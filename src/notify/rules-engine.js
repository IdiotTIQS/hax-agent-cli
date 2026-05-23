/**
 * NotificationRules — intelligent rule-based notification management.
 *
 * Rules are evaluated as: IF condition THEN action WITH priority.
 *
 *   const engine = new NotificationRules();
 *   engine.addRule({
 *     id: 'suppress-info',
 *     priority: 100,
 *     condition: { eventType: 'task.complete', severity: 'info' },
 *     action: { type: 'suppress', params: { reason: 'Low priority' } },
 *   });
 *   const result = engine.evaluate({ type: 'task.complete', severity: 'info' }, ctx);
 */
"use strict";

// ---- Constants ---------------------------------------------------------------

const SEVERITY_RANKS = { info: 0, warn: 1, error: 2, critical: 3 };

const ACTION_TYPES = new Set([
  "notify",
  "escalate",
  "suppress",
  "aggregate",
  "route",
]);

const DAY_NAMES = new Set([
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
]);

// ---- NotificationRules -------------------------------------------------------

class NotificationRules {
  /**
   * @param {object} [options]
   * @param {boolean} [options.strict=false] - Throw on invalid rule config
   * @param {boolean} [options.requireId=true] - Require rule.id to be set
   */
  constructor(options = {}) {
    this._rules = new Map();       // id -> rule
    this._priorityOrder = [];      // sorted rule ids by priority (desc)
    this._strict = options.strict === true;
    this._requireId = options.requireId !== false;
    this._evaluationLog = [];      // recent evaluation entries
    this._maxLogSize = 500;
  }

  // -- Rule management ---------------------------------------------------------

