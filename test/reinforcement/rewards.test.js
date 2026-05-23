/**
 * RewardFunction tests — compute (with sub-rewards), taskCompletionReward,
 * efficiencyReward, qualityReward, userSatisfactionReward, timeReward,
 * weight management, edge cases.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { RewardFunction } = require("../../src/reinforcement/rewards");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successOutcome(overrides = {}) {
  return {
    success: true,
    tokenCount: 1500,
    inputTokens: 800,
    outputTokens: 700,
    cost: 0.08,
    durationMs: 3000,
    errorCount: 0,
    outputQuality: "high",
    outputLength: 4000,
    hadRetries: false,
    retryCount: 0,
    ...overrides,
  };
}

function failureOutcome(overrides = {}) {
  return {
    success: false,
    tokenCount: 8000,
    cost: 0.45,
    durationMs: 25000,
    errorCount: 4,
    outputQuality: "low",
    outputLength: 200,
    hadRetries: true,
    retryCount: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compute
// ---------------------------------------------------------------------------

test("compute: returns positive total for successful outcome", () => {
  const rf = new RewardFunction();
  const outcome = successOutcome();

  const reward = rf.compute(outcome);
  assert.ok(typeof reward === "number");
  assert.ok(reward > 0, `Expected positive reward, got ${reward}`);
});

test("compute: returns negative total for failure outcome", () => {
  const rf = new RewardFunction();
  const outcome = failureOutcome();

  const reward = rf.compute(outcome);
  assert.ok(typeof reward === "number");
  assert.ok(reward < 0, `Expected negative reward, got ${reward}`);
});

test("compute: handles null outcome", () => {
  const rf = new RewardFunction();

  assert.equal(rf.compute(null), 0);
});

test("compute: verbose mode returns per-component breakdown", () => {
  const rf = new RewardFunction();
  const outcome = successOutcome();

  const result = rf.compute(outcome, { verbose: true });
  assert.ok(typeof result.total === "number");
  assert.ok("components" in result);
  assert.ok("taskCompletion" in result.components);
  assert.ok("efficiency" in result.components);
  assert.ok("quality" in result.components);
  assert.ok("userSatisfaction" in result.components);
  assert.ok("time" in result.components);
  assert.ok("errorPenalty" in result.components);

  // Each component should have value, weight, contribution
  for (const comp of Object.values(result.components)) {
    assert.ok("value" in comp);
    assert.ok("weight" in comp);
    assert.ok("contribution" in comp);
  }
});

test("compute: respects custom weights", () => {
  const rf = new RewardFunction({
    weights: {
      taskCompletion: 2.0,
      efficiency: 0,
      quality: 0,
      userSatisfaction: 0,
      time: 0,
      errorPenalty: 0,
    },
  });

  const outcome = successOutcome();
  const reward = rf.compute(outcome);

  // With only taskCompletion at weight 2.0 and success (value=1), total should be 2.0
  assert.ok(reward > 1.5 && reward < 2.5, `Expected ~2.0, got ${reward}`);
});

// ---------------------------------------------------------------------------
// taskCompletionReward
// ---------------------------------------------------------------------------

test("taskCompletionReward: success returns 1", () => {
  const rf = new RewardFunction();
  assert.equal(rf.taskCompletionReward({ success: true }), 1);
});

test("taskCompletionReward: failure returns -1", () => {
  const rf = new RewardFunction();
  assert.equal(rf.taskCompletionReward({ success: false }), -1);
});

test("taskCompletionReward: unknown returns 0", () => {
  const rf = new RewardFunction();
  assert.equal(rf.taskCompletionReward({}), 0);
});

test("taskCompletionReward: no errors with high quality infers partial success", () => {
  const rf = new RewardFunction();
  const result = rf.taskCompletionReward({
    errorCount: 0,
    outputQuality: "high",
  });
  assert.ok(result > 0.5, `Expected >0.5 for quality inference, got ${result}`);
});

test("taskCompletionReward: no errors infers mild partial success", () => {
  const rf = new RewardFunction();
  const result = rf.taskCompletionReward({
    errorCount: 0,
  });
  assert.ok(result > 0, `Expected >0, got ${result}`);
});

// ---------------------------------------------------------------------------
// efficiencyReward
// ---------------------------------------------------------------------------

test("efficiencyReward: low token usage gives positive reward", () => {
  const rf = new RewardFunction();
  const result = rf.efficiencyReward({
    tokenCount: 500,
    cost: 0.03,
  });
  assert.ok(result > 0);
});

test("efficiencyReward: high token usage gives negative reward", () => {
  const rf = new RewardFunction();
  const result = rf.efficiencyReward({
    tokenCount: 20000,
    cost: 1.0,
  });
  assert.ok(result < 0);
});

test("efficiencyReward: zero token/cost returns 0", () => {
  const rf = new RewardFunction();
  const result = rf.efficiencyReward({});
  assert.equal(result, 0);
});

// ---------------------------------------------------------------------------
// qualityReward
// ---------------------------------------------------------------------------

test("qualityReward: high quality gives positive reward", () => {
  const rf = new RewardFunction();
  const result = rf.qualityReward({ outputQuality: "high" });
  assert.ok(result > 0);
});

test("qualityReward: low quality gives negative reward", () => {
  const rf = new RewardFunction();
  const result = rf.qualityReward({ outputQuality: "low" });
  assert.ok(result < 0);
});

test("qualityReward: many retries reduces quality score", () => {
  const rf = new RewardFunction();
  const withRetries = rf.qualityReward({
    outputQuality: "high",
    hadRetries: true,
    retryCount: 10,
  });
  const withoutRetries = rf.qualityReward({
    outputQuality: "high",
    hadRetries: false,
    retryCount: 0,
  });
  assert.ok(withRetries < withoutRetries);
});

test("qualityReward: very short output reduces score", () => {
  const rf = new RewardFunction();
  const result = rf.qualityReward({
    outputQuality: "medium",
    outputLength: 5,
  });
  assert.ok(result < 0);
});

// ---------------------------------------------------------------------------
// userSatisfactionReward
// ---------------------------------------------------------------------------

test("userSatisfactionReward: explicit approval returns positive", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({ userApproved: true });
  assert.equal(result, 1);
});

test("userSatisfactionReward: explicit disapproval returns negative", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({ userApproved: false });
  assert.equal(result, -1);
});

test("userSatisfactionReward: star rating maps correctly", () => {
  const rf = new RewardFunction();

  // 5 stars -> 1
  const highResult = rf.userSatisfactionReward({ userRating: 5 });
  assert.equal(highResult, 1);

  // 3 stars -> 0
  const midResult = rf.userSatisfactionReward({ userRating: 3 });
  assert.equal(midResult, 0);

  // 1 star -> -1
  const lowResult = rf.userSatisfactionReward({ userRating: 1 });
  assert.equal(lowResult, -1);
});

test("userSatisfactionReward: positive feedback text yields positive score", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({
    userFeedback: "Great work, this is perfect and helpful!",
  });
  assert.ok(result > 0, `Expected positive for good feedback, got ${result}`);
});

test("userSatisfactionReward: negative feedback text yields negative score", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({
    userFeedback: "This is wrong and broken, doesn't work at all",
  });
  assert.ok(result < 0, `Expected negative for bad feedback, got ${result}`);
});

test("userSatisfactionReward: neutral feedback returns 0", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({
    userFeedback: "ok",
  });
  assert.equal(result, 0);
});

test("userSatisfactionReward: no feedback returns 0", () => {
  const rf = new RewardFunction();
  const result = rf.userSatisfactionReward({});
  assert.equal(result, 0);
});

// ---------------------------------------------------------------------------
// timeReward
// ---------------------------------------------------------------------------

test("timeReward: very fast completion returns 1", () => {
  const rf = new RewardFunction();
  assert.equal(rf.timeReward({ durationMs: 500 }), 1);
});

test("timeReward: moderate time returns 0", () => {
  const rf = new RewardFunction();
  assert.equal(rf.timeReward({ durationMs: 10000 }), 0);
});

test("timeReward: very slow returns negative", () => {
  const rf = new RewardFunction();
  const result = rf.timeReward({ durationMs: 60000 });
  assert.ok(result < -0.5);
});

test("timeReward: no duration returns 0", () => {
  const rf = new RewardFunction();
  assert.equal(rf.timeReward({}), 0);
  assert.equal(rf.timeReward({ durationMs: 0 }), 0);
});

// ---------------------------------------------------------------------------
// Weight management
// ---------------------------------------------------------------------------

test("getWeights: returns current weight configuration", () => {
  const rf = new RewardFunction({
    weights: { taskCompletion: 1.5, efficiency: 0.3 },
  });

  const weights = rf.getWeights();
  assert.equal(weights.taskCompletion, 1.5);
  assert.equal(weights.efficiency, 0.3);
  assert.equal(weights.quality, 0.5); // default
});

test("setWeights: updates weights at runtime", () => {
  const rf = new RewardFunction();

  rf.setWeights({ taskCompletion: 2.5 });
  const weights = rf.getWeights();
  assert.equal(weights.taskCompletion, 2.5);
  // Other weights unchanged
  assert.equal(weights.efficiency, 0.5);
});

// ---------------------------------------------------------------------------
// Static normalise
// ---------------------------------------------------------------------------

test("normalise: maps large positive value close to 1", () => {
  const result = RewardFunction.normalise(100, 10);
  assert.ok(result > 0.99);
});

test("normalise: maps large negative value close to -1", () => {
  const result = RewardFunction.normalise(-100, 10);
  assert.ok(result < -0.99);
});

test("normalise: zero maps to zero", () => {
  const result = RewardFunction.normalise(0, 1);
  assert.equal(result, 0);
});

test("normalise: throws for NaN input", () => {
  // NaN should be caught — returns 0 (not thrown)
  const result = RewardFunction.normalise(NaN, 1);
  assert.equal(result, 0);
});

// ---------------------------------------------------------------------------
// Error penalty via compute
// ---------------------------------------------------------------------------

test("errorPenalty: no errors yields no penalty", () => {
  const rf = new RewardFunction({
    weights: {
      taskCompletion: 0,
      efficiency: 0,
      quality: 0,
      userSatisfaction: 0,
      time: 0,
      errorPenalty: 1.0,
    },
  });

  const outcome = { errorCount: 0 };
  const result = rf.compute(outcome);
  assert.equal(result, 0);
});

test("errorPenalty: multiple errors yields negative contribution", () => {
  const rf = new RewardFunction({
    weights: {
      taskCompletion: 0,
      efficiency: 0,
      quality: 0,
      userSatisfaction: 0,
      time: 0,
      errorPenalty: 1.0,
    },
  });

  const outcome = { errorCount: 10 };
  const result = rf.compute(outcome);
  assert.ok(result < -0.9, `Expected close to -1 for many errors, got ${result}`);
});
