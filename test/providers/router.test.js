"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ModelRouter, STRATEGIES } = require("../../src/providers/router");

function createMockModel(overrides = {}) {
  return {
    id: overrides.id || "mock-model",
    provider: overrides.provider || "mock",
    displayName: overrides.displayName || "Mock Model",
    maxTokens: overrides.maxTokens ?? 4096,
    vision: overrides.vision ?? false,
    tools: overrides.tools ?? false,
    streaming: overrides.streaming ?? true,
    caching: overrides.caching ?? false,
    longContext: overrides.longContext ?? false,
    reasoning: overrides.reasoning ?? false,
    inputPer1k: overrides.inputPer1k ?? 0,
    outputPer1k: overrides.outputPer1k ?? 0,
    requestsPerMinute: overrides.requestsPerMinute ?? Infinity,
    tokensPerMinute: overrides.tokensPerMinute ?? Infinity,
    weight: overrides.weight ?? 1,
    ...overrides,
  };
}

test("ModelRouter registerModel adds a model", () => {
  const router = new ModelRouter();
  router.registerModel(createMockModel({ id: "test-model", provider: "anthropic" }));

  const available = router.getAvailableModels();
  assert.equal(available.length, 1);
  assert.equal(available[0].id, "test-model");
  assert.equal(available[0].provider, "anthropic");
});

test("ModelRouter registerModel normalizes model capabilities", () => {
  const router = new ModelRouter();
  router.registerModel({
    id: "minimal-model",
    provider: "openai",
    maxTokens: 8192,
  });

  const available = router.getAvailableModels();
  const model = available[0];

  assert.equal(model.id, "minimal-model");
  assert.equal(model.capabilities.maxTokens, 8192);
  assert.equal(model.capabilities.vision, false);
  assert.equal(model.capabilities.tools, false);
  assert.equal(model.capabilities.streaming, false);
  assert.equal(model.capabilities.caching, false);
});

test("ModelRouter registerModel throws on invalid input", () => {
  const router = new ModelRouter();

  assert.throws(() => router.registerModel(null), /Model must be a non-null object/);
  assert.throws(() => router.registerModel(undefined), /Model must be a non-null object/);
  assert.throws(() => router.registerModel({}), /Model must have a valid string id/);
});

test("ModelRouter route returns least cost model by default", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({
    id: "expensive-model",
    provider: "anthropic",
    inputPer1k: 0.015,
    outputPer1k: 0.075,
  }));

  router.registerModel(createMockModel({
    id: "cheap-model",
    provider: "openai",
    inputPer1k: 0.00015,
    outputPer1k: 0.0006,
  }));

  router.registerModel(createMockModel({
    id: "mid-model",
    provider: "google",
    inputPer1k: 0.00125,
    outputPer1k: 0.01,
  }));

  const selected = router.route({ estimatedInputTokens: 1000, estimatedOutputTokens: 500 });
  assert.equal(selected.id, "cheap-model");
});

test("ModelRouter route filters by preferred provider", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "anthropic-sonnet", provider: "anthropic" }));
  router.registerModel(createMockModel({ id: "openai-gpt4o", provider: "openai" }));
  router.registerModel(createMockModel({ id: "google-gemini", provider: "google" }));

  const selected = router.route({ preferredProvider: "google" });
  assert.equal(selected.id, "google-gemini");
});

test("ModelRouter route filters by maxTokens requirement", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "small-model", maxTokens: 4096 }));
  router.registerModel(createMockModel({ id: "large-model", maxTokens: 200000 }));

  const selected = router.route({ maxTokens: 100000 });
  assert.equal(selected.id, "large-model");
});

test("ModelRouter route filters by vision requirement", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "text-only", vision: false, inputPer1k: 0.001, outputPer1k: 0.005 }));
  router.registerModel(createMockModel({ id: "vision-capable", vision: true, inputPer1k: 0.002, outputPer1k: 0.01 }));

  const selected = router.route({ needsVision: true });
  assert.equal(selected.id, "vision-capable");
});

test("ModelRouter route filters by tools requirement", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "no-tools", tools: false, inputPer1k: 0.001, outputPer1k: 0.005 }));
  router.registerModel(createMockModel({ id: "with-tools", tools: true, inputPer1k: 0.002, outputPer1k: 0.01 }));

  const selected = router.route({ needsTools: true });
  assert.equal(selected.id, "with-tools");
});

test("ModelRouter route filters by maxCost", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({
    id: "expensive",
    inputPer1k: 0.015,
    outputPer1k: 0.075,
  }));

  router.registerModel(createMockModel({
    id: "cheap",
    inputPer1k: 0.0001,
    outputPer1k: 0.0005,
  }));

  // Expensive model cost for 1000 input + 500 output:
  // (0.015 * 1000)/1000 + (0.075 * 500)/1000 = 0.015 + 0.0375 = 0.0525
  // Set maxCost below that
  const selected = router.route({
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    maxCost: 0.001,
  });

  assert.equal(selected.id, "cheap");
});

test("ModelRouter route throws when no models match", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "text-only", vision: false }));

  assert.throws(
    () => router.route({ needsVision: true }),
    /No available models matching task requirements/,
  );
});

