/**
 * Tests for PluginRegistry: register, loadPlugin, unregister,
 * runHook, list, getHookCount, loadPluginsFromDirectory.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginRegistry, PLUGIN_HOOK_NAMES } = require("../src/plugins");

test("PLUGIN_HOOK_NAMES includes all expected hooks", () => {
  assert.ok(PLUGIN_HOOK_NAMES.includes("beforeToolCall"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("afterToolCall"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("onError"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("beforeChat"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("afterChat"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("onSessionStart"));
  assert.ok(PLUGIN_HOOK_NAMES.includes("onSessionEnd"));
  assert.equal(PLUGIN_HOOK_NAMES.length, 7);
});

test("PluginRegistry: constructor initializes hooks for all names", () => {
  const registry = new PluginRegistry();
  for (const hook of PLUGIN_HOOK_NAMES) {
    assert.deepEqual(registry._hooks.get(hook), []);
  }
  assert.deepEqual(registry._plugins, []);
});

test("PluginRegistry: register throws for non-object", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register(null), { message: /must be an object/ });
  assert.throws(() => registry.register("string"), { message: /must be an object/ });
  assert.throws(() => registry.register(42), { message: /must be an object/ });
});

test("PluginRegistry: register throws for missing or empty name", () => {
  const registry = new PluginRegistry();
  assert.throws(() => registry.register({}), {
    message: /must have a non-empty name/,
  });
  assert.throws(() => registry.register({ name: "" }), {
    message: /must have a non-empty name/,
  });
  assert.throws(() => registry.register({ name: "  " }), {
    message: /must have a non-empty name/,
  });
});

test("PluginRegistry: register throws for duplicate plugin name", () => {
  const registry = new PluginRegistry();
  registry.register({ name: "test-plugin" });
  assert.throws(() => registry.register({ name: "test-plugin" }), {
    message: /already registered/,
  });
});

test("PluginRegistry: register stores plugin metadata", () => {
  const registry = new PluginRegistry();
  registry.register({ name: "test-plugin", version: "1.0.0" });

  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "test-plugin");
  assert.equal(registry._plugins[0].version, "1.0.0");
  assert.deepEqual(registry._plugins[0].hooks, {});
});

test("PluginRegistry: register uses default version", () => {
  const registry = new PluginRegistry();
  registry.register({ name: "no-version" });
  assert.equal(registry._plugins[0].version, "0.0.0");
});

test("PluginRegistry: register ignores non-function hooks", () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "bad-hooks",
    hooks: {
      beforeToolCall: "not a function",
      afterToolCall: 42,
      beforeChat() {
        return { modified: true };
      },
    },
  });

  assert.equal(registry._hooks.get("beforeToolCall").length, 0);
  assert.equal(registry._hooks.get("afterToolCall").length, 0);
  assert.equal(registry._hooks.get("beforeChat").length, 1);
  assert.equal(registry._hooks.get("beforeChat")[0].plugin, "bad-hooks");
});

test("PluginRegistry: register ignores unknown hook names", () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "custom-hook",
    hooks: {
      myCustomHook() {
        return true;
      },
    },
  });
  assert.equal(registry._plugins.length, 1);
  assert.deepEqual(registry._plugins[0].hooks, {});
});

test("PluginRegistry: runHook returns context unchanged when no handlers", async () => {
  const registry = new PluginRegistry();
  const ctx = { toolName: "file.read" };
  const result = await registry.runHook("beforeToolCall", ctx);
  assert.deepEqual(result, ctx);
  // When no handlers exist, the original reference is returned directly
  assert.strictEqual(result, ctx);
});

test("PluginRegistry: runHook returns context unchanged for unknown hook", async () => {
  const registry = new PluginRegistry();
  const ctx = { foo: "bar" };
  const result = await registry.runHook("nonExistentHook", ctx);
  assert.deepEqual(result, ctx);
});

test("PluginRegistry: runHook passes through null/undefined return values", async () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "pass-through",
    hooks: {
      beforeToolCall(ctx) {
        // Explicitly return null - should be ignored
        return null;
      },
    },
  });

  const ctx = { toolName: "file.read" };
  const result = await registry.runHook("beforeToolCall", ctx);
  assert.deepEqual(result, ctx);
});

test("PluginRegistry: runHook calls handlers in registration order", async () => {
  const registry = new PluginRegistry();
  const order = [];

  registry.register({
    name: "first",
    hooks: {
      beforeToolCall(ctx) {
        order.push("first");
        return { ...ctx, touched: "first" };
      },
    },
  });

  registry.register({
    name: "second",
    hooks: {
      beforeToolCall(ctx) {
        order.push("second");
        return { ...ctx, touched: "second" };
      },
    },
  });

  const result = await registry.runHook("beforeToolCall", { toolName: "test" });
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(result.touched, "second");
});

test("PluginRegistry: runHook swallows handler errors and fires onError", async () => {
  const registry = new PluginRegistry();
  const errors = [];

  registry.register({
    name: "erroring-plugin",
    hooks: {
      beforeToolCall() {
        throw new Error("boom");
      },
    },
  });

  registry.register({
    name: "error-handler",
    hooks: {
      onError(ctx) {
        errors.push({
          hookName: ctx.hookName,
          pluginName: ctx.pluginName,
          message: ctx.error.message,
        });
        return ctx;
      },
    },
  });

  const ctx = { toolName: "file.read", session: { id: "s1" } };
  const result = await registry.runHook("beforeToolCall", ctx);

  // Context should be unchanged despite error
  assert.deepEqual(result, ctx);

  // Error handler should have been called
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "boom");
  assert.equal(errors[0].hookName, "beforeToolCall");
  assert.equal(errors[0].pluginName, "erroring-plugin");
});

test("PluginRegistry: runHook does not fire onError recursively for onError hook failures", async () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "bad-error-handler",
    hooks: {
      onError() {
        throw new Error("error within error handler");
      },
    },
  });

  // Should not throw or infinite loop
  const result = await registry.runHook("onError", { error: new Error("test") });
  assert.ok(result);
});

test("PluginRegistry: unregister removes plugin and its hooks", () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "target",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
      afterToolCall(ctx) {
        return ctx;
      },
    },
  });
  registry.register({
    name: "keep",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
    },
  });

  assert.equal(registry.getHookCount(), 3);

  const result = registry.unregister("target");
  assert.equal(result, true);
  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "keep");
  assert.equal(registry.getHookCount(), 1);
  // Only "keep"'s hooks remain
  assert.equal(registry._hooks.get("beforeToolCall").length, 1);
  assert.equal(registry._hooks.get("afterToolCall").length, 0);
});

test("PluginRegistry: unregister returns false for unknown plugin", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.unregister("nonexistent"), false);
});

test("PluginRegistry: list returns plugin summaries", () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "p1",
    version: "1.0.0",
    hooks: {
      beforeToolCall() {},
    },
  });
  registry.register({
    name: "p2",
    hooks: {
      beforeToolCall() {},
      onError() {},
    },
  });

  const list = registry.list();
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    name: "p1",
    version: "1.0.0",
    hooks: ["beforeToolCall"],
  });
  assert.deepEqual(list[1], {
    name: "p2",
    version: "0.0.0",
    hooks: ["beforeToolCall", "onError"],
  });
});

test("PluginRegistry: getHookCount returns total hooks across all plugins", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.getHookCount(), 0);

  registry.register({
    name: "p1",
    hooks: {
      beforeToolCall() {},
      afterToolCall() {},
    },
  });
  assert.equal(registry.getHookCount(), 2);

  registry.register({
    name: "p2",
    hooks: {
      beforeToolCall() {},
      onError() {},
      onSessionStart() {},
    },
  });
  assert.equal(registry.getHookCount(), 5);

  registry.unregister("p1");
  assert.equal(registry.getHookCount(), 3);
});

test("PluginRegistry: loadPlugin requires existing file", () => {
  const registry = new PluginRegistry();
  assert.throws(
    () => registry.loadPlugin("/i/do/not/exist.js"),
    { message: /Plugin file not found/ }
  );
});

test("PluginRegistry: loadPlugin loads and registers from file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-plugins-"));
  const pluginPath = path.join(tmpDir, "test-plugin.js");
  fs.writeFileSync(
    pluginPath,
    `module.exports = { name: "disk-plugin", version: "2.0.0", hooks: { beforeChat(ctx) { return ctx; } } };`,
    "utf8"
  );

  const registry = new PluginRegistry();
  registry.loadPlugin(pluginPath);

  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "disk-plugin");
  assert.equal(registry._plugins[0].version, "2.0.0");
});

test("PluginRegistry: loadPluginsFromDirectory loads all .js files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-plugins-"));
  fs.writeFileSync(
    path.join(tmpDir, "plugin-a.js"),
    "module.exports = { name: 'plugin-a' };",
    "utf8"
  );
  fs.writeFileSync(
    path.join(tmpDir, "plugin-b.js"),
    "module.exports = { name: 'plugin-b' };",
    "utf8"
  );
  // Non-js file should be skipped
  fs.writeFileSync(path.join(tmpDir, "readme.md"), "# plugins", "utf8");

  const registry = new PluginRegistry();
  const count = registry.loadPluginsFromDirectory(tmpDir);
  assert.equal(count, 2);
  assert.equal(registry._plugins.length, 2);
});

test("PluginRegistry: loadPluginsFromDirectory returns 0 for non-existent dir", () => {
  const registry = new PluginRegistry();
  const count = registry.loadPluginsFromDirectory("/i/do/not/exist");
  assert.equal(count, 0);
});

test("PluginRegistry: loadPluginsFromDirectory silently skips failing plugins", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-plugins-"));
  fs.writeFileSync(
    path.join(tmpDir, "good.js"),
    "module.exports = { name: 'good' };",
    "utf8"
  );
  fs.writeFileSync(
    path.join(tmpDir, "bad.js"),
    "throw new Error('load failure');",
    "utf8"
  );

  const registry = new PluginRegistry();
  const count = registry.loadPluginsFromDirectory(tmpDir);
  // Should count 1 success, not crash on the bad one
  assert.equal(count, 1);
  assert.equal(registry._plugins.length, 1);
  assert.equal(registry._plugins[0].name, "good");
});

test("PluginRegistry: runHook with async handlers works", async () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "async-plugin",
    hooks: {
      beforeToolCall: async (ctx) => {
        return { ...ctx, asyncModified: true };
      },
    },
  });

  const result = await registry.runHook("beforeToolCall", { toolName: "test" });
  assert.equal(result.asyncModified, true);
});

test("PluginRegistry: empty context defaults to empty object", async () => {
  const registry = new PluginRegistry();
  registry.register({
    name: "ctx-modifier",
    hooks: {
      onSessionStart(ctx) {
        return { ...ctx, started: true };
      },
    },
  });

  const result = await registry.runHook("onSessionStart");
  assert.equal(result.started, true);
});
