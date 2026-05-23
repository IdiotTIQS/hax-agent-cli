"use strict";

/**
 * CachePreloader — intelligent cache preloading based on usage patterns.
 *
 * Learns access patterns from sessions, predicts which keys are likely to
 * be needed soon, and proactively warms the cache.  Supports scheduled
 * recurring preloads.
 */

const { parseInterval } = require("./manager");

const DEFAULTS = {
  minConfidence: 0.3,
  maxSuggestions: 20,
  decayFactor: 0.95,
  lookbackWindowMs: 30 * 60 * 1000, // 30 minutes
  minAccessCount: 2,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// ── CachePreloader ───────────────────────────────────────────────────────────

class CachePreloader {
  /**
   * @param {import("./manager").CacheManager} cacheManager - The CacheManager to preload into.
   * @param {object} [options]
   * @param {number} [options.minConfidence=0.3]     Minimum score to suggest a key.
   * @param {number} [options.maxSuggestions=20]      Max number of suggestions.
   * @param {number} [options.decayFactor=0.95]       Decay factor for aging access scores.
   * @param {number} [options.lookbackWindowMs=1800000]  Look-back window for relevance.
   * @param {number} [options.minAccessCount=2]       Min accesses before suggesting.
   */
  constructor(cacheManager, options = {}) {
    if (!cacheManager || typeof cacheManager.get !== "function") {
      throw new TypeError("CachePreloader requires a CacheManager instance.");
    }

    this._cache = cacheManager;

    this._minConfidence = Number.isFinite(options.minConfidence) ? options.minConfidence : DEFAULTS.minConfidence;
    this._maxSuggestions = normalizeInt(options.maxSuggestions, DEFAULTS.maxSuggestions, 1, 500);
    this._decayFactor = Number.isFinite(options.decayFactor) && options.decayFactor > 0 && options.decayFactor <= 1
      ? options.decayFactor : DEFAULTS.decayFactor;
    this._lookbackWindowMs = normalizeInt(options.lookbackWindowMs, DEFAULTS.lookbackWindowMs, 1000, 86400000);
    this._minAccessCount = normalizeInt(options.minAccessCount, DEFAULTS.minAccessCount, 1, 100);

    // key -> { score, count, lastAccess, timestamps[], tags }
    /** @type {Map<string, { score: number, count: number, lastAccess: number, timestamps: number[], tags: string[] }>} */
    this._patterns = new Map();

    // Preloading state
    /** @type {Map<string, number>} key -> last preload timestamp */
    this._preloadState = new Map();
    /** @type {Set<string>} keys currently being preloaded */
    this._activePreloads = new Set();

    // Scheduler state
    /** @type {Array<{ id: number, intervalMs: number, patterns: Array<string|RegExp> }>} */
    this._schedules = [];
    /** @type {Map<string, number>} key -> last preload timestamp */
    this._lastPreloadTimes = new Map();
    /** @type {number|null} */
    this._stats = {
      totalPreloads: 0,
      totalSuggestions: 0,
      totalLearned: 0,
      hitPreloads: 0,
      missedPreloads: 0,
    };
  }

  // ── Learning ──────────────────────────────────────────────────────────────

  /**
   * Learn from session access data to build usage patterns.
   *
   * @param {Array<object>} sessions - Session objects.
   *   Each session should have a `keys` property (array of keys accessed) or
   *   be an array of keys directly.
   */
  learn(sessions) {
    if (!Array.isArray(sessions)) {
      throw new TypeError("learn() expects an array of sessions.");
    }

    const now = Date.now();
    const cutoff = now - this._lookbackWindowMs;
    let learned = 0;

    for (const session of sessions) {
      const keys = Array.isArray(session.keys) ? session.keys
        : Array.isArray(session) ? session
        : [];

      const sessionTime = session.timestamp || session.time || now;

      for (const key of keys) {
        if (typeof key !== "string" || key.trim().length === 0) continue;

        const existing = this._patterns.get(key);

        if (existing) {
          // Decay old score before adding new
          const timeSinceLast = sessionTime - existing.lastAccess;
          if (timeSinceLast > 0) {
            const decayPeriods = Math.floor(timeSinceLast / this._lookbackWindowMs);
            existing.score *= Math.pow(this._decayFactor, decayPeriods);
          }

          existing.count += 1;
          existing.score += 1.0;
          // Use sessionTime directly — callers should pass sessions in
          // chronological order.  When sessions are replayed, the most recent
          // session sets the lastAccess for decay calculations.
          existing.lastAccess = sessionTime;
          existing.timestamps.push(sessionTime);

          // Keep only recent timestamps
          while (existing.timestamps.length > 0 && existing.timestamps[0] < cutoff) {
            existing.timestamps.shift();
          }
        } else {
          this._patterns.set(key, {
            score: 1.0,
            count: 1,
            lastAccess: sessionTime,
            timestamps: [sessionTime],
            tags: session.tags || [],
          });
        }

        learned += 1;
      }
    }

    // Apply global decay
    this._applyDecay(now);

    this._stats.totalLearned += learned;
    return learned;
  }

  /**
   * Record a single access to improve prediction accuracy.
   * @param {string} key - The cache key that was accessed.
   * @param {object} [meta] - Optional metadata.
   * @param {string[]} [meta.tags] - Tags associated with the access.
   */
  recordAccess(key, meta = {}) {
    if (typeof key !== "string" || key.trim().length === 0) return;

    const now = Date.now();
    const existing = this._patterns.get(key);

    if (existing) {
      existing.count += 1;
      existing.score += 1.0;
      existing.lastAccess = now;
      existing.timestamps.push(now);
      if (meta.tags && meta.tags.length > 0) {
        existing.tags = [...new Set([...existing.tags, ...meta.tags])];
      }
    } else {
      this._patterns.set(key, {
        score: 1.0,
        count: 1,
        lastAccess: now,
        timestamps: [now],
        tags: meta.tags || [],
      });
    }

    // If this key was previously preloaded, track hit/miss
    if (this._preloadState.has(key)) {
      const preloadedAt = this._preloadState.get(key);
      if (now - preloadedAt < this._lookbackWindowMs) {
        this._stats.hitPreloads += 1;
      }
      this._preloadState.delete(key);
    }
  }

  // ── Preloading ────────────────────────────────────────────────────────────

  /**
   * Preload keys matching the given patterns into the cache.
   *
   * Patterns can be:
   *   - string:  preload exact key or prefix match (key starts with pattern)
   *   - RegExp:  preload keys matching the regex
   *
   * @param {Array<string|RegExp>|string|RegExp} patterns - Patterns to preload.
   * @returns {Promise<{ warmed: number, missed: number, skipped: number }>}
   */
  async preload(patterns) {
    const patternList = Array.isArray(patterns) ? patterns : [patterns];
    if (patternList.length === 0) return { warmed: 0, missed: 0, skipped: 0 };

    // Collect candidate keys from learned patterns
    const candidates = new Set();
    const now = Date.now();

    for (const pattern of patternList) {
      const isString = typeof pattern === "string";

      for (const [key, info] of this._patterns) {
        // Skip if already being preloaded (warm() handles L1-skip internally)
        if (this._activePreloads.has(key)) continue;

        let matches = false;
        if (isString) {
          matches = key === pattern || key.startsWith(pattern);
        } else if (pattern instanceof RegExp) {
          matches = pattern.test(key);
        }

        if (matches && info.score >= this._minConfidence) {
          candidates.add(key);
        }
      }
    }

    // Sort by score (descending) and limit
    const sorted = [...candidates]
      .map((key) => ({ key, score: this._patterns.get(key).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, this._maxSuggestions)
      .map((e) => e.key);

    // Mark as active and preload
    for (const key of sorted) {
      this._activePreloads.add(key);
      this._preloadState.set(key, now);
    }

    const result = await this._cache.warm(sorted);

    // Clean up active tracking
    for (const key of sorted) {
      this._activePreloads.delete(key);
    }

    const skipped = candidates.size - sorted.length;
    this._stats.totalPreloads += result.warmed;
    this._stats.missedPreloads += result.missed;

    return { ...result, skipped };
  }

  // ── Suggestions ───────────────────────────────────────────────────────────

  /**
   * Get a ranked list of keys that would be beneficial to preload.
   *
   * @param {object} [options]
   * @param {number} [options.limit]       Max suggestions to return.
   * @param {number} [options.minScore]    Minimum score threshold.
   * @returns {Array<{ key: string, score: number, count: number, lastAccess: number, recency: number }>}
   */
  getPreloadSuggestions(options = {}) {
    const limit = normalizeInt(options.limit, this._maxSuggestions, 1, 500);
    const minScore = Number.isFinite(options.minScore) ? options.minScore : this._minConfidence;
    const now = Date.now();

    this._applyDecay(now);

    const suggestions = [];

    for (const [key, info] of this._patterns) {
      // Skip keys already in cache
      if (this._cache.has(key)) continue;
      // Skip keys with too few accesses
      if (info.count < this._minAccessCount) continue;
      // Skip low-confidence entries
      if (info.score < minScore) continue;

      // Calculate recency score (how recently was it accessed in the window)
      const recentCount = info.timestamps.filter((t) => now - t <= this._lookbackWindowMs).length;
      const recency = recentCount / Math.max(info.count, 1);

      suggestions.push({
        key,
        score: Math.round(info.score * 100) / 100,
        count: info.count,
        lastAccess: info.lastAccess,
        recency: Math.round(recency * 100) / 100,
      });
    }

    // Sort by score descending, then recency
    suggestions.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.recency - a.recency;
    });

    this._stats.totalSuggestions += suggestions.length;

    return suggestions.slice(0, limit);
  }

  // ── Scheduled Preloading ──────────────────────────────────────────────────

  /**
   * Schedule recurring preloading.
   *
   * @param {string|number} interval - Interval as number (ms) or string ("5m", "1h", "30s", "500ms").
   * @param {Array<string|RegExp>|string|RegExp} patterns - Patterns to preload on each tick.
   * @returns {{ cancel: () => void }} Controller to cancel the schedule.
   */
  schedulePreload(interval, patterns) {
    const intervalMs = parseInterval(interval);
    if (!intervalMs || intervalMs < 100) {
      throw new TypeError(`Invalid preload interval: ${interval}. Use a number (ms) or string like "5m", "1h", "30s".`);
    }

    const id = this._schedules.length;
    const schedule = { id, intervalMs, patterns };
    this._schedules.push(schedule);

    // Run immediately on first tick? No, wait for first interval.
    const timer = setInterval(() => {
      this.preload(schedule.patterns).catch(() => {
        // Preload failures are non-fatal
      });
    }, intervalMs);

    if (timer && timer.unref) {
      timer.unref();
    }

    schedule._timer = timer;

    return {
      cancel: () => {
        clearInterval(timer);
        const idx = this._schedules.findIndex((s) => s.id === id);
        if (idx >= 0) this._schedules.splice(idx, 1);
      },
    };
  }

  /**
   * Cancel all scheduled preloads.
   */
  cancelAll() {
    for (const schedule of this._schedules) {
      if (schedule._timer) clearInterval(schedule._timer);
    }
    this._schedules = [];
  }

  // ── Pattern Management ───────────────────────────────────────────────────

  /**
   * Reset all learned patterns.
   */
  reset() {
    this._patterns.clear();
    this._preloadState.clear();
    this._stats = {
      totalPreloads: 0,
      totalSuggestions: 0,
      totalLearned: 0,
      hitPreloads: 0,
      missedPreloads: 0,
    };
  }

  /**
   * Get statistics about the preloader.
   * @returns {object}
   */
  getStats() {
    this._applyDecay(Date.now());
    const activeSchedules = this._schedules.length;
    const patternCount = this._patterns.size;
    const totalAccesses = [...this._patterns.values()].reduce((sum, p) => sum + p.count, 0);
    const avgScore = patternCount > 0
      ? [...this._patterns.values()].reduce((sum, p) => sum + p.score, 0) / patternCount
      : 0;

    let preloadHitRate = 0;
    const total = this._stats.hitPreloads + this._stats.missedPreloads;
    if (total > 0) {
      preloadHitRate = this._stats.hitPreloads / total;
    }

    return {
      ...this._stats,
      patternCount,
      totalAccesses,
      avgScore: Math.round(avgScore * 100) / 100,
      preloadHitRate: Math.round(preloadHitRate * 100) / 100,
      activeSchedules,
      minConfidence: this._minConfidence,
      maxSuggestions: this._maxSuggestions,
    };
  }

  /**
   * Get all known patterns (keys and their metadata).
   * @returns {Map<string, object>}
   */
  getPatterns() {
    return new Map(this._patterns);
  }

  /**
   * Remove a specific pattern so it is no longer considered for preloading.
   * @param {string} key
   */
  forget(key) {
    this._patterns.delete(key);
    this._preloadState.delete(key);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Apply time-based decay to all pattern scores.
   */
  _applyDecay(now) {
    for (const [key, info] of this._patterns) {
      const timeSinceLast = now - info.lastAccess;
      if (timeSinceLast > this._lookbackWindowMs) {
        const decayPeriods = Math.floor(timeSinceLast / this._lookbackWindowMs);
        info.score *= Math.pow(this._decayFactor, Math.min(decayPeriods, 20));
        // Remove very low-score patterns
        if (info.score < 0.01) {
          this._patterns.delete(key);
        }
      }
    }
  }

  /**
   * Clean up stale patterns and preload state.
   */
  _gc() {
    const now = Date.now();
    const cutoff = now - this._lookbackWindowMs * 5;

    for (const [key, info] of this._patterns) {
      if (info.lastAccess < cutoff && info.score < 0.05) {
        this._patterns.delete(key);
      }
    }

    for (const [key, ts] of this._preloadState) {
      if (now - ts > this._lookbackWindowMs) {
        this._preloadState.delete(key);
      }
    }
  }
}

module.exports = { CachePreloader, DEFAULTS };
