"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMPRESS_STRATEGIES,
  MemoryCompressor,
  jaccardSimilarity,
  tagOverlap,
  computeImportance,
  computeAge,
  estimateTokens,
  estimateBytes,
} = require("../../src/memory/compressor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(name, content, tags = []) {
  const now = new Date().toISOString();
  return { name, namespace: "test", tags, createdAt: now, updatedAt: now, content };
}

function makeOldMemory(name, content, tags = [], ageDays = 40) {
  const created = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
  const updated = new Date(Date.now() - (ageDays - 1) * 24 * 60 * 60 * 1000).toISOString();
  return { name, namespace: "test", tags, createdAt: created, updatedAt: updated, content };
}

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

test("jaccardSimilarity: identical texts return 1", () => {
  const result = jaccardSimilarity("hello world", "hello world");
  assert.ok(Math.abs(result - 1) < 1e-10);
});

test("jaccardSimilarity: completely different texts return 0", () => {
  const result = jaccardSimilarity("hello world", "foo bar");
  assert.equal(result, 0);
});

test("jaccardSimilarity: partial overlap returns value between 0 and 1", () => {
  const result = jaccardSimilarity("hello world foo", "hello world bar");
  // tokens: [hello, world, foo] vs [hello, world, bar]
  // intersection: hello, world (2), union: hello, world, foo, bar (4) -> 0.5
  assert.ok(Math.abs(result - 0.5) < 1e-10);
});

test("jaccardSimilarity: empty texts return 1", () => {
  const result = jaccardSimilarity("", "");
  assert.equal(result, 1);
});

// ---------------------------------------------------------------------------
// tagOverlap
// ---------------------------------------------------------------------------

test("tagOverlap: identical tags return 1", () => {
  const result = tagOverlap(["important", "key"], ["important", "key"]);
  assert.ok(Math.abs(result - 1) < 1e-10);
});

test("tagOverlap: no overlap returns 0", () => {
  const result = tagOverlap(["important"], ["transient"]);
  assert.equal(result, 0);
});

// ---------------------------------------------------------------------------
// computeImportance
// ---------------------------------------------------------------------------

test("computeImportance: important tag yields high score", () => {
  const score = computeImportance(["important", "critical"]);
  assert.ok(score >= 0.8, `Expected >=0.8, got ${score}`);
});

test("computeImportance: transient tag yields low score", () => {
  const score = computeImportance(["transient"]);
  assert.ok(score <= 0.3, `Expected <=0.3, got ${score}`);
});

// ---------------------------------------------------------------------------
// MemoryCompressor
// ---------------------------------------------------------------------------

test("MemoryCompressor: summarize creates summary of a memory", () => {
  const compressor = new MemoryCompressor();
  const mem = makeMemory("test-mem", "This is a short sentence. Then there is a lot more text that follows. It goes on and on with additional details that make the content substantially longer than just the first sentence alone, which should result in a measurable reduction after summarization.", ["note"]);
  const result = compressor.summarize(mem);

  assert.ok(result.summarized, "Expected summarized flag");
  assert.ok(result.content.length < mem.content.length, "Summary should be shorter than original");
  assert.ok(typeof result.originalContentLength === "number");
  assert.ok(result.originalContentLength > 0);
  assert.ok(typeof result.originalTokenEstimate === "number");
  assert.equal(result.name, mem.name);
  assert.equal(result.namespace, mem.namespace);
});

test("MemoryCompressor: summarize handles empty content", () => {
  const compressor = new MemoryCompressor();
  const mem = makeMemory("empty-mem", "");
  const result = compressor.summarize(mem);

  assert.ok(result.summarized);
  assert.equal(result.content, "");
  assert.equal(result.originalContentLength, 0);
});

test("MemoryCompressor: summarize handles null/missing memory", () => {
  const compressor = new MemoryCompressor();
  assert.equal(compressor.summarize(null), null);
  assert.equal(compressor.summarize(undefined), null);
});

