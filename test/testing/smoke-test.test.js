"use strict";

/**
 * Tests for the SmokeTest quick smoke-testing framework.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  SmokeTest,
  QUICK_TESTS,
  STANDARD_TESTS,
  FULL_TESTS,
  CRITICAL_TESTS,
} = require("../../src/testing/smoke-test");

const {
  createMockProvider,
  createMockToolRegistry,
  createMockSettings,
  createMockSession,
} = require("../../test-helpers/mocks");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fully-featured mock tool registry for smoke tests.
 * Supports register, has, get, execute, and list.
 */
function makeFullMockRegistry() {
  const tools = new Map();

  return {
    register(tool) {
      if (!tool || !tool.name) throw new Error("Tool name required");
      if (tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered.`);
      tools.set(tool.name, tool);
      return this;
    },
    has(name) {
      return tools.has(name);
    },
    get(name) {
      return tools.get(name) || null;
    },
    async execute(name, args, context) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool "${name}" is not registered.`);
      return tool.execute(args, context);
    },
    list() {
      return Array.from(tools.values(), (t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || null,
      }));
    },
  };
}

/**
 * In-memory memory API.
 */
function makeMockMemApi() {
  const store = new Map();
  return {
    writeMemory(name, content) { store.set(name, { name, content }); },
    readMemory(name) { return store.get(name) || null; },
    listMemories() { return Array.from(store.values()); },
    searchMemories(query) {
      const lower = String(query).toLowerCase();
      return Array.from(store.values()).filter(
        (e) => e.name.toLowerCase().includes(lower) || String(e.content).toLowerCase().includes(lower)
      );
    },
    deleteMemory(name) { return store.delete(name); },
  };
}

/**
 * In-memory fs adapter.
 */
function makeMockFs() {
  const files = new Map();
  return {
    async writeFile(filePath, content) { files.set(filePath, content); },
    async readFile(filePath) {
      if (!files.has(filePath)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(filePath);
    },
    async unlink(filePath) {
      if (!files.has(filePath)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = "ENOENT";
        throw err;
      }
      files.delete(filePath);
    },
    async access(filePath) {
      if (!files.has(filePath)) {
        const err = new Error(`ENOENT: ${filePath}`);
        err.code = "ENOENT";
        throw err;
      }
    },
  };
}

/**
 * Minimal mock plugin registry.
 */
function makeMockPluginRegistry() {
  const plugins = [];
  const hooksMap = new Map();
  ["beforeToolCall", "afterToolCall", "onError", "beforeChat", "afterChat", "onSessionStart", "onSessionEnd"]
    .forEach((h) => hooksMap.set(h, []));

  return {
    register(plugin) {
      if (!plugin || !plugin.name) throw new Error("Plugin must have a name");
      if (plugins.some((p) => p.name === plugin.name)) throw new Error(`Plugin "${plugin.name}" is already registered`);
      plugins.push({ name: plugin.name, hooks: plugin.hooks || {} });
      if (plugin.hooks) {
        for (const [h, fn] of Object.entries(plugin.hooks)) {
          if (hooksMap.has(h) && typeof fn === "function") hooksMap.get(h).push({ plugin: plugin.name, fn });
        }
      }
    },
    unregister(name) {
      const idx = plugins.findIndex((p) => p.name === name);
      if (idx === -1) return false;
      plugins.splice(idx, 1);
      for (const [, h] of hooksMap) {
        for (let i = h.length - 1; i >= 0; i--) {
          if (h[i].plugin === name) h.splice(i, 1);
        }
      }
      return true;
    },
    list() { return plugins.map((p) => ({ name: p.name, hooks: Object.keys(p.hooks || {}) })); },
    async runHook(name, ctx = {}) {
      for (const { fn } of hooksMap.get(name) || []) {
        try { const r = await fn(ctx); if (r !== undefined && r !== null) ctx = r; } catch (_) {}
      }
      return ctx;
    },
  };
}

// ---------------------------------------------------------------------------
// Test context builder
// ---------------------------------------------------------------------------

function buildContext(overrides = {}) {
  const settings = overrides.settings || createMockSettings();
  const toolRegistry = overrides.toolRegistry !== undefined ? overrides.toolRegistry : makeFullMockRegistry();
  const memApi = overrides.memApi || makeMockMemApi();
  const fsImpl = overrides.fs || makeMockFs();
  const pluginRegistry = overrides.pluginRegistry !== undefined ? overrides.pluginRegistry : makeMockPluginRegistry();
  const tmpDir = overrides.tmpDir || os.tmpdir();

  return {
    settings,
    toolRegistry,
    createSession: overrides.createSession || (() => createMockSession()),
    writeMemory: memApi.writeMemory.bind(memApi),
    readMemory: memApi.readMemory.bind(memApi),
    listMemories: memApi.listMemories.bind(memApi),
    searchMemories: memApi.searchMemories.bind(memApi),
    deleteMemory: memApi.deleteMemory.bind(memApi),
    fs: fsImpl,
    tmpDir,
    pluginRegistry,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("SmokeTest: constructor stores context", () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const stored = sm.getContext();

  assert.equal(stored.settings, ctx.settings);
  assert.equal(stored.toolRegistry, ctx.toolRegistry);
});

test("SmokeTest: runQuick returns expected result shape", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runQuick();

  assert.equal(typeof result.passed, "number");
  assert.equal(typeof result.failed, "number");
  assert.equal(typeof result.skipped, "number");
  assert.equal(typeof result.durationMs, "number");
  assert.equal(typeof result.criticalBlocked, "boolean");
  assert.equal(typeof result.timestamp, "string");
  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length >= QUICK_TESTS.length);
});

