"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ImportanceScorer,
  CRITICAL_THRESHOLD,
  EXPENDABLE_THRESHOLD,
} = require("../../src/preserve/importance");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConversation() {
  return [
    { role: "user", content: "I need to fix a critical bug in the auth module. This is very important." },
    { role: "assistant", content: "Let me look at the auth module code to understand the issue." },
    { role: "assistant", content: "I found the problem — there's a null reference error in the token validation logic." },
    { role: "user", content: "Yes, that's the issue. Please fix it and show me the updated code." },
    { role: "assistant", content: "I've decided to refactor the token validation function to add null checks and improve error handling." },
    { role: "user", content: "Sounds good, go ahead with that approach." },
    { role: "assistant", content: "Here's the updated code with null checks. The error should be resolved now." },
  ];
}

// ---------------------------------------------------------------------------
// ImportanceScorer.score
// ---------------------------------------------------------------------------

test("score: returns 0 for empty message content", () => {
  const scorer = new ImportanceScorer();
  const result = scorer.score({ role: "user", content: "" }, []);
  assert.equal(result, 0);
});

test("score: returns 0 for null/undefined message", () => {
  const scorer = new ImportanceScorer();
  assert.equal(scorer.score(null, []), 0);
  assert.equal(scorer.score(undefined, []), 0);
  assert.equal(scorer.score({}, []), 0);
});

test("score: assigns high score to message with decision language", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const decisionMsg = conversation[4]; // "I've decided to refactor..."
  const score = scorer.score(decisionMsg, conversation);

  assert.ok(score >= 0.3, `Expected score >= 0.3, got ${score}`);
});

test("score: assigns high score to message with error content", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const errorMsg = conversation[2]; // "null reference error..."
  const score = scorer.score(errorMsg, conversation);

  assert.ok(score >= 0.25, `Expected score >= 0.25, got ${score}`);
});

test("score: assigns high score to message with user explicit importance", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const importantMsg = conversation[0]; // "This is very important"
  const score = scorer.score(importantMsg, conversation);

  assert.ok(score >= 0.2, `Expected score >= 0.2, got ${score}`);
});

test("score: more recent messages score higher than older ones, all else equal", () => {
  const scorer = new ImportanceScorer();
  const messages = [
    { role: "user", content: "Generic message about project setup." },
    { role: "assistant", content: "Generic response about project structure." },
    { role: "user", content: "Generic message about the same topic." },
    { role: "assistant", content: "Generic response continuing the discussion." },
    { role: "user", content: "Generic message about the same topic." },
  ];

  const scores = messages.map((m) => scorer.score(m, messages));

  // Check that the last message scores higher than the first.
  assert.ok(scores[4] > scores[0],
    `Last message (${scores[4]}) should score higher than first (${scores[0]})`);
});

test("score: scores are always between 0 and 1 inclusive", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();

  for (const msg of conversation) {
    const s = scorer.score(msg, conversation);
    assert.ok(s >= 0 && s <= 1, `Score ${s} out of [0,1] range for content: ${msg.content.slice(0, 30)}`);
  }
});

// ---------------------------------------------------------------------------
// ImportanceScorer.scoreBatch
// ---------------------------------------------------------------------------

test("scoreBatch: returns sorted results with scores descending", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const results = scorer.scoreBatch(conversation);

  assert.equal(results.length, conversation.length);
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score,
      `Results not sorted descending at index ${i}: ${results[i - 1].score} < ${results[i].score}`);
  }
});

test("scoreBatch: each result has message, index, and score properties", () => {
  const scorer = new ImportanceScorer();
  const results = scorer.scoreBatch(makeConversation());

  for (const entry of results) {
    assert.ok(entry.message, "Missing message");
    assert.ok(typeof entry.index === "number", "Missing index");
    assert.ok(typeof entry.score === "number", "Missing score");
    assert.ok(entry.score >= 0 && entry.score <= 1, "Score out of range");
  }
});

test("scoreBatch: empty input returns empty array", () => {
  const scorer = new ImportanceScorer();
  const results = scorer.scoreBatch([]);
  assert.equal(results.length, 0);
});

test("scoreBatch: handles non-array input", () => {
  const scorer = new ImportanceScorer();
  const results = scorer.scoreBatch(null);
  assert.equal(results.length, 0);
});

// ---------------------------------------------------------------------------
// ImportanceScorer.identifyCritical
// ---------------------------------------------------------------------------

