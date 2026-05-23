"use strict";

const { debug } = require('../debug');

/**
 * Bulkhead — resilience pattern that limits concurrent execution to prevent
 * resource exhaustion. A "semaphore" controls how many calls can run
 * simultaneously; excess calls are queued or rejected.
 *
 * Queue overflow policies:
 *   THROW       — reject immediately (default)
 *   CALLER_RUNS — execute synchronously in the caller's context
 */

const OVERFLOW_POLICY = {
  THROW: 'THROW',
  CALLER_RUNS: 'CALLER_RUNS',
};

const DEFAULT_MAX_CONCURRENT = 10;
const DEFAULT_MAX_QUEUE = 100;

// ---- Semaphore (low-level) ----

class Semaphore {
  /**
   * @param {number} maxConcurrent — max simultaneous permits
   * @param {number} [maxQueue=Infinity] — max queued waiters
   */
  constructor(maxConcurrent, maxQueue = Infinity) {
    this._maxConcurrent = positiveInteger(maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this._maxQueue = Number.isFinite(maxQueue) ? Math.max(0, maxQueue) : Infinity;

    this._active = 0;
    this._waiters = [];
    this._totalAcquired = 0;
    this._totalRejected = 0;
  }

  /**
   * Acquire a permit. If none available, queue until one is released.
   *
   * @returns {Promise<() => void>} release function
   * @throws {BulkheadRejectedError} if queue is full
   */
  async acquire() {
    if (this._active < this._maxConcurrent) {
      this._active += 1;
      this._totalAcquired += 1;
      return this._createRelease();
    }

    // queue is full
    if (this._waiters.length >= this._maxQueue) {
      this._totalRejected += 1;
      throw new BulkheadRejectedError(
        `Semaphore queue full (${this._waiters.length}/${this._maxQueue}).`
      );
    }

    // enqueue
    this._totalAcquired += 1;
    return new Promise((resolve, reject) => {
      this._waiters.push({ resolve, reject });
    });
  }

  /**
   * Release a permit and wake the next waiter.
   */
  release() {
    if (this._active > 0) {
      this._active -= 1;
    }

    // Wake next waiter
    if (this._waiters.length > 0) {
      const next = this._waiters.shift();
      this._active += 1;
      next.resolve(this._createRelease());
    }
  }

  /** @returns {{ active: number, waiting: number, maxConcurrent: number }} */
  getStats() {
    return {
      active: this._active,
      waiting: this._waiters.length,
      maxConcurrent: this._maxConcurrent,
      totalAcquired: this._totalAcquired,
      totalRejected: this._totalRejected,
    };
  }

  /** @returns {number} */
  get active() {
    return this._active;
  }

  /** @returns {number} */
  get waiting() {
    return this._waiters.length;
  }

  _createRelease() {
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.release();
      }
    };
  }
}

// ---- Bulkhead ----

class Bulkhead {
  /**
   * @param {object} [options]
   * @param {number} [options.maxConcurrent=10]  — max parallel executions
   * @param {number} [options.maxQueue=100]      — max queued calls
   * @param {string} [options.overflowPolicy='THROW'] — 'THROW' | 'CALLER_RUNS'
   * @param {string} [options.name]              — optional name for debugging
   */
  constructor(options = {}) {
    this._maxConcurrent = positiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this._maxQueue = Number.isFinite(options.maxQueue) && options.maxQueue >= 0
      ? Math.max(0, Math.floor(options.maxQueue))
      : DEFAULT_MAX_QUEUE;
    this._overflowPolicy = options.overflowPolicy === OVERFLOW_POLICY.CALLER_RUNS
      ? OVERFLOW_POLICY.CALLER_RUNS
      : OVERFLOW_POLICY.THROW;
    this._name = options.name || 'bulkhead';

    this._semaphore = new Semaphore(this._maxConcurrent, this._maxQueue);
    this._totalExecuted = 0;
    this._totalRejected = 0;
  }

  /**
   * Execute a function through the bulkhead.
   *
   * @param {Function} fn — async or sync function
   * @returns {Promise<any>} result of fn
   * @throws {BulkheadRejectedError} if queue is full (THROW policy)
   */
  async execute(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Bulkhead.execute: fn must be a function');
    }

    let release;

    try {
      release = await this._semaphore.acquire();
    } catch (error) {
      this._totalRejected += 1;

      if (this._overflowPolicy === OVERFLOW_POLICY.CALLER_RUNS) {
        debug('bulkhead',
          `[${this._name}] queue full — using CALLER_RUNS (rejected=${this._totalRejected})`);
        this._totalExecuted += 1;
        return fn();
      }

      debug('bulkhead',
        `[${this._name}] rejecting call (rejected=${this._totalRejected})`);
      throw error;
    }

    try {
      this._totalExecuted += 1;
      const result = await fn();
      return result;
    } finally {
      if (release) release();
    }
  }

  /**
   * @returns {{ active: number, queueSize: number, totalExecuted: number, rejected: number, maxConcurrent: number, maxQueue: number }}
   */
  getStats() {
    const s = this._semaphore.getStats();
    return {
      active: s.active,
      queueSize: s.waiting,
      totalExecuted: this._totalExecuted,
      rejected: this._totalRejected,
      maxConcurrent: s.maxConcurrent,
      maxQueue: this._maxQueue,
    };
  }

  /** @returns {number} */
  get active() {
    return this._semaphore.active;
  }

  /** @returns {number} */
  get queueSize() {
    return this._semaphore.waiting;
  }

  /** @returns {string} */
  get overflowPolicy() {
    return this._overflowPolicy;
  }

  /** @returns {string} */
  get name() {
    return this._name;
  }
}

/**
 * Convenience wrapper — execute fn through a bulkhead.
 *
 * @param {Bulkhead} bulkhead
 * @param {Function} fn
 * @returns {Promise<any>}
 */
async function withBulkhead(bulkhead, fn) {
  return bulkhead.execute(fn);
}

// ---- Errors ----

class BulkheadRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BulkheadRejectedError';
    this.code = 'BULKHEAD_REJECTED';
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  Bulkhead,
  Semaphore,
  BulkheadRejectedError,
  withBulkhead,
  OVERFLOW_POLICY,
};
