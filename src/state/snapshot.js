"use strict";

/**
 * StateSnapshot — captures, restores, diffs, validates, and migrates
 * full agent state snapshots.
 *
 * A snapshot is a plain frozen object that represents the complete
 * observable state of an agent at a single point in time.  It is
 * designed to be serialisable (JSON-friendly) so it can be persisted,
 * sent over the wire, or used for checkpoint / resume workflows.
 *
 * Captured fields:
 *   - fsm.current / fsm.history        (from AgentLifecycle)
 *   - lifecycle state-times & timing   (from AgentLifecycle)
 *   - messages                         (conversation transcript)
 *   - goal                             (persistent goal state)
 *   - tools                            (available tool names)
 *   - settings                         (agent configuration)
 *   - permissionState                  (grant / deny map)
 *   - costTracking                     (token & cost counters)
 *   - contextStats                     (window utilisation)
 *   - metadata                         (arbitrary caller data)
 */

const CURRENT_VERSION = 1;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isISOString(v) {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return d instanceof Date && !Number.isNaN(d.getTime()) && v === d.toISOString();
}

function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// ------------------------------------------------------------------
// StateSnapshot
// ------------------------------------------------------------------

class StateSnapshot {
  /**
   * Capture a full agent state snapshot.
   *
   * @param {object} agent
   * @param {object} [agent.lifecycle]        AgentLifecycle instance
   * @param {Array}  [agent.messages=[]]      Conversation messages
   * @param {object} [agent.goal]             { enabled, text, maxContinuations }
   * @param {Array}  [agent.tools=[]]         Available tool names
   * @param {object} [agent.settings={}]      Agent settings
   * @param {object} [agent.permissionState={}]  Permission grants/denials
   * @param {object} [agent.costTracker]      { inputTokens, outputTokens, turnCount, toolCallCount, totalCost }
   * @param {object} [agent.contextStats]     Context window stats
   * @param {object} [agent.metadata={}]      Arbitrary metadata
   * @returns {object} Frozen snapshot
   */
  static capture(agent = {}) {
    const lifecycle = agent.lifecycle || null;
    const messages = Array.isArray(agent.messages) ? [...agent.messages] : [];
    const tools = Array.isArray(agent.tools) ? [...agent.tools] : [];
    const settings = isPlainObject(agent.settings) ? { ...agent.settings } : {};
    const permissionState = isPlainObject(agent.permissionState)
      ? { ...agent.permissionState }
      : {};
    const metadata = isPlainObject(agent.metadata) ? { ...agent.metadata } : {};

    // --- FSM state ---
    let fsmCurrent = null;
    let fsmHistory = [];
    let fsmEntryTime = null;

    if (lifecycle && lifecycle.fsm) {
      const fsmInfo = lifecycle.fsm.getCurrentState();
      fsmCurrent = fsmInfo ? fsmInfo.name : null;
      fsmEntryTime = fsmInfo ? fsmInfo.entryTime : null;
      fsmHistory = lifecycle.fsm.getHistory().map((entry) => ({
        from: entry.from,
        to: entry.to,
        timestamp: entry.timestamp,
        meta: { ...entry.meta },
      }));
    }

    // --- Lifecycle timing ---
    let stateTimes = {};
    let lastTransitionTime = null;
    let agentId = "";

    if (lifecycle) {
      agentId = String(lifecycle.agentId || "");
      stateTimes = lifecycle.getStateSummary ? lifecycle.getStateSummary() : {};
      lastTransitionTime =
        typeof lifecycle._lastTransitionTime === "number"
          ? lifecycle._lastTransitionTime
          : null;
    }

    // --- Goal ---
    const goal = {
      enabled: false,
      text: "",
      maxContinuations: null,
    };

    if (isPlainObject(agent.goal)) {
      goal.enabled = Boolean(agent.goal.enabled);
      goal.text = String(agent.goal.text || "");
      goal.maxContinuations =
        typeof agent.goal.maxContinuations === "number"
          ? agent.goal.maxContinuations
          : null;
    }

    // --- Cost tracking ---
    let costTracking = {
      inputTokens: 0,
      outputTokens: 0,
      turnCount: 0,
      toolCallCount: 0,
      totalCost: 0,
    };

    if (agent.costTracker) {
      const ct = agent.costTracker;
      costTracking = {
        inputTokens: safeNumber(ct.inputTokens, 0),
        outputTokens: safeNumber(ct.outputTokens, 0),
        turnCount: safeNumber(ct.turnCount, 0),
        toolCallCount: safeNumber(ct.toolCallCount, 0),
        totalCost:
          typeof ct.getCost === "function"
            ? safeNumber(ct.getCost(), 0)
            : safeNumber(ct.totalCost, 0),
      };
    }

    // --- Context stats ---
    let contextStats = null;
    if (agent.contextStats) {
      contextStats = {
        tokenCount: safeNumber(agent.contextStats.tokenCount, 0),
        messageCount: safeNumber(agent.contextStats.messageCount, 0),
        truncated: Boolean(agent.contextStats.truncated),
        utilization: safeNumber(agent.contextStats.utilization, 0),
      };
    }

    // --- Assemble ---
    const snapshot = {
      id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      version: CURRENT_VERSION,
      timestamp: new Date().toISOString(),

      fsm: {
        current: fsmCurrent,
        history: fsmHistory,
        entryTime: fsmEntryTime,
      },

      lifecycle: {
        stateTimes,
        lastTransitionTime,
      },

      messages,
      goal,
      tools,
      settings,
      permissionState,
      costTracking,
      contextStats,
      metadata,
    };

    return Object.freeze(snapshot);
  }

