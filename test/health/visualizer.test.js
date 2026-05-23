"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  HealthVisualizer,
  THEME,
  ANSI,
  BLOCKS,
  SPARK,
  _resampleArray,
} = require("../../src/health/visualizer");

// -------------------------------------------------------------------------
// Helpers: strip ANSI for content assertions
// -------------------------------------------------------------------------

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\x1B\[[0-9;]*m/g, "");
}

// -------------------------------------------------------------------------
// Constructor
// -------------------------------------------------------------------------

test("constructor initializes with default options", () => {
  const viz = new HealthVisualizer();
  assert.ok(viz, "should create instance");
});

test("constructor accepts custom termWidth", () => {
  const viz = new HealthVisualizer({ termWidth: 120 });
  assert.ok(viz, "should accept custom width");
});

test("constructor accepts showColor option", () => {
  const vizNoColor = new HealthVisualizer({ showColor: false });
  assert.ok(vizNoColor, "should accept showColor: false");
});

// -------------------------------------------------------------------------
// renderDashboard
// -------------------------------------------------------------------------

function makeHealth(overrides = {}) {
  return {
    overallScore: 87,
    grade: "B",
    timestamp: new Date().toISOString(),
    dimensions: {
      codeHealth: 85,
      testCoverage: 72,
      debtRatio: 0.15,
      docCoverage: 80,
      dependencyHealth: 91,
    },
    dimensionStatuses: {
      codeHealth: { value: 85, status: "pass", threshold: { warn: 70, critical: 50 } },
      testCoverage: { value: 72, status: "pass", threshold: { warn: 60, critical: 30 } },
      debtRatio: { value: 0.15, status: "pass", threshold: { warn: 0.3, critical: 0.6 } },
      docCoverage: { value: 80, status: "pass", threshold: { warn: 50, critical: 25 } },
      dependencyHealth: { value: 91, status: "pass", threshold: { warn: 70, critical: 40 } },
    },
    monitoring: {
      running: true,
      startedAt: new Date().toISOString(),
      lastCheckAt: new Date().toISOString(),
      totalChecks: 42,
    },
    alerts: { active: 0, recent: [] },
    ...overrides,
  };
}

test("renderDashboard() produces non-empty output for valid health object", () => {
  const viz = new HealthVisualizer();
  const output = viz.renderDashboard(makeHealth());

  assert.ok(output.length > 0, "dashboard should not be empty");
  assert.ok(stripAnsi(output).includes("PROJECT HEALTH DASHBOARD"), "should include header");
  assert.ok(stripAnsi(output).includes("HEALTH DIMENSIONS"), "should include dimensions section");
});

test("renderDashboard() includes overall score and grade", () => {
  const viz = new HealthVisualizer();
  const output = viz.renderDashboard(makeHealth({ overallScore: 87, grade: "B" }));

  const plain = stripAnsi(output);
  assert.ok(plain.includes("87"), "should include score");
  assert.ok(plain.includes("B"), "should include grade");
});

test("renderDashboard() shows monitoring status as ACTIVE when running", () => {
  const viz = new HealthVisualizer();
  const output = viz.renderDashboard(makeHealth());

  const plain = stripAnsi(output);
  assert.ok(plain.includes("ACTIVE"), "should show ACTIVE state");
});

test("renderDashboard() shows monitoring status as STOPPED when not running", () => {
  const viz = new HealthVisualizer();
  const output = viz.renderDashboard(makeHealth({
    monitoring: { running: false, startedAt: null, lastCheckAt: null, totalChecks: 0 },
  }));

  const plain = stripAnsi(output);
  assert.ok(plain.includes("STOPPED"), "should show STOPPED state");
});

test("renderDashboard() shows alerts section when alerts are active", () => {
  const viz = new HealthVisualizer();
  const output = viz.renderDashboard(makeHealth({
    alerts: {
      active: 3,
      recent: [
        {
          dimension: "codeHealth",
          level: "warn",
          message: "Code Health below threshold (45, threshold: 70)",
        },
      ],
    },
  }));

  const plain = stripAnsi(output);
  assert.ok(plain.includes("active alert"), "should mention alerts");
});

test("renderDashboard() returns empty string for null/undefined health", () => {
  const viz = new HealthVisualizer();
  assert.strictEqual(viz.renderDashboard(null), "");
  assert.strictEqual(viz.renderDashboard(undefined), "");
});