  /**
   * Add a notification rule.
   *
   * @param {object} rule
   * @param {string} rule.id — Unique identifier
   * @param {number} [rule.priority=0] — Higher priority rules evaluated first
   * @param {boolean} [rule.enabled=true]
   * @param {object|Function} rule.condition — Condition spec or predicate function
   * @param {object} rule.action — { type: string, params?: object }
   * @throws {Error} if strict mode and rule is invalid
   * @returns {object} The rule (for chaining)
   */
  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new Error("Rule must be a non-null object");
    }

    const id = rule.id;
    if (this._requireId && (typeof id !== "string" || id.trim() === "")) {
      throw new Error("Rule must have a non-empty string `id`");
    }

    if (id && this._rules.has(id)) {
      throw new Error(`Rule with id "${id}" already exists`);
    }

    const normalized = this._normalizeRule(rule);
    this._rules.set(normalized.id, normalized);
    this._rebuildPriorityOrder();
    return normalized;
  }

  /**
   * Remove a rule by id.
   * @param {string} id
   * @returns {boolean} true if removed
   */
  removeRule(id) {
    const existed = this._rules.delete(id);
    if (existed) {
      this._rebuildPriorityOrder();
    }
    return existed;
  }

  /**
   * Get a rule by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  getRule(id) {
    return this._rules.get(id);
  }

  /**
   * Enable or disable a rule.
   * @param {string} id
   * @param {boolean} enabled
   * @returns {boolean} true if the rule was found and updated
   */
  setRuleEnabled(id, enabled) {
    const rule = this._rules.get(id);
    if (!rule) return false;
    rule.enabled = Boolean(enabled);
    return true;
  }

  /**
   * Return all rules, sorted by priority (descending).
   * @returns {object[]}
   */
  listRules() {
    return this._priorityOrder.map((id) => this._rules.get(id));
  }

  /**
   * Count of registered rules.
   * @returns {number}
   */
  get count() {
    return this._rules.size;
  }

  // -- Evaluation --------------------------------------------------------------

  /**
   * Evaluate all enabled rules against an event and context.
   *
   * Returns results sorted by priority (highest first). Each result
   * includes the matching rule, whether it matched, and the
   * reason/action details.
   *
   * @param {object} event — { type, severity, source, ... }
   * @param {object} [context={}] — Additional evaluation context
   * @returns {object[]} Array of { rule, matched, reason, action }
   */
  evaluate(event, context = {}) {
    if (!event || typeof event !== "object") {
      throw new Error("Event must be a non-null object");
    }

    const results = [];

    for (const id of this._priorityOrder) {
      const rule = this._rules.get(id);
      if (!rule || !rule.enabled) continue;

      const matchResult = this._evaluateCondition(rule.condition, event, context);

      results.push({
        rule,
        matched: matchResult.matched,
        reason: matchResult.reason,
        action: matchResult.matched ? rule.action : null,
      });

      this._logEvaluation(rule.id, event, matchResult.matched, matchResult.reason);
    }

    return results;
  }

  /**
   * Get rules that match an event (without full evaluation detail).
   *
   * @param {object} event — { type, severity, source, ... }
   * @param {object} [context={}]
   * @returns {object[]} Array of matching rule objects
   */
  getMatchingRules(event, context = {}) {
    return this.evaluate(event, context)
      .filter((r) => r.matched)
      .map((r) => r.rule);
  }

  /**
   * Extract actions from a rule result or rule object.
   *
   * @param {object} rule — A rule object or evaluation result
   * @returns {object[]} Array of action objects { type, params }
   */
  getActions(ruleOrResult) {
    const rule = ruleOrResult && ruleOrResult.rule
      ? ruleOrResult.rule
      : ruleOrResult;

    if (!rule || !rule.action) return [];

    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];

    return actions.map((a) => ({
      type: a.type,
      params: a.params || {},
    }));
  }

  /**
   * Compute the effective action for an event by merging all matching
   * rule actions in priority order.
   *
   * Suppress rules (if matched) take precedence and short-circuit.
   *
   * @param {object} event
   * @param {object} [context={}]
   * @returns {object} { matched: boolean, actions: object[], suppressed: boolean }
   */
  resolve(event, context = {}) {
    const results = this.evaluate(event, context);
    const matched = results.filter((r) => r.matched);

    if (matched.length === 0) {
      return { matched: false, actions: [], suppressed: false };
    }

    // Check if any matching rule suppresses the notification
    const suppressors = matched.filter((r) => r.action.type === "suppress");
    if (suppressors.length > 0) {
      return {
        matched: true,
        actions: suppressors.map((r) => ({
          type: r.action.type,
          params: r.action.params || {},
        })),
        suppressed: true,
        suppressedBy: suppressors.map((r) => r.rule.id),
      };
    }

    // Collect actions from all non-suppress matching rules
    const actions = [];
    for (const m of matched) {
      const ruleActions = this.getActions(m);
      for (const a of ruleActions) {
        if (a.type !== "suppress") {
          actions.push(a);
        }
      }
    }

    return { matched: true, actions, suppressed: false };
  }

  // -- Evaluation log ----------------------------------------------------------

  /**
   * Get recent evaluation log entries.
   * @param {number} [limit]
   * @returns {object[]}
   */
  getLog(limit) {
    if (limit !== undefined) {
      return this._evaluationLog.slice(-limit);
    }
    return [...this._evaluationLog];
  }

  /**
   * Clear the evaluation log.
   */
  clearLog() {
    this._evaluationLog.length = 0;
  }

  // -- Filters / query methods -------------------------------------------------

  /**
   * Get rules by action type.
   * @param {string} actionType — "notify", "escalate", "suppress", "aggregate", "route"
   * @returns {object[]}
   */
  getRulesByActionType(actionType) {
    return this.listRules().filter((r) => {
      const actions = Array.isArray(r.action) ? r.action : [r.action];
      return actions.some((a) => a.type === actionType);
    });
  }

  /**
   * Get rules that would apply to a specific event type.
   * @param {string} eventType
   * @returns {object[]}
   */
  getRulesByEventType(eventType) {
    return this.listRules().filter((r) => {
      return doesEventTypeMatch(r.condition, eventType);
    });
  }

  // -- Internal helpers --------------------------------------------------------

  /** @private */
  _normalizeRule(rule) {
    const id = rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const priority = safeInt(rule.priority, 0);
    const enabled = rule.enabled !== false;

    let action;
    if (rule.action) {
      if (Array.isArray(rule.action)) {
        action = rule.action.map(normalizeAction);
      } else {
        action = normalizeAction(rule.action);
      }
    } else {
      action = { type: "notify", params: {} };
    }

    return {
      id,
      priority,
      enabled,
      condition: rule.condition || {},
      action,
      description: rule.description || "",
      meta: rule.meta || {},
    };
  }

  /** @private */
  _evaluateCondition(condition, event, context) {
    // If condition is a function, call it directly
    if (typeof condition === "function") {
      try {
        const result = condition(event, context);
        return {
          matched: Boolean(result),
          reason: result === true ? "Condition function returned true" : "Condition function returned false",
        };
      } catch (err) {
        return { matched: false, reason: `Condition function threw: ${err.message}` };
      }
    }

    // Otherwise, evaluate each field
    const checks = [];

    // -- eventType --
    if (condition.eventType !== undefined) {
      const match = doesEventTypeMatch(condition, event.type);
      checks.push({
        field: "eventType",
        matched: match,
        reason: match
          ? `Event type "${event.type}" matches rule eventType`
          : `Event type "${event.type}" does not match rule eventType`,
      });
    }

    // -- severity --
    if (condition.severity !== undefined) {
      const match = doesSeverityMatch(condition.severity, event.severity);
      checks.push({
        field: "severity",
        matched: match,
        reason: match
          ? `Severity "${event.severity}" matches rule severity`
          : `Severity "${event.severity}" does not match rule severity`,
      });
    }

    // -- source --
    if (condition.source !== undefined) {
      const eventSource = event.source || context.source;
      const match = doesListMatch(condition.source, eventSource);
      checks.push({
        field: "source",
        matched: match,
        reason: match
          ? `Source "${eventSource}" matches rule source`
          : `Source "${eventSource}" does not match rule source`,
      });
    }

    // -- frequency (rate-limiting) --
    if (condition.frequency !== undefined) {
      const match = checkFrequency(condition.frequency, event, context);
      checks.push({
        field: "frequency",
        matched: match.passed,
        reason: match.reason,
      });
    }

    // -- timeWindow --
    if (condition.timeWindow !== undefined) {
      const match = checkTimeWindow(condition.timeWindow);
      checks.push({
        field: "timeWindow",
        matched: match.passed,
        reason: match.reason,
      });
    }

    // All checks must pass (AND logic)
    const allMatched = checks.length === 0 || checks.every((c) => c.matched);
    const reason = checks.length === 0
      ? "No condition fields to evaluate"
      : checks
          .filter((c) => !c.matched)
          .map((c) => c.reason)
          .join("; ") || "All condition fields matched";

    return { matched: allMatched, reason };
  }

  /** @private */
  _rebuildPriorityOrder() {
    const entries = Array.from(this._rules.values());
    entries.sort((a, b) => b.priority - a.priority);
    this._priorityOrder = entries.map((r) => r.id);
  }

  /** @private */
  _logEvaluation(ruleId, event, matched, reason) {
    this._evaluationLog.push({
      ruleId,
      eventType: event.type || "unknown",
      timestamp: Date.now(),
      matched,
      reason,
    });
    if (this._evaluationLog.length > this._maxLogSize) {
      this._evaluationLog = this._evaluationLog.slice(-this._maxLogSize);
    }
  }
}

