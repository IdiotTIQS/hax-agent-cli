/**
 * Tests for QuotaManager.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { QuotaManager, RESOURCES, WINDOW_MODE } = require("../../src/quota/manager");

test("QuotaManager: initializes with default values", () => {
  const qm = new QuotaManager();
  const stats = qm.getStats();
  assert.equal(stats.totalConsumed, 0);
  assert.equal(stats.totalRejected, 0);
});

test("QuotaManager: RESOURCES includes all expected resources", () => {
  assert.ok(RESOURCES.includes("api_calls"));
  assert.ok(RESOURCES.includes("tokens_in"));
  assert.ok(RESOURCES.includes("tokens_out"));
  assert.ok(RESOURCES.includes("tool_executions"));
  assert.ok(RESOURCES.includes("file_operations"));
  assert.ok(RESOURCES.includes("session_time"));
  assert.equal(RESOURCES.length, 6);
});

test("QuotaManager: setQuota sets a global quota and checkQuota reflects it", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 100, 60000);

  const info = qm.checkQuota("api_calls");
  assert.equal(info.limit, 100);
  assert.equal(info.remaining, 100);
  assert.equal(info.used, 0);
  assert.equal(info.exhausted, false);
  assert.equal(info.windowMs, 60000);
});

test("QuotaManager: checkQuota returns unlimited when no quota is set", () => {
  const qm = new QuotaManager();
  const info = qm.checkQuota("tokens_in");
  assert.equal(info.limit, Infinity);
  assert.equal(info.remaining, Infinity);
  assert.equal(info.exhausted, false);
});

test("QuotaManager: consume deducts from quota and returns remaining", () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 50, 60000);

  const r1 = qm.consume("tool_executions", 10);
  assert.equal(r1.allowed, true);
  assert.equal(r1.consumed, 10);
  assert.equal(r1.remaining, 40);

  const r2 = qm.consume("tool_executions", 15);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 25);
});

test("QuotaManager: consume blocks when quota is exceeded", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 5, 60000);

  qm.consume("api_calls", 5);
  const r = qm.consume("api_calls", 1);
  assert.equal(r.allowed, false);
  assert.equal(r.consumed, 0);
  assert.equal(r.remaining, 0);
  assert.ok(r.reason.includes("Quota exceeded"));
});

test("QuotaManager: consume zero amount always succeeds", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 0, 60000);

  const r = qm.consume("api_calls", 0);
  assert.equal(r.allowed, true);
  assert.equal(r.consumed, 0);
});

test("QuotaManager: per-agent quotas are independent of global quotas", () => {
  const qm = new QuotaManager();
  qm.setQuota("tokens_in", 100, 60000);
  qm.setQuota("tokens_in", 20, 60000, { agentId: "agent-a" });
  qm.setQuota("tokens_in", 30, 60000, { agentId: "agent-b" });

  // Agent A has separate limit
  const a1 = qm.consume("tokens_in", 15, "agent-a");
  assert.equal(a1.allowed, true);
  assert.equal(a1.remaining, 5);

  const a2 = qm.consume("tokens_in", 10, "agent-a");
  assert.equal(a2.allowed, false);

  // Agent B unaffected by agent A's consumption
  const b1 = qm.consume("tokens_in", 25, "agent-b");
  assert.equal(b1.allowed, true);
  assert.equal(b1.remaining, 5);

  // Global quota also unaffected
  const g = qm.checkQuota("tokens_in");
  assert.equal(g.remaining, 100);
});

test("QuotaManager: reset clears usage counter for a resource", () => {
  const qm = new QuotaManager();
  qm.setQuota("file_operations", 10, 60000);

  qm.consume("file_operations", 8);
  assert.equal(qm.checkQuota("file_operations").remaining, 2);

  qm.reset("file_operations");
  const info = qm.checkQuota("file_operations");
  assert.equal(info.remaining, 10);
  assert.equal(info.used, 0);
});

test("QuotaManager: getUsage returns comprehensive resource stats", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 100, 60000);
  qm.setQuota("tokens_in", 500, 60000);
  qm.consume("api_calls", 30);
  qm.consume("tokens_in", 200);

  const usage = qm.getUsage();
  assert.ok("resources" in usage);
  assert.ok("api_calls" in usage.resources);
  assert.ok("tokens_in" in usage.resources);
  assert.equal(usage.resources.api_calls.used, 30);
  assert.equal(usage.resources.api_calls.remaining, 70);
  assert.equal(usage.resources.tokens_in.used, 200);
  assert.equal(usage.resources.tokens_in.remaining, 300);
  assert.ok(Array.isArray(usage.exhausted));
});

test("QuotaManager: getUsage per-agent returns agent-specific stats", () => {
  const qm = new QuotaManager();
  qm.setQuota("tool_executions", 20, 60000, { agentId: "worker" });
  qm.consume("tool_executions", 5, "worker");

  const usage = qm.getUsage(null, "worker");
  assert.ok("resources" in usage);
  assert.equal(usage.resources.tool_executions.used, 5);
  assert.equal(usage.resources.tool_executions.remaining, 15);
  assert.equal(usage.resources.tool_executions.limit, 20);
});

test("QuotaManager: sliding window expires entries outside the window", async () => {
  const qm = new QuotaManager({ defaultMode: "SLIDING" });
  qm.setQuota("tokens_out", 100, 100); // 100ms sliding window

  qm.consume("tokens_out", 50);
  assert.equal(qm.checkQuota("tokens_out").remaining, 50);

  // Wait for the window to pass
  await sleep(150);

  // Old entries should have expired
  const info = qm.checkQuota("tokens_out");
  assert.equal(info.remaining, 100);
  assert.equal(info.used, 0);
});

test("QuotaManager: fixed window resets after interval", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 10, 100); // 100ms fixed window

  qm.consume("api_calls", 8);
  assert.equal(qm.checkQuota("api_calls").remaining, 2);

  // Manually advance time by modifying lastReset
  qm._globalUsage.api_calls.lastReset = Date.now() - 101;

  // Should have auto-reset
  const info = qm.checkQuota("api_calls");
  assert.equal(info.remaining, 10);
});

test("QuotaManager: setWindowMode changes tracking globally", () => {
  const qm = new QuotaManager();
  qm.setWindowMode("SLIDING");
  // Verify by checking that a new quota uses SLIDING mode
  qm.setQuota("session_time", 60, 30000);
  // Use a small consume and check that the log tracks entries
  qm.consume("session_time", 10);
  assert.ok(qm._globalLog.session_time.length > 0);
});

test("QuotaManager: resetAll clears all usage and quotas", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 50, 60000);
  qm.consume("api_calls", 25);
  qm.consume("tokens_in", 100);

  qm.resetAll();

  const stats = qm.getStats();
  assert.equal(stats.totalConsumed, 0);
  assert.equal(stats.totalRejected, 0);

  const info = qm.checkQuota("api_calls");
  // resetAll does not remove quota definitions, just usage counters
  assert.equal(info.used, 0);
});

test("QuotaManager: throws on invalid resource name", () => {
  const qm = new QuotaManager();
  assert.throws(() => qm.setQuota("invalid_resource", 10), {
    message: /Unknown resource/,
  });
  assert.throws(() => qm.consume("invalid_resource", 1), {
    message: /Unknown resource/,
  });
  assert.throws(() => qm.checkQuota("invalid_resource"), {
    message: /Unknown resource/,
  });
});

test("QuotaManager: getStats tracks total consumed and rejected", () => {
  const qm = new QuotaManager();
  qm.setQuota("api_calls", 3, 60000);

  qm.consume("api_calls", 2);
  qm.consume("api_calls", 2); // should be rejected (only 1 left)

  const stats = qm.getStats();
  assert.equal(stats.totalConsumed, 2);
  assert.equal(stats.totalRejected, 1);
});

test("QuotaManager: WINDOW_MODE constants are frozen", () => {
  assert.equal(WINDOW_MODE.FIXED, "FIXED");
  assert.equal(WINDOW_MODE.SLIDING, "SLIDING");
  assert.throws(() => { WINDOW_MODE.FIXED = "CHANGED"; });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
