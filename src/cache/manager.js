"use strict";

/**
 * CacheManager — unified multi-level cache for agent operations.
 *
 * Levels (fastest to slowest):
 *   L1 — in-memory, fast, volatile
 *   L2 — disk-based, persistent across restarts
 *   L3 — remote (pluggable adapter), shared across instances
 *
 * On get, the fastest available level is consulted first.  On a hit from a
 * slower level the value is promoted to faster levels.  Eviction is LRU with
 * configurable max sizes per level.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CACHE_LEVELS = Object.freeze({
  L1: "memory",
  L2: "disk",
  L3: "remote",
});

const LEVEL_ORDER = [CACHE_LEVELS.L1, CACHE_LEVELS.L2, CACHE_LEVELS.L3];

const DEFAULTS = {
  l1MaxSize: 1000,
  l2MaxSize: 500,
  l3MaxSize: 200,
  defaultTTL: 5 * 60 * 1000,
  diskDir: null,
  cleanupInterval: 60 * 1000,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 16);
}

function clone(value) {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    return value;
  }
}

function parseInterval(str) {
  if (typeof str === "number") return normalizeInt(str, 60000, 1000, 86400000);
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^(\d+)\s*(ms|s|m|h)$/i);
  if (!m) return null;
  const val = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "ms": return val;
    case "s": return val * 1000;
    case "m": return val * 60 * 1000;
    case "h": return val * 3600 * 1000;
    default: return null;
  }
}

/**
 * Resolve a level specifier to its canonical value.
 * Accepts both key form ("L1", "L2", "L3") and value form ("memory", "disk", "remote").
 * @param {string|undefined} raw
 * @returns {string}
 */
function resolveLevel(raw) {
  if (!raw) return CACHE_LEVELS.L1;
  if (CACHE_LEVELS[raw]) return CACHE_LEVELS[raw];
  if (raw === "memory" || raw === CACHE_LEVELS.L1) return CACHE_LEVELS.L1;
  if (raw === "disk" || raw === CACHE_LEVELS.L2) return CACHE_LEVELS.L2;
  if (raw === "remote" || raw === CACHE_LEVELS.L3) return CACHE_LEVELS.L3;
  return CACHE_LEVELS.L1;
}

/**
 * Compute effective TTL and expiry timestamp.
 * ttl === 0 → no expiry. ttl === undefined/null/NaN → use defaultTTL.
 * @param {number|undefined|null} ttl
 * @param {number} defaultTTL
 * @returns {{ effectiveTTL: number, expiresAt: number }}
 */
function computeExpiry(ttl, defaultTTL) {
  if (ttl === 0) return { effectiveTTL: 0, expiresAt: 0 };
  const effectiveTTL = Number.isFinite(ttl) && ttl > 0 ? ttl : defaultTTL;
  const expiresAt = effectiveTTL > 0 ? Date.now() + effectiveTTL : 0;
  return { effectiveTTL, expiresAt };
}

// ── CacheError ───────────────────────────────────────────────────────────────

class CacheError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CacheError";
    this.code = String(code);
  }
}

// ── CacheManager ─────────────────────────────────────────────────────────────

