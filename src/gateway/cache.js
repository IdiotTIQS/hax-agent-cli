"use strict";

const crypto = require("node:crypto");

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * In-memory request cache with LRU eviction and TTL support.
 *
 * Cache keys are generated from request method, URL, and a hash of the body.
 * Entries expire based on TTL and are cleaned up lazily on access and
 * periodically via a background interval.
 */
class RequestCache {
  constructor(options = {}) {
    this._maxSize = Number.isFinite(options.maxSize) && options.maxSize > 0
      ? options.maxSize
      : DEFAULT_MAX_SIZE;
    this._defaultTTL = Number.isFinite(options.defaultTTL) && options.defaultTTL > 0
      ? options.defaultTTL
      : DEFAULT_TTL_MS;

    /** @type {Map<string, { response: *, expiresAt: number, lastAccess: number }>} */
    this._store = new Map();

    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;

    this._cleanupTimer = null;
    if (options.backgroundCleanup !== false) {
      this._startCleanup();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Generate a deterministic cache key from a request-like object.
   * @param {{ method?: string, url?: string, body?: string|object }} request
   * @returns {string}
   */
  static keyFromRequest(request) {
    const method = String(request.method || "GET").toUpperCase();
    const url = String(request.url || "");
    const body = request.body != null
      ? (typeof request.body === "string" ? request.body : JSON.stringify(request.body))
      : "";

    const bodyHash = body.length > 0
      ? crypto.createHash("sha256").update(body).digest("hex").slice(0, 16)
      : "empty";

    return `${method}:${url}:${bodyHash}`;
  }

  /**
   * Retrieve a cached response by key.
   * Returns `null` on miss or if the entry has expired.
   * @param {string} key
   * @returns {*|null}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) {
      this._misses += 1;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._evictions += 1;
      this._misses += 1;
      return null;
    }

    // Update access time and move to end for LRU tracking
    entry.lastAccess = Date.now();
    this._store.delete(key);
    this._store.set(key, entry);
    this._hits += 1;
    return entry.response;
  }

  /**
   * Store a response in the cache.
   * @param {string} key
   * @param {*} response
   * @param {number} [ttl] - TTL in milliseconds; uses default if omitted
   * @returns {this}
   */
  set(key, response, ttl) {
    const effectiveTTL = Number.isFinite(ttl) && ttl > 0 ? ttl : this._defaultTTL;

    // If key already exists, update in-place to preserve LRU order
    if (this._store.has(key)) {
      const entry = this._store.get(key);
      entry.response = response;
      entry.expiresAt = Date.now() + effectiveTTL;
      entry.lastAccess = Date.now();
      // Move to end by re-inserting
      this._store.delete(key);
      this._store.set(key, entry);
    } else {
      // Evict if at capacity before inserting
      if (this._store.size >= this._maxSize) {
        this._evictLRU();
      }
      this._store.set(key, {
        response,
        expiresAt: Date.now() + effectiveTTL,
        lastAccess: Date.now(),
      });
    }

    return this;
  }

  /**
   * Invalidate cache entries whose keys match a string or RegExp pattern.
   * @param {string|RegExp} pattern
   * @returns {number} Count of invalidated entries
   */
  invalidate(pattern) {
    let count = 0;
    const test = typeof pattern === "string"
      ? (key) => key.includes(pattern)
      : (key) => pattern.test(key);

    for (const key of this._store.keys()) {
      if (test(key)) {
        this._store.delete(key);
        count += 1;
      }
    }
    return count;
  }

  /**
   * Get cache statistics.
   * @returns {{ hits: number, misses: number, hitRate: number, missRate: number, size: number, maxSize: number, entryCount: number, evictions: number }}
   */
  getStats() {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
      missRate: total === 0 ? 0 : this._misses / total,
      size: this._store.size,
      maxSize: this._maxSize,
      entryCount: this._store.size,
      evictions: this._evictions,
    };
  }

  /**
   * Manually trigger a sweep of expired entries.
   * @returns {number} Number of entries removed
   */
  sweep() {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) {
        this._store.delete(key);
        this._evictions += 1;
        count += 1;
      }
    }
    return count;
  }

  /**
   * Remove all entries and reset statistics.
   */
  clear() {
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * Stop the background cleanup timer.
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Evict the least-recently-used entry.
   */
  _evictLRU() {
    // Map maintains insertion order; first entry is LRU since get/set re-inserts
    const firstKey = this._store.keys().next().value;
    if (firstKey) {
      this._store.delete(firstKey);
      this._evictions += 1;
    }
  }

  /**
   * Start a periodic background cleanup interval.
   */
  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this.sweep();
    }, CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer && this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }
}

module.exports = { RequestCache };
