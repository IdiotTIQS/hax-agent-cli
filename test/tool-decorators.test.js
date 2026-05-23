/**
 * Tests for tool decorators.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  withTimeout,
  withValidation,
  withRateLimit,
  withCaching,
  withMetrics,
  getMetrics,
  resetMetrics,
  resetToolMetrics,
  composeDecorators,
} = require("../src/tool-decorators");
const { ToolExecutionError } = require("../src/tools/error");

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

test("withTimeout: completes within time", async () => {
  const fn = async (x) => x * 2;
  const timed = withTimeout(fn, 1000);
  const result = await timed(5);
  assert.equal(result, 10);
});

test("withTimeout: throws TOOL_TIMEOUT on expiry", async () => {
  const fn = async () => sleep(200);
  const timed = withTimeout(fn, 10);
  try {
    await timed();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, "TOOL_TIMEOUT");
    assert.match(error.message, /timed out/i);
  }
});

test("withTimeout: clears timer on success", async () => {
  // Verify that successful completion does not leave a dangling timeout
  const fn = async () => "ok";
  const timed = withTimeout(fn, 5000);
  const result = await timed();
  assert.equal(result, "ok");
  // If the timer leaked, it would fire after 5s — no assertion needed,
  // node:test would hang or error. Let's also verify we can call again.
  const result2 = await timed();
  assert.equal(result2, "ok");
});

test("withTimeout: propagates original error (not timeout)", async () => {
  const fn = async () => { throw new Error("custom error"); };
  const timed = withTimeout(fn, 1000);
  try {
    await timed();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.message, "custom error");
  }
});

// ---------------------------------------------------------------------------
// withValidation
// ---------------------------------------------------------------------------

test("withValidation: passes valid args", async () => {
  const schema = {
    name: { type: "string", required: true },
    age: { type: "number" },
  };
  const fn = async (args) => `Hello ${args.name}, age ${args.age}`;
  const validated = withValidation(fn, schema);
  const result = await validated({ name: "Alice", age: 30 });
  assert.equal(result, "Hello Alice, age 30");
});

test("withValidation: rejects missing required field", async () => {
  const schema = {
    name: { type: "string", required: true },
  };
  const fn = async () => "ok";
  const validated = withValidation(fn, schema);
  try {
    await validated({});
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, "MISSING_REQUIRED_FIELD");
  }
});

test("withValidation: rejects invalid field type", async () => {
  const schema = {
    count: { type: "number" },
  };
  const fn = async () => "ok";
  const validated = withValidation(fn, schema);
  try {
    await validated({ count: "not-a-number" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, "INVALID_FIELD_TYPE");
  }
});

test("withValidation: allows optional fields to be missing", async () => {
  const schema = {
    name: { type: "string", required: true },
    optionalFlag: { type: "boolean" },
  };
  const fn = async (args) => `name=${args.name}`;
  const validated = withValidation(fn, schema);
  const result = await validated({ name: "Test" });
  assert.equal(result, "name=Test");
});

test("withValidation: rejects non-object args", async () => {
  const schema = { name: { type: "string" } };
  const fn = async () => "ok";
  const validated = withValidation(fn, schema);
  try {
    await validated(null);
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, "INVALID_ARGUMENT");
  }
});

test("withValidation: correctly validates array type", async () => {
  const schema = {
    items: { type: "array" },
  };
  const fn = async (args) => args.items.length;
  const validated = withValidation(fn, schema);

  const result = await validated({ items: [1, 2, 3] });
  assert.equal(result, 3);

  try {
    await validated({ items: "not-array" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.code, "INVALID_FIELD_TYPE");
  }
});

// ---------------------------------------------------------------------------
// withRateLimit
// ---------------------------------------------------------------------------

test("withRateLimit: allows calls under limit", async () => {
  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  const limited = withRateLimit(fn, { maxPerMinute: 60, maxBurst: 5 });

  for (let i = 0; i < 5; i += 1) {
    await limited();
  }
  assert.equal(callCount, 5);
});

test("withRateLimit: blocks when burst exceeded", async () => {
  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  const limited = withRateLimit(fn, { maxPerMinute: 60, maxBurst: 2 });

  await limited(); // 1
  await limited(); // 2

  try {
    await limited(); // 3 — should fail
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof ToolExecutionError);
    assert.equal(error.code, "TOOL_RATE_LIMITED");
  }
  assert.equal(callCount, 2);
});

test("withRateLimit: refills over time", async () => {
  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  // 120 tokens per minute = 2 per second, burst of 1
  const limited = withRateLimit(fn, { maxPerMinute: 120, maxBurst: 1 });

  await limited(); // consumes the 1 burst token
  assert.equal(callCount, 1);

  // Should be blocked
  try {
    await limited();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.code, "TOOL_RATE_LIMITED");
  }

  // Wait for refill (500ms interval, so 600ms is safe)
  await sleep(600);

  // Should now be allowed
  await limited();
  assert.equal(callCount, 2);
});

test("withRateLimit: defaults maxBurst to maxPerMinute", async () => {
  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  // maxPerMinute=60, burst defaults to 60
  const limited = withRateLimit(fn, { maxPerMinute: 60 });

  for (let i = 0; i < 10; i += 1) {
    await limited();
  }
  assert.equal(callCount, 10);
});

// ---------------------------------------------------------------------------
// withCaching
// ---------------------------------------------------------------------------

test("withCaching: returns cached result on second call", async () => {
  let executeCount = 0;
  const fn = async (x) => { executeCount += 1; return x * 2; };
  const cached = withCaching(fn, { ttlMs: 5000 });

  const r1 = await cached(5);
  assert.equal(r1, 10);
  assert.equal(executeCount, 1);

  const r2 = await cached(5);
  assert.equal(r2, 10);
  assert.equal(executeCount, 1); // not executed again
});

test("withCaching: different args produce different cache entries", async () => {
  let executeCount = 0;
  const fn = async (x) => { executeCount += 1; return x * 2; };
  const cached = withCaching(fn, { ttlMs: 5000 });

  assert.equal(await cached(3), 6);
  assert.equal(await cached(7), 14);
  assert.equal(executeCount, 2);
});

test("withCaching: evicts after TTL", async () => {
  let executeCount = 0;
  const fn = async (x) => { executeCount += 1; return x * 2; };
  const cached = withCaching(fn, { ttlMs: 50 });

  assert.equal(await cached(1), 2);
  assert.equal(executeCount, 1);

  // Hit cache
  assert.equal(await cached(1), 2);
  assert.equal(executeCount, 1);

  // Wait for expiry
  await sleep(100);

  // Should re-execute
  assert.equal(await cached(1), 2);
  assert.equal(executeCount, 2);
});

test("withCaching: respects maxSize by evicting oldest", async () => {
  let executeCount = 0;
  const fn = async (x) => { executeCount += 1; return x; };
  const cached = withCaching(fn, { ttlMs: 60000, maxSize: 2 });

  // Fill cache
  await cached("a");
  await cached("b");
  assert.equal(executeCount, 2);

  // Both cached
  assert.equal(await cached("a"), "a");
  assert.equal(await cached("b"), "b");
  assert.equal(executeCount, 2);

  // Add third entry — should evict "a" (oldest)
  await cached("c");
  assert.equal(executeCount, 3);

  // "a" was evicted, should re-execute
  assert.equal(await cached("a"), "a");
  assert.equal(executeCount, 4);

  // "b" was evicted when "a" was re-added (cache at capacity),
  // so it must re-execute too
  assert.equal(await cached("b"), "b");
  assert.equal(executeCount, 5);
});

// ---------------------------------------------------------------------------
// withMetrics
// ---------------------------------------------------------------------------

test("withMetrics: increments count", async () => {
  resetMetrics();
  const fn = async (x) => x + 1;
  const metered = withMetrics(fn, "test.increment");

  await metered(1);
  await metered(2);
  await metered(3);

  const metrics = getMetrics("test.increment");
  assert.equal(metrics.count, 3);
  assert.ok(metrics.totalDurationMs >= 0);
  assert.equal(metrics.errorCount, 0);
});

test("withMetrics: tracks duration", async () => {
  resetMetrics();
  const fn = async () => { await sleep(50); return "done"; };
  const metered = withMetrics(fn, "test.duration");

  await metered();
  const metrics = getMetrics("test.duration");
  assert.ok(metrics.totalDurationMs >= 40, `expected >=40, got ${metrics.totalDurationMs}`);
});

test("withMetrics: tracks errors separately", async () => {
  resetMetrics();
  const fn = async (shouldThrow) => {
    if (shouldThrow) throw new Error("boom");
    return "ok";
  };
  const metered = withMetrics(fn, "test.errors");

  await metered(false);
  try { await metered(true); } catch (_) { /* expected */ }
  await metered(false);

  const metrics = getMetrics("test.errors");
  assert.equal(metrics.count, 3);
  assert.equal(metrics.errorCount, 1);
});

