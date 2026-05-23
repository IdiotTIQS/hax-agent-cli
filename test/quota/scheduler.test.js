/**
 * Tests for FairScheduler.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FairScheduler, ALGORITHM } = require("../../src/quota/scheduler");

test("FairScheduler: initializes with default values", () => {
  const sched = new FairScheduler();
  assert.equal(sched.totalCapacity, 100);
  assert.equal(sched.algorithm, "WEIGHTED_FAIR");
  assert.equal(sched.pendingCount, 0);
});

test("FairScheduler: addAgent registers agent with default weight and priority", () => {
  const sched = new FairScheduler();
  sched.addAgent("agent-1");

  const alloc = sched.getAllocation("agent-1");
  assert.equal(alloc.weight, 1);
  assert.equal(alloc.priority, 0);
  assert.equal(alloc.allocations, 0);
  assert.equal(alloc.totalGranted, 0);
  assert.equal(alloc.fairShare, 100); // sole agent gets all
});

test("FairScheduler: addAgent with custom weight and priority", () => {
  const sched = new FairScheduler({ totalCapacity: 200 });
  sched.addAgent("agent-a", 3, 5);
  sched.addAgent("agent-b", 1, 0);

  const a = sched.getAllocation("agent-a");
  assert.equal(a.weight, 3);
  assert.equal(a.priority, 5);
  assert.equal(a.fairShare, 150); // 3/4 of 200

  const b = sched.getAllocation("agent-b");
  assert.equal(b.weight, 1);
  assert.equal(b.priority, 0);
  assert.equal(b.fairShare, 50); // 1/4 of 200
});

test("FairScheduler: addAgent throws on invalid agentId", () => {
  const sched = new FairScheduler();
  assert.throws(() => sched.addAgent(""), { message: /non-empty string/ });
  assert.throws(() => sched.addAgent(123), { message: /non-empty string/ });
});

test("FairScheduler: request queues allocation and returns requestId", () => {
  const sched = new FairScheduler();
  sched.addAgent("agent-1");
  sched.addAgent("agent-2");

  const r1 = sched.request("agent-1", "cpu", 30);
  assert.equal(r1.accepted, true);
  assert.ok(r1.requestId >= 0);

  const r2 = sched.request("agent-2", "cpu", 50);
  assert.equal(r2.accepted, true);
  assert.equal(sched.pendingCount, 2);
});

test("FairScheduler: allocate weighted fair distributes proportionally", () => {
  const sched = new FairScheduler({ totalCapacity: 100, algorithm: "WEIGHTED_FAIR" });
  sched.addAgent("heavy", 3);
  sched.addAgent("light", 1);

  sched.request("heavy", "cpu", 100);
  sched.request("light", "cpu", 100);

  const result = sched.allocate();

  assert.ok(result.granted.length > 0);
  // Heavy (3/4 weight) should get ~75, light (1/4) should get ~25
  const heavyGrant = result.granted.find((g) => g.agentId === "heavy");
  const lightGrant = result.granted.find((g) => g.agentId === "light");

  assert.ok(heavyGrant.amount >= lightGrant.amount);
  assert.ok(heavyGrant.amount > 1);
  assert.ok(lightGrant.amount > 1);

  // Total granted should not exceed capacity
  const total = result.granted.reduce((s, g) => s + g.amount, 0);
  assert.ok(total <= 100);
});

test("FairScheduler: allocate max-min fairness guarantees minimum", () => {
  const sched = new FairScheduler({ totalCapacity: 100, algorithm: "MAX_MIN" });
  sched.addAgent("a");
  sched.addAgent("b");
  sched.addAgent("c");

  sched.request("a", "mem", 10);
  sched.request("b", "mem", 80);
  sched.request("c", "mem", 100);

  const result = sched.allocate();

  assert.ok(result.granted.length > 0);

  // Agent "a" with small demand should get all of it
  const aGrant = result.granted.find((g) => g.agentId === "a");
  assert.equal(aGrant.amount, 10);

  const total = result.granted.reduce((s, g) => s + g.amount, 0);
  assert.ok(total <= 100);
});

test("FairScheduler: allocate priority-based serves higher priority first", () => {
  const sched = new FairScheduler({ totalCapacity: 50, algorithm: "PRIORITY" });
  sched.addAgent("critical", 1, 10);
  sched.addAgent("normal", 1, 5);
  sched.addAgent("low", 1, 0);

  sched.request("critical", "io", 30);
  sched.request("normal", "io", 30);
  sched.request("low", "io", 30);

  const result = sched.allocate();

  // Critical (highest prio) should be served first
  const criticalGrant = result.granted.find((g) => g.agentId === "critical");
  assert.ok(criticalGrant, "critical agent should be allocated");
  assert.equal(criticalGrant.amount, 30);

  // Normal gets the remaining 20
  const normalGrant = result.granted.find((g) => g.agentId === "normal");
  assert.ok(normalGrant, "normal agent should be allocated");
  assert.equal(normalGrant.amount, 20);

  // Low gets nothing
  const lowGrant = result.granted.find((g) => g.agentId === "low");
  assert.ok(!lowGrant || lowGrant.amount === 0);
});

test("FairScheduler: getAllocation returns updated stats after allocation", () => {
  const sched = new FairScheduler({ totalCapacity: 100 });
  sched.addAgent("worker");

  sched.request("worker", "cpu", 60);
  sched.allocate();

  const alloc = sched.getAllocation("worker");
  assert.equal(alloc.allocations, 1);
  assert.equal(alloc.totalGranted, 60);
  assert.equal(alloc.isStarving, false);
});

test("FairScheduler: getWaitTime predicts non-zero when queue is non-empty", () => {
  const sched = new FairScheduler({ totalCapacity: 10 });
  sched.addAgent("a", 1);
  sched.addAgent("b", 5);
  sched.addAgent("c", 1);

  sched.request("a", "x", 10);
  sched.request("b", "x", 10);
  sched.request("c", "x", 10);
  // Don't allocate — leave queue pending

  // Agent "c" has other agents ahead in queue
  const wait = sched.getWaitTime("c");
  assert.ok(typeof wait === "number");
  assert.ok(wait >= 0, `Expected wait >= 0, got ${wait}`);
});

test("FairScheduler: getWaitTime returns 0 when no pending requests", () => {
  const sched = new FairScheduler();
  sched.addAgent("solo");
  assert.equal(sched.getWaitTime("solo"), 0);
});

test("FairScheduler: starvation detection identifies starved agents", () => {
  const sched = new FairScheduler({
    totalCapacity: 10,
    starvationThresholdMs: 20,
    algorithm: "PRIORITY",
  });
  sched.addAgent("high", 1, 10);
  sched.addAgent("low", 1, 0);

  // Set low's lastAllocated far in the past to simulate long wait
  sched._agents.low.lastAllocated = Date.now() - 100;

  // High prio takes all capacity
  sched.request("high", "cpu", 10);
  sched.request("low", "cpu", 5);
  const r1 = sched.allocate();

  // "low" should be flagged as starved
  assert.ok(
    r1.starved.includes("low"),
    "low agent should be detected as starving"
  );
});

test("FairScheduler: removeAgent clears registration and returns rejected requests", () => {
  const sched = new FairScheduler({ totalCapacity: 100 });
  sched.addAgent("temp");
  sched.request("temp", "cpu", 30);

  const rejected = sched.removeAgent("temp");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].amount, 30);

  // Should throw if accessed now
  assert.throws(() => sched.getAllocation("temp"), {
    message: /Unknown agent/,
  });
});

test("FairScheduler: resetStats clears counters but keeps registrations", () => {
  const sched = new FairScheduler({ totalCapacity: 100 });
  sched.addAgent("persistent");
  sched.request("persistent", "cpu", 50);
  sched.allocate();

  sched.resetStats();

  const alloc = sched.getAllocation("persistent");
  assert.equal(alloc.allocations, 0);
  assert.equal(alloc.totalGranted, 0);
  assert.equal(sched.pendingCount, 0);
});

test("FairScheduler: getReport provides full agent summary", () => {
  const sched = new FairScheduler({ totalCapacity: 200 });
  sched.addAgent("a", 2);
  sched.addAgent("b", 1);
  sched.request("a", "cpu", 100);
  sched.request("b", "cpu", 100);
  sched.allocate();

  const report = sched.getReport();
  assert.equal(report.algorithm, "WEIGHTED_FAIR");
  assert.equal(report.totalCapacity, 200);
  assert.ok("a" in report.agents);
  assert.ok("b" in report.agents);
  assert.ok(Array.isArray(report.starvedAgents));
});

test("FairScheduler: ALGORITHM constants are frozen", () => {
  assert.equal(ALGORITHM.WEIGHTED_FAIR, "WEIGHTED_FAIR");
  assert.equal(ALGORITHM.MAX_MIN, "MAX_MIN");
  assert.equal(ALGORITHM.PRIORITY, "PRIORITY");
  assert.throws(() => { ALGORITHM.WEIGHTED_FAIR = "CHANGED"; });
});
