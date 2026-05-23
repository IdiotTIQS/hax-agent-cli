"use strict";

/**
 * Tests for the SelfTest agent self-testing framework.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { SelfTest, TEST_CATEGORIES, CATEGORY_WEIGHTS } = require("../../src/testing/selftest");
const { createMockProvider, createMockToolRegistry, createMockTool } = require("../../test-helpers/mocks");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock tool registry for self-testing.
 */
function makeMockToolRegistry(toolNames = []) {
  const tools = toolNames.map((name) =>
    createMockTool({ name, description: `${name} tool`, result: { ok: true } })
  );
  return createMockToolRegistry(tools);
}

/**
 * Create a minimal memory API object (not backed by filesystem).
 */
function makeMockMemoryApi() {
  const store = new Map();

  return {
    writeMemory(name, content) {
      store.set(name, { name, content, timestamp: new Date().toISOString() });
    },
    readMemory(name) {
      return store.get(name) || null;
    },
    listMemories() {
      return Array.from(store.values());
    },
    deleteMemory(name) {
      return store.delete(name);
    },
    searchMemories(query) {
      const lower = String(query).toLowerCase();
      const results = [];
      for (const [name, entry] of store) {
        if (name.toLowerCase().includes(lower) || String(entry.content).toLowerCase().includes(lower)) {
          results.push({ ...entry, score: 0.8 });
        }
      }
      return results;
    },
  };
}

/**
 * Minimal mock plugin registry.
 */
