/**
 * InteractionPolicy — Agent interaction policy and governance engine.
 *
 * Defines and enforces rules for agent-to-agent and agent-to-system interactions.
 * Supports four rule types (ALLOW, DENY, REQUIRE_APPROVAL, LOG_ONLY) and six
 * action types (CALL_TOOL, READ_FILE, WRITE_FILE, EXEC_SHELL, CALL_AGENT, SEND_MESSAGE).
 *
 * Evaluation strategy:
 *   DENY > REQUIRE_APPROVAL > ALLOW > LOG_ONLY (implicit allow)
 *
 *   - Any DENY match at any priority immediately blocks the action.
 *   - If no DENY, any REQUIRE_APPROVAL match flags the action for human review.
 *   - If neither DENY nor REQUIRE_APPROVAL, any ALLOW match permits the action.
 *   - LOG_ONLY rules never block; they are returned for audit/trace purposes.
 *   - If no rule matches, the default is to deny (safe-by-default).
 *
 * Rule shape:
 *   {
 *     type:       'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'LOG_ONLY',
 *     agents:     string[] | '*'               (which agent IDs this applies to)
 *     actions:    string[] | '*'               (action types)
 *     targets:    string[] | '*'               (target agent IDs or resource paths)
 *     conditions: ((agent, action, target, context) => boolean)[]  (optional)
 *     priority:   number                       (optional, higher = evaluated first)
 *     description: string                      (optional, human-readable)
 *   }
 */
"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WILDCARD = "*";

const RULE_TYPE = Object.freeze({
  ALLOW: "ALLOW",
  DENY: "DENY",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  LOG_ONLY: "LOG_ONLY",
});

const ACTION_TYPE = Object.freeze({
  CALL_TOOL: "CALL_TOOL",
  READ_FILE: "READ_FILE",
  WRITE_FILE: "WRITE_FILE",
  EXEC_SHELL: "EXEC_SHELL",
  CALL_AGENT: "CALL_AGENT",
  SEND_MESSAGE: "SEND_MESSAGE",
});

const ACTION_SEVERITY = Object.freeze({
  CALL_TOOL: 5,
  READ_FILE: 2,
  WRITE_FILE: 6,
  EXEC_SHELL: 8,
  CALL_AGENT: 7,
  SEND_MESSAGE: 3,
});