test("ModelRouter setStrategy switches between strategies", () => {
  const router = new ModelRouter();

  assert.equal(router.strategy, STRATEGIES.LEAST_COST);

  router.setStrategy(STRATEGIES.ROUND_ROBIN);
  assert.equal(router.strategy, STRATEGIES.ROUND_ROBIN);

  router.setStrategy(STRATEGIES.HIGHEST_CAPABILITY);
  assert.equal(router.strategy, STRATEGIES.HIGHEST_CAPABILITY);

  router.setStrategy(STRATEGIES.WEIGHTED_RANDOM);
  assert.equal(router.strategy, STRATEGIES.WEIGHTED_RANDOM);

  router.setStrategy(STRATEGIES.LEAST_COST);
  assert.equal(router.strategy, STRATEGIES.LEAST_COST);
});

test("ModelRouter setStrategy throws on unknown strategy", () => {
  const router = new ModelRouter();

  assert.throws(
    () => router.setStrategy("invalid_strategy"),
    /Unknown routing strategy/,
  );
});

test("ModelRouter round_robin strategy cycles through models", () => {
  const router = new ModelRouter();
  router.setStrategy(STRATEGIES.ROUND_ROBIN);

  router.registerModel(createMockModel({ id: "model-a" }));
  router.registerModel(createMockModel({ id: "model-b" }));
  router.registerModel(createMockModel({ id: "model-c" }));

  const first = router.route({});
  const second = router.route({});
  const third = router.route({});
  const fourth = router.route({});

  assert.equal(first.id, "model-a");
  assert.equal(second.id, "model-b");
  assert.equal(third.id, "model-c");
  assert.equal(fourth.id, "model-a");
});

test("ModelRouter weighted_random strategy respects weights", () => {
  const router = new ModelRouter();
  router.setStrategy(STRATEGIES.WEIGHTED_RANDOM);

  // Give model-b 100x the weight of model-a
  router.registerModel(createMockModel({ id: "model-a", weight: 1 }));
  router.registerModel(createMockModel({ id: "model-b", weight: 100 }));

  // Run many iterations; model-b should be selected the vast majority of times
  let countA = 0;
  let countB = 0;
  const trials = 500;

  for (let i = 0; i < trials; i += 1) {
    const selected = router.route({});
    if (selected.id === "model-a") countA += 1;
    else countB += 1;
  }

  assert.ok(countB > countA, `Weighted random: expected model-b (${countB}) to be selected more than model-a (${countA})`);
  assert.ok(countB / trials > 0.9, `model-b should be selected >90% of time, got ${((countB / trials) * 100).toFixed(1)}%`);
});

test("ModelRouter getModelStats returns usage statistics", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "model-a", provider: "anthropic" }));
  router.registerModel(createMockModel({ id: "model-b", provider: "openai" }));

  router.route({});
  router.route({});

  router.recordSuccess("model-a", 150);
  router.recordSuccess("model-a", 200);
  router.recordFailure("model-b", new Error("timeout"));

  const stats = router.getModelStats();
  assert.ok(stats["model-a"]);
  assert.ok(stats["model-b"]);
  assert.equal(stats["model-a"].usage.routed, 2);
  assert.equal(stats["model-a"].usage.successes, 2);
  assert.equal(stats["model-b"].usage.failures, 1);
});

test("ModelRouter route with rate limiting excludes rate-limited models", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({
    id: "rate-limited",
    requestsPerMinute: 2,
    tokensPerMinute: Infinity,
  }));

  router.registerModel(createMockModel({
    id: "unlimited",
    requestsPerMinute: Infinity,
    tokensPerMinute: Infinity,
  }));

  // Record 2 requests for rate-limited model (hitting the limit)
  router.recordTokenUsage("rate-limited", 100);
  router.recordTokenUsage("rate-limited", 100);

  const selected = router.route({});
  assert.equal(selected.id, "unlimited");
});

test("ModelRouter highest_capability strategy prefers more capable models", () => {
  const router = new ModelRouter();
  router.setStrategy(STRATEGIES.HIGHEST_CAPABILITY);

  router.registerModel(createMockModel({
    id: "basic",
    maxTokens: 4096,
    vision: false,
    tools: false,
  }));

  router.registerModel(createMockModel({
    id: "advanced",
    maxTokens: 200000,
    vision: true,
    tools: true,
    reasoning: true,
  }));

  const selected = router.route({});
  assert.equal(selected.id, "advanced");
});

test("ModelRouter getAvailableModels without task returns all non-rate-limited models", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "model-a" }));
  router.registerModel(createMockModel({ id: "model-b" }));

  const available = router.getAvailableModels();
  assert.equal(available.length, 2);
});

test("ModelRouter filters by streaming requirement", () => {
  const router = new ModelRouter();

  router.registerModel(createMockModel({ id: "with-streaming", streaming: true }));
  router.registerModel(createMockModel({ id: "no-streaming", streaming: false, inputPer1k: 0.0001, outputPer1k: 0.0005 }));

  const selected = router.route({ needsStreaming: true });
  assert.equal(selected.id, "with-streaming");
});
