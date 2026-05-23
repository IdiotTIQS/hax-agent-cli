/**
 * Tests for RegressionDetector.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { RegressionDetector, SEVERITY, DEFAULT_METRICS } = require("../../src/regression/detector.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(name, overrides = {}) {
  return {
    name,
    min: overrides.min ?? 1.2,
    max: overrides.max ?? 8.5,
    avg: overrides.avg ?? 3.2,
    p50: overrides.p50 ?? 2.9,
    p95: overrides.p95 ?? 6.1,
    p99: overrides.p99 ?? 7.8,
    stddev: overrides.stddev ?? 1.1,
    totalTime: overrides.totalTime ?? 320,
    opsPerSec: overrides.opsPerSec ?? 312,
    samples: overrides.samples ?? 100,
    tokensTotal: overrides.tokensTotal ?? 5000,
    tokensInput: overrides.tokensInput ?? 3000,
    tokensOutput: overrides.tokensOutput ?? 2000,
    cost: overrides.cost ?? 0.05,
    errorRate: overrides.errorRate ?? 0.01,
    memoryPeak: overrides.memoryPeak ?? 128,
    memoryAvg: overrides.memoryAvg ?? 96,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegressionDetector", () => {
  let detector;

  beforeEach(() => {
    detector = new RegressionDetector();
  });

  afterEach(() => {
    detector.clearBaseline();
  });

  // Test 1: setBaseline / getBaseline / clearBaseline
  it("setBaseline stores a baseline and getBaseline retrieves it", () => {
    const baseline = makeResult("v1.0");
    detector.setBaseline(baseline);
    const stored = detector.getBaseline();
    assert.ok(stored);
    assert.strictEqual(stored.name, "v1.0");
    assert.strictEqual(stored.avg, 3.2);
  });

  it("clearBaseline removes the stored baseline", () => {
    detector.setBaseline(makeResult("v1.0"));
    assert.ok(detector.getBaseline());
    detector.clearBaseline();
    assert.strictEqual(detector.getBaseline(), null);
  });

  // Test 2: compare produces detailed per-metric comparison
  it("compare returns per-metric comparison for two result objects", () => {
    const baseline = makeResult("v1.0");
    const current = makeResult("v2.0", { avg: 4.0, p99: 10.0 });
    const comparisons = detector.compare(baseline, current);
    assert.ok(Array.isArray(comparisons));
    assert.strictEqual(comparisons.length, 1);
    assert.ok(comparisons[0].metrics.avg);
    assert.strictEqual(comparisons[0].metrics.avg.baseline, 3.2);
    assert.strictEqual(comparisons[0].metrics.avg.current, 4.0);
    // avg change: (4.0 - 3.2) / 3.2 * 100 = 25%
    assert.ok(comparisons[0].metrics.avg.changePct > 24);
  });

  // Test 3: detectRegression finds no regression when values are identical
  it("detectRegression reports no regression when results are identical", () => {
    const baseline = makeResult("v1.0");
    const current = makeResult("v1.0");
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, false);
    assert.strictEqual(report.regressions.length, 0);
    assert.strictEqual(report.summary, "No regressions detected.");
  });

  // Test 4: detectRegression finds latency regression in avg
  it("detectRegression detects avg latency regression above threshold", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 }); // +56.25%
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, true);

    const avgReg = report.regressions.find((r) => r.metric === "avg");
    assert.ok(avgReg, "avg regression should be detected");
    assert.ok(avgReg.changePct > 50, `avg change should be > 50%, got ${avgReg.changePct}`);
    assert.strictEqual(avgReg.direction, "up");
  });

  // Test 5: detectRegression detects p95 regression
  it("detectRegression detects p95 latency regression", () => {
    const baseline = makeResult("v1.0", { p95: 6.0 });
    const current = makeResult("v2.0", { p95: 9.0 }); // +50%, p95 threshold is 15
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, true);

    const p95Reg = report.regressions.find((r) => r.metric === "p95");
    assert.ok(p95Reg, "p95 regression should be detected");
    assert.ok(p95Reg.changePct > 40);
    // 50% change / 15% threshold = 3.33x => major (>3.0x)
    assert.strictEqual(p95Reg.severity, SEVERITY.MAJOR);
  });

  // Test 6: detectRegression finds throughput regression (opsPerSec drops)
  it("detectRegression detects throughput regression when opsPerSec drops", () => {
    const baseline = makeResult("v1.0", { opsPerSec: 500 });
    const current = makeResult("v2.0", { opsPerSec: 400 }); // -20% => +20% regression (direction: down)
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, true);

    const tpReg = report.regressions.find((r) => r.metric === "opsPerSec");
    assert.ok(tpReg, "throughput regression should be detected");
    assert.strictEqual(tpReg.direction, "down");
    assert.ok(tpReg.changePct > 10);
  });

  // Test 7: detectRegression handles empty baseline gracefully
  it("detectRegression returns clear message when baseline is not set", () => {
    const current = makeResult("v2.0");
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, false);
    assert.strictEqual(report.message, "No baseline set");
    assert.strictEqual(report.baseline, null);
  });

  // Test 8: detectRegression does not detect sub-threshold changes
  it("detectRegression does not flag changes below threshold", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 3.3 }); // ~3.1% increase
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, false);
  });

  // Test 9: categorize returns correct severity classification
  it("categorize classifies regression severity correctly", () => {
    const minor = { metric: "avg", changePct: 12, severity: SEVERITY.MINOR };
    const moderate = { metric: "cost", changePct: 25, severity: SEVERITY.MODERATE };
    const critical = { metric: "errorRate", changePct: 80, severity: SEVERITY.CRITICAL };

    const catMinor = detector.categorize(minor);
    assert.strictEqual(catMinor.severity, SEVERITY.MINOR);
    assert.strictEqual(catMinor.priority, 4);

    const catModerate = detector.categorize(moderate);
    assert.strictEqual(catModerate.category, "cost");
    assert.strictEqual(catModerate.severity, SEVERITY.MODERATE);

    const catCritical = detector.categorize(critical);
    assert.strictEqual(catCritical.category, "reliability");
    assert.strictEqual(catCritical.priority, 1);
  });

  // Test 10: getRegressions returns all detected regressions
  it("getRegressions returns all regressions from the latest detection", () => {
    const baseline = makeResult("v1.0");
    // Create a current result with multiple regressions
    const current = makeResult("v2.0", {
      avg: 5.0,     // +56.25% (above 10% threshold)
      p99: 15.0,    // ~+92% (above 20% threshold)
      cost: 0.12,   // +140% (above 10% threshold)
      errorRate: 0.05, // +400% (above 5% threshold)
    });
    detector.setBaseline(baseline);
    detector.detectRegression(null, current);

    const regs = detector.getRegressions();
    assert.ok(regs.length >= 2, `Expected at least 2 regressions, got ${regs.length}`);

    // Regressions should be sorted by severity (critical first)
    const errorReg = regs.find((r) => r.metric === "errorRate");
    if (errorReg) {
      assert.strictEqual(errorReg.severity, SEVERITY.CRITICAL);
    }
  });

  // Test 11: setThreshold overrides per-metric threshold
  it("setThreshold changes a single metric threshold", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 3.6 }); // +12.5%
    detector.setBaseline(baseline);

    // Default avg threshold is 10%, so 12.5% should trigger
    let report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, true);

    // Set avg threshold to 20%; 12.5% should no longer trigger
    detector.setThreshold("avg", 20);
    report = detector.detectRegression(null, current);
    const avgReg = report.regressions.find((r) => r.metric === "avg");
    assert.strictEqual(avgReg, undefined, "avg regression should not trigger at 20% threshold");
  });

  // Test 12: explicit threshold argument to detectRegression
  it("detectRegression accepts an explicit threshold argument", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 3.6 }); // +12.5%

    // Pass threshold=20 via argument — should not trigger
    const report = detector.detectRegression(baseline, current, 20);
    assert.strictEqual(report.hasRegression, false);

    // Pass threshold=5 via argument — should trigger
    const report2 = detector.detectRegression(baseline, current, 5);
    assert.strictEqual(report2.hasRegression, true);
  });

  // Test 13: auto-adjustment of thresholds
  it("autoAdjust gradually increases thresholds on repeated detections", () => {
    const detector2 = new RegressionDetector({ autoAdjust: true, autoAdjustFactor: 0.5 });
    const baseline = makeResult("v1.0", { avg: 1.0 });
    const current = makeResult("v2.0", { avg: 2.0 }); // +100%

    detector2.setBaseline(baseline);

    // Initial threshold (default for avg is 10)
    const initialThreshold = detector2.getThreshold("avg");
    assert.ok(initialThreshold >= 10, `Expected threshold >= 10, got ${initialThreshold}`);

    // First detection
    detector2.detectRegression(null, current);
    const after1 = detector2.getThreshold("avg");
    assert.ok(after1 > initialThreshold, `Threshold should increase after first detection: ${after1} > ${initialThreshold}`);

    // Second detection
    detector2.detectRegression(null, current);
    const after2 = detector2.getThreshold("avg");
    assert.ok(after2 > after1, `Threshold should increase after second detection: ${after2} > ${after1}`);
  });

  // Test 14: suite results are compared correctly
  it("compare handles suite-style results with multiple benchmarks", () => {
    const suiteBase = {
      name: "base-suite",
      results: [
        makeResult("tool-call", { avg: 1.5 }),
        makeResult("agent-loop", { avg: 3.0 }),
      ],
    };
    const suiteCurr = {
      name: "curr-suite",
      results: [
        makeResult("tool-call", { avg: 1.8 }),
        makeResult("agent-loop", { avg: 4.5 }),
      ],
    };

    const comparisons = detector.compare(suiteBase, suiteCurr);
    assert.strictEqual(comparisons.length, 2);
    assert.strictEqual(comparisons[0].name, "tool-call");
    assert.strictEqual(comparisons[1].name, "agent-loop");
  });

  // Test 15: getRegressionsBySeverity filters correctly
  it("getRegressionsBySeverity filters by severity level", () => {
    const baseline = makeResult("v1.0");
    const current = makeResult("v2.0", {
      avg: 3.55,         // ~10.9% change / 10% thresh = 1.09x => minor
      errorRate: 0.08,   // critical
    });
    detector.setBaseline(baseline);
    detector.detectRegression(null, current);

    const criticals = detector.getRegressionsBySeverity("critical");
    const minors = detector.getRegressionsBySeverity("minor");
    assert.ok(criticals.length >= 1);
    assert.ok(minors.length >= 1);
    assert.ok(criticals.every((r) => r.severity === "critical"));
    assert.ok(minors.every((r) => r.severity === "minor"));
  });

  // Test 16: token usage regressions are detected
  it("detectRegression detects token usage regressions", () => {
    const baseline = makeResult("v1.0", { tokensTotal: 1000, tokensInput: 600, tokensOutput: 400 });
    const current = makeResult("v2.0", { tokensTotal: 1300, tokensInput: 800, tokensOutput: 500 }); // +30%, +33%, +25%
    detector.setBaseline(baseline);
    const report = detector.detectRegression(null, current);
    assert.strictEqual(report.hasRegression, true);

    const tokenRegs = report.regressions.filter((r) => r.metric.startsWith("token"));
    assert.ok(tokenRegs.length >= 1, `Expected token regressions, got ${tokenRegs.length}`);
  });
});
