"use strict";

/**
 * StrategyEngine — executes, evaluates, adapts, composes, and measures strategies.
 *
 * Works with strategy objects that conform to:
 *   { name, type, config, execute(context)?, evaluate(context)? }
 */

const { debug } = require("../debug");

const SCORE_THRESHOLD = 0.3;          // minimum score for a strategy to be eligible
const ADAPT_DECAY_FACTOR = 0.85;      // how much past feedback decays
const MEASURE_WEIGHTS = Object.freeze({
  success: 1.0,
  latencyPenalty: 0.3,
  resourcePenalty: 0.1,
  errorPenalty: 1.5,
});

class StrategyEngine {
  constructor(options = {}) {
    this._scoreThreshold =
      Number.isFinite(options.scoreThreshold) && options.scoreThreshold >= 0
        ? options.scoreThreshold
        : SCORE_THRESHOLD;
    this._adaptDecay =
      Number.isFinite(options.adaptDecay) && options.adaptDecay > 0 && options.adaptDecay <= 1
        ? options.adaptDecay
        : ADAPT_DECAY_FACTOR;
    this._feedbackHistory = new Map();
    this._executionLog = [];
  }

  /**
   * Execute a single strategy with the given context.
   *
   * @param {object} strategy — { name, type, config, execute(context)? }
   * @param {object} context  — arbitrary context data for the strategy
   * @returns {Promise<any>} result of strategy execution
   */
  async execute(strategy, context) {
    if (!strategy || typeof strategy !== "object") {
      throw new TypeError("Strategy must be a non-null object");
    }
    if (typeof strategy.execute !== "function") {
      throw new Error(`Strategy "${strategy.name || "unknown"}" has no execute() method`);
    }

    const startTime = Date.now();
    let result;
    let error = null;

    try {
      result = await strategy.execute(context);
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      this._recordExecution(strategy, context, result, error, durationMs);
    }

    return result;
  }

  /**
   * Evaluate multiple strategies against a context and pick the best one by score.
   *
   * Each strategy's evaluate(context) should return a number 0-1 (or a promise resolving to one).
   * The strategy with the highest score is returned alongside all scored results.
   *
   * @param {Array<object>} strategies — array of { name, type, config, evaluate(context)? }
   * @param {object} context           — context to evaluate against
   * @returns {Promise<object>} { selected, scores, all }
   */
  async evaluate(strategies, context) {
    if (!Array.isArray(strategies) || strategies.length === 0) {
      throw new Error("Must provide a non-empty array of strategies");
    }

    const scored = [];

    for (const strat of strategies) {
      let score = 0.5; // neutral default

      if (typeof strat.evaluate === "function") {
        try {
          const raw = await strat.evaluate(context);
          score = this._normalizeScore(raw);
        } catch (_) {
          score = 0;
        }
      }

      const feedbackScore = this._getFeedbackScore(strat.name);
      const adjustedScore = score * 0.7 + feedbackScore * 0.3;

      scored.push({
        strategy: strat,
        rawScore: score,
        feedbackScore,
        score: adjustedScore,
      });
    }

    // sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];

    // if top is below threshold, still return it — caller decides
    const selected = top.score >= this._scoreThreshold ? top.strategy : null;

    return {
      selected,
      bestScore: top ? top.score : 0,
      scores: scored.map((s) => ({
        name: s.strategy.name,
        type: s.strategy.type,
        score: s.score,
        rawScore: s.rawScore,
        feedbackScore: s.feedbackScore,
      })),
      all: scored,
    };
  }

