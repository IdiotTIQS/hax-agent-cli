/**
 * Tests for quality gates.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  QualityGate,
  lintCheck,
  typeCheck,
  testCheck,
  securityCheck,
  coverageCheck,
  dependencyCheck,
} = require("../../src/quality/gates");

test("QualityGate: registers pre-built checks by default", () => {
  const gate = new QualityGate();
  const checks = gate.listChecks();
  assert.ok(checks.includes("lint"));
  assert.ok(checks.includes("typeCheck"));
  assert.ok(checks.includes("test"));
  assert.ok(checks.includes("security"));
  assert.ok(checks.includes("coverage"));
  assert.ok(checks.includes("dependencies"));
  assert.equal(checks.length, 6);
});

test("QualityGate: addCheck registers a custom check", () => {
  const gate = new QualityGate();
  gate.addCheck("custom", () => ({ name: "custom", status: "pass", message: "ok", score: 10, details: {} }));
  const checks = gate.listChecks();
  assert.ok(checks.includes("custom"));
});

test("QualityGate: addCheck throws on invalid name", () => {
  const gate = new QualityGate();
  assert.throws(() => gate.addCheck("", () => {}), { message: /non-empty string/ });
  assert.throws(() => gate.addCheck(null, () => {}), { message: /non-empty string/ });
});

test("QualityGate: addCheck throws on non-function check", () => {
  const gate = new QualityGate();
  assert.throws(() => gate.addCheck("bad", "not-a-function"), { message: /must be a function/ });
});

test("QualityGate: removeCheck removes a check", () => {
  const gate = new QualityGate();
  gate.removeCheck("lint");
  const checks = gate.listChecks();
  assert.ok(!checks.includes("lint"));
});

test("QualityGate: runAll returns passed when no checks fail", () => {
  const gate = new QualityGate();
  const result = gate.runAll({
    lintOutput: { errorCount: 0, warningCount: 0, messages: [] },
    typeCheckOutput: { errors: 0, messages: [] },
    testOutput: { passed: 10, failed: 0, skipped: 0, total: 10 },
    securityOutput: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 }, total: 0 },
    coverageOutput: { lines: 90, statements: 85, functions: 82, branches: 75 },
    dependencyOutput: { advisories: {}, total: 0 },
  });
  assert.equal(result.passed, true);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.ok(result.totalScore >= 50);
});

test("QualityGate: runAll detects lint failures", () => {
  const gate = new QualityGate();
  const result = gate.runAll({
    lintOutput: { errorCount: 3, warningCount: 2, messages: [{ line: 1, message: "semi" }] },
    typeCheckOutput: { errors: 0, messages: [] },
    testOutput: { passed: 10, failed: 0, skipped: 0, total: 10 },
    securityOutput: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 }, total: 0 },
    coverageOutput: { lines: 90, statements: 85, functions: 82, branches: 75 },
    dependencyOutput: { advisories: {}, total: 0 },
  });
  const lintResult = result.results.find((r) => r.name === "lint");
  assert.equal(lintResult.status, "fail");
  assert.ok(result.failed > 0);
});

test("QualityGate: runAll skips tests when none run", () => {
  const gate = new QualityGate();
  const result = gate.runAll({
    lintOutput: { errorCount: 0, warningCount: 0, messages: [] },
    typeCheckOutput: { errors: 0, messages: [] },
    testOutput: { passed: 0, failed: 0, skipped: 0, total: 0 },
    securityOutput: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 }, total: 0 },
    coverageOutput: { lines: 90, statements: 85, functions: 82, branches: 75 },
    dependencyOutput: { advisories: {}, total: 0 },
  });
  const testResult = result.results.find((r) => r.name === "test");
  assert.equal(testResult.status, "skip");
  assert.equal(testResult.message, "No tests found");
});

test("QualityGate: runByName runs only specified checks", () => {
  const gate = new QualityGate();
  const result = gate.runByName(["lint", "typeCheck"], {
    lintOutput: { errorCount: 0, warningCount: 0, messages: [] },
    typeCheckOutput: { errors: 0, messages: [] },
  });
  assert.equal(result.results.length, 2);
  const names = result.results.map((r) => r.name);
  assert.ok(names.includes("lint"));
  assert.ok(names.includes("typeCheck"));
  assert.ok(!names.includes("security"));
});

test("QualityGate: runByName skips unregistered checks", () => {
  const gate = new QualityGate();
  const result = gate.runByName(["nonexistent"]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, "skip");
  assert.equal(result.results[0].message, "Check not registered");
});

test("QualityGate: setThreshold and getThreshold work", () => {
  const gate = new QualityGate();
  gate.setThreshold(30);
  assert.equal(gate.getThreshold(), 30);
  assert.throws(() => gate.setThreshold(-1), { message: /non-negative/ });
});

test("QualityGate: threshold causes fail when score too low", () => {
  const gate = new QualityGate();
  gate.setThreshold(60);
  // Only lint passes, everything fails — total score will be low
  const result = gate.runAll({
    lintOutput: { errorCount: 3, warningCount: 2, messages: [] },
    typeCheckOutput: { errors: 5, messages: [] },
    testOutput: { passed: 8, failed: 2, skipped: 0, total: 10 },
    securityOutput: { vulnerabilities: { critical: 1, high: 2 }, total: 3 },
    coverageOutput: { lines: 50, statements: 40, functions: 30, branches: 20 },
    dependencyOutput: { advisories: { "CVE-123": {} }, total: 1 },
  });
  assert.equal(result.passed, false);
  assert.equal(result.threshold, 60);
  assert.ok(result.totalScore < 60);
});

test("lintCheck: passes with no errors", () => {
  const result = lintCheck({ lintOutput: { errorCount: 0, warningCount: 0, messages: [] } });
  assert.equal(result.status, "pass");
  assert.equal(result.score, 10);
});

test("lintCheck: passes with only warnings", () => {
  const result = lintCheck({ lintOutput: { errorCount: 0, warningCount: 3, messages: [] } });
  assert.equal(result.status, "pass");
  assert.equal(result.score, 8);
});

test("typeCheck: fails when errors present", () => {
  const result = typeCheck({ typeCheckOutput: { errors: 2, messages: ["Type 'A' is not assignable"] } });
  assert.equal(result.status, "fail");
  assert.equal(result.score, 0);
});
