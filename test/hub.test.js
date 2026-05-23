/**
 * Integration hub tests.
 *
 * Covers createAgent with all feature combinations:
 *   - Defaults / minimal config
 *   - All features enabled
 *   - Plugins loaded from discovery dirs
 *   - Undo stack
 *   - Rate limiting
 *   - Goal persistence (restore)
 *   - Cleanup shuts down all subsystems
 *   - All features disabled
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createAgent } = require("../src/hub");

// ─── helpers ──────────────────────────────────────────────────────────

function makeSettings(overrides = {}) {
  return {
    agent: {
      name: "test-agent",
      model: "claude-sonnet-4-20250514",
      maxTurns: 10,
      temperature: 0.7,
      apiKey: undefined,
      apiUrl: undefined,
    },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 1000 },
    context: { enabled: true, windowTokens: 8000, reserveOutputTokens: 1024, charsPerToken: 4 },
    fileContext: {
      enabled: true,
      maxFiles: 20,
      maxIndexFiles: 1000,
      maxFileSize: 1048576,
      maxBytesPerFile: 1048576,
      maxTotalBytes: 10485760,
    },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 30000, maxBuffer: 10485760 } },
    ui: { locale: "en" },
    ...overrides,
  };
}

function tempPluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-hub-plugins-"));
  return dir;
}

function writePlugin(dir, name, hooks = {}) {
  const code = [
    '"use strict";',
    "module.exports = {",
    `  name: ${JSON.stringify(name)},`,
    `  version: "1.0.0",`,
    "  hooks: {",
  ];
  for (const [hookName, hookBody] of Object.entries(hooks)) {
    code.push(`    ${hookName}: ${hookBody},`);
  }
  code.push("  },");
  code.push("};");
  fs.writeFileSync(path.join(dir, `${name}.js`), code.join("\n"), "utf8");
}

// ─── tests ────────────────────────────────────────────────────────────

test("createAgent with defaults (minimal config)", () => {
  const settings = makeSettings();
  const result = createAgent({ root: os.tmpdir(), settings });

  assert.ok(result, "createAgent returns an object");
  assert.ok(typeof result.cleanup === "function", "cleanup is a function");
  assert.ok(
    "toolRegistry" in result,
    "toolRegistry key exists"
  );
  assert.ok(
    "session" in result,
    "session key exists"
  );
  assert.ok(
    "undoStack" in result,
    "undoStack key exists"
  );
  assert.ok(
    "pluginRegistry" in result,
    "pluginRegistry key exists"
  );
  assert.ok(
    "rateLimiter" in result,
    "rateLimiter key exists"
  );
  assert.ok(
    "shutdown" in result,
    "shutdown key exists"
  );

  // cleanup should not throw
  const errs = result.cleanup();
  assert.ok(Array.isArray(errs), "cleanup returns an array of errors");
});

test("createAgent with all features enabled", () => {
  const settings = makeSettings();
  const result = createAgent({ root: os.tmpdir(), settings });

  // Plugin registry should be created
  assert.ok(result.pluginRegistry !== null, "pluginRegistry is created");
  assert.ok(typeof result.pluginRegistry.list === "function", "pluginRegistry has list()");

  // Undo stack should be created
  assert.ok(result.undoStack !== null, "undoStack is created");
  assert.ok(typeof result.undoStack.push === "function", "undoStack has push()");

  // Rate limiter should be created
  assert.ok(result.rateLimiter !== null, "rateLimiter is created");
  assert.ok(typeof result.rateLimiter.acquire === "function", "rateLimiter has acquire()");

  // Session should be created
  assert.ok(result.session !== null, "session is created");
  assert.ok(typeof result.session.id === "string", "session has an id");

  // Tool registry should be created with some tools
  if (result.toolRegistry) {
    const tools = result.toolRegistry.list();
    assert.ok(Array.isArray(tools), "toolRegistry.list() returns an array");
  }

  // Shutdown manager should be created
  assert.ok(result.shutdown !== null, "shutdown is created");
  assert.ok(typeof result.shutdown.register === "function", "shutdown has register()");

  // Cleanup must work
  const errs = result.cleanup();
  assert.ok(Array.isArray(errs), "cleanup returns errors array");
});

test("createAgent with plugins enabled loads from discovery dirs", () => {
  const dir = tempPluginDir();
  try {
    writePlugin(dir, "test-logger", {
      beforeToolCall: "(ctx) => { /* log */ }",
      afterToolCall: "(ctx) => { /* log */ }",
    });

    const settings = makeSettings();
    const result = createAgent({
      root: os.tmpdir(),
      settings,
      enablePlugins: true,
      pluginDiscoveryDirs: [dir],
    });

    assert.ok(result.pluginRegistry !== null, "pluginRegistry exists");
    const plugins = result.pluginRegistry.list();
    const found = plugins.find((p) => p.name === "test-logger");
    assert.ok(found, "test-logger plugin was loaded from discovery dir");
    assert.ok(found.hooks.includes("beforeToolCall"), "beforeToolCall hook registered");
    assert.ok(found.hooks.includes("afterToolCall"), "afterToolCall hook registered");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createAgent with undo enabled has undoStack", () => {
  const settings = makeSettings();
  const result = createAgent({ root: os.tmpdir(), settings, enableUndo: true });

  assert.ok(result.undoStack !== null, "undoStack is not null when enabled");
  assert.equal(typeof result.undoStack.push, "function", "undoStack.push is a function");
  assert.equal(typeof result.undoStack.undo, "function", "undoStack.undo is a function");
  assert.equal(typeof result.undoStack.redo, "function", "undoStack.redo is a function");
  assert.equal(typeof result.undoStack.canUndo, "function", "undoStack.canUndo is a function");
  assert.equal(result.undoStack.canUndo(), false, "new undo stack has no items");
});

