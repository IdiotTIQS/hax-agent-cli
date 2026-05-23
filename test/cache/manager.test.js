"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CacheManager, CacheError, CACHE_LEVELS } = require("../../src/cache/manager");

// ── helpers ──────────────────────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-cache-mgr-"));
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

// ── L1 (memory) tests ───────────────────────────────────────────────────────

test("L1: set and get returns stored value", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("key1", { data: "hello" });
  const result = cache.get("key1");
  assert.deepEqual(result, { data: "hello" });
  cache.destroy();
});

test("L1: get returns undefined on miss", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  const result = cache.get("nonexistent");
  assert.equal(result, undefined);
  cache.destroy();
});

test("L1: LRU eviction when exceeding max size", () => {
  const cache = new CacheManager({ l1MaxSize: 3, backgroundCleanup: false });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  // Access "a" to make it recently used
  cache.get("a");

  // Insert "d" — should evict "b" (oldest LRU)
  cache.set("d", 4);

  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.get("d"), 4);
  cache.destroy();
});

test("L1: TTL expiry — entry expires and returns undefined", (t) => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("temp", "value", { ttl: 50 }); // 50ms TTL

  assert.equal(cache.get("temp"), "value");

  // Wait for expiry
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(cache.get("temp"), undefined);
      cache.destroy();
      resolve();
    }, 80);
  });
});

test("L1: set with no TTL (0) means no expiry", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("forever", "eternal", { ttl: 0 });

  const stats = cache.getStats();
  assert.equal(cache.get("forever"), "eternal");

  // Check ttl method returns 0 (no expiry)
  assert.equal(cache.ttl("forever"), 0);
  cache.destroy();
});

// ── L2 (disk) tests ─────────────────────────────────────────────────────────

test("L2: stores to disk and retrieves across instances", () => {
  const dir = tempDir();
  const cache1 = new CacheManager({ diskDir: dir, backgroundCleanup: false });
  cache1.set("persist-key", { name: "disk-data" }, { level: "disk" });
  assert.equal(cache1.get("persist-key").name, "disk-data");
  cache1.destroy();

  // New instance with same disk dir should recover from L2
  const cache2 = new CacheManager({ diskDir: dir, backgroundCleanup: false });
  const result = cache2.get("persist-key");
  assert.deepEqual(result, { name: "disk-data" });
  cache2.destroy();
  cleanupDir(dir);
});

test("L2: promotion — L2 hit promotes to L1", () => {
  const dir = tempDir();
  const cache = new CacheManager({ diskDir: dir, backgroundCleanup: false });
  cache.set("promo-key", "promo-value", { level: "disk" });

  // First access: L2 hit, promotes to L1
  assert.equal(cache.get("promo-key"), "promo-value");

  const stats = cache.getStats();
  assert.ok(stats.l2.hits >= 1, "Expected at least 1 L2 hit");
  assert.ok(stats.totalPromotions >= 1, "Expected promotion from L2 to L1");

  // Second access: should be L1 hit (already promoted)
  assert.equal(cache.get("promo-key"), "promo-value");
  assert.ok(cache.getStats().l1.hits >= 1, "Expected L1 hit after promotion");

  cache.destroy();
  cleanupDir(dir);
});

test("L2: TTL expiry on disk entries", () => {
  const dir = tempDir();
  const cache = new CacheManager({ diskDir: dir, backgroundCleanup: false });
  cache.set("short-lived", "expires-soon", { ttl: 60, level: "disk" });

  assert.equal(cache.get("short-lived"), "expires-soon");

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(cache.get("short-lived"), undefined);
      cache.destroy();

      // New instance also sees it as expired
      const cache2 = new CacheManager({ diskDir: dir, backgroundCleanup: false });
      assert.equal(cache2.get("short-lived"), undefined);
      cache2.destroy();
      cleanupDir(dir);
      resolve();
    }, 120);
  });
});

// ── L3 (remote) tests ───────────────────────────────────────────────────────

