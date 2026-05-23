"use strict";

/**
 * Memory compression and summarization engine.
 *
 * Compresses memory stores by summarizing old memories, merging related
 * entries, deduplicating near-identical content, and pruning low-value
 * memories. Designed to keep the memory store efficient while preserving
 * the most useful information.
 */

const COMPRESS_STRATEGIES = Object.freeze({
  SUMMARIZE: "summarize",
  MERGE: "merge",
  PRUNE: "prune",
  ARCHIVE: "archive",
});

const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_AGE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_IMPORTANCE_THRESHOLD = 0.3;
// Approximate: 1 token ≈ 4 characters in English text.
const CHARS_PER_TOKEN = 4;
const IMPORTANCE_TAG_WEIGHTS = {
  important: 1.0,
  critical: 1.0,
  pinned: 0.9,
  key: 0.8,
  reference: 0.6,
  note: 0.4,
  transient: 0.1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase word tokens, stripping punctuation.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Compute Jaccard similarity between two texts based on word tokens.
 * Returns a value between 0 (completely different) and 1 (identical).
 * @param {string} textA
 * @param {string} textB
 * @returns {number}
 */
function jaccardSimilarity(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute tag overlap between two memory records.
 * @param {string[]} tagsA
 * @param {string[]} tagsB
 * @returns {number} value between 0 and 1
 */
function tagOverlap(tagsA, tagsB) {
  const setA = new Set((tagsA || []).map((t) => t.toLowerCase()));
  const setB = new Set((tagsB || []).map((t) => t.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute importance score for a memory record from its tags.
 * @param {string[]} tags
 * @returns {number} value between 0 and 1
 */
function computeImportance(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 0.5;
  let score = 0;
  let count = 0;
  for (const tag of tags) {
    const key = String(tag).toLowerCase();
    const weight = IMPORTANCE_TAG_WEIGHTS[key];
    if (weight !== undefined) {
      score += weight;
      count++;
    }
  }
  // If no recognized tags, return neutral score; otherwise average.
  return count === 0 ? 0.5 : score / count;
}

/**
 * Compute age of a memory in milliseconds.
 * @param {object} memory
 * @returns {number}
 */
function computeAge(memory) {
  const timestamp = memory.updatedAt || memory.createdAt;
  if (!timestamp) return 0;
  return Date.now() - new Date(timestamp).getTime();
}

/**
 * Extract a one-sentence summary from content text.
 * @param {string} text
 * @returns {string}
 */
function firstSentence(text) {
  const cleaned = String(text || "").replace(/\n+/g, " ").trim();
  const match = cleaned.match(/^([^.!?]+[.!?]?)/);
  return match ? match[1].trim() : cleaned.slice(0, 200);
}

/**
 * Estimate token count from a string.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate byte size of a memory object (approximate JSON serialization).
 * @param {object|object[]} memories
 * @returns {number}
 */
function estimateBytes(memories) {
  if (memories === null || memories === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(memories), "utf8");
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// MemoryCompressor
// ---------------------------------------------------------------------------

class MemoryCompressor {
  /**
   * @param {object} [options]
   * @param {number} [options.similarityThreshold=0.7] - Jaccard threshold for
   *   considering two memories as near-duplicates.
   * @param {number} [options.ageThresholdMs=2592000000] - Age (ms) beyond
   *   which a memory is considered "old" and eligible for summarization.
   * @param {number} [options.importanceThreshold=0.3] - Below this importance
   *   score, memories are candidates for pruning.
   * @param {number} [options.tagOverlapThreshold=0.5] - Tag overlap threshold
   *   for considering two memories for merging.
   */
  constructor(options = {}) {
    this.similarityThreshold =
      Number.isFinite(options.similarityThreshold) && options.similarityThreshold > 0
        ? options.similarityThreshold
        : DEFAULT_SIMILARITY_THRESHOLD;

    this.ageThresholdMs =
      Number.isFinite(options.ageThresholdMs) && options.ageThresholdMs > 0
        ? options.ageThresholdMs
        : DEFAULT_AGE_THRESHOLD_MS;

    this.importanceThreshold =
      Number.isFinite(options.importanceThreshold) && options.importanceThreshold > 0
        ? options.importanceThreshold
        : DEFAULT_IMPORTANCE_THRESHOLD;

    this.tagOverlapThreshold =
      Number.isFinite(options.tagOverlapThreshold) && options.tagOverlapThreshold > 0
        ? options.tagOverlapThreshold
        : 0.5;
  }

  // -----------------------------------------------------------------------
  // compress(memories, options)
  // -----------------------------------------------------------------------

  /**
   * Compress a set of memories using a combination of strategies.
   *
   * @param {object[]} memories - Array of memory records.
   * @param {object} [options]
   * @param {string[]} [options.strategies] - Ordered list of strategies to
   *   apply. Default: all strategies in priority order.
   * @param {number} [options.maxMemories] - Target maximum count after
   *   compression. When set, pruning will try to meet this target.
   * @param {boolean} [options.dryRun=false] - If true, return what *would*
   *   happen without actually modifying the memories.
   * @returns {{ memories: object[], stats: object }}
   *   stats contains: originalCount, compressedCount, summarizedCount,
   *   mergedCount, prunedCount, archiveCandidates, savingsBytes, savingsTokens
   */
  compress(memories, options = {}) {
    const input = Array.isArray(memories) ? [...memories] : [];
    if (input.length === 0) {
      return {
        memories: [],
        stats: {
          originalCount: 0,
          compressedCount: 0,
          summarizedCount: 0,
          mergedCount: 0,
          prunedCount: 0,
          archiveCandidates: [],
          savingsBytes: 0,
          savingsTokens: 0,
        },
      };
    }

    const strategies = this._resolveStrategies(options.strategies);
    const maxMemories =
      Number.isSafeInteger(options.maxMemories) && options.maxMemories > 0
        ? options.maxMemories
        : null;

    const originalBytes = estimateBytes(input);
    const originalTokens = estimateTokens(
      input.map((m) => m.content || "").join(" ")
    );

    let working = input.map((m) => ({ ...m }));
    let summarizedCount = 0;
    let mergedCount = 0;
    let prunedCount = 0;
    const archiveCandidates = [];

    const now = Date.now();

    for (const strategy of strategies) {
      switch (strategy) {
        case COMPRESS_STRATEGIES.SUMMARIZE:
          ({ working, summarized: summarizedCount } = this._applySummarize(
            working,
            now,
            summarizedCount
          ));
          break;

        case COMPRESS_STRATEGIES.MERGE:
          ({ working, merged: mergedCount } = this._applyMerge(
            working,
            mergedCount
          ));
          break;

        case COMPRESS_STRATEGIES.PRUNE: {
          const pruneResult = this._applyPrune(
            working,
            maxMemories,
            archiveCandidates
          );
          working = pruneResult.working;
          prunedCount += pruneResult.pruned;
          break;
        }

        case COMPRESS_STRATEGIES.ARCHIVE:
          // Mark candidates without removing them yet — the caller decides.
          archiveCandidates.push(
            ...working.filter((m) => this._shouldArchive(m, now))
          );
          break;

        default:
          // Unknown strategy, skip.
          break;
      }
    }

    const compressedBytes = estimateBytes(working);
    const compressedText = working.map((m) => m.content || "").join(" ");
    const compressedTokens = estimateTokens(compressedText);

    return {
      memories: working,
      stats: {
        originalCount: input.length,
        compressedCount: working.length,
        summarizedCount,
        mergedCount,
        prunedCount,
        archiveCandidates,
        savingsBytes: originalBytes - compressedBytes,
        savingsTokens: originalTokens - compressedTokens,
      },
    };
  }

  // -----------------------------------------------------------------------
  // summarize(memory)
  // -----------------------------------------------------------------------

  /**
   * Create a summary of a single memory. Returns a new memory object with
   * summarized content and metadata unchanged.
   *
   * @param {object} memory
   * @returns {object} A new memory object with summarized content.
   */
  summarize(memory) {
    if (!memory || typeof memory !== "object") {
      return null;
    }

    const content = String(memory.content || "");
    const sentence = firstSentence(content);

    // Extract a few representative keywords as an extra hint.
    const tokens = tokenize(content);
    const wordFreq = new Map();
    for (const t of tokens) {
      if (t.length >= 3) {
        wordFreq.set(t, (wordFreq.get(t) || 0) + 1);
      }
    }
    const keywords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((e) => e[0]);

    const summary =
      keywords.length > 0
        ? `${sentence} [topics: ${keywords.join(", ")}]`
        : sentence;

    return {
      ...memory,
      content: summary,
      summarized: true,
      originalContentLength: content.length,
      originalTokenEstimate: estimateTokens(content),
      updatedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // merge(memoryA, memoryB)
  // -----------------------------------------------------------------------

  /**
   * Merge two related memory records into one combined record.
   *
   * The resulting memory keeps the name of the first memory, combines tags
   * (deduplicated), uses the most recent timestamps, and concatenates
   * content with labels.
   *
   * @param {object} memoryA
   * @param {object} memoryB
   * @returns {object} A new merged memory object.
   */
  merge(memoryA, memoryB) {
    const a = memoryA || {};
    const b = memoryB || {};

    // Use the first memory's name and namespace as base.
    const name = a.name || b.name || "merged-memory";
    const namespace = a.namespace || b.namespace || "default";

    // Merge tags, deduplicating case-insensitively.
    const tagSet = new Set();
    const tagsA = Array.isArray(a.tags) ? a.tags : [];
    const tagsB = Array.isArray(b.tags) ? b.tags : [];
    for (const t of [...tagsA, ...tagsB]) {
      if (typeof t === "string") tagSet.add(t.toLowerCase());
    }
    const tags = [...tagSet];

    // Most recent timestamps win.
    const createdAt = [a.createdAt, b.createdAt]
      .filter(Boolean)
      .sort()
      [0] || new Date().toISOString();
    const updatedAt = new Date().toISOString();

    // Combine content.
    const contentA = String(a.content || "");
    const contentB = String(b.content || "");

    const mergedContent =
      contentA && contentB
        ? `[From "${a.name || "memory-a"}"] ${contentA}\n\n[From "${b.name || "memory-b"}"] ${contentB}`
        : contentA || contentB;

    return {
      name,
      namespace,
      tags,
      createdAt,
      updatedAt,
      content: mergedContent,
      merged: true,
      mergedFrom: [a.name, b.name].filter(Boolean),
      mergedAt: updatedAt,
    };
  }

  // -----------------------------------------------------------------------
  // deduplicate(memories)
  // -----------------------------------------------------------------------

  /**
   * Remove duplicate and near-duplicate memories from the list.
   *
   * Two memories are considered near-duplicates when their Jaccard
   * content similarity exceeds the configured similarity threshold.
   * The memory with the more recent updatedAt timestamp is kept.
   *
   * @param {object[]} memories
   * @returns {object[]} Deduplicated array of memory records.
   */
  deduplicate(memories) {
    const input = Array.isArray(memories) ? memories : [];
    if (input.length <= 1) return input.map((m) => ({ ...m }));

    // Sort by updatedAt descending so newer memories are processed first
    // and therefore kept when duplicates are found.
    const sorted = [...input].sort(
      (a, b) =>
        String(b.updatedAt || b.createdAt || "").localeCompare(
          String(a.updatedAt || a.createdAt || "")
        )
    );

    const kept = [];

    for (const candidate of sorted) {
      const contentA = String(candidate.content || "");
      const nameA = (candidate.name || "").toLowerCase();

      const isDuplicate = kept.some((existing) => {
        const contentB = String(existing.content || "");
        const nameB = (existing.name || "").toLowerCase();

        // Exact name match is a strong signal.
        if (nameA && nameB && nameA === nameB) return true;

        // Content similarity check.
        const similarity = jaccardSimilarity(contentA, contentB);
        return similarity >= this.similarityThreshold;
      });

      if (!isDuplicate) {
        kept.push({ ...candidate });
      }
    }

    return kept;
  }

  // -----------------------------------------------------------------------
  // estimateSavings(original, compressed)
  // -----------------------------------------------------------------------

  /**
   * Estimate the savings achieved by compression.
   *
   * @param {object[]|string|object} original - Original memories or content.
   * @param {object[]|string|object} compressed - Compressed memories or
   *   content.
   * @returns {{ originalBytes: number, compressedBytes: number, originalTokens: number, compressedTokens: number, bytesSaved: number, tokensSaved: number, percentSaved: number }}
   */
  estimateSavings(original, compressed) {
    const originalBytes = estimateBytes(original);
    const compressedBytes = estimateBytes(compressed);

    const originalText = Array.isArray(original)
      ? original.map((m) => m.content || "").join(" ")
      : typeof original === "string"
        ? original
        : JSON.stringify(original || "");

    const compressedText = Array.isArray(compressed)
      ? compressed.map((m) => m.content || "").join(" ")
      : typeof compressed === "string"
        ? compressed
        : JSON.stringify(compressed || "");

    const originalTokens = estimateTokens(originalText);
    const compressedTokens = estimateTokens(compressedText);
    const bytesSaved = originalBytes - compressedBytes;
    const tokensSaved = originalTokens - compressedTokens;
    const percentSaved =
      originalBytes > 0
        ? Math.round((bytesSaved / originalBytes) * 100)
        : 0;

    return {
      originalBytes,
      compressedBytes,
      originalTokens,
      compressedTokens,
      bytesSaved,
      tokensSaved,
      percentSaved,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the ordered list of strategies to apply.
   * @private
   */
  _resolveStrategies(requested) {
    const all = Object.values(COMPRESS_STRATEGIES);
    if (!Array.isArray(requested) || requested.length === 0) {
      return all;
    }
    // Deduplicate and only include known strategies.
    const seen = new Set();
    const resolved = [];
    for (const s of requested) {
      const key = String(s).toLowerCase();
      if (all.includes(key) && !seen.has(key)) {
        seen.add(key);
        resolved.push(key);
      }
    }
    return resolved.length > 0 ? resolved : all;
  }

  /**
   * Apply SUMMARIZE strategy: summarize old but still important memories.
   * @private
   */
  _applySummarize(memories, now, prevCount) {
    let count = prevCount;
    const result = memories.map((m) => {
      const age = computeAge(m);
      const importance = computeImportance(m.tags);
      if (
        age >= this.ageThresholdMs &&
        importance >= this.importanceThreshold
      ) {
        count++;
        return this.summarize(m);
      }
      return m;
    });
    return { working: result, summarized: count };
  }

  /**
   * Apply MERGE strategy: merge similar memories that share namespace/tags.
   * @private
   */
  _applyMerge(memories, prevCount) {
    if (memories.length <= 1) return { working: memories, merged: prevCount };

    let count = prevCount;
    const remaining = memories.map((m) => ({ ...m }));
    const merged = [];

    // Group by namespace.
    const byNamespace = new Map();
    for (const m of remaining) {
      const ns = m.namespace || "default";
      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      byNamespace.get(ns).push(m);
    }

    const result = [];
    const consumed = new Set();

    for (const [, group] of byNamespace) {
      for (let i = 0; i < group.length; i++) {
        if (consumed.has(group[i])) continue;
        let base = group[i];
        let didMerge = false;

        for (let j = i + 1; j < group.length; j++) {
          if (consumed.has(group[j])) continue;

          const similarity = jaccardSimilarity(
            String(base.content || ""),
            String(group[j].content || "")
          );
          const overlap = tagOverlap(base.tags || [], group[j].tags || []);

          if (
            similarity >= this.similarityThreshold &&
            overlap >= this.tagOverlapThreshold
          ) {
            base = this.merge(base, group[j]);
            consumed.add(group[j]);
            didMerge = true;
            count++;
          }
        }

        if (didMerge) {
          merged.push(group[i]);
        }
        result.push(base);
        consumed.add(base);
      }
    }

    return { working: result, merged: count };
  }

  /**
   * Apply PRUNE strategy: remove low-importance and/or very old memories.
   * @private
   */
  _applyPrune(memories, maxMemories, archiveCandidates) {
    if (memories.length === 0) {
      return { working: memories, pruned: 0, archiveCandidates };
    }

    let pruned = 0;

    // First pass: prune low-importance memories below the threshold.
    let working = memories.filter((m) => {
      const importance = computeImportance(m.tags);
      if (importance < this.importanceThreshold) {
        pruned++;
        return false;
      }
      return true;
    });

    // Second pass: if maxMemories is set, prune the lowest-importance
    // memories until we're at or below the limit.
    if (maxMemories !== null && working.length > maxMemories) {
      const sorted = [...working].sort(
        (a, b) => computeImportance(b.tags) - computeImportance(a.tags)
      );
      working = sorted.slice(0, maxMemories);
      pruned += sorted.length - maxMemories;
    }

    return { working, pruned, archiveCandidates };
  }

  /**
   * Check if a memory should be archived (old and low-importance).
   * @private
   */
  _shouldArchive(memory, now) {
    const age = computeAge(memory);
    const importance = computeImportance(memory.tags);
    return (
      age >= this.ageThresholdMs &&
      importance < this.importanceThreshold * 2
    );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  COMPRESS_STRATEGIES,
  MemoryCompressor,
  jaccardSimilarity,
  tagOverlap,
  computeImportance,
  computeAge,
  estimateTokens,
  estimateBytes,
  tokenize,
};
