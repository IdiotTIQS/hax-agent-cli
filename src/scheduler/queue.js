"use strict";

/**
 * Task queue with priority-based scheduling.
 *
 * Manages a backlog of agent tasks ordered by priority (1 = highest, 10 = lowest).
 * Supports task dependencies, delay scheduling, and retry configuration.
 *
 * Uses a min-heap under the hood for O(log n) enqueue/dequeue.
 */

const { debug } = require('../debug');

/**
 * Priority queue backed by a binary min-heap.
 *
 * Ordering key: (priority, createdAt) — lower priority number = higher precedence.
 * When two tasks share the same priority the older one wins (FIFO within band).
 */
class PriorityQueue {
  constructor() {
    /** @type {Array<object>} */
    this._heap = [];
  }

  /**
   * Insert a task into the heap.
   * @param {object} entry - { priority, createdAt, task }
   */
  push(entry) {
    this._heap.push(entry);
    this._siftUp(this._heap.length - 1);
  }

  /**
   * Remove and return the highest-priority entry.
   * @returns {object|null}
   */
  pop() {
    if (this._heap.length === 0) return null;
    if (this._heap.length === 1) return this._heap.pop();

    const root = this._heap[0];
    this._heap[0] = this._heap.pop();
    this._siftDown(0);
    return root;
  }

  /**
   * Return the highest-priority entry without removing it.
   * @returns {object|null}
   */
  peek() {
    return this._heap.length > 0 ? this._heap[0] : null;
  }

  /** Number of entries currently in the heap. */
  get size() {
    return this._heap.length;
  }

  /**
   * Linear-scan removal by task id.  O(n) — use sparingly.
   * @param {string} taskId
   * @param {() => any} [onRemoved] - called with the removed entry after removal
   * @returns {object|null} The removed entry, or null if not found.
   */
  remove(taskId, onRemoved) {
    const idx = this._heap.findIndex((e) => e.task && e.task.id === taskId);
    if (idx === -1) return null;

    const removed = this._heap[idx];
    if (idx === this._heap.length - 1) {
      this._heap.pop();
    } else {
      this._heap[idx] = this._heap.pop();
      const parent = Math.floor((idx - 1) / 2);
      if (idx > 0 && this._compare(this._heap[idx], this._heap[parent]) < 0) {
        this._siftUp(idx);
      } else {
        this._siftDown(idx);
      }
    }

    if (typeof onRemoved === 'function') onRemoved();
    return removed;
  }

  /** Remove all entries from the heap. */
  clear() {
    this._heap.length = 0;
  }

  /**
   * Check whether any queued task is ready (no dependencies blocking it,
   * and its delay has elapsed).
   * @returns {boolean}
   */
  hasReady(now) {
    return this._heap.some((e) => isTaskReady(e.task, now));
  }

  // ---- internals ----

  _compare(a, b) {
    // lower priority value = higher precedence
    if (a.priority !== b.priority) return a.priority - b.priority;
    // older tasks first within same priority band
    return a.createdAt - b.createdAt;
  }

