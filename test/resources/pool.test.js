/**
 * Tests for ResourcePool.
 */
"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { ResourcePool, POLICY } = require("../../src/resources/pool");

// ---- constructor & exports ----

describe("ResourcePool constructor", () => {
  it("creates with default policy FAIR", () => {
    const pool = new ResourcePool();
    assert.equal(pool.poolCount, 0);
  });

  it("accepts custom default policy and name", () => {
    const pool = new ResourcePool({ defaultPolicy: POLICY.PRIORITY, name: "test-pool-mgr" });
    assert.equal(pool.poolCount, 0);
  });
});

// ---- createPool ----

describe("ResourcePool.createPool", () => {
  it("creates a named pool with given capacity", () => {
    const mgr = new ResourcePool();
    mgr.createPool("tokens", 1000, "resource-tokens");
    assert.equal(mgr.poolCount, 1);
  });

  it("throws on duplicate pool name", () => {
    const mgr = new ResourcePool();
    mgr.createPool("cpu", 100);
    assert.throws(() => mgr.createPool("cpu", 200), /already exists/);
  });

  it("throws on empty pool name", () => {
    const mgr = new ResourcePool();
    assert.throws(() => mgr.createPool("", 100), /non-empty string/);
  });
});

// ---- acquire ----

describe("ResourcePool.acquire", () => {
  it("grants resources when sufficient capacity is available", () => {
    const mgr = new ResourcePool();
    mgr.createPool("memory", 1024);
    const result = mgr.acquire("memory", "agent-1", 512);
    assert.equal(result.granted, true);
    assert.equal(result.amount, 512);
    assert.equal(result.remaining, 512);
  });

  it("queues agent when capacity is insufficient", () => {
    const mgr = new ResourcePool();
    mgr.createPool("storage", 100);
    mgr.acquire("storage", "agent-1", 80);
    const result = mgr.acquire("storage", "agent-2", 50);
    assert.equal(result.granted, false);
    assert.equal(result.waitPosition, 1);
    assert.ok(result.reason.startsWith("Queued"));
  });

  it("rejects immediately with noWait option when capacity is insufficient", () => {
    const mgr = new ResourcePool();
    mgr.createPool("bandwidth", 100, "network");
    mgr.acquire("bandwidth", "agent-a", 90);
    const result = mgr.acquire("bandwidth", "agent-b", 50, { noWait: true });
    assert.equal(result.granted, false);
    assert.equal(result.waitPosition, -1);
    assert.ok(result.reason.includes("Insufficient"));
  });

  it("validates pool name and agent ID", () => {
    const mgr = new ResourcePool();
    mgr.createPool("pool-a", 100);
    assert.throws(() => mgr.acquire("nonexistent", "a1", 10), /Unknown pool/);
    assert.throws(() => mgr.acquire("pool-a", "", 10), /non-empty string/);
  });
});

// ---- release ----

describe("ResourcePool.release", () => {
  it("releases resources back to the pool", () => {
    const mgr = new ResourcePool();
    mgr.createPool("tokens", 1000);
    mgr.acquire("tokens", "agent-1", 300);
    const result = mgr.release("tokens", "agent-1", 100);
    assert.equal(result.released, 100);
    assert.equal(result.remaining, 800);
  });

  it("satisfies waiting agents after release", () => {
    const mgr = new ResourcePool();
    mgr.createPool("calls", 100);
    mgr.acquire("calls", "agent-1", 80);
    mgr.acquire("calls", "agent-2", 50); // queued
    const result = mgr.release("calls", "agent-1", 60);
    assert.equal(result.waitersSatisfied, 1);
  });

  it("clamps release to what the agent actually holds", () => {
    const mgr = new ResourcePool();
    mgr.createPool("mem", 1024);
    mgr.acquire("mem", "agent-x", 256);
    const result = mgr.release("mem", "agent-x", 9999);
    assert.equal(result.released, 256);
  });
});

// ---- getUtilization ----

describe("ResourcePool.getUtilization", () => {
  it("returns utilization stats for a specific pool", () => {
    const mgr = new ResourcePool();
    mgr.createPool("disk", 500);
    mgr.acquire("disk", "agent-1", 200);
    const util = mgr.getUtilization("disk");
    assert.equal(util.name, "disk");
    assert.equal(util.allocated, 200);
    assert.equal(util.available, 300);
    assert.equal(util.utilization, 40);
  });

  it("returns aggregate stats across all pools", () => {
    const mgr = new ResourcePool();
    mgr.createPool("pool-a", 100);
    mgr.createPool("pool-b", 200);
    mgr.acquire("pool-a", "a1", 30);
    mgr.acquire("pool-b", "a2", 80);
    const agg = mgr.getUtilization();
    assert.equal(agg.aggregate.poolCount, 2);
    assert.equal(agg.aggregate.totalCapacity, 300);
    assert.equal(agg.aggregate.totalAllocated, 110);
  });
});

// ---- agent tracking ----

