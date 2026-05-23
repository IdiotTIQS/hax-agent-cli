"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RequestCache } = require("../../src/gateway/cache");

test("RequestCache set and get a cached response", () => {
  const cache = new RequestCache();
  cache.set("key-1", { data: "hello" });
  const result = cache.get("key-1");
  assert.deepEqual(result, { data: "hello" });
});

test("RequestCache get returns null for missing keys", () => {
  const cache = new RequestCache();
  const result = cache.get("nonexistent");
  assert.equal(result, null);
});

test("RequestCache get returns null for expired entries", () => {
  const cache = new RequestCache();
  // Set with a very short TTL
  cache.set("ephemeral", { data: "temp" }, 1);

  // Wait for expiry
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = cache.get("ephemeral");
      assert.equal(result, null);
      resolve();
    }, 10);
  });
});

test("RequestCache set uses default TTL when none is provided", () => {
  const cache = new RequestCache({ defaultTTL: 100 });
  cache.set("default-ttl", { val: 1 });
  // Should be retrievable immediately
  const result = cache.get("default-ttl");
  assert.deepEqual(result, { val: 1 });
});

test("RequestCache keyFromRequest generates deterministic keys from request shape", () => {
  const key1 = RequestCache.keyFromRequest({
    method: "POST",
    url: "/api/chat",
    body: { prompt: "hello" },
  });
  const key2 = RequestCache.keyFromRequest({
    method: "POST",
    url: "/api/chat",
    body: { prompt: "hello" },
  });
  const key3 = RequestCache.keyFromRequest({
    method: "GET",
    url: "/api/chat",
  });

  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
  assert.ok(key1.startsWith("POST:/api/chat:"));
});

test("RequestCache keyFromRequest handles different methods", () => {
  const getKey = RequestCache.keyFromRequest({ method: "get", url: "/test", body: "x" });
  const postKey = RequestCache.keyFromRequest({ method: "POST", url: "/test", body: "x" });

  assert.notEqual(getKey, postKey);
  // Method is normalized to uppercase in the key
  assert.ok(getKey.startsWith("GET:"));
  assert.ok(postKey.startsWith("POST:"));
});

test("RequestCache invalidate removes entries matching a string pattern", () => {
  const cache = new RequestCache();
  cache.set("user:1:profile", { name: "Alice" });
  cache.set("user:2:profile", { name: "Bob" });
  cache.set("admin:1:config", { role: "admin" });

  const removed = cache.invalidate("user:");
  assert.equal(removed, 2);
  assert.equal(cache.get("user:1:profile"), null);
  assert.equal(cache.get("user:2:profile"), null);
  assert.notEqual(cache.get("admin:1:config"), null);
});

test("RequestCache invalidate removes entries matching a RegExp pattern", () => {
  const cache = new RequestCache();
  cache.set("api:v1:users", []);
  cache.set("api:v2:users", []);
  cache.set("api:v1:posts", []);

  const removed = cache.invalidate(/api:v1:/);
  assert.equal(removed, 2);
  assert.equal(cache.get("api:v1:users"), null);
  assert.equal(cache.get("api:v1:posts"), null);
  assert.notEqual(cache.get("api:v2:users"), null);
});

test("RequestCache getStats tracks hit rate and miss rate", () => {
  const cache = new RequestCache();
  cache.set("a", 1);
  cache.set("b", 2);

  cache.get("a"); // hit
  cache.get("b"); // hit
  cache.get("c"); // miss

  const stats = cache.getStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 1);
  assert.equal(stats.hitRate, 2 / 3);
  assert.equal(stats.missRate, 1 / 3);
  assert.equal(stats.size, 2);
  assert.equal(stats.entryCount, 2);
});

test("RequestCache evicts LRU entry when max size exceeded", () => {
  const cache = new RequestCache({ maxSize: 3 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  // Access "a" so "b" becomes LRU
  cache.get("a");
  cache.get("c");

  // This should evict "b"
  cache.set("d", 4);

  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.get("d"), 4);
});

test("RequestCache sweep removes expired entries and returns count", () => {
  const cache = new RequestCache({ defaultTTL: 10, backgroundCleanup: false });
  cache.set("fresh", 1, 60000);
  cache.set("stale", 2, 1);

  // Wait for the stale entry to expire
  return new Promise((resolve) => {
    setTimeout(() => {
      const removed = cache.sweep();
      assert.equal(removed, 1);
      assert.notEqual(cache.get("fresh"), null);
      assert.equal(cache.get("stale"), null);
      resolve();
    }, 10);
  });
});

test("RequestCache clear removes all entries and resets stats", () => {
  const cache = new RequestCache();
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.get("c"); // miss

  cache.clear();

  assert.equal(cache.get("a"), null);
  assert.equal(cache.get("b"), null);

  const stats = cache.getStats();
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 2);
  assert.equal(stats.size, 0);
});

test("RequestCache set updates existing key with new TTL", () => {
  const cache = new RequestCache();
  cache.set("key", { version: 1 });
  cache.set("key", { version: 2 }, 60000);

  const result = cache.get("key");
  assert.deepEqual(result, { version: 2 });
  assert.equal(cache.getStats().size, 1);
});

test("RequestCache destroy stops background cleanup", () => {
  const cache = new RequestCache({ backgroundCleanup: true });
  assert.ok(cache._cleanupTimer !== null);

  cache.destroy();
  assert.equal(cache._cleanupTimer, null);
});
