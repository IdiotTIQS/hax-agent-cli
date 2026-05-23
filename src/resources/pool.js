"use strict";

const { debug } = require('../debug');

/**
 * ResourcePool — manages shared resource pools with fair allocation,
 * priority support, wait queuing, and utilization tracking.
 *
 * Each pool tracks:
 *   - total capacity
 *   - currently allocated amount
 *   - wait queue of agents requesting resources
 *   - per-agent allocations and usage history
 *
 * Fair allocation policies:
 *   FAIR         — equal share among all waiting agents
 *   PRIORITY     — higher priority agents served first
 *   FIRST_COME   — FIFO ordering
 */

const POLICY = Object.freeze({
  FAIR: "FAIR",
  PRIORITY: "PRIORITY",
  FIRST_COME: "FIRST_COME",
});

const DEFAULT_POLICY = POLICY.FAIR;
const DEFAULT_CAPACITY = 100;

// ---- ResourcePool ----

class ResourcePool {
  /**
   * @param {object} [options]
   * @param {string} [options.defaultPolicy='FAIR'] — default allocation policy
   * @param {number} [options.starvationTimeoutMs=60000] — time before starvation is declared
   * @param {string} [options.name]
   */
  constructor(options = {}) {
    this._defaultPolicy = Object.values(POLICY).includes(options.defaultPolicy)
      ? options.defaultPolicy
      : DEFAULT_POLICY;
    this._starvationTimeoutMs = positiveInteger(options.starvationTimeoutMs, 60000);
    this._name = options.name || "resource-pool-mgr";

    // _pools[name] = {
    //   capacity, type, policy, allocated, available,
    //   agents: { agentId: { allocated, priority, lastAcquired } },
    //   waitQueue: [{ agentId, amount, requestedAt, priority }],
    //   history: [{ agentId, amount, action, timestamp }]
    // }
    this._pools = {};

    // Global stats
    this._totalCreated = 0;
    this._totalAcquired = 0;
    this._totalReleased = 0;
    this._totalWaitTimeouts = 0;
  }

  // ---- pool creation ----

