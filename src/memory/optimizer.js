"use strict";

/**
 * Memory optimizer.
 *
 * Analyzes memory store efficiency, recommends and applies optimization
 * strategies, and tracks before/after statistics. Designed to work with
 * MemoryCompressor and MemoryArchiver to keep the memory system in peak
 * condition.
 */

const { MemoryCompressor, computeAge, estimateBytes } = require("./compressor");

const OPTIMIZATION_TARGETS = Object.freeze({
  SIZE: "size",
  RELEVANCE: "relevance",
  REDUNDANCY: "redundancy",
  AGE: "age",
});

const MAX_RECOMMENDATIONS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group memories by namespace.
 * @param {object[]} memories
 * @returns {Map<string, object[]>}
 */
function groupByNamespace(memories) {
  const map = new Map();
  for (const m of memories) {
    const ns = m.namespace || "default";
    if (!map.has(ns)) map.set(ns, []);
    map.get(ns).push(m);
  }
  return map;
}

/**
 * Count tags across all memories and return sorted frequency list.
 * @param {object[]} memories
 * @returns {{ tag: string, count: number }[]}
 */
function countTags(memories) {
  const counts = new Map();
  for (const m of memories) {
    const tags = Array.isArray(m.tags) ? m.tags : [];
    for (const tag of tags) {
      const key = String(tag).toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Compute median of an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// MemoryOptimizer
// ---------------------------------------------------------------------------

class MemoryOptimizer {
  /**
   * @param {object} [options]
   * @param {object} [options.compressorOptions] - Options forwarded to
   *   MemoryCompressor.
   * @param {number} [options.redundancyThreshold=0.7] - Similarity threshold
   *   for flagging redundant memories.
   * @param {number} [options.ageWarningMs=2592000000] - Age threshold (ms)
   *   for flagging memories as stale (default 30 days).
   * @param {number} [options.sizeWarningBytes=1048576] - Total size threshold
   *   (bytes) for flagging the memory store as too large (default 1 MB).
   */
  constructor(options = {}) {
    this.compressorOptions = options.compressorOptions || {};
    this.compressor = new MemoryCompressor(this.compressorOptions);

    this.redundancyThreshold =
      Number.isFinite(options.redundancyThreshold) && options.redundancyThreshold > 0
        ? options.redundancyThreshold
        : 0.7;

    this.ageWarningMs =
      Number.isFinite(options.ageWarningMs) && options.ageWarningMs > 0
        ? options.ageWarningMs
        : 30 * 24 * 60 * 60 * 1000;

    this.sizeWarningBytes =
      Number.isFinite(options.sizeWarningBytes) && options.sizeWarningBytes > 0
        ? options.sizeWarningBytes
        : 1024 * 1024;

    // Internal state.
    this._lastBefore = null;
    this._lastAfter = null;
    this._lastRecommendations = [];
    this._autoTimer = null;
  }

  // -----------------------------------------------------------------------
  // analyze(memories)
  // -----------------------------------------------------------------------

  /**
   * Analyze a set of memories for efficiency, returning a detailed
   * diagnostics report.
   *
   * @param {object[]} memories - Array of memory records.
   * @returns {object} Analysis report with these fields:
   *   - totalMemories: number
   *   - totalBytes: number (approx JSON bytes)
   *   - namespaceDistribution: { [ns]: count }
   *   - ageProfile: { oldest, newest, medianAgeMs, staleCount }
   *   - tagStats: { tag: string, count: number }[]
   *   - redundancyScore: number (0-1, how much redundancy)
   *   - redundancyPairs: number
   *   - efficiencyScore: number (0-100, overall health)
   *   - issues: string[]
   *   - issuesByTarget: { size: number, relevance: number, redundancy: number, age: number }
   */
  analyze(memories) {
    const mems = Array.isArray(memories) ? memories : [];
    if (mems.length === 0) {
      return {
        totalMemories: 0,
        totalBytes: 0,
        namespaceDistribution: {},
        ageProfile: {
          oldest: null,
          newest: null,
          medianAgeMs: 0,
          staleCount: 0,
        },
        tagStats: [],
        redundancyScore: 0,
        redundancyPairs: 0,
        efficiencyScore: 100,
        issues: [],
        issuesByTarget: { size: 0, relevance: 0, redundancy: 0, age: 0 },
      };
    }

    const totalBytes = estimateBytes(mems);

    // Namespace distribution.
    const nsMap = groupByNamespace(mems);
    const namespaceDistribution = {};
    for (const [ns, group] of nsMap) {
      namespaceDistribution[ns] = group.length;
    }

    // Age profile.
    const ages = mems.map((m) => computeAge(m)).filter((a) => a >= 0);
    const sortedAges = [...ages].sort((a, b) => a - b);
    const oldest = sortedAges.length > 0 ? sortedAges[sortedAges.length - 1] : null;
    const newest = sortedAges.length > 0 ? sortedAges[0] : null;
    const medianAgeMs = median(sortedAges);
    const staleCount = sortedAges.filter((a) => a > this.ageWarningMs).length;

    // Tag statistics.
    const tagStats = countTags(mems);

    // Redundancy analysis: count pairs that would be flagged as similar.
    let redundancyPairs = 0;
    const checked = new Set();
    let totalSimilarity = 0;
    for (let i = 0; i < mems.length; i++) {
      for (let j = i + 1; j < mems.length; j++) {
        const key = `${i}:${j}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const contentA = String(mems[i].content || "");
        const contentB = String(mems[j].content || "");
        const contentOverlap = this._quickOverlap(contentA, contentB);
        const tagOverlap = this._tagJaccard(mems[i].tags, mems[j].tags);
        const combined = (contentOverlap + tagOverlap) / 2;
        totalSimilarity += combined;
        if (combined >= this.redundancyThreshold) {
          redundancyPairs++;
        }
      }
    }

    const totalPairs = (mems.length * (mems.length - 1)) / 2;
    const redundancyScore =
      totalPairs > 0 ? redundancyPairs / totalPairs : 0;

    // Efficiency score: 0–100, higher is better.
    let efficiencyScore = 100;

    // Penalize for size.
    if (totalBytes > this.sizeWarningBytes) {
      efficiencyScore -= Math.min(
        30,
        Math.round(((totalBytes - this.sizeWarningBytes) / this.sizeWarningBytes) * 30)
      );
    }

    // Penalize for stale memories.
    if (staleCount > 0) {
      efficiencyScore -= Math.min(20, Math.round((staleCount / mems.length) * 20));
    }

    // Penalize for redundancy.
    efficiencyScore -= Math.round(redundancyScore * 30);

    // Penalize for having many small memories (fragmentation).
    const avgSize = totalBytes / mems.length;
    if (avgSize < 200 && mems.length > 10) {
      efficiencyScore -= 10;
    }

    efficiencyScore = Math.max(0, Math.min(100, efficiencyScore));

    // Collect issues.
    const issues = [];
    const issuesByTarget = { size: 0, relevance: 0, redundancy: 0, age: 0 };

    if (totalBytes > this.sizeWarningBytes) {
      issues.push(
        `Memory store exceeds size warning threshold (${(totalBytes / 1024).toFixed(1)} KB > ${(this.sizeWarningBytes / 1024).toFixed(1)} KB)`
      );
      issuesByTarget.size++;
    }

    if (staleCount > mems.length * 0.3) {
      issues.push(
        `${staleCount} of ${mems.length} memories are stale (older than ${Math.round(this.ageWarningMs / (24 * 3600 * 1000))} days)`
      );
      issuesByTarget.age++;
    }

    if (redundancyPairs > 0) {
      issues.push(
        `Found ${redundancyPairs} potentially redundant memory pair(s)`
      );
      issuesByTarget.redundancy += redundancyPairs;
    }

    if (mems.length > 50) {
      issues.push(
        `High memory count (${mems.length}) may slow down retrieval`
      );
      issuesByTarget.size++;
    }

    if (nsMap.size > 10) {
      issues.push(
        `High namespace fragmentation (${nsMap.size} namespaces)`
      );
      issuesByTarget.relevance++;
    }

    // Check for memories with short/empty content.
    const shortContentCount = mems.filter(
      (m) => String(m.content || "").length < 20
    ).length;
    if (shortContentCount > mems.length * 0.25) {
      issues.push(
        `${shortContentCount} memories have very short content (<20 chars)`
      );
      issuesByTarget.relevance++;
    }

    return {
      totalMemories: mems.length,
      totalBytes,
      namespaceDistribution,
      ageProfile: {
        oldest,
        newest,
        medianAgeMs,
        staleCount,
      },
      tagStats,
      redundancyScore: Math.round(redundancyScore * 100) / 100,
      redundancyPairs,
      efficiencyScore,
      issues,
      issuesByTarget,
    };
  }

  // -----------------------------------------------------------------------
  // optimize(memories)
  // -----------------------------------------------------------------------

  /**
   * Apply the best optimization strategy to a set of memories.
   *
   * Stores the before and after state for later retrieval via getStats().
   *
   * @param {object[]} memories - Array of memory records.
   * @param {object} [options]
   * @param {string[]} [options.targets] - Optimization targets to focus on.
   *   Leave empty for all targets.
   * @param {number} [options.maxMemories] - Target maximum memory count
   *   after optimization.
   * @returns {{ memories: object[], stats: object, recommendations: object[] }}
   */
  optimize(memories, options = {}) {
    const input = Array.isArray(memories) ? memories : [];
    this._lastBefore = input.map((m) => ({ ...m }));

    if (input.length === 0) {
      this._lastAfter = [];
      this._lastRecommendations = [];
      return {
        memories: [],
        stats: {
          before: this.getStats(),
          savingsBytes: 0,
          savingsTokens: 0,
          reductionPercent: 0,
        },
        recommendations: [],
      };
    }

    const analysis = this.analyze(input);
    this._lastRecommendations = this._buildRecommendations(analysis);

    const targets = Array.isArray(options.targets) && options.targets.length > 0
      ? options.targets
      : Object.values(OPTIMIZATION_TARGETS);

    // Determine strategies based on targeted areas.
    const strategies = this._targetsToStrategies(targets, analysis);

    // If explicit maxMemories, add PRUNE.
    if (
      Number.isSafeInteger(options.maxMemories) &&
      options.maxMemories > 0 &&
      !strategies.includes("prune")
    ) {
      strategies.push("prune");
    }

    const result = this.compressor.compress(input, {
      strategies,
      maxMemories: options.maxMemories || null,
    });

    this._lastAfter = result.memories;

    return {
      memories: result.memories,
      stats: {
        before: {
          count: result.stats.originalCount,
          bytes: estimateBytes(input),
        },
        after: {
          count: result.stats.compressedCount,
          bytes: estimateBytes(result.memories),
        },
        savingsBytes: result.stats.savingsBytes,
        savingsTokens: result.stats.savingsTokens,
        summarizedCount: result.stats.summarizedCount,
        mergedCount: result.stats.mergedCount,
        prunedCount: result.stats.prunedCount,
      },
      recommendations: this._lastRecommendations,
    };
  }

  // -----------------------------------------------------------------------
  // getRecommendations()
  // -----------------------------------------------------------------------

  /**
   * Get specific optimization suggestions from the last analysis or
   * optimization run.
   *
   * @returns {object[]} Array of recommendation objects, each with:
   *   - target: string (size, relevance, redundancy, age)
   *   - action: string (merge, summarize, prune, archive)
   *   - description: string
   *   - priority: number (1=highest, 3=lowest)
   *   - estimatedImpact: string (e.g., "~20% space savings")
   */
  getRecommendations() {
    return this._lastRecommendations;
  }

  // -----------------------------------------------------------------------
  // getStats()
  // -----------------------------------------------------------------------

  /**
   * Get before/after statistics from the last optimization run.
   *
   * @returns {{ before: object|null, after: object|null, delta: object }}
   *   Returns null for before/after if no optimization has been run yet.
   */
  getStats() {
    const before = this._lastBefore
      ? {
          count: this._lastBefore.length,
          bytes: estimateBytes(this._lastBefore),
        }
      : null;

    const after = this._lastAfter
      ? {
          count: this._lastAfter.length,
          bytes: estimateBytes(this._lastAfter),
        }
      : null;

    const delta =
      before && after
        ? {
            countReduction: before.count - after.count,
            bytesSaved: before.bytes - after.bytes,
            percentReduction:
              before.count > 0
                ? Math.round(((before.count - after.count) / before.count) * 100)
                : 0,
          }
        : null;

    return { before, after, delta };
  }

  // -----------------------------------------------------------------------
  // autoOptimize(options)
  // -----------------------------------------------------------------------

  /**
   * Configure automatic periodic optimization.
   *
   * Note: This method sets options for auto-optimization but does NOT
   * start an interval timer. The caller is responsible for invoking
   * `optimize()` on a schedule. This method stores the configuration
   * that the caller can reference.
   *
   * @param {object} options
   * @param {number} [options.intervalMs=3600000] - Suggested interval in
   *   milliseconds between optimization runs (default 1 hour).
   * @param {string[]} [options.targets] - Optimization targets to focus on.
   * @param {number} [options.maxMemories] - Target maximum memory count.
   * @param {boolean} [options.verbose=false] - Log optimization results.
   * @returns {object} Configuration object for the caller to use.
   */
  autoOptimize(options = {}) {
    const config = {
      intervalMs:
        Number.isFinite(options.intervalMs) && options.intervalMs >= 60000
          ? options.intervalMs
          : 3600000, // 1 hour
      targets: Array.isArray(options.targets) && options.targets.length > 0
        ? options.targets
        : Object.values(OPTIMIZATION_TARGETS),
      maxMemories:
        Number.isSafeInteger(options.maxMemories) && options.maxMemories > 0
          ? options.maxMemories
          : null,
      verbose: Boolean(options.verbose),
      enabled: true,
      configuredAt: new Date().toISOString(),
    };

    this._autoConfig = config;

    // Clear any existing timer.
    this.stopAutoOptimize();

    return config;
  }

  /**
   * Stop automatic optimization.
   */
  stopAutoOptimize() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer);
      this._autoTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Map analysis targets to compression strategies.
   * @private
   */
  _targetsToStrategies(targets, analysis) {
    const strategies = new Set();
    const set = new Set(targets.map((t) => String(t).toLowerCase()));

    if (
      set.has(OPTIMIZATION_TARGETS.REDUNDANCY) &&
      analysis.redundancyPairs > 0
    ) {
      strategies.add("merge");
    }

    if (set.has(OPTIMIZATION_TARGETS.AGE) && analysis.ageProfile.staleCount > 0) {
      strategies.add("summarize");
      strategies.add("archive");
    }

    if (
      set.has(OPTIMIZATION_TARGETS.SIZE) &&
      (analysis.totalBytes > this.sizeWarningBytes || analysis.totalMemories > 50)
    ) {
      strategies.add("prune");
    }

    if (set.has(OPTIMIZATION_TARGETS.RELEVANCE)) {
      strategies.add("summarize");
    }

    // Ensure at least one strategy.
    if (strategies.size === 0) {
      strategies.add("summarize");
    }

    return [...strategies];
  }

  /**
   * Build recommendations from analysis results.
   * @private
   */
  _buildRecommendations(analysis) {
    const recs = [];

    if (analysis.redundancyPairs > 0) {
      recs.push({
        target: "redundancy",
        action: "merge",
        description: `Merge ${analysis.redundancyPairs} similar memory pair(s) to reduce redundancy`,
        priority: analysis.redundancyPairs > 5 ? 1 : 2,
        estimatedImpact: `~${Math.round(analysis.redundancyScore * 100)}% less redundancy`,
      });
    }

    if (analysis.ageProfile.staleCount > 0) {
      recs.push({
        target: "age",
        action: "summarize",
        description: `Summarize ${analysis.ageProfile.staleCount} stale memories to keep context while saving space`,
        priority: analysis.ageProfile.staleCount > analysis.totalMemories * 0.5 ? 1 : 2,
        estimatedImpact: `~50-70% space savings for summarized memories`,
      });
    }

    if (analysis.totalMemories > 30) {
      recs.push({
        target: "size",
        action: "prune",
        description: `Consider pruning low-importance memories (${analysis.totalMemories} total, target <30)`,
        priority: analysis.totalMemories > 50 ? 1 : 3,
        estimatedImpact: `~${Math.round(Math.max(0, (analysis.totalMemories - 30) / analysis.totalMemories * 100))}% reduction`,
      });
    }

    if (analysis.totalBytes > this.sizeWarningBytes) {
      recs.push({
        target: "size",
        action: "archive",
        description: `Archive old memories to reduce memory store size (${(analysis.totalBytes / 1024).toFixed(1)} KB)`,
        priority: 1,
        estimatedImpact: `Potentially ${(analysis.totalBytes / 1024).toFixed(0)} KB freed`,
      });
    }

    if (analysis.issuesByTarget.relevance > 0) {
      recs.push({
        target: "relevance",
        action: "summarize",
        description: `Improve memory relevance by summarizing low-content memories`,
        priority: 2,
        estimatedImpact: "Better retrieval quality",
      });
    }

    // Sort by priority (lower = more urgent).
    recs.sort((a, b) => a.priority - b.priority);

    return recs.slice(0, MAX_RECOMMENDATIONS);
  }

  /**
   * Quick overlap check using first 500 characters of each content.
   * Fast approximation of Jaccard similarity for reporting purposes.
   * @private
   */
  _quickOverlap(contentA, contentB) {
    const a = contentA.toLowerCase().slice(0, 500);
    const b = contentB.toLowerCase().slice(0, 500);
    if (!a || !b) return 0;

    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 1));
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 1));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Tag Jaccard similarity.
   * @private
   */
  _tagJaccard(tagsA, tagsB) {
    const setA = new Set((tagsA || []).map((t) => String(t).toLowerCase()));
    const setB = new Set((tagsB || []).map((t) => String(t).toLowerCase()));
    if (setA.size === 0 && setB.size === 0) return 1;

    let intersection = 0;
    for (const t of setA) {
      if (setB.has(t)) intersection++;
    }
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MemoryOptimizer,
  OPTIMIZATION_TARGETS,
  groupByNamespace,
  countTags,
  median,
};