test("renderDashboard() handles missing dimensions gracefully", () => {
  const viz = new HealthVisualizer();
  const partial = {
    overallScore: 50,
    grade: "D",
    timestamp: new Date().toISOString(),
    dimensions: null,
    dimensionStatuses: null,
    monitoring: { running: false, totalChecks: 0 },
    alerts: { active: 0, recent: [] },
  };

  const output = viz.renderDashboard(partial);
  assert.ok(output.length > 0, "should produce output for partial data");
});

// -------------------------------------------------------------------------
// renderTrend
// -------------------------------------------------------------------------

function makeHistory(values) {
  return values.map((v, i) => ({
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    checkNumber: i + 1,
    overallScore: 80,
    grade: "B",
    dimensions: {
      codeHealth: v,
      testCoverage: 70,
      debtRatio: 0.2,
      docCoverage: 70,
      dependencyHealth: 70,
    },
  }));
}

test("renderTrend() produces a sparkline for valid history", () => {
  const viz = new HealthVisualizer();
  const history = makeHistory([80, 82, 79, 85, 88, 90, 87, 92, 95, 93]);

  const output = viz.renderTrend("codeHealth", history);
  assert.ok(output.length > 0, "should produce output");
  assert.ok(stripAnsi(output).includes("avg:"), "should include stats");
  assert.ok(stripAnsi(output).includes("min:"), "should include min");
  assert.ok(stripAnsi(output).includes("max:"), "should include max");
});

test("renderTrend() returns no-data message for empty history", () => {
  const viz = new HealthVisualizer();

  const output = viz.renderTrend("codeHealth", []);
  assert.ok(stripAnsi(output).includes("no data"), "should indicate no data");
});

test("renderTrend() returns no-data message for null history", () => {
  const viz = new HealthVisualizer();

  const output = viz.renderTrend("codeHealth", null);
  assert.ok(stripAnsi(output).includes("no data"), "should indicate no data");
});

test("renderTrend() supports disabling label and stats", () => {
  const viz = new HealthVisualizer();
  const history = makeHistory([80, 85, 90]);

  const bareOutput = viz.renderTrend("codeHealth", history, {
    showLabel: false,
    showStats: false,
  });

  const plain = stripAnsi(bareOutput);
  assert.ok(!plain.includes("Code Health"), "should not include label");
  assert.ok(!plain.includes("avg:"), "should not include stats");
});

test("renderTrend() handles debtRatio with inverted coloring", () => {
  const viz = new HealthVisualizer();
  const history = makeHistory([80, 85, 90]).map((s) => ({
    ...s,
    dimensions: { ...s.dimensions, codeHealth: undefined, debtRatio: 0.15 },
  }));

  // debtRatio is inverted — lowering is good
  const history2 = [0.8, 0.6, 0.4, 0.3, 0.15].map((v, i) => ({
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    checkNumber: i + 1,
    overallScore: 70,
    grade: "C",
    dimensions: {
      codeHealth: 80,
      testCoverage: 70,
      debtRatio: v,
      docCoverage: 70,
      dependencyHealth: 70,
    },
  }));

  const output = viz.renderTrend("debtRatio", history2);
  assert.ok(output.length > 0, "should produce output for debtRatio trend");
});

// -------------------------------------------------------------------------
// renderRadar
// -------------------------------------------------------------------------

test("renderRadar() produces radar chart for valid metrics", () => {
  const viz = new HealthVisualizer();
  const metrics = {
    codeHealth: 85,
    testCoverage: 72,
    debtRatio: 0.15,
    docCoverage: 80,
    dependencyHealth: 91,
  };

  const output = viz.renderRadar(metrics);
  assert.ok(output.length > 0, "should produce radar chart");

  // Should contain reset codes indicating colored output
  assert.ok(output.includes(ANSI.reset), "should include ANSI resets");
});

test("renderRadar() returns message for empty metrics", () => {
  const viz = new HealthVisualizer();

  const output = viz.renderRadar({});
  assert.ok(stripAnsi(output).includes("no metrics"), "should indicate no metrics");
});

test("renderRadar() returns message for single metric", () => {
  const viz = new HealthVisualizer();

  const output = viz.renderRadar({ codeHealth: 85 });
  assert.ok(
    stripAnsi(output).includes("at least 2 metrics"),
    "should indicate need more metrics"
  );
});

test("renderRadar() handles custom dimensions", () => {
  const viz = new HealthVisualizer();
  // Support compact mode
  const output = viz.renderRadar(
    { codeHealth: 80, testCoverage: 70, docCoverage: 90 },
    { compact: true, width: 30, height: 6 }
  );

  assert.ok(output.length > 0, "should produce compact radar");
});

// -------------------------------------------------------------------------
// renderHeatmap
// -------------------------------------------------------------------------

