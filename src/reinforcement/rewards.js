"use strict";

/**
 * RewardFunction — computes a composite reward signal from multiple
 * sub-rewards, each weighted by a configurable coefficient.
 *
 * Sub-rewards:
 *   - taskCompletionReward  — binary success/failure
 *   - efficiencyReward      — token and cost efficiency
 *   - qualityReward         — output quality heuristics
 *   - userSatisfactionReward — explicit or inferred user feedback
 *   - timeReward            — speed of completion
 *
 * All sub-rewards are normalised to roughly [-1, 1] so the composite
 * reward sits in a well-behaved range regardless of absolute scale.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sigmoid-like normalisation that maps any real value into [-1, 1].
 * Uses a scaled tanh for smooth clamping.
 */
function normalise(value, scale = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return clamp(Math.tanh(value / Math.max(scale, 0.001)), -1, 1);
}

/**
 * Linear normalisation: maps value relative to a target into [-1, 1].
 * value == target -> 1, value -> 0 -> 0, value -> infinity -> -1
 */
function linearEfficiency(value, target, invert) {
  if (typeof value !== "number" || value <= 0) return -1;
  const ratio = target / Math.max(value, 0.001);
  const score = clamp(ratio, 0, 2) - 1; // maps to [-1, 1]
  return invert ? -score : score;
}

// ---------------------------------------------------------------------------
// RewardFunction class
// ---------------------------------------------------------------------------

