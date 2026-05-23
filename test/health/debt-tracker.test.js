"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  TechnicalDebtTracker,
  DEBT_TYPES,
  SEVERITY_WEIGHTS,
} = require("../../src/health/debt-tracker");

// -------------------------------------------------------------------------
// recordDebt
// -------------------------------------------------------------------------

test("recordDebt creates a debt item with correct fields", () => {
  const tracker = new TechnicalDebtTracker();
  const debt = tracker.recordDebt(
    "/src/app.js",
    "TODO_FIXME",
    "medium",
    "Refactor the monolithic handler function"
  );

  assert.strictEqual(typeof debt.id, "number");
  assert.strictEqual(debt.filePath, "/src/app.js");
  assert.strictEqual(debt.type, "TODO_FIXME");
  assert.strictEqual(debt.severity, "medium");
  assert.strictEqual(debt.description, "Refactor the monolithic handler function");
  assert.strictEqual(debt.resolved, false);
  assert.strictEqual(debt.resolvedAt, null);
  assert.ok(debt.timestamp, "missing timestamp");
});

test("recordDebt assigns auto-incrementing IDs", () => {
  const tracker = new TechnicalDebtTracker();
  const d1 = tracker.recordDebt("/a.js", "TODO_FIXME", "low", "fix this");
  const d2 = tracker.recordDebt("/b.js", "MAGIC_NUMBER", "medium", "replace magic number");
  const d3 = tracker.recordDebt("/c.js", "LONG_FUNCTION", "high", "split function");

  assert.strictEqual(d2.id, d1.id + 1);
  assert.strictEqual(d3.id, d2.id + 1);
});

test("recordDebt throws on invalid inputs", () => {
  const tracker = new TechnicalDebtTracker();

  assert.throws(() => tracker.recordDebt("", "TODO_FIXME", "low", "desc"), TypeError);
  assert.throws(() => tracker.recordDebt("/f.js", "INVALID_TYPE", "low", "desc"), TypeError);
  assert.throws(() => tracker.recordDebt("/f.js", "TODO_FIXME", "extreme", "desc"), TypeError);
  assert.throws(() => tracker.recordDebt("/f.js", "TODO_FIXME", "low", ""), TypeError);
  assert.throws(() => tracker.recordDebt("/f.js", "TODO_FIXME", "low", 123), TypeError);
});

test("recordDebt supports all debt types", () => {
  const tracker = new TechnicalDebtTracker();
  const types = Object.keys(DEBT_TYPES);

  for (const type of types) {
    const debt = tracker.recordDebt(`/src/${type.toLowerCase()}.js`, type, "low", `Test debt for ${type}`);
    assert.strictEqual(debt.type, type);
    assert.ok(DEBT_TYPES[type], `type ${type} should be in DEBT_TYPES`);
  }

  assert.strictEqual(tracker.getAllDebts().length, types.length);
});

test("recordDebt supports all severity levels", () => {
  const tracker = new TechnicalDebtTracker();
  const severities = Object.keys(SEVERITY_WEIGHTS);

  for (const severity of severities) {
    const debt = tracker.recordDebt(`/src/sev-${severity}.js`, "LONG_FUNCTION", severity, `Severity test ${severity}`);
    assert.strictEqual(debt.severity, severity);
  }
});

// -------------------------------------------------------------------------
// resolveDebt
// -------------------------------------------------------------------------

test("resolveDebt marks debt as resolved", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/x.js", "DUPLICATE_CODE", "high", "Repeated validation logic");

  const resolved = tracker.resolveDebt("/src/x.js", "Repeated validation logic");
  assert.ok(resolved, "resolveDebt should return the resolved item");
  assert.strictEqual(resolved.resolved, true);
  assert.ok(resolved.resolvedAt, "missing resolvedAt timestamp");
});

test("resolveDebt only resolves the first matching unresolved debt", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/a.js", "MAGIC_NUMBER", "low", "same description");
  tracker.recordDebt("/src/a.js", "MAGIC_NUMBER", "low", "same description");

  const resolved = tracker.resolveDebt("/src/a.js", "same description");
  assert.ok(resolved);

  // Second one should still be unresolved.
  const unresolved = tracker.getAllDebts(true);
  assert.strictEqual(unresolved.length, 1);
  assert.strictEqual(unresolved[0].resolved, false);
});

test("resolveDebt returns null when no match found", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/a.js", "TODO_FIXME", "low", "do something");

  const result = tracker.resolveDebt("/src/nonexistent.js", "do something");
  assert.strictEqual(result, null);

  const result2 = tracker.resolveDebt("/src/a.js", "wrong description");
  assert.strictEqual(result2, null);
});

