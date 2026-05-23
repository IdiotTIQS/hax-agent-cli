"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  estimateCost,
  compareCosts,
  getCheapestModel,
  CacheAwareOptimizer,
  getModelPricing,
} = require("../../src/providers/cost-optimizer");

function createMockModel(overrides = {}) {
  return {
    id: overrides.id || "mock-model",
    provider: overrides.provider || "mock",
    inputPer1k: overrides.inputPer1k ?? 0.003,
    outputPer1k: overrides.outputPer1k ?? 0.015,
    capabilities: overrides.capabilities || {},
    ...overrides,
  };
}

test("estimateCost calculates correct cost for known model", () => {
  const cost = estimateCost("claude-sonnet-4", 1000, 500);

  // claude-sonnet-4: input=$0.003/1k, output=$0.015/1k
  // input cost = 0.003 * 1000/1000 = 0.003
  // output cost = 0.015 * 500/1000 = 0.0075
  // total = 0.0105
  assert.ok(Math.abs(cost - 0.0105) < 0.0001, `Expected ~0.0105, got ${cost}`);
});

test("estimateCost calculates correct cost for GPT model", () => {
  const cost = estimateCost("gpt-4o", 2000, 1000);

  // gpt-4o: input=$0.0025/1k, output=$0.01/1k
  // input cost = 0.0025 * 2000/1000 = 0.005
  // output cost = 0.01 * 1000/1000 = 0.01
  // total = 0.015
  assert.ok(Math.abs(cost - 0.015) < 0.0001, `Expected ~0.015, got ${cost}`);
});

test("estimateCost handles zero tokens", () => {
  const cost = estimateCost("claude-sonnet-4", 0, 0);
  assert.equal(cost, 0);
});

test("estimateCost uses model object pricing when available", () => {
  const model = createMockModel({
    id: "custom-model",
    inputPer1k: 0.005,
    outputPer1k: 0.025,
  });

  const cost = estimateCost(model, 1000, 1000);
  // input: 0.005 * 1000/1000 = 0.005
  // output: 0.025 * 1000/1000 = 0.025
  // total = 0.03
  assert.ok(Math.abs(cost - 0.03) < 0.0001, `Expected ~0.03, got ${cost}`);
});

test("estimateCost handles unknown model gracefully", () => {
  const cost = estimateCost("nonexistent-model-xyz", 1000, 500);
  // Unknown model should default to 0 cost
  assert.equal(cost, 0);
});

test("compareCosts ranks models from cheapest to most expensive", () => {
  const models = [
    createMockModel({ id: "expensive", inputPer1k: 0.015, outputPer1k: 0.075 }),
    createMockModel({ id: "cheap", inputPer1k: 0.0001, outputPer1k: 0.0005 }),
    createMockModel({ id: "mid", inputPer1k: 0.001, outputPer1k: 0.005 }),
  ];

  const ranked = compareCosts(models, 1000, 500);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].model.id, "cheap");
  assert.equal(ranked[1].model.id, "mid");
  assert.equal(ranked[2].model.id, "expensive");
});

test("compareCosts returns empty array for empty input", () => {
  const ranked = compareCosts([], 1000, 500);
  assert.deepEqual(ranked, []);
});

test("getCheapestModel picks the cheapest capable model by price", () => {
  const models = [
    createMockModel({ id: "expensive", inputPer1k: 0.01, outputPer1k: 0.05 }),
    createMockModel({ id: "cheap", inputPer1k: 0.0001, outputPer1k: 0.0005 }),
  ];

  const cheapest = getCheapestModel(models);
  assert.equal(cheapest.id, "cheap");
});

test("getCheapestModel respects task requirements", () => {
  const models = [
    createMockModel({
      id: "cheap-text-only",
      inputPer1k: 0.0001,
      outputPer1k: 0.0005,
      capabilities: { vision: false, tools: true },
    }),
    createMockModel({
      id: "expensive-vision",
      inputPer1k: 0.01,
      outputPer1k: 0.05,
      capabilities: { vision: true, tools: true },
    }),
  ];

  const cheapest = getCheapestModel(models, { needsVision: true });
  assert.equal(cheapest.id, "expensive-vision");
});

test("getCheapestModel throws when no models provided", () => {
  assert.throws(() => getCheapestModel([]), /At least one model is required/);
});

