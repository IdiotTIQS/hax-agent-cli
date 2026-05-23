"use strict";

const QUALITY_DIMENSIONS = Object.freeze({
  COMPLETENESS: "completeness",
  CONSISTENCY: "consistency",
  ACCURACY: "accuracy",
  CLARITY: "clarity",
  ACTIONABILITY: "actionability",
});

const DIMENSION_WEIGHTS = Object.freeze({
  completeness: 0.25,
  consistency: 0.2,
  accuracy: 0.2,
  clarity: 0.15,
  actionability: 0.2,
});

const MINIMUM_VIABLE_SCORE = 40;

/**
 * OutcomeQuality assesses the quality of merged or individual outcomes
 * across five dimensions: completeness, consistency, accuracy, clarity,
 * and actionability. Each dimension yields a 0-20 sub-score; the composite
 * score ranges 0-100.
 */
class OutcomeQuality {
  /**
   * @param {object} [options]
   * @param {object} [options.weights]          Per-dimension weight overrides.
   * @param {number} [options.minSentenceLength] Minimum sentence length in
   *   characters to count toward completeness.  Default: 15.
   * @param {number} [options.minSentencesForFull]  Sentence count for a
   *   perfect completeness score.  Default: 8.
   * @param {number} [options.readabilityTarget] Flesch-like target word
   *   length for clarity scoring.  Default: 5.
   */
  constructor(options = {}) {
    this._weights = { ...DIMENSION_WEIGHTS };
    if (options.weights && typeof options.weights === "object") {
      for (const dim of Object.values(QUALITY_DIMENSIONS)) {
        if (Number.isFinite(options.weights[dim]) && options.weights[dim] >= 0) {
          this._weights[dim] = options.weights[dim];
        }
      }
    }
    this._minSentenceLength =
      Number.isSafeInteger(options.minSentenceLength) && options.minSentenceLength >= 5
        ? options.minSentenceLength
        : 15;
    this._minSentencesForFull =
      Number.isSafeInteger(options.minSentencesForFull) && options.minSentencesForFull >= 2
        ? options.minSentencesForFull
        : 8;
    this._readabilityTarget =
      Number.isFinite(options.readabilityTarget) && options.readabilityTarget > 0
        ? options.readabilityTarget
        : 5;
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Compute a 0-100 quality score for an outcome.
   *
   * @param {object} outcome   Must have at minimum a `content` string.
   *   Optional fields used by some dimensions: `sources`, `confidence`,
   *   `providerCount`, `conflicts`.
   * @returns {object} Full scoring report.
   */
  score(outcome) {
    if (!outcome || typeof outcome !== "object") {
      throw new Error("outcome must be a non-null object");
    }

    const content = _getContent(outcome);
    const text = String(content || "");

    if (text.trim().length === 0) {
      const emptyReport = {
        totalScore: 0,
        wordCount: 0,
        sentenceCount: 0,
        dimensions: {
          [QUALITY_DIMENSIONS.COMPLETENESS]: { score: 0, weight: this._weights.completeness, notes: ["No content"] },
          [QUALITY_DIMENSIONS.CONSISTENCY]: { score: 0, weight: this._weights.consistency, notes: ["No content"] },
          [QUALITY_DIMENSIONS.ACCURACY]: { score: 0, weight: this._weights.accuracy, notes: ["No content"] },
          [QUALITY_DIMENSIONS.CLARITY]: { score: 0, weight: this._weights.clarity, notes: ["No content"] },
          [QUALITY_DIMENSIONS.ACTIONABILITY]: { score: 0, weight: this._weights.actionability, notes: ["No content"] },
        },
        viable: false,
        grade: "F",
      };
      this._history.push({ ...emptyReport, timestamp: Date.now() });
      return emptyReport;
    }

    const sentences = _extractSentences(text);
    const words = _extractWords(text);

    const completeness = this._scoreCompleteness(sentences, outcome);
    const consistency = this._scoreConsistency(text, sentences, outcome);
    const accuracy = this._scoreAccuracy(text, outcome, sentences);
    const clarity = this._scoreClarity(words, sentences);
    const actionability = this._scoreActionability(text, sentences);

    const totalScore = Math.round(
      (completeness.score * this._weights.completeness +
        consistency.score * this._weights.consistency +
        accuracy.score * this._weights.accuracy +
        clarity.score * this._weights.clarity +
        actionability.score * this._weights.actionability) *
        5, // Scale from 0-20 range to 0-100
    );

    const report = {
      totalScore,
      dimensions: {
        [QUALITY_DIMENSIONS.COMPLETENESS]: completeness,
        [QUALITY_DIMENSIONS.CONSISTENCY]: consistency,
        [QUALITY_DIMENSIONS.ACCURACY]: accuracy,
        [QUALITY_DIMENSIONS.CLARITY]: clarity,
        [QUALITY_DIMENSIONS.ACTIONABILITY]: actionability,
      },
      viable: totalScore >= MINIMUM_VIABLE_SCORE,
      grade: this._scoreToGrade(totalScore),
      wordCount: words.length,
      sentenceCount: sentences.length,
    };

    this._history.push({ ...report, timestamp: Date.now() });
    return report;
  }

  /**
   * Compare two outcomes in detail across all dimensions.
   *
   * @param {object} a  First outcome.
   * @param {object} b  Second outcome.
   * @returns {object} Side-by-side comparison.
   */
  compareOutcomes(a, b) {
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
      throw new Error("Both outcomes must be non-null objects");
    }

    const scoreA = this.score(a);
    const scoreB = this.score(b);

    const dimensionComparison = {};
    for (const dim of Object.values(QUALITY_DIMENSIONS)) {
      const dimA = scoreA.dimensions[dim];
      const dimB = scoreB.dimensions[dim];
      dimensionComparison[dim] = {
        a: dimA.score,
        b: dimB.score,
        winner: dimA.score > dimB.score ? "a" : dimB.score > dimA.score ? "b" : "tie",
        delta: Math.round((dimA.score - dimB.score) * 100) / 100,
        notesA: dimA.notes || [],
        notesB: dimB.notes || [],
      };
    }

    const winner =
      scoreA.totalScore > scoreB.totalScore ? "a"
        : scoreB.totalScore > scoreA.totalScore ? "b"
        : "tie";

    const contentA = _getContent(a);
    const contentB = _getContent(b);

    return {
      outcomeA: {
        totalScore: scoreA.totalScore,
        grade: scoreA.grade,
        wordCount: scoreA.wordCount,
        sentenceCount: scoreA.sentenceCount,
        preview: contentA.substring(0, 200),
      },
      outcomeB: {
        totalScore: scoreB.totalScore,
        grade: scoreB.grade,
        wordCount: scoreB.wordCount,
        sentenceCount: scoreB.sentenceCount,
        preview: contentB.substring(0, 200),
      },
      dimensionComparison,
      overallWinner: winner,
      scoreDelta: Math.round(Math.abs(scoreA.totalScore - scoreB.totalScore) * 100) / 100,
      strengthsA: this._extractStrengths(scoreA),
      strengthsB: this._extractStrengths(scoreB),
      weaknessesA: this._extractWeaknesses(scoreA),
      weaknessesB: this._extractWeaknesses(scoreB),
    };
  }

