"use strict";

/**
 * Vector math utilities and TF-IDF vectorizer for semantic memory.
 *
 * No external ML dependencies — pure math implementation using only
 * Node.js standard library.
 */

/**
 * Compute the dot product of two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function dotProduct(a, b) {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Compute the L2 (Euclidean) norm of a vector.
 * @param {number[]} v
 * @returns {number}
 */
function l2Norm(v) {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * Normalize a vector to unit length.
 * Returns a zero-filled vector of the same length if the input has zero norm.
 * @param {number[]} v
 * @returns {number[]}
 */
function normalize(v) {
  const norm = l2Norm(v);
  if (norm === 0) {
    return new Array(v.length).fill(0);
  }
  const result = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm;
  }
  return result;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (inclusive).
 * Returns 0 if either vector has zero magnitude.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`
    );
  }

  let dot = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normASq += a[i] * a[i];
    normBSq += b[i] * b[i];
  }

  const normProduct = Math.sqrt(normASq) * Math.sqrt(normBSq);
  if (normProduct === 0) {
    return 0;
  }

  return dot / normProduct;
}

/**
 * Tokenize text into lowercase word tokens, stripping punctuation.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Create a bag-of-words embedding from text using a given vocabulary.
 * The resulting vector has one dimension per vocabulary term, with the
 * value being the raw term frequency in the input text.
 *
 * @param {string} text - Input text to embed.
 * @param {string[]} vocabulary - Ordered list of vocabulary terms.
 * @returns {number[]} Sparse vector as a dense array of length vocabulary.length.
 */
function bagOfWordsEmbedding(text, vocabulary) {
  const tokens = tokenize(text);
  const vector = new Array(vocabulary.length).fill(0);

  // Build a lookup from token to index for O(1) assignment.
  const tokenToIndex = new Map();
  for (let i = 0; i < vocabulary.length; i++) {
    tokenToIndex.set(vocabulary[i], i);
  }

  for (let i = 0; i < tokens.length; i++) {
    const idx = tokenToIndex.get(tokens[i]);
    if (idx !== undefined) {
      vector[idx]++;
    }
  }

  return vector;
}

/**
 * Build a sorted vocabulary from a collection of texts.
 * Words are sorted alphabetically for deterministic ordering.
 * Single-character tokens and numeric-only tokens are excluded.
 *
 * @param {string[]} texts
 * @returns {string[]}
 */
function buildVocabulary(texts) {
  const termSet = new Set();

  for (let i = 0; i < texts.length; i++) {
    const tokens = tokenize(texts[i]);
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j];
      // Skip very short tokens and purely numeric tokens.
      if (t.length > 1 && !/^\d+$/.test(t)) {
        termSet.add(t);
      }
    }
  }

  return Array.from(termSet).sort();
}

/**
 * Compute TF-IDF vectors for a collection of texts.
 *
 * Steps:
 *   1. Build vocabulary from all texts.
 *   2. Compute document frequency (DF) for each term.
 *   3. Compute IDF as log(N / (1 + DF)) for smoothing.
 *   4. For each document, compute TF (raw count), then TF-IDF = TF * IDF.
 *
 * @param {string[]} texts - Array of text documents.
 * @returns {{ vocabulary: string[], vectors: number[][] }}
 */
function tfidfVectorize(texts) {
  if (texts.length === 0) {
    return { vocabulary: [], vectors: [] };
  }

  const vocabulary = buildVocabulary(texts);
  const N = texts.length;
  const V = vocabulary.length;

  if (V === 0) {
    return { vocabulary: [], vectors: texts.map(() => []) };
  }

  // Compute document frequency for each term.
  const df = new Array(V).fill(0);
  const tokenToIndex = new Map();
  for (let i = 0; i < V; i++) {
    tokenToIndex.set(vocabulary[i], i);
  }

  // Pre-tokenize all documents.
  const docTokens = texts.map((t) => tokenize(t));

  for (let d = 0; d < N; d++) {
    const seen = new Set();
    const tokens = docTokens[d];
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j];
      const idx = tokenToIndex.get(t);
      if (idx !== undefined && !seen.has(idx)) {
        seen.add(idx);
        df[idx]++;
      }
    }
  }

  // Compute IDF with smoothing so single-document corpora still produce
  // non-zero weights.  Formula: idf = log(1 + N / (1 + df))
  const idf = new Array(V);
  for (let i = 0; i < V; i++) {
    idf[i] = Math.log(1 + N / (1 + df[i]));
  }

  // Compute TF-IDF for each document.
  const vectors = [];
  for (let d = 0; d < N; d++) {
    const vec = new Array(V).fill(0);
    const tokens = docTokens[d];
    for (let j = 0; j < tokens.length; j++) {
      const idx = tokenToIndex.get(tokens[j]);
      if (idx !== undefined) {
        vec[idx]++; // term frequency
      }
    }
    // Multiply by IDF.
    for (let i = 0; i < V; i++) {
      vec[i] *= idf[i];
    }
    vectors.push(vec);
  }

  return { vocabulary, vectors };
}

/**
 * Project new text into the TF-IDF space defined by a vocabulary and IDF array.
 * Useful for embedding queries against an already-built index.
 *
 * @param {string} text - Query or new document text.
 * @param {string[]} vocabulary - Vocabulary from a prior tfidfVectorize call.
 * @param {number[]} idf - IDF values corresponding to the vocabulary.
 * @returns {number[]} TF-IDF vector for the input text.
 */
function projectTfidf(text, vocabulary, idf) {
  if (vocabulary.length !== idf.length) {
    throw new Error(
      `Vocabulary/IDF length mismatch: ${vocabulary.length} vs ${idf.length}`
    );
  }

  const V = vocabulary.length;
  const vec = new Array(V).fill(0);

  if (V === 0) {
    return vec;
  }

  const tokenToIndex = new Map();
  for (let i = 0; i < V; i++) {
    tokenToIndex.set(vocabulary[i], i);
  }

  const tokens = tokenize(text);
  for (let j = 0; j < tokens.length; j++) {
    const idx = tokenToIndex.get(tokens[j]);
    if (idx !== undefined) {
      vec[idx]++; // raw term frequency
    }
  }

  for (let i = 0; i < V; i++) {
    vec[i] *= idf[i];
  }

  return vec;
}

module.exports = {
  bagOfWordsEmbedding,
  buildVocabulary,
  cosineSimilarity,
  dotProduct,
  l2Norm,
  normalize,
  projectTfidf,
  tfidfVectorize,
  tokenize,
};
