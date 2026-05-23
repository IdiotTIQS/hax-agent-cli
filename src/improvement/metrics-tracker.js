"use strict";

/**
 * MetricsTracker — tracks session metrics over time, monitors trends,
 * manages goals, and produces holistic quality scorecards.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUserMsg(entry) {
  return entry && entry.role === "user";
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

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function safeAvg(list, decimals = 1) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const sum = list.reduce((a, b) => a + b, 0);
  const avg = sum / list.length;
  return decimals >= 0 ? roundTo(avg, decimals) : avg;
}

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

function parseUsageNumber(usage, ...keys) {
  if (!usage) return 0;
  for (const key of keys) {
    if (Number.isFinite(usage[key])) return usage[key];
  }
  return 0;
}

// Satisfaction proxy indicators in assistant messages
const POSITIVE_SIGNALS = /\b(great|perfect|awesome|excellent|thank|thanks|works|working|good|love it|exactly)\b/i;
const NEGATIVE_SIGNALS = /\b(not working|doesn'?t work|still broken|wrong|incorrect|not what|failed|error|issue|problem|bad)\b/i;

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

const TREND_DIRECTIONS = {
  IMPROVING: "improving",
  DECLINING: "declining",
  STABLE: "stable",
  INSUFFICIENT_DATA: "insufficient_data",
};

function computeTrend(dataPoints) {
  if (!Array.isArray(dataPoints) || dataPoints.length < 2) {
    return { direction: TREND_DIRECTIONS.INSUFFICIENT_DATA, slope: 0, confidence: 0 };
  }

  // Simple linear regression on index -> value
  const n = dataPoints.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = dataPoints[i];
    if (!Number.isFinite(y)) continue;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { direction: TREND_DIRECTIONS.STABLE, slope: 0, confidence: 0.5 };

  const slope = (n * sumXY - sumX * sumY) / denominator;

  // Determine direction and confidence
  const absSlope = Math.abs(slope);
  let direction = TREND_DIRECTIONS.STABLE;
  const meanVal = sumY / n;
  const normalizedSlope = meanVal !== 0 ? absSlope / Math.abs(meanVal) : absSlope;

  if (normalizedSlope < 0.02) {
    direction = TREND_DIRECTIONS.STABLE;
  } else if (slope > 0) {
    direction = TREND_DIRECTIONS.IMPROVING;
  } else {
    direction = TREND_DIRECTIONS.DECLINING;
  }

  // Confidence based on data variance
  const mean = sumY / n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(dataPoints[i])) continue;
    variance += (dataPoints[i] - mean) ** 2;
  }
  variance /= n;
  const cv = Math.sqrt(variance) / (Math.abs(mean) || 1);
  const confidence = Math.min(1, Math.max(0.3, 1 - cv));

  return { direction, slope: roundTo(slope, 4), confidence: roundTo(confidence, 3) };
}

function computeMovingAverage(dataPoints, windowSize = 3) {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return [];
  const result = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = dataPoints.slice(start, i + 1);
    result.push(safeAvg(window));
  }
  return result;
}

// ---------------------------------------------------------------------------
// MetricsTracker class
// ---------------------------------------------------------------------------

class MetricsTracker {
  /**
   * @param {object} [options]
   * @param {object} [options.goals] — initial goals
   */
  constructor(options = {}) {
    this._sessions = [];   // array of { sessionId, timestamp, metrics }
    this._goals = Array.isArray(options.goals) ? [...options.goals] : [];
    this._defaultWindowSize = options.windowSize || 5;
  }

  /**
   * Records a session's metrics for trend tracking.
   *
   * @param {object} session
   * @param {string} session.id
   * @param {object[]} [session.entries] — transcript entries
   * @returns {object} the metrics recorded for this session
   */
  trackSession(session) {
    const entries = Array.isArray(session.entries)
      ? session.entries
      : typeof session.entries === "function"
        ? session.entries()
        : [];

    const filtered = entries.filter((e) => !e || e.type !== "session.meta");

    const metrics = this._computeMetrics(filtered);
    const record = {
      sessionId: session.id || "unknown",
      timestamp: new Date().toISOString(),
      metrics,
    };

    this._sessions.push(record);

    // Keep last 1000 sessions
    if (this._sessions.length > 1000) {
      this._sessions = this._sessions.slice(-1000);
    }

    return metrics;
  }

  /**
   * Tracks a specific metric over time and determines its trend.
   *
   * @param {string} metric — metric key (e.g., "toolSuccessRate", "avgResponseTime")
   * @param {object} [options]
   * @param {number} [options.window] — how many recent sessions to analyze
   * @param {boolean} [options.smooth] — apply moving average smoothing
   * @returns {object} trend analysis
   */
  getTrends(metric, options = {}) {
    const window = options.window || this._defaultWindowSize;
    const sessions = this._getRecentSessions(window);

    const dataPoints = sessions
      .map((s) => {
        const val = s.metrics[metric];
        return Number.isFinite(val) ? val : null;
      })
      .filter((v) => v !== null);

    const trend = computeTrend(dataPoints);
    const smoothed = options.smooth ? computeMovingAverage(dataPoints, 3) : null;

    return {
      metric,
      sessionsAnalyzed: sessions.length,
      dataPoints: dataPoints.length,
      currentValue: dataPoints.length > 0 ? dataPoints[dataPoints.length - 1] : null,
      previousValue: dataPoints.length > 1 ? dataPoints[dataPoints.length - 2] : null,
      trend,
      dataPointsRaw: dataPoints,
      movingAverage: smoothed,
      allTimeHigh: dataPoints.length > 0 ? Math.max(...dataPoints) : null,
      allTimeLow: dataPoints.length > 0 ? Math.min(...dataPoints) : null,
      allTimeAvg: safeAvg(dataPoints, 3),
    };
  }

  /**
   * Sets improvement goals to track against.
   *
   * @param {object[]} goals — array of goal objects
   * @param {string}   goals[].metric — metric name
   * @param {number}   goals[].target — target value
   * @param {string}   goals[].direction — "up" or "down"
   * @param {string}   [goals[].timeframe] — e.g., "30d", "100sessions"
   * @returns {number} number of goals set
   */
  setGoals(goals) {
    if (!Array.isArray(goals)) {
      return 0;
    }

    const valid = goals.filter(
      (g) =>
        g &&
        typeof g.metric === "string" &&
        Number.isFinite(g.target) &&
        (g.direction === "up" || g.direction === "down")
    );

    this._goals = valid;
    return valid.length;
  }

  /**
   * Checks progress against all defined goals.
   *
   * @returns {object} goal progress report
   */
  checkGoals() {
    if (this._goals.length === 0) {
      return { goals: [], summary: "no goals set" };
    }

    const results = this._goals.map((goal) => {
      const trends = this.getTrends(goal.metric);
      const current = trends.currentValue;
      const target = goal.target;

      let status = "not_started";
      let progress = 0;
      let remaining = null;

      if (current !== null) {
        if (goal.direction === "up") {
          progress = target > 0 ? Math.min(1, roundTo(current / target, 3)) : 1;
          remaining = Math.max(0, target - current);
          status = current >= target ? "achieved" : "in_progress";
        } else {
          // direction === "down"
          if (target === 0) {
            progress = current === 0 ? 1 : 0;
            remaining = current;
            status = current === 0 ? "achieved" : "in_progress";
          } else {
            progress = Math.min(1, roundTo(target / Math.max(current, 0.001), 3));
            remaining = Math.max(0, current - target);
            status = current <= target ? "achieved" : "in_progress";
          }
        }
      }

      // Consider trend for at_risk status
      if (status === "in_progress" && trends.trend.direction === "declining" &&
          (goal.direction === "up")) {
        status = "at_risk";
      }
      if (status === "in_progress" && trends.trend.direction === "improving" &&
          (goal.direction === "down")) {
        status = "at_risk";
      }

      return {
        metric: goal.metric,
        target,
        direction: goal.direction,
        timeframe: goal.timeframe || null,
        currentValue: current,
        progress: roundTo(progress * 100, 1),
        remaining,
        status,
        trend: trends.trend,
      };
    });

    const achieved = results.filter((r) => r.status === "achieved").length;
    const inProgress = results.filter((r) => r.status === "in_progress").length;
    const atRisk = results.filter((r) => r.status === "at_risk").length;

    return {
      goals: results,
      summary: `${achieved} achieved, ${inProgress} in progress, ${atRisk} at risk out of ${results.length} goals`,
      overallProgress: results.length > 0
        ? roundTo(results.reduce((a, r) => a + r.progress, 0) / results.length, 1)
        : 0,
    };
  }

  /**
   * Produces a holistic quality scorecard across all tracked metrics.
   *
   * @returns {object} scorecard
   */
  getScorecard() {
    const sessions = this._getRecentSessions(50); // last 50 sessions

    if (sessions.length === 0) {
      return {
        sessions: 0,
        scores: {},
        overall: 0,
        grade: "N/A",
        summary: "insufficient data",
      };
    }

    // Compute aggregate metrics
    const toolSuccessRates = sessions
      .map((s) => s.metrics.toolSuccessRate)
      .filter((v) => Number.isFinite(v));
    const avgResponseTimes = sessions
      .map((s) => s.metrics.avgResponseTimeMs)
      .filter((v) => Number.isFinite(v));
    const tokenEfficiencies = sessions
      .map((s) => s.metrics.tokenEfficiency)
      .filter((v) => Number.isFinite(v));
    const satisfactionIndicators = sessions
      .map((s) => s.metrics.userSatisfactionIndicator)
      .filter((v) => Number.isFinite(v));
    const errorRates = sessions
      .map((s) => s.metrics.errorRate)
      .filter((v) => Number.isFinite(v));

    const avgToolSuccess = safeAvg(toolSuccessRates, 3);
    const avgResponseTime = safeAvg(avgResponseTimes, 0);
    const avgTokenEfficiency = safeAvg(tokenEfficiencies, 3);
    const avgSatisfaction = safeAvg(satisfactionIndicators, 3);
    const avgErrorRate = safeAvg(errorRates, 3);

    // Score each dimension (0-100)
    const scores = {
      toolReliability: this._scoreToolReliability(avgToolSuccess),
      responseSpeed: this._scoreResponseSpeed(avgResponseTime),
      tokenEfficiency: this._scoreTokenEfficiency(avgTokenEfficiency),
      userSatisfaction: this._scoreSatisfaction(avgSatisfaction),
      errorManagement: this._scoreErrorManagement(avgErrorRate),
    };

    // Overall score (weighted average)
    const weights = {
      toolReliability: 0.30,
      responseSpeed: 0.15,
      tokenEfficiency: 0.15,
      userSatisfaction: 0.25,
      errorManagement: 0.15,
    };

    let overall = 0;
    let totalWeight = 0;
    for (const [dim, weight] of Object.entries(weights)) {
      if (scores[dim] !== null) {
        overall += scores[dim] * weight;
        totalWeight += weight;
      }
    }
    overall = totalWeight > 0 ? roundTo(overall / totalWeight, 1) : 0;

    // Trends per dimension
    const trends = {
      toolReliability: computeTrend(toolSuccessRates),
      responseSpeed: computeTrend(avgResponseTimes.map((t) => -t)), // invert: lower is better
      tokenEfficiency: computeTrend(tokenEfficiencies),
      userSatisfaction: computeTrend(satisfactionIndicators),
      errorManagement: computeTrend(errorRates.map((r) => -r)), // invert: lower is better
    };

    // Grade
    const grade = this._computeGrade(overall);

    return {
      sessions: sessions.length,
      scores,
      overall,
      grade,
      trends,
      dimensions: {
        toolReliability: {
          value: avgToolSuccess,
          interpretation: avgToolSuccess >= 0.9 ? "excellent" : avgToolSuccess >= 0.7 ? "good" : "needs work",
        },
        responseSpeed: {
          value: `${avgResponseTime}ms`,
          interpretation: avgResponseTime < 2000 ? "fast" : avgResponseTime < 5000 ? "acceptable" : "slow",
        },
        tokenEfficiency: {
          value: avgTokenEfficiency,
          interpretation: avgTokenEfficiency >= 0.7 ? "efficient" : avgTokenEfficiency >= 0.4 ? "moderate" : "wasteful",
        },
        userSatisfaction: {
          value: avgSatisfaction,
          interpretation: avgSatisfaction >= 0.7 ? "positive" : avgSatisfaction >= 0.4 ? "neutral" : "negative",
        },
        errorManagement: {
          value: avgErrorRate,
          interpretation: avgErrorRate < 0.05 ? "excellent" : avgErrorRate < 0.15 ? "good" : "needs work",
        },
      },
      rawMetrics: {
        avgToolSuccessRate: avgToolSuccess,
        avgResponseTimeMs: avgResponseTime,
        avgTokenEfficiency: avgTokenEfficiency,
        avgUserSatisfaction: avgSatisfaction,
        avgErrorRate,
      },
    };
  }

  /**
   * Returns the list of available metric names.
   *
   * @returns {string[]} metric names
   */
  getMetricNames() {
    return [
      "toolSuccessRate",
      "avgResponseTimeMs",
      "tokenEfficiency",
      "userSatisfactionIndicator",
      "errorRate",
      "toolCallsPerTurn",
      "tokensPerTurn",
      "userMessageLength",
      "assistantMessageLength",
    ];
  }

  // ---------------------------------------------------------------------------
  // Private: metric computation
  // ---------------------------------------------------------------------------

  _computeMetrics(entries) {
    const toolMsgs = entries.filter((e) => isToolMsg(e));
    const toolErrors = toolMsgs.filter((e) => isErrorTool(e));
    const toolCalls = toolMsgs.length;
    const userMsgs = entries.filter((e) => isUserMsg(e));
    const asstMsgs = entries.filter((e) => isAssistantMsg(e));
    const turns = userMsgs.length;

    // Tool success rate
    const toolSuccessRate = toolCalls > 0
      ? roundTo((toolCalls - toolErrors.length) / toolCalls, 3)
      : 1;

    // Average response time (user -> next assistant)
    const responseTimes = [];
    for (let i = 0; i < entries.length; i++) {
      if (!isUserMsg(entries[i])) continue;
      const userTs = parseTs(entries[i]);
      if (!userTs) continue;
      for (let j = i + 1; j < entries.length; j++) {
        if (isAssistantMsg(entries[j])) {
          const asstTs = parseTs(entries[j]);
          if (asstTs) responseTimes.push(asstTs - userTs);
          break;
        }
      }
    }
    const avgResponseTimeMs = responseTimes.length > 0 ? roundTo(safeAvg(responseTimes), 0) : 0;

    // Token efficiency (output tokens per input token)
    let totalInput = 0;
    let totalOutput = 0;
    for (const e of entries) {
      if (!e.usage) continue;
      totalInput += parseUsageNumber(
        e.usage, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"
      );
      totalOutput += parseUsageNumber(
        e.usage, "output_tokens", "outputTokens", "completion_tokens", "completionTokens"
      );
    }
    const tokenEfficiency = totalInput > 0
      ? roundTo(totalOutput / totalInput, 3)
      : 0;

    // User satisfaction indicator (proxy based on language signals)
    let satisfactionSignal = 0;
    let signalCount = 0;
    for (const msg of userMsgs) {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (POSITIVE_SIGNALS.test(content)) {
        satisfactionSignal += 1;
        signalCount += 1;
      }
      if (NEGATIVE_SIGNALS.test(content)) {
        satisfactionSignal -= 1;
        signalCount += 1;
      }
    }
    const userSatisfactionIndicator = signalCount > 0
      ? roundTo(Math.max(0, Math.min(1, (satisfactionSignal / signalCount + 1) / 2)), 3)
      : 0.5; // neutral default

    // Error rate
    const totalEntries = entries.length;
    const errorRate = totalEntries > 0
      ? roundTo(toolErrors.length / totalEntries, 3)
      : 0;

    // Tool calls per turn
    const toolCallsPerTurn = turns > 0 ? roundTo(toolCalls / turns, 1) : 0;

    // Tokens per turn
    const tokensPerTurn = turns > 0
      ? roundTo((totalInput + totalOutput) / turns, 0)
      : 0;

    // Average message lengths
    const userMsgLengths = userMsgs
      .map((m) => typeof m.content === "string" ? m.content.length : 0)
      .filter((l) => l > 0);
    const asstMsgLengths = asstMsgs
      .map((m) => typeof m.content === "string" ? m.content.length : 0)
      .filter((l) => l > 0);

    return {
      toolSuccessRate,
      avgResponseTimeMs: Number(avgResponseTimeMs),
      tokenEfficiency,
      userSatisfactionIndicator,
      errorRate,
      toolCallsPerTurn,
      tokensPerTurn,
      userMessageLength: safeAvg(userMsgLengths, 1),
      assistantMessageLength: safeAvg(asstMsgLengths, 1),
      toolErrorCount: toolErrors.length,
      userMessageCount: userMsgs.length,
      assistantMessageCount: asstMsgs.length,
      totalEntries,
      turns,
    };
  }

  _getRecentSessions(n) {
    const start = Math.max(0, this._sessions.length - n);
    return this._sessions.slice(start);
  }

  // ---------------------------------------------------------------------------
  // Private: scoring helpers
  // ---------------------------------------------------------------------------

  _scoreToolReliability(avgSuccessRate) {
    // 0-100 scale: 100% success = 100, 50% success = 0
    if (avgSuccessRate === 0) return 0;
    return roundTo(Math.max(0, Math.min(100, (avgSuccessRate - 0.5) * 200)), 1);
  }

  _scoreResponseSpeed(avgTimeMs) {
    // < 1000ms = 100, > 10000ms = 0
    if (avgTimeMs === 0) return 100;
    return roundTo(Math.max(0, Math.min(100, 100 - (avgTimeMs - 1000) / 90)), 1);
  }

  _scoreTokenEfficiency(efficiency) {
    // > 0.5 = 100, 0 = 0
    return roundTo(Math.max(0, Math.min(100, efficiency * 200)), 1);
  }

  _scoreSatisfaction(indicator) {
    // 0-1 scale to 0-100
    return roundTo(indicator * 100, 1);
  }

  _scoreErrorManagement(avgErrorRate) {
    // 0% error = 100, 50%+ error = 0
    return roundTo(Math.max(0, Math.min(100, 100 - avgErrorRate * 200)), 1);
  }

  _computeGrade(overall) {
    if (overall >= 90) return "A";
    if (overall >= 80) return "B";
    if (overall >= 70) return "C";
    if (overall >= 60) return "D";
    return "F";
  }
}

module.exports = { MetricsTracker, TREND_DIRECTIONS };