  /**
   * Identify gaps between an outcome and a set of requirements.
   *
   * @param {object} outcome     The outcome to check.
   * @param {Array<string>} requirements  List of requirement descriptions.
   * @returns {object} Gap analysis report.
   */
  identifyGaps(outcome, requirements) {
    if (!outcome || typeof outcome !== "object") {
      throw new Error("outcome must be a non-null object");
    }
    if (!Array.isArray(requirements) || requirements.length === 0) {
      return {
        gaps: [],
        coverage: 1,
        metRequirements: [],
        unmetRequirements: [],
        message: "No requirements provided — nothing to gap-analyze",
      };
    }

    const content = _getContent(outcome).toLowerCase();
    const keyPhrases = this._extractKeyPhrases(content);

    const met = [];
    const unmet = [];
    const gaps = [];

    for (const req of requirements) {
      const reqLower = String(req).toLowerCase().trim();
      if (!reqLower) continue;

      // Check if the requirement is addressed:
      // 1. Direct keyword match
      const reqWords = new Set(reqLower.split(/\s+/).filter((w) => w.length >= 4));
      let bestOverlap = 0;
      for (const phrase of keyPhrases) {
        const phraseWords = new Set(phrase.split(/\s+/));
        let overlap = 0;
        for (const w of reqWords) {
          if (phraseWords.has(w)) overlap++;
        }
        bestOverlap = Math.max(bestOverlap, overlap / Math.max(1, reqWords.size));
      }

      // 2. Substring check as fallback
      const substringMatch = content.includes(reqLower);

      const metRequirement = bestOverlap >= 0.4 || substringMatch;

      if (metRequirement) {
        met.push(req);
      } else {
        unmet.push(req);
        gaps.push({
          requirement: req,
          reason: bestOverlap > 0
            ? `Partial match (${Math.round(bestOverlap * 100)}% keyword overlap)`
            : "No matching content found",
          suggestedRemediation: this._suggestGapRemediation(req),
        });
      }
    }

    const totalReqs = requirements.filter((r) => String(r).trim()).length;
    const coverage = totalReqs > 0 ? met.length / totalReqs : 1;

    return {
      gaps,
      coverage: Math.round(coverage * 100) / 100,
      metRequirements: met,
      unmetRequirements: unmet,
      totalRequirements: totalReqs,
      message:
        coverage === 1
          ? "All requirements are addressed."
          : `${unmet.length} of ${totalReqs} requirements are not addressed.`,
    };
  }

