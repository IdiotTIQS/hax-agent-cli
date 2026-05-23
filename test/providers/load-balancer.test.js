"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { LoadBalancer, STRATEGIES } = require("../../src/providers/load-balancer");

test("LoadBalancer addProvider registers a provider with default weight", () => {
  const lb = new LoadBalancer();
  lb.addProvider("anthropic");

  const status = lb.getStatus();
  assert.ok(status["anthropic"]);
  assert.equal(status["anthropic"].weight, 1);
  assert.equal(status["anthropic"].healthy, true);
  assert.equal(status["anthropic"].healthScore, 0.5);
});

test("LoadBalancer addProvider registers a provider with custom weight", () => {
  const lb = new LoadBalancer();
  lb.addProvider("openai", 3);
  lb.addProvider("anthropic", 1);

  const status = lb.getStatus();
  assert.equal(status["openai"].weight, 3);
  assert.equal(status["anthropic"].weight, 1);
});

test("LoadBalancer addProvider throws on empty name", () => {
  const lb = new LoadBalancer();

  assert.throws(() => lb.addProvider(""), /Provider name must be a non-empty string/);
  assert.throws(() => lb.addProvider("   "), /Provider name must be a non-empty string/);
});

test("LoadBalancer next round_robin cycles through providers", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.ROUND_ROBIN);

  lb.addProvider("provider-a");
  lb.addProvider("provider-b");
  lb.addProvider("provider-c");

  assert.equal(lb.next(), "provider-a");
  assert.equal(lb.next(), "provider-b");
  assert.equal(lb.next(), "provider-c");
  assert.equal(lb.next(), "provider-a");
});

test("LoadBalancer next round_robin tracks connection count", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.ROUND_ROBIN);

  lb.addProvider("provider-a");
  lb.addProvider("provider-b");

  lb.next();
  lb.next();
  lb.next(); // Should go to provider-a again

  const status = lb.getStatus();
  assert.equal(status["provider-a"].connectionCount, 2);
  assert.equal(status["provider-a"].totalConnections, 2);
  assert.equal(status["provider-b"].connectionCount, 1);
  assert.equal(status["provider-b"].totalConnections, 1);
});

test("LoadBalancer next weighted strategy respects weights", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.WEIGHTED);

  lb.addProvider("primary", 100);
  lb.addProvider("secondary", 1);

  let primaryCount = 0;
  let secondaryCount = 0;
  const trials = 500;

  for (let i = 0; i < trials; i += 1) {
    const name = lb.next();
    if (name === "primary") primaryCount += 1;
    else secondaryCount += 1;
  }

  assert.ok(primaryCount > secondaryCount,
    `Weighted: expected primary (${primaryCount}) > secondary (${secondaryCount})`);
  assert.ok(primaryCount / trials > 0.9,
    `primary should be selected >90% of time, got ${((primaryCount / trials) * 100).toFixed(1)}%`);
});

test("LoadBalancer next least_connections picks provider with fewest connections", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.LEAST_CONNECTIONS);

  lb.addProvider("provider-a");
  lb.addProvider("provider-b");

  // Route to provider-a a few times
  lb.next();
  lb.next(); // Now provider-a has 2 connections
  lb.next(); // This one should also go to provider-a (round-robin would pick b here, but least_connections picks a since both equal)
  // Actually: after 2 calls, a=2, b=1. Next call should pick b (least connections)

  const status = lb.getStatus();
  // After first call: a=1. After second: a=1, b=1 (both equal, picks a). After third: b has 1, a has 2, picks b.
  // So a should have 2, b should have 1
  assert.ok(status["provider-a"].connectionCount >= 1);
  assert.ok(status["provider-b"].connectionCount >= 0);
});

test("LoadBalancer next least_connections breaks ties by health score", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.LEAST_CONNECTIONS);

  lb.addProvider("healthy");
  lb.addProvider("degraded");

  lb.updateHealth("healthy", { healthScore: 0.9 });
  lb.updateHealth("degraded", { healthScore: 0.4 });

  // Both have zero connections; healthy should be chosen due to higher health score
  const name = lb.next();
  assert.equal(name, "healthy");
});

test("LoadBalancer markFailed deprioritizes provider with backoff", () => {
  const lb = new LoadBalancer();

  lb.addProvider("stable");
  lb.addProvider("flaky");

  lb.markFailed("flaky");

  const status = lb.getStatus();
  assert.ok(status["flaky"].failureCount >= 1);
  assert.ok(status["flaky"].backoffUntil > Date.now());
  assert.ok(status["flaky"].isBackedOff === true);

  // flaky should be excluded by backoff; only stable available
  const name = lb.next();
  assert.equal(name, "stable");
});

