/**
 * Tests for HotReloadManager: watchPlugin, watchSkill, watchConfig,
 * watchDependencies, pause/resume, getReloadHistory, throttle.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { HotReloadManager } = require("../../src/watcher/hot-reload");

// Helper: wait ms
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: create a temp directory
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-hr-"));
}

// Helper: create a simple plugin file
function writePlugin(dir, name, version) {
  const filePath = path.join(dir, `${name}.js`);
  const code = `
    module.exports = {
      name: "${name}",
      version: "${version || "1.0.0"}",
      hooks: {}
    };
  `;
  fs.writeFileSync(filePath, code, "utf8");
  return filePath;
}

// Helper: mock registry
function mockRegistry() {
  const plugins = [];
  return {
    register(plugin) {
      // Remove existing with same name
      const idx = plugins.findIndex((p) => p.name === plugin.name);
      if (idx >= 0) plugins.splice(idx, 1);
      plugins.push(plugin);
      return plugin;
    },
    unregister(name) {
      const idx = plugins.findIndex((p) => p.name === name);
      if (idx >= 0) { plugins.splice(idx, 1); return true; }
      return false;
    },
    loadSkill(fp) {
      delete require.cache[require.resolve(fp)];
      const skill = require(fp);
      this.register(skill);
      return skill;
    },
    list() { return [...plugins]; },
  };
}

test("HotReloadManager: constructor defaults", () => {
  const mgr = new HotReloadManager();
  assert.equal(mgr._throttleMs, 300);
  assert.equal(mgr._paused, false);
  assert.deepEqual(mgr.getReloadHistory(), []);
  assert.equal(mgr.isPaused(), false);
});

test("HotReloadManager: constructor accepts custom throttle", () => {
  const mgr = new HotReloadManager({ throttleMs: 500 });
  assert.equal(mgr._throttleMs, 500);
});

test("HotReloadManager: pause and resume", () => {
  const mgr = new HotReloadManager();
  assert.equal(mgr.isPaused(), false);

  mgr.pause();
  assert.equal(mgr.isPaused(), true);

  mgr.resume();
  assert.equal(mgr.isPaused(), false);
});

test("HotReloadManager: setThrottle updates minimum reload interval", () => {
  const mgr = new HotReloadManager();
  mgr.setThrottle(1000);
  assert.equal(mgr._throttleMs, 1000);

  mgr.setThrottle(0);
  assert.equal(mgr._throttleMs, 0);

  mgr.setThrottle(-5);
  assert.equal(mgr._throttleMs, 0, "negative throttle clamps to 0");
});

test("HotReloadManager: watchPlugin reloads plugin on file change", async () => {
  const dir = tmpDir();
  const reg = mockRegistry();

  // Create initial plugin
  const pluginPath = writePlugin(dir, "test-plugin", "1.0.0");
  reg.register(require(pluginPath));

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchPlugin(pluginPath, reg);

  // Modify the plugin file
  await wait(100);
  const updatedCode = `
    module.exports = {
      name: "test-plugin",
      version: "2.0.0",
      hooks: {
        beforeChat: function(ctx) { return ctx; }
      }
    };
  `;
  fs.writeFileSync(pluginPath, updatedCode, "utf8");

  // Wait for throttle + reload
  await wait(300);

  const plugins = reg.list();
  // Should have the updated version
  const reloaded = plugins.find((p) => p.name === "test-plugin");
  assert.ok(reloaded, "Plugin should still be registered after reload");
  assert.equal(reloaded.version, "2.0.0");

  // Check history
  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1);
  const lastReload = history[history.length - 1];
  assert.equal(lastReload.type, "plugin");
  assert.equal(lastReload.success, true);

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: watchSkill reloads skill on file change", async () => {
  const dir = tmpDir();
  const reg = mockRegistry();

  const skillPath = path.join(dir, "test-skill.js");
  const skillCode = `
    module.exports = {
      name: "test-skill",
      version: "1.0.0",
      hooks: {}
    };
  `;
  fs.writeFileSync(skillPath, skillCode, "utf8");

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchSkill(skillPath, reg);

  await wait(100);
  const updatedCode = `
    module.exports = {
      name: "test-skill",
      version: "1.1.0",
      hooks: {
        onSessionStart: function(ctx) { return ctx; }
      }
    };
  `;
  fs.writeFileSync(skillPath, updatedCode, "utf8");
  await wait(300);

  const skills = reg.list();
  const reloaded = skills.find((s) => s.name === "test-skill");
  assert.ok(reloaded);
  assert.equal(reloaded.version, "1.1.0");

  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1);
  assert.equal(history[history.length - 1].type, "skill");
  assert.equal(history[history.length - 1].success, true);

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: watchConfig invokes callback on change", async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ key: "old" }), "utf8");

  let callbackCalled = false;
  let callbackPath = null;

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchConfig(configPath, (fp) => {
    callbackCalled = true;
    callbackPath = fp;
  });

  await wait(100);
  fs.writeFileSync(configPath, JSON.stringify({ key: "new" }), "utf8");
  await wait(300);

  assert.equal(callbackCalled, true);
  assert.equal(path.resolve(callbackPath), configPath);

  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1);
  assert.equal(history[history.length - 1].type, "config");
  assert.equal(history[history.length - 1].success, true);

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: watchDependencies detects package.json changes", async () => {
  const dir = tmpDir();
  const pkgPath = path.join(dir, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "test-pkg",
    dependencies: { "lodash": "^4.0.0" },
  }), "utf8");

  let depsChanged = 0;
  let newDeps = null;
  let oldDeps = null;

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchDependencies(pkgPath, (newD, oldD) => {
    depsChanged++;
    newDeps = newD;
    oldDeps = oldD;
  });

  await wait(100);
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "test-pkg",
    dependencies: { "lodash": "^4.0.0", "axios": "^1.0.0" },
  }), "utf8");
  await wait(300);

  assert.ok(depsChanged >= 1, "Deps callback should have been called");
  assert.ok(newDeps && newDeps.axios, "New deps should include axios");
  assert.ok(oldDeps && !oldDeps.axios, "Old deps should NOT include axios");

  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1);
  assert.equal(history[history.length - 1].type, "dependencies");

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: pause suppresses reloads", async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ key: "v1" }), "utf8");

  let callCount = 0;

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchConfig(configPath, () => { callCount++; });

  mgr.pause();

  await wait(100);
  fs.writeFileSync(configPath, JSON.stringify({ key: "v2" }), "utf8");
  await wait(300);

  // Should NOT have invoked callback while paused
  assert.equal(callCount, 0);

  mgr.resume();
  await wait(50);

  fs.writeFileSync(configPath, JSON.stringify({ key: "v3" }), "utf8");
  await wait(300);

  assert.equal(callCount, 1, "Callback should fire after resume");

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: getReloadHistory returns chronological log", async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, "config1.json");
  fs.writeFileSync(configPath, JSON.stringify({ a: 1 }), "utf8");

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchConfig(configPath, () => {});

  await wait(100);
  fs.writeFileSync(configPath, JSON.stringify({ a: 2 }), "utf8");
  await wait(200);
  fs.writeFileSync(configPath, JSON.stringify({ a: 3 }), "utf8");
  await wait(300);

  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1, "History should have at least 1 entry");

  // Entries should have required fields
  for (const entry of history) {
    assert.ok(typeof entry.filePath === "string");
    assert.ok(typeof entry.type === "string");
    assert.ok(typeof entry.timestamp === "string");
    assert.ok(typeof entry.success === "boolean");
  }

  // Timestamps should be chronological
  for (let i = 1; i < history.length; i++) {
    assert.ok(
      new Date(history[i].timestamp) >= new Date(history[i - 1].timestamp),
      "History entries should be in chronological order",
    );
  }

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: close cleans up all watchers and pending reloads", async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ key: "initial" }), "utf8");

  let callCount = 0;
  const mgr = new HotReloadManager({ throttleMs: 0 });
  mgr.watchConfig(configPath, () => { callCount++; });

  await wait(100);
  mgr.close();

  assert.equal(mgr._pendingReloads.size, 0);

  // Modify after close — should not trigger
  fs.writeFileSync(configPath, JSON.stringify({ key: "after" }), "utf8");
  await wait(200);

  assert.equal(callCount, 0, "No callbacks should fire after close");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("HotReloadManager: watchPlugin with reload failure is logged", async () => {
  const dir = tmpDir();
  const reg = mockRegistry();

  // Create an invalid plugin (syntax error)
  const pluginPath = path.join(dir, "bad-plugin.js");
  fs.writeFileSync(pluginPath, "module.exports = { name: 'bad-plugin', hooks: {}", "utf8");

  // Load it once successfully with valid code first
  fs.writeFileSync(pluginPath, "module.exports = { name: 'bad-plugin', version: '1.0.0', hooks: {} };", "utf8");
  reg.register(require(pluginPath));

  const mgr = new HotReloadManager({ throttleMs: 50 });
  mgr.watchPlugin(pluginPath, reg);

  await wait(100);
  // Write invalid code
  fs.writeFileSync(pluginPath, "syntax error {{{", "utf8");
  await wait(300);

  const history = mgr.getReloadHistory();
  assert.ok(history.length >= 1);
  const lastEntry = history[history.length - 1];
  assert.equal(lastEntry.type, "plugin");
  assert.equal(lastEntry.success, false);
  assert.ok(typeof lastEntry.error === "string");

  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