  /**
   * Generate actionable improvement suggestions for an outcome.
   *
   * @param {object} outcome
   * @returns {object} Suggestions grouped by dimension.
   */
  suggestImprovements(outcome) {
    if (!outcome || typeof outcome !== "object") {
      throw new Error("outcome must be a non-null object");
    }

    const scoringReport = this.score(outcome);
    const suggestions = [];
    const byDimension = {};

    for (const dim of Object.values(QUALITY_DIMENSIONS)) {
      const dimReport = scoringReport.dimensions[dim];
      byDimension[dim] = [];

      if (dimReport.score >= 16) continue; // No suggestions when near-perfect

      const dimSuggestions = this._generateSuggestions(dim, dimReport, scoringReport);
      for (const sug of dimSuggestions) {
        suggestions.push({ ...sug, dimension: dim });
        byDimension[dim].push(sug);
      }
    }

    const priority = suggestions.sort((a, b) => {
      // Higher weight and bigger gap = higher priority
      const gapA = (20 - scoringReport.dimensions[a.dimension].score) * this._weights[a.dimension];
      const gapB = (20 - scoringReport.dimensions[b.dimension].score) * this._weights[b.dimension];
      return gapB - gapA;
    });

    return {
      totalScore: scoringReport.totalScore,
      grade: scoringReport.grade,
      suggestionCount: suggestions.length,
      suggestions: priority.map((s, i) => ({
        priority: i + 1,
        dimension: s.dimension,
        text: s.text,
        impact: s.impact,
      })),
      byDimension,
      summary:
        suggestions.length === 0
          ? "Outcome quality is excellent across all dimensions."
          : `${suggestions.length} improvement suggestion(s) identified. Top priority: ${priority[0]?.dimension || "N/A"}.`,
    };
  }

