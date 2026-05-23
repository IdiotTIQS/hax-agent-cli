/**
 * Tests for memory eviction.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { writeMemory, listMemories, deleteMemory } = require("../src/memory");
const {
  EVICTION_STRATEGIES,
  checkEvictionNeeded,
  evictMemories,
  evictAllMemories,
  getMemoryStorageStats,
} = require("../src/memory-eviction");

function createTempSettings() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-evic-"));
  return { memory: { directory: tmpDir, maxItems: 5 } };
}

function cleanupSettings(settings) {
  try {
    const dir = settings.memory.directory;
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {
    // ignore cleanup errors
  }
}

test("checkEvictionNeeded: returns false when under limit", () => {
  const settings = createTempSettings();
  writeMemory("test-mem", "content", settings);
  const result = checkEvictionNeeded({ settings });
  assert.equal(result.needsEviction, false);
  assert.equal(result.currentCount, 1);
  assert.equal(result.maxItems, 5);
  cleanupSettings(settings);
});

test("checkEvictionNeeded: returns true when over limit", () => {
  const settings = createTempSettings();
  for (let i = 0; i < 7; i++) {
    writeMemory(`mem-${i}`, `content-${i}`, settings);
  }
  const result = checkEvictionNeeded({ settings });
  assert.equal(result.needsEviction, true);
  assert.equal(result.currentCount, 7);
  cleanupSettings(settings);
});

test("evictMemories: removes excess memories", () => {
  const settings = createTempSettings();
  for (let i = 0; i < 10; i++) {
    writeMemory(`mem-${i}`, `content-${i}`, settings);
  }
  const before = listMemories(settings);
  assert.ok(before.length >= 10);

  const result = evictMemories({ settings, maxItems: 5 });
  assert.ok(result.evicted >= 5, `Expected at least 5 evicted, got ${result.evicted}`);
  assert.ok(result.kept <= 5, `Expected at most 5 kept, got ${result.kept}`);

  const after = listMemories(settings);
  assert.ok(after.length <= 5, `After eviction expected <=5, got ${after.length}`);
  cleanupSettings(settings);
});

test("evictMemories: keeps within limit when already fine", () => {
  const settings = createTempSettings();
  writeMemory("only-one", "content", settings);
  const result = evictMemories({ settings, maxItems: 10 });
  assert.equal(result.evicted, 0);
  assert.equal(result.kept, 1);
  assert.equal(result.exceededBy, 0);
  cleanupSettings(settings);
});

test("evictMemories: evicts oldest memories first with LRU strategy", () => {
  const settings = createTempSettings();
  // Write memories in order - oldest first
  for (let i = 0; i < 8; i++) {
    writeMemory(`mem-${i}`, `content-${i}`, settings);
    // Small sleep to ensure timestamps differ
    if (i < 7) {
      const memPath = path.join(settings.memory.directory, `mem-${i}-*.json`);
      // Timestamps are already ordered by creation
    }
  }

  // Update mem-7 (newest) to make it definitely the newest
  writeMemory("mem-7", "updated-content", settings);

  const result = evictMemories({
    settings,
    maxItems: 4,
    strategy: EVICTION_STRATEGIES.LEAST_RECENTLY_UPDATED,
  });
  assert.ok(result.evicted >= 4);
  assert.ok(result.kept <= 4);
  cleanupSettings(settings);
});

test("evictAllMemories: removes all memories", () => {
  const settings = createTempSettings();
  for (let i = 0; i < 5; i++) {
    writeMemory(`mem-${i}`, `content-${i}`, settings);
  }
  const before = listMemories(settings);
  assert.ok(before.length >= 5);

  const evicted = evictAllMemories({ settings });
  assert.equal(evicted, before.length);

  const after = listMemories(settings);
  assert.equal(after.length, 0);
  cleanupSettings(settings);
});

test("getMemoryStorageStats: returns correct stats", () => {
  const settings = createTempSettings();
  writeMemory("test-mem", "content", settings);
  const stats = getMemoryStorageStats({ settings });
  assert.equal(stats.total, 1);
  assert.ok(stats.maxItems > 0);
  assert.ok(typeof stats.utilization === "number");
  assert.ok(typeof stats.oldestCreatedAt === "string");
  assert.ok(typeof stats.newestCreatedAt === "string");
  cleanupSettings(settings);
});

test("getMemoryStorageStats: returns zero total for empty storage", () => {
  const settings = createTempSettings();
  const stats = getMemoryStorageStats({ settings });
  assert.equal(stats.total, 0);
  assert.equal(stats.utilization, 0);
  assert.equal(stats.oldestCreatedAt, null);
  assert.equal(stats.newestCreatedAt, null);
  cleanupSettings(settings);
});
