/**
 * Tests for session utility classes: InputHistory, CostTracker, Session.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { InputHistory, CostTracker, Session } = require("../src/session");

// ── InputHistory ─────────────────────────────────────────

test("InputHistory: constructor defaults maxSize to 1000", () => {
  const history = new InputHistory();
  assert.equal(history.maxSize, 1000);
  assert.deepEqual(history.entries, []);
  assert.equal(history.index, -1);
  assert.equal(history.partial, "");
});

test("InputHistory: constructor accepts custom maxSize", () => {
  const history = new InputHistory(42);
  assert.equal(history.maxSize, 42);
});

test("InputHistory: add ignores empty/whitespace entries", () => {
  const history = new InputHistory();
  history.add("");
  history.add("   ");
  history.add("\t");
  assert.equal(history.entries.length, 0);
});

test("InputHistory: add deduplicates consecutive same entries", () => {
  const history = new InputHistory();
  history.add("hello");
  history.add("hello");
  assert.equal(history.entries.length, 1);
});

test("InputHistory: add stores unique entries in FILO order (newest first)", () => {
  const history = new InputHistory();
  history.add("first");
  history.add("second");
  history.add("third");
  assert.deepEqual(history.entries, ["third", "second", "first"]);
});

test("InputHistory: add resets index and partial", () => {
  const history = new InputHistory();
  history.add("hello");
  history.add("world");
  // Navigate up
  history.up("current");
  assert.equal(history.index, 0);
  // Add new entry resets
  history.add("new-entry");
  assert.equal(history.index, -1);
  assert.equal(history.partial, "");
});

test("InputHistory: add trims to maxSize", () => {
  const history = new InputHistory(3);
  history.add("a");
  history.add("b");
  history.add("c");
  history.add("d");
  assert.deepEqual(history.entries, ["d", "c", "b"]);
});

test("InputHistory: up returns current when entries empty", () => {
  const history = new InputHistory();
  assert.equal(history.up("current"), "current");
});

test("InputHistory: up cycles through history", () => {
  const history = new InputHistory();
  history.add("entry3");
  history.add("entry2");
  history.add("entry1");

  assert.equal(history.up("current"), "entry1");
  assert.equal(history.index, 0);

  assert.equal(history.up(""), "entry2");
  assert.equal(history.index, 1);

  assert.equal(history.up(""), "entry3");
  assert.equal(history.index, 2);

  // At end, stays at last entry
  assert.equal(history.up(""), "entry3");
  assert.equal(history.index, 2);
});

test("InputHistory: down returns current when not navigating", () => {
  const history = new InputHistory();
  history.add("entry");
  assert.equal(history.down("current"), "current");
});

test("InputHistory: down returns partial at boundary", () => {
  const history = new InputHistory();
  history.add("entry2");
  history.add("entry1");

  history.up("my current input");
  assert.equal(history.partial, "my current input");

  // Down from index 0 returns partial
  assert.equal(history.down(""), "my current input");
  assert.equal(history.index, -1);
});

test("InputHistory: down cycles back through history", () => {
  const history = new InputHistory();
  history.add("entry3");
  history.add("entry2");
  history.add("entry1");

  // Go up twice
  history.up("");
  assert.equal(history.up(""), "entry2");

  // Go down once
  assert.equal(history.down(""), "entry1");
  assert.equal(history.index, 0);
});

test("InputHistory: reset clears navigation state", () => {
  const history = new InputHistory();
  history.add("entry");
  history.up("current");
  assert.equal(history.index, 0);

  history.reset();
  assert.equal(history.index, -1);
  assert.equal(history.partial, "");
});

test("InputHistory: search returns empty for empty query", () => {
  const history = new InputHistory();
  history.add("hello");
  assert.deepEqual(history.search(""), []);
});

test("InputHistory: search returns empty for null/undefined query", () => {
  const history = new InputHistory();
  history.add("hello");
  assert.deepEqual(history.search(null), []);
  assert.deepEqual(history.search(undefined), []);
});

test("InputHistory: search finds matching entries case-insensitively", () => {
  const history = new InputHistory();
  history.add("Hello World");
  history.add("Not matching");
  history.add("HELLO again");

  const results = history.search("hello");
  assert.equal(results.length, 2);
  assert.ok(results.includes("HELLO again"));
  assert.ok(results.includes("Hello World"));
});

test("InputHistory: search limits to 10 results", () => {
  const history = new InputHistory();
  for (let i = 0; i < 20; i++) {
    history.add(`match-${i}`);
  }
  const results = history.search("match");
  assert.equal(results.length, 10);
});

test("InputHistory: rsearch returns null for empty query", () => {
  const history = new InputHistory();
  assert.equal(history.rsearch(""), null);
  assert.equal(history.rsearch(null), null);
});

test("InputHistory: rsearch finds first match", () => {
  const history = new InputHistory();
  history.add("First entry");
  history.add("Second entry");

  const result = history.rsearch("second");
  assert.deepEqual(result, { match: "Second entry", query: "second" });
});

test("InputHistory: rsearch returns null when no match", () => {
  const history = new InputHistory();
  history.add("First entry");
  assert.equal(history.rsearch("zzz"), null);
});

// ── CostTracker ──────────────────────────────────────────

test("CostTracker: constructor initializes all counters to 0", () => {
  const tracker = new CostTracker();
  assert.equal(tracker.inputTokens, 0);
  assert.equal(tracker.outputTokens, 0);
  assert.equal(tracker.cacheCreationTokens, 0);
  assert.equal(tracker.cacheReadTokens, 0);
  assert.equal(tracker.turnCount, 0);
  assert.equal(tracker.toolCallCount, 0);
  assert.ok(tracker.startTime > 0);
});

test("CostTracker: addUsage updates counts from various key formats", () => {
  const tracker = new CostTracker();
  tracker.addUsage({
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5,
  });
  assert.equal(tracker.inputTokens, 100);
  assert.equal(tracker.outputTokens, 50);
  assert.equal(tracker.cacheCreationTokens, 10);
  assert.equal(tracker.cacheReadTokens, 5);
  assert.equal(tracker.turnCount, 1);
});

test("CostTracker: addUsage reads alternative key names", () => {
  const tracker = new CostTracker();
  tracker.addUsage({
    prompt_tokens: 200,
    completion_tokens: 100,
  });
  assert.equal(tracker.inputTokens, 200);
  assert.equal(tracker.outputTokens, 100);
});

test("CostTracker: addUsage handles null/undefined usage", () => {
  const tracker = new CostTracker();
  tracker.addUsage(null);
  tracker.addUsage(undefined);
  assert.equal(tracker.inputTokens, 0);
  assert.equal(tracker.turnCount, 0);
});

test("CostTracker: addUsage ignores non-finite values", () => {
  const tracker = new CostTracker();
  tracker.addUsage({
    inputTokens: NaN,
    outputTokens: Infinity,
  });
  assert.equal(tracker.inputTokens, 0);
  assert.equal(tracker.outputTokens, 0);
});

test("CostTracker: addToolCall increments counter", () => {
  const tracker = new CostTracker();
  tracker.addToolCall();
  tracker.addToolCall();
  assert.equal(tracker.toolCallCount, 2);
});

test("CostTracker: getCost returns 0 for unknown model", () => {
  const tracker = new CostTracker();
  tracker.inputTokens = 1000000;
  tracker.outputTokens = 500000;
  assert.equal(tracker.getCost("unknown-model-xyz"), 0);
});

test("CostTracker: getCost returns 0 for null/undefined model", () => {
  const tracker = new CostTracker();
  assert.equal(tracker.getCost(null), 0);
  assert.equal(tracker.getCost(undefined), 0);
});

test("CostTracker: getCost calculates correctly for known model", () => {
  const tracker = new CostTracker();
  tracker.inputTokens = 1000000; // 1M input tokens
  tracker.outputTokens = 500000; // 0.5M output tokens

  // claude-sonnet-4-20250514: $3/M input, $15/M output
  const cost = tracker.getCost("claude-sonnet-4-20250514");
  assert.ok(cost > 0);
  assert.ok(Math.abs(cost - (3 + 7.5)) < 0.01); // = 10.5
});

test("CostTracker: getPricing falls back to pattern matching", () => {
  const tracker = new CostTracker();
  // Should match claude-opus pattern
  const pricing = tracker.getPricing("claude-opus-4-20250515-beta");
  assert.ok(pricing);
  assert.equal(pricing.input, 15.0);
  assert.equal(pricing.output, 75.0);
});

test("CostTracker: getPricing falls back for gpt-4o variants", () => {
  const tracker = new CostTracker();
  const pricing = tracker.getPricing("gpt-4o-2024-11-20");
  assert.ok(pricing);
  assert.equal(pricing.input, 2.5);
  assert.equal(pricing.output, 10.0);
});

test("CostTracker: getPricing returns null for completely unknown pattern", () => {
  const tracker = new CostTracker();
  assert.equal(tracker.getPricing("something-completely-new"), null);
});

test("CostTracker: getCost includes cache costs when pricing has them", () => {
  const tracker = new CostTracker();
  tracker.cacheCreationTokens = 1000000; // 1M cache creation tokens
  tracker.cacheReadTokens = 1000000; // 1M cache read tokens

  // claude-sonnet has cacheWrite: 3.75, cacheRead: 0.3
  const cost = tracker.getCost("claude-sonnet-4-20250514");
  assert.ok(cost > 0);
  // cache write: $3.75, cache read: $0.30
  assert.ok(Math.abs(cost - (3.75 + 0.3)) < 0.01);
});

test("CostTracker: formatSummary includes all non-zero fields", () => {
  const tracker = new CostTracker();
  tracker.inputTokens = 1000;
  tracker.outputTokens = 500;
  tracker.turnCount = 3;
  tracker.toolCallCount = 7;

  const summary = tracker.formatSummary("claude-sonnet-4-20250514");
  assert.ok(summary.includes("Session Statistics"));
  assert.ok(summary.includes("3"));
  assert.ok(summary.includes("7"));
  assert.ok(summary.includes("1,000"));
  assert.ok(summary.includes("500"));
  assert.ok(summary.includes("Estimated cost"));
});

test("CostTracker: formatSummary hides cache lines when zero", () => {
  const tracker = new CostTracker();
  const summary = tracker.formatSummary("mock");
  assert.ok(!summary.includes("Cache write"));
  assert.ok(!summary.includes("Cache read"));
});

test("CostTracker: formatSummary shows cache lines when non-zero", () => {
  const tracker = new CostTracker();
  tracker.cacheCreationTokens = 100;
  tracker.cacheReadTokens = 200;

  const summary = tracker.formatSummary("claude-sonnet-4-20250514");
  assert.ok(summary.includes("Cache write"));
  assert.ok(summary.includes("Cache read"));
});

// ── Session ──────────────────────────────────────────────

test("Session: constructor creates unique id and empty messages", () => {
  const session = new Session();
  assert.ok(session.id);
  assert.ok(session.id.length > 0);
  assert.deepEqual(session.messages, []);
  assert.equal(session.costTracker instanceof CostTracker, true);
  assert.equal(session.shouldExit, false);
  assert.equal(session.isStreaming, false);
  assert.equal(session.pendingExit, false);
  assert.equal(session.responseAbortController, null);
  assert.equal(session.responseRenderer, null);
  assert.equal(session.responseInterrupted, false);
  assert.deepEqual(session.modifiedFiles, new Set());
  assert.equal(session.goal, null);
  assert.ok(session.startTime > 0);
});

test("Session: constructor stores provider, settings, and toolRegistry", () => {
  const provider = { name: "mock", model: "mock-a" };
  const settings = { projectRoot: "/test" };
  const toolRegistry = { tools: [] };

  const session = new Session({ provider, settings, toolRegistry });
  assert.equal(session.provider, provider);
  assert.equal(session.settings, settings);
  assert.equal(session.toolRegistry, toolRegistry);
});

test("Session: constructor stores permissionManager", () => {
  const pm = { mode: "yolo" };
  const session = new Session({ permissionManager: pm });
  assert.equal(session.permissionManager, pm);
});

test("Session: permissionManager defaults to null", () => {
  const session = new Session();
  assert.equal(session.permissionManager, null);
});

test("Session: getElapsedTime returns formatted time", () => {
  const session = new Session();
  const elapsed = session.getElapsedTime();
  assert.ok(typeof elapsed === "string");
  assert.ok(elapsed.length > 0);
});

test("Session: modifiedFiles is a Set", () => {
  const session = new Session();
  session.modifiedFiles.add("test.txt");
  session.modifiedFiles.add("src/index.js");
  assert.equal(session.modifiedFiles.size, 2);
  assert.ok(session.modifiedFiles.has("test.txt"));
});

test("Session: two sessions have different ids", () => {
  const s1 = new Session();
  const s2 = new Session();
  assert.notEqual(s1.id, s2.id);
});

test("Session: getStatusLine includes provider and model", () => {
  const session = new Session({
    provider: { name: "anthropic", model: "claude-sonnet-4" },
    settings: { projectRoot: "/test-project" },
  });
  const line = session.getStatusLine();
  assert.ok(line.includes("anthropic"));
  assert.ok(line.includes("claude-sonnet-4"));
  assert.ok(line.includes("test-project"));
});

test("Session: getStatusLine includes yolo mode indicator", () => {
  const session = new Session({
    permissionManager: { mode: "yolo" },
    settings: { projectRoot: "/test-project" },
  });
  const line = session.getStatusLine();
  assert.ok(line.includes("YOLO"));
});

test("Session: getStatusLine handles null permissionManager", () => {
  const session = new Session({
    settings: { projectRoot: "/test-project" },
  });
  const line = session.getStatusLine();
  // Should not crash
  assert.ok(line.length > 0);
});

test("Session: getStatusLine includes context meter when stats available", () => {
  const session = new Session({
    settings: { projectRoot: "/test-project" },
  });
  session.contextStats = {
    budgetTokens: 1000,
    inputTokens: 500,
  };
  const line = session.getStatusLine();
  assert.ok(line.includes("50%"));
  assert.ok(line.includes("500"));
  assert.ok(line.includes("1.0k"));
});

test("Session: getStatusLine handles long cwd paths with truncation", () => {
  const longPath = "/" + "a".repeat(40) + "/very/deep/nested/project";
  const session = new Session({
    settings: { projectRoot: longPath },
  });
  const line = session.getStatusLine();
  assert.ok(line.includes("..."));
});

test("Session: getStatusLine includes goal indicator when goal enabled", () => {
  const session = new Session({
    settings: { projectRoot: "/test" },
  });
  session.goal = { enabled: true, text: "Complete X" };
  const line = session.getStatusLine();
  assert.ok(line.includes("goal"));
});

test("Session: getStatusLine does not include goal when disabled", () => {
  const session = new Session({
    settings: { projectRoot: "/test" },
  });
  session.goal = { enabled: false, text: "X" };
  const line = session.getStatusLine();
  assert.ok(!line.includes("goal"));
});
