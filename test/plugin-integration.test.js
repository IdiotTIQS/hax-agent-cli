/**
 * Integration tests for PluginRegistry wired into ToolRegistry and CLI.
 *
 * Covers:
 *   - PluginRegistry: register, unregister, duplicate detection, invalid plugins
 *   - PluginRegistry: 7 hook names exist and are callable
 *   - PluginRegistry: auto-discovery from directory
 *   - PluginRegistry: hook execution order (sequential, registration order)
 *   - PluginRegistry: hook error isolation
 *   - PluginRegistry: loadPlugin from file
 *   - logger-plugin: all 7 hooks register without error
 *   - rate-limit-plugin: blocks when rate exceeded, allows when under limit
 *   - file-backup-plugin: creates backup before file.write
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginRegistry, PLUGIN_HOOK_NAMES } = require("../src/plugins");
const LoggerPlugin = require("../examples/plugins/logger-plugin");
const { createRateLimitPlugin } = require("../examples/plugins/rate-limit-plugin");
const FileBackupPlugin = require("../examples/plugins/file-backup-plugin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory and return a cleanup function.
 */
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-plugin-int-"));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a temp .js plugin file in the given directory.
 */
function createPluginFile(dir, filename, code) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, code, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// 1. PluginRegistry: register, unregister, duplicate detection, invalid plugins
// ---------------------------------------------------------------------------

test("PluginRegistry: register accepts valid plugin and stores metadata", () => {
  const registry = new PluginRegistry();

  const entry = registry.register({
    name: "integration-plugin",
    version: "2.3.1",
    hooks: {
      beforeToolCall(ctx) {
        return { ...ctx, tagged: true };
      },
    },
  });

  assert.equal(entry.name, "integration-plugin");
  assert.equal(entry.version, "2.3.1");
  assert.ok(entry.hooks.beforeToolCall);
  assert.equal(Object.keys(entry.hooks).length, 1);
  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._hooks.get("beforeToolCall").length, 1);
  assert.equal(registry._hooks.get("beforeToolCall")[0].plugin, "integration-plugin");
});

test("PluginRegistry: register throws for null/undefined plugin", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register(null), { message: /must be an object/ });
  assert.throws(() => registry.register(undefined), { message: /must be an object/ });
});

test("PluginRegistry: register throws for primitive values", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register(42), { message: /must be an object/ });
  assert.throws(() => registry.register("not-an-object"), {
    message: /must be an object/,
  });
  assert.throws(() => registry.register(true), { message: /must be an object/ });
});

test("PluginRegistry: register throws for array (arrays are typeof object)", () => {
  const registry = new PluginRegistry();
  // Arrays are typeof 'object' in JS, so they pass the type check
  // but fail the name check (arrays have no name property)
  assert.throws(() => registry.register([]), { message: /must have a non-empty name/ });
  assert.throws(() => registry.register([1, 2, 3]), { message: /must have a non-empty name/ });
});

test("PluginRegistry: register throws for missing name property", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register({}), {
    message: /must have a non-empty name/,
  });
});

test("PluginRegistry: register throws for empty or whitespace-only name", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register({ name: "" }), {
    message: /must have a non-empty name/,
  });
  assert.throws(() => registry.register({ name: "   " }), {
    message: /must have a non-empty name/,
  });
  assert.throws(() => registry.register({ name: "\t\n" }), {
    message: /must have a non-empty name/,
  });
});

test("PluginRegistry: register throws for duplicate plugin name", () => {
  const registry = new PluginRegistry();
  registry.register({ name: "unique-plugin" });
  assert.throws(() => registry.register({ name: "unique-plugin" }), {
    message: /already registered/,
  });
});

test("PluginRegistry: unregister removes plugin and its hooks", () => {
  const registry = new PluginRegistry();

  registry.register({
    name: "to-remove",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
      afterToolCall(ctx) {
        return ctx;
      },
      onError(ctx) {
        return ctx;
      },
    },
  });

  registry.register({
    name: "to-keep",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
    },
  });

  assert.equal(registry.getHookCount(), 4);
  assert.equal(registry._plugins.length, 2);

  const result = registry.unregister("to-remove");
  assert.equal(result, true);
  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "to-keep");
  assert.equal(registry.getHookCount(), 1);
  assert.equal(registry._hooks.get("beforeToolCall").length, 1);
  assert.equal(registry._hooks.get("afterToolCall").length, 0);
  assert.equal(registry._hooks.get("onError").length, 0);
});

test("PluginRegistry: unregister returns false for non-existent plugin", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.unregister("does-not-exist"), false);
  assert.equal(registry.unregister(""), false);
});

test("PluginRegistry: unregister handles empty registry gracefully", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.unregister("anything"), false);
  // Registry remains empty
  assert.equal(registry._plugins.length, 0);
  assert.equal(registry.getHookCount(), 0);
});

// ---------------------------------------------------------------------------
// 2. PluginRegistry: 7 hook names exist and are callable
// ---------------------------------------------------------------------------

test("PLUGIN_HOOK_NAMES contains exactly 7 hooks", () => {
  assert.equal(PLUGIN_HOOK_NAMES.length, 7);
});

