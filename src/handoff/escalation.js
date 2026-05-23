"use strict";

const ESCALATION_LEVELS = Object.freeze({
  SELF_HEAL: 0,
  TEAM_LEAD: 1,
  HUMAN: 2,
  ADMIN: 3,
});

const ESCALATION_TRIGGERS = Object.freeze({
  REPEATED_FAILURES: "REPEATED_FAILURES",
  TIME_EXCEEDING: "TIME_EXCEEDING",
  COST_EXCEEDING: "COST_EXCEEDING",
  SAFETY_CONCERN: "SAFETY_CONCERN",
  STUCK_LOOP: "STUCK_LOOP",
  DATA_LOSS_RISK: "DATA_LOSS_RISK",
  PERMISSION_DENIED: "PERMISSION_DENIED",
});

const ESCALATION_STATUS = Object.freeze({
  NORMAL: "NORMAL",
  WATCHING: "WATCHING",
  ESCALATED: "ESCALATED",
  CRITICAL: "CRITICAL",
});

class EscalationPolicy {
  constructor(options = {}) {
    this._state = new Map();
    this._history = new Map();
    this._paths = new Map();

    this._config = {
      maxFailures: options.maxFailures ?? 3,
      failureWindowMs: options.failureWindowMs ?? 300000, // 5 min
      maxTimeMinutes: options.maxTimeMinutes ?? 30,
      maxCostDollars: options.maxCostDollars ?? 5.0,
      loopDetectionCount: options.loopDetectionCount ?? 5,
      loopDetectionWindowMs: options.loopDetectionWindowMs ?? 60000, // 1 min
      cooldownMs: options.cooldownMs ?? 600000, // 10 min
      autoDeescalateAfterMs: options.autoDeescalateAfterMs ?? 1800000, // 30 min
    };
  }

  // ---- Public API ----