test("resolveDebtById resolves by unique ID", () => {
  const tracker = new TechnicalDebtTracker();
  const d1 = tracker.recordDebt("/src/1.js", "LONG_FUNCTION", "medium", "too long");
  const d2 = tracker.recordDebt("/src/2.js", "DEEP_NESTING", "high", "nesting issue");

  const resolved = tracker.resolveDebtById(d1.id);
  assert.ok(resolved);
  assert.strictEqual(resolved.id, d1.id);
  assert.strictEqual(resolved.resolved, true);

  // d2 should still be unresolved.
  const active = tracker.getAllDebts(true);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, d2.id);
});

test("resolveDebtById returns null for already resolved debt", () => {
  const tracker = new TechnicalDebtTracker();
  const d = tracker.recordDebt("/src/f.js", "MISSING_ERROR_HANDLING", "critical", "no try/catch");
  tracker.resolveDebtById(d.id);

  const result = tracker.resolveDebtById(d.id);
  assert.strictEqual(result, null);
});

// -------------------------------------------------------------------------
// getDebtSummary
// -------------------------------------------------------------------------

test("getDebtSummary returns correct aggregate data", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/a.js", "TODO_FIXME", "low", "todo 1");
  tracker.recordDebt("/src/a.js", "TODO_FIXME", "medium", "todo 2");
  tracker.recordDebt("/src/b.js", "LONG_FUNCTION", "high", "long fn");
  tracker.recordDebt("/src/c.js", "DUPLICATE_CODE", "critical", "dup code");

  // Resolve one.
  tracker.resolveDebt("/src/a.js", "todo 1");

  const summary = tracker.getDebtSummary();

  assert.strictEqual(summary.totalActive, 3);
  assert.strictEqual(summary.totalResolved, 1);
  assert.strictEqual(summary.totalCount, 4);
  assert.strictEqual(summary.resolutionRate, "25%");

  // By type.
  assert.ok(summary.byType.TODO_FIXME);
  assert.strictEqual(summary.byType.TODO_FIXME.count, 1); // only unresolved
  assert.ok(summary.byType.LONG_FUNCTION);
  assert.ok(summary.byType.DUPLICATE_CODE);

  // By severity.
  assert.strictEqual(summary.bySeverity.medium.count, 1);
  assert.strictEqual(summary.bySeverity.high.count, 1);
  assert.strictEqual(summary.bySeverity.critical.count, 1);

  // By file.
  assert.ok(summary.byFile["/src/a.js"]);
  assert.ok(summary.byFile["/src/b.js"]);
  assert.ok(summary.byFile["/src/c.js"]);

  // Estimated hours is a positive number.
  assert.ok(summary.estimatedTotalHours > 0);

  // Oldest and newest debt exist.
  assert.ok(summary.oldestDebt);
  assert.ok(summary.newestDebt);
});

test("getDebtSummary handles empty tracker", () => {
  const tracker = new TechnicalDebtTracker();
  const summary = tracker.getDebtSummary();

  assert.strictEqual(summary.totalActive, 0);
  assert.strictEqual(summary.totalResolved, 0);
  assert.strictEqual(summary.totalCount, 0);
  assert.strictEqual(summary.resolutionRate, "0%");
  assert.strictEqual(summary.estimatedTotalHours, 0);
  assert.strictEqual(summary.oldestDebt, null);
  assert.strictEqual(summary.newestDebt, null);
});

// -------------------------------------------------------------------------
// estimateCost
// -------------------------------------------------------------------------

test("estimateCost returns higher cost for higher severity", () => {
  const tracker = new TechnicalDebtTracker();

  const lowDebt = tracker.recordDebt("/src/x.js", "LONG_FUNCTION", "low", "low severity long function");
  const highDebt = tracker.recordDebt("/src/x.js", "LONG_FUNCTION", "high", "high severity long function");
  const criticalDebt = tracker.recordDebt("/src/x.js", "LONG_FUNCTION", "critical", "critical severity");

  const lowCost = tracker.estimateCost(lowDebt);
  const highCost = tracker.estimateCost(highDebt);
  const criticalCost = tracker.estimateCost(criticalDebt);

  assert.ok(highCost > lowCost, `highCost (${highCost}) should be > lowCost (${lowCost})`);
  assert.ok(criticalCost > highCost, `criticalCost (${criticalCost}) should be > highCost (${highCost})`);
});

