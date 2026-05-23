"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ContinuityManager,
  diffStringArrays,
} = require("../../src/bridge/continuity");

const { ContextBridge } = require("../../src/bridge/transfer");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
  return {
    id: "session-test-001",
    goal: "Fix the auth module null reference bug",
    messages: [
      { role: "user", content: "I need to fix a critical bug in the auth module." },
      { role: "assistant", content: "Let me analyze the auth module code in src/auth.js." },
      { role: "assistant", content: "I decided to refactor token validation using a guard clause." },
      { role: "user", content: "Sounds good, go ahead." },
      { role: "assistant", content: "I'm working on the fix now. I should also update the tests." },
      { role: "assistant", content: "One question: should the new validator support OAuth as well?" },
    ],
    modifiedFiles: new Set(["src/auth.js", "src/middleware.js"]),
    state: { currentFile: "src/auth.js", cursorLine: 142 },
    provider: { name: "anthropic", model: "claude-sonnet-4-20250514" },
    costTracker: { turnCount: 6 },
    startTime: Date.now() - 300000,
    ...overrides,
  };
}

function makeSession2() {
  return {
    id: "session-test-002",
    goal: "Add OAuth support to auth module",
    messages: [
      { role: "user", content: "Now let's add OAuth support." },
      { role: "assistant", content: "I decided to use the passport.js library for OAuth." },
      { role: "assistant", content: "I'm implementing the OAuth strategy now." },
      { role: "user", content: "Will this work with Google Sign-In?" },
    ],
    modifiedFiles: new Set(["src/auth.js", "src/oauth.js"]),
    state: { currentFile: "src/oauth.js", cursorLine: 45 },
    provider: { name: "anthropic", model: "claude-sonnet-4-20250514" },
    costTracker: { turnCount: 3 },
    startTime: Date.now() - 60000,
  };
}

// ---------------------------------------------------------------------------
// ContinuityManager.checkpoint
// ---------------------------------------------------------------------------

test("checkpoint: creates a checkpoint from a session", () => {
  const manager = new ContinuityManager();
  const session = makeSession();
  const result = manager.checkpoint(session, { reason: "manual" });

  assert.ok(typeof result.id === "string");
  assert.ok(result.id.startsWith("cont_"), `Expected id to start with cont_, got ${result.id}`);
  assert.equal(result.checkpoint.reason, "manual");
  assert.equal(result.checkpoint.sessionId, "session-test-001");
  assert.equal(result.checkpoint.goal, "Fix the auth module null reference bug");
  assert.ok(typeof result.checkpoint.createdAt === "number");
  assert.ok(typeof result.checkpoint.context === "object");
  assert.ok(result.checkpoint.error === null);
});

test("checkpoint: captures error reason", () => {
  const manager = new ContinuityManager();
  const session = makeSession();
  const result = manager.checkpoint(session, {
    reason: "error",
    error: "ECONNREFUSED: connection refused",
  });

  assert.equal(result.checkpoint.reason, "error");
  assert.equal(result.checkpoint.error, "ECONNREFUSED: connection refused");
  // Verify the context was still captured despite the error.
  assert.ok(result.checkpoint.context.decisions.length > 0);
});

test("checkpoint: auto-defaults reason to manual when unspecified", () => {
  const manager = new ContinuityManager();
  const session = makeSession();
  const result = manager.checkpoint(session);

  assert.equal(result.checkpoint.reason, "manual");
});

test("checkpoint: prunes oldest when at maxCheckpoints capacity", () => {
  const manager = new ContinuityManager({ maxCheckpoints: 3 });
  const session = makeSession();

  // Create 3 checkpoints to fill capacity.
  const cp1 = manager.checkpoint(makeSession({ id: "s1" }));
  const cp2 = manager.checkpoint(makeSession({ id: "s2" }));
  const cp3 = manager.checkpoint(makeSession({ id: "s3" }));
  assert.equal(manager.count(), 3);

  // Fourth checkpoint should evict the oldest (s1).
  const cp4 = manager.checkpoint(makeSession({ id: "s4" }));
  assert.equal(manager.count(), 3);
  assert.equal(manager.getCheckpoint(cp1.id), null, "oldest should be evicted");
  assert.ok(manager.getCheckpoint(cp4.id) !== null, "newest should be present");
});

test("checkpoint: links session to continuity chain", () => {
  const manager = new ContinuityManager();
  const session = makeSession();
  manager.checkpoint(session);

  const chain = manager.getContinuityChain();
  assert.ok(chain.length > 0);
  assert.equal(chain[chain.length - 1].sessionId, "session-test-001");
});

// ---------------------------------------------------------------------------
// ContinuityManager.autoCheckpoint
// ---------------------------------------------------------------------------