class CacheManager {
  /**
   * @param {object} [options]
   * @param {number} [options.l1MaxSize=1000]       Max entries in L1 (memory).
   * @param {number} [options.l2MaxSize=500]        Max entries in L2 (disk).
   * @param {number} [options.l3MaxSize=200]        Max entries tracked for L3.
   * @param {number} [options.defaultTTL=300000]    Default TTL in ms (5 min).
   * @param {string} [options.diskDir]              Path for L2 storage files.
   * @param {object} [options.remoteAdapter]        L3 adapter instance.
   * @param {boolean} [options.backgroundCleanup]   Enable periodic TTL sweep.
   * @param {number} [options.cleanupInterval]      Interval for background sweep.
   */
  constructor(options = {}) {
    // ── L1: in-memory ──────────────────────────────────────────────────
    this._l1 = new Map();
    this._l1MaxSize = normalizeInt(options.l1MaxSize, DEFAULTS.l1MaxSize, 1, 100000);
    this._l1Order = new Map(); // key -> sequence number for LRU

    // ── L2: disk ───────────────────────────────────────────────────────
    this._l2MaxSize = normalizeInt(options.l2MaxSize, DEFAULTS.l2MaxSize, 1, 50000);
    this._l2Dir = options.diskDir || path.join(os.tmpdir(), "hax-cache-l2-" + Date.now().toString(36));
    this._l2Index = new Map(); // key -> { file, expiresAt, size }
    this._l2Order = new Map();
    this._ensureDiskDir();
    this._rebuildL2Index(); // recover existing disk entries

    // ── L3: remote ─────────────────────────────────────────────────────
    this._l3MaxSize = normalizeInt(options.l3MaxSize, DEFAULTS.l3MaxSize, 1, 50000);
    this._l3Adapter = options.remoteAdapter || null;

    // ── config ─────────────────────────────────────────────────────────
    this._defaultTTL = normalizeInt(options.defaultTTL, DEFAULTS.defaultTTL, 0, 7 * 86400000);
    this._seq = 0;

    // ── statistics ─────────────────────────────────────────────────────
    this._stats = {
      l1: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      l2: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      l3: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      invalidations: 0,
      promotions: 0,
    };

    // ── background cleanup ─────────────────────────────────────────────
    this._cleanupTimer = null;
    if (options.backgroundCleanup !== false) {
      const interval = normalizeInt(
        options.cleanupInterval, DEFAULTS.cleanupInterval, 1000, 3600000
      );
      this._startCleanup(interval);
    }
  }

  // ── sequence ──────────────────────────────────────────────────────────────

  _nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  // ── key hashing ──────────────────────────────────────────────────────────

  _fileForKey(key) {
    return path.join(this._l2Dir, hashKey(key) + ".json");
  }

  // ── L1 operations ────────────────────────────────────────────────────────

  _l1Get(key) {
    const raw = this._l1.get(key);
    if (!raw) return undefined;

    if (raw.expiresAt > 0 && Date.now() > raw.expiresAt) {
      this._l1.delete(key);
      this._l1Order.delete(key);
      this._stats.l1.evictions += 1;
      return undefined;
    }

    // Update LRU order
    this._l1Order.set(key, this._nextSeq());
    return raw.value;
  }

  _l1Set(key, value, ttl) {
    const { expiresAt } = computeExpiry(ttl, this._defaultTTL);

    if (this._l1.has(key)) {
      this._l1Order.set(key, this._nextSeq());
      const entry = this._l1.get(key);
      entry.value = value;
      entry.expiresAt = expiresAt;
    } else {
      if (this._l1.size >= this._l1MaxSize) {
        this._evictL1();
      }
      this._l1.set(key, { value, expiresAt });
      this._l1Order.set(key, this._nextSeq());
    }
    this._stats.l1.sets += 1;
  }

  _l1Delete(key) {
    const existed = this._l1.delete(key);
    this._l1Order.delete(key);
    return existed;
  }

