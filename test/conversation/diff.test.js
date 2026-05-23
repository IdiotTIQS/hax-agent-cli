"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  diffMessages,
  detectRework,
  trackFileChanges,
  buildChangeLog,
  estimateProgress,
} = require("../../src/conversation/diff");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(role, content, timestamp) {
  const msg = { role, content };
  if (timestamp) msg.timestamp = timestamp;
  return msg;
}

// ---------------------------------------------------------------------------
// diffMessages
// ---------------------------------------------------------------------------

test("diffMessages: detects added and removed messages", () => {
  const before = [
    makeMsg("user", "Hello"),
    makeMsg("assistant", "Hi there"),
  ];
  const after = [
    makeMsg("user", "Hello"),
    makeMsg("assistant", "Hi there"),
    makeMsg("user", "New question"),
    makeMsg("assistant", "New answer"),
  ];

  const diff = diffMessages(before, after);

  assert.equal(diff.added.length, 2, "two messages should be added");
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.modified.length, 0, "should not have modified");
  assert.equal(diff.reordered, false);
  assert.ok(diff.summary.includes("2 messages added"));
});

test("diffMessages: detects modified messages", () => {
  const before = [
    makeMsg("user", "What is the capital of France?"),
    makeMsg("assistant", "The capital of France is Paris."),
  ];
  const after = [
    makeMsg("user", "What is the capital of France?"),
    makeMsg("assistant", "The capital of France is Paris. It is also known as the City of Light."),
  ];

  const diff = diffMessages(before, after);

  assert.ok(diff.modified.length >= 1, "should detect the modified assistant message");
  assert.equal(diff.added.length, 0);
});

test("diffMessages: detects reordered messages", () => {
  const before = [
    makeMsg("user", "Q1"),
    makeMsg("assistant", "A1"),
    makeMsg("user", "Q2"),
    makeMsg("assistant", "A2"),
  ];
  const after = [
    makeMsg("user", "Q2"),
    makeMsg("assistant", "A2"),
    makeMsg("user", "Q1"),
    makeMsg("assistant", "A1"),
  ];

  const diff = diffMessages(before, after);

  assert.equal(diff.reordered, true, "should detect reordering");
});

test("diffMessages: handles identical lists", () => {
  const messages = [
    makeMsg("user", "Hello"),
    makeMsg("assistant", "Hi"),
  ];

  const diff = diffMessages(messages, messages);

  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.modified.length, 0);
  assert.ok(diff.summary.includes("No changes"));
});

test("diffMessages: handles empty inputs", () => {
  const diff1 = diffMessages([], []);
  assert.equal(diff1.added.length, 0);
  assert.equal(diff1.removed.length, 0);

  const diff2 = diffMessages([], [makeMsg("user", "new")]);
  assert.equal(diff2.added.length, 1);
  assert.equal(diff2.removed.length, 0);

  const diff3 = diffMessages([makeMsg("user", "old")], []);
  assert.equal(diff3.added.length, 0);
  assert.equal(diff3.removed.length, 1);
});

test("diffMessages: handles null inputs gracefully", () => {
  const diff = diffMessages(null, null);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
});

// ---------------------------------------------------------------------------
// detectRework
// ---------------------------------------------------------------------------

test("detectRework: finds repeated file edits", () => {
  const messages = [
    makeMsg("assistant", "I edited `src/config.js` to add the new setting."),
    makeMsg("user", "Actually, change `src/config.js` back."),
    makeMsg("assistant", "I reverted `src/config.js`."),
    makeMsg("user", "No, put it back again in `src/config.js`."),
    makeMsg("assistant", "Re-applied changes to `src/config.js`."),
  ];

  const result = detectRework(messages);

  assert.equal(result.hasRework, true);
  const fileIncidents = result.reworkIncidents.filter((i) => i.type === "repeated-file-edits");
  assert.ok(fileIncidents.length >= 1, "should detect repeated edits to config.js");
  assert.ok(result.reworkScore > 0, "rework score should be positive");
});