  /**
   * Return a shallow copy of scoring history.
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Clear all history entries.
   */
  clearHistory() {
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Dimension scorers (each returns { score: 0-20, notes: string[] })
  // ---------------------------------------------------------------------------

  _scoreCompleteness(sentences, outcome) {
    const notes = [];
    let score = 0;

    // Sentence count
    const substantialCount = sentences.filter((s) => s.length >= this._minSentenceLength).length;
    score += Math.min(10, (substantialCount / this._minSentencesForFull) * 10);

    if (substantialCount < this._minSentencesForFull * 0.5) {
      notes.push(`Only ${substantialCount} substantial sentence(s); consider expanding content`);
    }

    // Content length (reward longer, well-structured content)
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    score += Math.min(5, totalChars / 1000);

    if (totalChars < 300) {
      notes.push("Content is very brief; more detail would improve completeness");
    }

    // Provider/source count as a proxy for breadth
    const sourceCount = Array.isArray(outcome.sources) ? outcome.sources.length : 0;
    if (outcome.providerCount && Number.isFinite(outcome.providerCount)) {
      score += Math.min(5, (outcome.providerCount / 3) * 5);
      if (outcome.providerCount < 2) {
        notes.push("Single-source outcome; multi-source synthesis would improve completeness");
      }
    } else if (sourceCount > 0) {
      score += Math.min(5, (sourceCount / 3) * 5);
    } else {
      // No provider info; give neutral mid-score
      score += 2.5;
    }

    return {
      score: Math.round(Math.min(20, score) * 100) / 100,
      weight: this._weights.completeness,
      notes,
    };
  }

  _scoreConsistency(text, sentences, outcome) {
    const notes = [];
    let score = 0;

    // Internal contradiction check: look for contradictory patterns
    const contradictions = _detectContradictions(text);
    const maxContradictions = Math.max(1, sentences.length * 0.3);
    score += Math.max(0, 10 - (contradictions / maxContradictions) * 10);

    if (contradictions > 0) {
      notes.push(`Detected ${contradictions} potential internal contradiction(s)`);
    }

    // Tense consistency
    const tenseScore = _scoreTenseConsistency(text);
    score += Math.min(5, tenseScore * 5);

    if (tenseScore < 0.7) {
      notes.push("Mixed tenses detected; review for consistency");
    }

    // Conflict count (from merge)
    const conflictCount =
      Number.isFinite(outcome.conflictCount) ? outcome.conflictCount : 0;
    if (conflictCount > 0) {
      score += Math.max(0, 5 - conflictCount);
      if (conflictCount >= 3) {
        notes.push(`${conflictCount} unresolved conflict(s) reduce consistency`);
      }
    } else {
      score += 5; // Full marks if no conflicts
    }

    // Structural consistency: paragraph/section lengths
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length >= 2) {
      const lengths = paragraphs.map((p) => p.length);
      const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
      const variance = lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / lengths.length;
      const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
      // Lower coefficient of variation = more consistent structure
      score += Math.min(5, Math.max(0, 5 * (1 - Math.min(1, cv))));
    } else {
      score += 2.5; // Neutral for single-paragraph content
    }

    return {
      score: Math.round(Math.min(20, score) * 100) / 100,
      weight: this._weights.consistency,
      notes,
    };
  }

