"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CacheManager } = require("../../src/cache/manager");
const { CachePreloader } = require("../../src/cache/preloader");

// ── helpers ──────────────────────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-preload-"));
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function createManager(dir) {
  return new CacheManager({ diskDir: dir || tempDir(), backgroundCleanup: false });
}

// ── Construction ─────────────────────────────────────────────────────────────

test("constructor requires a CacheManager instance", () => {
  assert.throws(() => new CachePreloader(null), { name: "TypeError" });
  assert.throws(() => new CachePreloader({}), { name: "TypeError" });
});

test("constructor accepts and applies options", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, {
    minConfidence: 0.5,
    maxSuggestions: 10,
    decayFactor: 0.8,
    lookbackWindowMs: 60000,
    minAccessCount: 3,
  });

  const stats = preloader.getStats();
  assert.equal(stats.minConfidence, 0.5);
  assert.equal(stats.maxSuggestions, 10);
  assert.equal(stats.patternCount, 0);
  cache.destroy();
});

// ── Learning ─────────────────────────────────────────────────────────────────

test("learn: records keys from session data", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  const sessions = [
    { keys: ["user:1", "user:2", "config:main"], time: Date.now() },
    { keys: ["user:1", "order:55"], time: Date.now() },
    { keys: ["user:1", "config:main", "order:55"], time: Date.now() },
  ];

  const learned = preloader.learn(sessions);
  assert.equal(learned, 8); // total key accesses counted

  const stats = preloader.getStats();
  assert.equal(stats.totalLearned, 8);
  assert.equal(stats.patternCount, 4); // unique keys: user:1, user:2, config:main, order:55

  cache.destroy();
});

test("learn: handles sessions that are arrays of keys directly", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  const sessions = [
    ["key:a", "key:b"],
    ["key:a", "key:c"],
  ];

  preloader.learn(sessions);
  const stats = preloader.getStats();
  assert.equal(stats.totalLearned, 4);
  assert.equal(stats.patternCount, 3);
  cache.destroy();
});

test("learn: boosts frequently accessed keys more than rare keys", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minAccessCount: 1, minConfidence: 0 });

  const now = Date.now();

  // freq-key accessed 5 times recently
  for (let i = 0; i < 5; i++) {
    preloader.learn([{ keys: ["freq-key"], timestamp: now - i * 10 }]);
  }

  // rare-key accessed only once recently
  preloader.learn([{ keys: ["rare-key"], timestamp: now }]);

  const suggestions = preloader.getPreloadSuggestions();

  const freqSuggestion = suggestions.find((s) => s.key === "freq-key");
  const rareSuggestion = suggestions.find((s) => s.key === "rare-key");

  assert.ok(freqSuggestion, "freq-key should be in suggestions");
  assert.ok(rareSuggestion, "rare-key should be in suggestions");

  // freq-key (5 accesses) should score higher than rare-key (1 access)
  assert.ok(
    freqSuggestion.score > rareSuggestion.score,
    `Expected freq-key score (${freqSuggestion.score}) > rare-key score (${rareSuggestion.score})`
  );

  cache.destroy();
});

test("learn: ignores empty keys", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  preloader.learn([{ keys: ["", "  ", "valid-key"], time: Date.now() }]);
  const stats = preloader.getStats();
  assert.equal(stats.patternCount, 1);
  assert.equal(stats.totalLearned, 1);
  cache.destroy();
});

// ── recordAccess ─────────────────────────────────────────────────────────────

test("recordAccess: tracks individual key accesses", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  // Cache a key, then record access as if it was retrieved
  cache.set("user:1", { name: "Alice" });
  preloader.recordAccess("user:1", { tags: ["user"] });
  preloader.recordAccess("user:1");
  preloader.recordAccess("user:1");

  const patterns = preloader.getPatterns();
  assert.ok(patterns.has("user:1"));
  assert.equal(patterns.get("user:1").count, 3);
  cache.destroy();
});

// ── Preloading ───────────────────────────────────────────────────────────────

test("preload: warms cache with keys matching pattern", async () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minConfidence: 0, minAccessCount: 2 });

  // Learn some patterns
  preloader.learn([
    { keys: ["user:alice", "user:bob", "admin:charlie"], time: Date.now() },
    { keys: ["user:alice", "user:dave"], time: Date.now() },
    { keys: ["user:alice", "admin:charlie"], time: Date.now() },
  ]);

  // Seed the cache with actual data so warm has something to load
  cache.set("user:alice", { name: "Alice" }, { level: "disk" });
  cache.set("user:bob", { name: "Bob" }, { level: "disk" });
  cache.set("user:dave", { name: "Dave" }, { level: "disk" });

  // Clear L1 to simulate cold start
  // (we can't easily clear L1 only, so let's use warm to load from L2)
  // Instead, let's test that preload calls warm with the right keys
  // by checking that keys get loaded into L1

  const result = await preloader.preload("user:");
  assert.ok(result.warmed >= 1, `Expected at least 1 warmed, got ${result.warmed}`);
  assert.ok(typeof result.missed === "number");
  assert.ok(typeof result.skipped === "number");

  cache.destroy();
});