test("SmokeTest: runQuick all pass with valid context", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runQuick();

  assert.equal(result.failed, 0, `Expected 0 failures, got ${result.failed}. Results: ${JSON.stringify(result.results.filter((r) => r.status === "fail"))}`);
  assert.equal(result.passed, QUICK_TESTS.length);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.criticalBlocked, false);
});

test("SmokeTest: runStandard returns expected result shape", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runStandard();

  assert.ok(result.results.length >= STANDARD_TESTS.length);
  assert.equal(result.failed, 0, `Unexpected failures in standard smoke: ${JSON.stringify(result.results.filter((r) => r.status === "fail"))}`);
  assert.ok(result.passed > 0);
});

test("SmokeTest: runFull returns expected result shape", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runFull();

  assert.ok(result.results.length >= FULL_TESTS.length);
  assert.equal(result.failed, 0, `Unexpected failures in full smoke: ${JSON.stringify(result.results.filter((r) => r.status === "fail"))}`);
  assert.ok(result.passed > 0);
});

test("SmokeTest: criticalBlocked is true when a critical test fails", async () => {
  // Provide a context with missing toolRegistry so "registry:init" (critical) fails
  const ctx = buildContext({ toolRegistry: null });
  const sm = new SmokeTest(ctx);
  const result = await sm.runQuick();

  assert.ok(result.failed > 0, "Expected at least 1 failure");
  assert.equal(result.criticalBlocked, true, "criticalBlocked should be true when a critical test fails");

  // Verify the specific critical test failed
  const registryInit = result.results.find((r) => r.name === "registry:init");
  assert.ok(registryInit);
  assert.equal(registryInit.status, "fail");
});

test("SmokeTest: missing config causes config:load to fail and criticalBlocked=true", async () => {
  const ctx = buildContext({ settings: null });
  const sm = new SmokeTest(ctx);
  const result = await sm.runQuick();

  const configResult = result.results.find((r) => r.name === "config:load");
  assert.ok(configResult);
  assert.equal(configResult.status, "fail");
  assert.equal(result.criticalBlocked, true);
});