class RewardFunction {
  /**
   * @param {object} [options]
   * @param {object} [options.weights] — per-component weight coefficients
   * @param {number} [options.weights.taskCompletion=1.0]
   * @param {number} [options.weights.efficiency=0.5]
   * @param {number} [options.weights.quality=0.5]
   * @param {number} [options.weights.userSatisfaction=0.8]
   * @param {number} [options.weights.time=0.3]
   * @param {number} [options.weights.errorPenalty=0.6]
   */
  constructor(options = {}) {
    this._weights = {
      taskCompletion: 1.0,
      efficiency: 0.5,
      quality: 0.5,
      userSatisfaction: 0.8,
      time: 0.3,
      errorPenalty: 0.6,
      ...(options.weights || {}),
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Computes the total composite reward for an outcome.
   *
   * @param {object} outcome
   * @param {boolean} [outcome.success]           — task succeeded
   * @param {number} [outcome.tokenCount]         — tokens consumed
   * @param {number} [outcome.inputTokens]        — prompt tokens
   * @param {number} [outcome.outputTokens]       — completion tokens
   * @param {number} [outcome.cost]               — estimated cost in USD
   * @param {number} [outcome.durationMs]         — wall-clock time
   * @param {number} [outcome.errorCount]         — number of errors
   * @param {string} [outcome.outputQuality]      — "high" | "medium" | "low"
   * @param {number} [outcome.outputLength]       — characters in output
   * @param {boolean} [outcome.userApproved]      — explicit user approval
   * @param {string} [outcome.userFeedback]       — free-text user feedback
   * @param {number} [outcome.userRating]         — 1-5 star rating
   * @param {boolean} [outcome.hadRetries]        — were retries needed
   * @param {number} [outcome.retryCount]         — how many retries
   *
   * @param {object} [context]
   * @param {boolean} [context.verbose=false]     — include per-component breakdown
   *
   * @returns {number|{total,components}} composite reward or breakdown
   */
  compute(outcome, context = {}) {
    if (!outcome) {
      return context.verbose
        ? { total: 0, components: {}, error: "no outcome" }
        : 0;
    }

    const tc = this.taskCompletionReward(outcome);
    const eff = this.efficiencyReward(outcome);
    const qual = this.qualityReward(outcome);
    const us = this.userSatisfactionReward(outcome);
    const tm = this.timeReward(outcome);
    const ep = this._computeErrorPenalty(outcome);

    const total = roundTo(
      tc * this._weights.taskCompletion +
      eff * this._weights.efficiency +
      qual * this._weights.quality +
      us * this._weights.userSatisfaction +
      tm * this._weights.time +
      ep * this._weights.errorPenalty,
      4
    );

    if (context.verbose) {
      return {
        total,
        components: {
          taskCompletion: { value: tc, weight: this._weights.taskCompletion, contribution: roundTo(tc * this._weights.taskCompletion, 4) },
          efficiency: { value: eff, weight: this._weights.efficiency, contribution: roundTo(eff * this._weights.efficiency, 4) },
          quality: { value: qual, weight: this._weights.quality, contribution: roundTo(qual * this._weights.quality, 4) },
          userSatisfaction: { value: us, weight: this._weights.userSatisfaction, contribution: roundTo(us * this._weights.userSatisfaction, 4) },
          time: { value: tm, weight: this._weights.time, contribution: roundTo(tm * this._weights.time, 4) },
          errorPenalty: { value: ep, weight: this._weights.errorPenalty, contribution: roundTo(ep * this._weights.errorPenalty, 4) },
        },
      };
    }

    return total;
  }

  // -------------------------------------------------------------------------
  // Sub-reward functions (each returns [-1, 1])
  // -------------------------------------------------------------------------

  /**
   * Task completion reward.
   * Success -> +1, failure -> -1, unknown -> 0.
   *
   * @param {object} outcome
   * @returns {number}
   */
  taskCompletionReward(outcome) {
    if (!outcome) return 0;
    if (outcome.success === true) return 1;
    if (outcome.success === false) return -1;

    // Infer partial success from other signals
    if (outcome.errorCount === 0 && outcome.outputQuality === "high") return 0.8;
    if (outcome.errorCount === 0) return 0.3;
    return 0;
  }

  /**
   * Token and cost efficiency reward.
   * Rewards lower token usage and lower cost.
   * Penalises excessive token counts.
   *
   * @param {object} outcome
   * @returns {number}
   */
  efficiencyReward(outcome) {
    if (!outcome) return 0;

    let score = 0;
    let components = 0;

    // Token efficiency: target 2000 total tokens as ideal
    const totalTokens = (outcome.tokenCount || 0) ||
      ((outcome.inputTokens || 0) + (outcome.outputTokens || 0));
    if (totalTokens > 0) {
      // Score between -1 (very many tokens) and 1 (very few tokens)
      const tokenScore = linearEfficiency(totalTokens, 2000, false);
      score += tokenScore;
      components += 1;
    }

    // Cost efficiency: target $0.10 as ideal
    if (typeof outcome.cost === "number") {
      const costScore = linearEfficiency(outcome.cost, 0.1, false);
      score += costScore;
      components += 1;
    }

    // Output conciseness: penalise very long outputs (>5000 chars) lightly
    if (typeof outcome.outputLength === "number" && outcome.outputLength > 0) {
      const concisenessScore = linearEfficiency(outcome.outputLength, 2000, false);
      score += concisenessScore * 0.5;
      components += 0.5;
    }

    return components > 0 ? roundTo(clamp(score / components, -1, 1), 4) : 0;
  }

  /**
   * Output quality reward.
   * Assesses quality indicators in the outcome.
   *
   * @param {object} outcome
   * @returns {number}
   */
  qualityReward(outcome) {
    if (!outcome) return 0;

    let score = 0;
    let components = 0;

    // Explicit quality label
    if (outcome.outputQuality === "high") {
      score += 1;
      components += 1;
    } else if (outcome.outputQuality === "medium") {
      score += 0.3;
      components += 1;
    } else if (outcome.outputQuality === "low") {
      score += -0.8;
      components += 1;
    }

    // No errors is a positive quality signal
    if (outcome.errorCount === 0 && outcome.success === true) {
      score += 0.4;
      components += 0.5;
    }

    // Had to retry suggests lower quality
    if (outcome.hadRetries === true) {
      score -= 0.3;
      components += 0.5;
    }

    // Many retries strongly suggests quality issues
    if (typeof outcome.retryCount === "number" && outcome.retryCount > 3) {
      score -= 0.5;
      components += 0.5;
    }

    // Output length as a weak quality proxy (very short outputs might be incomplete)
    if (typeof outcome.outputLength === "number") {
      if (outcome.outputLength < 20) {
        score -= 0.4;
        components += 0.5;
      }
    }

    return components > 0 ? roundTo(clamp(score / Math.max(components, 1), -1, 1), 4) : 0;
  }

  /**
   * User satisfaction reward.
   * Combines explicit feedback and inferred sentiment signals.
   *
   * @param {object} outcome
   * @returns {number}
   */
  userSatisfactionReward(outcome) {
    if (!outcome) return 0;

    let score = 0;
    let components = 0;

    // Explicit approval
    if (outcome.userApproved === true) {
      score += 1;
      components += 1;
    } else if (outcome.userApproved === false) {
      score += -1;
      components += 1;
    }

    // Star rating (1-5 mapped to [-1, 1])
    if (typeof outcome.userRating === "number") {
      const rating = clamp(outcome.userRating, 1, 5);
      score += (rating - 3) / 2; // 1->-1, 3->0, 5->1
      components += 1;
    }

    // Text feedback sentiment (simple keyword-based)
    if (typeof outcome.userFeedback === "string" && outcome.userFeedback.length > 0) {
      const feedback = outcome.userFeedback.toLowerCase();

      const positiveKeywords = [
        "great", "excellent", "good", "perfect", "thanks", "thank you",
        "awesome", "amazing", "works", "helpful", "solved", "love",
      ];
      const negativeKeywords = [
        "bad", "wrong", "error", "fail", "broke", "broken", "incorrect",
        "useless", "doesn't work", "not working", "confusing", "poor",
      ];

      const posCount = positiveKeywords.filter((kw) => feedback.includes(kw)).length;
      const negCount = negativeKeywords.filter((kw) => feedback.includes(kw)).length;

      if (posCount > negCount) {
        score += clamp(posCount * 0.3, 0, 1);
      } else if (negCount > posCount) {
        score += clamp(-negCount * 0.3, -1, 0);
      }
      components += 1;
    }

    return components > 0 ? roundTo(clamp(score / components, -1, 1), 4) : 0;
  }

  /**
   * Time / speed reward.
   * Rewards faster completion and penalises excessively slow operations.
   *
   * @param {object} outcome
   * @returns {number}
   */
  timeReward(outcome) {
    if (!outcome) return 0;

    // No duration data
    if (typeof outcome.durationMs !== "number" || outcome.durationMs <= 0) {
      return 0;
    }

    const ms = outcome.durationMs;

    // Very fast (<2s): strong positive
    if (ms < 2000) return 1;

    // Fast (2-5s): positive
    if (ms < 5000) return 0.5;

    // Moderate (5-15s): neutral
    if (ms < 15000) return 0;

    // Slow (15-30s): negative
    if (ms < 30000) return -0.5;

    // Very slow (>30s): strong negative
    // Logarithmic penalty so 5 minutes isn't infinitely worse than 2 minutes
    return clamp(-1 + (ms - 30000) / 120000, -1, -0.5);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Returns the current weight configuration.
   *
   * @returns {object}
   */
  getWeights() {
    return { ...this._weights };
  }

  /**
   * Updates weights at runtime.
   *
   * @param {object} weights — partial weight map
   */
  setWeights(weights) {
    if (weights && typeof weights === "object") {
      Object.assign(this._weights, weights);
    }
  }

  /**
   * Normalises a raw value using the internal normalisation function.
   * Exposed for use by external code that needs consistent scaling.
   *
   * @param {number} value
   * @param {number} [scale=1]
   * @returns {number}
   */
  static normalise(value, scale) {
    return normalise(value, scale);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Error penalty sub-reward.
   * More errors -> more negative reward.
   *
   * @param {object} outcome
   * @returns {number}
   */
  _computeErrorPenalty(outcome) {
    if (!outcome) return 0;

    const count = outcome.errorCount;
    if (typeof count !== "number" || count <= 0) return 0;

    // Logarithmic penalty: first few errors hurt more than later ones
    // 1 error -> -0.4, 3 errors -> -0.8, 10 errors -> -1.0
    return clamp(-Math.log(count + 1) / Math.log(11), -1, 0);
  }
}

module.exports = { RewardFunction };