test("autoCheckpoint: creates checkpoint when flag is enabled", () => {
  const manager = new ContinuityManager({
    autoCheckpointOnClose: true,
    autoCheckpointOnGoal: true,
    autoCheckpointOnError: true,
  });
  const session = makeSession();

  const result = manager.autoCheckpoint(session, "close");
  assert.ok(result !== null);
  assert.equal(result.checkpoint.reason, "close");
});

test("autoCheckpoint: returns null when auto-checkpoint is disabled", () => {
  const manager = new ContinuityManager({
    autoCheckpointOnClose: false,
  });
  const session = makeSession();

  const result = manager.autoCheckpoint(session, "close");
  assert.equal(result, null);
  assert.equal(manager.count(), 0);
});

test("autoCheckpoint: supports goal and error reasons", () => {
  const manager = new ContinuityManager({
    autoCheckpointOnGoal: true,
    autoCheckpointOnError: true,
  });
  const session = makeSession();

  const goalResult = manager.autoCheckpoint(session, "goal");
  assert.ok(goalResult !== null);
  assert.equal(goalResult.checkpoint.reason, "goal");

  const errorResult = manager.autoCheckpoint(session, "error", "Mock error");
  assert.ok(errorResult !== null);
  assert.equal(errorResult.checkpoint.reason, "error");
  assert.equal(errorResult.checkpoint.error, "Mock error");
});

// ---------------------------------------------------------------------------
// ContinuityManager.resume
// ---------------------------------------------------------------------------

test("resume: returns resume package for latest matching session checkpoint", () => {
  const manager = new ContinuityManager();
  const session1 = makeSession({ id: "session-A" });
  const session2 = makeSession({ id: "session-A" }); // same session id

  manager.checkpoint(session1, { reason: "manual" });
  manager.checkpoint(session2, { reason: "manual" });

  const pkg = manager.resume("session-A");
  assert.ok(pkg !== null);
  assert.equal(pkg.checkpoint.sessionId, "session-A");
  assert.ok(typeof pkg.summary === "string");
  assert.ok(pkg.summary.includes("Fix the auth module"));
  assert.ok(typeof pkg.context === "object");
});

test("resume: returns latest checkpoint when no sessionId specified", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "session-1" }));
  manager.checkpoint(makeSession({ id: "session-2" }));

  const pkg = manager.resume();
  assert.ok(pkg !== null);
  assert.equal(pkg.checkpoint.sessionId, "session-2", "should return most recent");
});

test("resume: returns null when no checkpoints exist", () => {
  const manager = new ContinuityManager();
  const pkg = manager.resume("nonexistent");
  assert.equal(pkg, null);
});

test("resume: returns null when sessionId not found and no checkpoints", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "existing" }));
  const pkg = manager.resume("nonexistent");
  // Falls back to latest checkpoint overall.
  assert.ok(pkg !== null);
  assert.equal(pkg.checkpoint.sessionId, "existing");
});

// ---------------------------------------------------------------------------
// ContinuityManager.compare
// ---------------------------------------------------------------------------

test("compare: diffs two checkpoints by id", () => {
  const manager = new ContinuityManager();
  const result1 = manager.checkpoint(makeSession({ id: "s1" }));
  const result2 = manager.checkpoint(makeSession2());

  const diff = manager.compare(result1.id, result2.id);
  assert.ok(diff !== null);
  assert.equal(diff.goalChanged, true);
  assert.equal(diff.a.id, result1.id);
  assert.equal(diff.b.id, result2.id);
  assert.ok(Array.isArray(diff.decisions.added));
  assert.ok(Array.isArray(diff.decisions.removed));
  assert.ok(Array.isArray(diff.tasks.added));
  assert.ok(Array.isArray(diff.files.added));
});

test("compare: diffs two checkpoints by object reference", () => {
  const manager = new ContinuityManager();
  const ckptA = manager.checkpoint(makeSession({ id: "s-same" }));
  const ckptB = manager.checkpoint(makeSession({ id: "s-same" }));

  const diff = manager.compare(ckptA.checkpoint, ckptB.checkpoint);
  assert.ok(diff !== null);
  assert.equal(diff.goalChanged, false, "same goal should not have changed");
});

test("compare: returns null when checkpoint not found", () => {
  const manager = new ContinuityManager();
  const result = manager.checkpoint(makeSession());

  const diff = manager.compare(result.id, "nonexistent-id");
  assert.equal(diff, null);
});

// ---------------------------------------------------------------------------
// ContinuityManager list / get / delete / count / clear
// ---------------------------------------------------------------------------

test("listCheckpoints: returns checkpoints newest-first", () => {
  const manager = new ContinuityManager();
  const cp1 = manager.checkpoint(makeSession({ id: "first" }));
  const cp2 = manager.checkpoint(makeSession({ id: "second" }));

  const list = manager.listCheckpoints();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, cp2.id, "newest first");
  assert.equal(list[1].id, cp1.id);
});

