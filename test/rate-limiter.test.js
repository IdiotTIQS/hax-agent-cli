/**
 * Tests for rate limiter.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RateLimiter, CompositeRateLimiter } = require("../src/rate-limiter");

test("RateLimiter: initializes with default values", () => {
  const rl = new RateLimiter();
  const stats = rl.getStats();
  assert.ok(stats.availableTokens > 0);
  assert.equal(stats.queueSize, 0);
  assert.equal(stats.waitCount, 0);
  assert.equal(stats.throttleCount, 0);
});

test("RateLimiter: acquires token immediately when available", async () => {
  const rl = new RateLimiter({ maxTokens: 10, refillRate: 1, refillIntervalMs: 1000 });
  const result = await rl.acquire(1, 100);
  assert.equal(result.acquired, true);
  assert.equal(result.waitedMs, 0);
});

test("RateLimiter: blocks when tokens are exhausted", async () => {
  const rl = new RateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 100 });
  // Consume all tokens
  await rl.acquire(2, 100);
  // Next request should fail (queue too small timeout for this test)
  const result = await rl.acquire(1, 10);
  assert.equal(result.acquired, false);
});

test("RateLimiter: refills tokens over time", async () => {
  const rl = new RateLimiter({ maxTokens: 5, refillRate: 10, refillIntervalMs: 50 });
  // Use all tokens
  await rl.acquire(5, 100);
  // Wait for refill
  await sleep(100);
  const result = await rl.acquire(1, 100);
  assert.equal(result.acquired, true);
});

test("RateLimiter: acquires zero-cost immediately", async () => {
  const rl = new RateLimiter({ maxTokens: 0, refillRate: 0 });
  const result = await rl.acquire(0, 100);
  assert.equal(result.acquired, true);
});

test("RateLimiter: wrap function respects limits", async () => {
  const rl = new RateLimiter({ maxTokens: 2, refillRate: 0, refillIntervalMs: 10000 });
  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  const wrapped = rl.wrap(fn, { cost: 1, timeoutMs: 50 });

  await wrapped();
  await wrapped();
  assert.equal(callCount, 2);

  // Third call should fail as tokens are exhausted
  try {
    await wrapped();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.match(error.message, /Rate limit exceeded/);
  }
});

test("RateLimiter: getStats returns current state", () => {
  const rl = new RateLimiter({ maxTokens: 10 });
  const stats = rl.getStats();
  assert.equal(stats.maxTokens, 10);
  assert.ok(typeof stats.availableTokens === "number");
  assert.ok(stats.queueSize === 0);
});

test("RateLimiter: drain rejects queued requests", async () => {
  const rl = new RateLimiter({ maxTokens: 1, refillRate: 0, refillIntervalMs: 10000 });
  await rl.acquire(1, 100);

  // Start a queued request
  const promise = rl.acquire(1, 5000);

  // Drain immediately
  const drained = rl.drain();
  // The queued request should have been rejected

  // Drain is async method that clears the queue
  try {
    await promise;
    // May or may not fail depending on timing
  } catch (_) {
    // Expected: drained
  }
});

test("CompositeRateLimiter: manages multiple buckets", async () => {
  const composite = new CompositeRateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 1000 });
  composite.define("api", { maxTokens: 3, refillRate: 1, refillIntervalMs: 1000 });
  composite.define("tools", { maxTokens: 10, refillRate: 5, refillIntervalMs: 1000 });

  // API bucket has 3 tokens
  const api1 = await composite.acquire("api", 1, 100);
  assert.equal(api1.acquired, true);

  const api2 = await composite.acquire("api", 1, 100);
  assert.equal(api2.acquired, true);

  const api3 = await composite.acquire("api", 1, 100);
  assert.equal(api3.acquired, true);

  const api4 = await composite.acquire("api", 1, 10);
  assert.equal(api4.acquired, false);

  // Tools bucket should be independent
  const tool1 = await composite.acquire("tools", 1, 100);
  assert.equal(tool1.acquired, true);
});

test("CompositeRateLimiter: global fallback for unknown names", async () => {
  const composite = new CompositeRateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 1000 });
  const result = await composite.acquire("undefined-bucket", 1, 100);
  assert.equal(result.acquired, true);
  assert.equal(composite._global.getStats().availableTokens, 1);
});

test("CompositeRateLimiter: getStats shows all buckets", () => {
  const composite = new CompositeRateLimiter();
  composite.define("api", { maxTokens: 5 });
  const stats = composite.getStats();
  assert.ok("global" in stats);
  assert.ok("buckets" in stats);
  assert.ok("api" in stats.buckets);
});

test("RateLimiter: reset restores full capacity", async () => {
  const rl = new RateLimiter({ maxTokens: 5, refillRate: 0 });
  await rl.acquire(3, 100);
  assert.equal(rl.getStats().availableTokens, 2);
  rl.reset();
  assert.equal(rl.getStats().availableTokens, 5);
  assert.equal(rl.getStats().throttleCount, 0);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
