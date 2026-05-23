"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ErrorPredictor,
  RISK_LEVEL,
  ERROR_TYPE,
} = require("../../src/prediction/error-predictor");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function simpleContext(overrides = {}) {
  return {
    name: "test-operation",
    estimatedToolCalls: 5,
    estimatedTokens: 2000,
    resourceUsage: {
      memoryRatio: 0.3,
      tokenQuotaRatio: 0.2,
      diskRatio: 0.1,
    },
    timeBudgetMs: 30000,
    recentErrors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ErrorPredictor: constructs with defaults", () => {
  const ep = new ErrorPredictor();
  assert.ok(ep instanceof ErrorPredictor);
  assert.deepEqual(ep.getErrorHistory(), []);
  const stats = ep.getErrorTypeStats();
  assert.ok(stats.timeout);
  assert.ok(stats.rateLimit);
  assert.ok(stats.authFailure);
  assert.equal(stats.timeout.count, 0);
});

test("ErrorPredictor: predicts timeout for high-complexity tight-budget operations", () => {
  const ep = new ErrorPredictor();
  const ctx = simpleContext({
    estimatedToolCalls: 20,
    timeBudgetMs: 5000,
  });

  const predictions = ep.predict(ctx);
  const timeouts = predictions.filter((p) => p.errorType === ERROR_TYPE.TIMEOUT);
  assert.ok(timeouts.length > 0, "should predict timeout");
  assert.equal(timeouts[0].riskLevel, RISK_LEVEL.CRITICAL);
  assert.ok(timeouts[0].confidence > 0.5);
});

test("ErrorPredictor: returns LOW risk for trivial operation", () => {
  const ep = new ErrorPredictor();
  const ctx = simpleContext({
    estimatedToolCalls: 1,
    timeBudgetMs: 60000,
  });

  const level = ep.getRiskLevel(ctx);
  assert.equal(level, RISK_LEVEL.LOW);
});

test("ErrorPredictor: getRiskLevel returns CRITICAL when resource exhausted", () => {
  const ep = new ErrorPredictor();
  const ctx = simpleContext({
    resourceUsage: {
      memoryRatio: 0.95,
      tokenQuotaRatio: 0.8,
      diskRatio: 0.3,
    },
  });

  const level = ep.getRiskLevel(ctx);
  assert.equal(level, RISK_LEVEL.CRITICAL);
});

test("ErrorPredictor: learns errors and updates stats", () => {
  const ep = new ErrorPredictor();

  ep.learn({ type: ERROR_TYPE.TIMEOUT, context: "op1", recoveryMs: 5000 });
  ep.learn({ type: ERROR_TYPE.TIMEOUT, context: "op2", recoveryMs: 3000 });
  ep.learn({ type: ERROR_TYPE.NETWORK_ERROR, context: "op3" });

  const stats = ep.getErrorTypeStats();
  assert.equal(stats.timeout.count, 2);
  assert.equal(stats.networkError.count, 1);
  assert.ok(stats.timeout.avgRecoveryMs > 0);

  const history = ep.getErrorHistory();
  assert.equal(history.length, 3);
});

test("ErrorPredictor: learned errors influence predictions", () => {
  const ep = new ErrorPredictor();

  // Learn several network errors
  for (let i = 0; i < 5; i++) {
    ep.learn({ type: ERROR_TYPE.NETWORK_ERROR, context: `op${i}` });
  }

  const ctx = simpleContext();
  const predictions = ep.predict(ctx);
  const networkPreds = predictions.filter((p) => p.errorType === ERROR_TYPE.NETWORK_ERROR);
  assert.ok(networkPreds.length > 0, "should predict network error after learning");
  assert.ok(
    networkPreds[0].riskLevel === RISK_LEVEL.HIGH ||
    networkPreds[0].riskLevel === RISK_LEVEL.CRITICAL
  );
});

