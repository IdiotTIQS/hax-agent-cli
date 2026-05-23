"use strict";

/**
 * CICache — hierarchical cache for CI pipeline results.
 *
 * Cache levels:
 *   pipeline — whole pipeline result
 *   stage    — individual stage result
 *   step     — individual step result
 *
 * Keys are hashed from input components (files, deps, config) to enable
 * deterministic cache lookups.  Metadata is stored alongside values for
 * pruning and statistics.
 */

const crypto = require("node:crypto");

const CACHE_LEVELS = new Set(["pipeline", "stage", "step"]);
const DEFAULT_MAX_SIZE = 500;
const DEFAULT_MAX_AGE_MS = 86_400_000; // 24 hours

class CacheError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CacheError";
    this.code = String(code);
  }
}

class CICache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize=500] - Maximum number of entries.
   * @param {number} [options.maxAgeMs=86400000] - Default max age in ms (24h).
   */
  constructor(options = {}) {
    this._store = new Map();       // key -> { value, metadata, accessedAt, createdAt }
    this._maxSize = normalizeInt(options.maxSize, DEFAULT_MAX_SIZE, 1, 100_000);
    this._defaultMaxAgeMs = normalizeInt(
      options.maxAgeMs,
      DEFAULT_MAX_AGE_MS,
      0,
      7 * 86_400_000 // max 7 days
    );

    this._stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
      prunes: 0,
    };

    this._lock = false; // simple mutex for gets/sets during prune
    this._seq = 0;       // monotonic counter for LRU ordering
  }

  /**
   * Return next sequence number.
   */
  _nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  /**
   * Retrieve a cached value by key.
   * @param {string} key
   * @returns {*|undefined} cached value or undefined if miss/expired.
   */
  get(key) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new CacheError("INVALID_KEY", "Cache key must be a non-empty string.");
    }

    const entry = this._store.get(key);
    if (!entry) {
      this._stats.misses += 1;
      return undefined;
    }

    // Check expiry
    if (entry.metadata.expiresAt && Date.now() > entry.metadata.expiresAt) {
      this._store.delete(key);
      this._stats.misses += 1;
      return undefined;
    }

    // Update access time and sequence for LRU ordering
    entry.accessedAt = Date.now();
    entry.order = this._nextSeq();
    this._stats.hits += 1;
    return clone(entry.value);
  }

  /**
   * Store a cached value.
   * @param {string} key
   * @param {*} value
   * @param {object} [metadata]
   * @param {'pipeline'|'stage'|'step'} [metadata.level='stage'] - Cache level.
   * @param {string[]} [metadata.tags=[]] - Tags for invalidation.
   * @param {number} [metadata.ttlMs] - Time-to-live in ms (overrides default).
   * @param {object} [metadata.inputs] - Hash inputs for provenance.
   */
  set(key, value, metadata = {}) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new CacheError("INVALID_KEY", "Cache key must be a non-empty string.");
    }

    const level = CACHE_LEVELS.has(metadata.level) ? metadata.level : "stage";
    const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
    const ttlMs = normalizeInt(metadata.ttlMs, this._defaultMaxAgeMs, 0, 7 * 86_400_000);
    const now = Date.now();

    const entry = {
      value: clone(value),
      metadata: {
        level,
        tags: [...tags],
        ttlMs,
        expiresAt: ttlMs > 0 ? now + ttlMs : null,
        inputs: metadata.inputs || {},
        createdAt: new Date(now).toISOString(),
      },
      accessedAt: now,
      createdAt: now,
      order: this._nextSeq(),
    };

    this._store.set(key, entry);
    this._stats.sets += 1;

    // Auto-prune if over max size
    if (this._store.size > this._maxSize) {
      this._pruneExcess();
    }

    return this;
  }

  /**
   * Invalidate cache entries matching a pattern.
   * Pattern can match against:
   *   - key (simple includes match)
   *   - tag (exact tag match)
   *   - level (exact level match)
   * @param {string|RegExp|object} pattern
   *   If string: matches keys that include the pattern (case-insensitive).
   *   If RegExp: matches keys using regex.test(key).
   *   If object: { key?, tag?, level?, olderThan? }
   * @returns {number} count of entries invalidated.
   */
  invalidate(pattern) {
    let removed = 0;

    if (typeof pattern === "string") {
      const lowerPattern = pattern.toLowerCase();
      for (const key of this._store.keys()) {
        if (key.toLowerCase().includes(lowerPattern)) {
          this._store.delete(key);
          removed += 1;
        }
      }
    } else if (pattern instanceof RegExp) {
      for (const key of this._store.keys()) {
        if (pattern.test(key)) {
          this._store.delete(key);
          removed += 1;
        }
      }
    } else if (pattern && typeof pattern === "object") {
      for (const [key, entry] of this._store) {
        let match = true;

        if (pattern.key !== undefined) {
          if (pattern.key instanceof RegExp) {
            match = pattern.key.test(key);
          } else {
            match = key.toLowerCase().includes(String(pattern.key).toLowerCase());
          }
        }

        if (match && pattern.tag !== undefined) {
          match = entry.metadata.tags.includes(pattern.tag);
        }

        if (match && pattern.level !== undefined) {
          match = entry.metadata.level === pattern.level;
        }

        if (match && pattern.olderThan !== undefined) {
          const olderThanTs = new Date(pattern.olderThan).getTime();
          match = entry.createdAt < olderThanTs;
        }

        if (match) {
          this._store.delete(key);
          removed += 1;
        }
      }
    }

    this._stats.invalidations += removed;
    return removed;
  }

  /**
   * Prune old or excess entries.
   * @param {number} [maxAge] - Maximum age in ms (entries older are removed).
   * @param {number} [maxSize] - Maximum number of entries.
   * @returns {number} count of entries pruned.
   */
  prune(maxAge, maxSize) {
    let removed = 0;

    const maxAgeMs = maxAge !== undefined
      ? normalizeInt(maxAge, this._defaultMaxAgeMs, 0, 7 * 86_400_000)
      : this._defaultMaxAgeMs;

    const sizeLimit = maxSize !== undefined
      ? normalizeInt(maxSize, this._maxSize, 1, 100_000)
      : this._maxSize;

    // Remove expired
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (entry.metadata.expiresAt && now > entry.metadata.expiresAt) {
        this._store.delete(key);
        removed += 1;
      }
    }

    // Remove entries older than maxAge
    if (maxAgeMs > 0) {
      const cutoff = now - maxAgeMs;
      for (const [key, entry] of this._store) {
        if (entry.createdAt < cutoff) {
          this._store.delete(key);
          removed += 1;
        }
      }
    }

    // Remove least-recently-accessed to meet size limit
    if (this._store.size > sizeLimit) {
      const entries = [...this._store.entries()]
        .sort((a, b) => a[1].order - b[1].order);

      const toRemove = this._store.size - sizeLimit;
      for (let i = 0; i < toRemove && i < entries.length; i++) {
        this._store.delete(entries[i][0]);
        removed += 1;
      }
    }

    this._stats.prunes += 1;
    return removed;
  }

  /**
   * Prune excess entries when over max size (removes oldest 10% or oldest 1).
   */
  _pruneExcess() {
    const excess = this._store.size - this._maxSize;
    if (excess <= 0) return;

    const toRemove = Math.max(excess, 1);
    const entries = [...this._store.entries()]
      .sort((a, b) => a[1].order - b[1].order);

    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this._store.delete(entries[i][0]);
    }
  }

  /**
   * Return cache statistics.
   * @returns {{ entries: number, maxSize: number, hits: number, misses: number,
   *             sets: number, invalidations: number, prunes: number,
   *             hitRatio: number, sizeBytes: number }}
   */
  getStats() {
    const total = this._stats.hits + this._stats.misses;
    const hitRatio = total > 0 ? Math.round((this._stats.hits / total) * 100) / 100 : 0;

    // Approximate memory size
    let sizeBytes = 0;
    for (const [, entry] of this._store) {
      try {
        sizeBytes += JSON.stringify(entry.value).length;
      } catch (_e) {
        sizeBytes += 256; // conservative estimate for non-serializable values
      }
    }

    return {
      entries: this._store.size,
      maxSize: this._maxSize,
      hits: this._stats.hits,
      misses: this._stats.misses,
      sets: this._stats.sets,
      invalidations: this._stats.invalidations,
      prunes: this._stats.prunes,
      hitRatio,
      sizeBytes,
    };
  }

  /**
   * Check if a key exists in the cache (and is not expired).
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (entry.metadata.expiresAt && Date.now() > entry.metadata.expiresAt) {
      this._store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all entries from the cache.
   */
  clear() {
    const count = this._store.size;
    this._store.clear();
    return count;
  }

  /**
   * Compute a deterministic hash from input components.
   * @param {object|string|Array} inputs - Files, deps, config, etc.
   * @param {string} [algorithm='sha256'] - Hash algorithm.
   * @returns {string} hex-encoded hash.
   */
  static hash(inputs, algorithm = "sha256") {
    const normalized = CICache._normalizeInput(inputs);
    return crypto.createHash(algorithm).update(normalized).digest("hex");
  }

  /**
   * Build a cache key from level and input components.
   * @param {'pipeline'|'stage'|'step'} level
   * @param {string} name - Pipeline, stage, or step name.
   * @param {object} [inputs] - Input components to hash.
   * @returns {string} composite cache key.
   */
  static buildKey(level, name, inputs = {}) {
    if (!CACHE_LEVELS.has(level)) {
      throw new CacheError("INVALID_LEVEL", `Cache level must be one of: ${[...CACHE_LEVELS].join(", ")}.`);
    }

    const inputHash = CICache.hash(inputs);
    return `ci:${level}:${name}:${inputHash}`;
  }

  /**
   * Normalize any input structure to a deterministic JSON string for hashing.
   */
  static _normalizeInput(inputs) {
    if (inputs === undefined || inputs === null) {
      return "null";
    }

    // Sort keys for deterministic output
    if (typeof inputs === "object" && !Array.isArray(inputs)) {
      const sorted = {};
      const keys = Object.keys(inputs).sort();
      for (const key of keys) {
        sorted[key] = CICache._normalizeInput(inputs[key]);
      }
      return JSON.stringify(sorted);
    }

    if (Array.isArray(inputs)) {
      return JSON.stringify(inputs.map(CICache._normalizeInput));
    }

    if (typeof inputs === "string") {
      return inputs;
    }

    return JSON.stringify(inputs);
  }
}

// ---- helpers ----

function normalizeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    // For non-serializable values (functions, symbols, etc.), return as-is.
    return value;
  }
}

module.exports = { CICache, CacheError, CACHE_LEVELS };
