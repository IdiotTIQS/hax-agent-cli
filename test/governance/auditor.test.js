/**
 * PolicyAuditor tests.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { InteractionPolicy, RULE_TYPE, ACTION_TYPE } = require("../../src/governance/policy-engine");
const {
  PolicyAuditor,
  VIOLATION_SEVERITY,
  classifyViolation,
} = require("../../src/governance/auditor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a session object with the given actions.
 */
function createSession(agentId, actions) {
  return {
    id: "session-1",
    agentId,
    actions,
    metadata: { startedAt: new Date().toISOString() },
  };
}

/**
 * Build a simple compliant session: all actions allowed by policy.
 */
function createCompliantSession() {
  return createSession("agent-1", [
    { type: ACTION_TYPE.CALL_TOOL, target: "tool-a", executed: true, timestamp: new Date().toISOString() },
    { type: ACTION_TYPE.READ_FILE, target: "/project/file.js", executed: true, timestamp: new Date().toISOString() },
  ]);
}

/**
 * Build a session with violations.
 */
function createViolatingSession() {
  return createSession("agent-3", [
    { type: ACTION_TYPE.CALL_TOOL, target: "tool-a", executed: true, timestamp: new Date().toISOString() },
    { type: ACTION_TYPE.EXEC_SHELL, target: "rm -rf /", executed: true, timestamp: new Date().toISOString() },
    { type: ACTION_TYPE.WRITE_FILE, target: "/etc/config", executed: true, timestamp: new Date().toISOString() },
  ]);
}

/**
 * Create a default policy for testing.
 */
function createTestPolicy() {
  const policy = new InteractionPolicy({ name: "audit-test-policy" });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["agent-1", "agent-2"],
    actions: [ACTION_TYPE.CALL_TOOL, ACTION_TYPE.READ_FILE],
    targets: "*",
    description: "Allow tool calls and reads for agent-1/2",
  });
  policy.addRule({
    type: RULE_TYPE.DENY,
    agents: ["agent-3"],
    actions: "*",
    targets: "*",
    description: "Deny all for agent-3",
  });
  policy.addRule({
    type: RULE_TYPE.REQUIRE_APPROVAL,
    agents: ["agent-2"],
    actions: [ACTION_TYPE.WRITE_FILE, ACTION_TYPE.EXEC_SHELL],
    targets: "*",
    description: "Require approval for dangerous ops",
  });
  return policy;
}

// ---------------------------------------------------------------------------
// classifyViolation
// ---------------------------------------------------------------------------

test("classifyViolation: returns CRITICAL for DENY with execution", () => {
  const result = {
    allowed: false,
    decision: "DENY",
  };
  assert.equal(classifyViolation(result, true), VIOLATION_SEVERITY.CRITICAL);
});

test("classifyViolation: returns MAJOR for REQUIRE_APPROVAL with execution", () => {
  const result = {
    allowed: false,
    decision: "REQUIRE_APPROVAL",
  };
  assert.equal(classifyViolation(result, true), VIOLATION_SEVERITY.MAJOR);
});

test("classifyViolation: returns MINOR for DEFAULT_DENY with execution", () => {
  const result = {
    allowed: false,
    decision: "DEFAULT_DENY",
  };
  assert.equal(classifyViolation(result, true), VIOLATION_SEVERITY.MINOR);
});

test("classifyViolation: returns null when not executed", () => {
  const result = {
    allowed: false,
    decision: "DENY",
  };
  assert.equal(classifyViolation(result, false), null);
});

test("classifyViolation: returns null for allowed execution", () => {
  const result = {
    allowed: true,
    decision: "ALLOW",
  };
  assert.equal(classifyViolation(result, true), null);
});

// ---------------------------------------------------------------------------
// audit — basic scenarios
// ---------------------------------------------------------------------------

