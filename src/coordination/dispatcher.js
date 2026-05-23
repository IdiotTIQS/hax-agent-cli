"use strict";

const STRATEGY = Object.freeze({
  LEAST_LOADED: 'least-loaded',
  ROUND_ROBIN: 'round-robin',
  CAPABILITY_MATCH: 'capability-match',
});

const TASK_STATUS = Object.freeze({
  pending: 'pending',
  assigned: 'assigned',
  in_progress: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
});

/**
 * Distributed task dispatcher with pluggable load-balancing strategies.
 *
 * Workers register with a set of capabilities.  Tasks carry a `type`,
 * `requirements`, `priority`, and optional `deadline`.  The dispatcher
 * selects the best worker according to the active strategy and tracks
 * per-worker load.
 */
class TaskDispatcher {
  /**
   * @param {object} [options]
   * @param {string} [options.strategy='least-loaded']  Active balancing strategy
   * @param {number} [options.maxRetries=3]              Max reassignment attempts for a task
   */
  constructor(options = {}) {
    this._workers = new Map();
    this._tasks = new Map();
    this._queue = [];
    this._taskSequence = 0;
    this._roundRobinIndex = 0;
    this._maxRetries = validatePositiveInt(options.maxRetries, 'maxRetries', 3);

    this._strategy = Object.values(STRATEGY).includes(options.strategy)
      ? options.strategy
      : STRATEGY.LEAST_LOADED;
  }

  /**
   * Register a worker node with its capabilities.
   * @param {string} nodeId
   * @param {string[]} capabilities  List of supported task types / skills
   * @param {object} [metadata]      Optional worker metadata
   * @returns {object} The registered worker record
   */
  registerWorker(nodeId, capabilities = [], metadata = {}) {
    requireString(nodeId, 'nodeId');

    if (!Array.isArray(capabilities)) {
      throw new Error('capabilities must be an array');
    }

    if (this._workers.has(nodeId)) {
      throw new Error(`Worker '${nodeId}' is already registered`);
    }

    const capSet = new Set(capabilities.map((item) => String(item).trim()).filter(Boolean));

    const worker = {
      id: nodeId,
      capabilities: Array.from(capSet),
      load: 0,
      taskIds: [],
      registeredAt: new Date().toISOString(),
      metadata: metadata && typeof metadata === 'object' ? deepClone(metadata) : {},
    };

    this._workers.set(nodeId, worker);
    return deepClone(worker);
  }

  /**
   * Unregister a worker.  Its pending/assigned tasks are returned to the
   * queue for redistribution.
   * @param {string} nodeId
   * @returns {object[]} Tasks that were reassigned
   */
  unregisterWorker(nodeId) {
    requireString(nodeId, 'nodeId');
    this._requireWorker(nodeId);

    const worker = this._workers.get(nodeId);
    const reassigned = [];

    for (const taskId of [...worker.taskIds]) {
      const task = this._tasks.get(taskId);
      if (task) {
        task.status = TASK_STATUS.pending;
        task.assignedTo = null;
        this._queue.push(task);
        reassigned.push(deepClone(task));
      }
    }

    this._workers.delete(nodeId);
    return reassigned;
  }

