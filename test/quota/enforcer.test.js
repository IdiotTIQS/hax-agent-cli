/**
 * Tests for QuotaEnforcer.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  QuotaEnforcer,
  QuotaViolationError,
  ACTION,
} = require("../../src/quota/enforcer");
const { QuotaManager } = require("../../src/quota/manager");

// ---- construction & basic checks ----

test("QuotaEnforcer: initializes with defaults", () => {
  const enforcer = new QuotaEnforcer();
  assert.ok(enforcer.quotaManager instanceof QuotaManager);

  const stats = enforcer.getEnforcementStats();
  assert.equal(stats.totalChecks, 0);
  assert.equal(stats.totalBlocks, 0);
  assert.equal(stats.agentsTracked, 0);
});

test("QuotaEnforcer: accepts external QuotaManager", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 10, 60000);

  const enforcer = new QuotaEnforcer({ quotaManager: qm });
  const pre = enforcer.preCheck("agent-x", "api_calls", 5);
  assert.equal(pre.allowed, true);
});

// ---- preCheck ----

test("QuotaEnforcer: preCheck allows operations within quota", () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 50, 60000);

  const enforcer = new QuotaEnforcer({ quotaManager: qm });

  const pre = enforcer.preCheck("agent-1", "tool_executions", 10);
  assert.equal(pre.allowed, true);
  assert.equal(pre.remaining, 40);
  assert.equal(pre.limit, 50);
});

test("QuotaEnforcer: preCheck blocks when quota exceeded with BLOCK action", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 3, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.preCheck("agent-1", "api_calls", 3);
  const pre = enforcer.preCheck("agent-1", "api_calls", 1);

  assert.equal(pre.allowed, false);
  assert.equal(pre.action, ACTION.BLOCK);
  assert.ok(pre.reason.includes("Quota exceeded"));
  assert.equal(pre.remaining, 0);
});

test("QuotaEnforcer: preCheck warns when quota exceeded with WARN action", () => {
  const qm = new QuotaManager();
  qm.setQuota("tokens_in", 5, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.WARN,
  });

  enforcer.preCheck("agent-1", "tokens_in", 5);
  const pre = enforcer.preCheck("agent-1", "tokens_in", 3);

  assert.equal(pre.allowed, true);
  assert.equal(pre.action, ACTION.WARN);
});

test("QuotaEnforcer: preCheck throttles with THROTTLE action", () => {
  const qm = new QuotaManager();
  qm.setQuota("file_operations", 2, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.THROTTLE,
  });

  enforcer.preCheck("agent-1", "file_operations", 2);
  const pre = enforcer.preCheck("agent-1", "file_operations", 1);

  assert.equal(pre.allowed, true);
  assert.equal(pre.action, ACTION.THROTTLE);
  assert.ok(typeof pre.delayMs === "number");
});

test("QuotaEnforcer: preCheck allows zero amount", () => {
  const enforcer = new QuotaEnforcer();
  const pre = enforcer.preCheck("agent-1", "api_calls", 0);
  assert.equal(pre.allowed, true);
});

// ---- postCheck ----

test("QuotaEnforcer: postCheck detects overdraft when resources exhausted", () => {
  const qm = new QuotaManager();
  qm.setQuota("tokens_out", 5, 60000);

  const enforcer = new QuotaEnforcer({ quotaManager: qm });

  // Consume all quota first — no agentId so global usage is tracked
  const pre = enforcer.preCheck(null, "tokens_out", 5);
  assert.equal(pre.allowed, true);

  // Force usage beyond quota by manually consuming more
  qm._globalUsage.tokens_out.used = 10;

  const post = enforcer.postCheck(null, "tokens_out", 5);
  assert.equal(post.violation, true);
  assert.ok(post.reason.includes("overdraft"));
});

test("QuotaEnforcer: postCheck reports no violation when within quota", () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 100, 60000);

  const enforcer = new QuotaEnforcer({ quotaManager: qm });
  const post = enforcer.postCheck("agent-1", "tool_executions", 10);
  assert.equal(post.violation, false);
});

// ---- enforce ----

test("QuotaEnforcer: enforce wraps and executes operation with quota checks", async () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 10, 60000);

  const enforcer = new QuotaEnforcer({ quotaManager: qm });

  let called = false;
  const result = await enforcer.enforce("agent-1", async () => {
    called = true;
    return "operation-result";
  });

  assert.equal(called, true);
  assert.equal(result, "operation-result");

  // Verify quota was consumed
  const remaining = qm.checkQuota("tool_executions", "agent-1");
  assert.equal(remaining.used, 1);
});

test("QuotaEnforcer: enforce throws QuotaViolationError on block", async () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 1, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  // First call succeeds
  await enforcer.enforce("agent-1", async () => "ok", { resource: "api_calls" });

  // Second call should throw
  try {
    await enforcer.enforce("agent-1", async () => "should-not-run", { resource: "api_calls" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuotaViolationError);
    assert.equal(error.name, "QuotaViolationError");
    assert.equal(error.code, "QUOTA_VIOLATION");
    assert.equal(error.agentId, "agent-1");
    assert.equal(error.resource, "api_calls");
    assert.equal(error.amount, 1);
  }
});

test("QuotaEnforcer: enforce throws TypeError on invalid arguments", async () => {
  const enforcer = new QuotaEnforcer();

  // Empty agentId
  await assert.rejects(
    () => enforcer.enforce("", async () => {}),
    { message: /non-empty string/ }
  );

  // Non-function operation
  await assert.rejects(
    () => enforcer.enforce("agent-1", "not-a-function"),
    { message: /must be a function/ }
  );
});

// ---- violations ----

test("QuotaEnforcer: getViolations returns violation history", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 2, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.preCheck("agent-x", "api_calls", 2);
  enforcer.preCheck("agent-x", "api_calls", 1); // blocked
  enforcer.preCheck("agent-x", "api_calls", 1); // blocked again

  const violations = enforcer.getViolations("agent-x");
  assert.ok(Array.isArray(violations));
  assert.ok(violations.length >= 2);

  // Each violation should have expected fields
  const v = violations[0];
  assert.equal(v.resource, "api_calls");
  assert.equal(v.action, ACTION.BLOCK);
  assert.ok(typeof v.reason === "string");
  assert.ok(typeof v.timestamp === "number");
});

test("QuotaEnforcer: getViolations without agentId returns all agents", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 1, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.preCheck("agent-a", "api_calls", 1);
  enforcer.preCheck("agent-a", "api_calls", 1); // blocked
  enforcer.preCheck("agent-b", "api_calls", 1);
  enforcer.preCheck("agent-b", "api_calls", 1); // blocked

  const all = enforcer.getViolations();
  assert.ok("agent-a" in all);
  assert.ok("agent-b" in all);
});

// ---- enforcement stats ----

test("QuotaEnforcer: getEnforcementStats tracks all metrics", () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 2, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.preCheck("agent-1", "tool_executions", 1); // allowed
  enforcer.preCheck("agent-1", "tool_executions", 1); // allowed
  enforcer.preCheck("agent-1", "tool_executions", 1); // blocked

  const stats = enforcer.getEnforcementStats();
  assert.equal(stats.totalChecks, 3);
  assert.equal(stats.totalBlocks, 1);
  assert.equal(stats.violationCount, 1);
  assert.equal(stats.agentsTracked, 1);
});

// ---- grace period & burst ----

test("QuotaEnforcer: grace period allows burst usage beyond quota", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 5, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    burstAllowance: 3,
    defaultAction: ACTION.BLOCK,
  });

  // Consume full quota
  enforcer.preCheck("agent-1", "api_calls", 5);

  // Activate grace
  enforcer.activateGrace("agent-1");

  // Burst should allow extra calls
  const pre = enforcer.preCheck("agent-1", "api_calls", 2);
  assert.equal(pre.allowed, true, "burst should allow extra usage during grace");
});

test("QuotaEnforcer: deactivateGrace removes grace period", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 1, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    burstAllowance: 5,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.activateGrace("agent-1");
  enforcer.deactivateGrace("agent-1");

  enforcer.preCheck("agent-1", "api_calls", 1); // consume quota
  const pre = enforcer.preCheck("agent-1", "api_calls", 1); // should block
  assert.equal(pre.allowed, false, "should block after grace deactivated");
});

// ---- action override ----

test("QuotaEnforcer: setAction overrides default action per resource", () => {
  const qm = new QuotaManager();
  qm.setQuota("tokens_in", 1, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  // Override tokens_in to WARN instead of BLOCK
  enforcer.setAction("tokens_in", ACTION.WARN);

  enforcer.preCheck("agent-1", "tokens_in", 1);
  const pre = enforcer.preCheck("agent-1", "tokens_in", 1);

  assert.equal(pre.allowed, true);
  assert.equal(pre.action, ACTION.WARN);
});

test("QuotaEnforcer: setAction rejects invalid action", () => {
  const enforcer = new QuotaEnforcer();
  assert.throws(() => enforcer.setAction("api_calls", "INVALID"), {
    message: /Invalid action/,
  });
});

// ---- clear violations ----

test("QuotaEnforcer: clearViolations removes history for an agent", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 1, 60000);

  const enforcer = new QuotaEnforcer({
    quotaManager: qm,
    defaultAction: ACTION.BLOCK,
  });

  enforcer.preCheck("agent-x", "api_calls", 1);
  enforcer.preCheck("agent-x", "api_calls", 1); // blocked

  assert.ok(enforcer.getViolations("agent-x").length > 0);

  enforcer.clearViolations("agent-x");
  assert.equal(enforcer.getViolations("agent-x").length, 0);
});

// ---- ACTION constants ----

test("QuotaEnforcer: ACTION constants are frozen", () => {
  assert.equal(ACTION.BLOCK, "BLOCK");
  assert.equal(ACTION.THROTTLE, "THROTTLE");
  assert.equal(ACTION.WARN, "WARN");
  assert.equal(ACTION.LOG, "LOG");
  assert.throws(() => { ACTION.BLOCK = "CHANGED"; });
});