describe("ResourcePool agent tracking", () => {
  it("getAgentAllocation returns per-agent info", () => {
    const mgr = new ResourcePool();
    mgr.createPool("tokens", 1000);
    mgr.acquire("tokens", "bot-7", 400);
    const info = mgr.getAgentAllocation("bot-7", "tokens");
    assert.equal(info.allocated, 400);
    assert.equal(info.waiting, false);
  });

  it("isWaiting detects queued agents", () => {
    const mgr = new ResourcePool();
    mgr.createPool("x", 10);
    mgr.acquire("x", "a1", 10);
    mgr.acquire("x", "a2", 5);
    assert.equal(mgr.isWaiting("a2"), true);
    assert.equal(mgr.isWaiting("a1"), false);
  });

  it("cancelAgent removes from wait queue and releases allocations", () => {
    const mgr = new ResourcePool();
    mgr.createPool("p", 100);
    mgr.acquire("p", "agent-x", 80);
    mgr.acquire("p", "agent-y", 50); // queued
    const result = mgr.cancelAgent("agent-y");
    assert.equal(result.canceled, 1);
    assert.equal(mgr.isWaiting("agent-y"), false);
  });
});

// ---- capacity management ----

describe("ResourcePool.setCapacity", () => {
  it("increases capacity and satisfies waiters", () => {
    const mgr = new ResourcePool();
    mgr.createPool("pool", 100);
    mgr.acquire("pool", "a1", 90);
    mgr.acquire("pool", "a2", 30); // queued (need 30, only 10 avail)
    const result = mgr.setCapacity("pool", 200);
    assert.equal(result.current, 200);
    assert.equal(result.waitersSatisfied, 1);
  });

  it("refuses to decrease below current allocation", () => {
    const mgr = new ResourcePool();
    mgr.createPool("pool", 100);
    mgr.acquire("pool", "a1", 80);
    const result = mgr.setCapacity("pool", 50);
    assert.equal(result.current, 80);
  });
});

// ---- policy & wait queue ----

describe("ResourcePool policy and wait queue", () => {
  it("setPolicy changes allocation policy", () => {
    const mgr = new ResourcePool();
    mgr.createPool("p", 100);
    mgr.setPolicy("p", POLICY.PRIORITY);
    assert.throws(() => mgr.setPolicy("p", "INVALID"), /Invalid policy/);
  });

  it("getWaitQueue returns ordered queue entries", () => {
    const mgr = new ResourcePool();
    mgr.createPool("q", 50);
    mgr.acquire("q", "a1", 50);
    mgr.acquire("q", "a2", 30);
    mgr.acquire("q", "a3", 20);
    const queue = mgr.getWaitQueue("q");
    assert.equal(queue.length, 2);
    // Under FAIR policy, both agents have no prior acquisitions,
    // so they sort by amount ascending: a3 (20) before a2 (30)
    assert.equal(queue[0].agentId, "a3");
    assert.equal(queue[0].position, 1);
    assert.equal(queue[1].agentId, "a2");
    assert.equal(queue[1].position, 2);
  });
});

// ---- reports & stats ----

describe("ResourcePool reports and stats", () => {
  it("getReport returns full pool status", () => {
    const mgr = new ResourcePool({ name: "reporter" });
    mgr.createPool("tokens", 500);
    mgr.acquire("tokens", "a1", 100);
    const report = mgr.getReport();
    assert.equal(report.name, "reporter");
    assert.equal(report.totalPools, 1);
    assert.ok(report.pools.tokens);
  });

  it("getStats returns aggregate counters", () => {
    const mgr = new ResourcePool();
    mgr.createPool("p", 100);
    mgr.acquire("p", "a1", 30);
    mgr.release("p", "a1", 10);
    const stats = mgr.getStats();
    assert.equal(stats.totalAcquired, 30);
    assert.equal(stats.totalReleased, 10);
    assert.equal(stats.totalCreated, 1);
  });
});

// ---- remove & reset ----

describe("ResourcePool.removePool", () => {
  it("removes a pool and reports rejected waiters", () => {
    const mgr = new ResourcePool();
    mgr.createPool("p", 10);
    mgr.acquire("p", "a1", 10);
    mgr.acquire("p", "a2", 5); // queued
    const result = mgr.removePool("p");
    assert.equal(result.removed, true);
    assert.equal(result.rejectedWaiters, 1);
    assert.equal(mgr.poolCount, 0);
  });
});

describe("ResourcePool.reset", () => {
  it("clears all allocations and counters", () => {
    const mgr = new ResourcePool();
    mgr.createPool("p1", 100);
    mgr.createPool("p2", 200);
    mgr.acquire("p1", "a1", 50);
    mgr.acquire("p2", "a2", 80);
    mgr.reset();
    assert.equal(mgr.getStats().totalAcquired, 0);
    const util = mgr.getUtilization();
    assert.equal(util.aggregate.totalAllocated, 0);
  });
});