test("MemoryCompressor: merge combines two memories", () => {
  const compressor = new MemoryCompressor();
  const memA = makeMemory("mem-a", "Content from A.", ["important"]);
  const memB = makeMemory("mem-b", "Content from B.", ["key"]);

  const result = compressor.merge(memA, memB);

  assert.ok(result.merged, "Expected merged flag");
  assert.ok(result.content.includes("mem-a"), "Should reference source A");
  assert.ok(result.content.includes("mem-b"), "Should reference source B");
  assert.ok(result.content.includes("Content from A"), "Should include A's content");
  assert.ok(result.content.includes("Content from B"), "Should include B's content");
  assert.deepEqual(result.mergedFrom, ["mem-a", "mem-b"]);
  // Tags should be deduplicated.
  assert.ok(result.tags.includes("important"));
  assert.ok(result.tags.includes("key"));
});

test("MemoryCompressor: merge handles overlapping tags", () => {
  const compressor = new MemoryCompressor();
  const memA = makeMemory("mem-a", "Content A.", ["important", "shared"]);
  const memB = makeMemory("mem-b", "Content B.", ["key", "Shared"]);

  const result = compressor.merge(memA, memB);

  // "shared" and "Shared" deduplicate case-insensitively.
  assert.equal(result.tags.length, 3);
  assert.ok(result.tags.includes("important"));
  assert.ok(result.tags.includes("key"));
  assert.ok(result.tags.includes("shared"));
});

test("MemoryCompressor: merge handles one empty memory", () => {
  const compressor = new MemoryCompressor();
  const memA = makeMemory("only", "Only content.", ["note"]);
  const memB = makeMemory("other", "");

  const result = compressor.merge(memA, memB);

  assert.ok(result.merged);
  assert.equal(result.content, "Only content.");
  assert.equal(result.name, "only");
});

test("MemoryCompressor: deduplicate removes exact duplicates", () => {
  const compressor = new MemoryCompressor();
  const mem1 = makeMemory("dup", "Same content.");
  const mem2 = makeMemory("dup", "Same content.");
  const mem3 = makeMemory("unique", "Different content entirely.");

  const result = compressor.deduplicate([mem1, mem2, mem3]);

  assert.equal(result.length, 2, `Expected 2 after dedup, got ${result.length}`);
  const names = result.map((m) => m.name);
  assert.ok(names.includes("dup"), "Should keep one duplicate");
  assert.ok(names.includes("unique"), "Should keep unique");
});

test("MemoryCompressor: deduplicate removes near-duplicates by similarity", () => {
  const compressor = new MemoryCompressor({ similarityThreshold: 0.5 });
  const mem1 = makeMemory("alpha", "hello world this is a test of similarity checking");
  const mem2 = makeMemory("beta", "hello world this is a test of the similarity check");
  const mem3 = makeMemory("gamma", "completely unrelated topic about bananas");

  const result = compressor.deduplicate([mem1, mem2, mem3]);

  // mem1 and mem2 are near-duplicates; one should be removed.
  assert.ok(
    result.length <= 2,
    `Expected <=2 after near-dup removal, got ${result.length}`
  );
});

test("MemoryCompressor: deduplicate returns empty for empty input", () => {
  const compressor = new MemoryCompressor();
  assert.deepEqual(compressor.deduplicate([]), []);
});

test("MemoryCompressor: deduplicate returns single for single input", () => {
  const compressor = new MemoryCompressor();
  const mem = makeMemory("solo", "Only one.");
  const result = compressor.deduplicate([mem]);
  assert.equal(result.length, 1);
});

test("MemoryCompressor: compress applies SUMMARIZE to old memories", () => {
  const compressor = new MemoryCompressor({
    ageThresholdMs: 1000, // 1 second — memories older than 1s get summarized
    similarityThreshold: 0.7,
    importanceThreshold: 0.3,
  });

  const memories = [
    makeOldMemory("old-mem", "This is a very old memory with lots of content that should be summarized because it exceeds the age threshold. It has several sentences of content that go into detail about various topics.", ["note"], 5),
    makeMemory("new-mem", "Recent memory content.", ["important"]),
  ];

  const result = compressor.compress(memories, { strategies: [COMPRESS_STRATEGIES.SUMMARIZE] });

  assert.equal(result.memories.length, 2);
  assert.ok(result.stats.summarizedCount > 0, "Expected some memories to be summarized");
  assert.ok(result.stats.originalCount === 2);
  assert.ok(result.stats.compressedCount === 2);
});

