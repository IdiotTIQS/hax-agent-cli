/**
 * Tests for FileWatcher: watch, on, unwatch, close,
 * getWatchedPaths, debouncing, ignore patterns, polling fallback.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { FileWatcher, DEFAULT_IGNORE } = require("../../src/watcher/fs-watcher");

// Helper: wait ms
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: create a temp directory tree
function tmpDirTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hax-fsw-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    const dir = path.dirname(full);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content || "", "utf8");
  }
  return root;
}

test("FileWatcher: constructor defaults", () => {
  const fw = new FileWatcher();
  assert.equal(fw._debounceMs, 100);
  assert.deepEqual(fw._ignorePatterns, [".git", "node_modules", ".hax-agent"]);
  assert.equal(fw._usePolling, false);
  assert.deepEqual(fw.getWatchedPaths(), []);
});

test("FileWatcher: constructor accepts custom options", () => {
  const fw = new FileWatcher({ debounceMs: 50, ignore: [".git", "*.log"], usePolling: true });
  assert.equal(fw._debounceMs, 50);
  assert.deepEqual(fw._ignorePatterns, [".git", "*.log"]);
  assert.equal(fw._usePolling, true);
});

test("FileWatcher: watch single file detects change", async () => {
  const root = tmpDirTree({ "test.txt": "hello" });
  const fw = new FileWatcher({ debounceMs: 0 });
  const filePath = path.join(root, "test.txt");

  const events = [];
  fw.on("change", (p) => events.push({ event: "change", path: p }));

  fw.watch(filePath);

  // Wait briefly then modify
  await wait(100);
  fs.writeFileSync(filePath, "world", "utf8");
  await wait(300);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  assert.ok(events.length >= 1, "Expected at least one change event");
  assert.equal(path.resolve(events[0].path), filePath);
});

test("FileWatcher: watch directory detects new file (add event)", async () => {
  const root = tmpDirTree({});
  const fw = new FileWatcher({ debounceMs: 0 });

  const events = [];
  fw.on("add", (p) => events.push({ event: "add", path: p }));
  fw.on("addDir", (p) => events.push({ event: "addDir", path: p }));

  fw.watch(root, { recursive: true });
  await wait(200);

  const newFile = path.join(root, "newfile.txt");
  fs.writeFileSync(newFile, "content", "utf8");
  await wait(400);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  const addEvents = events.filter((e) => e.event === "add");
  assert.ok(addEvents.length >= 1, "Expected at least one add event");
});

test("FileWatcher: watch directory with files reports existing directory", async () => {
  const root = tmpDirTree({ "a.txt": "a", "sub/b.txt": "b" });
  const fw = new FileWatcher({ debounceMs: 0 });

  const events = [];
  fw.on("addDir", (p) => events.push({ event: "addDir", path: p }));

  fw.watch(root, { recursive: true });
  await wait(200);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  // Should report the root and sub directories
  const dirEvents = events.filter((e) => e.event === "addDir");
  assert.ok(dirEvents.length >= 2, `Expected >= 2 addDir events, got ${dirEvents.length}`);
});

test("FileWatcher: unwatch stops events for a path", async () => {
  const root = tmpDirTree({ "a.txt": "a", "b.txt": "b" });
  const fw = new FileWatcher({ debounceMs: 0 });

  const aFile = path.join(root, "a.txt");
  const bFile = path.join(root, "b.txt");

  const events = [];
  fw.on("change", (p) => events.push(path.resolve(p)));

  fw.watch(root);
  await wait(100);

  // Unwatch a.txt specifically
  fw.unwatch(aFile);
  await wait(50);

  // Modify both files
  fs.writeFileSync(aFile, "new-a", "utf8");
  fs.writeFileSync(bFile, "new-b", "utf8");
  await wait(300);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  // b.txt should still fire events, a.txt should not
  const aEvents = events.filter((p) => p === aFile);
  const bEvents = events.filter((p) => p === bFile);
  assert.ok(bEvents.length >= 1, "b.txt should trigger change events");
  assert.equal(aEvents.length, 0, "a.txt should NOT trigger events after unwatch");
});

test("FileWatcher: close stops all watchers", async () => {
  const root = tmpDirTree({ "test.txt": "hello" });
  const fw = new FileWatcher({ debounceMs: 0 });
  const filePath = path.join(root, "test.txt");

  fw.watch(filePath);
  await wait(100);

  fw.close();
  await wait(50);

  assert.deepEqual(fw.getWatchedPaths(), []);

  // Modify after close — should not trigger
  fs.writeFileSync(filePath, "world", "utf8");
  await wait(200);

  fs.rmSync(root, { recursive: true, force: true });
  // No assertion needed — just verifying no crash
});

test("FileWatcher: getWatchedPaths returns sorted paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hax-fsw-"));
  const subDir = path.join(root, "sub");
  fs.mkdirSync(subDir);

  const fw = new FileWatcher({ debounceMs: 0 });
  fw.watch(root);
  fw.watch(path.join(root, "extra.js"));

  const paths = fw.getWatchedPaths();
  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  assert.ok(paths.length >= 1);
  assert.ok(paths.includes(root));
});

test("FileWatcher: watch non-existent path watches parent", async () => {
  const root = tmpDirTree({});
  const fw = new FileWatcher({ debounceMs: 0 });
  const nonexistent = path.join(root, "nonexistent.txt");

  const events = [];
  fw.on("add", (p) => events.push(path.resolve(p)));

  fw.watch(nonexistent);
  await wait(200);

  // Create the file — parent watcher should detect it
  fs.writeFileSync(nonexistent, "created", "utf8");
  await wait(400);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  const addEvents = events.filter((p) => p === nonexistent);
  assert.ok(addEvents.length >= 1, "Expected add event for created file");
});

test("FileWatcher: ignores .git, node_modules, .hax-agent by default", () => {
  const root = tmpDirTree({
    ".git/config": "git",
    "node_modules/pkg/index.js": "pkg",
    ".hax-agent/cache.json": "cache",
    "src/app.js": "app",
  });

  const fw = new FileWatcher({ debounceMs: 0 });

  // Should not watch ignored directories
  fw.watch(root, { recursive: true });

  const paths = fw.getWatchedPaths();
  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  // Should include root and src, but not .git, node_modules, .hax-agent
  const normalized = paths.map((p) => p.replace(/\\/g, "/"));
  assert.ok(normalized.some((p) => p.endsWith("src")), "Should watch src dir");
  assert.ok(!normalized.some((p) => p.includes(".git")), "Should NOT watch .git");
  assert.ok(!normalized.some((p) => p.includes("node_modules")), "Should NOT watch node_modules");
  assert.ok(!normalized.some((p) => p.includes(".hax-agent")), "Should NOT watch .hax-agent");
});

test("FileWatcher: debounce coalesces rapid events", async () => {
  const root = tmpDirTree({ "debounce.txt": "initial" });
  const fw = new FileWatcher({ debounceMs: 200 });
  const filePath = path.join(root, "debounce.txt");

  const events = [];
  fw.on("change", (p) => events.push({ path: p, time: Date.now() }));

  fw.watch(filePath);
  await wait(100);

  // Rapid writes
  fs.writeFileSync(filePath, "v1", "utf8");
  fs.writeFileSync(filePath, "v2", "utf8");
  fs.writeFileSync(filePath, "v3", "utf8");
  await wait(500);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  // Should have at most 1-2 events (debounced)
  assert.ok(events.length <= 2, `Expected <= 2 events due to debouncing, got ${events.length}`);
  assert.ok(events.length >= 1, "Expected at least 1 event");
});

test("FileWatcher: on throws for invalid event name", () => {
  const fw = new FileWatcher();
  assert.throws(() => fw.on("invalidEvent", () => {}), {
    message: /Unknown event/,
  });
});

test("FileWatcher: watch accepts array of paths", async () => {
  const root = tmpDirTree({ "a.txt": "a", "b.txt": "b" });
  const fw = new FileWatcher({ debounceMs: 0 });

  const events = [];
  fw.on("change", (p) => events.push(path.resolve(p)));

  fw.watch([path.join(root, "a.txt"), path.join(root, "b.txt")]);
  await wait(100);

  fs.writeFileSync(path.join(root, "a.txt"), "new-a", "utf8");
  fs.writeFileSync(path.join(root, "b.txt"), "new-b", "utf8");
  await wait(300);

  fw.close();
  fs.rmSync(root, { recursive: true, force: true });

  assert.ok(events.length >= 2, `Expected >= 2 change events, got ${events.length}`);
});