  /**
   * Dispatch a task to the best available worker.
   * @param {object} task
   * @param {string} task.id       Optional — auto-generated if omitted
   * @param {string} task.type     Task type for capability matching
   * @param {*}      task.data     Task payload
   * @param {number} [task.priority=0]  Higher priority tasks are assigned first
   * @param {string[]} [task.requirements]  Required capabilities
   * @param {number} [task.deadline]  Unix-ms deadline (informational)
   * @returns {object} Dispatch result { task, worker, status }
   */
  dispatch(task) {
    if (!task || typeof task !== 'object') {
      throw new Error('task must be an object');
    }

    const id = task.id || `task-${++this._taskSequence}`;
    const type = String(task.type || '').trim() || 'default';
    const priority = Number.isSafeInteger(task.priority) ? task.priority : 0;
    const requirements = Array.isArray(task.requirements)
      ? task.requirements.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const record = {
      id,
      type,
      data: deepClone(task.data),
      priority,
      requirements,
      deadline: Number.isSafeInteger(task.deadline) ? task.deadline : null,
      status: TASK_STATUS.pending,
      assignedTo: null,
      retries: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this._tasks.set(id, record);

    // Select best worker
    const workerId = this._selectWorker(record);

    if (workerId) {
      record.status = TASK_STATUS.assigned;
      record.assignedTo = workerId;

      const worker = this._workers.get(workerId);
      worker.load++;
      worker.taskIds.push(id);
    } else {
      // No suitable worker — enqueue
      this._queue.push(record);
    }

    return {
      task: deepClone(record),
      worker: workerId ? deepClone(this._workers.get(workerId)) : null,
      status: workerId ? 'assigned' : 'queued',
    };
  }

  /**
   * Mark a task as completed.
   * @param {string} taskId
   * @param {*} [result]  Task result data
   * @returns {object} The updated task
   */
  completeTask(taskId, result = null) {
    requireString(taskId, 'taskId');
    const task = this._requireTask(taskId);

    if (task.status === TASK_STATUS.completed) {
      throw new Error(`Task '${taskId}' is already completed`);
    }

    task.status = TASK_STATUS.completed;
    task.completedAt = new Date().toISOString();

    if (task.assignedTo && this._workers.has(task.assignedTo)) {
      const worker = this._workers.get(task.assignedTo);
      worker.load = Math.max(0, worker.load - 1);
    }

    this._removeFromQueue(taskId);

    return deepClone(task);
  }

  /**
   * Mark a task as failed.
   * @param {string} taskId
   * @param {string} [error]  Error description
   * @returns {object} The updated task
   */
  failTask(taskId, error = null) {
    requireString(taskId, 'taskId');
    const task = this._requireTask(taskId);

    task.status = TASK_STATUS.failed;
    task.completedAt = new Date().toISOString();

    if (task.assignedTo && this._workers.has(task.assignedTo)) {
      const worker = this._workers.get(task.assignedTo);
      worker.load = Math.max(0, worker.load - 1);
    }

    this._removeFromQueue(taskId);

    return deepClone(task);
  }

  /**
   * Redistribute all tasks from a failed node back into the dispatch
   * queue.  Those tasks will be picked up on the next `dispatch` or
   * `drainQueue` call.
   * @param {string} failedNodeId
   * @returns {object[]} Redistributed tasks
   */
  redistribute(failedNodeId) {
    requireString(failedNodeId, 'failedNodeId');

    if (!this._workers.has(failedNodeId)) {
      return [];
    }

    const worker = this._workers.get(failedNodeId);
    const redistributed = [];

    for (const taskId of [...worker.taskIds]) {
      const task = this._tasks.get(taskId);
      if (!task) {
        continue;
      }

      if (task.retries >= this._maxRetries) {
        task.status = TASK_STATUS.failed;
        task.completedAt = new Date().toISOString();
        continue;
      }

      task.status = TASK_STATUS.pending;
      task.assignedTo = null;
      task.retries++;
      this._queue.push(task);
      redistributed.push(deepClone(task));
    }

    worker.taskIds = [];
    worker.load = 0;

    return redistributed;
  }

  /**
   * Attempt to assign all queued tasks to available workers.
   * @returns {object[]} Results of each assignment attempt
   */
  drainQueue() {
    const results = [];

    // Sort queue by priority descending, then by creation time
    this._queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });

    const remaining = [];

    for (const task of this._queue) {
      const workerId = this._selectWorker(task);

      if (workerId) {
        task.status = TASK_STATUS.assigned;
        task.assignedTo = workerId;

        const worker = this._workers.get(workerId);
        worker.load++;
        worker.taskIds.push(task.id);

        results.push({
          task: deepClone(task),
          worker: deepClone(this._workers.get(workerId)),
          status: 'assigned',
        });
      } else {
        remaining.push(task);
      }
    }

