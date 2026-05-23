"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StateSnapshot, CURRENT_VERSION } = require("../../src/state/snapshot");
const { AgentLifecycle } = require("../../src/state/agent-lifecycle");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeLifecycle(agentId) {
  return new AgentLifecycle({ agentId: agentId || "test-agent" });
}

function makeSnapshotBase(overrides = {}) {
  return {
    id: "snap-test-1",
    agentId: "test-agent",
    version: CURRENT_VERSION,
    timestamp: new Date().toISOString(),
    fsm: { current: "idle", history: [], entryTime: Date.now() },
    lifecycle: { stateTimes: { idle: 100 }, lastTransitionTime: Date.now() },
    messages: [{ role: "user", content: "hello" }],
    goal: { enabled: false, text: "", maxContinuations: null },
    tools: [],
    settings: {},
    permissionState: {},
    costTracking: {
      inputTokens: 0,
      outputTokens: 0,
      turnCount: 0,
      toolCallCount: 0,
      totalCost: 0,
    },
    contextStats: null,
    metadata: {},
    ...overrides,
  };
}

// ------------------------------------------------------------------
// capture()
// ------------------------------------------------------------------

test("capture: creates a snapshot with all required fields", () => {
  const lifecycle = makeLifecycle("cap-1");
  const snapshot = StateSnapshot.capture({
    lifecycle,
    messages: [{ role: "user", content: "ping" }],
    goal: { enabled: true, text: "fix bugs", maxContinuations: 3 },
    tools: ["read", "write"],
    settings: { model: "test-model" },
    permissionState: { bash: "allow" },
    costTracker: {
      inputTokens: 100,
      outputTokens: 50,
      turnCount: 2,
      toolCallCount: 1,
      totalCost: 0.015,
    },
  });

  assert.ok(typeof snapshot.id === "string");
  assert.ok(snapshot.id.startsWith("snap-"));
  assert.equal(snapshot.agentId, "cap-1");
  assert.equal(snapshot.version, CURRENT_VERSION);
  assert.ok(typeof snapshot.timestamp === "string");

  // FSM
  assert.equal(snapshot.fsm.current, "idle");
  assert.ok(Array.isArray(snapshot.fsm.history));

  // Lifecycle
  assert.ok(typeof snapshot.lifecycle.stateTimes === "object");

  // Messages
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].role, "user");

  // Goal
  assert.equal(snapshot.goal.enabled, true);
  assert.equal(snapshot.goal.text, "fix bugs");
  assert.equal(snapshot.goal.maxContinuations, 3);

  // Tools
  assert.deepEqual(snapshot.tools, ["read", "write"]);

  // Settings
  assert.deepEqual(snapshot.settings, { model: "test-model" });

  // Permission state
  assert.deepEqual(snapshot.permissionState, { bash: "allow" });

  // Cost tracking
  assert.equal(snapshot.costTracking.inputTokens, 100);
  assert.equal(snapshot.costTracking.outputTokens, 50);
  assert.equal(snapshot.costTracking.totalCost, 0.015);

  // Snapshot is frozen (immutable)
  assert.throws(() => {
    snapshot.messages = [];
  });
});

test("capture: defaults missing agent fields gracefully", () => {
  const snapshot = StateSnapshot.capture({});

  assert.equal(snapshot.agentId, "");
  assert.equal(snapshot.messages.length, 0);
  assert.equal(snapshot.tools.length, 0);
  assert.deepEqual(snapshot.goal, {
    enabled: false,
    text: "",
    maxContinuations: null,
  });
  assert.deepEqual(snapshot.costTracking, {
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
    toolCallCount: 0,
    totalCost: 0,
  });
  assert.equal(snapshot.fsm.current, null);
  assert.equal(snapshot.fsm.history.length, 0);
});

test("capture: captures FSM history from lifecycle transitions", () => {
  const lifecycle = makeLifecycle("hist-1");
  const { AgentStates } = require("../../src/state/agent-lifecycle");

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING, { inputLength: 10 });

  const snapshot = StateSnapshot.capture({ lifecycle });

  assert.equal(snapshot.fsm.current, "thinking");
  assert.ok(snapshot.fsm.history.length >= 3); // null→idle + idle→receiving + receiving→thinking

  const lastEntry = snapshot.fsm.history[snapshot.fsm.history.length - 1];
  assert.equal(lastEntry.from, "receiving");
  assert.equal(lastEntry.to, "thinking");
});

// ------------------------------------------------------------------
// restore()
// ------------------------------------------------------------------

test("restore: returns a mutable deep clone of a valid snapshot", () => {
  const snapshot = makeSnapshotBase({
    messages: [{ role: "user", content: "restore me" }],
    costTracking: { inputTokens: 200, outputTokens: 100, turnCount: 1, toolCallCount: 0, totalCost: 0.03 },
  });

  const restored = StateSnapshot.restore(snapshot);

  // Deep clone: should not be the same reference
  assert.notStrictEqual(restored, snapshot);
  assert.notStrictEqual(restored.messages, snapshot.messages);
  assert.notStrictEqual(restored.costTracking, snapshot.costTracking);

  // Content should match
  assert.equal(restored.messages[0].content, "restore me");
  assert.equal(restored.costTracking.totalCost, 0.03);

  // Restored copy is mutable
  restored.messages.push({ role: "assistant", content: "ok" });
  assert.equal(restored.messages.length, 2);
});

test("restore: throws TypeError for an invalid snapshot", () => {
  assert.throws(
    () => StateSnapshot.restore(null),
    { message: /validation failed/ },
  );

  assert.throws(
    () => StateSnapshot.restore({}),
    { message: /validation failed/ },
  );

  assert.throws(
    () => StateSnapshot.restore(makeSnapshotBase({ version: -1 })),
    { message: /validation failed/ },
  );
});