  _siftUp(idx) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this._compare(this._heap[idx], this._heap[parent]) >= 0) break;
      [this._heap[idx], this._heap[parent]] = [this._heap[parent], this._heap[idx]];
      idx = parent;
    }
  }

  _siftDown(idx) {
    const last = this._heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < last && this._compare(this._heap[left], this._heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < last && this._compare(this._heap[right], this._heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === idx) break;

      [this._heap[idx], this._heap[smallest]] = [this._heap[smallest], this._heap[idx]];
      idx = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

const DEFAULT_PRIORITY = 5;
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 10;

let _taskIdCounter = 0;

/**
 * Create a normalized task object.
 *
 * @param {object} input
 * @param {string} [input.id]       - Unique id (auto-generated if omitted)
 * @param {string} [input.name]     - Human-readable label
 * @param {string} [input.type]     - Task type (e.g. "agent-run", "file-scan")
 * @param {*}      [input.data]     - Arbitrary payload passed to the worker
 * @param {number} [input.priority] - 1 (highest) – 10 (lowest), defaults to 5
 * @param {number} [input.delay]    - Minimum ms before task becomes eligible
 * @param {string[]} [input.dependencies] - Task ids that must complete first
 * @param {number} [input.maxRetries]     - Maximum execution attempts, default 3
 * @param {number} [input.timeout]        - Per-attempt timeout in ms, default 30_000
 * @returns {object} Normalized task object
 */
function normalizeTask(input = {}) {
  const now = Date.now();
  const priority = clampInt(input.priority, MIN_PRIORITY, MAX_PRIORITY, DEFAULT_PRIORITY);

  return {
    id: input.id || `task-${++_taskIdCounter}-${now.toString(36)}`,
    name: String(input.name || ''),
    type: String(input.type || 'generic'),
    data: input.data !== undefined ? input.data : null,
    priority,
    createdAt: now,
    delay: Math.max(0, Number(input.delay) || 0),
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.slice() : [],
    maxRetries: clampInt(input.maxRetries, 0, 100, 3),
    timeout: clampInt(input.timeout, 0, 600_000, 30_000),
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Determine whether a task is eligible for dequeue right now.
 * A task is ready when:
 *   - It has no unmet dependencies (all dependency ids are in the completed set).
 *   - Its delay has elapsed (createdAt + delay <= now).
 *
 * @param {object} task
 * @param {number} now       - Current timestamp (ms)
 * @param {Set<string>} [completed] - Set of completed task ids
 * @returns {boolean}
 */
function isTaskReady(task, now, completed) {
  if (completed && task.dependencies.length > 0) {
    for (const depId of task.dependencies) {
      if (!completed.has(depId)) return false;
    }
  }
  return task.createdAt + task.delay <= (now || Date.now());
}

// ---------------------------------------------------------------------------
// TaskQueue
// ---------------------------------------------------------------------------

class TaskQueue {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize] - Maximum queue capacity (0 = unlimited)
   */
  constructor(options = {}) {
    this._heap = new PriorityQueue();
    this._taskMap = new Map(); // id -> task for fast lookup
    this._completed = new Set(); // ids of tasks that have finished successfully
    this._maxSize = clampInt(options.maxSize, 0, 1_000_000, 0);

    /** @type {Map<string, Array<{ resolve: Function, reject: Function }>>} */
    this._waiters = new Map(); // dependencyId -> pending resolvers
  }

  /**
   * Add a task to the queue.
   *
   * @param {object} task     - Raw task input (see normalizeTask).
   * @param {object} [options]
   * @param {boolean} [options.defer] - If true, skip validation checks; caller will enqueue later.
   * @returns {object} The normalized task object.
   * @throws {Error} If the queue is at capacity or the task id is a duplicate.
   */
  enqueue(task, options = {}) {
    if (this._maxSize > 0 && this._heap.size >= this._maxSize) {
      throw new Error('Queue at capacity');
    }

    const normalized = normalizeTask(task);

    if (this._taskMap.has(normalized.id)) {
      throw new Error(`Duplicate task id: ${normalized.id}`);
    }

    const ready = isTaskReady(normalized, Date.now(), this._completed);

    this._taskMap.set(normalized.id, normalized);
    this._heap.push({
      priority: normalized.priority,
      createdAt: normalized.createdAt,
      task: normalized,
      ready,
    });

    debug('scheduler:queue', `enqueued ${normalized.id} (${normalized.name || normalized.type}), priority=${normalized.priority}`);

    return normalized;
  }

  /**
   * Dequeue the highest-priority task that is ready to run.
   * Tasks whose delay hasn't elapsed or whose dependencies aren't satisfied
   * are skipped.  The task remains in the queue in that case so that a
   * subsequent call can pick it up later.
   *
   * @param {number} [now] - Current timestamp (defaults to Date.now()).
   * @returns {object|null} The dequeued task, or null if nothing is ready.
   */
  dequeue(now) {
    const ts = now || Date.now();
    const deferred = [];

    let result = null;

    // We must drain the heap until we find a ready task, re-inserting
    // unready tasks so they stay in priority order.
    while (this._heap.size > 0) {
      const entry = this._heap.pop();
      if (!entry) break;

      const task = entry.task;
      if (isTaskReady(task, ts, this._completed)) {
        result = task;
        break;
      }

      deferred.push(entry);
    }

    // Re-insert skipped entries.
    for (const entry of deferred) {
      this._heap.push(entry);
    }

    if (result) {
      this._taskMap.delete(result.id);
      debug('scheduler:queue', `dequeued ${result.id}`);
    }

    return result || null;
  }

  /**
   * Return the next ready task without removing it from the queue.
   * @returns {object|null}
   */
  peek() {
    const ts = Date.now();
    // Walk heap entries in priority order (we can't mutate the heap for peek).
    const sorted = [...this._heap._heap].sort(
      (a, b) => a.priority - b.priority || a.createdAt - b.createdAt
    );
    for (const entry of sorted) {
      if (isTaskReady(entry.task, ts, this._completed)) {
        return entry.task;
      }
    }
    return null;
  }

  /**
   * Number of tasks currently in the queue.
   * @returns {number}
   */
  size() {
    return this._heap.size;
  }

  /**
   * Whether the queue has zero tasks.
   * @returns {boolean}
   */
  isEmpty() {
    return this._heap.size === 0;
  }

  /**
   * Remove a specific task by id.
   * @param {string} taskId
   * @returns {boolean} true if the task was found and removed.
   */
  remove(taskId) {
    const existed = this._taskMap.has(taskId);
    this._heap.remove(taskId);
    this._taskMap.delete(taskId);
    if (existed) {
      debug('scheduler:queue', `removed ${taskId}`);
    }
    return existed;
  }

  /**
   * Remove all tasks from the queue.
   */
  clear() {
    this._heap.clear();
    this._taskMap.clear();
    this._completed.clear();
    debug('scheduler:queue', 'queue cleared');
  }

  /**
   * Mark a task as completed so that tasks depending on it become eligible.
   * @param {string} taskId
   */
  markCompleted(taskId) {
    this._completed.add(taskId);

    // Notify any waiters registered for this dependency.
    const waiters = this._waiters.get(taskId);
    if (waiters) {
      for (const w of waiters) w.resolve();
      this._waiters.delete(taskId);
    }
  }

  /**
   * Mark a task as failed — does NOT unblock dependents.
   * @param {string} taskId
   */
  markFailed(taskId) {
    // Failed tasks do not satisfy dependencies.
    // The task is already removed from the active set, so no further action needed.
  }

  /**
   * Wait for a dependency task to complete.
   * Returns a promise that resolves when the dependency is marked completed.
   *
   * @param {string} dependencyId
   * @returns {Promise<void>}
   */
  waitForDependency(dependencyId) {
    if (this._completed.has(dependencyId)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let list = this._waiters.get(dependencyId);
      if (!list) {
        list = [];
        this._waiters.set(dependencyId, list);
      }
      list.push({ resolve, reject });
    });
  }

  /**
   * Return a snapshot of all tasks currently in the queue.
   * @returns {object[]}
   */
  toArray() {
    const now = Date.now();
    return [...this._heap._heap].map((entry) => ({
      ...entry.task,
      ready: isTaskReady(entry.task, now, this._completed),
    }));
  }

  /**
   * Get a task by id (includes both queued and completed tasks).
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this._taskMap.get(id) || null;
  }

  /**
   * Count of tasks that are currently eligible to run.
   * @returns {number}
   */
  readyCount() {
    const now = Date.now();
    let count = 0;
    for (const entry of this._heap._heap) {
      if (isTaskReady(entry.task, now, this._completed)) count++;
    }
    return count;
  }
}

module.exports = { TaskQueue, PriorityQueue, normalizeTask, isTaskReady, DEFAULT_PRIORITY };
