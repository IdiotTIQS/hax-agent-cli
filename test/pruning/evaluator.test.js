/**
 * Pruning evaluator edge-case tests.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PruningEvaluator } = require("../../src/pruning/evaluator");
const { ImportanceScorer } = require("../../src/preserve/importance");
const { ContextPruner } = require("../../src/pruning/strategies");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessages(count) {
  const msgs = [];
  for (let i = 0; i < count; i += 1) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}: ${i % 4 === 0 ? "Let's plan the architecture." : i % 4 === 1 ? "Here is some code for the implementation." : i % 4 === 2 ? "I found a critical bug in the error handling." : "This is an important decision: we will proceed with this approach."}`,
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
// PruningEvaluator constructor
// ---------------------------------------------------------------------------

test("PruningEvaluator: constructor sets defaults", () => {
  const evaluator = new PruningEvaluator();
  assert.ok(evaluator.scorer instanceof ImportanceScorer);
  assert.ok(evaluator.pruner instanceof ContextPruner);
});

test("PruningEvaluator: constructor accepts custom scorer and pruner", () => {
  const scorer = new ImportanceScorer({ criticalThreshold: 0.8 });
  const pruner = new ContextPruner({ minKeep: 3 });
  const evaluator = new PruningEvaluator({ scorer, pruner });
  assert.equal(evaluator.scorer.criticalThreshold, 0.8);
  assert.equal(evaluator.pruner.minKeep, 3);
});

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

test("evaluate: perfect retention gives high overall score", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeMessages(5);
  const result = evaluator.evaluate(messages, messages);
  assert.equal(result.retentionRate, 1);
  assert.equal(result.informationLoss, 0);
  // Score components: retention=1*.2 + reduction=0*.15 + info=1*.3
  //   + domain=1*.15 + importance=1*.1 + recency=1*.1 = 0.85
  assert.ok(result.overallScore >= 0.8, `expected >= 0.8, got ${result.overallScore}`);
  assert.equal(result.details.originalCount, 5);
  assert.equal(result.details.prunedCount, 5);
});

test("evaluate: partial retention produces measurable loss", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  const pruned = messages.slice(-3);

  const result = evaluator.evaluate(messages, pruned);
  assert.ok(result.retentionRate < 1);
  assert.ok(result.informationLoss >= 0);
  assert.ok(result.overallScore < 1);
  assert.equal(result.details.originalCount, 10);
  assert.equal(result.details.prunedCount, 3);
});

test("evaluate: empty original returns perfect zero-loss eval", () => {
  const evaluator = new PruningEvaluator();
  const result = evaluator.evaluate([], []);
  assert.equal(result.retentionRate, 1);
  assert.equal(result.informationLoss, 0);
  assert.equal(result.overallScore, 1);
});

test("evaluate: all messages pruned returns maximum loss", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeMessages(5);
  const result = evaluator.evaluate(messages, []);
  assert.equal(result.informationLoss, 1);
  assert.ok(result.overallScore <= 0.5, "empty pruned set should score low");
});

// ---------------------------------------------------------------------------
// getRetentionRate
// ---------------------------------------------------------------------------

test("getRetentionRate: returns correct ratio", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeMessages(10);
  const pruned = messages.slice(0, 4);
  const rate = evaluator.getRetentionRate(messages, pruned);
  assert.equal(rate, 0.4);
});

test("getRetentionRate: returns 1 for empty original", () => {
  const evaluator = new PruningEvaluator();
  const rate = evaluator.getRetentionRate([], []);
  assert.equal(rate, 1);
});

// ---------------------------------------------------------------------------
// getInformationLoss
// ---------------------------------------------------------------------------

test("getInformationLoss: returns 0 when all important messages kept", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  const loss = evaluator.getInformationLoss(messages, messages);
  assert.equal(loss, 0);
});

test("getInformationLoss: returns higher loss for dropping important content", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  // Drop messages 3-6 which include error and important messages.
  const pruned = [...messages.slice(0, 3), ...messages.slice(7)];
  const loss = evaluator.getInformationLoss(messages, pruned);
  assert.ok(loss > 0, "dropping important messages should cause loss");
});

test("getInformationLoss: returns 1 for completely empty pruned set", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeMessages(5);
  const loss = evaluator.getInformationLoss(messages, []);
  assert.equal(loss, 1);
});

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

test("compare: returns ranked results for all default strategies", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  const budget = 300;

  const results = evaluator.compare(null, messages, budget);
  assert.equal(results.length, 4);
  assert.ok(results[0].strategy.length > 0);

  // Results should be sorted by overallScore descending.
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(
      results[i - 1].overallScore >= results[i].overallScore,
      `strategy ${results[i - 1].strategy} (${results[i - 1].overallScore}) should rank >= ${results[i].strategy} (${results[i].overallScore})`,
    );
  }
});

test("compare: accepts custom strategy list", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  const budget = 300;

  const results = evaluator.compare(["fifo", "importance"], messages, budget);
  assert.equal(results.length, 2);
});

test("compare: handles empty messages", () => {
  const evaluator = new PruningEvaluator();
  const results = evaluator.compare(null, [], 1000);
  assert.equal(results.length, 4);
  for (const r of results) {
    assert.equal(r.retained, 0);
  }
});

// ---------------------------------------------------------------------------
// getBestStrategy
// ---------------------------------------------------------------------------

test("getBestStrategy: returns the best strategy for rich messages", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();
  const budget = 300;

  const best = evaluator.getBestStrategy(messages, budget);
  assert.ok(best.strategy.length > 0);
  assert.ok(best.overallScore >= 0);
  assert.ok(best.overallScore <= 1);
  assert.ok(Array.isArray(best.messages));
  assert.ok(best.retentionRate > 0);
  assert.ok(best.informationLoss < 1);
});

test("getBestStrategy: handles empty messages gracefully", () => {
  const evaluator = new PruningEvaluator();
  const best = evaluator.getBestStrategy([], 1000);
  assert.equal(best.strategy, "none");
  assert.equal(best.overallScore, 0);
  assert.equal(best.messages.length, 0);
});

test("getBestStrategy: larger budgets improve best score", () => {
  const evaluator = new PruningEvaluator();
  const messages = makeRichMessages();

  const bestTight = evaluator.getBestStrategy(messages, 100);
  const bestLoose = evaluator.getBestStrategy(messages, 2000);

  assert.ok(
    bestLoose.overallScore >= bestTight.overallScore,
    `loose budget score (${bestLoose.overallScore}) should be >= tight budget score (${bestTight.overallScore})`,
  );
});
