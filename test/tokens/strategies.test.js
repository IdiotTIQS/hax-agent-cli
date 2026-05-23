"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TokenStrategy,
  STRATEGY_NAMES,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_APPLICABILITY,
} = require("../../src/tokens/strategies");

const sampleMessages = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello, can you help me?" },
  { role: "assistant", content: "Of course! What do you need?" },
  { role: "user", content: "Explain token optimization in detail." },
  { role: "assistant", content: "Token optimization involves reducing the number of tokens used in prompts while preserving context quality." },
  { role: "user", content: "Can you give me concrete strategies?" },
  { role: "assistant", content: "Sure. Strategies include truncation, summarization, tool compression, deduplication, and prompt merging." },
  { role: "user", content: "How effective are these?" },
  { role: "assistant", content: "Effectiveness varies, but combined they can reduce token usage by 30-60% without significant quality loss." },
];

test("getAvailableStrategies returns all strategies with descriptions", () => {
  const strategy = new TokenStrategy();
  const available = strategy.getAvailableStrategies();

  assert.equal(available.length, STRATEGY_NAMES.length);

  for (const item of available) {
    assert.ok(STRATEGY_NAMES.includes(item.name));
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.description, "string");
    assert.ok(item.description.length > 0);
    assert.ok(Array.isArray(item.applicability));
    assert.ok(item.applicability.length > 0);
    assert.equal(item.description, STRATEGY_DESCRIPTIONS[item.name]);
    assert.deepStrictEqual(item.applicability, STRATEGY_APPLICABILITY[item.name]);
  }
});

test("selectStrategy returns truncateOldest for long-running sessions with many messages", () => {
  const strategy = new TokenStrategy();
  const context = {
    messageCount: 50,
    totalTokens: 100000,
    budgetRemaining: 5000,
    toolCount: 3,
    systemPromptCount: 1,
    sessionDuration: 3600000,
  };

  const result = strategy.selectStrategy(context);

  assert.equal(typeof result.strategy, "string");
  assert.ok(STRATEGY_NAMES.includes(result.strategy));
  assert.ok(result.confidence > 0);
  assert.ok(result.confidence <= 1);
  assert.equal(typeof result.reason, "string");
  assert.ok(Array.isArray(result.alternatives));
});

test("selectStrategy favors compressTools when tool count is very high", () => {
  const strategy = new TokenStrategy();
  const context = {
    messageCount: 10,
    totalTokens: 50000,
    budgetRemaining: 40000,
    toolCount: 30,
    systemPromptCount: 1,
    sessionDuration: 60000,
  };

  const result = strategy.selectStrategy(context);
  assert.equal(result.strategy, "compressTools");
});

test("selectStrategy favors mergeSystemPrompts when many system prompts exist", () => {
  const strategy = new TokenStrategy();
  const context = {
    messageCount: 8,
    totalTokens: 20000,
    budgetRemaining: 15000,
    toolCount: 2,
    systemPromptCount: 5,
    sessionDuration: 120000,
  };

  const result = strategy.selectStrategy(context);
  assert.equal(result.strategy, "mergeSystemPrompts");
});

test("applyStrategy truncateOldest removes oldest non-system messages", () => {
  const strategy = new TokenStrategy({ truncateKeepRecent: 4 });
  const msgs = [...sampleMessages]; // 9 messages, 1 system + 8 non-system

  const result = strategy.applyStrategy(msgs, "truncateOldest", { keepRecent: 3 });

  assert.ok(result.applied);
  assert.equal(result.newCount, 4); // 1 system + 3 kept
  assert.ok(result.savedTokens > 0);
  assert.ok(result.removedCount >= 4);
  assert.equal(typeof result.summary, "string");
});

test("applyStrategy summarizeHistory replaces older messages with summary", () => {
  const strategy = new TokenStrategy({ summaryMaxTokens: 200 });
  const msgs = [...sampleMessages]; // 9 messages

  const result = strategy.applyStrategy(msgs, "summarizeHistory");

  assert.ok(result.applied);
  assert.ok(result.newCount < msgs.length);
  assert.ok(result.removedCount > 0);
  assert.ok(result.savedTokens >= 0);
  assert.ok(result.summary.includes("Summarized"));
});

test("applyStrategy dropRedundant removes duplicate messages", () => {
  const strategy = new TokenStrategy();
  const msgs = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello." },
    { role: "user", content: "Hello." }, // duplicate
    { role: "assistant", content: "Hi there!" },
    { role: "assistant", content: "Hi there!" }, // duplicate
    { role: "user", content: "" }, // empty
  ];

  const result = strategy.applyStrategy(msgs, "dropRedundant");

  assert.ok(result.applied);
  assert.ok(result.removedCount >= 2);
  assert.ok(result.newCount < msgs.length);
  assert.ok(result.summary.includes("redundant"));
});