  /**
   * Create a named resource pool.
   *
   * @param {string}  name     — unique pool name
   * @param {number}  capacity — total capacity of the pool
   * @param {string}  [type]   — resource type (tokens, memory, etc.)
   * @param {object}  [options]
   * @param {string}  [options.policy] — allocation policy for this pool
   * @returns {ResourcePool}
   */
  createPool(name, capacity, type, options = {}) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("createPool: name must be a non-empty string");
    }
    if (this._pools[name]) {
      throw new Error(`Pool "${name}" already exists. Remove it first or use a different name.`);
    }

    const cap = positiveInteger(capacity, DEFAULT_CAPACITY);
    const policy = Object.values(POLICY).includes(options.policy)
      ? options.policy
      : this._defaultPolicy;

    this._pools[name] = {
      capacity: cap,
      type: type || "generic",
      policy,
      allocated: 0,
      available: cap,
      agents: {},
      waitQueue: [],
      history: [],
      createdAt: Date.now(),
    };

    this._totalCreated += 1;

    debug("pool", `[${this._name}] created pool "${name}" (cap=${cap}, type=${type || "generic"}, policy=${policy})`);

    return this;
  }

  /**
   * Remove a pool. All wait queue entries are rejected.
   *
   * @param {string} name
   * @returns {{ removed: boolean, rejectedWaiters: number }}
   */
  removePool(name) {
    this._validatePool(name);
    const pool = this._pools[name];
    const rejectedWaiters = pool.waitQueue.length;
    delete this._pools[name];

    debug("pool", `[${this._name}] removed pool "${name}", rejected ${rejectedWaiters} waiters`);

    return { removed: true, rejectedWaiters };
  }

  // ---- resource acquisition ----

  /**
   * Acquire resources from a pool for an agent.
   *
   * If resources are available, they are granted immediately.
   * Otherwise the agent is placed in the wait queue (unless
   * options.noWait is true, in which case the request is rejected).
   *
   * @param {string}  poolName
   * @param {string}  agentId
   * @param {number}  amount    — amount to acquire
   * @param {object}  [options]
   * @param {number}  [options.priority=0] — agent priority for PRIORITY policy
   * @param {boolean} [options.noWait=false] — reject instead of queuing
   * @returns {{
   *   granted: boolean,
   *   amount: number,
   *   remaining: number,
   *   waitPosition?: number,
   *   reason?: string
   * }}
   */
  acquire(poolName, agentId, amount, options = {}) {
    this._validatePool(poolName);
    this._validateAgentId(agentId);

    const pool = this._pools[poolName];
    const amountNum = clampPositive(amount, 1);
    const priority = Number.isFinite(options.priority) ? Math.max(0, Math.floor(options.priority)) : 0;

    if (amountNum <= 0) {
      return { granted: false, amount: 0, remaining: pool.available, reason: "Amount must be positive" };
    }

    // Initialize agent tracking if needed
    if (!pool.agents[agentId]) {
      pool.agents[agentId] = { allocated: 0, priority, lastAcquired: Date.now() };
    } else {
      // Update priority if provided
      if (options.priority !== undefined) {
        pool.agents[agentId].priority = priority;
      }
    }

    // Try to grant immediately
    if (amountNum <= pool.available) {
      pool.allocated += amountNum;
      pool.available -= amountNum;
      pool.agents[agentId].allocated += amountNum;
      pool.agents[agentId].lastAcquired = Date.now();
      pool.history.push({
        agentId,
        amount: amountNum,
        action: "acquire",
        timestamp: Date.now(),
      });

      this._totalAcquired += amountNum;

      debug("pool",
        `[${this._name}] "${agentId}" acquired ${amountNum} from "${poolName}" ` +
        `(remaining=${pool.available}/${pool.capacity})`);

      return {
        granted: true,
        amount: amountNum,
        remaining: pool.available,
      };
    }

    // Not enough available — reject or queue
    if (options.noWait) {
      return {
        granted: false,
        amount: 0,
        remaining: pool.available,
        reason: `Insufficient resources: requested ${amountNum}, available ${pool.available}`,
        waitPosition: -1,
      };
    }

    // Add to wait queue
    const waitEntry = {
      agentId,
      amount: amountNum,
      requestedAt: Date.now(),
      priority,
    };

    pool.waitQueue.push(waitEntry);

    // Sort queue according to policy
    this._sortWaitQueue(pool);

    const position = pool.waitQueue.indexOf(waitEntry) + 1;

    debug("pool",
      `[${this._name}] "${agentId}" queued for ${amountNum} from "${poolName}" ` +
      `(position=${position}, queue depth=${pool.waitQueue.length})`);

    return {
      granted: false,
      amount: 0,
      remaining: pool.available,
      waitPosition: position,
      reason: `Queued: insufficient resources (need ${amountNum}, have ${pool.available})`,
    };
  }

  // ---- resource release ----

  /**
   * Release resources back to a pool from an agent.
   *
   * After releasing, the pool attempts to satisfy waiting agents
   * from the newly available resources.
   *
   * @param {string} poolName
   * @param {string} agentId
   * @param {number} amount    — amount to release
   * @returns {{
   *   released: number,
   *   remaining: number,
   *   waitersSatisfied: number
   * }}
   */
  release(poolName, agentId, amount) {
    this._validatePool(poolName);
    this._validateAgentId(agentId);

    const pool = this._pools[poolName];
    const amountNum = clampPositive(amount, 1);

    if (amountNum <= 0) {
      return { released: 0, remaining: pool.available, waitersSatisfied: 0 };
    }

    // Clamp to what the agent actually holds
    const agentInfo = pool.agents[agentId] || { allocated: 0 };
    const actualRelease = Math.min(amountNum, agentInfo.allocated);

    // Update pool
    pool.allocated = Math.max(0, pool.allocated - actualRelease);
    pool.available = Math.min(pool.capacity, pool.available + actualRelease);

    if (pool.agents[agentId]) {
      pool.agents[agentId].allocated = Math.max(0, pool.agents[agentId].allocated - actualRelease);
    }

    pool.history.push({
      agentId,
      amount: actualRelease,
      action: "release",
      timestamp: Date.now(),
    });

    this._totalReleased += actualRelease;

    // Try to satisfy waiting agents
    const waitersSatisfied = this._satisfyWaiters(poolName);

    debug("pool",
      `[${this._name}] "${agentId}" released ${actualRelease} to "${poolName}" ` +
      `(available=${pool.available}/${pool.capacity}, satisfied=${waitersSatisfied})`);

    return {
      released: actualRelease,
      remaining: pool.available,
      waitersSatisfied,
    };
  }

  /**
   * Force-satisfy waiters from the pool's available resources.
   * Typically called automatically after release(), but can be
   * invoked manually if pool capacity is increased.
   *
   * @param {string} poolName
   * @returns {number} waiters satisfied
   */
  satisfyWaiters(poolName) {
    this._validatePool(poolName);
    return this._satisfyWaiters(poolName);
  }

  // ---- pool management ----

  /**
   * Increase or decrease pool capacity.
   * If increased, attempts to satisfy waiters.
   * If decreased below current allocation, the reduction is capped.
   *
   * @param {string} poolName
   * @param {number} newCapacity
   * @returns {{ previous: number, current: number, waitersSatisfied: number }}
   */
  setCapacity(poolName, newCapacity) {
    this._validatePool(poolName);

    const pool = this._pools[poolName];
    const newCap = positiveInteger(newCapacity, pool.capacity);
    const previous = pool.capacity;

    if (newCap < pool.allocated) {
      // Can't reduce below current allocation
      pool.capacity = pool.allocated;
      pool.available = 0;
    } else {
      pool.capacity = newCap;
      pool.available = newCap - pool.allocated;
    }

    // Try to satisfy waiters if capacity increased
    const waitersSatisfied = newCap > previous ? this._satisfyWaiters(poolName) : 0;

    debug("pool", `[${this._name}] pool "${poolName}" capacity: ${previous} -> ${pool.capacity}`);

    return { previous, current: pool.capacity, waitersSatisfied };
  }

  /**
   * Set the allocation policy for a specific pool.
   *
   * @param {string} poolName
   * @param {string} policy — 'FAIR' | 'PRIORITY' | 'FIRST_COME'
   * @returns {ResourcePool}
   */
  setPolicy(poolName, policy) {
    this._validatePool(poolName);
    if (!Object.values(POLICY).includes(policy)) {
      throw new Error(`Invalid policy "${policy}". Valid: ${Object.values(POLICY).join(", ")}`);
    }
    this._pools[poolName].policy = policy;
    this._sortWaitQueue(this._pools[poolName]);
    return this;
  }

  // ---- query ----

  /**
   * Get utilization stats for a pool or all pools.
   *
   * @param {string} [poolName] — omit for aggregate stats
   * @returns {object}
   */
  getUtilization(poolName) {
    if (poolName) {
      this._validatePool(poolName);
      return this._poolUtilization(this._pools[poolName], poolName);
    }

    // Aggregate across all pools
    const pools = {};
    let totalCapacity = 0;
    let totalAllocated = 0;
    let totalWaiters = 0;
    let totalAgents = 0;

    for (const [name, pool] of Object.entries(this._pools)) {
      pools[name] = this._poolUtilization(pool, name);
      totalCapacity += pool.capacity;
      totalAllocated += pool.allocated;
      totalWaiters += pool.waitQueue.length;
      totalAgents += Object.keys(pool.agents).length;
    }

    return {
      pools,
      aggregate: {
        poolCount: Object.keys(this._pools).length,
        totalCapacity,
        totalAllocated,
        totalAvailable: totalCapacity - totalAllocated,
        totalWaiters,
        totalAgents: Object.keys(this._aggregateAgents()).length,
        utilizationPercent: totalCapacity > 0
          ? parseFloat(((totalAllocated / totalCapacity) * 100).toFixed(1))
          : 0,
      },
    };
  }

  /**
   * Get the wait queue for a specific pool.
   *
   * @param {string} poolName
   * @returns {Array<{ agentId: string, amount: number, requestedAt: number, priority: number, position: number }>}
   */
  getWaitQueue(poolName) {
    this._validatePool(poolName);
    const pool = this._pools[poolName];

    return pool.waitQueue.map((entry, idx) => ({
      agentId: entry.agentId,
      amount: entry.amount,
      requestedAt: entry.requestedAt,
      priority: entry.priority,
      position: idx + 1,
    }));
  }

  /**
   * Get allocation info for a specific agent across all pools or a specific pool.
   *
   * @param {string} agentId
   * @param {string} [poolName]
   * @returns {object}
   */
  getAgentAllocation(agentId, poolName) {
    if (poolName) {
      this._validatePool(poolName);
      const pool = this._pools[poolName];
      const agent = pool.agents[agentId];
      if (!agent) {
        return { agentId, poolName, allocated: 0, waiting: false };
      }
      const waiting = pool.waitQueue.filter((w) => w.agentId === agentId).length;
      return {
        agentId,
        poolName,
        allocated: agent.allocated,
        priority: agent.priority,
        lastAcquired: agent.lastAcquired,
        waiting: waiting > 0,
        waitEntries: waiting,
      };
    }

    // Across all pools
    const pools = {};
    let totalAllocated = 0;
    for (const [name, pool] of Object.entries(this._pools)) {
      const agent = pool.agents[agentId];
      if (agent && agent.allocated > 0) {
        pools[name] = { allocated: agent.allocated };
        totalAllocated += agent.allocated;
      }
    }

    return { agentId, pools, totalAllocated };
  }

  /**
   * Check if an agent is currently waiting on any pool.
   *
   * @param {string} agentId
   * @returns {boolean}
   */
  isWaiting(agentId) {
    for (const pool of Object.values(this._pools)) {
      if (pool.waitQueue.some((w) => w.agentId === agentId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel all wait queue entries for an agent and release their allocations.
   *
   * @param {string} agentId
   * @returns {{ canceled: number, released: number }}
   */
  cancelAgent(agentId) {
    let canceled = 0;
    let released = 0;

    for (const [name, pool] of Object.entries(this._pools)) {
      // Remove from wait queue
      const before = pool.waitQueue.length;
      pool.waitQueue = pool.waitQueue.filter((w) => w.agentId !== agentId);
      canceled += before - pool.waitQueue.length;

      // Release all allocations
      if (pool.agents[agentId] && pool.agents[agentId].allocated > 0) {
        const result = this.release(name, agentId, pool.agents[agentId].allocated);
        released += result.released;
      }
    }

    return { canceled, released };
  }

  /**
   * Get a summary report of all pools.
   *
   * @returns {object}
   */
  getReport() {
    const pools = {};
    for (const [name, pool] of Object.entries(this._pools)) {
      pools[name] = {
        type: pool.type,
        policy: pool.policy,
        capacity: pool.capacity,
        allocated: pool.allocated,
        available: pool.available,
        agentCount: Object.keys(pool.agents).length,
        waitQueueDepth: pool.waitQueue.length,
        utilization: pool.capacity > 0
          ? parseFloat(((pool.allocated / pool.capacity) * 100).toFixed(1))
          : 0,
      };
    }

    return {
      name: this._name,
      totalPools: Object.keys(this._pools).length,
      totalCreated: this._totalCreated,
      totalAcquired: this._totalAcquired,
      totalReleased: this._totalReleased,
      pools,
    };
  }

  // ---- statistics ----

  /** @returns {{ totalAcquired: number, totalReleased: number, totalCreated: number }} */
  getStats() {
    return {
      totalAcquired: this._totalAcquired,
      totalReleased: this._totalReleased,
      totalCreated: this._totalCreated,
    };
  }

  /** Reset all pools, clearing allocations and wait queues. */
  reset() {
    for (const [name, pool] of Object.entries(this._pools)) {
      pool.allocated = 0;
      pool.available = pool.capacity;
      pool.agents = {};
      pool.waitQueue = [];
      pool.history = [];
    }
    this._totalAcquired = 0;
    this._totalReleased = 0;
    return this;
  }

  /** @returns {number} */
  get poolCount() {
    return Object.keys(this._pools).length;
  }

  // ---- private helpers ----

  _satisfyWaiters(poolName) {
    const pool = this._pools[poolName];
    if (pool.waitQueue.length === 0 || pool.available <= 0) {
      return 0;
    }

    this._sortWaitQueue(pool);

    let satisfied = 0;
    const newQueue = [];

    for (const entry of pool.waitQueue) {
      if (entry.amount <= pool.available) {
        // Grant the request
        pool.allocated += entry.amount;
        pool.available -= entry.amount;

        if (!pool.agents[entry.agentId]) {
          pool.agents[entry.agentId] = {
            allocated: 0,
            priority: entry.priority,
            lastAcquired: Date.now(),
          };
        }
        pool.agents[entry.agentId].allocated += entry.amount;
        pool.agents[entry.agentId].lastAcquired = Date.now();

        pool.history.push({
          agentId: entry.agentId,
          amount: entry.amount,
          action: "acquire",
          timestamp: Date.now(),
        });

        this._totalAcquired += entry.amount;
        satisfied += 1;
      } else {
        newQueue.push(entry);
      }
    }

    pool.waitQueue = newQueue;

    return satisfied;
  }

  _sortWaitQueue(pool) {
    switch (pool.policy) {
      case POLICY.PRIORITY:
        pool.waitQueue.sort((a, b) => b.priority - a.priority || a.requestedAt - b.requestedAt);
        break;
      case POLICY.FAIR:
        // Sort by least-recently-served first, then amount ascending
        pool.waitQueue.sort((a, b) => {
          const aLast = (pool.agents[a.agentId] || {}).lastAcquired || 0;
          const bLast = (pool.agents[b.agentId] || {}).lastAcquired || 0;
          if (aLast !== bLast) return aLast - bLast;
          return a.amount - b.amount;
        });
        break;
      case POLICY.FIRST_COME:
      default:
        pool.waitQueue.sort((a, b) => a.requestedAt - b.requestedAt);
        break;
    }
  }

  _poolUtilization(pool, name) {
    return {
      name,
      type: pool.type,
      policy: pool.policy,
      capacity: pool.capacity,
      allocated: pool.allocated,
      available: pool.available,
      utilization: pool.capacity > 0
        ? parseFloat(((pool.allocated / pool.capacity) * 100).toFixed(1))
        : 0,
      agentCount: Object.keys(pool.agents).length,
      waitQueueDepth: pool.waitQueue.length,
    };
  }

  _aggregateAgents() {
    const agents = new Set();
    for (const pool of Object.values(this._pools)) {
      for (const agentId of Object.keys(pool.agents)) {
        agents.add(agentId);
      }
    }
    return [...agents];
  }

  _validatePool(poolName) {
    if (!this._pools[poolName]) {
      throw new Error(
        `Unknown pool "${poolName}". Create it with createPool() first.`
      );
    }
  }

  _validateAgentId(agentId) {
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new TypeError("agentId must be a non-empty string");
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
  ResourcePool,
  POLICY,
};
