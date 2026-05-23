"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MemoryOptimizer,
  OPTIMIZATION_TARGETS,
  groupByNamespace,
  countTags,
  median,
} = require("../../src/memory/optimizer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(name, content, tags = [], namespace = "test") {
  const now = new Date().toISOString();
  return { name, namespace, tags, createdAt: now, updatedAt: now, content };
}

function makeOldMemory(name, content, tags = [], namespace = "test", ageDays = 40) {
  const created = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  const updated = new Date(Date.now() - (ageDays - 1) * 24 * 60 * 60 * 1000).toISOString();
  return { name, namespace, tags, createdAt: created, updatedAt: updated, content };
}

// ---------------------------------------------------------------------------
// median
// ---------------------------------------------------------------------------

test("median: returns middle value for odd-length array", () => {
  assert.equal(median([1, 5, 3]), 3);
});

test("median: returns average of two middle values for even-length array", () => {
  assert.equal(median([1, 4, 2, 3]), 2.5);
});

test("median: returns 0 for empty array", () => {
  assert.equal(median([]), 0);
});

// ---------------------------------------------------------------------------
// groupByNamespace
// ---------------------------------------------------------------------------

test("groupByNamespace: groups memories by namespace", () => {
  const memories = [
    makeMemory("a", "x", [], "ns1"),
    makeMemory("b", "x", [], "ns2"),
    makeMemory("c", "x", [], "ns1"),
  ];

  const groups = groupByNamespace(memories);
  assert.equal(groups.get("ns1").length, 2);
  assert.equal(groups.get("ns2").length, 1);
});

test("groupByNamespace: uses 'default' for missing namespace", () => {
  const memories = [{ name: "m", content: "x" }];
  const groups = groupByNamespace(memories);
  assert.ok(groups.has("default"));
  assert.equal(groups.get("default").length, 1);
});

// ---------------------------------------------------------------------------
// countTags
// ---------------------------------------------------------------------------

test("countTags: returns tag frequency sorted descending", () => {
  const memories = [
    makeMemory("a", "x", ["alpha", "beta"]),
    makeMemory("b", "x", ["alpha", "gamma"]),
    makeMemory("c", "x", ["alpha"]),
  ];

  const stats = countTags(memories);
  assert.equal(stats[0].tag, "alpha");
  assert.equal(stats[0].count, 3);
  assert.equal(stats[1].tag, "beta");
  assert.equal(stats[1].count, 1);
});

// ---------------------------------------------------------------------------
// MemoryOptimizer
// ---------------------------------------------------------------------------

test("MemoryOptimizer: analyze detects redundancy in memories", () => {
  const optimizer = new MemoryOptimizer({ redundancyThreshold: 0.3 });

  const memories = [
    makeMemory("a", "hello world this is a test of redundancy detection in code"),
    makeMemory("b", "hello world this is a test of redundancy detection in system"),
    makeMemory("c", "completely unrelated topic about cooking recipes"),
  ];

  const analysis = optimizer.analyze(memories);

  assert.ok(analysis.redundancyPairs > 0, "Expected redundancy pairs to be detected");
  assert.ok(analysis.redundancyScore > 0);
  assert.ok(analysis.efficiencyScore < 100, "Efficiency should be below 100 with redundancy");
});

test("MemoryOptimizer: analyze detects age issues", () => {
  const optimizer = new MemoryOptimizer({ ageWarningMs: 1000 }); // 1 second

  const memories = [
    makeOldMemory("stale", "Old content.", ["note"], "test", 30),
    makeMemory("fresh", "New content.", ["important"]),
  ];

  const analysis = optimizer.analyze(memories);

  assert.ok(analysis.ageProfile.staleCount > 0, "Expected staleCount > 0");
  assert.ok(analysis.ageProfile.medianAgeMs > 0);
  assert.ok(analysis.issues.length > 0, "Should report issues");
});

test("MemoryOptimizer: analyze returns full efficiency score of 100 for optimal memories", () => {
  const optimizer = new MemoryOptimizer({ ageWarningMs: 365 * 24 * 60 * 60 * 1000 });

  const memories = [
    makeMemory("clean", "Well-organized memory.", ["important"]),
  ];

  const analysis = optimizer.analyze(memories);

  assert.ok(analysis.efficiencyScore >= 90);
  assert.equal(analysis.issues.length, 0);
});