test("audit: returns perfect score for compliant session", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createCompliantSession();
  const result = auditor.audit(session);

  assert.equal(result.sessionId, "session-1");
  assert.equal(result.agentId, "agent-1");
  assert.equal(result.totalActions, 2);
  assert.equal(result.violations.length, 0);
  assert.equal(result.complianceScore, 100);
});

test("audit: detects CRITICAL violations when denied actions execute", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createViolatingSession();
  const result = auditor.audit(session);

  assert.ok(result.violations.length > 0);
  const criticals = result.violations.filter((v) => v.severity === VIOLATION_SEVERITY.CRITICAL);
  assert.ok(criticals.length > 0, `Expected CRITICAL violations, got: ${result.violations.map((v) => v.severity)}`);
  assert.ok(result.complianceScore < 100);
});

test("audit: detects MAJOR violations for unapproved actions", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createSession("agent-2", [
    { type: ACTION_TYPE.WRITE_FILE, target: "/app/config.json", executed: true, timestamp: new Date().toISOString() },
  ]);
  const result = auditor.audit(session);

  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].severity, VIOLATION_SEVERITY.MAJOR);
  assert.equal(result.violations[0].decision, "REQUIRE_APPROVAL");
});

test("audit: scores 0 when no policy and no audit data exists", () => {
  const auditor = new PolicyAuditor();
  assert.equal(auditor.getComplianceScore(), 0);
});

// ---------------------------------------------------------------------------
// getViolations / getViolationsBySeverity
// ---------------------------------------------------------------------------

test("getViolations: returns violations from last audit", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createViolatingSession());

  const violations = auditor.getViolations();
  assert.ok(violations.length > 0);
});

test("getViolationsBySeverity: filters correctly", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createViolatingSession());

  const criticals = auditor.getViolationsBySeverity(VIOLATION_SEVERITY.CRITICAL);
  assert.ok(criticals.length > 0);
  assert.ok(criticals.every((v) => v.severity === VIOLATION_SEVERITY.CRITICAL));

  const majors = auditor.getViolationsBySeverity(VIOLATION_SEVERITY.MAJOR);
  assert.ok(majors.every((v) => v.severity === VIOLATION_SEVERITY.MAJOR));
});

// ---------------------------------------------------------------------------
// getComplianceScore / getCategoryScores
// ---------------------------------------------------------------------------

test("getComplianceScore: returns 100 for perfect audit", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createCompliantSession());
  assert.equal(auditor.getComplianceScore(), 100);
});

test("getComplianceScore: returns reduced score for violations", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createViolatingSession());
  const score = auditor.getComplianceScore();
  assert.ok(typeof score === "number");
  assert.ok(score >= 0 && score <= 100);
  assert.ok(score < 80, `Expected score below 80, got ${score}`);
});

test("getCategoryScores: returns all four categories", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createCompliantSession());
  const catScores = auditor.getCategoryScores();

  assert.ok(Object.prototype.hasOwnProperty.call(catScores, "policy_adherence"));
  assert.ok(Object.prototype.hasOwnProperty.call(catScores, "approval_compliance"));
  assert.ok(Object.prototype.hasOwnProperty.call(catScores, "action_safety"));
  assert.ok(Object.prototype.hasOwnProperty.call(catScores, "coverage"));
});

// ---------------------------------------------------------------------------
// suggestPolicyImprovements
// ---------------------------------------------------------------------------

test("suggestPolicyImprovements: returns suggestions for violations", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createViolatingSession());

  const improvements = auditor.suggestPolicyImprovements();
  assert.ok(improvements.total > 0);
  assert.ok(improvements.suggestions.length > 0);
  assert.ok(improvements.suggestions.some((s) => s.priority === "HIGH"));
});

test("suggestPolicyImprovements: suggests adding rules when none exist", () => {
  const policy = new InteractionPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createSession("agent-1", [
    { type: ACTION_TYPE.CALL_TOOL, target: "tool-a", executed: true, timestamp: new Date().toISOString() },
  ]));

  const improvements = auditor.suggestPolicyImprovements();
  assert.ok(improvements.total > 0);
  assert.ok(improvements.suggestions.some((s) => s.priority === "LOW"));
});

