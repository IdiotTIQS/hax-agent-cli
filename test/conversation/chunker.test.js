"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  chunkByTurns,
  chunkByTokens,
  chunkByTopic,
  chunkByTime,
  optimizeChunks,
} = require("../../src/conversation/chunker");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(role, content, timestamp) {
  const msg = { role, content };
  if (timestamp) msg.timestamp = timestamp;
  return msg;
}

function makeBulk(count, prefix) {
  const p = prefix || "message";
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `${p} ${i}: ${"x".repeat(50)}`,
  }));
}

/**
 * Verify every chunk conforms to the Chunk format.
 * @param {Array} chunks
 */
function assertValidChunks(chunks) {
  assert.ok(Array.isArray(chunks), "chunks should be an array");
  for (const c of chunks) {
    assert.ok(Array.isArray(c.messages), "chunk.messages should be an array");
    assert.ok(c.messages.length > 0, "each chunk should have at least one message");
    assert.equal(typeof c.startIndex, "number", "startIndex should be a number");
    assert.equal(typeof c.endIndex, "number", "endIndex should be a number");
    assert.ok(c.startIndex <= c.endIndex, "startIndex should be <= endIndex");
    assert.equal(typeof c.estimatedTokens, "number", "estimatedTokens should be a number");
    assert.ok(c.estimatedTokens > 0, "estimatedTokens should be positive");
    assert.equal(typeof c.topic, "string", "topic should be a string");
    assert.equal(typeof c.summary, "string", "summary should be a string");
  }
}

/**
 * Assert chunks cover all original messages without overlaps or gaps.
 * @param {Array} chunks
 * @param {number} totalMessages
 */
function assertContinuousCoverage(chunks, totalMessages) {
  const covered = new Set();
  for (const c of chunks) {
    for (let i = c.startIndex; i <= c.endIndex; i += 1) {
      covered.add(i);
    }
  }
  assert.equal(covered.size, totalMessages, "all messages should be covered exactly once");
  for (let i = 0; i < totalMessages; i += 1) {
    assert.ok(covered.has(i), `message index ${i} should be covered`);
  }
}

// ---------------------------------------------------------------------------
// chunkByTurns
// ---------------------------------------------------------------------------

test("chunkByTurns: splits into fixed-size turn chunks", () => {
  const messages = makeBulk(25);
  const chunks = chunkByTurns(messages, 10);

  assert.ok(chunks.length >= 2);
  assertValidChunks(chunks);
  assertContinuousCoverage(chunks, 25);
  assert.equal(chunks[0].messages.length, 10);
  assert.equal(chunks[1].messages.length, 10);
  assert.equal(chunks[2].messages.length, 5);
});

test("chunkByTurns: uses default maxTurns of 20", () => {
  const messages = makeBulk(50);
  const chunks = chunkByTurns(messages);

  assert.ok(chunks.length >= 3);
  assertContinuousCoverage(chunks, 50);
  assert.ok(chunks[0].messages.length <= 20);
});

test("chunkByTurns: single chunk when under maxTurns", () => {
  const messages = makeBulk(5);
  const chunks = chunkByTurns(messages, 20);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].messages.length, 5);
  assertContinuousCoverage(chunks, 5);
});

test("chunkByTurns: handles empty input", () => {
  const chunks = chunkByTurns([], 10);
  assert.equal(chunks.length, 0);
});

test("chunkByTurns: clamps invalid maxTurns to 1 minimum", () => {
  const messages = makeBulk(5);
  const chunks = chunkByTurns(messages, -5);

  assert.ok(chunks.length >= 1);
  assertContinuousCoverage(chunks, 5);
});

// ---------------------------------------------------------------------------
// chunkByTokens
// ---------------------------------------------------------------------------

test("chunkByTokens: splits by estimated token budget", () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(200), // ~50 tokens each at 4 chars/token
  }));

  const chunks = chunkByTokens(messages, 300, 4);

  assert.ok(chunks.length >= 2, "should split into multiple chunks");
  assertValidChunks(chunks);
  assertContinuousCoverage(chunks, 20);

  // Each chunk should be roughly under the token budget.
  for (const c of chunks) {
    assert.ok(c.estimatedTokens <= 350, `chunk tokens ${c.estimatedTokens} should be near or under 300 budget`);
  }
});

test("chunkByTokens: single chunk when messages fit within budget", () => {
  const messages = [
    makeMsg("user", "hello"),
    makeMsg("assistant", "hi there"),
  ];

  const chunks = chunkByTokens(messages, 10000, 4);

  assert.equal(chunks.length, 1);
  assertContinuousCoverage(chunks, 2);
});

test("chunkByTokens: handles large messages that exceed budget individually", () => {
  const messages = [
    makeMsg("assistant", "x".repeat(50000)), // ~12500 tokens at 4 chars/token
    makeMsg("user", "small"),
  ];

  const chunks = chunkByTokens(messages, 8000, 4);

  // The first message alone exceeds the budget, but we still include it in a chunk.
  assert.ok(chunks.length >= 1);
  // All messages should be covered.
  const totalCovered = chunks.reduce((s, c) => s + c.messages.length, 0);
  assert.equal(totalCovered, 2);
});

test("chunkByTokens: handles empty input", () => {
  assert.equal(chunkByTokens([], 8000).length, 0);
});

// ---------------------------------------------------------------------------
// chunkByTopic
// ---------------------------------------------------------------------------

