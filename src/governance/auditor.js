/**
 * PolicyAuditor — Audits agent sessions for policy compliance, identifies
 * violations, computes compliance scores, and generates comprehensive
 * audit reports with actionable recommendations.
 *
 * Violation severity levels (in descending order):
 *   CRITICAL — blocked action was executed; security bypass
 *   MAJOR    — action executed without required approval
 *   MINOR    — action executed but logged-only (no explicit allow)
 *   ADVISORY — policy gap or improvement suggestion
 */
"use strict";

const { RULE_TYPE, ACTION_SEVERITY } = require("./policy-engine");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIOLATION_SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  MAJOR: "MAJOR",
  MINOR: "MINOR",
  ADVISORY: "ADVISORY",
});

const SEVERITY_WEIGHTS = Object.freeze({
  CRITICAL: 25,
  MAJOR: 15,
  MINOR: 5,
  ADVISORY: 1,
});

const SCORE_CATEGORIES = Object.freeze({
  POLICY_ADHERENCE: "policy_adherence",
  APPROVAL_COMPLIANCE: "approval_compliance",
  ACTION_SAFETY: "action_safety",
  COVERAGE: "coverage",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify the severity of a violation based on the evaluation result and
 * whether the action was actually executed.
 *
 * @param {object} evalResult  - result from InteractionPolicy.evaluate()
 * @param {boolean} executed   - whether the action was actually performed
 * @returns {string} one of VIOLATION_SEVERITY values
 */
function classifyViolation(evalResult, executed) {
  if (!executed) return null; // no violation if action wasn't performed

  switch (evalResult.decision) {
    case "DENY":
      return VIOLATION_SEVERITY.CRITICAL; // action ran despite explicit deny
    case "REQUIRE_APPROVAL":
      return VIOLATION_SEVERITY.MAJOR; // action ran without approval
    case "DEFAULT_DENY":
      return VIOLATION_SEVERITY.MINOR; // action ran without any allow rule
    case "LOG_ONLY":
      return VIOLATION_SEVERITY.MINOR; // action ran with log-only coverage
    default:
      return null;
  }
}

/**
 * Validate session structure.
 * @param {object} session
 */
function validateSession(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Session must be a non-null object.");
  }
  if (!Array.isArray(session.actions)) {
    throw new Error("Session must have an 'actions' array.");
  }
}

// ---------------------------------------------------------------------------
// PolicyAuditor
// ---------------------------------------------------------------------------

class PolicyAuditor {
  /**
   * @param {object} [options]
   * @param {object} [options.policy] - InteractionPolicy instance to audit against
   * @param {number} [options.criticalThreshold] - max CRITICAL violations before score is 0 (default: 1)
   * @param {number} [options.majorThreshold]    - max MAJOR violations before severe penalty (default: 5)
   */
  constructor(options = {}) {
    /** @type {import('./policy-engine').InteractionPolicy|null} */
    this._policy = options.policy || null;
    /** @type {number} */
    this._criticalThreshold = Number.isSafeInteger(options.criticalThreshold) && options.criticalThreshold >= 0
      ? options.criticalThreshold
      : 1;
    /** @type {number} */
    this._majorThreshold = Number.isSafeInteger(options.majorThreshold) && options.majorThreshold >= 0
      ? options.majorThreshold
      : 5;
    /** @type {object|null} last audit result */
    this._lastAudit = null;
    /** @type {object[]} accumulated violations */
    this._violations = [];
    /** @type {object|null} cached audit report */
    this._report = null;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Set the policy to audit against.
   * @param {import('./policy-engine').InteractionPolicy} policy
   */
  setPolicy(policy) {
    this._policy = policy;
  }

  /**
   * Audit a session for policy compliance.
   *
   * Expected session shape:
   *   {
   *     id: string,
   *     agentId: string,
   *     actions: Array<{
   *       type: string,       // one of ACTION_TYPE
   *       target: string,     // target agent ID or resource path
   *       executed: boolean,  // whether the action was actually performed
   *       context: object,    // optional context
   *       timestamp: string   // ISO timestamp
   *     }>,
   *     metadata: object      // optional metadata
   *   }
   *
   * @param {object} session
   * @returns {{
   *   sessionId: string,
   *   agentId: string,
   *   totalActions: number,
   *   violations: object[],
   *   complianceScore: number,
   *   categoryScores: object,
   *   timestamp: string
   * }}
   */
  audit(session) {
    validateSession(session);

    this._violations = [];
    this._report = null;

    const sessionId = session.id || "unknown";
    const agentId = session.agentId || "unknown";
    const actions = session.actions || [];
    const totalActions = actions.length;

    let deniedButExecuted = 0;
    let unapprovedExecutions = 0;
    let unallowedExecutions = 0;
    let loggedOnlyExecutions = 0;
    let fullyAllowed = 0;
    let evaluatedCount = 0;

    for (const action of actions) {
      const actionType = action.type;
      const target = action.target;
      const executed = action.executed === true;
      const context = action.context;

      let evalResult;

      if (this._policy) {
        evalResult = this._policy.evaluate(agentId, actionType, target, context);
      } else {
        // No policy configured — treat all as allowed
        evalResult = {
          allowed: true,
          requiresApproval: false,
          decision: "DEFAULT_ALLOW",
          reason: "No policy configured; action implicitly allowed.",
          matchingRules: [],
          logOnlyRules: [],
        };
      }

      evaluatedCount++;

      if (executed) {
        const severity = classifyViolation(evalResult, executed);

        if (severity) {
          const violation = {
            actionType,
            target: target || "(none)",
            decision: evalResult.decision,
            severity,
            reason: evalResult.reason,
            actionTimestamp: action.timestamp || null,
            executed: true,
          };

          this._violations.push(violation);

          switch (severity) {
            case VIOLATION_SEVERITY.CRITICAL:
              deniedButExecuted++;
              break;
            case VIOLATION_SEVERITY.MAJOR:
              unapprovedExecutions++;
              break;
            case VIOLATION_SEVERITY.MINOR:
              if (evalResult.decision === "DEFAULT_DENY") unallowedExecutions++;
              else loggedOnlyExecutions++;
              break;
          }
        } else {
          fullyAllowed++;
        }
      }
    }

    // Calculate category scores
    const categoryScores = this._calculateCategoryScores(
      totalActions,
      deniedButExecuted,
      unapprovedExecutions,
      unallowedExecutions,
      loggedOnlyExecutions,
      evaluatedCount
    );

    const complianceScore = this._calculateOverallScore(categoryScores);

    const result = {
      sessionId,
      agentId,
      totalActions,
      violations: [...this._violations],
      complianceScore,
      categoryScores,
      timestamp: new Date().toISOString(),
    };

    this._lastAudit = result;
    return result;
  }

  /**
   * Get all violations found in the last audit.
   * @returns {object[]}
   */
  getViolations() {
    return [...this._violations];
  }

  /**
   * Get violations filtered by severity.
   * @param {string} severity - one of VIOLATION_SEVERITY
   * @returns {object[]}
   */
  getViolationsBySeverity(severity) {
    return this._violations.filter((v) => v.severity === severity);
  }

  /**
   * Get the overall compliance score (0-100) from the last audit.
   * @returns {number}
   */
  getComplianceScore() {
    if (!this._lastAudit) return 0;
    return this._lastAudit.complianceScore;
  }

  /**
   * Get category-level scores from the last audit.
   * @returns {object}
   */
  getCategoryScores() {
    if (!this._lastAudit) return {};
    return { ...this._lastAudit.categoryScores };
  }

  /**
   * Suggest policy improvements based on the violations found.
   *
   * @returns {{
   *   total: number,
   *   suggestions: Array<{ priority: string, message: string, affectedAgents: string[], affectedActions: string[] }>
   * }}
   */
  suggestPolicyImprovements() {
    const suggestions = [];
    const seenActions = new Set();
    const seenDenyActions = new Set();
    const seenUnapprovedActions = new Set();

    for (const violation of this._violations) {
      const key = `${violation.actionType}:${violation.target}`;

      if (violation.severity === VIOLATION_SEVERITY.CRITICAL) {
        if (!seenDenyActions.has(key)) {
          seenDenyActions.add(key);
          suggestions.push({
            priority: "HIGH",
            message: `Add explicit ALLOW rule for action '${violation.actionType}' on target '${violation.target}' if this behavior is intended, or block the agent from executing this action.`,
            affectedAgents: [this._lastAudit?.agentId || "unknown"],
            affectedActions: [violation.actionType],
          });
        }
      } else if (violation.severity === VIOLATION_SEVERITY.MAJOR) {
        if (!seenUnapprovedActions.has(key)) {
          seenUnapprovedActions.add(key);
          suggestions.push({
            priority: "MEDIUM",
            message: `Action '${violation.actionType}' on target '${violation.target}' was executed without approval. Add an approval workflow or convert REQUIRE_APPROVAL to ALLOW if approval is not needed.`,
            affectedAgents: [this._lastAudit?.agentId || "unknown"],
            affectedActions: [violation.actionType],
          });
        }
      } else if (violation.severity === VIOLATION_SEVERITY.MINOR && violation.decision === "DEFAULT_DENY") {
        if (!seenActions.has(key)) {
          seenActions.add(key);
          suggestions.push({
            priority: "LOW",
            message: `No explicit rule covers action '${violation.actionType}' on target '${violation.target}'. Add an ALLOW or LOG_ONLY rule to make the policy explicit.`,
            affectedAgents: [this._lastAudit?.agentId || "unknown"],
            affectedActions: [violation.actionType],
          });
        }
      }
    }

    // Check for policy coverage gaps (no violations but potential improvements)
    if (this._policy && this._violations.length === 0 && this._lastAudit) {
      const policyRules = this._policy.getRules();
      if (policyRules.length === 0) {
        suggestions.push({
          priority: "HIGH",
          message: "No policy rules are defined. Define interaction rules to govern agent behavior.",
          affectedAgents: [this._lastAudit.agentId],
          affectedActions: [],
        });
      }
    }

    return {
      total: suggestions.length,
      suggestions,
    };
  }

  /**
   * Generate a comprehensive audit report.
   *
   * @param {object} [session] - optional session to audit before reporting
   * @returns {{
   *   summary: object,
   *   violations: object,
   *   complianceScore: number,
   *   categoryBreakdown: object,
   *   recommendations: object,
   *   metadata: object
   * }}
   */
  generateAuditReport(session) {
    if (session) {
      this.audit(session);
    }

    if (!this._lastAudit && this._violations.length === 0) {
      return {
        summary: {
          status: "NO_DATA",
          message: "No audit data available. Run audit(session) first.",
        },
        violations: { total: 0, bySeverity: {} },
        complianceScore: 0,
        categoryBreakdown: {},
        recommendations: { total: 0, suggestions: [] },
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    const lastAudit = this._lastAudit || {
      sessionId: "unknown",
      agentId: "unknown",
      totalActions: 0,
      complianceScore: 0,
      categoryScores: {},
    };

    const violationCounts = {
      [VIOLATION_SEVERITY.CRITICAL]: this.getViolationsBySeverity(VIOLATION_SEVERITY.CRITICAL).length,
      [VIOLATION_SEVERITY.MAJOR]: this.getViolationsBySeverity(VIOLATION_SEVERITY.MAJOR).length,
      [VIOLATION_SEVERITY.MINOR]: this.getViolationsBySeverity(VIOLATION_SEVERITY.MINOR).length,
      [VIOLATION_SEVERITY.ADVISORY]: this.getViolationsBySeverity(VIOLATION_SEVERITY.ADVISORY).length,
    };

    const improvements = this.suggestPolicyImprovements();

    // Determine overall status
    let status;
    if (lastAudit.complianceScore >= 90) status = "PASS";
    else if (lastAudit.complianceScore >= 70) status = "WARN";
    else if (lastAudit.complianceScore >= 40) status = "FAIL";
    else status = "CRITICAL_FAIL";

    const report = {
      summary: {
        status,
        sessionId: lastAudit.sessionId,
        agentId: lastAudit.agentId,
        totalActions: lastAudit.totalActions,
        totalViolations: this._violations.length,
        message: this._generateStatusMessage(status, lastAudit.complianceScore),
      },
      violations: {
        total: this._violations.length,
        bySeverity: violationCounts,
        details: this._violations.map((v) => ({
          severity: v.severity,
          action: v.actionType,
          target: v.target,
          decision: v.decision,
          reason: v.reason,
          timestamp: v.actionTimestamp,
        })),
      },
      complianceScore: lastAudit.complianceScore,
      categoryBreakdown: lastAudit.categoryScores || {},
      recommendations: improvements,
      metadata: {
        generatedAt: new Date().toISOString(),
        hasPolicy: this._policy !== null,
        ruleCount: this._policy ? this._policy.ruleCount : 0,
        criticalThreshold: this._criticalThreshold,
        majorThreshold: this._majorThreshold,
      },
    };

    this._report = report;
    return report;
  }

  /**
   * Return the last generated report.
   * @returns {object|null}
   */
  getLastReport() {
    return this._report;
  }

  /**
   * Reset all audit state.
   */
  reset() {
    this._violations = [];
    this._lastAudit = null;
    this._report = null;
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  /**
   * Calculate per-category compliance scores.
   *
   * Categories:
   *   policy_adherence  — are explicit denies being respected
   *   approval_compliance — are approval-required actions being approved
   *   action_safety     — overall safety based on action severity weights
   *   coverage          — how well do rules cover the actions observed
   *
   * @param {number} totalActions
   * @param {number} deniedButExecuted
   * @param {number} unapprovedExecutions
   * @param {number} unallowedExecutions
   * @param {number} loggedOnlyExecutions
   * @param {number} evaluatedCount
   * @returns {{ policy_adherence: number, approval_compliance: number, action_safety: number, coverage: number }}
   */
  _calculateCategoryScores(totalActions, deniedButExecuted, unapprovedExecutions, unallowedExecutions, loggedOnlyExecutions, evaluatedCount) {
    if (totalActions === 0) {
      return {
        [SCORE_CATEGORIES.POLICY_ADHERENCE]: 100,
        [SCORE_CATEGORIES.APPROVAL_COMPLIANCE]: 100,
        [SCORE_CATEGORIES.ACTION_SAFETY]: 100,
        [SCORE_CATEGORIES.COVERAGE]: 100,
      };
    }

    // Policy adherence: penalized by denied-but-executed (CRITICAL)
    const policyAdherence = Math.max(
      0,
      100 - (deniedButExecuted * SEVERITY_WEIGHTS.CRITICAL)
    );

    // Approval compliance: penalized by unapproved executions (MAJOR)
    const approvalCompliance = Math.max(
      0,
      100 - (unapprovedExecutions * SEVERITY_WEIGHTS.MAJOR)
    );

    // Action safety: based on severity weights of violations
    let totalDeduction = 0;
    for (const violation of this._violations) {
      totalDeduction += SEVERITY_WEIGHTS[violation.severity] || 0;
    }
    const actionSafety = Math.max(0, 100 - totalDeduction);

    // Coverage: how well are actions covered by explicit rules
    const uncovered = unallowedExecutions + loggedOnlyExecutions;
    const coverage = totalActions > 0
      ? Math.round(((totalActions - uncovered) / totalActions) * 100)
      : 100;

    return {
      [SCORE_CATEGORIES.POLICY_ADHERENCE]: policyAdherence,
      [SCORE_CATEGORIES.APPROVAL_COMPLIANCE]: approvalCompliance,
      [SCORE_CATEGORIES.ACTION_SAFETY]: actionSafety,
      [SCORE_CATEGORIES.COVERAGE]: coverage,
    };
  }

  /**
   * Calculate overall compliance score (weighted average of categories).
   * @param {object} categoryScores
   * @returns {number} 0-100
   */
  _calculateOverallScore(categoryScores) {
    const weights = {
      [SCORE_CATEGORIES.POLICY_ADHERENCE]: 35,
      [SCORE_CATEGORIES.APPROVAL_COMPLIANCE]: 25,
      [SCORE_CATEGORIES.ACTION_SAFETY]: 20,
      [SCORE_CATEGORIES.COVERAGE]: 20,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const [category, weight] of Object.entries(weights)) {
      totalWeight += weight;
      weightedSum += (categoryScores[category] || 0) * weight;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
  }

  /**
   * Generate a human-readable status message.
   * @param {string} status
   * @param {number} score
   * @returns {string}
   */
  _generateStatusMessage(status, score) {
    switch (status) {
      case "PASS":
        return `Audit passed with a compliance score of ${score}/100. No significant violations detected.`;
      case "WARN":
        return `Audit completed with warnings. Compliance score: ${score}/100. Review violations and recommended improvements.`;
      case "FAIL":
        return `Audit failed. Compliance score: ${score}/100. Significant violations detected. Immediate action recommended.`;
      case "CRITICAL_FAIL":
        return `Audit failed critically. Compliance score: ${score}/100. Security-critical violations detected. Immediate remediation required.`;
      default:
        return `Audit result unknown. Compliance score: ${score}/100.`;
    }
  }
}

module.exports = {
  PolicyAuditor,
  VIOLATION_SEVERITY,
  SEVERITY_WEIGHTS,
  SCORE_CATEGORIES,
  classifyViolation,
};
