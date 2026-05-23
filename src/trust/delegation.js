/**
 * DelegationEngine — Selects and ranks agents for task assignment using
 * a combination of reputation, reliability, capability matching, workload,
 * and past performance data.
 *
 *   const engine = new DelegationEngine({ reputation, reliability });
 *   const best = engine.selectAgent(task, ["agent-1", "agent-2"]);
 *   engine.evaluateDelegation(task, best.agentId, result);
 */
"use strict";

const { ReputationEngine } = require("./reputation");
const { ReliabilityTracker } = require("./reliability");

// ─── Selection strategies ───────────────────────────────────────────────

const STRATEGY = Object.freeze({
  BEST_FIT: "BEST_FIT",
  ROUND_ROBIN: "ROUND_ROBIN",
  EXPLORE: "EXPLORE",
  WEIGHTED_RANDOM: "WEIGHTED_RANDOM",
});

// ─── Default weights for ranking ────────────────────────────────────────

const DEFAULT_RANK_WEIGHTS = Object.freeze({
  reputation: 0.25,
  reliability: 0.25,
  capabilityMatch: 0.20,
  workload: 0.10,
  pastPerformance: 0.20,
});

// ─── Helpers ────────────────────────────────────────────────────────────

function _now() {
  return Date.now();
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _seedRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── DelegationEngine ───────────────────────────────────────────────────

class DelegationEngine {
  /**
   * @param {object} options
   * @param {ReputationEngine} [options.reputation] - ReputationEngine instance
   * @param {ReliabilityTracker} [options.reliability] - ReliabilityTracker instance
   * @param {object} [options.rankWeights] - Custom weights for ranking
   * @param {string} [options.defaultStrategy] - Default selection strategy
   */
  constructor(options = {}) {
    /**
     * @type {ReputationEngine}
     */
    this.reputation = options.reputation || new ReputationEngine();

    /**
     * @type {ReliabilityTracker}
     */
    this.reliability = options.reliability || new ReliabilityTracker();

    /**
     * @type {object}
     */
    this.rankWeights = options.rankWeights
      ? { ...DEFAULT_RANK_WEIGHTS, ...options.rankWeights }
      : { ...DEFAULT_RANK_WEIGHTS };

    /**
     * @type {string}
     */
    this.defaultStrategy = options.defaultStrategy || STRATEGY.BEST_FIT;

    /**
     * History of task assignments.
     * @type {Array<object>}
     */
    this._history = [];

    /**
     * Per-agent workload counters.
     * @type {Map<string, number>}
     */
    this._workload = new Map();

    /**
     * Per-agent capability profiles.
     * @type {Map<string, Array<string>>}
     */
    this._capabilities = new Map();

    /**
     * Round-robin index tracker.
     * @type {Map<string, number>}
     */
    this._roundRobinIndex = new Map();

    /**
     * Maximum history entries to retain.
     * @type {number}
     */
    this._maxHistory = options.maxHistory || 1000;
  }

  // ── Capability registration ────────────────────────────────────────────

  /**
   * Register an agent's capabilities (task types they can handle).
   *
   * @param {string} agentId
   * @param {Array<string>} capabilities - List of supported task types
   */
  registerCapabilities(agentId, capabilities = []) {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("agentId is required");
    }
    this._capabilities.set(
      agentId,
      capabilities.map((c) => c.toLowerCase())
    );
  }

  /**
   * Remove a registered agent and all its data.
   *
   * @param {string} agentId
   */
  unregisterAgent(agentId) {
    this._capabilities.delete(agentId);
    this._workload.delete(agentId);
    this._roundRobinIndex.delete(agentId);
  }

  // ── Selection ──────────────────────────────────────────────────────────

  /**
   * Select the best agent for a given task from a list of candidates.
   *
   * @param {object} task               - Task descriptor
   * @param {string} [task.type]        - Task type/category
   * @param {number} [task.complexity]  - 0-1 complexity
   * @param {string[]} candidates       - Array of candidate agent IDs
   * @param {object} [options]
   * @param {string} [options.strategy] - Selection strategy (BEST_FIT, ROUND_ROBIN, etc.)
   * @returns {object} { agentId, score, ranking }
   */
  selectAgent(task = {}, candidates = [], options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("At least one candidate is required");
    }

    const strategy = options.strategy || this.defaultStrategy;

    switch (strategy) {
      case STRATEGY.BEST_FIT:
        return this._selectBestFit(task, candidates);
      case STRATEGY.ROUND_ROBIN:
        return this._selectRoundRobin(task, candidates);
      case STRATEGY.EXPLORE:
        return this._selectExplore(task, candidates);
      case STRATEGY.WEIGHTED_RANDOM:
        return this._selectWeightedRandom(task, candidates, options.seed);
      default:
        throw new Error(
          `Unknown selection strategy: ${strategy}. Valid: ${Object.values(STRATEGY).join(", ")}`
        );
    }
  }

  /**
   * Rank all candidates for a given task, returning a sorted list.
   *
   * @param {object} task         - Task descriptor
   * @param {string[]} candidates  - Array of candidate agent IDs
   * @returns {Array<{ agentId, score, factors }>} Ranked from best to worst
   */
  rankAgents(task = {}, candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    const scored = candidates.map((agentId) => {
      const reputation = this.reputation.getReputation(agentId);
      const reliability = this.reliability.getReliability(agentId);
      const workload = this.getWorkload(agentId);
      const capabilityMatch = this._computeCapabilityMatch(agentId, task);
      const pastPerformance = this._computePastPerformance(agentId, task);

      const workloadScore = Math.max(0, 1 - workload * 0.1);

      const score =
        (reputation.score / 100) * this.rankWeights.reputation +
        reliability.successRate * this.rankWeights.reliability +
        capabilityMatch * this.rankWeights.capabilityMatch +
        workloadScore * this.rankWeights.workload +
        pastPerformance * this.rankWeights.pastPerformance;

      return {
        agentId,
        score: Math.round(score * 100) / 100,
        normalizedScore: Math.round(score * 100),
        factors: {
          reputation: reputation.score,
          reliability: reliability.successRate,
          capabilityMatch: Math.round(capabilityMatch * 100) / 100,
          workload: workloadScore,
          pastPerformance: Math.round(pastPerformance * 100) / 100,
          reliabilityDetail: reliability,
        },
      };
    });

    scored.sort((a, b) => b.normalizedScore - a.normalizedScore);
    return scored;
  }

  // ── History ────────────────────────────────────────────────────────────

  /**
   * Get the delegation history.
   *
   * @param {object} [options]
   * @param {number} [options.limit]  - Max entries
   * @param {string} [options.agentId] - Filter by agent
   * @param {string} [options.taskType] - Filter by task type
   * @returns {Array<object>}
   */
  getDelegationHistory(options = {}) {
    let results = [...this._history];

    if (options.agentId) {
      results = results.filter((e) => e.agentId === options.agentId);
    }

    if (options.taskType) {
      results = results.filter((e) => e.taskType === options.taskType);
    }

    const limit = options.limit !== undefined ? Math.max(0, options.limit) : undefined;
    if (limit !== undefined) {
      results = results.slice(-limit);
    }

    return results;
  }

  // ── Evaluation / feedback loop ─────────────────────────────────────────

  /**
   * Evaluate a completed delegation and feed results back into the system.
   * This updates reputation, reliability, and workload.
   *
   * @param {object} task            - The original task descriptor
   * @param {string} agentId         - The agent that handled the task
   * @param {object} result          - Execution result
   * @param {boolean} result.success - Whether the task succeeded
   * @param {number} [result.durationMs]
   * @param {string} [result.errorType]
   * @param {boolean} [result.collaborative]
   */
  evaluateDelegation(task = {}, agentId, result = {}) {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("agentId is required");
    }

    // Record assignment in history
    this._recordHistory(task, agentId, result);

    // Update workload
    this.incrementWorkload(agentId);

    // Update reliability tracker
    this.reliability.trackExecution(agentId, {
      success: result.success !== false,
      taskType: task.type || "unknown",
      durationMs: result.durationMs || 0,
      errorType: result.errorType || null,
      recovered: result.recovered || false,
    });

    // Update reputation
    if (result.success !== false) {
      this.reputation.recordSuccess(agentId, task, result);
    } else {
      this.reputation.recordFailure(agentId, task, {
        type: result.errorType || "unknown",
        name: result.errorType || "Error",
      });
    }
  }

  // ── Workload management ────────────────────────────────────────────────

  /**
   * Get the current workload count for an agent (number of active/in-flight tasks).
   *
   * @param {string} agentId
   * @returns {number}
   */
  getWorkload(agentId) {
    return this._workload.get(agentId) || 0;
  }

  /**
   * Increment the workload counter for an agent.
   *
   * @param {string} agentId
   */
  incrementWorkload(agentId) {
    const current = this._workload.get(agentId) || 0;
    this._workload.set(agentId, current + 1);
  }

  /**
   * Decrement the workload counter for an agent (when a task completes).
   *
   * @param {string} agentId
   */
  decrementWorkload(agentId) {
    const current = this._workload.get(agentId) || 0;
    this._workload.set(agentId, Math.max(0, current - 1));
  }

  /**
   * Get workload snapshot for all agents.
   *
   * @returns {object} Map of agentId -> workload count
   */
  getWorkloadSnapshot() {
    const snapshot = {};
    for (const [agentId, count] of this._workload) {
      snapshot[agentId] = count;
    }
    return snapshot;
  }

  // ── Reset ──────────────────────────────────────────────────────────────

  /**
   * Reset all delegation state (history, workload, capabilities).
   */
  reset() {
    this._history = [];
    this._workload.clear();
    this._capabilities.clear();
    this._roundRobinIndex.clear();
    this.reputation.reset();
    this.reliability.reset();
  }

  // ── Private: selection strategies ──────────────────────────────────────

  _selectBestFit(task, candidates) {
    const ranked = this.rankAgents(task, candidates);
    if (ranked.length === 0) {
      throw new Error("No candidates could be ranked");
    }
    return {
      agentId: ranked[0].agentId,
      score: ranked[0].normalizedScore,
      ranking: ranked,
    };
  }

  _selectRoundRobin(task, candidates) {
    const key = task.type || "default";
    let index = this._roundRobinIndex.get(key) || 0;

    const sorted = [...candidates].sort();
    const selected = sorted[index % sorted.length];

    index = (index + 1) % sorted.length;
    this._roundRobinIndex.set(key, index);

    const ranked = this.rankAgents(task, candidates);

    return {
      agentId: selected,
      score: 0,
      ranking: ranked,
      strategy: STRATEGY.ROUND_ROBIN,
    };
  }

  _selectExplore(task, candidates) {
    // Pick the agent with the fewest delegations to encourage exploration
    const ranked = this.rankAgents(task, candidates);

    const withCounts = candidates.map((agentId) => {
      const assignments = this._history.filter((h) => h.agentId === agentId).length;
      return { agentId, assignmentCount: assignments };
    });

    withCounts.sort((a, b) => a.assignmentCount - b.assignmentCount);

    return {
      agentId: withCounts[0].agentId,
      score: 0,
      ranking: ranked,
      strategy: STRATEGY.EXPLORE,
    };
  }

  _selectWeightedRandom(task, candidates, seed) {
    const ranked = this.rankAgents(task, candidates);
    if (ranked.length === 0) {
      throw new Error("No candidates could be ranked");
    }

    const totalScore = ranked.reduce((sum, r) => sum + Math.max(1, r.normalizedScore), 0);
    const rand = seed !== undefined ? _seedRandom(seed)() : Math.random();
    let cumulative = 0;

    for (const entry of ranked) {
      cumulative += Math.max(1, entry.normalizedScore) / totalScore;
      if (rand <= cumulative) {
        return {
          agentId: entry.agentId,
          score: entry.normalizedScore,
          ranking: ranked,
          strategy: STRATEGY.WEIGHTED_RANDOM,
        };
      }
    }

    // Fallback to top-ranked
    return {
      agentId: ranked[0].agentId,
      score: ranked[0].normalizedScore,
      ranking: ranked,
      strategy: STRATEGY.WEIGHTED_RANDOM,
    };
  }

  // ── Private: ranking helpers ───────────────────────────────────────────

  _computeCapabilityMatch(agentId, task) {
    const caps = this._capabilities.get(agentId);
    if (!caps || caps.length === 0) return 0.5; // unknown — neutral

    const taskType = (task.type || task.taskType || "").toLowerCase();
    if (!taskType) return 0.5;

    // Exact match
    if (caps.includes(taskType)) return 1.0;

    // Partial match
    for (const cap of caps) {
      if (cap.includes(taskType) || taskType.includes(cap)) return 0.8;
    }

    return 0.2;
  }

  _computePastPerformance(agentId, task) {
    const taskType = task.type || "unknown";
    const relevantHistory = this._history.filter(
      (h) => h.agentId === agentId && h.taskType === taskType
    );

    if (relevantHistory.length === 0) return 0.5;

    const successes = relevantHistory.filter((h) => h.success).length;
    return successes / relevantHistory.length;
  }

  _recordHistory(task, agentId, result) {
    const entry = {
      taskType: task.type || "unknown",
      taskComplexity:
        typeof task.complexity === "number" ? task.complexity : null,
      agentId,
      success: result.success !== false,
      durationMs: result.durationMs || 0,
      errorType: result.errorType || null,
      timestamp: _now(),
    };

    this._history.push(entry);

    // Prune old entries if over limit
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }
  }
}

DelegationEngine.STRATEGY = STRATEGY;

module.exports = { DelegationEngine };
