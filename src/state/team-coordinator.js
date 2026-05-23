"use strict";

const { StateMachine } = require("./fsm");

/**
 * Canonical team-level states.
 */
const TeamStates = Object.freeze({
  ASSEMBLING: "assembling",
  PLANNING:   "planning",
  EXECUTING:  "executing",
  REVIEWING:  "reviewing",
  MERGING:    "merging",
  COMPLETED:  "completed",
  FAILED:     "failed",
});

/**
 * Active states for progress classification.
 * @private
 */
const ACTIVE_STATES = new Set([
  "receiving",
  "thinking",
  "tool_call",
  "responding",
]);

/**
 * Manages the lifecycle of an entire agent team.
 *
 * Tracks the team-level state machine and aggregates per-member
 * AgentLifecycle instances to surface bottlenecks, progress, and
 * coordination suggestions.
 */
class TeamCoordinator {
  constructor(options = {}) {
    this.teamId = options.teamId || `team-${Date.now().toString(36)}`;

    /** @type {Map<string, { lifecycle: import('./agent-lifecycle').AgentLifecycle, name: string }>} */
    this._members = new Map();

    // ---- Build the team-level state machine -------------------------
    this.fsm = new StateMachine({ initial: TeamStates.ASSEMBLING });

    const graph = {
      [TeamStates.ASSEMBLING]: [TeamStates.PLANNING, TeamStates.FAILED],
      [TeamStates.PLANNING]:   [TeamStates.EXECUTING, TeamStates.FAILED],
      [TeamStates.EXECUTING]:  [TeamStates.REVIEWING, TeamStates.FAILED],
      [TeamStates.REVIEWING]:  [TeamStates.MERGING, TeamStates.EXECUTING, TeamStates.FAILED],
      [TeamStates.MERGING]:    [TeamStates.COMPLETED, TeamStates.FAILED],
      [TeamStates.COMPLETED]:  [TeamStates.ASSEMBLING],
      [TeamStates.FAILED]:     [TeamStates.ASSEMBLING],
    };

    for (const [name, transitions] of Object.entries(graph)) {
      this.fsm.addState(name, { transitions });
    }

    // Guard: PLANNING → EXECUTING requires at least one member
    this.fsm.addTransition(
      TeamStates.PLANNING,
      TeamStates.EXECUTING,
      () => this._members.size > 0,
    );

    // Guard: MERGING → COMPLETED requires no blocked members
    this.fsm.addTransition(
      TeamStates.MERGING,
      TeamStates.COMPLETED,
      () => !this.isBlocked(),
    );
  }

  // ------------------------------------------------------------------
  // Member management
  // ------------------------------------------------------------------

  /**
   * Register an agent lifecycle instance as a team member.
   *
   * @param {string} agentId
   * @param {import('./agent-lifecycle').AgentLifecycle} lifecycle
   * @returns {string} The agentId
   */
  addMember(agentId, lifecycle) {
    if (typeof agentId !== "string" || agentId.trim() === "") {
      throw new TypeError("addMember requires a non-empty agentId string");
    }

    this._members.set(agentId, {
      lifecycle,
      name: agentId,
    });

    return agentId;
  }

  /**
   * Remove a member from tracking.
   *
   * @param {string} agentId
   * @returns {boolean} Whether a member was removed
   */
  removeMember(agentId) {
    return this._members.delete(agentId);
  }

  /**
   * @param {string} agentId
   * @returns {{ lifecycle: object, name: string } | null}
   */
  getMember(agentId) {
    return this._members.get(agentId) || null;
  }

  /**
   * @returns {number}
   */
  get memberCount() {
    return this._members.size;
  }

  // ------------------------------------------------------------------
  // Aggregate state queries
  // ------------------------------------------------------------------

  /**
   * Full team state including every member's current state.
   *
   * @returns {{
   *   teamState: string|null,
   *   members: Record<string, string|null>,
   *   memberCount: number,
   * }}
   */
  getTeamState() {
    const members = {};

    for (const [id, member] of this._members) {
      members[id] = member.lifecycle.currentState();
    }

    return {
      teamState: this.fsm.getCurrentState()?.name || null,
      members,
      memberCount: this._members.size,
    };
  }

