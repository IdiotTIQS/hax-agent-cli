/**
 * ReliabilityTracker — Tracks agent execution reliability metrics including
 * mean time between failures, error rates, recovery rates, and consistency.
 *
 *   const tracker = new ReliabilityTracker();
 *   tracker.trackExecution("agent-1", { success: true, taskType: "code-review", durationMs: 500 });
 *   tracker.getReliability("agent-1");  // { mtbfMs: ..., errorRate: {...}, ... }
 *   tracker.predictSuccess("agent-1", { type: "code-review" });
 */
"use strict";

// ─── Helpers ────────────────────────────────────────────────────────────

function _now() {
  return Date.now();
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _safeAverage(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function _safeMedian(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── ReliabilityTracker ─────────────────────────────────────────────────

class ReliabilityTracker {
  constructor(options = {}) {
    /**
     * Map<agentId, { executions: Array<object>, failures: Array<object>,
     *   taskTypeStats: Map<string, { successes, failures, totalDurationMs }> }>
     * @type {Map<string, object>}
     */
    this._agents = new Map();

    this._windowSize = options.windowSize || 100; // max recent executions to keep
  }

  // ── Recording ──────────────────────────────────────────────────────────

  /**
   * Record a task execution for an agent.
   *
   * @param {string} agentId
   * @param {object} execution
   * @param {boolean} execution.success    - Whether the execution succeeded
   * @param {string}  [execution.taskType] - Category of task (e.g. "code-review")
   * @param {number}  [execution.durationMs] - Execution duration
   * @param {string}  [execution.errorType] - Error type if failed
   * @param {boolean} [execution.recovered] - Whether agent recovered from a prior failure
   */
  trackExecution(agentId, execution = {}) {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("agentId is required");
    }

    const agent = this._getOrCreateAgent(agentId);
    const record = {
      success: execution.success !== false,
      taskType: execution.taskType || "unknown",
      durationMs:
        typeof execution.durationMs === "number" && execution.durationMs >= 0
          ? execution.durationMs
          : 0,
      errorType: execution.errorType || null,
      recovered: execution.recovered === true,
      timestamp:
        typeof execution.timestamp === "number"
          ? execution.timestamp
          : _now(),
    };

    agent.executions.push(record);
    if (agent.executions.length > this._windowSize) {
      agent.executions = agent.executions.slice(-this._windowSize);
    }

    if (!record.success) {
      agent.failures.push(record);
      if (agent.failures.length > this._windowSize) {
        agent.failures = agent.failures.slice(-this._windowSize);
      }
      agent.lastFailureTimestamp = record.timestamp;
    }

    // Update per-task-type stats
    if (!agent.taskTypeStats.has(record.taskType)) {
      agent.taskTypeStats.set(record.taskType, {
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
      });
    }
    const typeStats = agent.taskTypeStats.get(record.taskType);
    if (record.success) {
      typeStats.successes += 1;
    } else {
      typeStats.failures += 1;
    }
    typeStats.totalDurationMs += record.durationMs;

    // Track recovery
    if (record.recovered) {
      agent.recoveryCount = (agent.recoveryCount || 0) + 1;
      agent.recoveryTimestamps = agent.recoveryTimestamps || [];
      agent.recoveryTimestamps.push(record.timestamp);
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────

  /**
   * Get comprehensive reliability metrics for an agent.
   *
   * @param {string} agentId
   * @returns {object} Reliability metrics
   */
  getReliability(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      return {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        mtbfMs: null,
        avgRecoveryRate: 0,
        consistencyScore: 0,
        errorRateByType: {},
        avgDurationMs: 0,
        medianDurationMs: 0,
      };
    }

    const total = agent.executions.length;
    const successCount = agent.executions.filter((e) => e.success).length;
    const failureCount = total - successCount;
    const successRate = total > 0 ? successCount / total : 0;

    const mtbfMs = this._computeMTBF(agent);
    const errorRateByType = this._computeErrorRateByType(agent);
    const avgRecoveryRate = this._computeRecoveryRate(agent);
    const consistencyScore = this._computeConsistencyScore(agent);

    const durations = agent.executions
      .map((e) => e.durationMs)
      .filter((d) => d > 0);

    return {
      totalExecutions: total,
      successCount,
      failureCount,
      successRate: Math.round(successRate * 100) / 100,
      mtbfMs,
      avgRecoveryRate,
      consistencyScore: Math.round(consistencyScore * 100) / 100,
      errorRateByType,
      avgDurationMs: Math.round(_safeAverage(durations)),
      medianDurationMs: Math.round(_safeMedian(durations)),
    };
  }

  /**
   * Predict the likelihood of success for a given agent and task.
   *
   * @param {string} agentId
   * @param {object} task - Task descriptor (typically { type, complexity })
   * @returns {object} { probability: 0-1, confidence: 0-1, factors: {...} }
   */
  predictSuccess(agentId, task = {}) {
    const agent = this._agents.get(agentId);
    if (!agent || agent.executions.length === 0) {
      return {
        probability: 0.5,
        confidence: 0,
        factors: {
          overallSuccessRate: null,
          taskTypeSuccessRate: null,
          recentTrend: null,
        },
      };
    }

    const overall = this.getReliability(agentId);
    const taskType = task.type || task.taskType || "unknown";

    // Match task type to agent's known types (fuzzy prefix matching)
    let taskTypeSuccessRate = null;
    const matchedType = this._matchTaskType(agent, taskType);
    if (matchedType) {
      const stats = agent.taskTypeStats.get(matchedType);
      const total = stats.successes + stats.failures;
      taskTypeSuccessRate = total > 0 ? stats.successes / total : null;
    }

    // Recent trend: success rate of last 10
    const recentExecs = agent.executions.slice(-10);
    const recentSuccess = recentExecs.filter((e) => e.success).length;
    const recentTrend =
      recentExecs.length > 0 ? recentSuccess / recentExecs.length : null;

    // Compute confidence based on data volume
    const dataPoints = agent.executions.length;
    const confidence = _clamp(dataPoints / 50, 0, 1); // 50+ data points = full confidence

    // Weighted probability
    const weights = [];
    const values = [];

    if (overall.successRate > 0 || overall.totalExecutions > 0) {
      weights.push(0.4);
      values.push(overall.successRate);
    }

    if (taskTypeSuccessRate !== null) {
      weights.push(0.35);
      values.push(taskTypeSuccessRate);
    }

    if (recentTrend !== null) {
      weights.push(0.25);
      values.push(recentTrend);
    }

    if (weights.length === 0) {
      return { probability: 0.5, confidence: 0, factors: { overallSuccessRate: null, taskTypeSuccessRate: null, recentTrend: null } };
    }

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
    const probability = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

    return {
      probability: Math.round(probability * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      factors: {
        overallSuccessRate: overall.successRate,
        taskTypeSuccessRate,
        recentTrend,
      },
    };
  }

  /**
   * Identify areas where the agent underperforms (high error rates per task type).
   *
   * @param {string} agentId
   * @returns {Array<{ taskType, errorRate, failures, total }>} Sorted by error rate descending
   */
  getWeaknesses(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return [];

    const weaknesses = [];

    for (const [taskType, stats] of agent.taskTypeStats) {
      const total = stats.successes + stats.failures;
      if (total === 0) continue;

      const errorRate = stats.failures / total;
      if (errorRate >= 0.2) {
        // 20%+ error rate is a weakness
        weaknesses.push({
          taskType,
          errorRate: Math.round(errorRate * 100) / 100,
          failures: stats.failures,
          total,
        });
      }
    }

    weaknesses.sort((a, b) => b.errorRate - a.errorRate);
    return weaknesses;
  }

  /**
   * Identify areas of excellence for an agent (low error rates with sufficient volume).
   *
   * @param {string} agentId
   * @returns {Array<{ taskType, successRate, avgDurationMs, total }>} Sorted by success rate
   */
  getStrengths(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return [];

    const strengths = [];

    for (const [taskType, stats] of agent.taskTypeStats) {
      const total = stats.successes + stats.failures;
      if (total < 3) continue; // need enough data

      const successRate = stats.successes / total;
      if (successRate >= 0.8) {
        strengths.push({
          taskType,
          successRate: Math.round(successRate * 100) / 100,
          avgDurationMs: Math.round(stats.totalDurationMs / total),
          total,
        });
      }
    }

    strengths.sort((a, b) => b.successRate - a.successRate);
    return strengths;
  }

  /**
   * Get all tracked agent IDs.
   *
   * @returns {string[]}
   */
  getAgentIds() {
    return Array.from(this._agents.keys());
  }

  /**
   * Get raw execution history for an agent.
   *
   * @param {string} agentId
   * @param {object} [options]
   * @param {number} [options.limit] - Max entries to return
   * @returns {Array<object>}
   */
  getHistory(agentId, options = {}) {
    const agent = this._agents.get(agentId);
    if (!agent) return [];

    const limit = options.limit !== undefined ? Math.max(0, options.limit) : undefined;
    const execs = [...agent.executions].reverse(); // newest first

    if (limit !== undefined) {
      return execs.slice(0, limit).map((e) => ({ ...e }));
    }
    return execs.map((e) => ({ ...e }));
  }

  /**
   * Reset data for a specific agent.
   *
   * @param {string} agentId
   * @returns {boolean}
   */
  resetAgent(agentId) {
    return this._agents.delete(agentId);
  }

  /**
   * Reset the entire reliability tracker.
   */
  reset() {
    this._agents.clear();
  }

  /**
   * Get the total number of tracked agents.
   *
   * @returns {number}
   */
  get agentCount() {
    return this._agents.size;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  _getOrCreateAgent(agentId) {
    let agent = this._agents.get(agentId);
    if (!agent) {
      agent = {
        executions: [],
        failures: [],
        taskTypeStats: new Map(),
        recoveryCount: 0,
        recoveryTimestamps: [],
        lastFailureTimestamp: null,
      };
      this._agents.set(agentId, agent);
    }
    return agent;
  }

  _computeMTBF(agent) {
    if (agent.failures.length < 2) return null;

    const sortedFailures = [...agent.failures].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    let totalGap = 0;
    let gapCount = 0;

    for (let i = 1; i < sortedFailures.length; i++) {
      const gap = sortedFailures[i].timestamp - sortedFailures[i - 1].timestamp;
      if (gap > 0) {
        totalGap += gap;
        gapCount += 1;
      }
    }

    if (gapCount === 0) return null;

    return Math.round(totalGap / gapCount);
  }

  _computeErrorRateByType(agent) {
    const byType = {};

    for (const failure of agent.failures) {
      const type = failure.errorType || "unknown";
      byType[type] = (byType[type] || 0) + 1;
    }

    const total = agent.executions.length || 1;
    const result = {};
    for (const [type, count] of Object.entries(byType)) {
      result[type] = {
        count,
        rate: Math.round((count / total) * 100) / 100,
      };
    }

    return result;
  }

  _computeRecoveryRate(agent) {
    const failures = agent.failures.length;
    const recoveries = agent.recoveryCount || 0;

    if (failures === 0) return 1; // never failed — perfect recovery
    return Math.round((recoveries / failures) * 100) / 100;
  }

  _computeConsistencyScore(agent) {
    if (agent.executions.length < 3) return 0.7;

    // Sliding window of success/failure pattern
    const recent = agent.executions.slice(-20);
    let switchCount = 0;

    for (let i = 1; i < recent.length; i++) {
      if (recent[i].success !== recent[i - 1].success) {
        switchCount += 1;
      }
    }

    const maxSwitches = recent.length - 1;
    const switchRate = maxSwitches > 0 ? switchCount / maxSwitches : 0;

    // Lower switch rate = more consistent
    if (switchRate <= 0.1) return 1.0;
    if (switchRate <= 0.2) return 0.85;
    if (switchRate <= 0.3) return 0.7;
    if (switchRate <= 0.5) return 0.5;
    return 0.3;
  }

  _matchTaskType(agent, taskType) {
    const knownTypes = Array.from(agent.taskTypeStats.keys());
    if (knownTypes.length === 0) return null;

    // Exact match
    if (agent.taskTypeStats.has(taskType)) return taskType;

    // Prefix match
    const lowerType = taskType.toLowerCase();
    for (const key of knownTypes) {
      if (key.toLowerCase().includes(lowerType) || lowerType.includes(key.toLowerCase())) {
        return key;
      }
    }

    return null;
  }
}

module.exports = { ReliabilityTracker };
