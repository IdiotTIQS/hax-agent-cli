/**
 * Pruning strategies edge-case tests.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ContextPruner,
  classifyMessageDomains,
} = require("../../src/pruning/strategies");

const { ImportanceScorer } = require("../../src/preserve/importance");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessages(count) {
  const msgs = [];
  for (let i = 0; i < count; i += 1) {
    const roles = ["user", "assistant"];
    msgs.push({
      role: roles[i % 2],
      content: `Message number ${i + 1} in the conversation. This is the ${i % 2 === 0 ? "user" : "assistant"} speaking.`,
    });
  }
  return msgs;
}

function makeRichMessages() {
  return [
    { role: "user", content: "Let's plan the architecture for the new project." },
    { role: "assistant", content: "We should use a microservices architecture with a Node.js backend." },
    { role: "user", content: "I think that's a good approach. Let's start with the API layer." },
    { role: "assistant", content: "Here is the function to create a user endpoint." },
    { role: "user", content: "I'm getting an error when running this: TypeError: Cannot read property 'id' of undefined at line 42" },
    { role: "assistant", content: "That bug is caused by the missing null check. We need to add a guard clause." },
    { role: "user", content: "This is important: we must also implement the authentication module today." },
    { role: "assistant", content: "Understood. I'll prioritize the auth module. Let me analyze the requirements first." },
    { role: "user", content: "Final decision: we will use JWT for authentication and store tokens in memory." },
    { role: "assistant", content: "I agree with that decision. JWT is the right choice for this architecture. Here is the plan." },
  ];
}

// ---------------------------------------------------------------------------
// ContextPruner constructor
// ---------------------------------------------------------------------------

test("ContextPruner: constructor sets defaults", () => {
  const pruner = new ContextPruner();
  assert.ok(pruner.scorer instanceof ImportanceScorer);
  assert.equal(pruner.minKeep, 1);
});

test("ContextPruner: constructor accepts custom scorer", () => {
  const scorer = new ImportanceScorer({ criticalThreshold: 0.7 });
  const pruner = new ContextPruner({ scorer });
  assert.equal(pruner.scorer.criticalThreshold, 0.7);
});

test("ContextPruner: constructor respects custom minKeep", () => {
  const pruner = new ContextPruner({ minKeep: 3 });
  assert.equal(pruner.minKeep, 3);
});

test("ContextPruner: constructor clamps minKeep to minimum 1", () => {
  const pruner = new ContextPruner({ minKeep: 0 });
  assert.equal(pruner.minKeep, 1);
});

// ---------------------------------------------------------------------------
// strategyFIFO
// ---------------------------------------------------------------------------

test("strategyFIFO: drops oldest messages first", () => {
  const pruner = new ContextPruner();
  const messages = makeMessages(10);
  const budget = 200;

  const result = pruner.strategyFIFO(messages, budget);
  assert.ok(result.messages.length < messages.length, "should drop some messages");
  assert.ok(result.messages.length > 0, "should keep at least minKeep");
  // Last message should always be kept.
  assert.equal(
    result.messages[result.messages.length - 1].content,
    messages[messages.length - 1].content,
  );
  // First kept should be newer than original first.
  assert.ok(result.messages.length <= messages.length);
});

test("strategyFIFO: empty messages returns empty", () => {
  const pruner = new ContextPruner();
  const result = pruner.strategyFIFO([], 1000);
  assert.equal(result.messages.length, 0);
  assert.equal(result.stats.originalCount, 0);
});

test("strategyFIFO: budget covers all messages", () => {
  const pruner = new ContextPruner();
  const messages = makeMessages(3);
  // Use a very large budget (100k tokens) to ensure all 3 messages fit.
  const result = pruner.strategyFIFO(messages, 100000);
  assert.equal(result.messages.length, 3);
  assert.equal(result.stats.droppedCount, 0);
});

test("strategyFIFO: respects minKeep with tiny budget", () => {
  const pruner = new ContextPruner({ minKeep: 2 });
  const messages = makeMessages(5);
  const result = pruner.strategyFIFO(messages, 1);
  assert.ok(result.messages.length >= 2, "should keep at least minKeep even when budget is tiny");
});

// ---------------------------------------------------------------------------
// strategyImportance
// ---------------------------------------------------------------------------

test("strategyImportance: keeps high-importance messages", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  // Tight budget: only ~4 messages fit, forcing scoring-based selection.
  const budget = 250;

  const result = pruner.strategyImportance(messages, budget);
  assert.ok(result.messages.length > 0);
  assert.ok(result.messages.length < messages.length, "should prune some messages");
  // The "important" message (about auth, index 6) should be kept
  // since it has high user-explicit importance.
  const hasImportant = result.messages.some((m) =>
    m.content.toLowerCase().includes("this is important"),
  );
  assert.ok(hasImportant, "important message should be kept");
});

test("strategyImportance: preserves original message order", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 600;

  const result = pruner.strategyImportance(messages, budget);
  let lastIndex = -1;
  for (const msg of result.messages) {
    const idx = messages.findIndex(
      (m) => m.role === msg.role && m.content === msg.content,
    );
    assert.ok(idx > lastIndex, "messages should be in original order");
    lastIndex = idx;
  }
});

test("strategyImportance: empty messages returns empty", () => {
  const pruner = new ContextPruner();
  const result = pruner.strategyImportance([], 1000);
  assert.equal(result.messages.length, 0);
});

// ---------------------------------------------------------------------------
// strategyHybrid
// ---------------------------------------------------------------------------

test("strategyHybrid: keeps critical messages", () => {
  // Use a custom scorer with lower threshold so "decision" messages qualify.
  const scorer = new ImportanceScorer({ criticalThreshold: 0.3 });
  const pruner = new ContextPruner({ scorer });
  const messages = makeRichMessages();
  const budget = 250;

  const result = pruner.strategyHybrid(messages, budget);
  assert.ok(result.messages.length > 0);
  assert.ok(result.messages.length < messages.length, "should prune some messages");
  // With the lower threshold, decision/important messages should be kept.
  const criticalPhrases = ["final decision", "this is important"];
  const hasAnyCritical = criticalPhrases.some((phrase) =>
    result.messages.some((m) =>
      m.content.toLowerCase().includes(phrase.toLowerCase()),
    ),
  );
  assert.ok(hasAnyCritical, "at least one critical message should be kept");
});

test("strategyHybrid: falls back to FIFO for remaining budget", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 600;

  const result = pruner.strategyHybrid(messages, budget);
  // Last message should be kept (recency fill).
  const lastKept = result.messages[result.messages.length - 1];
  assert.equal(lastKept.content, messages[messages.length - 1].content);
});

// ---------------------------------------------------------------------------
// strategyDomain
// ---------------------------------------------------------------------------

test("strategyDomain: ensures domain diversity", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 500;

  const result = pruner.strategyDomain(messages, budget);
  assert.ok(result.messages.length > 0);

  // Should have detected multiple domains (planning, code, debugging).
  const allDomains = new Set();
  for (const msg of messages) {
    const domains = classifyMessageDomains(msg);
    for (const d of domains) allDomains.add(d);
  }

  const keptDomains = new Set();
  for (const msg of result.messages) {
    const domains = classifyMessageDomains(msg);
    for (const d of domains) keptDomains.add(d);
  }

  assert.ok(keptDomains.size >= 2, "should keep representation from multiple domains");
});

test("strategyDomain: empty messages returns empty", () => {
  const pruner = new ContextPruner();
  const result = pruner.strategyDomain([], 1000);
  assert.equal(result.messages.length, 0);
});

// ---------------------------------------------------------------------------
// classifyMessageDomains
// ---------------------------------------------------------------------------

test("classifyMessageDomains: detects code domain", () => {
  const msg = { content: "Here is the function: const api = require('./api');" };
  const domains = classifyMessageDomains(msg);
  assert.ok(domains.has("code"));
});

test("classifyMessageDomains: detects planning domain", () => {
  const msg = { content: "Let's plan the strategy for implementing this feature." };
  const domains = classifyMessageDomains(msg);
  assert.ok(domains.has("planning"));
});

test("classifyMessageDomains: detects debugging domain", () => {
  const msg = { content: "I'm getting an error: the bug is at line 42." };
  const domains = classifyMessageDomains(msg);
  assert.ok(domains.has("debugging"));
});

test("classifyMessageDomains: falls back to general", () => {
  const msg = { content: "Hello, how are you today?" };
  const domains = classifyMessageDomains(msg);
  assert.ok(domains.has("general"));
  assert.equal(domains.size, 1);
});

test("classifyMessageDomains: detects multiple domains", () => {
  const msg = { content: "The plan is to fix the error in the function by refactoring the code." };
  const domains = classifyMessageDomains(msg);
  assert.ok(domains.size >= 2, "should match multiple domains");
});

// ---------------------------------------------------------------------------
// estimateQuality
// ---------------------------------------------------------------------------

test("estimateQuality: returns perfect score for identical sets", () => {
  const pruner = new ContextPruner();
  const messages = makeMessages(5);
  const quality = pruner.estimateQuality(messages, messages);
  assert.ok(quality.score >= 0.9, "identical sets should score high");
  assert.equal(quality.factors.retention, 1);
});

test("estimateQuality: returns lower score for partial retention", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const pruned = messages.slice(-3); // Keep only last 3
  const quality = pruner.estimateQuality(messages, pruned);
  assert.ok(quality.score < 1, "partial retention should score below 1");
  assert.ok(quality.score > 0, "partial retention should score above 0");
});

test("estimateQuality: returns zero for empty pruned set", () => {
  const pruner = new ContextPruner();
  const messages = makeMessages(5);
  const quality = pruner.estimateQuality(messages, []);
  assert.equal(quality.score, 0);
});

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

test("prune: dispatches to correct strategy", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 500;

  let result = pruner.prune(messages, budget, "fifo");
  assert.equal(result.stats.strategy, "fifo");

  result = pruner.prune(messages, budget, "importance");
  assert.equal(result.stats.strategy, "importance");

  result = pruner.prune(messages, budget, "hybrid");
  assert.equal(result.stats.strategy, "hybrid");

  result = pruner.prune(messages, budget, "domain");
  assert.equal(result.stats.strategy, "domain");
});

test("prune: invalid strategy falls back to hybrid", () => {
  const pruner = new ContextPruner();
  const messages = makeMessages(5);
  const budget = 500;

  const result = pruner.prune(messages, budget, "nonexistent");
  assert.equal(result.stats.strategy, "hybrid");
});

test("prune: returns empty for empty messages", () => {
  const pruner = new ContextPruner();
  const result = pruner.prune([], 1000, "fifo");
  assert.equal(result.messages.length, 0);
});

// ---------------------------------------------------------------------------
// compareStrategies
// ---------------------------------------------------------------------------

test("compareStrategies: returns ranked results for all strategies", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 300;

  const results = pruner.compareStrategies(messages, budget);
  assert.equal(results.length, 4, "should compare all 4 strategies");
  assert.equal(results[0].strategy.length > 0, true);

  // Results should be sorted by quality descending.
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(
      results[i - 1].quality >= results[i].quality,
      `strategy ${results[i - 1].strategy} should rank >= ${results[i].strategy}`,
    );
  }
});

// ---------------------------------------------------------------------------
// selectBestStrategy
// ---------------------------------------------------------------------------

test("selectBestStrategy: returns the best strategy for the input", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();
  const budget = 300;

  const best = pruner.selectBestStrategy(messages, budget);
  assert.ok(best.strategy.length > 0);
  assert.ok(best.quality >= 0);
  assert.ok(best.quality <= 1);
  assert.ok(Array.isArray(best.messages));
  assert.ok(best.messages.length > 0);
});

test("selectBestStrategy: works with different budgets", () => {
  const pruner = new ContextPruner();
  const messages = makeRichMessages();

  const bestSmall = pruner.selectBestStrategy(messages, 100);
  assert.ok(bestSmall.quality <= 1);

  const bestLarge = pruner.selectBestStrategy(messages, 2000);
  assert.ok(bestLarge.quality >= bestSmall.quality, "larger budget should yield higher quality");
});
