/**
 * ReputationEngine — Tracks agent reputation scores based on task performance,
 * reliability, and quality. Used to decide which agents to assign tasks to.
 *
 *   const engine = new ReputationEngine();
 *   engine.recordSuccess("agent-1", { type: "code-review" }, { durationMs: 500 });
 *   engine.getReputation("agent-1");  // { score: 85, breakdown: {...}, history: {...} }
 *   engine.getLeaderboard({ limit: 5 });
 */
"use strict";

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const DEFAULT_SCORE = 50;

// ─── Scoring weights ────────────────────────────────────────────────────

const FACTOR_WEIGHTS = Object.freeze({
  successRate: 0.30,
  taskComplexity: 0.20,
  timeliness: 0.15,
  collaboration: 0.10,
  consistency: 0.25,
});

// ─── Decay configuration ──────────────────────────────────────────────────

const DECAY_HALF_LIFE_DAYS = 30;
const DECAY_FLOOR = 10;

// ─── Helpers ────────────────────────────────────────────────────────────

function _now() {
  return Date.now();
}

function _daysBetween(a, b) {
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _computeSuccessRate(successCount, failureCount) {
  const total = successCount + failureCount;
  if (total === 0) return 0.5; // neutral for no data
  return successCount / total;
}

function _complexityFromTask(task) {
  if (!task || typeof task !== "object") return 0.5;
  const raw = typeof task.complexity === "number" ? task.complexity : 0.5;
  return _clamp(raw, 0, 1);
}

function _timelinessScore(durationMs, expectedMs) {
  if (expectedMs <= 0) return 0.75; // no expectation — neutral
  const ratio = durationMs / expectedMs;
  if (ratio <= 0.5) return 1.0;
  if (ratio <= 1.0) return 0.9;
  if (ratio <= 1.5) return 0.7;
  if (ratio <= 2.0) return 0.5;
  if (ratio <= 3.0) return 0.3;
  return 0.1;
}

// ─── ReputationEngine ───────────────────────────────────────────────────

class ReputationEngine {
  constructor(options = {}) {
    /**
     * Map<agentId, { successes, failures, collaborationCount, totalDurationMs,
     *   scores: number[], lastUpdated, decayAppliedAt }>
     * @type {Map<string, object>}
     */
    this._agents = new Map();

    this._decayHalfLifeDays =
      options.decayHalfLifeDays !== undefined
        ? options.decayHalfLifeDays
        : DECAY_HALF_LIFE_DAYS;

    this._decayFloor =
      options.decayFloor !== undefined ? options.decayFloor : DECAY_FLOOR;
  }

  // ── Recording ──────────────────────────────────────────────────────────

  /**
   * Record a successful task execution.
   *
   * @param {string} agentId
   * @param {object}  task   - Task descriptor (must have `complexity` optionally)
   * @param {object}  result - Execution result (must have `durationMs` optionally,
   *                           `collaborative` optionally)
   */
  recordSuccess(agentId, task, result) {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("agentId is required");
    }

    const agent = this._getOrCreateAgent(agentId);
    agent.successes += 1;

    const durationMs = _clamp(
      typeof (result && result.durationMs) === "number" ? result.durationMs : 0,
      0,
      Infinity
    );
    agent.totalDurationMs += durationMs;

    if (result && result.collaborative) {
      agent.collaborationCount += 1;
    }

    const complexity = _complexityFromTask(task);
    agent.totalComplexity += complexity;

    const successRateScore = _computeSuccessRate(
      agent.successes,
      agent.failures
    );

    const complexityScore = complexity;

    const avgDuration =
      agent.successes > 0 ? agent.totalDurationMs / agent.successes : 0;
    const timelinessScore =
      avgDuration > 0
        ? _timelinessScore(durationMs, avgDuration)
        : 0.75;

    const collaborationScore =
      agent.successes > 0
        ? agent.collaborationCount / agent.successes
        : 0.5;

    // Consistency: running stddev of success rate over recent scores
    const consistencyScore = this._computeConsistency(agent, successRateScore);

    const factorScores = {
      successRate: Math.round(successRateScore * MAX_SCORE),
      taskComplexity: Math.round(complexityScore * MAX_SCORE),
      timeliness: Math.round(timelinessScore * MAX_SCORE),
      collaboration: Math.round(collaborationScore * MAX_SCORE),
      consistency: Math.round(consistencyScore * MAX_SCORE),
    };

    agent.latestFactorScores = factorScores;

    const score = this._computeWeightedScore(factorScores);
    agent.scores.push(score);
    if (agent.scores.length > 100) {
      agent.scores = agent.scores.slice(-100);
    }

    agent.lastUpdated = _now();
  }

  /**
   * Record a failed task execution.
   *
   * @param {string} agentId
   * @param {object} task   - Task descriptor
   * @param {Error|object} error - Error that occurred
   */
  recordFailure(agentId, task, error) {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("agentId is required");
    }

    const agent = this._getOrCreateAgent(agentId);
    agent.failures += 1;
    agent.lastUpdated = _now();

    const errorType =
      error && error.type
        ? error.type
        : error && error.name
          ? error.name
          : "unknown";

    if (!agent.errorCounts) {
      agent.errorCounts = {};
    }
    agent.errorCounts[errorType] = (agent.errorCounts[errorType] || 0) + 1;
  }

  // ── Queries ────────────────────────────────────────────────────────────

  /**
   * Get the reputation score for an agent with a full breakdown.
   *
   * @param {string} agentId
   * @returns {object} { score, breakdown: {...}, history: { successes, failures, total, successRate } }
   */
  getReputation(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      return {
        score: DEFAULT_SCORE,
        breakdown: {
          successRate: DEFAULT_SCORE,
          taskComplexity: DEFAULT_SCORE,
          timeliness: DEFAULT_SCORE,
          collaboration: DEFAULT_SCORE,
          consistency: DEFAULT_SCORE,
        },
        history: {
          successes: 0,
          failures: 0,
          total: 0,
          successRate: 0.5,
        },
      };
    }

    const factorScores = agent.latestFactorScores || {
      successRate: DEFAULT_SCORE,
      taskComplexity: DEFAULT_SCORE,
      timeliness: DEFAULT_SCORE,
      collaboration: DEFAULT_SCORE,
      consistency: DEFAULT_SCORE,
    };

    const score = this._computeWeightedScore(factorScores);

    return {
      score: Math.round(score),
      breakdown: { ...factorScores },
      history: {
        successes: agent.successes,
        failures: agent.failures,
        total: agent.successes + agent.failures,
        successRate: _computeSuccessRate(agent.successes, agent.failures),
      },
    };
  }

  /**
   * Get a ranked list of agents by their reputation score.
   *
   * @param {object} [options]
   * @param {number} [options.limit=10]      - Max entries
   * @param {number} [options.minTasks=0]    - Minimum number of tasks required
   * @param {number} [options.minSuccessRate] - Minimum success rate filter
   * @returns {Array<{ agentId, score, breakdown, history }>}
   */
  getLeaderboard(options = {}) {
    const limit = Math.max(1, options.limit || 10);
    const minTasks = Math.max(0, options.minTasks || 0);

    const results = [];

    for (const [agentId, agent] of this._agents) {
      const total = agent.successes + agent.failures;
      if (total < minTasks) continue;

      const rep = this.getReputation(agentId);

      if (
        options.minSuccessRate !== undefined &&
        rep.history.successRate < options.minSuccessRate
      ) {
        continue;
      }

      results.push({
        agentId,
        score: rep.score,
        breakdown: rep.breakdown,
        history: rep.history,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Apply time decay to all agent scores. Older scores (based on lastUpdated)
   * are decayed toward the floor value. Uses exponential decay with configurable
   * half-life.
   */
  decayReputation() {
    const now = _now();

    for (const [, agent] of this._agents) {
      if (!agent.lastUpdated) continue;

      const daysSinceUpdate = _daysBetween(now, agent.lastUpdated);
      if (daysSinceUpdate < 1) continue; // skip very recent updates

      const decayFactor = Math.pow(0.5, daysSinceUpdate / this._decayHalfLifeDays);

      if (agent.scores.length > 0) {
        const decayedScores = agent.scores.map((score) => {
          const range = score - this._decayFloor;
          const decayed = this._decayFloor + range * decayFactor;
          return Math.round(decayed);
        });
        agent.scores = decayedScores;
      }

      agent.decayedAt = now;
    }
  }

  /**
   * Get raw agent data for external analysis.
   *
   * @param {string} agentId
   * @returns {object|null}
   */
  getAgentData(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return null;

    return {
      successes: agent.successes,
      failures: agent.failures,
      collaborationCount: agent.collaborationCount,
      totalDurationMs: agent.totalDurationMs,
      totalComplexity: agent.totalComplexity,
      errorCounts: agent.errorCounts ? { ...agent.errorCounts } : {},
      scoreCount: agent.scores.length,
      lastUpdated: agent.lastUpdated,
      decayedAt: agent.decayedAt || null,
    };
  }

  /**
   * Reset all data for a specific agent.
   *
   * @param {string} agentId
   * @returns {boolean} True if agent existed and was removed
   */
  resetAgent(agentId) {
    return this._agents.delete(agentId);
  }

  /**
   * Reset the entire reputation engine.
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
        successes: 0,
        failures: 0,
        collaborationCount: 0,
        totalDurationMs: 0,
        totalComplexity: 0,
        scores: [],
        lastUpdated: 0,
        latestFactorScores: null,
        errorCounts: {},
      };
      this._agents.set(agentId, agent);
    }
    return agent;
  }

  _computeWeightedScore(factorScores) {
    return (
      factorScores.successRate * FACTOR_WEIGHTS.successRate +
      factorScores.taskComplexity * FACTOR_WEIGHTS.taskComplexity +
      factorScores.timeliness * FACTOR_WEIGHTS.timeliness +
      factorScores.collaboration * FACTOR_WEIGHTS.collaboration +
      factorScores.consistency * FACTOR_WEIGHTS.consistency
    );
  }

  _computeConsistency(agent, currentSuccessRate) {
    if (agent.scores.length < 2) return 0.7; // not enough data — neutral

    const recentScores = agent.scores.slice(-20);
    const mean =
      recentScores.reduce((sum, s) => sum + s, 0) / recentScores.length;

    if (mean === 0) return 0.5;

    const variance =
      recentScores.reduce((sum, s) => {
        const diff = s - mean;
        return sum + diff * diff;
      }, 0) / recentScores.length;

    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;

    // Lower CV means more consistent => higher score
    if (coefficientOfVariation <= 0.05) return 1.0;
    if (coefficientOfVariation <= 0.10) return 0.9;
    if (coefficientOfVariation <= 0.15) return 0.8;
    if (coefficientOfVariation <= 0.25) return 0.6;
    if (coefficientOfVariation <= 0.40) return 0.4;
    return 0.2;
  }
}

ReputationEngine.MIN_SCORE = MIN_SCORE;
ReputationEngine.MAX_SCORE = MAX_SCORE;
ReputationEngine.DEFAULT_SCORE = DEFAULT_SCORE;
ReputationEngine.FACTOR_WEIGHTS = FACTOR_WEIGHTS;

module.exports = { ReputationEngine };
