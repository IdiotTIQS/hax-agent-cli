"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MemoryArchiver,
  generateArchiveName,
  listArchiveFiles,
} = require("../../src/memory/archiver");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(name, content, tags = [], namespace = "test") {
  const now = new Date().toISOString();
  return { name, namespace, tags, createdAt: now, updatedAt: now, content };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-arch-"));
}

function cleanup(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// generateArchiveName
// ---------------------------------------------------------------------------

test("generateArchiveName: returns a .json.gz filename", () => {
  const name = generateArchiveName();
  assert.ok(name.endsWith(".json.gz"), `Expected .json.gz extension, got ${name}`);
  assert.ok(name.startsWith("hax-memory-archive-"), `Unexpected prefix: ${name}`);
});

test("generateArchiveName: supports custom prefix", () => {
  const name = generateArchiveName("custom-test");
  assert.ok(name.startsWith("custom-test-"));
  assert.ok(name.endsWith(".json.gz"));
});

// ---------------------------------------------------------------------------
// MemoryArchiver
// ---------------------------------------------------------------------------

test("MemoryArchiver: archive creates compressed file with metadata", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const memories = [
    makeMemory("mem-1", "Content one.", ["important"]),
    makeMemory("mem-2", "Content two.", ["key"]),
  ];

  const result = archiver.archive(memories);

  assert.ok(result, "Expected non-null result");
  assert.ok(result.path.endsWith(".json.gz"));
  assert.ok(fs.existsSync(result.path), `Archive file should exist at ${result.path}`);
  assert.equal(result.metadata.memoryCount, 2);
  assert.ok(result.metadata.fileSize > 0);

  cleanup(archiveDir);
});

test("MemoryArchiver: archive returns null for empty input", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  assert.equal(archiver.archive([]), null);
  assert.equal(archiver.archive(null), null);

  cleanup(archiveDir);
});

test("MemoryArchiver: archive supports custom path", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });
  const customPath = path.join(archiveDir, "custom-archive.json.gz");

  const memories = [makeMemory("mem", "Content.")];
  const result = archiver.archive(memories, customPath);

  assert.equal(result.path, customPath);
  assert.ok(fs.existsSync(customPath));

  cleanup(archiveDir);
});

test("MemoryArchiver: restore returns memories from archive", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const original = [
    makeMemory("mem-a", "Content A.", ["alpha"], "ns1"),
    makeMemory("mem-b", "Content B.", ["beta"], "ns2"),
  ];

  const archiveResult = archiver.archive(original);
  const restored = archiver.restore(archiveResult.path);

  assert.equal(restored.length, 2);
  assert.equal(restored[0].name, "mem-a");
  assert.equal(restored[1].name, "mem-b");
  // Each should have restore metadata.
  assert.ok(restored[0].restoredFromArchive);
  assert.ok(restored[0].restoredAt);

  cleanup(archiveDir);
});

test("MemoryArchiver: restore filters by namespace", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const original = [
    makeMemory("mem-a", "Content.", ["tag"], "ns-alpha"),
    makeMemory("mem-b", "Content.", ["tag"], "ns-beta"),
  ];

  const archiveResult = archiver.archive(original);
  const restored = archiver.restore(archiveResult.path, { namespace: "ns-alpha" });

  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, "mem-a");

  cleanup(archiveDir);
});

test("MemoryArchiver: restore filters by tag", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const original = [
    makeMemory("mem-a", "Content.", ["important"]),
    makeMemory("mem-b", "Content.", ["transient"]),
  ];

  const archiveResult = archiver.archive(original);
  const restored = archiver.restore(archiveResult.path, { tag: "important" });

  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, "mem-a");

  cleanup(archiveDir);
});

test("MemoryArchiver: restore filters by name", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const original = [
    makeMemory("apple", "Content."),
    makeMemory("banana", "Content."),
    makeMemory("orange", "Content."),
  ];

  const archiveResult = archiver.archive(original);
  const restored = archiver.restore(archiveResult.path, { name: "pp" });

  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, "apple");

  cleanup(archiveDir);
});

test("MemoryArchiver: restore returns empty for missing archive", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });
  const result = archiver.restore(path.join(archiveDir, "nonexistent.json.gz"));

  assert.deepEqual(result, []);

  cleanup(archiveDir);
});

test("MemoryArchiver: listArchives returns available archives", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  // No archives yet.
  let list = archiver.listArchives();
  assert.equal(list.length, 0);

  // Create one.
  archiver.archive([makeMemory("mem", "Content.")]);

  list = archiver.listArchives();
  assert.equal(list.length, 1);
  assert.ok(typeof list[0].name === "string");
  assert.ok(typeof list[0].path === "string");
  assert.ok(typeof list[0].size === "number");
  assert.ok(typeof list[0].createdAt === "string");
  assert.equal(list[0].memoryCount, 1);

  cleanup(archiveDir);
});