  _evictL1() {
    let oldestKey = null;
    let oldestSeq = Infinity;
    for (const [k, seq] of this._l1Order) {
      if (seq < oldestSeq) {
        oldestSeq = seq;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      this._l1.delete(oldestKey);
      this._l1Order.delete(oldestKey);
      this._stats.l1.evictions += 1;
    }
  }

  // ── L2 operations ────────────────────────────────────────────────────────

  _l2Get(key) {
    const idx = this._l2Index.get(key);
    if (!idx) {
      this._stats.l2.misses += 1;
      return undefined;
    }

    if (idx.expiresAt > 0 && Date.now() > idx.expiresAt) {
      this._l2Delete(key);
      this._stats.l2.misses += 1;
      return undefined;
    }

    try {
      const raw = fs.readFileSync(idx.file, "utf8");
      const entry = JSON.parse(raw);
      this._l2Order.set(key, this._nextSeq());
      this._stats.l2.hits += 1;
      return entry.value;
    } catch (_e) {
      this._l2Delete(key);
      this._stats.l2.misses += 1;
      return undefined;
    }
  }

  _l2Set(key, value, ttl) {
    const { expiresAt } = computeExpiry(ttl, this._defaultTTL);
    const file = this._fileForKey(key);

    try {
      const payload = JSON.stringify({ key, value, expiresAt, createdAt: Date.now() });
      fs.writeFileSync(file, payload, "utf8");
    } catch (_e) {
      throw new CacheError("L2_WRITE_FAILED", `Failed to write L2 cache entry for key: ${key}`);
    }

    if (!this._l2Index.has(key) && this._l2Index.size >= this._l2MaxSize) {
      this._evictL2();
    }

    this._l2Index.set(key, { file, expiresAt, size: Buffer.byteLength(JSON.stringify(value), "utf8") });
    this._l2Order.set(key, this._nextSeq());
    this._stats.l2.sets += 1;
  }

  _l2Delete(key) {
    const idx = this._l2Index.get(key);
    if (idx) {
      try { fs.unlinkSync(idx.file); } catch (_e) { /* ignore */ }
      this._l2Index.delete(key);
      this._l2Order.delete(key);
      this._stats.l2.evictions += 1;
    }
  }

  _evictL2() {
    let oldestKey = null;
    let oldestSeq = Infinity;
    for (const [k, seq] of this._l2Order) {
      if (seq < oldestSeq) {
        oldestSeq = seq;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      this._l2Delete(oldestKey);
    }
  }

  _ensureDiskDir() {
    try {
      if (!fs.existsSync(this._l2Dir)) {
        fs.mkdirSync(this._l2Dir, { recursive: true });
      }
    } catch (_e) {
      throw new CacheError("L2_DIR_FAILED", `Cannot create L2 cache directory: ${this._l2Dir}`);
    }
  }

  /**
   * Scan the L2 disk directory and rebuild the in-memory index
   * so entries written by a previous instance are discoverable.
   */
  _rebuildL2Index() {
    try {
      const files = fs.readdirSync(this._l2Dir);
      for (const name of files) {
        if (!name.endsWith(".json")) continue;
        const filePath = path.join(this._l2Dir, name);
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const entry = JSON.parse(raw);
          const key = entry.key;
          if (!key || typeof key !== "string") continue;

          // Skip expired entries
          if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
            try { fs.unlinkSync(filePath); } catch (_e) { /* ignore */ }
            continue;
          }

          const size = Buffer.byteLength(raw, "utf8");
          this._l2Index.set(key, { file: filePath, expiresAt: entry.expiresAt || 0, size });
          this._l2Order.set(key, this._nextSeq());
        } catch (_e) {
          // Corrupt file — remove it
          try { fs.unlinkSync(filePath); } catch (_e2) { /* ignore */ }
        }
      }
    } catch (_e) {
      // Directory may not exist or be unreadable — non-fatal
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Retrieve a cached value by key.
   * Checks L1 first, then L2.  On a slower-level hit the value is promoted
   * to L1.  For L3 lookups use `getAsync()`.
   *
   * @param {string} key
   * @returns {*|undefined} cached value or undefined on miss.
   */
  get(key) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new CacheError("INVALID_KEY", "Cache key must be a non-empty string.");
    }

    // Level 1: memory
    let value = this._l1Get(key);
    if (value !== undefined) {
      this._stats.l1.hits += 1;
      return clone(value);
    }
    this._stats.l1.misses += 1;

    // Level 2: disk
    value = this._l2Get(key);
    if (value !== undefined) {
      // Promote to L1
      const idx = this._l2Index.get(key);
      const ttl = idx && idx.expiresAt > 0 ? idx.expiresAt - Date.now() : this._defaultTTL;
      this._l1Set(key, value, ttl);
      this._stats.promotions += 1;
      return clone(value);
    }

    return undefined;
  }

