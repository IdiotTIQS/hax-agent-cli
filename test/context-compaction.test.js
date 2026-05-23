"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compactMessages,
  buildCompactionPrompt,
  buildCompactMessages,
} = require("../src/context-compaction");

// ---------------------------------------------------------------------------
// compactMessages
// ---------------------------------------------------------------------------

test("compactMessages: returns all messages as preserveZone when total is below preserveCount", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
    { role: "user", content: "help me" },
  ];

  const result = compactMessages(messages, { preserveCount: 10 });

  assert.equal(result.summaryZone.length, 0);
  assert.equal(result.preserveZone.length, 3);
  assert.deepEqual(result.preserveZone, messages);
});

test("compactMessages: splits messages into summaryZone and preserveZone", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));

  const result = compactMessages(messages, { preserveCount: 5 });

  assert.equal(result.summaryZone.length, 25);
  assert.equal(result.preserveZone.length, 5);
  assert.equal(result.summaryZone[0].content, "message 0");
  assert.equal(result.summaryZone[24].content, "message 24");
  assert.equal(result.preserveZone[0].content, "message 25");
  assert.equal(result.preserveZone[4].content, "message 29");
});

test("compactMessages: uses the default preserveCount of 20", () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({
    role: "user",
    content: `msg ${i}`,
  }));

  const result = compactMessages(messages);

  assert.equal(result.summaryZone.length, 30);
  assert.equal(result.preserveZone.length, 20);
});

test("compactMessages: clamps preserveCount to a minimum of 2", () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({
    role: "user",
    content: `msg ${i}`,
  }));

  const result = compactMessages(messages, { preserveCount: 1 });

  assert.equal(result.preserveZone.length, 2, "preserveCount clamped to 2");
  assert.equal(result.summaryZone.length, 8);
});

test("compactMessages: exact boundary yields empty summaryZone", () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: "user",
    content: `msg ${i}`,
  }));

  const result = compactMessages(messages, { preserveCount: 20 });

  assert.equal(result.summaryZone.length, 0);
  assert.equal(result.preserveZone.length, 20);
});

test("compactMessages: empty input produces empty zones", () => {
  const result = compactMessages([], { preserveCount: 5 });

  assert.equal(result.summaryZone.length, 0);
  assert.equal(result.preserveZone.length, 0);
});

test("compactMessages: non-array input is handled safely", () => {
  const result = compactMessages(null, { preserveCount: 5 });

  assert.equal(result.summaryZone.length, 0);
  assert.equal(result.preserveZone.length, 0);
});

// ---------------------------------------------------------------------------
// buildCompactionPrompt
// ---------------------------------------------------------------------------

test("buildCompactionPrompt: generates a valid prompt from summary messages", () => {
  const summaryMessages = [
    { role: "user", content: "What is the project structure?" },
    { role: "assistant", content: "It has src/, test/, and docs/ directories." },
    { role: "user", content: "Create a new module." },
  ];

  const prompt = buildCompactionPrompt(summaryMessages);

  assert.ok(prompt.includes("Summarize the following conversation history"));
  assert.ok(prompt.includes("3 messages"));
  assert.ok(prompt.includes("[1] user: What is the project structure?"));
  assert.ok(prompt.includes("[2] assistant: It has src/, test/, and docs/ directories."));
  assert.ok(prompt.includes("[3] user: Create a new module."));
  assert.ok(prompt.endsWith("Summary:"));
});

test("buildCompactionPrompt: handles empty summary messages", () => {
  const prompt = buildCompactionPrompt([]);

  assert.ok(prompt.includes("0 messages"));
  assert.ok(prompt.includes("Conversation history:"));
  assert.ok(prompt.endsWith("Summary:"));
});

test("buildCompactionPrompt: includes maxTokens hint when provided", () => {
  const summaryMessages = [{ role: "user", content: "Hello" }];

  const prompt = buildCompactionPrompt(summaryMessages, 500);

  assert.ok(prompt.includes("1 message"));
  assert.ok(prompt.includes("under approximately 500 tokens"));
});

test("buildCompactionPrompt: handles messages with missing content gracefully", () => {
  const summaryMessages = [
    { role: "user" },
    { role: "assistant", content: null },
  ];

  const prompt = buildCompactionPrompt(summaryMessages);

  assert.ok(prompt.includes("2 messages"));
  assert.ok(prompt.includes("[1] user: "));
  assert.ok(prompt.includes("[2] assistant: "));
});

// ---------------------------------------------------------------------------
// buildCompactMessages
// ---------------------------------------------------------------------------

test("buildCompactMessages: prepends summary to first preserve message", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));
  const summary = "The user asked about project structure and a new module was created.";

  const result = buildCompactMessages(messages, summary, 5);

  // Should have exactly 5 messages (the preserve zone).
  assert.equal(result.length, 5);
  // First message should contain the summary block.
  assert.ok(result[0].content.includes("<conversation-summary>"));
  assert.ok(result[0].content.includes(summary));
  assert.ok(result[0].content.includes("</conversation-summary>"));
  // The last four should be the unmodified tail messages.
  assert.equal(result[4].content, "message 29");
});

test("buildCompactMessages: returns only preserve zone without summary", () => {
  const messages = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ];

  const result = buildCompactMessages(messages, "", 2);

  assert.equal(result.length, 2);
  assert.equal(result[0].content, "second");
  assert.equal(result[1].content, "third");
});

test("buildCompactMessages: handles empty original messages", () => {
  const result = buildCompactMessages([], "some summary", 20);

  assert.equal(result.length, 0);
});

test("buildCompactMessages: works with whitespace-only summary", () => {
  const messages = [
    { role: "user", content: "msg 1" },
    { role: "assistant", content: "msg 2" },
  ];

  const result = buildCompactMessages(messages, "   ", 10);

  assert.equal(result.length, 2);
  // No summary block because the summary was whitespace-only.
  assert.ok(!result[0].content.includes("<conversation-summary>"));
});

test("buildCompactMessages: uses default preserveCount when not specified", () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({
    role: "user",
    content: `msg ${i}`,
  }));

  const result = buildCompactMessages(messages, "summary here");

  // Default is 20, so 20 messages should be kept.
  assert.equal(result.length, 20);
  assert.ok(result[0].content.includes("<conversation-summary>"));
});

test("buildCompactMessages: non-array input returns empty array", () => {
  const result = buildCompactMessages(null, "summary", 5);

  assert.equal(result.length, 0);
});
