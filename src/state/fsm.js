"use strict";

/**
 * Generic finite state machine with guarded transitions, wildcard routing,
 * entry/exit actions, and transition history.
 *
 * States are registered via addState(), which optionally declares allowed
 * outgoing transitions.  Additional guarded transitions can be layered on
 * top via addTransition().  Guards are functions (context) => boolean that
 * must return true for the transition to be permitted.
 *
 * Wildcards: use "*" as the "from" state in addTransition() to make a
 * transition legal from any state.
 */
class StateMachine {
  constructor(options = {}) {
    this.initial = typeof options.initial === "string" ? options.initial : null;
    this.current = this.initial;

    // name → { entry, exit, transitions: Set<string> }
    this._states = new Map();

    // { from, to, guard } — raw transition definitions
    this._transitions = [];

    // History array: { from, to, timestamp, meta }
    this._history = [];

    // Timestamp of the last successful transition (or constructor time)
    this._entryTime = null;

    if (this.current) {
      this._entryTime = Date.now();
      this._history.push({
        from: null,
        to: this.current,
        timestamp: this._entryTime,
        meta: {},
      });
    }
  }

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  /**
   * Register a named state.
   *
   * @param {string} name
   * @param {{ entry?: Function, exit?: Function, transitions?: string[] }} config
   * @returns {StateMachine} this (fluent)
   */
  addState(name, config = {}) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new TypeError("addState requires a non-empty name string");
    }

    const entry =
      typeof config.entry === "function" ? config.entry : null;
    const exit =
      typeof config.exit === "function" ? config.exit : null;
    const transitions = Array.isArray(config.transitions)
      ? new Set(config.transitions)
      : new Set();

    this._states.set(name, { entry, exit, transitions });

    // Auto-set initial if this is the first state and no initial was given
    if (this.current === null && this.initial === null) {
      this.initial = name;
      this.current = name;
      this._entryTime = Date.now();
      this._history.push({
        from: null,
        to: name,
        timestamp: this._entryTime,
        meta: {},
      });
    }

    return this;
  }

  /**
   * Define a (possibly guarded) transition between two states.
   *
   * @param {string} from   Source state name, or "*" for wildcard-from-any.
   * @param {string} to     Target state name.
   * @param {Function} [guard]  (context) => boolean
   * @returns {StateMachine} this (fluent)
   */
  addTransition(from, to, guard) {
    if (typeof from !== "string" || from.trim() === "") {
      throw new TypeError("addTransition requires a non-empty 'from' string");
    }
    if (typeof to !== "string" || to.trim() === "") {
      throw new TypeError("addTransition requires a non-empty 'to' string");
    }

    const guardFn = typeof guard === "function" ? guard : null;

    this._transitions.push({ from, to, guard: guardFn });

    // Push into per-state allowed-transition sets so wildcards are visible
    // in getAvailableTransitions() etc.
    if (from === "*") {
      for (const [, stateDef] of this._states) {
        stateDef.transitions.add(to);
      }
    } else {
      const src = this._states.get(from);
      if (src) {
        src.transitions.add(to);
      }
    }

    return this;
  }

  // ------------------------------------------------------------------
  // Transitioning
  // ------------------------------------------------------------------

  /**
   * Attempt a transition from current to `to`.
   *
   * Runs exit action on the current state, updates current, pushes
   * a history entry, then runs entry action on the new state.
   *
   * @param {string} to       Target state name
   * @param {object} [context]  Arbitrary payload passed to guards and actions
   * @returns {{ from: string, to: string, timestamp: number, meta: object }}
   * @throws {Error} if the transition is not allowed
   */
  transition(to, context = {}) {
    if (!this.canTransition(to, context)) {
      throw new Error(
        `Invalid transition: ${this.current || "(null)"} -> ${to}`,
      );
    }

    const currentDef = this._states.get(this.current);
    const nextDef = this._states.get(to);
    const from = this.current;

    // Exit action
    if (currentDef && currentDef.exit) {
      try {
        currentDef.exit(context);
      } catch (_) {
        // Exit actions are best-effort; never block the transition
      }
    }

    this.current = to;
    this._entryTime = Date.now();

    const entry = {
      from,
      to,
      timestamp: this._entryTime,
      meta: { ...context },
    };
    this._history.push(entry);

    // Entry action
    if (nextDef && nextDef.entry) {
      try {
        nextDef.entry(context);
      } catch (_) {
        // Entry actions are best-effort
      }
    }

    return entry;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /**
   * Check whether a transition from current → `to` is allowed.
   *
   * A transition is allowed when:
   *   1. `to` is a known state
   *   2. `to` appears in the current state's outgoing set
   *   3. Any guards registered for this path return true (OR semantics)
   *
   * @param {string} to
   * @param {object} [context]
   * @returns {boolean}
   */
  canTransition(to, context = {}) {
    if (this.current === null) return false;
    if (!this._states.has(to)) return false;

    const currentDef = this._states.get(this.current);
    if (!currentDef || !currentDef.transitions.has(to)) return false;

    // Collect guards that match (current→to) or (*→to)
    const guards = this._transitions
      .filter(
        (t) =>
          (t.from === this.current || t.from === "*") &&
          t.to === to &&
          t.guard !== null,
      )
      .map((t) => t.guard);

    if (guards.length === 0) return true;

    // At least one guard must pass (OR semantics)
    return guards.some((g) => {
      try {
        return g(context) === true;
      } catch (_) {
        // Guard threw — treat as blocked
        return false;
      }
    });
  }

  /**
   * @returns {{ name: string, config: object, entryTime: number, elapsed: number } | null}
   */
  getCurrentState() {
    if (this.current === null) return null;
    const config = this._states.get(this.current) || null;
    return {
      name: this.current,
      config: config
        ? { transitions: [...config.transitions] }
        : null,
      entryTime: this._entryTime,
      elapsed: this._entryTime ? Date.now() - this._entryTime : 0,
    };
  }

  /**
   * @returns {string[]} Names of states reachable from the current state
   */
  getAvailableTransitions() {
    if (this.current === null) return [];
    const currentDef = this._states.get(this.current);
    if (!currentDef) return [];
    return [...currentDef.transitions];
  }

  /**
   * @returns {Array<{ from: string|null, to: string, timestamp: number, meta: object }>}
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Return to the initial state.
   *
   * Runs exit on current, pushes a history entry, and resets entry time.
   *
   * @param {object} [context]
   * @returns {string|null} The initial state name
   */
  reset(context = {}) {
    // Exit current without throwing
    if (this.current && this._states.has(this.current)) {
      const exitFn = this._states.get(this.current).exit;
      if (exitFn) {
        try {
          exitFn(context);
        } catch (_) {
          // Swallow
        }
      }
    }

    this.current = this.initial;
    this._entryTime = Date.now();

    this._history.push({
      from: null,
      to: this.initial,
      timestamp: this._entryTime,
      meta: { reset: true, ...context },
    });

    return this.current;
  }
}

module.exports = { StateMachine };
