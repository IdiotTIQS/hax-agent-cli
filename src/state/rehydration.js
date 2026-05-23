"use strict";

const { StateSnapshot } = require("./snapshot");

/**
 * StateRehydration — safely restores agent state after interruption,
 * crash, or forced shutdown.
 *
 * Provides layered recovery:
 *   1. Full rehydration with environment compatibility checks
 *   2. Partial recovery from incomplete or partially-corrupt snapshots
 *   3. A detailed recovery report so callers know exactly what was
 *      recovered and what was lost.
 */

// Known platform values.
const VALID_PLATFORMS = new Set(["win32", "darwin", "linux", "aix", "freebsd", "openbsd", "sunos"]);

// Minimum acceptable Node.js major version for rehydration.
const MIN_NODE_MAJOR = 14;

class StateRehydration {
  constructor() {
    /** @type {{ recovered: string[], lost: string[], warnings: string[], errors: string[] }} */
    this._report = {
      recovered: [],
      lost: [],
      warnings: [],
      errors: [],
    };
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Full rehydration: validate snapshot, check environment, restore.
   *
   * @param {object} snapshot  Raw snapshot data
   * @returns {object|null}    Restored state data, or null on failure
   */
  rehydrate(snapshot) {
    this._resetReport();

    // Step 1 — validate snapshot structure
    const validation = StateSnapshot.validate(snapshot);
    if (!validation.valid) {
      this._report.errors.push(...validation.errors);
      this._report.lost.push("full_state");
      return null;
    }
    this._report.warnings.push(...validation.warnings);

    // Step 2 — validate environment
    const envCheck = this.validateEnvironment(snapshot);
    if (!envCheck.compatible) {
      this._report.warnings.push(...envCheck.warnings);
      // Non-fatal: we still try to rehydrate, but flag the incompatibility.
    }

    // Step 3 — restore via StateSnapshot (gives us a deep clone)
    let restored;
    try {
      restored = StateSnapshot.restore(snapshot);
    } catch (err) {
      this._report.errors.push(`restore failed: ${err.message}`);
      this._report.lost.push("full_state");
      return null;
    }

    // Step 4 — reconciliation: mark what was recovered
    this._report.recovered.push("fsm_state");
    this._report.recovered.push("lifecycle_timing");

    if (restored.messages.length > 0) {
      this._report.recovered.push(`messages (${restored.messages.length})`);
    } else {
      this._report.lost.push("messages");
    }

    if (restored.goal.enabled && restored.goal.text) {
      this._report.recovered.push("goal");
    } else if (restored.goal.enabled) {
      this._report.warnings.push("goal was enabled but has no text");
    }

    if (restored.tools.length > 0) {
      this._report.recovered.push(`tools (${restored.tools.length})`);
    } else {
      this._report.lost.push("tools");
    }

    if (Object.keys(restored.permissionState).length > 0) {
      this._report.recovered.push("permissionState");
    }

    if (restored.costTracking.inputTokens > 0 || restored.costTracking.outputTokens > 0) {
      this._report.recovered.push("costTracking");
    } else {
      this._report.warnings.push("costTracking has zero usage — may be a fresh session");
    }

    if (restored.contextStats) {
      this._report.recovered.push("contextStats");
    }

    return restored;
  }

  /**
   * Best-effort recovery from a partial or damaged snapshot.
   *
   * Attempts to salvage as much data as possible, filling in sensible
   * defaults for missing or corrupt fields.
   *
   * @param {object} partial  A possibly-incomplete snapshot
   * @returns {object}        Best-effort restored state
   */
  recoverPartial(partial) {
    this._resetReport();

    if (!partial || typeof partial !== "object") {
      this._report.errors.push("partial snapshot is not an object");
      this._report.lost.push("full_state");
      return this._emptyRecovery();
    }

    const recovered = this._emptyRecovery();

    // --- Try to recover each field ---

    // id
    if (typeof partial.id === "string" && partial.id.trim()) {
      recovered.id = partial.id;
      this._report.recovered.push("id");
    } else {
      recovered.id = `recover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this._report.lost.push("id");
    }

    // agentId
    if (typeof partial.agentId === "string") {
      recovered.agentId = partial.agentId;
      this._report.recovered.push("agentId");
    } else {
      this._report.lost.push("agentId");
    }

    // version
    if (typeof partial.version === "number" && partial.version > 0) {
      recovered.version = partial.version;
    } else {
      this._report.warnings.push("version missing or invalid, using 1");
    }

    // timestamp
    if (typeof partial.timestamp === "string" && partial.timestamp.trim()) {
      recovered.timestamp = partial.timestamp;
      this._report.recovered.push("timestamp");
    } else {
      recovered.timestamp = new Date().toISOString();
      this._report.lost.push("timestamp");
    }

    // FSM
    if (partial.fsm && typeof partial.fsm === "object") {
      recovered.fsm = {
        current:
          typeof partial.fsm.current === "string" ? partial.fsm.current : null,
        history: Array.isArray(partial.fsm.history)
          ? partial.fsm.history.filter(
              (entry) => entry && typeof entry === "object" && entry.from != null && entry.to != null,
            )
          : [],
        entryTime:
          typeof partial.fsm.entryTime === "number" ? partial.fsm.entryTime : null,
      };
      if (recovered.fsm.current) {
        this._report.recovered.push("fsm");
      } else {
        this._report.warnings.push("fsm.current is null — agent state unknown");
        this._report.lost.push("fsm.current");
      }
    } else {
      this._report.lost.push("fsm");
      recovered.fsm = { current: null, history: [], entryTime: null };
    }

    // Lifecycle
    if (partial.lifecycle && typeof partial.lifecycle === "object") {
      recovered.lifecycle = {
        stateTimes:
          partial.lifecycle.stateTimes && typeof partial.lifecycle.stateTimes === "object"
            ? { ...partial.lifecycle.stateTimes }
            : {},
        lastTransitionTime:
          typeof partial.lifecycle.lastTransitionTime === "number"
            ? partial.lifecycle.lastTransitionTime
            : null,
      };
      this._report.recovered.push("lifecycle");
    } else {
      this._report.lost.push("lifecycle");
    }

    // Messages
    if (Array.isArray(partial.messages)) {
      recovered.messages = partial.messages.filter(
        (msg) =>
          msg &&
          typeof msg === "object" &&
          typeof msg.role === "string" &&
          (typeof msg.content === "string" || Array.isArray(msg.content)),
      );
      const dropped = (partial.messages.length || 0) - recovered.messages.length;
      if (dropped > 0) {
        this._report.warnings.push(`dropped ${dropped} malformed messages`);
      }
      if (recovered.messages.length > 0) {
        this._report.recovered.push(`messages (${recovered.messages.length})`);
      } else {
        this._report.lost.push("messages");
      }
    } else {
      this._report.lost.push("messages");
    }

    // Goal
    if (partial.goal && typeof partial.goal === "object") {
      recovered.goal = {
        enabled: Boolean(partial.goal.enabled),
        text: String(partial.goal.text || ""),
        maxContinuations:
          typeof partial.goal.maxContinuations === "number"
            ? partial.goal.maxContinuations
            : null,
      };
      if (recovered.goal.enabled && recovered.goal.text) {
        this._report.recovered.push("goal");
      } else {
        this._report.lost.push("goal");
      }
    } else {
      this._report.lost.push("goal");
    }

    // Tools
    if (Array.isArray(partial.tools)) {
      recovered.tools = partial.tools.filter((t) => typeof t === "string");
      if (recovered.tools.length > 0) {
        this._report.recovered.push(`tools (${recovered.tools.length})`);
      } else {
        this._report.lost.push("tools");
      }
    } else {
      this._report.lost.push("tools");
    }

    // Settings
    if (partial.settings && typeof partial.settings === "object" && !Array.isArray(partial.settings)) {
      recovered.settings = { ...partial.settings };
      this._report.recovered.push("settings");
    } else {
      this._report.lost.push("settings");
    }

    // Permission state
    if (partial.permissionState && typeof partial.permissionState === "object" && !Array.isArray(partial.permissionState)) {
      recovered.permissionState = { ...partial.permissionState };
      this._report.recovered.push("permissionState");
    } else {
      this._report.lost.push("permissionState");
    }

    // Cost tracking
    if (partial.costTracking && typeof partial.costTracking === "object") {
      recovered.costTracking = {
        inputTokens: safeNum(partial.costTracking.inputTokens, 0),
        outputTokens: safeNum(partial.costTracking.outputTokens, 0),
        turnCount: safeNum(partial.costTracking.turnCount, 0),
        toolCallCount: safeNum(partial.costTracking.toolCallCount, 0),
        totalCost: safeNum(partial.costTracking.totalCost, 0),
      };
      this._report.recovered.push("costTracking");
    } else {
      this._report.lost.push("costTracking");
    }

    // Context stats — optional
    if (partial.contextStats && typeof partial.contextStats === "object") {
      recovered.contextStats = {
        tokenCount: safeNum(partial.contextStats.tokenCount, 0),
        messageCount: safeNum(partial.contextStats.messageCount, 0),
        truncated: Boolean(partial.contextStats.truncated),
        utilization: safeNum(partial.contextStats.utilization, 0),
      };
      this._report.recovered.push("contextStats");
    }

    // Metadata
    if (partial.metadata && typeof partial.metadata === "object" && !Array.isArray(partial.metadata)) {
      recovered.metadata = { ...partial.metadata };
    }

    return recovered;
  }

  /**
   * Check whether the current runtime environment is compatible with
   * the snapshot's recorded environment.
   *
   * @param {object} snapshot
   * @returns {{ compatible: boolean, checks: object, warnings: string[] }}
   */
  validateEnvironment(snapshot) {
    const warnings = [];
    const checks = {};

    // Platform compatibility
    const snapshotPlatform = snapshot.metadata?.platform || null;
    const currentPlatform = process.platform;

    checks.platform = {
      snapshot: snapshotPlatform,
      current: currentPlatform,
      match: snapshotPlatform ? snapshotPlatform === currentPlatform : null,
    };

    if (snapshotPlatform && snapshotPlatform !== currentPlatform) {
      warnings.push(
        `Snapshot was captured on "${snapshotPlatform}" but current platform is "${currentPlatform}". ` +
        "File paths and tool availability may differ.",
      );
    }

    // Node.js version
    const snapshotNode = snapshot.metadata?.nodeVersion || null;
    const currentNode = process.version;

    checks.node = {
      snapshot: snapshotNode,
      current: currentNode,
      ok: true,
    };

    if (snapshotNode) {
      const snapMajor = extractMajor(snapshotNode);
      const currMajor = extractMajor(currentNode);

      if (snapMajor !== null && currMajor !== null && snapMajor > currMajor) {
        warnings.push(
          `Snapshot was captured with Node.js ${snapshotNode} but current is ${currentNode}. ` +
          "Some APIs may not be available.",
        );
        checks.node.ok = currMajor >= MIN_NODE_MAJOR;
      }

      if (currMajor < MIN_NODE_MAJOR) {
        warnings.push(
          `Current Node.js version ${currentNode} is below minimum required (v${MIN_NODE_MAJOR}).`,
        );
        checks.node.ok = false;
      }
    }

    // Tool availability check (if snapshot lists tools)
    if (Array.isArray(snapshot.tools) && snapshot.tools.length > 0) {
      checks.tools = {
        expected: snapshot.tools.length,
        available: snapshot.tools.length, // Can't actually check — warn if needed
      };
    }

    return {
      compatible: checks.node?.ok !== false,
      checks,
      warnings,
    };
  }

  /**
   * Returns the recovery report from the last rehydrate / recoverPartial call.
   *
   * @returns {{ recovered: string[], lost: string[], warnings: string[], errors: string[] }}
   */
  getRecoveryReport() {
    return {
      recovered: [...this._report.recovered],
      lost: [...this._report.lost],
      warnings: [...this._report.warnings],
      errors: [...this._report.errors],
    };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _resetReport() {
    this._report = {
      recovered: [],
      lost: [],
      warnings: [],
      errors: [],
    };
  }

  /**
   * Build an empty recovery template with safe defaults.
   * @returns {object}
   */
  _emptyRecovery() {
    return {
      id: "",
      agentId: "",
      version: 1,
      timestamp: new Date().toISOString(),
      fsm: { current: null, history: [], entryTime: null },
      lifecycle: { stateTimes: {}, lastTransitionTime: null },
      messages: [],
      goal: { enabled: false, text: "", maxContinuations: null },
      tools: [],
      settings: {},
      permissionState: {},
      costTracking: {
        inputTokens: 0,
        outputTokens: 0,
        turnCount: 0,
        toolCallCount: 0,
        totalCost: 0,
      },
      contextStats: null,
      metadata: { recovered: true, recoveredAt: new Date().toISOString() },
    };
  }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function safeNum(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function extractMajor(versionString) {
  const match = String(versionString).match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

module.exports = { StateRehydration };