test("L3: getAsync retrieves from remote adapter", async () => {
  const remoteStore = new Map();
  const adapter = {
    get: async (key) => remoteStore.get(key) || null,
    set: async (key, value) => { remoteStore.set(key, value); },
    delete: async () => {},
  };

  remoteStore.set("remote-key", { from: "remote" });

  const cache = new CacheManager({ remoteAdapter: adapter, backgroundCleanup: false });
  const result = await cache.getAsync("remote-key");

  assert.deepEqual(result, { from: "remote" });

  // Should now also be in L1
  assert.equal(cache.get("remote-key").from, "remote");

  cache.destroy();
});

test("L3: setAsync stores to remote adapter", async () => {
  const remoteStore = new Map();
  const adapter = {
    get: async (key) => remoteStore.get(key) || null,
    set: async (key, value) => { remoteStore.set(key, value); },
    delete: async () => {},
  };

  const cache = new CacheManager({ remoteAdapter: adapter, backgroundCleanup: false });
  await cache.setAsync("remote-set", { data: 42 }, { level: "remote" });

  assert.ok(remoteStore.has("remote-set"));
  assert.deepEqual(remoteStore.get("remote-set"), { data: 42 });

  // Also in L1
  assert.deepEqual(cache.get("remote-set"), { data: 42 });

  cache.destroy();
});

test("L3: getAsync returns undefined when no adapter configured", async () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  const result = await cache.getAsync("no-adapter-key");
  assert.equal(result, undefined);
  cache.destroy();
});

// ── Invalidation tests ──────────────────────────────────────────────────────

test("invalidate: removes L1 entries by string pattern", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("user:1", { name: "Alice" });
  cache.set("user:2", { name: "Bob" });
  cache.set("order:1", { total: 100 });

  const removed = cache.invalidate("user:");
  assert.equal(removed, 2);
  assert.equal(cache.get("user:1"), undefined);
  assert.equal(cache.get("user:2"), undefined);
  assert.equal(cache.get("order:1").total, 100);
  cache.destroy();
});

test("invalidate: removes L2 entries by RegExp", () => {
  const dir = tempDir();
  const cache = new CacheManager({ diskDir: dir, backgroundCleanup: false });

  cache.set("prod:key1", "p1", { level: "disk" });
  cache.set("prod:key2", "p2", { level: "disk" });
  cache.set("dev:key1", "d1", { level: "disk" });

  const removed = cache.invalidate(/^prod:/);
  assert.equal(removed, 2);
  assert.equal(cache.get("prod:key1"), undefined);
  assert.equal(cache.get("prod:key2"), undefined);
  assert.equal(cache.get("dev:key1"), "d1");

  cache.destroy();
  cleanupDir(dir);
});

test("invalidate: object pattern matches by tag", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("a", 1, { tags: ["temp"] });
  cache.set("b", 2, { tags: ["important"] });
  cache.set("c", 3, { tags: ["temp", "draft"] });

  const removed = cache.invalidate({ tag: "temp" });
  assert.equal(removed, 2);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), undefined);
  cache.destroy();
});

test("invalidate: throws on empty key", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  assert.throws(() => cache.get(""), { name: "CacheError" });
  assert.throws(() => cache.get("  "), { name: "CacheError" });
  assert.throws(() => cache.set("", "x"), { name: "CacheError" });
  cache.destroy();
});

// ── Warm tests ──────────────────────────────────────────────────────────────

test("warm: preloads keys from L2 into L1", async () => {
  const dir = tempDir();
  const cache = new CacheManager({ diskDir: dir, backgroundCleanup: false });

  cache.set("warm:a", "A", { level: "disk" });
  cache.set("warm:b", "B", { level: "disk" });
  cache.set("warm:c", "C", { level: "disk" });

  // Clear L1 to simulate cold start
  cache.clear();
  // Re-set to L2 only
  cache.set("warm:a", "A", { level: "disk" });
  cache.set("warm:b", "B", { level: "disk" });
  cache.set("warm:c", "C", { level: "disk" });

  // But clear does not remove disk — let's verify
  // we need a better approach. Let me use a fresh instance.
  // Actually, the clear() method also clears L2. So let me just verify warm works.

  // Recreate dir
  cleanupDir(dir);
  const dir2 = tempDir();
  const cache2 = new CacheManager({ diskDir: dir2, backgroundCleanup: false });
  cache2.set("warm:a", "A", { level: "disk" });
  cache2.set("warm:b", "B", { level: "disk" });

  const result = await cache2.warm(["warm:a", "warm:b", "warm:nonexistent"]);
  assert.equal(result.warmed, 2);
  assert.equal(result.missed, 1);

  // Keys should now be in L1
  assert.equal(cache2.get("warm:a"), "A");
  assert.equal(cache2.get("warm:b"), "B");

  cache2.destroy();
  cleanupDir(dir);
  cleanupDir(dir2);
});

