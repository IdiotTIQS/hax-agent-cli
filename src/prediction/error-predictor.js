"use strict";

const { EventEmitter } = require("node:events");
const { debug } = require("../debug");

/**
 * ErrorPredictor — predictive error prevention engine.
 *
 * Analyzes operation context against historical error patterns, resource
 * states, time-based heuristics, and complexity indicators to forecast
 * likely failures *before* an operation executes. Feeds into the
 * EarlyWarningSystem and integrates with the CircuitBreaker for
 * proactive risk mitigation.
 *
 * Error types modelled:
 *   - timeout           — operation likely to exceed time budget
 *   - rateLimit         — approaching provider rate limits
 *   - authFailure       — credential expiry or scope issues
 *   - validationError   — input schema / constraint violations
 *   - networkError      — connectivity instability
 *   - resourceExhausted — memory, token, or disk ceiling
 *
 * Risk levels: LOW, MEDIUM, HIGH, CRITICAL
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_LEVEL = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const ERROR_TYPE = {
  TIMEOUT: "timeout",
  RATE_LIMIT: "rateLimit",
  AUTH_FAILURE: "authFailure",
  VALIDATION_ERROR: "validationError",
  NETWORK_ERROR: "networkError",
  RESOURCE_EXHAUSTED: "resourceExhausted",
};

// Heuristic thresholds
const RECENT_ERROR_WINDOW_MS = 300_000;        // 5 minutes
const RECENT_ERROR_HIGH_COUNT = 5;
const RECENT_ERROR_CRITICAL_COUNT = 10;

const COMPLEXITY_LOW_THRESHOLD = 3;             // tool calls
const COMPLEXITY_MEDIUM_THRESHOLD = 8;
const COMPLEXITY_HIGH_THRESHOLD = 15;

const RESOURCE_WARN_RATIO = 0.7;                // 70% usage
const RESOURCE_CRITICAL_RATIO = 0.9;            // 90% usage

const TIME_PATTERN_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const TIME_PATTERN_BUSY_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]; // 9am-5pm

const PREDICTION_CONFIDENCE_MIN = 0.0;
const PREDICTION_CONFIDENCE_MAX = 1.0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function floatClamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nowMs() {
  return Date.now();
}

/**
 * Compute a decaying weight for an error based on its age.
 * Recent errors (within 60s) → weight 1.0
 * Old errors (past the window)  → weight 0.0
 * Linear decay in between.
 */
function decayWeight(ageMs, windowMs) {
  if (ageMs <= 0) return 1.0;
  if (ageMs >= windowMs) return 0.0;
  return 1.0 - ageMs / windowMs;
}

// ---------------------------------------------------------------------------
// ErrorPredictor
// ---------------------------------------------------------------------------

