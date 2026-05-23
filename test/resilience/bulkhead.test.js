/**
 * Tests for Bulkhead and Semaphore.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Bulkhead,
  Semaphore,
  BulkheadRejectedError,
  withBulkhead,
  OVERFLOW_POLICY,
} = require("../../src/resilience/bulkhead");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Bulkhead ----

test("Bulkhead: executes successfully within concurrency limit", async () => {
  const bh = new Bulkhead({ maxConcurrent: 3, maxQueue: 10 });
  const result = await bh.execute(() => Promise.resolve(99));
  assert.equal(result, 99);

  const stats = bh.getStats();
  assert.equal(stats.active, 0);
  assert.equal(stats.totalExecuted, 1);
  assert.equal(stats.rejected, 0);
});

test("Bulkhead: enforces concurrency limit", async () => {
  const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 10 });

  let running = 0;
  let maxRunning = 0;

  const task = () => {
    running += 1;
    if (running > maxRunning) maxRunning = running;
    return sleep(30).then(() => { running -= 1; });
  };

  const tasks = [bh.execute(task), bh.execute(task), bh.execute(task), bh.execute(task), bh.execute(task)];

  await Promise.all(tasks);
  assert.ok(maxRunning <= 2, `Expected maxRunning <= 2, got ${maxRunning}`);
});

test("Bulkhead: rejects when queue is full (THROW policy)", async () => {
  const bh = new Bulkhead({
    maxConcurrent: 1,
    maxQueue: 1,
    overflowPolicy: OVERFLOW_POLICY.THROW,
  });

  // fill the one slot
  const p1 = bh.execute(() => sleep(100));

  // fill the queue
  const p2 = bh.execute(() => sleep(100));

  // this should be rejected
  try {
    await bh.execute(() => Promise.resolve("never"));
    assert.fail("Should have thrown BulkheadRejectedError");
  } catch (error) {
    assert.ok(error instanceof BulkheadRejectedError);
    assert.equal(error.code, "BULKHEAD_REJECTED");
  }

  await p1;
  await p2;

  const stats = bh.getStats();
  assert.equal(stats.rejected, 1);
});

test("Bulkhead: uses CALLER_RUNS when queue is full", async () => {
  const bh = new Bulkhead({
    maxConcurrent: 1,
    maxQueue: 0,
    overflowPolicy: OVERFLOW_POLICY.CALLER_RUNS,
  });

  // fill the one slot with a slow task
  let slowDone = false;
  const slow = bh.execute(() => sleep(50).then(() => { slowDone = true; }));

  // this should run in caller context (not through the semaphore)
  const result = await bh.execute(() => Promise.resolve("caller-ran"));
  assert.equal(result, "caller-ran");

  await slow;
  assert.ok(slowDone);

  const stats = bh.getStats();
  assert.equal(stats.rejected, 1);
  assert.equal(stats.totalExecuted, 2);
});

test("Bulkhead: getStats returns accurate values", async () => {
  const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 5 });

  const statsBefore = bh.getStats();
  assert.equal(statsBefore.active, 0);
  assert.equal(statsBefore.queueSize, 0);
  assert.equal(statsBefore.maxConcurrent, 2);
  assert.equal(statsBefore.maxQueue, 5);

  // start a slow task
  const p = bh.execute(() => sleep(50).then(() => "done"));

  const statsDuring = bh.getStats();
  assert.equal(statsDuring.active, 1);

  await p;

  const statsAfter = bh.getStats();
  assert.equal(statsAfter.active, 0);
  assert.equal(statsAfter.totalExecuted, 1);
});

test("Bulkhead: throws TypeError for non-function argument", async () => {
  const bh = new Bulkhead();
  try {
    await bh.execute(123);
    assert.fail("Should have thrown TypeError");
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
});

// ---- Semaphore ----

test("Semaphore: acquire and release work correctly", async () => {
  const sem = new Semaphore(3);

  const r1 = await sem.acquire();
  assert.equal(sem.active, 1);

  const r2 = await sem.acquire();
  assert.equal(sem.active, 2);

  r1();
  assert.equal(sem.active, 1);

  r2();
  assert.equal(sem.active, 0);
});

test("Semaphore: queues waiters and wakes them on release", async () => {
  const sem = new Semaphore(1);

  const release = await sem.acquire();
  assert.equal(sem.active, 1);

  let secondAcquired = false;
  const p = sem.acquire().then((r) => {
    secondAcquired = true;
    r();
  });

  assert.equal(sem.waiting, 1);
  assert.equal(secondAcquired, false);

  release();

  await p;
  assert.equal(secondAcquired, true);
  assert.equal(sem.active, 0);
});

test("Semaphore: rejects when queue is full", async () => {
  const sem = new Semaphore(1, 2);

  // fill active slot
  const r = await sem.acquire();

  // fill queue
  const p1 = sem.acquire();
  const p2 = sem.acquire();

  assert.equal(sem.waiting, 2);

  // next should reject
  try {
    await sem.acquire();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof BulkheadRejectedError);
  }

  // cleanup — each queued acquire returns a release function
  r();
  const r1 = await p1;
  r1();
  const r2 = await p2;
  r2();
});

test("Semaphore: double-release is safe", async () => {
  const sem = new Semaphore(3);

  const r = await sem.acquire();
  assert.equal(sem.active, 1);

  r();
  assert.equal(sem.active, 0);

  // double release should be a no-op
  r();
  assert.equal(sem.active, 0);
});

// ---- withBulkhead ----

test("withBulkhead: convenience wrapper works", async () => {
  const bh = new Bulkhead({ maxConcurrent: 5 });

  const result = await withBulkhead(bh, () => Promise.resolve("wrapped"));
  assert.equal(result, "wrapped");
});

test("Bulkhead: handles sync functions", async () => {
  const bh = new Bulkhead({ maxConcurrent: 5 });

  const result = await bh.execute(() => 42);
  assert.equal(result, 42);
});

test("Bulkhead: overflowPolicy getter", () => {
  const bh1 = new Bulkhead({ overflowPolicy: OVERFLOW_POLICY.CALLER_RUNS });
  assert.equal(bh1.overflowPolicy, OVERFLOW_POLICY.CALLER_RUNS);

  const bh2 = new Bulkhead({ overflowPolicy: OVERFLOW_POLICY.THROW });
  assert.equal(bh2.overflowPolicy, OVERFLOW_POLICY.THROW);

  const bh3 = new Bulkhead({ overflowPolicy: "INVALID" });
  assert.equal(bh3.overflowPolicy, OVERFLOW_POLICY.THROW);
});