test("listCheckpoints: supports metadataOnly", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "m1" }));
  manager.checkpoint(makeSession({ id: "m2" }));

  const list = manager.listCheckpoints({ metadataOnly: true });
  assert.equal(list.length, 2);
  // Metadata-only entries should not have the full context object.
  assert.equal(list[0].context, undefined);
  assert.ok(typeof list[0].id === "string");
  assert.ok(typeof list[0].reason === "string");
});

test("getCheckpoint: retrieves single checkpoint by id", () => {
  const manager = new ContinuityManager();
  const result = manager.checkpoint(makeSession());

  const retrieved = manager.getCheckpoint(result.id);
  assert.ok(retrieved !== null);
  assert.equal(retrieved.id, result.id);
  assert.equal(retrieved.sessionId, "session-test-001");
});

test("getCheckpoint: returns null for nonexistent id", () => {
  const manager = new ContinuityManager();
  assert.equal(manager.getCheckpoint("nonexistent"), null);
});

test("deleteCheckpoint: removes a checkpoint and returns true", () => {
  const manager = new ContinuityManager();
  const result = manager.checkpoint(makeSession());
  assert.equal(manager.count(), 1);

  const deleted = manager.deleteCheckpoint(result.id);
  assert.equal(deleted, true);
  assert.equal(manager.count(), 0);
  assert.equal(manager.getCheckpoint(result.id), null);
});

test("deleteCheckpoint: returns false for nonexistent id", () => {
  const manager = new ContinuityManager();
  assert.equal(manager.deleteCheckpoint("nonexistent"), false);
});

test("clear: removes all checkpoints and resets chain", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "a" }));
  manager.checkpoint(makeSession({ id: "b" }));
  manager.checkpoint(makeSession({ id: "c" }));

  assert.equal(manager.count(), 3);
  assert.ok(manager.getContinuityChain().length > 0);

  manager.clear();
  assert.equal(manager.count(), 0);
  assert.equal(manager.getContinuityChain().length, 0);
});

// ---------------------------------------------------------------------------
// ContinuityManager continuity chain
// ---------------------------------------------------------------------------

test("getContinuityChain: reflects linked sessions in order", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "alpha" }));
  manager.checkpoint(makeSession({ id: "beta" }));
  manager.checkpoint(makeSession({ id: "gamma" }));

  const chain = manager.getContinuityChain();
  assert.equal(chain.length, 3);
  assert.equal(chain[0].sessionId, "alpha");
  assert.equal(chain[1].sessionId, "beta");
  assert.equal(chain[2].sessionId, "gamma");
});

test("getContinuityChain: does not duplicate consecutive same-session entries", () => {
  const manager = new ContinuityManager();
  manager.checkpoint(makeSession({ id: "dup" }));
  manager.checkpoint(makeSession({ id: "dup" }));
  manager.checkpoint(makeSession({ id: "dup" }));

  const chain = manager.getContinuityChain();
  assert.equal(chain.length, 1, "consecutive same session should not duplicate");
  assert.equal(chain[0].sessionId, "dup");
});

test("getContinuityChain: respects maxChainLength", () => {
  const manager = new ContinuityManager({ maxChainLength: 3 });
  for (let i = 0; i < 6; i += 1) {
    manager.checkpoint(makeSession({ id: `chain-${i}` }));
  }

  const chain = manager.getContinuityChain();
  assert.equal(chain.length, 3, "should be capped at maxChainLength");
  // The oldest entries should have been evicted.
  assert.equal(chain[0].sessionId, "chain-3");
  assert.equal(chain[2].sessionId, "chain-5");
});

// ---------------------------------------------------------------------------
// Custom bridge integration
// ---------------------------------------------------------------------------

test("constructor: accepts a custom bridge instance", () => {
  const bridge = new ContextBridge({ maxSummaries: 5 });
  const manager = new ContinuityManager({ bridge });

  const result = manager.checkpoint(makeSession());
  assert.ok(result !== null);
});

// ---------------------------------------------------------------------------
// Helper: diffStringArrays
// ---------------------------------------------------------------------------

test("diffStringArrays: computes correct add/remove/unchanged", () => {
  const diff = diffStringArrays(["a", "b", "c"], ["b", "c", "d"]);

  assert.deepEqual(diff.added, ["d"]);
  assert.deepEqual(diff.removed, ["a"]);
  assert.deepEqual(diff.unchanged, ["b", "c"]);
});

test("diffStringArrays: handles empty arrays", () => {
  const diff = diffStringArrays([], []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.unchanged, []);
});

test("diffStringArrays: handles non-array inputs", () => {
  const diff = diffStringArrays(null, undefined);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.unchanged, []);
});