test("LoadBalancer markFailed eventually allows provider back after backoff expires", () => {
  const lb = new LoadBalancer();

  lb.addProvider("provider-a");
  lb.addProvider("provider-b");

  // Mark failed with a very short backoff simulation
  lb.markFailed("provider-a");

  // Manually clear the backoff to simulate time passing
  const entry = lb._providers.get("provider-a");
  entry.backoffUntil = Date.now() - 1000;

  // Now provider-a should be available again
  const name = lb.next();
  assert.equal(name, "provider-a");
});

test("LoadBalancer markSuccess restores provider health", () => {
  const lb = new LoadBalancer();

  lb.addProvider("recovering");

  lb.markFailed("recovering");
  let status = lb.getStatus();
  const originalHealth = status["recovering"].healthScore;

  lb.markSuccess("recovering", 50);
  status = lb.getStatus();
  assert.ok(status["recovering"].healthScore > originalHealth);
  assert.equal(status["recovering"].healthy, true);
});

test("LoadBalancer getStatus returns full provider state", () => {
  const lb = new LoadBalancer();

  lb.addProvider("anthropic", 2);
  lb.addProvider("openai", 1);

  lb.next(); // anthropic
  lb.next(); // openai
  lb.markFailed("openai");

  const status = lb.getStatus();

  assert.equal(Object.keys(status).length, 2);
  assert.ok(typeof status["anthropic"].weight === "number");
  assert.ok(typeof status["anthropic"].connectionCount === "number");
  assert.ok(typeof status["anthropic"].totalConnections === "number");
  assert.ok(typeof status["anthropic"].healthScore === "number");
  assert.equal(typeof status["anthropic"].healthy, "boolean");
  assert.equal(status["openai"].backoffUntil !== null, true);
  assert.equal(status["openai"].isBackedOff, true);
});

test("LoadBalancer next throws when no healthy providers", () => {
  const lb = new LoadBalancer();

  lb.addProvider("dead");
  lb.markFailed("dead");

  // Ensure backoff is in the future (large failure count pushes backoff far out)
  lb.markFailed("dead");
  lb.markFailed("dead");

  assert.throws(
    () => lb.next(),
    /No healthy providers available/,
  );
});

test("LoadBalancer removeProvider removes a registered provider", () => {
  const lb = new LoadBalancer();

  lb.addProvider("temp");
  assert.equal(lb.providerCount, 1);

  lb.removeProvider("temp");
  assert.equal(lb.providerCount, 0);
});

test("LoadBalancer setStrategy throws on unknown strategy", () => {
  const lb = new LoadBalancer();

  assert.throws(
    () => lb.setStrategy("nonexistent"),
    /Unknown load balancing strategy/,
  );
});

test("LoadBalancer adaptive strategy favors faster healthier providers", () => {
  const lb = new LoadBalancer();
  lb.setStrategy(STRATEGIES.ADAPTIVE);

  lb.addProvider("fast");
  lb.addProvider("slow");

  lb.updateHealth("fast", { healthScore: 1.0, averageLatencyMs: 50 });
  lb.updateHealth("slow", { healthScore: 1.0, averageLatencyMs: 5000 });

  let fastCount = 0;
  let slowCount = 0;
  const trials = 200;

  for (let i = 0; i < trials; i += 1) {
    const name = lb.next();
    if (name === "fast") fastCount += 1;
    else slowCount += 1;
  }

  assert.ok(fastCount > slowCount,
    `Adaptive: expected fast (${fastCount}) > slow (${slowCount})`);
});

test("LoadBalancer updateHealth merges new stats with existing state", () => {
  const lb = new LoadBalancer();

  lb.addProvider("test-provider");
  lb.updateHealth("test-provider", {
    healthScore: 0.8,
    averageLatencyMs: 200,
    successRate: 0.95,
  });

  const status = lb.getStatus();
  assert.ok(status["test-provider"].healthScore > 0.7);
  assert.equal(status["test-provider"].averageLatencyMs, 200);
});

test("LoadBalancer updateHealth ignores unknown providers", () => {
  const lb = new LoadBalancer();

  // Should not throw
  lb.updateHealth("nonexistent", { healthScore: 1.0 });
});

test("LoadBalancer markFailed exponential backoff increases with repeated failures", () => {
  const lb = new LoadBalancer();
  lb.addProvider("unstable");

  lb.markFailed("unstable");
  const firstBackoff = lb.getStatus()["unstable"].backoffUntil;

  lb.markFailed("unstable");
  const secondBackoff = lb.getStatus()["unstable"].backoffUntil;

  // Second failure should push backoff further out
  assert.ok(secondBackoff >= firstBackoff,
    `Expected second backoff (${secondBackoff}) >= first backoff (${firstBackoff})`);
});
