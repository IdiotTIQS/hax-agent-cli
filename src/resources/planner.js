"use strict";

const { debug } = require('../debug');

/**
 * ResourcePlanner — plans resource allocation for agent tasks by
 * estimating needs, creating allocation plans, optimizing distribution,
 * and detecting bottlenecks across six tracked resource dimensions:
 *
 *   tokens, apiCalls, toolExecutions, time, memory, disk
 *
 * The planner can operate in several strategies:
 *   GREEDY  — allocate to highest-priority task first
 *   BALANCED — distribute resources evenly among tasks
 *   EFFICIENCY — minimize waste by packing tasks efficiently
 */

const STRATEGY = Object.freeze({
  GREEDY: "GREEDY",
  BALANCED: "BALANCED",
  EFFICIENCY: "EFFICIENCY",
});

const RESOURCE_TYPES = Object.freeze([
  "tokens",
  "apiCalls",
  "toolExecutions",
  "time",
  "memory",
  "disk",
]);

const TASK_COMPLEXITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const DEFAULT_STRATEGY = STRATEGY.BALANCED;

// ---- ResourcePlanner ----

class ResourcePlanner {
  /**
   * @param {object} [options]
   * @param {string} [options.strategy='BALANCED'] — allocation strategy
   * @param {object} [options.resourceDefaults]   — default resource pool sizes
   * @param {string} [options.name]
   */
  constructor(options = {}) {
    this._strategy = Object.values(STRATEGY).includes(options.strategy)
      ? options.strategy
      : DEFAULT_STRATEGY;
    this._name = options.name || "resource-planner";

    this._resourceDefaults = Object.assign(
      {
        tokens: 100000,
        apiCalls: 100,
        toolExecutions: 50,
        time: 300000,     // 5 minutes in ms
        memory: 2048,     // MB
        disk: 1024,       // MB
      },
      options.resourceDefaults || {}
    );

    // _plans[planId] = { tasks, resources, allocations, strategy, timestamp, metadata }
    this._plans = {};

    // _estimates[taskType] = { tokens, apiCalls, toolExecutions, time, memory, disk }
    // Learned over time from actual usage vs estimates
    this._estimates = {};

    // Historical accuracy tracking: { taskType: { over: number, under: number, samples: number } }
    this._accuracy = {};
  }

  // ---- strategy ----

  /**
   * Set the allocation strategy.
   *
   * @param {string} strategy — 'GREEDY' | 'BALANCED' | 'EFFICIENCY'
   * @returns {ResourcePlanner}
   */
  setStrategy(strategy) {
    if (!Object.values(STRATEGY).includes(strategy)) {
      throw new Error(
        `Invalid strategy "${strategy}". Valid: ${Object.values(STRATEGY).join(", ")}`
      );
    }
    this._strategy = strategy;
    return this;
  }

  /** @returns {string} */
  get strategy() {
    return this._strategy;
  }

  // ---- planning ----

