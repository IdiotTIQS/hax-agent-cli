"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ContextRestorer } = require("../../src/preserve/restorer");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSession() {
  return {
    goal: "Fix the auth module null reference bug",
    state: { currentFile: "src/auth.js", cursorLine: 142 },
    messages: [
      { role: "user", content: "I need to fix a critical bug in the auth module." },
      { role: "assistant", content: "Let me analyze the auth module code." },
      { role: "assistant", content: "I found a null reference error in the token validation." },
      { role: "user", content: "Please implement the fix and show me the updated code." },
    ],
  };
}

// ---------------------------------------------------------------------------
// ContextRestorer.saveCheckpoint
// ---------------------------------------------------------------------------

test("saveCheckpoint: saves a checkpoint and returns id with checkpoint data", () => {
  const restorer = new ContextRestorer();
  const result = restorer.saveCheckpoint({
    messages: [{ role: "user", content: "hello" }],
    goal: "test goal",
    state: { foo: "bar" },
  });

  assert.ok(typeof result.id === "string", "Expected string id");
  assert.ok(result.id.startsWith("ckpt_"), `Expected id to start with ckpt_, got ${result.id}`);
  assert.equal(result.checkpoint.goal, "test goal");
  assert.equal(result.checkpoint.state.foo, "bar");
  assert.equal(result.checkpoint.messages.length, 1);
  assert.ok(typeof result.checkpoint.timestamp === "number", "Expected numeric timestamp");
  assert.ok(typeof result.checkpoint.summary === "string", "Expected string summary");
});

test("saveCheckpoint: uses provided id when specified", () => {
  const restorer = new ContextRestorer();
  const result = restorer.saveCheckpoint({
    id: "my-custom-id",
    messages: [],
    goal: "custom",
  });

  assert.equal(result.id, "my-custom-id");
  assert.equal(result.checkpoint.id, "my-custom-id");
});

test("saveCheckpoint: overwrites existing checkpoint with same id", () => {
  const restorer = new ContextRestorer();
  restorer.saveCheckpoint({ id: "same-id", goal: "first version" });
  restorer.saveCheckpoint({ id: "same-id", goal: "second version" });

  assert.equal(restorer.count(), 1, "Should only have one checkpoint with that id");
  const restored = restorer.restoreCheckpoint("same-id");
  assert.equal(restored.goal, "second version");
});

test("saveCheckpoint: auto-generates a message summary when none provided", () => {
  const restorer = new ContextRestorer();
  const result = restorer.saveCheckpoint({
    messages: [
      { role: "user", content: "Fix the login bug please." },
      { role: "assistant", content: "I've identified the issue and fixed it." },
    ],
  });

  assert.ok(result.checkpoint.summary.length > 0);
  assert.ok(result.checkpoint.summary.includes("user:"));
  assert.ok(result.checkpoint.summary.includes("assistant:"));
});

// ---------------------------------------------------------------------------
// ContextRestorer.restoreCheckpoint
// ---------------------------------------------------------------------------

test("restoreCheckpoint: returns the correct checkpoint by id", () => {
  const restorer = new ContextRestorer();
  const saved = restorer.saveCheckpoint({
    messages: makeSession().messages,
    goal: "restore-test",
    state: { key: "value" },
  });

  const restored = restorer.restoreCheckpoint(saved.id);

  assert.notEqual(restored, null);
  assert.equal(restored.id, saved.id);
  assert.equal(restored.goal, "restore-test");
  assert.equal(restored.state.key, "value");
  assert.equal(restored.messages.length, makeSession().messages.length);
});

test("restoreCheckpoint: returns null for unknown id", () => {
  const restorer = new ContextRestorer();
  const result = restorer.restoreCheckpoint("nonexistent-id");
  assert.equal(result, null);
});

test("restoreCheckpoint: returns null for empty string id", () => {
  const restorer = new ContextRestorer();
  assert.equal(restorer.restoreCheckpoint(""), null);
  assert.equal(restorer.restoreCheckpoint("   "), null);
});

test("restoreCheckpoint: returned checkpoint is a deep clone (immutable)", () => {
  const restorer = new ContextRestorer();
  const saved = restorer.saveCheckpoint({
    messages: [{ role: "user", content: "original" }],
    state: { key: "val" },
  });

  const restored = restorer.restoreCheckpoint(saved.id);
  restored.state.key = "modified";
  restored.messages[0].content = "changed";

  // Fetch again and verify original is unchanged.
  const restoredAgain = restorer.restoreCheckpoint(saved.id);
  assert.equal(restoredAgain.state.key, "val");
  assert.equal(restoredAgain.messages[0].content, "original");
});