// ------------------------------------------------------------------
// diff()
// ------------------------------------------------------------------

test("diff: detects fsm.current change", () => {
  const a = makeSnapshotBase({ fsm: { current: "idle", history: [], entryTime: 100 } });
  const b = makeSnapshotBase({ fsm: { current: "thinking", history: [], entryTime: 200 } });

  const result = StateSnapshot.diff(a, b);

  assert.ok(result.changed.includes("fsm.current"));
  assert.equal(result.details["fsm.current"].from, "idle");
  assert.equal(result.details["fsm.current"].to, "thinking");
});

test("diff: detects message length changes", () => {
  const a = makeSnapshotBase({ messages: [{ role: "user", content: "a" }] });
  const b = makeSnapshotBase({
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
  });

  const result = StateSnapshot.diff(a, b);

  assert.ok(result.changed.includes("messages.length"));
  assert.equal(result.details["messages.length"].added, 1);
});

test("diff: detects goal and costTracking changes", () => {
  const a = makeSnapshotBase({
    goal: { enabled: false, text: "", maxContinuations: null },
    costTracking: { inputTokens: 0, outputTokens: 0, turnCount: 0, toolCallCount: 0, totalCost: 0 },
  });
  const b = makeSnapshotBase({
    goal: { enabled: true, text: "learn", maxContinuations: 5 },
    costTracking: { inputTokens: 50, outputTokens: 25, turnCount: 1, toolCallCount: 1, totalCost: 0.01 },
  });

  const result = StateSnapshot.diff(a, b);

  assert.ok(result.changed.includes("goal"));
  assert.ok(result.changed.includes("costTracking"));
  assert.ok(typeof result.details.costTracking.delta.inputTokens === "number");
  assert.equal(result.details.costTracking.delta.inputTokens, 50);
});

test("diff: handles non-object inputs gracefully", () => {
  const result = StateSnapshot.diff(null, undefined);
  assert.deepEqual(result.changed, ["snapshot"]);
});

// ------------------------------------------------------------------
// validate()
// ------------------------------------------------------------------

test("validate: passes a well-formed snapshot", () => {
  const snapshot = makeSnapshotBase();
  const result = StateSnapshot.validate(snapshot);

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validate: rejects missing required fields", () => {
  const result = StateSnapshot.validate({ id: "x" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((e) => e.includes("missing required field")));
});

test("validate: rejects bad field types", () => {
  const snapshot = makeSnapshotBase({
    messages: "not-an-array",
    version: "not-a-number",
  });

  const result = StateSnapshot.validate(snapshot);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("messages")));
  assert.ok(result.errors.some((e) => e.includes("version")));
});

test("validate: warns on empty messages and missing FSM current", () => {
  const snapshot = makeSnapshotBase({
    messages: [],
    tools: [],
    fsm: { current: null, history: [], entryTime: null },
  });

  const result = StateSnapshot.validate(snapshot);

  assert.equal(result.valid, true); // still valid, just warnings
  assert.ok(result.warnings.some((w) => w.includes("no messages")));
  assert.ok(result.warnings.some((w) => w.includes("no tools")));
  assert.ok(result.warnings.some((w) => w.includes("fsm.current is null")));
});

// ------------------------------------------------------------------
// migrate()
// ------------------------------------------------------------------

test("migrate: throws for non-existent migration path", () => {
  const snapshot = makeSnapshotBase({ version: 1 });

  assert.throws(
    () => StateSnapshot.migrate(snapshot, 1, 99),
    { message: /No migration path/ },
  );
});

test("migrate: throws for invalid version arguments", () => {
  const snapshot = makeSnapshotBase();

  assert.throws(
    () => StateSnapshot.migrate(snapshot, 0, 2),
    { message: /fromVersion must be a positive integer/ },
  );

  assert.throws(
    () => StateSnapshot.migrate(snapshot, 1, -1),
    { message: /toVersion must be a positive integer/ },
  );
});

test("migrate: no-op when fromVersion equals toVersion", () => {
  const snapshot = makeSnapshotBase({ version: 1 });
  const result = StateSnapshot.migrate(snapshot, 1, 1);
  assert.equal(result.version, 1);
});

test("migrate: throws for non-object snapshot", () => {
  assert.throws(
    () => StateSnapshot.migrate(null, 1, 2),
    { message: /must be a plain object/ },
  );
});

// ------------------------------------------------------------------
// Integration: full round-trip with lifecycle
// ------------------------------------------------------------------

test("round-trip: capture → restore → use data to reconstruct", () => {
  const lifecycle = makeLifecycle("rt-1");
  const { AgentStates } = require("../../src/state/agent-lifecycle");

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 20 });
  lifecycle.transition(AgentStates.THINKING);

  const original = StateSnapshot.capture({
    lifecycle,
    messages: [
      { role: "user", content: "write tests" },
      { role: "assistant", content: "sure" },
    ],
    goal: { enabled: true, text: "test coverage", maxContinuations: 2 },
    tools: ["read", "write", "grep"],
    costTracker: { inputTokens: 500, outputTokens: 200, turnCount: 3, toolCallCount: 5, getCost: () => 0.05 },
  });

  // Restore
  const restored = StateSnapshot.restore(original);

  // Verify all data survived
  assert.equal(restored.agentId, "rt-1");
  assert.equal(restored.fsm.current, "thinking");
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.goal.text, "test coverage");
  assert.deepEqual(restored.tools, ["read", "write", "grep"]);
  assert.equal(restored.costTracking.inputTokens, 500);
  assert.equal(restored.costTracking.totalCost, 0.05);

  // Diff original vs restored should show no changes
  const diffResult = StateSnapshot.diff(original, restored);
  assert.equal(diffResult.changed.length, 0);
});