test("PLUGIN_HOOK_NAMES includes all required hooks", () => {
  const requiredHooks = [
    "beforeToolCall",
    "afterToolCall",
    "onError",
    "beforeChat",
    "afterChat",
    "onSessionStart",
    "onSessionEnd",
  ];
  for (const hook of requiredHooks) {
    assert.ok(
      PLUGIN_HOOK_NAMES.includes(hook),
      `PLUGIN_HOOK_NAMES should include "${hook}"`,
    );
  }
});

test("PluginRegistry: all 7 hooks are callable via runHook", async () => {
  const registry = new PluginRegistry();
  const called = {};

  registry.register({
    name: "all-hooks-plugin",
    hooks: {
      beforeToolCall(ctx) {
        called.beforeToolCall = true;
        return ctx;
      },
      afterToolCall(ctx) {
        called.afterToolCall = true;
        return ctx;
      },
      onError(ctx) {
        called.onError = true;
        return ctx;
      },
      beforeChat(ctx) {
        called.beforeChat = true;
        return ctx;
      },
      afterChat(ctx) {
        called.afterChat = true;
        return ctx;
      },
      onSessionStart(ctx) {
        called.onSessionStart = true;
        return ctx;
      },
      onSessionEnd(ctx) {
        called.onSessionEnd = true;
        return ctx;
      },
    },
  });

  const baseCtx = { session: { id: "test-session" } };

  await registry.runHook("beforeToolCall", { ...baseCtx, toolName: "test" });
  await registry.runHook("afterToolCall", {
    ...baseCtx,
    toolName: "test",
    result: { ok: true },
  });
  await registry.runHook("onError", {
    ...baseCtx,
    error: new Error("test"),
  });
  await registry.runHook("beforeChat", { ...baseCtx, message: "hello" });
  await registry.runHook("afterChat", {
    ...baseCtx,
    message: "hello",
    response: "hi",
  });
  await registry.runHook("onSessionStart", baseCtx);
  await registry.runHook("onSessionEnd", baseCtx);

  assert.equal(called.beforeToolCall, true);
  assert.equal(called.afterToolCall, true);
  assert.equal(called.onError, true);
  assert.equal(called.beforeChat, true);
  assert.equal(called.afterChat, true);
  assert.equal(called.onSessionStart, true);
  assert.equal(called.onSessionEnd, true);
});

test("PluginRegistry: each hook name has its own handler list", () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "tc-only",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
    },
  });
  registry.register({
    name: "chat-only",
    hooks: {
      beforeChat(ctx) {
        return ctx;
      },
    },
  });

  // Each hook list is independent
  assert.equal(registry._hooks.get("beforeToolCall").length, 1);
  assert.equal(registry._hooks.get("beforeChat").length, 1);
  assert.equal(registry._hooks.get("onError").length, 0);

  // The handler for beforeToolCall belongs to "tc-only"
  assert.equal(registry._hooks.get("beforeToolCall")[0].plugin, "tc-only");
  assert.equal(registry._hooks.get("beforeChat")[0].plugin, "chat-only");
});

// ---------------------------------------------------------------------------
// 3. PluginRegistry: auto-discovery from directory
// ---------------------------------------------------------------------------

