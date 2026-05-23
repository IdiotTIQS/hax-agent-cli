/**
 * Tests for RootCauseAnalyzer.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  RootCauseAnalyzer,
  STRATEGIES,
  CONFIDENCE_LEVELS,
  bisectTests,
  computeRelevance,
} = require("../../src/regression/root-cause.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegression(overrides = {}) {
  return {
    metric: overrides.metric || "avg",
    label: overrides.label || "Avg Latency",
    changePct: overrides.changePct ?? 35,
    severity: overrides.severity || "major",
    baseline: overrides.baseline ?? 3.2,
    current: overrides.current ?? 4.32,
    direction: overrides.direction || "up",
    threshold: overrides.threshold ?? 10,
    detectedAt: overrides.detectedAt || new Date().toISOString(),
  };
}

function makeChanges(count = 3) {
  return [
    {
      file: "src/agent/loop.js",
      lines: 42,
      type: "refactor",
      description: "Refactored agent loop to use async generator pattern",
      timestamp: new Date().toISOString(),
      author: "dev1",
      commit: "abc123",
    },
    {
      file: "src/llm/provider.js",
      lines: 15,
      type: "dependency-upgrade",
      description: "Upgraded anthropic SDK from 0.21 to 0.30",
      timestamp: new Date().toISOString(),
      author: "dev2",
      commit: "def456",
    },
    {
      file: "src/cache/prompt-cache.js",
      lines: 120,
      type: "new-feature",
      description: "Added prompt caching layer with TTL eviction",
      timestamp: new Date().toISOString(),
      author: "dev3",
      commit: "ghi789",
    },
    {
      file: "src/benchmark/runner.js",
      lines: 8,
      type: "optimization",
      description: "Optimized percentile calculation with pre-sorted arrays",
      timestamp: new Date().toISOString(),
      author: "dev1",
      commit: "jkl012",
    },
  ].slice(0, count);
}

function makeTests(count = 5) {
  return [
    { name: "test-basic-agent", regressionSignal: 0.45 },
    { name: "test-tool-execution", regressionSignal: 0.08 },
    { name: "test-streaming-response", regressionSignal: 0.62 },
    { name: "test-error-recovery", regressionSignal: 0.01 },
    { name: "test-large-context", regressionSignal: 0.34 },
  ].slice(0, count);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RootCauseAnalyzer", () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new RootCauseAnalyzer();
  });

  // Test 1: analyze identifies likely causes from context
  it("analyze produces hypotheses when given full context", () => {
    const regression = makeRegression({ metric: "avg", changePct: 35 });
    const context = {
      baseline: { avg: 3.2, p95: 6.1, opsPerSec: 312, cost: 0.05 },
      current: { avg: 4.32, p95: 9.5, opsPerSec: 280, cost: 0.05 },
      changes: makeChanges(3),
      tests: makeTests(5),
    };

    const result = analyzer.analyze(regression, context);

    assert.ok(result.regression, "result should contain regression data");
    assert.ok(result.hypotheses.length > 0, `Expected some hypotheses, got ${result.hypotheses.length}`);
    assert.ok(result.strategies.length > 0, `Expected some strategies, got ${result.strategies.length}`);
    assert.ok(result.summary.length > 0, "result should have a summary");
    assert.ok(result.analyzedAt, "result should have analyzedAt timestamp");
  });

  // Test 2: analyze handles missing context gracefully
  it("analyze produces results with minimal context", () => {
    const regression = makeRegression({ metric: "cost" });
    const result = analyzer.analyze(regression, {});

    assert.ok(result.regression);
    assert.ok(result.strategies.length > 0, "Should apply expert rules at minimum");
    assert.ok(result.summary.length > 0);
  });

  // Test 3: correlateChanges finds matching code changes
  it("correlateChanges finds code changes correlated with the regression", () => {
    const regression = makeRegression({ metric: "memoryPeak", changePct: 45 });
    const changes = makeChanges(4);

    const result = analyzer.correlateChanges(regression, changes);

    assert.ok(result.correlations.length > 0, `Expected some correlations, got ${result.correlations.length}`);
    assert.ok(result.hypotheses.length > 0, `Expected some hypotheses, got ${result.hypotheses.length}`);

    // Cache-related file should have high relevance for memoryPeak
    const cacheCor = result.correlations.find((c) => c.change.file.includes("cache"));
    if (cacheCor) {
      assert.ok(cacheCor.relevance > 0.3,
        `Cache file should have high relevance for memory: ${cacheCor.relevance}`);
    }
  });

  // Test 4: correlateChanges returns empty for empty changes array
  it("correlateChanges returns empty results when given no changes", () => {
    const regression = makeRegression({ metric: "avg" });
    const result = analyzer.correlateChanges(regression, []);
    assert.strictEqual(result.correlations.length, 0);
    assert.strictEqual(result.hypotheses.length, 0);
  });

  // Test 5: narrowDown isolates regression to a specific test
  it("narrowDown identifies the test with strongest regression signal", () => {
    const regression = makeRegression({ metric: "avg" });
    const tests = makeTests(5);

    const result = analyzer.narrowDown(regression, tests);

    assert.ok(result.result, "should have a result");
    assert.ok(result.result.culprit, "should identify a culprit test");
    assert.strictEqual(result.result.culprit, "test-streaming-response"); // highest signal 0.62
    assert.ok(result.hypotheses.length >= 1);
  });

  // Test 6: narrowDown returns empty when no test exceeds threshold
  it("narrowDown returns no culprit when all signals are below threshold", () => {
    const analyzer2 = new RootCauseAnalyzer({ bisectionThreshold: 0.9 });
    const regression = makeRegression({ metric: "avg" });
    const tests = makeTests(5); // max signal is 0.62, below 0.9 threshold

    const result = analyzer2.narrowDown(regression, tests);
    assert.strictEqual(result.result.culprit, null);
    assert.strictEqual(result.result.candidates.length, 0);
  });

  // Test 7: suggestFix provides remediation suggestions
  it("suggestFix returns actionable remediation suggestions", () => {
    const regression = makeRegression({ metric: "memoryPeak", severity: "major" });
    const analysis = {
      hypotheses: [
        {
          cause: "Memory leak in cache module",
          confidence: CONFIDENCE_LEVELS.HIGH,
          strategy: STRATEGIES.EXPERT_RULES,
        },
      ],
    };

    const fix = analyzer.suggestFix(regression, analysis);

    assert.ok(fix.suggestions.length >= 1, `Expected some suggestions, got ${fix.suggestions.length}`);
    assert.strictEqual(fix.priority, "immediate"); // major severity => immediate

    const hasCacheSuggestion = fix.suggestions.some((s) => s.action.includes("cache"));
    assert.ok(hasCacheSuggestion, "suggestion should reference the cache cause");
  });

  // Test 8: suggestFix defaults to planned priority for minor regressions
  it("suggestFix uses planned priority for minor severity regressions", () => {
    const regression = makeRegression({ metric: "avg", severity: "minor" });
    const fix = analyzer.suggestFix(regression, null);
    assert.strictEqual(fix.priority, "planned");
    assert.ok(fix.suggestions.length > 0);
  });

  // Test 9: generateRCAReport produces a comprehensive RCA report
  it("generateRCAReport produces a structured RCA report", () => {
    const regression = makeRegression({
      metric: "p99",
      label: "P99 Latency",
      changePct: 55,
      severity: "critical",
    });
    const context = {
      baseline: { p99: 7.8, avg: 3.2 },
      current: { p99: 12.1, avg: 4.5 },
      changes: makeChanges(3),
      tests: makeTests(5),
    };

    const report = analyzer.generateRCAReport(regression, context);

    // Verify report structure
    assert.strictEqual(report.reportVersion, "1.0");
    assert.ok(report.generatedAt, "should have generatedAt timestamp");
    assert.strictEqual(report.regression.metric, "p99");
    assert.strictEqual(report.regression.severity, "critical");
    assert.strictEqual(report.regression.change, "+55.00%");
    assert.ok(report.analysis.hypotheses.length > 0, "should have hypotheses");
    assert.ok(report.analysis.strategiesApplied.length > 0, "should list strategies");
    assert.ok(report.remediation.suggestions.length > 0, "should have remediation suggestions");
    assert.strictEqual(report.remediation.priority, "immediate");
    assert.strictEqual(report.context.changesCount, 3);
    assert.strictEqual(report.context.testsCount, 5);
    assert.strictEqual(report.context.hasBaselineData, true);
    assert.strictEqual(report.context.hasCurrentData, true);
  });

  // Test 10: expert rules fire for known patterns
  it("expert rules match known memory regression patterns", () => {
    const regression = makeRegression({ metric: "memoryPeak", changePct: 60 });
    const result = analyzer.analyze(regression, {});

    const expertHypotheses = result.strategies.find(
      (s) => s.strategy === STRATEGIES.EXPERT_RULES
    );

    assert.ok(expertHypotheses, "expert rules strategy should be applied");
    assert.ok(
      expertHypotheses.matchedRules.includes("ER-001"),
      "ER-001 should match memoryPeak"
    );
    const memHypothesis = result.hypotheses.find((h) =>
      h.evidence && h.evidence.ruleId === "ER-001"
    );
    assert.ok(memHypothesis, "ER-001 hypothesis should be in results");
    assert.strictEqual(memHypothesis.confidence, CONFIDENCE_LEVELS.HIGH);
  });

  // Test 11: expert rules match known error rate patterns
  it("expert rules match error rate regressions", () => {
    const regression = makeRegression({ metric: "errorRate", changePct: 25 });
    const result = analyzer.analyze(regression, {});

    const expertHypotheses = result.strategies.find(
      (s) => s.strategy === STRATEGIES.EXPERT_RULES
    );
    assert.ok(
      expertHypotheses.matchedRules.includes("ER-004"),
      "ER-004 should match errorRate"
    );
  });

  // Test 12: addRules registers custom expert rules
  it("addRules registers and applies custom expert rules", () => {
    const customRule = {
      id: "CUSTOM-001",
      test: (reg) => reg.metric === "customMetric",
      cause: "Custom metric regression detected from custom data source.",
      confidence: CONFIDENCE_LEVELS.HIGH,
    };

    analyzer.addRules([customRule]);

    const regression = makeRegression({ metric: "customMetric", label: "Custom Metric" });
    const result = analyzer.analyze(regression, {});

    const customHypothesis = result.hypotheses.find(
      (h) => h.evidence && h.evidence.ruleId === "CUSTOM-001"
    );
    assert.ok(customHypothesis, "custom rule should produce a hypothesis");
    assert.strictEqual(customHypothesis.confidence, CONFIDENCE_LEVELS.HIGH);
  });

  // Test 13: setCorrelationThreshold changes filtering behavior
  it("setCorrelationThreshold adjusts correlation filtering", () => {
    const regression = makeRegression({ metric: "avg" });
    const changes = makeChanges(4);

    // With low threshold, correlations should be found
    let result = analyzer.correlateChanges(regression, changes);
    assert.ok(result.correlations.length > 0, "should find correlations with default threshold");

    // With very high threshold, none should pass
    analyzer.setCorrelationThreshold(0.99);
    result = analyzer.correlateChanges(regression, changes);
    assert.strictEqual(result.correlations.length, 0, "no correlations should pass 0.99 threshold");
  });

  // Test 14: computeRelevance utility works correctly
  it("computeRelevance returns higher scores for related changes", () => {
    const regression = { metric: "memoryPeak" };

    const relatedFile = { file: "src/cache/memory-store.js", type: "new-feature", description: "in-memory store" };
    const unrelatedFile = { file: "docs/readme.md", type: "docs", description: "update docs" };

    const relScore = computeRelevance(regression, relatedFile);
    const unrelScore = computeRelevance(regression, unrelatedFile);

    assert.ok(relScore > unrelScore,
      `Related score (${relScore}) should be higher than unrelated (${unrelScore})`);
  });

  // Test 15: bisectTests helper works correctly
  it("bisectTests identifies the correct culprit and range", () => {
    const tests = [
      { name: "test-a", regressionSignal: 0.02 },
      { name: "test-b", regressionSignal: 0.15 },
      { name: "test-c", regressionSignal: 0.48 },
      { name: "test-d", regressionSignal: 0.12 },
      { name: "test-e", regressionSignal: 0.03 },
    ];

    const result = bisectTests(tests, 0.05);
    // bisectTests now sorts internally by signal descending
    assert.strictEqual(result.culprit, "test-c", "highest signal should be culprit");
    assert.deepStrictEqual(result.range, [0, 2], "range in sorted order should cover first 3 entries (indices 0-2)");
    assert.deepStrictEqual(result.candidates, ["test-c", "test-b", "test-d"]);
  });

  // Test 16: bisectTests handles empty arrays
  it("bisectTests returns empty result for empty test array", () => {
    const result = bisectTests([], 0.05);
    assert.strictEqual(result.culprit, null);
    assert.strictEqual(result.candidates.length, 0);
  });

  // Test 17: strategies are correctly listed in RCA report
  it("generateRCAReport lists all applied strategies", () => {
    const regression = makeRegression({ metric: "avg" });
    const context = {
      baseline: { avg: 1.0 },
      current: { avg: 2.0 },
      changes: makeChanges(3),
      tests: makeTests(5),
    };

    const report = analyzer.generateRCAReport(regression, context);

    const strategies = report.analysis.strategiesApplied;
    assert.ok(strategies.includes(STRATEGIES.DELTA_ANALYSIS), "should include delta analysis");
    assert.ok(strategies.includes(STRATEGIES.CORRELATION), "should include correlation");
    assert.ok(strategies.includes(STRATEGIES.EXPERT_RULES), "should include expert rules");
    assert.ok(strategies.includes(STRATEGIES.BISECTION), "should include bisection");
  });
});
