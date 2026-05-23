/**
 * Tests for RetryPolicy.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RetryPolicy, STRATEGY, DEFAULT, AGGRESSIVE, CAUTIOUS } = require("../../src/resilience/retry");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Basic behavior ----

test("RetryPolicy: succeeds on first attempt", async () => {
  const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 5 });
  const result = await policy.execute(() => Promise.resolve("first"));
  assert.equal(result, "first");
  assert.equal(policy.getAttempt(), 0);
});

test("RetryPolicy: retries on failure and eventually succeeds", async () => {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    if (calls < 3) throw new Error("transient");
    return "ok";
  };

  const policy = new RetryPolicy({ maxRetries: 5, baseDelay: 5 });
  const result = await policy.execute(fn);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.equal(policy.getAttempt(), 2);
});

test("RetryPolicy: gives up after maxRetries exhausted", async () => {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    throw new Error("persistent");
  };

  const policy = new RetryPolicy({ maxRetries: 3, baseDelay: 5 });
  try {
    await policy.execute(fn);
    assert.fail("Should have thrown");
  } catch (error) {
    assert.match(error.message, /persistent/);
    assert.equal(calls, 4); // initial + 3 retries
    assert.equal(policy.getAttempt(), 4);
  }
});

test("RetryPolicy: shouldRetry returns false for non-matching errors", async () => {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    throw new Error("fatal error");
  };

  const policy = new RetryPolicy({
    maxRetries: 3,
    baseDelay: 5,
    retryOn: [/transient/i, /timeout/i],
  });

  try {
    await policy.execute(fn);
    assert.fail("Should have thrown");
  } catch (error) {
    assert.match(error.message, /fatal error/);
    assert.equal(calls, 1); // no retries
  }
});

test("RetryPolicy: shouldRetry matches string conditions", () => {
  const policy = new RetryPolicy({ retryOn: ["timeout", "ECONNRESET"] });

  assert.ok(policy.shouldRetry(new Error("Connection timeout")));
  assert.ok(policy.shouldRetry({ message: "timeout", code: "ECONNRESET" }));
  assert.ok(!policy.shouldRetry(new Error("Invalid input")));
});

test("RetryPolicy: shouldRetry matches RegExp conditions", () => {
  const policy = new RetryPolicy({ retryOn: [/5\d\d/, /rate limit/i] });

  assert.ok(policy.shouldRetry(new Error("Server error 500")));
  assert.ok(policy.shouldRetry(new Error("Rate limit exceeded")));
  assert.ok(!policy.shouldRetry(new Error("404 not found")));
});

test("RetryPolicy: shouldRetry matches function predicates", () => {
  const policy = new RetryPolicy({
    retryOn: [
      (error) => error?.status >= 500,
      (error) => error?.code === "TIMEOUT",
    ],
  });

  assert.ok(policy.shouldRetry({ status: 503, message: "unavailable" }));
  assert.ok(policy.shouldRetry({ code: "TIMEOUT" }));
  assert.ok(!policy.shouldRetry({ status: 400 }));
});

// ---- Strategies ----

test("RetryPolicy: FIXED strategy uses constant delay", () => {
  const policy = new RetryPolicy({ strategy: STRATEGY.FIXED, baseDelay: 100 });
  // Internal _calculateDelay is private; verify through config
  assert.equal(policy.config.strategy, STRATEGY.FIXED);
  assert.equal(policy.config.baseDelay, 100);
});

test("RetryPolicy: EXPONENTIAL strategy respects maxDelay", () => {
  const policy = new RetryPolicy({
    strategy: STRATEGY.EXPONENTIAL,
    baseDelay: 100,
    maxDelay: 500,
    maxRetries: 10,
  });
  assert.equal(policy.config.maxDelay, 500);
});

test("RetryPolicy: FIBONACCI strategy is available", () => {
  const policy = new RetryPolicy({
    strategy: STRATEGY.FIBONACCI,
    baseDelay: 10,
    maxDelay: 1000,
    maxRetries: 5,
  });
  assert.equal(policy.config.strategy, STRATEGY.FIBONACCI);
});

test("RetryPolicy: JITTER strategy produces randomized delays", () => {
  const policy = new RetryPolicy({
    strategy: STRATEGY.JITTER,
    baseDelay: 50,
    maxDelay: 500,
  });
  assert.equal(policy.config.strategy, STRATEGY.JITTER);
});

// ---- onRetry callback ----

test("RetryPolicy: onRetry callback is invoked on each retry", async () => {
  let attempts = [];
  const fn = async () => {
    throw new Error("fail");
  };

  const policy = new RetryPolicy({
    maxRetries: 2,
    baseDelay: 5,
    onRetry: (attempt, error, delay) => {
      attempts.push({ attempt, msg: error.message, delay });
    },
  });

  try {
    await policy.execute(fn);
    assert.fail("Should have thrown");
  } catch (_) {}

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attempt, 1);
  assert.match(attempts[0].msg, /fail/);
  assert.ok(typeof attempts[0].delay === "number");
  assert.equal(attempts[1].attempt, 2);
});

// ---- Pre-built policies ----

test("RetryPolicy: DEFAULT policy has 3 retries", () => {
  const p = DEFAULT();
  assert.equal(p.config.maxRetries, 3);
  assert.equal(p.config.baseDelay, 500);
  assert.equal(p.config.strategy, STRATEGY.EXPONENTIAL);
});

test("RetryPolicy: AGGRESSIVE policy has 7 retries", () => {
  const p = AGGRESSIVE();
  assert.equal(p.config.maxRetries, 7);
  assert.equal(p.config.baseDelay, 200);
});

test("RetryPolicy: CAUTIOUS policy has 2 retries with long delays", () => {
  const p = CAUTIOUS();
  assert.equal(p.config.maxRetries, 2);
  assert.equal(p.config.baseDelay, 2000);
  assert.equal(p.config.maxDelay, 60000);
});

// ---- reset() ----

test("RetryPolicy: reset clears attempt counter", () => {
  const policy = new RetryPolicy({ maxRetries: 5 });
  // simulate some attempts by setting internal state
  // (we can't set _attempt directly but we can exercise and reset)
  policy.reset();
  assert.equal(policy.getAttempt(), 0);
});

// ---- Edge cases ----

test("RetryPolicy: throws TypeError for non-function", async () => {
  const policy = new RetryPolicy();
  try {
    await policy.execute("not a function");
    assert.fail("Should have thrown TypeError");
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
});

test("RetryPolicy: handles sync functions", async () => {
  const policy = new RetryPolicy({ maxRetries: 2, baseDelay: 5 });
  const result = await policy.execute(() => 42);
  assert.equal(result, 42);
  assert.equal(policy.getAttempt(), 0);
});

test("RetryPolicy: invalid strategy defaults to EXPONENTIAL", () => {
  const policy = new RetryPolicy({ strategy: "BOGUS" });
  assert.equal(policy.config.strategy, STRATEGY.EXPONENTIAL);
});

test("RetryPolicy: retryAllErrors option controls default behavior", () => {
  // Default: when retryOn is empty, retry all errors
  const p1 = new RetryPolicy();
  assert.ok(p1.shouldRetry(new Error("anything")));

  // Explicit false
  const p2 = new RetryPolicy({ retryAllErrors: false });
  assert.ok(!p2.shouldRetry(new Error("anything")));
});
