/**
 * Tests for PluginIndex: scan, index, search, list, getCompatible,
 * serialisation to/from JSON, saveToFile/loadFromFile.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginIndex } = require("../../src/plugins/indexer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory containing plugins, then clean up after.
 */
function withTempPlugins(plugins, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-idx-"));

  for (const p of plugins) {
    const filePath = path.join(tmpDir, p.filename);
    fs.writeFileSync(filePath, p.source, "utf8");
    // Clear require cache between tests
    delete require.cache[require.resolve(filePath)];
  }

  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("PluginIndex: scan discovers and indexes plugins in a directory", () => {
  withTempPlugins(
    [
      {
        filename: "logger.js",
        source: `module.exports = { name: "logger", version: "1.0.0", hooks: { beforeToolCall(ctx) { return ctx; } } };`,
      },
      {
        filename: "backup.js",
        source: `module.exports = { name: "backup", version: "2.0.0", hooks: { beforeToolCall(ctx) { return ctx; }, onError(ctx) { return ctx; } } };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      const count = index.scan(tmpDir);
      assert.equal(count, 2);

      const list = index.list();
      assert.equal(list.length, 2);
      assert.ok(list.some((p) => p.name === "logger"));
      assert.ok(list.some((p) => p.name === "backup"));
    },
  );
});

test("PluginIndex: scan returns 0 for non-existent directory", () => {
  const index = new PluginIndex();
  const count = index.scan("/does/not/exist/anywhere");
  assert.equal(count, 0);
});

test("PluginIndex: scan returns 0 for a file path instead of directory", () => {
  withTempPlugins(
    [
      {
        filename: "single.js",
        source: `module.exports = { name: "single", version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      const filePath = path.join(tmpDir, "single.js");
      const count = index.scan(filePath);
      assert.equal(count, 0);
    },
  );
});

test("PluginIndex: scan recursively discovers plugins in subdirectories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-idx-"));

  const subDir = path.join(tmpDir, "sub");
  fs.mkdirSync(subDir);

  fs.writeFileSync(
    path.join(tmpDir, "top.js"),
    `module.exports = { name: "top", version: "1.0.0" };`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(subDir, "nested.js"),
    `module.exports = { name: "nested", version: "1.0.0" };`,
    "utf8",
  );

  try {
    const index = new PluginIndex();
    const count = index.scan(tmpDir);
    assert.equal(count, 2);

    const names = index.list().map((p) => p.name);
    assert.ok(names.includes("top"));
    assert.ok(names.includes("nested"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("PluginIndex: scan respects recursive: false", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-idx-"));

  const subDir = path.join(tmpDir, "sub");
  fs.mkdirSync(subDir);

  fs.writeFileSync(
    path.join(tmpDir, "top.js"),
    `module.exports = { name: "top", version: "1.0.0" };`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(subDir, "nested.js"),
    `module.exports = { name: "nested", version: "1.0.0" };`,
    "utf8",
  );

  try {
    const index = new PluginIndex();
    const count = index.scan(tmpDir, { recursive: false });
    assert.equal(count, 1);

    const names = index.list().map((p) => p.name);
    assert.ok(names.includes("top"));
    assert.ok(!names.includes("nested"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("PluginIndex: scan skips non-js files", () => {
  withTempPlugins(
    [
      {
        filename: "readme.md",
        source: "# Readme",
      },
      {
        filename: "valid.js",
        source: `module.exports = { name: "valid", version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      const count = index.scan(tmpDir);
      assert.equal(count, 1);
      assert.equal(index.list()[0].name, "valid");
    },
  );
});

test("PluginIndex: index extracts metadata including hooks, description, version", () => {
  withTempPlugins(
    [
      {
        filename: "full.js",
        source: `module.exports = { name: "full-plugin", version: "3.2.1", description: "A full-featured plugin", hooks: { beforeChat(ctx) { return ctx; }, afterChat(ctx) { return ctx; }, onSessionStart(ctx) { return ctx; } } };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      const entry = index.index(path.join(tmpDir, "full.js"));

      assert.equal(entry.name, "full-plugin");
      assert.equal(entry.version, "3.2.1");
      assert.equal(entry.description, "A full-featured plugin");
      assert.deepEqual(entry.hooks, ["beforeChat", "afterChat", "onSessionStart"]);
      assert.equal(typeof entry.path, "string");
      assert.equal(entry.validation.valid, true);
    },
  );
});

test("PluginIndex: index throws for file with no valid plugin name", () => {
  withTempPlugins(
    [
      {
        filename: "bad.js",
        source: `module.exports = { version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      assert.throws(() => index.index(path.join(tmpDir, "bad.js")), {
        message: /has no valid "name"/,
      });
    },
  );
});

test("PluginIndex: index throws for non-existent file", () => {
  const index = new PluginIndex();
  assert.throws(() => index.index("/does/not/exist.js"), {
    message: /Plugin file not found/,
  });
});

test("PluginIndex: search finds plugins by name", () => {
  const index = new PluginIndex();

  // Manually populate for controlled test
  withTempPlugins(
    [
      {
        filename: "a.js",
        source: `module.exports = { name: "hello-world", version: "1.0.0", description: "Greeter plugin" };`,
      },
      {
        filename: "b.js",
        source: `module.exports = { name: "goodbye-world", version: "2.0.0", description: "Farewell plugin" };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const results = index.search("hello");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "hello-world");

  const results2 = index.search("world");
  assert.equal(results2.length, 2);
});

test("PluginIndex: search finds plugins by description", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "x.js",
        source: `module.exports = { name: "alpha", description: "Database connector" };`,
      },
      {
        filename: "y.js",
        source: `module.exports = { name: "beta", description: "File system utilities" };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const results = index.search("database");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "alpha");

  const results2 = index.search("utilities");
  assert.equal(results2.length, 1);
  assert.equal(results2[0].name, "beta");
});

test("PluginIndex: search finds plugins by hook name", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "hooker.js",
        source: `module.exports = { name: "hooker", hooks: { onError(ctx) { return ctx; } } };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const results = index.search("onError");
  assert.ok(results.length >= 1);
  assert.ok(results.some((p) => p.name === "hooker"));
});

test("PluginIndex: search returns empty array for empty/null query", () => {
  const index = new PluginIndex();
  assert.deepEqual(index.search(""), []);
  assert.deepEqual(index.search("  "), []);
  assert.deepEqual(index.search(null), []);
});

test("PluginIndex: list returns all indexed plugins", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "a.js",
        source: `module.exports = { name: "p1", version: "1.0.0" };`,
      },
      {
        filename: "b.js",
        source: `module.exports = { name: "p2", version: "2.0.0" };`,
      },
      {
        filename: "c.js",
        source: `module.exports = { name: "p3", version: "3.0.0" };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const list = index.list();
  assert.equal(list.length, 3);
  const names = list.map((p) => p.name).sort();
  assert.deepEqual(names, ["p1", "p2", "p3"]);
});

test("PluginIndex: getCompatible returns plugins with matching hooks", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "a.js",
        source: `module.exports = { name: "logger", hooks: { beforeToolCall(ctx) { return ctx; }, afterToolCall(ctx) { return ctx; } } };`,
      },
      {
        filename: "b.js",
        source: `module.exports = { name: "backup", hooks: { beforeToolCall(ctx) { return ctx; } } };`,
      },
      {
        filename: "c.js",
        source: `module.exports = { name: "metrics", hooks: { afterChat(ctx) { return ctx; } } };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const beforeToolPlugins = index.getCompatible("beforeToolCall");
  assert.equal(beforeToolPlugins.length, 2);
  assert.ok(beforeToolPlugins.some((p) => p.name === "logger"));
  assert.ok(beforeToolPlugins.some((p) => p.name === "backup"));

  const arrayResult = index.getCompatible(["beforeToolCall", "afterChat"]);
  assert.equal(arrayResult.length, 3);

  const noMatch = index.getCompatible("onSessionEnd");
  assert.equal(noMatch.length, 0);
});

test("PluginIndex: toJSON and fromJSON round-trip", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "r.js",
        source: `module.exports = { name: "roundtrip", version: "1.0.0", description: "Test plugin", hooks: { beforeChat(ctx) { return ctx; } } };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  const json = index.toJSON();
  assert.ok(typeof json.plugins === "object");
  assert.equal(json.count, 1);
  assert.ok(json.plugins.roundtrip);
  assert.equal(json.plugins.roundtrip.name, "roundtrip");
  assert.equal(json.plugins.roundtrip.version, "1.0.0");

  const restored = PluginIndex.fromJSON(json);
  assert.equal(restored.size, 1);
  assert.equal(restored.get("roundtrip").name, "roundtrip");
  assert.equal(restored.get("roundtrip").version, "1.0.0");

  const list = restored.list();
  assert.equal(list.length, 1);
});

test("PluginIndex: saveToFile and loadFromFile round-trip", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-idx-"));

  try {
    const index = new PluginIndex();

    // Create a test plugin
    const pluginDir = path.join(tmpDir, "plugins");
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(
      path.join(pluginDir, "test.js"),
      `module.exports = { name: "file-test", version: "2.0.0", description: "File roundtrip", hooks: { onError(ctx) { return ctx; } } };`,
      "utf8",
    );

    index.scan(pluginDir);

    const jsonPath = path.join(tmpDir, "index.json");
    index.saveToFile(jsonPath);

    assert.ok(fs.existsSync(jsonPath));
    const raw = fs.readFileSync(jsonPath, "utf8");
    assert.ok(raw.includes("file-test"));

    const loaded = PluginIndex.loadFromFile(jsonPath);
    assert.equal(loaded.size, 1);
    assert.equal(loaded.get("file-test").name, "file-test");
    assert.equal(loaded.get("file-test").version, "2.0.0");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("PluginIndex: get returns a single plugin or undefined", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "g.js",
        source: `module.exports = { name: "grab", version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  assert.ok(index.get("grab"));
  assert.equal(index.get("grab").name, "grab");
  assert.equal(index.get("nonexistent"), undefined);
});

test("PluginIndex: remove deletes a plugin from the index", () => {
  const index = new PluginIndex();

  withTempPlugins(
    [
      {
        filename: "r.js",
        source: `module.exports = { name: "removable", version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      index.scan(tmpDir);
    },
  );

  assert.equal(index.size, 1);
  assert.equal(index.remove("removable"), true);
  assert.equal(index.size, 0);
  assert.equal(index.remove("already-gone"), false);
});

test("PluginIndex: scan silently skips invalid plugin files", () => {
  withTempPlugins(
    [
      {
        filename: "not-a-plugin.js",
        source: `module.exports = function() { return 42; };`,
      },
      {
        filename: "good-one.js",
        source: `module.exports = { name: "good", version: "1.0.0" };`,
      },
    ],
    (tmpDir) => {
      const index = new PluginIndex();
      const count = index.scan(tmpDir);
      assert.equal(count, 1);
      assert.equal(index.list()[0].name, "good");
    },
  );
});

test("PluginIndex: fromJSON handles null and empty input", () => {
  const index1 = PluginIndex.fromJSON(null);
  assert.equal(index1.size, 0);

  const index2 = PluginIndex.fromJSON({});
  assert.equal(index2.size, 0);

  const index3 = PluginIndex.fromJSON({ plugins: null });
  assert.equal(index3.size, 0);
});