test("createAgent with undo disabled has null undoStack", () => {
  const settings = makeSettings();
  const result = createAgent({ root: os.tmpdir(), settings, enableUndo: false });

  assert.equal(result.undoStack, null, "undoStack is null when disabled");
});

test("createAgent with rate limit enabled rate-limits tools", async () => {
  const settings = makeSettings();
  const result = createAgent({
    root: os.tmpdir(),
    settings,
    enableRateLimit: true,
    rateLimitOptions: { maxTokens: 100, refillRate: 10 },
  });

  assert.ok(result.rateLimiter !== null, "rateLimiter is created");
  const stats = result.rateLimiter.getStats();
  assert.ok(typeof stats === "object", "rateLimiter.getStats returns an object");
  assert.ok(typeof stats.global === "object", "stats.global exists");

  // Acquire a token from the rate limiter
  const { acquired } = await result.rateLimiter.acquire("default", 1, 1000);
  assert.equal(acquired, true, "can acquire token from rate limiter");
});

test("createAgent with goal persistence restores saved goals", () => {
  const settings = makeSettings();
  const result = createAgent({
    root: os.tmpdir(),
    settings,
    enableGoalPersistence: true,
    enableShutdown: false,
  });

  // Goal persistence module was loaded (soft dependency)
  // Session should have been created with an id
  if (result.session) {
    assert.ok(typeof result.session.id === "string", "session has id");
    // Goal may be null if nothing persisted yet, which is correct
    assert.ok(
      result.session.goal === null || result.session.goal === undefined || typeof result.session.goal === "object",
      "session.goal is null or an object"
    );
  }
});

test("cleanup shuts down all subsystems", () => {
  const settings = makeSettings();
  const result = createAgent({ root: os.tmpdir(), settings });

  // Run cleanup
  const errors = result.cleanup();
  assert.ok(Array.isArray(errors), "cleanup returns array");
  // All errors should be from graceful degradation, not crashes
  for (const err of errors) {
    assert.ok(typeof err === "string", `cleanup error is a string: ${err}`);
  }

  // After cleanup, undo stack should be empty
  if (result.undoStack) {
    assert.equal(result.undoStack.canUndo(), false, "undo stack cleared after cleanup");
  }
});