class ErrorPredictor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.recentErrorWindowMs=300000]      — window for recent error history
   * @param {number} [options.recentErrorHighCount=5]          — errors in window → HIGH risk
   * @param {number} [options.recentErrorCriticalCount=10]     — errors in window → CRITICAL risk
   * @param {number} [options.resourceWarnRatio=0.7]           — resource usage ratio for warning
   * @param {number} [options.resourceCriticalRatio=0.9]       — resource usage ratio for critical
   * @param {number} [options.timePatternWindowMs=86400000]    — time pattern analysis window
   * @param {number[]} [options.busyHours]                     — hours considered "peak load"
   */
  constructor(options = {}) {
    super();

    this._recentErrorWindowMs = positiveInteger(
      options.recentErrorWindowMs, RECENT_ERROR_WINDOW_MS
    );
    this._recentErrorHighCount = positiveInteger(
      options.recentErrorHighCount, RECENT_ERROR_HIGH_COUNT
    );
    this._recentErrorCriticalCount = positiveInteger(
      options.recentErrorCriticalCount, RECENT_ERROR_CRITICAL_COUNT
    );
    this._resourceWarnRatio = floatClamp(
      options.resourceWarnRatio || RESOURCE_WARN_RATIO, 0, 1
    );
    this._resourceCriticalRatio = floatClamp(
      options.resourceCriticalRatio || RESOURCE_CRITICAL_RATIO, 0, 1
    );
    this._timePatternWindowMs = positiveInteger(
      options.timePatternWindowMs, TIME_PATTERN_WINDOW
    );
    this._busyHours = Array.isArray(options.busyHours)
      ? options.busyHours
      : TIME_PATTERN_BUSY_HOURS;

    // Learned error history: [{ type, context, timestamp, metadata }]
    this._errorHistory = [];

    // Aggregated stats per error type
    this._errorTypeStats = Object.create(null);
    for (const t of Object.values(ERROR_TYPE)) {
      this._errorTypeStats[t] = {
        count: 0,
        lastSeen: null,
        frequency: 0,       // errors per hour (smoothed)
        avgRecoveryMs: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Predict likely errors for a prospective operation.
   *
   * The context object should describe the operation about to be performed:
   *   {
   *     name: string,               // operation name
   *     estimatedToolCalls: number, // expected tool call count
   *     estimatedTokens: number,    // expected token budget
   *     resourceUsage: {            // current resource state
   *       memoryRatio: 0..1,
   *       tokenQuotaRatio: 0..1,
   *       diskRatio: 0..1,
   *     },
   *     timeBudgetMs: number,       // expected time budget
   *     recentErrors: string[],     // error type names from the last few operations
   *   }
   *
   * @param {object} context — operation context
   * @returns {object[]} array of prediction objects
   */
  predict(context) {
    if (!context || typeof context !== "object") {
      return [];
    }

    const name = context.name || "(unnamed)";
    const predictions = [];

    // 1. Timeout prediction — based on complexity vs time budget
    predictions.push(...this._predictTimeout(context, name));

    // 2. Rate-limit prediction — based on recent rate-limit errors + token quota
    predictions.push(...this._predictRateLimit(context, name));

    // 3. Auth-failure prediction — based on recent auth errors
    predictions.push(...this._predictAuthFailure(context, name));

    // 4. Validation-error prediction — based on complexity + no validation pattern
    predictions.push(...this._predictValidationError(context, name));

    // 5. Network-error prediction — based on recent network errors + time patterns
    predictions.push(...this._predictNetworkError(context, name));

    // 6. Resource-exhaustion prediction — based on resource usage ratios
    predictions.push(...this._predictResourceExhausted(context, name));

    // Sort by risk level (most severe first), then by confidence
    const riskOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    predictions.sort((a, b) => {
      const rDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (rDiff !== 0) return rDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    return predictions;
  }

  /**
   * Get the overall risk level for an operation.
   *
   * @param {object} operation — same shape as predict() context
   * @returns {string} "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
   */
  getRiskLevel(operation) {
    const predictions = this.predict(operation);

    if (predictions.length === 0) return RISK_LEVEL.LOW;

    let maxSeverity = RISK_LEVEL.LOW;
    const riskOrder = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

    for (const p of predictions) {
      if (riskOrder[p.riskLevel] > riskOrder[maxSeverity]) {
        maxSeverity = p.riskLevel;
      }
    }

    return maxSeverity;
  }

  /**
   * Suggest preventive measures for an operation based on predictions.
   *
   * @param {object} operation — same shape as predict() context
   * @returns {object[]} array of precaution suggestions
   */
  suggestPrecautions(operation) {
    const predictions = this.predict(operation);
    const precautions = [];

    const seenTypes = new Set();

    for (const p of predictions) {
      const type = p.errorType;
      if (seenTypes.has(type)) continue;
      seenTypes.add(type);

      switch (type) {
        case ERROR_TYPE.TIMEOUT:
          precautions.push({
            action: "increaseTimeout",
            message: `Increase timeout budget; current estimate may be insufficient`,
            riskLevel: p.riskLevel,
            details: {
              estimatedComplexity: operation.estimatedToolCalls || 0,
              currentTimeBudget: operation.timeBudgetMs || 0,
              suggestedBudget: (operation.timeBudgetMs || 30000) * 1.5,
            },
          });
          break;

        case ERROR_TYPE.RATE_LIMIT:
          precautions.push({
            action: "throttle",
            message: `Add rate-limit backoff or reduce request frequency`,
            riskLevel: p.riskLevel,
            details: {
              recentRateLimitErrors: this._errorTypeStats[ERROR_TYPE.RATE_LIMIT].count,
              tokenQuotaRatio: operation.resourceUsage?.tokenQuotaRatio || 0,
            },
          });
          break;

        case ERROR_TYPE.AUTH_FAILURE:
          precautions.push({
            action: "refreshCredentials",
            message: `Verify and refresh authentication credentials before executing`,
            riskLevel: p.riskLevel,
            details: {
              recentAuthFailures: this._errorTypeStats[ERROR_TYPE.AUTH_FAILURE].count,
            },
          });
          break;

        case ERROR_TYPE.VALIDATION_ERROR:
          precautions.push({
            action: "validateInputs",
            message: `Pre-validate operation inputs and schemas to avoid validation failures`,
            riskLevel: p.riskLevel,
            details: {
              estimatedToolCalls: operation.estimatedToolCalls || 0,
            },
          });
          break;

        case ERROR_TYPE.NETWORK_ERROR:
          precautions.push({
            action: "retryWithBackoff",
            message: `Enable exponential backoff and circuit-breaker for network calls`,
            riskLevel: p.riskLevel,
            details: {
              recentNetworkErrors: this._errorTypeStats[ERROR_TYPE.NETWORK_ERROR].count,
              isPeakHours: this._isPeakHours(),
            },
          });
          break;

        case ERROR_TYPE.RESOURCE_EXHAUSTED:
          precautions.push({
            action: "reduceFootprint",
            message: `Reduce resource footprint: trim context, free memory, or defer non-critical work`,
            riskLevel: p.riskLevel,
            details: {
              memoryRatio: operation.resourceUsage?.memoryRatio || 0,
              tokenQuotaRatio: operation.resourceUsage?.tokenQuotaRatio || 0,
              diskRatio: operation.resourceUsage?.diskRatio || 0,
            },
          });
          break;

        default:
          break;
      }
    }

    return precautions;
  }

  /**
   * Learn from an actual error to improve future predictions.
   *
   * @param {object} error — error report
   * @param {string} error.type  — one of ERROR_TYPE values
   * @param {string} [error.context] — operation context at time of error
   * @param {number} [error.recoveryMs] — how long the error lasted
   * @param {object} [error.metadata] — additional diagnostic data
   */
  learn(error) {
    if (!error || !error.type) {
      debug("error-predictor", "learn called without error type — ignoring");
      return;
    }

    const type = error.type;
    if (!ERROR_TYPE[type.toUpperCase()] && !Object.values(ERROR_TYPE).includes(type)) {
      debug("error-predictor", `learn called with unknown error type: ${type}`);
      // Still record unknown types generically
    }

    const record = {
      type,
      context: error.context || null,
      timestamp: error.timestamp || nowMs(),
      recoveryMs: error.recoveryMs || 0,
      metadata: error.metadata || {},
    };

    this._errorHistory.push(record);

    // Update type-specific stats
    if (this._errorTypeStats[type]) {
      const stats = this._errorTypeStats[type];
      stats.count += 1;
      stats.lastSeen = record.timestamp;

      // Smoothed frequency: exponential moving average over 1-hour buckets
      const timeSinceLast = stats.lastSeen && record.timestamp > stats.lastSeen
        ? record.timestamp - stats.lastSeen + 1
        : 3600000;
      const instantFreq = 3600000 / timeSinceLast;
      stats.frequency = stats.frequency === 0
        ? instantFreq
        : stats.frequency * 0.7 + instantFreq * 0.3;

      if (error.recoveryMs > 0) {
        stats.avgRecoveryMs = stats.avgRecoveryMs === 0
          ? error.recoveryMs
          : stats.avgRecoveryMs * 0.8 + error.recoveryMs * 0.2;
      }
    }

    // Prune old entries beyond the time pattern window
    this._pruneHistory();

    // Emit event so EarlyWarningSystem can react
    this.emit("error-learned", {
      type,
      stats: this._errorTypeStats[type] || {},
      timestamp: record.timestamp,
    });

    debug("error-predictor", `learned error type="${type}" (total=${this._errorHistory.length})`);
  }

  /**
   * Get the full error history.
   *
   * @returns {object[]} array of learned error records
   */
  getErrorHistory() {
    return this._errorHistory.slice();
  }

  /**
   * Get aggregated statistics per error type.
   *
   * @returns {object} { timeout: { count, frequency, ... }, ... }
   */
  getErrorTypeStats() {
    // Return a deep-enough copy
    const copy = Object.create(null);
    for (const [type, stats] of Object.entries(this._errorTypeStats)) {
      copy[type] = { ...stats };
    }
    return copy;
  }

  /**
   * Reset all learned data.
   */
  reset() {
    this._errorHistory = [];
    this._errorTypeStats = Object.create(null);
    for (const t of Object.values(ERROR_TYPE)) {
      this._errorTypeStats[t] = {
        count: 0,
        lastSeen: null,
        frequency: 0,
        avgRecoveryMs: 0,
      };
    }

    debug("error-predictor", "reset all learned data");
  }

  // ---------------------------------------------------------------------------
  // Private predictors
  // ---------------------------------------------------------------------------

  /**
   * Timeout prediction: complexity vs time budget.
   * High complexity + tight time budget → TIMEOUT risk.
   */
  _predictTimeout(context, name) {
    const predictions = [];
    const toolCalls = context.estimatedToolCalls || 0;
    const timeBudget = context.timeBudgetMs || 30000;

    // Estimate: each tool call takes ~2s baseline + network overhead
    const estimatedTimeNeeded = toolCalls * 2500 + 5000; // base overhead
    const timeRatio = timeBudget > 0 ? estimatedTimeNeeded / timeBudget : 1;

    if (timeRatio >= 1.5) {
      predictions.push({
        errorType: ERROR_TYPE.TIMEOUT,
        riskLevel: RISK_LEVEL.CRITICAL,
        confidence: floatClamp(Math.min(timeRatio / 2, 1), 0.3, 1),
        reason: `Estimated ${estimatedTimeNeeded}ms needed for ${toolCalls} tool calls, but only ${timeBudget}ms budgeted`,
        details: {
          estimatedTimeNeeded,
          timeBudget,
          toolCalls,
          ratio: Math.round(timeRatio * 100) / 100,
        },
      });
    } else if (timeRatio >= 1.0) {
      predictions.push({
        errorType: ERROR_TYPE.TIMEOUT,
        riskLevel: RISK_LEVEL.HIGH,
        confidence: floatClamp(timeRatio * 0.8, 0.2, 0.9),
        reason: `Tight time budget: ${toolCalls} tool calls in ${timeBudget}ms`,
        details: {
          estimatedTimeNeeded,
          timeBudget,
          toolCalls,
          ratio: Math.round(timeRatio * 100) / 100,
        },
      });
    } else if (timeRatio >= 0.7) {
      predictions.push({
        errorType: ERROR_TYPE.TIMEOUT,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.5,
        reason: `Moderate time pressure for ${toolCalls} tool calls`,
        details: {
          estimatedTimeNeeded,
          timeBudget,
          toolCalls,
          ratio: Math.round(timeRatio * 100) / 100,
        },
      });
    }

    // Also factor in timeout error history
    const timeoutStats = this._errorTypeStats[ERROR_TYPE.TIMEOUT];
    if (timeoutStats && timeoutStats.frequency > 1) {
      const existing = predictions[0];
      if (existing) {
        existing.riskLevel = this._elevateRisk(existing.riskLevel, 1);
        existing.confidence = floatClamp(existing.confidence + 0.15, 0, 1);
      }
    }

    return predictions;
  }

  /**
   * Rate-limit prediction: recent rate-limit errors + token quota pressure.
   */
  _predictRateLimit(context, name) {
    const predictions = [];
    const recent = this._countRecent(ERROR_TYPE.RATE_LIMIT);
    const quotaRatio = context.resourceUsage?.tokenQuotaRatio || 0;

    if (recent >= 3 || quotaRatio >= this._resourceCriticalRatio) {
      predictions.push({
        errorType: ERROR_TYPE.RATE_LIMIT,
        riskLevel: RISK_LEVEL.CRITICAL,
        confidence: floatClamp(0.7 + recent * 0.05, 0, 1),
        reason: `High rate-limit risk: ${recent} recent rate-limit errors, quota at ${Math.round(quotaRatio * 100)}%`,
        details: { recentRateLimits: recent, quotaRatio },
      });
    } else if (recent >= 1 || quotaRatio >= this._resourceWarnRatio) {
      predictions.push({
        errorType: ERROR_TYPE.RATE_LIMIT,
        riskLevel: RISK_LEVEL.HIGH,
        confidence: floatClamp(0.5 + recent * 0.1, 0, 1),
        reason: `Elevated rate-limit risk: ${recent} recent errors, quota at ${Math.round(quotaRatio * 100)}%`,
        details: { recentRateLimits: recent, quotaRatio },
      });
    } else if (quotaRatio >= 0.5 && this._isPeakHours()) {
      predictions.push({
        errorType: ERROR_TYPE.RATE_LIMIT,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.4,
        reason: `Moderate rate-limit risk during peak hours; quota at ${Math.round(quotaRatio * 100)}%`,
        details: { recentRateLimits: recent, quotaRatio, peakHours: true },
      });
    }

    return predictions;
  }

  /**
   * Auth-failure prediction: recent auth errors or stale credentials.
   */
  _predictAuthFailure(context, name) {
    const predictions = [];
    const recent = this._countRecent(ERROR_TYPE.AUTH_FAILURE);
    const authStats = this._errorTypeStats[ERROR_TYPE.AUTH_FAILURE];

    if (recent >= 2) {
      predictions.push({
        errorType: ERROR_TYPE.AUTH_FAILURE,
        riskLevel: recent >= 4 ? RISK_LEVEL.CRITICAL : RISK_LEVEL.HIGH,
        confidence: floatClamp(0.6 + recent * 0.1, 0, 1),
        reason: `${recent} recent authentication failures — credentials may need refresh`,
        details: { recentAuthFailures: recent, lastSeen: authStats?.lastSeen || null },
      });
    } else if (recent === 1) {
      predictions.push({
        errorType: ERROR_TYPE.AUTH_FAILURE,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.35,
        reason: `One recent authentication failure — monitor for recurrence`,
        details: { recentAuthFailures: 1, lastSeen: authStats?.lastSeen || null },
      });
    }

    return predictions;
  }

  /**
   * Validation-error prediction: high-complexity operations with no validation step.
   */
  _predictValidationError(context, name) {
    const predictions = [];
    const toolCalls = context.estimatedToolCalls || 0;
    const complexity = this._complexityLevel(toolCalls);
    const recent = this._countRecent(ERROR_TYPE.VALIDATION_ERROR);

    if (complexity === "high" && recent >= 2) {
      predictions.push({
        errorType: ERROR_TYPE.VALIDATION_ERROR,
        riskLevel: RISK_LEVEL.CRITICAL,
        confidence: 0.75,
        reason: `High-complexity operation (${toolCalls} tool calls) with recent validation errors`,
        details: { toolCalls, complexity, recentValidationErrors: recent },
      });
    } else if (complexity === "high") {
      predictions.push({
        errorType: ERROR_TYPE.VALIDATION_ERROR,
        riskLevel: RISK_LEVEL.HIGH,
        confidence: 0.55,
        reason: `High-complexity operation (${toolCalls} tool calls) — pre-validation recommended`,
        details: { toolCalls, complexity, recentValidationErrors: recent },
      });
    } else if (complexity === "medium" && recent >= 1) {
      predictions.push({
        errorType: ERROR_TYPE.VALIDATION_ERROR,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.4,
        reason: `Moderate-complexity operation with prior validation errors`,
        details: { toolCalls, complexity, recentValidationErrors: recent },
      });
    }

    return predictions;
  }

  /**
   * Network-error prediction: recent network errors + time-of-day patterns.
   */
  _predictNetworkError(context, name) {
    const predictions = [];
    const recent = this._countRecent(ERROR_TYPE.NETWORK_ERROR);
    const networkStats = this._errorTypeStats[ERROR_TYPE.NETWORK_ERROR];

    if (recent >= 4) {
      predictions.push({
        errorType: ERROR_TYPE.NETWORK_ERROR,
        riskLevel: RISK_LEVEL.CRITICAL,
        confidence: 0.8,
        reason: `Persistent network instability: ${recent} recent network errors`,
        details: { recentNetworkErrors: recent, frequency: networkStats?.frequency || 0 },
      });
    } else if (recent >= 2) {
      predictions.push({
        errorType: ERROR_TYPE.NETWORK_ERROR,
        riskLevel: RISK_LEVEL.HIGH,
        confidence: 0.55,
        reason: `${recent} recent network errors — consider retry with backoff`,
        details: { recentNetworkErrors: recent, frequency: networkStats?.frequency || 0 },
      });
    } else if (recent >= 1) {
      predictions.push({
        errorType: ERROR_TYPE.NETWORK_ERROR,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.3,
        reason: `Intermittent network errors detected`,
        details: { recentNetworkErrors: recent },
      });
    }

    // Elevate during peak hours when network congestion is likely
    if (predictions.length > 0 && this._isPeakHours()) {
      predictions[0].riskLevel = this._elevateRisk(predictions[0].riskLevel, 1);
      predictions[0].confidence = floatClamp(predictions[0].confidence + 0.1, 0, 1);
    }

    return predictions;
  }

  /**
   * Resource-exhaustion prediction: memory/token/disk ratios.
   */
  _predictResourceExhausted(context, name) {
    const predictions = [];
    const res = context.resourceUsage || {};
    const memoryRatio = res.memoryRatio || 0;
    const tokenQuotaRatio = res.tokenQuotaRatio || 0;
    const diskRatio = res.diskRatio || 0;

    const maxRatio = Math.max(memoryRatio, tokenQuotaRatio, diskRatio);

    if (maxRatio >= this._resourceCriticalRatio) {
      const worstResource = memoryRatio >= this._resourceCriticalRatio
        ? "memory"
        : tokenQuotaRatio >= this._resourceCriticalRatio
          ? "tokens"
          : "disk";

      predictions.push({
        errorType: ERROR_TYPE.RESOURCE_EXHAUSTED,
        riskLevel: RISK_LEVEL.CRITICAL,
        confidence: floatClamp(maxRatio, 0, 1),
        reason: `Resource exhaustion imminent: ${worstResource} at ${Math.round(maxRatio * 100)}%`,
        details: { memoryRatio, tokenQuotaRatio, diskRatio, worstResource },
      });
    } else if (maxRatio >= this._resourceWarnRatio) {
      const worstResource = memoryRatio >= this._resourceWarnRatio
        ? "memory"
        : tokenQuotaRatio >= this._resourceWarnRatio
          ? "tokens"
          : "disk";

      predictions.push({
        errorType: ERROR_TYPE.RESOURCE_EXHAUSTED,
        riskLevel: RISK_LEVEL.HIGH,
        confidence: floatClamp(maxRatio * 0.9, 0, 1),
        reason: `${worstResource} usage at ${Math.round(maxRatio * 100)}% — approaching limit`,
        details: { memoryRatio, tokenQuotaRatio, diskRatio, worstResource },
      });
    } else if (maxRatio >= 0.5) {
      predictions.push({
        errorType: ERROR_TYPE.RESOURCE_EXHAUSTED,
        riskLevel: RISK_LEVEL.MEDIUM,
        confidence: 0.35,
        reason: `Resource usage elevated at ${Math.round(maxRatio * 100)}%`,
        details: { memoryRatio, tokenQuotaRatio, diskRatio },
      });
    }

    return predictions;
  }

  // ---------------------------------------------------------------------------
  // Internal utilities
  // ---------------------------------------------------------------------------

  /**
   * Count recent errors of a specific type within the sliding window.
   */
  _countRecent(type) {
    const cutoff = nowMs() - this._recentErrorWindowMs;
    let count = 0;

    for (let i = this._errorHistory.length - 1; i >= 0; i--) {
      if (this._errorHistory[i].timestamp < cutoff) break;
      if (this._errorHistory[i].type === type) {
        count += 1;
      }
    }

    return count;
  }

  /**
   * Determine complexity level from tool call count.
   */
  _complexityLevel(toolCalls) {
    if (toolCalls >= COMPLEXITY_HIGH_THRESHOLD) return "high";
    if (toolCalls >= COMPLEXITY_MEDIUM_THRESHOLD) return "medium";
    if (toolCalls >= COMPLEXITY_LOW_THRESHOLD) return "low";
    return "trivial";
  }

  /**
   * Check if current time falls within peak (busy) hours.
   */
  _isPeakHours() {
    const hour = new Date().getHours();
    return this._busyHours.includes(hour);
  }

  /**
   * Elevate risk level by a number of steps.
   */
  _elevateRisk(currentLevel, steps) {
    const levels = [RISK_LEVEL.LOW, RISK_LEVEL.MEDIUM, RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL];
    const idx = levels.indexOf(currentLevel);
    if (idx === -1) return currentLevel;
    const newIdx = Math.min(idx + steps, levels.length - 1);
    return levels[newIdx];
  }

  /**
   * Prune error history entries older than the time pattern window.
   */
  _pruneHistory() {
    const cutoff = nowMs() - this._timePatternWindowMs;

    let removeCount = 0;
    while (
      this._errorHistory.length > 0 &&
      this._errorHistory[0].timestamp < cutoff
    ) {
      // Recalculate stats for pruned entries
      const removed = this._errorHistory.shift();
      const stats = this._errorTypeStats[removed.type];
      if (stats && stats.count > 0) {
        stats.count = Math.max(0, stats.count - 1);
      }
      removeCount += 1;
    }

    if (removeCount > 0) {
      debug("error-predictor", `pruned ${removeCount} old error records`);
    }
  }
}

module.exports = {
  ErrorPredictor,
  RISK_LEVEL,
  ERROR_TYPE,
  RECENT_ERROR_WINDOW_MS,
  RECENT_ERROR_HIGH_COUNT,
  RECENT_ERROR_CRITICAL_COUNT,
  COMPLEXITY_LOW_THRESHOLD,
  COMPLEXITY_MEDIUM_THRESHOLD,
  COMPLEXITY_HIGH_THRESHOLD,
  RESOURCE_WARN_RATIO,
  RESOURCE_CRITICAL_RATIO,
  TIME_PATTERN_WINDOW,
};
