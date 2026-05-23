"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { CICache, CacheError, CACHE_LEVELS } = require("../../src/ci/cache");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("CICache", () => {
  let cache;

  beforeEach(() => {
    cache = new CICache();
  });

  // 1. basic get/set
  it("should set and get a cached value", () => {
    cache.set("key1", { data: "hello" });
    const result = cache.get("key1");
    assert.deepStrictEqual(result, { data: "hello" });
  });

  it("should return undefined on cache miss", () => {
    const result = cache.get("nonexistent");
    assert.strictEqual(result, undefined);
  });

  it("should return a clone not the original reference", () => {
    const obj = { data: [1, 2, 3] };
    cache.set("key2", obj);
    obj.data.push(4); // mutate original

    const result = cache.get("key2");
    assert.deepStrictEqual(result.data, [1, 2, 3]); // cached copy unchanged
  });

  // 2. has
  it("should check key existence with has()", () => {
    assert.strictEqual(cache.has("k"), false);
    cache.set("k", "v");
    assert.strictEqual(cache.has("k"), true);
  });

  // 3. TTL expiry
  it("should expire entries after TTL", async () => {
    cache.set("expire-key", "val", { ttlMs: 50 });
    assert.strictEqual(cache.get("expire-key"), "val");

    await sleep(80);
    assert.strictEqual(cache.get("expire-key"), undefined);
  });

  it("should respect has() with TTL expiry", async () => {
    cache.set("temp", "x", { ttlMs: 30 });
    assert.strictEqual(cache.has("temp"), true);
    await sleep(50);
    assert.strictEqual(cache.has("temp"), false);
  });

  // 4. invalidate by string pattern
  it("should invalidate entries matching a string pattern", () => {
    cache.set("ci:pipeline:build:123", "a");
    cache.set("ci:pipeline:test:456", "b");
    cache.set("other:key", "c");

    const removed = cache.invalidate("ci:pipeline");
    assert.strictEqual(removed, 2);
    assert.strictEqual(cache.get("ci:pipeline:build:123"), undefined);
    assert.strictEqual(cache.get("ci:pipeline:test:456"), undefined);
    assert.strictEqual(cache.get("other:key"), "c"); // untouched
  });

  // 5. invalidate by RegExp
  it("should invalidate entries matching a regex pattern", () => {
    cache.set("ci:stage:lint:abc", "x");
    cache.set("ci:stage:test:def", "y");
    cache.set("ci:pipeline:build:ghi", "z");

    const removed = cache.invalidate(/^ci:stage:/);
    assert.strictEqual(removed, 2);
    assert.strictEqual(cache.get("ci:stage:lint:abc"), undefined);
    assert.strictEqual(cache.get("ci:stage:test:def"), undefined);
    assert.strictEqual(cache.get("ci:pipeline:build:ghi"), "z"); // untouched
  });

  // 6. invalidate by object pattern (tag, level, key, olderThan)
  it("should invalidate by tag", () => {
    cache.set("k1", "v1", { tags: ["frontend", "js"] });
    cache.set("k2", "v2", { tags: ["backend", "go"] });
    cache.set("k3", "v3", { tags: ["frontend", "css"] });

    const removed = cache.invalidate({ tag: "frontend" });
    assert.strictEqual(removed, 2);
    assert.strictEqual(cache.get("k2"), "v2"); // backend untouched
  });

  it("should invalidate by level", () => {
    cache.set("a", "1", { level: "pipeline" });
    cache.set("b", "2", { level: "stage" });
    cache.set("c", "3", { level: "step" });

    const removed = cache.invalidate({ level: "stage" });
    assert.strictEqual(removed, 1);
    assert.strictEqual(cache.get("b"), undefined);
    assert.strictEqual(cache.get("a"), "1");
    assert.strictEqual(cache.get("c"), "3");
  });

  it("should invalidate by olderThan", async () => {
    cache.set("old", "x");
    await sleep(50);

    const removed = cache.invalidate({ olderThan: new Date().toISOString() });
    assert.strictEqual(removed, 1);
    assert.strictEqual(cache.get("old"), undefined);
  });

  // 7. getStats
  it("should track cache statistics", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");   // hit
    cache.get("c");   // miss
    cache.get("d");   // miss

    const stats = cache.getStats();
    assert.strictEqual(stats.entries, 2);
    assert.strictEqual(stats.sets, 2);
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 2);
    assert.strictEqual(stats.hitRatio, 0.33);
    assert.ok(typeof stats.sizeBytes === "number");
    assert.ok(stats.sizeBytes > 0);
  });

  // 8. prune
  it("should prune entries older than maxAge", async () => {
    cache.set("fresh", "f");
    await sleep(30);
    cache.set("stale", "s");

    // Force createdAt back so it looks older
    // We passed it at creation so use lower-level access
    const entry = cache._store.get("stale");
    entry.createdAt = Date.now() - 10_000; // fake 10s old

    const removed = cache.prune(50, 100); // maxAge=50ms
    assert.ok(removed >= 1); // stale should be removed
    assert.strictEqual(cache.get("fresh"), "f"); // fresh still there
  });

  it("should prune to respect maxSize", () => {
    cache = new CICache({ maxSize: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // should trigger auto-prune

    const stats = cache.getStats();
    assert.ok(stats.entries <= 2);
  });

  it("should prune least-recently-accessed entries when exceeding maxSize", () => {
    cache = new CICache({ maxSize: 3 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // access a and b, leave c as least recently accessed
    cache.get("a");
    cache.get("b");

    cache.prune(undefined, 2);

    assert.strictEqual(cache.has("a"), true);
    assert.strictEqual(cache.has("b"), true);
    assert.strictEqual(cache.has("c"), false); // c should be evicted
  });

  // 9. clear
  it("should clear all entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    const count = cache.clear();
    assert.strictEqual(count, 3);
    assert.strictEqual(cache.getStats().entries, 0);
  });

  // 10. static hash
  it("should compute deterministic hash from inputs", () => {
    const h1 = CICache.hash({ files: ["a.js", "b.js"], deps: { lodash: "4.0" } });
    const h2 = CICache.hash({ files: ["a.js", "b.js"], deps: { lodash: "4.0" } });
    const h3 = CICache.hash({ files: ["a.js"], deps: { lodash: "4.0" } });

    assert.strictEqual(h1, h2); // same inputs = same hash
    assert.notStrictEqual(h1, h3); // different inputs = different hash
  });

  it("should produce same hash regardless of key order", () => {
    const h1 = CICache.hash({ b: 2, a: 1 });
    const h2 = CICache.hash({ a: 1, b: 2 });
    assert.strictEqual(h1, h2);
  });

  // 11. static buildKey
  it("should build a cache key from level, name, and inputs", () => {
    const key = CICache.buildKey("stage", "lint", { files: ["src/*.js"] });
    assert.ok(key.startsWith("ci:stage:lint:"));
    assert.ok(key.length > 30);
  });

  it("should throw on invalid level in buildKey", () => {
    assert.throws(() => CICache.buildKey("unknown", "x"), { code: "INVALID_LEVEL" });
  });

  // 12. set with metadata
  it("should store metadata alongside values", () => {
    cache.set("meta-key", "val", {
      level: "pipeline",
      tags: ["critical", "v1"],
      ttlMs: 60000,
    });

    const entry = cache._store.get("meta-key");
    assert.strictEqual(entry.metadata.level, "pipeline");
    assert.deepStrictEqual(entry.metadata.tags, ["critical", "v1"]);
    assert.strictEqual(entry.metadata.ttlMs, 60000);
    assert.ok(typeof entry.metadata.expiresAt === "number");
    assert.ok(entry.metadata.expiresAt > Date.now());
  });

  // 13. invalidate returns correct count
  it("should return count of invalidated entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    const removed = cache.invalidate(/^[ab]$/);
    assert.strictEqual(removed, 2);
    assert.strictEqual(cache.getStats().entries, 1);
    assert.strictEqual(cache.getStats().invalidations, 2);
  });

  // 14. edge: set with empty tags/metadata
  it("should handle set() with no metadata gracefully", () => {
    cache.set("minimal", "ok");
    const val = cache.get("minimal");
    assert.strictEqual(val, "ok");

    const entry = cache._store.get("minimal");
    assert.strictEqual(entry.metadata.level, "stage"); // default
    assert.deepStrictEqual(entry.metadata.tags, []);
  });
});