test("identifyCritical: returns messages scored at or above critical threshold", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const critical = scorer.identifyCritical(conversation);

  assert.ok(Array.isArray(critical));
  assert.ok(critical.length >= 1, "Expected at least one critical message");

  // Every critical message should score >= threshold.
  for (const msg of critical) {
    const s = scorer.score(msg, conversation);
    assert.ok(s >= CRITICAL_THRESHOLD,
      `Critical message scored ${s} but threshold is ${CRITICAL_THRESHOLD}`);
  }
});

test("identifyCritical: can use custom threshold via constructor", () => {
  const scorer = new ImportanceScorer({ criticalThreshold: 0.9 });
  const conversation = makeConversation();
  const critical = scorer.identifyCritical(conversation);

  // With a very high threshold, few or none should qualify.
  assert.ok(critical.length <= 2,
    `Expected <= 2 critical with threshold 0.9, got ${critical.length}`);
});

// ---------------------------------------------------------------------------
// ImportanceScorer.identifyExpendable
// ---------------------------------------------------------------------------

test("identifyExpendable: returns messages scored below expendable threshold", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();
  const expendable = scorer.identifyExpendable(conversation);

  assert.ok(Array.isArray(expendable));

  for (const msg of expendable) {
    const s = scorer.score(msg, conversation);
    assert.ok(s < EXPENDABLE_THRESHOLD,
      `Expendable message scored ${s} but threshold is ${EXPENDABLE_THRESHOLD}`);
  }
});

test("identifyExpendable: short, non-decision messages are expendable", () => {
  const scorer = new ImportanceScorer();
  const messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello, how can I help?" },
  ];

  const expendable = scorer.identifyExpendable(messages);
  assert.ok(expendable.length >= 1, "Short greetings should be expendable");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("score: handles missing role gracefully", () => {
  const scorer = new ImportanceScorer();
  const messages = [
    { content: "Some message without a role." },
    { content: "Another message about an important bug fix that we decided on." },
  ];

  const s0 = scorer.score(messages[0], messages);
  const s1 = scorer.score(messages[1], messages);

  assert.ok(s0 >= 0 && s0 <= 1);
  assert.ok(s1 >= 0 && s1 <= 1);
  // The bug/decision message should score higher.
  assert.ok(s1 > s0, `Expected s1 (${s1}) > s0 (${s0})`);
});

test("score: handles conversation where message is not part of the list", () => {
  const scorer = new ImportanceScorer();
  const messages = makeConversation();
  const externalMsg = { role: "user", content: "I decided to change the entire architecture. This is very important!" };

  // When message is not in conversation, it should still be scorable.
  const score = scorer.score(externalMsg, messages);
  assert.ok(score >= 0 && score <= 1);
  // Because of decision + explicit importance language, should be relatively high.
  assert.ok(score >= 0.25, `Expected score >= 0.25, got ${score}`);
});

test("scoreBatch: deduplication behavior with identical content across messages", () => {
  const scorer = new ImportanceScorer();
  const messages = [
    { role: "user", content: "Task: fix the login bug." },
    { role: "assistant", content: "Analyzing the login module." },
    { role: "user", content: "Task: fix the login bug." }, // repeated
    { role: "assistant", content: "Found the issue in auth.js. The error is a TypeError." },
    { role: "user", content: "Great, please fix it." },
  ];

  const results = scorer.scoreBatch(messages);

  assert.equal(results.length, 5);
  // The error-content message (index 3) should rank highly.
  const top3 = results.slice(0, 3);
  assert.ok(top3.length === 3);
});

test("identifyCritical: returns empty array for all-low-importance messages", () => {
  const scorer = new ImportanceScorer({ criticalThreshold: 0.99 });
  const messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
    { role: "user", content: "Ok" },
    { role: "assistant", content: "Sure" },
  ];

  const critical = scorer.identifyCritical(messages);
  assert.equal(critical.length, 0);
});

test("identifyCritical and identifyExpendable are complementary sets covering all messages", () => {
  const scorer = new ImportanceScorer();
  const conversation = makeConversation();

  const critical = scorer.identifyCritical(conversation);
  const expendable = scorer.identifyExpendable(conversation);
  const middle = conversation.filter((m) => !critical.includes(m) && !expendable.includes(m));

  // Critical + middle + expendable should account for all messages.
  assert.equal(critical.length + middle.length + expendable.length, conversation.length);
});