  /**
   * Restore an agent from a snapshot.  Returns the full snapshot data,
   * validated and deep-cloned, ready for the caller to rebuild agent
   * internals.
   *
   * @param {object} snapshot
   * @returns {object} Deep-cloned, validated snapshot data
   * @throws {TypeError} if the snapshot fails validation
   */
  static restore(snapshot) {
    const result = StateSnapshot.validate(snapshot);
    if (!result.valid) {
      throw new TypeError(
        `Snapshot validation failed: ${result.errors.join("; ")}`,
      );
    }

    // Return a mutable deep clone so the caller can modify it during restore.
    const clone = deepClone(snapshot);

    // Ensure messages are writable (defensive)
    clone.messages = Array.isArray(clone.messages) ? [...clone.messages] : [];
    clone.tools = Array.isArray(clone.tools) ? [...clone.tools] : [];

    return clone;
  }

  /**
   * Compute what changed between two snapshots.
   *
   * @param {object} a  Older snapshot
   * @param {object} b  Newer snapshot
   * @returns {object}  { changed: string[], details: object }
   */
  static diff(a, b) {
    if (!isPlainObject(a) || !isPlainObject(b)) {
      return {
        changed: ["snapshot"],
        details: { snapshot: "One or both snapshots are not plain objects" },
      };
    }

    const changed = [];
    const details = {};

    // Compare top-level scalar/identity fields
    const scalarFields = ["agentId", "version"];
    for (const field of scalarFields) {
      if (a[field] !== b[field]) {
        changed.push(field);
        details[field] = { from: a[field], to: b[field] };
      }
    }

    // FSM current state
    if (isPlainObject(a.fsm) && isPlainObject(b.fsm)) {
      if (a.fsm.current !== b.fsm.current) {
        changed.push("fsm.current");
        details["fsm.current"] = { from: a.fsm.current, to: b.fsm.current };
      }
    } else if (a.fsm !== b.fsm) {
      changed.push("fsm");
      details.fsm = { from: a.fsm, to: b.fsm };
    }

    // Messages — compare lengths and last N entries for performance
    const aMsgs = Array.isArray(a.messages) ? a.messages : [];
    const bMsgs = Array.isArray(b.messages) ? b.messages : [];

    if (aMsgs.length !== bMsgs.length) {
      changed.push("messages.length");
      details["messages.length"] = {
        from: aMsgs.length,
        to: bMsgs.length,
        added: bMsgs.length - aMsgs.length,
      };
    } else {
      // Check if any message content differs
      let msgChanged = false;
      for (let i = 0; i < aMsgs.length; i++) {
        if (!shallowEqual(aMsgs[i], bMsgs[i])) {
          msgChanged = true;
          break;
        }
      }
      if (msgChanged) {
        changed.push("messages.content");
        details["messages.content"] = "Content differs between snapshots";
      }
    }

    // Goal
    if (!shallowEqual(a.goal, b.goal)) {
      changed.push("goal");
      details.goal = { from: a.goal, to: b.goal };
    }

    // Tools
    if (JSON.stringify(a.tools) !== JSON.stringify(b.tools)) {
      changed.push("tools");
      details.tools = { from: a.tools, to: b.tools };
    }

    // Settings
    if (!shallowEqual(a.settings, b.settings)) {
      changed.push("settings");
      details.settings = { from: a.settings, to: b.settings };
    }

    // Permission state
    if (!shallowEqual(a.permissionState, b.permissionState)) {
      changed.push("permissionState");
      details.permissionState = {
        from: a.permissionState,
        to: b.permissionState,
      };
    }

    // Cost tracking
    if (!shallowEqual(a.costTracking, b.costTracking)) {
      changed.push("costTracking");
      details.costTracking = {
        from: a.costTracking,
        to: b.costTracking,
        delta: {
          inputTokens: safeNumber(b.costTracking?.inputTokens, 0) -
            safeNumber(a.costTracking?.inputTokens, 0),
          outputTokens: safeNumber(b.costTracking?.outputTokens, 0) -
            safeNumber(a.costTracking?.outputTokens, 0),
          totalCost: safeNumber(b.costTracking?.totalCost, 0) -
            safeNumber(a.costTracking?.totalCost, 0),
        },
      };
    }

    // Context stats
    if (!shallowEqual(a.contextStats, b.contextStats)) {
      changed.push("contextStats");
      details.contextStats = {
        from: a.contextStats,
        to: b.contextStats,
      };
    }

    // Metadata
    if (!shallowEqual(a.metadata, b.metadata)) {
      changed.push("metadata");
      details.metadata = { from: a.metadata, to: b.metadata };
    }

    return Object.freeze({ changed, details: Object.freeze(details) });
  }

