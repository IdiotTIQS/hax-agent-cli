/**
 * Tests for ConfigApplier: applyDelta, canHotReload, requiresRestart,
 * applySection, rollback, and pending restarts tracking.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ConfigApplier,
  HOT_RELOADABLE,
  RESTART_REQUIRED,
  computeDelta,
} = require("../../src/hotreload/applier");

// ---- canHotReload ----

test("ConfigApplier: canHotReload returns true for hot-reloadable settings", () => {
  const applier = new ConfigApplier();

  assert.equal(applier.canHotReload("ui.theme"), true);
  assert.equal(applier.canHotReload("ui.locale"), true);
  assert.equal(applier.canHotReload("permissions.mode"), true);
  assert.equal(applier.canHotReload("context.enabled"), true);
  assert.equal(applier.canHotReload("context.windowTokens"), true);
  assert.equal(applier.canHotReload("tools.shell.enabled"), true);
  assert.equal(applier.canHotReload("tools.shell.timeoutMs"), true);
  assert.equal(applier.canHotReload("prompts.includeSettings"), true);
  assert.equal(applier.canHotReload("fileContext.maxFiles"), true);
});

test("ConfigApplier: canHotReload returns false for restart-required settings", () => {
  const applier = new ConfigApplier();

  assert.equal(applier.canHotReload("agent.provider"), false);
  assert.equal(applier.canHotReload("agent.model"), false);
  assert.equal(applier.canHotReload("agent.apiKey"), false);
  assert.equal(applier.canHotReload("agent.apiUrl"), false);
  assert.equal(applier.canHotReload("agent.temperature"), false);
});

test("ConfigApplier: canHotReload handles section-level check", () => {
  const applier = new ConfigApplier();

  // "ui" as a section contains hot-reloadable entries => true.
  assert.equal(applier.canHotReload("ui"), true);

  // "agent" as a section contains no hot-reloadable entries => false.
  assert.equal(applier.canHotReload("agent"), false);
});

test("ConfigApplier: canHotReload returns false for empty or invalid input", () => {
  const applier = new ConfigApplier();
  assert.equal(applier.canHotReload(""), false);
  assert.equal(applier.canHotReload(null), false);
  assert.equal(applier.canHotReload(undefined), false);
  assert.equal(applier.canHotReload("non.existent"), false);
});

// ---- applyDelta ----

test("ConfigApplier: applyDelta applies hot-reloadable changes and skips restarts", () => {
  const applier = new ConfigApplier();

  const oldConfig = {
    ui: { theme: "dark", locale: "en" },
    permissions: { mode: "normal" },
    agent: { model: "claude-sonnet-4-20250514", apiKey: "sk-old" },
  };

  const newConfig = {
    ui: { theme: "light", locale: "fr" },
    permissions: { mode: "ask" },
    agent: { model: "claude-opus-4-20250514", apiKey: "sk-new" },
  };

  const result = applier.applyDelta(oldConfig, newConfig);

  // All five changed entries appear as applied or skipped.
  assert.equal(result.applied.length + result.skipped.length, 5);
  assert.ok(result.applied.some((e) => e.path === "ui.theme"));
  assert.ok(result.applied.some((e) => e.path === "ui.locale"));
  assert.ok(result.applied.some((e) => e.path === "permissions.mode"));

  // Agent changes should be skipped.
  assert.ok(result.skipped.some((e) => e.path === "agent.model"));
  assert.ok(result.skipped.some((e) => e.path === "agent.apiKey"));

  assert.equal(result.requiresRestart, true);
});

test("ConfigApplier: applyDelta returns requiresRestart: false when no restart settings change", () => {
  const applier = new ConfigApplier();

  const oldConfig = { ui: { theme: "dark" }, tools: { shell: { timeoutMs: 10000 } } };
  const newConfig = { ui: { theme: "light" }, tools: { shell: { timeoutMs: 20000 } } };

  const result = applier.applyDelta(oldConfig, newConfig);

  assert.equal(result.requiresRestart, false);
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
});

test("ConfigApplier: applyDelta handles new sections added in newConfig", () => {
  const applier = new ConfigApplier();

  const oldConfig = { ui: { theme: "dark" } };
  const newConfig = { ui: { theme: "dark" }, permissions: { mode: "auto" } };

  const result = applier.applyDelta(oldConfig, newConfig);

  assert.equal(result.requiresRestart, false);
  assert.ok(result.applied.some((e) => e.path === "permissions.mode"));
});

test("ConfigApplier: applyDelta tracks pending restarts across multiple calls", () => {
  const applier = new ConfigApplier();

  applier.applyDelta(
    { agent: { model: "gpt-4" } },
    { agent: { model: "gpt-4o" } },
  );

  applier.applyDelta(
    { agent: { apiKey: "old" } },
    { agent: { apiKey: "new" } },
  );

  const pending = applier.pendingRestarts();
  assert.ok(pending.includes("agent.model"));
  assert.ok(pending.includes("agent.apiKey"));
  // Should be deduplicated across calls if the same key appears again.
  assert.equal(pending.length, 2);
});

// ---- requiresRestart ----

test("ConfigApplier: requiresRestart returns restart-required paths from settings", () => {
  const applier = new ConfigApplier();

  const paths = applier.requiresRestart({
    agent: { provider: "openai", model: "gpt-4", apiKey: "sk-abc" },
    ui: { theme: "light" },
  });

  assert.ok(paths.includes("agent.provider"));
  assert.ok(paths.includes("agent.model"));
  assert.ok(paths.includes("agent.apiKey"));
  assert.equal(paths.includes("ui.theme"), false);
});

test("ConfigApplier: requiresRestart returns empty array for no restart settings", () => {
  const applier = new ConfigApplier();

  const paths = applier.requiresRestart({
    ui: { theme: "dark" },
    permissions: { mode: "normal" },
  });

  assert.deepEqual(paths, []);
});

// ---- applySection ----

test("ConfigApplier: applySection applies nested section deltas", () => {
  const applier = new ConfigApplier();

  const oldVal = { theme: "dark", locale: "en" };
  const newVal = { theme: "light", locale: "fr" };

  applier.applySection("ui", oldVal, newVal);

  assert.equal(applier._applied.length, 2);
  assert.ok(applier._applied.some((e) => e.path === "ui.theme"));
  assert.ok(applier._applied.some((e) => e.path === "ui.locale"));
});

test("ConfigApplier: applySection skips non-hot-reloadable entries within section", () => {
  const applier = new ConfigApplier();

  const oldVal = { provider: "anthropic", model: "claude-sonnet-4-20250514" };
  const newVal = { provider: "openai", model: "gpt-4" };

  applier.applySection("agent", oldVal, newVal);

  // agent.* settings are not hot-reloadable, so nothing should be applied.
  assert.equal(applier._applied.length, 0);
});

test("ConfigApplier: applySection throws for empty section", () => {
  const applier = new ConfigApplier();
  assert.throws(() => applier.applySection("", {}, {}), { message: /non-empty string/ });
  assert.throws(() => applier.applySection(null, {}, {}), { message: /non-empty string/ });
});

// ---- rollback ----

test("ConfigApplier: rollback reverts the last applied entry", () => {
  const rollbackLog = [];
  const applier = new ConfigApplier({
    rollbackFn: (path, oldVal) => rollbackLog.push({ path, oldVal }),
  });

  applier._applied = [
    { path: "ui.theme", oldVal: "dark", newVal: "light" },
    { path: "permissions.mode", oldVal: "normal", newVal: "ask" },
  ];

  applier.rollback();

  assert.deepEqual(rollbackLog, [{ path: "permissions.mode", oldVal: "normal" }]);
  assert.equal(applier._applied.length, 1);
});

test("ConfigApplier: rollback with specific setting reverts only that entry", () => {
  const rollbackLog = [];
  const applier = new ConfigApplier({
    rollbackFn: (path, oldVal) => rollbackLog.push({ path, oldVal }),
  });

  applier._applied = [
    { path: "ui.theme", oldVal: "dark", newVal: "light" },
    { path: "ui.locale", oldVal: "en", newVal: "fr" },
    { path: "permissions.mode", oldVal: "normal", newVal: "ask" },
  ];

  applier.rollback("ui.theme");

  assert.deepEqual(rollbackLog, [{ path: "ui.theme", oldVal: "dark" }]);
  assert.equal(applier._applied.length, 2);
});

test("ConfigApplier: rollback is a no-op when applied list is empty", () => {
  const rollbackLog = [];
  const applier = new ConfigApplier({
    rollbackFn: (path, oldVal) => rollbackLog.push({ path, oldVal }),
  });

  // Should not throw.
  applier.rollback();
  assert.deepEqual(rollbackLog, []);
});

test("ConfigApplier: rollback is a no-op when setting not found", () => {
  const applier = new ConfigApplier();
  applier._applied = [{ path: "ui.theme", oldVal: "dark", newVal: "light" }];

  // Should not throw.
  applier.rollback("nonexistent.setting");
  assert.equal(applier._applied.length, 1);
});

// ---- computeDelta helper ----

test("computeDelta: detects top-level primitive changes", () => {
  const oldCfg = { theme: "dark", locale: "en" };
  const newCfg = { theme: "light", locale: "en" };

  const diff = computeDelta(oldCfg, newCfg);
  assert.equal(diff.length, 1);
  assert.deepEqual(diff[0], { path: "theme", oldVal: "dark", newVal: "light" });
});

test("computeDelta: detects nested object changes", () => {
  const oldCfg = { ui: { theme: "dark", locale: "en" } };
  const newCfg = { ui: { theme: "light", locale: "en" } };

  const diff = computeDelta(oldCfg, newCfg);
  assert.equal(diff.length, 1);
  assert.deepEqual(diff[0], { path: "ui.theme", oldVal: "dark", newVal: "light" });
});

test("computeDelta: detects added and removed keys", () => {
  const oldCfg = { a: 1, b: 2 };
  const newCfg = { b: 2, c: 3 };

  const diff = computeDelta(oldCfg, newCfg);
  assert.equal(diff.length, 2);
  assert.ok(diff.some((d) => d.path === "a" && d.oldVal === 1 && d.newVal === undefined));
  assert.ok(diff.some((d) => d.path === "c" && d.oldVal === undefined && d.newVal === 3));
});

test("computeDelta: returns empty for identical configs", () => {
  const cfg = { ui: { theme: "dark" }, agent: { model: "claude" } };
  const diff = computeDelta(cfg, cfg);
  assert.equal(diff.length, 0);
});
