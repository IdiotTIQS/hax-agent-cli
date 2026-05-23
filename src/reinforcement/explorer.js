"use strict";

/**
 * ExplorationEngine — balances exploration vs. exploitation using pluggable
 * strategies, generates action variants, evaluates outcomes, and enforces
 * safety constraints so that exploration does not cause harm.
 *
 * Strategies: epsilonGreedy, softmax, upperConfidenceBound
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Default unsafe patterns (may be customised)
// ---------------------------------------------------------------------------

const DEFAULT_UNSAFE_PATTERNS = [
  /rm\s+-rf\b/i,
  /DROP\s+(TABLE|DATABASE)/i,
  /DELETE\s+FROM/i,
  /sudo\s+/i,
  /chmod\s+777/i,
  /eval\s*\(/i,
  />\s*\/dev\/null/i,
  /format\s+(c:|d:|disk)/i,
];

/**
 * Checks whether a string contains patterns that look unsafe.
 * @param {string} value
 * @param {RegExp[]} unsafePatterns
 * @returns {boolean}
 */
function containsUnsafePattern(value, unsafePatterns) {
  if (typeof value !== "string" || value.length === 0) return false;
  return unsafePatterns.some((p) => p.test(value));
}

/**
 * Picks one of a list of items using softmax probabilities from weights.
 * @param {Array} items
 * @param {number[]} weights
 * @param {number} temperature
 * @returns {*} selected item
 */
function softmaxPick(items, weights, temperature) {
  const t = Math.max(temperature, 0.01);
  const scaled = weights.map((w) => w / t);
  const maxScaled = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - maxScaled));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);

  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += probs[i];
    if (r <= cumulative) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// ExplorationEngine class
// ---------------------------------------------------------------------------

class ExplorationEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.strategy="epsilonGreedy"]
   *   — one of: "epsilonGreedy", "softmax", "upperConfidenceBound"
   * @param {number} [options.epsilon=0.1]           — epsilon for epsilon-greedy
   * @param {number} [options.epsilonDecay=0.9995]   — decay per exploration step
   * @param {number} [options.minEpsilon=0.02]       — floor for epsilon
   * @param {number} [options.temperature=1.0]       — boltzmann / softmax temperature
   * @param {number} [options.ucbC=2.0]              — UCB exploration constant
   * @param {number} [options.safetyThreshold=0.8]   — minimum confidence for safe
   * @param {RegExp[]} [options.unsafePatterns]      — patterns to reject
   */
  constructor(options = {}) {
    this._strategy = options.strategy || "epsilonGreedy";
    this._epsilon = options.epsilon != null ? options.epsilon : 0.1;
    this._epsilonDecay = options.epsilonDecay != null ? options.epsilonDecay : 0.9995;
    this._minEpsilon = options.minEpsilon != null ? options.minEpsilon : 0.02;
    this._temperature = options.temperature || 1.0;
    this._ucbC = options.ucbC != null ? options.ucbC : 2.0;
    this._safetyThreshold = options.safetyThreshold != null ? options.safetyThreshold : 0.8;

    this._unsafePatterns = Array.isArray(options.unsafePatterns)
      ? options.unsafePatterns
      : DEFAULT_UNSAFE_PATTERNS;

    // Tracking
    this._totalExplorations = 0;
    this._successfulExplorations = 0;
    this._explorationHistory = [];

    // Per-action statistics for UCB
    // actionName -> { count, totalReward, avgReward }
    this._actionStats = new Map();
  }

  // -------------------------------------------------------------------------
  // Strategy detection helpers
  // -------------------------------------------------------------------------

  _isEpsilonGreedy() {
    return this._strategy === "epsilonGreedy";
  }

  _isSoftmax() {
    return this._strategy === "softmax";
  }

  _isUCB() {
    return this._strategy === "upperConfidenceBound";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Decides whether the engine should explore or exploit for a given state.
   *
   * @param {object} state
   * @param {object} [options]
   * @param {{action:string,value:number}[]} [options.actionValues]
   *   — known action-value pairs for UCB calculation
   * @param {number} [options.totalSteps] — total steps taken so far
   * @returns {{ explore: boolean, reason: string, meta?: object }}
   */
  shouldExplore(state, options = {}) {
    const actionValues = Array.isArray(options.actionValues) ? options.actionValues : [];
    const totalSteps = typeof options.totalSteps === "number" ? options.totalSteps : 1;

    switch (this._strategy) {
      case "epsilonGreedy":
        return this._shouldExploreEpsilonGreedy();

      case "softmax":
        return this._shouldExploreSoftmax(actionValues);

      case "upperConfidenceBound":
        return this._shouldExploreUCB(actionValues, totalSteps);

      default:
        return { explore: Math.random() < 0.1, reason: `unknown_strategy(${this._strategy})` };
    }
  }

  /**
   * Generates a variant of an original action for exploration purposes.
   *
   * @param {object} original
   * @param {string} original.action     — original action name
   * @param {object} [original.params]   — original parameters
   * @param {object} [options]
   * @param {string[]} [options.toolAlternatives] — alternative tools to try
   * @param {string[]} [options.strategyAlternatives] — alternative strategies
   * @returns {{ variant: object|null, description: string, isNovel: boolean }}
   */
  generateVariant(original, options = {}) {
    if (!original || !original.action) {
      return { variant: null, description: "missing original action", isNovel: false };
    }

    const toolAlts = Array.isArray(options.toolAlternatives) ? options.toolAlternatives : [];
    const strategyAlts = Array.isArray(options.strategyAlternatives) ? options.strategyAlternatives : [];

    // Generate variants by type
    const variantTypes = [];

    // Type 1: tool substitution — swap original tool for an alternative
    if (toolAlts.length > 0) {
      variantTypes.push("tool_substitution");
    }

    // Type 2: parameter perturbation — tweak existing params
    if (original.params && Object.keys(original.params).length > 0) {
      variantTypes.push("param_perturbation");
    }

    // Type 3: strategy substitution — try a different high-level approach
    if (strategyAlts.length > 0) {
      variantTypes.push("strategy_substitution");
    }

    // Type 4: sequence reorder — change execution order
    variantTypes.push("sequence_reorder");

    // Pick a variant type at random if there are options
    const type =
      variantTypes.length > 0
        ? variantTypes[Math.floor(Math.random() * variantTypes.length)]
        : "random";

    let variant = null;
    let description = "";

    switch (type) {
      case "tool_substitution": {
        const alt = toolAlts[Math.floor(Math.random() * toolAlts.length)];
        variant = { ...original, action: alt, _variantType: type };
        description = `substituted tool "${original.action}" -> "${alt}"`;
        break;
      }

      case "param_perturbation": {
        const perturbed = { ...original };
        // Add a small random perturbation to numeric params
        if (original.params) {
          const newParams = { ...original.params };
          for (const [key, val] of Object.entries(newParams)) {
            if (typeof val === "number") {
              newParams[key] = roundTo(val * (0.8 + Math.random() * 0.4), 2);
            }
          }
          perturbed.params = newParams;
        }
        variant = { ...perturbed, _variantType: type };
        description = "perturbed numeric parameters +-20%";
        break;
      }

      case "strategy_substitution": {
        const altStrat = strategyAlts[Math.floor(Math.random() * strategyAlts.length)];
        variant = {
          ...original,
          _originalAction: original.action,
          action: `strategy:${altStrat}`,
          _variantType: type,
        };
        description = `substituted strategy "${original.action}" -> "${altStrat}"`;
        break;
      }

      case "sequence_reorder": {
        // Swap position with a placeholder indicating reorder
        variant = {
          ...original,
          _reorderHint: "try_reverse_or_interleave",
          _variantType: type,
        };
        description = "reorder execution sequence";
        break;
      }

      default: {
        // Random fallback — add a small mutation
        variant = {
          ...original,
          action: original.action + "_explore",
          _variantType: "random",
        };
        description = `random exploration of "${original.action}"`;
      }
    }

    const isNovel = variant.action !== original.action;

    return { variant, description, isNovel };
  }

  /**
   * Evaluates the outcome of an exploration to determine if it was beneficial.
   *
   * @param {object} outcome
   * @param {boolean} [outcome.success]      — did it succeed?
   * @param {number} [outcome.errorCount]    — number of errors
   * @param {number} [outcome.durationMs]    — time taken
   * @param {number} [outcome.tokenCount]    — tokens consumed
   * @param {number} [outcome.cost]          — estimated cost
   * @param {boolean} [outcome.userApproved] — explicit user feedback
   * @returns {{ score: number, assessment: string, details: object }}
   */
  evaluateOutcome(outcome) {
    if (!outcome) {
      return { score: 0, assessment: "no_outcome", details: {} };
    }

    let score = 0;
    const components = {};

    // Success (dominant factor)
    if (outcome.success === true) {
      score += 10;
      components.success = 10;
    } else if (outcome.success === false) {
      score -= 15;
      components.failure = -15;
    }

    // Error penalty
    if (typeof outcome.errorCount === "number" && outcome.errorCount > 0) {
      const penalty = Math.min(outcome.errorCount * 3, 10);
      score -= penalty;
      components.errorPenalty = -penalty;
    }

    // Duration — prefer faster outcomes (linear decay)
    if (typeof outcome.durationMs === "number" && outcome.durationMs > 0) {
      // Target: under 5000ms gives positive score, over penalises
      const durationScore = clamp(Math.round((5000 - outcome.durationMs) / 1000), -5, 3);
      score += durationScore;
      components.duration = durationScore;
    }

    // Token efficiency — prefer fewer tokens
    if (typeof outcome.tokenCount === "number" && outcome.tokenCount > 0) {
      const tokenScore = clamp(Math.round((2000 - outcome.tokenCount) / 1000), -3, 3);
      score += tokenScore;
      components.tokens = tokenScore;
    }

    // Cost efficiency
    if (typeof outcome.cost === "number") {
      const costScore = clamp(Math.round((0.5 - outcome.cost) * 10), -5, 3);
      score += costScore;
      components.cost = costScore;
    }

    // User approval — strong signal
    if (outcome.userApproved === true) {
      score += 5;
      components.userApproval = 5;
    } else if (outcome.userApproved === false) {
      score -= 10;
      components.userDisapproval = -10;
    }

    const clampedScore = clamp(score, -30, 30);

    let assessment;
    if (clampedScore >= 15) assessment = "excellent";
    else if (clampedScore >= 8) assessment = "good";
    else if (clampedScore >= 0) assessment = "neutral";
    else if (clampedScore >= -8) assessment = "poor";
    else assessment = "harmful";

    // Record for stats
    this._totalExplorations += 1;
    if (clampedScore > 0) {
      this._successfulExplorations += 1;
    }

    this._explorationHistory.push({
      id: uid(),
      score: clampedScore,
      assessment,
      timestamp: new Date().toISOString(),
    });

    // Update per-action stats
    if (outcome._action) {
      this._recordActionStat(outcome._action, clampedScore);
    }

    return {
      score: clampedScore,
      assessment,
      details: {
        components,
        rawScore: roundTo(score, 2),
      },
    };
  }

  /**
   * Checks whether a proposed exploration variant is safe to execute.
   *
   * @param {object} variant
   * @param {string} variant.action
   * @param {object} [variant.params]
   * @returns {{ safe: boolean, reason: string, riskLevel: string }}
   */
  isSafe(variant) {
    if (!variant) {
      return { safe: false, reason: "no variant provided", riskLevel: "unknown" };
    }

    const checks = [];

    // Check action name for unsafe patterns
    const actionStr = String(variant.action || "");
    if (containsUnsafePattern(actionStr, this._unsafePatterns)) {
      checks.push({ safe: false, reason: `unsafe pattern in action name: "${actionStr}"` });
    }

    // Check string parameter values for unsafe patterns
    if (variant.params) {
      for (const [key, val] of Object.entries(variant.params)) {
        if (typeof val === "string" && containsUnsafePattern(val, this._unsafePatterns)) {
          checks.push({
            safe: false,
            reason: `unsafe pattern in param "${key}": "${val.slice(0, 80)}"`,
          });
        }
      }
    }

    if (checks.length > 0) {
      return { safe: false, reason: checks[0].reason, riskLevel: "high" };
    }

    // Estimate risk from action name keywords
    const riskKeywords = [
      "delete", "remove", "destroy", "drop", "truncate", "purge",
      "exec", "sudo", "admin", "root",
    ];
    const lowerAction = actionStr.toLowerCase();
    const matchedRisk = riskKeywords.filter((kw) => lowerAction.includes(kw));

    if (matchedRisk.length > 1) {
      return {
        safe: false,
        reason: `action "${actionStr}" matches multiple risk keywords: ${matchedRisk.join(", ")}`,
        riskLevel: "high",
      };
    }
    if (matchedRisk.length === 1) {
      return {
        safe: true,
        reason: `action "${actionStr}" matches risk keyword "${matchedRisk[0]}" — proceed with caution`,
        riskLevel: "medium",
      };
    }

    return { safe: true, reason: "no unsafe patterns detected", riskLevel: "low" };
  }

  /**
   * Returns aggregated exploration statistics.
   *
   * @returns {object}
   */
  getExplorationStats() {
    const total = this._totalExplorations;
    const successRate = total > 0
      ? roundTo(this._successfulExplorations / total, 4)
      : 0;

    // Score distribution
    const scoreBuckets = { excellent: 0, good: 0, neutral: 0, poor: 0, harmful: 0 };
    for (const entry of this._explorationHistory) {
      const bucket = entry.assessment;
      if (bucket in scoreBuckets) scoreBuckets[bucket] += 1;
    }

    // Recent trend (last 10)
    const recent = this._explorationHistory.slice(-10);
    const recentAvgScore = recent.length > 0
      ? roundTo(recent.reduce((a, e) => a + e.score, 0) / recent.length, 2)
      : 0;

    // Per-action breakdown
    const actionBreakdown = [];
    for (const [action, stats] of this._actionStats) {
      actionBreakdown.push({
        action,
        count: stats.count,
        avgReward: stats.count > 0 ? roundTo(stats.totalReward / stats.count, 2) : 0,
        totalReward: roundTo(stats.totalReward, 2),
      });
    }
    actionBreakdown.sort((a, b) => b.avgReward - a.avgReward);

    return {
      totalExplorations: total,
      successfulExplorations: this._successfulExplorations,
      successRate,
      assessmentDistribution: scoreBuckets,
      recentAvgScore,
      recentTrend: recentAvgScore > 1 ? "improving" : recentAvgScore < -1 ? "declining" : "stable",
      actionBreakdown,
      currentEpsilon: roundTo(this._epsilon, 4),
      strategy: this._strategy,
    };
  }

  /**
   * Changes the exploration strategy at runtime.
   *
   * @param {string} strategy — "epsilonGreedy" | "softmax" | "upperConfidenceBound"
   */
  setStrategy(strategy) {
    const valid = ["epsilonGreedy", "softmax", "upperConfidenceBound"];
    if (valid.includes(strategy)) {
      this._strategy = strategy;
      return true;
    }
    return false;
  }

  /**
   * Resets the engine state.
   */
  reset() {
    this._totalExplorations = 0;
    this._successfulExplorations = 0;
    this._explorationHistory = [];
    this._actionStats.clear();
    this._epsilon = 0.1;
  }

  // -------------------------------------------------------------------------
  // Private strategy implementations
  // -------------------------------------------------------------------------

  /**
   * Epsilon-greedy: explore with probability epsilon.
   */
  _shouldExploreEpsilonGreedy() {
    const explore = Math.random() < this._epsilon;

    // Decay epsilon on each check
    this._epsilon = Math.max(this._minEpsilon, this._epsilon * this._epsilonDecay);

    return {
      explore,
      reason: explore
        ? `epsilon-greedy: random explore (epsilon=${roundTo(this._epsilon, 4)})`
        : `epsilon-greedy: exploit best action (epsilon=${roundTo(this._epsilon, 4)})`,
      meta: { epsilon: roundTo(this._epsilon, 4) },
    };
  }

  /**
   * Softmax / Boltzmann: explore proportionally to action value estimates.
   * Small value differences still have non-zero probability.
   */
  _shouldExploreSoftmax(actionValues) {
    if (actionValues.length === 0) {
      // No action values known; always explore
      return { explore: true, reason: "softmax: no action values — explore", meta: { temperature: this._temperature } };
    }

    const values = actionValues.map((av) => av.value != null ? av.value : 0);
    const probs = this._softmaxProbs(values);

    // If the max probability is very high, we exploit; otherwise, we explore
    const maxProb = Math.max(...probs);
    const explore = maxProb < (1 - this._epsilon);

    return {
      explore,
      reason: explore
        ? `softmax: maxProb=${roundTo(maxProb, 4)} (below threshold) — explore`
        : `softmax: maxProb=${roundTo(maxProb, 4)} (confident) — exploit`,
      meta: { maxProbability: roundTo(maxProb, 4), temperature: this._temperature },
    };
  }

  /**
   * Upper Confidence Bound: explore actions with high uncertainty.
   * UCB = avgReward + c * sqrt(ln(totalSteps) / count)
   */
  _shouldExploreUCB(actionValues, totalSteps) {
    if (actionValues.length === 0) {
      return { explore: true, reason: "UCB: no action values — explore", meta: { totalSteps } };
    }

    const ucbScores = [];
    const incTotal = Math.max(totalSteps, 1);

    for (const av of actionValues) {
      const count = av.count || 0;
      const avgReward = av.value || 0;
      let ucb;
      if (count === 0) {
        // Unvisited action — assign high UCB to encourage exploration
        ucb = Infinity;
      } else {
        ucb = avgReward + this._ucbC * Math.sqrt(Math.log(incTotal) / count);
      }
      ucbScores.push({ action: av.action, ucb, avgReward, count });
    }

    // Find action with highest UCB
    ucbScores.sort((a, b) => b.ucb - a.ucb);
    const top = ucbScores[0];

    // The best action might be different from the best-known action
    // (exploration when UCB suggests an under-explored action)
    const bestKnown = ucbScores.reduce((best, s) =>
      s.avgReward > best.avgReward ? s : best, { avgReward: -Infinity }
    );

    const explore = top.action !== bestKnown.action || top.count === 0;

    return {
      explore,
      reason: explore
        ? `UCB: explore "${top.action}" (UCB=${top.ucb === Infinity ? 'inf' : roundTo(top.ucb, 4)}, count=${top.count})`
        : `UCB: exploit "${top.action}" (confirmed best, UCB=${roundTo(top.ucb, 4)}, count=${top.count})`,
      meta: { topAction: top.action, topUCB: top.ucb === Infinity ? "inf" : roundTo(top.ucb, 4), totalSteps: incTotal },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _softmaxProbs(values) {
    const t = Math.max(this._temperature, 0.01);
    const maxV = Math.max(...values, 0);
    const exps = values.map((v) => Math.exp((v - maxV) / t));
    const sum = exps.reduce((a, b) => a + b, 0);
    return sum === 0 ? exps.map(() => 1 / values.length) : exps.map((e) => e / sum);
  }

  _recordActionStat(action, score) {
    if (!this._actionStats.has(action)) {
      this._actionStats.set(action, { count: 0, totalReward: 0 });
    }
    const stats = this._actionStats.get(action);
    stats.count += 1;
    stats.totalReward += score;
  }
}

module.exports = { ExplorationEngine };
