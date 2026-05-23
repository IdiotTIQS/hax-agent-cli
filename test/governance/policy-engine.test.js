/**
 * InteractionPolicy engine tests.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InteractionPolicy,
  RULE_TYPE,
  ACTION_TYPE,
} = require("../../src/governance/policy-engine");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultPolicy() {
  const policy = new InteractionPolicy({ name: "test-policy" });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["agent-1", "agent-2"],
    actions: [ACTION_TYPE.CALL_TOOL, ACTION_TYPE.READ_FILE],
    targets: "*",
    description: "Allow tool calls and file reads for agent-1 and agent-2",
  });
  policy.addRule({
    type: RULE_TYPE.DENY,
    agents: ["agent-3"],
    actions: "*",
    targets: "*",
    description: "Deny all actions from agent-3",
  });
  return policy;
}

// ---------------------------------------------------------------------------
// addRule
// ---------------------------------------------------------------------------

test("addRule: stores rule and increments ruleCount", () => {
  const policy = new InteractionPolicy();
  assert.equal(policy.ruleCount, 0);

  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: "*",
    actions: [ACTION_TYPE.CALL_TOOL],
    targets: "*",
  });
  assert.equal(policy.ruleCount, 1);

  const rules = policy.getRules();
  assert.equal(rules[0].type, RULE_TYPE.ALLOW);
  assert.equal(rules[0].agents, "*");
});

test("addRule: throws for invalid rule type", () => {
  const policy = new InteractionPolicy();
  assert.throws(
    () => policy.addRule({ type: "INVALID", agents: "*", actions: "*" }),
    { message: /Rule type must be one of/ }
  );
});

test("addRule: throws for null rule", () => {
  const policy = new InteractionPolicy();
  assert.throws(
    () => policy.addRule(null),
    { message: /Rule must be a non-null object/ }
  );
});

test("addRules: adds multiple rules at once", () => {
  const policy = new InteractionPolicy();
  policy.addRules([
    { type: RULE_TYPE.ALLOW, agents: "*", actions: [ACTION_TYPE.CALL_TOOL], targets: "*" },
    { type: RULE_TYPE.DENY, agents: ["blocked-agent"], actions: "*", targets: "*" },
    { type: RULE_TYPE.LOG_ONLY, agents: ["supervisor"], actions: [ACTION_TYPE.SEND_MESSAGE], targets: "*" },
  ]);
  assert.equal(policy.ruleCount, 3);
});

// ---------------------------------------------------------------------------
// removeRule
// ---------------------------------------------------------------------------

test("removeRule: removes by index", () => {
  const policy = new InteractionPolicy();
  policy.addRule({ type: RULE_TYPE.ALLOW, agents: "*", actions: "*", targets: "*" });
  assert.equal(policy.ruleCount, 1);
  assert.equal(policy.removeRule(0), true);
  assert.equal(policy.ruleCount, 0);
});

test("removeRule: removes by reference", () => {
  const policy = new InteractionPolicy();
  const rule = { type: RULE_TYPE.ALLOW, agents: "*", actions: "*", targets: "*" };
  policy.addRule(rule);
  assert.equal(policy.removeRule(policy.getRules()[0]), true);
  assert.equal(policy.ruleCount, 0);
});

test("removeRule: returns false for invalid index", () => {
  const policy = new InteractionPolicy();
  assert.equal(policy.removeRule(99), false);
});

// ---------------------------------------------------------------------------
// evaluate — basic scenarios
// ---------------------------------------------------------------------------

test("evaluate: allows action when ALLOW rule matches", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "tool-x");
  assert.equal(result.allowed, true);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.requiresApproval, false);
});

test("evaluate: denies action when DENY rule matches", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate("agent-3", ACTION_TYPE.CALL_TOOL, "tool-x");
  assert.equal(result.allowed, false);
  assert.equal(result.decision, "DENY");
});

test("evaluate: DENY takes precedence over ALLOW", () => {
  const policy = new InteractionPolicy({ name: "conflict-test" });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["agent-1"],
    actions: "*",
    targets: "*",
    priority: 100,
  });
  policy.addRule({
    type: RULE_TYPE.DENY,
    agents: ["agent-1"],
    actions: [ACTION_TYPE.EXEC_SHELL],
    targets: "*",
    priority: 50, // lower priority, but DENY still wins by rule-type
  });

  const result = policy.evaluate("agent-1", ACTION_TYPE.EXEC_SHELL, "cmd.exe");
  assert.equal(result.allowed, false);
  assert.equal(result.decision, "DENY");
});

test("evaluate: safe-by-default denies unmatched actions", () => {
  const policy = new InteractionPolicy({ safeByDefault: true });
  // No rules added

  const result = policy.evaluate("agent-x", ACTION_TYPE.CALL_TOOL, "tool-y");
  assert.equal(result.allowed, false);
  assert.equal(result.decision, "DEFAULT_DENY");
  assert.ok(result.reason.includes("safe-by-default"));
});

test("evaluate: non-safe-by-default allows unmatched actions", () => {
  const policy = new InteractionPolicy({ safeByDefault: false });
  // No rules added

  const result = policy.evaluate("agent-x", ACTION_TYPE.CALL_TOOL, "tool-y");
  assert.equal(result.allowed, true);
  assert.equal(result.decision, "DEFAULT_ALLOW");
});

test("evaluate: REQUIRE_APPROVAL blocks action but flags for review", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.REQUIRE_APPROVAL,
    agents: "*",
    actions: [ACTION_TYPE.WRITE_FILE],
    targets: "*",
    description: "File writes need human sign-off",
  });

  const result = policy.evaluate("agent-1", ACTION_TYPE.WRITE_FILE, "/etc/config");
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.decision, "REQUIRE_APPROVAL");
});

test("evaluate: LOG_ONLY does not block but records for audit", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.LOG_ONLY,
    agents: "*",
    actions: [ACTION_TYPE.SEND_MESSAGE],
    targets: "*",
    description: "Log all messages",
  });

  const result = policy.evaluate("agent-1", ACTION_TYPE.SEND_MESSAGE, "agent-2");
  // safeByDefault=true, so LOG_ONLY only → DEFAULT_DENY
  assert.equal(result.decision, "DEFAULT_DENY");
  assert.equal(result.logOnlyRules.length, 1);
});

// ---------------------------------------------------------------------------
// evaluate — conditions
// ---------------------------------------------------------------------------

test("evaluate: respects condition functions", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: "*",
    actions: [ACTION_TYPE.CALL_TOOL],
    targets: "*",
    conditions: [
      (_agent, _action, target, _ctx) => target === "allowed-tool",
    ],
  });

  const allowed = policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "allowed-tool");
  assert.equal(allowed.allowed, true);

  const denied = policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "blocked-tool");
  assert.equal(denied.allowed, false); // safeByDefault=true → DENY
});

// ---------------------------------------------------------------------------
// evaluate — priority ordering
// ---------------------------------------------------------------------------

test("evaluate: higher priority rule wins among same type", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["agent-1"],
    actions: "*",
    targets: "*",
    priority: 10,
    description: "low-priority allow",
  });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["agent-1"],
    actions: "*",
    targets: "*",
    priority: 100,
    description: "high-priority allow",
  });

  const result = policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "tool-x");
  assert.equal(result.allowed, true);
  assert.ok(result.reason.includes("high-priority allow"));
});

// ---------------------------------------------------------------------------
// getApplicablePolicies
// ---------------------------------------------------------------------------

test("getApplicablePolicies: returns rules matching an agent", () => {
  const policy = createDefaultPolicy();
  const rules = policy.getApplicablePolicies("agent-1");
  // agent-1 has the ALLOW rule, and agent-3 has the DENY rule (but not for agent-1)
  // The ALLOW rule has agents: ["agent-1", "agent-2"], so it matches
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, RULE_TYPE.ALLOW);
});

test("getApplicablePolicies: returns empty for unmatched agent", () => {
  const policy = createDefaultPolicy();
  const rules = policy.getApplicablePolicies("agent-unknown");
  assert.equal(rules.length, 0);
});

test("getApplicablePolicies: wildcard matches all agents", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.LOG_ONLY,
    agents: "*",
    actions: "*",
    targets: "*",
  });

  assert.equal(policy.getApplicablePolicies("any-agent").length, 1);
  assert.equal(policy.getApplicablePolicies("another-agent").length, 1);
  assert.equal(policy.getApplicablePolicies("third-agent").length, 1);
});

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

test("explain: provides detailed reasoning for allow", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate("agent-1", ACTION_TYPE.READ_FILE, "/path/file.txt");
  const explanation = policy.explain(ACTION_TYPE.READ_FILE, result);

  assert.equal(explanation.decision, "ALLOW");
  assert.equal(explanation.allowed, true);
  assert.equal(explanation.severity, "LOW");
  assert.ok(explanation.applicableRules.length > 0);
  assert.ok(explanation.recommendation.includes("permitted"));
  assert.ok(explanation.summary.length > 0);
});

test("explain: provides detailed reasoning for deny", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate("agent-3", ACTION_TYPE.CALL_TOOL, "tool-x");
  const explanation = policy.explain(ACTION_TYPE.CALL_TOOL, result);

  assert.equal(explanation.decision, "DENY");
  assert.equal(explanation.allowed, false);
  assert.equal(explanation.severity, "HIGH");
  assert.ok(explanation.recommendation.includes("blocked"));
});

test("explain: handles empty decision gracefully", () => {
  const policy = new InteractionPolicy();
  const explanation = policy.explain("UNKNOWN", null);
  assert.equal(explanation.decision, "UNKNOWN");
  assert.equal(explanation.rulesConsidered, 0);
});

// ---------------------------------------------------------------------------
// getRulesByType
// ---------------------------------------------------------------------------

test("getRulesByType: filters rules by type", () => {
  const policy = new InteractionPolicy();
  policy.addRules([
    { type: RULE_TYPE.ALLOW, agents: "*", actions: "*", targets: "*" },
    { type: RULE_TYPE.ALLOW, agents: ["a"], actions: "*", targets: "*" },
    { type: RULE_TYPE.DENY, agents: ["b"], actions: "*", targets: "*" },
    { type: RULE_TYPE.LOG_ONLY, agents: ["c"], actions: "*", targets: "*" },
  ]);

  assert.equal(policy.getRulesByType(RULE_TYPE.ALLOW).length, 2);
  assert.equal(policy.getRulesByType(RULE_TYPE.DENY).length, 1);
  assert.equal(policy.getRulesByType(RULE_TYPE.LOG_ONLY).length, 1);
  assert.equal(policy.getRulesByType(RULE_TYPE.REQUIRE_APPROVAL).length, 0);
});

// ---------------------------------------------------------------------------
// audit trail
// ---------------------------------------------------------------------------

test("getAuditTrail: records evaluation history", () => {
  const policy = createDefaultPolicy();
  policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "tool-x");
  policy.evaluate("agent-3", ACTION_TYPE.CALL_TOOL, "tool-x");

  const trail = policy.getAuditTrail();
  assert.equal(trail.length, 2);
  assert.equal(trail[0].agent, "agent-1");
  assert.equal(trail[0].action, ACTION_TYPE.CALL_TOOL);
  assert.equal(trail[0].result.decision, "ALLOW");
  assert.equal(trail[1].result.decision, "DENY");
});

test("clearAuditTrail: resets audit history", () => {
  const policy = createDefaultPolicy();
  policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, "tool-x");
  assert.equal(policy.getAuditTrail().length, 1);
  policy.clearAuditTrail();
  assert.equal(policy.getAuditTrail().length, 0);
});

// ---------------------------------------------------------------------------
// agent identity resolution
// ---------------------------------------------------------------------------

test("evaluate: resolves agent from object with id", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate(
    { id: "agent-1", name: "Helper" },
    ACTION_TYPE.CALL_TOOL,
    "tool-x"
  );
  assert.equal(result.allowed, true);
});

test("evaluate: resolves agent from object with name", () => {
  const policy = createDefaultPolicy();
  const result = policy.evaluate(
    { name: "agent-1" },
    ACTION_TYPE.CALL_TOOL,
    "tool-x"
  );
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// safeByDefault property
// ---------------------------------------------------------------------------

test("safeByDefault: getter and setter work correctly", () => {
  const policy = new InteractionPolicy({ safeByDefault: true });
  assert.equal(policy.safeByDefault, true);
  policy.safeByDefault = false;
  assert.equal(policy.safeByDefault, false);
});

// ---------------------------------------------------------------------------
// name property
// ---------------------------------------------------------------------------

test("name: returns configured name", () => {
  const policy = new InteractionPolicy({ name: "production-policy" });
  assert.equal(policy.name, "production-policy");
});

test("name: defaults to 'default'", () => {
  const policy = new InteractionPolicy();
  assert.equal(policy.name, "default");
});

// ---------------------------------------------------------------------------
// clearRules
// ---------------------------------------------------------------------------

test("clearRules: removes all rules", () => {
  const policy = createDefaultPolicy();
  assert.ok(policy.ruleCount > 0);
  policy.clearRules();
  assert.equal(policy.ruleCount, 0);
});

// ---------------------------------------------------------------------------
// edge cases
// ---------------------------------------------------------------------------

test("evaluate: handles undefined target gracefully", () => {
  const policy = new InteractionPolicy({ safeByDefault: false });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: "*",
    actions: "*",
    targets: "*",
  });

  const result = policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL);
  assert.equal(result.allowed, true);
});

test("evaluate: respects agent array with wildcard", () => {
  const policy = new InteractionPolicy();
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: ["*", "agent-specific"],
    actions: "*",
    targets: "*",
  });

  // "agent-specific" inside array should be ignored since "*" already matches everything
  assert.equal(policy.evaluate("any-agent", ACTION_TYPE.CALL_TOOL, "target").allowed, true);
});

test("evaluate: target array matching works", () => {
  const policy = new InteractionPolicy({ safeByDefault: true });
  policy.addRule({
    type: RULE_TYPE.ALLOW,
    agents: "*",
    actions: "*",
    targets: ["/safe/path", "/another/path"],
  });

  assert.equal(
    policy.evaluate("agent-1", ACTION_TYPE.READ_FILE, "/safe/path").allowed,
    true
  );
  assert.equal(
    policy.evaluate("agent-1", ACTION_TYPE.READ_FILE, "/blocked/path").allowed,
    false
  );
});

// ---------------------------------------------------------------------------
// max audit trail
// ---------------------------------------------------------------------------

test("audit trail: respects maxAuditEntries limit", () => {
  const policy = new InteractionPolicy({ maxAuditEntries: 5, safeByDefault: false });
  for (let i = 0; i < 10; i++) {
    policy.evaluate("agent-1", ACTION_TYPE.CALL_TOOL, `tool-${i}`);
  }
  const trail = policy.getAuditTrail();
  assert.equal(trail.length, 5);
  // Most recent entries should be preserved
  assert.equal(trail[4].target, "tool-9");
});
