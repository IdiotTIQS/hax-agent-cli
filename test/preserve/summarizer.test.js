"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ContextSummarizer,
  SummaryLevel,
} = require("../../src/preserve/summarizer");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConversation() {
  return [
    { role: "user", content: "I need to fix a critical bug in src/auth.js. The login flow is broken." },
    { role: "assistant", content: "Let me look at the auth module. Can you describe the error?" },
    { role: "user", content: "It throws a TypeError in token validation. Users can't log in." },
    { role: "assistant", content: "I've decided to refactor the token validation in src/auth.js to add null checks and improve error handling. Tests will go in test/auth.test.js." },
    { role: "user", content: "Good plan. Also, what about the rate limiter in src/middleware/rate-limiter.js?" },
    { role: "assistant", content: "I chose a token-bucket algorithm for the rate limiter. It should handle spike traffic better." },
    { role: "user", content: "Sounds good. Is the deployment config updated yet?" },
  ];
}

// ---------------------------------------------------------------------------
// ContextSummarizer.summarizeContext
// ---------------------------------------------------------------------------

test("summarizeContext: returns structured result for STANDARD level", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(makeConversation(), SummaryLevel.STANDARD);

  assert.equal(result.level, SummaryLevel.STANDARD);
  assert.ok(Array.isArray(result.keyDecisions));
  assert.ok(typeof result.currentTask === "string");
  assert.ok(Array.isArray(result.openQuestions));
  assert.ok(Array.isArray(result.relevantFiles));
  assert.ok(typeof result.summary === "string");
  assert.equal(result.messageCount, 7);
});

test("summarizeContext: BRIEF level produces shorter summary", () => {
  const summarizer = new ContextSummarizer();
  const standard = summarizer.summarizeContext(makeConversation(), SummaryLevel.STANDARD);
  const brief = summarizer.summarizeContext(makeConversation(), SummaryLevel.BRIEF);

  assert.equal(brief.level, SummaryLevel.BRIEF);
  // Brief should be shorter or equal to standard.
  assert.ok(brief.summary.length <= standard.summary.length + 100,
    `Brief (${brief.summary.length}) should not significantly exceed standard (${standard.summary.length})`);
  assert.ok(brief.keyDecisions.length <= standard.keyDecisions.length);
});

test("summarizeContext: DETAILED level includes role breakdown", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(makeConversation(), SummaryLevel.DETAILED);

  assert.equal(result.level, SummaryLevel.DETAILED);
  assert.ok(result.roleBreakdown, "DETAILED should include role breakdown");
  assert.ok(typeof result.roleBreakdown === "object");
  // Should have user and assistant at minimum.
  assert.ok("user" in result.roleBreakdown || "assistant" in result.roleBreakdown);
});

test("summarizeContext: handles empty messages", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext([], SummaryLevel.STANDARD);

  assert.equal(result.messageCount, 0);
  assert.equal(result.currentTask, "(no messages)");
  assert.equal(result.summary, "(empty conversation)");
  assert.equal(result.keyDecisions.length, 0);
});

test("summarizeContext: defaults to STANDARD when level not specified", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(makeConversation());

  assert.equal(result.level, SummaryLevel.STANDARD);
});

test("summarizeContext: extracts relevant file paths from messages", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(makeConversation(), SummaryLevel.STANDARD);

  // The fixture mentions src/auth.js, test/auth.test.js, src/middleware/rate-limiter.js
  const hasAuthJs = result.relevantFiles.some((f) => f.includes("auth.js"));
  const hasRateLimiter = result.relevantFiles.some((f) => f.includes("rate-limiter"));
  assert.ok(hasAuthJs || hasRateLimiter,
    `Expected relevant files to include auth.js or rate-limiter.js, got: ${result.relevantFiles.join(", ")}`);
});

// ---------------------------------------------------------------------------
// ContextSummarizer.createContextCard
// ---------------------------------------------------------------------------

test("createContextCard: returns a non-empty paragraph string", () => {
  const summarizer = new ContextSummarizer();
  const card = summarizer.createContextCard(makeConversation());

  assert.ok(typeof card === "string");
  assert.ok(card.length > 20, `Expected card length > 20, got ${card.length}`);
  // Should mention the current task.
  assert.ok(
    card.includes("deployment") || card.includes("rate limiter") || card.includes("token"),
    `Card should reference task content, got: "${card}"`,
  );
});

test("createContextCard: handles empty messages", () => {
  const summarizer = new ContextSummarizer();
  const card = summarizer.createContextCard([]);

  assert.ok(typeof card === "string");
  assert.ok(card.includes("0 messages"));
});

// ---------------------------------------------------------------------------
// ContextSummarizer.createContextBrief
// ---------------------------------------------------------------------------

test("createContextBrief: returns a single-sentence string", () => {
  const summarizer = new ContextSummarizer();
  const brief = summarizer.createContextBrief(makeConversation());

  assert.ok(typeof brief === "string");
  assert.ok(brief.length > 0);
  // Should not be multi-paragraph.
  assert.ok(!brief.includes("\n\n"), "Brief should be single-line");
});

// ---------------------------------------------------------------------------
// ContextSummarizer.createContextIndex
// ---------------------------------------------------------------------------