test("detectRework: finds correction patterns", () => {
  const messages = [
    makeMsg("assistant", "I created the module with class-based components."),
    makeMsg("user", "No, that's not what I wanted. Actually, I meant functional components with hooks."),
    makeMsg("assistant", "OK, I rewrote it with hooks."),
  ];

  const result = detectRework(messages);

  assert.equal(result.hasRework, true);
  const corrections = result.reworkIncidents.filter((i) => i.type === "correction");
  assert.ok(corrections.length >= 1, "should detect user correction");
});

test("detectRework: finds repeated attempts", () => {
  const messages = [
    makeMsg("user", "Fix the login bug where users can't sign in."),
    makeMsg("assistant", "I checked the auth middleware."),
    makeMsg("user", "The login bug is still there. Users can't sign in. Please fix it again."),
  ];

  const result = detectRework(messages);

  assert.equal(result.hasRework, true);
  const repeats = result.reworkIncidents.filter((i) => i.type === "repeated-attempt");
  assert.ok(repeats.length >= 1, "should detect repeated attempt at same issue");
});

test("detectRework: returns negative for clean conversation", () => {
  const messages = [
    makeMsg("user", "What is 2+2?"),
    makeMsg("assistant", "The answer is 4."),
    makeMsg("user", "Thanks!"),
  ];

  const result = detectRework(messages);

  assert.equal(result.hasRework, false);
  assert.equal(result.reworkScore, 0);
});

test("detectRework: handles empty input", () => {
  const result = detectRework([]);
  assert.equal(result.hasRework, false);
  assert.equal(result.reworkScore, 0);
});

// ---------------------------------------------------------------------------
// trackFileChanges
// ---------------------------------------------------------------------------

test("trackFileChanges: extracts file paths and operations", () => {
  const messages = [
    makeMsg("assistant", "I created `src/auth.js` and edited `src/index.js` to import it."),
    makeMsg("assistant", "Then I updated the README and deleted `src/old.js`."),
  ];

  const changes = trackFileChanges(messages);

  assert.ok(Array.isArray(changes));
  assert.ok(changes.length >= 2, "should track multiple files");

  // Find auth.js.
  const auth = changes.find((c) => c.file.includes("auth.js"));
  assert.ok(auth, "should track src/auth.js");
  assert.ok(auth.operations.some((o) => o.op === "create"), "should detect create operation");

  // Find old.js.
  const old = changes.find((c) => c.file.includes("old.js"));
  assert.ok(old, "should track src/old.js");
  assert.ok(old.operations.some((o) => o.op === "delete"), "should detect delete operation");
});

test("trackFileChanges: tracks mention count and first/last indices", () => {
  const messages = [
    makeMsg("user", "Let's work on `src/main.js`."),
    makeMsg("assistant", "I edited `src/main.js`."),
    makeMsg("user", "Now update `src/main.js` again."),
    makeMsg("assistant", "Updated `src/main.js` once more."),
  ];

  const changes = trackFileChanges(messages);

  const main = changes.find((c) => c.file.includes("main.js"));
  assert.ok(main, "should track main.js");
  assert.equal(main.mentionCount, 4);
  assert.equal(main.firstMention, 0);
  assert.equal(main.lastMention, 3);
});

test("trackFileChanges: handles messages with no file references", () => {
  const messages = [
    makeMsg("user", "Hello, how are you?"),
    makeMsg("assistant", "I'm doing well, thank you!"),
  ];

  const changes = trackFileChanges(messages);

  assert.deepEqual(changes, []);
});

test("trackFileChanges: handles empty input", () => {
  assert.deepEqual(trackFileChanges([]), []);
});

// ---------------------------------------------------------------------------
// buildChangeLog
// ---------------------------------------------------------------------------

test("buildChangeLog: builds chronological change log", () => {
  const messages = [
    makeMsg("assistant", "Created `src/index.js` with the main entry point."),
    makeMsg("assistant", "Added `src/utils.js` and `test/utils.test.js`."),
    makeMsg("assistant", "Refactored `src/index.js` to use the new utilities."),
  ];

  const log = buildChangeLog(messages);

  assert.ok(Array.isArray(log));
  assert.ok(log.length >= 2, "should have multiple log entries");

  // Verify chronological order.
  for (let i = 1; i < log.length; i += 1) {
    assert.ok(log[i].index >= log[i - 1].index, "log entries should be in chronological order");
  }

  // Each entry should have the required fields.
  for (const entry of log) {
    assert.equal(typeof entry.index, "number");
    assert.ok(Array.isArray(entry.files));
    assert.equal(typeof entry.operation, "string");
    assert.equal(typeof entry.summary, "string");
  }
});