  /**
   * Adapt a strategy's config based on execution feedback.
   *
   * @param {object} strategy — current strategy with config
   * @param {object} feedback — { success, latencyMs, resourceUsed, error? }
   * @returns {object} adapted strategy (new config)
   */
  adapt(strategy, feedback) {
    if (!strategy || typeof strategy !== "object") {
      throw new TypeError("Strategy must be a non-null object");
    }
    if (!feedback || typeof feedback !== "object") {
      throw new TypeError("Feedback must be a non-null object");
    }

    const existingFeedback = this._feedbackHistory.get(strategy.name) || {
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      totalResourceUsed: 0,
      count: 0,
    };

    const updated = {
      successes: existingFeedback.successes + (feedback.success ? 1 : 0),
      failures: existingFeedback.failures + (feedback.success ? 0 : 1),
      totalLatencyMs: existingFeedback.totalLatencyMs + (Number.isFinite(feedback.latencyMs) ? feedback.latencyMs : 0),
      totalResourceUsed:
        existingFeedback.totalResourceUsed + (Number.isFinite(feedback.resourceUsed) ? feedback.resourceUsed : 0),
      count: existingFeedback.count + 1,
    };

    // apply decay to historical data (including count)
    if (updated.count > 1) {
      updated.successes = Math.round(updated.successes * this._adaptDecay);
      updated.failures = Math.round(updated.failures * this._adaptDecay);
      updated.totalLatencyMs = updated.totalLatencyMs * this._adaptDecay;
      updated.totalResourceUsed = updated.totalResourceUsed * this._adaptDecay;
      updated.count = Math.round(updated.count * this._adaptDecay);
    }

    this._feedbackHistory.set(strategy.name, updated);

    // compute adaptation suggestions
    const successRate = updated.count === 0 ? 1 : updated.successes / updated.count;
    const avgLatency = updated.count === 0 ? 0 : updated.totalLatencyMs / updated.count;

    const adaptedConfig = { ...(strategy.config || {}) };

    // if success rate is low, suggest increasing safety measures
    if (successRate < 0.5 && feedback.error) {
      adaptedConfig._adaptSafeMode = true;
      adaptedConfig._adaptReason = `Low success rate (${(successRate * 100).toFixed(0)}%) — enabling safe mode`;
    }

    // if latency is consistently high, suggest reducing complexity
    if (avgLatency > 5000) {
      adaptedConfig._adaptReduceComplexity = true;
      adaptedConfig._adaptReason = `High average latency (${Math.round(avgLatency)}ms) — reducing complexity`;
    }

    const adapted = {
      ...strategy,
      config: Object.freeze({ ...adaptedConfig }),
    };

    return adapted;
  }

  /**
   * Combine multiple strategies into a composite (pipeline / fallback / parallel).
   *
   * @param {Array<object>} strategies
   * @returns {object} composite strategy with execute(context)
   */
  compose(strategies) {
    if (!Array.isArray(strategies) || strategies.length === 0) {
      throw new Error("Must provide a non-empty array of strategies to compose");
    }

    const mode = strategies.length > 1 ? "fallback" : "single";
    const names = strategies.map((s) => s.name || "anonymous");

    const composite = {
      name: `composite(${names.join("+")})`,
      type: strategies[0].type || "compound",
      config: Object.freeze({
        mode,
        count: strategies.length,
        members: names.slice(),
      }),
      _strategies: strategies.slice(),

      async execute(context) {
        if (mode === "single") {
          return strategies[0].execute
            ? strategies[0].execute(context)
            : strategies[0];
        }

        // fallback: try each in order, return first success
        const errors = [];
        for (const strat of strategies) {
          try {
            if (typeof strat.execute === "function") {
              return await strat.execute(context);
            }
            return strat;
          } catch (err) {
            errors.push({ strategy: strat.name, error: err.message });
          }
        }

        const aggregated = errors.map((e) => `[${e.strategy}] ${e.error}`).join("; ");
        throw new Error(`All composed strategies failed: ${aggregated}`);
      },

      evaluate(context) {
        // average of member evaluate scores
        let sum = 0;
        let count = 0;
        for (const strat of strategies) {
          if (typeof strat.evaluate === "function") {
            try {
              const score = strat.evaluate(context);
              const resolved = score instanceof Promise ? score : Promise.resolve(score);
              // synchronously only — async evaluate is skipped in compose
              if (typeof resolved.then !== "function") {
                sum += resolved;
                count += 1;
              }
            } catch (_) {
              // skip
            }
          }
        }
        return count === 0 ? 0.5 : sum / count;
      },
    };

    return composite;
  }

