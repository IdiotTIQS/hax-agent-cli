"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SemanticMemory } = require("../../src/memory/semantic-search");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock listFn that returns a fixed set of memory records.
 */
function createMockList(memories) {
  return () => memories.slice();
}

/**
 * Create a mock readFn that looks up a memory by name.
 */
function createMockRead(memories) {
  return (name) => memories.find((m) => m.name === name) || null;
}

function makeFixtureMemories() {
  return [
    {
      name: "js-tips",
      content: "Use const and let instead of var. Arrow functions are concise.",
      namespace: "dev",
      tags: ["javascript", "best-practices"],
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      name: "python-setup",
      content:
        "Create a virtual environment with python -m venv .venv. Install packages with pip.",
      namespace: "dev",
      tags: ["python", "setup"],
      updatedAt: "2025-02-01T00:00:00.000Z",
    },
    {
      name: "project-structure",
      content:
        "Keep source code in src/, tests in test/, and configuration in config/.",
      namespace: "default",
      tags: ["architecture"],
      updatedAt: "2025-03-01T00:00:00.000Z",
    },
    {
      name: "deployment-checklist",
      content:
        "Run tests, build artifacts, verify staging, then deploy to production.",
      namespace: "ops",
      tags: ["deployment", "checklist"],
      updatedAt: "2025-04-01T00:00:00.000Z",
    },
  ];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("SemanticMemory: initializes with zero size", () => {
  const sm = new SemanticMemory();
  assert.equal(sm.size(), 0);
});

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

test("index: stores a memory entry and makes it searchable", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({
    listFn: createMockList(memories),
    readFn: createMockRead(memories),
  });

  sm.index(memories[0]);
  assert.equal(sm.size(), 1);

  const results = sm.search("javascript arrow functions", 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, "js-tips");
});

test("index: updating the same name replaces the previous vector", () => {
  const sm = new SemanticMemory();
  sm.index({ name: "note", content: "machine learning basics" });
  sm.index({ name: "note", content: "deep learning neural networks" });
  assert.equal(sm.size(), 1);

  // The new content should dominate.
  const results = sm.search("neural networks", 1);
  assert.equal(results[0].id, "note");
});

test("index: throws when entry has no name", () => {
  const sm = new SemanticMemory();
  assert.throws(() => sm.index({ content: "no name" }), /string 'name'/i);
  assert.throws(() => sm.index(null), /string 'name'/i);
});

test("index: handles empty content gracefully", () => {
  const sm = new SemanticMemory();
  sm.index({ name: "empty-memory", content: "" });
  // The name "empty-memory" still produces tokens, so it is indexed.
  // The assertion verifies it does not throw.
  assert.equal(sm.size(), 1);
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test("search: returns empty array when not yet indexed", () => {
  const sm = new SemanticMemory();
  assert.deepEqual(sm.search("anything", 5), []);
});

test("search: returns empty array for empty query", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();
  assert.deepEqual(sm.search("", 5), []);
  assert.deepEqual(sm.search("   ", 5), []);
});

test("search: returns semantically relevant results", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  // Query about Python should rank python-setup highest.
  const results = sm.search("python virtual environment setup", 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, "python-setup");
});

test("search: respects k parameter", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  const results = sm.search("code", 2);
  assert.ok(results.length <= 2);
});

test("search: metadata is propagated to results", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  const results = sm.search("deployment", 1);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].metadata.tags, ["deployment", "checklist"]);
  assert.equal(results[0].metadata.namespace, "ops");
});

// ---------------------------------------------------------------------------
// reindex
// ---------------------------------------------------------------------------

test("reindex: rebuilds index from all persisted memories", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  assert.equal(sm.size(), 4);
  assert.ok(sm.search("source code test directory", 1).length > 0);
});

test("reindex: handles empty memory list gracefully", () => {
  const sm = new SemanticMemory({ listFn: () => [] });
  sm.reindex();
  assert.equal(sm.size(), 0);
  assert.deepEqual(sm.search("anything", 5), []);
});

test("reindex: throws when listFn is not configured", () => {
  const sm = new SemanticMemory();
  assert.throws(() => sm.reindex(), /listFn is not configured/i);
});

test("reindex: clears previous index before rebuilding", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();
  assert.equal(sm.size(), 4);

  // Reindex with fewer memories.
  const fewer = createMockList(memories.slice(0, 2));
  sm._listFn = fewer;
  sm.reindex();
  assert.equal(sm.size(), 2);
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

test("remove: deletes a memory from the index", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  assert.equal(sm.remove("js-tips"), true);
  assert.equal(sm.size(), 3);
  assert.equal(sm.remove("js-tips"), false); // already gone
});

test("remove: returns false for unknown name", () => {
  const sm = new SemanticMemory();
  sm.index({ name: "only-one", content: "hello" });
  assert.equal(sm.remove("nonexistent"), false);
  assert.equal(sm.size(), 1);
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

test("toJson / fromJson: round-trips the full semantic index", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  const json = sm.toJson();
  assert.ok(Array.isArray(json.vocabulary));
  assert.ok(json.vocabulary.length > 0);
  assert.ok(Array.isArray(json.idf));
  assert.equal(json.vocabulary.length, json.idf.length);
  assert.ok(json.store && Array.isArray(json.store.entries));

  // Restore into a fresh instance.
  const restored = new SemanticMemory();
  restored.fromJson(json);

  assert.equal(restored.size(), sm.size());

  // Search should produce equivalent results.
  const originalResults = sm.search("python", 1);
  const restoredResults = restored.search("python", 1);
  assert.equal(originalResults.length, restoredResults.length);
  assert.equal(originalResults[0].id, restoredResults[0].id);
});

test("fromJson: throws on invalid data", () => {
  const sm = new SemanticMemory();
  assert.throws(() => sm.fromJson(null), /must have/i);
  assert.throws(() => sm.fromJson({}), /must have/i);
  assert.throws(() => sm.fromJson({ vocabulary: "not-array", idf: [] }), /must have/i);
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

test("clear: removes all indexed data and resets state", () => {
  const memories = makeFixtureMemories();
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();
  assert.equal(sm.size(), 4);

  sm.clear();
  assert.equal(sm.size(), 0);
  assert.deepEqual(sm.search("anything"), []);
});

// ---------------------------------------------------------------------------
// Integration-like: search ranking quality
// ---------------------------------------------------------------------------

test("SemanticMemory: ranks exact topic match highest", () => {
  const memories = [
    { name: "react-hooks", content: "useState and useEffect are React hooks.", namespace: "dev", tags: ["react"] },
    { name: "vue-reactivity", content: "Vue 3 uses ref and reactive for state.", namespace: "dev", tags: ["vue"] },
    { name: "angular-services", content: "Angular services use dependency injection.", namespace: "dev", tags: ["angular"] },
  ];
  const sm = new SemanticMemory({ listFn: createMockList(memories) });
  sm.reindex();

  const results = sm.search("react hooks useState useEffect", 3);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, "react-hooks");
});
