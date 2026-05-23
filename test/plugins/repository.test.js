/**
 * Tests for PluginRepository: addSource, fetchIndex, searchRemote,
 * install, update, listRemote.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginRepository } = require("../../src/plugins/repository");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory containing plugin files, run fn, then clean up.
 */
function withTempRepoDir(plugins, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-repo-"));

  for (const p of plugins) {
    const filePath = path.join(tmpDir, p.filename);
    fs.writeFileSync(filePath, p.source, "utf8");
    delete require.cache[require.resolve(filePath)];
  }

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-target-"));

  try {
    fn(tmpDir, targetDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("PluginRepository: addSource stores source configuration", () => {
  const repo = new PluginRepository();
  repo.addSource("community", "/path/to/plugins", "local");

  const source = repo.getSource("community");
  assert.ok(source);
  assert.equal(source.name, "community");
  assert.equal(source.url, "/path/to/plugins");
  assert.equal(source.type, "local");
});

test("PluginRepository: addSource rejects missing name", () => {
  const repo = new PluginRepository();
  assert.throws(() => repo.addSource("", "/path", "local"), { message: /name is required/ });
});

test("PluginRepository: addSource rejects missing URL", () => {
  const repo = new PluginRepository();
  assert.throws(() => repo.addSource("test", "", "local"), { message: /URL is required/ });
});

test("PluginRepository: addSource rejects unknown type", () => {
  const repo = new PluginRepository();
  assert.throws(() => repo.addSource("test", "/path", "ftp"), {
    message: /Unsupported source type/,
  });
});

test("PluginRepository: addSource supports git type", () => {
  const repo = new PluginRepository();
  repo.addSource("github", "https://github.com/user/repo.git", "git");

  const source = repo.getSource("github");
  assert.equal(source.type, "git");
});

test("PluginRepository: removeSource deletes a source and its cache", () => {
  const repo = new PluginRepository();
  repo.addSource("temp", "/tmp/plugins", "local");

  assert.equal(repo.removeSource("temp"), true);
  assert.equal(repo.getSource("temp"), null);
  assert.equal(repo.removeSource("already-gone"), false);
});

test("PluginRepository: listSources returns all sources", () => {
  const repo = new PluginRepository();
  repo.addSource("a", "/a", "local");
  repo.addSource("b", "/b", "local");

  const sources = repo.listSources();
  assert.equal(sources.length, 2);
  assert.ok(sources.some((s) => s.name === "a"));
  assert.ok(sources.some((s) => s.name === "b"));
});

test("PluginRepository: fetchIndex builds index from local source", () => {
  withTempRepoDir(
    [
      {
        filename: "p1.js",
        source: `module.exports = { name: "plugin-one", version: "1.0.0", description: "First plugin", hooks: { beforeChat(ctx) { return ctx; } } };`,
      },
      {
        filename: "p2.js",
        source: `module.exports = { name: "plugin-two", version: "2.0.0", description: "Second plugin", hooks: { afterChat(ctx) { return ctx; } } };`,
      },
    ],
    (repoDir) => {
      const repo = new PluginRepository();
      repo.addSource("local", repoDir, "local");

      const index = repo.fetchIndex("local");
      assert.equal(index.size, 2);

      const list = index.list();
      assert.ok(list.some((p) => p.name === "plugin-one"));
      assert.ok(list.some((p) => p.name === "plugin-two"));
    },
  );
});

test("PluginRepository: fetchIndex throws for unknown source", () => {
  const repo = new PluginRepository();
  assert.throws(() => repo.fetchIndex("nonexistent"), {
    message: /Unknown source/,
  });
});

test("PluginRepository: fetchIndex throws for missing local directory", () => {
  const repo = new PluginRepository();
  repo.addSource("missing", "/definitely/does/not/exist", "local");
  assert.throws(() => repo.fetchIndex("missing"), {
    message: /directory not found/,
  });
});

test("PluginRepository: fetchIndex returns empty index for git source (stub)", () => {
  const repo = new PluginRepository();
  repo.addSource("gh", "https://github.com/example/plugins.git", "git");

  const index = repo.fetchIndex("gh");
  assert.equal(index.size, 0);
  assert.deepEqual(index.list(), []);
});

test("PluginRepository: getIndex caches and returns cached index", () => {
  withTempRepoDir(
    [
      {
        filename: "cache-me.js",
        source: `module.exports = { name: "cache-me", version: "1.0.0" };`,
      },
    ],
    (repoDir) => {
      const repo = new PluginRepository();
      repo.addSource("cached-src", repoDir, "local");

      const idx1 = repo.getIndex("cached-src");
      assert.equal(idx1.size, 1);

      const idx2 = repo.getIndex("cached-src");
      assert.strictEqual(idx2, idx1); // Same cached instance
    },
  );
});

test("PluginRepository: searchRemote searches across all sources", () => {
  const repo = new PluginRepository();

  withTempRepoDir(
    [
      {
        filename: "search-a.js",
        source: `module.exports = { name: "search-alpha", description: "Alpha search target" };`,
      },
    ],
    (dirA) => {
      repo.addSource("src-a", dirA, "local");

      withTempRepoDir(
        [
          {
            filename: "search-b.js",
            source: `module.exports = { name: "search-beta", description: "Beta search target" };`,
          },
        ],
        (dirB) => {
          repo.addSource("src-b", dirB, "local");

          const results = repo.searchRemote("alpha");
          assert.equal(results.length, 1);
          assert.equal(results[0].plugin.name, "search-alpha");
          assert.equal(results[0].source, "src-a");

          const results2 = repo.searchRemote("search");
          assert.equal(results2.length, 2);
        },
      );
    },
  );
});

test("PluginRepository: listRemote lists plugins from all sources", () => {
  const repo = new PluginRepository();

  withTempRepoDir(
    [
      {
        filename: "remote-a.js",
        source: `module.exports = { name: "remote-a", version: "1.0.0" };`,
      },
      {
        filename: "remote-b.js",
        source: `module.exports = { name: "remote-b", version: "2.0.0" };`,
      },
    ],
    (repoDir) => {
      repo.addSource("main", repoDir, "local");
      const list = repo.listRemote();

      assert.equal(list.length, 2);
      const names = list.map((r) => r.plugin.name);
      assert.ok(names.includes("remote-a"));
      assert.ok(names.includes("remote-b"));
      // All plugins should report the same source
      assert.ok(list.every((r) => r.source === "main"));
    },
  );
});

test("PluginRepository: findByName locates a plugin across sources", () => {
  const repo = new PluginRepository();

  withTempRepoDir(
    [
      {
        filename: "unique.js",
        source: `module.exports = { name: "unique-plugin", version: "3.0.0" };`,
      },
    ],
    (repoDir) => {
      repo.addSource("test-src", repoDir, "local");

      const results = repo.findByName("unique-plugin");
      assert.equal(results.length, 1);
      assert.equal(results[0].plugin.name, "unique-plugin");
      assert.equal(results[0].plugin.version, "3.0.0");
      assert.equal(results[0].source, "test-src");

      const empty = repo.findByName("nonexistent");
      assert.deepEqual(empty, []);
    },
  );
});

test("PluginRepository: install copies a plugin from local source to target directory", () => {
  withTempRepoDir(
    [
      {
        filename: "install-me.js",
        source: `module.exports = { name: "install-me", version: "1.2.3", hooks: { beforeChat(ctx) { return ctx; } }, description: "Install test" };`,
      },
    ],
    (repoDir, targetDir) => {
      const repo = new PluginRepository();
      repo.addSource("source1", repoDir, "local");

      const destPath = repo.install("install-me", targetDir, "source1");
      assert.ok(fs.existsSync(destPath));
      assert.ok(destPath.endsWith("install-me.js"));

      const content = fs.readFileSync(destPath, "utf8");
      assert.ok(content.includes("install-me"));
      assert.ok(content.includes("1.2.3"));
    },
  );
});

test("PluginRepository: install auto-discovers source if not specified", () => {
  withTempRepoDir(
    [
      {
        filename: "auto-plugin.js",
        source: `module.exports = { name: "auto-plugin", version: "2.0.0" };`,
      },
    ],
    (repoDir, targetDir) => {
      const repo = new PluginRepository();
      repo.addSource("src1", repoDir, "local");

      const destPath = repo.install("auto-plugin", targetDir);
      assert.ok(fs.existsSync(destPath));
    },
  );
});

test("PluginRepository: install throws for unknown plugin", () => {
  const repo = new PluginRepository();
  assert.throws(() => repo.install("nonexistent", "/tmp"), {
    message: /not found in any source/,
  });
});

test("PluginRepository: update updates a plugin and returns version info", () => {
  withTempRepoDir(
    [
      {
        filename: "upgradable.js",
        source: `module.exports = { name: "upgradable", version: "2.0.0" };`,
      },
    ],
    (repoDir, targetDir) => {
      const repo = new PluginRepository();
      repo.addSource("upgrade-src", repoDir, "local");

      // Install an old version first
      const oldFile = path.join(targetDir, "upgradable.js");
      fs.writeFileSync(
        oldFile,
        `module.exports = { name: "upgradable", version: "1.0.0" };`,
        "utf8",
      );

      const result = repo.update("upgradable", targetDir, "upgrade-src");

      assert.ok(fs.existsSync(result.path));
      assert.equal(result.previousVersion, "1.0.0");
      assert.equal(result.newVersion, "2.0.0");
    },
  );
});

test("PluginRepository: update works when no previous version exists", () => {
  withTempRepoDir(
    [
      {
        filename: "fresh.js",
        source: `module.exports = { name: "fresh", version: "5.0.0" };`,
      },
    ],
    (repoDir, targetDir) => {
      const repo = new PluginRepository();
      repo.addSource("fresh-src", repoDir, "local");

      const result = repo.update("fresh", targetDir, "fresh-src");

      assert.equal(result.previousVersion, "none");
      assert.equal(result.newVersion, "5.0.0");
    },
  );
});

test("PluginRepository: install from git source throws stub error", () => {
  const repo = new PluginRepository();
  repo.addSource("gh", "https://github.com/user/plugins.git", "git");

  // The git index is empty, so findByName would fail.
  // Test the error path directly by checking the git type handling.
  // Since the git stub returns an empty index, install will throw "not found".
  assert.throws(() => repo.install("any-plugin", "/tmp", "gh"), {
    message: /not found in any source/,
  });
});