  /**
   * Async version that also checks L3 (remote) when an adapter is configured.
   * @param {string} key
   * @returns {Promise<*|undefined>}
   */
  async getAsync(key) {
    // Try L1+L2 synchronously first
    const local = this.get(key);
    if (local !== undefined) return local;

    // Level 3: remote
    if (!this._l3Adapter || typeof this._l3Adapter.get !== "function") {
      this._stats.l3.misses += 1;
      return undefined;
    }

    try {
      const remoteValue = await this._l3Adapter.get(key);
      if (remoteValue !== undefined && remoteValue !== null) {
        this._stats.l3.hits += 1;
        // Promote to L2 and L1
        this._l2Set(key, remoteValue);
        this._l1Set(key, remoteValue);
        this._stats.promotions += 2;
        return clone(remoteValue);
      }
    } catch (_e) {
      // Remote failure is a miss, not an error for the caller
    }

    this._stats.l3.misses += 1;
    return undefined;
  }

  /**
   * Store a value in the cache.
   *
   * @param {string} key
   * @param {*} value
   * @param {object} [options]
   * @param {number} [options.ttl]          TTL in ms (default: 5 min, 0 = no expiry).
   * @param {'memory'|'disk'|'remote'} [options.level='memory']  Minimum persistence level.
   * @param {string[]} [options.tags]       Tags for invalidation grouping.
   * @returns {this}
   */
  set(key, value, options = {}) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new CacheError("INVALID_KEY", "Cache key must be a non-empty string.");
    }

    const level = resolveLevel(options.level);
    const ttl = normalizeInt(options.ttl, this._defaultTTL, 0, 7 * 86400000);
    const tags = Array.isArray(options.tags) ? options.tags : [];

    // Store at the requested level (not always in L1 — slower levels
    // are promoted to L1 only on access, via get/warm).
    if (level === CACHE_LEVELS.L1) {
      this._l1Set(key, value, ttl);
    } else if (level === CACHE_LEVELS.L2) {
      this._l2Set(key, value, ttl);
    } else if (level === CACHE_LEVELS.L3) {
      this._l2Set(key, value, ttl);
      this._stats.l3.sets += 1;
    }

    // Attach tags (stored as metadata on the L1 entry, if present)
    if (tags.length > 0) {
      const l1Entry = this._l1.get(key);
      if (l1Entry) {
        l1Entry.tags = tags;
      }
    }

    return this;
  }

  /**
   * Async version that also stores to L3 when an adapter is configured.
   * @param {string} key
   * @param {*} value
   * @param {object} [options]
   * @returns {Promise<this>}
   */
  async setAsync(key, value, options = {}) {
    this.set(key, value, options);

    if (this._l3Adapter && typeof this._l3Adapter.set === "function") {
      const ttl = normalizeInt(options.ttl, this._defaultTTL, 0, 7 * 86400000);
      try {
        await this._l3Adapter.set(key, value, ttl);
        this._stats.l3.sets += 1;
      } catch (_e) {
        // Remote write failure is non-fatal
      }
    }

    return this;
  }

  /**
   * Invalidate cache entries whose keys match a pattern.
   * Operates on L1 and L2 synchronously.
   *
   * @param {string|RegExp|object} pattern
   *   - string:  key includes the string (case-insensitive)
   *   - RegExp:  key matches the regex
   *   - object:  { key?, tag?, level? }
   * @returns {number} count of entries invalidated.
   */
  invalidate(pattern) {
    let removed = 0;

    // Determine matcher
    let matcher;
    if (typeof pattern === "string") {
      const lower = pattern.toLowerCase();
      matcher = (k) => k.toLowerCase().includes(lower);
    } else if (pattern instanceof RegExp) {
      matcher = (k) => pattern.test(k);
    } else if (pattern && typeof pattern === "object") {
      const inKey = pattern.key;
      const inTag = pattern.tag;
      const inLevel = pattern.level;
      matcher = (key) => {
        if (inKey !== undefined) {
          if (inKey instanceof RegExp) {
            if (!inKey.test(key)) return false;
          } else if (!key.toLowerCase().includes(String(inKey).toLowerCase())) {
            return false;
          }
        }
        if (inTag !== undefined) {
          const l1Entry = this._l1.get(key);
          const tags = l1Entry && l1Entry.tags ? l1Entry.tags : [];
          if (!tags.includes(inTag)) return false;
        }
        if (inLevel !== undefined) {
          // Check if key exists at the specified level
          const atLevel = inLevel === CACHE_LEVELS.L1 ? this._l1.has(key)
            : inLevel === CACHE_LEVELS.L2 ? this._l2Index.has(key)
            : false;
          if (!atLevel) return false;
        }
        return true;
      };
    } else {
      matcher = () => false;
    }

    // Invalidate L1
    for (const key of this._l1.keys()) {
      if (matcher(key)) {
        this._l1.delete(key);
        this._l1Order.delete(key);
        removed += 1;
      }
    }

    // Invalidate L2
    for (const key of this._l2Index.keys()) {
      if (matcher(key)) {
        this._l2Delete(key);
        removed += 1;
      }
    }

    this._stats.invalidations += removed;
    return removed;
  }

  /**
   * Async version that also invalidates L3 entries.
   * @param {string|RegExp|object} pattern
   * @returns {Promise<number>}
   */
  async invalidateAsync(pattern) {
    const localRemoved = this.invalidate(pattern);

    if (this._l3Adapter && typeof this._l3Adapter.delete === "function") {
      try {
        // Pass pattern info; adapter decides what to delete
        if (typeof pattern === "string") {
          await this._l3Adapter.delete(pattern);
        } else if (pattern instanceof RegExp) {
          await this._l3Adapter.delete(pattern.source);
        } else if (pattern && pattern.key) {
          await this._l3Adapter.delete(pattern.key);
        }
      } catch (_e) {
        // Non-fatal
      }
    }

    return localRemoved;
  }

  /**
   * Preload specified keys into faster levels.
   * For each key, attempts to load from the slowest available level and
   * promote to all faster levels so subsequent `get()` calls hit L1.
   *
   * @param {string[]} keys - Keys to warm.
   * @returns {Promise<{ warmed: number, missed: number }>}
   */
  async warm(keys) {
    if (!Array.isArray(keys)) {
      throw new CacheError("INVALID_ARGS", "warm() expects an array of keys.");
    }

    let warmed = 0;
    let missed = 0;
    let skipped = 0;

    for (const key of keys) {
      // Already in L1 — nothing to do
      if (this._l1Get(key) !== undefined) {
        skipped += 1;
        continue;
      }

      let value = undefined;

      // Try L2
      value = this._l2Get(key);
      if (value !== undefined) {
        this._l1Set(key, value);
        warmed += 1;
        continue;
      }

      // Try L3
      if (this._l3Adapter && typeof this._l3Adapter.get === "function") {
        try {
          value = await this._l3Adapter.get(key);
          if (value !== undefined && value !== null) {
            this._l2Set(key, value);
            this._l1Set(key, value);
            warmed += 1;
            continue;
          }
        } catch (_e) { /* continue to miss */ }
      }

      missed += 1;
    }

    return { warmed, missed, skipped };
  }

  /**
   * Return per-level cache statistics.
   * @returns {object}
   */
  getStats() {
    const l1Total = this._stats.l1.hits + this._stats.l1.misses;
    const l2Total = this._stats.l2.hits + this._stats.l2.misses;
    const l3Total = this._stats.l3.hits + this._stats.l3.misses;

    // Approximate memory sizes
    let l1SizeBytes = 0;
    for (const [, entry] of this._l1) {
      try { l1SizeBytes += JSON.stringify(entry.value).length; } catch (_e) { l1SizeBytes += 128; }
    }

    let l2SizeBytes = 0;
    for (const [, idx] of this._l2Index) {
      l2SizeBytes += idx.size || 256;
    }

    return {
      l1: {
        entries: this._l1.size,
        maxSize: this._l1MaxSize,
        hits: this._stats.l1.hits,
        misses: this._stats.l1.misses,
        hitRate: l1Total > 0 ? this._stats.l1.hits / l1Total : 0,
        sets: this._stats.l1.sets,
        evictions: this._stats.l1.evictions,
        sizeBytes: l1SizeBytes,
      },
      l2: {
        entries: this._l2Index.size,
        maxSize: this._l2MaxSize,
        hits: this._stats.l2.hits,
        misses: this._stats.l2.misses,
        hitRate: l2Total > 0 ? this._stats.l2.hits / l2Total : 0,
        sets: this._stats.l2.sets,
        evictions: this._stats.l2.evictions,
        sizeBytes: l2SizeBytes,
        directory: this._l2Dir,
      },
      l3: {
        entries: this._l3Adapter ? "external" : "none",
        maxSize: this._l3MaxSize,
        hits: this._stats.l3.hits,
        misses: this._stats.l3.misses,
        hitRate: l3Total > 0 ? this._stats.l3.hits / l3Total : 0,
        sets: this._stats.l3.sets,
        evictions: this._stats.l3.evictions,
        adapter: this._l3Adapter ? typeof this._l3Adapter.constructor.name === "string"
          ? this._l3Adapter.constructor.name : "custom" : null,
      },
      totalInvalidations: this._stats.invalidations,
      totalPromotions: this._stats.promotions,
      defaultTTL: this._defaultTTL,
    };
  }

  /**
   * Check whether a key exists (and is not expired) at any available level.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (typeof key !== "string" || key.trim().length === 0) return false;

    // Check L1
    const l1Val = this._l1Get(key);
    if (l1Val !== undefined) return true;

    // Check L2
    const idx = this._l2Index.get(key);
    if (idx) {
      if (idx.expiresAt > 0 && Date.now() > idx.expiresAt) return false;
      return true;
    }

    return false;
  }

  /**
   * Get the remaining TTL (ms) for a key at its fastest level.
   * Returns -1 if not found, 0 if it has no expiry, positive ms otherwise.
   * @param {string} key
   * @returns {number}
   */
  ttl(key) {
    const raw = this._l1.get(key);
    if (raw) {
      if (raw.expiresAt <= 0) return 0;
      const remaining = raw.expiresAt - Date.now();
      return remaining > 0 ? remaining : -1;
    }

    const idx = this._l2Index.get(key);
    if (idx) {
      if (idx.expiresAt <= 0) return 0;
      const remaining = idx.expiresAt - Date.now();
      return remaining > 0 ? remaining : -1;
    }

    return -1;
  }

  /**
   * Manually trigger a sweep of expired entries from L1 and L2.
   * @returns {number} count of entries removed.
   */
  sweep() {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this._l1) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this._l1.delete(key);
        this._l1Order.delete(key);
        count += 1;
      }
    }

    for (const [key, idx] of this._l2Index) {
      if (idx.expiresAt > 0 && now > idx.expiresAt) {
        try { fs.unlinkSync(idx.file); } catch (_e) { /* ignore */ }
        this._l2Index.delete(key);
        this._l2Order.delete(key);
        count += 1;
      }
    }

    return count;
  }

  /**
   * Clear all entries from all levels and reset statistics.
   */
  clear() {
    this._l1.clear();
    this._l1Order.clear();

    for (const idx of this._l2Index.values()) {
      try { fs.unlinkSync(idx.file); } catch (_e) { /* ignore */ }
    }
    this._l2Index.clear();
    this._l2Order.clear();

    this._stats = {
      l1: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      l2: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      l3: { hits: 0, misses: 0, sets: 0, evictions: 0 },
      invalidations: 0,
      promotions: 0,
    };
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

  // ── private: background cleanup ─────────────────────────────────────────

  _startCleanup(intervalMs) {
    this._cleanupTimer = setInterval(() => {
      this.sweep();
    }, intervalMs);
    if (this._cleanupTimer && this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }
}

module.exports = { CacheManager, CacheError, CACHE_LEVELS, parseInterval };