test("MemoryOptimizer: analyze returns namespaces distribution", () => {
  const optimizer = new MemoryOptimizer();

  const memories = [
    makeMemory("a", "x", [], "dev"),
    makeMemory("b", "x", [], "dev"),
    makeMemory("c", "x", [], "personal"),
  ];

  const analysis = optimizer.analyze(memories);

  assert.equal(analysis.namespaceDistribution.dev, 2);
  assert.equal(analysis.namespaceDistribution.personal, 1);
});

test("MemoryOptimizer: analyze returns tag stats", () => {
  const optimizer = new MemoryOptimizer();

  const memories = [
    makeMemory("a", "x", ["important", "dev"]),
    makeMemory("b", "x", ["important", "review"]),
  ];

  const analysis = optimizer.analyze(memories);

  assert.ok(analysis.tagStats.length > 0);
  const topTag = analysis.tagStats[0];
  assert.equal(topTag.tag, "important");
  assert.equal(topTag.count, 2);
});

test("MemoryOptimizer: analyze returns empty analysis for empty input", () => {
  const optimizer = new MemoryOptimizer();
  const analysis = optimizer.analyze([]);

  assert.equal(analysis.totalMemories, 0);
  assert.equal(analysis.totalBytes, 0);
  assert.equal(analysis.efficiencyScore, 100);
  assert.deepEqual(analysis.issues, []);
  assert.deepEqual(analysis.issuesByTarget, { size: 0, relevance: 0, redundancy: 0, age: 0 });
});

test("MemoryOptimizer: optimize compresses memories and returns stats", () => {
  const optimizer = new MemoryOptimizer({
    compressorOptions: {
      similarityThreshold: 0.15,
      tagOverlapThreshold: 0.1,
    },
    redundancyThreshold: 0.15,
  });

  const memories = [
    makeMemory("m1", "memory compression system for agent project development work", ["dev"]),
    makeMemory("m2", "compression memory agent project development system work", ["dev"]),
    makeMemory("m3", "Grocery list for the week.", ["personal"]),
    makeMemory("m4", "Grocery shopping list.", ["personal"]),
  ];

  const result = optimizer.optimize(memories);

  assert.ok(result.stats.before.count === 4);
  // Merges should have reduced the count.
  assert.ok(
    result.stats.after.count < 4,
    `Expected count < 4 after merge, got ${result.stats.after.count}`
  );
  assert.ok(result.stats.mergedCount > 0 || result.stats.summarizedCount > 0);
});

test("MemoryOptimizer: optimize handles empty input", () => {
  const optimizer = new MemoryOptimizer();
  const result = optimizer.optimize([]);

  assert.deepEqual(result.memories, []);
  assert.equal(result.stats.savingsBytes, 0);
  assert.equal(result.stats.savingsTokens, 0);
  assert.deepEqual(result.recommendations, []);
});

test("MemoryOptimizer: getRecommendations returns suggestions after optimize", () => {
  const optimizer = new MemoryOptimizer({
    ageWarningMs: 1000,
    redundancyThreshold: 0.1,
  });

  const memories = [
    makeOldMemory("old-stale", "Very old data.", ["note"], "test", 60),
    makeMemory("new", "Fresh content.", ["important"]),
  ];

  // Optimize to populate recommendations.
  optimizer.optimize(memories);

  const recs = optimizer.getRecommendations();

  assert.ok(recs.length > 0, `Expected recommendations, got ${recs.length}`);
  // Should have age-related recommendation.
  const ageRec = recs.find((r) => r.target === "age");
  assert.ok(ageRec, "Expected age-related recommendation");
  assert.equal(ageRec.action, "summarize");
});

test("MemoryOptimizer: getRecommendations returns empty array when not yet run", () => {
  const optimizer = new MemoryOptimizer();
  const recs = optimizer.getRecommendations();
  assert.deepEqual(recs, []);
});

test("MemoryOptimizer: getStats returns before/after comparison", () => {
  const optimizer = new MemoryOptimizer();

  const memories = [
    makeMemory("a", "Content A.", ["important"]),
    makeMemory("b", "Content B.", ["key"]),
  ];

  optimizer.optimize(memories);
  const stats = optimizer.getStats();

  assert.ok(stats.before, "Expected before stats");
  assert.equal(stats.before.count, 2);
  assert.ok(stats.after, "Expected after stats");
  assert.ok(stats.delta, "Expected delta");
  assert.ok(typeof stats.delta.countReduction === "number");
  assert.ok(typeof stats.delta.bytesSaved === "number");
});

