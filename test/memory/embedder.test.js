"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cosineSimilarity,
  dotProduct,
  l2Norm,
  normalize,
  bagOfWordsEmbedding,
  tfidfVectorize,
  projectTfidf,
  tokenize,
  buildVocabulary,
} = require("../../src/memory/embedder");

// ---------------------------------------------------------------------------
// dotProduct
// ---------------------------------------------------------------------------

test("dotProduct: computes dot product of two equal-length vectors", () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
  assert.equal(dotProduct(a, b), 32);
});

test("dotProduct: returns 0 for orthogonal vectors", () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.equal(dotProduct(a, b), 0);
});

test("dotProduct: throws on length mismatch", () => {
  assert.throws(
    () => dotProduct([1, 2], [1, 2, 3]),
    /length mismatch/i
  );
});

test("dotProduct: handles negative values", () => {
  assert.equal(dotProduct([-1, 2], [3, -4]), -1 * 3 + 2 * (-4)); // -3 + -8 = -11
});

// ---------------------------------------------------------------------------
// l2Norm
// ---------------------------------------------------------------------------

test("l2Norm: computes Euclidean norm", () => {
  // sqrt(3^2 + 4^2) = 5
  assert.equal(l2Norm([3, 4]), 5);
});

test("l2Norm: zero-length vector returns 0", () => {
  assert.equal(l2Norm([]), 0);
});

test("l2Norm: zero vector returns 0", () => {
  assert.equal(l2Norm([0, 0, 0]), 0);
});

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

test("normalize: returns unit vector", () => {
  const v = [3, 4];
  const result = normalize(v);
  // [3/5, 4/5] = [0.6, 0.8]
  assert.ok(Math.abs(result[0] - 0.6) < 1e-10);
  assert.ok(Math.abs(result[1] - 0.8) < 1e-10);

  // Verify unit length.
  assert.ok(Math.abs(l2Norm(result) - 1) < 1e-10);
});

test("normalize: zero vector returns zeros", () => {
  const result = normalize([0, 0, 0]);
  assert.deepEqual(result, [0, 0, 0]);
});

test("normalize: does not mutate the original vector", () => {
  const v = [5, 0];
  const copy = v.slice();
  normalize(v);
  assert.deepEqual(v, copy);
});

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

test("cosineSimilarity: identical vectors return 1", () => {
  const v = [1, 2, 3];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-10);
});

test("cosineSimilarity: opposite vectors return -1", () => {
  const v = [5, 0, 0];
  const negV = [-5, 0, 0];
  assert.ok(Math.abs(cosineSimilarity(v, negV) - (-1)) < 1e-10);
});

test("cosineSimilarity: orthogonal vectors return 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: zero vector returns 0", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 2], [0, 0]), 0);
});

