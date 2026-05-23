"use strict";

const { debug } = require('../debug');

/**
 * RetryPolicy — resilience pattern for retrying failed operations
 * with configurable backoff strategies.
 *
 * Supported strategies:
 *   FIXED       — constant delay between attempts
 *   EXPONENTIAL — delay doubles each attempt (2^attempt * base)
 *   FIBONACCI   — delay follows Fibonacci sequence (fib(attempt) * base)
 *   JITTER      — randomized delay within a range
 *
 * Pre-built policies:
 *   DEFAULT    — 3 retries, 500ms base, exponential backoff
 *   AGGRESSIVE — 7 retries, 200ms base, exponential backoff
 *   CAUTIOUS   — 2 retries, 2000ms base, exponential backoff, longer max
 */

const STRATEGY = {
  FIXED: 'FIXED',
  EXPONENTIAL: 'EXPONENTIAL',
  FIBONACCI: 'FIBONACCI',
  JITTER: 'JITTER',
};

// ---- Fibonacci helpers (cached) ----

const _fibCache = [0, 1];

function fib(n) {
  if (n < _fibCache.length) return _fibCache[n];
  for (let i = _fibCache.length; i <= n; i += 1) {
    _fibCache[i] = _fibCache[i - 1] + _fibCache[i - 2];
  }
  return _fibCache[n];
}

// ---- Delay strategies ----

const delayStrategies = {
  [STRATEGY.FIXED](_attempt, baseDelay) {
    return baseDelay;
  },

  [STRATEGY.EXPONENTIAL](attempt, baseDelay, _maxDelay) {
    return Math.min(_maxDelay, baseDelay * Math.pow(2, attempt));
  },

  [STRATEGY.FIBONACCI](attempt, baseDelay, _maxDelay) {
    return Math.min(_maxDelay, fib(attempt + 1) * baseDelay);
  },

  [STRATEGY.JITTER](_attempt, baseDelay, _maxDelay) {
    const range = Math.min(_maxDelay, baseDelay * 3);
    const minDelay = Math.max(0, baseDelay * 0.5);
    return minDelay + Math.random() * (range - minDelay);
  },
};

// ---- RetryPolicy ----

class RetryPolicy {
  /**
   * @param {object} [options]
   * @param {number} [options.maxRetries=3]       — max retry attempts
   * @param {number} [options.baseDelay=500]      — base delay in ms
   * @param {number} [options.maxDelay=30000]     — max delay cap in ms
   * @param {string} [options.strategy='EXPONENTIAL'] — backoff strategy
   * @param {Array<string|RegExp|Function>} [options.retryOn] — retryable error conditions
   * @param {boolean} [options.retryAllErrors=true] — retry all errors when retryOn is empty
   * @param {Function} [options.onRetry]           — callback(attempt, error, delay)
   * @param {string} [options.name]                — optional name for debugging
   */
  constructor(options = {}) {
    this._maxRetries = positiveInteger(options.maxRetries, 3);
    this._baseDelay = positiveInteger(options.baseDelay, 500);
    this._maxDelay = Math.max(this._baseDelay, positiveInteger(options.maxDelay, 30_000));
    this._strategy = validStrategy(options.strategy);
    this._retryOn = Array.isArray(options.retryOn) ? options.retryOn : [];
    this._retryAllErrors = this._retryOn.length === 0 && options.retryAllErrors !== false;
    this._onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;
    this._name = options.name || 'retry-policy';

    this._attempt = 0;
  }

  /**
   * Execute a function with retry logic.
   *
   * @param {Function} fn — async or sync function to execute
   * @returns {Promise<any>} result of fn
   * @throws {Error} the last error if all retries are exhausted
   */
  async execute(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('RetryPolicy.execute: fn must be a function');
    }

    this._attempt = 0;
    let lastError = null;

    while (this._attempt <= this._maxRetries) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error;
        this._attempt += 1;

        if (!this.shouldRetry(error) || this._attempt > this._maxRetries) {
          throw error;
        }

        const delayMs = this._calculateDelay();

        debug('retry',
          `[${this._name}] attempt ${this._attempt}/${this._maxRetries} failed: ${error.message}. ` +
          `Retrying in ${Math.round(delayMs)}ms (strategy=${this._strategy})`);

        if (this._onRetry) {
          try {
            this._onRetry(this._attempt, error, delayMs);
          } catch (_) {
            // suppress callback errors
          }
        }

        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Check if an error should trigger a retry.
   *
   * @param {Error} error
   * @returns {boolean}
   */
  shouldRetry(error) {
    if (this._retryAllErrors) return true;
    if (this._retryOn.length === 0) return false;

    const message = String(error?.message || '');
    const code = error?.code || '';
    const combined = `${message} ${code}`;

    for (const condition of this._retryOn) {
      if (typeof condition === 'function') {
        try {
          if (condition(error)) return true;
        } catch (_) {
          // condition evaluation failed, skip
        }
      } else if (condition instanceof RegExp) {
        if (condition.test(combined)) return true;
      } else if (typeof condition === 'string') {
        if (combined.toLowerCase().includes(condition.toLowerCase())) return true;
      }
    }

    return false;
  }

  /**
   * Get the current attempt number (1-based).
   *
   * @returns {number}
   */
  getAttempt() {
    return this._attempt;
  }

  /**
   * Reset attempt counter for re-use.
   */
  reset() {
    this._attempt = 0;
  }

  /** @returns {{ maxRetries: number, baseDelay: number, maxDelay: number, strategy: string }} */
  get config() {
    return {
      maxRetries: this._maxRetries,
      baseDelay: this._baseDelay,
      maxDelay: this._maxDelay,
      strategy: this._strategy,
    };
  }

  // ---- private ----

  _calculateDelay() {
    const compute = delayStrategies[this._strategy] || delayStrategies[STRATEGY.EXPONENTIAL];
    const raw = compute(this._attempt, this._baseDelay, this._maxDelay);
    return Math.max(0, Math.min(this._maxDelay, Math.round(raw)));
  }
}

// ---- Pre-built policies ----

/**
 * Default policy: 3 retries, 500ms base, exponential backoff.
 * @returns {RetryPolicy}
 */
function DEFAULT() {
  return new RetryPolicy({
    maxRetries: 3,
    baseDelay: 500,
    maxDelay: 10_000,
    strategy: STRATEGY.EXPONENTIAL,
  });
}

/**
 * Aggressive policy: 7 retries, 200ms base, exponential backoff.
 * @returns {RetryPolicy}
 */
function AGGRESSIVE() {
  return new RetryPolicy({
    maxRetries: 7,
    baseDelay: 200,
    maxDelay: 5_000,
    strategy: STRATEGY.EXPONENTIAL,
  });
}

/**
 * Cautious policy: 2 retries, 2000ms base, exponential backoff, longer max.
 * @returns {RetryPolicy}
 */
function CAUTIOUS() {
  return new RetryPolicy({
    maxRetries: 2,
    baseDelay: 2_000,
    maxDelay: 60_000,
    strategy: STRATEGY.EXPONENTIAL,
  });
}

// ---- Helpers ----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validStrategy(value) {
  const upper = String(value || '').toUpperCase();
  return STRATEGY[upper] ? upper : STRATEGY.EXPONENTIAL;
}

module.exports = {
  RetryPolicy,
  STRATEGY,
  DEFAULT,
  AGGRESSIVE,
  CAUTIOUS,
};
