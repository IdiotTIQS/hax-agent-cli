"use strict";

/**
 * Multi-dimensional argument scoring system.
 *
 * Each argument is evaluated across four dimensions:
 *   - evidence quality  (0-10)
 *   - logical soundness  (0-10)
 *   - relevance           (0-10)
 *   - clarity             (0-10)
 *
 * A weighted composite score is computed.  Scores can also come from
 * explicit per-dimension values supplied by the caller.
 */

const SCORING_DIMENSIONS = Object.freeze({
  evidence: 'evidence',
  logic: 'logic',
  relevance: 'relevance',
  clarity: 'clarity',
});

/** Default weights for each scoring dimension. */
const DEFAULT_WEIGHTS = Object.freeze({
  evidence: 0.30,
  logic: 0.30,
  relevance: 0.25,
  clarity: 0.15,
});

const MAX_SCORE = 10;
const MIN_SCORE = 0;

/**
 * Heuristic keyword sets for auto-scoring when explicit scores are absent.
 * Maps each dimension to arrays of [regex, bonus] pairs.
 */
const HEURISTIC_PATTERNS = Object.freeze({
  evidence: [
    [/\b(study|research|data|experiment|survey|statistic|benchmark|trial)\b/gi, 2.0],
    [/\b(cite|citation|source|reference|according to)\b/gi, 1.5],
    [/\b(empirical|measured|observed|documented|proven)\b/gi, 1.5],
    [/\b(without evidence|no data|unsubstantiated)\b/gi, -2.0],
  ],
  logic: [
    [/\b(therefore|thus|hence|consequently|as a result)\b/gi, 1.0],
    [/\b(if\s+.+\s+then|modus|syllogism|deduction|inference)\b/gi, 1.5],
    [/\b(premise|conclusion follows|logically)\b/gi, 1.5],
    [/\b(fallacy|contradict|inconsistent|non sequitur)\b/gi, -2.0],
  ],
  relevance: [
    [/\b(directly|specifically|pertinent|germane|applicable)\b/gi, 1.0],
    [/\b(addressing the|central to|at the heart of|core issue)\b/gi, 1.5],
    [/\b(tangent|irrelevant|off-topic|not relevant)\b/gi, -2.5],
  ],
  clarity: [
    [/\b(specifically|in other words|to clarify|namely|that is)\b/gi, 1.0],
    [/\b(clearly|precisely|concisely|succinctly)\b/gi, 1.0],
    [/\b(confusing|unclear|ambiguous|vague|obscure)\b/gi, -2.0],
  ],
});

class ArgumentScorer {
  /**
   * @param {object} [options]
   * @param {object} [options.weights] - Custom weights for each dimension.
   *   Defaults to { evidence: 0.30, logic: 0.30, relevance: 0.25, clarity: 0.15 }.
   */
  constructor(options = {}) {
    const w = options.weights || {};
    this._weights = {
      evidence: clampWeight(w.evidence, DEFAULT_WEIGHTS.evidence),
      logic: clampWeight(w.logic, DEFAULT_WEIGHTS.logic),
      relevance: clampWeight(w.relevance, DEFAULT_WEIGHTS.relevance),
      clarity: clampWeight(w.clarity, DEFAULT_WEIGHTS.clarity),
    };

    // Normalize so weights sum to 1.0
    const total = this._weights.evidence + this._weights.logic + this._weights.relevance + this._weights.clarity;
    if (total !== 1 && total > 0) {
      this._weights.evidence /= total;
      this._weights.logic /= total;
      this._weights.relevance /= total;
      this._weights.clarity /= total;
    }
  }