// ---- Condition checkers (pure functions) -------------------------------------

/**
 * Check if an event type matches the condition's eventType field.
 */
function doesEventTypeMatch(condition, eventType) {
  if (condition.eventType === undefined) return true;
  if (typeof condition.eventType === "function") {
    return Boolean(condition.eventType(eventType));
  }
  const allowed = Array.isArray(condition.eventType)
    ? condition.eventType
    : [condition.eventType];
  return allowed.some((t) => {
    if (t === "*") return true;
    if (t instanceof RegExp) return t.test(String(eventType));
    return String(t) === String(eventType);
  });
}

/**
 * Check if a severity matches the condition's severity field.
 *
 * Accepts:
 * - string: exact match
 * - string[]: any match
 * - { min: string }: severity rank >= min rank
 * - { max: string }: severity rank <= max rank
 * - { exact: string|string[] }: exact list
 * - { rank: number }: exact rank match
 */
function doesSeverityMatch(conditionSeverity, eventSeverity) {
  if (conditionSeverity === undefined) return true;
  if (eventSeverity === undefined || eventSeverity === null) return false;

  const evtRank = SEVERITY_RANKS[String(eventSeverity).toLowerCase()] ?? 0;

  // String or array — exact match
  if (typeof conditionSeverity === "string") {
    return String(eventSeverity).toLowerCase() === conditionSeverity.toLowerCase();
  }
  if (Array.isArray(conditionSeverity)) {
    return conditionSeverity.some(
      (s) => String(eventSeverity).toLowerCase() === String(s).toLowerCase()
    );
  }

  // Object spec
  if (typeof conditionSeverity === "object") {
    let passed = true;

    if (conditionSeverity.min !== undefined) {
      const minRank = resolveSeverityRank(conditionSeverity.min);
      if (evtRank < minRank) passed = false;
    }
    if (conditionSeverity.max !== undefined) {
      const maxRank = resolveSeverityRank(conditionSeverity.max);
      if (evtRank > maxRank) passed = false;
    }
    if (conditionSeverity.exact !== undefined) {
      const exactList = Array.isArray(conditionSeverity.exact)
        ? conditionSeverity.exact
        : [conditionSeverity.exact];
      passed = exactList.some(
        (s) => String(eventSeverity).toLowerCase() === String(s).toLowerCase()
      );
    }
    if (conditionSeverity.rank !== undefined) {
      const expectedRank = resolveSeverityRank(conditionSeverity.rank);
      passed = evtRank === expectedRank;
    }

    return passed;
  }

  return false;
}

