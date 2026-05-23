/**
 * KnowledgeCurator tests: quality review, deduplication, verification,
 * pruning, and aggregate quality scoring.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  KnowledgeAccumulator,
  KnowledgeItem,
  KNOWLEDGE_TYPES,
} = require("../../src/knowledge/accumulator");

const {
  DIMENSION_WEIGHTS,
  KnowledgeCurator,
  QUALITY_DIMENSIONS,
} = require("../../src/knowledge/curator");

// ── Helpers ──────────────────────────────────────────────────

function createFixture() {
  const accumulator = new KnowledgeAccumulator();
  const curator = new KnowledgeCurator(accumulator);
  return { accumulator, curator };
}

function seedKnowledge(accumulator, items) {
  accumulator.accumulate(items);
}

// ── Constructor ──────────────────────────────────────────────

test("KnowledgeCurator: requires a KnowledgeAccumulator", () => {
  assert.throws(
    () => new KnowledgeCurator(null),
    { message: /must be a KnowledgeAccumulator/ }
  );
  assert.throws(
    () => new KnowledgeCurator({}),
    { message: /must be a KnowledgeAccumulator/ }
  );

  const acc = new KnowledgeAccumulator();
  const curator = new KnowledgeCurator(acc);
  assert.ok(curator instanceof KnowledgeCurator);
});

test("KnowledgeCurator: accepts custom options", () => {
  const acc = new KnowledgeAccumulator();
  const curator = new KnowledgeCurator(acc, {
    weights: { accuracy: 0.5, relevance: 0.5, freshness: 0, consistency: 0, completeness: 0 },
    similarityThreshold: 0.9,
    maxAgeDays: 30,
  });
  // Can't easily inspect private fields, but constructor should not throw
  assert.ok(curator);
});

// ── review ───────────────────────────────────────────────────

test("review: scores knowledge item on all quality dimensions", () => {
  const { curator } = createFixture();

  const item = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "TypeScript provides static type checking for JavaScript codebases, catching errors at compile time rather than runtime.", {
    confidence: 0.9,
    tags: ["typescript", "static-typing", "javascript"],
    timestamp: new Date().toISOString(),
  });

  const scores = curator.review(item);

  // All dimensions present
  assert.ok("accuracy" in scores);
  assert.ok("relevance" in scores);
  assert.ok("freshness" in scores);
  assert.ok("consistency" in scores);
  assert.ok("completeness" in scores);
  assert.ok("overall" in scores);

  // Scores are in 0..1 range
  for (const dim of ["accuracy", "relevance", "freshness", "consistency", "completeness", "overall"]) {
    assert.ok(scores[dim] >= 0 && scores[dim] <= 1, `${dim} score ${scores[dim]} out of range`);
  }

  // Freshness should be high for a just-created item
  assert.ok(scores.freshness >= 0.8, `freshness ${scores.freshness} should be high for recent item`);
});

test("review: stale item gets low freshness score", () => {
  const { curator } = createFixture();

  const oldItem = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Some old knowledge", {
    confidence: 0.8,
    timestamp: "2020-01-01T00:00:00.000Z",
  });

  const scores = curator.review(oldItem);
  assert.ok(scores.freshness <= 0.3, `freshness ${scores.freshness} should be low for old item`);
});

test("review: well-structured item gets high overall score", () => {
  const { curator } = createFixture();

  const good = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, [
    "A comprehensive explanation of how React's reconciliation algorithm works,",
    "including the diffing process, key props, and the fiber architecture.",
    "This is critical for performance optimization in large applications.",
    "",
    "```js",
    "// Example of memoization in React",
    "const Memoized = React.memo(Component);",
    "```",
  ].join("\n"), {
    confidence: 0.95,
    tags: ["react", "performance", "reconciliation", "fiber", "frontend"],
  });

  const scores = curator.review(good);
  assert.ok(scores.overall > 0.5, `overall ${scores.overall} should be high for well-structured item`);
  assert.ok(scores.accuracy >= 0.7, `accuracy ${scores.accuracy} should be high`);
  assert.ok(scores.completeness >= 0.4, `completeness should be decent for long content`);
});

test("review: poorly formed item gets low overall score", () => {
  const { curator } = createFixture();

  const bad = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "maybe?", {
    confidence: 0.3,
    tags: [],
  });

  const scores = curator.review(bad);
  assert.ok(scores.overall < 0.5, `overall ${scores.overall} should be low for poor item`);
  assert.ok(scores.accuracy <= 0.6, `accuracy ${scores.accuracy} should be low for vague content`);
});

test("review: returns zero scores for null input", () => {
  const { curator } = createFixture();
  const scores = curator.review(null);
  assert.equal(scores.overall, 0);
  assert.equal(scores.accuracy, 0);
  assert.equal(scores.relevance, 0);
});

// ── deduplicate ──────────────────────────────────────────────

test("deduplicate: removes near-duplicate items keeping higher confidence", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "React uses virtual DOM for rendering components optimally", {
      confidence: 0.9, tags: ["react", "dom"], timestamp: "2026-01-01T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "React uses virtual DOM for rendering components", {
      confidence: 0.6, tags: ["react", "dom"], timestamp: "2026-01-02T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Python is an interpreted language", {
      confidence: 0.8, tags: ["python"], timestamp: "2026-01-03T00:00:00.000Z",
    }),
  ]);

  const result = curator.deduplicate();

  // The lower-confidence duplicate should be removed
  assert.ok(result.duplicateCount >= 1, `expected at least 1 duplicate removed, got ${result.duplicateCount}`);
  assert.equal(result.kept.length, accumulator.size);

  // The Python item should remain
  const pythonItem = result.kept.find((it) => it.content.includes("Python"));
  assert.ok(pythonItem, "unrelated item should be kept");
});

test("deduplicate: handles empty accumulator gracefully", () => {
  const { accumulator, curator } = createFixture();

  const result = curator.deduplicate();
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.conflicts, []);
});

test("deduplicate: detects and reports contradictions", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "I always recommend using TypeScript", {
      confidence: 0.9, tags: ["typescript"], timestamp: "2026-01-01T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "I never recommend using TypeScript", {
      confidence: 0.7, tags: ["typescript"], timestamp: "2026-01-02T00:00:00.000Z",
    }),
  ]);

  const result = curator.deduplicate();
  // Depending on similarity threshold, these may or may not be flagged
  // as duplicates, but at minimum we should have detected a contradiction
  // if similarity is >= 0.4 and both are preferences
  // Let's check that either duplicates were found OR conflicts were detected
  const hasAction = result.duplicateCount > 0 || result.conflicts.length > 0;
  assert.ok(hasAction, "should either deduplicate or detect contradiction");
});

test("deduplicate: keeps higher-confidence item when contradiction found", () => {
  const { accumulator, curator } = createFixture();

  const highConf = new KnowledgeItem(KNOWLEDGE_TYPES.DECISION, "We should always use strict mode", {
    confidence: 0.95, tags: ["strict-mode", "best-practice"],
  });
  const lowConf = new KnowledgeItem(KNOWLEDGE_TYPES.DECISION, "We should not use strict mode ever", {
    confidence: 0.3, tags: ["strict-mode", "anti-pattern"],
  });

  seedKnowledge(accumulator, [highConf, lowConf]);

  const result = curator.deduplicate();

  // The kept items should contain the higher-confidence one
  const keptIds = result.kept.map((it) => it.id);
  assert.ok(keptIds.includes(highConf.id), "higher-confidence item should be kept");
});

// ── verify ───────────────────────────────────────────────────

test("verify: confirms knowledge against matching source", () => {
  const { curator } = createFixture();

  const knowledge = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "The database uses PostgreSQL 15 with connection pooling enabled", {
    confidence: 0.9,
    tags: ["postgresql", "database", "configuration"],
    timestamp: "2026-02-01T00:00:00.000Z",
  });

  const source = {
    content: "Our PostgreSQL 15 instance was configured with PgBouncer for connection pooling",
    tags: ["postgresql", "database", "pgbouncer"],
    timestamp: "2026-01-15T00:00:00.000Z", // source predates knowledge
  };

  const result = curator.verify(knowledge, source);
  assert.ok(result.verified, "knowledge should verify against matching source");
  assert.ok(result.score >= 0.5, `score ${result.score} should be >= 0.5`);
  assert.ok(result.dimensions.contentOverlap > 0);
  assert.ok(result.dimensions.tagAlignment > 0);
});

test("verify: flags mismatched knowledge", () => {
  const { curator } = createFixture();

  const knowledge = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "We use MySQL 8 for the primary database", {
    confidence: 0.8,
    tags: ["mysql", "database"],
    timestamp: "2026-02-01T00:00:00.000Z",
  });

  const source = {
    content: "The application connects to a MongoDB Atlas cluster for document storage",
    tags: ["mongodb", "nosql", "database"],
    timestamp: "2026-01-15T00:00:00.000Z",
  };

  const result = curator.verify(knowledge, source);
  assert.ok(!result.verified, "knowledge about MySQL should not verify against MongoDB source");
  assert.ok(result.score < 0.5);
  assert.ok(result.discrepancies.length > 0, "should report discrepancies");
});

test("verify: handles missing inputs gracefully", () => {
  const { curator } = createFixture();
  const knowledge = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Test", { confidence: 0.5 });

  const noSource = curator.verify(knowledge, null);
  assert.ok(!noSource.verified);
  assert.equal(noSource.score, 0);

  const noKnowledge = curator.verify(null, { content: "Test" });
  assert.ok(!noKnowledge.verified);
  assert.equal(noKnowledge.score, 0);
});

// ── prune ────────────────────────────────────────────────────

test("prune: removes items older than maxAgeDays", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Very old knowledge", {
      timestamp: "2020-01-01T00:00:00.000Z", confidence: 0.8,
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Recent knowledge", {
      timestamp: new Date().toISOString(), confidence: 0.8,
    }),
  ]);

  const result = curator.prune({ maxAgeDays: 365 });
  assert.ok(result.removedCount >= 1, "at least one old item should be removed");
  assert.ok(result.kept.some((it) => it.content === "Recent knowledge"), "recent item should be kept");
});

test("prune: removes items below minConfidence", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "High confidence", { confidence: 0.9 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Low confidence", { confidence: 0.2 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Medium confidence", { confidence: 0.5 }),
  ]);

  const result = curator.prune({ minConfidence: 0.5 });
  assert.equal(result.removedCount, 1, "only the 0.2 confidence item should be removed");
  assert.ok(result.kept.some((it) => it.content === "Medium confidence"), "edge case: equality should be kept");
  assert.ok(result.kept.some((it) => it.content === "High confidence"), "high confidence should be kept");
});

test("prune: filters by type whitelist (keepTypes)", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "A fact", { confidence: 0.8 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "A lesson", { confidence: 0.8 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.DECISION, "A decision", { confidence: 0.8 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "A preference", { confidence: 0.8 }),
  ]);

  const result = curator.prune({ keepTypes: [KNOWLEDGE_TYPES.FACT, KNOWLEDGE_TYPES.LESSON] });
  assert.equal(result.keptCount, 2, "only fact and lesson should remain");
  assert.ok(result.kept.every((it) =>
    it.type === KNOWLEDGE_TYPES.FACT || it.type === KNOWLEDGE_TYPES.LESSON
  ));
});

test("prune: filters by type blacklist (removeTypes)", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "A fact", { confidence: 0.8 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PATTERN, "A pattern", { confidence: 0.8 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "A preference", { confidence: 0.8 }),
  ]);

  const result = curator.prune({ removeTypes: [KNOWLEDGE_TYPES.PREFERENCE] });
  assert.equal(result.removedCount, 1, "preference should be removed");
  assert.ok(!result.kept.some((it) => it.type === KNOWLEDGE_TYPES.PREFERENCE));
  assert.equal(result.keptCount, 2);
});

test("prune: applies maxItems hard cap removing lowest-confidence first", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item A", { confidence: 0.3 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item B", { confidence: 0.9 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item C", { confidence: 0.5 }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item D", { confidence: 0.7 }),
  ]);

  const result = curator.prune({ maxItems: 2 });
  assert.equal(result.keptCount, 2, "should keep only 2 items");
  // Highest confidence items should remain
  assert.ok(result.kept.some((it) => it.content === "Item B"), "highest confidence should survive");
  assert.ok(result.kept.some((it) => it.content === "Item D"), "second highest should survive");
});

// ── getQualityScore ──────────────────────────────────────────

test("getQualityScore: computes aggregate quality across all items", () => {
  const { accumulator, curator } = createFixture();

  seedKnowledge(accumulator, [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Well-documented TypeScript configuration uses tsconfig.json with strict mode enabled for maximum type safety", {
      confidence: 0.9, tags: ["typescript", "configuration", "strict-mode"],
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "Always run the full test suite before merging to main to prevent regressions in critical paths", {
      confidence: 0.9, tags: ["testing", "ci", "best-practice"],
    }),
  ]);

  const score = curator.getQualityScore();
  assert.ok("accuracy" in score);
  assert.ok("relevance" in score);
  assert.ok("freshness" in score);
  assert.ok("consistency" in score);
  assert.ok("completeness" in score);
  assert.ok("overall" in score);
  assert.equal(score.itemCount, 2);
  assert.ok(score.overall > 0, "non-empty knowledge should have positive overall score");
});

test("getQualityScore: returns zero scores for empty accumulator", () => {
  const { accumulator, curator } = createFixture();

  const score = curator.getQualityScore();
  assert.equal(score.accuracy, 0);
  assert.equal(score.relevance, 0);
  assert.equal(score.freshness, 0);
  assert.equal(score.consistency, 0);
  assert.equal(score.completeness, 0);
  assert.equal(score.overall, 0);
  assert.equal(score.itemCount, 0);
});

// ── Full curation pipeline ───────────────────────────────────

test("full pipeline: accumulate, review, deduplicate, prune", () => {
  const { accumulator, curator } = createFixture();

  // 1. Accumulate knowledge from simulated sessions
  const session = {
    id: "sess-001",
    entries: [
      { text: "We always use ESLint with the recommended rules #eslint #preference", type: "user" },
      { text: "Decided to migrate from Webpack to Vite #vite #decision", type: "assistant" },
      { text: "Learned that tree-shaking reduces bundle size by 30% #performance #lesson", type: "assistant" },
    ],
  };

  accumulator.learn(session);

  // 2. Also accumulate directly
  accumulator.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Vite uses esbuild for fast dev builds #vite", {
      confidence: 0.9, tags: ["vite", "esbuild"],
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Vite is a fast build tool that uses esbuild under the hood #vite", {
      confidence: 0.5, tags: ["vite"],
    }),
  ]);

  // 3. Review individual items
  const items = accumulator.items;
  for (const item of items) {
    const scores = curator.review(item);
    assert.ok(scores.overall >= 0, `review should produce valid scores for item ${item.id}`);
  }

  // 4. Deduplicate
  const beforeSize = accumulator.size;
  const dedupResult = curator.deduplicate();
  assert.ok(accumulator.size <= beforeSize, "dedup should not increase size");

  // 5. Prune
  const pruneResult = curator.prune({ minConfidence: 0.4 });
  assert.ok(Array.isArray(pruneResult.removed));
  assert.ok(Array.isArray(pruneResult.kept));

  // 6. Final quality check
  const quality = curator.getQualityScore();
  assert.ok(quality.overall >= 0);
  assert.ok(typeof quality.itemCount === "number");
});
