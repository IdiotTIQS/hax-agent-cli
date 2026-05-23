"use strict";

/**
 * Task worker — pulls jobs from a TaskQueue and executes them with
 * retry logic, timeouts, and concurrency control.
 *
 * Emits lifecycle events so monitors / loggers can observe progress.
 */

const EventEmitter = require('node:events');
const { debug } = require('../debug');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

class TaskWorkerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskWorkerError';
    this.code = String(code);
  }
}

// ---------------------------------------------------------------------------
// TaskWorker
// ---------------------------------------------------------------------------

class TaskWorker extends EventEmitter {
  /**
   * @param {object} options
   * @param {object} options.queue        - A TaskQueue instance
   * @param {Function} options.executor   - async (task) => result — user-provided executor
   * @param {number} [options.concurrency=1] - Max parallel tasks
   * @param {number} [options.pollInterval=100] - ms between queue polls when idle
   * @param {number} [options.maxRetries=3]    - Default retry count per task
   * @param {number} [options.timeout=30000]   - Default per-task timeout (ms)
   * @param {Function} [options.sleepFn]       - (ms) => Promise, overridable for tests
   */
  constructor(options = {}) {
    super();

    if (!options.queue) {
      throw new TaskWorkerError('MISSING_QUEUE', 'options.queue is required');
    }
    if (typeof options.executor !== 'function') {
      throw new TaskWorkerError('MISSING_EXECUTOR', 'options.executor must be a function');
    }

    /** @type {import('./queue').TaskQueue} */
    this.queue = options.queue;
    this._executor = options.executor;

    this._concurrency = clampInt(options.concurrency, 1, 1024, 1);
    this._pollInterval = clampInt(options.pollInterval, 1, 60_000, 100);
    this._defaultMaxRetries = clampInt(options.maxRetries, 0, 100, 3);
    this._defaultTimeout = clampInt(options.timeout, 0, 600_000, 30_000);
    this._sleep = typeof options.sleepFn === 'function'
      ? options.sleepFn
      : (ms) => new Promise((r) => setTimeout(r, ms));

    /** @type {'idle'|'running'|'paused'|'stopped'} */
    this._state = 'idle';

    this._running = new Set();   // task ids currently executing
    this._loopTimer = null;
    this._stopResolve = null;

    // Stats
    this._stats = {
      completed: 0,
      failed: 0,
      retried: 0,
      totalDurationMs: 0,
      taskDurations: [],
    };
  }

  // ---- lifecycle ----

  /**
   * Start pulling tasks from the queue and processing them.
   * Idempotent — calling start() when already running is a no-op.
   */
  start() {
    if (this._state === 'running') return;
    this._state = 'running';
    debug('scheduler:worker', 'worker started');
    this._schedulePoll();
  }

  /**
   * Graceful shutdown: finish in-flight tasks, then stop.
   * @returns {Promise<void>} Resolves when all in-flight tasks complete.
   */
  stop() {
    return new Promise((resolve) => {
      if (this._state === 'idle' || this._state === 'stopped') {
        this._state = 'stopped';
        return resolve();
      }

      this._state = 'stopped';
      debug('scheduler:worker', 'worker stopping (graceful)');

      if (this._running.size === 0) {
        this._clearTimer();
        this.emit('worker.idle');
        return resolve();
      }

      this._stopResolve = resolve;
    });
  }

  /**
   * Pause processing.  In-flight tasks continue; no new tasks are dequeued.
   */
  pause() {
    if (this._state !== 'running') return;
    this._state = 'paused';
    this._clearTimer();
    debug('scheduler:worker', 'worker paused');
  }

  /**
   * Resume processing after pause().
   */
  resume() {
    if (this._state !== 'paused') return;
    this._state = 'running';
    debug('scheduler:worker', 'worker resumed');
    this._schedulePoll();
  }

  // ---- concurrency ----

  /**
   * Change the maximum number of parallel tasks.
   * @param {number} n
   */
  setConcurrency(n) {
    this._concurrency = clampInt(n, 1, 1024, 1);
    // If we were below capacity and idle, kick off a poll.
    if (this._state === 'running' && this._running.size < this._concurrency) {
      this._schedulePoll();
    }
  }

  get concurrency() {
    return this._concurrency;
  }