/**
 * Check if a value matches a list spec (string, string[], or "*").
 */
function doesListMatch(spec, value) {
  if (spec === undefined || spec === null) return true;
  if (value === undefined || value === null) return false;

  if (spec === "*") return true;
  if (typeof spec === "function") return Boolean(spec(value));
  if (spec instanceof RegExp) return spec.test(String(value));

  const allowed = Array.isArray(spec) ? spec : [spec];
  return allowed.some((s) => {
    if (s instanceof RegExp) return s.test(String(value));
    return String(s) === String(value);
  });
}

/**
 * Check frequency / rate-limiting condition.
 *
 * Accepts:
 * - number: max occurrences total (uses context._history)
 * - { max: number, windowMs: number }: max in a sliding window
 * - { min: number, windowMs: number }: at least N in window
 */
function checkFrequency(freqSpec, event, context) {
  const history = Array.isArray(context._history)
    ? context._history
    : [];

  const now = Date.now();

  // Simple max count
  if (typeof freqSpec === "number") {
    const count = history.filter(
      (h) => h.type === event.type
    ).length;
    if (count >= freqSpec) {
      return {
        passed: false,
        reason: `Frequency limit reached: ${count}/${freqSpec} events of type "${event.type}"`,
      };
    }
    return {
      passed: true,
      reason: `Frequency within limit: ${count}/${freqSpec}`,
    };
  }

  // Object spec
  if (typeof freqSpec === "object") {
    const windowMs = freqSpec.windowMs || 60000;

    if (freqSpec.max !== undefined) {
      const cutoff = now - windowMs;
      const count = history.filter(
        (h) => h.type === event.type && h.timestamp >= cutoff
      ).length;
      if (count >= freqSpec.max) {
        return {
          passed: false,
          reason: `Rate limit reached: ${count}/${freqSpec.max} in last ${windowMs}ms for "${event.type}"`,
        };
      }
      return {
        passed: true,
        reason: `Rate limit OK: ${count}/${freqSpec.max} in last ${windowMs}ms`,
      };
    }

    if (freqSpec.min !== undefined) {
      const cutoff = now - windowMs;
      const count = history.filter(
        (h) => h.type === event.type && h.timestamp >= cutoff
      ).length;
      if (count < freqSpec.min) {
        return {
          passed: false,
          reason: `Minimum frequency not met: ${count}/${freqSpec.min} in last ${windowMs}ms for "${event.type}"`,
        };
      }
      return {
        passed: true,
        reason: `Minimum frequency met: ${count}/${freqSpec.min} in last ${windowMs}ms`,
      };
    }
  }

  return { passed: true, reason: "No frequency limits configured" };
}

