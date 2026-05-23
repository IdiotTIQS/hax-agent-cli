"use strict";

const { debug } = require('../debug');

/**
 * FairScheduler — multi-agent resource scheduler implementing
 * weighted fair queuing, max-min fairness, and priority-based
 * allocation with starvation detection and prevention.
 *
 * Each agent has a weight and optional priority. When agents contend
 * for resources the scheduler distributes capacity proportionally to
 * weights while guaranteeing minimum allocations (max-min fairness).
 */

const ALGORITHM = Object.freeze({
  WEIGHTED_FAIR: "WEIGHTED_FAIR",
  MAX_MIN: "MAX_MIN",
  PRIORITY: "PRIORITY",
});

const DEFAULT_TOTAL_CAPACITY = 100;
const STARVATION_THRESHOLD_MS = 30_000; // 30 s without allocation
const DEFAULT_WEIGHT = 1;
const MIN_ALLOCATION = 1;               // at least 1 unit for every agent

// ---- FairScheduler ----

class FairScheduler {
  /**
   * @param {object} [options]
   * @param {number} [options.totalCapacity=100] — total resource units
   * @param {string} [options.algorithm='WEIGHTED_FAIR'] — scheduling algorithm
   * @param {number} [options.starvationThresholdMs=30000]
   * @param {string} [options.name]
   */
  constructor(options = {}) {
    this._totalCapacity = positiveInteger(options.totalCapacity, DEFAULT_TOTAL_CAPACITY);
    this._algorithm = Object.values(ALGORITHM).includes(options.algorithm)
      ? options.algorithm
      : ALGORITHM.WEIGHTED_FAIR;
    this._starvationThresholdMs = positiveInteger(
      options.starvationThresholdMs, STARVATION_THRESHOLD_MS
    );
    this._name = options.name || "fair-scheduler";

    // _agents[agentId] = { weight, priority, allocations, lastAllocated, totalGranted, isStarving }
    this._agents = {};

    // Pending requests: [{ agentId, resource, amount, timestamp }]
    this._pending = [];

    // Allocation history for starvation detection
    this._allocationHistory = [];
  }

  // ---- agent registration ----

  /**
   * Register an agent with the scheduler.
   *
   * @param {string}  agentId
   * @param {number}  [weight=1]    — relative weight for fair sharing
   * @param {number}  [priority=0]  — higher = more urgent (for PRIORITY algo)
   * @returns {FairScheduler}
   */
  addAgent(agentId, weight, priority) {
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new TypeError("addAgent: agentId must be a non-empty string");
    }

    this._agents[agentId] = {
      weight: positiveInteger(weight, DEFAULT_WEIGHT),
      priority: Number.isFinite(priority) ? Math.max(0, Math.floor(priority)) : 0,
      allocations: 0,
      lastAllocated: Date.now(),
      totalGranted: 0,
      isStarving: false,
    };

    debug("scheduler", `[${this._name}] registered agent "${agentId}" ` +
      `(weight=${this._agents[agentId].weight}, prio=${this._agents[agentId].priority})`);