test("MemoryArchiver: listArchives returns empty when directory does not exist", () => {
  const archiver = new MemoryArchiver({
    archiveDir: "/tmp/hax-nonexistent-dir-" + Math.random(),
  });
  const list = archiver.listArchives();
  assert.deepEqual(list, []);
});

test("MemoryArchiver: pruneArchives removes old archives", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({
    archiveDir,
    maxArchiveAgeMs: 1, // 1ms — everything is old
  });

  // Create two archives.
  archiver.archive([makeMemory("mem-1", "Content.")]);
  archiver.archive([makeMemory("mem-2", "Content.")]);

  const listBefore = archiver.listArchives();
  assert.ok(listBefore.length >= 2);

  const result = archiver.pruneArchives(1, 100);
  assert.equal(result.removed, listBefore.length, `Expected all removed, got ${result.removed}`);

  const listAfter = archiver.listArchives();
  assert.equal(listAfter.length, 0);

  cleanup(archiveDir);
});

test("MemoryArchiver: pruneArchives enforces maxCount", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({
    archiveDir,
    maxArchiveAgeMs: 365 * 24 * 60 * 60 * 1000, // 1 year — nothing is old by age
  });

  // Create several archives.
  for (let i = 0; i < 5; i++) {
    archiver.archive([makeMemory("mem", `Content ${i}`)]);
  }

  const result = archiver.pruneArchives(null, 2);

  assert.ok(
    result.removed >= 3,
    `Expected at least 3 pruned by count, got ${result.removed}`
  );
  assert.ok(result.kept <= 2, `Expected at most 2 kept, got ${result.kept}`);

  const listAfter = archiver.listArchives();
  assert.ok(listAfter.length <= 2);

  cleanup(archiveDir);
});

test("MemoryArchiver: pruneArchives handles empty directory", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const result = archiver.pruneArchives();
  assert.equal(result.removed, 0);
  assert.equal(result.kept, 0);
  assert.deepEqual(result.removedPaths, []);

  cleanup(archiveDir);
});

test("MemoryArchiver: searchArchives finds memories by query", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  archiver.archive([
    makeMemory("project-alpha", "This memory is about the alpha project."),
    makeMemory("meeting-notes", "Notes from the weekly meeting."),
    makeMemory("grocery-list", "Milk, eggs, bread, butter."),
  ]);

  const results = archiver.searchArchives("alpha");

  assert.ok(results.length >= 1, `Expected >=1 result, got ${results.length}`);
  assert.equal(results[0].memory.name, "project-alpha");
  assert.ok(results[0].score > 0);
  assert.ok(typeof results[0].archive === "string");

  cleanup(archiveDir);
});

test("MemoryArchiver: searchArchives handles no matches", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  archiver.archive([makeMemory("mem", "Some content here.")]);

  const results = archiver.searchArchives("zzzznonexistentzzzz");
  assert.deepEqual(results, []);

  cleanup(archiveDir);
});

test("MemoryArchiver: searchArchives handles empty query", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  archiver.archive([makeMemory("mem", "Content.")]);

  assert.deepEqual(archiver.searchArchives(""), []);
  assert.deepEqual(archiver.searchArchives(null), []);
  assert.deepEqual(archiver.searchArchives(undefined), []);

  cleanup(archiveDir);
});

test("MemoryArchiver: searchArchives respects namespace filter", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  archiver.archive([
    makeMemory("mem-a", "Important info about search.", [], "ns-alpha"),
    makeMemory("mem-b", "Important info about search.", [], "ns-beta"),
  ]);

  const results = archiver.searchArchives("search", { namespace: "ns-alpha" });

  assert.equal(results.length, 1);
  assert.equal(results[0].memory.name, "mem-a");

  cleanup(archiveDir);
});

test("MemoryArchiver: searchArchives respects limit", () => {
  const archiveDir = tempDir();
  const archiver = new MemoryArchiver({ archiveDir });

  const memories = [];
  for (let i = 0; i < 10; i++) {
    memories.push(makeMemory(`mem-${i}`, `Common match phrase here for memory ${i}.`));
  }

  archiver.archive(memories);

  const results = archiver.searchArchives("match phrase", { limit: 3 });

  assert.ok(results.length <= 3, `Expected <=3, got ${results.length}`);

  cleanup(archiveDir);
});
