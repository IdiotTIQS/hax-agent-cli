'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a timestamp for display.
 * @param {string} ts - ISO timestamp
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts) return 'unknown';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC';
  } catch (_) {
    return ts;
  }
}

/**
 * Truncate a string for display.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 120) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...[truncated]';
}

/**
 * Capitalize the first letter of each word.
 * @param {string} str
 * @returns {string}
 */
function titleCase(str) {
  if (!str) return '';
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a decision pattern fingerprint from context keys and type.
 * @param {object} decision
 * @returns {string}
 */
function patternFingerprint(decision) {
  const contextKeys = decision.context
    ? Object.keys(decision.context).sort().join(',')
    : '';
  return `${decision.type}|${contextKeys}`;
}

// ---------------------------------------------------------------------------
// ExplainabilityReport
// ---------------------------------------------------------------------------

/**
 * Generates human-readable reports from DecisionTracer data,
 * explaining why agents made specific choices across sessions.
 *
 * Usage:
 *   const tracer = new DecisionTracer();
 *   // ... trace decisions ...
 *   const report = new ExplainabilityReport(tracer);
 *   const sessionReport = report.generateSessionReport('session-123');
 *   const summary = report.generateSummaryReport(tracer.getSessionIds());
 */
class ExplainabilityReport {
  /**
   * @param {object} tracer - a DecisionTracer instance
   * @param {object} [options]
   * @param {string} [options.defaultFormat] - 'text' | 'markdown' | 'json' (default: 'text')
   */
  constructor(tracer, options = {}) {
    if (!tracer || typeof tracer.getDecisionTree !== 'function') {
      throw new TypeError('ExplainabilityReport requires a DecisionTracer instance');
    }
    this._tracer = tracer;
    this._defaultFormat = options.defaultFormat || 'text';
  }

  // ---------------------------------------------------------------------------
  // Session Report
  // ---------------------------------------------------------------------------

  /**
   * Generate a full explainability report for a session.
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {string} [options.format] - 'text' | 'markdown' | 'json'
   * @returns {object|string} formatted report
   */
  generateSessionReport(sessionId, options = {}) {
    const format = options.format || this._defaultFormat;
    const tree = this._tracer.getDecisionTree(sessionId);

    if (tree.totalDecisions === 0) {
      return this._formatOutput({
        sessionId,
        empty: true,
        message: `No decisions recorded for session "${sessionId}".`,
      }, format);
    }

    const decisions = tree.decisions.map((d) => this._enrichDecision(d));
    const patterns = this.identifyDecisionPatterns(decisions);

    const report = {
      sessionId,
      generatedAt: new Date().toISOString(),
      summary: {
        totalDecisions: tree.totalDecisions,
        timeRange: `${formatTime(tree.startTime)} -> ${formatTime(tree.endTime)}`,
        typeBreakdown: tree.summary.typeBreakdown || {},
        avgConfidence: tree.summary.avgConfidence,
        successRate: tree.summary.successRate,
      },
      timeline: decisions.map((d) => ({
        id: d.id,
        timestamp: formatTime(d.timestamp),
        type: d.type,
        agentId: d.agentId,
        chosen: d.outcome ? d.outcome.chosen : null,
        rationale: d.rationale,
        confidence: d.confidence,
        confidenceLabel: d.confidenceLabel,
        success: d.outcome ? d.outcome.success : null,
      })),
      patterns: patterns.map((p) => ({
        type: p.type,
        count: p.count,
        description: p.description,
        avgConfidence: p.avgConfidence,
        successRate: p.successRate,
      })),
      decisions: decisions,
    };

    return this._formatOutput(report, format);
  }

  // ---------------------------------------------------------------------------
  // Decision Report
  // ---------------------------------------------------------------------------

  /**
   * Deep-dive analysis on a single decision.
   *
   * @param {string} decisionId
   * @param {object} [options]
   * @param {string} [options.format] - 'text' | 'markdown' | 'json'
   * @returns {object|string} formatted report
   */
  generateDecisionReport(decisionId, options = {}) {
    const format = options.format || this._defaultFormat;

    // Search across all sessions for the decision
    let decision = null;
    let foundSessionId = null;
    for (const sessionId of this._tracer.getSessionIds()) {
      const tree = this._tracer.getDecisionTree(sessionId);
      const found = tree.decisions.find((d) => d.id === decisionId);
      if (found) {
        decision = found;
        foundSessionId = sessionId;
        break;
      }
    }

    if (!decision) {
      return this._formatOutput({
        decisionId,
        empty: true,
        message: `Decision "${decisionId}" not found.`,
      }, format);
    }

    // Find related decisions (same session, before and after)
    const sessionTree = this._tracer.getDecisionTree(foundSessionId);
    const decisions = sessionTree.decisions;
    const decisionIndex = decisions.findIndex((d) => d.id === decisionId);
    const priorDecisions = decisions.slice(0, decisionIndex).map((d) => ({
      id: d.id,
      type: d.type,
      timestamp: d.timestamp,
      rationale: d.rationale,
    }));
    const subsequentDecisions = decisions.slice(decisionIndex + 1).map((d) => ({
      id: d.id,
      type: d.type,
      timestamp: d.timestamp,
      rationale: d.rationale,
    }));

    const enriched = this._enrichDecision(decision);
    const quality = this.evaluateDecisionQuality(decision, decision.outcome);

    const report = {
      decisionId,
      sessionId: foundSessionId,
      generatedAt: new Date().toISOString(),
      decision: {
        id: enriched.id,
        timestamp: formatTime(enriched.timestamp),
        type: enriched.type,
        agentId: enriched.agentId,
        context: enriched.context,
        alternatives: enriched.alternatives,
        rationale: enriched.rationale,
        confidence: enriched.confidence,
        confidenceLabel: enriched.confidenceLabel,
        outcome: enriched.outcome,
        metadata: enriched.metadata,
      },
      quality,
      context: {
        priorDecisions: priorDecisions.length,
        priorDecisionIds: priorDecisions.map((d) => d.id),
        subsequentDecisions: subsequentDecisions.length,
        subsequentDecisionIds: subsequentDecisions.map((d) => d.id),
      },
    };

    return this._formatOutput(report, format);
  }

  // ---------------------------------------------------------------------------
  // Summary Report
  // ---------------------------------------------------------------------------

  /**
   * Generate a summary report across multiple sessions or all sessions.
   *
   * @param {string[]} [sessions] - session IDs to include (default: all)
   * @param {object} [options]
   * @param {string} [options.format] - 'text' | 'markdown' | 'json'
   * @returns {object|string} formatted report
   */
  generateSummaryReport(sessions, options = {}) {
    const format = options.format || this._defaultFormat;
    const sessionIds = Array.isArray(sessions) && sessions.length > 0
      ? sessions
      : this._tracer.getSessionIds();

    if (sessionIds.length === 0) {
      return this._formatOutput({
        empty: true,
        message: 'No sessions with recorded decisions found.',
      }, format);
    }

    const allDecisions = [];
    const sessionSummaries = [];

    for (const sessionId of sessionIds) {
      const tree = this._tracer.getDecisionTree(sessionId);
      allDecisions.push(...tree.decisions);
      sessionSummaries.push({
        sessionId,
        totalDecisions: tree.totalDecisions,
        startTime: tree.startTime,
        endTime: tree.endTime,
        typeBreakdown: tree.summary.typeBreakdown,
        avgConfidence: tree.summary.avgConfidence,
        successRate: tree.summary.successRate,
      });
    }

    const patterns = this.identifyDecisionPatterns(allDecisions);
    const typeBreakdown = {};
    const confidences = [];
    const successCounts = { true: 0, false: 0, unknown: 0 };

    for (const d of allDecisions) {
      typeBreakdown[d.type] = (typeBreakdown[d.type] || 0) + 1;
      if (d.confidence != null) confidences.push(d.confidence);
      if (d.outcome && d.outcome.success === true) successCounts.true += 1;
      else if (d.outcome && d.outcome.success === false) successCounts.false += 1;
      else successCounts.unknown += 1;
    }

    const total = successCounts.true + successCounts.false;

    const report = {
      generatedAt: new Date().toISOString(),
      sessionsAnalyzed: sessionIds.length,
      totalDecisions: allDecisions.length,
      overall: {
        typeBreakdown,
        avgConfidence: confidences.length > 0
          ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000
          : null,
        successRate: total > 0
          ? Math.round((successCounts.true / total) * 1000) / 1000
          : null,
        successCounts,
      },
      sessionSummaries,
      patterns,
      topRationales: this._topRationales(allDecisions, 5),
    };

    return this._formatOutput(report, format);
  }

  // ---------------------------------------------------------------------------
  // Pattern Detection
  // ---------------------------------------------------------------------------

  /**
   * Identify common patterns in decision-making.
   *
   * @param {object[]} [decisions] - decisions to analyze (default: all)
   * @returns {object[]} pattern descriptions
   */
  identifyDecisionPatterns(decisions) {
    const source = Array.isArray(decisions) ? decisions : this._tracer.getAllDecisions({ limit: 1000 });
    const patterns = [];

    if (source.length === 0) return patterns;

    // Pattern 1: Type distribution
    const typeCounts = {};
    for (const d of source) {
      typeCounts[d.type] = (typeCounts[d.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(typeCounts)) {
      const typeDecisions = source.filter((d) => d.type === type);
      const confidences = typeDecisions.map((d) => d.confidence).filter((c) => c != null);
      const successes = typeDecisions.filter((d) => d.outcome && d.outcome.success === true).length;
      const failures = typeDecisions.filter((d) => d.outcome && d.outcome.success === false).length;
      const total = successes + failures;

      patterns.push({
        type: `decision_type:${type}`,
        count,
        percentage: Math.round((count / source.length) * 1000) / 10,
        description: `${titleCase(type)} decisions are the most frequent type (${count} of ${source.length} total).`,
        avgConfidence: confidences.length > 0
          ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000
          : null,
        successRate: total > 0 ? Math.round((successes / total) * 1000) / 1000 : null,
      });
    }

    // Pattern 2: Confidence clustering (high-confidence vs low-confidence choices)
    const highConf = source.filter((d) => d.confidence >= 0.7);
    const lowConf = source.filter((d) => d.confidence < 0.4 && d.confidence != null);
    if (highConf.length > 0) {
      patterns.push({
        type: 'high_confidence_decisions',
        count: highConf.length,
        percentage: Math.round((highConf.length / source.length) * 1000) / 10,
        description: `${highConf.length} decisions were made with high confidence (>= 0.7).`,
        avgConfidence: null,
        successRate: null,
      });
    }
    if (lowConf.length > 0) {
      patterns.push({
        type: 'low_confidence_decisions',
        count: lowConf.length,
        percentage: Math.round((lowConf.length / source.length) * 1000) / 10,
        description: `${lowConf.length} decisions were made with low confidence (< 0.4), indicating uncertainty.`,
        avgConfidence: null,
        successRate: null,
      });
    }

    // Pattern 3: Sequential tool usage patterns
    const toolSelections = source.filter((d) => d.type === 'tool_selection' && d.outcome && d.outcome.chosen);
    if (toolSelections.length >= 2) {
      const pairs = [];
      for (let i = 0; i < toolSelections.length - 1; i++) {
        const prev = toolSelections[i].outcome.chosen;
        const next = toolSelections[i + 1].outcome.chosen;
        if (prev && next) pairs.push(`${prev} -> ${next}`);
      }

      const pairCounts = {};
      for (const pair of pairs) {
        pairCounts[pair] = (pairCounts[pair] || 0) + 1;
      }

      const sortedPairs = Object.entries(pairCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      for (const [pair, count] of sortedPairs) {
        patterns.push({
          type: 'tool_sequence',
          count,
          description: `Common tool sequence: ${pair} (${count} occurrences).`,
          avgConfidence: null,
          successRate: null,
        });
      }
    }

    // Pattern 4: Error recovery effectiveness
    const recoveryDecisions = source.filter((d) => d.type === 'error_recovery');
    if (recoveryDecisions.length > 0) {
      const successful = recoveryDecisions.filter((d) => d.outcome && d.outcome.success === true).length;
      const recoveryStrategies = {};
      for (const rd of recoveryDecisions) {
        const chosen = rd.outcome && rd.outcome.chosen;
        if (chosen) {
          if (!recoveryStrategies[chosen]) recoveryStrategies[chosen] = { total: 0, success: 0 };
          recoveryStrategies[chosen].total += 1;
          if (rd.outcome.success === true) recoveryStrategies[chosen].success += 1;
        }
      }

      patterns.push({
        type: 'error_recovery_effectiveness',
        count: recoveryDecisions.length,
        percentage: Math.round((recoveryDecisions.length / source.length) * 1000) / 10,
        description: `${successful} of ${recoveryDecisions.length} error recovery decisions succeeded.`,
        avgConfidence: null,
        successRate: recoveryDecisions.length > 0
          ? Math.round((successful / recoveryDecisions.length) * 1000) / 1000
          : null,
      });

      // Top recovery strategies
      const sortedStrategies = Object.entries(recoveryStrategies)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 3);

      for (const [strat, stats] of sortedStrategies) {
        patterns.push({
          type: 'recovery_strategy',
          count: stats.total,
          description: `Recovery strategy "${strat}" used ${stats.total} times (${stats.success} successful).`,
          avgConfidence: null,
          successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 1000) / 1000 : null,
        });
      }
    }

    return patterns;
  }

  // ---------------------------------------------------------------------------
  // Decision Quality
  // ---------------------------------------------------------------------------

  /**
   * Evaluate the quality of a decision given its trace and observed outcome.
   *
   * @param {object} trace - the decision trace
   * @param {object} outcome - the observed outcome
   * @returns {object} quality assessment
   */
  evaluateDecisionQuality(trace, outcome) {
    if (!trace) {
      return { score: 0, level: 'unknown', factors: [], notes: 'No trace data available.' };
    }

    const factors = [];
    let score = 0;
    let maxScore = 0;

    // Factor 1: Number of alternatives considered (1-4 points)
    maxScore += 4;
    const altCount = Array.isArray(trace.alternatives) ? trace.alternatives.length : 0;
    if (altCount >= 5) {
      score += 4;
      factors.push({ factor: 'alternatives_considered', score: 4, max: 4, detail: `${altCount} alternatives considered (comprehensive).` });
    } else if (altCount >= 3) {
      score += 3;
      factors.push({ factor: 'alternatives_considered', score: 3, max: 4, detail: `${altCount} alternatives considered (adequate).` });
    } else if (altCount >= 1) {
      score += 2;
      factors.push({ factor: 'alternatives_considered', score: 2, max: 4, detail: `${altCount} alternatives considered (minimal).` });
    } else {
      factors.push({ factor: 'alternatives_considered', score: 0, max: 4, detail: 'No alternatives documented.' });
    }

    // Factor 2: Rationale quality (1-3 points)
    maxScore += 3;
    const rationale = trace.rationale || '';
    if (rationale.length >= 80) {
      score += 3;
      factors.push({ factor: 'rationale_detail', score: 3, max: 3, detail: 'Detailed rationale provided.' });
    } else if (rationale.length >= 20) {
      score += 2;
      factors.push({ factor: 'rationale_detail', score: 2, max: 3, detail: 'Adequate rationale provided.' });
    } else if (rationale.length > 0) {
      score += 1;
      factors.push({ factor: 'rationale_detail', score: 1, max: 3, detail: 'Minimal rationale provided.' });
    } else {
      factors.push({ factor: 'rationale_detail', score: 0, max: 3, detail: 'No rationale documented.' });
    }

    // Factor 3: Outcome success (0-3 points)
    maxScore += 3;
    if (outcome && outcome.success === true) {
      score += 3;
      factors.push({ factor: 'outcome_success', score: 3, max: 3, detail: 'Decision resulted in successful outcome.' });
    } else if (outcome && outcome.success === false) {
      factors.push({ factor: 'outcome_success', score: 0, max: 3, detail: 'Decision resulted in unsuccessful outcome.' });
    } else {
      score += 1;
      factors.push({ factor: 'outcome_success', score: 1, max: 3, detail: 'Outcome not yet recorded.' });
    }

    // Factor 4: Confidence-to-outcome alignment (0-2 points bonus)
    maxScore += 2;
    if (outcome && outcome.success === true && trace.confidence >= 0.6) {
      score += 2;
      factors.push({ factor: 'confidence_alignment', score: 2, max: 2, detail: 'High confidence aligned with successful outcome.' });
    } else if (outcome && outcome.success === false && trace.confidence < 0.6) {
      score += 2;
      factors.push({ factor: 'confidence_alignment', score: 2, max: 2, detail: 'Low confidence appropriately signaled risky decision.' });
    } else if (outcome && outcome.success === false && trace.confidence >= 0.7) {
      factors.push({ factor: 'confidence_alignment', score: 0, max: 2, detail: 'High confidence but failed outcome — potential overconfidence.' });
    } else {
      score += 1;
      factors.push({ factor: 'confidence_alignment', score: 1, max: 2, detail: 'Confidence-outcome alignment is neutral or unknown.' });
    }

    // Normalize to 0-1 scale
    const normalizedScore = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 1000 : 0;
    let level = 'unknown';
    if (normalizedScore >= 0.8) level = 'excellent';
    else if (normalizedScore >= 0.6) level = 'good';
    else if (normalizedScore >= 0.4) level = 'fair';
    else if (normalizedScore >= 0.2) level = 'poor';
    else level = 'very_poor';

    return {
      score: normalizedScore,
      level,
      rawScore: score,
      maxScore,
      factors,
    };
  }

  // ---------------------------------------------------------------------------
  // Export Formats
  // ---------------------------------------------------------------------------

  /**
   * Export a report in the specified format.
   *
   * @param {object} report
   * @param {string} format - 'text' | 'markdown' | 'json'
   * @returns {string|object}
   */
  export(report, format) {
    return this._formatOutput(report, format || this._defaultFormat);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Enrich a decision with computed fields for reporting.
   * @param {object} decision
   * @returns {object}
   */
  _enrichDecision(decision) {
    const d = { ...decision };
    d.alternativeCount = Array.isArray(d.alternatives) ? d.alternatives.length : 0;
    d.topAlternative = Array.isArray(d.alternatives) && d.alternatives.length > 0
      ? d.alternatives.reduce((best, a) =>
          ((a.score || 0) > (best.score || 0) ? a : best), d.alternatives[0])
      : null;
    d.hasRationale = typeof d.rationale === 'string' && d.rationale.length > 0;
    d.hasOutcome = d.outcome && (d.outcome.success !== null);
    return d;
  }

  /**
   * Format report data for output.
   * @param {object} data
   * @param {string} format
   * @returns {string|object}
   */
  _formatOutput(data, format) {
    switch (format) {
      case 'json':
        return data;

      case 'markdown':
        return this._toMarkdown(data);

      case 'text':
      default:
        return this._toText(data);
    }
  }

  /**
   * Convert report to a plain text string.
   * @param {object} data
   * @returns {string}
   */
  _toText(data) {
    if (data.empty) return `[Explainability Report]\n${data.message}\n`;

    let out = '';

    // Session report
    if (data.sessionId && data.summary) {
      out += `=== Explainability Report: Session ${data.sessionId} ===\n\n`;
      out += `Generated: ${formatTime(data.generatedAt)}\n\n`;
      out += `Summary:\n`;
      out += `  Total Decisions: ${data.summary.totalDecisions}\n`;
      out += `  Time Range: ${data.summary.timeRange}\n`;
      out += `  Avg Confidence: ${data.summary.avgConfidence != null ? data.summary.avgConfidence : 'N/A'}\n`;
      out += `  Success Rate: ${data.summary.successRate != null ? (data.summary.successRate * 100).toFixed(1) + '%' : 'N/A'}\n`;
      out += `  Type Breakdown: ${JSON.stringify(data.summary.typeBreakdown)}\n`;
      out += '\n';

      if (data.patterns && data.patterns.length > 0) {
        out += `Decision Patterns:\n`;
        for (const p of data.patterns) {
          out += `  - ${p.description}\n`;
        }
        out += '\n';
      }

      if (data.timeline && data.timeline.length > 0) {
        out += `Decision Timeline:\n`;
        for (const t of data.timeline) {
          out += `  [${t.timestamp}] ${titleCase(t.type)} (${t.confidenceLabel})\n`;
          out += `    Chosen: ${t.chosen || 'N/A'}\n`;
          out += `    Rationale: ${truncate(t.rationale, 100)}\n`;
          out += `    Success: ${t.success !== null ? t.success : 'unknown'}\n`;
        }
        out += '\n';
      }
    }

    // Summary report
    if (data.overall) {
      out += `=== Cross-Session Explainability Summary ===\n\n`;
      out += `Generated: ${formatTime(data.generatedAt)}\n`;
      out += `Sessions Analyzed: ${data.sessionsAnalyzed}\n`;
      out += `Total Decisions: ${data.totalDecisions}\n\n`;
      out += `Overall:\n`;
      out += `  Type Breakdown: ${JSON.stringify(data.overall.typeBreakdown)}\n`;
      out += `  Avg Confidence: ${data.overall.avgConfidence != null ? data.overall.avgConfidence : 'N/A'}\n`;
      out += `  Success Rate: ${data.overall.successRate != null ? (data.overall.successRate * 100).toFixed(1) + '%' : 'N/A'}\n`;
      out += '\n';

      if (data.patterns && data.patterns.length > 0) {
        out += `Identified Patterns:\n`;
        for (const p of data.patterns) {
          out += `  - ${p.description}\n`;
        }
        out += '\n';
      }
    }

    // Decision report
    if (data.decisionId && data.decision) {
      out += `=== Decision Deep-Dive: ${data.decisionId} ===\n\n`;
      out += `Session: ${data.sessionId}\n`;
      out += `Generated: ${formatTime(data.generatedAt)}\n\n`;
      out += `Decision Details:\n`;
      out += `  Type: ${titleCase(data.decision.type)}\n`;
      out += `  Agent: ${data.decision.agentId}\n`;
      out += `  Timestamp: ${data.decision.timestamp}\n`;
      out += `  Confidence: ${data.decision.confidence} (${data.decision.confidenceLabel})\n`;
      out += `  Rationale: ${data.decision.rationale}\n`;
      out += '\n';

      if (data.quality) {
        out += `Quality Assessment:\n`;
        out += `  Score: ${data.quality.score} (${data.quality.level})\n`;
        for (const f of data.quality.factors) {
          out += `  - [${f.score}/${f.max}] ${f.factor}: ${f.detail}\n`;
        }
        out += '\n';
      }

      out += `Context: ${data.context.priorDecisions} prior decisions, ${data.context.subsequentDecisions} subsequent decisions\n`;
      out += '\n';

      if (data.decision.alternatives && data.decision.alternatives.length > 0) {
        out += `Alternatives Considered:\n`;
        for (const alt of data.decision.alternatives) {
          out += `  - ${alt.id} (score: ${alt.score != null ? alt.score : 'N/A'})\n`;
          out += `    ${alt.description}\n`;
        }
        out += '\n';
      }
    }

    return out;
  }

  /**
   * Convert report to a markdown string.
   * @param {object} data
   * @returns {string}
   */
  _toMarkdown(data) {
    if (data.empty) return `# Explainability Report\n\n${data.message}\n`;

    let out = '';

    // Session report
    if (data.sessionId && data.summary) {
      out += `# Explainability Report: Session \`${data.sessionId}\`\n\n`;
      out += `*Generated: ${formatTime(data.generatedAt)}*\n\n`;
      out += `## Summary\n\n`;
      out += `| Metric | Value |\n`;
      out += `|--------|-------|\n`;
      out += `| Total Decisions | ${data.summary.totalDecisions} |\n`;
      out += `| Time Range | ${data.summary.timeRange} |\n`;
      out += `| Avg Confidence | ${data.summary.avgConfidence != null ? data.summary.avgConfidence : 'N/A'} |\n`;
      out += `| Success Rate | ${data.summary.successRate != null ? (data.summary.successRate * 100).toFixed(1) + '%' : 'N/A'} |\n`;
      out += `| Type Breakdown | ${JSON.stringify(data.summary.typeBreakdown)} |\n`;
      out += '\n';

      if (data.patterns && data.patterns.length > 0) {
        out += `## Decision Patterns\n\n`;
        for (const p of data.patterns) {
          out += `- ${p.description}\n`;
        }
        out += '\n';
      }

      if (data.timeline && data.timeline.length > 0) {
        out += `## Decision Timeline\n\n`;
        for (const t of data.timeline) {
          out += `### ${t.timestamp} — ${titleCase(t.type)} (${t.confidenceLabel})\n\n`;
          out += `- **Chosen:** ${t.chosen || 'N/A'}\n`;
          out += `- **Rationale:** ${truncate(t.rationale, 120)}\n`;
          out += `- **Success:** ${t.success !== null ? t.success : 'unknown'}\n\n`;
        }
      }
    }

    // Summary report
    if (data.overall) {
      out += `# Cross-Session Explainability Summary\n\n`;
      out += `*Generated: ${formatTime(data.generatedAt)}*\n\n`;
      out += `| Metric | Value |\n`;
      out += `|--------|-------|\n`;
      out += `| Sessions Analyzed | ${data.sessionsAnalyzed} |\n`;
      out += `| Total Decisions | ${data.totalDecisions} |\n`;
      out += `| Avg Confidence | ${data.overall.avgConfidence != null ? data.overall.avgConfidence : 'N/A'} |\n`;
      out += `| Success Rate | ${data.overall.successRate != null ? (data.overall.successRate * 100).toFixed(1) + '%' : 'N/A'} |\n`;
      out += '\n';

      if (data.patterns && data.patterns.length > 0) {
        out += `## Identified Patterns\n\n`;
        for (const p of data.patterns) {
          out += `- ${p.description}\n`;
        }
        out += '\n';
      }
    }

    // Decision report
    if (data.decisionId && data.decision) {
      out += `# Decision Deep-Dive: \`${data.decisionId}\`\n\n`;
      out += `- **Session:** \`${data.sessionId}\`\n`;
      out += `- **Generated:** ${formatTime(data.generatedAt)}\n\n`;
      out += `## Decision Details\n\n`;
      out += `| Field | Value |\n`;
      out += `|-------|-------|\n`;
      out += `| Type | ${titleCase(data.decision.type)} |\n`;
      out += `| Agent | ${data.decision.agentId} |\n`;
      out += `| Timestamp | ${data.decision.timestamp} |\n`;
      out += `| Confidence | ${data.decision.confidence} (${data.decision.confidenceLabel}) |\n`;
      out += `| Rationale | ${data.decision.rationale} |\n`;
      out += '\n';

      if (data.quality) {
        out += `## Quality Assessment\n\n`;
        out += `**Score:** ${data.quality.score} (${data.quality.level})\n\n`;
        out += `| Factor | Score | Detail |\n`;
        out += `|--------|-------|--------|\n`;
        for (const f of data.quality.factors) {
          out += `| ${f.factor} | ${f.score}/${f.max} | ${f.detail} |\n`;
        }
        out += '\n';
      }

      if (data.decision.alternatives && data.decision.alternatives.length > 0) {
        out += `## Alternatives Considered\n\n`;
        for (const alt of data.decision.alternatives) {
          out += `- **${alt.id}** (score: ${alt.score != null ? alt.score : 'N/A'})\n`;
          out += `  ${alt.description}\n`;
        }
        out += '\n';
      }
    }

    return out;
  }

  /**
   * Extract the most common rationales from a set of decisions.
   * @param {object[]} decisions
   * @param {number} n
   * @returns {string[]}
   */
  _topRationales(decisions, n) {
    const counts = {};
    for (const d of decisions) {
      if (d.rationale && d.rationale.length > 10) {
        // Group by similar prefixes (first 60 chars)
        const key = d.rationale.slice(0, 60);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([rationale, count]) => ({ rationale, count }));
  }
}

module.exports = { ExplainabilityReport };