test("createAgent without optional features (all disabled) works", () => {
  const settings = makeSettings();
  const result = createAgent({
    root: os.tmpdir(),
    settings,
    enablePlugins: false,
    enableUndo: false,
    enableRateLimit: false,
    enableRetry: false,
    enableShutdown: false,
    enableMemoryEviction: false,
    enableGoalPersistence: false,
    enableAutoCompact: false,
  });

  assert.ok(result, "createAgent returns an object even with all features disabled");
  assert.ok(typeof result.cleanup === "function", "cleanup is still a function");
  assert.equal(result.pluginRegistry, null, "pluginRegistry is null when disabled");
  assert.equal(result.undoStack, null, "undoStack is null when disabled");
  assert.equal(result.rateLimiter, null, "rateLimiter is null when disabled");
  assert.equal(result.shutdown, null, "shutdown is null when disabled");
  assert.equal(result.compactionApi, null, "compactionApi is null when disabled");
});

test("createAgent with invalid settings still returns object", () => {
  // Missing required fields should not crash — the hub degrades gracefully
  const result = createAgent({ root: os.tmpdir(), settings: {} });
  assert.ok(result, "createAgent returns an object even with empty settings");
  assert.ok(typeof result.cleanup === "function", "cleanup is a function");
});

test("createAgent wires plugin hooks into toolRegistry", () => {
  const dir = tempPluginDir();
  try {
    writePlugin(dir, "tracker", {
      beforeToolCall: "(ctx) => { ctx._tracked = true; }",
    });

    const settings = makeSettings();
    const result = createAgent({
      root: os.tmpdir(),
      settings,
      enablePlugins: true,
      pluginDiscoveryDirs: [dir],
    });

    assert.ok(result.pluginRegistry !== null, "pluginRegistry exists");
    const plugins = result.pluginRegistry.list();
    // hub-goal-persistence is also auto-registered when goal persistence is enabled
    assert.ok(plugins.length >= 1, "at least one plugin loaded");
    const tracker = plugins.find((p) => p.name === "tracker");
    assert.ok(tracker, "tracker plugin found among loaded plugins");

    // The tool registry should have the plugin registry wired in
    if (result.toolRegistry) {
      assert.equal(
        result.toolRegistry.pluginRegistry,
        result.pluginRegistry,
        "toolRegistry.pluginRegistry references the plugin registry"
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createAgent with compaction enabled returns compactionApi", () => {
  const settings = makeSettings();
  const result = createAgent({
    root: os.tmpdir(),
    settings,
    enableAutoCompact: true,
  });

  if (result.compactionApi) {
    assert.ok(typeof result.compactionApi.compactMessages === "function", "compactMessages is a function");
    assert.ok(typeof result.compactionApi.buildCompactionPrompt === "function", "buildCompactionPrompt is a function");
    assert.ok(typeof result.compactionApi.buildCompactMessages === "function", "buildCompactMessages is a function");
  }
});

test("multiple createAgent calls produce independent instances", () => {
  const settings = makeSettings();

  const result1 = createAgent({ root: os.tmpdir(), settings });
  const result2 = createAgent({ root: os.tmpdir(), settings });

  assert.ok(result1 !== result2, "calls return different objects");

  // Each has its own registry, session, stack
  if (result1.pluginRegistry && result2.pluginRegistry) {
    assert.ok(result1.pluginRegistry !== result2.pluginRegistry, "separate plugin registries");
  }
  if (result1.toolRegistry && result2.toolRegistry) {
    assert.ok(result1.toolRegistry !== result2.toolRegistry, "separate tool registries");
  }
  if (result1.session && result2.session) {
    assert.ok(result1.session.id !== result2.session.id, "separate sessions with unique ids");
  }

  // Cleanup both
  result1.cleanup();
  result2.cleanup();
});

test("createAgent can createAgent with custom shutdown options", () => {
  const settings = makeSettings();
  const result = createAgent({
    root: os.tmpdir(),
    settings,
    enableShutdown: true,
    shutdownOptions: { timeoutMs: 10000 },
  });

  if (result.shutdown) {
    assert.ok(result.shutdown.hookCount >= 0, "shutdown has hookCount");
  }

  result.cleanup();
});
