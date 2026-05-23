/**
 * Lightweight benchmarking harness for measuring tool, provider, and agent
 * engine performance. Collects high-resolution timing samples and computes
 * statistical summaries including percentiles and standard deviation.
 */
"use strict";

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

/**
 * @param {number[]} sorted - samples sorted ascending
 * @param {number} p - percentile (0–100)
 * @returns {number} interpolated percentile value
 */
function percentile(sorted, p) {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Compute full statistical summary from raw timing samples (milliseconds).
 * @param {number[]} samples - individual run durations in ms
 * @returns {object} stats bag
 */
function computeStats(samples) {
  if (samples.length === 0) {
    return {
      min: 0, max: 0, avg: 0,
      p50: 0, p95: 0, p99: 0,
      stddev: 0, totalTime: 0, opsPerSec: 0,
      samples: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const variance = n > 1
    ? sorted.reduce((acc, val) => acc + (val - avg) ** 2, 0) / (n - 1)
    : 0;
  const stddev = Math.sqrt(variance);
  const totalTime = sum;
  const opsPerSec = totalTime > 0 ? (n / totalTime) * 1000 : Infinity;

  return { min, max, avg, p50, p95, p99, stddev, totalTime, opsPerSec, samples: n };
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

class Benchmark {
  /**
   * @param {string} name - label for this benchmark
   * @param {function} fn - function to benchmark; receives context object
   * @param {object} [options] - default run options
   * @param {number} [options.iterations] - measured iterations (default 100)
   * @param {number} [options.warmup] - warmup iterations (default 5)
   * @param {function} [options.setup] - called before each iteration, returns context
   * @param {function} [options.teardown] - called after each iteration with context
   */
  constructor(name, fn, options = {}) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Benchmark name must be a non-empty string.");
    }
    if (typeof fn !== "function") {
      throw new TypeError("Benchmark fn must be a function.");
    }

    this.name = name;
    this.fn = fn;
    this.options = options;
  }

  /**
   * Execute the benchmark: warmup first, then collect timing samples.
   * @param {object} [options] - overrides for constructor options
   * @returns {Promise<object>} result object with stats
   */
  async run(options = {}) {
    const opts = { ...this.options, ...options };
    const {
      iterations = 100,
      warmup = 5,
      setup = null,
      teardown = null,
    } = opts;

    const resolvedIterations = Math.max(0, Math.floor(Number(iterations)));
    const resolvedWarmup = Math.max(0, Math.floor(Number(warmup)));

    // ---- warmup phase ----
    for (let i = 0; i < resolvedWarmup; i++) {
      let ctx;
      try {
        ctx = typeof setup === "function" ? await setup() : {};
      } catch (err) {
        throw new Error(`Benchmark "${this.name}" setup failed on warmup iteration ${i + 1}: ${err.message}`);
      }
      try {
        await this.fn(ctx);
      } catch (err) {
        throw new Error(`Benchmark "${this.name}" threw on warmup iteration ${i + 1}: ${err.message}`);
      }
      try {
        if (typeof teardown === "function") await teardown(ctx);
      } catch (_) {
        // teardown errors during warmup are non-fatal
      }
    }

    // ---- measured phase ----
    const samples = [];
    for (let i = 0; i < resolvedIterations; i++) {
      let ctx;
      try {
        ctx = typeof setup === "function" ? await setup() : {};
      } catch (err) {
        throw new Error(`Benchmark "${this.name}" setup failed on iteration ${i + 1}: ${err.message}`);
      }

      const start = process.hrtime.bigint();
      try {
        await this.fn(ctx);
      } catch (err) {
        throw new Error(`Benchmark "${this.name}" threw on iteration ${i + 1}: ${err.message}`);
      }
      const end = process.hrtime.bigint();

      samples.push(Number(end - start) / 1e6); // nanoseconds → milliseconds

      try {
        if (typeof teardown === "function") await teardown(ctx);
      } catch (_) {
        // teardown errors during measurement are non-fatal
      }
    }

    const stats = computeStats(samples);

    return {
      name: this.name,
      iterations: resolvedIterations,
      warmup: resolvedWarmup,
      ...stats,
    };
  }

  /**
   * Run two benchmarks side-by-side and produce a comparison report.
   * @param {string} nameA
   * @param {function} fnA
   * @param {string} nameB
   * @param {function} fnB
   * @param {object} [options] - run options shared by both benchmarks
   * @returns {Promise<object>} { a, b, faster, speedup }
   */
  static async compare(nameA, fnA, nameB, fnB, options = {}) {
    const benchA = new Benchmark(nameA, fnA);
    const benchB = new Benchmark(nameB, fnB);
    const [resultA, resultB] = await Promise.all([
      benchA.run(options),
      benchB.run(options),
    ]);

    const faster = resultA.avg < resultB.avg ? nameA : nameB;
    const slowerAvg = Math.max(resultA.avg, resultB.avg);
    const fasterAvg = Math.min(resultA.avg, resultB.avg);
    const speedup = fasterAvg > 0 ? slowerAvg / fasterAvg : 1;

    return {
      a: resultA,
      b: resultB,
      faster,
      speedup,
    };
  }

  /**
   * Run a named suite of benchmarks sequentially.
   * @param {string} name - suite label
   * @param {Array<{name: string, fn: function, setup?: function, teardown?: function}>} benchmarks
   * @param {object} [options] - default run options for every benchmark
   * @returns {Promise<object>} { name, results: [...] }
   */
  static async suite(name, benchmarks, options = {}) {
    if (!Array.isArray(benchmarks)) {
      throw new TypeError("suite expects an array of benchmark descriptors.");
    }

    const results = [];
    for (const desc of benchmarks) {
      const b = new Benchmark(desc.name, desc.fn);
      const runOpts = { ...options };
      if (typeof desc.setup === "function") runOpts.setup = desc.setup;
      if (typeof desc.teardown === "function") runOpts.teardown = desc.teardown;
      const result = await b.run(runOpts);
      results.push(result);
    }

    return { name, results };
  }

  /**
   * Produce a human-readable plain-text table for one or more results.
   * @param {object|object[]} results - single result object or array of results
   * @returns {string}
   */
  static formatResults(results) {
    const list = Array.isArray(results) ? results : [results];
    if (list.length === 0) return "(no results)";

    const header = [
      "name".padEnd(24),
      "avg (ms)".padStart(10),
      "p50 (ms)".padStart(10),
      "p95 (ms)".padStart(10),
      "p99 (ms)".padStart(10),
      "min (ms)".padStart(10),
      "max (ms)".padStart(10),
      "stddev".padStart(10),
      "ops/s".padStart(12),
    ];

    const lines = [header.join("")];

    for (const r of list) {
      const ops = Number.isFinite(r.opsPerSec)
        ? (r.opsPerSec >= 1000 ? r.opsPerSec.toFixed(0) : r.opsPerSec.toFixed(1))
        : "n/a";

      const row = [
        r.name.slice(0, 23).padEnd(24),
        r.avg.toFixed(3).padStart(10),
        r.p50.toFixed(3).padStart(10),
        r.p95.toFixed(3).padStart(10),
        r.p99.toFixed(3).padStart(10),
        r.min.toFixed(3).padStart(10),
        r.max.toFixed(3).padStart(10),
        r.stddev.toFixed(3).padStart(10),
        ops.padStart(12),
      ];
      lines.push(row.join(""));
    }

    return lines.join("\n");
  }
}

module.exports = { Benchmark, computeStats, percentile };