test("estimateCost varies by debt type", () => {
  const tracker = new TechnicalDebtTracker();

  const magicNum = tracker.recordDebt("/src/x.js", "MAGIC_NUMBER", "low", "magic number");
  const longFn = tracker.recordDebt("/src/x.js", "LONG_FUNCTION", "low", "long function");

  const magicCost = tracker.estimateCost(magicNum);
  const longFnCost = tracker.estimateCost(longFn);

  // LONG_FUNCTION has higher base cost than MAGIC_NUMBER.
  assert.ok(
    longFnCost > magicCost,
    `LONG_FUNCTION cost (${longFnCost}) should be > MAGIC_NUMBER cost (${magicCost})`
  );
});

// -------------------------------------------------------------------------
// prioritize
// -------------------------------------------------------------------------

test("prioritize sorts debts by ROI descending", () => {
  const tracker = new TechnicalDebtTracker();

  tracker.recordDebt("/src/a.js", "MAGIC_NUMBER", "low", "magic number");       // low impact, low cost
  tracker.recordDebt("/src/b.js", "DUPLICATE_CODE", "high", "dup code");        // high impact, medium cost
  tracker.recordDebt("/src/c.js", "MISSING_ERROR_HANDLING", "critical", "err"); // high impact, low-medium cost

  const ranked = tracker.prioritize();

  assert.strictEqual(ranked.length, 3);
  // ROI should be descending.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1].roi >= ranked[i].roi,
      `ROI at index ${i - 1} (${ranked[i - 1].roi}) should be >= ROI at index ${i} (${ranked[i].roi})`
    );
  }

  // All should have positive ROI.
  for (const item of ranked) {
    assert.ok(item.roi > 0, `expected positive ROI, got ${item.roi}`);
    assert.ok(item.estimatedHours > 0, `expected positive hours, got ${item.estimatedHours}`);
    assert.ok(item.impact > 0, `expected positive impact, got ${item.impact}`);
  }
});

test("prioritize returns empty array when no active debts", () => {
  const tracker = new TechnicalDebtTracker();
  const ranked = tracker.prioritize();
  assert.strictEqual(ranked.length, 0);
});

test("prioritize excludes resolved debts", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/a.js", "DEEP_NESTING", "high", "nested logic");
  tracker.recordDebt("/src/b.js", "LONG_FUNCTION", "medium", "long fn");

  tracker.resolveDebt("/src/a.js", "nested logic");

  const ranked = tracker.prioritize();
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].debt.description, "long fn");
});

// -------------------------------------------------------------------------
// getTrend
// -------------------------------------------------------------------------

test("getTrend returns history and trend after multiple snapshots", () => {
  const tracker = new TechnicalDebtTracker();

  // Record some debts and resolve some to create a trend.
  const d1 = tracker.recordDebt("/src/1.js", "TODO_FIXME", "low", "unfinished feature");
  const d2 = tracker.recordDebt("/src/2.js", "MAGIC_NUMBER", "low", "replace 42");
  const d3 = tracker.recordDebt("/src/3.js", "LONG_FUNCTION", "high", "too long");

  tracker.resolveDebt("/src/1.js", "unfinished feature");
  tracker.resolveDebt("/src/3.js", "too long");

  const trend = tracker.getTrend();
  assert.ok(trend.snapshots.length >= 2, `expected at least 2 snapshots, got ${trend.snapshots.length}`);
  assert.ok(
    ["improving", "declining", "stable", "insufficient-data"].includes(trend.trend),
    `unexpected trend: ${trend.trend}`
  );

  // Since we resolved more than we added, trend should be improving.
  assert.strictEqual(trend.trend, "improving");
});

// -------------------------------------------------------------------------
// getAllDebts
// -------------------------------------------------------------------------

test("getAllDebts returns all debts by default", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/a.js", "TODO_FIXME", "low", "desc 1");
  tracker.recordDebt("/src/b.js", "MAGIC_NUMBER", "medium", "desc 2");
  tracker.resolveDebt("/src/a.js", "desc 1");

  const all = tracker.getAllDebts();
  assert.strictEqual(all.length, 2);

  const active = tracker.getAllDebts(true);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].description, "desc 2");
});

// -------------------------------------------------------------------------
// clear
// -------------------------------------------------------------------------

test("clear resets all internal state", () => {
  const tracker = new TechnicalDebtTracker();
  tracker.recordDebt("/src/x.js", "DEEP_NESTING", "high", "nested");
  tracker.clear();

  assert.strictEqual(tracker.getAllDebts().length, 0);
  const summary = tracker.getDebtSummary();
  assert.strictEqual(summary.totalCount, 0);
  assert.strictEqual(tracker.prioritize().length, 0);
});
