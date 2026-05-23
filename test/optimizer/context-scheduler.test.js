"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ContextScheduler,
  estimateTokens,
  messageTokens,
  scoreRelevance,
} = require("../../src/optimizer/context-scheduler");

// ---------------------------------------------------------------------------
// estimateTokens / messageTokens / scoreRelevance
// ---------------------------------------------------------------------------

test("estimateTokens: returns 0 for empty input", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
});

test("messageTokens: adds overhead to content tokens", () => {
  const msg = { role: "user", content: "hello world" };
  const tokens = messageTokens(msg);
  assert.ok(tokens > 2, "should be content tokens + overhead");
});

test("scoreRelevance: returns higher score for overlapping terms", () => {
  const msg1 = { content: "The user asked about token optimization strategies." };
  const msg2 = { content: "Lunch was delicious today." };
  const query = "token optimization";

  const score1 = scoreRelevance(msg1, query);
  const score2 = scoreRelevance(msg2, query);

  assert.ok(score1 > score2, "matching message should score higher");
});

test("scoreRelevance: returns 0.5 for empty query", () => {
  const msg = { content: "some content here" };
  assert.equal(scoreRelevance(msg, ""), 0.5);
  assert.equal(scoreRelevance(msg, "  "), 0.5);
});

test("scoreRelevance: returns 0 for null/empty message", () => {
  assert.equal(scoreRelevance(null, "query"), 0);
  assert.equal(scoreRelevance({}, "query"), 0);
  assert.equal(scoreRelevance({ content: "" }, "query"), 0);
});

// ---------------------------------------------------------------------------
// ContextScheduler: schedule
// ---------------------------------------------------------------------------

test("schedule: returns latest message even when budget is tight", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "old message" },
    { role: "user", content: "current message" },
  ];

  const result = scheduler.schedule(messages, 50);

  assert.equal(result.included.length, 2, "both messages should be included");
  assert.ok(result.included.some((m) => m.content === "current message"),
    "latest message should be included");
});

test("schedule: drops older messages that exceed budget", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "a".repeat(2000) },
    { role: "assistant", content: "b".repeat(2000) },
    { role: "user", content: "c".repeat(2000) },
    { role: "user", content: "hello" },
  ];

  // Tight budget forces dropping early messages.
  const result = scheduler.schedule(messages, 50);

  assert.equal(result.included.length, 1, "only latest fits");
  assert.equal(result.included[0].content, "hello");
  assert.ok(result.dropped.length > 0);
});

test("schedule: handles empty message list", () => {
  const scheduler = new ContextScheduler();
  const result = scheduler.schedule([], 100);

  assert.equal(result.included.length, 0);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.totalTokens, 0);
});

test("schedule: includes all messages when budget is generous", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "msg1" },
    { role: "assistant", content: "msg2" },
    { role: "user", content: "msg3" },
  ];

  const result = scheduler.schedule(messages, 10000);

  assert.equal(result.included.length, 3);
  assert.equal(result.dropped.length, 0);
});

test("schedule: auto-summarizes dropped messages when above threshold", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "a".repeat(500) },
    { role: "assistant", content: "b".repeat(500) },
    { role: "tool", content: "c".repeat(500) },
    { role: "user", content: "hello" },
  ];

  // Tight budget + low summarizeThreshold triggers auto-summary.
  const result = scheduler.schedule(messages, 50, { summarizeThreshold: 10 });

  assert.equal(result.included.length, 1, "only latest message fits");
  assert.ok(result.summarized.length > 0, "dropped messages should be summarized");
  assert.ok(result.summarized[0].content.includes("Context summary"));
});

// ---------------------------------------------------------------------------
// ContextScheduler: prioritizeByRelevance
// ---------------------------------------------------------------------------

test("prioritizeByRelevance: ranks messages by query relevance", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "How do I configure the database?" },
    { role: "user", content: "What is the weather like?" },
    { role: "assistant", content: "Database configuration involves setting up the connection string." },
  ];

  const ranked = scheduler.prioritizeByRelevance(messages, "database configuration");

  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].score > ranked[1].score,
    "most relevant should be first");
  // The DB configuration message should rank highest.
  assert.ok(ranked[0].message.content.includes("Database configuration"),
    "database answer should be most relevant");
});

test("prioritizeByRelevance: handles empty messages array", () => {
  const scheduler = new ContextScheduler();
  const ranked = scheduler.prioritizeByRelevance([], "query");
  assert.equal(ranked.length, 0);
});

// ---------------------------------------------------------------------------
// ContextScheduler: summarizeStaleContext
// ---------------------------------------------------------------------------

test("summarizeStaleContext: produces a concise summary of old messages", () => {
  const scheduler = new ContextScheduler();
  const oldMessages = [
    { role: "user", content: "Create a new file called index.js. It should export a default function." },
    { role: "assistant", content: "I have created index.js with the export." },
    { role: "tool", content: "File written successfully." },
  ];

  const summarized = scheduler.summarizeStaleContext(oldMessages);

  assert.equal(summarized.length, 1, "should produce one summary message");
  assert.equal(summarized[0].role, "system");
  assert.ok(summarized[0].content.includes("3 preceding messages"));
  assert.ok(summarized[0].content.includes("user"));
  assert.ok(summarized[0].content.includes("assistant"));
  assert.ok(summarized[0].content.includes("tool"));
  assert.ok(summarized[0].content.includes("1 tool calls"));
});

test("summarizeStaleContext: handles empty input", () => {
  const scheduler = new ContextScheduler();
  const summarized = scheduler.summarizeStaleContext([]);
  assert.equal(summarized.length, 0);
});

// ---------------------------------------------------------------------------
// ContextScheduler: injectContext
// ---------------------------------------------------------------------------

test("injectContext: prepends context to existing system message", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
  ];

  const result = scheduler.injectContext(messages, "Additional rules: be concise.");

  assert.equal(result.length, 2);
  assert.ok(result[0].content.includes("You are a helpful assistant"));
  assert.ok(result[0].content.includes("Additional rules"));
});

test("injectContext: inserts a new system message when none exists", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "Hello" },
  ];

  const result = scheduler.injectContext(messages, "Be concise.");

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "system");
  assert.equal(result[0].content, "Be concise.");
});

test("injectContext: uses explicit insertion point when provided", () => {
  const scheduler = new ContextScheduler();
  const messages = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ];

  const result = scheduler.injectContext(messages, { role: "tool", content: "tool output" }, {
    insertionPoint: 2,
  });

  assert.equal(result.length, 4);
  assert.equal(result[2].role, "tool");
  assert.equal(result[2].content, "tool output");
});

test("injectContext: skips injection for empty context", () => {
  const scheduler = new ContextScheduler();
  const messages = [{ role: "user", content: "Hello" }];

  const result = scheduler.injectContext(messages, "");
  assert.equal(result.length, 1);

  const result2 = scheduler.injectContext(messages, "   ");
  assert.equal(result2.length, 1);
});

// ---------------------------------------------------------------------------
// ContextScheduler: getSchedule
// ---------------------------------------------------------------------------

test("getSchedule: returns last schedule result and null initially", () => {
  const scheduler = new ContextScheduler();

  assert.equal(scheduler.getSchedule(), null, "should be null before any schedule call");

  const messages = [{ role: "user", content: "hello" }];
  scheduler.schedule(messages, 100);

  const schedule = scheduler.getSchedule();
  assert.ok(schedule !== null);
  assert.equal(schedule.included.length, 1);
  assert.equal(schedule.totalTokens >= 0, true);
});