test("warm: returns 0 warmed for empty array", async () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  const result = await cache.warm([]);
  assert.deepEqual(result, { warmed: 0, missed: 0, skipped: 0 });
  cache.destroy();
});

// ── Stats tests ─────────────────────────────────────────────────────────────

test("getStats: returns per-level statistics after mixed operations", () => {
  const cache = new CacheManager({ backgroundCleanup: false });

  cache.set("s1", "val1");
  cache.get("s1");    // hit
  cache.get("s1");    // hit
  cache.get("miss1"); // miss

  const stats = cache.getStats();

  assert.ok(typeof stats.l1 === "object");
  assert.ok(typeof stats.l2 === "object");
  assert.ok(typeof stats.l3 === "object");
  assert.equal(stats.l1.hits, 2);
  assert.equal(stats.l1.misses, 1);
  assert.equal(stats.l1.entries, 1);
  assert.equal(stats.l1.maxSize, 1000);
  assert.ok(stats.l1.hitRate >= 0);
  assert.equal(stats.l3.adapter, null);
  assert.equal(stats.totalInvalidations, 0);
  assert.ok(typeof stats.defaultTTL === "number");

  cache.destroy();
});

// ── Sweep & has tests ───────────────────────────────────────────────────────

test("sweep: removes expired entries from L1 and L2", () => {
  const dir = tempDir();
  const cache = new CacheManager({
    diskDir: dir,
    l1MaxSize: 100,
    defaultTTL: 5 * 60 * 1000,
    backgroundCleanup: false,
  });

  // Set a very short TTL (1ms) so the entry expires almost immediately
  cache.set("sweep:a", "A", { ttl: 1 });
  cache.set("sweep:b", "B", { ttl: 99999, level: "disk" });

  // Small delay to let sweep:a expire
  const start = Date.now();
  while (Date.now() - start < 5) { /* busy-wait ~5ms */ }

  const removed = cache.sweep();
  assert.ok(removed >= 1, `Expected at least 1 expired entry removed, got ${removed}`);
  assert.equal(cache.get("sweep:a"), undefined);
  assert.equal(cache.get("sweep:b"), "B");

  cache.destroy();
  cleanupDir(dir);
});

test("has: correctly reports key existence", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("exists", "yes");
  assert.equal(cache.has("exists"), true);
  assert.equal(cache.has("nope"), false);
  assert.equal(cache.has(""), false);
  cache.destroy();
});

// ── Error handling ───────────────────────────────────────────────────────────

test("rejects non-string keys with CacheError", () => {
  const cache = new CacheManager({ backgroundCleanup: false });

  assert.throws(() => cache.get(null), { name: "CacheError" });
  assert.throws(() => cache.get(123), { name: "CacheError" });
  assert.throws(() => cache.set(undefined, "x"), { name: "CacheError" });

  cache.destroy();
});

test("warm rejects non-array argument", async () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  await assert.rejects(() => cache.warm("not-an-array"), { name: "CacheError" });
  cache.destroy();
});

// ── Clear & destroy ─────────────────────────────────────────────────────────

test("clear: resets all levels and stats", () => {
  const cache = new CacheManager({ backgroundCleanup: false });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");

  cache.clear();

  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.getStats().l1.hits, 0);
  assert.equal(cache.getStats().l1.entries, 0);
  cache.destroy();
});

test("destroy: stops background cleanup timer", () => {
  const cache = new CacheManager({ backgroundCleanup: true, cleanupInterval: 100 });
  // Setting up with cleanup should work
  assert.ok(cache._cleanupTimer !== null);
  cache.destroy();
  assert.equal(cache._cleanupTimer, null);
});