test("buildChangeLog: includes rationale for assistant actions", () => {
  const messages = [
    makeMsg("user", "Please set up ESLint with the Airbnb config."),
    makeMsg("assistant", "I installed eslint and configured it in `.eslintrc.js`."),
  ];

  const log = buildChangeLog(messages);

  const eslintEntry = log.find((e) => e.files.some((f) => f.includes("eslintrc")));
  assert.ok(eslintEntry, "should have eslint entry");
  if (eslintEntry && eslintEntry.rationale) {
    assert.ok(
      eslintEntry.rationale.toLowerCase().includes("airbnb") ||
      eslintEntry.rationale.toLowerCase().includes("eslint"),
      "rationale should reference the user's request",
    );
  }
});

test("buildChangeLog: handles empty input", () => {
  const log = buildChangeLog([]);
  assert.deepEqual(log, []);
});

// ---------------------------------------------------------------------------
// estimateProgress
// ---------------------------------------------------------------------------

test("estimateProgress: returns progress percentage and indicators", () => {
  const messages = [
    makeMsg("assistant", "I created `src/index.js` and `src/app.js`."),
    makeMsg("assistant", "Updated `src/index.js` to add routing."),
    makeMsg("assistant", "Refactored `src/app.js` for better performance."),
    makeMsg("assistant", "Added tests for all modules. Everything is done and complete."),
  ];

  const progress = estimateProgress(messages);

  assert.equal(typeof progress.percent, "number");
  assert.ok(progress.percent >= 0 && progress.percent <= 100, "percent should be 0-100");
  assert.ok(["high", "medium", "low"].includes(progress.confidence));
  assert.ok(Array.isArray(progress.indicators));
  assert.ok(progress.indicators.length > 0);
});

test("estimateProgress: returns low percent for minimal conversation", () => {
  const messages = [
    makeMsg("user", "Hi, are you there?"),
  ];

  const progress = estimateProgress(messages);

  assert.equal(progress.percent, 0, "single greeting should have near-zero progress");
});

test("estimateProgress: gives higher score for file-heavy conversations", () => {
  const light = [
    makeMsg("user", "Tell me a joke."),
    makeMsg("assistant", "Why did the chicken cross the road?"),
  ];

  const heavy = [
    makeMsg("assistant", "Created `src/main.js`."),
    makeMsg("assistant", "Created `src/routes.js`."),
    makeMsg("assistant", "Created `src/models.js`."),
    makeMsg("assistant", "Created `src/controllers.js`."),
    makeMsg("assistant", "Created `src/middleware.js`."),
    makeMsg("assistant", "Fixed all issues. [x] Setup project [x] Create routes [x] Add models [x] Add controllers. Everything is finished and complete."),
  ];

  const lightProgress = estimateProgress(light);
  const heavyProgress = estimateProgress(heavy);

  assert.ok(
    heavyProgress.percent > lightProgress.percent,
    `heavy progress (${heavyProgress.percent}) should exceed light (${lightProgress.percent})`,
  );
});

test("estimateProgress: detects checkboxes for completion tracking", () => {
  const messages = [
    makeMsg("assistant", `Progress:
- [x] Set up project
- [x] Add database
- [x] Create API routes
- [ ] Write tests
- [ ] Deploy`),
  ];

  const progress = estimateProgress(messages);

  const checkboxIndicator = progress.indicators.find(
    (i) => i.factor === "checkbox completion ratio",
  );
  assert.ok(checkboxIndicator, "should have checkbox indicator");
  // 3 of 5 checked = 60%, contribution should be ~6.
  assert.ok(checkboxIndicator.contribution > 0);
  assert.ok(checkboxIndicator.contribution < 10);
});

test("estimateProgress: handles empty input", () => {
  const progress = estimateProgress([]);
  assert.equal(progress.percent, 0);
  assert.equal(progress.confidence, "high");
});
