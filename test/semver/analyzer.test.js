/**
 * Tests for SemverAnalyzer: analyzeChange, detectBreakingChanges,
 * estimateMigrationEffort, getMigrationGuide, isSafeUpgrade.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SemverAnalyzer, ImpactLevel } = require("../../src/semver/analyzer");

// ---------------------------------------------------------------------------
// analyzeChange — basic classification
// ---------------------------------------------------------------------------

test("analyzeChange: classifies PATCH change as safe", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.0.0", "1.0.1");

  assert.equal(result.level, ImpactLevel.PATCH);
  assert.equal(result.isBreaking, false);
  assert.equal(result.isSafe, true);
  assert.equal(result.direction, "upgrade");
  assert.equal(result.diff, "PATCH");
});

test("analyzeChange: classifies MINOR change as safe", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.0.0", "1.2.0");

  assert.equal(result.level, ImpactLevel.MINOR);
  assert.equal(result.isBreaking, false);
  assert.equal(result.isSafe, true);
  assert.equal(result.diff, "MINOR");
});

test("analyzeChange: classifies MAJOR change as breaking", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.0.0", "2.0.0");

  assert.equal(result.level, ImpactLevel.MAJOR);
  assert.equal(result.isBreaking, true);
  assert.equal(result.isSafe, false);
  assert.equal(result.diff, "MAJOR");
});

test("analyzeChange: classifies PREMAJOR as breaking and unsafe", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.0.0", "2.0.0-alpha.0");

  assert.equal(result.level, ImpactLevel.MAJOR);
  assert.equal(result.isBreaking, true);
  assert.equal(result.isSafe, false);
  assert.equal(result.diff, "PREMAJOR");
});

test("analyzeChange: classifies PRE change as prerelease (unsafe)", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.0.0-alpha.1", "1.0.0-beta.1");

  assert.equal(result.level, ImpactLevel.PRERELEASE);
  assert.equal(result.isBreaking, true);
  assert.equal(result.isSafe, false);
  assert.equal(result.diff, "PRE");
});

test("analyzeChange: returns identity result for same version", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("1.2.3", "1.2.3");

  assert.equal(result.level, ImpactLevel.PATCH);
  assert.equal(result.isBreaking, false);
  assert.equal(result.isSafe, true);
  assert.equal(result.direction, "same");
  assert.equal(result.diff, null);
  assert.equal(result.migrationEffort.hours, 0);
});

test("analyzeChange: treats downgrade as breaking and unsafe", () => {
  const analyzer = new SemverAnalyzer();
  const result = analyzer.analyzeChange("2.0.0", "1.0.0");

  assert.equal(result.level, ImpactLevel.MAJOR);
  assert.equal(result.isBreaking, true);
  assert.equal(result.isSafe, false);
  assert.equal(result.direction, "downgrade");
});

test("analyzeChange: returns invalid result for malformed versions", () => {
  const analyzer = new SemverAnalyzer();

  const r1 = analyzer.analyzeChange("bad", "1.0.0");
  assert.equal(r1.level, null);
  assert.equal(r1.direction, "invalid");
  assert.ok(r1.summary.includes("Invalid source version"));

  const r2 = analyzer.analyzeChange("1.0.0", "nope");
  assert.equal(r2.level, null);
  assert.equal(r2.direction, "invalid");

  const r3 = analyzer.analyzeChange(null, "1.0.0");
  assert.equal(r3.level, null);
  assert.equal(r3.direction, "invalid");
});

// ---------------------------------------------------------------------------
// detectBreakingChanges
// ---------------------------------------------------------------------------

test("detectBreakingChanges: returns empty for patch change", () => {
  const analyzer = new SemverAnalyzer();
  const changes = analyzer.detectBreakingChanges("1.0.0", "1.0.1");

  assert.equal(changes.length, 0);
});

test("detectBreakingChanges: detects API removal on major bump", () => {
  const analyzer = new SemverAnalyzer();
  const changes = analyzer.detectBreakingChanges("1.0.0", "2.0.0");

  assert.ok(changes.length > 0);
  assert.ok(changes.some((c) => c.category === "api-removed"));
});

test("detectBreakingChanges: includes pre-release instability warning", () => {
  const analyzer = new SemverAnalyzer();
  const changes = analyzer.detectBreakingChanges("1.2.3", "1.3.0-alpha.0");

  assert.ok(changes.length > 0);
  assert.ok(changes.some((c) => c.category === "behavior-changed"));
});

test("detectBreakingChanges: includes registered breaking changes", () => {
  const analyzer = new SemverAnalyzer();
  analyzer.registerBreakingChanges("1.0.0", "1.1.0", [
    { category: "api-changed", description: "Renamed export foo() to bar()", effort: "medium" },
  ]);

  const changes = analyzer.detectBreakingChanges("1.0.0", "1.1.0");

  assert.equal(changes.length, 1);
  assert.equal(changes[0].description, "Renamed export foo() to bar()");
});

// ---------------------------------------------------------------------------
// estimateMigrationEffort
// ---------------------------------------------------------------------------

test("estimateMigrationEffort: returns none for patch changes", () => {
  const analyzer = new SemverAnalyzer();
  const effort = analyzer.estimateMigrationEffort("1.0.0", "1.0.5");

  assert.equal(effort.level, "none");
});

test("estimateMigrationEffort: returns low for minor changes", () => {
  const analyzer = new SemverAnalyzer();
  const effort = analyzer.estimateMigrationEffort("1.0.0", "1.5.0");

  assert.equal(effort.level, "low");
  assert.ok(effort.hours > 0);
  assert.ok(effort.tasks >= 1);
});

test("estimateMigrationEffort: returns medium/high for major gap", () => {
  const analyzer = new SemverAnalyzer();
  const effort = analyzer.estimateMigrationEffort("1.0.0", "4.0.0");

  assert.equal(effort.level, "high");
  assert.ok(effort.hours > 30);
  assert.ok(effort.tasks > 5);
});

test("estimateMigrationEffort: single major bump is low effort", () => {
  const analyzer = new SemverAnalyzer();
  const effort = analyzer.estimateMigrationEffort("1.0.0", "2.0.0");

  assert.equal(effort.level, "low");
  assert.ok(effort.hours > 10);
});

test("estimateMigrationEffort: returns none for same version", () => {
  const analyzer = new SemverAnalyzer();
  const effort = analyzer.estimateMigrationEffort("1.0.0", "1.0.0");

  assert.equal(effort.level, "none");
  assert.equal(effort.hours, 0);
  assert.equal(effort.tasks, 0);
});

// ---------------------------------------------------------------------------
// getMigrationGuide
// ---------------------------------------------------------------------------

test("getMigrationGuide: generates multi-step guide for major upgrade", () => {
  const analyzer = new SemverAnalyzer();
  const guide = analyzer.getMigrationGuide("1.0.0", "3.0.0");

  assert.ok(guide.length > 3);
  assert.ok(guide.some((s) => s.action === "review-changelog"));
  assert.ok(guide.some((s) => s.action === "run-tests"));
  assert.ok(guide.some((s) => s.action === "migrate-api"));
});

test("getMigrationGuide: generates minimal guide for patch upgrade", () => {
  const analyzer = new SemverAnalyzer();
  const guide = analyzer.getMigrationGuide("1.0.0", "1.0.1");

  assert.ok(guide.length <= 3);
  assert.ok(guide.some((s) => s.action === "review-changelog"));
  assert.ok(guide.some((s) => s.action === "update"));
});

test("getMigrationGuide: returns pre-registered guide when available", () => {
  const analyzer = new SemverAnalyzer();
  analyzer.registerMigrationGuide("1.0.0", "2.0.0", [
    { step: 1, action: "custom-a", details: "Do custom thing A." },
    { step: 2, action: "custom-b", details: "Do custom thing B." },
  ]);

  const guide = analyzer.getMigrationGuide("1.0.0", "2.0.0");

  assert.equal(guide.length, 2);
  assert.equal(guide[0].action, "custom-a");
  assert.equal(guide[1].action, "custom-b");
});

// ---------------------------------------------------------------------------
// isSafeUpgrade
// ---------------------------------------------------------------------------

test("isSafeUpgrade: returns true for patch upgrades", () => {
  const analyzer = new SemverAnalyzer();
  assert.equal(analyzer.isSafeUpgrade("1.0.0", "1.0.5"), true);
});

test("isSafeUpgrade: returns true for minor upgrades", () => {
  const analyzer = new SemverAnalyzer();
  assert.equal(analyzer.isSafeUpgrade("1.0.0", "1.9.0"), true);
});

test("isSafeUpgrade: returns false for major upgrades", () => {
  const analyzer = new SemverAnalyzer();
  assert.equal(analyzer.isSafeUpgrade("1.0.0", "2.0.0"), false);
});

test("isSafeUpgrade: returns false for downgrades", () => {
  const analyzer = new SemverAnalyzer();
  assert.equal(analyzer.isSafeUpgrade("3.0.0", "1.0.0"), false);
});

// ---------------------------------------------------------------------------
// Registered breaking changes override safety
// ---------------------------------------------------------------------------

test("analyzeChange: minor upgrade with registered breaking changes becomes unsafe", () => {
  const analyzer = new SemverAnalyzer();
  analyzer.registerBreakingChanges("1.0.0", "1.1.0", [
    { category: "api-removed", description: "Function removed", effort: "high" },
  ]);

  const result = analyzer.analyzeChange("1.0.0", "1.1.0");

  assert.equal(result.level, ImpactLevel.MINOR);
  assert.equal(result.isBreaking, true);
  assert.equal(result.isSafe, false);
  assert.equal(result.breakingChanges.length, 1); // one registered breaking change
});
