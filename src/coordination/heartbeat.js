"use strict";

/**
 * Tracks liveness of distributed nodes via heartbeat signalling.
 *
 * Each node periodically calls `receiveHeartbeat()`.  If a node does not
 * heartbeat within the configured timeout window it is marked dead.
 * Dead nodes are kept for a cleanup threshold before being purged.
 */
class HeartbeatManager {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs=10000]      Milliseconds before a node is considered dead
   * @param {number} [options.cleanupThresholdMs=60000]  Milliseconds before dead nodes are purged
   * @param {number} [options.historySize=20]        Max number of heartbeat timestamps to keep per node
   */
  constructor(options = {}) {
    this._timeoutMs = validatePositiveInt(options.timeoutMs, 'timeoutMs', 10000);
    this._cleanupThresholdMs = validatePositiveInt(options.cleanupThresholdMs, 'cleanupThresholdMs', 60000);
    this._historySize = validatePositiveInt(options.historySize, 'historySize', 20);

    this._nodes = new Map();
    this._downHandlers = [];
    this._active = false;
    this._intervalId = null;
    this._nowFn = null; // injectable clock for tests
  }

  /**
   * Start the heartbeat monitor loop.  The loop ticks on the given interval
   * and evaluates timeouts.
   * @param {string} nodeId    The local node (for self-reporting)
   * @param {number} [intervalMs=2000]  Evaluation interval in milliseconds
   */
  start(nodeId, intervalMs = 2000) {
    requireString(nodeId, 'nodeId');

    if (this._active) {
      throw new Error('HeartbeatManager is already running');
    }

    this._active = true;
    this._selfId = nodeId;

    // Ensure the local node exists
    if (!this._nodes.has(nodeId)) {
      this._nodes.set(nodeId, createNodeRecord(nodeId));
    }

    this._evaluate();

    this._intervalId = setInterval(() => {
      this._evaluate();
    }, Math.max(100, validatePositiveInt(intervalMs, 'intervalMs', 2000)));
  }

  /**
   * Stop the heartbeat monitor loop.
   */
  stop() {
    if (!this._active) {
      return;
    }

    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    this._active = false;
  }

  /**
   * Receive a heartbeat from a node, marking it alive.
   * @param {string} nodeId
   * @param {object} [metadata]  Optional metadata attached to the heartbeat
   * @returns {object} The node record
   */
  receiveHeartbeat(nodeId, metadata = null) {
    requireString(nodeId, 'nodeId');

    const now = this._now();
    let record = this._nodes.get(nodeId);

    if (!record) {
      record = createNodeRecord(nodeId);
      this._nodes.set(nodeId, record);
    }

    record.lastHeartbeat = now;
    record.status = 'alive';
    record.metadata = metadata && typeof metadata === 'object' ? deepClone(metadata) : null;

    // Keep a rolling history
    record.history.push(now);
    if (record.history.length > this._historySize) {
      record.history = record.history.slice(-this._historySize);
    }

    return deepClone(record);
  }

  /**
   * Get all currently alive nodes.
   * @returns {object[]}
   */
  getAliveNodes() {
    this._evaluate();
    return Array.from(this._nodes.values())
      .filter((record) => record.status === 'alive')
      .map(deepClone);
  }

  /**
   * Get all nodes that have timed out (dead).
   * @returns {object[]}
   */
  getDeadNodes() {
    this._evaluate();
    return Array.from(this._nodes.values())
      .filter((record) => record.status === 'dead')
      .map(deepClone);
  }

  /**
   * Get all tracked nodes regardless of status.
   * @returns {object[]}
   */
  getAllNodes() {
    return Array.from(this._nodes.values()).map(deepClone);
  }

  /**
   * Get a single node's record.
   * @param {string} nodeId
   * @returns {object|null}
   */
  getNode(nodeId) {
    requireString(nodeId, 'nodeId');
    const record = this._nodes.get(nodeId);
    return record ? deepClone(record) : null;
  }

  /**
   * Get the count of alive nodes.
   * @returns {number}
   */
  getAliveCount() {
    this._evaluate();
    return Array.from(this._nodes.values()).filter((record) => record.status === 'alive').length;
  }

  /**
   * Check if a specific node is alive.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isAlive(nodeId) {
    requireString(nodeId, 'nodeId');
    this._evaluate();
    const record = this._nodes.get(nodeId);
    return record ? record.status === 'alive' : false;
  }

  /**
   * Subscribe to node-down events.
   * Handler receives { nodeId, lastHeartbeat, downAt }.
   * @param {function} handler
   */
  onNodeDown(handler) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function');
    }
    this._downHandlers.push(handler);
  }

  /**
   * Remove a previously registered node-down handler.
   * @param {function} handler
   */
  offNodeDown(handler) {
    const index = this._downHandlers.indexOf(handler);
    if (index !== -1) {
      this._downHandlers.splice(index, 1);
    }
  }

  /**
   * Manually remove a node from tracking.
   * @param {string} nodeId
   */
  removeNode(nodeId) {
    requireString(nodeId, 'nodeId');
    this._nodes.delete(nodeId);
  }

  /**
   * Inject a custom clock function (for testing).
   * Pass null to reset to system clock.
   * @param {function|null} fn
   */
  setClock(fn) {
    if (fn !== null && typeof fn !== 'function') {
      throw new Error('setClock expects a function or null');
    }
    this._nowFn = fn;
  }

  /**
   * Get the configured timeout value in milliseconds.
   * @returns {number}
   */
  getTimeout() {
    return this._timeoutMs;
  }

  /**
   * Check whether the monitor loop is running.
   * @returns {boolean}
   */
  isRunning() {
    return this._active;
  }

  // ---- Private ----

  _now() {
    return this._nowFn ? this._nowFn() : Date.now();
  }

  _evaluate() {
    const now = this._now();
    const newlyDead = [];

    for (const [id, record] of this._nodes) {
      if (record.status === 'dead') {
        // Purge nodes that have been dead beyond the cleanup threshold
        if (record.downAt !== null && now - record.downAt > this._cleanupThresholdMs) {
          this._nodes.delete(id);
        }
        continue;
      }

      if (record.lastHeartbeat === null) {
        continue;
      }

      if (now - record.lastHeartbeat > this._timeoutMs) {
        record.status = 'dead';
        record.downAt = now;
        newlyDead.push(deepClone(record));
      }
    }

    for (const record of newlyDead) {
      this._emitDown({
        nodeId: record.id,
        lastHeartbeat: record.lastHeartbeat,
        downAt: record.downAt,
      });
    }
  }

  _emitDown(event) {
    for (const handler of this._downHandlers) {
      try {
        handler(deepClone(event));
      } catch (_) {
        // Swallow handler errors.
      }
    }
  }
}

// ---- Helpers ----

function createNodeRecord(nodeId) {
  return {
    id: nodeId,
    status: 'alive',
    lastHeartbeat: null,
    firstSeen: new Date().toISOString(),
    downAt: null,
    metadata: null,
    history: [],
  };
}

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

module.exports = { HeartbeatManager };