/**
 * Check time window condition.
 *
 * Accepts:
 * - { start: number, end: number }: epoch millisecond range
 * - { days: string[] }: allowed days of week
 * - { hours: [number, number] }: allowed hour range [start, end) in 24h
 * - { after: number, before: number }: epoch ms bounds
 * - { excludeHours: [number, number] }: exclude hour range
 */
function checkTimeWindow(spec) {
  const now = new Date();

  if (typeof spec === "object") {
    // Epoch range
    if (spec.start !== undefined && spec.end !== undefined) {
      const ts = now.getTime();
      if (ts < spec.start || ts > spec.end) {
        return {
          passed: false,
          reason: `Current time ${ts} is outside window [${spec.start}, ${spec.end}]`,
        };
      }
      return { passed: true, reason: `Current time is within window` };
    }

    // after / before (either or both)
    if (spec.after !== undefined) {
      if (now.getTime() < spec.after) {
        return {
          passed: false,
          reason: `Current time is before allowed start ${new Date(spec.after).toISOString()}`,
        };
      }
    }
    if (spec.before !== undefined) {
      if (now.getTime() > spec.before) {
        return {
          passed: false,
          reason: `Current time is after allowed end ${new Date(spec.before).toISOString()}`,
        };
      }
    }

    // Days of week
    if (spec.days !== undefined && Array.isArray(spec.days)) {
      const currentDay = now.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      const allowedDays = spec.days.map((d) => String(d).toLowerCase());

      if (!allowedDays.includes(currentDay)) {
        return {
          passed: false,
          reason: `Today (${currentDay}) is not in allowed days: [${allowedDays.join(", ")}]`,
        };
      }
    }

    // Hours range [start, end)
    if (spec.hours !== undefined && Array.isArray(spec.hours) && spec.hours.length >= 2) {
      const hour = now.getHours();
      const [startH, endH] = spec.hours;

      if (startH <= endH) {
        if (hour < startH || hour >= endH) {
          return {
            passed: false,
            reason: `Current hour ${hour} is outside allowed range [${startH}, ${endH})`,
          };
        }
      } else {
        // Wrapping range, e.g., [22, 6) for overnight
        if (hour < startH && hour >= endH) {
          return {
            passed: false,
            reason: `Current hour ${hour} is outside allowed range [${startH}, ${endH})`,
          };
        }
      }
    }

    // Exclude hours
    if (spec.excludeHours !== undefined && Array.isArray(spec.excludeHours) && spec.excludeHours.length >= 2) {
      const hour = now.getHours();
      const [exStart, exEnd] = spec.excludeHours;
      const inExclusion = exStart <= exEnd
        ? hour >= exStart && hour < exEnd
        : hour >= exStart || hour < exEnd;

      if (inExclusion) {
        return {
          passed: false,
          reason: `Current hour ${hour} is in exclusion range [${exStart}, ${exEnd})`,
        };
      }
    }

    return { passed: true, reason: "Time window check passed" };
  }

  return { passed: true, reason: "No time window condition configured" };
}

// ---- Helpers ---------------------------------------------------------------

function normalizeAction(action) {
  const type = String(action.type || "notify").toLowerCase();
  if (!ACTION_TYPES.has(type)) {
    throw new Error(`Unknown action type: "${type}". Must be one of: ${[...ACTION_TYPES].join(", ")}`);
  }
  return {
    type,
    params: action.params || {},
  };
}

function severityRank(severity) {
  return SEVERITY_RANKS[String(severity || "info").toLowerCase()] ?? 0;
}

function resolveSeverityRank(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : 0;
  }
  return severityRank(value);
}

function safeInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

// ---- Exports ---------------------------------------------------------------

module.exports = {
  NotificationRules,
  ACTION_TYPES,
  SEVERITY_RANKS,
  // Condition checkers exported for testing
  doesEventTypeMatch,
  doesSeverityMatch,
  doesListMatch,
  checkFrequency,
  checkTimeWindow,
  resolveSeverityRank,
  severityRank,
};
