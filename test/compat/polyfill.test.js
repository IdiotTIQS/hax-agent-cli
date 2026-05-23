"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PolyfillRegistry,
  BUILTIN_POLYFILLS,
} = require("../../src/compat/polyfill");

// -----------------------------------------------------------------------
// Setup helpers
// -----------------------------------------------------------------------

function fresh() {
  return new PolyfillRegistry();
}

// -----------------------------------------------------------------------
// register
// -----------------------------------------------------------------------

test("register adds a polyfill to the registry", () => {
  const reg = fresh();
  reg.register("arrayLast", () => false, () => {});
  assert.equal(reg.size, 1);
  assert.equal(reg.isNeeded("arrayLast"), false);
});

test("register throws on missing feature name", () => {
  const reg = fresh();
  assert.throws(() => reg.register("", () => true, () => {}), /feature/);
  assert.throws(() => reg.register("   ", () => true, () => {}), /feature/);
});

test("register throws on non-function detector", () => {
  const reg = fresh();
  assert.throws(() => reg.register("x", "not-fn", () => {}), /detector/);
});

test("register throws on non-function implementation", () => {
  const reg = fresh();
  assert.throws(() => reg.register("x", () => true, 123), /implementation/);
});

test("register is chainable", () => {
  const reg = fresh();
  const result = reg.register("a", () => true, () => {}).register("b", () => false, () => {});
  assert.equal(result, reg);
  assert.equal(reg.size, 2);
});

// -----------------------------------------------------------------------
// isNeeded
// -----------------------------------------------------------------------

test("isNeeded returns true when detector returns true", () => {
  const reg = fresh();
  reg.register("needed", () => true, () => {});
  assert.equal(reg.isNeeded("needed"), true);
});

test("isNeeded returns false when detector returns false", () => {
  const reg = fresh();
  reg.register("notNeeded", () => false, () => {});
  assert.equal(reg.isNeeded("notNeeded"), false);
});

test("isNeeded treats a throwing detector as needed", () => {
  const reg = fresh();
  reg.register("broken", () => { throw new Error("detect fail"); }, () => {});
  assert.equal(reg.isNeeded("broken"), true);
});

test("isNeeded throws for unregistered feature", () => {
  const reg = fresh();
  assert.throws(() => reg.isNeeded("missing"), /not registered/);
});

// -----------------------------------------------------------------------
// apply
// -----------------------------------------------------------------------

test("apply runs implementation when needed", () => {
  const reg = fresh();
  let called = false;
  reg.register("feat", () => true, () => { called = true; });

  const result = reg.apply("feat");
  assert.equal(result, true);
  assert.equal(called, true);
});

test("apply skips when not needed", () => {
  const reg = fresh();
  let called = false;
  reg.register("feat", () => false, () => { called = true; });

  const result = reg.apply("feat");
  assert.equal(result, false);
  assert.equal(called, false);
});

test("apply is idempotent — does not re-apply", () => {
  const reg = fresh();
  let count = 0;
  reg.register("once", () => true, () => { count++; });

  assert.equal(reg.apply("once"), true);
  assert.equal(reg.apply("once"), true);
  assert.equal(count, 1);
});

test("apply wraps implementation errors", () => {
  const reg = fresh();
  reg.register("err", () => true, () => { throw new Error("impl boom"); });

  assert.throws(() => reg.apply("err"), /Polyfill.*"err".*impl boom/);
});

// -----------------------------------------------------------------------
// applyAll
// -----------------------------------------------------------------------

test("applyAll runs multiple polyfills", () => {
  const reg = fresh();
  const calls = [];
  reg.register("a", () => true, () => calls.push("a"));
  reg.register("b", () => false, () => calls.push("b"));
  reg.register("c", () => true, () => calls.push("c"));

  const result = reg.applyAll(["a", "b", "c"]);
  assert.deepEqual(result.applied, ["a", "c"]);
  assert.deepEqual(result.skipped, ["b"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, ["a", "c"]);
});

test("applyAll with no arguments applies all registered", () => {
  const reg = fresh();
  const calls = [];
  reg.register("x", () => true, () => calls.push("x"));
  reg.register("y", () => true, () => calls.push("y"));

  const result = reg.applyAll();
  assert.deepEqual(result.applied, ["x", "y"]);
  assert.deepEqual(result.skipped, []);
  assert.equal(calls.length, 2);
});

test("applyAll collects errors without stopping", () => {
  const reg = fresh();
  reg.register("ok", () => true, () => {});
  reg.register("bad", () => true, () => { throw new Error("bad impl"); });

  const result = reg.applyAll(["ok", "bad"]);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0], "ok");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].feature, "bad");
});

// -----------------------------------------------------------------------
// list
// -----------------------------------------------------------------------