test("suggestPolicyImprovements: returns no suggestions for clean audit", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createCompliantSession());

  const improvements = auditor.suggestPolicyImprovements();
  assert.equal(improvements.total, 0);
});

// ---------------------------------------------------------------------------
// generateAuditReport
// ---------------------------------------------------------------------------

test("generateAuditReport: produces full report from audited session", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createCompliantSession();

  const report = auditor.generateAuditReport(session);

  assert.equal(report.summary.status, "PASS");
  assert.equal(report.complianceScore, 100);
  assert.equal(report.violations.total, 0);
  assert.equal(report.violations.bySeverity.CRITICAL, 0);
  assert.ok(report.metadata.hasPolicy);
  assert.ok(report.metadata.generatedAt);
  assert.ok(report.recommendations.suggestions.length >= 0);
});

test("generateAuditReport: reports CRITICAL_FAIL for severe violations", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createViolatingSession();

  const report = auditor.generateAuditReport(session);

  assert.equal(report.summary.status, "FAIL");
  assert.ok(report.complianceScore >= 40 && report.complianceScore < 70);
  assert.ok(report.violations.total > 0);
  assert.ok(report.violations.bySeverity.CRITICAL > 0);
});

test("generateAuditReport: returns NO_DATA when no audit performed", () => {
  const auditor = new PolicyAuditor();
  const report = auditor.generateAuditReport();

  assert.equal(report.summary.status, "NO_DATA");
  assert.equal(report.complianceScore, 0);
  assert.equal(report.violations.total, 0);
});

test("generateAuditReport: uses previous audit data when no session provided", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createCompliantSession());

  const report = auditor.generateAuditReport();
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.complianceScore, 100);
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

test("audit: throws for null session", () => {
  const auditor = new PolicyAuditor();
  assert.throws(
    () => auditor.audit(null),
    { message: /Session must be a non-null object/ }
  );
});

test("audit: throws for session without actions array", () => {
  const auditor = new PolicyAuditor();
  assert.throws(
    () => auditor.audit({ id: "bad-session" }),
    { message: /Session must have an 'actions' array/ }
  );
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

test("reset: clears all audit state", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createViolatingSession());

  assert.ok(auditor.getViolations().length > 0);

  auditor.reset();

  assert.equal(auditor.getViolations().length, 0);
  assert.equal(auditor.getComplianceScore(), 0);
  assert.equal(auditor.getLastReport(), null);
});

// ---------------------------------------------------------------------------
// getLastReport
// ---------------------------------------------------------------------------

test("getLastReport: returns report after generateAuditReport", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  auditor.audit(createCompliantSession());
  auditor.generateAuditReport();

  const report = auditor.getLastReport();
  assert.ok(report);
  assert.equal(report.complianceScore, 100);
});

// ---------------------------------------------------------------------------
// empty session
// ---------------------------------------------------------------------------

test("audit: handles empty session with zero actions", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createSession("agent-1", []);

  const result = auditor.audit(session);
  assert.equal(result.totalActions, 0);
  assert.equal(result.violations.length, 0);
  assert.equal(result.complianceScore, 100);
});

// ---------------------------------------------------------------------------
// action not executed
// ---------------------------------------------------------------------------

test("audit: does not flag violations for actions that were not executed", () => {
  const policy = createTestPolicy();
  const auditor = new PolicyAuditor({ policy });
  const session = createSession("agent-3", [
    { type: ACTION_TYPE.EXEC_SHELL, target: "dangerous-cmd", executed: false, timestamp: new Date().toISOString() },
  ]);

  const result = auditor.audit(session);
  assert.equal(result.violations.length, 0);
  assert.equal(result.complianceScore, 100);
});
