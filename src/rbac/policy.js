/**
 * PolicyEngine — ABAC-style policy evaluation with conflict resolution,
 * rule explanation, and policy-set merging.
 *
 * Rule shape:
 *   {
 *     effect:      'allow' | 'deny',
 *     subjects:    string[] | '*'             (optional — '*' matches all)
 *     actions:     string[] | '*'             (optional)
 *     resources:   string[] | '*'             (optional)
 *     conditions:  ((subject, action, resource, context) => boolean)[]  (optional)
 *     priority:    number                     (optional, higher = evaluated first)
 *     description: string                     (optional, human-readable)
 *   }
 *
 * Conflict resolution: explicit deny > explicit allow > implicit deny
 */
"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WILDCARD = "*";

/**
 * Test whether a candidate value matches a rule filter.
 * @param {string}   candidate
 * @param {string[]|'*'|undefined} filter
 */
function matchesFilter(candidate, filter) {
  if (!filter) return true;
  if (filter === WILDCARD) return true;
  if (Array.isArray(filter)) {
    return filter.includes(candidate) || filter.includes(WILDCARD);
  }
  return false;
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------
class PolicyEngine {
  constructor() {
    /** @type {object[]} */
    this._rules = [];
  }

  /**
   * Add an ABAC-style policy rule.
   * @param {object} rule
   * @param {'allow'|'deny'} rule.effect
   * @param {string[]|'*'}  [rule.subjects]
   * @param {string[]|'*'}  [rule.actions]
   * @param {string[]|'*'}  [rule.resources]
   * @param {Function[]}    [rule.conditions]
   * @param {number}        [rule.priority]
   * @param {string}        [rule.description]
   */
  addRule(rule) {
    if (!rule.effect || (rule.effect !== "allow" && rule.effect !== "deny")) {
      throw new Error('Rule effect must be "allow" or "deny".');
    }
    this._rules.push({
      effect: rule.effect,
      subjects: rule.subjects,
      actions: rule.actions,
      resources: rule.resources,
      conditions: rule.conditions || [],
      priority: typeof rule.priority === "number" ? rule.priority : 0,
      description: rule.description || null,
    });
  }

  /**
   * Evaluate all rules against a subject, action, resource, and optional context.
   *
   * Strategy:
   *   - Collect all applicable rules (subject match, action match, resource match,
   *     conditions satisfied).
   *   - Sort by priority (descending) and effect: 'deny' before 'allow' at same priority.
   *   - First applicable explicit deny  →  { allowed: false, reason }
   *   - First applicable explicit allow →  { allowed: true,  reason }
   *   - No applicable rule              →  { allowed: false, reason: "implicit_deny" }
   *
   * @param {string}  subject
   * @param {string}  action
   * @param {object}  [resource]   resource descriptor, e.g. { type, id, ... }
   * @param {object}  [context]    additional context, e.g. { time, ip, ... }
   * @returns {{ allowed: boolean, matchingRules: object[], reason: string }}
   */
  evaluate(subject, action, resource, context) {
    const applicable = this._getApplicable(subject, action, resource, context);

    // Sort: higher priority first; at same priority, denies before allows
    applicable.sort((a, b) => {
      const priDiff = (b.priority || 0) - (a.priority || 0);
      if (priDiff !== 0) return priDiff;
      if (a.effect === "deny" && b.effect === "allow") return -1;
      if (a.effect === "allow" && b.effect === "deny") return 1;
      return 0;
    });

    if (applicable.length === 0) {
      return {
        allowed: false,
        matchingRules: [],
        reason: `No policy rule matched (subject: "${subject}", action: "${action}"). Implicit deny.`,
      };
    }

    for (const rule of applicable) {
      if (rule.effect === "deny") {
        return {
          allowed: false,
          matchingRules: applicable,
          reason: rule.description
            ? `Explicit deny: ${rule.description}`
            : `Explicit deny rule matched for subject "${subject}", action "${action}".`,
        };
      }
    }

    // All applicable rules are 'allow'
    const firstAllow = applicable[0];
    return {
      allowed: true,
      matchingRules: applicable,
      reason: firstAllow.description
        ? `Explicit allow: ${firstAllow.description}`
        : `Explicit allow rule matched for subject "${subject}", action "${action}".`,
    };
  }

  /**
   * Filter and return rules that are potentially applicable to the given
   * subject/action pair (ignoring conditions).
   * @param {string} subject
   * @param {string} action
   * @returns {object[]}
   */
  getApplicableRules(subject, action) {
    return this._rules.filter((rule) => {
      if (!matchesFilter(subject, rule.subjects)) return false;
      if (!matchesFilter(action, rule.actions)) return false;
      return true;
    });
  }

  /**
   * Produce a detailed explanation of why a subject was allowed or denied
   * access to a particular action/resource.
   *
   * @param {string} subject
   * @param {string} action
   * @param {object} [resource]
   * @param {object} [context]
   * @returns {{ allowed: boolean, reason: string, ruleCount: number, trace: object[] }}
   */
  explain(subject, action, resource, context) {
    const allApplicable = this._getApplicable(subject, action, resource, context);
    const trace = allApplicable.map((rule) => ({
      effect: rule.effect,
      priority: rule.priority || 0,
      description: rule.description || "(no description)",
      conditionsSatisfied: true,
    }));

    // Also include rules that matched subject/action but failed conditions
    const subjectActionMatches = this._rules.filter((rule) => {
      if (!matchesFilter(subject, rule.subjects)) return false;
      if (!matchesFilter(action, rule.actions)) return false;
      if (allApplicable.includes(rule)) return false;
      return true;
    });

    for (const rule of subjectActionMatches) {
      trace.push({
        effect: rule.effect,
        priority: rule.priority || 0,
        description: rule.description || "(no description)",
        conditionsSatisfied: false,
      });
    }

    const result = this.evaluate(subject, action, resource, context);
    return {
      allowed: result.allowed,
      reason: result.reason,
      ruleCount: this._rules.length,
      applicableCount: allApplicable.length,
      trace,
    };
  }

  /**
   * Merge multiple policy sets into this engine.
   * Each policy set can be a PolicyEngine instance or an array of rule objects.
   *
   * @param {(PolicyEngine|object[])[]} policies
   */
  combinePolicies(policies) {
    for (const policy of policies) {
      if (policy instanceof PolicyEngine) {
        for (const rule of policy._rules) {
          this.addRule(rule);
        }
      } else if (Array.isArray(policy)) {
        for (const rule of policy) {
          this.addRule(rule);
        }
      } else {
        throw new Error(
          "combinePolicies expects an array of PolicyEngine instances or rule arrays."
        );
      }
    }
  }

  /**
   * Remove all rules from the engine.
   */
  clearRules() {
    this._rules = [];
  }

  /**
   * Return the total number of rules in this engine.
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

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Collect all rules that match subject, action, resource, AND conditions.
   * @param {string} subject
   * @param {string} action
   * @param {object} [resource]
   * @param {object} [context]
   * @returns {object[]}
   */
  _getApplicable(subject, action, resource, context) {
    return this._rules.filter((rule) => {
      if (!matchesFilter(subject, rule.subjects)) return false;
      if (!matchesFilter(action, rule.actions)) return false;
      if (!matchesFilter(resource?.type, rule.resources)) return false;

      // Evaluate conditions
      for (const cond of rule.conditions) {
        if (!cond(subject, action, resource, context)) return false;
      }
      return true;
    });
  }
}

module.exports = { PolicyEngine };
