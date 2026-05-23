"use strict";

const { debug } = require('../debug');

/**
 * QuotaManager — tracks resource consumption per-agent and globally,
 * enforcing limits through sliding or fixed time windows.
 *
 * Tracked resources:
 *   api_calls, tokens_in, tokens_out, tool_executions,
 *   file_operations, session_time
 *
 * Window modes:
 *   FIXED  — counter resets at the end of each interval (e.g. every 60 s)
 *   SLIDING — keeps a timestamped log; only the last `window` ms count
 */

const RESOURCES = Object.freeze([
  "api_calls",
  "tokens_in",
  "tokens_out",
  "tool_executions",
  "file_operations",
  "session_time",
]);

const WINDOW_MODE = Object.freeze({
  FIXED: "FIXED",
  SLIDING: "SLIDING",
});

const DEFAULT_WINDOW_MS = 60_000;       // 1 minute
const DEFAULT_MODE = WINDOW_MODE.FIXED;

// ---- QuotaManager ----

class QuotaManager {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultWindowMs=60000] — default window length
   * @param {string} [options.defaultMode='FIXED'] — 'FIXED' | 'SLIDING'
   * @param {string} [options.name] — optional name for debugging
   */
  constructor(options = {}) {
    this._defaultWindowMs = positiveInteger(options.defaultWindowMs, DEFAULT_WINDOW_MS);
    this._defaultMode = options.defaultMode === WINDOW_MODE.SLIDING
      ? WINDOW_MODE.SLIDING
      : WINDOW_MODE.FIXED;
    this._name = options.name || "quota-manager";

    // _quotas[resource] = { limit, windowMs, mode }
    this._quotas = {};

    // _globalUsage[resource] = { used, startTime, lastReset }
    // (for FIXED mode)
    this._globalUsage = {};

    // _globalLog[resource] = [{amount, timestamp}, ...]
    // (for SLIDING mode)
    this._globalLog = {};

    // _agentQuotas[agentId][resource] = { limit, windowMs, mode }
    this._agentQuotas = {};

    // _agentUsage[agentId][resource] = { used, startTime, lastReset }
    this._agentUsage = {};

    // _agentLog[agentId][resource] = [{amount, timestamp}, ...]
    this._agentLog = {};

    this._totalConsumed = 0;
    this._totalRejected = 0;

    // Initialize all resource counters
    for (const r of RESOURCES) {
      this._globalUsage[r] = { used: 0, startTime: Date.now(), lastReset: Date.now() };
      this._globalLog[r] = [];
    }
  }

  // ---- quota definitions ----

  /**
   * Set a quota for a resource.
   *
   * @param {string}  resource           — resource name
   * @param {number}  limit              — maximum allowed units within the window
   * @param {number}  [windowMs]         — window length in ms (default: constructor default)
   * @param {object}  [options]
   * @param {string}  [options.mode]     — 'FIXED' | 'SLIDING'
   * @param {string}  [options.agentId]  — if set, applies to a specific agent
   * @returns {QuotaManager}
   */
  setQuota(resource, limit, windowMs, options = {}) {
    this._validateResource(resource);

    const limitNum = clampPositive(limit, 0);
    const win = windowMs !== undefined
      ? positiveInteger(windowMs, this._defaultWindowMs)
      : this._defaultWindowMs;
    const mode = options.mode === WINDOW_MODE.SLIDING
      ? WINDOW_MODE.SLIDING
      : this._defaultMode;

    if (options.agentId) {
      this._ensureAgent(options.agentId);
      this._agentQuotas[options.agentId][resource] = { limit: limitNum, windowMs: win, mode };
    } else {
      this._quotas[resource] = { limit: limitNum, windowMs: win, mode };
    }

    debug("quota", `[${this._name}] setQuota ${resource}=${limitNum}/${win}ms (${mode})` +
      (options.agentId ? ` agent=${options.agentId}` : " global"));
    return this;
  }

  // ---- usage checks ----

  /**
   * Check remaining quota for a resource.
   *
   * @param {string}  resource
   * @param {string}  [agentId] — if omitted, checks global
   * @returns {{ remaining: number, limit: number, used: number, windowMs: number, exhausted: boolean }}
   */
  checkQuota(resource, agentId) {
    this._validateResource(resource);

    const q = this._resolveQuota(resource, agentId);
    if (!q) {
      return { remaining: Infinity, limit: Infinity, used: 0, windowMs: this._defaultWindowMs, exhausted: false };
    }

    // Advance window state before computing
    if (agentId) {
      if (this._agentUsage[agentId]) {
        this._advanceWindowState(resource, this._agentUsage[agentId], this._agentLog[agentId], q);
      }
    } else {
      this._advanceWindowState(resource, this._globalUsage, this._globalLog, q);
    }

    const used = agentId
      ? (this._agentUsage[agentId]?.[resource]?.used || 0)
      : (this._globalUsage[resource]?.used || 0);

    const rawRemaining = q.limit - used;
    const remaining = Math.max(0, rawRemaining);
    const deficit = rawRemaining < 0 ? Math.abs(rawRemaining) : 0;

    return {
      remaining,
      limit: q.limit,
      used,
      deficit,
      windowMs: q.windowMs,
      exhausted: remaining <= 0,
    };
  }

  /**
   * Attempt to consume quota. Returns a result object.
   *
   * @param {string}  resource
   * @param {number}  amount
   * @param {string}  [agentId]
   * @returns {{ allowed: boolean, consumed: number, remaining: number, limit: number, reason?: string }}
   */
  consume(resource, amount, agentId) {
    this._validateResource(resource);

    const amountNum = clampPositive(amount, 0);
    if (amountNum === 0) {
      return { allowed: true, consumed: 0, remaining: 0, limit: 0 };
    }

    const q = this._resolveQuota(resource, agentId);
    if (!q) {
      // No quota set — unlimited
      this._totalConsumed += amountNum;
      if (agentId) {
        this._ensureAgent(agentId);
        this._agentLog[agentId][resource].push({ amount: amountNum, timestamp: Date.now() });
      } else {
        this._globalLog[resource].push({ amount: amountNum, timestamp: Date.now() });
      }
      return { allowed: true, consumed: amountNum, remaining: Infinity, limit: Infinity };
    }

    // Advance window state
    if (agentId) {
      this._ensureAgent(agentId);
      this._advanceWindowState(resource, this._agentUsage[agentId], this._agentLog[agentId], q);
    } else {
      this._advanceWindowState(resource, this._globalUsage, this._globalLog, q);
    }

    const usage = agentId ? this._agentUsage[agentId][resource] : this._globalUsage[resource];
    const remaining = Math.max(0, q.limit - usage.used);

    if (amountNum > remaining) {
      this._totalRejected += 1;
      debug("quota",
        `[${this._name}] rejected ${amountNum}/${resource} ` +
        `(used=${usage.used}, limit=${q.limit})` +
        (agentId ? ` agent=${agentId}` : ""));
      return {
        allowed: false,
        consumed: 0,
        remaining,
        limit: q.limit,
        reason: `Quota exceeded: ${resource} has ${remaining} remaining, requested ${amountNum}`,
      };
    }

    usage.used += amountNum;
    this._totalConsumed += amountNum;

    if (q.mode === WINDOW_MODE.SLIDING) {
      const log = agentId ? this._agentLog[agentId][resource] : this._globalLog[resource];
      log.push({ amount: amountNum, timestamp: Date.now() });
    }

    return { allowed: true, consumed: amountNum, remaining: q.limit - usage.used, limit: q.limit };
  }

  /**
   * Reset the usage counter for a resource.
   *
   * @param {string}  resource
   * @param {string}  [agentId]
   * @returns {QuotaManager}
   */
  reset(resource, agentId) {
    this._validateResource(resource);

    const now = Date.now();
    if (agentId && this._agentUsage[agentId]) {
      if (this._agentUsage[agentId][resource]) {
        this._agentUsage[agentId][resource] = { used: 0, startTime: now, lastReset: now };
      }
      if (this._agentLog[agentId]?.[resource]) {
        this._agentLog[agentId][resource] = [];
      }
    } else if (!agentId) {
      this._globalUsage[resource] = { used: 0, startTime: now, lastReset: now };
      this._globalLog[resource] = [];
    }

    return this;
  }

  /**
   * Get current usage stats.
   *
   * @param {string}  [resource] — omit for all resources
   * @param {string}  [agentId] — omit for global
   * @returns {object}
   */
  getUsage(resource, agentId) {
    if (resource) {
      this._validateResource(resource);
      return this._buildResourceUsage(resource, agentId);
    }

    // Aggregate all resources
    const result = {
      resources: {},
      totalConsumed: 0,
      totalRemaining: 0,
      totalLimit: 0,
      exhausted: [],
    };

    for (const r of RESOURCES) {
      const info = this._buildResourceUsage(r, agentId);
      result.resources[r] = info;
      if (agentId) {
        result.totalConsumed += info.used;
        result.totalRemaining += info.remaining;
        result.totalLimit += info.limit === Infinity ? 0 : info.limit;
      }
      if (info.exhausted) {
        result.exhausted.push(r);
      }
    }

    // For global, sum across resources
    if (!agentId) {
      result.totalConsumed = this._totalConsumed;
    }

    result.totalRejected = this._totalRejected;
    return result;
  }

  // ---- window mode ----

  /**
   * Set tracking mode for a specific resource or globally.
   *
   * @param {string} mode — 'FIXED' | 'SLIDING'
   * @param {string} [resource] — omit to set default
   */
  setWindowMode(mode, resource) {
    const m = mode === WINDOW_MODE.SLIDING ? WINDOW_MODE.SLIDING : WINDOW_MODE.FIXED;

    if (resource) {
      this._validateResource(resource);
      if (this._quotas[resource]) {
        this._quotas[resource].mode = m;
      }
    } else {
      this._defaultMode = m;
    }
    return this;
  }

  /**
   * @returns {{ rejected: number, consumed: number }}
   */
  getStats() {
    return {
      totalConsumed: this._totalConsumed,
      totalRejected: this._totalRejected,
    };
  }

  /** Reset ALL quotas and usage counters. */
  resetAll() {
    const now = Date.now();
    for (const r of RESOURCES) {
      this._globalUsage[r] = { used: 0, startTime: now, lastReset: now };
      this._globalLog[r] = [];
    }
    this._agentUsage = {};
    this._agentLog = {};
    this._totalConsumed = 0;
    this._totalRejected = 0;
    return this;
  }

  // ---- private helpers ----

  _validateResource(resource) {
    if (!RESOURCES.includes(resource)) {
      throw new Error(
        `Unknown resource "${resource}". Valid: ${RESOURCES.join(", ")}`
      );
    }
  }

  _ensureAgent(agentId) {
    if (!this._agentQuotas[agentId]) {
      this._agentQuotas[agentId] = {};
    }
    if (!this._agentUsage[agentId]) {
      this._agentUsage[agentId] = {};
      this._agentLog[agentId] = {};
      for (const r of RESOURCES) {
        const now = Date.now();
        this._agentUsage[agentId][r] = { used: 0, startTime: now, lastReset: now };
        this._agentLog[agentId][r] = [];
      }
    }
  }

  _resolveQuota(resource, agentId) {
    if (agentId && this._agentQuotas[agentId]?.[resource]) {
      return this._agentQuotas[agentId][resource];
    }
    return this._quotas[resource] || null;
  }

  _advanceWindowState(resource, usageStore, logStore, quota) {
    const now = Date.now();
    const usage = usageStore[resource];
    if (!usage) return;

    if (quota.mode === WINDOW_MODE.FIXED) {
      // Fixed window: reset if the interval has passed
      const elapsed = now - usage.lastReset;
      if (elapsed >= quota.windowMs) {
        usage.used = 0;
        usage.lastReset = now;
      }
    } else {
      // Sliding window: purge entries outside the window
      const cutoff = now - quota.windowMs;
      const log = logStore[resource] || [];
      let idx = 0;
      while (idx < log.length && log[idx].timestamp < cutoff) {
        idx++;
      }
      if (idx > 0) {
        log.splice(0, idx);
      }
      // Recompute used from remaining entries
      let sum = 0;
      for (const entry of log) {
        sum += entry.amount;
      }
      usage.used = sum;
    }
  }

  _buildResourceUsage(resource, agentId) {
    const q = this._resolveQuota(resource, agentId);

    if (agentId && this._agentUsage[agentId]) {
      if (q) {
        this._advanceWindowState(resource, this._agentUsage[agentId], this._agentLog[agentId], q);
      }
      const usage = this._agentUsage[agentId][resource] || { used: 0 };
      const limit = q ? q.limit : Infinity;
      const remaining = Math.max(0, limit - usage.used);
      return {
        resource,
        limit,
        used: usage.used,
        remaining,
        exhausted: remaining <= 0 && limit !== Infinity,
        windowMs: q ? q.windowMs : this._defaultWindowMs,
        mode: q ? q.mode : this._defaultMode,
      };
    }

    // Global
    if (q) {
      this._advanceWindowState(resource, this._globalUsage, this._globalLog, q);
    }
    const usage = this._globalUsage[resource] || { used: 0 };
    const limit = q ? q.limit : Infinity;
    const remaining = Math.max(0, limit - usage.used);
    return {
      resource,
      limit,
      used: usage.used,
      remaining,
      exhausted: remaining <= 0 && limit !== Infinity,
      windowMs: q ? q.windowMs : this._defaultWindowMs,
      mode: q ? q.mode : this._defaultMode,
    };
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
  QuotaManager,
  RESOURCES,
  WINDOW_MODE,
};