  /**
   * Create a resource allocation plan for a set of tasks.
   *
   * Each task is an object:
   *   { id: string, type?: string, priority?: number, complexity?: string,
   *     estimatedDuration?: number, agentId?: string }
   *
   * Resources is an object with available pools:
   *   { tokens: number, apiCalls: number, toolExecutions: number,
   *     time: number, memory: number, disk: number }
   *
   * @param {object[]} tasks     — array of task descriptors
   * @param {object}   resources — available resource pool sizes
   * @returns {{
   *   planId: string,
   *   tasks: number,
   *   totalAllocated: object,
   *   unallocated: number,
   *   allocations: object[],
   *   bottlenecks: object[],
   *   utilization: object,
   *   strategy: string,
   *   timestamp: number
   * }}
   */
  plan(tasks, resources) {
    if (!Array.isArray(tasks)) {
      throw new TypeError("plan: tasks must be an array");
    }
    if (!resources || typeof resources !== "object") {
      throw new TypeError("plan: resources must be an object");
    }

    const pool = this._normalizeResourcePool(resources);
    const normalizedTasks = tasks.map((t, i) => this._normalizeTask(t, i));

    // Estimate needs for each task
    const estimates = normalizedTasks.map((t) => ({
      task: t,
      needs: this.estimateNeeds(t),
    }));

    // Allocate according to strategy
    let allocations;
    switch (this._strategy) {
      case STRATEGY.EFFICIENCY:
        allocations = this._allocateEfficient(estimates, pool);
        break;
      case STRATEGY.GREEDY:
        allocations = this._allocateGreedy(estimates, pool);
        break;
      case STRATEGY.BALANCED:
      default:
        allocations = this._allocateBalanced(estimates, pool);
        break;
    }

    // Compute total allocated resources
    const totalAllocated = this._sumAllocations(allocations);

    // Calculate utilization
    const utilization = {};
    for (const r of RESOURCE_TYPES) {
      utilization[r] = pool[r] > 0
        ? parseFloat(((totalAllocated[r] || 0) / pool[r] * 100).toFixed(1))
        : 0;
    }

    // Detect bottlenecks
    const bottlenecks = this.detectBottlenecks({
      allocations,
      resources: pool,
      totalAllocated,
    });

    const planId = `plan-${Date.now()}-${Object.keys(this._plans).length + 1}`;

    const plan = {
      planId,
      tasks: normalizedTasks.length,
      totalAllocated,
      unallocated: normalizedTasks.length - allocations.filter((a) => a.granted).length,
      resources: { ...pool },
      allocations,
      bottlenecks,
      utilization,
      strategy: this._strategy,
      timestamp: Date.now(),
    };

    // Store plan
    this._plans[planId] = plan;

    // Optimize
    const optimized = this.optimizeAllocation(plan);
    this._plans[planId] = optimized;

    debug("planner",
      `[${this._name}] created plan ${planId}: ${allocations.length}/${normalizedTasks.length} tasks, ` +
      `strategy=${this._strategy}, bottlenecks=${bottlenecks.length}`);

    return optimized;
  }

  // ---- estimation ----

  /**
   * Estimate the resources needed for a task.
   *
   * Uses task properties (type, complexity, estimatedDuration) to compute
   * expected resource consumption. Falls back to learned estimates
   * for known task types, and uses complexity-based defaults otherwise.
   *
   * @param {object} task — task descriptor
   * @returns {{
   *   tokens: number,
   *   apiCalls: number,
   *   toolExecutions: number,
   *   time: number,
   *   memory: number,
   *   disk: number,
   *   totalCost: number,
   *   confidence: number
   * }}
   */
  estimateNeeds(task) {
    const t = this._normalizeTask(task);

    // If task type has a learned estimate, use it
    if (t.type && this._estimates[t.type]) {
      const est = this._estimates[t.type];
      const confidence = this._accuracy[t.type]
        ? Math.min(1, this._accuracy[t.type].samples / 10)
        : 0.5;

      return {
        tokens: est.tokens,
        apiCalls: est.apiCalls,
        toolExecutions: est.toolExecutions,
        time: est.time,
        memory: est.memory,
        disk: est.disk,
        totalCost: this._computeTotalCost(est),
        confidence,
      };
    }

    // Use complexity-based defaults
    const base = this._complexityDefaults(t.complexity);

    // Adjust by priority (higher priority tasks tend to require more)
    const prioMult = 1 + (t.priority || 0) * 0.1;

    const est = {
      tokens: Math.ceil(base.tokens * prioMult),
      apiCalls: Math.ceil(base.apiCalls * prioMult),
      toolExecutions: Math.ceil(base.toolExecutions * prioMult),
      time: Math.ceil(base.time * prioMult),
      memory: Math.ceil(base.memory * prioMult),
      disk: Math.ceil(base.disk * prioMult),
    };

    return {
      ...est,
      totalCost: this._computeTotalCost(est),
      confidence: 0.3,
    };
  }

