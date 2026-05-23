"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TokenBudget,
  CATEGORIES,
  DEFAULT_ALLOCATION_PERCENTAGES,
} = require("../../src/tokens/budget");

test("allocate sets up budget with default category percentages", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  const status = budget.getBudget();
  assert.equal(status.totalTokens, 100000);

  const expectedSystemPrompt = Math.floor(100000 * DEFAULT_ALLOCATION_PERCENTAGES.system_prompt);
  assert.ok(status.categories.system_prompt.allocated >= expectedSystemPrompt - 1);

  const expectedConversation = Math.floor(100000 * DEFAULT_ALLOCATION_PERCENTAGES.conversation);
  assert.ok(status.categories.conversation.allocated >= expectedConversation - 1);

  const expectedTools = Math.floor(100000 * DEFAULT_ALLOCATION_PERCENTAGES.tools);
  assert.ok(status.categories.tools.allocated >= expectedTools - 1);

  const expectedOutput = Math.floor(100000 * DEFAULT_ALLOCATION_PERCENTAGES.output);
  assert.ok(status.categories.output.allocated >= expectedOutput - 1);

  const expectedSafety = Math.floor(100000 * DEFAULT_ALLOCATION_PERCENTAGES.safety_margin);
  assert.ok(status.categories.safety_margin.allocated >= expectedSafety - 1);
});

test("allocate with zero tokens still creates minimum budgets", () => {
  const budget = new TokenBudget();
  budget.allocate(0);

  const status = budget.getBudget();
  assert.equal(status.totalTokens, 0);

  for (const category of CATEGORIES) {
    assert.equal(status.categories[category].allocated, 1);
  }
});

test("reserve reserves tokens for a category", () => {
  const budget = new TokenBudget();
  budget.allocate(50000);

  budget.reserve("conversation", 10000);
  const status = budget.getBudget();

  assert.equal(status.categories.conversation.reserved, 10000);
  assert.equal(status.totalReserved, 10000);
});

test("reserve exceeding allocation expands the category", () => {
  const budget = new TokenBudget();
  budget.allocate(10000);

  const originalAllocated = budget.getBudget().categories.conversation.allocated;
  budget.reserve("conversation", originalAllocated + 5000);

  const status = budget.getBudget();
  assert.ok(status.categories.conversation.allocated >= originalAllocated + 5000);
  assert.equal(status.categories.conversation.reserved, originalAllocated + 5000);
});

test("consume consumes tokens from a category", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  budget.consume("conversation", 5000);
  const status = budget.getBudget();

  assert.equal(status.categories.conversation.consumed, 5000);
  assert.equal(status.totalConsumed, 5000);
});

test("consume accumulates across multiple calls", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  budget.consume("conversation", 2000);
  budget.consume("conversation", 3000);
  budget.consume("conversation", 1500);

  assert.equal(budget.getBudget().categories.conversation.consumed, 6500);
});

test("remaining returns remaining tokens in a category", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  const initialRemaining = budget.remaining("conversation");
  budget.consume("conversation", 5000);
  const afterRemaining = budget.remaining("conversation");

  assert.equal(afterRemaining, initialRemaining - 5000);
});

test("remaining without argument returns total remaining across all categories", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  const totalRemaining = budget.remaining();
  assert.ok(totalRemaining > 0);
  assert.ok(totalRemaining <= 100000);
});

test("getBudget returns full budget status with all fields", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  const status = budget.getBudget();

  assert.ok(typeof status.totalTokens === "number");
  assert.ok(typeof status.totalConsumed === "number");
  assert.ok(typeof status.totalRemaining === "number");
  assert.ok(typeof status.totalReserved === "number");
  assert.ok(typeof status.frozen === "boolean");
  assert.ok(Array.isArray(status.warnings));
  assert.ok(Array.isArray(status.overdrafts));

  for (const category of CATEGORIES) {
    assert.ok(status.categories[category] !== undefined);
    assert.ok(typeof status.categories[category].allocated === "number");
    assert.ok(typeof status.categories[category].consumed === "number");
    assert.ok(typeof status.categories[category].remaining === "number");
    assert.ok(typeof status.categories[category].exhausted === "boolean");
    assert.ok(typeof status.categories[category].percentage === "number");
  }
});

test("isExhausted detects when a category is depleted", () => {
  const budget = new TokenBudget();
  budget.allocate(100);

  assert.equal(budget.isExhausted("conversation"), false);

  // Consume all tokens from conversation.
  const allocated = budget.getBudget().categories.conversation.allocated;
  budget.consume("conversation", allocated);

  assert.equal(budget.isExhausted("conversation"), true);
});

test("isExhausted throws for invalid category", () => {
  const budget = new TokenBudget();
  budget.allocate(1000);

  assert.throws(() => {
    budget.isExhausted("invalid_category");
  }, /Unknown budget category/);
});

test("consume generates overdraft warning when tokens exceed available", () => {
  const budget = new TokenBudget();
  budget.allocate(1000);

  const allocated = budget.getBudget().categories.system_prompt.allocated;
  budget.consume("system_prompt", allocated + 500);

  const status = budget.getBudget();
  assert.ok(status.overdrafts.length > 0);
  assert.equal(status.overdrafts[0].category, "system_prompt");
  assert.equal(status.overdrafts[0].deficit, 500);
});

test("freeze prevents re-allocation", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);
  budget.freeze();

  const before = budget.getBudget().totalTokens;
  budget.allocate(200000);
  const after = budget.getBudget().totalTokens;

  assert.equal(before, after);

  const warnings = budget.getWarnings();
  assert.ok(warnings.some((w) => w.message.includes("frozen")));
});

test("freeze prevents reserve", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);
  budget.freeze();

  budget.reserve("tools", 5000);
  const warnings = budget.getWarnings();
  assert.ok(warnings.length > 0);
  assert.ok(warnings.some((w) => w.message.includes("frozen")));

  // Reserved should not have changed.
  assert.equal(budget.getBudget().categories.tools.reserved, 0);
});

test("unfreeze re-enables modifications", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);
  budget.freeze();
  budget.allocate(50000);
  assert.equal(budget.getBudget().totalTokens, 100000);

  budget.unfreeze();
  budget.allocate(50000);
  assert.equal(budget.getBudget().totalTokens, 50000);
});

test("clearWarnings clears warning history", () => {
  const budget = new TokenBudget();
  budget.allocate(1000);
  budget.freeze();
  budget.allocate(5000);

  assert.ok(budget.getWarnings().length > 0);
  budget.clearWarnings();
  assert.equal(budget.getWarnings().length, 0);
});

test("consume with zero or negative tokens does nothing harmful", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  budget.consume("conversation", 0);
  assert.equal(budget.getBudget().categories.conversation.consumed, 0);

  budget.consume("conversation", -5);
  assert.equal(budget.getBudget().categories.conversation.consumed, 0);
});

test("very large allocation works correctly", () => {
  const budget = new TokenBudget();
  budget.allocate(1_000_000);

  const status = budget.getBudget();
  assert.equal(status.totalTokens, 1_000_000);
  assert.ok(status.totalRemaining > 900_000);

  // All categories should have reasonable allocations.
  for (const category of CATEGORIES) {
    assert.ok(status.categories[category].allocated > 0);
  }
});

test("budget categories total matches allocation", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);

  const status = budget.getBudget();
  let sum = 0;
  for (const category of CATEGORIES) {
    sum += status.categories[category].allocated;
  }

  assert.equal(sum, 100000);
});