function makeMockPluginRegistry() {
  const plugins = [];
  const hooks = new Map([
    ["beforeToolCall", []],
    ["afterToolCall", []],
    ["onError", []],
    ["beforeChat", []],
    ["afterChat", []],
    ["onSessionStart", []],
    ["onSessionEnd", []],
  ]);

  return {
    register(plugin) {
      if (!plugin || typeof plugin !== "object") throw new Error("Plugin must be an object");
      if (!plugin.name || !String(plugin.name).trim()) throw new Error("Plugin must have a non-empty name");
      if (plugins.some((p) => p.name === plugin.name)) throw new Error(`Plugin "${plugin.name}" is already registered`);
      const entry = { name: plugin.name, version: plugin.version || "0.0.0", hooks: plugin.hooks || {} };
      plugins.push(entry);
      if (plugin.hooks) {
        for (const [hookName, fn] of Object.entries(plugin.hooks)) {
          if (hooks.has(hookName) && typeof fn === "function") {
            hooks.get(hookName).push({ plugin: entry.name, fn });
          }
        }
      }
      return entry;
    },
    unregister(name) {
      const idx = plugins.findIndex((p) => p.name === name);
      if (idx === -1) return false;
      plugins.splice(idx, 1);
      for (const [, handlers] of hooks) {
        for (let i = handlers.length - 1; i >= 0; i--) {
          if (handlers[i].plugin === name) handlers.splice(i, 1);
        }
      }
      return true;
    },
    list() {
      return plugins.map((p) => ({ name: p.name, version: p.version, hooks: Object.keys(p.hooks) }));
    },
    async runHook(hookName, context = {}) {
      const handlers = hooks.get(hookName) || [];
      let ctx = { ...context };
      for (const { fn } of handlers) {
        try {
          const result = await fn(ctx);
          if (result !== undefined && result !== null) ctx = result;
        } catch (_) { /* isolate */ }
      }
      return ctx;
    },
    getHookCount() {
      let count = 0;
      for (const h of hooks.values()) count += h.length;
      return count;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("SelfTest: constructor creates instance with defaults", () => {
  const st = new SelfTest();
  assert.ok(st instanceof SelfTest);
  assert.equal(st._timeoutMs, 5000);
  assert.equal(st._registry.size, 0);
  assert.equal(st._results.size, 0);
  assert.equal(st._lastRunAt, null);
  assert.equal(st._totalDurationMs, 0);
});

test("SelfTest: constructor accepts custom timeout", () => {
  const st = new SelfTest({ timeoutMs: 1000 });
  assert.equal(st._timeoutMs, 1000);
});

test("SelfTest: testTools registers tool checks", () => {
  const st = new SelfTest();
  const reg = makeMockToolRegistry(["tool.alpha", "tool.beta"]);

  st.testTools(reg, { expectedTools: ["tool.alpha", "tool.beta"] });

  const checks = st._registry.get("tools");
  assert.ok(Array.isArray(checks));
  assert.ok(checks.length >= 3, `Expected >=3 checks, got ${checks.length}`);
  assert.equal(checks[0].name, "tools:registry-exists");
});

test("SelfTest: testTools with exercise option registers execute check", () => {
  const st = new SelfTest();
  const reg = makeMockToolRegistry(["tool.exercise"]);

  st.testTools(reg, {
    expectedTools: ["tool.exercise"],
    exercise: { name: "tool.exercise", args: { input: "test" } },
  });

  const checks = st._registry.get("tools");
  const exerciseCheck = checks.find((c) => c.name.startsWith("tools:execute-"));
  assert.ok(exerciseCheck, "Expected an execute check when exercise option is provided");
});

test("SelfTest: testProviders registers provider checks", () => {
  const st = new SelfTest();
  const provider = createMockProvider({ name: "test-provider", model: "test-model", response: "pong" });

  st.testProviders(provider);

  const checks = st._registry.get("providers");
  assert.ok(Array.isArray(checks));
  assert.ok(checks.length >= 4, `Expected >=4 checks, got ${checks.length}`);
  assert.equal(checks[0].name, "providers:exists");
});

test("SelfTest: testMemory registers memory checks", () => {
  const st = new SelfTest();
  const mem = makeMockMemoryApi();

  st.testMemory(mem);

  const checks = st._registry.get("memory");
  assert.ok(Array.isArray(checks));
  assert.equal(checks.length, 5);
  const names = checks.map((c) => c.name);
  assert.deepEqual(names, [
    "memory:api-exists",
    "memory:write",
    "memory:read",
    "memory:list",
    "memory:delete",
  ]);
});

test("SelfTest: testPlugins registers plugin checks", () => {
  const st = new SelfTest();
  const reg = makeMockPluginRegistry();

  st.testPlugins(reg);

  const checks = st._registry.get("plugins");
  assert.ok(Array.isArray(checks));
  assert.equal(checks.length, 5);
  const names = checks.map((c) => c.name);
  assert.deepEqual(names, [
    "plugins:registry-exists",
    "plugins:list",
    "plugins:register",
    "plugins:hook-execution",
    "plugins:unregister",
  ]);
});

test("SelfTest: testAll runs all registered checks and returns report", async () => {
  const st = new SelfTest();

  const reg = makeMockToolRegistry(["tool.one", "tool.two"]);
  const provider = createMockProvider({ name: "test-provider", model: "test-model", response: "pong" });
  const mem = makeMockMemoryApi();
  const plugins = makeMockPluginRegistry();

  st.testTools(reg, { expectedTools: ["tool.one"] });
  st.testProviders(provider);
  st.testMemory(mem);
  st.testPlugins(plugins);

  const report = await st.testAll();

  assert.ok(typeof report.timestamp === "string");
  assert.ok(report.totalTests > 0);
  assert.ok(report.passed > 0, `Expected some passed tests, got ${report.passed}`);
  assert.equal(report.failed, 0);
  assert.equal(report.skipped, 0);
  assert.ok(typeof report.healthScore === "number");
  assert.ok(report.healthScore >= 0 && report.healthScore <= 100);
  assert.ok(typeof report.totalDurationMs === "number");
  assert.ok(report.categories.tools.tests.length > 0);
  assert.ok(report.categories.providers.tests.length > 0);
  assert.ok(report.categories.memory.tests.length > 0);
  assert.ok(report.categories.plugins.tests.length > 0);
});

test("SelfTest: getHealthScore returns 0 when no tests have been run", () => {
  const st = new SelfTest();
  assert.equal(st.getHealthScore(), 0);
});

test("SelfTest: getHealthScore returns 100 when all tests pass", async () => {
  const st = new SelfTest();
  const mem = makeMockMemoryApi();
  st.testMemory(mem);
  await st.testAll();
  assert.equal(st.getHealthScore(), 100);
});

test("SelfTest: getHealthScore penalizes failed categories", async () => {
  const st = new SelfTest();

  // Use a faulty memory API that will fail
  const faultyMem = {
    writeMemory() { throw new Error("Write failed"); },
    readMemory() { throw new Error("Read failed"); },
    listMemories() { throw new Error("List failed"); },
    deleteMemory() { throw new Error("Delete failed"); },
  };

  // Use a working tool registry
  const reg = makeMockToolRegistry(["tool.ok"]);
  st.testTools(reg);
  st.testMemory(faultyMem);

  await st.testAll();

  // tools should pass, memory should fail
  const score = st.getHealthScore();
  assert.ok(score < 100, `Expected healthScore < 100, got ${score}`);
  assert.ok(score > 0, `Expected healthScore > 0, got ${score}`);

  const report = st.getReport();
  assert.ok(report.categories.tools.failed === 0);
  assert.ok(report.categories.memory.failed > 0);
});

test("SelfTest: getReport reflects correct pass/fail/skip counts", async () => {
  const st = new SelfTest();
  const mem = makeMockMemoryApi();
  st.testMemory(mem);

  // Run and check a single category
  await st.testAll();

  const report = st.getReport();
  assert.ok(report.categories.memory.tests.length === 5);
  assert.ok(report.totalTests >= 5);
  assert.equal(report.categories.memory.failed, 0);
});

test("SelfTest: reset clears all state", async () => {
  const st = new SelfTest();
  const mem = makeMockMemoryApi();
  st.testMemory(mem);
  await st.testAll();

  assert.ok(st._results.size > 0);
  assert.ok(st._lastRunAt !== null);

  st.reset();

  assert.equal(st._registry.size, 0);
  assert.equal(st._results.size, 0);
  assert.equal(st._lastRunAt, null);
  assert.equal(st._totalDurationMs, 0);
  assert.equal(st.getHealthScore(), 0);
});

test("SelfTest: convenience methods chain correctly", () => {
  const st = new SelfTest();
  const reg = makeMockToolRegistry(["tool.a"]);
  const provider = createMockProvider({ name: "p", model: "m", response: "ok" });
  const mem = makeMockMemoryApi();
  const plugins = makeMockPluginRegistry();

  const returned = st
    .setToolRegistry(reg)
    .setProvider(provider)
    .setMemoryApi(mem)
    .setPluginRegistry(plugins);

  assert.strictEqual(returned, st);
  assert.equal(st._registry.size, 4);
});

test("SelfTest: TEST_CATEGORIES and CATEGORY_WEIGHTS are frozen", () => {
  assert.ok(Object.isFrozen(TEST_CATEGORIES));
  assert.ok(Object.isFrozen(CATEGORY_WEIGHTS));
  assert.ok(TEST_CATEGORIES.includes("tools"));
  assert.ok(TEST_CATEGORIES.includes("providers"));
  assert.ok(TEST_CATEGORIES.includes("memory"));
  assert.ok(TEST_CATEGORIES.includes("plugins"));
  assert.ok(typeof CATEGORY_WEIGHTS.tools === "number");
});

test("SelfTest: testTools handles missing registry gracefully", async () => {
  const st = new SelfTest();
  st.testTools(null);

  const checks = st._registry.get("tools");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].name, "tools:registry-exists");

  await st.testAll();
  const report = st.getReport();
  assert.equal(report.categories.tools.failed, 1);
});

test("SelfTest: testMemory handles missing API functions gracefully", async () => {
  const st = new SelfTest();
  st.testMemory({}); // Empty object, no functions

  await st.testAll();
  const report = st.getReport();
  // api-exists passes ({} is an object), the other 4 fail
  assert.equal(report.categories.memory.failed, 4);
  assert.equal(report.categories.memory.passed, 1);
  // Health score should be 0 for this category (0/4 non-skip tests passed)
  assert.ok(st.getHealthScore() < 50);
});