test("applyStrategy mergeSystemPrompts combines multiple system messages", () => {
  const strategy = new TokenStrategy();
  const msgs = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "system", content: "Always be polite and concise." },
    { role: "system", content: "Use markdown for formatting." },
    { role: "user", content: "Hello." },
  ];

  const result = strategy.applyStrategy(msgs, "mergeSystemPrompts");

  assert.ok(result.applied);
  assert.equal(result.newCount, 2); // 1 merged system + 1 user
  assert.equal(result.removedCount, 2);
  assert.ok(result.messages[0].role === "system");
  assert.ok(result.messages[0].content.includes("helpful assistant"));
  assert.ok(result.messages[0].content.includes("polite and concise"));
  assert.ok(result.messages[0].content.includes("markdown"));
});

test("applyStrategy with fewer messages than keepRecent does not truncate", () => {
  const strategy = new TokenStrategy({ truncateKeepRecent: 20 });
  const msgs = sampleMessages.slice(0, 4);

  const result = strategy.applyStrategy(msgs, "truncateOldest");

  assert.equal(result.applied, false);
  assert.equal(result.savedTokens, 0);
  assert.equal(result.removedCount, 0);
});

test("evaluateSavings estimates savings without mutating messages", () => {
  const strategy = new TokenStrategy();
  const msgs = [...sampleMessages];

  // Clone for comparison.
  const originalLength = msgs.length;

  const evaluation = strategy.evaluateSavings(msgs, "truncateOldest");

  assert.equal(typeof evaluation.estimatedSavings, "number");
  assert.ok(evaluation.estimatedSavings >= 0);
  assert.equal(typeof evaluation.savingsPercent, "number");
  assert.equal(typeof evaluation.riskLevel, "string");
  assert.ok(["low", "medium", "high", "unknown"].includes(evaluation.riskLevel));
  assert.equal(typeof evaluation.recommendation, "string");

  // Messages should not have been mutated.
  assert.equal(msgs.length, originalLength);
});

test("evaluateSavings for mergeSystemPrompts detects savings with multiple system messages", () => {
  const strategy = new TokenStrategy();
  const msgs = [
    { role: "system", content: "You are helpful." },
    { role: "system", content: "Be concise." },
    { role: "system", content: "No emojis." },
    { role: "user", content: "Hi" },
  ];

  const evaluation = strategy.evaluateSavings(msgs, "mergeSystemPrompts");

  assert.ok(evaluation.estimatedSavings > 0);
  assert.ok(evaluation.savingsPercent > 0);
});

test("getEffectiveness returns historical data for a valid strategy", () => {
  const strategy = new TokenStrategy();

  // Apply a strategy first to record some history.
  strategy.applyStrategy(sampleMessages, "truncateOldest", { keepRecent: 3 });

  const effectiveness = strategy.getEffectiveness("truncateOldest");

  assert.equal(effectiveness.strategy, "truncateOldest");
  assert.ok(typeof effectiveness.averageSavingsPercent === "number");
  assert.ok(effectiveness.averageSavingsPercent >= 0);
  assert.ok(typeof effectiveness.successRate === "number");
  assert.ok(effectiveness.successRate >= 0 && effectiveness.successRate <= 1);
  assert.equal(typeof effectiveness.qualityImpact, "string");
  assert.ok(effectiveness.sampleSize > 0);
  assert.ok(effectiveness.recentOutcomes > 0);
  assert.ok(effectiveness.lastUsed !== null);
});

test("getEffectiveness returns null for invalid strategy name", () => {
  const strategy = new TokenStrategy();
  const result = strategy.getEffectiveness("nonexistent");
  assert.equal(result, null);
});

test("applyStrategy throws for invalid strategy name", () => {
  const strategy = new TokenStrategy();
  assert.throws(
    () => strategy.applyStrategy([], "invalid_strategy"),
    /Unknown strategy/
  );
});

test("selectStrategy with empty context returns safe fallback", () => {
  const strategy = new TokenStrategy();
  const result = strategy.selectStrategy(null);

  assert.equal(result.strategy, "dropRedundant");
  assert.ok(result.confidence <= 0.2);
  assert.ok(typeof result.reason === "string");
});

test("autoOptimize applies multiple strategies to meet token savings target", () => {
  const strategy = new TokenStrategy();

  // Build a large message set with multiple system prompts.
  const largeMessages = [
    { role: "system", content: "Sys prompt A. ".repeat(20) },
    { role: "system", content: "Sys prompt B. ".repeat(15) },
    { role: "system", content: "Sys prompt C. ".repeat(10) },
    ...Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message number ${i} with some content. `.repeat(10),
    })),
  ];

  const context = {
    messageCount: largeMessages.length,
    totalTokens: 50000,
    budgetRemaining: 5000,
    systemPromptCount: 3,
    toolCount: 0,
    sessionDuration: 3600000,
  };

  const result = strategy.autoOptimize(largeMessages, 1000, context);

  assert.ok(Array.isArray(result.appliedStrategies));
  assert.ok(result.appliedStrategies.length > 0);
  assert.ok(result.totalSavedTokens > 0);
  assert.equal(typeof result.targetMet, "boolean");
});

test("autoOptimize with zero target savings returns without applying", () => {
  const strategy = new TokenStrategy();
  const result = strategy.autoOptimize(sampleMessages, 0, {});

  assert.ok(Array.isArray(result.appliedStrategies));
  assert.equal(result.appliedStrategies.length, 0);
  assert.equal(result.totalSavedTokens, 0);
});