    this._queue = remaining;
    return results;
  }

  /**
   * Get per-worker load information.
   * @returns {object[]}
   */
  getLoad() {
    return Array.from(this._workers.values())
      .map((worker) => ({
        id: worker.id,
        load: worker.load,
        capabilities: [...worker.capabilities],
        taskIds: [...worker.taskIds],
      }))
      .sort((a, b) => b.load - a.load);
  }

  /**
   * Get the current queue of pending tasks.
   * @returns {object[]}
   */
  getQueue() {
    return this._queue.map(deepClone);
  }

  /**
   * Get the queue length.
   * @returns {number}
   */
  getQueueLength() {
    return this._queue.length;
  }

  /**
   * Get all tasks tracked by the dispatcher.
   * @returns {object[]}
   */
  getAllTasks() {
    return Array.from(this._tasks.values()).map(deepClone);
  }

  /**
   * Get a specific task by ID.
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    requireString(taskId, 'taskId');
    const task = this._tasks.get(taskId);
    return task ? deepClone(task) : null;
  }

  /**
   * Get all registered workers.
   * @returns {object[]}
   */
  getWorkers() {
    return Array.from(this._workers.values()).map(deepClone);
  }

  /**
   * Get a specific worker.
   * @param {string} nodeId
   * @returns {object|null}
   */
  getWorker(nodeId) {
    requireString(nodeId, 'nodeId');
    const worker = this._workers.get(nodeId);
    return worker ? deepClone(worker) : null;
  }

  /**
   * Change the load-balancing strategy at runtime.
   * @param {string} strategy  One of STRATEGY values
   */
  setStrategy(strategy) {
    if (!Object.values(STRATEGY).includes(strategy)) {
      throw new Error(`Unknown strategy '${strategy}'. Valid: ${Object.values(STRATEGY).join(', ')}`);
    }
    this._strategy = strategy;
    this._roundRobinIndex = 0;
  }

  /**
   * Get the current strategy.
   * @returns {string}
   */
  getStrategy() {
    return this._strategy;
  }

  /**
   * Cancel a pending or queued task.
   * @param {string} taskId
   * @returns {object}
   */
  cancelTask(taskId) {
    requireString(taskId, 'taskId');
    const task = this._requireTask(taskId);

    if (![TASK_STATUS.pending, TASK_STATUS.assigned].includes(task.status)) {
      throw new Error(`Cannot cancel task '${taskId}' with status '${task.status}'`);
    }

    task.status = TASK_STATUS.cancelled;
    task.completedAt = new Date().toISOString();

    if (task.assignedTo && this._workers.has(task.assignedTo)) {
      const worker = this._workers.get(task.assignedTo);
      worker.load = Math.max(0, worker.load - 1);
      const idx = worker.taskIds.indexOf(taskId);
      if (idx !== -1) {
        worker.taskIds.splice(idx, 1);
      }
    }

    this._removeFromQueue(taskId);

    return deepClone(task);
  }

  // ---- Private ----

  _selectWorker(task) {
    const workers = Array.from(this._workers.values());
    if (workers.length === 0) {
      return null;
    }

    // Filter workers that match capability requirements
    const matched = workers.filter((worker) => {
      if (task.requirements.length === 0) {
        return true;
      }
      return task.requirements.every((req) => worker.capabilities.includes(req));
    });

    if (matched.length === 0) {
      return null;
    }

    switch (this._strategy) {
      case STRATEGY.ROUND_ROBIN:
        return this._selectRoundRobin(matched);
      case STRATEGY.CAPABILITY_MATCH:
        return this._selectCapabilityMatch(task, matched);
      case STRATEGY.LEAST_LOADED:
      default:
        return this._selectLeastLoaded(matched);
    }
  }

  _selectLeastLoaded(workers) {
    workers.sort((a, b) => a.load - b.load);
    return workers[0].id;
  }

  _selectRoundRobin(workers) {
    const index = this._roundRobinIndex % workers.length;
    this._roundRobinIndex++;
    return workers[index].id;
  }

  _selectCapabilityMatch(task, workers) {
    // Score workers by how many of the task's requirements they support,
    // tie-break on least-loaded first
    const scored = workers.map((worker) => {
      const matchCount = task.requirements.filter((req) => worker.capabilities.includes(req)).length;
      return { id: worker.id, score: matchCount, load: worker.load };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score; // higher score first
      }
      return a.load - b.load; // lower load first
    });

    return scored[0].id;
  }

  _removeFromQueue(taskId) {
    this._queue = this._queue.filter((task) => task.id !== taskId);
  }

  _requireWorker(nodeId) {
    if (!this._workers.has(nodeId)) {
      throw new Error(`Unknown worker: ${nodeId}`);
    }
  }

  _requireTask(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }
}

// ---- Helpers ----

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function validatePositiveInt(value, name, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = { STRATEGY, TASK_STATUS, TaskDispatcher };
