/**
 * SimulationMetrics — collects, computes, and compares metrics across
 * simulation runs for multi-agent scenarios.
 */
"use strict";

class SimulationMetrics {
  constructor() {
    this._events = [];
    this._startedAt = null;
    this._completedAt = null;
    this._tags = {};
  }

  // ── Event recording ─────────────────────────────────────

  /**
   * Record a simulation event.
   * @param {object} event
   * @param {string} event.type - Event type.
   * @param {string} event.agent - Agent name.
   * @param {string} event.action - Action performed.
   * @param {string} event.outcome - Outcome (success, failure, etc.).
   * @param {number} [event.tokensUsed] - Tokens consumed.
   * @param {number} [event.duration] - Duration in ms.
   * @param {object} [event.metadata] - Extra data.
   */
  track(event) {
    if (!event || typeof event !== "object") {
      throw new Error("Event must be an object.");
    }

    const record = {
      id: this._events.length + 1,
      timestamp: new Date().toISOString(),
      type: event.type || "unknown",
      agent: event.agent || "system",
      action: event.action || null,
      outcome: event.outcome || null,
      tokensUsed: normalizePositive(event.tokensUsed, 0),
      duration: normalizePositive(event.duration, 0),
      metadata: event.metadata && typeof event.metadata === "object" ? clone(event.metadata) : {},
    };

    this._events.push(record);

    if (!this._startedAt) {
      this._startedAt = record.timestamp;
    }
    this._completedAt = record.timestamp;

    return record;
  }

  /**
   * Tag the metrics run with arbitrary key-value pairs for filtering.
   * @param {string} key
   * @param {*} value
   */
  tag(key, value) {
    this._tags[key] = value;
    return this;
  }

