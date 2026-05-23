"use strict";

const { EventEmitter } = require("node:events");

/**
 * TaskTracker -- real-time task execution tracking.
 *
 * Monitors task lifecycle events (start, complete, fail, block) and provides
 * aggregate progress reports.  Emits events so downstream listeners can react
 * to state changes without polling.
 */

const STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
};

// ---------------------------------------------------------------------------
// TaskTracker
// ---------------------------------------------------------------------------

class TaskTracker extends EventEmitter {
  /**
   * @param {{ tasks?: { id: string, title?: string }[] }} [opts]
   */
  constructor(opts = {}) {
    super();

    /** @type {Map<string, { id: string, title: string, status: string, result?: any, error?: any, reason?: string, startedAt?: string, completedAt?: string }>} */
    this._tasks = new Map();

    if (opts.tasks && Array.isArray(opts.tasks)) {
      for (const task of opts.tasks) {
        this._registerTask(task);
      }
    }

    /** @type {number} */
    this._startedAt = null;
  }

  // ---- Task registration ----------------------------------------------------

  /**
   * Register a task for tracking.  Called automatically if a tasks array is
   * provided to the constructor; also exposed for dynamic registration.
   *
   * @param {{ id: string, title?: string }} task
   * @returns {TaskTracker}
   */
  _registerTask(task) {
    if (!task || !task.id) return this;

    const id = String(task.id).trim();
    if (id.length === 0 || this._tasks.has(id)) return this;

    this._tasks.set(id, {
      id,
      title: String(task.title || id),
      status: STATUS.PENDING,
      result: undefined,
      error: undefined,
      reason: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });

    return this;
  }

  // ---- Lifecycle methods ----------------------------------------------------

  /**
   * Mark a task as started (in progress).
   *
   * @param {string} taskId
   * @returns {boolean} true if transition was valid
   */
  start(taskId) {
    const task = this._resolve(taskId);
    if (!task) return false;

    if (task.status !== STATUS.PENDING) return false;

    task.status = STATUS.IN_PROGRESS;
    task.startedAt = new Date().toISOString();

    if (this._startedAt === null) {
      this._startedAt = Date.now();
    }

    /** @type {import("node:events")} */
    this.emit("task:start", {
      id: task.id,
      title: task.title,
      startedAt: task.startedAt,
      progress: this.getProgress(),
    });

    return true;
  }

  /**
   * Mark a task as completed with an optional result.
   *
   * @param {string} taskId
   * @param {*} [result]
   * @returns {boolean} true if transition was valid
   */
  complete(taskId, result) {
    const task = this._resolve(taskId);
    if (!task) return false;

    if (task.status !== STATUS.IN_PROGRESS) return false;

    task.status = STATUS.COMPLETED;
    task.result = result !== undefined ? result : null;
    task.completedAt = new Date().toISOString();

    const progress = this.getProgress();

    /** @type {import("node:events")} */
    this.emit("task:complete", {
      id: task.id,
      title: task.title,
      result: task.result,
      completedAt: task.completedAt,
      progress,
    });

    // Emit all:complete when every task is finished
    if (progress.done + progress.failed === progress.total && progress.total > 0) {
      /** @type {import("node:events")} */
      this.emit("all:complete", {
        progress,
        completedCount: progress.done,
        failedCount: progress.failed,
        blockedCount: progress.blocked,
      });
    }

    return true;
  }

  /**
   * Mark a task as failed.
   *
   * @param {string} taskId
   * @param {*} [error] -- error object or message describing the failure
   * @returns {boolean} true if transition was valid
   */
  fail(taskId, error) {
    const task = this._resolve(taskId);
    if (!task) return false;

    // Allow fail from PENDING or IN_PROGRESS
    if (task.status === STATUS.COMPLETED || task.status === STATUS.FAILED) {
      return false;
    }

    task.status = STATUS.FAILED;
    task.error = error !== undefined ? error : null;
    task.completedAt = new Date().toISOString();

    const progress = this.getProgress();

    /** @type {import("node:events")} */
    this.emit("task:fail", {
      id: task.id,
      title: task.title,
      error: task.error,
      completedAt: task.completedAt,
      progress,
    });

    // Emit all:complete when every task is finished
    if (progress.done + progress.failed === progress.total && progress.total > 0) {
      /** @type {import("node:events")} */
      this.emit("all:complete", {
        progress,
        completedCount: progress.done,
        failedCount: progress.failed,
        blockedCount: progress.blocked,
      });
    }

    return true;
  }

  /**
   * Mark a task as blocked (waiting on an external dependency).
   *
   * @param {string} taskId
   * @param {string} reason -- human-readable reason for the block
   * @returns {boolean} true if transition was valid
   */
  block(taskId, reason) {
    const task = this._resolve(taskId);
    if (!task) return false;

    if (task.status !== STATUS.PENDING && task.status !== STATUS.IN_PROGRESS) {
      return false;
    }

    task.status = STATUS.BLOCKED;
    task.reason = reason || null;

    /** @type {import("node:events")} */
    this.emit("task:block", {
      id: task.id,
      title: task.title,
      reason: task.reason,
      progress: this.getProgress(),
    });

    return true;
  }

  // ---- Aggregation ----------------------------------------------------------

  /**
   * Get the full status of all tracked tasks.
   *
   * @returns {object[]}
   */
  getStatus() {
    return [...this._tasks.values()].map(cloneState);
  }

  /**
   * Get aggregate progress counters and percentage.
   *
   * @returns {{ total: number, done: number, inProgress: number, blocked: number, failed: number, percent: number }}
   */
  getProgress() {
    let total = 0;
    let done = 0;
    let inProgress = 0;
    let blocked = 0;
    let failed = 0;

    for (const [, task] of this._tasks) {
      total += 1;
      switch (task.status) {
        case STATUS.COMPLETED:
          done += 1;
          break;
        case STATUS.IN_PROGRESS:
          inProgress += 1;
          break;
        case STATUS.BLOCKED:
          blocked += 1;
          break;
        case STATUS.FAILED:
          failed += 1;
          break;
        // PENDING contributes to total but no counter
      }
    }

    const finished = done + failed;
    const percent = total === 0 ? 0 : Math.round((finished / total) * 100);

    return { total, done, inProgress, blocked, failed, percent };
  }

  // ---- Task query -----------------------------------------------------------

  /**
   * Get the current state of a single task.
   *
   * @param {string} taskId
   * @returns {object|undefined}
   */
  getTask(taskId) {
    const task = this._resolve(taskId);
    return task ? cloneState(task) : undefined;
  }

  /**
   * Return the number of tracked tasks.
   * @returns {number}
   */
  get size() {
    return this._tasks.size;
  }

  // ---- Bulk operations ------------------------------------------------------

  /**
   * Reset all tasks to their initial pending state.
   */
  reset() {
    for (const [, task] of this._tasks) {
      task.status = STATUS.PENDING;
      task.result = undefined;
      task.error = undefined;
      task.reason = undefined;
      task.startedAt = undefined;
      task.completedAt = undefined;
    }
    this._startedAt = null;
  }

  /**
   * Remove all tasks from tracking.
   */
  clear() {
    this._tasks.clear();
    this._startedAt = null;
  }

  // ---- Internal -------------------------------------------------------------

  /** @param {string} taskId */
  _resolve(taskId) {
    const id = String(taskId || "").trim();
    if (!id) return null;
    return this._tasks.get(id) || null;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

function cloneState(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    result: task.result,
    error: task.error,
    reason: task.reason,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
  };
}

module.exports = {
  TaskTracker,
  STATUS,
};