  _scoreAccuracy(text, outcome, sentences) {
    const notes = [];
    let score = 0;

    // Confidence as proxy for accuracy (from merge process)
    if (Number.isFinite(outcome.confidence)) {
      score += Math.min(10, outcome.confidence * 10);
      if (outcome.confidence < 0.4) {
        notes.push("Low confidence score; accuracy may be unreliable");
      }
    } else {
      score += 5; // Neutral
      notes.push("No confidence data available; accuracy rating is estimated");
    }

    // Factual language indicators (hedging is OK in moderation, but excess = low accuracy)
    const hedgingCount = _countPattern(text, /\b(maybe|perhaps|possibly|might|could be|I think|not sure|unclear|unknown|maybe)\b/gi);
    const hedgingRatio = hedgingCount / Math.max(1, sentences.length);
    if (hedgingRatio > 0.3) {
      const deduction = Math.min(5, Math.round((hedgingRatio - 0.3) * 25));
      score += Math.max(0, 5 - deduction);
      notes.push("High hedging language detected; consider firmer statements where supported by evidence");
    } else if (hedgingRatio > 0.1) {
      score += Math.min(5, 5 - Math.round((hedgingRatio - 0.1) * 10));
    } else {
      score += 5;
    }

    // Specificity: numeric data, citations
    const specificityCount = _countPattern(
      text,
      /\b(\d+%|\d+\s*(?:percent|years?|months?|days?|hours?|minutes?|dollars?|users?|times?))\b/gi,
    );
    score += Math.min(5, specificityCount * 1.5);

    if (specificityCount === 0) {
      notes.push("No specific data points (numbers, metrics, citations) found; add quantifiable evidence");
    }

    return {
      score: Math.round(Math.min(20, score) * 100) / 100,
      weight: this._weights.accuracy,
      notes,
    };
  }

  _scoreClarity(words, sentences) {
    const notes = [];
    let score = 0;

    if (words.length === 0) return { score: 0, weight: this._weights.clarity, notes: ["No words to evaluate"] };

    // Average word length: closer to readabilityTarget = better clarity
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const wordLengthDeviation = Math.abs(avgWordLength - this._readabilityTarget);
    score += Math.max(0, 8 - wordLengthDeviation * 1.5);

    if (avgWordLength > 7) {
      notes.push(`Average word length (${Math.round(avgWordLength * 100) / 100}) is high; consider simpler vocabulary`);
    } else if (avgWordLength < 3.5 && sentences.length > 3) {
      notes.push("Very short words dominate; writing may lack precision");
    }

    // Sentence length consistency (not too short, not too long)
    const sentLengths = sentences.map((s) => s.split(/\s+/).length);
    const avgSentLen = sentLengths.length > 0 ? sentLengths.reduce((s, l) => s + l, 0) / sentLengths.length : 0;

    if (avgSentLen >= 5 && avgSentLen <= 30) {
      score += 7;
    } else if (avgSentLen < 5) {
      score += 3;
      notes.push("Sentences are very short; combine ideas for better flow");
    } else {
      score += 4;
      notes.push("Long sentences detected; break them up for readability");
    }

    // No run-on detection (sentences over 60 words)
    const veryLong = sentLengths.filter((l) => l > 60).length;
    if (veryLong > 0) {
      const deduction = Math.min(5, veryLong);
      score += Math.max(0, 5 - deduction);
      notes.push(`${veryLong} very long sentence(s) (>60 words); consider splitting`);
    } else {
      score += 5;
    }

    return {
      score: Math.round(Math.min(20, score) * 100) / 100,
      weight: this._weights.clarity,
      notes,
    };
  }

  _scoreActionability(text, sentences) {
    const notes = [];
    let score = 0;

    // Imperative/action verbs
    const actionPatterns = [
      /\b(must|should|need to|required to|have to|will do)\b/gi,
      /\b(implement|create|build|deploy|configure|set up|install|run|execute|perform|develop|apply|use|add|remove|update|change|fix|resolve|address|follow|ensure|verify|check|test|review|monitor)\b/gi,
      /\b(step|first|second|third|next|finally|then)\b/gi,
    ];

    let actionScore = 0;
    for (const pattern of actionPatterns) {
      actionScore += _countPattern(text, pattern);
    }
    const actionRatio = actionScore / Math.max(1, sentences.length);
    score += Math.min(10, actionRatio * 10);

    if (actionRatio < 0.5) {
      notes.push("Few action-oriented words detected; add concrete steps or directives");
    }

    // List/step presence
    const hasNumberedList = /(?:^|\n)\s*\d+[.)]\s/.test(text);
    const hasBulletList = /(?:^|\n)\s*[-*+]\s/.test(text);
    if (hasNumberedList || hasBulletList) {
      score += 5;
    } else {
      score += 2;
      notes.push("No structured lists found; use numbered steps or bullet points for actionability");
    }