// ---------------------------------------------------------------------------
// ContextRestorer.listCheckpoints
// ---------------------------------------------------------------------------

test("listCheckpoints: returns checkpoints sorted newest-first", () => {
  const restorer = new ContextRestorer();
  const id1 = restorer.saveCheckpoint({ goal: "first" }).id;
  const id2 = restorer.saveCheckpoint({ goal: "second" }).id;
  const id3 = restorer.saveCheckpoint({ goal: "third" }).id;

  const list = restorer.listCheckpoints();

  assert.equal(list.length, 3);
  // Newest-first.
  assert.equal(list[0].id, id3);
  assert.equal(list[1].id, id2);
  assert.equal(list[2].id, id1);
});

test("listCheckpoints: respects limit option", () => {
  const restorer = new ContextRestorer();
  for (let i = 0; i < 10; i += 1) {
    restorer.saveCheckpoint({ goal: `goal-${i}` });
  }

  const limited = restorer.listCheckpoints({ limit: 5 });
  assert.equal(limited.length, 5);
});

test("listCheckpoints: metadataOnly returns id and timestamp without full data", () => {
  const restorer = new ContextRestorer();
  restorer.saveCheckpoint({
    messages: [{ role: "user", content: "hello" }],
    goal: "test",
  });

  const list = restorer.listCheckpoints({ metadataOnly: true });

  assert.equal(list.length, 1);
  assert.ok(typeof list[0].id === "string");
  assert.ok(typeof list[0].timestamp === "number");
  assert.ok(typeof list[0].goal === "string");
  assert.ok(typeof list[0].summary === "string");
  // Full metadata should not have messages.
  assert.equal(list[0].messages, undefined);
});

// ---------------------------------------------------------------------------
// ContextRestorer.deleteCheckpoint
// ---------------------------------------------------------------------------

test("deleteCheckpoint: removes a checkpoint and returns true", () => {
  const restorer = new ContextRestorer();
  const saved = restorer.saveCheckpoint({ goal: "to-delete" });

  assert.equal(restorer.count(), 1);
  const result = restorer.deleteCheckpoint(saved.id);
  assert.equal(result, true);
  assert.equal(restorer.count(), 0);
  assert.equal(restorer.restoreCheckpoint(saved.id), null);
});

test("deleteCheckpoint: returns false for unknown id", () => {
  const restorer = new ContextRestorer();
  assert.equal(restorer.deleteCheckpoint("no-such-id"), false);
});

test("deleteCheckpoint: returns false for empty id", () => {
  const restorer = new ContextRestorer();
  assert.equal(restorer.deleteCheckpoint(""), false);
});

// ---------------------------------------------------------------------------
// ContextRestorer.createAutoCheckpoint
// ---------------------------------------------------------------------------

test("createAutoCheckpoint: creates checkpoint at a decision point", () => {
  const restorer = new ContextRestorer();
  const session = makeSession();

  // A decision point: assistant gave a plan and user confirms.
  session.messages = [
    { role: "user", content: "What approach should we use for auth?" },
    { role: "assistant", content: "I recommend we implement a token validation strategy with null checks and then add tests." },
    { role: "assistant", content: "The plan is to use a middleware approach for cleaner architecture." },
    { role: "user", content: "Ok, go ahead with that approach." },
  ];

  const result = restorer.createAutoCheckpoint(session);

  assert.notEqual(result, null, "Expected a checkpoint at a decision point");
  assert.ok(result.id.startsWith("ckpt_"));
  assert.equal(result.checkpoint.goal, session.goal);
  assert.equal(result.checkpoint.messages.length, session.messages.length);
  assert.equal(result.checkpoint.meta.autoGenerated, true);
});

test("createAutoCheckpoint: returns null when no decision point detected", () => {
  const restorer = new ContextRestorer();
  const session = makeSession();
  session.messages = [
    { role: "user", content: "What time is it?" },
    { role: "assistant", content: "It's 3 PM." },
    { role: "user", content: "Thanks." },
    { role: "assistant", content: "You're welcome!" },
  ];

  const result = restorer.createAutoCheckpoint(session);
  assert.equal(result, null, "Should not checkpoint casual conversation");
});

test("createAutoCheckpoint: creates checkpoint when forced", () => {
  const restorer = new ContextRestorer();
  const session = makeSession();
  session.messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
  ];

  const result = restorer.createAutoCheckpoint(session, { force: true });

  assert.notEqual(result, null, "Forced checkpoint should always be created");
  assert.equal(result.checkpoint.meta.forced, true);
});