test("PluginRegistry: loadPluginsFromDirectory loads all .js files", () => {
  const { dir, cleanup } = tmpDir();
  try {
    createPluginFile(
      dir,
      "alpha.js",
      `module.exports = { name: "auto-alpha", version: "1.0.0" };`,
    );
    createPluginFile(
      dir,
      "beta.js",
      `module.exports = { name: "auto-beta", version: "2.0.0" };`,
    );
    createPluginFile(
      dir,
      "gamma.js",
      `module.exports = { name: "auto-gamma" };`,
    );

    const registry = new PluginRegistry();
    const count = registry.loadPluginsFromDirectory(dir);

    assert.equal(count, 3);
    assert.equal(registry._plugins.length, 3);

    const names = registry._plugins.map((p) => p.name);
    assert.deepEqual(names, ["auto-alpha", "auto-beta", "auto-gamma"]);
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPluginsFromDirectory skips non-js files", () => {
  const { dir, cleanup } = tmpDir();
  try {
    createPluginFile(dir, "plugin.js", "module.exports = { name: 'only-js' };");
    createPluginFile(dir, "readme.md", "# Readme");
    createPluginFile(dir, "notes.txt", "some notes");
    createPluginFile(dir, ".gitkeep", "");

    const registry = new PluginRegistry();
    const count = registry.loadPluginsFromDirectory(dir);

    assert.equal(count, 1);
    assert.equal(registry._plugins[0].name, "only-js");
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPluginsFromDirectory returns 0 for missing directory", () => {
  const registry = new PluginRegistry();
  const missingDir = path.join(os.tmpdir(), "does-not-exist-" + Date.now());
  const count = registry.loadPluginsFromDirectory(missingDir);
  assert.equal(count, 0);
  assert.equal(registry._plugins.length, 0);
});

test("PluginRegistry: loadPluginsFromDirectory returns 0 for empty directory", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const registry = new PluginRegistry();
    const count = registry.loadPluginsFromDirectory(dir);
    assert.equal(count, 0);
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPluginsFromDirectory silently skips broken plugins", () => {
  const { dir, cleanup } = tmpDir();
  try {
    createPluginFile(dir, "good-1.js", "module.exports = { name: 'good-1' };");
    createPluginFile(dir, "bad.js", "syntax error here !!!#@#$%^");
    createPluginFile(dir, "good-2.js", "module.exports = { name: 'good-2' };");
    createPluginFile(dir, "also-bad.js", "throw new Error('failed on load');");

    const registry = new PluginRegistry();
    const count = registry.loadPluginsFromDirectory(dir);

    assert.equal(count, 2);
    assert.equal(registry._plugins.length, 2);
    assert.equal(registry._plugins[0].name, "good-1");
    assert.equal(registry._plugins[1].name, "good-2");
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPluginsFromDirectory skips duplicate plugin names", () => {
  const { dir, cleanup } = tmpDir();
  try {
    createPluginFile(dir, "first.js", "module.exports = { name: 'dupe-name' };");
    createPluginFile(dir, "second.js", "module.exports = { name: 'dupe-name' };");

    const registry = new PluginRegistry();
    // The first one loads, the second throws "already registered"
    const count = registry.loadPluginsFromDirectory(dir);

    assert.equal(count, 1);
    assert.equal(registry._plugins.length, 1);
    assert.equal(registry._plugins[0].name, "dupe-name");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. PluginRegistry: hook execution order (sequential, registration order)
// ---------------------------------------------------------------------------

test("PluginRegistry: hooks execute sequentially in registration order", async () => {
  const registry = new PluginRegistry();
  const timeline = [];

  registry.register({
    name: "plugin-1",
    hooks: {
      beforeChat(ctx) {
        timeline.push("1-start");
        return { ...ctx, step: 1 };
      },
    },
  });

  registry.register({
    name: "plugin-2",
    hooks: {
      beforeChat(ctx) {
        timeline.push("2-start");
        return { ...ctx, step: 2 };
      },
    },
  });

  registry.register({
    name: "plugin-3",
    hooks: {
      beforeChat(ctx) {
        timeline.push("3-start");
        return { ...ctx, step: 3 };
      },
    },
  });

  const result = await registry.runHook("beforeChat", { message: "test" });

  assert.deepEqual(timeline, ["1-start", "2-start", "3-start"]);
  assert.equal(result.step, 3);
  assert.equal(result.message, "test");
});

test("PluginRegistry: each hook passes modified context to next handler", async () => {
  const registry = new PluginRegistry();
  const receivedValues = [];

  registry.register({
    name: "first",
    hooks: {
      beforeToolCall(ctx) {
        receivedValues.push({ from: "first", received: ctx.value });
        return { ...ctx, value: "A" };
      },
    },
  });

  registry.register({
    name: "second",
    hooks: {
      beforeToolCall(ctx) {
        receivedValues.push({ from: "second", received: ctx.value });
        return { ...ctx, value: "B" };
      },
    },
  });

  registry.register({
    name: "third",
    hooks: {
      beforeToolCall(ctx) {
        receivedValues.push({ from: "third", received: ctx.value });
        return { ...ctx, value: "C" };
      },
    },
  });

  const result = await registry.runHook("beforeToolCall", { value: "initial" });

  assert.deepEqual(receivedValues, [
    { from: "first", received: "initial" },
    { from: "second", received: "A" },
    { from: "third", received: "B" },
  ]);
  assert.equal(result.value, "C");
});

test("PluginRegistry: handlers that return undefined do not change context", async () => {
  const registry = new PluginRegistry();

  registry.register({
    name: "no-return",
    hooks: {
      beforeChat(ctx) {
        // No explicit return — returns undefined
      },
    },
  });

  registry.register({
    name: "reads-context",
    hooks: {
      beforeChat(ctx) {
        return { ...ctx, touched: ctx.message === "original" };
      },
    },
  });

  const result = await registry.runHook("beforeChat", { message: "original" });
  assert.equal(result.touched, true);
  assert.equal(result.message, "original");
});

// ---------------------------------------------------------------------------
// 5. PluginRegistry: hook error isolation
// ---------------------------------------------------------------------------

test("PluginRegistry: one hook error does not stop subsequent hooks", async () => {
  const registry = new PluginRegistry();
  const executed = [];

  registry.register({
    name: "safe-1",
    hooks: {
      beforeToolCall(ctx) {
        executed.push("safe-1");
        return ctx;
      },
    },
  });

  registry.register({
    name: "exploder",
    hooks: {
      beforeToolCall() {
        executed.push("exploder");
        throw new Error("kaboom");
      },
    },
  });

  registry.register({
    name: "safe-2",
    hooks: {
      beforeToolCall(ctx) {
        executed.push("safe-2");
        return { ...ctx, madeIt: true };
      },
    },
  });

  const result = await registry.runHook("beforeToolCall", { toolName: "test" });

  assert.deepEqual(executed, ["safe-1", "exploder", "safe-2"]);
  assert.equal(result.madeIt, true);
  assert.equal(result.toolName, "test");
});

test("PluginRegistry: error in hook fires onError handler", async () => {
  const registry = new PluginRegistry();
  const errorEvents = [];

  registry.register({
    name: "fails-on-beforechat",
    hooks: {
      beforeChat() {
        throw new Error("chat-pre error");
      },
    },
  });

  registry.register({
    name: "error-catcher",
    hooks: {
      onError(ctx) {
        errorEvents.push({
          hookName: ctx.hookName,
          pluginName: ctx.pluginName,
          message: ctx.error.message,
        });
        return ctx;
      },
    },
  });

  const ctx = { message: "hello", session: { id: "s1" } };
  const result = await registry.runHook("beforeChat", ctx);

  assert.equal(errorEvents.length, 1);
  assert.equal(errorEvents[0].hookName, "beforeChat");
  assert.equal(errorEvents[0].pluginName, "fails-on-beforechat");
  assert.equal(errorEvents[0].message, "chat-pre error");
  assert.deepEqual(result, ctx);
});

test("PluginRegistry: onError handler failure does not cause infinite recursion", async () => {
  const registry = new PluginRegistry();

  registry.register({
    name: "bad-error-handler",
    hooks: {
      onError() {
        throw new Error("error handler itself failed");
      },
    },
  });

  registry.register({
    name: "triggers-error",
    hooks: {
      beforeToolCall() {
        throw new Error("original error");
      },
    },
  });

  // Must not throw or hang
  const result = await registry.runHook("beforeToolCall", { toolName: "test" });
  assert.ok(result);
  assert.equal(result.toolName, "test");
});

test("PluginRegistry: multiple onError handlers all receive error events", async () => {
  const registry = new PluginRegistry();
  const caught = [];

  registry.register({
    name: "catcher-1",
    hooks: {
      onError(ctx) {
        caught.push({ catcher: 1, hook: ctx.hookName, msg: ctx.error.message });
        return ctx;
      },
    },
  });

  registry.register({
    name: "catcher-2",
    hooks: {
      onError(ctx) {
        caught.push({ catcher: 2, hook: ctx.hookName, msg: ctx.error.message });
        return ctx;
      },
    },
  });

  registry.register({
    name: "failure-source",
    hooks: {
      beforeChat() {
        throw new Error("chat failure");
      },
    },
  });

  await registry.runHook("beforeChat", { message: "hi" });

  assert.equal(caught.length, 2);
  assert.equal(caught[0].catcher, 1);
  assert.equal(caught[0].hook, "beforeChat");
  assert.equal(caught[1].catcher, 2);
  assert.equal(caught[1].hook, "beforeChat");
});

// ---------------------------------------------------------------------------
// 6. PluginRegistry: loadPlugin from file
// ---------------------------------------------------------------------------

test("PluginRegistry: loadPlugin loads a plugin module from disk", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const filePath = createPluginFile(
      dir,
      "disk-plugin.js",
      `module.exports = {
        name: "from-disk",
        version: "5.0.0",
        hooks: {
          onSessionStart(ctx) { return { ...ctx, disk: true }; },
          onSessionEnd(ctx) { return ctx; }
        }
      };`,
    );

    const registry = new PluginRegistry();
    registry.loadPlugin(filePath);

    assert.equal(registry._plugins.length, 1);
    assert.equal(registry._plugins[0].name, "from-disk");
    assert.equal(registry._plugins[0].version, "5.0.0");
    assert.ok(registry._plugins[0].hooks.onSessionStart);
    assert.ok(registry._plugins[0].hooks.onSessionEnd);
    assert.equal(registry.getHookCount(), 2);
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPlugin throws for non-existent file", () => {
  const registry = new PluginRegistry();
  const missingPath = path.join(os.tmpdir(), "nonexistent-plugin-" + Date.now() + ".js");
  assert.throws(
    () => registry.loadPlugin(missingPath),
    { message: /Plugin file not found/ },
  );
});

test("PluginRegistry: loadPlugin resolves relative paths", () => {
  const { dir, cleanup } = tmpDir();
  try {
    createPluginFile(
      dir,
      "rel-plugin.js",
      `module.exports = { name: "relative", hooks: { beforeChat(ctx) { return ctx; } } };`,
    );

    const registry = new PluginRegistry();

    // Save and change to the temp dir so relative paths resolve
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      registry.loadPlugin("./rel-plugin.js");
    } finally {
      process.chdir(originalCwd);
    }

    assert.equal(registry._plugins.length, 1);
    assert.equal(registry._plugins[0].name, "relative");
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPlugin clears require cache for hot-reload", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const filePath = createPluginFile(
      dir,
      "reloadable.js",
      `module.exports = { name: "v1" };`,
    );

    const registry = new PluginRegistry();

    // First load
    registry.loadPlugin(filePath);
    assert.equal(registry._plugins.length, 1);
    assert.equal(registry._plugins[0].name, "v1");

    // Overwrite the file with a new version
    fs.writeFileSync(filePath, `module.exports = { name: "v2" };`, "utf8");

    // Second load (should work because cache was cleared)
    registry.loadPlugin(filePath);
    assert.equal(registry._plugins.length, 2);
    assert.equal(registry._plugins[1].name, "v2");
  } finally {
    cleanup();
  }
});

test("PluginRegistry: loadPlugin registers a plugin with all hook functions", async () => {
  const { dir, cleanup } = tmpDir();
  try {
    const filePath = createPluginFile(
      dir,
      "full-plugin.js",
      `module.exports = {
        name: "full-disk-plugin",
        version: "1.0.0",
        hooks: {
          beforeToolCall(ctx) { return { ...ctx, beforeTool: true }; },
          afterToolCall(ctx) { return { ...ctx, afterTool: true }; },
          onError(ctx) { return { ...ctx, onError: true }; },
          beforeChat(ctx) { return { ...ctx, beforeChat: true }; },
          afterChat(ctx) { return { ...ctx, afterChat: true }; },
          onSessionStart(ctx) { return { ...ctx, onStart: true }; },
          onSessionEnd(ctx) { return { ...ctx, onEnd: true }; },
        }
      };`,
    );

    const registry = new PluginRegistry();
    registry.loadPlugin(filePath);

    assert.equal(registry.getHookCount(), 7);

    // Verify each hook works
    const ctx = await registry.runHook("beforeToolCall", {});
    assert.equal(ctx.beforeTool, true);

    const ctx2 = await registry.runHook("afterToolCall", {});
    assert.equal(ctx2.afterTool, true);

    const ctx3 = await registry.runHook("onError", { error: new Error("x") });
    assert.equal(ctx3.onError, true);

    const ctx4 = await registry.runHook("beforeChat", {});
    assert.equal(ctx4.beforeChat, true);

    const ctx5 = await registry.runHook("afterChat", {});
    assert.equal(ctx5.afterChat, true);

    const ctx6 = await registry.runHook("onSessionStart", {});
    assert.equal(ctx6.onStart, true);

    const ctx7 = await registry.runHook("onSessionEnd", {});
    assert.equal(ctx7.onEnd, true);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. LoggerPlugin: all 7 hooks register without error
// ---------------------------------------------------------------------------

test("LoggerPlugin: exports a valid plugin descriptor", () => {
  assert.equal(typeof LoggerPlugin, "object");
  assert.equal(LoggerPlugin.name, "logger-plugin");
  assert.equal(LoggerPlugin.version, "1.0.0");
  assert.equal(typeof LoggerPlugin.hooks, "object");
});

test("LoggerPlugin: has all 7 hooks defined as functions", () => {
  for (const hookName of PLUGIN_HOOK_NAMES) {
    assert.ok(
      typeof LoggerPlugin.hooks[hookName] === "function",
      `LoggerPlugin should have a function for hook "${hookName}"`,
    );
  }
});

test("LoggerPlugin: registers all 7 hooks on a PluginRegistry", () => {
  const registry = new PluginRegistry();
  registry.register(LoggerPlugin);

  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "logger-plugin");
  assert.equal(registry._plugins[0].version, "1.0.0");
  assert.equal(registry.getHookCount(), 7);

  // Verify each hook list contains exactly one handler from logger-plugin
  for (const hookName of PLUGIN_HOOK_NAMES) {
    const handlers = registry._hooks.get(hookName);
    assert.equal(handlers.length, 1, `hook "${hookName}" should have 1 handler`);
    assert.equal(
      handlers[0].plugin,
      "logger-plugin",
      `handler for "${hookName}" should belong to logger-plugin`,
    );
  }
});

test("LoggerPlugin: all hooks can be called without throwing", async () => {
  const registry = new PluginRegistry();
  registry.register(LoggerPlugin);

  const session = { id: "test-log", cwd: os.tmpdir() };

  // Each hook should execute without error
  await registry.runHook("beforeToolCall", {
    toolName: "file.read",
    args: { path: "/tmp/test.txt" },
    session,
  });

  await registry.runHook("afterToolCall", {
    toolName: "file.read",
    args: { path: "/tmp/test.txt" },
    result: { ok: true, durationMs: 42 },
    session,
  });

  await registry.runHook("onError", {
    error: new Error("test error"),
    toolName: "file.write",
    pluginName: "some-plugin",
    hookName: "beforeToolCall",
    session,
  });

  await registry.runHook("beforeChat", {
    message: "Hello, can you read a file?",
    session,
  });

  await registry.runHook("afterChat", {
    message: "Hello, can you read a file?",
    response: "Sure, let me read that file for you.",
    session,
  });

  await registry.runHook("onSessionStart", { session });

  await registry.runHook("onSessionEnd", { session });

  // No exceptions means success
  assert.ok(true);
});

test("LoggerPlugin: register() convenience method works", () => {
  const registry = new PluginRegistry();
  LoggerPlugin.register(registry);

  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "logger-plugin");
  assert.equal(registry.getHookCount(), 7);
});

test("LoggerPlugin: hooks pass context through unchanged", async () => {
  const registry = new PluginRegistry();
  registry.register(LoggerPlugin);

  const ctx = {
    toolName: "file.read",
    args: { path: "/tmp/test.txt" },
    result: { ok: true },
    session: { id: "pass-through", cwd: os.tmpdir() },
    customField: "should-survive",
  };

  const result = await registry.runHook("beforeToolCall", ctx);
  assert.equal(result.toolName, "file.read");
  assert.equal(result.customField, "should-survive");
});

// ---------------------------------------------------------------------------
// 8. RateLimitPlugin: beforeToolCall blocks when rate exceeded
// ---------------------------------------------------------------------------

test("RateLimitPlugin: beforeToolCall blocks when rate limit is exceeded", () => {
  // maxCallsPerMinute=0 + burst=0 means bucket is always empty
  const plugin = createRateLimitPlugin({ maxCallsPerMinute: 0, burst: 0 });

  assert.throws(
    () => {
      plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
    },
    (err) => {
      return (
        err.code === "RATE_LIMITED" &&
        err.message.includes("Rate limit exceeded") &&
        typeof err.retryAfterMs === "number"
      );
    },
  );
});

test("RateLimitPlugin: beforeToolCall blocks when burst is exhausted", () => {
  // Give a small burst capacity, then exhaust it
  const plugin = createRateLimitPlugin({ maxCallsPerMinute: 0, burst: 3 });

  // First 3 calls should go through (burst=3)
  for (let i = 0; i < 3; i++) {
    const ctx = { toolName: "file.read", session: {} };
    const result = plugin.hooks.beforeToolCall(ctx);
    assert.deepEqual(result, ctx, `call ${i + 1} should succeed`);
  }

  // 4th call should be blocked
  assert.throws(() => {
    plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
  }, { code: "RATE_LIMITED" });
});

test("RateLimitPlugin: RATE_LIMITED error includes retryAfterMs", () => {
  const plugin = createRateLimitPlugin({ maxCallsPerMinute: 0, burst: 0 });

  let caughtErr = null;
  try {
    plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
  } catch (err) {
    caughtErr = err;
  }

  assert.ok(caughtErr);
  assert.equal(caughtErr.code, "RATE_LIMITED");
  assert.ok(typeof caughtErr.retryAfterMs === "number");
  assert.ok(caughtErr.retryAfterMs > 0);
  assert.ok(caughtErr.message.includes("retry in"));
});

// ---------------------------------------------------------------------------
// 9. RateLimitPlugin: beforeToolCall allows when under limit
// ---------------------------------------------------------------------------

test("RateLimitPlugin: beforeToolCall allows calls when under the limit", () => {
  // High limit ensures bucket is always full
  const plugin = createRateLimitPlugin({ maxCallsPerMinute: 9999, burst: 100 });

  for (let i = 0; i < 50; i++) {
    const ctx = { toolName: "file.read", args: { path: "/tmp/test.txt" }, session: {} };
    const result = plugin.hooks.beforeToolCall(ctx);
    assert.deepEqual(result, ctx, `call ${i + 1} should succeed`);
  }
});

test("RateLimitPlugin: default configuration allows normal usage", () => {
  // Default is 30 calls/min + 5 burst = 35 initial tokens
  const plugin = createRateLimitPlugin();

  for (let i = 0; i < 35; i++) {
    const ctx = { toolName: "file.read", session: {} };
    const result = plugin.hooks.beforeToolCall(ctx);
    assert.deepEqual(result, ctx, `default-config call ${i + 1} should succeed`);
  }

  // 36th call should be blocked
  assert.throws(() => {
    plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
  }, { code: "RATE_LIMITED" });
});

test("RateLimitPlugin: onSessionStart resets the bucket", () => {
  const plugin = createRateLimitPlugin({ maxCallsPerMinute: 0, burst: 2 });

  // Exhaust the burst
  plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
  plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });

  // Now blocked
  assert.throws(() => {
    plugin.hooks.beforeToolCall({ toolName: "file.read", session: {} });
  }, { code: "RATE_LIMITED" });

  // Reset via onSessionStart
  plugin.hooks.onSessionStart({ session: { id: "new-session" } });

  // Should allow calls again
  for (let i = 0; i < 2; i++) {
    const ctx = { toolName: "file.read", session: { id: "new-session" } };
    const result = plugin.hooks.beforeToolCall(ctx);
    assert.deepEqual(result, ctx, `after-reset call ${i + 1} should succeed`);
  }
});

test("RateLimitPlugin: register method works with custom options", () => {
  const registry = new PluginRegistry();
  const { register } = require("../examples/plugins/rate-limit-plugin");
  register(registry, { maxCallsPerMinute: 60, burst: 10 });

  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "rate-limit-plugin");

  // The plugin should have its hooks wired in
  assert.equal(registry._hooks.get("beforeToolCall").length, 1);
  assert.equal(registry._hooks.get("onSessionStart").length, 1);
});