test("ErrorPredictor: suggests precautions for high-risk operation", () => {
  const ep = new ErrorPredictor();

  ep.learn({ type: ERROR_TYPE.RATE_LIMIT, context: "op1" });
  ep.learn({ type: ERROR_TYPE.RATE_LIMIT, context: "op2" });

  const ctx = simpleContext({
    estimatedToolCalls: 20,
    timeBudgetMs: 5000,
    resourceUsage: {
      memoryRatio: 0.5,
      tokenQuotaRatio: 0.85,
      diskRatio: 0.2,
    },
  });

  const precautions = ep.suggestPrecautions(ctx);
  assert.ok(precautions.length > 0, "should suggest precautions");
  assert.ok(precautions.some((p) => p.action === "throttle"), "should suggest throttling for rate limit risk");
  assert.ok(precautions.some((p) => p.action === "increaseTimeout"), "should suggest timeout increase");
});

test("ErrorPredictor: ignores null/undefined context gracefully", () => {
  const ep = new ErrorPredictor();

  assert.deepEqual(ep.predict(null), []);
  assert.deepEqual(ep.predict(undefined), []);
  assert.equal(ep.getRiskLevel(null), RISK_LEVEL.LOW);
});

test("ErrorPredictor: learn ignores calls without type", () => {
  const ep = new ErrorPredictor();
  ep.learn({ context: "no-type" });
  ep.learn(null);
  ep.learn(undefined);
  ep.learn({});

  assert.equal(ep.getErrorHistory().length, 0);
});

test("ErrorPredictor: predicts validation errors for complex operations with history", () => {
  const ep = new ErrorPredictor();

  ep.learn({ type: ERROR_TYPE.VALIDATION_ERROR, context: "op1" });
  ep.learn({ type: ERROR_TYPE.VALIDATION_ERROR, context: "op2" });

  const ctx = simpleContext({ estimatedToolCalls: 12 });
  const predictions = ep.predict(ctx);
  const valPreds = predictions.filter((p) => p.errorType === ERROR_TYPE.VALIDATION_ERROR);
  assert.ok(valPreds.length > 0, "should predict validation error for complex op with history");
});

test("ErrorPredictor: predicts rate-limit at high token quota", () => {
  const ep = new ErrorPredictor();
  const ctx = simpleContext({
    resourceUsage: {
      memoryRatio: 0.3,
      tokenQuotaRatio: 0.92,
      diskRatio: 0.1,
    },
  });

  const predictions = ep.predict(ctx);
  const ratePreds = predictions.filter((p) => p.errorType === ERROR_TYPE.RATE_LIMIT);
  assert.ok(ratePreds.length > 0, "should predict rate limit at critical quota");
  assert.equal(ratePreds[0].riskLevel, RISK_LEVEL.CRITICAL);
});

test("ErrorPredictor: reset clears all data", () => {
  const ep = new ErrorPredictor();

  ep.learn({ type: ERROR_TYPE.TIMEOUT, context: "op1" });
  ep.learn({ type: ERROR_TYPE.NETWORK_ERROR, context: "op2" });
  ep.learn({ type: ERROR_TYPE.AUTH_FAILURE, context: "op3" });

  ep.reset();

  assert.deepEqual(ep.getErrorHistory(), []);
  const stats = ep.getErrorTypeStats();
  assert.equal(stats.timeout.count, 0);
  assert.equal(stats.networkError.count, 0);
});

test("ErrorPredictor: emits error-learned event on learn", (tContext) => {
  const ep = new ErrorPredictor();
  let emitted = null;

  ep.on("error-learned", (data) => {
    emitted = data;
  });

  ep.learn({ type: ERROR_TYPE.TIMEOUT, context: "op1", recoveryMs: 2000 });

  assert.ok(emitted, "should emit error-learned event");
  assert.equal(emitted.type, ERROR_TYPE.TIMEOUT);
  assert.ok(emitted.stats);
});
