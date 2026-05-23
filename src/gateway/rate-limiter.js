"use strict";

const ALGORITHMS = Object.freeze({
  TOKEN_BUCKET: "token_bucket",
  SLIDING_WINDOW: "sliding_window",
  FIXED_WINDOW: "fixed_window",
  LEAKY_BUCKET: "leaky_bucket",
});

const DEFAULT_MAX_TOKENS = 100;
const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 minute
const DEFAULT_ALGORITHM = ALGORITHMS.TOKEN_BUCKET;

/**
 * In-memory distributed-style rate limiter supporting multiple algorithms.
 *
 * Each key gets its own bucket/window. Algorithms:
 *  - token_bucket: tokens refill at a constant rate; burst up to maxTokens
 *  - sliding_window: counts requests in a rolling time window
 *  - fixed_window: counts requests in the current fixed interval
 *  - leaky_bucket: requests queue up and are processed at a steady rate
 *
 * Concurrency-safe for single-process use (synchronous acquire/release).
 */
class DistributedRateLimiter {
  constructor(options = {}) {
    /** @type {Map<string, { algorithm: string, maxTokens: number, intervalMs: number, tokens: number, lastRefill: number, window: number[] }>} */
    this._buckets = new Map();
    this._stats = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Configure a per-key rate limit.
   * @param {string} key
   * @param {number} maxTokens - Maximum tokens/requests per interval
   * @param {number} [interval] - Interval in milliseconds
   * @param {string} [algorithm] - One of ALGORITHMS values
   * @returns {this}
   */
  setLimit(key, maxTokens, interval, algorithm) {
    const resolvedMax = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS;
    const resolvedInterval = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_MS;
    const resolvedAlgo = _resolveAlgorithm(algorithm);

    this._buckets.set(key, {
      algorithm: resolvedAlgo,
      maxTokens: resolvedMax,
      intervalMs: resolvedInterval,
      tokens: resolvedMax,
      lastRefill: Date.now(),
      lastLeak: Date.now(),
      queueSize: 0,
      window: [],
    });

    if (!this._stats.has(key)) {
      this._stats.set(key, { acquired: 0, rejected: 0, released: 0 });
    }

    return this;
  }

  /**
   * Attempt to acquire a token for the given key.
   * Returns `true` if successful, `false` if rate-limited.
   * @param {string} key
   * @returns {boolean}
   */
  acquire(key) {
    const bucket = this._ensureBucket(key);
    const stats = this._ensureStats(key);

    this._refill(bucket);

    let allowed = false;

    switch (bucket.algorithm) {
      case ALGORITHMS.TOKEN_BUCKET:
        allowed = this._acquireTokenBucket(bucket);
        break;
      case ALGORITHMS.SLIDING_WINDOW:
        allowed = this._acquireSlidingWindow(bucket);
        break;
      case ALGORITHMS.FIXED_WINDOW:
        allowed = this._acquireFixedWindow(bucket);
        break;
      case ALGORITHMS.LEAKY_BUCKET:
        allowed = this._acquireLeakyBucket(bucket);
        break;
      default:
        allowed = this._acquireTokenBucket(bucket);
    }

    if (allowed) {
      stats.acquired += 1;
    } else {
      stats.rejected += 1;
    }

    return allowed;
  }

  /**
   * Release a token back to the bucket for the given key.
   * @param {string} key
   * @returns {this}
   */
  release(key) {
    const bucket = this._buckets.get(key);
    if (!bucket) return this;

    const stats = this._ensureStats(key);
    const newTokens = Math.min(bucket.tokens + 1, bucket.maxTokens);
    if (newTokens > bucket.tokens) {
      bucket.tokens = newTokens;
      stats.released += 1;
    }

    return this;
  }

  /**
   * Return remaining capacity for a key.
   * @param {string} key
   * @returns {{ remaining: number, maxTokens: number, intervalMs: number, algorithm: string }}
   */
  getLimit(key) {
    const bucket = this._buckets.get(key);
    if (!bucket) {
      return { remaining: 0, maxTokens: 0, intervalMs: 0, algorithm: DEFAULT_ALGORITHM };
    }
    this._refill(bucket);
    return {
      remaining: Math.floor(bucket.tokens),
      maxTokens: bucket.maxTokens,
      intervalMs: bucket.intervalMs,
      algorithm: bucket.algorithm,
    };
  }

  /**
   * Get per-key usage statistics.
   * @returns {Record<string, { acquired: number, rejected: number, released: number, successRate: number }>}
   */
  getStats() {
    const result = {};
    for (const [key, stats] of this._stats) {
      const total = stats.acquired + stats.rejected;
      result[key] = {
        acquired: stats.acquired,
        rejected: stats.rejected,
        released: stats.released,
        successRate: total === 0 ? 1 : stats.acquired / total,
      };
    }
    return result;
  }

  /**
   * Reset statistics and buckets for all keys.
   */
  reset() {
    this._buckets.clear();
    this._stats.clear();
  }

  // ── Algorithm implementations ───────────────────────────────────────────

  /**
   * Token bucket: each acquire consumes one token.
   * Tokens refill at a constant rate.
   */
  _acquireTokenBucket(bucket) {
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Sliding window: count requests in the last `intervalMs`.
   */
  _acquireSlidingWindow(bucket) {
    const now = Date.now();
    const cutoff = now - bucket.intervalMs;

    // Remove expired timestamps
    while (bucket.window.length > 0 && bucket.window[0] < cutoff) {
      bucket.window.shift();
    }

    if (bucket.window.length < bucket.maxTokens) {
      bucket.window.push(now);
      return true;
    }
    return false;
  }

  /**
   * Fixed window: reset counter at interval boundaries.
   */
  _acquireFixedWindow(bucket) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;

    // Reset window if the interval has passed
    if (elapsed >= bucket.intervalMs) {
      bucket.lastRefill = now;
      bucket.window = [now];
      bucket.tokens = bucket.maxTokens - 1;
      return true;
    }

    if (bucket.window.length < bucket.maxTokens) {
      bucket.window.push(now);
      bucket.tokens = bucket.maxTokens - bucket.window.length;
      return true;
    }

    return false;
  }

  /**
   * Leaky bucket: requests are processed at a steady rate.
   * The bucket has a capacity; excess requests are rejected.
   */
  _acquireLeakyBucket(bucket) {
    const now = Date.now();
    const elapsed = now - (bucket.lastLeak || now);
    const leakRate = bucket.maxTokens / bucket.intervalMs;
    const leaked = Math.floor(elapsed * leakRate);

    if (leaked > 0) {
      bucket.queueSize = Math.max(0, bucket.queueSize - leaked);
      bucket.lastLeak = now;
    }

    if (bucket.queueSize < bucket.maxTokens) {
      bucket.queueSize += 1;
      bucket.tokens = bucket.maxTokens - bucket.queueSize;
      return true;
    }

    return false;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Refill tokens based on elapsed time (token bucket only).
   */
  _refill(bucket) {
    if (bucket.algorithm !== ALGORITHMS.TOKEN_BUCKET) return;

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const refillRate = bucket.maxTokens / bucket.intervalMs;
    const refillAmount = elapsed * refillRate;

    if (refillAmount >= 1) {
      bucket.tokens = Math.min(bucket.tokens + refillAmount, bucket.maxTokens);
      bucket.lastRefill = now;
    }
  }

  /**
   * Get or create a bucket for a key (uses defaults).
   */
  _ensureBucket(key) {
    if (!this._buckets.has(key)) {
      this.setLimit(key, DEFAULT_MAX_TOKENS, DEFAULT_INTERVAL_MS, DEFAULT_ALGORITHM);
    }
    return this._buckets.get(key);
  }

  /**
   * Get or create stats for a key.
   */
  _ensureStats(key) {
    if (!this._stats.has(key)) {
      this._stats.set(key, { acquired: 0, rejected: 0, released: 0 });
    }
    return this._stats.get(key);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function _resolveAlgorithm(algo) {
  if (!algo) return DEFAULT_ALGORITHM;
  const normalized = String(algo).toLowerCase();
  if (Object.values(ALGORITHMS).includes(normalized)) {
    return normalized;
  }
  return DEFAULT_ALGORITHM;
}

module.exports = { DistributedRateLimiter, ALGORITHMS };