  /**
   * Measure a strategy's effectiveness after execution.
   *
   * @param {object} strategy — the strategy that was executed
   * @param {object} context  — the context it was executed with
   * @param {object} result   — { success, latencyMs, resourceUsed, error? }
   * @returns {object} measurement { effectiveness, scores, recommendation }
   */
  measure(strategy, context, result) {
    if (!result || typeof result !== "object") {
      throw new TypeError("Result must be a non-null object");
    }

    const success = result.success !== false;
    const latencyMs = Number.isFinite(result.latencyMs) ? result.latencyMs : 0;
    const resourceUsed = Number.isFinite(result.resourceUsed) ? result.resourceUsed : 0;

    // normalized latency score: 0 (very slow) to 1 (instant)
    const latencyScore = latencyMs <= 0 ? 1 : Math.max(0, 1 - (latencyMs / 10000) * MEASURE_WEIGHTS.latencyPenalty);

    // resource score: 0 (very expensive) to 1 (free)
    const resourceScore = resourceUsed <= 0 ? 1 : Math.max(0, 1 - (resourceUsed / 1000) * MEASURE_WEIGHTS.resourcePenalty);

    // error penalty
    let errorPenalty = 0;
    if (!success && result.error) {
      errorPenalty = MEASURE_WEIGHTS.errorPenalty;
    }

    const rawEffectiveness =
      (success ? MEASURE_WEIGHTS.success : 0) +
      latencyScore +
      resourceScore -
      errorPenalty;

    const effectiveness = Math.max(0, Math.min(1, rawEffectiveness / 3));

    const recommendation = this._buildRecommendation(effectiveness, success, latencyMs);

    const measurement = {
      strategyName: strategy.name || "unknown",
      effectiveness,
      scores: {
        success,
        latencyScore,
        resourceScore,
        errorPenalty,
      },
      latencyMs,
      resourceUsed,
      recommendation,
      timestamp: Date.now(),
    };

    debug("strategy", `measure(${strategy.name}): effectiveness=${effectiveness.toFixed(2)} ${recommendation}`);

    return measurement;
  }

  /**
   * Get feedback history for a strategy.
   *
   * @param {string} name
   * @returns {object|null}
   */
  getFeedback(name) {
    return this._feedbackHistory.get(name) || null;
  }

  /**
   * Get the full execution log.
   *
   * @returns {Array<object>}
   */
  getExecutionLog() {
    return this._executionLog.slice();
  }

  /**
   * Clear all history.
   */
  reset() {
    this._feedbackHistory.clear();
    this._executionLog.length = 0;
  }

  // ---- private ----

  _normalizeScore(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5;
    return Math.max(0, Math.min(1, raw));
  }

  _getFeedbackScore(strategyName) {
    const fb = this._feedbackHistory.get(strategyName);
    if (!fb || fb.count === 0) return 0.5; // neutral for unknown
    const successRate = fb.successes / fb.count;
    return successRate;
  }

  _recordExecution(strategy, context, result, error, durationMs) {
    this._executionLog.push({
      strategyName: strategy.name || "unknown",
      strategyType: strategy.type || "unknown",
      contextKeys: context && typeof context === "object" ? Object.keys(context) : [],
      success: !error,
      error: error ? error.message : null,
      durationMs,
      timestamp: Date.now(),
    });

    // trim log to prevent unbounded growth
    if (this._executionLog.length > 1000) {
      this._executionLog.shift();
    }
  }

  _buildRecommendation(effectiveness, success, latencyMs) {
    if (effectiveness >= 0.8) return "maintain";
    if (effectiveness >= 0.5) return "tune";
    if (success) return "adjust";
    return "replace";
  }
}

module.exports = {
  StrategyEngine,
  SCORE_THRESHOLD,
  ADAPT_DECAY_FACTOR,
  MEASURE_WEIGHTS,
};
