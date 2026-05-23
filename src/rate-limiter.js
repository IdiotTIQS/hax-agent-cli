"use strict";

/**
 * Token-bucket rate limiter for API calls and tool execution.
 *
 * Tracks usage over time windows and delays/throttles when limits are exceeded.
 * Supports both global limits and per-operation-type limits.
 */

class RateLimiter {
  /**
   * @param {object} options
   * @param {number} [options.maxTokens=60] - Maximum tokens in the bucket
   * @param {number} [options.refillRate=1] - Tokens refilled per interval
   * @param {number} [options.refillIntervalMs=1000] - Refill interval in milliseconds
   * @param {number} [options.maxQueueSize=100] - Max queued requests
   */
  constructor(options = {}) {
    this.maxTokens = positiveInteger(options.maxTokens, 60);
    this.refillRate = positiveInteger(options.refillRate, 1);
    this.refillIntervalMs = positiveInteger(options.refillIntervalMs, 1000);
    this.maxQueueSize = positiveInteger(options.maxQueueSize, 100);
    this.availableTokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.queue = [];
    this.waitCount = 0;
    this.throttleCount = 0;
  }

  /**
   * Attempt to acquire a token. Returns immediately if available,
   * otherwise queues and waits.
   * @param {number} [cost=1] - Token cost for this operation
   * @param {number} [timeoutMs=30000] - Max time to wait in ms
   * @returns {Promise<{ acquired: boolean, waitedMs: number }>}
   */
  async acquire(cost = 1, timeoutMs = 30000) {
    const startTime = Date.now();
    this._refill();

    if (cost <= 0) {
      return { acquired: true, waitedMs: 0 };
    }

    if (this.availableTokens >= cost && this.queue.length === 0) {
      this.availableTokens -= cost;
      return { acquired: true, waitedMs: 0 };
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.throttleCount += 1;
      return { acquired: false, waitedMs: 0 };
    }

    this.waitCount += 1;

    try {
      const result = await this._enqueue(cost, timeoutMs, startTime);
      return result;
    } finally {
      this.waitCount = Math.max(0, this.waitCount - 1);
    }
  }

  /**
   * Wrap an async function with rate-limiting.
   * @param {Function} fn - Async function to wrap
   * @param {object} [options]
   * @param {number} [options.cost=1]
   * @param {number} [options.timeoutMs=30000]
   * @returns {Function} Rate-limited wrapper
   */
  wrap(fn, options = {}) {
    const cost = positiveNumber(options.cost, 1);
    const timeoutMs = positiveNumber(options.timeoutMs, 30000);

    return async (...args) => {
      const { acquired, waitedMs } = await this.acquire(cost, timeoutMs);

      if (!acquired) {
        throw new Error('Rate limit exceeded. Try again later.');
      }

      try {
        return await fn(...args);
      } finally {
        // Tokens are not returned on completion (consumed)
      }
    };
  }

  /**
   * Get a snapshot of the current limiter state.
   * @returns {{ availableTokens: number, maxTokens: number, queueSize: number, waitCount: number, throttleCount: number }}
   */
  getStats() {
    this._refill();
    return {
      availableTokens: this.availableTokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      refillIntervalMs: this.refillIntervalMs,
      queueSize: this.queue.length,
      waitCount: this.waitCount,
      throttleCount: this.throttleCount,
    };
  }

  reset() {
    this.availableTokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.queue = [];
    this.waitCount = 0;
    this.throttleCount = 0;
  }

  /**
   * Reject all queued requests with an error.
   */
  drain() {
    const drained = this.queue.splice(0);

    for (const entry of drained) {
      entry.reject(new Error('Rate limiter drained'));
    }
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed < this.refillIntervalMs) {
      return;
    }

    const intervals = Math.floor(elapsed / this.refillIntervalMs);
    this.availableTokens = Math.min(
      this.maxTokens,
      this.availableTokens + intervals * this.refillRate,
    );
    this.lastRefill = now - (elapsed % this.refillIntervalMs);

    this._processQueue();
  }

  _processQueue() {
    while (this.queue.length > 0 && this.availableTokens > 0) {
      const entry = this.queue[0];

      if (this.availableTokens >= entry.cost) {
        this.queue.shift();
        this.availableTokens -= entry.cost;
        clearTimeout(entry.timer);
        const waitedMs = Date.now() - entry.startTime;
        entry.resolve({ acquired: true, waitedMs });
      } else {
        break;
      }
    }
  }

  _enqueue(cost, timeoutMs, startTime) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((e) => e.startTime === startTime);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        const waitedMs = Date.now() - startTime;
        resolve({ acquired: false, waitedMs });
      }, timeoutMs);

      this.queue.push({
        cost,
        resolve,
        reject,
        startTime,
        timer,
      });
    });
  }
}

/**
 * Composite rate limiter that manages multiple named buckets.
 */
class CompositeRateLimiter {
  constructor(defaults = {}) {
    this._limiters = new Map();
    this._defaults = defaults;
    this._global = new RateLimiter(defaults);
  }

  /**
   * Define a named rate limit.
   * @param {string} name
   * @param {object} options - RateLimiter options
   */
  define(name, options = {}) {
    const limiter = new RateLimiter({ ...this._defaults, ...options });
    this._limiters.set(name, limiter);
    return limiter;
  }

  /**
   * Acquire a token from a named limiter.
   * @param {string} name
   * @param {number} [cost=1]
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<{ acquired: boolean, waitedMs: number }>}
   */
  async acquire(name, cost = 1, timeoutMs = 30000) {
    const limiter = this._limiters.get(name);
    if (limiter) {
      return limiter.acquire(cost, timeoutMs);
    }
    return this._global.acquire(cost, timeoutMs);
  }

  /**
   * Wrap a function with a named rate limit.
   * @param {string} name
   * @param {Function} fn
   * @param {object} [options]
   * @returns {Function}
   */
  wrap(name, fn, options = {}) {
    const limiter = this._limiters.get(name);
    if (!limiter) {
      return this._global.wrap(fn, options);
    }
    return limiter.wrap(fn, options);
  }

  getStats() {
    const stats = { global: this._global.getStats(), buckets: {} };
    for (const [name, limiter] of this._limiters) {
      stats.buckets[name] = limiter.getStats();
    }
    return stats;
  }

  reset() {
    this._global.reset();
    for (const limiter of this._limiters.values()) {
      limiter.reset();
    }
  }

  drain() {
    this._global.drain();
    for (const limiter of this._limiters.values()) {
      limiter.drain();
    }
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { RateLimiter, CompositeRateLimiter };
