"use strict";

/**
 * SkillMetrics — tracks skill invocation performance including success rate,
 * duration, and user satisfaction. Maintains in-memory rolling window for
 * trend analysis.
 */

// ── Constants ───────────────────────────────────────────────────────────────
const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_HISTORY_PER_SKILL = 500;

// ── Constructor ─────────────────────────────────────────────────────────────

class SkillMetrics {
  /**
   * @param {object} [options]
   * @param {number}  [options.trendWindowMs=604800000] — trend window in ms (default 7 days)
   * @param {boolean} [options.persist=false] — if true, stats survive instance destruction (stub)
   */
  constructor(options = {}) {
    this._trendWindowMs = options.trendWindowMs || TREND_WINDOW_MS;
    this._persist = Boolean(options.persist);

    /**
     * Per-skill stats accumulator.
     * Map<skillName, { count, successCount, failCount, totalDuration, recentDurations, ratings, lastUsedAt, history }>
     */
    /** @type {Map<string, object>} */
    this._stats = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Record a skill invocation.
   *
   * @param {string} skill — skill name
   * @param {object} result
   * @param {boolean} [result.success=true] — whether the invocation succeeded
   * @param {number}  [result.duration] — duration in ms
   * @param {number}  [result.satisfaction] — user satisfaction rating (1–5, optional)
   */
  recordUsage(skill, result = {}) {
    if (!skill) return;

    const {
      success = true,
      duration = 0,
      satisfaction = null,
    } = result;

    const now = Date.now();

    // Init or retrieve stats
    let entry = this._stats.get(skill);
    if (!entry) {
      entry = {
        count: 0,
        successCount: 0,
        failCount: 0,
        totalDuration: 0,
        recentDurations: [],
        ratings: [],
        lastUsedAt: null,
        history: [],
      };
      this._stats.set(skill, entry);
    }

    // Update counters
    entry.count += 1;
    if (success) {
      entry.successCount += 1;
    } else {
      entry.failCount += 1;
    }
    entry.totalDuration += duration;
    entry.lastUsedAt = now;

    // Track recent durations (rolling window)
    if (duration > 0) {
      entry.recentDurations.push(duration);
      if (entry.recentDurations.length > MAX_HISTORY_PER_SKILL) {
        entry.recentDurations.shift();
      }
    }

    // Track satisfaction ratings
    if (typeof satisfaction === 'number' && satisfaction >= 1 && satisfaction <= 5) {
      entry.ratings.push(satisfaction);
      if (entry.ratings.length > MAX_HISTORY_PER_SKILL) {
        entry.ratings.shift();
      }
    }

    // Append to history (timestamped record)
    entry.history.push({ ts: now, success, duration, satisfaction });
    if (entry.history.length > MAX_HISTORY_PER_SKILL) {
      entry.history.shift();
    }
  }

  /**
   * Get detailed stats for a specific skill.
   *
   * @param {string} skill — skill name
   * @returns {{
   *   invocationCount: number,
   *   successRate: number,
   *   failRate: number,
   *   avgDuration: number,
   *   p50Duration: number,
   *   p95Duration: number,
   *   avgSatisfaction: number|null,
   *   lastUsedAt: number|null,
   *   recentCount: number,
   * }}
   */
  getStats(skill) {
    const entry = this._stats.get(skill);
    if (!entry) {
      return {
        invocationCount: 0,
        successRate: 0,
        failRate: 0,
        avgDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        avgSatisfaction: null,
        lastUsedAt: null,
        recentCount: 0,
      };
    }

    const total = entry.count || 1;
    const successRate = entry.count > 0
      ? Math.round((entry.successCount / entry.count) * 1000) / 1000
      : 0;

    // Duration percentiles from recentDurations
    let avgDuration = 0;
    let p50Duration = 0;
    let p95Duration = 0;
    if (entry.recentDurations.length > 0) {
      const sorted = [...entry.recentDurations].sort((a, b) => a - b);
      avgDuration = Math.round(entry.totalDuration / entry.count);
      p50Duration = this._percentile(sorted, 50);
      p95Duration = this._percentile(sorted, 95);
    }

    // Average satisfaction
    let avgSatisfaction = null;
    if (entry.ratings.length > 0) {
      avgSatisfaction =
        Math.round(
          (entry.ratings.reduce((a, b) => a + b, 0) / entry.ratings.length) * 100
        ) / 100;
    }

    // Recent invocations (within trend window)
    const cutoff = Date.now() - this._trendWindowMs;
    const recentCount = entry.history.filter((h) => h.ts >= cutoff).length;

    return {
      invocationCount: entry.count,
      successRate,
      failRate: Math.round((1 - successRate) * 1000) / 1000,
      avgDuration,
      p50Duration,
      p95Duration,
      avgSatisfaction,
      lastUsedAt: entry.lastUsedAt,
      recentCount,
    };
  }

  /**
   * Get the top performing skills, optionally filtered by category tag.
   *
   * @param {string} [category] — optional tag to filter by (searches available skill tags)
   * @param {object} [options]
   * @param {number} [options.limit=10] — max results
   * @param {'successRate'|'invocationCount'|'avgSatisfaction'|'avgDuration'} [options.sortBy='successRate']
   * @returns {Array<{ skill: string, stats: object }>}
   */
  getTopSkills(category = null, options = {}) {
    const { limit = 10, sortBy = 'successRate' } = options;

    const entries = [];
    for (const [skill, entry] of this._stats) {
      entries.push({ skill, stats: this.getStats(skill), _entry: entry });
    }

    const sortFns = {
      successRate: (a, b) => b.stats.successRate - a.stats.successRate,
      invocationCount: (a, b) => b.stats.invocationCount - a.stats.invocationCount,
      avgSatisfaction: (a, b) =>
        (b.stats.avgSatisfaction || 0) - (a.stats.avgSatisfaction || 0),
      avgDuration: (a, b) => a.stats.avgDuration - b.stats.avgDuration || 0,
    };

    const sorter = sortFns[sortBy] || sortFns.successRate;
    entries.sort(sorter);

    return entries.slice(0, limit).map(({ skill, stats }) => ({ skill, stats }));
  }

  /**
   * Get usage trends over time (aggregate stats per day within the trend window).
   *
   * @returns {{
   *   dailyUsage: Array<{ date: string, totalInvocations: number, uniqueSkills: number }>,
   *   overallTrend: 'rising'|'falling'|'stable'|'no-data',
   *   topGrowingSkills: Array<{ skill: string, growth: number }>,
   * }}
   */
  getTrends() {
    const now = Date.now();
    const cutoff = now - this._trendWindowMs;

    // Collect all history events within the window, bucketed by day
    const dayBuckets = new Map(); // dateString → { total, skills: Set }
    const skillGrowth = new Map(); // skillName → growth count (recent invocations)

    for (const [skill, entry] of this._stats) {
      let skillRecentCount = 0;
      for (const h of entry.history) {
        if (h.ts >= cutoff) {
          const dateKey = this._formatDate(new Date(h.ts));
          const bucket = dayBuckets.get(dateKey) || { total: 0, skills: new Set() };
          bucket.total += 1;
          bucket.skills.add(skill);
          dayBuckets.set(dateKey, bucket);

          skillRecentCount += 1;
        }
      }
      if (skillRecentCount > 0) {
        skillGrowth.set(skill, skillRecentCount);
      }
    }

    // Build daily usage array sorted by date
    const dailyUsage = [];
    for (const [date, bucket] of dayBuckets) {
      dailyUsage.push({
        date,
        totalInvocations: bucket.total,
        uniqueSkills: bucket.skills.size,
      });
    }
    dailyUsage.sort((a, b) => a.date.localeCompare(b.date));

    // Determine overall trend
    let overallTrend = 'no-data';
    if (dailyUsage.length >= 2) {
      const firstHalf = dailyUsage.slice(0, Math.floor(dailyUsage.length / 2));
      const secondHalf = dailyUsage.slice(Math.floor(dailyUsage.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d.totalInvocations, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d.totalInvocations, 0) / secondHalf.length;

      if (secondAvg > firstAvg * 1.1) {
        overallTrend = 'rising';
      } else if (secondAvg < firstAvg * 0.9) {
        overallTrend = 'falling';
      } else {
        overallTrend = 'stable';
      }
    } else if (dailyUsage.length === 1) {
      overallTrend = 'stable';
    }

    // Top growing skills
    const topGrowingSkills = [...skillGrowth.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill, growth]) => ({ skill, growth }));

    return { dailyUsage, overallTrend, topGrowingSkills };
  }

  /**
   * Reset all metrics (useful for testing).
   */
  reset() {
    this._stats.clear();
  }

  /**
   * Get all tracked skill names.
   * @returns {Array<string>}
   */
  getTrackedSkills() {
    return [...this._stats.keys()];
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** @private Calculate a percentile from a sorted array of numbers. */
  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  /** @private Format a Date to YYYY-MM-DD. */
  _formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

// ── Convenience exports ─────────────────────────────────────────────────────

/**
 * Create a default metrics tracker.
 */
function createMetrics(options) {
  return new SkillMetrics(options);
}

module.exports = {
  SkillMetrics,
  createMetrics,
};
