/**
 * Tests for quality reporter.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatGateResult,
  formatAsChecklist,
  formatAsBadge,
  summarizeGateRun,
  trackHistory,
  getQualityTrend,
} = require("../../src/quality/reporter");

function makePassingResult() {
  return {
    passed: true,
    failed: 0,
    skipped: 0,
    totalScore: 60,
    maxScore: 60,
    threshold: 0,
    results: [
      { name: "lint", status: "pass", message: "No lint issues", score: 10, details: {}, weight: 1 },
      { name: "typeCheck", status: "pass", message: "Type check passed", score: 10, details: {}, weight: 1 },
      { name: "test", status: "pass", message: "All tests passed", score: 10, details: {}, weight: 1 },
    ],
  };
}

function makeFailingResult() {
  return {
    passed: false,
    failed: 2,
    skipped: 1,
    totalScore: 30,
    maxScore: 60,
    threshold: 0,
    results: [
      { name: "lint", status: "fail", message: "3 lint errors", score: 0, details: {}, weight: 1 },
      { name: "typeCheck", status: "fail", message: "5 type errors", score: 0, details: {}, weight: 1 },
      { name: "test", status: "skip", message: "No tests found", score: 0, details: {}, weight: 1 },
    ],
  };
}

test("formatGateResult: renders passing result", () => {
  const output = formatGateResult(makePassingResult());
  assert.ok(output.includes("PASSED"));
  assert.ok(output.includes("Score: 60/60"));
  assert.ok(output.includes("[PASS] lint"));
});

test("formatGateResult: renders failing result", () => {
  const output = formatGateResult(makeFailingResult());
  assert.ok(output.includes("FAILED"));
  assert.ok(output.includes("[FAIL] lint"));
  assert.ok(output.includes("[SKIP] test"));
});

test("formatAsChecklist: renders markdown checklist", () => {
  const results = makePassingResult().results;
  const output = formatAsChecklist(results);
  assert.ok(output.includes("- [x]"));
  assert.ok(output.includes("lint"));
  assert.ok(output.includes("typeCheck"));
});

test("formatAsChecklist: marks failed items as unchecked", () => {
  const results = makeFailingResult().results;
  const output = formatAsChecklist(results);
  assert.ok(output.includes("- [ ] **lint**: 3 lint errors *(failed)*"));
});

test("formatAsBadge: returns passed badge", () => {
  const output = formatAsBadge(makePassingResult());
  assert.ok(output.includes("passed"));
  assert.ok(output.includes("green"));
  assert.ok(output.startsWith("!"));
});

test("formatAsBadge: returns failed badge", () => {
  const output = formatAsBadge(makeFailingResult());
  assert.ok(output.includes("failed"));
  assert.ok(output.includes("red"));
});

test("summarizeGateRun: returns one-line summary", () => {
  const output = summarizeGateRun(makeFailingResult());
  assert.ok(output.startsWith("[FAIL]"));
  assert.ok(output.includes("2 failed"));
  assert.ok(output.includes("1 skipped"));
  assert.ok(output.includes("30/60"));
});

test("trackHistory: appends entry to history array", () => {
  const history = trackHistory(makePassingResult());
  assert.equal(history.length, 1);
  assert.equal(history[0].passed, true);
  assert.equal(history[0].totalScore, 60);
  assert.ok(typeof history[0].timestamp === "string");
});

test("trackHistory: appends to existing history", () => {
  const history = trackHistory(makePassingResult());
  const updated = trackHistory(makeFailingResult(), history);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].passed, true);
  assert.equal(updated[1].passed, false);
});

test("getQualityTrend: returns insufficient-data for empty history", () => {
  const trend = getQualityTrend([]);
  assert.equal(trend.entries, 0);
  assert.equal(trend.trend, "insufficient-data");
});

test("getQualityTrend: detects improving trend", () => {
  const history = [
    { passed: false, totalScore: 30, maxScore: 100 },
    { passed: false, totalScore: 40, maxScore: 100 },
    { passed: true, totalScore: 60, maxScore: 100 },
    { passed: true, totalScore: 80, maxScore: 100 },
    { passed: true, totalScore: 90, maxScore: 100 },
    { passed: true, totalScore: 95, maxScore: 100 },
  ];
  const trend = getQualityTrend(history);
  assert.equal(trend.trend, "improving");
  assert.equal(trend.passCount, 4);
  assert.equal(trend.failCount, 2);
});

test("getQualityTrend: detects declining trend", () => {
  const history = [
    { passed: true, totalScore: 95, maxScore: 100 },
    { passed: true, totalScore: 85, maxScore: 100 },
    { passed: true, totalScore: 70, maxScore: 100 },
    { passed: false, totalScore: 40, maxScore: 100 },
    { passed: false, totalScore: 20, maxScore: 100 },
    { passed: false, totalScore: 10, maxScore: 100 },
  ];
  const trend = getQualityTrend(history);
  assert.equal(trend.trend, "declining");
});

test("getQualityTrend: computes correct passRate", () => {
  const history = [
    { passed: true, totalScore: 80, maxScore: 100 },
    { passed: false, totalScore: 40, maxScore: 100 },
    { passed: true, totalScore: 80, maxScore: 100 },
    { passed: true, totalScore: 80, maxScore: 100 },
  ];
  const trend = getQualityTrend(history);
  assert.equal(trend.passRate, "75%");
  assert.equal(trend.entries, 4);
});
