"use strict";

const HANDOFF_REASONS = Object.freeze({
  BLOCKED: "BLOCKED",
  APPROVAL_NEEDED: "APPROVAL_NEEDED",
  UNCERTAIN: "UNCERTAIN",
  LIMIT_REACHED: "LIMIT_REACHED",
  ESCALATION: "ESCALATION",
  CHECKPOINT: "CHECKPOINT",
});

const HANDOFF_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  RESOLVED: "RESOLVED",
  TIMED_OUT: "TIMED_OUT",
  CANCELLED: "CANCELLED",
});

class HandoffProtocol {
  constructor(options = {}) {
    this._handoffs = new Map();
    this._nextId = 1;
    this._agentStates = new Map();
    this._pendingByAgent = new Map();
    this._defaultTimeoutMs = options.defaultTimeoutMs || 300000; // 5 min
    this._maxPendingPerAgent = options.maxPendingPerAgent || 5;
  }

  // ---- Public API ----

  /**
   * Agent requests human help.
   *
   * @param {string} agentId
   * @param {string} reason - One of HANDOFF_REASONS
   * @param {object} context - Arbitrary context data describing the situation
   * @returns {object} The created handoff record
   */
  requestHandoff(agentId, reason, context = {}) {
    requireString(agentId, "agentId");
    requireValidReason(reason);

    if (!this._agentStates.has(agentId)) {
      this._agentStates.set(agentId, { state: "running", escalationLevel: 0 });
    }

    const existingPending = this._pendingByAgent.get(agentId) || [];
    if (existingPending.length >= this._maxPendingPerAgent) {
      throw new Error(
        `Agent ${agentId} has ${existingPending.length} pending handoffs (max ${this._maxPendingPerAgent})`
      );
    }

    const handoff = {
      id: `handoff-${this._nextId++}`,
      agentId,
      reason,
      status: HANDOFF_STATUS.PENDING,
      context: deepClone(context),
      requestedAt: new Date().toISOString(),
      acceptedAt: null,
      rejectedAt: null,
      resolvedAt: null,
      timedOutAt: null,
      cancelledAt: null,
      humanResponse: null,
      responseBy: null,
      metadata: {
        attempt: existingPending.length + 1,
        escalationLevel: this._agentStates.get(agentId).escalationLevel || 0,
      },
    };

    this._handoffs.set(handoff.id, handoff);

    const pending = this._pendingByAgent.get(agentId) || [];
    pending.push(handoff.id);
    this._pendingByAgent.set(agentId, pending);

    return deepClone(handoff);
  }

  /**
   * Packages the current agent state into a handoff-ready snapshot.
   *
   * @param {string} agentId
   * @returns {object} Prepared handoff data
   */
  prepareHandoff(agentId) {
    requireString(agentId, "agentId");

    const state = this._agentStates.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const pendingIds = this._pendingByAgent.get(agentId) || [];
    const activeHandoffId = pendingIds.length > 0 ? pendingIds[pendingIds.length - 1] : null;

    const snapshot = {
      agentId,
      timestamp: new Date().toISOString(),
      currentState: deepClone(state),
      activeHandoffId,
      pendingCount: pendingIds.length,
      handoffHistory: this._getHandoffsForAgent(agentId).map((h) => ({
        id: h.id,
        reason: h.reason,
        status: h.status,
        requestedAt: h.requestedAt,
        resolvedAt: h.resolvedAt,
      })),
    };

    return snapshot;
  }

  /**
   * Transitions control to human by executing the handoff.
   * The agent state moves to "handed_off" and the human is notified.
   *
   * @param {object} handoff - The handoff record
   * @returns {object} The updated handoff record
   */
  executeHandoff(handoff) {
    const id = typeof handoff === "string" ? handoff : handoff.id;
    requireString(id, "handoff.id");

    const record = this._handoffs.get(id);
    if (!record) {
      throw new Error(`Unknown handoff: ${id}`);
    }

    if (record.status !== HANDOFF_STATUS.PENDING) {
      throw new Error(
        `Cannot execute handoff ${id}: current status is ${record.status}`
      );
    }

    record.status = HANDOFF_STATUS.ACCEPTED;
    record.acceptedAt = new Date().toISOString();

    const agentState = this._agentStates.get(record.agentId);
    if (agentState) {
      agentState.state = "handed_off";
      agentState.handoffId = id;
    }

    return deepClone(record);
  }

