"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TokenPlanner,
} = require("../../src/tokens/planner");

test("plan returns a complete budget plan for a task", () => {
  const planner = new TokenPlanner();
  const result = planner.plan("Build a REST API with authentication and rate limiting", "claude-sonnet-4");

  assert.ok(typeof result.totalTokens === "number");
  assert.ok(result.totalTokens > 0);
  assert.ok(typeof result.categories === "object");
  assert.ok(typeof result.complexity === "string");
  assert.ok(typeof result.modelFactor === "number");
  assert.ok(typeof result.phase === "string");
  assert.ok(Array.isArray(result.plan));

  // All standard categories should be present.
  assert.ok("system_prompt" in result.categories);
  assert.ok("conversation" in result.categories);
  assert.ok("tools" in result.categories);
  assert.ok("output" in result.categories);
  assert.ok("safety_margin" in result.categories);

  // Each category should have a positive allocation.
  for (const value of Object.values(result.categories)) {
    assert.ok(value > 0);
  }
});

test("estimate returns estimated token count for a task", () => {
  const planner = new TokenPlanner();

  const trivial = planner.estimate("Say hello");
  // "refactor" + "migrate" = 2 pattern signals, triggers "medium"
  const medium = planner.estimate("Refactor and migrate the database schema");
  // Very long task with many complexity signals triggers "high" or "very_high"
  const high = planner.estimate(
    "Design and implement a comprehensive analytics platform with multiple database " +
    "connections, file processing stages across several phases, audit log analysis " +
    "capabilities, and step 1 through step 5 deployment for the entire organization"
  );

  assert.ok(trivial > 0);
  assert.ok(high > medium);
  assert.ok(medium >= trivial);
});

test("estimate returns positive value for empty task", () => {
  const planner = new TokenPlanner();
  const result = planner.estimate("");
  assert.ok(result > 0);
});

test("estimate returns positive value for null/undefined", () => {
  const planner = new TokenPlanner();
  const result = planner.estimate(null);
  assert.ok(result > 0);
});

test("optimize reorders budget by provided priorities", () => {
  const planner = new TokenPlanner();
  const taskPlan = planner.plan("Analyze codebase and suggest optimizations", "gpt-4o");

  const optimized = planner.optimize(taskPlan, ["tools", "output", "conversation", "safety_margin", "system_prompt"]);

  assert.ok(typeof optimized.totalTokens === "number");
  assert.ok(optimized.totalTokens > 0);
  assert.ok(typeof optimized.categories === "object");
  assert.ok(Array.isArray(optimized.adjustments));
  assert.deepStrictEqual(optimized.priorityOrder, ["tools", "output", "conversation", "safety_margin", "system_prompt"]);

  // Top priority should get the most tokens.
  const toolTokens = optimized.categories.tools || 0;
  const safetyTokens = optimized.categories.safety_margin || 0;
  assert.ok(toolTokens >= safetyTokens);
});

test("optimize with empty priorities uses default ordering", () => {
  const planner = new TokenPlanner();
  const taskPlan = planner.plan("Write unit tests", "claude-haiku-4");

  const optimized = planner.optimize(taskPlan, []);

  assert.ok(optimized.totalTokens > 0);
  assert.ok(Object.keys(optimized.categories).length > 0);
});

test("optimize throws for invalid budget", () => {
  const planner = new TokenPlanner();

  assert.throws(() => {
    planner.optimize(null, []);
  }, /valid budget/);

  assert.throws(() => {
    planner.optimize(undefined, []);
  }, /valid budget/);
});

test("adjust increases allocation for overrun categories", () => {
  const planner = new TokenPlanner();
  const budget = {
    totalTokens: 10000,
    categories: {
      system_prompt: 1000,
      conversation: 4000,
      tools: 2000,
      output: 2000,
      safety_margin: 1000,
    },
  };

  const actualUsage = {
    conversation: 6000,
    tools: 1500,
    output: 500,
  };

  const adjusted = planner.adjust(budget, actualUsage);

  assert.ok(adjusted.categories.conversation > 4000);
  assert.ok(adjusted.insights.some((i) => i.category === "conversation" && i.type === "overrun"));
  assert.ok(adjusted.insights.some((i) => i.category === "output" && i.type === "underutilized"));
});

test("adjust reduces allocation for underutilized categories", () => {
  const planner = new TokenPlanner();
  const budget = {
    totalTokens: 10000,
    categories: {
      system_prompt: 1000,
      conversation: 4000,
      tools: 2000,
      output: 2000,
      safety_margin: 1000,
    },
  };

  const actualUsage = {
    conversation: 500,
    tools: 2000,
    output: 2000,
  };

  const adjusted = planner.adjust(budget, actualUsage);

  assert.ok(adjusted.categories.conversation < 4000);
  assert.ok(adjusted.insights.some((i) => i.category === "conversation" && i.type === "underutilized"));
});

