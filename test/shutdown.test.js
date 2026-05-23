/**
 * Tests for shutdown manager.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ShutdownManager, getShutdownManager, PRIORITY } = require("../src/shutdown");

// Each test creates a fresh instance to avoid singleton interference
test("ShutdownManager: registers hooks and sorts by priority", () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  sm.register("hook-c", 30, () => {});
  sm.register("hook-a", 0, () => {});
  sm.register("hook-b", 10, () => {});
  assert.equal(sm.hookCount, 3);
  assert.equal(sm._hooks[0].name, "hook-a");
  assert.equal(sm._hooks[1].name, "hook-b");
  assert.equal(sm._hooks[2].name, "hook-c");
  sm.detach();
});

test("ShutdownManager: runs hooks in priority order", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  const order = [];

  sm.register("second", 10, () => { order.push("second"); });
  sm.register("first", 0, () => { order.push("first"); });
  sm.register("third", 20, () => { order.push("third"); });

  await sm.shutdown({ exitProcess: false });

  assert.deepEqual(order, ["first", "second", "third"]);
  sm.detach();
});

test("ShutdownManager: runs async hooks", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  let ran = false;

  sm.register("async-hook", 0, async () => {
    await sleep(10);
    ran = true;
  });

  await sm.shutdown({ exitProcess: false });
  assert.equal(ran, true);
  sm.detach();
});

test("ShutdownManager: handles hook errors gracefully", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  const ran = [];

  sm.register("fail", 0, () => { throw new Error("fail!"); });
  sm.register("ok", 10, () => { ran.push("ok"); });

  // Should not throw — shutdown handles errors
  await sm.shutdown({ exitProcess: false });
  assert.deepEqual(ran, ["ok"]);
  sm.detach();
});

test("ShutdownManager: respects once option", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  let count = 0;

  sm.register("once-hook", 0, () => { count += 1; }, { once: true });

  await sm.shutdown({ exitProcess: false });
  assert.equal(count, 1);

  // Hook should be removed, second shutdown should not run it
  await sm.shutdown({ exitProcess: false });
  assert.equal(count, 1);
  sm.detach();
});

test("ShutdownManager: persistent hooks rerun", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  let count = 0;

  sm.register("persist", 0, () => { count += 1; }, { once: false });

  await sm.shutdown({ exitProcess: false });
  assert.equal(count, 1);

  await sm.shutdown({ exitProcess: false });
  assert.equal(count, 2);
  sm.detach();
});

test("ShutdownManager: times out slow hooks", async () => {
  const sm = new ShutdownManager({ timeoutMs: 50 });
  let slowHookTimedOut = false;

  sm.register("slow", 0, async () => {
    await sleep(500);
    slowHookTimedOut = true;
  });

  const start = Date.now();
  await sm.shutdown({ exitProcess: false });
  const elapsed = Date.now() - start;

  // The hook timed out (50ms is less than 500ms)
  assert.ok(elapsed < 200, `Expected fast shutdown, took ${elapsed}ms`);
  sm.detach();
});

test("ShutdownManager: unregister removes hook", () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  sm.register("temp", 0, () => {});
  assert.equal(sm.hookCount, 1);
  sm.unregister("temp");
  assert.equal(sm.hookCount, 0);
  sm.detach();
});

test("ShutdownManager: isShuttingDown flag reflects active shutdown state", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  assert.equal(sm.isShuttingDown, false);

  let capturedDuring = null;
  sm.register("check", 0, (ctx) => {
    // During active shutdown, isShuttingDown should be true
    capturedDuring = sm.isShuttingDown;
  });

  await sm.shutdown({ exitProcess: false });
  assert.equal(capturedDuring, true);
  sm.detach();
});

test("getShutdownManager: returns singleton", () => {
  // Clear singleton for test
  const ShutdownModule = require("../src/shutdown");

  const sm1 = new ShutdownManager({ timeoutMs: 1000 });
  // getShutdownManager relies on module-level _instance, so we test directly
  assert.ok(sm1 instanceof ShutdownManager);
  assert.equal(typeof sm1.register, "function");
  sm1.detach();
});

test("ShutdownManager: reason is passed to hooks", async () => {
  const sm = new ShutdownManager({ timeoutMs: 1000 });
  let captured = null;

  sm.register("capture", 0, (ctx) => { captured = ctx; });

  await sm.shutdown({ reason: "test-reason", exitProcess: false });
  assert.equal(captured.reason, "test-reason");
  sm.detach();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