test("MemoryCompressor: compress applies MERGE to similar memories", () => {
  const compressor = new MemoryCompressor({
    similarityThreshold: 0.2,
    tagOverlapThreshold: 0.1,
  });

  const memories = [
    makeMemory("one", "memory compression feature for agent project development system", ["dev"]),
    makeMemory("two", "compression memory for agent project development feature system", ["dev"]),
    makeMemory("three", "Grocery list: milk eggs bread.", ["personal"]),
  ];

  const result = compressor.compress(memories, { strategies: [COMPRESS_STRATEGIES.MERGE] });

  // one and two should have merged.
  assert.ok(
    result.memories.length < 3,
    `Expected <3 after merge, got ${result.memories.length}`
  );
  assert.ok(result.stats.mergedCount > 0, "Expected at least one merge");
});

test("MemoryCompressor: compress applies PRUNE to low-importance memories", () => {
  const compressor = new MemoryCompressor({
    importanceThreshold: 0.9,
  });

  const memories = [
    makeMemory("keep", "Important content.", ["critical"]),
    makeMemory("drop", "Transient note.", ["transient"]),
  ];

  const result = compressor.compress(memories, { strategies: [COMPRESS_STRATEGIES.PRUNE] });

  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].name, "keep");
  assert.equal(result.stats.prunedCount, 1);
});

test("MemoryCompressor: compress returns empty for empty input", () => {
  const compressor = new MemoryCompressor();
  const result = compressor.compress([]);
  assert.deepEqual(result.memories, []);
  assert.equal(result.stats.originalCount, 0);
  assert.equal(result.stats.compressedCount, 0);
  assert.equal(result.stats.savingsBytes, 0);
});

test("MemoryCompressor: compress respects maxMemories", () => {
  const compressor = new MemoryCompressor({ importanceThreshold: 0.01 });

  const memories = [];
  for (let i = 0; i < 10; i++) {
    memories.push(makeMemory(`mem-${i}`, `Content ${i}`, ["note"]));
  }

  const result = compressor.compress(memories, {
    strategies: [COMPRESS_STRATEGIES.PRUNE],
    maxMemories: 5,
  });

  assert.ok(result.memories.length <= 5, `Expected <=5, got ${result.memories.length}`);
});

test("MemoryCompressor: estimateSavings calculates token and byte savings", () => {
  const compressor = new MemoryCompressor();
  const original = [
    makeMemory("long-mem", "A".repeat(1000)),
  ];
  const compressed = [
    makeMemory("short-mem", "A".repeat(100)),
  ];

  const savings = compressor.estimateSavings(original, compressed);

  assert.ok(savings.originalBytes > 0);
  assert.ok(savings.compressedBytes > 0);
  assert.ok(savings.bytesSaved > 0, `Expected bytesSaved > 0, got ${savings.bytesSaved}`);
  assert.ok(savings.tokensSaved > 0, `Expected tokensSaved > 0, got ${savings.tokensSaved}`);
  assert.ok(savings.percentSaved > 0, `Expected percentSaved > 0, got ${savings.percentSaved}`);
  assert.ok(savings.originalTokens > savings.compressedTokens);
});

test("MemoryCompressor: estimateSavings works with string input", () => {
  const compressor = new MemoryCompressor();
  const savings = compressor.estimateSavings("long text " + "x".repeat(500), "short");

  assert.ok(savings.bytesSaved > 0);
  assert.ok(savings.originalTokens > 0);
});

// ---------------------------------------------------------------------------
// estimateTokens / estimateBytes
// ---------------------------------------------------------------------------

test("estimateTokens: returns 0 for empty string", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateBytes: returns 0 for null input", () => {
  assert.equal(estimateBytes(null), 0);
});

// ---------------------------------------------------------------------------
// computeAge
// ---------------------------------------------------------------------------

test("computeAge: returns positive ms for old memory", () => {
  const mem = makeOldMemory("old", "content", ["note"], 10);
  const age = computeAge(mem);
  assert.ok(age > 0, `Expected age > 0, got ${age}`);
  // Age should be roughly 10 days in milliseconds.
  const expectedMin = 9 * 24 * 60 * 60 * 1000;
  assert.ok(age >= expectedMin, `Expected >=${expectedMin}ms, got ${age}`);
});

test("computeAge: returns 0 for memory with no timestamps", () => {
  const mem = { name: "no-time", content: "x" };
  assert.equal(computeAge(mem), 0);
});
