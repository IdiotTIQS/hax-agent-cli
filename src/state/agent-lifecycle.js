"use strict";

const { StateMachine } = require("./fsm");

/**
 * Canonical agent states.
 */
const AgentStates = Object.freeze({
  IDLE: "idle",
  RECEIVING: "receiving",
  THINKING: "thinking",
  TOOL_CALL: "tool_call",
  WAITING_TOOL: "waiting_tool",
  RESPONDING: "responding",
  INTERRUPTED: "interrupted",
  ERROR: "error",
  COMPLETED: "completed",
});

/**
 * Pre-built state machine for a single Hax agent.
 *
 * Tracks the agent through its full lifecycle, accumulates per-state
 * timing, and notifies subscribers on every state change.
 *
 *   IDLE → RECEIVING → THINKING ⇄ TOOL_CALL → WAITING_TOOL
 *                                 ↘ RESPONDING → COMPLETED
 *   Any active state can transition to INTERRUPTED or ERROR.
 */
class AgentLifecycle {
  constructor(options = {}) {
    this.agentId = options.agentId || `agent-${Date.now().toString(36)}`;

    /** @type {Array<Function>} */
    this._listeners = [];

    /** @type {Map<string, number>} state → accumulated ms */
    this._stateTimes = new Map();

    /** @type {number} timestamp of last successful transition (or construction time) */
    this._lastTransitionTime = Date.now();

    // ---- Build the state machine -----------------------------------
    this.fsm = new StateMachine({ initial: AgentStates.IDLE });

    // States and their allowed outgoing transitions (unguarded).
    // Guarded refinements are added via addTransition below.
    const stateGraph = {
      [AgentStates.IDLE]:         [AgentStates.RECEIVING],
      [AgentStates.RECEIVING]:    [AgentStates.THINKING, AgentStates.INTERRUPTED, AgentStates.ERROR],
      [AgentStates.THINKING]:     [AgentStates.TOOL_CALL, AgentStates.RESPONDING, AgentStates.INTERRUPTED, AgentStates.ERROR],
      [AgentStates.TOOL_CALL]:    [AgentStates.WAITING_TOOL, AgentStates.INTERRUPTED, AgentStates.ERROR],
      [AgentStates.WAITING_TOOL]: [AgentStates.THINKING, AgentStates.TOOL_CALL, AgentStates.RESPONDING, AgentStates.INTERRUPTED, AgentStates.ERROR],
      [AgentStates.RESPONDING]:   [AgentStates.COMPLETED, AgentStates.INTERRUPTED, AgentStates.ERROR],
      [AgentStates.INTERRUPTED]:  [AgentStates.RECEIVING, AgentStates.IDLE, AgentStates.ERROR],
      [AgentStates.ERROR]:        [AgentStates.IDLE],
      [AgentStates.COMPLETED]:    [AgentStates.IDLE],
    };

    for (const [name, transitions] of Object.entries(stateGraph)) {
      this.fsm.addState(name, { transitions });
    }

    // ---- Guarded transitions ---------------------------------------
    // THINKING → TOOL_CALL: only when the agent actually has tools
    this.fsm.addTransition(
      AgentStates.THINKING,
      AgentStates.TOOL_CALL,
      (ctx) => ctx?.hasTools !== false,
    );

    // RESPONDING → COMPLETED: only when the response is truly finished
    this.fsm.addTransition(
      AgentStates.RESPONDING,
      AgentStates.COMPLETED,
      (ctx) => ctx?.responseComplete !== false,
    );

    // RECEIVING → THINKING: only if the input is non-empty
    this.fsm.addTransition(
      AgentStates.RECEIVING,
      AgentStates.THINKING,
      (ctx) => (ctx?.inputLength ?? 1) > 0,
    );
  }

  // ------------------------------------------------------------------
  // State mutation
  // ------------------------------------------------------------------

  /**
   * Transition to a new state.
   *
   * Accumulates elapsed time in the previous state, records the
   * transition time, and fires all onStateChange listeners.
   *
   * @param {string} to       Target state (one of AgentStates)
   * @param {object} [context]  Arbitrary payload (passed to guards)
   * @returns {{ from: string, to: string, timestamp: number, meta: object }}
   * @throws {Error} if the transition is not allowed
   */
  transition(to, context = {}) {
    const from = this.currentState();
    const result = this.fsm.transition(to, context);

    // Accumulate time in the state we just left
    if (from) {
      const elapsed = Date.now() - this._lastTransitionTime;
      const prev = this._stateTimes.get(from) || 0;
      this._stateTimes.set(from, prev + elapsed);
    }

    this._lastTransitionTime = Date.now();

    // Notify subscribers (after transition)
    for (const listener of this._listeners) {
      try {
        listener(from, to, context);
      } catch (_) {
        // Subscriber errors must not break the lifecycle
      }
    }

    return result;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /** @returns {string|null} Current state name */
  currentState() {
    const info = this.fsm.getCurrentState();
    return info ? info.name : null;
  }

  /** @returns {boolean} */
  canTransition(to, context = {}) {
    return this.fsm.canTransition(to, context);
  }

  /** @returns {string[]} */
  getAvailableTransitions() {
    return this.fsm.getAvailableTransitions();
  }

  /** @returns {Array<{ from: string|null, to: string, timestamp: number, meta: object }>} */
  getHistory() {
    return this.fsm.getHistory();
  }

  // ------------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------------

  /**
   * Subscribe to state changes.
   *
   * @param {Function} handler  Called as (fromState, toState, context)
   * @returns {Function} Unsubscribe function
   */
  onStateChange(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onStateChange handler must be a function");
    }

    this._listeners.push(handler);

    return () => {
      const idx = this._listeners.indexOf(handler);
      if (idx !== -1) {
        this._listeners.splice(idx, 1);
      }
    };
  }

  // ------------------------------------------------------------------
  // Timing
  // ------------------------------------------------------------------

  /**
   * Milliseconds spent in the current state so far.
   * @returns {number}
   */
  getElapsedInState() {
    return Date.now() - this._lastTransitionTime;
  }

  /**
   * Total milliseconds spent in each state (accumulated + current running).
   * @returns {Record<string, number>}
   */
  getStateSummary() {
    const summary = {};

    for (const [state, total] of this._stateTimes) {
      summary[state] = total;
    }

    // Add running time for the current state
    const current = this.currentState();
    if (current) {
      summary[current] = (summary[current] || 0) + this.getElapsedInState();
    }

    return summary;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Whether the agent is in a state where it can accept new user input.
   * @returns {boolean}
   */
  canAcceptInput() {
    const state = this.currentState();
    return (
      state === AgentStates.IDLE ||
      state === AgentStates.COMPLETED ||
      state === AgentStates.INTERRUPTED
    );
  }

  /**
   * Reset to IDLE, clearing all accumulated timing and listeners.
   * @returns {string}
   */
  reset() {
    // Flush time for current state before resetting
    const current = this.currentState();
    if (current) {
      const elapsed = Date.now() - this._lastTransitionTime;
      const prev = this._stateTimes.get(current) || 0;
      this._stateTimes.set(current, prev + elapsed);
    }

    this._listeners = [];
    this._stateTimes = new Map();
    this._lastTransitionTime = Date.now();

    return this.fsm.reset();
  }
}

module.exports = { AgentLifecycle, AgentStates };
