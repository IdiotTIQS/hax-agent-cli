/**
 * Tests for ConfigNotifier: notifyChanges, subscribe, broadcast,
 * getChangeLog, wildcard handlers, and valid component enforcement.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ConfigNotifier, VALID_COMPONENTS } = require("../../src/hotreload/notifier");

// ---- Construction ----

test("ConfigNotifier: constructs with empty state", () => {
  const n = new ConfigNotifier();
  assert.equal(n._subscribers.size, 0);
  assert.equal(n._wildcardHandlers.length, 0);
  assert.deepEqual(n._changeLog, []);
});

// ---- subscribe ----

test("ConfigNotifier: subscribe registers a component handler for a section", () => {
  const n = new ConfigNotifier();
  n.subscribe("renderer", () => {}, "ui");

  const subs = n._subscribers.get("ui");
  assert.ok(subs);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].component, "renderer");
  assert.equal(typeof subs[0].handler, "function");
});

test("ConfigNotifier: subscribe without section registers wildcard handler", () => {
  const n = new ConfigNotifier();
  const handler = () => {};
  n.subscribe("session", handler);

  assert.equal(n._wildcardHandlers.length, 1);
  assert.equal(n._wildcardHandlers[0], handler);
});

test("ConfigNotifier: subscribe throws for unknown component", () => {
  const n = new ConfigNotifier();
  assert.throws(() => n.subscribe("invalidComponent", () => {}), {
    message: /Unknown component/,
  });
});

test("ConfigNotifier: subscribe throws for non-function handler", () => {
  const n = new ConfigNotifier();
  assert.throws(() => n.subscribe("renderer", "not-a-fn", "ui"), {
    message: /must be a function/,
  });
});

test("ConfigNotifier: subscribe accepts all valid components", () => {
  const n = new ConfigNotifier();
  for (const comp of VALID_COMPONENTS) {
    n.subscribe(comp, () => {}, "ui");
  }
  const subs = n._subscribers.get("ui");
  assert.equal(subs.length, VALID_COMPONENTS.size);
});

// ---- notifyChanges ----

test("ConfigNotifier: notifyChanges broadcasts to section-specific subscribers", () => {
  const n = new ConfigNotifier();
  const calls = [];

  n.subscribe("renderer", (section, oldVal, newVal, ts) => {
    calls.push({ section, oldVal, newVal, ts });
  }, "ui");

  n.notifyChanges([
    { section: "ui", oldVal: { theme: "dark" }, newVal: { theme: "light" } },
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].section, "ui");
  assert.deepEqual(calls[0].oldVal, { theme: "dark" });
  assert.deepEqual(calls[0].newVal, { theme: "light" });
  assert.ok(typeof calls[0].ts === "string");
});

test("ConfigNotifier: notifyChanges calls wildcard handlers for every change", () => {
  const n = new ConfigNotifier();
  const wildcardCalls = [];

  n.subscribe("session", (changes, ts) => {
    wildcardCalls.push({ changes, ts });
  });

  n.notifyChanges([
    { section: "ui", oldVal: "dark", newVal: "light" },
    { section: "permissions", oldVal: "normal", newVal: "ask" },
  ]);

  assert.equal(wildcardCalls.length, 1);
  assert.equal(wildcardCalls[0].changes.length, 2);
  assert.ok(typeof wildcardCalls[0].ts === "string");
});

test("ConfigNotifier: notifyChanges records entries in change log", () => {
  const n = new ConfigNotifier();

  n.notifyChanges([
    { section: "ui", oldVal: "dark", newVal: "light" },
  ]);

  n.notifyChanges([
    { section: "permissions", oldVal: "normal", newVal: "auto" },
  ]);

  const log = n.getChangeLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].changes[0].section, "ui");
  assert.equal(log[1].changes[0].section, "permissions");
  assert.ok(typeof log[0].timestamp === "string");
});

test("ConfigNotifier: notifyChanges skips entries without valid section", () => {
  const n = new ConfigNotifier();

  n.notifyChanges([
    { oldVal: 1, newVal: 2 },               // no section
    { section: "", oldVal: 1, newVal: 2 },   // empty section
    { section: "ui", oldVal: "a", newVal: "b" },
  ]);

  const log = n.getChangeLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].changes.length, 1);
  assert.equal(log[0].changes[0].section, "ui");
});

test("ConfigNotifier: notifyChanges throws for non-array input", () => {
  const n = new ConfigNotifier();
  assert.throws(() => n.notifyChanges("not-an-array"), { message: /must be an array/ });
});

// ---- broadcast ----

test("ConfigNotifier: broadcast sends to matching section subscribers only", () => {
  const n = new ConfigNotifier();
  const uiCalls = [];
  const permCalls = [];

  n.subscribe("renderer", (s, oldV, newV) => uiCalls.push({ s, oldV, newV }), "ui");
  n.subscribe("permissionManager", (s, oldV, newV) => permCalls.push({ s, oldV, newV }), "permissions");

  n.broadcast("ui", "dark", "light");

  assert.equal(uiCalls.length, 1);
  assert.equal(permCalls.length, 0);
});

test("ConfigNotifier: broadcast does not throw when no subscribers exist", () => {
  const n = new ConfigNotifier();
  // Should not throw.
  n.broadcast("nonexistent", 1, 2);
});

// ---- getChangeLog ----

test("ConfigNotifier: getChangeLog supports since filter", () => {
  const n = new ConfigNotifier();

  // Populate change log with deterministic timestamps.
  n._changeLog = [
    { timestamp: "2026-01-01T00:00:00.000Z", changes: [{ section: "ui", oldVal: "dark", newVal: "light" }] },
    { timestamp: "2026-06-01T00:00:00.000Z", changes: [{ section: "permissions", oldVal: "normal", newVal: "auto" }] },
    { timestamp: "2026-12-01T00:00:00.000Z", changes: [{ section: "tools", oldVal: "a", newVal: "b" }] },
  ];

  const filtered = n.getChangeLog({ since: "2026-06-01T00:00:00.000Z" });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].changes[0].section, "permissions");
  assert.equal(filtered[1].changes[0].section, "tools");
});

test("ConfigNotifier: getChangeLog supports limit", () => {
  const n = new ConfigNotifier();

  for (const ch of [
    { section: "ui", oldVal: 1, newVal: 2 },
    { section: "ui", oldVal: 2, newVal: 3 },
    { section: "ui", oldVal: 3, newVal: 4 },
    { section: "permissions", oldVal: "a", newVal: "b" },
    { section: "permissions", oldVal: "b", newVal: "c" },
  ]) {
    n.notifyChanges([ch]);
  }

  const limited = n.getChangeLog({ limit: 3 });
  assert.equal(limited.length, 3);
  // Most recent first (slice from end).
  assert.equal(limited[2].changes[0].section, "permissions");
});

// ---- reset ----

test("ConfigNotifier: reset clears subscribers and change log", () => {
  const n = new ConfigNotifier();

  n.subscribe("renderer", () => {}, "ui");
  n.subscribe("session", () => {});
  n.notifyChanges([{ section: "ui", oldVal: "a", newVal: "b" }]);

  assert.ok(n._subscribers.size > 0);
  assert.ok(n._changeLog.length > 0);

  n.reset();

  assert.equal(n._subscribers.size, 0);
  assert.equal(n._wildcardHandlers.length, 0);
  assert.equal(n._changeLog.length, 0);
});

// ---- Handler errors do not propagate ----

test("ConfigNotifier: handler errors do not prevent other handlers from firing", () => {
  const n = new ConfigNotifier();
  const goodCalls = [];

  n.subscribe("renderer", () => { throw new Error("boom"); }, "ui");
  n.subscribe("toolRegistry", (s, oldV, newV) => goodCalls.push({ s, oldV, newV }), "ui");

  // Should not throw.
  n.notifyChanges([{ section: "ui", oldVal: "a", newVal: "b" }]);

  assert.equal(goodCalls.length, 1);
  assert.equal(goodCalls[0].s, "ui");
});

// ---- Multiple sections in one notifyChanges ----

test("ConfigNotifier: multiple sections fire respective handlers correctly", () => {
  const n = new ConfigNotifier();
  const uiCalls = [];
  const permCalls = [];
  const toolCalls = [];

  n.subscribe("renderer", (s, o, nv) => uiCalls.push({ s, o, nv }), "ui");
  n.subscribe("permissionManager", (s, o, nv) => permCalls.push({ s, o, nv }), "permissions");
  n.subscribe("toolRegistry", (s, o, nv) => toolCalls.push({ s, o, nv }), "tools");

  n.notifyChanges([
    { section: "ui", oldVal: "dark", newVal: "light" },
    { section: "permissions", oldVal: "normal", newVal: "auto" },
  ]);

  assert.equal(uiCalls.length, 1);
  assert.equal(permCalls.length, 1);
  assert.equal(toolCalls.length, 0);
});