test("renderHeatmap() produces heatmap for valid areas", () => {
  const viz = new HealthVisualizer();
  const areas = [
    { label: "src/core", score: 92 },
    { label: "src/health", score: 85 },
    { label: "src/dashboard", score: 78 },
    { label: "src/tools", score: 65 },
    { label: "src/i18n", score: 45 },
    { label: "test/", score: 88 },
  ];

  const output = viz.renderHeatmap(areas);
  assert.ok(output.length > 0, "should produce heatmap");

  const plain = stripAnsi(output);
  assert.ok(plain.includes("90+"), "should include legend");
  assert.ok(plain.includes("<40"), "should include low-end legend");
});

test("renderHeatmap() returns message for empty areas", () => {
  const viz = new HealthVisualizer();

  const output = viz.renderHeatmap([]);
  assert.ok(stripAnsi(output).includes("no areas"), "should indicate no areas");
});

test("renderHeatmap() respects showLegend: false", () => {
  const viz = new HealthVisualizer();
  const areas = [{ label: "core", score: 85 }];

  const output = viz.renderHeatmap(areas, { showLegend: false });
  assert.ok(!stripAnsi(output).includes("90+"), "should not include legend");
});

// -------------------------------------------------------------------------
// renderStatusBadge
// -------------------------------------------------------------------------

test("renderStatusBadge() produces badge for valid score", () => {
  const viz = new HealthVisualizer();

  const aBadge = viz.renderStatusBadge(95);
  assert.ok(stripAnsi(aBadge).includes("A"), "A-grade badge should contain A");

  const bBadge = viz.renderStatusBadge(85);
  assert.ok(stripAnsi(bBadge).includes("B"), "B-grade badge should contain B");

  const cBadge = viz.renderStatusBadge(75);
  assert.ok(stripAnsi(cBadge).includes("C"), "C-grade badge should contain C");

  const dBadge = viz.renderStatusBadge(65);
  assert.ok(stripAnsi(dBadge).includes("D"), "D-grade badge should contain D");

  const fBadge = viz.renderStatusBadge(30);
  assert.ok(stripAnsi(fBadge).includes("F"), "F-grade badge should contain F");
});

test("renderStatusBadge() returns N/A for null/undefined score", () => {
  const viz = new HealthVisualizer();

  assert.ok(stripAnsi(viz.renderStatusBadge(null)).includes("N/A"));
  assert.ok(stripAnsi(viz.renderStatusBadge(undefined)).includes("N/A"));
});

test("renderStatusBadge() can hide grade", () => {
  const viz = new HealthVisualizer();
  const badge = viz.renderStatusBadge(85, { showGrade: false });

  assert.ok(!stripAnsi(badge).includes("B"), "should not include grade letter");
  assert.ok(stripAnsi(badge).includes("85"), "should still include score");
});

test("renderStatusBadge() can hide score", () => {
  const viz = new HealthVisualizer();
  const badge = viz.renderStatusBadge(85, { showScore: false });

  assert.ok(stripAnsi(badge).includes("B"), "should include grade letter");
  assert.ok(!stripAnsi(badge).includes("85"), "should not include score number");
});

// -------------------------------------------------------------------------
// Exported constants
// -------------------------------------------------------------------------

test("THEME is a non-null object with expected keys", () => {
  assert.strictEqual(typeof THEME, "object");
  assert.ok(THEME.heading);
  assert.ok(THEME.success);
  assert.ok(THEME.warning);
  assert.ok(THEME.error);
  assert.ok(THEME.muted);
});

test("ANSI is a non-null object with color codes", () => {
  assert.strictEqual(typeof ANSI, "object");
  assert.ok(ANSI.reset);
  assert.ok(ANSI.red);
  assert.ok(ANSI.green);
});

test("BLOCKS and SPARK are non-empty arrays", () => {
  assert.ok(Array.isArray(BLOCKS));
  assert.ok(BLOCKS.length > 0);
  assert.ok(Array.isArray(SPARK));
  assert.ok(SPARK.length > 0);
});

// -------------------------------------------------------------------------
// _resampleArray helper
// -------------------------------------------------------------------------

test("_resampleArray() downsamples an array to target length", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = _resampleArray(input, 4);

  assert.strictEqual(result.length, 4);
  assert.ok(result.every((v) => typeof v === "number"));
});

test("_resampleArray() returns same array if shorter than target", () => {
  const input = [1, 2, 3];
  const result = _resampleArray(input, 5);

  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result, input);
});

test("_resampleArray() returns empty array for empty input", () => {
  assert.deepStrictEqual(_resampleArray([], 5), []);
  assert.deepStrictEqual(_resampleArray(null, 5), []);
});