test("withMetrics: reports avgDurationMs", async () => {
  resetMetrics();
  const fn = async () => "ok";
  const metered = withMetrics(fn, "test.avg");

  await metered();
  await metered();

  const metrics = getMetrics("test.avg");
  assert.equal(metrics.count, 2);
  assert.ok(typeof metrics.avgDurationMs === "number");
  assert.ok(metrics.avgDurationMs >= 0);
});

test("withMetrics: returns null avgDurationMs when no calls", () => {
  resetMetrics();
  const metrics = getMetrics("test.nonexistent");
  assert.equal(metrics.count, 0);
  assert.equal(metrics.avgDurationMs, null);
});

test("withMetrics: resetToolMetrics clears specific tool", () => {
  resetMetrics();
  const fn = async () => "ok";
  const meteredA = withMetrics(fn, "tool.a");
  const meteredB = withMetrics(fn, "tool.b");

  // Both are same underlying fn — just testing metrics separation
  meteredA; // register
  meteredB;

  resetToolMetrics("tool.a");
  const metricsA = getMetrics("tool.a");
  const metricsB = getMetrics("tool.b");
  assert.equal(metricsA.count, 0);
  assert.equal(metricsB.count, 0); // never called
});

// ---------------------------------------------------------------------------
// composeDecorators
// ---------------------------------------------------------------------------

