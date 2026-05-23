"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StateRehydration } = require("../../src/state/rehydration");
const { StateSnapshot } = require("../../src/state/snapshot");
const { AgentLifecycle, AgentStates } = require("../../src/state/agent-lifecycle");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function captureHealthySnapshot(agentId) {
  const lifecycle = new AgentLifecycle({ agentId: agentId || "healthy-1" });
  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING);

  return StateSnapshot.capture({
    lifecycle,
    messages: [
      { role: "user", content: "report status" },
      { role: "assistant", content: "all systems operational" },
    ],
    goal: { enabled: true, text: "monitor health", maxContinuations: 2 },
    tools: ["read", "write", "grep"],
    settings: { model: "test-model", projectRoot: "/tmp/test" },
    permissionState: { bash: "allow", write: "ask" },
    costTracker: {
      inputTokens: 300,
      outputTokens: 150,
      turnCount: 2,
      toolCallCount: 3,
      getCost: () => 0.04,
    },
    contextStats: {
      tokenCount: 450,
      messageCount: 2,
      truncated: false,
      utilization: 0.75,
    },
    metadata: {
      platform: process.platform,
      nodeVersion: process.version,
      capturedBy: "test",
    },
  });
}

// ------------------------------------------------------------------
// rehydrate() — full path
// ------------------------------------------------------------------

test("rehydrate: restores a valid snapshot with full recovery report", () => {
  const rehydrator = new StateRehydration();
  const snapshot = captureHealthySnapshot("rh-1");

  const restored = rehydrator.rehydrate(snapshot);

  assert.ok(restored !== null);
  assert.equal(restored.agentId, "rh-1");
  assert.equal(restored.fsm.current, "thinking");
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.goal.text, "monitor health");
  assert.deepEqual(restored.tools, ["read", "write", "grep"]);
  assert.equal(restored.costTracking.inputTokens, 300);
  assert.equal(restored.costTracking.totalCost, 0.04);

  // Check recovery report
  const report = rehydrator.getRecoveryReport();
  assert.ok(report.recovered.includes("fsm_state"));
  assert.ok(report.recovered.includes("lifecycle_timing"));
  assert.ok(report.recovered.some((r) => r.startsWith("messages")));
  assert.ok(report.recovered.includes("goal"));
  assert.ok(report.recovered.some((r) => r.startsWith("tools")));
  assert.ok(report.recovered.includes("costTracking"));
  assert.ok(report.recovered.includes("contextStats"));
  assert.equal(report.errors.length, 0);
});

test("rehydrate: returns null and logs errors for invalid snapshot", () => {
  const rehydrator = new StateRehydration();

  const restored = rehydrator.rehydrate({ garbage: true });

  assert.equal(restored, null);

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.errors.length > 0);
  assert.ok(report.lost.includes("full_state"));
});

test("rehydrate: handles snapshot with no messages gracefully", () => {
  const rehydrator = new StateRehydration();
  const snapshot = captureHealthySnapshot("empty-msgs");

  // build manually with empty messages
  const emptySnapshot = {
    ...snapshot,
    messages: [],
  };

  // Need to bypass freeze for test — make a mutable copy of the snapshot
  const restored = rehydrator.rehydrate(emptySnapshot);

  // Even with empty messages, rehydration should succeed
  assert.ok(restored !== null);
  assert.equal(restored.messages.length, 0);

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.lost.includes("messages"));
});

// ------------------------------------------------------------------
// recoverPartial() — best-effort
// ------------------------------------------------------------------

test("recoverPartial: salvages data from a partial snapshot", () => {
  const rehydrator = new StateRehydration();

  const partial = {
    id: "partial-1",
    agentId: "agent-x",
    version: 1,
    timestamp: new Date().toISOString(),
    fsm: {
      current: "thinking",
      history: [
        { from: null, to: "idle", timestamp: 1000, meta: {} },
        { from: "idle", to: "thinking", timestamp: 2000, meta: {} },
      ],
      entryTime: 2000,
    },
    lifecycle: {
      stateTimes: { idle: 500, thinking: 300 },
      lastTransitionTime: 2000,
    },
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
    goal: { enabled: true, text: "partial recovery test" },
    tools: ["grep"],
    // Missing: settings, permissionState, costTracking, contextStats
  };

  const recovered = rehydrator.recoverPartial(partial);

  // Check recovered
  assert.equal(recovered.id, "partial-1");
  assert.equal(recovered.agentId, "agent-x");
  assert.equal(recovered.fsm.current, "thinking");
  assert.equal(recovered.messages.length, 2);
  assert.equal(recovered.goal.text, "partial recovery test");
  assert.deepEqual(recovered.tools, ["grep"]);

  // Missing fields should get defaults
  assert.deepEqual(recovered.settings, {});
  assert.deepEqual(recovered.permissionState, {});
  assert.equal(recovered.costTracking.inputTokens, 0);

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.recovered.includes("fsm"));
  assert.ok(report.recovered.includes("goal"));
  assert.ok(report.lost.includes("settings"));
  assert.ok(report.lost.includes("permissionState"));
  assert.ok(report.lost.includes("costTracking"));
});

