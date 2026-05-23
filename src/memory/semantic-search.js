"use strict";

const { tfidfVectorize, projectTfidf, cosineSimilarity, buildVocabulary } = require("./embedder");
const { VectorStore } = require("./vector-store");

/**
 * SemanticMemory — high-level semantic search layer over the file-based
 * memory system (src/memory.js).
 *
 * Usage:
 *   const sm = new SemanticMemory({ listFn, readFn });
 *   await sm.reindex();               // index all existing memories
 *   sm.index(memoryEntry);            // index a single memory
 *   const results = sm.search("query", 5);
 *   sm.remove("memory-name");
 */
class SemanticMemory {
  /**
   * @param {object} options
   * @param {Function} options.listFn - Function that returns all memory records
   *   (signature must match listMemories from src/memory.js).
   * @param {Function} options.readFn - Function that reads a single memory by name
   *   (signature must match readMemory(name, opts) from src/memory.js).
   * @param {object} [options.listOptions] - Options forwarded to listFn (e.g. namespace).
   */
  constructor(options = {}) {
    this._listFn = options.listFn;
    this._readFn = options.readFn;
    this._listOptions = options.listOptions || {};
    this._store = new VectorStore();
    this._vocabulary = [];
    this._idf = [];
    this._indexed = false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Index a single memory entry into the vector store.
   *
   * The entry is expected to have the shape returned by writeMemory /
   * listMemories: { name, content, namespace, tags, ... }
   *
   * @param {object} memoryEntry
   * @param {string} memoryEntry.name
   * @param {string} memoryEntry.content
   * @returns {this}
   */
  index(memoryEntry) {
    if (!memoryEntry || typeof memoryEntry.name !== "string") {
      throw new Error("SemanticMemory.index: entry must have a string 'name' property");
    }

    const content = memoryEntry.content || "";
    const combinedText = buildIndexText(memoryEntry);

    // Rebuild the vocabulary with this document included so the projection
    // is dimensionally consistent.
    const currentTexts = this._getAllTexts();
    currentTexts.push(combinedText);

    const { vocabulary, vectors } = tfidfVectorize(currentTexts);

    // The last vector is the new entry's vector.
    const newVector = vectors[vectors.length - 1];

    this._vocabulary = vocabulary;
    // IDF is needed for projectTfidf on subsequent searches.
    this._idf = computeIdf(currentTexts, vocabulary);
    this._indexed = true;

    if (newVector && newVector.length > 0) {
      this._store.add(memoryEntry.name, newVector, {
        name: memoryEntry.name,
        namespace: memoryEntry.namespace || "default",
        tags: memoryEntry.tags || [],
        updatedAt: memoryEntry.updatedAt || null,
      });
    }

    return this;
  }

  /**
   * Search for memories semantically similar to the query.
   *
   * @param {string} query - Natural language query.
   * @param {number} [k=10] - Number of results to return.
   * @returns {{ id: string, similarity: number, metadata: object|null }[]}
   */
  search(query, k = 10) {
    if (!this._indexed || this._vocabulary.length === 0) {
      return [];
    }

    if (typeof query !== "string" || query.trim().length === 0) {
      return [];
    }

    const queryVector = projectTfidf(query.trim(), this._vocabulary, this._idf);

    if (queryVector.every((v) => v === 0)) {
      // The query shares no vocabulary terms with the index.
      return [];
    }

    return this._store.search(queryVector, k);
  }

  /**
   * Rebuild the entire vector index from all persisted memories.
   *
   * Reads all memories via listFn, builds a fresh vocabulary and TF-IDF
   * vectors, and replaces the internal vector store.
   *
   * @returns {this}
   */
  reindex() {
    if (typeof this._listFn !== "function") {
      throw new Error(
        "SemanticMemory.reindex: listFn is not configured — " +
        "provide { listFn } in the constructor options."
      );
    }

    this._store.clear();

    const memories = this._listFn(this._listOptions);

    if (memories.length === 0) {
      this._vocabulary = [];
      this._idf = [];
      this._indexed = false;
      return this;
    }

    // Combine content + metadata for richer embeddings.
    const texts = memories.map((m) => buildIndexText(m));
    const { vocabulary, vectors } = tfidfVectorize(texts);

    this._vocabulary = vocabulary;
    this._idf = computeIdf(texts, vocabulary);

    for (let i = 0; i < memories.length; i++) {
      const mem = memories[i];
      const vec = vectors[i];
      if (vec && vec.length > 0) {
        this._store.add(mem.name, vec, {
          name: mem.name,
          namespace: mem.namespace || "default",
          tags: mem.tags || [],
          updatedAt: mem.updatedAt || null,
        });
      }
    }

    this._indexed = true;
    return this;
  }

  /**
   * Remove a memory from the vector store by name.
   *
   * @param {string} name - The memory name (same as used in writeMemory).
   * @returns {boolean} true if removed, false if not found.
   */
  remove(name) {
    return this._store.delete(name);
  }

  /**
   * Number of vectors currently indexed.
   *
   * @returns {number}
   */
  size() {
    return this._store.size();
  }

  /**
   * Clear all indexed vectors and reset vocabulary.
   */
  clear() {
    this._store.clear();
    this._vocabulary = [];
    this._idf = [];
    this._indexed = false;
  }

  /**
   * Serialize the entire semantic index to a plain object.
   *
   * @returns {{ vocabulary: string[], idf: number[], store: object }}
   */
  toJson() {
    return {
      vocabulary: this._vocabulary.slice(),
      idf: this._idf.slice(),
      store: this._store.toJson(),
    };
  }

  /**
   * Restore the semantic index from a previously serialized state.
   *
   * @param {{ vocabulary: string[], idf: number[], store: { entries: object[] } }} data
   * @returns {this}
   */
  fromJson(data) {
    if (!data || !Array.isArray(data.vocabulary) || !Array.isArray(data.idf)) {
      throw new Error(
        "SemanticMemory.fromJson: data must have 'vocabulary' and 'idf' arrays"
      );
    }

    this._vocabulary = data.vocabulary.slice();
    this._idf = data.idf.slice();
    this._store.fromJson(data.store || { entries: [] });
    this._indexed = this._vocabulary.length > 0;

    return this;
  }
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Build a combined text representation of a memory entry for embedding.
 * Includes name, content, namespace, and tags to improve search relevance.
 *
 * @param {object} mem
 * @returns {string}
 */
function buildIndexText(mem) {
  const parts = [];

  if (mem.name) {
    parts.push(mem.name);
  }
  if (mem.content) {
    parts.push(mem.content);
  }
  if (mem.namespace && mem.namespace !== "default") {
    parts.push(`namespace:${mem.namespace}`);
  }
  if (Array.isArray(mem.tags) && mem.tags.length > 0) {
    parts.push(`tags:${mem.tags.join(" ")}`);
  }

  return parts.join(" ");
}

/**
 * Collect all currently indexed texts by reading entry metadata from the store.
 *
 * @returns {string[]}
 * @private
 */
SemanticMemory.prototype._getAllTexts = function _getAllTexts() {
  const texts = [];
  for (const [id, entry] of this._store._entries) {
    const meta = entry.metadata || {};
    texts.push(buildIndexText({ name: id, ...meta }));
  }
  return texts;
};

/**
 * Compute IDF values for a vocabulary from a collection of texts.
 *
 * @param {string[]} texts
 * @param {string[]} vocabulary
 * @returns {number[]}
 */
function computeIdf(texts, vocabulary) {
  const { tokenize } = require("./embedder");
  const N = texts.length;
  const V = vocabulary.length;

  if (V === 0) {
    return [];
  }

  const tokenToIndex = new Map();
  for (let i = 0; i < V; i++) {
    tokenToIndex.set(vocabulary[i], i);
  }

  const df = new Array(V).fill(0);
  const docTokens = texts.map((t) => tokenize(t));

  for (let d = 0; d < N; d++) {
    const seen = new Set();
    const tokens = docTokens[d];
    for (let j = 0; j < tokens.length; j++) {
      const idx = tokenToIndex.get(tokens[j]);
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

module.exports = { SemanticMemory };