  /**
   * Whether any team member is in a blocked state.
   *
   * @returns {boolean}
   */
  isBlocked() {
    for (const [, member] of this._members) {
      const state = member.lifecycle.currentState();
      if (state === "interrupted" || state === "error") {
        return true;
      }
    }
    return false;
  }

  /**
   * Members that are currently blocked and may need attention.
   *
   * @returns {Array<{ agentId: string, state: string, elapsed: number, canAcceptInput: boolean }>}
   */
  getBottlenecks() {
    const bottlenecks = [];

    for (const [id, member] of this._members) {
      const state = member.lifecycle.currentState();
      if (
        state === "interrupted" ||
        state === "error" ||
        state === "waiting_tool"
      ) {
        bottlenecks.push({
          agentId: id,
          state,
          elapsed: member.lifecycle.getElapsedInState(),
          canAcceptInput: member.lifecycle.canAcceptInput(),
        });
      }
    }

    return bottlenecks;
  }

  /**
   * Progress breakdown across all members.
   *
   * @returns {{ total: number, active: number, waiting: number, completed: number, failed: number }}
   */
  getProgress() {
    let total = 0;
    let active = 0;
    let waiting = 0;
    let completed = 0;
    let failed = 0;

    for (const [, member] of this._members) {
      total += 1;
      const state = member.lifecycle.currentState();

      if (state === "completed") {
        completed += 1;
      } else if (state === "error") {
        failed += 1;
      } else if (state === "waiting_tool" || state === "interrupted") {
        waiting += 1;
      } else if (ACTIVE_STATES.has(state)) {
        active += 1;
      }
      // idle members contribute to total but not to active/waiting/completed/failed
    }

    return { total, active, waiting, completed, failed };
  }

  // ------------------------------------------------------------------
  // Coordination
  // ------------------------------------------------------------------

  /**
   * Analyse current team state and suggest next actions to unblock progress.
   *
   * @returns {{
   *   teamState: string|null,
   *   bottlenecks: Array,
   *   suggestions: Array<{ agentId: string, action: string, reason: string }>,
   *   blocked: boolean,
   * }}
   */
  coordinate() {
    const bottlenecks = this.getBottlenecks();
    const suggestions = [];

    for (const bottleneck of bottlenecks) {
      if (bottleneck.state === "interrupted") {
        suggestions.push({
          agentId: bottleneck.agentId,
          action: "resume",
          reason: `Agent ${bottleneck.agentId} is interrupted. Send new input or reset to continue.`,
        });
      } else if (bottleneck.state === "error") {
        suggestions.push({
          agentId: bottleneck.agentId,
          action: "reset",
          reason: `Agent ${bottleneck.agentId} is in error state. Reset to IDLE before retrying.`,
        });
      } else if (bottleneck.state === "waiting_tool") {
        suggestions.push({
          agentId: bottleneck.agentId,
          action: "check_tool",
          reason: `Agent ${bottleneck.agentId} has been waiting for a tool for ${bottleneck.elapsed}ms. Verify tool availability.`,
        });
      }
    }

    return {
      teamState: this.fsm.getCurrentState()?.name || null,
      bottlenecks,
      suggestions,
      blocked: this.isBlocked(),
    };
  }

  // ------------------------------------------------------------------
  // Team-level state machine delegation
  // ------------------------------------------------------------------

  /**
   * @param {string} to
   * @param {object} [context]
   * @returns {object}
   */
  transition(to, context = {}) {
    return this.fsm.transition(to, context);
  }

  /**
   * @param {string} to
   * @param {object} [context]
   * @returns {boolean}
   */
  canTransition(to, context = {}) {
    return this.fsm.canTransition(to, context);
  }

  /** @returns {object|null} */
  getCurrentState() {
    return this.fsm.getCurrentState();
  }

  /** @returns {string[]} */
  getAvailableTransitions() {
    return this.fsm.getAvailableTransitions();
  }

  /** @returns {Array} */
  getHistory() {
    return this.fsm.getHistory();
  }

  /**
   * Reset the team coordinator: clear all members and return to ASSEMBLING.
   * @param {object} [context]
   * @returns {string|null}
   */
  reset(context = {}) {
    for (const [, member] of this._members) {
      try {
        member.lifecycle.reset();
      } catch (_) {
        // Best-effort
      }
    }
    this._members.clear();
    return this.fsm.reset(context);
  }
}

module.exports = { TeamCoordinator, TeamStates };