const RULE_TYPE_PRIORITY = Object.freeze({
  DENY: 100,
  REQUIRE_APPROVAL: 75,
  ALLOW: 50,
  LOG_ONLY: 25,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Test whether a candidate value matches a rule filter.
 * @param {string}   candidate
 * @param {string[]|'*'|undefined} filter
 * @param {string}   [fieldName] - for error messages
 */
function matchesFilter(candidate, filter, fieldName) {
  if (!filter) {
    throw new Error(`${fieldName || "filter"} is required for rule matching.`);
  }
  if (filter === WILDCARD) return true;
  if (Array.isArray(filter)) {
    return filter.includes(candidate) || filter.includes(WILDCARD);
  }
  return false;
}

/**
 * Validate a rule object.
 * @param {object} rule
 */
function validateRule(rule) {
  if (!rule || typeof rule !== "object") {
    throw new Error("Rule must be a non-null object.");
  }
  if (!rule.type || !RULE_TYPE[rule.type]) {
    throw new Error(
      `Rule type must be one of: ${Object.keys(RULE_TYPE).join(", ")}. Got: ${rule.type}`
    );
  }
}

/**
 * Resolve agent identifier from an agent descriptor.
 * @param {string|object} agent
 * @returns {string}
 */
function resolveAgentId(agent) {
  if (typeof agent === "string") return agent;
  if (agent && typeof agent === "object") {
    return agent.id || agent.name || agent.agentId || "unknown";
  }
  return "unknown";
}

/**
 * Resolve target identifier from a target descriptor.
 * @param {string|object} target
 * @returns {string}
 */
function resolveTargetId(target) {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") {
    return target.id || target.name || target.agentId || target.resource || target.path || "unknown";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// InteractionPolicy
// ---------------------------------------------------------------------------

class InteractionPolicy {
  constructor(options = {}) {
    /** @type {object[]} */
    this._rules = [];
    /** @type {string} */
    this._name = typeof options.name === "string" ? options.name : "default";
    /** @type {boolean} safe-by-default: if true, deny actions with no matching rule */
    this._safeByDefault = options.safeByDefault !== false;
    /** @type {object[]} audit trail of all evaluations */
    this._auditTrail = [];
    /** @type {number} max audit trail entries */
    this._maxAuditEntries = Number.isSafeInteger(options.maxAuditEntries) && options.maxAuditEntries > 0
      ? options.maxAuditEntries
      : 1000;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Add an interaction policy rule.
   *
   * @param {object} rule
   * @param {'ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'LOG_ONLY'} rule.type
   * @param {string[]|'*'} rule.agents - agent IDs this rule applies to
   * @param {string[]|'*'} rule.actions - action types
   * @param {string[]|'*'} [rule.targets] - target IDs or paths; default '*'
   * @param {Function[]} [rule.conditions] - predicate functions
   * @param {number} [rule.priority] - higher = evaluated first
   * @param {string} [rule.description]
   */
  addRule(rule) {
    validateRule(rule);

    this._rules.push({
      type: rule.type,
      agents: rule.agents,
      actions: rule.actions,
      targets: rule.targets || WILDCARD,
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
      priority: typeof rule.priority === "number" ? rule.priority : 0,
      description: typeof rule.description === "string" ? rule.description : null,
      addedAt: new Date().toISOString(),
    });
  }

  /**
   * Add multiple rules at once.
   * @param {object[]} rules
   */
  addRules(rules) {
    if (!Array.isArray(rules)) {
      throw new Error("addRules expects an array of rule objects.");
    }
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  /**
   * Remove a rule by its index or reference.
   * @param {number|object} ruleRef
   * @returns {boolean} true if removed
   */
  removeRule(ruleRef) {
    if (typeof ruleRef === "number") {
      if (ruleRef >= 0 && ruleRef < this._rules.length) {
        this._rules.splice(ruleRef, 1);
        return true;
      }
      return false;
    }
    const index = this._rules.indexOf(ruleRef);
    if (index !== -1) {
      this._rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Evaluate whether an agent is allowed to perform an action against a target.
   *
   * Resolution order (sorted by priority desc, then rule-type priority):
   *   1. If any applicable DENY rule matches → denied (stop).
   *   2. If any applicable REQUIRE_APPROVAL rule matches → requires_approval.
   *   3. If any applicable ALLOW rule matches → allowed.
   *   4. If only LOG_ONLY rules match, check safeByDefault.
   *   5. If no rules match, apply default policy.
   *
   * @param {string|object} agent   - agent descriptor or ID
   * @param {string}        action  - one of ACTION_TYPE values
   * @param {string|object} [target] - target descriptor, ID, or path
   * @param {object}        [context] - additional context (time, session data, etc.)
   * @returns {{
   *   allowed: boolean,
   *   requiresApproval: boolean,
   *   decision: 'ALLOW'|'DENY'|'REQUIRE_APPROVAL'|'LOG_ONLY'|'DEFAULT_DENY'|'DEFAULT_ALLOW',
   *   reason: string,
   *   matchingRules: object[],
   *   logOnlyRules: object[]
   * }}
   */
  evaluate(agent, action, target, context) {
    const agentId = resolveAgentId(agent);
    const targetId = target !== undefined && target !== null ? resolveTargetId(target) : WILDCARD;

    // Collect applicable rules
    const applicable = this._getApplicable(agentId, action, targetId, context);

    // Sort: higher priority first, then by rule-type severity
    applicable.sort((a, b) => {
      const priDiff = (b.priority || 0) - (a.priority || 0);
      if (priDiff !== 0) return priDiff;
      return (RULE_TYPE_PRIORITY[b.type] || 0) - (RULE_TYPE_PRIORITY[a.type] || 0);
    });

    const denies = applicable.filter((r) => r.type === RULE_TYPE.DENY);
    const requireApprovals = applicable.filter((r) => r.type === RULE_TYPE.REQUIRE_APPROVAL);
    const allows = applicable.filter((r) => r.type === RULE_TYPE.ALLOW);
    const logOnlys = applicable.filter((r) => r.type === RULE_TYPE.LOG_ONLY);

    let result;

    if (denies.length > 0) {
      const firstDeny = denies[0];
      result = {
        allowed: false,
        requiresApproval: false,
        decision: "DENY",
        reason: firstDeny.description
          ? `Action denied: ${firstDeny.description}`
          : `Action "${action}" by agent "${agentId}" on target "${targetId}" is denied by policy.`,
        matchingRules: applicable,
        logOnlyRules: logOnlys,
      };
    } else if (requireApprovals.length > 0) {
      const firstApproval = requireApprovals[0];
      result = {
        allowed: false,
        requiresApproval: true,
        decision: "REQUIRE_APPROVAL",
        reason: firstApproval.description
          ? `Action requires approval: ${firstApproval.description}`
          : `Action "${action}" by agent "${agentId}" on target "${targetId}" requires approval.`,
        matchingRules: applicable,
        logOnlyRules: logOnlys,
      };
    } else if (allows.length > 0) {
      const firstAllow = allows[0];
      result = {
        allowed: true,
        requiresApproval: false,
        decision: "ALLOW",
        reason: firstAllow.description
          ? `Action allowed: ${firstAllow.description}`
          : `Action "${action}" by agent "${agentId}" on target "${targetId}" is allowed.`,
        matchingRules: applicable,
        logOnlyRules: logOnlys,
      };
    } else if (logOnlys.length > 0) {
      result = {
        allowed: !this._safeByDefault,
        requiresApproval: false,
        decision: this._safeByDefault ? "DEFAULT_DENY" : "DEFAULT_ALLOW",
        reason: this._safeByDefault
          ? `Action "${action}" by agent "${agentId}" on target "${targetId}" has no explicit allow rule (only LOG_ONLY). Default: deny.`
          : `Action "${action}" by agent "${agentId}" on target "${targetId}" logged only. Default: allow.`,
        matchingRules: applicable,
        logOnlyRules: logOnlys,
      };
    } else {
      result = {
        allowed: !this._safeByDefault,
        requiresApproval: false,
        decision: this._safeByDefault ? "DEFAULT_DENY" : "DEFAULT_ALLOW",
        reason: this._safeByDefault
          ? `No policy rule matched for action "${action}" by agent "${agentId}". Default: deny (safe-by-default).`
          : `No policy rule matched for action "${action}" by agent "${agentId}". Default: allow.`,
        matchingRules: [],
        logOnlyRules: [],
      };
    }

    // Record audit trail
    this._recordAudit({
      agent: agentId,
      action,
      target: targetId,
      context: context || {},
      result: {
        allowed: result.allowed,
        requiresApproval: result.requiresApproval,
        decision: result.decision,
      },
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Get all policies (rules) that apply to a specific agent.
   *
   * @param {string|object} agent - agent descriptor or ID
   * @returns {object[]} array of matching rule objects
   */
  getApplicablePolicies(agent) {
    const agentId = resolveAgentId(agent);
    return this._rules.filter((rule) => {
      return matchesFilter(agentId, rule.agents, "rule.agents");
    });
  }

  /**
   * Produce a detailed explanation of why an action was allowed or denied.
   * This is designed to be called after evaluate() to get human-readable output,
   * or standalone with historical decision data.
   *
   * @param {string} action - the action that was evaluated
   * @param {object} decision - the return value from evaluate()
   * @returns {{
   *   summary: string,
   *   decision: string,
   *   allowed: boolean,
   *   requiresApproval: boolean,
   *   severity: string,
   *   rulesConsidered: number,
   *   applicableRules: object[],
   *   recommendation: string
   * }}
   */
  explain(action, decision) {
    if (!decision || typeof decision !== "object") {
      return {
        summary: "No evaluation data provided.",
        decision: "UNKNOWN",
        allowed: false,
        requiresApproval: false,
        severity: "UNKNOWN",
        rulesConsidered: 0,
        applicableRules: [],
        recommendation: "Provide a valid decision object from evaluate().",
      };
    }

    const actionSeverity = ACTION_SEVERITY[action] || 0;
    let severityLabel;
    if (actionSeverity >= 7) severityLabel = "CRITICAL";
    else if (actionSeverity >= 5) severityLabel = "HIGH";
    else if (actionSeverity >= 3) severityLabel = "MEDIUM";
    else severityLabel = "LOW";

    const matchingRules = decision.matchingRules || [];
    const logOnlyRules = decision.logOnlyRules || [];
    const allRules = [...matchingRules, ...logOnlyRules];

    let recommendation;
    if (decision.decision === "DENY") {
      recommendation = "This action is blocked. Review the deny rules above or adjust agent permissions.";
    } else if (decision.decision === "REQUIRE_APPROVAL") {
      recommendation = "This action requires human approval before execution.";
    } else if (decision.decision === "ALLOW") {
      recommendation = "This action is permitted. No changes needed.";
    } else if (decision.decision === "DEFAULT_DENY") {
      recommendation = "No explicit rules matched. Consider adding an ALLOW rule if this action should be permitted.";
    } else {
      recommendation = "No explicit rules matched. Action is allowed by default policy.";
    }

    return {
      summary: decision.reason || "No explanation available.",
      decision: decision.decision,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval || false,
      severity: severityLabel,
      rulesConsidered: allRules.length,
      applicableRules: matchingRules.map((rule) => ({
        type: rule.type,
        priority: rule.priority || 0,
        description: rule.description || "(no description)",
      })),
      recommendation,
    };
  }

  /**
   * Return the total number of rules.
   * @returns {number}
   */
  get ruleCount() {
    return this._rules.length;
  }

  /**
   * Return a shallow copy of the rules array.
   * @returns {object[]}
   */
  getRules() {
    return [...this._rules];
  }

  /**
   * Return rules of a specific type.
   * @param {string} type - one of RULE_TYPE values
   * @returns {object[]}
   */
  getRulesByType(type) {
    return this._rules.filter((r) => r.type === type);
  }

  /**
   * Return the audit trail of all evaluations.
   * @returns {object[]}
   */
  getAuditTrail() {
    return [...this._auditTrail];
  }

  /**
   * Clear all rules from the policy.
   */
  clearRules() {
    this._rules = [];
  }

  /**
   * Clear the audit trail.
   */
  clearAuditTrail() {
    this._auditTrail = [];
  }

  /**
   * Get the policy name.
   * @returns {string}
   */
  get name() {
    return this._name;
  }

  /**
   * Check if safe-by-default mode is active.
   * @returns {boolean}
   */
  get safeByDefault() {
    return this._safeByDefault;
  }

  /**
   * Set safe-by-default mode.
   * @param {boolean} value
   */
  set safeByDefault(value) {
    this._safeByDefault = Boolean(value);
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  /**
   * Collect all rules that match agent, action, target, AND conditions.
   * @param {string} agentId
   * @param {string} action
   * @param {string} targetId
   * @param {object} [context]
   * @returns {object[]}
   */
  _getApplicable(agentId, action, targetId, context) {
    return this._rules.filter((rule) => {
      if (!matchesFilter(agentId, rule.agents, "rule.agents")) return false;
      if (!matchesFilter(action, rule.actions, "rule.actions")) return false;
      if (!matchesFilter(targetId, rule.targets, "rule.targets")) return false;

      // Evaluate conditions
      for (const cond of rule.conditions) {
        if (!cond(agentId, action, targetId, context)) return false;
      }
      return true;
    });
  }

  /**
   * Record an entry in the audit trail, trimming if needed.
   * @param {object} entry
   */
  _recordAudit(entry) {
    this._auditTrail.push(entry);
    if (this._auditTrail.length > this._maxAuditEntries) {
      this._auditTrail = this._auditTrail.slice(-this._maxAuditEntries);
    }
  }
}

module.exports = {
  InteractionPolicy,
  RULE_TYPE,
  ACTION_TYPE,
  ACTION_SEVERITY,
  RULE_TYPE_PRIORITY,
};
