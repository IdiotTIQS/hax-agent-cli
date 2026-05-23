"use strict";

const { debug } = require('../debug');
const { QuotaManager } = require('./manager');
const { FairScheduler } = require('./scheduler');

/**
 * QuotaEnforcer — wraps operations with pre/post quota checks,
 * logs violations, and enforces configurable actions (BLOCK,
 * THROTTLE, WARN, LOG) with support for grace periods and
 * burst allowances.
 *
 * Designed to work with QuotaManager and FairScheduler or
 * standalone with its own internal manager.
 */

const ACTION = Object.freeze({
  BLOCK: "BLOCK",
  THROTTLE: "THROTTLE",
  WARN: "WARN",
  LOG: "LOG",
});

const ACTION_SEVERITY = Object.freeze({
  BLOCK: 3,
  THROTTLE: 2,
  WARN: 1,
  LOG: 0,
});

const DEFAULT_ACTION = ACTION.BLOCK;
const DEFAULT_GRACE_PERIOD_MS = 5000;     // 5 s grace after violation
const DEFAULT_BURST_ALLOWANCE = 5;        // extra units allowed in burst
const DEFAULT_THROTTLE_DELAY_MS = 1000;   // delay between throttled ops

// ---- QuotaEnforcer ----

class QuotaEnforcer {
  /**
   * @param {object} [options]
   * @param {QuotaManager} [options.quotaManager]  — external QuotaManager instance
   * @param {FairScheduler} [options.scheduler]    — external FairScheduler instance
   * @param {string} [options.defaultAction='BLOCK'] — action on violation
   * @param {number} [options.gracePeriodMs=5000]  — grace period after first violation
   * @param {number} [options.burstAllowance=5]    — extra units allowed in burst
   * @param {string} [options.name]
   */
  constructor(options = {}) {
    this._quotaManager = options.quotaManager || new QuotaManager();
    this._scheduler = options.scheduler || null;

    this._defaultAction = Object.values(ACTION).includes(options.defaultAction)
      ? options.defaultAction
      : DEFAULT_ACTION;
    this._gracePeriodMs = positiveInteger(options.gracePeriodMs, DEFAULT_GRACE_PERIOD_MS);
    this._burstAllowance = positiveInteger(options.burstAllowance, DEFAULT_BURST_ALLOWANCE);
    this._name = options.name || "quota-enforcer";

    // Per-agent violations
    // _violations[agentId] = [{ resource, amount, action, timestamp, reason }]
    this._violations = {};

    // Enforcement stats
    this._stats = {
      totalChecks: 0,
      totalBlocks: 0,
      totalThrottles: 0,
      totalWarns: 0,
      totalLogs: 0,
      totalPostChecks: 0,
      postCheckBlocked: 0,
    };

    // Per-agent grace state
    // _grace[agentId] = { active: true, startedAt, remainingBurst }
    this._grace = {};

    // Per-resource action overrides
    // _actionOverrides[resource] = { action }
    this._actionOverrides = {};

    // Throttle state for agents
    this._throttleTimers = {};
  }

  // ---- configuration ----

  /**
   * Override the violation action for a specific resource.
   *
   * @param {string} resource
   * @param {string} action — 'BLOCK' | 'THROTTLE' | 'WARN' | 'LOG'
   * @returns {QuotaEnforcer}
   */
  setAction(resource, action) {
    if (!Object.values(ACTION).includes(action)) {
      throw new Error(
        `Invalid action "${action}". Valid: ${Object.values(ACTION).join(", ")}`
      );
    }
    this._actionOverrides[resource] = { action };
    return this;
  }

  /**
   * Activate grace period for an agent, allowing burst usage.
   *
   * @param {string} agentId
   * @param {number} [durationMs] — optional custom grace period
   * @returns {QuotaEnforcer}
   */
  activateGrace(agentId, durationMs) {
    const dur = positiveInteger(durationMs, this._gracePeriodMs);
    this._grace[agentId] = {
      active: true,
      startedAt: Date.now(),
      remainingBurst: this._burstAllowance,
      durationMs: dur,
    };
    return this;
  }

  /**
   * Deactivate grace period for an agent.
   *
   * @param {string} agentId
   * @returns {QuotaEnforcer}
   */
  deactivateGrace(agentId) {
    delete this._grace[agentId];
    return this;
  }

  // ---- enforcement ----