    return this;
  }

  /**
   * Remove an agent from the scheduler. Rejected pending requests
   * are returned.
   *
   * @param {string} agentId
   * @returns {object[]} rejected requests
   */
  removeAgent(agentId) {
    const rejected = this._pending.filter((r) => r.agentId === agentId);
    this._pending = this._pending.filter((r) => r.agentId !== agentId);
    delete this._agents[agentId];
    return rejected;
  }

  /**
   * Update an agent's weight.
   *
   * @param {string} agentId
   * @param {number} weight
   */
  setWeight(agentId, weight) {
    this._validateAgent(agentId);
    this._agents[agentId].weight = positiveInteger(weight, DEFAULT_WEIGHT);
    return this;
  }

  /**
   * Update an agent's priority.
   *
   * @param {string} agentId
   * @param {number} priority
   */
  setPriority(agentId, priority) {
    this._validateAgent(agentId);
    this._agents[agentId].priority = Number.isFinite(priority)
      ? Math.max(0, Math.floor(priority))
      : 0;
    return this;
  }

  // ---- request & allocate ----

  /**
   * Request resource allocation for an agent. The request is queued
   * and will be satisfied on the next `allocate()` call.
   *
   * @param {string} agentId
   * @param {string} resource  — logical resource name (for tracking)
   * @param {number} amount    — units requested
   * @returns {{ requestId: number, accepted: boolean }}
   */
  request(agentId, resource, amount) {
    this._validateAgent(agentId);

    const amountNum = clampPositive(amount, 1);
    if (amountNum <= 0) {
      return { requestId: -1, accepted: false, reason: "Amount must be positive" };
    }

    const requestId = this._allocationHistory.length + this._pending.length;
    this._pending.push({
      agentId,
      resource,
      amount: amountNum,
      timestamp: Date.now(),
      requestId,
    });

    debug("scheduler",
      `[${this._name}] queued request #${requestId}: ` +
      `${agentId} wants ${amountNum} of ${resource}`);

    return { requestId, accepted: true };
  }

  /**
   * Run one allocation round. Distributes capacity among pending
   * agents according to the configured algorithm.
   *
   * @returns {{
   *   granted: Array<{ agentId: string, amount: number, requestId: number }>,
   *   remaining: number,
   *   starved: string[],
   *   round: number
   * }}
   */
  allocate() {
    if (this._pending.length === 0) {
      return { granted: [], remaining: this._totalCapacity, starved: [], round: 0 };
    }

    let granted;
    switch (this._algorithm) {
      case ALGORITHM.MAX_MIN:
        granted = this._allocateMaxMin();
        break;
      case ALGORITHM.PRIORITY:
        granted = this._allocatePriority();
        break;
      case ALGORITHM.WEIGHTED_FAIR:
      default:
        granted = this._allocateWeightedFair();
        break;
    }

    // Clear pending (all requests processed)
    this._pending = [];

    // Record round in history
    const round = this._allocationHistory.length + 1;
    this._allocationHistory.push({
      round,
      timestamp: Date.now(),
      granted: granted.map((g) => ({ agentId: g.agentId, amount: g.amount })),
    });

    // Detect starvation
    const starved = this._detectStarvation();

    // Update per-agent stats
    const now = Date.now();
    for (const g of granted) {
      if (this._agents[g.agentId]) {
        const agent = this._agents[g.agentId];
        agent.allocations += 1;
        agent.lastAllocated = now;
        agent.totalGranted += g.amount;
        agent.isStarving = false;
      }
    }

    const totalGranted = granted.reduce((sum, g) => sum + g.amount, 0);
    const remaining = Math.max(0, this._totalCapacity - totalGranted);

    debug("scheduler",
      `[${this._name}] round #${round}: granted=${totalGranted}, ` +
      `remaining=${remaining}, starved=[${starved.join(",")}]`);

    return { granted, remaining, starved, round };
  }

  // ---- query ----

  /**
   * Get current allocation info for an agent.
   *
   * @param {string} agentId
   * @returns {{
   *   weight: number,
   *   priority: number,
   *   allocations: number,
   *   lastAllocated: number,
   *   totalGranted: number,
   *   isStarving: boolean,
   *   fairShare: number
   * }}
   */
  getAllocation(agentId) {
    this._validateAgent(agentId);
    const agent = this._agents[agentId];
    const fairShare = this._computeFairShare(agentId);

    return {
      weight: agent.weight,
      priority: agent.priority,
      allocations: agent.allocations,
      lastAllocated: agent.lastAllocated,
      totalGranted: agent.totalGranted,
      isStarving: agent.isStarving,
      fairShare,
    };
  }

  /**
   * Predicted wait time in ms before an agent's next request
   * will be allocated. Heuristic based on queue depth, agent weight,
   * and capacity.
   *
   * @param {string} agentId
   * @returns {number} ms
   */
  getWaitTime(agentId) {
    this._validateAgent(agentId);

    if (this._pending.length === 0) {
      return 0;
    }

    const agent = this._agents[agentId];

    // Count how many requests are ahead of this agent
    const ahead = this._pending.filter((r) => r.agentId !== agentId).length;
    if (ahead === 0) return 0;

    // Rough heuristic: each "round" takes ~100 ms, weighted by queue/capacity ratio
    const totalRequested = this._pending.reduce((s, r) => s + r.amount, 0);
    const roundsNeeded = Math.ceil(totalRequested / this._totalCapacity);

    // Heavier agents get proportionally faster service
    const weightFactor = 1 / Math.max(1, agent.weight);

    return Math.ceil(ahead * 50 * weightFactor * roundsNeeded);
  }

  /**
   * Get a summary report of all agents and their allocations.
   *
   * @returns {object}
   */
  getReport() {
    const agents = {};
    for (const [id, agent] of Object.entries(this._agents)) {
      agents[id] = {
        weight: agent.weight,
        priority: agent.priority,
        totalGranted: agent.totalGranted,
        allocations: agent.allocations,
        isStarving: agent.isStarving,
        fairShare: this._computeFairShare(id),
        waitTimeMs: this.getWaitTime(id),
      };
    }

    return {
      algorithm: this._algorithm,
      totalCapacity: this._totalCapacity,
      pendingCount: this._pending.length,
      agents,
      starvedAgents: Object.keys(this._agents).filter((id) => this._agents[id].isStarving),
    };
  }

  /** Reset all agent stats while keeping registrations. */
  resetStats() {
    const now = Date.now();
    for (const id of Object.keys(this._agents)) {
      this._agents[id].allocations = 0;
      this._agents[id].lastAllocated = now;
      this._agents[id].totalGranted = 0;
      this._agents[id].isStarving = false;
    }
    this._pending = [];
    this._allocationHistory = [];
    return this;
  }

  /** @returns {number} */
  get totalCapacity() {
    return this._totalCapacity;
  }

  /** @returns {string} */
  get algorithm() {
    return this._algorithm;
  }

  /** @returns {number} */
  get pendingCount() {
    return this._pending.length;
  }

  // ---- allocation algorithms ----

  /**
   * Weighted Fair Queuing: distribute capacity proportional to agent weights.
   */
  _allocateWeightedFair() {
    const activeAgents = this._uniqueAgents();
    if (activeAgents.length === 0) return [];

    const totalWeight = activeAgents.reduce(
      (sum, id) => sum + this._agents[id].weight, 0
    );

    const granted = [];

    // Distribute proportional shares
    let remaining = this._totalCapacity;
    const allocations = {};

    for (const agentId of activeAgents) {
      const share = Math.floor(
        this._totalCapacity * (this._agents[agentId].weight / totalWeight)
      );
      allocations[agentId] = Math.max(MIN_ALLOCATION, share);
      remaining -= allocations[agentId];
    }

    // Distribute any remainder to the heaviest agent
    if (remaining > 0) {
      const heaviest = activeAgents.reduce((best, id) =>
        this._agents[id].weight > this._agents[best].weight ? id : best
      );
      allocations[heaviest] += remaining;
    }

    // Match allocations to pending requests
    const requestsByAgent = {};
    for (const req of this._pending) {
      if (!requestsByAgent[req.agentId]) {
        requestsByAgent[req.agentId] = [];
      }
      requestsByAgent[req.agentId].push(req);
    }

    for (const agentId of activeAgents) {
      const agentReqs = requestsByAgent[agentId] || [];
      let alloc = allocations[agentId] || 0;

      // Grant requests up to the allocation
      for (const req of agentReqs) {
        const grant = Math.min(req.amount, alloc);
        if (grant > 0) {
          granted.push({
            agentId,
            amount: grant,
            requestId: req.requestId,
          });
          alloc -= grant;
        }
        if (alloc <= 0) break;
      }
    }

    return granted;
  }

  /**
   * Max-Min Fairness: guarantee minimum allocation for each agent,
   * then distribute remaining capacity evenly among those who need more.
   */
  _allocateMaxMin() {
    const activeAgents = this._uniqueAgents();
    if (activeAgents.length === 0) return [];

    const agentReqs = {};
    let totalDemand = 0;

    for (const id of activeAgents) {
      const demand = this._pending
        .filter((r) => r.agentId === id)
        .reduce((s, r) => s + r.amount, 0);
      agentReqs[id] = demand;
      totalDemand += demand;
    }

    // If capacity exceeds total demand, grant everything
    if (totalDemand <= this._totalCapacity) {
      const granted = [];
      for (const req of this._pending) {
        granted.push({
          agentId: req.agentId,
          amount: req.amount,
          requestId: req.requestId,
        });
      }
      return granted;
    }

    // Max-min: equal share first, then redistribute unused
    let remaining = this._totalCapacity;
    const allocations = {};
    const unsatisfied = new Set(activeAgents);

    // Phase 1: provisional equal share
    const n = activeAgents.length;
    const fairShare = Math.floor(remaining / n);
    for (const id of activeAgents) {
      const alloc = Math.min(agentReqs[id], Math.max(MIN_ALLOCATION, fairShare));
      allocations[id] = alloc;
      remaining -= alloc;
      if (alloc >= agentReqs[id]) {
        unsatisfied.delete(id);
      }
    }

    // Phase 2: redistribute surplus to unsatisfied agents
    while (remaining > 0 && unsatisfied.size > 0) {
      const share = Math.max(1, Math.floor(remaining / unsatisfied.size));
      let progress = false;

      for (const id of [...unsatisfied]) {
        const need = agentReqs[id] - allocations[id];
        if (need <= 0) {
          unsatisfied.delete(id);
          continue;
        }
        const give = Math.min(need, share);
        allocations[id] += give;
        remaining -= give;
        progress = true;
      }

      if (!progress) break;
    }

    // Build granted list from pending
    const granted = [];
    const agentAllocs = {};
    for (const id of activeAgents) {
      agentAllocs[id] = allocations[id] || 0;
    }

    for (const req of this._pending) {
      let alloc = agentAllocs[req.agentId] || 0;
      const grant = Math.min(req.amount, alloc);
      if (grant > 0) {
        granted.push({
          agentId: req.agentId,
          amount: grant,
          requestId: req.requestId,
        });
        agentAllocs[req.agentId] -= grant;
      }
    }

    return granted;
  }

  /**
   * Priority-based: higher priority agents get served first up to
   * their full request, then remaining capacity cascades down.
   */
  _allocatePriority() {
    const activeAgents = this._uniqueAgents();
    if (activeAgents.length === 0) return [];

    // Sort by priority desc, then by request time asc
    const agentReqs = {};
    for (const id of activeAgents) {
      agentReqs[id] = this._pending
        .filter((r) => r.agentId === id)
        .reduce((s, r) => s + r.amount, 0);
    }

    const sorted = activeAgents.sort((a, b) => {
      const pdiff = this._agents[b].priority - this._agents[a].priority;
      if (pdiff !== 0) return pdiff;
      // Same priority — earlier request first
      const aTime = Math.min(
        ...this._pending.filter((r) => r.agentId === a).map((r) => r.timestamp)
      );
      const bTime = Math.min(
        ...this._pending.filter((r) => r.agentId === b).map((r) => r.timestamp)
      );
      return aTime - bTime;
    });

    const granted = [];
    let remaining = this._totalCapacity;

    for (const agentId of sorted) {
      if (remaining <= 0) break;

      const requests = this._pending.filter((r) => r.agentId === agentId);
      for (const req of requests) {
        const grant = Math.min(req.amount, remaining);
        if (grant > 0) {
          granted.push({
            agentId: req.agentId,
            amount: grant,
            requestId: req.requestId,
          });
          remaining -= grant;
        }
        if (remaining <= 0) break;
      }
    }

    return granted;
  }

  // ---- starvation detection ----

  _detectStarvation() {
    const now = Date.now();
    const starved = [];

    for (const [id, agent] of Object.entries(this._agents)) {
      const waited = now - agent.lastAllocated;

      // Agent has pending requests but hasn't been served
      const hasPending = this._pending.some((r) => r.agentId === id);
      const recentlyAllocated = this._allocationHistory.length > 0 &&
        this._allocationHistory[this._allocationHistory.length - 1]
          .granted.some((g) => g.agentId === id);

      if ((waited > this._starvationThresholdMs && !recentlyAllocated) ||
          (hasPending && waited > this._starvationThresholdMs)) {
        agent.isStarving = true;
        starved.push(id);
        debug("scheduler",
          `[${this._name}] STARVATION: agent "${id}" waited ${waited}ms`);
      }
    }

    return starved;
  }

  // ---- private helpers ----

  _uniqueAgents() {
    const seen = new Set();
    for (const req of this._pending) {
      if (this._agents[req.agentId]) {
        seen.add(req.agentId);
      }
    }
    return [...seen];
  }

  _computeFairShare(agentId) {
    if (!this._agents[agentId]) return 0;
    const totalWeight = Object.values(this._agents).reduce(
      (s, a) => s + a.weight, 0
    );
    if (totalWeight === 0) return 0;
    return Math.floor(
      this._totalCapacity * (this._agents[agentId].weight / totalWeight)
    );
  }

  _validateAgent(agentId) {
    if (!this._agents[agentId]) {
      throw new Error(`Unknown agent "${agentId}". Register it with addAgent() first.`);
    }
  }
}

// ---- helpers ----

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clampPositive(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

// ---- exports ----

module.exports = {
  FairScheduler,
  ALGORITHM,
};
