"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { persistGoal, restoreGoal } = require("../src/goal-persistence");
const { createSessionId, readTranscript } = require("../src/memory");

/**
 * Create an isolated fixture with temporary directories so tests do not
 * interfere with each other or with the real filesystem state.
 */
function createFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-goal-"));
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "memory") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  return { projectRoot, settings };
}

// ---------------------------------------------------------------------------
// persistGoal
// ---------------------------------------------------------------------------

test("persistGoal: writes a goal.meta entry to the session transcript", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();
  const goal = {
    enabled: true,
    text: "Refactor all test files",
    maxContinuations: 5,
    createdAt: "2026-05-22T10:00:00.000Z",
  };

  const entry = persistGoal(sessionId, goal, settings);

  assert.equal(entry.type, "goal.meta");
  assert.equal(entry.goal.text, "Refactor all test files");
  assert.equal(entry.goal.enabled, true);
  assert.equal(entry.goal.maxContinuations, 5);
  assert.ok(typeof entry.timestamp === "string");

  // Verify the entry was actually written to disk.
  const transcripts = readTranscript(sessionId, settings);
  const goalEntries = transcripts.filter((e) => e.type === "goal.meta");
  assert.equal(goalEntries.length, 1);
  assert.equal(goalEntries[0].goal.text, "Refactor all test files");
});

test("persistGoal: null goal writes a cleared-goal marker", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  // Set a goal first, then clear it.
  persistGoal(sessionId, { enabled: true, text: "temporary goal" }, settings);
  const entry = persistGoal(sessionId, null, settings);

  assert.equal(entry.type, "goal.meta");
  assert.equal(entry.goal, null);

  const transcripts = readTranscript(sessionId, settings);
  const goalEntries = transcripts.filter((e) => e.type === "goal.meta");
  assert.equal(goalEntries.length, 2);
  assert.equal(goalEntries[1].goal, null);
});

test("persistGoal: returns undefined for an empty sessionId", () => {
  const { settings } = createFixture();

  const result = persistGoal("", { enabled: true, text: "should not write" }, settings);
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// restoreGoal
// ---------------------------------------------------------------------------

test("restoreGoal: restores the most recent active goal from transcript", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  const goal = {
    enabled: true,
    text: "Migrate to TypeScript",
    maxContinuations: 10,
    createdAt: "2026-05-22T10:00:00.000Z",
  };
  persistGoal(sessionId, goal, settings);

  // Write a regular transcript entry *after* the goal to confirm
  // the restore walks past non-goal entries.
  const { appendTranscriptEntry } = require("../src/memory");
  appendTranscriptEntry(
    sessionId,
    { role: "user", content: "start migration" },
    settings,
  );

  const restored = restoreGoal(sessionId, settings);

  assert.equal(restored.enabled, true);
  assert.equal(restored.text, "Migrate to TypeScript");
  assert.equal(restored.maxContinuations, 10);
});

test("restoreGoal: returns the most recent goal when multiple are stored", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  persistGoal(sessionId, { enabled: true, text: "first goal" }, settings);
  persistGoal(sessionId, { enabled: true, text: "second goal" }, settings);

  const restored = restoreGoal(sessionId, settings);
  assert.equal(restored.text, "second goal");
});

test("restoreGoal: returns null when no goal has ever been saved", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  const { appendTranscriptEntry } = require("../src/memory");
  appendTranscriptEntry(sessionId, { role: "user", content: "hello" }, settings);
  appendTranscriptEntry(sessionId, { role: "assistant", content: "hi" }, settings);

  const restored = restoreGoal(sessionId, settings);
  assert.equal(restored, null);
});

test("restoreGoal: returns null when the most recent goal was cleared", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  persistGoal(sessionId, { enabled: true, text: "will be cleared" }, settings);
  persistGoal(sessionId, null, settings);

  const restored = restoreGoal(sessionId, settings);
  assert.equal(restored, null);
});

test("restoreGoal: returns null for a disabled goal", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  persistGoal(
    sessionId,
    { enabled: false, text: "disabled goal" },
    settings,
  );

  const restored = restoreGoal(sessionId, settings);
  assert.equal(restored, null);
});

test("restoreGoal: returns null for an empty sessionId", () => {
  const { settings } = createFixture();

  const restored = restoreGoal("", settings);
  assert.equal(restored, null);
});

test("restoreGoal: round-trip preserves special characters", () => {
  const { settings } = createFixture();
  const sessionId = createSessionId();

  const specialGoal = {
    enabled: true,
    text: 'Fix all "edge" cases with \n newlines, \t tabs, and emoji 🎉',
    maxContinuations: 3,
    createdAt: "2026-05-22T12:00:00.000Z",
  };

  persistGoal(sessionId, specialGoal, settings);

  const restored = restoreGoal(sessionId, settings);
  assert.equal(restored.text, specialGoal.text);
  assert.equal(restored.maxContinuations, 3);
  assert.equal(restored.enabled, true);
});