test("createAutoCheckpoint: returns null for empty session messages", () => {
  const restorer = new ContextRestorer();
  const result = restorer.createAutoCheckpoint({ messages: [] }, { force: true });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Checkpoint cap and auto-pruning
// ---------------------------------------------------------------------------

test("auto-pruning: oldest checkpoint is removed when maxCheckpoints is reached", () => {
  const restorer = new ContextRestorer({ maxCheckpoints: 3, autoPrune: true });

  const first = restorer.saveCheckpoint({ goal: "first" });
  restorer.saveCheckpoint({ goal: "second" });
  restorer.saveCheckpoint({ goal: "third" });
  // This should push out "first".
  restorer.saveCheckpoint({ goal: "fourth" });

  assert.equal(restorer.count(), 3);
  assert.equal(restorer.restoreCheckpoint(first.id), null, "First should be pruned");
});

test("auto-pruning: can be disabled", () => {
  const restorer = new ContextRestorer({ maxCheckpoints: 3, autoPrune: false });

  restorer.saveCheckpoint({ goal: "first" });
  restorer.saveCheckpoint({ goal: "second" });
  restorer.saveCheckpoint({ goal: "third" });
  restorer.saveCheckpoint({ goal: "fourth" });

  // Since autoPrune is off, all 4 should remain.
  assert.equal(restorer.count(), 4);
});

// ---------------------------------------------------------------------------
// ContextRestorer.clear
// ---------------------------------------------------------------------------

test("clear: removes all checkpoints", () => {
  const restorer = new ContextRestorer();
  restorer.saveCheckpoint({ goal: "a" });
  restorer.saveCheckpoint({ goal: "b" });
  restorer.saveCheckpoint({ goal: "c" });

  assert.equal(restorer.count(), 3);
  restorer.clear();
  assert.equal(restorer.count(), 0);
  assert.equal(restorer.listCheckpoints().length, 0);
});

// ---------------------------------------------------------------------------
// ContextRestorer.count
// ---------------------------------------------------------------------------

test("count: returns zero for new instance", () => {
  const restorer = new ContextRestorer();
  assert.equal(restorer.count(), 0);
});

test("count: reflects accurate count after saves and deletes", () => {
  const restorer = new ContextRestorer();
  const a = restorer.saveCheckpoint({ goal: "a" });
  const b = restorer.saveCheckpoint({ goal: "b" });

  assert.equal(restorer.count(), 2);
  restorer.deleteCheckpoint(a.id);
  assert.equal(restorer.count(), 1);
  restorer.deleteCheckpoint(b.id);
  assert.equal(restorer.count(), 0);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("saveCheckpoint: handles empty context", () => {
  const restorer = new ContextRestorer();
  const result = restorer.saveCheckpoint();

  assert.ok(typeof result.id === "string");
  assert.ok(result.checkpoint.messages.length === 0);
  assert.equal(result.checkpoint.goal, "");
  assert.deepEqual(result.checkpoint.state, {});
});

test("restoreCheckpoint: deep-clones complex nested state", () => {
  const restorer = new ContextRestorer();
  const complexState = {
    files: { "src/auth.js": { modified: true, lines: 100 } },
    cursor: { line: 42, column: 8 },
    diagnostics: [{ severity: "error", message: "null ref" }],
  };

  restorer.saveCheckpoint({ messages: [], state: complexState });
  const list = restorer.listCheckpoints();
  const restored = list[0];

  assert.deepEqual(restored.state, complexState);
  // Ensure it's a clone, not a reference.
  restored.state.files = {};
  const restoredAgain = restorer.listCheckpoints()[0];
  assert.ok(typeof restoredAgain.state.files["src/auth.js"] !== "undefined");
});

test("createAutoCheckpoint: detects decision point in assistant message with multiple reasoning steps", () => {
  const restorer = new ContextRestorer();
  const session = {
    messages: [
      { role: "user", content: "How should we fix the database connection pooling?" },
      { role: "assistant", content: "First, let me analyze the current connection pool configuration." },
      { role: "assistant", content: "I've decided to implement a connection strategy with exponential backoff and circuit breaker pattern. This will handle transient failures gracefully." },
      { role: "user", content: "Let's do it." },
    ],
  };

  const result = restorer.createAutoCheckpoint(session);
  assert.notEqual(result, null, "Should detect decision point with multi-step reasoning");
});
