/**
 * KnowledgeAccumulator tests: cross-session knowledge extraction,
 * accumulation, recall, synthesis, and topic mapping.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  KNOWLEDGE_TYPES,
  KnowledgeAccumulator,
  KnowledgeItem,
  normalizeKnowledgeType,
} = require("../../src/knowledge/accumulator");

// ── KnowledgeItem ────────────────────────────────────────────

test("KnowledgeItem: creates item with all defaults", () => {
  const item = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "The sky is blue");
  assert.ok(item.id.startsWith("ki-"));
  assert.equal(item.type, KNOWLEDGE_TYPES.FACT);
  assert.equal(item.content, "The sky is blue");
  assert.equal(item.confidence, 0.5);
  assert.deepEqual(item.tags, []);
  assert.equal(item.sourceSession, "");
  assert.ok(typeof item.timestamp === "string");
  assert.deepEqual(item.metadata, {});
});

test("KnowledgeItem: accepts and normalizes options", () => {
  const item = new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "Always test first", {
    confidence: 0.9,
    tags: ["testing", "TDD", "  QUALITY  "],
    sourceSession: "sess-001",
    timestamp: "2026-01-15T10:00:00.000Z",
    metadata: { author: "agent-a" },
  });
  assert.equal(item.type, KNOWLEDGE_TYPES.LESSON);
  assert.equal(item.content, "Always test first");
  assert.equal(item.confidence, 0.9);
  assert.deepEqual(item.tags, ["testing", "tdd", "quality"]);
  assert.equal(item.sourceSession, "sess-001");
  assert.equal(item.timestamp, "2026-01-15T10:00:00.000Z");
  assert.deepEqual(item.metadata, { author: "agent-a" });
});

test("KnowledgeItem: clamps confidence to 0..1 range", () => {
  const high = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "test", { confidence: 5 });
  assert.equal(high.confidence, 1);

  const low = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "test", { confidence: -2 });
  assert.equal(low.confidence, 0);

  const nan = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "test", { confidence: "abc" });
  assert.equal(nan.confidence, 0.5);
});

test("KnowledgeItem: throws on invalid type", () => {
  assert.throws(
    () => new KnowledgeItem("invalid_type", "content"),
    { message: /Invalid knowledge type/ }
  );

  assert.throws(
    () => new KnowledgeItem("", "content"),
    { message: /Invalid knowledge type/ }
  );
});

// ── KnowledgeAccumulator: learn ──────────────────────────────

test("learn: extracts knowledge items from session entries", () => {
  const acc = new KnowledgeAccumulator();
  const session = {
    id: "2026-01-15T10-00-00Z-abc123",
    entries: [
      {
        text: "I always prefer using TypeScript over plain JavaScript #typescript #preference",
        type: "user",
        timestamp: "2026-01-15T10:01:00.000Z",
      },
      {
        text: "We decided to use PostgreSQL as the primary database #postgresql #decision",
        type: "assistant",
        timestamp: "2026-01-15T10:02:00.000Z",
      },
      {
        text: "Learned that connection pooling reduces latency by 40% #performance #lesson",
        type: "assistant",
        timestamp: "2026-01-15T10:03:00.000Z",
      },
    ],
  };

  const items = acc.learn(session);
  assert.ok(items.length >= 3, `expected at least 3 items, got ${items.length}`);

  // First item should be a preference
  const pref = items.find((it) => it.type === KNOWLEDGE_TYPES.PREFERENCE);
  assert.ok(pref, "should have extracted a preference");
  assert.ok(pref.content.includes("TypeScript"));
  assert.deepEqual(pref.tags, ["typescript", "preference"]);
  assert.equal(pref.sourceSession, session.id);

  // Second item should be a decision
  const dec = items.find((it) => it.type === KNOWLEDGE_TYPES.DECISION);
  assert.ok(dec, "should have extracted a decision");
  assert.ok(dec.content.includes("PostgreSQL"));
  assert.deepEqual(dec.tags, ["postgresql", "decision"]);

  // Third item should be a lesson
  const les = items.find((it) => it.type === KNOWLEDGE_TYPES.LESSON);
  assert.ok(les, "should have extracted a lesson");
  assert.ok(les.content.includes("connection pooling"));
  assert.deepEqual(les.tags, ["performance", "lesson"]);
});

test("learn: returns empty array for invalid session", () => {
  const acc = new KnowledgeAccumulator();
  assert.deepEqual(acc.learn(null), []);
  assert.deepEqual(acc.learn({}), []);
  assert.deepEqual(acc.learn({ entries: null }), []);
  assert.deepEqual(acc.learn({ id: "s1", entries: "not-array" }), []);
});

test("learn: handles entries without text-like properties", () => {
  const acc = new KnowledgeAccumulator();
  const session = {
    id: "sess-empty",
    entries: [
      { type: "system", timestamp: "2026-01-15T10:00:00.000Z" },
      { type: "tool_result", data: {} },
    ],
  };
  const items = acc.learn(session);
  assert.deepEqual(items, []);
});

test("learn: keeps borderline-confidence items (threshold is exclusive)", () => {
  const acc = new KnowledgeAccumulator();
  const session = {
    id: "sess-borderline",
    entries: [
      {
        text: "maybe?",  // short text + question mark → confidence = 0.3 (minimum from heuristic)
        type: "user",
      },
    ],
  };
  const items = acc.learn(session);
  // confidence is exactly 0.3, and the filter uses < 0.3 (exclusive), so it is kept
  assert.equal(items.length, 1);
  assert.equal(items[0].confidence, 0.3);
});

test("learn: entries without sufficient text signal are skipped", () => {
  const acc = new KnowledgeAccumulator();
  const session = {
    id: "sess-no-text",
    entries: [
      { type: "user", text: "" },
      { type: "assistant", text: "   " },
      { role: "tool", content: "" },
      { role: "system", message: null },
      { timestamp: "2026-01-01T00:00:00.000Z" },  // no text property at all
    ],
  };
  const items = acc.learn(session);
  assert.equal(items.length, 0);
});

// ── KnowledgeAccumulator: accumulate ─────────────────────────

test("accumulate: stores KnowledgeItem instances", () => {
  const acc = new KnowledgeAccumulator();
  const item = new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Earth orbits the Sun", {
    confidence: 0.95,
    tags: ["astronomy", "fact"],
  });

  const stored = acc.accumulate(item);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].content, "Earth orbits the Sun");
  assert.equal(acc.size, 1);
});

test("accumulate: converts plain objects to KnowledgeItems", () => {
  const acc = new KnowledgeAccumulator();
  const plain = {
    type: KNOWLEDGE_TYPES.PATTERN,
    content: "Bugs cluster after Friday deploys #deploy #pattern",
    confidence: 0.8,
    tags: ["deploy", "pattern"],
  };

  const stored = acc.accumulate(plain);
  assert.equal(stored.length, 1);
  assert.ok(stored[0].id.startsWith("ki-"));
  assert.equal(stored[0].type, KNOWLEDGE_TYPES.PATTERN);
  assert.equal(stored[0].content, "Bugs cluster after Friday deploys #deploy #pattern");
  assert.ok(stored[0].tags.includes("deploy"));
});

test("accumulate: accepts arrays and skips invalid entries", () => {
  const acc = new KnowledgeAccumulator();
  const items = [
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item 1", { confidence: 0.7 }),
    { type: KNOWLEDGE_TYPES.LESSON, content: "Item 2", confidence: 0.8 },
    null,
    undefined,
    {},
    { type: KNOWLEDGE_TYPES.DECISION, content: "Item 3", confidence: 0.6 },
  ];

  const stored = acc.accumulate(items);
  assert.equal(stored.length, 3, "null, undefined, and empty-content objects should be skipped");
  assert.equal(acc.size, 3);
});

// ── KnowledgeAccumulator: recall ─────────────────────────────

test("recall: text search finds items by content match", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "React uses a virtual DOM for rendering", {
      tags: ["react", "frontend"],
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "Always memoize expensive computations", {
      tags: ["performance", "react"],
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Node.js runs on the V8 engine", {
      tags: ["nodejs", "backend"],
    }),
  ]);

  const results = acc.recall("react");
  assert.equal(results.length, 2);
  // Both items mention "React" — verify they're the right ones
  assert.ok(results.some((r) => r.content.includes("virtual DOM")));
  assert.ok(results.some((r) => r.content.includes("memoize")));
});

test("recall: structured query filters by type and tags", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "V8 is fast", { tags: ["js"] }),
    new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "Use strict mode", { tags: ["js", "best-practice"] }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "Prefer const over let", { tags: ["js", "style"] }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Python is interpreted", { tags: ["python"] }),
  ]);

  const results = acc.recall({ type: KNOWLEDGE_TYPES.FACT });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.type === KNOWLEDGE_TYPES.FACT));

  const taggedResults = acc.recall({ tags: ["style"] });
  assert.equal(taggedResults.length, 1);
  assert.equal(taggedResults[0].content, "Prefer const over let");
});

test("recall: respects options filters (confidenceMin, since, limit)", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "High confidence fact", { confidence: 0.9, tags: ["test"] }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Low confidence fact", { confidence: 0.4, tags: ["test"] }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Medium fact", { confidence: 0.6, tags: ["test"] }),
  ]);

  // confidenceMin filter
  const highOnly = acc.recall("", { confidenceMin: 0.7 });
  assert.equal(highOnly.length, 1);
  assert.equal(highOnly[0].content, "High confidence fact");

  // limit filter
  const limited = acc.recall({ tags: ["test"] }, { limit: 2 });
  assert.equal(limited.length, 2);
});

// ── KnowledgeAccumulator: synthesize ─────────────────────────

test("synthesize: aggregates knowledge by topic", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "TypeScript adds static typing #typescript", {
      confidence: 0.9, timestamp: "2026-01-01T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "Always use strict TypeScript config #typescript", {
      confidence: 0.85, timestamp: "2026-01-05T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.LESSON, "Learned TypeScript generics are powerful #typescript", {
      confidence: 0.8, timestamp: "2026-01-10T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Python uses significant whitespace #python", {
      confidence: 0.9, timestamp: "2026-01-02T00:00:00.000Z",
    }),
  ]);

  const synthesis = acc.synthesize("typescript");
  assert.equal(synthesis.topic, "typescript");
  assert.equal(synthesis.itemCount, 3);
  assert.ok(synthesis.confidence > 0.8);
  assert.ok(synthesis.summary.includes("3 knowledge items"));
  assert.deepEqual(synthesis.types, { fact: 1, preference: 1, lesson: 1 });
  assert.equal(synthesis.firstSeen, "2026-01-01T00:00:00.000Z");
  assert.equal(synthesis.lastSeen, "2026-01-10T00:00:00.000Z");
});

test("synthesize: returns empty result for unknown topic", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Some random knowledge", { tags: ["misc"] }),
  ]);

  const synthesis = acc.synthesize("nonexistent");
  assert.equal(synthesis.topic, "nonexistent");
  assert.equal(synthesis.itemCount, 0);
  assert.equal(synthesis.confidence, 0);
  assert.equal(synthesis.firstSeen, null);
  assert.equal(synthesis.lastSeen, null);
  assert.deepEqual(synthesis.items, []);
});

test("synthesize: throws on empty topic", () => {
  const acc = new KnowledgeAccumulator();
  assert.throws(
    () => acc.synthesize(""),
    { message: /must be a non-empty string/ }
  );
  assert.throws(
    () => acc.synthesize("   "),
    { message: /must be a non-empty string/ }
  );
});

// ── KnowledgeAccumulator: getTopics ──────────────────────────

test("getTopics: builds topic map with confidence scores", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item 1", {
      confidence: 0.9, tags: ["typescript", "static-typing"],
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.PREFERENCE, "Item 2", {
      confidence: 0.8, tags: ["typescript", "tooling"],
      timestamp: "2026-01-10T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Item 3", {
      confidence: 0.7, tags: ["python"],
      timestamp: "2026-01-05T00:00:00.000Z",
    }),
  ]);

  const topics = acc.getTopics();

  // typescript appears in 2 items
  assert.ok(topics["typescript"]);
  assert.equal(topics["typescript"].count, 2);
  assert.equal(topics["typescript"].confidence, 0.85); // (0.9 + 0.8) / 2
  assert.ok(topics["typescript"].types.includes(KNOWLEDGE_TYPES.FACT));
  assert.ok(topics["typescript"].types.includes(KNOWLEDGE_TYPES.PREFERENCE));
  assert.equal(topics["typescript"].lastSeen, "2026-01-10T00:00:00.000Z");

  // static-typing appears in 1 item
  assert.ok(topics["static-typing"]);
  assert.equal(topics["static-typing"].count, 1);
  assert.equal(topics["static-typing"].confidence, 0.9);

  // tooling appears in 1 item
  assert.ok(topics["tooling"]);
  assert.equal(topics["tooling"].count, 1);

  // python appears in 1 item
  assert.ok(topics["python"]);
  assert.equal(topics["python"].count, 1);
});

test("getTopics: returns empty object when no knowledge has tags", () => {
  const acc = new KnowledgeAccumulator();
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "No tags here", { confidence: 0.5 }),
  ]);
  assert.deepEqual(acc.getTopics(), {});
});

// ── KnowledgeAccumulator: utility methods ────────────────────

test("accumulator: size and clear work correctly", () => {
  const acc = new KnowledgeAccumulator();
  assert.equal(acc.size, 0);

  acc.accumulate(new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "A"));
  acc.accumulate(new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "B"));
  acc.accumulate(new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "C"));
  assert.equal(acc.size, 3);

  acc.clear();
  assert.equal(acc.size, 0);
  assert.deepEqual(acc.getTopics(), {});
  const results = acc.recall("");
  assert.equal(results.length, 0);
});

test("accumulator: maxItems evicts oldest entries", () => {
  const acc = new KnowledgeAccumulator({ maxItems: 3 });
  acc.accumulate([
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "First", {
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Second", {
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
    new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Third", {
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  ]);
  assert.equal(acc.size, 3);

  // Adding a fourth item should evict the oldest ("First")
  acc.accumulate(new KnowledgeItem(KNOWLEDGE_TYPES.FACT, "Fourth", {
    timestamp: "2026-01-04T00:00:00.000Z",
  }));
  assert.equal(acc.size, 3);

  const contents = acc.items.map((i) => i.content);
  assert.ok(!contents.includes("First"), "oldest item should be evicted");
  assert.ok(contents.includes("Second"));
  assert.ok(contents.includes("Third"));
  assert.ok(contents.includes("Fourth"));
});

// ── normalizeKnowledgeType ───────────────────────────────────

test("normalizeKnowledgeType: validates and normalizes types", () => {
  assert.equal(normalizeKnowledgeType("FACT"), KNOWLEDGE_TYPES.FACT);
  assert.equal(normalizeKnowledgeType("Fact"), KNOWLEDGE_TYPES.FACT);
  assert.equal(normalizeKnowledgeType("pattern"), KNOWLEDGE_TYPES.PATTERN);
  assert.equal(normalizeKnowledgeType("DECISION"), KNOWLEDGE_TYPES.DECISION);
  assert.equal(normalizeKnowledgeType("lesson"), KNOWLEDGE_TYPES.LESSON);
  assert.equal(normalizeKnowledgeType("PREFERENCE"), KNOWLEDGE_TYPES.PREFERENCE);

  assert.throws(() => normalizeKnowledgeType("unknown"), { message: /Invalid knowledge type/ });
  assert.throws(() => normalizeKnowledgeType(""), { message: /Invalid knowledge type/ });
});

// ── Cross-session knowledge extraction ───────────────────────

test("learn: extracts knowledge from multiple sessions independently", () => {
  const acc = new KnowledgeAccumulator();

  const session1 = {
    id: "session-1",
    entries: [
      { text: "We decided to use microservices architecture #architecture", type: "user" },
    ],
  };
  const session2 = {
    id: "session-2",
    entries: [
      { text: "Pattern: microservices increase deployment complexity #architecture", type: "assistant" },
    ],
  };

  const items1 = acc.learn(session1);
  const items2 = acc.learn(session2);

  assert.equal(items1.length, 1);
  assert.equal(items2.length, 1);
  assert.equal(items1[0].sourceSession, "session-1");
  assert.equal(items2[0].sourceSession, "session-2");
  assert.notEqual(items1[0].id, items2[0].id);
});