  /**
   * Agent resumes after the human has responded.
   *
   * @param {object|string} handoff - The handoff record or ID
   * @param {object} humanResponse - The human's response data
   * @returns {object} Resume context for the agent
   */
  resumeFromHandoff(handoff, humanResponse) {
    const id = typeof handoff === "string" ? handoff : handoff.id;
    requireString(id, "handoff.id");

    const record = this._handoffs.get(id);
    if (!record) {
      throw new Error(`Unknown handoff: ${id}`);
    }

    if (record.status !== HANDOFF_STATUS.ACCEPTED) {
      throw new Error(
        `Cannot resume handoff ${id}: current status is ${record.status}. Must be ACCEPTED.`
      );
    }

    record.status = HANDOFF_STATUS.RESOLVED;
    record.resolvedAt = new Date().toISOString();
    record.humanResponse = deepClone(humanResponse);

    // Remove from pending list
    this._removePending(record.agentId, id);

    // Restore agent state
    const agentState = this._agentStates.get(record.agentId);
    if (agentState) {
      agentState.state = "running";
      agentState.handoffId = null;
    }

    // Build resume context
    const resumeContext = {
      handoffId: id,
      agentId: record.agentId,
      reason: record.reason,
      originalContext: record.context,
      humanResponse,
      resumedAt: new Date().toISOString(),
      instructions: humanResponse.instructions || humanResponse.decision || null,
      approved: humanResponse.approved !== false,
    };

    return resumeContext;
  }

  /**
   * Human rejects a handoff request.
   *
   * @param {string} handoffId
   * @param {string} reason - Why the handoff was rejected
   * @returns {object} The updated handoff record
   */
  rejectHandoff(handoffId, reason) {
    requireString(handoffId, "handoffId");
    requireString(reason, "reason");

    const record = this._handoffs.get(handoffId);
    if (!record) {
      throw new Error(`Unknown handoff: ${handoffId}`);
    }

    if (record.status !== HANDOFF_STATUS.PENDING && record.status !== HANDOFF_STATUS.ACCEPTED) {
      throw new Error(
        `Cannot reject handoff ${handoffId}: current status is ${record.status}`
      );
    }

    record.status = HANDOFF_STATUS.REJECTED;
    record.rejectedAt = new Date().toISOString();
    record.humanResponse = { rejected: true, reason };

    // Remove from pending list
    this._removePending(record.agentId, handoffId);

    // Restore agent state if it was handed off
    const agentState = this._agentStates.get(record.agentId);
    if (agentState && agentState.handoffId === handoffId) {
      agentState.state = "running";
      agentState.handoffId = null;
    }

    return deepClone(record);
  }

  /**
   * Cancel a pending handoff before it is accepted or rejected.
   *
   * @param {string} handoffId
   * @returns {object} The updated handoff record
   */
  cancelHandoff(handoffId) {
    requireString(handoffId, "handoffId");

    const record = this._handoffs.get(handoffId);
    if (!record) {
      throw new Error(`Unknown handoff: ${handoffId}`);
    }

    if (record.status !== HANDOFF_STATUS.PENDING) {
      throw new Error(
        `Cannot cancel handoff ${handoffId}: current status is ${record.status}`
      );
    }

    record.status = HANDOFF_STATUS.CANCELLED;
    record.cancelledAt = new Date().toISOString();

    this._removePending(record.agentId, handoffId);

    return deepClone(record);
  }

  /**
   * Get a handoff record by ID.
   *
   * @param {string} handoffId
   * @returns {object|null}
   */
  getHandoff(handoffId) {
    requireString(handoffId, "handoffId");
    const record = this._handoffs.get(handoffId);
    return record ? deepClone(record) : null;
  }