test("getCheapestModel throws when no model meets requirements", () => {
  const models = [
    createMockModel({ id: "text-only", capabilities: { vision: false } }),
  ];

  assert.throws(
    () => getCheapestModel(models, { needsVision: true }),
    /No capable model found matching task requirements/,
  );
});

test("CacheAwareOptimizer shouldUseCache returns true for system prompts", () => {
  const optimizer = new CacheAwareOptimizer();

  assert.equal(optimizer.shouldUseCache("You are a helpful AI assistant that specializes in code review."), true);
});

test("CacheAwareOptimizer shouldUseCache returns true for instructions/guidelines", () => {
  const optimizer = new CacheAwareOptimizer();

  assert.equal(optimizer.shouldUseCache("These are the coding guidelines and rules for this project. Follow them strictly."), true);
});

test("CacheAwareOptimizer shouldUseCache returns false for short queries", () => {
  const optimizer = new CacheAwareOptimizer();

  assert.equal(optimizer.shouldUseCache("Hello"), false);
});

test("CacheAwareOptimizer shouldUseCache returns false for non-cacheable content", () => {
  const optimizer = new CacheAwareOptimizer();

  assert.equal(optimizer.shouldUseCache("What is the weather in San Francisco today?"), false);
});

test("CacheAwareOptimizer estimateSavings calculates prompt caching savings", () => {
  const optimizer = new CacheAwareOptimizer();

  const savings = optimizer.estimateSavings("claude-sonnet-4", 10000);

  // Standard: 0.003 * 10000/1000 = 0.03
  // Cache read: 0.0003 * 10000/1000 = 0.003
  // Savings = 0.03 - 0.003 = 0.027
  // Percentage: 0.027/0.03 * 100 = 90%
  assert.ok(savings.savings > 0, `Expected positive savings, got ${savings.savings}`);
  assert.ok(savings.percentage > 0, `Expected positive percentage, got ${savings.percentage}`);
  assert.equal(savings.tokens, 10000);
});

test("CacheAwareOptimizer estimateSavings returns zero for non-caching models", () => {
  const optimizer = new CacheAwareOptimizer();

  const model = createMockModel({
    id: "no-cache-model",
    inputPer1k: 0.01,
    outputPer1k: 0.05,
    // No cache pricing
  });

  const savings = optimizer.estimateSavings(model, 10000);
  assert.equal(savings.savings, 0);
  assert.equal(savings.percentage, 0);
});

test("CacheAwareOptimizer optimizeRequest identifies cache breakpoints in messages", () => {
  const optimizer = new CacheAwareOptimizer();

  const messages = [
    { role: "system", content: "You are a helpful coding assistant with deep expertise in software development." },
    { role: "user", content: "What is 2+2?" },
    { role: "user", content: "Please follow the coding guidelines for all responses." },
  ];

  const result = optimizer.optimizeRequest("claude-sonnet-4", messages);

  assert.ok(Array.isArray(result.cacheBreakpoints));
  assert.ok(result.cacheBreakpoints.length >= 2);
  assert.ok(result.cachedTokens > 0);
  assert.ok(result.estimatedSavings >= 0);
});

test("CacheAwareOptimizer recordQuery tracks repeated queries for reuse detection", () => {
  const optimizer = new CacheAwareOptimizer({ minReuseThreshold: 2 });

  const query = "How should we structure the module system for the alpha beta gamma delta project?";

  // First time should not trigger cache (no pattern match, never seen before)
  assert.equal(optimizer.shouldUseCache(query), false);

  // Record once — count is 1, which meets threshold-1 (>=1), so cache is now suggested
  optimizer.recordQuery(query);
  assert.equal(optimizer.shouldUseCache(query), true);

  // Record again — count is now 2
  optimizer.recordQuery(query);
  assert.equal(optimizer.shouldUseCache(query), true);
});

test("getModelPricing returns exact match for known model ID", () => {
  const pricing = getModelPricing("gpt-4o");
  assert.equal(pricing.inputPer1k, 0.0025);
  assert.equal(pricing.outputPer1k, 0.01);
});

test("getModelPricing returns zero pricing for unknown model", () => {
  const pricing = getModelPricing("unknown-model-xyz");
  assert.equal(pricing.inputPer1k, 0);
  assert.equal(pricing.outputPer1k, 0);
});
