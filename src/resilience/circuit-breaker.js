"use strict";

const { EventEmitter } = require('node:events');
const { debug } = require('../debug');

/**
 * Circuit Breaker — resilience pattern that prevents cascading failures.
 *
 * Monitors call success/failure and "trips" to OPEN state when failures
 * exceed a threshold within a sliding time window. Once OPEN, calls
 * fast-fail until the reset timeout elapses, at which point the breaker
 * transitions to HALF_OPEN to test recovery.
 *
 * States:
 *   CLOSED    — normal operation, calls go through
 *   OPEN      — fast-fail, calls are rejected immediately
 *   HALF_OPEN — limited calls allowed to probe recovery
 *
 * Events emitted:
 *   - 'open'      : breaker transitions to OPEN
 *   - 'close'     : breaker transitions to CLOSED
 *   - 'half-open' : breaker transitions to HALF_OPEN
 *   - 'trip'      : threshold exceeded (fires alongside 'open')
 */

const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
const DEFAULT_HALF_OPEN_MAX_CALLS = 1;
const DEFAULT_SLIDING_WINDOW_MS = 30_000;

class CircuitBreaker extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.failureThreshold=5]    — failures in window before tripping
   * @param {number} [options.resetTimeout=30000]    — ms to stay OPEN before HALF_OPEN
   * @param {number} [options.halfOpenMaxCalls=1]    — max concurrent calls in HALF_OPEN
   * @param {number} [options.slidingWindowMs]       — ms for the sliding failure window
   * @param {string} [options.name]                  — optional name for debugging
   */
  constructor(options = {}) {
    super();

    this._failureThreshold = positiveInteger(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD);
    this._resetTimeoutMs = positiveInteger(options.resetTimeout, DEFAULT_RESET_TIMEOUT_MS);
    this._halfOpenMaxCalls = positiveInteger(options.halfOpenMaxCalls, DEFAULT_HALF_OPEN_MAX_CALLS);
    this._slidingWindowMs = positiveInteger(options.slidingWindowMs, DEFAULT_SLIDING_WINDOW_MS);
    this._name = options.name || 'circuit-breaker';

    this._state = STATE.CLOSED;
    this._failureTimestamps = [];
    this._halfOpenActive = 0;
    this._successCount = 0;
    this._failureCount = 0;
    this._rejectedCount = 0;
    this._openedAt = null;

    this._resetTimer = null;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * @param {Function} fn — async or sync function to execute
   * @returns {Promise<any>} result of fn
   * @throws {CircuitBreakerOpenError} if the breaker is OPEN
   * @throws {Error} re-throws fn's error on failure
   */
  async execute(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('CircuitBreaker.execute: fn must be a function');
    }

    // OPEN — fast-fail
    if (this._state === STATE.OPEN) {
      this._rejectedCount += 1;

      debug('circuit-breaker',
        `[${this._name}] OPEN — rejecting call (rejected=${this._rejectedCount})`);

      const err = new CircuitBreakerOpenError(
        `Circuit breaker [${this._name}] is OPEN. ` +
        `Opened at ${this._openedAt?.toISOString() || 'unknown'}, ` +
        `reset in ~${this._timeUntilReset()}ms.`
      );
      err.code = 'CIRCUIT_BREAKER_OPEN';
      throw err;
    }

    // HALF_OPEN — limited concurrency probe
    if (this._state === STATE.HALF_OPEN) {
      if (this._halfOpenActive >= this._halfOpenMaxCalls) {
        this._rejectedCount += 1;

        debug('circuit-breaker',
          `[${this._name}] HALF_OPEN — rejecting (active=${this._halfOpenActive}, max=${this._halfOpenMaxCalls})`);

        const err = new CircuitBreakerOpenError(
          `Circuit breaker [${this._name}] is HALF_OPEN and at capacity (${this._halfOpenActive}/${this._halfOpenMaxCalls}).`
        );
        err.code = 'CIRCUIT_BREAKER_HALF_OPEN_FULL';
        throw err;
      }

      this._halfOpenActive += 1;
    }

    // CLOSED or HALF_OPEN — execute
    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    } finally {
      if (this._state === STATE.HALF_OPEN) {
        this._halfOpenActive = Math.max(0, this._halfOpenActive - 1);
      }
    }
  }

  /**
   * Force the breaker back to CLOSED state, clearing failure history.
   */
  reset() {
    this._transitionTo(STATE.CLOSED);
    this._failureTimestamps = [];
    this._openedAt = null;
    this._successCount = 0;
    this._failureCount = 0;
    this._rejectedCount = 0;
    this._halfOpenActive = 0;

    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
      this._resetTimer = null;
    }

    debug('circuit-breaker', `[${this._name}] manually reset to CLOSED`);
  }

  /**
   * Get current state and detailed statistics.
   *
   * @returns {{ state: string, stats: object }}
   */
  getState() {
    return {
      state: this._state,
      stats: {
        successCount: this._successCount,
        failureCount: this._failureCount,
        rejectedCount: this._rejectedCount,
        failureWindowCount: this._countFailuresInWindow(),
        halfOpenActive: this._halfOpenActive,
        openedAt: this._openedAt,
        timeUntilReset: this._state === STATE.OPEN ? this._timeUntilReset() : null,
      },
    };
  }

  /** @returns {string} current state (CLOSED / OPEN / HALF_OPEN) */
  get state() {
    return this._state;
  }

  // ---- private ----

  _onSuccess() {
    this._successCount += 1;

    if (this._state === STATE.HALF_OPEN) {
      // A single success in HALF_OPEN proves recovery
      debug('circuit-breaker', `[${this._name}] HALF_OPEN success — closing circuit`);
      this._transitionTo(STATE.CLOSED);
      this._failureTimestamps = [];
      this._openedAt = null;
    }
  }

  _onFailure() {
    this._failureCount += 1;

    const now = Date.now();
    this._failureTimestamps.push(now);

    if (this._state === STATE.HALF_OPEN) {
      // Any failure in HALF_OPEN re-opens immediately
      debug('circuit-breaker', `[${this._name}] HALF_OPEN failure — re-opening circuit`);
      this._transitionTo(STATE.OPEN);
      this._openedAt = new Date();
      this._scheduleHalfOpen();
      return;
    }

    // CLOSED — check sliding window threshold
    const windowFailures = this._countFailuresInWindow();

    if (windowFailures >= this._failureThreshold) {
      debug('circuit-breaker',
        `[${this._name}] threshold exceeded (${windowFailures}/${this._failureThreshold}) — tripping`);

      this.emit('trip', {
        name: this._name,
        failures: windowFailures,
        threshold: this._failureThreshold,
      });

      this._transitionTo(STATE.OPEN);
      this._openedAt = new Date();
      this._scheduleHalfOpen();
    }
  }

  _countFailuresInWindow() {
    const now = Date.now();
    const cutoff = now - this._slidingWindowMs;

    // Remove expired entries
    while (this._failureTimestamps.length > 0 && this._failureTimestamps[0] < cutoff) {
      this._failureTimestamps.shift();
    }

    return this._failureTimestamps.length;
  }

  _transitionTo(newState) {
    if (this._state === newState) return;

    const oldState = this._state;
    this._state = newState;

    debug('circuit-breaker', `[${this._name}] ${oldState} → ${newState}`);

    if (newState === STATE.OPEN) {
      this.emit('open', { name: this._name, previous: oldState });
    } else if (newState === STATE.CLOSED) {
      this.emit('close', { name: this._name, previous: oldState });
    } else if (newState === STATE.HALF_OPEN) {
      this.emit('half-open', { name: this._name, previous: oldState });
    }
  }

  _scheduleHalfOpen() {
    if (this._resetTimer) {
      clearTimeout(this._resetTimer);
    }

    this._resetTimer = setTimeout(() => {
      this._resetTimer = null;

      if (this._state === STATE.OPEN) {
        debug('circuit-breaker', `[${this._name}] reset timeout elapsed — transitioning to HALF_OPEN`);
        this._transitionTo(STATE.HALF_OPEN);
      }
    }, this._resetTimeoutMs);

    // Allow timer to not hold the process (tests)
    if (this._resetTimer && typeof this._resetTimer.unref === 'function') {
      this._resetTimer.unref();
    }
  }

  _timeUntilReset() {
    if (!this._openedAt) return 0;
    const elapsed = Date.now() - this._openedAt.getTime();
    return Math.max(0, this._resetTimeoutMs - elapsed);
  }
}

/**
 * Error thrown when a call is rejected because the breaker is OPEN.
 */
class CircuitBreakerOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.code = 'CIRCUIT_BREAKER_OPEN';
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerOpenError,
  STATE,
};
