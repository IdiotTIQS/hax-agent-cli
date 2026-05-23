/**
 * Tests for the Benchmark reporter.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
  formatComparison,
  detectRegression,
} = require("../../src/benchmark/reporter");

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function sampleResult(overrides = {}) {
  return {
    name: "sample-bench",
    iterations: 100,
    warmup: 5,
    min: 0.512,
    max: 4.231,
    avg: 1.234,
    p50: 1.100,
    p95: 2.850,
    p99: 3.900,
    stddev: 0.567,
    totalTime: 123.4,
    opsPerSec: 810.3,
    samples: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatAsText
// ---------------------------------------------------------------------------

test("formatAsText: produces aligned table for a single result", () => {
  const out = formatAsText(sampleResult());
  assert.ok(typeof out === "string");
  assert.ok(out.includes("sample-bench"));
  assert.ok(out.includes("avg (ms)"));
  assert.ok(out.includes("1.234"));
  assert.ok(out.includes("810.3"));
  // Should have a header row + one data row
  const lines = out.split("\n");
  assert.ok(lines.length >= 2);
});

test("formatAsText: produces aligned table for multiple results", () => {
  const results = [
    sampleResult({ name: "first" }),
    sampleResult({ name: "second", avg: 2.5 }),
  ];
  const out = formatAsText(results);
  assert.ok(out.includes("first"));
  assert.ok(out.includes("second"));
  assert.ok(out.includes("2.500"));
  const lines = out.split("\n");
  assert.equal(lines.length, 3); // header + 2 data rows
});

test("formatAsText: handles empty array", () => {
  assert.equal(formatAsText([]), "(no results)");
});

test("formatAsText: handles missing numeric fields gracefully", () => {
  const out = formatAsText({
    name: "partial",
    avg: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    min: 0,
    max: 0,
    stddev: 0,
    opsPerSec: 0,
  });
  assert.ok(out.includes("partial"));
  assert.ok(out.includes("n/a")); // opsPerSec of 0 → n/a
});

// ---------------------------------------------------------------------------
// formatAsMarkdown
// ---------------------------------------------------------------------------

test("formatAsMarkdown: produces GFM table for a single result", () => {
  const out = formatAsMarkdown(sampleResult());
  assert.ok(out.includes("| name"));
  assert.ok(out.includes("| :-"));
  assert.ok(out.includes("sample-bench"));
  assert.ok(out.includes("1.234"));
});

test("formatAsMarkdown: produces GFM table for multiple results", () => {
  const results = [
    sampleResult({ name: "A" }),
    sampleResult({ name: "B" }),
  ];
  const out = formatAsMarkdown(results);
  assert.ok(out.includes("| A |"));
  assert.ok(out.includes("| B |"));
  // Header, separator, 2 data rows = 4 lines
  assert.equal(out.split("\n").length, 4);
});

test("formatAsMarkdown: handles empty array", () => {
  assert.equal(formatAsMarkdown([]), "_No results._");
});

// ---------------------------------------------------------------------------
// formatAsJson
// ---------------------------------------------------------------------------

test("formatAsJson: produces valid indented JSON", () => {
  const r = sampleResult();
  const out = formatAsJson(r);
  const parsed = JSON.parse(out);
  assert.equal(parsed.name, "sample-bench");
  assert.equal(parsed.avg, 1.234);
  assert.equal(parsed.opsPerSec, 810.3);
  // Verify indentation
  assert.ok(out.includes("  "));
});

test("formatAsJson: handles array input", () => {
  const results = [sampleResult({ name: "one" }), sampleResult({ name: "two" })];
  const out = formatAsJson(results);
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "one");
  assert.equal(parsed[1].name, "two");
});

test("formatAsJson: handles empty array", () => {
  const out = formatAsJson([]);
  assert.equal(out, "[]");
});

// ---------------------------------------------------------------------------
// formatComparison
// ---------------------------------------------------------------------------

test("formatComparison: produces side-by-side output", () => {
  const a = sampleResult({ name: "baseline", avg: 1.0 });
  const b = sampleResult({ name: "current", avg: 1.5 });
  const out = formatComparison(a, b);
  assert.ok(out.includes("baseline"));
  assert.ok(out.includes("1.000"));
  assert.ok(out.includes("1.500"));
  assert.ok(out.includes("Delta"));
  assert.ok(out.includes("+50.0%")); // (1.5 - 1.0) / 1.0 = 50%
});

test("formatComparison: handles missing counterpart", () => {
  const a = sampleResult({ name: "only-a", avg: 1.0 });
  const out = formatComparison(a, null);
  assert.ok(out.includes("only-a"));
  assert.ok(out.includes("no counterpart"));
});

test("formatComparison: handles array inputs", () => {
  const listA = [sampleResult({ name: "X", avg: 2.0 })];
  const listB = [sampleResult({ name: "X", avg: 2.2 })];
  const out = formatComparison(listA, listB);
  assert.ok(out.includes("+10.0%"));
});

// ---------------------------------------------------------------------------
// detectRegression
// ---------------------------------------------------------------------------

test("detectRegression: detects regression above threshold", () => {
  const baseline = sampleResult({ avg: 1.0, p50: 1.0, p95: 1.0, p99: 1.0, min: 0.5, max: 1.5, stddev: 0.1 });
  const current = sampleResult({ avg: 1.2, p50: 1.1, p95: 1.3, p99: 1.4, min: 0.6, max: 1.8, stddev: 0.15 });
  // avg: +20%, p50: +10%, p95: +30%, p99: +40%, min: +20%, max: +20%, stddev: +50%
  const report = detectRegression(current, baseline, 5);
  assert.ok(report !== null);
  assert.equal(report.name, "sample-bench");
  assert.equal(report.threshold, 5);
  assert.ok(report.regressions.length >= 5); // avg, p50, p95, p99, min, max, stddev all above 5%
});

test("detectRegression: returns null when all metrics are within threshold", () => {
  const baseline = sampleResult({ avg: 1.0, p50: 1.0, p95: 1.0, p99: 1.0, min: 0.5, max: 1.5, stddev: 0.1 });
  const current = sampleResult({ avg: 1.02, p50: 1.01, p95: 1.01, p99: 1.02, min: 0.51, max: 1.52, stddev: 0.101 });
  const report = detectRegression(current, baseline, 5);
  assert.equal(report, null);
});

test("detectRegression: handles improvement without flagging", () => {
  const baseline = sampleResult({ avg: 2.0, p50: 2.0, p95: 3.0, p99: 4.0, min: 1.0, max: 5.0, stddev: 0.5 });
  const current = sampleResult({ avg: 1.0, p50: 1.0, p95: 1.5, p99: 2.0, min: 0.5, max: 2.5, stddev: 0.3 });
  // All metrics decreased (improvement) → no regression
  const report = detectRegression(current, baseline, 5);
  assert.equal(report, null);
});

test("detectRegression: handles null / missing inputs", () => {
  assert.equal(detectRegression(null, sampleResult()), null);
  assert.equal(detectRegression(sampleResult(), null), null);
  assert.equal(detectRegression(null, null), null);
});

test("detectRegression: respects custom threshold", () => {
  const baseline = sampleResult({ avg: 1.0, p50: 1.0, p95: 1.0, p99: 1.0, min: 0.5, max: 1.5, stddev: 0.1 });
  const current = sampleResult({ avg: 1.08, p50: 1.05, p95: 1.02, p99: 1.01, min: 0.5, max: 1.5, stddev: 0.1 });
  // avg is +8% — flagged at threshold 5, but not at threshold 10
  const reportStrict = detectRegression(current, baseline, 5);
  assert.ok(reportStrict !== null);
  assert.ok(reportStrict.regressions.some((r) => r.metric === "avg"));

  const reportLoose = detectRegression(current, baseline, 10);
  // p50 is +5% — still not above 10, avg is +8% still under 10
  assert.equal(reportLoose, null);
});

test("detectRegression: includes change percentage in each regression entry", () => {
  const baseline = sampleResult({ avg: 2.0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stddev: 0 });
  const current = sampleResult({ avg: 2.5, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stddev: 0 });
  const report = detectRegression(current, baseline, 5);
  assert.ok(report !== null);
  const avgReg = report.regressions.find((r) => r.metric === "avg");
  assert.ok(avgReg);
  assert.equal(avgReg.current, 2.5);
  assert.equal(avgReg.baseline, 2.0);
  assert.ok(Math.abs(avgReg.changePct - 25) < 0.01);
});
