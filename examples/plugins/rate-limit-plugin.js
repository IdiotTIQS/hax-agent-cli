"use strict";

/**
 * Rate-Limit Plugin — Limits how many tool calls can be made per minute
 * using a token-bucket algorithm.
 *
 * Install:
 *   Copy this file to `.hax-agent/plugins/` and restart the agent.
 *
 * Configuration (passed via the plugin constructor helper):
 *   - maxCallsPerMinute  (default: 30)   — sustained call rate
 *   - burst              (default: 5)    — extra tokens for short bursts
 *   - blockMessage       (default: see below) — message shown when blocked
 *
 *   const { PluginRegistry } = require('./src/plugins');
 *   const registry = new PluginRegistry();
 *   require('./examples/plugins/rate-limit-plugin').register(registry, {
 *     maxCallsPerMinute: 60,
 *   });
 *
 * Algorithm:
 *   The bucket starts full (maxCallsPerMinute + burst tokens).  Each tool
 *   call consumes one token.  Tokens refill at a constant rate of
 *   `maxCallsPerMinute / 60_000` tokens per millisecond.  When the bucket
 *   is empty, `beforeToolCall` throws an error, which the PluginRegistry
 *   catches and routes to `onError` handlers without crashing.
 */

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

class TokenBucket {
  /**
   * @param {number} maxCallsPerMinute  sustained calls per minute
   * @param {number} burst              extra burst capacity
   */
  constructor(maxCallsPerMinute, burst) {
    this._rate = maxCallsPerMinute / 60_000; // tokens per ms
    this._capacity = maxCallsPerMinute + burst;
    this._tokens = this._capacity;
    this._lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time, then try to consume one.
   * Returns `true` if the call is allowed, `false` if rate-limited.
   */
  consume() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;

    // Refill
    if (elapsed > 0) {
      this._tokens = Math.min(this._capacity, this._tokens + elapsed * this._rate);
      this._lastRefill = now;
    }

    if (this._tokens >= 1) {
      this._tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Estimate how many milliseconds until the next token is available.
   */
  msUntilNextToken() {
    if (this._tokens >= 1) return 0;
    const needed = 1 - this._tokens;
    return Math.ceil(needed / this._rate);
  }

  /** Reset bucket to full capacity (e.g. on session start). */
  reset() {
    this._tokens = this._capacity;
    this._lastRefill = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const DEFAULTS = {
  maxCallsPerMinute: 30,
  burst: 5,
  blockMessage:
    "Rate limit exceeded.  Too many tool calls — please wait a moment before retrying.",
};

/**
 * Factory: create the plugin object with the given options so that the bucket
 * carries the caller's configuration.
 */
function createRateLimitPlugin(options) {
  const opts = Object.assign({}, DEFAULTS, options || {});

  const bucket = new TokenBucket(opts.maxCallsPerMinute, opts.burst);

  function beforeToolCall(ctx) {
    if (!bucket.consume()) {
      const waitMs = bucket.msUntilNextToken();
      const err = new Error(
        `${opts.blockMessage} (retry in ~${Math.ceil(waitMs / 1000)}s)`
      );
      err.code = "RATE_LIMITED";
      err.retryAfterMs = waitMs;
      throw err;
    }
    return ctx;
  }

  function onSessionStart(ctx) {
    bucket.reset();
    return ctx;
  }

  return {
    name: "rate-limit-plugin",
    version: "1.0.0",
    hooks: {
      beforeToolCall,
      onSessionStart,
    },
  };
}

/**
 * Register the plugin on a PluginRegistry instance.
 *
 * @param {import('../../src/plugins').PluginRegistry} registry
 * @param {object} [options]
 */
function register(registry, options) {
  registry.register(createRateLimitPlugin(options));
}

module.exports = { createRateLimitPlugin, register };