  /**
   * Score a single argument.
   *
   * @param {object} argument
   * @param {string} argument.body - The argument text.
   * @param {object} [argument.scores] - Explicit per-dimension scores.
   * @param {number} [argument.scores.evidence]  - 0-10
   * @param {number} [argument.scores.logic]     - 0-10
   * @param {number} [argument.scores.relevance] - 0-10
   * @param {number} [argument.scores.clarity]   - 0-10
   * @param {object[]} [argument.evidenceItems] - Array of evidence objects to boost evidence score.
   * @returns {object} Scored argument with dimensions, composite, and breakdown.
   */
  scoreArgument(argument) {
    if (!argument || typeof argument !== 'object') {
      throw new Error('argument must be a non-null object');
    }

    const body = typeof argument.body === 'string' ? argument.body : '';
    const explicitScores = (argument.scores && typeof argument.scores === 'object') ? argument.scores : {};

    // Dimension scores: prefer explicit, fall back to heuristic
    const evidence = clampScore(
      explicitScores.evidence !== undefined ? explicitScores.evidence : this._heuristicScore(body, 'evidence')
    );
    const logic = clampScore(
      explicitScores.logic !== undefined ? explicitScores.logic : this._heuristicScore(body, 'logic')
    );
    const relevance = clampScore(
      explicitScores.relevance !== undefined ? explicitScores.relevance : this._heuristicScore(body, 'relevance')
    );
    const clarity = clampScore(
      explicitScores.clarity !== undefined ? explicitScores.clarity : this._heuristicScore(body, 'clarity')
    );

    // Boost evidence score if evidence items are attached
    let evidenceBonus = 0;
    if (Array.isArray(argument.evidenceItems) && argument.evidenceItems.length > 0) {
      evidenceBonus = Math.min(2, argument.evidenceItems.length * 0.5);
    }

    const adjustedEvidence = clampScore(evidence + evidenceBonus);

    const composite = this._computeComposite(adjustedEvidence, logic, relevance, clarity);

    return {
      composite,
      dimensions: {
        evidence: adjustedEvidence,
        logic,
        relevance,
        clarity,
      },
      weights: { ...this._weights },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Rank an array of arguments by composite score (highest first).
   *
   * @param {object[]} args - Array of argument objects (each with body, optional scores).
   * @returns {object[]} New array sorted by composite score descending, each entry
   *   enriched with the scoring result and rank.
   */
  rankArguments(args) {
    if (!Array.isArray(args)) {
      throw new Error('args must be an array');
    }

    const scored = args.map((arg, idx) => {
      const scoring = this.scoreArgument(arg);
      return {
        argument: arg,
        scoring,
        rank: 0,
        originalIndex: idx,
      };
    });

    // Sort by composite descending, then by original index for stability
    scored.sort((a, b) => {
      const diff = b.scoring.composite - a.scoring.composite;
      if (diff !== 0) return diff > 0 ? 1 : -1;
      return a.originalIndex - b.originalIndex;
    });

    // Assign ranks (1-based, with ties)
    for (let i = 0; i < scored.length; i++) {
      if (i === 0) {
        scored[i].rank = 1;
      } else if (scored[i].scoring.composite === scored[i - 1].scoring.composite) {
        scored[i].rank = scored[i - 1].rank;
      } else {
        scored[i].rank = i + 1;
      }
    }

    return scored;
  }

  /**
   * Determine the winning position from a set of scored entries.
   *
   * @param {object[]} scoredEntries - Output from rankArguments(), or an array of
   *   { argument, scoring, ... } objects.
   * @returns {object} Winner info: { winner, runnerUp, all entries, isTie }.
   */
  determineWinner(scoredEntries) {
    if (!Array.isArray(scoredEntries) || scoredEntries.length === 0) {
      return { winner: null, runnerUp: null, entries: [], isTie: false };
    }

    const ranked = [...scoredEntries].sort((a, b) => b.scoring.composite - a.scoring.composite);

    const topScore = ranked[0].scoring.composite;
    const tiedForFirst = ranked.filter((e) => e.scoring.composite === topScore);

    if (tiedForFirst.length > 1) {
      return {
        winner: null,
        runnerUp: null,
        entries: ranked,
        isTie: true,
        topScore,
        tiedCount: tiedForFirst.length,
        tiedEntries: tiedForFirst,
      };
    }

    const winner = ranked[0];
    const runnerUp = ranked.length > 1 ? ranked[1] : null;

    return {
      winner,
      runnerUp,
      entries: ranked,
      isTie: false,
      topScore,
    };
  }

  /**
   * Get the current scoring weights.
   * @returns {{ evidence: number, logic: number, relevance: number, clarity: number }}
   */
  get weights() {
    return { ...this._weights };
  }

  /**
   * Update the scoring weights.
   * @param {object} weights
   */
  setWeights(weights) {
    if (!weights || typeof weights !== 'object') {
      throw new Error('weights must be an object');
    }
    if (weights.evidence !== undefined) this._weights.evidence = clampWeight(weights.evidence, DEFAULT_WEIGHTS.evidence);
    if (weights.logic !== undefined) this._weights.logic = clampWeight(weights.logic, DEFAULT_WEIGHTS.logic);
    if (weights.relevance !== undefined) this._weights.relevance = clampWeight(weights.relevance, DEFAULT_WEIGHTS.relevance);
    if (weights.clarity !== undefined) this._weights.clarity = clampWeight(weights.clarity, DEFAULT_WEIGHTS.clarity);

    const total = this._weights.evidence + this._weights.logic + this._weights.relevance + this._weights.clarity;
    if (total !== 1 && total > 0) {
      this._weights.evidence /= total;
      this._weights.logic /= total;
      this._weights.relevance /= total;
      this._weights.clarity /= total;
    }
  }

  // ---- Private ----

  /**
   * Compute a heuristic dimension score from argument body text.
   * Base score starts at 5 (neutral), adjusted by keyword matches.
   */
  _heuristicScore(body, dimension) {
    if (!body || body.trim() === '') {
      return 5;
    }

    let score = 5;
    const patterns = HEURISTIC_PATTERNS[dimension] || [];

    for (const [regex, bonus] of patterns) {
      const matches = (body.match(regex) || []).length;
      score += matches * bonus;
    }

    // Bonus for argument length (suggests substance), capped
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount > 100) score += 1.0;
    if (wordCount > 250) score += 1.0;
    if (wordCount < 20) score -= 1.0;

    return clampScore(score);
  }

  _computeComposite(evidence, logic, relevance, clarity) {
    return parseFloat((
      evidence * this._weights.evidence +
      logic * this._weights.logic +
      relevance * this._weights.relevance +
      clarity * this._weights.clarity
    ).toFixed(2));
  }
}

// ---- Helpers ----

function clampScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 5; // neutral default
  }
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(value * 100) / 100));
}

function clampWeight(value, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return fallback;
  }
  return parseFloat(value.toFixed(4));
}

module.exports = {
  ArgumentScorer,
  DEFAULT_WEIGHTS,
  MAX_SCORE,
  MIN_SCORE,
  SCORING_DIMENSIONS,
};