  /**
   * Register a learned estimate for a task type. As actual execution
   * data comes in, this improves future estimates.
   *
   * @param {string} taskType
   * @param {object} actualUsage — { tokens, apiCalls, toolExecutions, time, memory, disk }
   * @returns {ResourcePlanner}
   */
  learn(taskType, actualUsage) {
    if (!taskType || typeof taskType !== "string") {
      throw new TypeError("learn: taskType must be a non-empty string");
    }

    const actual = this._normalizeResourceEstimate(actualUsage);

    if (this._estimates[taskType]) {
      // Exponential moving average: 70% old, 30% new
      const old = this._estimates[taskType];
      for (const r of RESOURCE_TYPES) {
        this._estimates[taskType][r] = Math.ceil(old[r] * 0.7 + (actual[r] || 0) * 0.3);
      }
    } else {
      this._estimates[taskType] = { ...actual };
    }

    // Track accuracy
    if (!this._accuracy[taskType]) {
      this._accuracy[taskType] = { over: 0, under: 0, samples: 0 };
    }

    const prev = this._estimates[taskType];
    for (const r of RESOURCE_TYPES) {
      if ((actual[r] || 0) > prev[r]) {
        this._accuracy[taskType].over += 1;
      } else {
        this._accuracy[taskType].under += 1;
      }
    }
    this._accuracy[taskType].samples += 1;

    debug("planner", `[${this._name}] learned usage for task type "${taskType}"`);

    return this;
  }

  // ---- optimization ----

  /**
   * Optimize an existing allocation plan. Applies rebalancing,
   * overcommitment reduction, and resource packing depending on the
   * current strategy.
   *
   * @param {object} plan — as returned by plan()
   * @returns {object} optimized plan
   */
  optimizeAllocation(plan) {
    if (!plan || !plan.allocations || !plan.totalAllocated) {
      throw new TypeError("optimizeAllocation: invalid plan object");
    }

    const optimized = JSON.parse(JSON.stringify(plan));
    const allocs = optimized.allocations;

    // Step 1: Reduce over-allocations (allocated > needed) to free resources
    for (const a of allocs) {
      if (!a.granted) continue;
      for (const r of RESOURCE_TYPES) {
        if (a.allocated[r] > a.needed[r]) {
          a.allocated[r] = a.needed[r];
          a.waste = (a.waste || 0) + (a.allocated[r] - a.needed[r]);
        }
      }
    }

    // Step 2: Reclaim from unallocated tasks
    let reclaimed = { tokens: 0, apiCalls: 0, toolExecutions: 0, time: 0, memory: 0, disk: 0 };
    for (const a of allocs) {
      if (!a.granted) {
        for (const r of RESOURCE_TYPES) {
          reclaimed[r] = (reclaimed[r] || 0) + (a.needed[r] || 0);
        }
      }
    }

    // Step 3: Try to fit unallocated tasks with reclaimed + unused resources
    const resources = optimized.resources || {};
    const remaining = {};
    for (const r of RESOURCE_TYPES) {
      remaining[r] = Math.max(0,
        (resources[r] || 0) - (optimized.totalAllocated[r] || 0) + (reclaimed[r] || 0)
      );
    }

    // Step 4: Pack unallocated tasks where possible (for EFFICIENCY strategy)
    if (this._strategy === STRATEGY.EFFICIENCY) {
      const unallocated = allocs.filter((a) => !a.granted);
      for (const a of unallocated) {
        const fits = RESOURCE_TYPES.every((r) => (a.needed[r] || 0) <= (remaining[r] || 0));
        if (fits) {
          for (const r of RESOURCE_TYPES) {
            const need = a.needed[r] || 0;
            a.allocated[r] = need;
            remaining[r] -= need;
          }
          a.granted = true;
        }
      }
    }

    // Recompute total allocated
    optimized.totalAllocated = this._sumAllocations(allocs);

    // Update unallocated count
    optimized.unallocated = allocs.filter((a) => !a.granted).length;

    // Recalculate utilization
    optimized.utilization = {};
    for (const r of RESOURCE_TYPES) {
      optimized.utilization[r] = (resources[r] || 0) > 0
        ? parseFloat(((optimized.totalAllocated[r] || 0) / (resources[r] || 1) * 100).toFixed(1))
        : 0;
    }

    // Re-detect bottlenecks
    optimized.bottlenecks = this.detectBottlenecks(optimized);

    optimized.optimized = true;
    optimized.optimizedAt = Date.now();

    if (plan.planId && this._plans[plan.planId]) {
      this._plans[plan.planId] = optimized;
    }

    debug("planner", `[${this._name}] optimized plan ${plan.planId || "inline"}`);

    return optimized;
  }