test("cosineSimilarity: throws on length mismatch", () => {
  assert.throws(
    () => cosineSimilarity([1, 2], [1]),
    /length mismatch/i
  );
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test("tokenize: splits text into lowercase word tokens", () => {
  const result = tokenize("Hello World! How are you?");
  assert.deepEqual(result, ["hello", "world", "how", "are", "you"]);
});

test("tokenize: empty string returns empty array", () => {
  assert.deepEqual(tokenize(""), []);
});

test("tokenize: non-string returns empty array", () => {
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
});

// ---------------------------------------------------------------------------
// buildVocabulary
// ---------------------------------------------------------------------------

test("buildVocabulary: returns sorted unique words across texts", () => {
  const vocab = buildVocabulary(["hello world", "hello there"]);
  // tokens: hello, world, hello, there -> unique and sorted
  assert.deepEqual(vocab, ["hello", "there", "world"]);
});

test("buildVocabulary: filters out single-character and numeric tokens", () => {
  const vocab = buildVocabulary(["a big 42 test 1 99"]);
  // "a", "42", "1", "99" are filtered; "big", "test" remain
  assert.ok(vocab.includes("big"));
  assert.ok(vocab.includes("test"));
  assert.ok(!vocab.includes("a"));
  assert.ok(!vocab.includes("42"));
  assert.ok(!vocab.includes("1"));
  assert.ok(!vocab.includes("99"));
});

// ---------------------------------------------------------------------------
// bagOfWordsEmbedding
// ---------------------------------------------------------------------------

test("bagOfWordsEmbedding: produces vector with term frequencies", () => {
  const vocab = ["hello", "world"];
  const vec = bagOfWordsEmbedding("hello world hello", vocab);
  assert.deepEqual(vec, [2, 1]);
});

test("bagOfWordsEmbedding: unknown words are ignored", () => {
  const vocab = ["foo"];
  const vec = bagOfWordsEmbedding("foo bar baz", vocab);
  assert.deepEqual(vec, [1]);
});

// ---------------------------------------------------------------------------
// tfidfVectorize
// ---------------------------------------------------------------------------

test("tfidfVectorize: returns correct shape for single document", () => {
  const { vocabulary, vectors } = tfidfVectorize(["hello world"]);
  assert.equal(vectors.length, 1);
  assert.equal(vocabulary.length, 2);
  assert.equal(vectors[0].length, vocabulary.length);
});

test("tfidfVectorize: empty input returns empty vocabulary and vectors", () => {
  const { vocabulary, vectors } = tfidfVectorize([]);
  assert.deepEqual(vocabulary, []);
  assert.deepEqual(vectors, []);
});

test("tfidfVectorize: rare terms get higher IDF weight", () => {
  const texts = [
    "machine learning is powerful",
    "learning deep learning",
    "deep neural networks",
  ];
  const { vocabulary, vectors } = tfidfVectorize(texts);

  // "machine" appears in 1/3 docs -> higher IDF
  // "learning" appears in 2/3 docs -> lower IDF
  const machineIdx = vocabulary.indexOf("machine");
  const learningIdx = vocabulary.indexOf("learning");

  assert.ok(machineIdx >= 0);
  assert.ok(learningIdx >= 0);

  // In doc 0, "machine" (rare) should have higher weight than "learning" (common).
  const doc0 = vectors[0];
  assert.ok(doc0[machineIdx] > doc0[learningIdx]);
});

test("tfidfVectorize: all-doc-empty returns empty vectors", () => {
  const { vocabulary, vectors } = tfidfVectorize([""]);
  assert.deepEqual(vocabulary, []);
  assert.equal(vectors.length, 1);
  assert.deepEqual(vectors[0], []);
});

// ---------------------------------------------------------------------------
// projectTfidf
// ---------------------------------------------------------------------------

test("projectTfidf: projects new text into existing TF-IDF space", () => {
  // Use multiple documents so IDF values are meaningful.
  const texts = [
    "hello world foo bar",
    "hello world",
    "foo bar baz",
  ];
  const { vocabulary } = tfidfVectorize(texts);
  const idf = computeTestIdf(texts, vocabulary);

  const vec = projectTfidf("hello foo", vocabulary, idf);
  assert.equal(vec.length, vocabulary.length);

  // "hello" and "foo" should be non-zero.
  const helloIdx = vocabulary.indexOf("hello");
  const fooIdx = vocabulary.indexOf("foo");
  assert.ok(vec[helloIdx] > 0);
  assert.ok(vec[fooIdx] > 0);

  // "bar" should be zero since it's not in the query.
  const barIdx = vocabulary.indexOf("bar");
  assert.equal(vec[barIdx], 0);
});

test("projectTfidf: throws on length mismatch between vocabulary and idf", () => {
  assert.throws(
    () => projectTfidf("text", ["a", "b"], [1]),
    /length mismatch/i
  );
});

test("projectTfidf: empty vocabulary returns zero-length vector", () => {
  const vec = projectTfidf("hello", [], []);
  assert.deepEqual(vec, []);
});

// ---------------------------------------------------------------------------
// Helper for tests
// ---------------------------------------------------------------------------

function computeTestIdf(texts, vocabulary) {
  const { tokenize } = require("../../src/memory/embedder");
  const N = texts.length;
  const V = vocabulary.length;
  const tokenToIndex = new Map();
  for (let i = 0; i < V; i++) tokenToIndex.set(vocabulary[i], i);

  const df = new Array(V).fill(0);
  for (const text of texts) {
    const seen = new Set();
    const tokens = tokenize(text);
    for (const t of tokens) {
      const idx = tokenToIndex.get(t);
      if (idx !== undefined && !seen.has(idx)) {
        seen.add(idx);
        df[idx]++;
      }
    }
  }

  const idf = new Array(V);
  for (let i = 0; i < V; i++) {
    idf[i] = Math.log(1 + N / (1 + df[i]));
  }
  return idf;
}