test("suggestBudget without history uses base estimates", () => {
  const planner = new TokenPlanner();
  const result = planner.suggestBudget("Write a comprehensive test suite", "claude-opus-4", []);

  assert.equal(result.confidence, "low");
  assert.equal(result.basedOn, "base_estimates");
  assert.equal(result.sampleSize, 0);
  assert.ok(result.totalTokens > 0);
  assert.ok(Object.keys(result.categories).length === 5);
});

test("suggestBudget with history uses historical data with higher confidence", () => {
  const planner = new TokenPlanner();

  // Simulate history by recording multiple similar usages.
  for (let i = 0; i < 30; i++) {
    const taskPlan = planner.plan("Build a CRUD API with database integration", "claude-sonnet-4");
    const usage = {
      conversation: 4000 + Math.floor(Math.random() * 1000),
      tools: 1500 + Math.floor(Math.random() * 500),
      output: 1800 + Math.floor(Math.random() * 600),
      system_prompt: 800 + Math.floor(Math.random() * 200),
      safety_margin: 500 + Math.floor(Math.random() * 300),
    };
    planner.recordUsage(taskPlan, usage, "Build a CRUD API with database integration", "claude-sonnet-4");
  }

  const history = planner.getHistory();
  const result = planner.suggestBudget("Build a REST API with authentication", "claude-sonnet-4", history);

  assert.ok(result.confidence === "high" || result.confidence === "medium");
  assert.equal(result.basedOn, "historical_usage");
  assert.ok(result.sampleSize > 0);
  assert.ok(result.totalTokens > 0);
});

test("recordUsage stores usage and returns a record with all fields", () => {
  const planner = new TokenPlanner();
  const taskPlan = planner.plan("Debug a failing pipeline", "gpt-4o");

  const usage = {
    conversation: 3000,
    tools: 2500,
    output: 1500,
    system_prompt: 800,
    safety_margin: 400,
  };

  const record = planner.recordUsage(taskPlan, usage, "Debug a failing pipeline", "gpt-4o");

  assert.ok(typeof record.timestamp === "number");
  assert.ok(["low", "medium", "high"].includes(record.complexity));
  assert.equal(record.model, "gpt-4o");
  assert.deepStrictEqual(record.usage, usage);
  assert.ok(record.taskLength > 0);

  const history = planner.getHistory();
  assert.equal(history.length, 1);
  assert.deepStrictEqual(history[0], record);
});

test("getModelProfile returns model statistics after recording usage", () => {
  const planner = new TokenPlanner();

  for (let i = 0; i < 5; i++) {
    const taskPlan = planner.plan("Implement feature X", "deepseek-v4-pro");
    const usage = {
      conversation: 5000 + i * 500,
      tools: 2000 + i * 200,
      output: 2500 + i * 300,
      system_prompt: 1000,
      safety_margin: 500,
    };
    planner.recordUsage(taskPlan, usage, "Implement feature X", "deepseek-v4-pro");
  }

  const profile = planner.getModelProfile("deepseek-v4-pro");

  assert.ok(profile !== null);
  assert.equal(profile.model, "deepseek-v4-pro");
  assert.equal(profile.count, 5);
  assert.ok(profile.averageTokens > 0);
});

test("getModelProfile returns null for unknown model", () => {
  const planner = new TokenPlanner();
  const profile = planner.getModelProfile("nonexistent-model");
  assert.equal(profile, null);
});

test("history is pruned when exceeding maximum size", () => {
  const planner = new TokenPlanner();

  for (let i = 0; i < 60; i++) {
    const taskPlan = planner.plan(`Task ${i}`, "claude-sonnet-4");
    planner.recordUsage(taskPlan, { conversation: 1000 }, `Task ${i}`, "claude-sonnet-4");
  }

  const history = planner.getHistory();
  assert.ok(history.length <= 50);
});

test("plan detects different phases correctly", () => {
  const planner = new TokenPlanner();

  const planningResult = planner.plan("Design the architecture for a new microservice", "gpt-4o");
  assert.equal(planningResult.phase, "planning");

  const executionResult = planner.plan("Implement the user authentication module", "gpt-4o");
  assert.equal(executionResult.phase, "execution");

  const reviewResult = planner.plan("Review the pull request for security vulnerabilities", "gpt-4o");
  assert.equal(reviewResult.phase, "review");
});

test("adjust returns budget unchanged when actualUsage is null", () => {
  const planner = new TokenPlanner();
  const budget = {
    totalTokens: 10000,
    categories: { conversation: 5000, tools: 3000, output: 2000 },
  };

  const result = planner.adjust(budget, null);
  assert.deepStrictEqual(result, budget);
});
