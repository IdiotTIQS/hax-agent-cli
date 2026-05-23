"use strict";

const ELECTION_STATE = Object.freeze({
  idle: 'idle',
  electing: 'electing',
  stable: 'stable',
});

/**
 * Bully algorithm leader election with priority-based election.
 *
 * Each registered node has a numeric priority (higher wins).
 * When `elect()` is called, the node with the highest priority among all
 * active candidates becomes the leader.  If the leader resigns or is
 * removed, a new election can be triggered.
 */
class LeaderElection {
  constructor() {
    this._nodes = new Map();
    this._leaderId = null;
    this._state = ELECTION_STATE.idle;
    this._electionTerm = 0;
    this._handlers = [];
  }

  /**
   * Register a node as a candidate for leadership.
   * @param {string} nodeId   Unique node identifier
   * @param {number} [priority=0]  Higher priority nodes win elections
   * @returns {object} The registered node record
   */
  register(nodeId, priority = 0) {
    requireString(nodeId, 'nodeId');

    if (!Number.isSafeInteger(priority)) {
      throw new Error('priority must be a safe integer');
    }

    if (this._nodes.has(nodeId)) {
      throw new Error(`Node '${nodeId}' is already registered`);
    }

    const node = {
      id: nodeId,
      priority,
      registeredAt: new Date().toISOString(),
    };

    this._nodes.set(nodeId, node);
    return deepClone(node);
  }

  /**
   * Unregister a node.  If it was the leader, leadership is vacated.
   * @param {string} nodeId
   */
  unregister(nodeId) {
    requireString(nodeId, 'nodeId');
    this._requireNode(nodeId);

    const wasLeader = this._leaderId === nodeId;
    this._nodes.delete(nodeId);

    if (wasLeader) {
      const previousLeader = this._leaderId;
      this._leaderId = null;
      this._state = ELECTION_STATE.idle;
      this._emit({ previousLeader, newLeader: null, term: this._electionTerm, reason: 'unregistered' });
    }
  }

  /**
   * Run the leader election algorithm.
   * The candidate with the highest priority wins.  Ties are broken by
   * lexicographic ordering of nodeId (deterministic).
   * @returns {object} Election result
   */
  elect() {
    if (this._nodes.size === 0) {
      throw new Error('No registered nodes — cannot elect a leader');
    }

    this._state = ELECTION_STATE.electing;
    this._electionTerm++;

    const candidates = Array.from(this._nodes.values());
    const previousLeader = this._leaderId;

    // Bully: highest priority wins; tie-break on id
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return String(a.id).localeCompare(String(b.id));
    });

    const leader = candidates[0];
    this._leaderId = leader.id;
    this._state = ELECTION_STATE.stable;

    const result = {
      term: this._electionTerm,
      leader: leader.id,
      priority: leader.priority,
      previousLeader,
      candidateCount: candidates.length,
      electedAt: new Date().toISOString(),
    };

    if (previousLeader !== leader.id) {
      this._emit({ previousLeader, newLeader: leader.id, term: this._electionTerm, reason: 'elected' });
    }

    return result;
  }

  /**
   * Get the current leader ID, or null if no leader has been elected.
   * @returns {string|null}
   */
  getLeader() {
    return this._leaderId;
  }

  /**
   * Check whether the given node is the current leader.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isLeader(nodeId) {
    requireString(nodeId, 'nodeId');
    return this._leaderId === nodeId;
  }

  /**
   * The current leader steps down voluntarily.
   * @param {string} nodeId  Must match the current leader
   * @returns {object} Resignation record
   */
  resign(nodeId) {
    requireString(nodeId, 'nodeId');

    if (this._leaderId !== nodeId) {
      throw new Error(`Node '${nodeId}' is not the leader (current leader: ${this._leaderId || 'none'})`);
    }

    const previousLeader = this._leaderId;
    this._leaderId = null;
    this._state = ELECTION_STATE.idle;

    const record = {
      previousLeader,
      resignedAt: new Date().toISOString(),
      term: this._electionTerm,
    };

    this._emit({ previousLeader, newLeader: null, term: this._electionTerm, reason: 'resigned' });

    return record;
  }

  /**
   * Subscribe to leader-change events.
   * @param {function} handler  Called with { previousLeader, newLeader, term, reason }
   */
  onLeaderChange(handler) {
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function');
    }
    this._handlers.push(handler);
  }

  /**
   * Remove a previously registered handler.
   * @param {function} handler
   */
  offLeaderChange(handler) {
    const index = this._handlers.indexOf(handler);
    if (index !== -1) {
      this._handlers.splice(index, 1);
    }
  }

  /**
   * Get all registered nodes.
   * @returns {object[]}
   */
  getNodes() {
    return Array.from(this._nodes.values()).map(deepClone);
  }

  /**
   * Get the current election state.
   * @returns {string}
   */
  getState() {
    return this._state;
  }

  /**
   * Get the current election term number.
   * @returns {number}
   */
  getTerm() {
    return this._electionTerm;
  }

  /**
   * Get a specific node's record.
   * @param {string} nodeId
   * @returns {object|null}
   */
  getNode(nodeId) {
    requireString(nodeId, 'nodeId');
    const node = this._nodes.get(nodeId);
    return node ? deepClone(node) : null;
  }

  // ---- Private ----

  _requireNode(nodeId) {
    if (!this._nodes.has(nodeId)) {
      throw new Error(`Unknown node: ${nodeId}`);
    }
  }

  _emit(event) {
    for (const handler of this._handlers) {
      try {
        handler(deepClone(event));
      } catch (_) {
        // Swallow handler errors so one broken subscriber does not
        // prevent others from receiving notifications.
      }
    }
  }
}

// ---- Helpers ----

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = { ELECTION_STATE, LeaderElection };
