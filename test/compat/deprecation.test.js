"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeprecationManager,
  LEVELS,
} = require("../../src/compat/deprecation");

// -----------------------------------------------------------------------
// Setup helper
// -----------------------------------------------------------------------

function fresh(clk) {
  return new DeprecationManager({ clock: clk || (() => 0) });
}

// -----------------------------------------------------------------------
// deprecate / isDeprecated
// -----------------------------------------------------------------------

test("deprecate registers an API path (SOFT by default)", () => {
  const mgr = fresh();
  mgr.deprecate("tools.oldSearch", "2.0.0");
  assert.equal(mgr.isDeprecated("tools.oldSearch"), true);
  assert.equal(mgr.isDeprecated("tools.newSearch"), false);
});

test("deprecate carries all metadata", () => {
  const clk = () => 1710000000000;
  const mgr = new DeprecationManager({ clock: clk });
  mgr.deprecate("api.v1.login", "3.0.0", "api.v2.auth", "Use new auth flow", "HARD");
  const info = mgr.getDeprecationInfo("api.v1.login");
  assert.equal(info.apiPath, "api.v1.login");
  assert.equal(info.version, "3.0.0");
  assert.equal(info.replacement, "api.v2.auth");
  assert.equal(info.message, "Use new auth flow");
  assert.equal(info.level, LEVELS.HARD);
  assert.equal(info.deprecatedAt, 1710000000000);
});

test("getDeprecationInfo returns null for unknown path", () => {
  const mgr = fresh();
  assert.equal(mgr.getDeprecationInfo("nonexistent"), null);
});

// -----------------------------------------------------------------------
// warn
// -----------------------------------------------------------------------

test("warn returns false for unknown path", () => {
  const mgr = fresh();
  assert.equal(mgr.warn("nope"), false);
});

test("warn throws for REMOVED level", () => {
  const mgr = fresh();
  mgr.deprecate("old.fn", "3.0.0", "new.fn", "Gone", "REMOVED");
  assert.throws(
    () => mgr.warn("old.fn"),
    /DEPRECATION.*REMOVED.*"new\.fn"/,
  );
});

test("warn returns true for HARD level and does not throw", () => {
  const mgr = fresh();
  mgr.deprecate("api.old", "2.0.0", "api.new", "Pls migrate", "HARD");

  // Capture console.warn
  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(msg);

  const result = mgr.warn("api.old");
  console.warn = orig;

  assert.equal(result, true);
  assert.ok(warnings.length >= 1);
  assert.ok(warnings[0].includes("api.old"));
  assert.ok(warnings[0].includes("HARD"));
});

test("warn is silent for SOFT level", () => {
  const mgr = fresh();
  mgr.deprecate("soft.api", "2.1.0", "new.api", null, "SOFT");

  const warnings = [];
  const orig = console.warn;
  console.warn = (msg) => warnings.push(msg);

  const result = mgr.warn("soft.api");
  console.warn = orig;

  assert.equal(result, true);
  assert.equal(warnings.length, 0);
});

test("warn fires onWarn callback for HARD level", () => {
  let captured = null;
  const mgr = new DeprecationManager({
    onWarn: (info) => { captured = info; },
  });
  mgr.deprecate("cb.api", "2.5.0", "cb.new", null, "HARD");

  // Suppress console.warn
  const orig = console.warn;
  console.warn = () => {};
  mgr.warn("cb.api");
  console.warn = orig;

  assert.ok(captured !== null);
  assert.equal(captured.apiPath, "cb.api");
  assert.equal(captured.level, "HARD");
});

test("warn merges context into onWarn payload", () => {
  let captured = null;
  const mgr = new DeprecationManager({
    onWarn: (info) => { captured = info; },
  });
  mgr.deprecate("ctx.api", "3.0.0", null, null, "HARD");

  // Suppress console.warn
  const orig = console.warn;
  console.warn = () => {};
  mgr.warn("ctx.api", { caller: "myModule", line: 42 });
  console.warn = orig;

  assert.equal(captured.caller, "myModule");
  assert.equal(captured.line, 42);
});

// -----------------------------------------------------------------------
// getAllDeprecated
// -----------------------------------------------------------------------

test("getAllDeprecated returns all entries", () => {
  const mgr = fresh();
  mgr.deprecate("a.one", "1.0.0", null, null, "SOFT");
  mgr.deprecate("a.two", "2.0.0", null, null, "HARD");
  mgr.deprecate("a.three", "3.0.0", null, null, "REMOVED");

  const all = mgr.getAllDeprecated();
  assert.equal(all.length, 3);
  assert.equal(mgr.size, 3);
});

