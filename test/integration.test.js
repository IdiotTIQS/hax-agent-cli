/**
 * End-to-end integration tests for HaxAgent.
 *
 * These tests manually wire together standalone modules to verify
 * cross-module behavior. Many modules (UndoStack, PluginRegistry,
 * batch, export) are feature-complete but not yet integrated into
 * the production runtime. These tests validate that manual wiring
 * works correctly and serve as integration documentation.
 *
 * Coverage:
 *   - Undo + File tools: undoStack with real file I/O
 *   - Batch + Export: input parsing, session transcript export
 *   - Memory + Batch/Export: write transcript, export to formats
 *   - Plugin + Tool: register plugins, run hooks
 *   - Config validation + Settings loading
 *   - Rate limiter + Tool retry
 *   - Shutdown + Plugin lifecycle
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(prefix = "hax-integ-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFixture() {
  const projectRoot = createTempDir("hax-integ-");
  return {
    projectRoot,
    settings: {
      projectRoot,
      memoryDirectory: path.join(projectRoot, "memory"),
      sessionDirectory: path.join(projectRoot, "sessions"),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. UndoStack + File Tools integration
// ---------------------------------------------------------------------------

test("undo + file: push, undo, redo cycle with real files", async () => {
  const projectRoot = createTempDir("hax-undo-int-");
  const filePath = path.join(projectRoot, "data.txt");
  fs.writeFileSync(filePath, "v1", "utf8");

  const { UndoStack } = require("../src/undo-stack");
  const undoStack = new UndoStack();

  // Simulate tool operations
  undoStack.push({ filePath, originalContent: "v1", newContent: "v2", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v2", "utf8");

  assert.equal(undoStack.canUndo(), true);
  assert.equal(undoStack.canRedo(), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");

  // Undo
  const undoResult = await undoStack.undo();
  assert.equal(undoResult.undone, true);
  assert.ok(undoResult.description.includes("data.txt"));
  assert.equal(fs.readFileSync(filePath, "utf8"), "v1");
  assert.equal(undoStack.canRedo(), true);

  // Redo
  const redoResult = await undoStack.redo();
  assert.equal(redoResult.redone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");
  assert.equal(undoStack.canRedo(), false);
});

test("undo + file: LIFO undo across multiple edits", async () => {
  const projectRoot = createTempDir("hax-undo-int-");
  const filePath = path.join(projectRoot, "ver.txt");
  fs.writeFileSync(filePath, "v1", "utf8");

  const { UndoStack } = require("../src/undo-stack");
  const undoStack = new UndoStack();

  // Three edits
  undoStack.push({ filePath, originalContent: "v1", newContent: "v2", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v2", "utf8");

  undoStack.push({ filePath, originalContent: "v2", newContent: "v3", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v3", "utf8");

  undoStack.push({ filePath, originalContent: "v3", newContent: "v4", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v4", "utf8");

  assert.equal(fs.readFileSync(filePath, "utf8"), "v4");
  assert.equal(undoStack._stack.length, 3);

  // Undo v4->v3, v3->v2, v2->v1
  await undoStack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v3");
  await undoStack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");
  await undoStack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v1");
  assert.equal(undoStack.canUndo(), false);

  // Redo v1->v2, v2->v3, v3->v4
  await undoStack.redo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");
  await undoStack.redo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v3");
  await undoStack.redo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "v4");
  assert.equal(undoStack.canRedo(), false);
});

test("undo + file: delete operation stores content for recovery", async () => {
  const projectRoot = createTempDir("hax-undo-int-");
  const filePath = path.join(projectRoot, "critical.txt");
  const important = "critical data that must be recoverable";
  fs.writeFileSync(filePath, important, "utf8");

  const { UndoStack } = require("../src/undo-stack");
  const undoStack = new UndoStack();

  // Simulate file.delete tool behavior
  undoStack.push({
    toolName: "file.delete",
    filePath,
    originalContent: important,
    newContent: "",
    description: "Delete critical.txt",
  });
  fs.unlinkSync(filePath);
  assert.equal(fs.existsSync(filePath), false);

  // Undo should recreate
  const result = await undoStack.undo();
  assert.equal(result.undone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), important);
});

test("undo + file: external modification captured on undo for accurate redo", async () => {
  const projectRoot = createTempDir("hax-undo-int-");
  const filePath = path.join(projectRoot, "ext.txt");
  fs.writeFileSync(filePath, "original", "utf8");

  const { UndoStack } = require("../src/undo-stack");
  const undoStack = new UndoStack();

  undoStack.push({
    filePath, originalContent: "original", newContent: "tool-wrote",
    toolName: "file.write",
  });
  fs.writeFileSync(filePath, "tool-wrote", "utf8");

  // External process modifies
  fs.writeFileSync(filePath, "externally modified", "utf8");

  await undoStack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "original");

  // Redo stack captures external state as baseline
  assert.equal(undoStack._redoStack.length, 1);
  assert.equal(undoStack._redoStack[0].originalContent, "externally modified");
  assert.equal(undoStack._redoStack[0].newContent, "tool-wrote");
});

test("undo + file: maxEntries, list, clear work correctly", () => {
  const { UndoStack } = require("../src/undo-stack");
  const undoStack = new UndoStack(3);

  for (let i = 0; i < 5; i++) {
    undoStack.push({ filePath: `f${i}.txt`, originalContent: `${i}`, newContent: `${i + 1}` });
  }

  assert.equal(undoStack._stack.length, 3);
  assert.equal(undoStack._stack[0].filePath, path.resolve("f2.txt")); // oldest kept

  // List is most-recent-first
  const list = undoStack.list();
  assert.equal(list[0].file, "f4.txt");
  assert.equal(list[2].file, "f2.txt");
  assert.ok(list[0].timestamp);

  // New push clears redo
  undoStack._redoStack.push({ filePath: "r.txt" });
  undoStack.push({ filePath: "new.txt", originalContent: "n", newContent: "N" });
  assert.equal(undoStack._redoStack.length, 0);

  // Clear
  undoStack._redoStack.push({ filePath: "r2.txt" });
  undoStack.clear();
  assert.equal(undoStack.canUndo(), false);
  assert.equal(undoStack.canRedo(), false);
});

// ---------------------------------------------------------------------------
// 2. Batch + Export integration
// ---------------------------------------------------------------------------

test("batch + export: multi-marker input parsing", () => {
  const { parseBatchInput } = require("../src/batch");

  assert.deepEqual(parseBatchInput("hello"), ["hello"]);
  assert.deepEqual(parseBatchInput(""), []);
  assert.deepEqual(parseBatchInput("   \n"), []);

  const multi = parseBatchInput("@@@multi@@@\nline1\n\nline2\nline3");
  assert.deepEqual(multi, ["line1", "line2", "line3"]);

  const dash = parseBatchInput("---multi---\nturn1\nturn2");
  assert.deepEqual(dash, ["turn1", "turn2"]);
});

test("batch + export: session transcript export to Markdown, JSON, Text", () => {
  const { projectRoot, settings } = createFixture();

  const { createSessionId, writeTranscript } = require("../src/memory");
  const {
    exportSessionToMarkdown,
    exportSessionToJson,
    exportSessionToText,
  } = require("../src/export");

  const sessionId = createSessionId();
  const messages = [
    { role: "user", content: "Refactor the auth module" },
    { role: "assistant", content: "Reading the existing code..." },
    { role: "tool", name: "file.read", data: "exports = { login, logout }" },
    { role: "assistant", content: "Done. Added OAuth2 with PKCE." },
  ];

  writeTranscript(sessionId, messages, settings);
  const exportDir = path.join(projectRoot, "exports");

  // Markdown
  const mdPath = path.join(exportDir, "session.md");
  const md = exportSessionToMarkdown(sessionId, mdPath, settings);
  assert.equal(md.format, "markdown");
  assert.equal(md.entries, 4);
  assert.ok(fs.existsSync(mdPath));

  const mdContent = fs.readFileSync(mdPath, "utf8");
  assert.ok(mdContent.includes("# Hax Agent Session Transcript"));
  assert.ok(mdContent.includes("Refactor the auth module"));
  assert.ok(mdContent.includes("OAuth2 with PKCE"));

  // JSON
  const jsonPath = path.join(exportDir, "session.json");
  const json = exportSessionToJson(sessionId, jsonPath, settings);
  assert.equal(json.format, "json");
  assert.equal(json.entries, 4);

  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(parsed.messages.length, 4);
  assert.equal(parsed.messages[0].role, "user");
  assert.equal(parsed.messages[2].toolName, "file.read");

  // Text
  const txtPath = path.join(exportDir, "session.txt");
  const txt = exportSessionToText(sessionId, txtPath, settings);
  assert.equal(txt.format, "text");
  assert.equal(txt.entries, 4);

  const txtContent = fs.readFileSync(txtPath, "utf8");
  assert.ok(txtContent.includes("Session ID:"));
  assert.ok(txtContent.includes("Refactor the auth module"));
});

test("batch + export: export throws for non-existent session", () => {
  const { settings } = createFixture();
  const { exportSessionToMarkdown } = require("../src/export");

  assert.throws(
    () => exportSessionToMarkdown("nonexistent-id", "/tmp/out.md", settings),
    { message: /Session not found/ },
  );
});

test("batch + export: empty transcript export", () => {
  const { projectRoot, settings } = createFixture();

  const { createSessionId, writeTranscript } = require("../src/memory");
  const { exportSessionToJson } = require("../src/export");

  const sessionId = createSessionId();
  writeTranscript(sessionId, [], settings);

  const outputPath = path.join(projectRoot, "empty.json");
  const result = exportSessionToJson(sessionId, outputPath, settings);
  assert.equal(result.entries, 0);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).messages.length, 0);
});

// ---------------------------------------------------------------------------
// 3. Memory + Export integration (cross-check)
// ---------------------------------------------------------------------------

test("memory + export: write memory, build transcript, export all together", () => {
  const { projectRoot, settings } = createFixture();

  const {
    createSessionId, writeMemory, readMemory, listMemories,
    deleteMemory, searchMemories, writeTranscript,
  } = require("../src/memory");
  const { exportSessionToJson } = require("../src/export");

  // Write memories
  writeMemory("api-base-url", "https://api.example.com/v2", settings);
  writeMemory("db-config", "host=localhost port=5432", settings);
  writeMemory("coding-style", "Use 2-space indentation", settings);

  const all = listMemories(settings);
  assert.equal(all.length, 3);
  assert.equal(all[0].name, "coding-style"); // sorted by updatedAt desc

  // Read one back
  const db = readMemory("db-config", settings);
  assert.equal(db.content, "host=localhost port=5432");
  assert.ok(db.createdAt);
  assert.ok(db.updatedAt);

  // Search
  const results = searchMemories("api", settings);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "api-base-url");

  // Delete
  assert.equal(deleteMemory("coding-style", settings), true);
  assert.equal(deleteMemory("coding-style", settings), false);
  assert.equal(listMemories(settings).length, 2);

  // Build and export a transcript for a batch session
  const sessionId = createSessionId();
  writeTranscript(sessionId, [
    { role: "user", content: "What is the API base URL?" },
    { role: "assistant", content: "Based on memory: https://api.example.com/v2" },
  ], settings);

  const jsonPath = path.join(projectRoot, "batch-session.json");
  const jsonResult = exportSessionToJson(sessionId, jsonPath, settings);
  assert.equal(jsonResult.entries, 2);

  const exportData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(exportData.messages[0].role, "user");
});

test("memory + export: search with substring matching", () => {
  const { settings } = createFixture();
  const { writeMemory, searchMemories } = require("../src/memory");

  writeMemory("react-patterns", "Use functional components", settings);
  writeMemory("vue-patterns", "Use composition API", settings);
  writeMemory("backend-auth", "JWT with refresh tokens", settings);

  // Substring search
  const patternResults = searchMemories("component", settings);
  assert.equal(patternResults.length, 1);
  assert.equal(patternResults[0].name, "react-patterns");

  const authResults = searchMemories("jwt", settings);
  assert.equal(authResults.length, 1);
  assert.equal(authResults[0].name, "backend-auth");

  // Empty query
  assert.deepEqual(searchMemories("", settings), []);
  assert.deepEqual(searchMemories("   ", settings), []);
});

// ---------------------------------------------------------------------------
// 4. Plugin + Tool-like integration
// ---------------------------------------------------------------------------

test("plugin + tool: hooks fire in registration order around operations", async () => {
  const { PluginRegistry } = require("../src/plugins");

  const hookCalls = [];
  const registry = new PluginRegistry();

  registry.register({
    name: "audit-logger",
    version: "1.0.0",
    hooks: {
      beforeToolCall(ctx) {
        hookCalls.push({ hook: "beforeToolCall", tool: ctx.toolName });
        return ctx;
      },
      afterToolCall(ctx) {
        hookCalls.push({ hook: "afterToolCall", tool: ctx.toolName, ok: ctx.result?.ok });
        return ctx;
      },
      onError(ctx) {
        hookCalls.push({ hook: "onError", tool: ctx.toolName, msg: ctx.error?.message?.slice(0, 40) });
        return ctx;
      },
    },
  });

  // Simulate success
  await registry.runHook("beforeToolCall", { toolName: "file.write", args: {} });
  await registry.runHook("afterToolCall", { toolName: "file.write", result: { ok: true } });

  // Simulate error
  await registry.runHook("onError", {
    toolName: "file.read",
    error: new Error("ENOENT: no such file"),
  });

  assert.equal(hookCalls[0].hook, "beforeToolCall");
  assert.equal(hookCalls[0].tool, "file.write");
  assert.equal(hookCalls[1].hook, "afterToolCall");
  assert.equal(hookCalls[1].ok, true);
  assert.equal(hookCalls[2].hook, "onError");
  assert.equal(hookCalls[2].tool, "file.read");
  assert.ok(hookCalls[2].msg.includes("ENOENT"));
});

test("plugin + tool: multiple plugins execute hooks sequentially", async () => {
  const { PluginRegistry } = require("../src/plugins");

  const order = [];
  const registry = new PluginRegistry();

  registry.register({
    name: "alpha",
    hooks: {
      beforeToolCall(ctx) { order.push("alpha:before"); return ctx; },
      afterToolCall(ctx) { order.push("alpha:after"); return ctx; },
    },
  });
  registry.register({
    name: "beta",
    hooks: {
      beforeToolCall(ctx) { order.push("beta:before"); return ctx; },
      afterToolCall(ctx) { order.push("beta:after"); return ctx; },
    },
  });

  await registry.runHook("beforeToolCall", { toolName: "test" });
  await registry.runHook("afterToolCall", { toolName: "test" });

  assert.deepEqual(order, [
    "alpha:before", "beta:before",
    "alpha:after", "beta:after",
  ]);
});

test("plugin + tool: hook errors caught, subsequent hooks still run", async () => {
  const { PluginRegistry } = require("../src/plugins");

  const completed = [];
  const registry = new PluginRegistry();

  registry.register({
    name: "crashy",
    hooks: {
      beforeToolCall() { throw new Error("crash!"); },
    },
  });
  registry.register({
    name: "robust",
    hooks: {
      beforeToolCall(ctx) { completed.push("robust"); return ctx; },
    },
  });

  // Must not throw
  const ctx = await registry.runHook("beforeToolCall", { toolName: "test" });
  assert.equal(ctx.toolName, "test");
  assert.deepEqual(completed, ["robust"]);
});

test("plugin + tool: register, unregister, getHookCount", async () => {
  const { PluginRegistry } = require("../src/plugins");

  const registry = new PluginRegistry();
  assert.equal(registry.getHookCount(), 0);

  registry.register({
    name: "logger",
    hooks: {
      beforeToolCall(ctx) { ctx.marked = true; return ctx; },
      afterToolCall(ctx) { return ctx; },
    },
  });

  assert.equal(registry.getHookCount(), 2);

  // Hook should fire
  const ctx = await registry.runHook("beforeToolCall", {});
  assert.equal(ctx.marked, true);

  // Unregister and verify
  assert.equal(registry.unregister("logger"), true);
  assert.equal(registry.unregister("logger"), false);
  assert.equal(registry.getHookCount(), 0);

  // Empty runHook returns context unchanged
  const ctx2 = await registry.runHook("beforeToolCall", { toolName: "none" });
  assert.deepEqual(ctx2, { toolName: "none" });
});

test("plugin + tool: directory auto-discovery of .js plugins", () => {
  const projectRoot = createTempDir("hax-plugin-int-");
  const pluginsDir = path.join(projectRoot, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  // Valid plugin
  fs.writeFileSync(path.join(pluginsDir, "logger.js"), `
    module.exports = {
      name: "logger",
      version: "1.0.0",
      hooks: {
        beforeToolCall(ctx) { ctx.logged = true; return ctx; },
      },
    };
  `, "utf8");

  // Malformed plugin (not an object)
  fs.writeFileSync(path.join(pluginsDir, "bad.js"), `
    module.exports = "not a plugin";
  `, "utf8");

  const { PluginRegistry } = require("../src/plugins");
  const registry = new PluginRegistry();

  // Should load 1 plugin (bad.js is skipped silently)
  const count = registry.loadPluginsFromDirectory(pluginsDir);
  assert.equal(count, 1);

  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "logger");
  assert.deepEqual(list[0].hooks, ["beforeToolCall"]);
});

test("plugin + tool: all 7 hook names are registered", () => {
  const { PluginRegistry, PLUGIN_HOOK_NAMES } = require("../src/plugins");
  const registry = new PluginRegistry();

  assert.equal(PLUGIN_HOOK_NAMES.length, 7);
  for (const name of PLUGIN_HOOK_NAMES) {
    assert.ok(registry._hooks.has(name), `Hook "${name}" should be registered`);
  }
});

// ---------------------------------------------------------------------------
// 5. Config validation + Settings loading integration
// ---------------------------------------------------------------------------

test("config + settings: valid defaults pass validation", () => {
  const { DEFAULT_SETTINGS } = require("../src/config");
  const { validateSettings } = require("../src/config-validator");

  const issues = validateSettings(DEFAULT_SETTINGS);
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("config + settings: invalid values produce descriptive errors", () => {
  const { validateSettings } = require("../src/config-validator");

  const bad = {
    agent: { name: "", model: "", maxTurns: 0, temperature: 10 },
    permissions: { mode: "unsafe" },
    tools: { shell: { timeoutMs: 0 } },
    ui: { locale: "xx-YY" },
  };

  const issues = validateSettings(bad);
  const errors = issues.filter((i) => i.severity === "error");

  assert.ok(errors.length >= 3, `Expected >=3 errors, got ${errors.length}`);

  const paths = errors.map((i) => i.path);
  assert.ok(paths.includes("agent.maxTurns"), "maxTurns=0 should be caught");
  assert.ok(paths.includes("agent.temperature"), "temperature=10 should be caught");
  assert.ok(paths.includes("permissions.mode"), "mode=unsafe should be caught");
});

test("config + settings: assertValidSettings throws", () => {
  const { assertValidSettings } = require("../src/config-validator");

  assert.throws(
    () => assertValidSettings(
      { agent: { name: "t", model: "m", maxTurns: 0, temperature: 0.2 }, permissions: { mode: "normal" } },
      { throwOnError: true },
    ),
    { message: /validation failed/ },
  );
});

test("config + settings: resolveSettings merges project overrides and tracks sources", () => {
  const projectRoot = createTempDir("hax-config-int-");
  const { resolveSettings } = require("../src/config");

  // Write project-level settings
  const projectSettingsDir = path.join(projectRoot, ".hax-agent");
  fs.mkdirSync(projectSettingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectSettingsDir, "settings.json"),
    JSON.stringify({ agent: { maxTurns: 50, temperature: 0.7 } }),
    "utf8",
  );

  const result = resolveSettings({ projectRoot });
  assert.equal(result.settings.agent.maxTurns, 50);
  assert.equal(result.settings.agent.temperature, 0.7);

  // Sources metadata
  assert.ok(Array.isArray(result.sources));
  const projectSource = result.sources.find((s) => s.type === "project");
  assert.notEqual(projectSource, undefined);
  assert.equal(projectSource.loaded, true);

  for (const source of result.sources) {
    assert.ok(["user", "project", "explicit"].includes(source.type));
    assert.equal(typeof source.path, "string");
    assert.equal(typeof source.loaded, "boolean");
  }
});

test("config + settings: resolveSettings with missing project file gracefully degrades", () => {
  const projectRoot = createTempDir("hax-config-int-");
  // No .hax-agent/settings.json — should still resolve without error
  const { resolveSettings } = require("../src/config");
  const result = resolveSettings({ projectRoot });

  assert.ok(result.settings.agent.maxTurns >= 1);
  assert.ok(result.settings.agent.model.length > 0);
});

// ---------------------------------------------------------------------------
// 6. Rate limiter + Tool retry integration
// ---------------------------------------------------------------------------

test("rate-limiter + retry: retry when rate-limit exhausted, fails after maxRetries", async () => {
  const { RateLimiter } = require("../src/rate-limiter");
  const { createRetryableTool } = require("../src/tool-retry");

  // 1 token, no refill — exhaust immediately
  const limiter = new RateLimiter({ maxTokens: 1, refillRate: 0, refillIntervalMs: 99999 });
  await limiter.acquire(1, 50);

  let callCount = 0;
  const execute = async () => {
    callCount += 1;
    const token = await limiter.acquire(1, 10);
    if (!token.acquired) throw new Error("Rate limit exceeded");
    return { success: true };
  };

  const retryable = createRetryableTool({
    toolName: "rate-limited-op",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
    retryOn: [/rate limit/i, /Rate limit/],
  });

  try {
    await retryable({}, {});
    assert.fail("Should have thrown");
  } catch (err) {
    assert.match(err.message, /Rate limit exceeded/);
    assert.equal(callCount, 3); // maxRetries=3 means 3 total attempts
  }
});

test("rate-limiter + retry: transient I/O errors retried with backoff", async () => {
  const { createRetryableTool } = require("../src/tool-retry");

  let calls = 0;
  const execute = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    return { success: true };
  };

  const retryable = createRetryableTool({
    toolName: "busy-op",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
    retryOn: [/EBUSY/i],
  });

  const result = await retryable({}, {});
  assert.equal(result.success, true);
  assert.equal(calls, 3);
});

test("rate-limiter + retry: non-retryable errors fail immediately", async () => {
  const { createRetryableTool } = require("../src/tool-retry");

  let calls = 0;
  const execute = async () => {
    calls += 1;
    throw new Error("EACCES: permission denied");
  };

  const retryable = createRetryableTool({
    toolName: "no-retry-op",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
    retryOn: [/EBUSY/i], // only retry EBUSY
  });

  try {
    await retryable({}, {});
    assert.fail("Should have thrown");
  } catch (err) {
    assert.match(err.message, /permission denied/);
    assert.equal(calls, 1); // no retry
  }
});

test("rate-limiter + retry: composite limiter with named buckets", async () => {
  const { CompositeRateLimiter } = require("../src/rate-limiter");

  const composite = new CompositeRateLimiter({
    maxTokens: 100,
    refillRate: 10,
    refillIntervalMs: 100,
  });

  composite.define("file-ops", { maxTokens: 3, refillRate: 1, refillIntervalMs: 100 });

  // Can acquire 3 from file-ops bucket
  for (let i = 0; i < 3; i++) {
    const r = await composite.acquire("file-ops", 1, 50);
    assert.equal(r.acquired, true, `Acquire ${i + 1} should succeed`);
  }

  // 4th fails
  const exhausted = await composite.acquire("file-ops", 1, 50);
  assert.equal(exhausted.acquired, false);

  // Unknown bucket uses global fallback (100 tokens available)
  const global = await composite.acquire("unknown-op", 1, 30);
  assert.equal(global.acquired, true);
});

test("rate-limiter + retry: wrap function with rate limit times out correctly", async () => {
  const { CompositeRateLimiter } = require("../src/rate-limiter");

  const limiter = new CompositeRateLimiter({
    maxTokens: 10,
    refillRate: 5,
    refillIntervalMs: 100,
  });
  limiter.define("slow-op", { maxTokens: 2, refillRate: 0, refillIntervalMs: 99999 });

  let callCount = 0;
  const fn = async () => { callCount += 1; return callCount; };
  const wrapped = limiter.wrap("slow-op", fn, { cost: 1, timeoutMs: 50 });

  await wrapped();
  await wrapped();
  assert.equal(callCount, 2);

  // Third times out
  try {
    await wrapped();
    assert.fail("Should have timed out");
  } catch (err) {
    assert.ok(/Rate limit|timeout/i.test(err.message));
  }
});

test("rate-limiter + retry: shouldRetry with string, regex, and function filters", () => {
  const { shouldRetry } = require("../src/tool-retry");

  // Empty filter: retry everything
  assert.equal(shouldRetry(new Error("anything"), []), true);

  // String match (case-insensitive)
  assert.equal(shouldRetry(new Error("EBUSY: resource busy"), ["busy"]), true);
  assert.equal(shouldRetry(new Error("permission denied"), ["busy"]), false);

  // Regex match
  assert.equal(shouldRetry(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }), [/etime/i]), true);
  assert.equal(shouldRetry(new Error("ok"), [/etime/i]), false);

  // Function match
  assert.equal(shouldRetry(Object.assign(new Error("oops"), { code: "ECONNRESET" }), [
    (e) => e.code === "ECONNRESET",
  ]), true);
});

test("rate-limiter + retry: getStats reflects usage", async () => {
  const { RateLimiter } = require("../src/rate-limiter");

  const rl = new RateLimiter({ maxTokens: 5, refillRate: 1, refillIntervalMs: 10000 });

  await rl.acquire(3, 50);
  const stats = rl.getStats();
  assert.equal(stats.availableTokens, 2);
  assert.equal(stats.waitCount, 0);
});

// ---------------------------------------------------------------------------
// 7. Shutdown + Plugin lifecycle integration
// ---------------------------------------------------------------------------

test("shutdown + plugins: onSessionStart/onSessionEnd lifecycle", async () => {
  const { PluginRegistry } = require("../src/plugins");
  const { ShutdownManager, PRIORITY } = require("../src/shutdown");

  const events = [];
  const pluginRegistry = new PluginRegistry();

  pluginRegistry.register({
    name: "lifespan-logger",
    hooks: {
      onSessionStart(ctx) { events.push("plugin:start"); return ctx; },
      onSessionEnd(ctx) { events.push("plugin:end"); return ctx; },
    },
  });

  await pluginRegistry.runHook("onSessionStart", { session: { id: "s1" } });

  const sm = new ShutdownManager({ timeoutMs: 2000 });
  sm.register("plugin-shutdown", PRIORITY.NOTIFY, async () => {
    await pluginRegistry.runHook("onSessionEnd", { session: { id: "s1" } });
    events.push("shutdown:notify");
  });
  sm.register("exit-log", PRIORITY.LOG, () => {
    events.push("shutdown:log");
  });

  await sm.shutdown({ exitProcess: false });

  assert.deepEqual(events, [
    "plugin:start",
    "plugin:end",
    "shutdown:notify",
    "shutdown:log",
  ]);
  sm.detach();
});

test("shutdown + plugins: priority ordering enforced", async () => {
  const { ShutdownManager, PRIORITY } = require("../src/shutdown");

  const order = [];
  const sm = new ShutdownManager({ timeoutMs: 2000 });

  sm.register("c-streams", PRIORITY.CLOSE_STREAMS, () => order.push("close-streams"));
  sm.register("a-save", PRIORITY.SAVE_STATE, () => order.push("save-state"));
  sm.register("d-log", PRIORITY.LOG, () => order.push("log"));
  sm.register("b-locks", PRIORITY.RELEASE_LOCKS, () => order.push("release-locks"));

  await sm.shutdown({ exitProcess: false });

  assert.deepEqual(order, [
    "save-state",
    "close-streams",
    "release-locks",
    "log",
  ]);
  sm.detach();
});

test("shutdown + plugins: hook errors don't block other hooks", async () => {
  const { ShutdownManager, PRIORITY } = require("../src/shutdown");
  const { PluginRegistry } = require("../src/plugins");

  const ran = [];
  const pluginRegistry = new PluginRegistry();

  pluginRegistry.register({
    name: "crashy",
    hooks: {
      onSessionEnd() { ran.push("crashy"); throw new Error("boom!"); },
    },
  });
  pluginRegistry.register({
    name: "robust",
    hooks: {
      onSessionEnd() { ran.push("robust"); },
    },
  });

  const sm = new ShutdownManager({ timeoutMs: 2000 });
  sm.register("plugins-end", PRIORITY.NOTIFY, async () => {
    await pluginRegistry.runHook("onSessionEnd", {});
    ran.push("notify-done");
  });
  sm.register("final", PRIORITY.LOG, () => ran.push("final"));

  // Must not throw
  await sm.shutdown({ exitProcess: false });
  assert.deepEqual(ran, ["crashy", "robust", "notify-done", "final"]);
  sm.detach();
});

test("shutdown + plugins: runHook on unknown hook returns context unchanged", async () => {
  const { PluginRegistry } = require("../src/plugins");
  const registry = new PluginRegistry();

  // No handlers registered; should return context as-is
  const ctx = await registry.runHook("nonExistentHook", { data: 42 });
  assert.deepEqual(ctx, { data: 42 });
});

// ---------------------------------------------------------------------------
// 8. Cross-cutting: full manual wiring scenario
// ---------------------------------------------------------------------------

test("cross-cutting: config + undo + plugin + memory all coexist in one scenario", async () => {
  const { projectRoot, settings } = createFixture();

  // 1. Config validation on a manually built config
  const { DEFAULT_SETTINGS, mergeSettings } = require("../src/config");
  const { validateSettings } = require("../src/config-validator");
  const merged = mergeSettings(DEFAULT_SETTINGS, { agent: { maxTurns: 50 } });
  assert.equal(merged.agent.maxTurns, 50);
  assert.equal(validateSettings(merged).filter((i) => i.severity === "error").length, 0);

  // 2. Memory operations
  const { writeMemory, readMemory, listMemories } = require("../src/memory");
  writeMemory("project-config", "Use TypeScript strict mode", settings);
  writeMemory("auth-config", "JWT expiry: 15m", settings);

  assert.equal(listMemories(settings).length, 2);
  assert.equal(readMemory("auth-config", settings).content, "JWT expiry: 15m");

  // 3. UndoStack with real file
  const { UndoStack } = require("../src/undo-stack");
  const configPath = path.join(projectRoot, "tsconfig.json");
  fs.writeFileSync(configPath, JSON.stringify({ strict: false }), "utf8");

  const undoStack = new UndoStack();
  undoStack.push({
    filePath: configPath,
    originalContent: JSON.stringify({ strict: false }),
    newContent: JSON.stringify({ strict: true }),
    toolName: "file.edit",
  });

  // 4. Plugin registry watches
  const { PluginRegistry } = require("../src/plugins");
  const pluginEvents = [];
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register({
    name: "cross-auditor",
    hooks: {
      beforeToolCall(ctx) { pluginEvents.push("before:" + ctx.toolName); return ctx; },
      afterToolCall(ctx) { pluginEvents.push("after:" + ctx.toolName); return ctx; },
    },
  });

  // 5. Simulate tool execution with plugin hooks
  await pluginRegistry.runHook("beforeToolCall", { toolName: "file.edit" });
  pluginEvents.push("tool:execute");
  const newContent = JSON.stringify({ strict: true });
  fs.writeFileSync(configPath, newContent, "utf8");
  await pluginRegistry.runHook("afterToolCall", { toolName: "file.edit", result: { ok: true } });

  // 6. Undo the change
  await undoStack.undo();
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).strict, false);

  // 7. Verify everything
  assert.deepEqual(pluginEvents, [
    "before:file.edit", "tool:execute", "after:file.edit",
  ]);
  assert.equal(undoStack.canRedo(), true);

  const mem = readMemory("project-config", settings);
  assert.equal(mem.content, "Use TypeScript strict mode");
});

test("cross-cutting: undoStack clear + memory delete + plugin unregister all clean up", () => {
  const { settings } = createFixture();
  const { UndoStack } = require("../src/undo-stack");
  const { PluginRegistry } = require("../src/plugins");
  const { writeMemory, deleteMemory, listMemories } = require("../src/memory");

  // Create and clean up undo
  const undoStack = new UndoStack();
  undoStack.push({ filePath: "/tmp/test.txt", originalContent: "a", newContent: "b" });
  undoStack.push({ filePath: "/tmp/test.txt", originalContent: "b", newContent: "c" });
  undoStack.clear();
  assert.equal(undoStack.canUndo(), false);
  assert.equal(undoStack.canRedo(), false);

  // Create and clean up plugin
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register({
    name: "temp-plugin",
    hooks: { beforeToolCall(ctx) { return ctx; } },
  });
  assert.equal(pluginRegistry.getHookCount(), 1);
  pluginRegistry.unregister("temp-plugin");
  assert.equal(pluginRegistry.getHookCount(), 0);

  // Create and clean up memory
  writeMemory("temp-mem", "to be deleted", settings);
  assert.equal(listMemories(settings).length, 1);
  deleteMemory("temp-mem", settings);
  assert.equal(listMemories(settings).length, 0);
});

test("cross-cutting: DEFAULT_SETTINGS never regresses against validator", () => {
  const { DEFAULT_SETTINGS } = require("../src/config");
  const { validateSettings } = require("../src/config-validator");

  const issues = validateSettings(DEFAULT_SETTINGS);
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0,
    `DEFAULT_SETTINGS has ${errors.length} validator errors: ${JSON.stringify(errors)}. Fix DEFAULT_SETTINGS or update RULES.`);
});