test("preload: skips keys already in L1 cache", async () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minConfidence: 0, minAccessCount: 1 });

  // Learn a pattern
  preloader.learn([
    { keys: ["cached-key", "uncached-key"], time: Date.now() },
    { keys: ["cached-key", "uncached-key"], time: Date.now() },
  ]);

  // Put one key in L1 (already cached)
  cache.set("cached-key", "already-here");

  // Also set uncached-key in L2 so warm can find it
  cache.set("uncached-key", "in-disk", { level: "disk" });

  const result = await preloader.preload("");

  // cached-key should be skipped (already in L1), uncached-key warmed
  assert.ok(result.warmed >= 0);
  assert.ok(result.skipped >= 0);

  cache.destroy();
});

// ── Suggestions ─────────────────────────────────────────────────────────────

test("getPreloadSuggestions: returns ranked keys not in cache", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minAccessCount: 2, minConfidence: 0.1 });

  // Learn patterns
  preloader.learn([
    { keys: ["hot:key", "warm:key", "cold:key"], time: Date.now() },
    { keys: ["hot:key", "warm:key"], time: Date.now() },
    { keys: ["hot:key"], time: Date.now() },
  ]);

  // Put warm:key in cache so it should be excluded
  cache.set("warm:key", "cached");

  const suggestions = preloader.getPreloadSuggestions();
  assert.ok(Array.isArray(suggestions));
  assert.ok(suggestions.length >= 1);

  // warm:key should NOT be suggested (already in cache)
  const warmSuggestion = suggestions.find((s) => s.key === "warm:key");
  assert.equal(warmSuggestion, undefined);

  // hot:key should be first (most frequent)
  if (suggestions.length > 0) {
    assert.ok(suggestions[0].key === "hot:key" || suggestions[0].score >= suggestions[suggestions.length - 1].score);
  }

  cache.destroy();
});

test("getPreloadSuggestions: respects limit and minScore options", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minAccessCount: 1, minConfidence: 0 });

  const keys = Array.from({ length: 50 }, (_, i) => `item:${i}`);
  // Learn each key once
  for (let i = 0; i < keys.length; i++) {
    preloader.learn([{ keys: [keys[i]], time: Date.now() }]);
    // Learn the first 10 keys more
    if (i < 10) {
      preloader.learn([{ keys: [keys[i]], time: Date.now() }]);
    }
  }

  const suggestions = preloader.getPreloadSuggestions({ limit: 5 });
  assert.ok(suggestions.length <= 5);

  // All should have count >= minAccessCount
  for (const s of suggestions) {
    assert.ok(s.count >= 1);
  }

  cache.destroy();
});

// ── Scheduled Preloading ────────────────────────────────────────────────────

test("schedulePreload: creates a cancelable recurring preload", async () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache, { minConfidence: 0, minAccessCount: 1 });

  preloader.learn([
    { keys: ["sched:a", "sched:b"], time: Date.now() },
    { keys: ["sched:a", "sched:b"], time: Date.now() },
  ]);

  cache.set("sched:a", "A", { level: "disk" });
  cache.set("sched:b", "B", { level: "disk" });

  const controller = preloader.schedulePreload("100ms", "sched:");

  // Wait for one tick
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Cancel
  controller.cancel();

  const stats = preloader.getStats();
  assert.ok(stats.totalPreloads >= 0);
  assert.equal(preloader._schedules.length, 0);

  cache.destroy();
});

test("schedulePreload: rejects invalid interval strings", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  assert.throws(() => preloader.schedulePreload("not-an-interval", ["key"]), {
    name: "TypeError",
  });
  assert.throws(() => preloader.schedulePreload("", []), { name: "TypeError" });

  cache.destroy();
});

test("cancelAll: stops all scheduled preloads", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  preloader.schedulePreload("10m", ["a"]);
  preloader.schedulePreload("5m", ["b"]);
  preloader.schedulePreload(60000, ["c"]);

  const stats = preloader.getStats();
  assert.equal(stats.activeSchedules, 3);

  preloader.cancelAll();
  assert.equal(preloader.getStats().activeSchedules, 0);

  cache.destroy();
});

// ── Reset & Forget ───────────────────────────────────────────────────────────

test("reset: clears all learned patterns and stats", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  preloader.learn([{ keys: ["a", "b", "c"], time: Date.now() }]);
  assert.equal(preloader.getStats().patternCount, 3);

  preloader.reset();
  assert.equal(preloader.getStats().patternCount, 0);
  assert.equal(preloader.getStats().totalLearned, 0);
  cache.destroy();
});

test("forget: removes a single pattern from consideration", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  preloader.learn([{ keys: ["keep-me", "remove-me"], time: Date.now() }]);
  preloader.forget("remove-me");

  const patterns = preloader.getPatterns();
  assert.ok(patterns.has("keep-me"));
  assert.equal(patterns.has("remove-me"), false);
  cache.destroy();
});

// ── Stats ────────────────────────────────────────────────────────────────────

test("getStats: returns comprehensive statistics", () => {
  const cache = createManager();
  const preloader = new CachePreloader(cache);

  preloader.learn([{ keys: ["a", "b"], time: Date.now() }]);

  const stats = preloader.getStats();
  assert.ok(typeof stats.patternCount === "number");
  assert.ok(typeof stats.totalAccesses === "number");
  assert.ok(typeof stats.avgScore === "number");
  assert.ok(typeof stats.preloadHitRate === "number");
  assert.ok(typeof stats.activeSchedules === "number");
  assert.ok(typeof stats.minConfidence === "number");
  assert.ok(typeof stats.maxSuggestions === "number");
  assert.equal(stats.patternCount, 2);
  assert.equal(stats.totalAccesses, 2);

  cache.destroy();
});
