/**
 * Tests for the Benchmark runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Benchmark, computeStats, percentile } = require("../../src/benchmark/runner");

// ---------------------------------------------------------------------------
// computeStats / percentile
// ---------------------------------------------------------------------------

test("percentile: computes exact value for integer index", () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(percentile(sorted, 50), 3); // index 2 → sorted[2]
});

test("percentile: interpolates between adjacent values", () => {
  const sorted = [1, 2, 3, 4];
  // index for p50 = (50/100) * 3 = 1.5 → between sorted[1]=2 and sorted[2]=3
  const p50 = percentile(sorted, 50);
  assert.ok(p50 > 2 && p50 < 3);
  assert.equal(p50, 2.5);
});

test("percentile: handles p0 and p100", () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(percentile(sorted, 0), 10);
  assert.equal(percentile(sorted, 100), 50);
});

test("computeStats: returns zeros for empty samples", () => {
  const stats = computeStats([]);
  assert.equal(stats.samples, 0);
  assert.equal(stats.avg, 0);
  assert.equal(stats.min, 0);
  assert.equal(stats.max, 0);
  assert.equal(stats.stddev, 0);
});

test("computeStats: computes correct statistics for known samples", () => {
  const samples = [2, 4, 4, 4, 5, 5, 7, 9];
  const stats = computeStats(samples);
  assert.equal(stats.samples, 8);
  assert.equal(stats.min, 2);
  assert.equal(stats.max, 9);
  assert.equal(stats.avg, 5);
  assert.equal(stats.p50, 4.5); // between sorted[3]=4 and sorted[4]=5
  // p95: index = 0.95 * 7 = 6.65, lower=6, upper=7
  // sorted[6]=7, sorted[7]=9 → 7 + (9-7)*0.65 = 7 + 1.3 = 8.3
  assert.ok(Math.abs(stats.p95 - 8.3) < 0.01);
  // variance (sample): sum((x-5)^2)/(n-1) = (9+1+1+1+0+0+4+16)/7 = 32/7 ≈ 4.571
  assert.ok(Math.abs(stats.stddev - Math.sqrt(32 / 7)) < 0.01);
});

test("computeStats: opsPerSec is Infinity when totalTime is zero", () => {
  const stats = computeStats([0, 0, 0]);
  assert.equal(stats.opsPerSec, Infinity);
});

// ---------------------------------------------------------------------------
// Benchmark constructor
// ---------------------------------------------------------------------------

test("Benchmark: constructor requires a non-empty name", () => {
  assert.throws(() => new Benchmark("", () => {}), TypeError);
  assert.throws(() => new Benchmark(123, () => {}), TypeError);
});

test("Benchmark: constructor requires a function", () => {
  assert.throws(() => new Benchmark("test", null), TypeError);
  assert.throws(() => new Benchmark("test", "not a fn"), TypeError);
});

test("Benchmark: constructor stores name, fn, and options", () => {
  const fn = () => 42;
  const b = new Benchmark("my-bench", fn, { iterations: 50 });
  assert.equal(b.name, "my-bench");
  assert.equal(b.fn, fn);
  assert.deepEqual(b.options, { iterations: 50 });
});

// ---------------------------------------------------------------------------
// Benchmark.run
// ---------------------------------------------------------------------------

test("Benchmark.run: executes measured iterations and returns stats", async () => {
  let callCount = 0;
  const b = new Benchmark("sync-test", () => { callCount += 1; });
  const result = await b.run({ iterations: 10, warmup: 2 });

  assert.equal(callCount, 12); // 2 warmup + 10 measured
  assert.equal(result.name, "sync-test");
  assert.equal(result.iterations, 10);
  assert.equal(result.warmup, 2);
  assert.equal(result.samples, 10);
  assert.ok(Number.isFinite(result.avg));
  assert.ok(Number.isFinite(result.p50));
  assert.ok(Number.isFinite(result.p95));
  assert.ok(Number.isFinite(result.p99));
  assert.ok(Number.isFinite(result.stddev));
  assert.ok(result.min >= 0);
});

test("Benchmark.run: handles async functions", async () => {
  const b = new Benchmark("async-test", async (ctx) => {
    await new Promise((resolve) => setImmediate(resolve));
    ctx.touched = true;
  });
  const result = await b.run({ iterations: 5, warmup: 1 });
  assert.equal(result.iterations, 5);
  assert.equal(result.samples, 5);
  assert.ok(result.avg > 0);
});

test("Benchmark.run: supports setup and teardown hooks", async () => {
  const seen = [];
  const b = new Benchmark("hook-test", async (ctx) => {
    seen.push(ctx.id);
  }, {
    setup: async () => ({ id: Math.random() }),
    teardown: async (ctx) => { seen.push(`teardown-${ctx.id}`); },
  });
  const result = await b.run({ iterations: 4, warmup: 0 });
  assert.equal(result.samples, 4);
  // Each iteration creates: setup → fn → teardown
  assert.equal(seen.length, 8); // 4 ids + 4 teardowns
});

test("Benchmark.run: handles zero iterations gracefully", async () => {
  const b = new Benchmark("zero-iter", () => { throw new Error("should not run"); });
  const result = await b.run({ iterations: 0, warmup: 0 });
  assert.equal(result.iterations, 0);
  assert.equal(result.samples, 0);
  assert.equal(result.avg, 0);
});

test("Benchmark.run: negative iterations are floored to zero", async () => {
  const b = new Benchmark("neg-iter", () => 1);
  const result = await b.run({ iterations: -5, warmup: -2 });
  assert.equal(result.iterations, 0);
  assert.equal(result.warmup, 0);
});

test("Benchmark.run: surfaces errors from the benchmark function", async () => {
  const b = new Benchmark("failing", () => { throw new Error("Boom!"); });
  await assert.rejects(
    () => b.run({ iterations: 3, warmup: 0 }),
    /Benchmark "failing" threw on iteration 1: Boom!/,
  );
});

test("Benchmark.run: surfaces errors from setup", async () => {
  const b = new Benchmark("bad-setup", () => {}, {
    setup: async () => { throw new Error("Setup failed"); },
  });
  await assert.rejects(
    () => b.run({ iterations: 3, warmup: 0 }),
    /Benchmark "bad-setup" setup failed on iteration 1: Setup failed/,
  );
});

// ---------------------------------------------------------------------------
// Benchmark.compare
// ---------------------------------------------------------------------------

test("Benchmark.compare: runs two benchmarks and returns comparison", async () => {
  // Use an async delay so the "slow" function is measurably slower.
  const slow = async () => { await new Promise((r) => setTimeout(r, 10)); };
  const fast = () => 42;

  const comp = await Benchmark.compare("slow-fn", slow, "fast-fn", fast, {
    iterations: 10,
    warmup: 1,
  });

  assert.equal(comp.a.name, "slow-fn");
  assert.equal(comp.b.name, "fast-fn");
  assert.equal(comp.faster, "fast-fn");
  assert.ok(comp.speedup >= 1);
  assert.equal(comp.a.samples, 10);
  assert.equal(comp.b.samples, 10);
  assert.ok(comp.a.avg > comp.b.avg);
});

// ---------------------------------------------------------------------------
// Benchmark.suite
// ---------------------------------------------------------------------------

test("Benchmark.suite: runs multiple benchmarks in order", async () => {
  const order = [];
  const benchmarks = [
    { name: "first", fn: () => { order.push(1); } },
    { name: "second", fn: async () => { order.push(2); } },
    { name: "third", fn: () => { order.push(3); } },
  ];

  const suiteResult = await Benchmark.suite("my-suite", benchmarks, {
    iterations: 5,
    warmup: 1,
  });

  assert.equal(suiteResult.name, "my-suite");
  assert.equal(suiteResult.results.length, 3);
  assert.deepEqual(order, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
  assert.equal(suiteResult.results[0].name, "first");
  assert.equal(suiteResult.results[1].name, "second");
  assert.equal(suiteResult.results[2].name, "third");
});

test("Benchmark.suite: passes per-benchmark setup/teardown", async () => {
  const ctxLog = [];
  const benchmarks = [
    {
      name: "with-setup",
      fn: (ctx) => { ctxLog.push(`fn-${ctx.label}`); },
      setup: async () => ({ label: "A" }),
      teardown: (ctx) => { ctxLog.push(`td-${ctx.label}`); },
    },
  ];

  await Benchmark.suite("setup-suite", benchmarks, { iterations: 2, warmup: 0 });
  assert.deepEqual(ctxLog, ["fn-A", "td-A", "fn-A", "td-A"]);
});

test("Benchmark.suite: throws for non-array input", async () => {
  await assert.rejects(() => Benchmark.suite("bad", null), TypeError);
  await assert.rejects(() => Benchmark.suite("bad", "not-array"), TypeError);
});

// ---------------------------------------------------------------------------
// Benchmark.formatResults
// ---------------------------------------------------------------------------

test("Benchmark.formatResults: produces text output for a single result", () => {
  const fake = {
    name: "test",
    avg: 1.234,
    p50: 1.1,
    p95: 2.2,
    p99: 3.3,
    min: 0.5,
    max: 4.0,
    stddev: 0.567,
    opsPerSec: 810.3,
  };
  const out = Benchmark.formatResults(fake);
  assert.ok(out.includes("test"));
  assert.ok(out.includes("1.234"));
  assert.ok(out.includes("810.3"));
});

test("Benchmark.formatResults: produces text output for multiple results", () => {
  const results = [
    { name: "A", avg: 1, p50: 1, p95: 1, p99: 1, min: 1, max: 1, stddev: 0, opsPerSec: 1000 },
    { name: "B", avg: 2, p50: 2, p95: 2, p99: 2, min: 2, max: 2, stddev: 0, opsPerSec: 500 },
  ];
  const out = Benchmark.formatResults(results);
  assert.ok(out.includes("A"));
  assert.ok(out.includes("B"));
  assert.ok(out.includes("1000"));
  assert.ok(out.includes("500"));
});

test("Benchmark.formatResults: handles empty array", () => {
  const out = Benchmark.formatResults([]);
  assert.equal(out, "(no results)");
});

test("Benchmark.formatResults: handles Infinity opsPerSec", () => {
  const fake = {
    name: "instant",
    avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stddev: 0, opsPerSec: Infinity,
  };
  const out = Benchmark.formatResults(fake);
  assert.ok(out.includes("n/a"));
});