  /**
   * Validate a snapshot for structural integrity.
   *
   * @param {object} snapshot
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  static validate(snapshot) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(snapshot)) {
      errors.push("snapshot must be a plain object");
      return { valid: false, errors, warnings };
    }

    // Required top-level fields
    const required = [
      "id",
      "agentId",
      "version",
      "timestamp",
      "fsm",
      "lifecycle",
      "messages",
      "goal",
      "tools",
      "settings",
      "permissionState",
      "costTracking",
    ];

    for (const field of required) {
      if (!(field in snapshot)) {
        errors.push(`missing required field: "${field}"`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // --- Type checks ---

    if (!isNonEmptyString(snapshot.id)) {
      errors.push('"id" must be a non-empty string');
    }

    if (typeof snapshot.agentId !== "string") {
      errors.push('"agentId" must be a string');
    }

    if (typeof snapshot.version !== "number" || !Number.isInteger(snapshot.version) || snapshot.version < 1) {
      errors.push('"version" must be a positive integer');
    }

    if (!isISOString(snapshot.timestamp)) {
      errors.push('"timestamp" must be a valid ISO-8601 string');
    }

    // FSM
    if (!isPlainObject(snapshot.fsm)) {
      errors.push('"fsm" must be a plain object');
    } else {
      if (!("current" in snapshot.fsm)) {
        errors.push('"fsm.current" is required');
      } else if (snapshot.fsm.current !== null && typeof snapshot.fsm.current !== "string") {
        errors.push('"fsm.current" must be a string or null');
      }
      if (!Array.isArray(snapshot.fsm.history)) {
        errors.push('"fsm.history" must be an array');
      } else {
        for (let i = 0; i < snapshot.fsm.history.length; i++) {
          const entry = snapshot.fsm.history[i];
          if (!isPlainObject(entry)) {
            errors.push(`"fsm.history[${i}]" must be a plain object`);
            break;
          }
          if (!("from" in entry) || !("to" in entry)) {
            errors.push(`"fsm.history[${i}]" must have "from" and "to"`);
            break;
          }
        }
      }
    }

    // Lifecycle
    if (!isPlainObject(snapshot.lifecycle)) {
      errors.push('"lifecycle" must be a plain object');
    } else {
      if (!isPlainObject(snapshot.lifecycle.stateTimes)) {
        errors.push('"lifecycle.stateTimes" must be a plain object');
      }
    }

    // Messages
    if (!Array.isArray(snapshot.messages)) {
      errors.push('"messages" must be an array');
    } else {
      for (let i = 0; i < snapshot.messages.length; i++) {
        const msg = snapshot.messages[i];
        if (!isPlainObject(msg)) {
          errors.push(`"messages[${i}]" must be a plain object`);
          break;
        }
        if (typeof msg.role !== "string") {
          errors.push(`"messages[${i}].role" is required`);
          break;
        }
        if (typeof msg.content !== "string" && !Array.isArray(msg.content)) {
          errors.push(`"messages[${i}].content" must be a string or array`);
          break;
        }
      }
    }

    // Goal
    if (!isPlainObject(snapshot.goal)) {
      errors.push('"goal" must be a plain object');
    } else {
      if (typeof snapshot.goal.enabled !== "boolean") {
        errors.push('"goal.enabled" must be a boolean');
      }
      if (typeof snapshot.goal.text !== "string") {
        errors.push('"goal.text" must be a string');
      }
    }

    // Tools
    if (!Array.isArray(snapshot.tools)) {
      errors.push('"tools" must be an array');
    }

    // Settings
    if (!isPlainObject(snapshot.settings)) {
      errors.push('"settings" must be a plain object');
    }

    // Permission state
    if (!isPlainObject(snapshot.permissionState)) {
      errors.push('"permissionState" must be a plain object');
    }

    // Cost tracking
    if (!isPlainObject(snapshot.costTracking)) {
      errors.push('"costTracking" must be a plain object');
    }

    // --- Warnings (non-fatal) ---

    if (snapshot.messages && snapshot.messages.length === 0) {
      warnings.push("snapshot has no messages");
    }

    if (snapshot.tools && snapshot.tools.length === 0) {
      warnings.push("snapshot has no tools defined");
    }

    if (snapshot.fsm && snapshot.fsm.current === null) {
      warnings.push("fsm.current is null — agent has no current state");
    }

    if (snapshot.costTracking && snapshot.costTracking.totalCost < 0) {
      warnings.push("totalCost is negative");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Migrate a snapshot from one version to another.
   *
   * Migration functions are keyed by [fromVersion]: Function that
   * transforms the snapshot in-place and bumps its version.
   *
   * @param {object} snapshot       The snapshot to migrate (mutated)
   * @param {number} fromVersion    Current version of the snapshot
   * @param {number} toVersion      Target version
   * @returns {object} The migrated snapshot (same reference)
   */
  static migrate(snapshot, fromVersion, toVersion) {
    if (!isPlainObject(snapshot)) {
      throw new TypeError("snapshot must be a plain object");
    }

    let v = Number(fromVersion);
    const target = Number(toVersion);

    if (!Number.isInteger(v) || v < 1) {
      throw new TypeError(
        `fromVersion must be a positive integer, got ${fromVersion}`,
      );
    }
    if (!Number.isInteger(target) || target < 1) {
      throw new TypeError(
        `toVersion must be a positive integer, got ${toVersion}`,
      );
    }

    const migrations = {
      // Example: 1 → 2 adds a new field
      // 1: (snap) => {
      //   snap.metadata = snap.metadata || {};
      //   snap.metadata.migratedAt = new Date().toISOString();
      //   snap.version = 2;
      // },
    };

    while (v < target) {
      const migrateFn = migrations[v];
      if (!migrateFn) {
        throw new Error(
          `No migration path from version ${v} to ${v + 1}`,
        );
      }
      migrateFn(snapshot);
      v = snapshot.version;
    }

    // If we need to go backwards, error out (not supported)
    if (v > target) {
      throw new Error(
        `Cannot downgrade snapshot from version ${v} to ${target}`,
      );
    }

    return snapshot;
  }
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

function safeNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// ------------------------------------------------------------------

module.exports = { StateSnapshot, CURRENT_VERSION };