  /**
   * Pre-operation check. Determines whether an operation should be
   * allowed, throttled, or blocked.
   *
   * @param {string} agentId
   * @param {string} resource
   * @param {number} amount
   * @returns {{
   *   allowed: boolean,
   *   action: string,
   *   remaining: number,
   *   limit: number,
   *   reason?: string,
   *   delayMs?: number
   * }}
   */
  preCheck(agentId, resource, amount) {
    this._stats.totalChecks += 1;

    const amountNum = clampPositive(amount, 0);
    if (amountNum === 0) {
      return { allowed: true, action: ACTION.LOG, remaining: Infinity, limit: Infinity };
    }

    // Check if agent is in grace period
    const grace = this._grace[agentId];
    const inGrace = grace && grace.active && (Date.now() - grace.startedAt) < (grace.durationMs || this._gracePeriodMs);

    // Try to consume from the quota manager
    const result = this._quotaManager.consume(resource, amountNum, agentId);

    if (result.allowed) {
      // Consumed successfully — deduct from burst allowance if in grace
      if (inGrace && grace.remainingBurst > 0) {
        grace.remainingBurst = Math.max(0, grace.remainingBurst - amountNum);
      }
      return {
        allowed: true,
        action: ACTION.LOG,
        remaining: result.remaining,
        limit: result.limit,
      };
    }

    // Quota exceeded — determine action
    // Check if grace period burst can cover it
    if (inGrace && grace.remainingBurst >= amountNum) {
      grace.remainingBurst -= amountNum;
      return {
        allowed: true,
        action: ACTION.WARN,
        remaining: result.remaining,
        limit: result.limit,
        reason: `Burst allowance used (${grace.remainingBurst} remaining burst units)`,
      };
    }

    // Determine enforcement action
    const action = this._resolveAction(resource);
    const reason = result.reason || `Quota exceeded for ${resource}`;

    // Record violation
    this._recordViolation(agentId, resource, amountNum, action, reason);

    // Apply action
    switch (action) {
      case ACTION.BLOCK:
        this._stats.totalBlocks += 1;
        return {
          allowed: false,
          action: ACTION.BLOCK,
          remaining: result.remaining,
          limit: result.limit,
          reason,
        };

      case ACTION.THROTTLE:
        this._stats.totalThrottles += 1;
        this._applyThrottle(agentId);
        return {
          allowed: true,
          action: ACTION.THROTTLE,
          remaining: result.remaining,
          limit: result.limit,
          reason,
          delayMs: DEFAULT_THROTTLE_DELAY_MS,
        };

      case ACTION.WARN:
        this._stats.totalWarns += 1;
        return {
          allowed: true,
          action: ACTION.WARN,
          remaining: result.remaining,
          limit: result.limit,
          reason,
        };

      case ACTION.LOG:
      default:
        this._stats.totalLogs += 1;
        debug("enforcer", `[${this._name}] VIOLATION: ${agentId}/${resource} (${amountNum}) — ${reason}`);
        return {
          allowed: true,
          action: ACTION.LOG,
          remaining: result.remaining,
          limit: result.limit,
          reason,
        };
    }
  }

  /**
   * Post-operation check. Called after an operation completes.
   * Can retroactively flag violations (e.g., actual usage exceeding
   * anticipated usage).
   *
   * @param {string} agentId
   * @param {string} resource
   * @param {number} amount    — actual amount consumed
   * @param {*}      [result]  — operation result (optional metadata)
   * @returns {{ violation: boolean, action: string, reason?: string }}
   */
  postCheck(agentId, resource, amount, result) {
    this._stats.totalPostChecks += 1;

    const amountNum = clampPositive(amount, 0);
    if (amountNum === 0) {
      return { violation: false, action: ACTION.LOG };
    }

    // Check remaining quota after the fact
    const quotaInfo = this._quotaManager.checkQuota(resource, agentId);

    // If usage is over budget (deficit > 0), flag it
    if (quotaInfo.deficit > 0 || quotaInfo.exhausted) {
      const action = this._resolveAction(resource);

      if (action === ACTION.BLOCK || action === ACTION.THROTTLE) {
        this._stats.postCheckBlocked += 1;
      }

      this._recordViolation(
        agentId,
        resource,
        amountNum,
        action,
        `Post-check: overdraft by ${quotaInfo.deficit} units`
      );

      return {
        violation: true,
        action,
        reason: `Post-check violation: overdraft of ${quotaInfo.deficit}`,
      };
    }

    return { violation: false, action: ACTION.LOG };
  }

  /**
   * Wrap an operation with pre and post quota checks.
   *
   * @param {string}   agentId
   * @param {Function} operation   — async function to execute
   * @param {object}   [options]
   * @param {string}   [options.resource='tool_executions']
   * @param {number}   [options.amount=1]
   * @returns {Promise<any>} operation result
   * @throws {QuotaViolationError} if pre-check blocks
   */
  async enforce(agentId, operation, options = {}) {
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new TypeError("enforce: agentId must be a non-empty string");
    }
    if (typeof operation !== "function") {
      throw new TypeError("enforce: operation must be a function");
    }