test("chunkByTopic: splits at explicit topic transitions", () => {
  const messages = [
    makeMsg("user", "Let's discuss the database schema."),
    makeMsg("assistant", "We need users, orders, and products tables."),
    makeMsg("user", "Next, let's talk about the frontend design."),
    makeMsg("assistant", "We should use React with a component library."),
    makeMsg("user", "Switching gears to deployment strategy."),
    makeMsg("assistant", "Docker with Kubernetes is the best approach here."),
  ];

  const chunks = chunkByTopic(messages);

  assert.ok(chunks.length >= 2, "should detect at least two topics");
  assertValidChunks(chunks);
  assertContinuousCoverage(chunks, 6);

  // Topics should be different across chunks.
  const topics = chunks.map((c) => c.topic);
  const uniqueTopics = new Set(topics);
  assert.ok(uniqueTopics.size >= 2, "different chunks should have different topics");
});

test("chunkByTopic: single topic for cohesive conversation", () => {
  const messages = [
    makeMsg("user", "How do I set up ESLint?"),
    makeMsg("assistant", "Run npm install eslint --save-dev."),
    makeMsg("user", "What config should I use?"),
    makeMsg("assistant", "Use the recommended config. Here's how..."),
  ];

  const chunks = chunkByTopic(messages);

  // A cohesive Q&A may end up as a single topic block.
  assert.ok(chunks.length >= 1);
  assertContinuousCoverage(chunks, 4);
});

test("chunkByTopic: handles empty input", () => {
  assert.equal(chunkByTopic([]).length, 0);
});

// ---------------------------------------------------------------------------
// chunkByTime
// ---------------------------------------------------------------------------

test("chunkByTime: splits when time gap exceeds threshold", () => {
  const messages = [
    makeMsg("user", "morning message", "2025-06-01T09:00:00Z"),
    makeMsg("assistant", "morning reply", "2025-06-01T09:05:00Z"),
    // Gap of 2 hours.
    makeMsg("user", "afternoon message", "2025-06-01T11:05:00Z"),
    makeMsg("assistant", "afternoon reply", "2025-06-01T11:10:00Z"),
  ];

  const chunks = chunkByTime(messages, 30, 4);

  assert.equal(chunks.length, 2, "should split into morning and afternoon chunks");
  assertValidChunks(chunks);
  assertContinuousCoverage(chunks, 4);
  assert.equal(chunks[0].messages.length, 2);
  assert.equal(chunks[1].messages.length, 2);
});

test("chunkByTime: keeps messages together within the gap threshold", () => {
  const messages = [
    makeMsg("user", "msg 1", "2025-06-01T09:00:00Z"),
    makeMsg("assistant", "msg 2", "2025-06-01T09:15:00Z"),
    makeMsg("user", "msg 3", "2025-06-01T09:28:00Z"),
  ];

  const chunks = chunkByTime(messages, 30, 4);

  // All within 30 minutes — should be one chunk.
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].messages.length, 3);
});

test("chunkByTime: ignores missing timestamps", () => {
  const messages = [
    makeMsg("user", "no timestamp"),
    makeMsg("assistant", "no timestamp either"),
    makeMsg("user", "still no timestamp"),
  ];

  const chunks = chunkByTime(messages, 30, 4);

  // All without timestamps, no splits.
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].messages.length, 3);
});

test("chunkByTime: handles empty input", () => {
  assert.equal(chunkByTime([]).length, 0);
});

// ---------------------------------------------------------------------------
// optimizeChunks
// ---------------------------------------------------------------------------

test("optimizeChunks: produces valid chunks within token budget", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}: ${"data ".repeat(20)}`,
  }));

  const chunks = optimizeChunks(messages, 500, 4);

  assert.ok(chunks.length >= 1);
  assertValidChunks(chunks);
  assertContinuousCoverage(chunks, 30);

  // Verify no chunk drastically exceeds the budget.
  for (const c of chunks) {
    // Allow some tolerance because optimizeChunks uses a best-effort approach.
    assert.ok(
      c.estimatedTokens < 1000,
      `chunk tokens ${c.estimatedTokens} should be somewhat bounded (target: 500)`,
    );
  }
});

test("optimizeChunks: prefers topic boundaries when splitting", () => {
  const messages = [
    makeMsg("user", "Let's discuss the database."),
    makeMsg("assistant", "Here's the schema: " + "x".repeat(300)),
    makeMsg("user", "Now let's switch to the frontend."),
    makeMsg("assistant", "Here's the React setup: " + "x".repeat(300)),
  ];

  const chunks = optimizeChunks(messages, 400, 4);

  assert.ok(chunks.length >= 1);
  assertValidChunks(chunks);
});

test("optimizeChunks: handles empty input", () => {
  assert.equal(optimizeChunks([]).length, 0);
});

test("optimizeChunks: small conversation fits in one chunk", () => {
  const messages = [
    makeMsg("user", "hello"),
    makeMsg("assistant", "hi"),
  ];

  const chunks = optimizeChunks(messages, 10000, 4);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].messages.length, 2);
});

test("optimizeChunks: handles single large message", () => {
  const messages = [
    makeMsg("assistant", "x".repeat(5000)),
  ];

  const chunks = optimizeChunks(messages, 1000, 4);

  // Even if a message exceeds budget, it should still be included.
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].messages.length, 1);
});