  // ---- stats ----

  /**
   * Return current worker statistics.
   * @returns {{ completed: number, failed: number, retried: number, avgDurationMs: number, active: number }}
   */
  getStats() {
    const durations = this._stats.taskDurations;
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    return {
      completed: this._stats.completed,
      failed: this._stats.failed,
      retried: this._stats.retried,
      avgDurationMs,
      active: this._running.size,
      state: this._state,
    };
  }

  get state() {
    return this._state;
  }

  // ---- internals ----

  _schedulePoll() {
    if (this._loopTimer) return; // already scheduled
    this._loopTimer = setImmediate(() => this._poll());
  }

  _clearTimer() {
    if (this._loopTimer) {
      clearImmediate(this._loopTimer);
      this._loopTimer = null;
    }
  }

  async _poll() {
    this._clearTimer();

    // Check if we should keep going.
    if (this._state !== 'running') {
      if (this._state === 'stopped' && this._running.size === 0) {
        if (this._stopResolve) {
          this._stopResolve();
          this._stopResolve = null;
        }
        this.emit('worker.idle');
      }
      // If paused, do nothing — resume() will restart polls.
      return;
    }

    // Fill up to concurrency.
    while (this._running.size < this._concurrency) {
      const task = this.queue.dequeue();
      if (!task) break;

      this._running.add(task.id);
      this._processOne(task).finally(() => {
        this._running.delete(task.id);

        // Re-poll after task finishes so we can pick up more work
        // or finalize if stopping.
        if (this._state === 'running') {
          this._schedulePoll();
        } else if (this._state === 'stopped' && this._running.size === 0) {
          if (this._stopResolve) {
            this._stopResolve();
            this._stopResolve = null;
          }
          this.emit('worker.idle');
        }
      });
    }

    // If running but no capacity left, the .finally() callbacks above
    // will re-poll as tasks complete.
    // If idle (nothing running, nothing queued), poll after interval
    // to wake up when delayed tasks become ready.
    if (this._state === 'running' && this._running.size === 0 && this.queue.isEmpty()) {
      this._loopTimer = setTimeout(() => this._poll(), this._pollInterval);
    }
  }

  async _processOne(task) {
    const maxRetries = task.maxRetries !== undefined ? task.maxRetries : this._defaultMaxRetries;
    const timeoutMs = task.timeout !== undefined ? task.timeout : this._defaultTimeout;

    this.emit('task.start', { task });

    const t0 = Date.now();

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const result = await this._executeWithTimeout(task, timeoutMs);
        const duration = Date.now() - t0;

        this._stats.completed += 1;
        this._stats.totalDurationMs += duration;
        this._stats.taskDurations.push(duration);

        this.queue.markCompleted(task.id);
        this.emit('task.complete', { task, result, duration, attempts: attempt });
        return;
      } catch (error) {
        if (attempt > maxRetries) {
          // All retries exhausted.
          const duration = Date.now() - t0;
          this._stats.failed += 1;
          this._stats.totalDurationMs += duration;

          this.queue.markFailed(task.id);
          this.emit('task.error', { task, error, duration, attempts: attempt });
          return;
        }

        // Retry.
        this._stats.retried += 1;
        const delay = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
        const jitter = Math.random() * delay * 0.3;
        const waitMs = Math.round(delay + jitter);

        this.emit('task.retry', { task, error, attempt, nextAttemptIn: waitMs });
        debug('scheduler:worker', `task ${task.id} attempt ${attempt}/${maxRetries + 1} failed: ${error.message}. Retrying in ${waitMs}ms`);

        await this._sleep(waitMs);
      }
    }
  }

  /**
   * Execute a task with an upper-bound timeout.
   * If the executor does not settle within `timeoutMs`, the promise rejects
   * with a timeout error.
   *
   * @param {object} task
   * @param {number} timeoutMs - 0 means no timeout
   * @returns {Promise<*>}
   */
  async _executeWithTimeout(task, timeoutMs) {
    if (!timeoutMs || timeoutMs <= 0) {
      return this._executor(task);
    }

    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new TaskWorkerError('TASK_TIMEOUT', `Task ${task.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([this._executor(task), timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timerId);
    }
  }
}

module.exports = { TaskWorker, TaskWorkerError };