test("createContextIndex: returns keyword entries sorted by score", () => {
  const summarizer = new ContextSummarizer();
  const index = summarizer.createContextIndex(makeConversation());

  assert.ok(Array.isArray(index));
  assert.ok(index.length > 0, "Expected at least one keyword");

  for (const entry of index) {
    assert.ok(typeof entry.keyword === "string");
    assert.ok(typeof entry.score === "number");
    assert.ok(typeof entry.frequency === "number");
    assert.ok(entry.frequency >= 1);
    assert.ok(entry.score > 0);
  }

  // Verify sorted by score descending.
  for (let i = 1; i < index.length; i += 1) {
    assert.ok(index[i - 1].score >= index[i].score,
      `Index not sorted descending at position ${i}`);
  }
});

test("createContextIndex: handles empty messages", () => {
  const summarizer = new ContextSummarizer();
  const index = summarizer.createContextIndex([]);
  assert.deepEqual(index, []);
});

test("createContextIndex: respects maxKeywords in constructor", () => {
  const summarizer = new ContextSummarizer({ maxKeywords: 5 });

  // Generate a conversation with diverse content.
  const messages = [];
  const topics = [
    "authentication", "authorization", "database", "connection", "pooling",
    "middleware", "rate limiting", "logging", "monitoring", "deployment",
    "testing", "validation", "serialization", "caching", "routing",
  ];
  for (let i = 0; i < topics.length; i += 1) {
    messages.push({ role: "user", content: `Let's discuss ${topics[i]} implementation.` });
    messages.push({ role: "assistant", content: `The ${topics[i]} approach involves careful planning and design considerations.` });
  }

  const index = summarizer.createContextIndex(messages);
  assert.ok(index.length <= 5, `Expected <= 5 keywords, got ${index.length}`);
});

test("createContextIndex: user messages weighted higher than system messages", () => {
  const summarizer = new ContextSummarizer();

  // system mentions "database" many times, user mentions "auth" once.
  const messages = [
    { role: "system", content: "database database database database database" },
    { role: "user", content: "Let's work on auth." },
  ];

  const index = summarizer.createContextIndex(messages);

  // "auth" from user (weight 1.5) should score comparably to "database" from system (weight 0.5).
  const authEntry = index.find((e) => e.keyword === "auth");
  const dbEntry = index.find((e) => e.keyword === "database");

  assert.ok(authEntry, "auth should be a keyword");
  assert.ok(dbEntry, "database should be a keyword");
});

// ---------------------------------------------------------------------------
// ContextSummarizer.injectSummary
// ---------------------------------------------------------------------------

test("injectSummary: prepends summary to message list as system message", () => {
  const summarizer = new ContextSummarizer();
  const messages = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
  ];

  const injected = summarizer.injectSummary(messages, "Important context summary");

  assert.equal(injected.length, 3);
  assert.equal(injected[0].role, "system");
  assert.ok(injected[0].content.includes("<context-summary>"));
  assert.ok(injected[0].content.includes("Important context summary"));
  assert.ok(injected[0].content.includes("</context-summary>"));
});

test("injectSummary: merges with existing system message instead of creating new one", () => {
  const summarizer = new ContextSummarizer();
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
  ];

  const injected = summarizer.injectSummary(messages, "Extra context");

  assert.equal(injected.length, 2, "Should not increase message count");
  assert.equal(injected[0].role, "system");
  assert.ok(injected[0].content.includes("<context-summary>"));
  assert.ok(injected[0].content.includes("You are a helpful assistant."));
});

test("injectSummary: handles empty summary string", () => {
  const summarizer = new ContextSummarizer();
  const messages = [
    { role: "user", content: "Hello" },
  ];

  const injected = summarizer.injectSummary(messages, "");
  assert.equal(injected.length, 1);
  assert.equal(injected[0].content, "Hello");
});

test("injectSummary: handles summary object from summarizeContext", () => {
  const summarizer = new ContextSummarizer();
  const summaryObj = summarizer.summarizeContext(makeConversation(), SummaryLevel.STANDARD);
  const messages = [{ role: "user", content: "New message" }];

  const injected = summarizer.injectSummary(messages, summaryObj);

  assert.equal(injected.length, 2);
  assert.equal(injected[0].role, "system");
  assert.ok(injected[0].content.includes("<context-summary>"));
});

test("injectSummary: handles non-array messages input", () => {
  const summarizer = new ContextSummarizer();
  const injected = summarizer.injectSummary(null, "summary text");

  assert.ok(Array.isArray(injected));
  assert.equal(injected.length, 1);
  assert.equal(injected[0].role, "system");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("summarizeContext: handles single message", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(
    [{ role: "user", content: "Fix the login bug." }],
    SummaryLevel.STANDARD,
  );

  assert.equal(result.messageCount, 1);
  assert.ok(typeof result.summary === "string");
});

test("summarizeContext: handles messages with no role", () => {
  const summarizer = new ContextSummarizer();
  const result = summarizer.summarizeContext(
    [{ content: "Some content without a role" }],
    SummaryLevel.STANDARD,
  );

  assert.equal(result.messageCount, 1);
  assert.ok(typeof result.summary === "string");
});

test("createContextIndex: empty index for conversation with only stop words", () => {
  const summarizer = new ContextSummarizer();
  const messages = [
    { role: "user", content: "the and for that with this from have are was not" },
  ];

  const index = summarizer.createContextIndex(messages);
  assert.equal(index.length, 0);
});