    const resource = options.resource || "tool_executions";
    const amount = Number.isFinite(options.amount) && options.amount > 0
      ? Math.floor(options.amount)
      : 1;

    // Pre-check
    const pre = this.preCheck(agentId, resource, amount);

    if (!pre.allowed) {
      throw new QuotaViolationError(
        agentId,
        resource,
        amount,
        pre.reason || "Quota violation"
      );
    }

    // Execute operation
    let execResult;
    let error;
    try {
      execResult = await operation();
    } catch (err) {
      error = err;
    }

    // Post-check
    this.postCheck(agentId, resource, amount, execResult);

    if (error) {
      throw error;
    }

    return execResult;
  }

  // ---- violation history ----

  /**
   * Get violation history for a specific agent or all agents.
   *
   * @param {string} [agentId]
   * @returns {object[]|object} array of violations or {agentId: [...]}
   */
  getViolations(agentId) {
    if (agentId) {
      return (this._violations[agentId] || []).slice();
    }
    return JSON.parse(JSON.stringify(this._violations));
  }

  /**
   * Clear violation history for an agent or all agents.
   *
   * @param {string} [agentId]
   * @returns {QuotaEnforcer}
   */
  clearViolations(agentId) {
    if (agentId) {
      delete this._violations[agentId];
    } else {
      this._violations = {};
    }
    return this;
  }

  // ---- statistics ----

  /**
   * Get enforcement statistics.
   *
   * @returns {{
   *   totalChecks: number,
   *   totalBlocks: number,
   *   totalThrottles: number,
   *   totalWarns: number,
   *   totalLogs: number,
   *   postChecks: number,
   *   postCheckBlocks: number,
   *   violationCount: number,
   *   agentsTracked: number
   * }}
   */
  getEnforcementStats() {
    let violationCount = 0;
    for (const v of Object.values(this._violations)) {
      violationCount += v.length;
    }

    return {
      totalChecks: this._stats.totalChecks,
      totalBlocks: this._stats.totalBlocks,
      totalThrottles: this._stats.totalThrottles,
      totalWarns: this._stats.totalWarns,
      totalLogs: this._stats.totalLogs,
      postChecks: this._stats.totalPostChecks,
      postCheckBlocks: this._stats.postCheckBlocked,
      violationCount,
      agentsTracked: Object.keys(this._violations).length,
    };
  }

  /**
   * Reset all stats and violation history.
   * @returns {QuotaEnforcer}
   */
  resetStats() {
    this._stats = {
      totalChecks: 0,
      totalBlocks: 0,
      totalThrottles: 0,
      totalWarns: 0,
      totalLogs: 0,
      totalPostChecks: 0,
      postCheckBlocked: 0,
    };
    this._violations = {};
    this._grace = {};
    this._throttleTimers = {};
    return this;
  }

  // ---- private helpers ----

  _resolveAction(resource) {
    if (this._actionOverrides[resource]) {
      return this._actionOverrides[resource].action;
    }
    return this._defaultAction;
  }

  _recordViolation(agentId, resource, amount, action, reason) {
    if (!this._violations[agentId]) {
      this._violations[agentId] = [];
    }

    this._violations[agentId].push({
      resource,
      amount,
      action,
      reason,
      timestamp: Date.now(),
    });

    debug("enforcer",
      `[${this._name}] ${action}: ${agentId}/${resource}=${amount} — ${reason}`);
  }

  _applyThrottle(agentId) {
    // Clear previous throttle timer
    if (this._throttleTimers[agentId]) {
      clearTimeout(this._throttleTimers[agentId]);
    }

    // Set a throttle cooldown
    this._throttleTimers[agentId] = setTimeout(() => {
      delete this._throttleTimers[agentId];
    }, DEFAULT_THROTTLE_DELAY_MS).unref();
  }

  /** @returns {QuotaManager} */
  get quotaManager() {
    return this._quotaManager;
  }

  /** @returns {FairScheduler|null} */
  get scheduler() {
    return this._scheduler;
  }
}

// ---- QuotaViolationError ----

class QuotaViolationError extends Error {
  /**
   * @param {string} agentId
   * @param {string} resource
   * @param {number} amount
   * @param {string} reason
   */
  constructor(agentId, resource, amount, reason) {
    super(`[${agentId}] quota violation on ${resource} (${amount}): ${reason}`);
    this.name = "QuotaViolationError";
    this.code = "QUOTA_VIOLATION";
    this.agentId = agentId;
    this.resource = resource;
    this.amount = amount;
    this.reason = reason;
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
  QuotaEnforcer,
  QuotaViolationError,
  ACTION,
};
