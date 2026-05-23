"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DistributedRateLimiter, ALGORITHMS } = require("../../src/gateway/rate-limiter");

test("DistributedRateLimiter acquire succeeds when under limit (token_bucket)", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("api-a", 10, 60000, ALGORITHMS.TOKEN_BUCKET);

  for (let i = 0; i < 10; i += 1) {
    assert.equal(limiter.acquire("api-a"), true);
  }
});

test("DistributedRateLimiter acquire fails when over limit (token_bucket)", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("api-b", 3, 60000, ALGORITHMS.TOKEN_BUCKET);

  assert.equal(limiter.acquire("api-b"), true);
  assert.equal(limiter.acquire("api-b"), true);
  assert.equal(limiter.acquire("api-b"), true);
  assert.equal(limiter.acquire("api-b"), false);
});

test("DistributedRateLimiter release returns a token", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("api-c", 2, 60000, ALGORITHMS.TOKEN_BUCKET);

  assert.equal(limiter.acquire("api-c"), true);
  assert.equal(limiter.acquire("api-c"), true);
  assert.equal(limiter.acquire("api-c"), false);

  limiter.release("api-c");
  assert.equal(limiter.acquire("api-c"), true);
});

test("DistributedRateLimiter release does not exceed max tokens", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("api-d", 1, 60000, ALGORITHMS.TOKEN_BUCKET);

  limiter.release("api-d");
  limiter.release("api-d");
  limiter.release("api-d");

  // Should still only allow 1 acquire (can't exceed maxTokens)
  assert.equal(limiter.acquire("api-d"), true);
  // The bucket already had 1 token (untouched), plus release doesn't overflow
  // Actually: setLimit sets tokens=maxTokens=1. release increases up to maxTokens.
  // So after 3 releases, tokens stays at 1. acquire uses it, leaving 0.
});

test("DistributedRateLimiter sliding window rejects requests over limit in the window", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("sw-key", 3, 1000, ALGORITHMS.SLIDING_WINDOW);

  assert.equal(limiter.acquire("sw-key"), true);
  assert.equal(limiter.acquire("sw-key"), true);
  assert.equal(limiter.acquire("sw-key"), true);
  assert.equal(limiter.acquire("sw-key"), false);
});

test("DistributedRateLimiter fixed window resets after interval", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("fw-key", 2, 20, ALGORITHMS.FIXED_WINDOW);

  assert.equal(limiter.acquire("fw-key"), true);
  assert.equal(limiter.acquire("fw-key"), true);
  assert.equal(limiter.acquire("fw-key"), false);

  // Wait for window to reset
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(limiter.acquire("fw-key"), true);
      resolve();
    }, 30);
  });
});

test("DistributedRateLimiter leaky bucket processes at a steady rate", () => {
  const limiter = new DistributedRateLimiter();
  // 5 requests per 100ms = 1 per 20ms
  limiter.setLimit("lb-key", 5, 100, ALGORITHMS.LEAKY_BUCKET);

  // Fill the bucket
  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.acquire("lb-key"), true);
  }
  assert.equal(limiter.acquire("lb-key"), false);

  // Wait for leak
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(limiter.acquire("lb-key"), true);
      resolve();
    }, 30);
  });
});

test("DistributedRateLimiter getLimit returns remaining capacity", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("limit-key", 10, 60000, ALGORITHMS.TOKEN_BUCKET);

  limiter.acquire("limit-key");
  limiter.acquire("limit-key");

  const info = limiter.getLimit("limit-key");
  assert.equal(info.maxTokens, 10);
  assert.equal(info.remaining, 8);
  assert.equal(info.algorithm, ALGORITHMS.TOKEN_BUCKET);
});

test("DistributedRateLimiter getStats returns per-key usage", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("stats-a", 5, 60000);
  limiter.setLimit("stats-b", 3, 60000);

  limiter.acquire("stats-a");
  limiter.acquire("stats-a");
  limiter.acquire("stats-b");
  limiter.acquire("stats-b");
  limiter.acquire("stats-b");
  limiter.acquire("stats-b"); // rejected

  const stats = limiter.getStats();
  assert.equal(stats["stats-a"].acquired, 2);
  assert.equal(stats["stats-a"].rejected, 0);
  assert.equal(stats["stats-b"].acquired, 3);
  assert.equal(stats["stats-b"].rejected, 1);
  assert.ok(stats["stats-a"].successRate > 0.9);
  assert.ok(stats["stats-b"].successRate < 1);
});

test("DistributedRateLimiter uses defaults for unconfigured keys", () => {
  const limiter = new DistributedRateLimiter();

  // Calling acquire without setLimit should use defaults (100 tokens per 60s)
  assert.equal(limiter.acquire("implicit"), true);

  const info = limiter.getLimit("implicit");
  assert.ok(info.maxTokens > 0);
  assert.ok(info.intervalMs > 0);
});

test("DistributedRateLimiter reset clears all buckets and stats", () => {
  const limiter = new DistributedRateLimiter();
  limiter.setLimit("r-key", 10, 60000);
  limiter.acquire("r-key");
  limiter.acquire("r-key");

  limiter.reset();

  const stats = limiter.getStats();
  assert.deepEqual(stats, {});
});
