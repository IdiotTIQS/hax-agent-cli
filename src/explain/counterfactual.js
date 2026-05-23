'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a similarity score between two outcomes (0-1).
 * Higher = more similar.
 *
 * @param {object} outcomeA
 * @param {object} outcomeB
 * @returns {number}
 */
function outcomeSimilarity(outcomeA, outcomeB) {
  if (!outcomeA || !outcomeB) return 0;
  let matches = 0;
  let total = 0;

  // Compare success state
  total += 1;
  if (outcomeA.success === outcomeB.success) matches += 1;

  // Compare chosen values
  total += 1;
  if (outcomeA.chosen === outcomeB.chosen) matches += 1;

  // Compare result strings (prefix match)
  if (outcomeA.result !== undefined && outcomeB.result !== undefined) {
    total += 1;
    if (outcomeA.result === outcomeB.result) matches += 1;
  }

  return total > 0 ? matches / total : 0;
}

/**
 * Compute an impact score for a decision given its outcome.
 * High impact: decision significantly changed the course of action.
 *
 * @param {object} decision
 * @param {object} outcome
 * @returns {number} 0-1 impact score
 */
function computeImpactScore(decision, outcome) {
  let score = 0;
  let maxScore = 0;

  // Factor: number of alternatives (more alternatives = more impactful choice)
  maxScore += 3;
  const altCount = Array.isArray(decision.alternatives) ? decision.alternatives.length : 0;
  if (altCount >= 5) score += 3;
  else if (altCount >= 3) score += 2;
  else if (altCount >= 1) score += 1;

  // Factor: was it an error recovery? (yes = high impact)
  maxScore += 3;
  if (decision.type === 'error_recovery') score += 3;
  else if (decision.type === 'tool_selection') score += 2;
  else if (decision.type === 'response_path') score += 1;

  // Factor: outcome success matters for impact
  maxScore += 2;
  if (outcome && outcome.success === false) score += 2; // failures are impactful
  else if (outcome && outcome.success === true) score += 1;

  // Factor: high confidence decisions that failed are very impactful
  maxScore += 2;
  if (decision.confidence >= 0.7 && outcome && outcome.success === false) score += 2;
  else if (decision.confidence < 0.4 && outcome && outcome.success === true) score += 1; // surprising success

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Generate a unique report ID.
 * @returns {string}
 */
function generateReportId() {
  return `cfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// CounterfactualEngine
// ---------------------------------------------------------------------------

/**
 * Explores "what-if" scenarios for agent decisions, comparing actual outcomes
 * against alternative paths that could have been taken.
 *
 * Usage:
 *   const engine = new CounterfactualEngine(tracer);
 *   const analysis = engine.whatIf(decision, selectedAlternative);
 *   const comparison = engine.compareOutcomes(decision, allAlternatives);
 *   const pivotal = engine.findPivotalDecision('session-123');
 *   const report = engine.generateWhatIfReport(decision, alternatives);
 */
class CounterfactualEngine {
  /**
   * @param {object} tracer - a DecisionTracer instance
   * @param {object} [options]
   * @param {boolean} [options.enabled] - whether counterfactual analysis is active (default: true)
   */
  constructor(tracer, options = {}) {
    if (!tracer || typeof tracer.getDecisionTree !== 'function') {
      throw new TypeError('CounterfactualEngine requires a DecisionTracer instance');
    }
    this._tracer = tracer;
    this._enabled = options.enabled !== false;
    this._analyses = new Map();
  }

  // ---------------------------------------------------------------------------
  // What-If Analysis
  // ---------------------------------------------------------------------------

  /**
   * Explore what would have happened if a different alternative was chosen.
   *
   * @param {object} decision - the original decision
   * @param {object|string} alternative - the alternative to explore (object with id/description, or string id)
   * @returns {object} what-if analysis
   */
  whatIf(decision, alternative) {
    if (!this._enabled || !decision) {
      return { error: 'Counterfactual analysis is disabled or no decision provided.' };
    }

    const altId = typeof alternative === 'string' ? alternative : (alternative.id || alternative.description || 'unknown');
    const originalChosen = decision.outcome ? decision.outcome.chosen : (decision.chosen || 'unknown');

    if (altId === originalChosen) {
      return {
        decisionId: decision.id,
        analysisType: 'what_if',
        alternativeId: altId,
        note: 'The selected alternative matches the original choice. No counterfactual difference.',
        isSameChoice: true,
        outcomesCompared: false,
      };
    }

    // Find the alternative details from the decision
    const altDetails = Array.isArray(decision.alternatives)
      ? decision.alternatives.find((a) => a.id === altId || a.description === altId)
      : null;

    // Estimate the counterfactual outcome
    const estimatedOutcome = this._estimateCounterfactualOutcome(decision, altDetails, altId);

    // Compare with actual outcome
    const actualOutcome = decision.outcome || {};

    const analysis = {
      id: generateReportId(),
      decisionId: decision.id,
      analysisType: 'what_if',
      timestamp: new Date().toISOString(),
      originalChoice: {
        id: originalChosen,
        outcome: actualOutcome,
      },
      alternativeChoice: {
        id: altId,
        estimatedOutcome,
        details: altDetails || { id: altId, description: 'Unknown alternative' },
      },
      comparison: {
        estimatedImprovement: estimatedOutcome.potentialImprovement || 'unknown',
        riskLevel: estimatedOutcome.riskLevel || 'unknown',
        confidenceInEstimate: estimatedOutcome.confidence || 0.5,
      },
    };

    // Cache the analysis
    this._analyses.set(analysis.id, analysis);

    return analysis;
  }

  // ---------------------------------------------------------------------------
  // Outcome Comparison
  // ---------------------------------------------------------------------------

  /**
   * Compare the actual outcome against all considered alternatives.
   *
   * @param {object} decision - the original decision
   * @param {Array<string|object>} [alternatives] - alternatives to compare (default: from decision)
   * @returns {object} comparison results
   */
  compareOutcomes(decision, alternatives) {
    if (!this._enabled || !decision) {
      return { error: 'Counterfactual analysis is disabled or no decision provided.' };
    }

    const alts = Array.isArray(alternatives) && alternatives.length > 0
      ? alternatives
      : (Array.isArray(decision.alternatives) ? decision.alternatives : []);

    if (alts.length === 0) {
      return {
        decisionId: decision.id,
        comparisonCount: 0,
        note: 'No alternatives available for comparison.',
        rankings: [],
      };
    }

    const actualOutcome = decision.outcome || {};
    const actualChosen = actualOutcome.chosen || (decision.chosen || null);

    // Compare each alternative against the actual choice
    const rankings = alts.map((alt) => {
      const altId = typeof alt === 'string' ? alt : (alt.id || alt.description || 'unknown');
      const isActualChoice = altId === actualChosen;

      // Estimate outcome for this alternative
      const estimated = this._estimateCounterfactualOutcome(decision, alt, altId);

      let rank = 'unknown';
      if (isActualChoice) {
        rank = actualOutcome.success === true ? 'best_choice' : 'baseline';
      } else if (estimated.potentialImprovement === 'significant_improvement') {
        rank = 'missed_opportunity';
      } else if (estimated.potentialImprovement === 'significant_risk') {
        rank = 'correctly_avoided';
      } else if (estimated.potentialImprovement === 'similar') {
        rank = 'equivalent';
      }

      return {
        alternativeId: altId,
        description: typeof alt === 'string' ? alt : (alt.description || ''),
        isActualChoice,
        estimatedOutcome: estimated,
        rank,
      };
    });

    // Sort: missed opportunities first, then correctly avoided, then equivalent
    const rankOrder = { missed_opportunity: 0, best_choice: 1, correctly_avoided: 2, baseline: 3, equivalent: 4, unknown: 5 };
    rankings.sort((a, b) => (rankOrder[a.rank] || 5) - (rankOrder[b.rank] || 5));

    const comparison = {
      decisionId: decision.id,
      analysisType: 'comparison',
      timestamp: new Date().toISOString(),
      actualChoice: {
        id: actualChosen,
        outcome: actualOutcome,
      },
      comparisonCount: alts.length,
      rankings,
      summary: {
        missedOpportunities: rankings.filter((r) => r.rank === 'missed_opportunity'),
        correctlyAvoided: rankings.filter((r) => r.rank === 'correctly_avoided'),
        equivalent: rankings.filter((r) => r.rank === 'equivalent'),
        bestChoice: rankings.filter((r) => r.rank === 'best_choice'),
      },
    };

    this._analyses.set(comparison.decisionId + '_comparison', comparison);

    return comparison;
  }

  // ---------------------------------------------------------------------------
  // Impact Estimation
  // ---------------------------------------------------------------------------

  /**
   * Estimate the impact of a decision given its outcome.
   *
   * @param {object} decision - the decision to evaluate
   * @param {object} outcome - the observed outcome
   * @returns {object} impact estimation
   */
  estimateImpact(decision, outcome) {
    if (!this._enabled || !decision) {
      return { error: 'Counterfactual analysis is disabled or no decision provided.' };
    }

    const impactScore = computeImpactScore(decision, outcome || decision.outcome || {});

    let impactLevel = 'unknown';
    let description = '';

    if (impactScore >= 0.7) {
      impactLevel = 'critical';
      description = 'This decision had a critical impact on the session trajectory. The choice significantly altered the course of action.';
    } else if (impactScore >= 0.5) {
      impactLevel = 'major';
      description = 'This decision had a major impact. The choice notably influenced subsequent actions.';
    } else if (impactScore >= 0.3) {
      impactLevel = 'moderate';
      description = 'This decision had a moderate impact, influencing some follow-up actions but not fundamentally changing the trajectory.';
    } else if (impactScore >= 0.1) {
      impactLevel = 'minor';
      description = 'This decision had a minor impact. The choice was unlikely to change the overall outcome.';
    } else {
      impactLevel = 'negligible';
      description = 'This decision had negligible impact. Any alternative would have led to similar results.';
    }

    return {
      decisionId: decision.id,
      impactScore: Math.round(impactScore * 1000) / 1000,
      impactLevel,
      description,
      factors: {
        alternativeCount: Array.isArray(decision.alternatives) ? decision.alternatives.length : 0,
        decisionType: decision.type || 'general',
        wasErrorRecovery: decision.type === 'error_recovery',
        wasFailure: outcome ? outcome.success === false : false,
        confidenceMismatch: decision.confidence >= 0.7 && outcome && outcome.success === false,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Pivotal Decision Detection
  // ---------------------------------------------------------------------------

  /**
   * Find the decision that mattered most in a session.
   * The pivotal decision is the one whose alternatives would have most
   * significantly changed the session's trajectory.
   *
   * @param {string|object} session - session ID or session decision tree object
   * @returns {object} pivotal decision analysis
   */
  findPivotalDecision(session) {
    if (!this._enabled) {
      return { error: 'Counterfactual analysis is disabled.' };
    }

    let decisions;
    let sessionId;

    if (typeof session === 'string') {
      const tree = this._tracer.getDecisionTree(session);
      decisions = tree.decisions;
      sessionId = session;
    } else if (session && Array.isArray(session.decisions)) {
      decisions = session.decisions;
      sessionId = session.sessionId || 'unknown';
    } else if (Array.isArray(session)) {
      decisions = session;
      sessionId = 'unknown';
    } else {
      return { error: 'Invalid session data. Provide a sessionId or decision array.' };
    }

    if (!Array.isArray(decisions) || decisions.length === 0) {
      return {
        sessionId,
        totalDecisions: 0,
        note: 'No decisions available to analyze.',
        pivotalDecision: null,
      };
    }

    // Score each decision for "pivotal-ness"
    const scored = decisions.map((d) => {
      const outcome = d.outcome || {};
      const impact = computeImpactScore(d, outcome);

      // Boost: decisions with many alternatives
      const altBoost = Array.isArray(d.alternatives) ? Math.min(d.alternatives.length / 10, 0.2) : 0;

      // Boost: error recovery decisions (these are inherently pivotal)
      const errorBoost = d.type === 'error_recovery' ? 0.15 : 0;

      // Boost: decisions that failed
      const failureBoost = outcome.success === false ? 0.1 : 0;

      // Boost: earlier decisions have more downstream impact
      const position = decisions.indexOf(d);
      const positionBoost = decisions.length > 1
        ? (1 - position / (decisions.length - 1)) * 0.1
        : 0;

      const pivotalScore = Math.min(impact + altBoost + errorBoost + failureBoost + positionBoost, 1);

      return {
        decision: d,
        pivotalScore: Math.round(pivotalScore * 1000) / 1000,
        factors: {
          baseImpact: Math.round(impact * 1000) / 1000,
          alternativeCount: Array.isArray(d.alternatives) ? d.alternatives.length : 0,
          isErrorRecovery: d.type === 'error_recovery',
          isFailure: outcome.success === false,
          isEarlyDecision: position < decisions.length / 3,
        },
      };
    });

    // Sort by pivotal score descending
    scored.sort((a, b) => b.pivotalScore - a.pivotalScore);

    const top = scored[0];
    const runnerUp = scored.length > 1 ? scored[1] : null;

    let pivotalDescription = '';
    if (top.pivotalScore >= 0.7) {
      pivotalDescription = `${top.decision.type} decision "${top.decision.outcome?.chosen || top.decision.id}" was the most pivotal in this session. Changing this decision would likely alter the entire trajectory.`;
    } else if (top.pivotalScore >= 0.4) {
      pivotalDescription = `${top.decision.type} decision "${top.decision.outcome?.chosen || top.decision.id}" was moderately pivotal. Alternatives had some potential to change outcomes.`;
    } else {
      pivotalDescription = `No single decision stands out as highly pivotal. The session had a relatively flat impact distribution.`;
    }

    const analysis = {
      sessionId,
      totalDecisions: decisions.length,
      pivotalDecision: {
        id: top.decision.id,
        type: top.decision.type,
        chosen: top.decision.outcome?.chosen || null,
        timestamp: top.decision.timestamp,
        pivotalScore: top.pivotalScore,
        factors: top.factors,
        rationale: top.decision.rationale,
        description: pivotalDescription,
      },
      runnerUp: runnerUp ? {
        id: runnerUp.decision.id,
        type: runnerUp.decision.type,
        chosen: runnerUp.decision.outcome?.chosen || null,
        pivotalScore: runnerUp.pivotalScore,
      } : null,
      allScores: scored.map((s) => ({
        id: s.decision.id,
        type: s.decision.type,
        chosen: s.decision.outcome?.chosen || null,
        pivotalScore: s.pivotalScore,
      })),
    };

    this._analyses.set(`pivotal_${sessionId}`, analysis);

    return analysis;
  }

  // ---------------------------------------------------------------------------
  // What-If Report
  // ---------------------------------------------------------------------------

  /**
   * Generate a structured what-if analysis report.
   *
   * @param {object} decision - the decision to analyze
   * @param {Array<string|object>} [alternatives] - alternatives to explore (default: from decision)
   * @returns {object} what-if report
   */
  generateWhatIfReport(decision, alternatives) {
    if (!this._enabled || !decision) {
      return {
        reportId: generateReportId(),
        generatedAt: new Date().toISOString(),
        error: 'Counterfactual analysis is disabled or no decision provided.',
      };
    }

    const alts = Array.isArray(alternatives) && alternatives.length > 0
      ? alternatives
      : (Array.isArray(decision.alternatives) ? decision.alternatives : []);

    const actualChosen = decision.outcome?.chosen || decision.chosen || 'unknown';

    // Run what-if for each alternative (except the actual choice)
    const whatIfResults = [];
    for (const alt of alts) {
      const altId = typeof alt === 'string' ? alt : (alt.id || alt.description || '');
      if (altId === actualChosen) continue; // skip the actual choice
      const result = this.whatIf(decision, alt);
      whatIfResults.push(result);
    }

    // Run comparison
    const comparison = this.compareOutcomes(decision, alts);

    // Estimate impact
    const impact = this.estimateImpact(decision, decision.outcome || {});

    // Identify best alternative not taken
    const opportunities = comparison.rankings
      ? comparison.rankings.filter((r) => r.rank === 'missed_opportunity')
      : [];
    const bestMissed = opportunities.length > 0 ? opportunities[0] : null;

    // Identify worst alternative avoided
    const avoided = comparison.rankings
      ? comparison.rankings.filter((r) => r.rank === 'correctly_avoided')
      : [];
    const bestAvoided = avoided.length > 0 ? avoided[0] : null;

    const report = {
      reportId: generateReportId(),
      generatedAt: new Date().toISOString(),
      decision: {
        id: decision.id,
        type: decision.type,
        timestamp: decision.timestamp,
        agentId: decision.agentId,
        context: decision.context || {},
        rationale: decision.rationale || '',
        confidence: decision.confidence,
      },
      actualOutcome: decision.outcome || {},
      impact,
      whatIfScenarios: whatIfResults.map((r) => ({
        alternativeId: r.alternativeChoice?.id || r.alternativeId,
        estimatedOutcome: r.alternativeChoice?.estimatedOutcome || null,
        comparison: r.comparison || null,
        isSameChoice: r.isSameChoice || false,
      })),
      comparison,
      recommendations: {
        bestMissedOpportunity: bestMissed ? {
          alternativeId: bestMissed.alternativeId,
          description: bestMissed.description,
          note: 'This alternative might have produced a better outcome. Consider for similar future decisions.',
        } : null,
        bestRiskAvoided: bestAvoided ? {
          alternativeId: bestAvoided.alternativeId,
          description: bestAvoided.description,
          note: 'Avoiding this alternative likely prevented a worse outcome.',
        } : null,
        decisionQuality: impact.impactLevel === 'critical' || impact.impactLevel === 'major'
          ? 'This was a high-impact decision. Review the rationale carefully to ensure it was made with sufficient consideration.'
          : 'This was a routine decision with moderate-to-low impact.',
      },
    };

    this._analyses.set(report.reportId, report);

    return report;
  }

  /**
   * Get a previously generated analysis by ID.
   * @param {string} analysisId
   * @returns {object|undefined}
   */
  getAnalysis(analysisId) {
    for (const [, analysis] of this._analyses) {
      if (analysis.id === analysisId || analysis.reportId === analysisId) {
        return analysis;
      }
    }
    return undefined;
  }

  /**
   * Clear all cached analyses.
   */
  reset() {
    this._analyses.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Estimate what the outcome would have been if a different alternative was chosen.
   *
   * @param {object} decision - the original decision
   * @param {object|null} alternative - details about the alternative
   * @param {string} alternativeId - identifier for the alternative
   * @returns {object} estimated counterfactual outcome
   */
  _estimateCounterfactualOutcome(decision, alternative, alternativeId) {
    const actualOutcome = decision.outcome || {};

    // Factors that influence the estimate
    let estimatedSuccess = null;
    let riskLevel = 'unknown';
    let potentialImprovement = 'unknown';
    let confidence = 0.3; // low confidence by default for counterfactuals

    if (!alternative) {
      return {
        estimatedSuccess: null,
        riskLevel: 'high',
        potentialImprovement: 'unknown',
        confidence: 0.1,
        reasoning: `Alternative "${alternativeId}" has no detailed information. Cannot estimate outcome reliably.`,
      };
    }

    // If the alternative has a lower score than the chosen, it's likely worse
    const altScore = Number.isFinite(alternative.score) ? alternative.score : null;
    const chosenAlt = Array.isArray(decision.alternatives)
      ? decision.alternatives.find((a) => a.id === (actualOutcome.chosen || ''))
      : null;
    const chosenScore = chosenAlt && Number.isFinite(chosenAlt.score) ? chosenAlt.score : null;

    // Check pros/cons for signals
    const pros = Array.isArray(alternative.pros) ? alternative.pros : [];
    const cons = Array.isArray(alternative.cons) ? alternative.cons : [];

    let reasoning = '';

    // Heuristic 1: Score comparison
    if (altScore !== null && chosenScore !== null) {
      if (altScore >= chosenScore + 0.2) {
        potentialImprovement = 'significant_improvement';
        estimatedSuccess = true;
        riskLevel = 'low';
        confidence = 0.6;
        reasoning = `Alternative scored higher (${altScore} vs ${chosenScore}), suggesting better outcomes.`;
      } else if (altScore <= chosenScore - 0.2) {
        potentialImprovement = 'significant_risk';
        estimatedSuccess = false;
        riskLevel = 'high';
        confidence = 0.6;
        reasoning = `Alternative scored lower (${altScore} vs ${chosenScore}), suggesting worse outcomes.`;
      } else {
        potentialImprovement = 'similar';
        estimatedSuccess = actualOutcome.success;
        riskLevel = 'moderate';
        confidence = 0.5;
        reasoning = `Alternative scored similarly (${altScore} vs ${chosenScore}), suggesting comparable outcomes.`;
      }
    } else {
      // No scores — use pros/cons counts as a rough heuristic
      if (cons.length > pros.length + 1) {
        potentialImprovement = 'significant_risk';
        estimatedSuccess = false;
        riskLevel = 'high';
        confidence = 0.4;
        reasoning = `Alternative has more cons (${cons.length}) than pros (${pros.length}), suggesting higher risk.`;
      } else if (pros.length > cons.length + 1) {
        potentialImprovement = 'significant_improvement';
        estimatedSuccess = true;
        riskLevel = 'low';
        confidence = 0.4;
        reasoning = `Alternative has more pros (${pros.length}) than cons (${cons.length}), suggesting better outcomes.`;
      } else {
        potentialImprovement = 'similar';
        riskLevel = 'moderate';
        confidence = 0.3;
        reasoning = `Insufficient data to distinguish outcomes between alternatives.`;
      }
    }

    // Heuristic 2: For error recovery, any strategy other than the chosen one is risky
    if (decision.type === 'error_recovery' && actualOutcome.success === true) {
      riskLevel = riskLevel === 'low' ? 'moderate' : riskLevel;
      confidence = Math.max(confidence - 0.1, 0.1);
      reasoning += ' Since the actual recovery succeeded, deviating introduces uncertainty.';
    }

    return {
      estimatedSuccess,
      riskLevel,
      potentialImprovement,
      confidence: Math.round(confidence * 100) / 100,
      reasoning,
      alternativeScore: altScore,
      chosenScore,
    };
  }
}

module.exports = { CounterfactualEngine };
