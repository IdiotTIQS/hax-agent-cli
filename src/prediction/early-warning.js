"use strict";

const { EventEmitter } = require("node:events");
const { debug } = require("../debug");

/**
 * EarlyWarningSystem — proactive warning engine that monitors agent
 * sessions for signals that precede failures.
 *
 * Unlike the AnomalyDetector (which finds anomalies that have already
 * occurred), the EarlyWarningSystem detects *trends* and *leading
 * indicators* that suggest future problems, giving operators time to
 * intervene before a failure cascades.
 *
 * Warning indicators monitored:
 *   - Token acceleration      — token usage growing faster than baseline
 *   - Error rate increase     — error count trending upward
 *   - Latency growth          — operation durations increasing
 *   - Tool failure patterns   — specific tools failing repeatedly
 *   - Conversation loops      — agent repeating the same patterns
 *
 * Severity levels: WATCH → ADVISORY → WARNING → URGENT
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY = {
  WATCH: "WATCH",
  ADVISORY: "ADVISORY",
  WARNING: "WARNING",
  URGENT: "URGENT",
};

const WARNING_INDICATOR = {
  TOKEN_ACCELERATION: "tokenAcceleration",
  ERROR_RATE_INCREASE: "errorRateIncrease",
  LATENCY_GROWTH: "latencyGrowth",
  TOOL_FAILURE_PATTERN: "toolFailurePattern",
  CONVERSATION_LOOP: "conversationLoop",
};

// Heuristic thresholds
const TOKEN_ACCELERATION_THRESHOLD = 1.5;       // 50% growth rate
const ERROR_RATE_INCREASE_THRESHOLD = 2.0;       // 2x error rate
const LATENCY_GROWTH_THRESHOLD = 1.3;            // 30% latency increase
const TOOL_FAILURE_STREAK_THRESHOLD = 3;         // consecutive failures
const LOOP_DETECTION_WINDOW = 5;                 // entries to check for repetition
const TREND_WINDOW_SIZE = 10;                    // entries for trend analysis

const BASELINE_MIN_SAMPLES = 3;                  // minimum data points for baseline

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractEntries(session) {
  if (Array.isArray(session)) return session;
  if (session && Array.isArray(session.entries)) return session.entries;
  if (session && typeof session.entries === "function") return session.entries();
  return [];
}

function isAssistantMsg(entry) {
  return entry && entry.role === "assistant";
}

function isToolMsg(entry) {
  return entry && entry.role === "tool";
}

function isErrorTool(entry) {
  return isToolMsg(entry) && entry.isError === true;
}

function parseUsageToken(usage, ...keys) {
  if (!usage) return 0;
  for (const key of keys) {
    if (Number.isFinite(usage[key])) return usage[key];
  }
  return 0;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function mean(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Warning factory
// ---------------------------------------------------------------------------

function makeWarning(indicator, severity, message, details) {
  return {
    id: `${indicator}_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
    indicator,
    severity,
    message,
    details: details || {},
    timestamp: nowMs(),
    acknowledged: false,
    escalated: false,
  };
}

// ---------------------------------------------------------------------------
// EarlyWarningSystem
// ---------------------------------------------------------------------------

class EarlyWarningSystem extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.tokenAccelerationThreshold=1.5]  — growth ratio that triggers
   * @param {number} [options.errorRateIncreaseThreshold=2.0]  — error multiplier that triggers
   * @param {number} [options.latencyGrowthThreshold=1.3]      — latency increase ratio
   * @param {number} [options.toolFailureStreakThreshold=3]    — consecutive failures
   * @param {number} [options.loopDetectionWindow=5]           — entries for loop detection
   * @param {number} [options.baselineMinSamples=3]            — min data for baseline
   */
  constructor(options = {}) {
    super();

    this._tokenAccelerationThreshold = Number.isFinite(options.tokenAccelerationThreshold)
      ? options.tokenAccelerationThreshold
      : TOKEN_ACCELERATION_THRESHOLD;

    this._errorRateIncreaseThreshold = Number.isFinite(options.errorRateIncreaseThreshold)
      ? options.errorRateIncreaseThreshold
      : ERROR_RATE_INCREASE_THRESHOLD;

    this._latencyGrowthThreshold = Number.isFinite(options.latencyGrowthThreshold)
      ? options.latencyGrowthThreshold
      : LATENCY_GROWTH_THRESHOLD;

    this._toolFailureStreakThreshold = Number.isFinite(options.toolFailureStreakThreshold)
      ? options.toolFailureStreakThreshold
      : TOOL_FAILURE_STREAK_THRESHOLD;

    this._loopDetectionWindow = Number.isFinite(options.loopDetectionWindow)
      ? options.loopDetectionWindow
      : LOOP_DETECTION_WINDOW;

    this._baselineMinSamples = Number.isFinite(options.baselineMinSamples)
      ? options.baselineMinSamples
      : BASELINE_MIN_SAMPLES;

    // Active warnings (most recent per indicator)
    this._warnings = [];

    // Historical trends: running window of measurements
    this._trends = {
      tokenUsage: [],              // [{ ts, totalTokens }]
      errorCounts: [],             // [{ ts, count }]
      latencies: [],               // [{ ts, ms, toolName }]
      toolFailures: [],            // [{ ts, toolName, isError }]
      messagePatterns: [],         // [{ ts, contentHash }]
    };

    // Baselines (established from first N datapoints)
    this._baselines = {
      avgTokenUsage: 0,
      avgErrorRate: 0,
      avgLatencyMs: 0,
      established: false,
    };

    // Session metadata
    this._sessionId = null;
    this._lastMonitorTs = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Monitor a session for early warning signs.
   *
   * Call this periodically (e.g., after each exchange) to feed the
   * system with fresh data. Returns newly generated warnings.
   *
   * @param {object|object[]} session — session object or entry array
   * @returns {object[]} new warnings generated in this monitoring cycle
   */
  monitor(session) {
    const entries = extractEntries(session);
    if (entries.length === 0) return [];

    const beforeCount = this._warnings.length;

    // 1. Detect token acceleration
    this._detectTokenAcceleration(entries);

    // 2. Detect error rate increase
    this._detectErrorRateIncrease(entries);

    // 3. Detect latency growth
    this._detectLatencyGrowth(entries);

    // 4. Detect tool failure patterns
    this._detectToolFailurePatterns(entries);

    // 5. Detect conversation loops
    this._detectConversationLoops(entries);

    // Establish or update baselines if sufficient data collected
    this._updateBaselines();

    this._lastMonitorTs = nowMs();

    // Return only newly generated warnings
    return this._warnings.slice(beforeCount);
  }

  /**
   * Get all current active (unacknowledged) warnings.
   *
   * @returns {object[]} array of warning objects
   */
  getWarnings() {
    return this._warnings.filter((w) => !w.acknowledged);
  }

  /**
   * Get the full list of warnings (including acknowledged).
   *
   * @returns {object[]}
   */
  getAllWarnings() {
    return this._warnings.slice();
  }

  /**
   * Get current trends indicating future problems.
   *
   * @returns {object} trend analysis object
   */
  getTrends() {
    const tokenTrend = this._computeTokenTrend();
    const errorTrend = this._computeErrorTrend();
    const latencyTrend = this._computeLatencyTrend();
    const loopTrend = this._computeLoopTrend();

    return {
      tokenUsage: {
        direction: tokenTrend.direction,       // "rising" | "falling" | "stable"
        growthRate: tokenTrend.growthRate,
        currentAvg: tokenTrend.currentAvg,
        baselineAvg: tokenTrend.baselineAvg,
      },
      errorRate: {
        direction: errorTrend.direction,
        growthRate: errorTrend.growthRate,
        currentRate: errorTrend.currentRate,
        baselineRate: errorTrend.baselineRate,
      },
      latency: {
        direction: latencyTrend.direction,
        growthRate: latencyTrend.growthRate,
        currentAvgMs: latencyTrend.currentAvgMs,
        baselineAvgMs: latencyTrend.baselineAvgMs,
      },
      conversationLoop: {
        detected: loopTrend.detected,
        patternLength: loopTrend.patternLength,
        repeatCount: loopTrend.repeatCount,
      },
      baselinesEstablished: this._baselines.established,
    };
  }

  /**
   * Suggest intervention actions based on current warning state.
   *
   * @returns {object[]} array of intervention suggestions
   */
  suggestIntervention() {
    const activeWarnings = this.getWarnings();
    const trends = this.getTrends();
    const interventions = [];

    // Group warnings by indicator
    const byIndicator = Object.create(null);
    for (const w of activeWarnings) {
      if (!byIndicator[w.indicator]) byIndicator[w.indicator] = [];
      byIndicator[w.indicator].push(w);
    }

    // Token acceleration intervention
    if (byIndicator[WARNING_INDICATOR.TOKEN_ACCELERATION]) {
      const severities = byIndicator[WARNING_INDICATOR.TOKEN_ACCELERATION].map((w) => w.severity);
      const maxSev = this._maxSeverity(severities);

      interventions.push({
        priority: maxSev === SEVERITY.URGENT ? 1 : 2,
        indicator: WARNING_INDICATOR.TOKEN_ACCELERATION,
        action: "compactContext",
        message: `Token usage accelerating — consider context compaction or summarization`,
        severity: maxSev,
        details: {
          growthRate: trends.tokenUsage.growthRate,
          currentAvg: trends.tokenUsage.currentAvg,
          baselineAvg: trends.tokenUsage.baselineAvg,
        },
      });
    }

    // Error rate intervention
    if (byIndicator[WARNING_INDICATOR.ERROR_RATE_INCREASE]) {
      const severities = byIndicator[WARNING_INDICATOR.ERROR_RATE_INCREASE].map((w) => w.severity);
      const maxSev = this._maxSeverity(severities);

      interventions.push({
        priority: maxSev === SEVERITY.URGENT ? 1 : maxSev === SEVERITY.WARNING ? 2 : 3,
        indicator: WARNING_INDICATOR.ERROR_RATE_INCREASE,
        action: "activateCircuitBreaker",
        message: `Error rate increasing — consider enabling circuit breaker or reducing operation scope`,
        severity: maxSev,
        details: {
          growthRate: trends.errorRate.growthRate,
          currentRate: trends.errorRate.currentRate,
          baselineRate: trends.errorRate.baselineRate,
        },
      });
    }

    // Latency growth intervention
    if (byIndicator[WARNING_INDICATOR.LATENCY_GROWTH]) {
      const severities = byIndicator[WARNING_INDICATOR.LATENCY_GROWTH].map((w) => w.severity);
      const maxSev = this._maxSeverity(severities);

      interventions.push({
        priority: maxSev === SEVERITY.URGENT ? 1 : 3,
        indicator: WARNING_INDICATOR.LATENCY_GROWTH,
        action: "optimizeOrDefer",
        message: `Operation latency growing — consider deferring non-critical work or optimizing tool calls`,
        severity: maxSev,
        details: {
          growthRate: trends.latency.growthRate,
          currentAvgMs: trends.latency.currentAvgMs,
          baselineAvgMs: trends.latency.baselineAvgMs,
        },
      });
    }

    // Tool failure pattern intervention
    if (byIndicator[WARNING_INDICATOR.TOOL_FAILURE_PATTERN]) {
      const severities = byIndicator[WARNING_INDICATOR.TOOL_FAILURE_PATTERN].map((w) => w.severity);
      const maxSev = this._maxSeverity(severities);
      const failedTools = byIndicator[WARNING_INDICATOR.TOOL_FAILURE_PATTERN]
        .map((w) => w.details?.toolName)
        .filter(Boolean);

      interventions.push({
        priority: maxSev === SEVERITY.URGENT ? 1 : 2,
        indicator: WARNING_INDICATOR.TOOL_FAILURE_PATTERN,
        action: "pauseAndInvestigate",
        message: `Tool failure pattern detected for: ${[...new Set(failedTools)].join(", ") || "unknown"} — pause and investigate`,
        severity: maxSev,
        details: {
          failedTools: [...new Set(failedTools)],
          streakThreshold: this._toolFailureStreakThreshold,
        },
      });
    }

    // Conversation loop intervention
    if (byIndicator[WARNING_INDICATOR.CONVERSATION_LOOP]) {
      const severities = byIndicator[WARNING_INDICATOR.CONVERSATION_LOOP].map((w) => w.severity);
      const maxSev = this._maxSeverity(severities);

      interventions.push({
        priority: maxSev === SEVERITY.URGENT ? 1 : 2,
        indicator: WARNING_INDICATOR.CONVERSATION_LOOP,
        action: "breakLoop",
        message: `Conversation loop detected — inject clarification prompt or adjust instructions`,
        severity: maxSev,
        details: {
          patternLength: trends.conversationLoop.patternLength,
          repeatCount: trends.conversationLoop.repeatCount,
        },
      });
    }

    // Sort by priority (lowest number = highest priority)
    interventions.sort((a, b) => a.priority - b.priority);

    return interventions;
  }

  /**
   * Acknowledge a warning by its ID.
   *
   * @param {string} warningId
   * @returns {boolean} true if acknowledged
   */
  acknowledge(warningId) {
    const warning = this._warnings.find((w) => w.id === warningId);
    if (!warning) return false;
    warning.acknowledged = true;
    this.emit("warning-acknowledged", { id: warningId });
    return true;
  }

  /**
   * Clear all warnings and reset trend data.
   */
  reset() {
    this._warnings = [];
    this._trends = {
      tokenUsage: [],
      errorCounts: [],
      latencies: [],
      toolFailures: [],
      messagePatterns: [],
    };
    this._baselines = {
      avgTokenUsage: 0,
      avgErrorRate: 0,
      avgLatencyMs: 0,
      established: false,
    };
    this._sessionId = null;
    this._lastMonitorTs = null;

    debug("early-warning", "system reset");
  }

  // ---------------------------------------------------------------------------
  // Detectors
  // ---------------------------------------------------------------------------

  /**
   * Detect token acceleration: compare recent token usage to baseline.
   */
  _detectTokenAcceleration(entries) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!isAssistantMsg(e) || !e.usage) continue;

      const input = parseUsageToken(e.usage, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
      const output = parseUsageToken(e.usage, "output_tokens", "outputTokens", "completion_tokens", "completionTokens");
      if (input === 0 && output === 0) continue;

      this._trends.tokenUsage.push({
        ts: nowMs(),
        totalTokens: input + output,
        inputTokens: input,
        outputTokens: output,
      });
    }

    // Keep window bounded
    while (this._trends.tokenUsage.length > TREND_WINDOW_SIZE * 2) {
      this._trends.tokenUsage.shift();
    }

    // Need baseline and enough recent data
    if (!this._baselines.established) return;
    if (this._trends.tokenUsage.length < this._baselineMinSamples) return;

    const recentSlice = this._trends.tokenUsage.slice(-this._baselineMinSamples);
    const recentAvg = mean(recentSlice.map((t) => t.totalTokens));
    const baseline = this._baselines.avgTokenUsage;

    if (baseline <= 0) return;

    const ratio = recentAvg / baseline;

    if (ratio >= this._tokenAccelerationThreshold * 2) {
      this._addWarning(WARNING_INDICATOR.TOKEN_ACCELERATION, SEVERITY.URGENT,
        `Token usage surge: ${roundTo(ratio, 2)}x baseline (recent=${roundTo(recentAvg, 0)}, baseline=${roundTo(baseline, 0)})`,
        { ratio: roundTo(ratio, 2), recentAvg: roundTo(recentAvg, 0), baselineAvg: roundTo(baseline, 0) }
      );
    } else if (ratio >= this._tokenAccelerationThreshold * 1.5) {
      this._addWarning(WARNING_INDICATOR.TOKEN_ACCELERATION, SEVERITY.WARNING,
        `Token usage growing rapidly: ${roundTo(ratio, 2)}x baseline`,
        { ratio: roundTo(ratio, 2), recentAvg: roundTo(recentAvg, 0), baselineAvg: roundTo(baseline, 0) }
      );
    } else if (ratio >= this._tokenAccelerationThreshold) {
      this._addWarning(WARNING_INDICATOR.TOKEN_ACCELERATION, SEVERITY.ADVISORY,
        `Token usage increasing: ${roundTo(ratio, 2)}x baseline`,
        { ratio: roundTo(ratio, 2), recentAvg: roundTo(recentAvg, 0), baselineAvg: roundTo(baseline, 0) }
      );
    }
  }

  /**
   * Detect error rate increase: compare recent error frequency to baseline.
   */
  _detectErrorRateIncrease(entries) {
    const recentErrors = [];
    for (const e of entries) {
      if (isErrorTool(e)) {
        recentErrors.push({ ts: nowMs(), toolName: e.name || "(unnamed)" });
      }
    }

    // Record errors in trends
    if (recentErrors.length > 0) {
      this._trends.errorCounts.push({
        ts: nowMs(),
        count: recentErrors.length,
      });
    }

    while (this._trends.errorCounts.length > TREND_WINDOW_SIZE * 2) {
      this._trends.errorCounts.shift();
    }

    if (!this._baselines.established) return;

    // Detect errors appearing from a clean baseline — fire immediately
    // even with fewer than baselineMinSamples data points.
    const recentSlice = this._trends.errorCounts.slice(-this._baselineMinSamples);
    const recentRate = mean(recentSlice.map((e) => e.count));
    const baseline = this._baselines.avgErrorRate;

    if (baseline <= 0 && recentRate > 0) {
      this._addWarning(WARNING_INDICATOR.ERROR_RATE_INCREASE, SEVERITY.WATCH,
        `Errors appearing where baseline was clean: ${recentRate} per cycle`,
        { recentRate: roundTo(recentRate, 2), baselineRate: baseline }
      );
      return;
    }

    if (baseline <= 0) return;

    // For ratio-based comparisons we need enough historical data
    if (this._trends.errorCounts.length < this._baselineMinSamples) return;

    const ratio = recentRate / baseline;

    if (ratio >= this._errorRateIncreaseThreshold * 2) {
      this._addWarning(WARNING_INDICATOR.ERROR_RATE_INCREASE, SEVERITY.URGENT,
        `Error rate critical: ${roundTo(ratio, 2)}x baseline (recent=${roundTo(recentRate, 2)}, baseline=${roundTo(baseline, 2)})`,
        { ratio: roundTo(ratio, 2), recentRate: roundTo(recentRate, 2), baselineRate: roundTo(baseline, 2) }
      );
    } else if (ratio >= this._errorRateIncreaseThreshold) {
      this._addWarning(WARNING_INDICATOR.ERROR_RATE_INCREASE, SEVERITY.WARNING,
        `Error rate increasing: ${roundTo(ratio, 2)}x baseline`,
        { ratio: roundTo(ratio, 2), recentRate: roundTo(recentRate, 2), baselineRate: roundTo(baseline, 2) }
      );
    } else if (ratio >= 1.5) {
      this._addWarning(WARNING_INDICATOR.ERROR_RATE_INCREASE, SEVERITY.ADVISORY,
        `Error rate trending up: ${roundTo(ratio, 2)}x baseline`,
        { ratio: roundTo(ratio, 2), recentRate: roundTo(recentRate, 2), baselineRate: roundTo(baseline, 2) }
      );
    }
  }

  /**
   * Detect latency growth: tool call durations increasing over time.
   */
  _detectLatencyGrowth(entries) {
    for (const e of entries) {
      if (!isToolMsg(e) || !e.durationMs) continue;
      this._trends.latencies.push({
        ts: nowMs(),
        ms: e.durationMs,
        toolName: e.name || "(unnamed)",
      });
    }

    while (this._trends.latencies.length > TREND_WINDOW_SIZE * 2) {
      this._trends.latencies.shift();
    }

    if (!this._baselines.established) return;
    if (this._trends.latencies.length < this._baselineMinSamples) return;

    const recentSlice = this._trends.latencies.slice(-this._baselineMinSamples);
    const recentAvg = mean(recentSlice.map((l) => l.ms));
    const baseline = this._baselines.avgLatencyMs;

    if (baseline <= 0) return;

    const ratio = recentAvg / baseline;

    if (ratio >= this._latencyGrowthThreshold * 2) {
      this._addWarning(WARNING_INDICATOR.LATENCY_GROWTH, SEVERITY.URGENT,
        `Latency spike: ${roundTo(ratio, 2)}x baseline (${roundTo(recentAvg, 0)}ms vs ${roundTo(baseline, 0)}ms)`,
        { ratio: roundTo(ratio, 2), recentAvgMs: roundTo(recentAvg, 0), baselineAvgMs: roundTo(baseline, 0) }
      );
    } else if (ratio >= this._latencyGrowthThreshold) {
      this._addWarning(WARNING_INDICATOR.LATENCY_GROWTH, SEVERITY.WARNING,
        `Latency increasing: ${roundTo(ratio, 2)}x baseline (${roundTo(recentAvg, 0)}ms vs ${roundTo(baseline, 0)}ms)`,
        { ratio: roundTo(ratio, 2), recentAvgMs: roundTo(recentAvg, 0), baselineAvgMs: roundTo(baseline, 0) }
      );
    } else if (ratio >= 1.15) {
      this._addWarning(WARNING_INDICATOR.LATENCY_GROWTH, SEVERITY.ADVISORY,
        `Latency trending up: ${roundTo(ratio, 2)}x baseline`,
        { ratio: roundTo(ratio, 2), recentAvgMs: roundTo(recentAvg, 0), baselineAvgMs: roundTo(baseline, 0) }
      );
    }
  }

  /**
   * Detect tool failure patterns: repeated failures on specific tools.
   */
  _detectToolFailurePatterns(entries) {
    const failingTools = new Map();

    for (const e of entries) {
      if (!isErrorTool(e)) continue;
      const name = e.name || "(unnamed)";
      if (!failingTools.has(name)) {
        failingTools.set(name, 0);
        // Find streak
        let streak = 1;
        for (let j = entries.indexOf(e) + 1; j < entries.length; j++) {
          if (isErrorTool(entries[j]) && (entries[j].name || "(unnamed)") === name) {
            streak += 1;
          } else {
            break;
          }
        }
        failingTools.set(name, streak);
      }

      this._trends.toolFailures.push({
        ts: nowMs(),
        toolName: name,
        isError: true,
      });
    }

    while (this._trends.toolFailures.length > TREND_WINDOW_SIZE * 2) {
      this._trends.toolFailures.shift();
    }

    for (const [toolName, streak] of failingTools) {
      if (streak >= this._toolFailureStreakThreshold) {
        const severity = streak >= this._toolFailureStreakThreshold * 2
          ? SEVERITY.URGENT
          : streak >= this._toolFailureStreakThreshold + 1
            ? SEVERITY.WARNING
            : SEVERITY.ADVISORY;

        this._addWarning(WARNING_INDICATOR.TOOL_FAILURE_PATTERN, severity,
          `Tool "${toolName}" failing consecutively (${streak} failures in a row)`,
          { toolName, streak, threshold: this._toolFailureStreakThreshold }
        );
      }
    }
  }

  /**
   * Detect conversation loops: agent repeating the same message patterns.
   */
  _detectConversationLoops(entries) {
    for (const e of entries) {
      if (!isAssistantMsg(e)) continue;
      const content = typeof e.content === "string" ? e.content : "";
      if (content.length < 10) continue;

      // Hash content for pattern matching (simple hash)
      const contentHash = this._simpleHash(content);
      this._trends.messagePatterns.push({
        ts: nowMs(),
        contentHash,
      });
    }

    while (this._trends.messagePatterns.length > TREND_WINDOW_SIZE * 2) {
      this._trends.messagePatterns.shift();
    }

    // Look for repeated patterns (same hash appearing multiple times)
    const recentPatterns = this._trends.messagePatterns.slice(-this._loopDetectionWindow);
    if (recentPatterns.length < this._loopDetectionWindow) return;

    const hashCounts = new Map();
    for (const p of recentPatterns) {
      hashCounts.set(p.contentHash, (hashCounts.get(p.contentHash) || 0) + 1);
    }

    let maxRepeat = 0;
    for (const count of hashCounts.values()) {
      if (count > maxRepeat) maxRepeat = count;
    }

    if (maxRepeat >= 3) {
      const severity = maxRepeat >= 5 ? SEVERITY.URGENT
        : maxRepeat >= 4 ? SEVERITY.WARNING
          : SEVERITY.ADVISORY;

      this._addWarning(WARNING_INDICATOR.CONVERSATION_LOOP, severity,
        `Potential conversation loop: same pattern repeated ${maxRepeat} times in recent exchanges`,
        { repeatCount: maxRepeat, windowSize: this._loopDetectionWindow }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Trend computation
  // ---------------------------------------------------------------------------

  _computeTokenTrend() {
    if (this._trends.tokenUsage.length < this._baselineMinSamples) {
      return {
        direction: "stable",
        growthRate: 0,
        currentAvg: 0,
        baselineAvg: this._baselines.avgTokenUsage,
      };
    }

    const recent = this._trends.tokenUsage.slice(-this._baselineMinSamples);
    const currentAvg = mean(recent.map((t) => t.totalTokens));
    const baseline = this._baselines.avgTokenUsage;

    let growthRate = 0;
    let direction = "stable";
    if (baseline > 0) {
      growthRate = currentAvg / baseline;
      direction = growthRate > 1.1 ? "rising" : growthRate < 0.9 ? "falling" : "stable";
    }

    return { direction, growthRate: roundTo(growthRate, 2), currentAvg: roundTo(currentAvg, 0), baselineAvg: roundTo(baseline, 0) };
  }

  _computeErrorTrend() {
    if (this._trends.errorCounts.length < this._baselineMinSamples) {
      return {
        direction: "stable",
        growthRate: 0,
        currentRate: 0,
        baselineRate: this._baselines.avgErrorRate,
      };
    }

    const recent = this._trends.errorCounts.slice(-this._baselineMinSamples);
    const currentRate = mean(recent.map((e) => e.count));
    const baseline = this._baselines.avgErrorRate;

    let growthRate = 0;
    let direction = "stable";
    if (baseline > 0) {
      growthRate = currentRate / baseline;
      direction = growthRate > 1.1 ? "rising" : growthRate < 0.9 ? "falling" : "stable";
    } else if (currentRate > 0) {
      direction = "rising";
      growthRate = currentRate;
    }

    return { direction, growthRate: roundTo(growthRate, 2), currentRate: roundTo(currentRate, 2), baselineRate: roundTo(baseline, 2) };
  }

  _computeLatencyTrend() {
    if (this._trends.latencies.length < this._baselineMinSamples) {
      return {
        direction: "stable",
        growthRate: 0,
        currentAvgMs: 0,
        baselineAvgMs: this._baselines.avgLatencyMs,
      };
    }

    const recent = this._trends.latencies.slice(-this._baselineMinSamples);
    const currentAvgMs = mean(recent.map((l) => l.ms));
    const baseline = this._baselines.avgLatencyMs;

    let growthRate = 0;
    let direction = "stable";
    if (baseline > 0) {
      growthRate = currentAvgMs / baseline;
      direction = growthRate > 1.1 ? "rising" : growthRate < 0.9 ? "falling" : "stable";
    }

    return { direction, growthRate: roundTo(growthRate, 2), currentAvgMs: roundTo(currentAvgMs, 0), baselineAvgMs: roundTo(baseline, 0) };
  }

  _computeLoopTrend() {
    const recentPatterns = this._trends.messagePatterns.slice(-this._loopDetectionWindow);
    const hashCounts = new Map();
    for (const p of recentPatterns) {
      hashCounts.set(p.contentHash, (hashCounts.get(p.contentHash) || 0) + 1);
    }
    let maxRepeat = 0;
    for (const count of hashCounts.values()) {
      if (count > maxRepeat) maxRepeat = count;
    }

    return {
      detected: maxRepeat >= 3,
      patternLength: recentPatterns.length,
      repeatCount: maxRepeat,
    };
  }

  // ---------------------------------------------------------------------------
  // Baseline management
  // ---------------------------------------------------------------------------

  _updateBaselines() {
    if (this._baselines.established) return;

    // Token baseline: need enough token samples
    if (this._trends.tokenUsage.length >= this._baselineMinSamples && this._baselines.avgTokenUsage === 0) {
      const samples = this._trends.tokenUsage.slice(0, this._baselineMinSamples);
      this._baselines.avgTokenUsage = mean(samples.map((t) => t.totalTokens));
    }

    // Error rate baseline
    if (this._trends.errorCounts.length >= this._baselineMinSamples && this._baselines.avgErrorRate === 0) {
      const samples = this._trends.errorCounts.slice(0, this._baselineMinSamples);
      this._baselines.avgErrorRate = mean(samples.map((e) => e.count));
    }

    // Latency baseline
    if (this._trends.latencies.length >= this._baselineMinSamples && this._baselines.avgLatencyMs === 0) {
      const samples = this._trends.latencies.slice(0, this._baselineMinSamples);
      this._baselines.avgLatencyMs = mean(samples.map((l) => l.ms));
    }

    // Established if at least one baseline is set (tokenUsage is primary)
    if (this._baselines.avgTokenUsage > 0) {
      this._baselines.established = true;
      debug("early-warning", `baselines established: tokens=${roundTo(this._baselines.avgTokenUsage, 0)}, errors=${roundTo(this._baselines.avgErrorRate, 2)}, latency=${roundTo(this._baselines.avgLatencyMs, 0)}ms`);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Add a warning, deduplicating against recent similar warnings.
   */
  _addWarning(indicator, severity, message, details) {
    // Deduplicate: if we already have an unacknowledged warning
    // of the same indicator within the last 30 seconds, escalate if needed
    const now = nowMs();
    const existing = this._warnings.find(
      (w) => w.indicator === indicator && !w.acknowledged && (now - w.timestamp) < 30000
    );

    if (existing) {
      const currentIdx = this._severityOrder(severity);
      const existingIdx = this._severityOrder(existing.severity);
      if (currentIdx > existingIdx) {
        existing.severity = severity;
        existing.escalated = true;
        existing.message = message;
        existing.details = details;
        this.emit("warning-escalated", { id: existing.id, from: existing.severity, to: severity });
      }
      return;
    }

    const warning = makeWarning(indicator, severity, message, details);
    this._warnings.push(warning);

    // Keep warnings list bounded
    while (this._warnings.length > 100) {
      this._warnings.shift();
    }

    this.emit("warning", warning);
    debug("early-warning", `[${severity}] ${indicator}: ${message}`);
  }

  _severityOrder(severity) {
    const order = { WATCH: 0, ADVISORY: 1, WARNING: 2, URGENT: 3 };
    return order[severity] !== undefined ? order[severity] : 0;
  }

  _maxSeverity(severities) {
    let maxIdx = -1;
    let maxSev = SEVERITY.WATCH;
    for (const s of severities) {
      const idx = this._severityOrder(s);
      if (idx > maxIdx) {
        maxIdx = idx;
        maxSev = s;
      }
    }
    return maxSev;
  }

  /**
   * Simple string hash for content pattern matching.
   */
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32-bit integer
    }
    return hash;
  }
}

module.exports = {
  EarlyWarningSystem,
  SEVERITY,
  WARNING_INDICATOR,
  TOKEN_ACCELERATION_THRESHOLD,
  ERROR_RATE_INCREASE_THRESHOLD,
  LATENCY_GROWTH_THRESHOLD,
  TOOL_FAILURE_STREAK_THRESHOLD,
  LOOP_DETECTION_WINDOW,
  TREND_WINDOW_SIZE,
  BASELINE_MIN_SAMPLES,
};
