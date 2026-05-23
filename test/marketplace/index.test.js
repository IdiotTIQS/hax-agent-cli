/**
 * Tests for PluginMarketplace: search, install, update, uninstall,
 * getTrending, getRecommended, ratings, and source management.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginMarketplace, TASK_KEYWORDS } = require("../../src/marketplace/index");

// ─── helpers ────────────────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-mkt-"));
}

function writePlugin(dir, name, overrides = {}) {
  const code = [
    '"use strict";',
    "module.exports = {",
    `  name: ${JSON.stringify(name)},`,
    `  version: ${JSON.stringify(overrides.version || "1.0.0")},`,
    `  description: ${JSON.stringify(overrides.description || `Plugin ${name} for testing`)},`,
    "  hooks: {",
  ];
  const hooks = overrides.hooks || {};
  for (const [hookName, hookBody] of Object.entries(hooks)) {
    code.push(`    ${hookName}: ${hookBody},`);
  }
  if (Object.keys(hooks).length === 0) {
    code.push("    beforeToolCall(ctx) { return ctx; },");
  }
  code.push("  },");
  if (overrides.metadata) {
    code.push(`  metadata: ${JSON.stringify(overrides.metadata)},`);
  }
  code.push("};");
  fs.writeFileSync(path.join(dir, `${name}.js`), code.join("\n"), "utf8");
}

// ─── tests ──────────────────────────────────────────────────────────────

test("PluginMarketplace: constructor initialises with default empty state", () => {
  const mp = new PluginMarketplace();
  assert.ok(mp._localIndex instanceof Object, "_localIndex exists");
  assert.ok(mp._repository instanceof Object, "_repository exists");
  assert.ok(mp._officialIndex instanceof Object, "_officialIndex exists");
  assert.equal(mp._installed.size, 0);
  assert.equal(mp._installCounts.size, 0);
  assert.equal(mp._initialized, false);
});

test("PluginMarketplace: constructor scans localDir if provided and directory exists", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "local-test", {
      description: "A local test plugin",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir });
    const results = mp._localIndex.search("local-test");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "local-test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: constructor registers extra sources", () => {
  const mp = new PluginMarketplace({
    sources: [
      { name: "community", url: "/tmp/community", type: "local" },
      { name: "upstream", url: "https://github.com/example/repo", type: "git" },
    ],
  });

  const sources = mp.listSources();
  assert.equal(sources.length, 2);
  assert.equal(sources[0].name, "community");
  assert.equal(sources[1].name, "upstream");
  assert.equal(sources[1].type, "git");
});

test("PluginMarketplace: init() fetches sources and loads state", async () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "test-plugin", {
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir, installedDir: dir });
    await mp.init();

    assert.equal(mp._initialized, true);
    // Double-init should be safe
    await mp.init();
    assert.equal(mp._initialized, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: search() finds plugins in local index", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "logger-plugin", {
      description: "Advanced logging for tool calls",
      hooks: { beforeToolCall: "(ctx) => ctx", afterToolCall: "(ctx) => ctx" },
    });
    writePlugin(dir, "security-plugin", {
      description: "Security audit for tool calls",
      hooks: { beforeToolCall: "(ctx) => ctx", onError: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir });

    // Search by name
    const byName = mp.search("logger");
    assert.ok(byName.length >= 1, `Expected at least 1 result for "logger", got ${byName.length}`);
    assert.equal(byName[0].name, "logger-plugin");

    // Search by description
    const byDesc = mp.search("security audit");
    assert.ok(byDesc.length >= 1, `Expected at least 1 result for description search`);
    assert.equal(byDesc[0].name, "security-plugin");

    // Empty query returns all
    const all = mp.search("");
    assert.ok(all.length >= 2, `Expected at least 2 results, got ${all.length}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: search() filters by hooks", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "hook-a", {
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });
    writePlugin(dir, "hook-b", {
      hooks: { beforeToolCall: "(ctx) => ctx", onError: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir });

    const onErrorResults = mp.search("", { hooks: ["onError"] });
    assert.equal(onErrorResults.length, 1);
    assert.equal(onErrorResults[0].name, "hook-b");

    const multiResults = mp.search("", { hooks: ["beforeToolCall", "onError"] });
    assert.equal(multiResults.length, 1);
    assert.equal(multiResults[0].name, "hook-b");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: search() respects limit option", () => {
  const dir = tempDir();
  try {
    for (let i = 0; i < 5; i++) {
      writePlugin(dir, `plugin-${i}`, {
        hooks: { beforeToolCall: "(ctx) => ctx" },
      });
    }

    const mp = new PluginMarketplace({ localDir: dir });
    const results = mp.search("", { limit: 3 });
    assert.ok(results.length <= 3, `Expected <= 3 results, got ${results.length}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: install() copies plugin file and tracks installation", () => {
  const sourceDir = tempDir();
  const installDir = tempDir();
  try {
    writePlugin(sourceDir, "my-plugin", {
      version: "2.1.0",
      hooks: { beforeChat: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: sourceDir, installedDir: installDir });
    const result = mp.install("my-plugin");

    assert.equal(result.name, "my-plugin");
    assert.equal(result.version, "2.1.0");
    assert.equal(result.source, "local");
    assert.ok(fs.existsSync(result.path));

    // Tracked as installed
    assert.equal(mp.isInstalled("my-plugin"), true);

    const installed = mp.listInstalled();
    assert.equal(installed.length, 1);
    assert.equal(installed[0].version, "2.1.0");
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: install() throws for missing plugin", () => {
  const mp = new PluginMarketplace({ installedDir: tempDir() });
  assert.throws(
    () => mp.install("non-existent-plugin"),
    { message: /not found in any source/ },
  );
});

test("PluginMarketplace: install() throws for empty plugin name", () => {
  const mp = new PluginMarketplace({ installedDir: tempDir() });
  assert.throws(() => mp.install(""), { message: /Plugin name is required/ });
  assert.throws(() => mp.install(null), { message: /Plugin name is required/ });
});

test("PluginMarketplace: update() detects new version and installs it", () => {
  const sourceDir = tempDir();
  const installDir = tempDir();
  try {
    writePlugin(sourceDir, "upgradable", {
      version: "2.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: sourceDir, installedDir: installDir });

    // First install
    const first = mp.install("upgradable");
    assert.equal(first.version, "2.0.0");

    // Overwrite with a newer version in the source
    writePlugin(sourceDir, "upgradable", {
      version: "3.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    // Update should see the new version
    const updateResult = mp.update("upgradable");
    assert.equal(updateResult.previousVersion, "2.0.0");
    assert.equal(updateResult.newVersion, "3.0.0");
    assert.equal(updateResult.updated, true);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: uninstall() deletes plugin files and untracks", () => {
  const sourceDir = tempDir();
  const installDir = tempDir();
  try {
    writePlugin(sourceDir, "removable", {
      version: "1.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: sourceDir, installedDir: installDir });
    mp.install("removable");

    assert.equal(mp.isInstalled("removable"), true);

    const uninstalled = mp.uninstall("removable");
    assert.equal(uninstalled.removed, true);
    assert.ok(uninstalled.filesDeleted.length === 1);

    assert.equal(mp.isInstalled("removable"), false);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: getTrending() returns ranked plugins by installs and rating", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "popular", {
      version: "1.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });
    writePlugin(dir, "niche", {
      version: "1.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir, installedDir: dir });

    // Install "popular" multiple times to boost count
    mp.install("popular");
    mp.install("popular");
    mp.install("popular");
    mp.install("niche");

    // Rate them
    mp.rate("popular", 5);
    mp.rate("popular", 4);
    mp.rate("niche", 3);

    const trending = mp.getTrending({ limit: 5 });
    assert.ok(trending.length >= 2, `Expected at least 2 trending, got ${trending.length}`);
    assert.equal(trending[0].name, "popular");

    // Limited
    const limited = mp.getTrending({ limit: 1 });
    assert.equal(limited.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: getRecommended() matches task keywords to hooks", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "error-logger", {
      description: "Logs all errors",
      hooks: { onError: "(ctx) => ctx" },
    });
    writePlugin(dir, "chat-formatter", {
      description: "Formats chat messages",
      hooks: { beforeChat: "(ctx) => ctx", afterChat: "(ctx) => ctx" },
    });
    writePlugin(dir, "tool-monitor", {
      description: "Monitors tool calls",
      hooks: { beforeToolCall: "(ctx) => ctx", afterToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir });

    // "debugging" maps to beforeToolCall + afterToolCall + onError
    const recs = mp.getRecommended("debugging tool calls");
    assert.ok(recs.length >= 1, `Expected at least 1 recommendation, got ${recs.length}`);

    // "error" should prioritize plugins with onError hook
    const errorRecs = mp.getRecommended("handle errors gracefully");
    const topError = errorRecs[0];
    assert.ok(topError.hooks.includes("onError"), "Top recommendation should include onError hook");

    // Unknown task falls back to trending
    const unknown = mp.getRecommended("xyzabc123");
    assert.ok(Array.isArray(unknown), "Unknown task returns array");
    assert.ok(unknown.length >= 0, "Unknown task may return empty or trending");

    // Empty task falls back to trending
    const emptyRecs = mp.getRecommended("");
    assert.ok(Array.isArray(emptyRecs), "Empty task returns array");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: rate() and getRating() work correctly", () => {
  const mp = new PluginMarketplace();

  assert.equal(mp.getRating("unknown-plugin"), 0);

  mp.rate("test-plugin", 4);
  mp.rate("test-plugin", 5);

  const rating = mp.getRating("test-plugin");
  assert.equal(rating, 4.5);
});

test("PluginMarketplace: rate() throws for invalid rating values", () => {
  const mp = new PluginMarketplace();
  assert.throws(() => mp.rate("p", 6), { message: /between 0 and 5/ });
  assert.throws(() => mp.rate("p", -1), { message: /between 0 and 5/ });
  assert.throws(() => mp.rate("p", "bad"), { message: /must be a number/ });
});

test("PluginMarketplace: getStats() returns comprehensive marketplace stats", () => {
  const dir = tempDir();
  try {
    writePlugin(dir, "stats-plugin", {
      version: "1.0.0",
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir, installedDir: dir });

    // Install and rate
    mp.install("stats-plugin");
    mp.rate("stats-plugin", 4);

    const stats = mp.getStats();
    assert.ok(typeof stats.totalAvailable === "number");
    assert.ok(typeof stats.totalInstalled === "number");
    assert.ok(typeof stats.totalSources === "number");
    assert.ok(Array.isArray(stats.topInstalled));
    assert.ok(typeof stats.avgRating === "number");

    assert.equal(stats.totalInstalled, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PluginMarketplace: addSource() and removeSource() manage sources", () => {
  const mp = new PluginMarketplace();

  assert.equal(mp.listSources().length, 0);

  mp.addSource("test-src", "/tmp/test", "local");
  assert.equal(mp.listSources().length, 1);
  assert.equal(mp.listSources()[0].name, "test-src");

  const removed = mp.removeSource("test-src");
  assert.equal(removed, true);
  assert.equal(mp.listSources().length, 0);

  assert.equal(mp.removeSource("nonexistent"), false);
});

test("PluginMarketplace: registerOfficial() and unregisterOfficial() manage official registry", () => {
  const mp = new PluginMarketplace();

  mp.registerOfficial({
    name: "official-plugin",
    version: "1.0.0",
    description: "An officially supported plugin",
    hooks: ["beforeToolCall", "onError"],
  });

  const results = mp.search("official-plugin");
  assert.equal(results.length, 1);
  assert.equal(results[0].source, "official");
  assert.equal(results[0].name, "official-plugin");

  const unregistered = mp.unregisterOfficial("official-plugin");
  assert.equal(unregistered, true);

  const after = mp.search("official-plugin");
  assert.equal(after.length, 0);
});

test("PluginMarketplace: scanLocal() indexes a new directory", () => {
  const dir1 = tempDir();
  const dir2 = tempDir();
  try {
    writePlugin(dir1, "dir1-plugin", {
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });
    writePlugin(dir2, "dir2-plugin", {
      hooks: { beforeToolCall: "(ctx) => ctx" },
    });

    const mp = new PluginMarketplace({ localDir: dir1 });

    // Initially only dir1
    const before = mp.search("");
    const namesBefore = before.map((p) => p.name);
    assert.ok(namesBefore.includes("dir1-plugin"));
    assert.ok(!namesBefore.includes("dir2-plugin"));

    // Scan dir2 as well
    const scanned = mp.scanLocal(dir2);
    assert.equal(scanned, 1);

    const after = mp.search("");
    const namesAfter = after.map((p) => p.name);
    assert.ok(namesAfter.includes("dir1-plugin"));
    assert.ok(namesAfter.includes("dir2-plugin"));
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("PluginMarketplace: TASK_KEYWORDS maps known tasks to hooks", () => {
  assert.ok(Array.isArray(TASK_KEYWORDS.logging));
  assert.ok(TASK_KEYWORDS.logging.includes("beforeToolCall"));
  assert.ok(TASK_KEYWORDS.security.includes("beforeToolCall"));
  assert.ok(TASK_KEYWORDS.security.includes("onError"));
  assert.ok(TASK_KEYWORDS.format.includes("beforeChat"));
  assert.ok(TASK_KEYWORDS.format.includes("afterChat"));
  assert.ok(TASK_KEYWORDS.deployment.includes("onSessionStart"));
  assert.ok(TASK_KEYWORDS.deployment.includes("onSessionEnd"));
});
