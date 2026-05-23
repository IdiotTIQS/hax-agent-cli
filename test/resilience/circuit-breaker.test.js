/**
 * Tests for CircuitBreaker.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CircuitBreaker, CircuitBreakerOpenError, STATE } = require("../../src/resilience/circuit-breaker");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Core behavior ----

test("CircuitBreaker: executes successfully in CLOSED state", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
  const result = await cb.execute(() => Promise.resolve(42));
  assert.equal(result, 42);

  const { state, stats } = cb.getState();
  assert.equal(state, STATE.CLOSED);
  assert.equal(stats.successCount, 1);
  assert.equal(stats.failureCount, 0);
});

test("CircuitBreaker: trips to OPEN after failureThreshold is reached", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 200 });

  const failing = () => Promise.reject(new Error("boom"));

  try { await cb.execute(failing); } catch (_) { /* expected */ }
  try { await cb.execute(failing); } catch (_) { /* expected */ }
  try { await cb.execute(failing); } catch (_) { /* expected */ }

  assert.equal(cb.state, STATE.OPEN);

  const { stats } = cb.getState();
  assert.equal(stats.failureCount, 3);
  assert.equal(stats.failureWindowCount, 3);
});

test("CircuitBreaker: fast-fails in OPEN state", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 500 });

  // trip
  try { await cb.execute(() => Promise.reject(new Error("e1"))); } catch (_) {}
  try { await cb.execute(() => Promise.reject(new Error("e2"))); } catch (_) {}

  assert.equal(cb.state, STATE.OPEN);

  // subsequent call should fast-fail
  try {
    await cb.execute(() => Promise.resolve("should not run"));
    assert.fail("Should have thrown CircuitBreakerOpenError");
  } catch (error) {
    assert.ok(error instanceof CircuitBreakerOpenError);
    assert.equal(error.code, "CIRCUIT_BREAKER_OPEN");
  }

  const { stats } = cb.getState();
  assert.equal(stats.rejectedCount, 1);
});

test("CircuitBreaker: transitions to HALF_OPEN after resetTimeout", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

  // trip
  try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch (_) {}
  assert.equal(cb.state, STATE.OPEN);

  await sleep(80);
  assert.equal(cb.state, STATE.HALF_OPEN);
});

test("CircuitBreaker: recovers to CLOSED on success in HALF_OPEN", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30 });

  try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch (_) {}
  await sleep(50);
  assert.equal(cb.state, STATE.HALF_OPEN);

  const result = await cb.execute(() => Promise.resolve("recovered"));
  assert.equal(result, "recovered");
  assert.equal(cb.state, STATE.CLOSED);

  const { stats } = cb.getState();
  assert.equal(stats.successCount, 1);
});

test("CircuitBreaker: re-opens on failure in HALF_OPEN", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30 });

  try { await cb.execute(() => Promise.reject(new Error("fail1"))); } catch (_) {}
  await sleep(50);
  assert.equal(cb.state, STATE.HALF_OPEN);

  try {
    await cb.execute(() => Promise.reject(new Error("fail2")));
  } catch (_) {}

  assert.equal(cb.state, STATE.OPEN);
});

test("CircuitBreaker: sliding window ignores old failures", async () => {
  // short window of 50ms
  const cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 500,
    slidingWindowMs: 50,
  });

  // first failure
  try { await cb.execute(() => Promise.reject(new Error("f1"))); } catch (_) {}
  assert.equal(cb.state, STATE.CLOSED);

  await sleep(60); // window has passed

  // second failure — should not count the first
  try { await cb.execute(() => Promise.reject(new Error("f2"))); } catch (_) {}
  assert.equal(cb.state, STATE.CLOSED);

  // third and fourth in rapid succession
  try { await cb.execute(() => Promise.reject(new Error("f3"))); } catch (_) {}
  assert.equal(cb.state, STATE.CLOSED);

  try { await cb.execute(() => Promise.reject(new Error("f4"))); } catch (_) {}
  // f2 is now outside the window but f3+f4 are inside — still only 2 in window
  // We need 3, so still CLOSED. Let's add a 5th.
  try { await cb.execute(() => Promise.reject(new Error("f5"))); } catch (_) {}
  // f3, f4, f5 should be within the window now
  assert.equal(cb.state, STATE.OPEN);
});

test("CircuitBreaker: manual reset forces CLOSED state", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1 });

  try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch (_) {}
  assert.equal(cb.state, STATE.OPEN);

  cb.reset();
  assert.equal(cb.state, STATE.CLOSED);

  const { stats } = cb.getState();
  assert.equal(stats.failureCount, 0);
  assert.equal(stats.rejectedCount, 0);
});

test("CircuitBreaker: getState returns complete stats", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, name: "api-cb" });

  try { await cb.execute(() => Promise.reject(new Error("x"))); } catch (_) {}
  try { await cb.execute(() => Promise.reject(new Error("y"))); } catch (_) {}

  const { state, stats } = cb.getState();
  assert.equal(state, STATE.OPEN);
  assert.equal(stats.failureCount, 2);
  assert.equal(stats.failureWindowCount, 2);
  assert.equal(stats.rejectedCount, 0);
  assert.ok(stats.openedAt instanceof Date);
  assert.ok(typeof stats.timeUntilReset === "number");
  assert.ok(stats.timeUntilReset > 0);
});

test("CircuitBreaker: emits events on state transitions", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30 });
  const events = [];

  cb.on("open", () => events.push("open"));
  cb.on("close", () => events.push("close"));
  cb.on("half-open", () => events.push("half-open"));
  cb.on("trip", () => events.push("trip"));

  // trip to OPEN (trip fires before open in _onFailure)
  try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch (_) {}
  assert.deepEqual(events, ["trip", "open"]);

  // wait for HALF_OPEN
  await sleep(50);
  assert.deepEqual(events, ["trip", "open", "half-open"]);

  // recover to CLOSED
  await cb.execute(() => Promise.resolve("ok"));
  assert.deepEqual(events, ["trip", "open", "half-open", "close"]);
});

test("CircuitBreaker: halfOpenMaxCalls limits concurrent probes", async () => {
  const cb = new CircuitBreaker({
    failureThreshold: 1,
    resetTimeout: 30,
    halfOpenMaxCalls: 2,
  });

  try { await cb.execute(() => Promise.reject(new Error("fail"))); } catch (_) {}
  await sleep(50);
  assert.equal(cb.state, STATE.HALF_OPEN);

  // start a long-running HALF_OPEN call
  let running = true;
  const slow = new Promise((resolve) => setTimeout(() => { running = false; resolve("slow"); }, 100));

  const p1 = cb.execute(() => slow);
  await sleep(5);

  // second call within limit — should be allowed
  const p2 = cb.execute(() => Promise.resolve("fast"));

  // third call — should be rejected
  try {
    await cb.execute(() => Promise.resolve("third"));
    assert.fail("Should have rejected third concurrent call in HALF_OPEN");
  } catch (error) {
    assert.ok(error instanceof CircuitBreakerOpenError);
    assert.equal(error.code, "CIRCUIT_BREAKER_HALF_OPEN_FULL");
  }

  const r2 = await p2;
  assert.equal(r2, "fast");

  // wait for slow to complete to re-enter CLOSED
  const r1 = await p1;
  assert.equal(r1, "slow");
});

test("CircuitBreaker: throws TypeError for non-function argument", async () => {
  const cb = new CircuitBreaker();
  try {
    await cb.execute("not a function");
    assert.fail("Should have thrown TypeError");
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
});