  /**
   * Bulk-import events from a simulation history array.
   * @param {Array<object>} history - Array of { event, data } records.
   */
  importHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error("History must be an array.");
    }

    for (const entry of history) {
      if (entry && typeof entry === "object") {
        this.track({
          type: entry.event || entry.type,
          agent: entry.data && entry.data.agent ? entry.data.agent : (entry.agent || "system"),
          action: entry.data && entry.data.action ? entry.data.action : (entry.action || null),
          outcome: entry.data && entry.data.outcome ? entry.data.outcome : (entry.outcome || null),
          metadata: entry.data ? entry.data : entry.metadata || {},
        });
      }
    }

    return this;
  }

  // ── Aggregate statistics ────────────────────────────────

  /**
   * Compute aggregate statistics over all tracked events.
   */
  computeStats() {
    const total = this._events.length;
    const byAgent = {};
    const byOutcome = { success: 0, partial_success: 0, failure: 0, needs_input: 0 };
    const byAction = {};
    let totalTokens = 0;
    let totalDuration = 0;

    for (const event of this._events) {
      // Per-agent
      if (!byAgent[event.agent]) {
        byAgent[event.agent] = {
          events: 0,
          successes: 0,
          failures: 0,
          tokens: 0,
          duration: 0,
        };
      }
      byAgent[event.agent].events++;
      byAgent[event.agent].tokens += event.tokensUsed;
      byAgent[event.agent].duration += event.duration;

      // Per-outcome
      if (event.outcome in byOutcome) {
        byOutcome[event.outcome]++;
        if (event.outcome === "success") {
          byAgent[event.agent].successes++;
        } else if (event.outcome === "failure") {
          byAgent[event.agent].failures++;
        }
      }

      // Per-action
      if (event.action) {
        byAction[event.action] = (byAction[event.action] || 0) + 1;
      }

      totalTokens += event.tokensUsed;
      totalDuration += event.duration;
    }

    const wallTime = this._startedAt && this._completedAt
      ? new Date(this._completedAt).getTime() - new Date(this._startedAt).getTime()
      : 0;

    // Agent success rates
    for (const agentKey of Object.keys(byAgent)) {
      const agent = byAgent[agentKey];
      agent.successRate = agent.events > 0 ? agent.successes / agent.events : 0;
      agent.failureRate = agent.events > 0 ? agent.failures / agent.events : 0;
    }

    return {
      total,
      wallTime,
      totalTokens,
      totalDuration,
      byAgent,
      byOutcome,
      byAction,
      tags: { ...this._tags },
      agentCount: Object.keys(byAgent).length,
    };
  }

  // ── Derived metrics ─────────────────────────────────────

  /**
   * Measure efficiency: tokens consumed per successful task completion.
   * Lower is better.
   */
  efficiency() {
    const stats = this.computeStats();
    const totalSuccesses = stats.byOutcome.success + stats.byOutcome.partial_success;

    if (totalSuccesses === 0) {
      return { tokensPerSuccess: null, description: "No successful events recorded." };
    }

    return {
      tokensPerSuccess: Math.round(stats.totalTokens / totalSuccesses),
      totalTokens: stats.totalTokens,
      successes: totalSuccesses,
      isEfficient: stats.totalTokens / Math.max(1, totalSuccesses) < 1000,
    };
  }

  /**
   * Measure output quality indicators.
   * Quality = successRate * (1 - failureRate) weighted by action counts.
   * Returns a score from 0 to 1.
   */
  quality() {
    const stats = this.computeStats();

    if (stats.total === 0) {
      return { score: 0, description: "No events to evaluate quality." };
    }

    const successRate = (stats.byOutcome.success + stats.byOutcome.partial_success) / stats.total;
    const failureRate = stats.byOutcome.failure / stats.total;
    const diversity = Object.keys(stats.byAction).length / Math.max(1, stats.agentCount);

    // Quality score: blend of success rate, low failure rate, and action diversity
    const score = clamp((successRate * (1 - failureRate) * 0.7 + Math.min(diversity, 1) * 0.3), 0, 1);

    return {
      score: round(score, 4),
      successRate: round(successRate, 4),
      failureRate: round(failureRate, 4),
      actionDiversity: round(diversity, 4),
      breakdown: {
        totalEvents: stats.total,
        successes: stats.byOutcome.success,
        partialSuccesses: stats.byOutcome.partial_success,
        failures: stats.byOutcome.failure,
        needsInput: stats.byOutcome.needs_input,
      },
    };
  }

  /**
   * Measure inter-agent collaboration.
   * Higher means agents interact more evenly (less dominance by one agent).
   */
  collaboration() {
    const stats = this.computeStats();
    const agents = Object.keys(stats.byAgent);

    if (agents.length < 2) {
      return { score: 0, description: "Need at least 2 agents to measure collaboration." };
    }

    const eventCounts = agents.map((a) => stats.byAgent[a].events);
    const total = eventCounts.reduce((sum, c) => sum + c, 0);

    if (total === 0) {
      return { score: 0, description: "No events across agents." };
    }

    // Normalized entropy as a collaboration measure — higher entropy = more balanced participation
    const proportions = eventCounts.map((c) => c / total);
    const entropy = -proportions.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
    const maxEntropy = Math.log2(agents.length);

    const score = maxEntropy > 0 ? round(entropy / maxEntropy, 4) : 0;

    // Dominance: ratio of most-active to least-active agent
    const maxEvents = Math.max(...eventCounts);
    const minEvents = Math.min(...eventCounts);
    const dominanceRatio = minEvents > 0 ? round(maxEvents / minEvents, 2) : maxEvents;

    return {
      score,
      description: score > 0.8 ? "Highly collaborative" : score > 0.5 ? "Moderately collaborative" : "Low collaboration",
      agentParticipation: agents.reduce((acc, a) => {
        acc[a] = stats.byAgent[a].events;
        return acc;
      }, {}),
      dominanceRatio,
      agentEntropy: round(entropy, 4),
    };
  }

  // ── Comparison ──────────────────────────────────────────

  /**
   * Compare this metrics run against another.
   * @param {SimulationMetrics} other
   * @returns {object} Comparison report.
   */
  compareScenarios(other) {
    if (!(other instanceof SimulationMetrics)) {
      throw new Error("Can only compare with another SimulationMetrics instance.");
    }

    const selfStats = this.computeStats();
    const otherStats = other.computeStats();

    const selfQuality = this.quality();
    const otherQuality = other.quality();

    const selfCollab = this.collaboration();
    const otherCollab = other.collaboration();

    const selfEfficiency = this.efficiency();
    const otherEfficiency = other.efficiency();

    const comparisons = [];

    // Compare total events
    comparisons.push({
      metric: "totalEvents",
      self: selfStats.total,
      other: otherStats.total,
      delta: selfStats.total - otherStats.total,
      winner: selfStats.total > otherStats.total ? "self" : selfStats.total < otherStats.total ? "other" : "tie",
    });

    // Compare quality score
    comparisons.push({
      metric: "quality",
      self: selfQuality.score,
      other: otherQuality.score,
      delta: round(selfQuality.score - otherQuality.score, 4),
      winner: selfQuality.score > otherQuality.score ? "self" : selfQuality.score < otherQuality.score ? "other" : "tie",
    });

    // Compare collaboration score
    comparisons.push({
      metric: "collaboration",
      self: selfCollab.score,
      other: otherCollab.score,
      delta: round(selfCollab.score - otherCollab.score, 4),
      winner: selfCollab.score > otherCollab.score ? "self" : selfCollab.score < otherCollab.score ? "other" : "tie",
    });

    // Compare efficiency
    const selfTokPer = selfEfficiency.tokensPerSuccess;
    const otherTokPer = otherEfficiency.tokensPerSuccess;
    comparisons.push({
      metric: "efficiency",
      self: selfTokPer,
      other: otherTokPer,
      delta: selfTokPer !== null && otherTokPer !== null ? otherTokPer - selfTokPer : null,
      winner: selfTokPer !== null && otherTokPer !== null
        ? (selfTokPer < otherTokPer ? "self" : selfTokPer > otherTokPer ? "other" : "tie")
        : null,
    });

    return {
      selfTags: selfStats.tags,
      otherTags: otherStats.tags,
      comparisons,
      summary: {
        selfWins: comparisons.filter((c) => c.winner === "self").length,
        otherWins: comparisons.filter((c) => c.winner === "other").length,
        ties: comparisons.filter((c) => c.winner === "tie").length,
      },
    };
  }

  // ── Report ──────────────────────────────────────────────

  /**
   * Generate a detailed human-readable simulation report.
   * @param {object} [options={}]
   * @param {boolean} [options.includeRaw=false] - Include raw event data.
   */
  generateReport(options = {}) {
    const stats = this.computeStats();
    const qualityResult = this.quality();
    const collabResult = this.collaboration();
    const efficiencyResult = this.efficiency();

    const report = {
      summary: {
        totalEvents: stats.total,
        wallTimeMs: stats.wallTime,
        agentCount: stats.agentCount,
        totalTokens: stats.totalTokens,
        tags: stats.tags,
      },
      quality: qualityResult,
      collaboration: collabResult,
      efficiency: efficiencyResult,
      byAgent: stats.byAgent,
      byOutcome: stats.byOutcome,
      byAction: stats.byAction,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
    };

    if (options.includeRaw) {
      report.raw = this._events.map(clone);
    }

    return report;
  }

  /**
   * Reset all tracked data.
   */
  reset() {
    this._events = [];
    this._startedAt = null;
    this._completedAt = null;
    this._tags = {};
    return this;
  }
}

// ── Helpers ───────────────────────────────────────────────

function normalizePositive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SimulationMetrics,
};