  // ---- bottleneck detection ----

  /**
   * Detect resource bottlenecks in an allocation plan.
   * A bottleneck exists when demand exceeds available capacity,
   * or when utilization of a resource approaches 100%.
   *
   * @param {object} plan — plan object with allocations and resources
   * @returns {Array<{
   *   resource: string,
   *   severity: string,       // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
   *   demand: number,
   *   capacity: number,
   *   utilization: number,    // percent
   *   shortfall: number,
   *   constrainedTasks: number,
   *   suggestion: string
   * }>}
   */
  detectBottlenecks(plan) {
    if (!plan || !plan.allocations || !plan.resources) {
      return [];
    }

    const bottlenecks = [];
    const resources = plan.resources;
    const allocations = plan.allocations || [];

    for (const r of RESOURCE_TYPES) {
      const capacity = resources[r] || 0;
      if (capacity === 0) continue;

      // Sum demand from all tasks
      let demand = 0;
      for (const a of allocations) {
        demand += (a.needed && a.needed[r]) ? a.needed[r] : 0;
      }

      const utilization = parseFloat(((demand / capacity) * 100).toFixed(1));
      const shortfall = Math.max(0, demand - capacity);

      // Determine severity
      let severity = "LOW";
      if (utilization >= 95) {
        severity = "CRITICAL";
      } else if (utilization >= 80) {
        severity = "HIGH";
      } else if (utilization >= 60) {
        severity = "MEDIUM";
      }

      // Only flag if utilization is meaningful (> 30% or there's a shortfall)
      if (utilization < 30 && shortfall === 0) continue;

      // Count tasks constrained by this resource
      let constrainedTasks = 0;
      for (const a of allocations) {
        if (a.needed && a.needed[r] && !a.granted) {
          constrainedTasks += 1;
        }
      }

      const suggestion = this._bottleneckSuggestion(r, severity, shortfall);

      bottlenecks.push({
        resource: r,
        severity,
        demand,
        capacity,
        utilization,
        shortfall,
        constrainedTasks,
        suggestion,
      });
    }

    // Sort by severity then utilization
    const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    bottlenecks.sort((a, b) => {
      const sevDiff = severityRank[b.severity] - severityRank[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.utilization - a.utilization;
    });

    return bottlenecks;
  }

  // ---- plan retrieval ----

  /**
   * Get a previously created plan by ID.
   *
   * @param {string} planId
   * @returns {object|null}
   */
  getPlan(planId) {
    return this._plans[planId] || null;
  }

  /**
   * List all stored plan IDs.
   *
   * @returns {string[]}
   */
  listPlans() {
    return Object.keys(this._plans);
  }

  /**
   * Get learned estimates for all known task types.
   *
   * @returns {object}
   */
  getLearnedEstimates() {
    return JSON.parse(JSON.stringify({
      estimates: this._estimates,
      accuracy: this._accuracy,
    }));
  }

  /**
   * Remove a stored plan.
   *
   * @param {string} planId
   * @returns {boolean}
   */
  removePlan(planId) {
    if (this._plans[planId]) {
      delete this._plans[planId];
      return true;
    }
    return false;
  }

  /** Reset all stored plans and learned estimates. */
  reset() {
    this._plans = {};
    this._estimates = {};
    this._accuracy = {};
    return this;
  }

  // ---- allocation strategies ----

  /**
   * Greedy allocation: highest-priority tasks get resources first.
   */
  _allocateGreedy(estimateList, pool) {
    // Sort by priority descending, then by estimated cost ascending
    const sorted = [...estimateList].sort((a, b) => {
      const pDiff = (b.task.priority || 0) - (a.task.priority || 0);
      if (pDiff !== 0) return pDiff;
      return a.needs.totalCost - b.needs.totalCost;
    });

    const allocations = [];
    const remaining = { ...pool };

    for (const item of sorted) {
      const allocation = this._tryAllocate(item, remaining);
      allocations.push(allocation);

      if (allocation.granted) {
        for (const r of RESOURCE_TYPES) {
          remaining[r] -= allocation.allocated[r] || 0;
        }
      }
    }

    return allocations;
  }

  /**
   * Balanced allocation: distribute resources evenly among all tasks.
   */
  _allocateBalanced(estimateList, pool) {
    if (estimateList.length === 0) return [];

    const n = estimateList.length;
    const allocations = [];
    const used = { tokens: 0, apiCalls: 0, toolExecutions: 0, time: 0, memory: 0, disk: 0 };

    // Phase 1: Give each task an equal fair share of each resource
    for (const item of estimateList) {
      const alloc = {
        taskId: item.task.id,
        granted: true,
        needed: { ...item.needs },
        allocated: {},
        shortfall: {},
      };

      for (const r of RESOURCE_TYPES) {
        const fair = Math.floor(pool[r] / n);
        const grant = Math.min(fair, item.needs[r] || 0);
        alloc.allocated[r] = grant;
        alloc.shortfall[r] = Math.max(0, (item.needs[r] || 0) - grant);
        used[r] += grant;
      }

      allocations.push(alloc);
    }

    // Phase 2: Distribute remaining resources to tasks with shortfalls
    const remaining = {};
    for (const r of RESOURCE_TYPES) {
      remaining[r] = Math.max(0, pool[r] - used[r]);
    }

    // Sort by total shortfall (descending) to prioritize most needy tasks
    const byShortfall = [...allocations].map((a, idx) => ({
      idx,
      totalShortfall: RESOURCE_TYPES.reduce((s, r) => s + (a.shortfall[r] || 0), 0),
    })).sort((a, b) => b.totalShortfall - a.totalShortfall);

    for (const { idx } of byShortfall) {
      const a = allocations[idx];
      for (const r of RESOURCE_TYPES) {
        if (remaining[r] <= 0) break;
        const give = Math.min(a.shortfall[r] || 0, remaining[r]);
        a.allocated[r] += give;
        a.shortfall[r] -= give;
        remaining[r] -= give;
      }
    }

    return allocations;
  }

  /**
   * Efficiency allocation: fit tasks into resource pools to minimize waste.
   * Packs tasks like a bin-packing problem, preferring smaller tasks first.
   */
  _allocateEfficient(estimateList, pool) {
    // Sort by total cost ascending (small tasks first) for better packing
    const sorted = [...estimateList].sort(
      (a, b) => a.needs.totalCost - b.needs.totalCost
    );

    const allocations = [];
    const remaining = { ...pool };

    for (const item of sorted) {
      const allocation = this._tryAllocate(item, remaining);
      allocations.push(allocation);

      if (allocation.granted) {
        for (const r of RESOURCE_TYPES) {
          remaining[r] -= allocation.allocated[r] || 0;
        }
      }
    }

    return allocations;
  }

  // ---- private helpers ----

  _tryAllocate(item, remaining) {
    const needs = item.needs;
    const canFit = RESOURCE_TYPES.every(
      (r) => (needs[r] || 0) <= (remaining[r] || 0)
    );

    if (!canFit) {
      return {
        taskId: item.task.id,
        granted: false,
        needed: { ...needs },
        allocated: {},
        reason: this._allocationFailureReason(item, remaining),
      };
    }

    const alloc = {};
    for (const r of RESOURCE_TYPES) {
      alloc[r] = needs[r] || 0;
    }

    return {
      taskId: item.task.id,
      granted: true,
      needed: { ...needs },
      allocated: alloc,
    };
  }

  _allocationFailureReason(item, remaining) {
    const failures = [];
    for (const r of RESOURCE_TYPES) {
      const need = item.needs[r] || 0;
      const avail = remaining[r] || 0;
      if (need > avail) {
        failures.push(`${r} (need ${need}, have ${avail})`);
      }
    }
    return `Insufficient resources: ${failures.join(", ")}`;
  }

  _normalizeTask(task, index) {
    if (!task || typeof task !== "object") {
      throw new TypeError("plan: each task must be an object");
    }

    const id = task.id || `task-${index || 0}`;
    const type = task.type || "default";
    const priority = Number.isFinite(task.priority) ? Math.max(0, Math.floor(task.priority)) : 0;
    const complexity = Object.values(TASK_COMPLEXITY).includes(task.complexity)
      ? task.complexity
      : TASK_COMPLEXITY.MEDIUM;

    return {
      id,
      type,
      priority,
      complexity,
      estimatedDuration: Number.isFinite(task.estimatedDuration) ? task.estimatedDuration : null,
      agentId: task.agentId || null,
    };
  }

  _normalizeResourcePool(resources) {
    const pool = {};
    for (const r of RESOURCE_TYPES) {
      const val = resources[r];
      pool[r] = Number.isFinite(val) && val >= 0
        ? Math.floor(val)
        : this._resourceDefaults[r] || 0;
    }
    return pool;
  }

  _normalizeResourceEstimate(est) {
    const result = {};
    for (const r of RESOURCE_TYPES) {
      result[r] = Number.isFinite(est[r]) && est[r] >= 0 ? Math.ceil(est[r]) : 0;
    }
    return result;
  }

  _complexityDefaults(complexity) {
    switch (complexity) {
      case TASK_COMPLEXITY.CRITICAL:
        return { tokens: 50000, apiCalls: 20, toolExecutions: 15, time: 120000, memory: 512, disk: 256 };
      case TASK_COMPLEXITY.HIGH:
        return { tokens: 25000, apiCalls: 10, toolExecutions: 8, time: 60000, memory: 256, disk: 128 };
      case TASK_COMPLEXITY.LOW:
        return { tokens: 5000, apiCalls: 3, toolExecutions: 2, time: 15000, memory: 64, disk: 16 };
      case TASK_COMPLEXITY.MEDIUM:
      default:
        return { tokens: 10000, apiCalls: 5, toolExecutions: 5, time: 30000, memory: 128, disk: 64 };
    }
  }

  _computeTotalCost(est) {
    // Weighted sum: tokens and apiCalls are most significant
    return (
      (est.tokens || 0) * 0.001 +
      (est.apiCalls || 0) * 10 +
      (est.toolExecutions || 0) * 5 +
      (est.time || 0) * 0.01 +
      (est.memory || 0) * 0.1 +
      (est.disk || 0) * 0.05
    );
  }

  _sumAllocations(allocations) {
    const total = { tokens: 0, apiCalls: 0, toolExecutions: 0, time: 0, memory: 0, disk: 0 };
    for (const a of allocations) {
      if (a.granted) {
        for (const r of RESOURCE_TYPES) {
          total[r] = (total[r] || 0) + (a.allocated[r] || 0);
        }
      }
    }
    return total;
  }

  _bottleneckSuggestion(resource, severity, shortfall) {
    const suggestions = {
      tokens: "Increase token budget or reduce per-task token consumption",
      apiCalls: "Batch API calls or increase call quota",
      toolExecutions: "Reduce tool usage per task or increase tool execution budget",
      time: "Extend time window or reduce task duration estimates",
      memory: "Reduce memory footprint or allocate additional memory",
      disk: "Clean up disk or increase storage allocation",
    };

    let s = suggestions[resource] || `Increase ${resource} capacity`;
    if (severity === "CRITICAL" && shortfall > 0) {
      s += `. Shortfall of ${shortfall} units.`;
    }
    return s;
  }
}

// ---- exports ----

module.exports = {
  ResourcePlanner,
  STRATEGY,
  RESOURCE_TYPES,
  TASK_COMPLEXITY,
};
