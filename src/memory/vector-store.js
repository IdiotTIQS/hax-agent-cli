"use strict";

const { cosineSimilarity } = require("./embedder");

/**
 * In-memory vector store with cosine-similarity search and serialization.
 *
 * Uses a linear scan with a size-k min-heap for top-k retrieval,
 * providing exact (not approximate) nearest-neighbor results.
 */

class VectorStore {
  constructor() {
    /** @type {Map<string, { vector: number[], metadata: object|null }>} */
    this._entries = new Map();
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  /**
   * Add or update a vector entry.
   *
   * @param {string} id - Unique identifier for the entry.
   * @param {number[]} vector - The embedding vector.
   * @param {object|null} [metadata=null] - Optional metadata attached to the entry.
   * @returns {this}
   */
  add(id, vector, metadata = null) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("VectorStore.add: id must be a non-empty string");
    }
    if (!Array.isArray(vector)) {
      throw new Error("VectorStore.add: vector must be an array of numbers");
    }
    if (vector.length === 0) {
      throw new Error("VectorStore.add: vector must not be empty");
    }
    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
        throw new Error(
          `VectorStore.add: vector[${i}] must be a finite number, got ${vector[i]}`
        );
      }
    }

    // Store a defensive copy to prevent external mutation.
    this._entries.set(id, {
      vector: vector.slice(),
      metadata: metadata != null ? structuredClone(metadata) : null,
    });

    return this;
  }

  /**
   * Search for the top-k most similar entries to the query vector.
   *
   * Uses a linear scan with a min-heap for efficient top-k pruning.
   *
   * @param {number[]} queryVector - The query embedding.
   * @param {number} [k=10] - Number of results to return.
   * @returns {{ id: string, similarity: number, metadata: object|null }[]}
   *   Results sorted by similarity descending (highest first).
   */
  search(queryVector, k = 10) {
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return [];
    }

    const top = new TopKHeap(Math.max(1, Math.floor(k)));

    for (const [id, entry] of this._entries) {
      if (entry.vector.length !== queryVector.length) {
        // Skip dimension-mismatched entries instead of throwing.
        continue;
      }
      const sim = cosineSimilarity(queryVector, entry.vector);
      top.push(id, sim, entry.metadata);
    }

    return top.toSorted();
  }

  /**
   * Delete an entry by ID.
   *
   * @param {string} id
   * @returns {boolean} true if an entry was deleted, false if not found.
   */
  delete(id) {
    return this._entries.delete(id);
  }

  /**
   * Get the number of stored vectors.
   *
   * @returns {number}
   */
  size() {
    return this._entries.size;
  }

  /**
   * Remove all entries from the store.
   */
  clear() {
    this._entries.clear();
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize the store to a plain object suitable for JSON.stringify.
   *
   * @returns {{ entries: { id: string, vector: number[], metadata: object|null }[] }}
   */
  toJson() {
    const entries = [];
    for (const [id, entry] of this._entries) {
      entries.push({
        id,
        vector: entry.vector,
        metadata: entry.metadata,
      });
    }
    return { entries };
  }

  /**
   * Deserialize from a plain object (as produced by toJson).
   *
   * @param {{ entries: { id: string, vector: number[], metadata: object|null }[] }} data
   * @returns {this}
   */
  fromJson(data) {
    this.clear();

    if (!data || !Array.isArray(data.entries)) {
      return this;
    }

    for (let i = 0; i < data.entries.length; i++) {
      const e = data.entries[i];
      this.add(e.id, e.vector, e.metadata);
    }

    return this;
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  /**
   * Check if an entry exists by ID.
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._entries.has(id);
  }

  /**
   * Get a stored entry by ID.
   *
   * @param {string} id
   * @returns {{ vector: number[], metadata: object|null } | undefined}
   */
  get(id) {
    const entry = this._entries.get(id);
    if (!entry) {
      return undefined;
    }
    return {
      vector: entry.vector.slice(),
      metadata: entry.metadata != null
        ? structuredClone(entry.metadata)
        : null,
    };
  }
}

// -----------------------------------------------------------------------------
// Internal: Top-K min-heap for efficient pruning during linear scan
// -----------------------------------------------------------------------------

class TopKHeap {
  constructor(k) {
    this._k = k;
    /** @type {{ id: string, similarity: number, metadata: object|null }[]} */
    this._heap = [];
  }

  /**
   * Push a candidate result. Maintains the heap at size k with the
   * k-highest similarity values by keeping a min-heap.
   */
  push(id, similarity, metadata) {
    if (this._heap.length < this._k) {
      this._heap.push({ id, similarity, metadata });
      this._siftUp(this._heap.length - 1);
      return;
    }

    // If the new similarity is higher than the smallest in the heap, replace it.
    if (similarity > this._heap[0].similarity) {
      this._heap[0] = { id, similarity, metadata };
      this._siftDown(0);
    }
  }

  /** Return results sorted by similarity descending. */
  toSorted() {
    return this._heap
      .slice()
      .sort((a, b) => b.similarity - a.similarity);
  }

  // ---- min-heap helpers ----

  _siftUp(idx) {
    const item = this._heap[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this._heap[parentIdx].similarity <= item.similarity) {
        break;
      }
      this._heap[idx] = this._heap[parentIdx];
      idx = parentIdx;
    }
    this._heap[idx] = item;
  }

  _siftDown(idx) {
    const item = this._heap[idx];
    const half = this._heap.length >> 1;
    while (idx < half) {
      let childIdx = (idx << 1) + 1;
      let child = this._heap[childIdx];
      const rightIdx = childIdx + 1;
      if (
        rightIdx < this._heap.length &&
        this._heap[rightIdx].similarity < child.similarity
      ) {
        childIdx = rightIdx;
        child = this._heap[rightIdx];
      }
      if (item.similarity <= child.similarity) {
        break;
      }
      this._heap[idx] = child;
      idx = childIdx;
    }
    this._heap[idx] = item;
  }
}

module.exports = { VectorStore };
