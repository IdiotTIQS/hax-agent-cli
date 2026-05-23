"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { VectorStore } = require("../../src/memory/vector-store");

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("VectorStore: initializes empty", () => {
  const store = new VectorStore();
  assert.equal(store.size(), 0);
});

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

test("add: stores a vector with metadata", () => {
  const store = new VectorStore();
  store.add("doc-1", [1, 2, 3], { title: "Hello" });
  assert.equal(store.size(), 1);
  assert.ok(store.has("doc-1"));
});

test("add: overwrites existing entry with same ID", () => {
  const store = new VectorStore();
  store.add("a", [1, 0], { v: 1 });
  store.add("a", [0, 1], { v: 2 });
  assert.equal(store.size(), 1);
  const entry = store.get("a");
  assert.deepEqual(entry.vector, [0, 1]);
  assert.deepEqual(entry.metadata, { v: 2 });
});

test("add: returns this for chaining", () => {
  const store = new VectorStore();
  const result = store.add("x", [1]);
  assert.strictEqual(result, store);
});

test("add: throws on empty ID", () => {
  const store = new VectorStore();
  assert.throws(() => store.add("", [1]), /non-empty string/i);
});

test("add: throws on non-array vector", () => {
  const store = new VectorStore();
  assert.throws(() => store.add("x", "not-an-array"), /must be an array/i);
});

test("add: throws on empty vector", () => {
  const store = new VectorStore();
  assert.throws(() => store.add("x", []), /must not be empty/i);
});

test("add: throws on non-finite values", () => {
  const store = new VectorStore();
  assert.throws(() => store.add("x", [NaN]), /must be a finite number/i);
  assert.throws(() => store.add("x", [Infinity]), /must be a finite number/i);
});

test("add: stores a defensive copy of the vector", () => {
  const store = new VectorStore();
  const vec = [1, 2, 3];
  store.add("d", vec);
  vec[0] = 99;
  assert.deepEqual(store.get("d").vector, [1, 2, 3]);
});

test("add: stores a defensive copy of metadata", () => {
  const store = new VectorStore();
  const meta = { count: 1 };
  store.add("e", [1], meta);
  meta.count = 99;
  assert.deepEqual(store.get("e").metadata, { count: 1 });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test("search: returns empty array when store is empty", () => {
  const store = new VectorStore();
  assert.deepEqual(store.search([1, 0]), []);
});

test("search: returns top-k results sorted by similarity", () => {
  const store = new VectorStore();
  store.add("a", [1, 0, 0]); // identical to query
  store.add("b", [0, 1, 0]); // orthogonal
  store.add("c", [0.9, 0.1, 0]); // very similar

  const results = store.search([1, 0, 0], 3);

  assert.equal(results.length, 3);
  assert.equal(results[0].id, "a"); // most similar
  assert.ok(results[0].similarity > results[1].similarity);
  assert.ok(results[1].similarity > results[2].similarity);
});

test("search: respects k parameter", () => {
  const store = new VectorStore();
  store.add("a", [1, 0]);
  store.add("b", [0.9, 0.1]);
  store.add("c", [0.8, 0.2]);
  store.add("d", [0.7, 0.3]);

  const results = store.search([1, 0], 2);
  assert.equal(results.length, 2);
});

test("search: skips dimension-mismatched entries", () => {
  const store = new VectorStore();
  store.add("a", [1, 0]);
  store.add("b", [1, 2, 3]); // 3-d vs 2-d query

  const results = store.search([1, 0], 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "a");
});

test("search: empty query vector returns empty array", () => {
  const store = new VectorStore();
  store.add("a", [1, 0]);
  assert.deepEqual(store.search([], 5), []);
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

test("delete: removes an entry and returns true", () => {
  const store = new VectorStore();
  store.add("a", [1]);
  assert.equal(store.delete("a"), true);
  assert.equal(store.size(), 0);
});

test("delete: returns false for missing entry", () => {
  const store = new VectorStore();
  assert.equal(store.delete("nonexistent"), false);
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

test("clear: removes all entries", () => {
  const store = new VectorStore();
  store.add("a", [1]).add("b", [2]).add("c", [3]);
  store.clear();
  assert.equal(store.size(), 0);
  assert.deepEqual(store.search([1]), []);
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

test("toJson / fromJson: round-trips all data", () => {
  const store = new VectorStore();
  store.add("doc-1", [1, 2, 3], { title: "Alpha" });
  store.add("doc-2", [4, 5, 6], { title: "Beta" });
  store.add("doc-3", [7, 8, 9], null);

  const json = store.toJson();
  assert.ok(Array.isArray(json.entries));
  assert.equal(json.entries.length, 3);

  // Restore into a fresh store.
  const restored = new VectorStore();
  restored.fromJson(json);

  assert.equal(restored.size(), 3);
  assert.ok(restored.has("doc-1"));
  assert.ok(restored.has("doc-2"));
  assert.ok(restored.has("doc-3"));

  const entry = restored.get("doc-1");
  assert.deepEqual(entry.vector, [1, 2, 3]);
  assert.deepEqual(entry.metadata, { title: "Alpha" });
});

test("fromJson: handles empty/null data gracefully", () => {
  const store = new VectorStore();
  store.fromJson(null);
  assert.equal(store.size(), 0);

  store.fromJson({});
  assert.equal(store.size(), 0);

  store.fromJson({ entries: [] });
  assert.equal(store.size(), 0);
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

test("get: returns a defensive copy of the stored entry", () => {
  const store = new VectorStore();
  store.add("a", [5, 6], { k: "v" });

  const entry = store.get("a");
  entry.vector[0] = 999;
  entry.metadata.k = "mutated";

  const fresh = store.get("a");
  assert.deepEqual(fresh.vector, [5, 6]);
  assert.deepEqual(fresh.metadata, { k: "v" });
});

test("get: returns undefined for missing ID", () => {
  const store = new VectorStore();
  assert.equal(store.get("missing"), undefined);
});