    // Outcome/result language
    const outcomePattern = /\b(result|outcome|output|deliverable|goal|objective|target|milestone|deadline)\b/gi;
    const outcomeCount = _countPattern(text, outcomePattern);
    score += Math.min(5, outcomeCount);

    if (outcomeCount === 0) {
      notes.push("No outcome language detected; clarify expected results");
    }

    return {
      score: Math.round(Math.min(20, score) * 100) / 100,
      weight: this._weights.actionability,
      notes,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _extractKeyPhrases(text, maxPhrases = 20) {
    const words = text.split(/\s+/).filter((w) => w.length >= 4);
    const stopWords = new Set([
      "this", "that", "with", "from", "have", "were", "been", "when", "will",
      "would", "could", "should", "about", "which", "their", "there",
      "these", "those", "they", "them", "what", "where",
    ]);

    const wordFreq = {};
    for (const word of words) {
      if (stopWords.has(word)) continue;
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    const phrases = [];
    const sorted = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, maxPhrases);

    for (const [word] of sorted) {
      const idx = text.indexOf(word);
      if (idx >= 0) {
        const start = Math.max(0, idx - 20);
        const end = Math.min(text.length, idx + word.length + 20);
        const context = text.substring(start, end);
        const contextWords = context.split(/\s+/);
        if (contextWords.length >= 3) {
          const pivot = contextWords.findIndex((w) => w.toLowerCase().includes(word));
          const s = Math.max(0, pivot >= 0 ? pivot - 1 : 0);
          const e = Math.min(contextWords.length, pivot >= 0 ? pivot + 2 : contextWords.length);
          const phrase = contextWords.slice(s, e).join(" ");
          if (phrase.length >= 6) phrases.push(phrase);
        }
      }
    }

    return [...new Set(phrases)];
  }

  _suggestGapRemediation(requirement) {
    const reqLower = requirement.toLowerCase();
    if (reqLower.includes("budget") || reqLower.includes("cost") || reqLower.includes("price")) {
      return "Add cost estimates, budget constraints, or pricing information";
    }
    if (reqLower.includes("timeline") || reqLower.includes("schedule") || reqLower.includes("deadline")) {
      return "Include a timeline with milestones and deadlines";
    }
    if (reqLower.includes("risk") || reqLower.includes("mitigation")) {
      return "Identify potential risks and propose mitigation strategies";
    }
    if (reqLower.includes("alternative") || reqLower.includes("option")) {
      return "List alternative approaches and compare their trade-offs";
    }
    if (reqLower.includes("metric") || reqLower.includes("measure") || reqLower.includes("kpi")) {
      return "Define measurable metrics or KPIs for success evaluation";
    }
    if (reqLower.includes("stakeholder") || reqLower.includes("audience")) {
      return "Identify affected stakeholders or target audience";
    }
    return "Expand the outcome to explicitly address this requirement";
  }

  _generateSuggestions(dimension, dimReport, scoringReport) {
    const suggestions = [];

    switch (dimension) {
      case QUALITY_DIMENSIONS.COMPLETENESS:
        if (scoringReport.sentenceCount < 4) {
          suggestions.push({ text: "Expand content with more detail — the outcome is very brief.", impact: "high" });
        }
        if (!scoringReport.dimensions[dimension].notes) {
          suggestions.push({ text: "Include data from multiple sources or perspectives.", impact: "medium" });
        }
        if (dimReport.score < 10) {
          suggestions.push({ text: "Consider adding background context, examples, or supporting evidence.", impact: "high" });
        }
        break;

      case QUALITY_DIMENSIONS.CONSISTENCY:
        suggestions.push({ text: "Review for internal contradictions and align conflicting statements.", impact: "high" });
        if (dimReport.score < 12) {
          suggestions.push({ text: "Use consistent terminology throughout; avoid switching terms for the same concept.", impact: "medium" });
        }
        break;

      case QUALITY_DIMENSIONS.ACCURACY:
        suggestions.push({ text: "Add specific data points, metrics, or citations to strengthen factual claims.", impact: "high" });
        if (dimReport.score < 10) {
          suggestions.push({ text: "Replace hedging language with definitive statements where evidence supports it.", impact: "medium" });
        }
        break;

      case QUALITY_DIMENSIONS.CLARITY:
        if (scoringReport.wordCount > 0) {
          suggestions.push({ text: "Simplify vocabulary and shorten overly long sentences.", impact: "medium" });
          suggestions.push({ text: "Use consistent formatting, headings, and structure to improve readability.", impact: "medium" });
        }
        break;

      case QUALITY_DIMENSIONS.ACTIONABILITY:
        suggestions.push({ text: "Add numbered steps or bullet-point action items.", impact: "high" });
        suggestions.push({ text: "Define clear deliverables, owners, and timelines for each action.", impact: "high" });
        if (dimReport.score < 12) {
          suggestions.push({ text: "Include expected outcomes or success criteria for each recommended action.", impact: "medium" });
        }
        break;
    }

    return suggestions;
  }

  _extractStrengths(report) {
    const strengths = [];
    for (const dim of Object.values(QUALITY_DIMENSIONS)) {
      if (report.dimensions[dim].score >= 15) {
        strengths.push(dim);
      }
    }
    return strengths;
  }

  _extractWeaknesses(report) {
    const weaknesses = [];
    for (const dim of Object.values(QUALITY_DIMENSIONS)) {
      if (report.dimensions[dim].score < 10) {
        weaknesses.push(dim);
      }
    }
    return weaknesses;
  }

  _scoreToGrade(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function _getContent(outcome) {
  if (!outcome) return "";
  return String(
    outcome.response?.content ||
      outcome.content ||
      outcome.text ||
      outcome.message ||
      "",
  );
}

function _extractSentences(text) {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function _extractWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function _countPattern(text, pattern) {
  if (typeof text !== "string") return 0;
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function _detectContradictions(text) {
  const lower = text.toLowerCase();
  let count = 0;

  const contradictionPairs = [
    [/\bincrease\b/g, /\bdecrease\b/g],
    [/\bimprove\b/g, /\bworsen\b/g],
    [/\bpositive\b/g, /\bnegative\b/g],
    [/\bsuccess\b/g, /\bfailure\b/g],
    [/\bagree\b/g, /\bdisagree\b/g],
    [/\bshould\b/g, /\bshould not\b/g],
    [/\brecommend\b/g, /\bavoid\b/g],
    [/\bincluded\b/g, /\bexcluded\b/g],
  ];

  for (const [pos, neg] of contradictionPairs) {
    const posCount = _countPattern(lower, pos);
    const negCount = _countPattern(lower, neg);
    if (posCount > 0 && negCount > 0) {
      count += Math.min(posCount, negCount);
    }
  }

  return count;
}

function _scoreTenseConsistency(text) {
  const pastPattern = /\b(was|were|had|did|made|went|took|came|said|knew|thought|found|built|ran|spoke|wrote|drove)\b/gi;
  const presentPattern = /\b(is|are|has|have|does|makes|goes|takes|comes|says|knows|thinks|finds|builds|runs|speaks|writes|drives)\b/gi;
  const futurePattern = /\b(will|shall|going to|plan to|intend to)\b/gi;

  const past = _countPattern(text, pastPattern);
  const present = _countPattern(text, presentPattern);
  const future = _countPattern(text, futurePattern);
  const total = past + present + future;

  if (total === 0) return 1; // No tense markers = neutral, full score

  const dominant = Math.max(past, present, future);
  return dominant / total;
}

module.exports = {
  OutcomeQuality,
  QUALITY_DIMENSIONS,
  MINIMUM_VIABLE_SCORE,
};