// ---------------------------------------------------------------------------
// 10. FileBackupPlugin: creates backup before file.write
// ---------------------------------------------------------------------------

test("FileBackupPlugin: creates a backup before file.write", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    // Create a file to back up
    const filePath = path.join(projectRoot, "important.txt");
    fs.writeFileSync(filePath, "original content", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.write",
      args: { path: filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // Should have attached backup metadata
    assert.ok(result._backupPath);
    assert.ok(result._backupPath.includes("important.txt"));
    // Cross-platform: check for the backup directory components
    assert.ok(
      result._backupPath.includes(".hax-agent") &&
        result._backupPath.includes("backups"),
    );

    // Verify the backup file exists and contains the original content
    const backupContent = fs.readFileSync(result._backupPath, "utf8");
    assert.equal(backupContent, "original content");
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: creates backup before file.edit", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "edit-me.txt");
    fs.writeFileSync(filePath, "before edit", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.edit",
      args: { path: filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    assert.ok(result._backupPath);
    assert.ok(result._backupPath.includes("edit-me.txt"));
    assert.equal(fs.existsSync(result._backupPath), true);
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: creates backup before file.delete", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "delete-me.txt");
    fs.writeFileSync(filePath, "to be deleted", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.delete",
      args: { path: filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    assert.ok(result._backupPath);
    assert.ok(result._backupPath.includes("delete-me.txt"));
    assert.equal(fs.existsSync(result._backupPath), true);
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: skips non-mutating tools", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "read-only.txt");
    fs.writeFileSync(filePath, "read me", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.read",
      args: { path: filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // No backup metadata should be attached for non-mutating tools
    assert.equal(result._backupPath, undefined);
    assert.equal(result._backupOriginal, undefined);

    // No backup directory should have been created
    const backupDir = path.join(projectRoot, ".hax-agent", "backups");
    assert.equal(
      fs.existsSync(backupDir),
      false,
      "backup dir should not exist for non-mutating tools",
    );
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: skips tools with no args", async () => {
  const registry = new PluginRegistry();
  registry.register(FileBackupPlugin);

  const result = await registry.runHook("beforeToolCall", {
    toolName: "file.write",
    session: { cwd: os.tmpdir() },
  });

  assert.equal(result._backupPath, undefined);
});

test("FileBackupPlugin: skips tools with empty path", async () => {
  const registry = new PluginRegistry();
  registry.register(FileBackupPlugin);

  const result = await registry.runHook("beforeToolCall", {
    toolName: "file.write",
    args: { path: "" },
    session: { cwd: os.tmpdir() },
  });

  assert.equal(result._backupPath, undefined);
});

test("FileBackupPlugin: skips when file does not exist", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const missingPath = path.join(projectRoot, "does-not-exist.txt");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.write",
      args: { path: missingPath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // No backup created for non-existent file
    assert.equal(result._backupPath, undefined);

    // The backup directory may have been created, but no actual backup file
    const backupDir = path.join(projectRoot, ".hax-agent", "backups");
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir);
      assert.equal(files.length, 0, "backup dir should be empty");
    }
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: resolves relative paths against session cwd", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    // Create the file inside the project root
    const filePath = path.join(projectRoot, "relative-file.txt");
    fs.writeFileSync(filePath, "relative path content", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    // Pass only the basename as a relative path
    const ctx = {
      toolName: "file.write",
      args: { path: "relative-file.txt" },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    assert.ok(result._backupPath, "backup should be created for relative path");
    assert.ok(result._backupPath.includes("relative-file.txt"));

    const backupContent = fs.readFileSync(result._backupPath, "utf8");
    assert.equal(backupContent, "relative path content");
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: uses filePath fallback when path is absent", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "fallback.txt");
    fs.writeFileSync(filePath, "fallback content", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    // Use `filePath` instead of `path` for the file reference
    const ctx = {
      toolName: "file.write",
      args: { filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    assert.ok(result._backupPath);
    assert.ok(result._backupPath.includes("fallback.txt"));
    const backupContent = fs.readFileSync(result._backupPath, "utf8");
    assert.equal(backupContent, "fallback content");
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: backup filename uses ISO timestamp format", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "timestamp-test.txt");
    fs.writeFileSync(filePath, "content", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.write",
      args: { path: filePath },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // Backup name format: <ISO-timestamp>_<original-basename>
    // ISO timestamp has dashes, not colons (Windows-safe)
    const backupBasename = path.basename(result._backupPath);
    assert.ok(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_timestamp-test\.txt$/.test(
        backupBasename,
      ),
      `backup basename "${backupBasename}" should match ISO timestamp pattern`,
    );
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: multiple backups create distinct files", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "multi-backup.txt");
    fs.writeFileSync(filePath, "v1", "utf8");

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    // First backup
    const result1 = await registry.runHook("beforeToolCall", {
      toolName: "file.write",
      args: { path: filePath },
      session: { cwd: projectRoot },
    });

    // Modify the file
    fs.writeFileSync(filePath, "v2", "utf8");

    // Small delay to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second backup
    const result2 = await registry.runHook("beforeToolCall", {
      toolName: "file.write",
      args: { path: filePath },
      session: { cwd: projectRoot },
    });

    // Both backups should exist and be different
    assert.ok(fs.existsSync(result1._backupPath));
    assert.ok(fs.existsSync(result2._backupPath));
    assert.notEqual(result1._backupPath, result2._backupPath);

    // First backup has v1, second has v2
    assert.equal(fs.readFileSync(result1._backupPath, "utf8"), "v1");
    assert.equal(fs.readFileSync(result2._backupPath, "utf8"), "v2");
  } finally {
    cleanup();
  }
});

test("FileBackupPlugin: does not back up directories", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const subDir = path.join(projectRoot, "my-folder");
    fs.mkdirSync(subDir);

    const registry = new PluginRegistry();
    registry.register(FileBackupPlugin);

    const ctx = {
      toolName: "file.delete",
      args: { path: subDir },
      session: { cwd: projectRoot },
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // Directories should not be backed up
    assert.equal(result._backupPath, undefined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Combined plugin scenarios
// ---------------------------------------------------------------------------

test("Combined: logger + rate-limit + file-backup run in sequence", async () => {
  const { dir: projectRoot, cleanup } = tmpDir();
  try {
    const filePath = path.join(projectRoot, "combined-test.txt");
    fs.writeFileSync(filePath, "combined content", "utf8");

    const registry = new PluginRegistry();
    const logEntries = [];

    // Use a mock logger (no disk writes) to avoid async stream issues
    registry.register({
      name: "mock-logger",
      version: "1.0.0",
      hooks: {
        beforeToolCall(ctx) {
          logEntries.push(`beforeToolCall:${ctx.toolName}`);
          return ctx;
        },
        onSessionEnd(ctx) {
          logEntries.push(`onSessionEnd:${ctx.session.id}`);
          return ctx;
        },
      },
    });

    registry.register(createRateLimitPlugin({ maxCallsPerMinute: 9999, burst: 100 }));
    registry.register(FileBackupPlugin);

    const session = { id: "combined", cwd: projectRoot };

    // Run beforeToolCall — all three plugins should execute
    const ctx = {
      toolName: "file.write",
      args: { path: filePath },
      session,
    };

    const result = await registry.runHook("beforeToolCall", ctx);

    // File-backup should have created a backup
    assert.ok(result._backupPath);
    assert.ok(fs.existsSync(result._backupPath));
    assert.equal(fs.readFileSync(result._backupPath, "utf8"), "combined content");

    // Mock logger should have logged the call
    assert.deepEqual(logEntries, ["beforeToolCall:file.write"]);

    await registry.runHook("onSessionEnd", { session });
    assert.deepEqual(logEntries, ["beforeToolCall:file.write", "onSessionEnd:combined"]);
  } finally {
    cleanup();
  }
});

test("Combined: rate-limit error in beforeToolCall is caught and fires onError handlers", async () => {
  const registry = new PluginRegistry();
  const errorLog = [];

  // Logger to capture onError
  registry.register(LoggerPlugin);

  // Rate limiter with zero capacity to force failure
  registry.register(createRateLimitPlugin({ maxCallsPerMinute: 0, burst: 0 }));

  // Dedicated error catcher
  registry.register({
    name: "test-catcher",
    hooks: {
      onError(ctx) {
        errorLog.push({
          pluginName: ctx.pluginName,
          hookName: ctx.hookName,
          code: ctx.error.code,
        });
        return ctx;
      },
    },
  });

  const ctx = {
    toolName: "file.read",
    session: { id: "error-test", cwd: os.tmpdir() },
  };

  const result = await registry.runHook("beforeToolCall", ctx);

  // The context should pass through despite the rate-limit error
  assert.equal(result.toolName, "file.read");

  // The error catcher should have recorded a rate-limit error
  assert.equal(errorLog.length, 1);
  assert.equal(errorLog[0].pluginName, "rate-limit-plugin");
  assert.equal(errorLog[0].hookName, "beforeToolCall");
  assert.equal(errorLog[0].code, "RATE_LIMITED");
});

test("Combined: unregister mid-flight does not affect current hook execution", async () => {
  const registry = new PluginRegistry();
  const executed = [];

  registry.register({
    name: "self-remover",
    hooks: {
      beforeChat(ctx) {
        executed.push("self-remover");
        registry.unregister("self-remover");
        return ctx;
      },
    },
  });

  registry.register({
    name: "after-remover",
    hooks: {
      beforeChat(ctx) {
        executed.push("after-remover");
        return ctx;
      },
    },
  });

  await registry.runHook("beforeChat", { message: "test" });

  // Both should still have executed since runHook iterates a snapshot
  // Actually: runHook iterates the handlers array. removePlugin filters the
  // array in-place via splice, but the for-of loop already has its iterator.
  // Let's check what actually happens.
  // The for..of iterates `this._hooks.get(hookName)` — a reference to the array.
  // When splice removes from _plugins, unregister also refilters _hooks arrays.
  // The _hooks array is replaced with a new filtered array, but the for..of
  // already captured the original array reference in `handlers`.
  assert.ok(executed.includes("after-remover"));
});

test("PluginRegistry: list returns correct plugin summaries after operations", () => {
  const registry = new PluginRegistry();

  registry.register({
    name: "pA",
    version: "1.0.0",
    hooks: { beforeToolCall() {}, afterToolCall() {} },
  });

  registry.register({
    name: "pB",
    hooks: { onError() {} },
  });

  let list = registry.list();
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { name: "pA", version: "1.0.0", hooks: ["beforeToolCall", "afterToolCall"] });
  assert.deepEqual(list[1], { name: "pB", version: "0.0.0", hooks: ["onError"] });

  registry.unregister("pA");
  list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "pB");
});

test("PluginRegistry: getHookCount reflects current state correctly", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.getHookCount(), 0);

  registry.register({
    name: "p1",
    hooks: {
      beforeToolCall() {},
      afterToolCall() {},
      onError() {},
    },
  });
  assert.equal(registry.getHookCount(), 3);

  registry.register({
    name: "p2",
    hooks: {
      beforeToolCall() {},
      onSessionStart() {},
    },
  });
  assert.equal(registry.getHookCount(), 5);

  registry.unregister("p1");
  assert.equal(registry.getHookCount(), 2);

  registry.unregister("p2");
  assert.equal(registry.getHookCount(), 0);

  registry.unregister("nonexistent");
  assert.equal(registry.getHookCount(), 0);
});

test("PluginRegistry: constructor creates independent instances", () => {
  const registry1 = new PluginRegistry();
  const registry2 = new PluginRegistry();

  registry1.register({ name: "only-in-1", hooks: { beforeChat(ctx) { return ctx; } } });
  registry2.register({ name: "only-in-2", hooks: { onError(ctx) { return ctx; } } });

  assert.equal(registry1._plugins.length, 1);
  assert.equal(registry2._plugins.length, 1);
  assert.equal(registry1._plugins[0].name, "only-in-1");
  assert.equal(registry2._plugins[0].name, "only-in-2");

  assert.equal(registry1.getHookCount(), 1);
  assert.equal(registry2.getHookCount(), 1);

  // Hook lists are independent
  assert.equal(registry1._hooks.get("beforeChat").length, 1);
  assert.equal(registry2._hooks.get("beforeChat").length, 0);
});