test("SmokeTest: updateContext allows adding dependencies after construction", async () => {
  // Start with minimal context
  const ctx = buildContext({
    toolRegistry: makeFullMockRegistry(),
    settings: createMockSettings(),
    pluginRegistry: makeMockPluginRegistry(),
  });
  const sm = new SmokeTest(ctx);

  // Run quick first
  const quick = await sm.runQuick();
  assert.equal(quick.failed, 0);

  // Now add plugins so full tests work
  sm.updateContext({ pluginRegistry: makeMockPluginRegistry() });

  // Run full suite
  const full = await sm.runFull();
  assert.equal(full.failed, 0, `Full suite failures after update: ${JSON.stringify(full.results.filter((r) => r.status === "fail"))}`);
});

test("SmokeTest: QUICK_TESTS, STANDARD_TESTS, FULL_TESTS are frozen", () => {
  assert.ok(Object.isFrozen(QUICK_TESTS));
  assert.ok(Object.isFrozen(STANDARD_TESTS));
  assert.ok(Object.isFrozen(FULL_TESTS));
});

test("SmokeTest: CRITICAL_TESTS contains expected entries", () => {
  assert.ok(CRITICAL_TESTS instanceof Set);
  assert.ok(CRITICAL_TESTS.has("config:load"));
  assert.ok(CRITICAL_TESTS.has("registry:init"));
  assert.ok(CRITICAL_TESTS.has("session:create"));
  assert.equal(CRITICAL_TESTS.size, 3);
});

test("SmokeTest: runStandard skips unknown tests gracefully", () => {
  // Build a custom test list that includes an unknown name
  const resultPromise = (async () => {
    const ctx = buildContext();
    const sm = new SmokeTest(ctx);
    // Access internal _runSuite with a custom list
    return sm._runSuite(["nonexistent:test", "config:load", "nonexistent:test2"]);
  })();

  // Should not throw
  assert.doesNotReject(resultPromise);
});

test("SmokeTest: all three levels run in increasing order of coverage", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);

  const quick = await sm.runQuick();
  const standard = await sm.runStandard();
  const full = await sm.runFull();

  assert.ok(quick.results.length < standard.results.length,
    `Quick (${quick.results.length}) should have fewer tests than standard (${standard.results.length})`);
  assert.ok(standard.results.length < full.results.length,
    `Standard (${standard.results.length}) should have fewer tests than full (${full.results.length})`);
});

test("SmokeTest: runFull includes files tests", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runFull();

  const fileTests = result.results.filter((r) => r.name.startsWith("files:"));
  assert.equal(fileTests.length, 3);
  const fileNames = fileTests.map((r) => r.name);
  assert.deepEqual(fileNames, ["files:write", "files:read", "files:delete"]);
  assert.ok(fileTests.every((r) => r.status === "pass"), "All file tests should pass");
});

test("SmokeTest: runFull includes plugin tests", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runFull();

  const pluginTests = result.results.filter((r) => r.name.startsWith("plugins:"));
  assert.equal(pluginTests.length, 2);
  assert.ok(pluginTests.every((r) => r.status === "pass"), "All plugin tests should pass");
});

test("SmokeTest: runQuick completes quickly (under 1 second)", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runQuick();

  assert.ok(result.durationMs < 1000, `runQuick took ${result.durationMs}ms, expected < 1000ms`);
});

test("SmokeTest: memory tests cycle through write/read/delete correctly", async () => {
  const ctx = buildContext();
  const sm = new SmokeTest(ctx);
  const result = await sm.runStandard();

  const memTests = result.results.filter((r) => r.name.startsWith("memory:"));
  assert.equal(memTests.length, 4);
  const memNames = memTests.map((r) => r.name);
  assert.deepEqual(memNames, ["memory:write", "memory:read", "memory:list", "memory:delete"]);
  assert.ok(memTests.every((r) => r.status === "pass"), "All memory tests should pass");
});