test("MemoryOptimizer: getStats returns null before/after when not optimized", () => {
  const optimizer = new MemoryOptimizer();
  const stats = optimizer.getStats();

  assert.equal(stats.before, null);
  assert.equal(stats.after, null);
  assert.equal(stats.delta, null);
});

test("MemoryOptimizer: autoOptimize configures auto settings", () => {
  const optimizer = new MemoryOptimizer();

  const config = optimizer.autoOptimize({
    intervalMs: 60000,
    targets: [OPTIMIZATION_TARGETS.SIZE],
    maxMemories: 20,
    verbose: true,
  });

  assert.equal(config.intervalMs, 60000);
  assert.deepEqual(config.targets, [OPTIMIZATION_TARGETS.SIZE]);
  assert.equal(config.maxMemories, 20);
  assert.equal(config.verbose, true);
  assert.equal(config.enabled, true);
  assert.ok(typeof config.configuredAt === "string");

  // Should be able to stop.
  optimizer.stopAutoOptimize();
});

test("MemoryOptimizer: autoOptimize uses defaults when called without arguments", () => {
  const optimizer = new MemoryOptimizer();
  const config = optimizer.autoOptimize();

  assert.equal(config.intervalMs, 3600000); // 1 hour default
  assert.ok(Array.isArray(config.targets));
  assert.ok(config.targets.length > 0);
  assert.equal(config.maxMemories, null);
  assert.equal(config.verbose, false);
  assert.equal(config.enabled, true);

  optimizer.stopAutoOptimize();
});

test("MemoryOptimizer: optimize with explicit targets uses correct strategies", () => {
  const optimizer = new MemoryOptimizer({
    compressorOptions: {
      ageThresholdMs: 1000, // 1 second — old memories get summarized
      similarityThreshold: 0.2,
      importanceThreshold: 0.1, // low threshold so note/transient tags get summarized
      tagOverlapThreshold: 0.1,
    },
  });

  const memories = [
    makeOldMemory("old-1", "Compression feature development work. This is additional content that makes the memory longer.", ["note"], "test", 40),
    makeOldMemory("old-2", "Compression system feature progress. More details added here for length.", ["transient"], "test", 45),
  ];

  // Target only age — should summarize rather than prune.
  const result = optimizer.optimize(memories, {
    targets: [OPTIMIZATION_TARGETS.AGE],
  });

  assert.ok(result.stats.summarizedCount > 0, "Expected summarization for age target");
});

test("MemoryOptimizer: optimize with REDUNDANCY target triggers merge", () => {
  const optimizer = new MemoryOptimizer({
    compressorOptions: {
      similarityThreshold: 0.2,
      tagOverlapThreshold: 0.1,
    },
    redundancyThreshold: 0.2,
  });

  const memories = [
    makeMemory("dup-1", "Memory compression system for agent project development.", ["dev"]),
    makeMemory("dup-2", "Agent project memory compression system development.", ["dev"]),
  ];

  const result = optimizer.optimize(memories, {
    targets: [OPTIMIZATION_TARGETS.REDUNDANCY],
  });

  // Should merge the two similar memories.
  assert.ok(
    result.stats.after.count < 2,
    `Expected merge to reduce count below 2, got ${result.stats.after.count}`
  );
});

test("MemoryOptimizer: analyze detects fragmentation issues", () => {
  const optimizer = new MemoryOptimizer();

  const memories = [];
  for (let i = 0; i < 15; i++) {
    memories.push(makeMemory(`m-${i}`, "x", [], `ns-${i}`));
  }

  const analysis = optimizer.analyze(memories);

  assert.ok(analysis.totalMemories === 15);
  assert.ok(Object.keys(analysis.namespaceDistribution).length >= 15);
  // Should have a fragmentation issue.
  const fragIssue = analysis.issues.find((i) => i.includes("fragmentation"));
  assert.ok(fragIssue, "Expected fragmentation issue when many namespaces exist");
});

test("MemoryOptimizer: analyze detects short content issue", () => {
  const optimizer = new MemoryOptimizer();
  const memories = [
    makeMemory("a", "hi"),
    makeMemory("b", "ok"),
    makeMemory("c", "y"),
    makeMemory("d", "A proper length content string."),
  ];

  const analysis = optimizer.analyze(memories);
  const shortIssue = analysis.issues.find((i) => i.includes("short content"));
  assert.ok(shortIssue, "Expected short content issue");
});