  /**
   * Get all pending handoffs, optionally filtered by agent.
   *
   * @param {string} [agentId]
   * @returns {object[]}
   */
  getPendingHandoffs(agentId) {
    const results = [];
    for (const [id, record] of this._handoffs) {
      if (record.status !== HANDOFF_STATUS.PENDING) continue;
      if (agentId && record.agentId !== agentId) continue;
      results.push(deepClone(record));
    }
    return results.sort(
      (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
    );
  }

  /**
   * Get the number of pending handoffs for an agent.
   *
   * @param {string} agentId
   * @returns {number}
   */
  getPendingCount(agentId) {
    requireString(agentId, "agentId");
    return (this._pendingByAgent.get(agentId) || []).length;
  }

  /**
   * Query handoffs by various filters.
   *
   * @param {object} [filter]
   * @param {string} [filter.agentId]
   * @param {string} [filter.reason]
   * @param {string} [filter.status]
   * @param {string} [filter.since] - ISO date string
   * @returns {object[]}
   */
  query(filter = {}) {
    const results = [];
    for (const record of this._handoffs.values()) {
      if (filter.agentId && record.agentId !== filter.agentId) continue;
      if (filter.reason && record.reason !== filter.reason) continue;
      if (filter.status && record.status !== filter.status) continue;
      if (filter.since && new Date(record.requestedAt) < new Date(filter.since)) continue;
      results.push(deepClone(record));
    }
    return results.sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  /**
   * Check handoffs that have exceeded their timeout and mark them TIMED_OUT.
   *
   * @returns {object[]} Array of handoffs that timed out
   */
  checkTimeouts() {
    const now = new Date();
    const timedOut = [];

    for (const record of this._handoffs.values()) {
      if (record.status !== HANDOFF_STATUS.PENDING && record.status !== HANDOFF_STATUS.ACCEPTED) {
        continue;
      }

      const elapsed = now.getTime() - new Date(record.requestedAt).getTime();
      if (elapsed > this._defaultTimeoutMs) {
        record.status = HANDOFF_STATUS.TIMED_OUT;
        record.timedOutAt = now.toISOString();
        this._removePending(record.agentId, record.id);

        // Restore agent state
        const agentState = this._agentStates.get(record.agentId);
        if (agentState && agentState.handoffId === record.id) {
          agentState.state = "running";
          agentState.handoffId = null;
        }

        timedOut.push(deepClone(record));
      }
    }

    return timedOut;
  }

  /**
   * Update agent state tracking.
   *
   * @param {string} agentId
   * @param {object} stateUpdates
   */
  updateAgentState(agentId, stateUpdates = {}) {
    requireString(agentId, "agentId");

    let state = this._agentStates.get(agentId);
    if (!state) {
      state = { state: "running", escalationLevel: 0 };
      this._agentStates.set(agentId, state);
    }

    Object.assign(state, stateUpdates);
  }

  /**
   * Get the current state for an agent.
   *
   * @param {string} agentId
   * @returns {object|null}
   */
  getAgentState(agentId) {
    requireString(agentId, "agentId");
    const state = this._agentStates.get(agentId);
    return state ? deepClone(state) : null;
  }

  /**
   * Get handoff statistics.
   *
   * @returns {object}
   */
  getStats() {
    const stats = {
      total: this._handoffs.size,
      pending: 0,
      accepted: 0,
      rejected: 0,
      resolved: 0,
      timedOut: 0,
      cancelled: 0,
      byReason: {},
      byAgent: {},
    };

    for (const record of this._handoffs.values()) {
      const statusKey = record.status.toLowerCase();
      if (stats[statusKey] !== undefined) {
        stats[statusKey]++;
      }

      stats.byReason[record.reason] = (stats.byReason[record.reason] || 0) + 1;
      stats.byAgent[record.agentId] = (stats.byAgent[record.agentId] || 0) + 1;
    }

    // Calculate percentages
    stats.resolutionRate = stats.total > 0
      ? ((stats.resolved / (stats.resolved + stats.rejected)) * 100).toFixed(1) + "%"
      : "0.0%";

    return stats;
  }

  /**
   * Clear all handoffs and agent states.
   */
  clear() {
    this._handoffs.clear();
    this._agentStates.clear();
    this._pendingByAgent.clear();
    this._nextId = 1;
  }

  // ---- Internal ----

  _getHandoffsForAgent(agentId) {
    const results = [];
    for (const record of this._handoffs.values()) {
      if (record.agentId === agentId) {
        results.push(record);
      }
    }
    return results;
  }

  _removePending(agentId, handoffId) {
    const pending = this._pendingByAgent.get(agentId);
    if (!pending) return;

    const idx = pending.indexOf(handoffId);
    if (idx !== -1) {
      pending.splice(idx, 1);
    }

    if (pending.length === 0) {
      this._pendingByAgent.delete(agentId);
    } else {
      this._pendingByAgent.set(agentId, pending);
    }
  }
}

// ---- Helpers ----

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireValidReason(reason) {
  if (!Object.values(HANDOFF_REASONS).includes(reason)) {
    throw new Error(
      `Invalid handoff reason "${reason}". Must be one of: ${Object.values(HANDOFF_REASONS).join(", ")}`
    );
  }
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  HandoffProtocol,
  HANDOFF_REASONS,
  HANDOFF_STATUS,
};