test("getAllDeprecated filters by level", () => {
  const mgr = fresh();
  mgr.deprecate("a.one", "1.0.0", null, null, "SOFT");
  mgr.deprecate("a.two", "2.0.0", null, null, "HARD");
  mgr.deprecate("a.three", "3.0.0", null, null, "REMOVED");

  const hard = mgr.getAllDeprecated("HARD");
  assert.equal(hard.length, 1);
  assert.equal(hard[0].apiPath, "a.two");

  const soft = mgr.getAllDeprecated("soft");
  assert.equal(soft.length, 1);
  assert.equal(soft[0].apiPath, "a.one");
});

// -----------------------------------------------------------------------
// getDeprecationSchedule
// -----------------------------------------------------------------------

test("getDeprecationSchedule returns timeline sorted by version", () => {
  const mgr = fresh();
  mgr.deprecate("c", "3.0.0", null, null, "SOFT");
  mgr.deprecate("a", "1.0.0", null, null, "HARD");
  mgr.deprecate("b", "2.0.0", null, null, "SOFT");
  mgr.deprecate("d-removed", "4.0.0", null, null, "REMOVED");

  const schedule = mgr.getDeprecationSchedule();
  assert.equal(schedule.length, 3); // REMOVED is excluded

  assert.equal(schedule[0].version, "1.0.0");
  assert.equal(schedule[0].apis.length, 1);
  assert.equal(schedule[0].apis[0].apiPath, "a");

  assert.equal(schedule[1].version, "2.0.0");
  assert.equal(schedule[2].version, "3.0.0");
});

test("getDeprecationSchedule groups multiple APIs under the same version", () => {
  const mgr = fresh();
  mgr.deprecate("x.one", "2.0.0");
  mgr.deprecate("x.two", "2.0.0");

  const schedule = mgr.getDeprecationSchedule();
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].apis.length, 2);
});

// -----------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------

test("deprecate throws on empty apiPath", () => {
  const mgr = fresh();
  assert.throws(() => mgr.deprecate("", "1.0.0"), /apiPath/);
  assert.throws(() => mgr.deprecate("   ", "1.0.0"), /apiPath/);
});

test("deprecate throws on empty version", () => {
  const mgr = fresh();
  assert.throws(() => mgr.deprecate("x", ""), /version/);
});

test("deprecate is chainable", () => {
  const mgr = fresh();
  const result = mgr.deprecate("a", "1.0.0").deprecate("b", "2.0.0");
  assert.equal(result, mgr);
  assert.equal(mgr.size, 2);
});

test("unDeprecate removes a registered entry", () => {
  const mgr = fresh();
  mgr.deprecate("toremove", "1.0.0");
  assert.equal(mgr.isDeprecated("toremove"), true);

  const removed = mgr.unDeprecate("toremove");
  assert.equal(removed, true);
  assert.equal(mgr.isDeprecated("toremove"), false);
});

test("unDeprecate returns false for unknown path", () => {
  const mgr = fresh();
  assert.equal(mgr.unDeprecate("nope"), false);
});

test("SOFT is the default level when none specified", () => {
  const mgr = fresh();
  mgr.deprecate("x", "1.0.0");
  assert.equal(mgr.getDeprecationInfo("x").level, LEVELS.SOFT);
});

test("unknown level throws", () => {
  const mgr = fresh();
  assert.throws(() => mgr.deprecate("x", "1.0.0", null, null, "SUPER_HARD"), /Unknown.*level/);
});

test("LEVELS export is frozen and contains expected values", () => {
  assert.equal(LEVELS.SOFT, "SOFT");
  assert.equal(LEVELS.HARD, "HARD");
  assert.equal(LEVELS.REMOVED, "REMOVED");
  assert.equal(Object.keys(LEVELS).length, 3);
});

test("size reflects registered entries", () => {
  const mgr = fresh();
  assert.equal(mgr.size, 0);
  mgr.deprecate("a", "1.0.0");
  assert.equal(mgr.size, 1);
  mgr.deprecate("a", "2.0.0"); // overwrite
  assert.equal(mgr.size, 1);
  mgr.deprecate("b", "2.0.0");
  assert.equal(mgr.size, 2);
});