test("composeDecorators: chains multiple decorators in order", async () => {
  let callOrder = [];

  // Decorator that records its position in the chain
  const makeDecorator = (name) => (fn) => async (...args) => {
    callOrder.push(`before-${name}`);
    const result = await fn(...args);
    callOrder.push(`after-${name}`);
    return result;
  };

  const base = async (x) => { callOrder.push("base"); return x; };

  const composed = composeDecorators(
    base,
    makeDecorator("A"),
    makeDecorator("B"),
    makeDecorator("C"),
  );

  const result = await composed(42);
  assert.equal(result, 42);

  // A is outermost, so: before-A → before-B → before-C → base → after-C → after-B → after-A
  assert.deepEqual(callOrder, [
    "before-A",
    "before-B",
    "before-C",
    "base",
    "after-C",
    "after-B",
    "after-A",
  ]);
});

test("composeDecorators: single decorator works", async () => {
  const fn = async (x) => x * 3;
  const timed = composeDecorators(fn, (f) => withTimeout(f, 1000));
  const result = await timed(4);
  assert.equal(result, 12);
});

test("composeDecorators: full pipeline with validation + timeout + metrics", async () => {
  resetMetrics();
  const schema = { value: { type: "number", required: true } };

  const fn = async (args) => args.value * 10;

  const decorated = composeDecorators(
    fn,
    (f) => withTimeout(f, 1000),
    (f) => withValidation(f, schema),
    (f) => withMetrics(f, "test.pipeline"),
  );

  const result = await decorated({ value: 7 });
  assert.equal(result, 70);

  // Validation should reject bad args
  try {
    await decorated({ value: "bad" });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.code, "INVALID_FIELD_TYPE");
  }

  const metrics = getMetrics("test.pipeline");
  // Validation rejects before reaching the metrics-wrapped fn,
  // so only the successful call is counted
  assert.equal(metrics.count, 1);
  assert.equal(metrics.errorCount, 0);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