test("list returns status of all registered polyfills", () => {
  const reg = fresh();
  reg.register("needed", () => true, () => {});
  reg.register("notNeeded", () => false, () => {});

  const lst = reg.list();
  assert.equal(lst.length, 2);

  const needed = lst.find((e) => e.feature === "needed");
  assert.equal(needed.needed, true);
  assert.equal(needed.applied, false);

  const notNeeded = lst.find((e) => e.feature === "notNeeded");
  assert.equal(notNeeded.needed, false);
});

test("list shows applied status after application", () => {
  const reg = fresh();
  reg.register("f", () => true, () => {});
  reg.apply("f");

  const lst = reg.list();
  const entry = lst.find((e) => e.feature === "f");
  assert.equal(entry.applied, true);
});

// -----------------------------------------------------------------------
// reset / resetAll
// -----------------------------------------------------------------------

test("reset clears applied state for a single polyfill", () => {
  const reg = fresh();
  let count = 0;
  reg.register("reapply", () => true, () => { count++; });

  reg.apply("reapply");
  assert.equal(count, 1);

  reg.reset("reapply");
  reg.apply("reapply");
  assert.equal(count, 2);
});

test("resetAll clears all applied states", () => {
  const reg = fresh();
  let a = 0, b = 0;
  reg.register("a", () => true, () => { a++; });
  reg.register("b", () => true, () => { b++; });

  reg.applyAll();
  assert.equal(reg.appliedCount, 2);

  reg.resetAll();
  assert.equal(reg.appliedCount, 0);

  reg.applyAll();
  assert.equal(a, 2);
  assert.equal(b, 2);
});

// -----------------------------------------------------------------------
// onApplied hooks
// -----------------------------------------------------------------------

test("onApplied hook fires after successful application", () => {
  const reg = fresh();
  const fired = [];
  reg.register("h", () => true, () => {});
  reg.onApplied((feature, ok) => fired.push({ feature, ok }));

  reg.apply("h");
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0], { feature: "h", ok: true });
});

test("onApplied hook does not fire for skipped polyfill", () => {
  const reg = fresh();
  const fired = [];
  reg.register("skip", () => false, () => {});
  reg.onApplied((f) => fired.push(f));

  reg.apply("skip");
  assert.equal(fired.length, 0);
});

test("onApplied hook errors are silently swallowed", () => {
  const reg = fresh();
  reg.register("f", () => true, () => {});
  reg.onApplied(() => { throw new Error("hook bug"); });

  // Should not throw
  assert.doesNotThrow(() => reg.apply("f"));
});

// -----------------------------------------------------------------------
// BUILTIN_POLYFILLS
// -----------------------------------------------------------------------

test("BUILTIN_POLYFILLS contains expected features", () => {
  const keys = Object.keys(BUILTIN_POLYFILLS);
  assert.ok(keys.includes("globalThis"));
  assert.ok(keys.includes("structuredClone"));
  assert.ok(keys.includes("abortSignalTimeout"));
  assert.ok(keys.includes("stringReplaceAll"));
  assert.ok(keys.includes("arrayAt"));
  assert.ok(keys.includes("objectHasOwn"));
  assert.ok(keys.includes("cryptoRandomUUID"));
  assert.ok(keys.includes("promiseAllSettled"));
  assert.ok(keys.includes("providerMessagesCompat"));
});

test("BUILTIN_POLYFILLS entries have detector and impl", () => {
  for (const [name, entry] of Object.entries(BUILTIN_POLYFILLS)) {
    assert.ok(typeof entry.detector === "function", `${name} detector`);
    assert.ok(typeof entry.impl === "function", `${name} impl`);
  }
});

test("all BUILTIN_POLYFILLS can be registered and applied without error", () => {
  const reg = fresh();
  for (const [name, { detector, impl }] of Object.entries(BUILTIN_POLYFILLS)) {
    reg.register(name, detector, impl);
  }
  assert.equal(reg.size, Object.keys(BUILTIN_POLYFILLS).length);

  const result = reg.applyAll();
  assert.ok(result.errors.length === 0, `Errors: ${JSON.stringify(result.errors)}`);
  assert.ok(result.applied.length > 0);
});

// -----------------------------------------------------------------------
// appliedCount
// -----------------------------------------------------------------------

test("appliedCount tracks number of applied polyfills", () => {
  const reg = fresh();
  assert.equal(reg.appliedCount, 0);

  reg.register("a", () => true, () => {});
  reg.register("b", () => false, () => {});
  reg.register("c", () => true, () => {});

  reg.apply("a");
  assert.equal(reg.appliedCount, 1);

  reg.apply("b");
  assert.equal(reg.appliedCount, 1); // b was skipped

  reg.apply("c");
  assert.equal(reg.appliedCount, 2);
});