  /**
   * Determine whether a given situation warrants escalation.
   *
   * @param {string} agentId
   * @param {object} situation - Context describing the current situation
   * @param {string} [situation.trigger] - Known trigger type
   * @param {number} [situation.consecutiveFailures]
   * @param {number} [situation.elapsedMinutes]
   * @param {number} [situation.costDollars]
   * @param {boolean} [situation.safetyConcern]
   * @param {boolean} [situation.stuckInLoop]
   * @param {boolean} [situation.dataLossRisk]
   * @param {boolean} [situation.permissionDenied]
   * @returns {object} Decision object with shouldEscalate and reason
   */
  shouldEscalate(agentId, situation = {}) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);
    const decision = {
      shouldEscalate: false,
      trigger: null,
      targetLevel: state.escalationLevel,
      reason: "",
      severity: "low",
    };

    // Check trigger-based escalation
    const triggerChecks = [
      { cond: () => this._checkRepeatedFailures(agentId, situation), trigger: ESCALATION_TRIGGERS.REPEATED_FAILURES },
      { cond: () => this._checkTimeExceeding(agentId, situation), trigger: ESCALATION_TRIGGERS.TIME_EXCEEDING },
      { cond: () => this._checkCostExceeding(agentId, situation), trigger: ESCALATION_TRIGGERS.COST_EXCEEDING },
      { cond: () => this._checkSafetyConcern(agentId, situation), trigger: ESCALATION_TRIGGERS.SAFETY_CONCERN },
      { cond: () => this._checkStuckLoop(agentId, situation), trigger: ESCALATION_TRIGGERS.STUCK_LOOP },
      { cond: () => this._checkDataLossRisk(agentId, situation), trigger: ESCALATION_TRIGGERS.DATA_LOSS_RISK },
      { cond: () => this._checkPermissionDenied(agentId, situation), trigger: ESCALATION_TRIGGERS.PERMISSION_DENIED },
    ];

    for (const check of triggerChecks) {
      if (check.cond()) {
        decision.shouldEscalate = true;
        decision.trigger = check.trigger;
        decision.targetLevel = this._nextLevel(state.escalationLevel);
        decision.reason = this._describeTrigger(check.trigger, situation);

        // Assign severity
        if (check.trigger === ESCALATION_TRIGGERS.SAFETY_CONCERN || check.trigger === ESCALATION_TRIGGERS.DATA_LOSS_RISK) {
          decision.severity = "critical";
        } else if (check.trigger === ESCALATION_TRIGGERS.STUCK_LOOP || check.trigger === ESCALATION_TRIGGERS.PERMISSION_DENIED) {
          decision.severity = "high";
        } else {
          decision.severity = "medium";
        }

        break;
      }
    }

    return decision;
  }

  /**
   * Escalate an agent to a higher authority level.
   *
   * @param {string} agentId
   * @param {object} situation - The current situation context
   * @param {number} [level] - Specific level to escalate to (auto-determined if not provided)
   * @returns {object} Escalation result
   */
  escalate(agentId, situation = {}, level = null) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);
    const currentLevel = state.escalationLevel;
    const targetLevel = level !== null ? clampLevel(level) : this._nextLevel(currentLevel);

    if (targetLevel <= currentLevel) {
      return {
        escalated: false,
        agentId,
        currentLevel,
        targetLevel,
        levelName: ESCALATION_LEVEL_NAMES[currentLevel],
        reason: "Already at or above target escalation level",
      };
    }

    // Check cooldown
    if (state.lastEscalationAt) {
      const elapsed = Date.now() - new Date(state.lastEscalationAt).getTime();
      if (elapsed < this._config.cooldownMs) {
        const remainingSeconds = Math.ceil((this._config.cooldownMs - elapsed) / 1000);
        return {
          escalated: false,
          agentId,
          currentLevel,
          targetLevel,
          levelName: ESCALATION_LEVEL_NAMES[currentLevel],
          reason: `Cooldown active: ${remainingSeconds}s remaining before next escalation`,
        };
      }
    }

    const previousLevel = state.escalationLevel;
    state.escalationLevel = targetLevel;
    state.escalationStatus = ESCALATION_STATUS.ESCALATED;
    state.lastEscalationAt = new Date().toISOString();
    state.lastEscalationTrigger = situation.trigger || "MANUAL";
    state.escalationCount += 1;

    // Record in history
    this._recordEscalationEvent(agentId, {
      type: "escalate",
      fromLevel: previousLevel,
      toLevel: targetLevel,
      trigger: situation.trigger,
      timestamp: state.lastEscalationAt,
      context: safeClone(situation),
    });

    return {
      escalated: true,
      agentId,
      previousLevel,
      currentLevel: targetLevel,
      levelName: ESCALATION_LEVEL_NAMES[targetLevel],
      path: this.getEscalationPath(agentId),
      status: state.escalationStatus,
    };
  }

  /**
   * Get the escalation path for an agent — who to contact at each level.
   *
   * @param {string} agentId
   * @returns {object} Escalation path with contacts at each level
   */
  getEscalationPath(agentId) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);
    const customPath = this._paths.get(agentId);

    const path = customPath || [
      { level: ESCALATION_LEVELS.SELF_HEAL, name: "Self-Heal", contact: "Automatic recovery routines", autoResolve: true },
      { level: ESCALATION_LEVELS.TEAM_LEAD, name: "Team Lead", contact: "team-lead@haxagent.local", autoResolve: false },
      { level: ESCALATION_LEVELS.HUMAN, name: "Human Operator", contact: "human-operator@haxagent.local", autoResolve: false },
      { level: ESCALATION_LEVELS.ADMIN, name: "Administrator", contact: "admin@haxagent.local", autoResolve: false },
    ];

    return {
      agentId,
      currentLevel: state.escalationLevel,
      currentLevelName: ESCALATION_LEVEL_NAMES[state.escalationLevel],
      path,
    };
  }

  /**
   * Set a custom escalation path for an agent.
   *
   * @param {string} agentId
   * @param {object[]} path - Array of { level, name, contact } objects
   */
  setEscalationPath(agentId, path) {
    requireString(agentId, "agentId");

    if (!Array.isArray(path) || path.length === 0) {
      throw new Error("path must be a non-empty array");
    }

    for (const entry of path) {
      if (!Number.isInteger(entry.level) || entry.level < 0 || entry.level > 3) {
        throw new Error(`Invalid escalation level: ${entry.level}. Must be 0-3.`);
      }
    }

    this._paths.set(agentId, deepClone(path));
  }

  /**
   * De-escalate an agent back to normal operation.
   *
   * @param {string} agentId
   * @returns {object} De-escalation result
   */
  deescalate(agentId) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);

    if (state.escalationLevel === ESCALATION_LEVELS.SELF_HEAL) {
      return {
        deescalated: false,
        agentId,
        reason: "Already at lowest level (SELF_HEAL)",
        currentLevel: state.escalationLevel,
        levelName: ESCALATION_LEVEL_NAMES[state.escalationLevel],
      };
    }

    const previousLevel = state.escalationLevel;
    state.escalationLevel = ESCALATION_LEVELS.SELF_HEAL;
    state.escalationStatus = ESCALATION_STATUS.NORMAL;
    state.lastDeescalationAt = new Date().toISOString();
    state.lastEscalationTrigger = null;

    this._recordEscalationEvent(agentId, {
      type: "deescalate",
      fromLevel: previousLevel,
      toLevel: ESCALATION_LEVELS.SELF_HEAL,
      trigger: "MANUAL_DEESCALATION",
      timestamp: state.lastDeescalationAt,
    });

    return {
      deescalated: true,
      agentId,
      previousLevel,
      currentLevel: ESCALATION_LEVELS.SELF_HEAL,
      levelName: ESCALATION_LEVEL_NAMES[ESCALATION_LEVELS.SELF_HEAL],
      status: state.escalationStatus,
    };
  }

  /**
   * Auto-deescalate agents that have been escalated longer than the auto-deescalate window.
   *
   * @returns {object[]} Array of de-escalation results
   */
  autoDeescalate() {
    const results = [];
    const now = Date.now();

    for (const [agentId, state] of this._state) {
      if (state.escalationLevel === ESCALATION_LEVELS.SELF_HEAL) continue;
      if (!state.lastEscalationAt) continue;

      const elapsed = now - new Date(state.lastEscalationAt).getTime();
      if (elapsed >= this._config.autoDeescalateAfterMs) {
        results.push(this.deescalate(agentId));
      }
    }

    return results;
  }

  /**
   * Record a failure for an agent (used for repeated failure tracking).
   *
   * @param {string} agentId
   * @param {object} [details]
   */
  recordFailure(agentId, details = {}) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);
    const now = Date.now();

    // Clean old failures outside the window
    state.failures = state.failures.filter(
      (f) => now - f.timestamp < this._config.failureWindowMs
    );

    state.failures.push({
      timestamp: now,
      type: details.type || "UNKNOWN",
      message: details.message || "",
      code: details.code || null,
    });

    // Update status
    const failureCount = state.failures.length;
    if (failureCount >= this._config.maxFailures) {
      state.escalationStatus = ESCALATION_STATUS.WATCHING;
    }
  }

  /**
   * Record an action for loop detection.
   *
   * @param {string} agentId
   * @param {string} actionKey - Unique identifier for the action (e.g., "tool:read_file:/path")
   */
  recordAction(agentId, actionKey) {
    requireString(agentId, "agentId");

    const state = this._getOrCreateState(agentId);
    const now = Date.now();

    // Clean old actions
    state.recentActions = (state.recentActions || []).filter(
      (a) => now - a.timestamp < this._config.loopDetectionWindowMs
    );

    state.recentActions.push({
      timestamp: now,
      actionKey,
    });
  }

  /**
   * Get the current escalation state for an agent.
   *
   * @param {string} agentId
   * @returns {object|null}
   */
  getState(agentId) {
    requireString(agentId, "agentId");
    const state = this._state.get(agentId);
    if (!state) return null;

    return {
      agentId,
      escalationLevel: state.escalationLevel,
      levelName: ESCALATION_LEVEL_NAMES[state.escalationLevel],
      status: state.escalationStatus,
      escalationCount: state.escalationCount,
      failureCount: state.failures.length,
      lastEscalationAt: state.lastEscalationAt,
      lastDeescalationAt: state.lastDeescalationAt,
      recentActionCount: (state.recentActions || []).length,
    };
  }

  /**
   * Get escalation history for an agent.
   *
   * @param {string} agentId
   * @returns {object[]}
   */
  getHistory(agentId) {
    requireString(agentId, "agentId");
    return deepClone(this._history.get(agentId) || []);
  }

  /**
   * Check whether the agent is currently in a loop.
   *
   * @param {string} agentId
   * @returns {boolean}
   */
  isInLoop(agentId) {
    requireString(agentId, "agentId");
    const state = this._state.get(agentId);
    if (!state || !state.recentActions) return false;

    const now = Date.now();
    const recent = state.recentActions.filter(
      (a) => now - a.timestamp < this._config.loopDetectionWindowMs
    );

    // Count duplicate action keys
    const counts = new Map();
    for (const a of recent) {
      counts.set(a.actionKey, (counts.get(a.actionKey) || 0) + 1);
    }

    for (const count of counts.values()) {
      if (count >= this._config.loopDetectionCount) return true;
    }

    return false;
  }

  /**
   * Clear all escalation state.
   */
  clear() {
    this._state.clear();
    this._history.clear();
    this._paths.clear();
  }

  // ---- Internal ----

  _getOrCreateState(agentId) {
    if (!this._state.has(agentId)) {
      this._state.set(agentId, {
        escalationLevel: ESCALATION_LEVELS.SELF_HEAL,
        escalationStatus: ESCALATION_STATUS.NORMAL,
        escalationCount: 0,
        lastEscalationAt: null,
        lastDeescalationAt: null,
        lastEscalationTrigger: null,
        failures: [],
        recentActions: [],
        startTime: Date.now(),
        totalCost: 0,
      });
    }
    return this._state.get(agentId);
  }

  _nextLevel(currentLevel) {
    if (currentLevel >= ESCALATION_LEVELS.ADMIN) return ESCALATION_LEVELS.ADMIN;
    return currentLevel + 1;
  }

  _recordEscalationEvent(agentId, event) {
    if (!this._history.has(agentId)) {
      this._history.set(agentId, []);
    }
    this._history.get(agentId).push(event);
  }

  _checkRepeatedFailures(agentId, situation) {
    const state = this._state.get(agentId);
    if (!state) return false;

    const failureCount = situation.consecutiveFailures || state.failures.length;
    return failureCount >= this._config.maxFailures;
  }

  _checkTimeExceeding(agentId, situation) {
    const elapsedMinutes = situation.elapsedMinutes || this._calculateElapsedMinutes(agentId);
    return elapsedMinutes > this._config.maxTimeMinutes;
  }

  _checkCostExceeding(agentId, situation) {
    const costDollars = situation.costDollars || (this._state.get(agentId)?.totalCost || 0);
    return costDollars > this._config.maxCostDollars;
  }

  _checkSafetyConcern(agentId, situation) {
    return situation.safetyConcern === true;
  }

  _checkStuckLoop(agentId, situation) {
    if (situation.stuckInLoop === true) return true;
    return this.isInLoop(agentId);
  }

  _checkDataLossRisk(agentId, situation) {
    return situation.dataLossRisk === true;
  }

  _checkPermissionDenied(agentId, situation) {
    return situation.permissionDenied === true;
  }

  _calculateElapsedMinutes(agentId) {
    const state = this._state.get(agentId);
    if (!state) return 0;
    return (Date.now() - state.startTime) / 60000;
  }

  _describeTrigger(trigger, situation) {
    const descriptions = {
      [ESCALATION_TRIGGERS.REPEATED_FAILURES]: `Exceeded ${this._config.maxFailures} consecutive failures within the tracking window`,
      [ESCALATION_TRIGGERS.TIME_EXCEEDING]: `Session exceeded ${this._config.maxTimeMinutes} minutes`,
      [ESCALATION_TRIGGERS.COST_EXCEEDING]: `Cost exceeded $${this._config.maxCostDollars.toFixed(2)}`,
      [ESCALATION_TRIGGERS.SAFETY_CONCERN]: "Safety concern detected",
      [ESCALATION_TRIGGERS.STUCK_LOOP]: "Agent appears to be stuck in a repetitive loop",
      [ESCALATION_TRIGGERS.DATA_LOSS_RISK]: "Risk of data loss detected",
      [ESCALATION_TRIGGERS.PERMISSION_DENIED]: "Critical operation denied due to permissions",
    };
    return descriptions[trigger] || "Unknown escalation trigger";
  }
}

// ---- Helpers ----

const ESCALATION_LEVEL_NAMES = Object.freeze({
  [ESCALATION_LEVELS.SELF_HEAL]: "SELF_HEAL",
  [ESCALATION_LEVELS.TEAM_LEAD]: "TEAM_LEAD",
  [ESCALATION_LEVELS.HUMAN]: "HUMAN",
  [ESCALATION_LEVELS.ADMIN]: "ADMIN",
});

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function clampLevel(level) {
  const num = Number(level);
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Invalid escalation level: ${level}`);
  }
  return Math.max(ESCALATION_LEVELS.SELF_HEAL, Math.min(ESCALATION_LEVELS.ADMIN, num));
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { cloneError: "Could not serialize value" };
  }
}

module.exports = {
  EscalationPolicy,
  ESCALATION_LEVELS,
  ESCALATION_TRIGGERS,
  ESCALATION_STATUS,
};