test("recoverPartial: filters malformed messages", () => {
  const rehydrator = new StateRehydration();

  const partial = {
    messages: [
      { role: "user", content: "valid" },
      { role: "assistant" },             // missing content
      null,                                // not an object
      { role: "system", content: "also valid" },
      { content: "no role" },             // missing role
    ],
  };

  const recovered = rehydrator.recoverPartial(partial);

  assert.equal(recovered.messages.length, 2);
  assert.equal(recovered.messages[0].role, "user");
  assert.equal(recovered.messages[1].role, "system");

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.warnings.some((w) => w.includes("dropped")));
});

test("recoverPartial: handles completely invalid input", () => {
  const rehydrator = new StateRehydration();

  const recovered = rehydrator.recoverPartial(null);

  assert.ok(recovered !== null);
  assert.equal(recovered.agentId, "");
  assert.equal(recovered.fsm.current, null);

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.lost.includes("full_state"));
});

test("recoverPartial: recovers costTracking with partial data", () => {
  const rehydrator = new StateRehydration();

  const partial = {
    costTracking: {
      inputTokens: 500,
      // outputTokens missing
      // turnCount is NaN
      turnCount: NaN,
    },
  };

  const recovered = rehydrator.recoverPartial(partial);

  assert.equal(recovered.costTracking.inputTokens, 500);
  assert.equal(recovered.costTracking.outputTokens, 0); // default
  assert.equal(recovered.costTracking.turnCount, 0);    // NaN → 0
  assert.equal(recovered.costTracking.totalCost, 0);

  const report = rehydrator.getRecoveryReport();
  assert.ok(report.recovered.includes("costTracking"));
});

// ------------------------------------------------------------------
// validateEnvironment()
// ------------------------------------------------------------------

test("validateEnvironment: reports compatible when platform matches", () => {
  const rehydrator = new StateRehydration();

  const snapshot = {
    metadata: {
      platform: process.platform,
      nodeVersion: process.version,
    },
    tools: [],
  };

  const result = rehydrator.validateEnvironment(snapshot);

  assert.equal(result.compatible, true);
  if (snapshot.metadata.platform) {
    assert.equal(result.checks.platform.match, true);
  }
});

test("validateEnvironment: warns on platform mismatch", () => {
  const rehydrator = new StateRehydration();

  const snapshot = {
    metadata: {
      platform: "darwin",
      nodeVersion: process.version,
    },
    tools: [],
  };

  // Current platform is win32 (from test env), so it will warn
  const result = rehydrator.validateEnvironment(snapshot);
  assert.ok(result.warnings.some((w) => w.includes("platform")));
});

test("validateEnvironment: warns if snapshot Node.js is newer than current", () => {
  const rehydrator = new StateRehydration();

  const snapshot = {
    metadata: {
      nodeVersion: "v99.0.0",
    },
    tools: [],
  };

  const result = rehydrator.validateEnvironment(snapshot);
  assert.ok(result.warnings.some((w) => w.includes("Node.js")));
});

test("validateEnvironment: handles missing metadata gracefully", () => {
  const rehydrator = new StateRehydration();

  const result = rehydrator.validateEnvironment({});

  // Should be compatible by default (no metadata to contradict)
  assert.equal(result.compatible, true);
  assert.equal(result.checks.platform?.snapshot, null);
});

// ------------------------------------------------------------------
// getRecoveryReport() — isolation
// ------------------------------------------------------------------

test("getRecoveryReport: returns empty report before any operation", () => {
  const rehydrator = new StateRehydration();
  const report = rehydrator.getRecoveryReport();

  assert.equal(report.recovered.length, 0);
  assert.equal(report.lost.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.errors.length, 0);
});

test("getRecoveryReport: reports are independent between operations", () => {
  const rehydrator = new StateRehydration();

  // First operation
  rehydrator.recoverPartial({ agentId: "first" });
  const report1 = rehydrator.getRecoveryReport();
  assert.ok(report1.recovered.includes("agentId"));

  // Second operation — should reset
  rehydrator.rehydrate(captureHealthySnapshot("second"));
  const report2 = rehydrator.getRecoveryReport();

  // Report2 should have second's agentId recovered
  assert.ok(report2.recovered.includes("fsm_state"));
});
