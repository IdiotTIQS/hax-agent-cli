"use strict";

const { normalizeKnowledgeType } = require("./accumulator");

// ── Quality dimensions ───────────────────────────────────────

const QUALITY_DIMENSIONS = Object.freeze({
  ACCURACY: "accuracy",
  RELEVANCE: "relevance",
  FRESHNESS: "freshness",
  CONSISTENCY: "consistency",
  COMPLETENESS: "completeness",
});

const DIMENSION_WEIGHTS = Object.freeze({
  accuracy: 0.35,
  relevance: 0.25,
  freshness: 0.15,
  consistency: 0.15,
  completeness: 0.10,
});

// ── KnowledgeCurator ─────────────────────────────────────────

class KnowledgeCurator {
  /**
   * Curates and maintains the quality of knowledge accumulated across
   * sessions.  Works with a KnowledgeAccumulator instance.
   *
   * @param {object} accumulator - A KnowledgeAccumulator instance
   * @param {object} [options]
   * @param {object} [options.weights]          - Custom dimension weights
   * @param {number} [options.similarityThreshold=0.7] - Jaccard-ish threshold for dedup
   * @param {number} [options.maxAgeDays=365]   - Default max age for pruning
   */
  constructor(accumulator, options = {}) {
    if (!accumulator || typeof accumulator.accumulate !== "function") {
      throw new Error("accumulator must be a KnowledgeAccumulator instance");
    }
    this._accumulator = accumulator;
    this._weights = options.weights
      ? { ...DIMENSION_WEIGHTS, ...options.weights }
      : { ...DIMENSION_WEIGHTS };
    this._similarityThreshold = typeof options.similarityThreshold === "number"
      ? options.similarityThreshold
      : 0.7;
    this._maxAgeDays = typeof options.maxAgeDays === "number" ? options.maxAgeDays : 365;
  }

  // ── review ─────────────────────────────────────────────────

  /**
   * Review a knowledge item and score it across all quality dimensions.
   *
   * Scoring rules:
   *  - accuracy:   content length & specificity, confidence
   *  - relevance:  tag density, content substance
   *  - freshness:  recency of timestamp
   *  - consistency: presence of tags (indicates structured knowledge)
   *  - completeness: content length, tag coverage
   *
   * @param {object} knowledge - KnowledgeItem or { type, content, confidence, tags, timestamp }
   * @returns {object} { accuracy, relevance, freshness, consistency, completeness, overall, dimensions }
   */
  review(knowledge) {
    if (!knowledge) {
      return this._zeroScores();
    }

    const content = String(knowledge.content || "").trim();
    const confidence = clampConfidence(knowledge.confidence);
    const tags = Array.isArray(knowledge.tags) ? knowledge.tags : [];
    const timestamp = knowledge.timestamp || new Date().toISOString();

    const accuracy = this._scoreAccuracy(content, confidence, knowledge.type);
    const relevance = this._scoreRelevance(content, tags);
    const freshness = this._scoreFreshness(timestamp);
    const consistency = this._scoreConsistency(content, tags);
    const completeness = this._scoreCompleteness(content, tags);

    const overall = this._computeOverall({
      accuracy, relevance, freshness, consistency, completeness,
    });

    return {
      accuracy: Math.round(accuracy * 100) / 100,
      relevance: Math.round(relevance * 100) / 100,
      freshness: Math.round(freshness * 100) / 100,
      consistency: Math.round(consistency * 100) / 100,
      completeness: Math.round(completeness * 100) / 100,
      overall: Math.round(overall * 100) / 100,
      dimensions: QUALITY_DIMENSIONS,
    };
  }

  _scoreAccuracy(content, confidence, type) {
    let score = confidence; // base from the extraction confidence

    // Longer, well-formed content is more likely to be accurate
    if (content.length > 100) score += 0.1;
    if (content.length > 200) score += 0.05;

    // Specific patterns suggest higher accuracy
    if (/#\w+/.test(content)) score += 0.05;
    if (/```[\s\S]*```/.test(content)) score += 0.1;

    // Vague language lowers accuracy
    if (/\b(maybe|perhaps|might|possibly|I think|probably)\b/i.test(content)) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  _scoreRelevance(content, tags) {
    let score = 0.5; // neutral baseline

    // Content substance
    if (content.length > 20) score += 0.1;
    if (content.length > 80) score += 0.1;

    // Tag richness indicates intentional categorization
    if (tags.length >= 1) score += 0.1;
    if (tags.length >= 3) score += 0.1;

    // URLs or file paths suggest concrete references
    if (/https?:\/\//i.test(content)) score += 0.05;
    if (/\/[\w.-]+(\/[\w.-]+)+/.test(content)) score += 0.05;

    return Math.max(0, Math.min(1, score));
  }

  _scoreFreshness(timestamp) {
    const now = Date.now();
    const itemDate = new Date(timestamp).getTime();
    if (isNaN(itemDate)) return 0.3;

    const ageMs = now - itemDate;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays <= 1) return 1.0;
    if (ageDays <= 7) return 0.9;
    if (ageDays <= 30) return 0.8;
    if (ageDays <= 90) return 0.6;
    if (ageDays <= 180) return 0.4;
    if (ageDays <= 365) return 0.25;
    return 0.1;
  }

  _scoreConsistency(content, tags) {
    let score = 0.5;

    // Tagged items are more consistent (intentional structure)
    if (tags.length >= 1) score += 0.15;
    if (tags.length >= 2) score += 0.1;

    // Repetition of key terms suggests consistent focus
    const words = content.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const unique = new Set(words);
    if (words.length > 0) {
      const uniquenessRatio = unique.size / words.length;
      // Very high uniqueness might mean scattered — penalize
      // Moderate uniqueness means focused, consistent content
      if (uniquenessRatio < 0.6) score += 0.1;
      if (uniquenessRatio < 0.4) score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  _scoreCompleteness(content, tags) {
    let score = 0.3; // baseline — most extracted knowledge is partial

    // Content length as proxy for completeness
    if (content.length > 50) score += 0.1;
    if (content.length > 150) score += 0.1;
    if (content.length > 300) score += 0.1;

    // Tags indicate the item was categorized intentionally
    if (tags.length >= 2) score += 0.1;

    // Code or structured data blocks improve completeness
    if (/```[\s\S]*```/.test(content)) score += 0.1;
    if (/^\d+\.\s/.test(content)) score += 0.1; // numbered list

    return Math.max(0, Math.min(1, score));
  }

  _computeOverall(scores) {
    let overall = 0;
    for (const [dim, weight] of Object.entries(this._weights)) {
      overall += (scores[dim] || 0) * weight;
    }
    return Math.max(0, Math.min(1, overall));
  }

  _zeroScores() {
    return {
      accuracy: 0, relevance: 0, freshness: 0,
      consistency: 0, completeness: 0, overall: 0,
      dimensions: QUALITY_DIMENSIONS,
    };
  }

  // ── deduplicate ────────────────────────────────────────────

  /**
   * Remove duplicate and contradictory knowledge from the accumulator.
   *
   * Duplicates are detected via Jaccard-like token overlap.  When two
   * items are similar enough, the one with lower confidence is removed.
   * Contradictions are flagged but the higher-confidence item is kept.
   *
   * @returns {object} { removed, kept, conflicts, duplicateCount }
   */
  deduplicate() {
    const all = this._accumulator.items;
    const toRemove = new Set();
    const conflicts = [];
    const n = all.length;

    for (let i = 0; i < n; i++) {
      if (toRemove.has(all[i].id)) continue;

      for (let j = i + 1; j < n; j++) {
        if (toRemove.has(all[j].id)) continue;

        const similarity = this._computeSimilarity(all[i], all[j]);

        if (similarity >= this._similarityThreshold) {
          // Near-duplicate or related — keep the higher-confidence item
          if (all[i].confidence >= all[j].confidence) {
            toRemove.add(all[j].id);
          } else {
            toRemove.add(all[i].id);
            break; // all[i] was removed; move to next i
          }
        } else if (similarity >= 0.4 && all[i].type === all[j].type) {
          // Possible contradiction (same type, partial overlap)
          const isContradictory = this._detectContradiction(all[i], all[j]);
          if (isContradictory) {
            conflicts.push({
              itemA: all[i].id,
              itemB: all[j].id,
              type: all[i].type,
              similarity: Math.round(similarity * 100) / 100,
              kept: all[i].confidence >= all[j].confidence ? all[i].id : all[j].id,
            });

            // Keep the higher-confidence one
            if (all[i].confidence >= all[j].confidence) {
              toRemove.add(all[j].id);
            } else {
              toRemove.add(all[i].id);
              break;
            }
          }
        }
      }
    }

    const removed = [];
    for (const id of toRemove) {
      const item = all.find((it) => it.id === id);
      if (item) removed.push(item);
    }

    // Remove from accumulator
    for (const item of removed) {
      this._removeItem(item);
    }

    return {
      removed,
      kept: this._accumulator.items,
      conflicts,
      duplicateCount: removed.length,
    };
  }

  /**
   * Compute Jaccard-like similarity between two knowledge items based on
   * tokenised content and tag overlap.
   */
  _computeSimilarity(a, b) {
    const tokensA = new Set(
      a.content.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    );
    const tokensB = new Set(
      b.content.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    );

    const setA = new Set([...tokensA, ...a.tags.map((t) => `tag:${t}`)]);
    const setB = new Set([...tokensB, ...b.tags.map((t) => `tag:${t}`)]);

    if (setA.size === 0 && setB.size === 0) return 0;

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /** Heuristically detect contradictory statements. */
  _detectContradiction(a, b) {
    const contentA = a.content.toLowerCase();
    const contentB = b.content.toLowerCase();

    // Look for negation pairs
    const contradictionIndicators = [
      [/\balways\b/, /\bnever\b/],
      [/\bshould\b/, /\bshould not\b/],
      [/\bmust\b/, /\bmust not\b/],
      [/\bgood\b/, /\bbad\b/],
      [/\brecommend\b/, /\b(do not|don't) recommend\b/],
    ];

    for (const [posPattern, negPattern] of contradictionIndicators) {
      if ((posPattern.test(contentA) && negPattern.test(contentB)) ||
          (negPattern.test(contentA) && posPattern.test(contentB))) {
        return true;
      }
    }

    return false;
  }

  /** Remove a single item from the accumulator internals. */
  _removeItem(item) {
    // Directly manipulate the accumulator's internal data — this is a
    // tight coupling by design since the curator is meant to work with
    // the accumulator it was given.
    const acc = this._accumulator;
    if (acc._items && acc._items.has(item.id)) {
      acc._items.delete(item.id);
    }
    if (acc._indexByTag) {
      for (const tag of item.tags || []) {
        const set = acc._indexByTag.get(tag);
        if (set) {
          set.delete(item.id);
          if (set.size === 0) acc._indexByTag.delete(tag);
        }
      }
    }
    if (acc._indexByType) {
      const set = acc._indexByType.get(item.type);
      if (set) {
        set.delete(item.id);
        if (set.size === 0) acc._indexByType.delete(item.type);
      }
    }
  }

  // ── verify ─────────────────────────────────────────────────

  /**
   * Verify a knowledge item against a source.
   *
   * The source can be any object containing content, tags, or other
   * data.  Verification checks for:
   *  - Content overlap (is the knowledge reflected in the source?)
   *  - Tag alignment (do tags match the source context?)
   *  - Temporal consistency (was the knowledge recorded after the source?)
   *
   * @param {object} knowledge - KnowledgeItem to verify
   * @param {object} source    - Source object { content, tags, timestamp }
   * @returns {object} { verified, score, discrepancies, dimensions }
   */
  verify(knowledge, source) {
    if (!knowledge || !source) {
      return {
        verified: false,
        score: 0,
        discrepancies: ["Missing knowledge or source"],
        dimensions: { contentOverlap: 0, tagAlignment: 0, temporalConsistency: 0 },
      };
    }

    const kContent = String(knowledge.content || "").trim().toLowerCase();
    const sContent = String(source.content || "").trim().toLowerCase();
    const kTags = Array.isArray(knowledge.tags) ? knowledge.tags : [];
    const sTags = Array.isArray(source.tags) ? source.tags.map((t) => t.toLowerCase()) : [];

    const discrepancies = [];

    // Content overlap check
    const contentOverlap = this._computeContentOverlap(kContent, sContent);
    if (contentOverlap < 0.2) {
      discrepancies.push("Low content overlap between knowledge and source");
    }

    // Tag alignment check
    const tagAlignment = this._computeTagAlignment(kTags, sTags);
    if (tagAlignment < 0.3 && sTags.length > 0) {
      discrepancies.push("Knowledge tags poorly aligned with source tags");
    }

    // Temporal consistency
    const temporalConsistency = this._computeTemporalConsistency(
      knowledge.timestamp,
      source.timestamp
    );
    if (temporalConsistency === 0) {
      discrepancies.push("Knowledge predates source — may be stale");
    }

    const dimensions = { contentOverlap, tagAlignment, temporalConsistency };
    const score = (contentOverlap * 0.5 + tagAlignment * 0.3 + temporalConsistency * 0.2);

    return {
      verified: score >= 0.5,
      score: Math.round(score * 100) / 100,
      discrepancies,
      dimensions,
    };
  }

  _computeContentOverlap(kContent, sContent) {
    if (!kContent || !sContent) return 0;
    const kTokens = new Set(kContent.split(/\s+/).filter((t) => t.length > 3));
    const sTokens = new Set(sContent.split(/\s+/).filter((t) => t.length > 3));
    if (kTokens.size === 0 || sTokens.size === 0) return 0;
    const intersection = new Set([...kTokens].filter((t) => sTokens.has(t)));
    return intersection.size / Math.max(kTokens.size, sTokens.size);
  }

  _computeTagAlignment(kTags, sTags) {
    if (kTags.length === 0 && sTags.length === 0) return 0.5; // neutral
    if (kTags.length === 0 || sTags.length === 0) return 0;
    const kSet = new Set(kTags);
    const overlap = sTags.filter((t) => kSet.has(t)).length;
    return overlap / Math.max(kTags.length, sTags.length);
  }

  _computeTemporalConsistency(kTimestamp, sTimestamp) {
    if (!kTimestamp || !sTimestamp) return 0.5;
    const kMs = new Date(kTimestamp).getTime();
    const sMs = new Date(sTimestamp).getTime();
    if (isNaN(kMs) || isNaN(sMs)) return 0.5;
    // Knowledge should be recorded after or at same time as source
    if (kMs >= sMs) return 1;
    const diffDays = (sMs - kMs) / (1000 * 60 * 60 * 24);
    if (diffDays <= 1) return 0.8;
    if (diffDays <= 7) return 0.5;
    return 0;
  }

  // ── prune ──────────────────────────────────────────────────

  /**
   * Prune the knowledge base, removing items that are outdated, irrelevant,
   * or low-confidence.
   *
   * @param {object} [options]
   * @param {number} [options.maxAgeDays=365]       - Max age in days
   * @param {number} [options.minConfidence=0]      - Minimum confidence
   * @param {number} [options.maxItems]             - Hard cap on total items
   * @param {string[]} [options.keepTypes]          - Knowledge types to keep (others removed)
   * @param {string[]} [options.removeTypes]        - Knowledge types to remove
   * @returns {object} { removed, kept, removedCount, keptCount }
   */
  prune(options = {}) {
    const maxAgeDays = typeof options.maxAgeDays === "number"
      ? options.maxAgeDays
      : this._maxAgeDays;
    const minConfidence = typeof options.minConfidence === "number"
      ? options.minConfidence
      : 0;
    const keepTypes = options.keepTypes
      ? new Set(options.keepTypes.map((t) => normalizeKnowledgeType(t)))
      : null;
    const removeTypes = options.removeTypes
      ? new Set(options.removeTypes.map((t) => normalizeKnowledgeType(t)))
      : null;

    const now = Date.now();
    const toRemove = new Set();

    for (const item of this._accumulator.items) {
      // Age check
      if (typeof maxAgeDays === "number" && maxAgeDays > 0) {
        const itemMs = new Date(item.timestamp).getTime();
        if (!isNaN(itemMs)) {
          const ageDays = (now - itemMs) / (1000 * 60 * 60 * 24);
          if (ageDays > maxAgeDays) {
            toRemove.add(item.id);
            continue;
          }
        }
      }

      // Confidence check
      if (item.confidence < minConfidence) {
        toRemove.add(item.id);
        continue;
      }

      // Type whitelist check
      if (keepTypes && !keepTypes.has(item.type)) {
        toRemove.add(item.id);
        continue;
      }

      // Type blacklist check
      if (removeTypes && removeTypes.has(item.type)) {
        toRemove.add(item.id);
        continue;
      }
    }

    // Hard cap — remove lowest-confidence items first
    if (typeof options.maxItems === "number" && options.maxItems > 0) {
      const kept = this._accumulator.items.filter((item) => !toRemove.has(item.id));
      if (kept.length > options.maxItems) {
        kept.sort((a, b) => a.confidence - b.confidence);
        const excess = kept.slice(0, kept.length - options.maxItems);
        for (const item of excess) {
          toRemove.add(item.id);
        }
      }
    }

    const removed = [];
    const all = this._accumulator.items;
    for (const id of toRemove) {
      const item = all.find((it) => it.id === id);
      if (item) {
        this._removeItem(item);
        removed.push(item);
      }
    }

    return {
      removed,
      kept: this._accumulator.items,
      removedCount: removed.length,
      keptCount: this._accumulator.size,
    };
  }

  // ── getQualityScore ────────────────────────────────────────

  /**
   * Compute aggregate quality score across all items in the accumulator.
   *
   * Reviews every item and averages the dimension scores, then computes
   * the overall weighted score.
   *
   * @returns {object} { accuracy, relevance, freshness, consistency, completeness, overall, itemCount }
   */
  getQualityScore() {
    const all = this._accumulator.items;
    if (all.length === 0) {
      return {
        accuracy: 0, relevance: 0, freshness: 0,
        consistency: 0, completeness: 0, overall: 0,
        itemCount: 0,
      };
    }

    const totals = { accuracy: 0, relevance: 0, freshness: 0, consistency: 0, completeness: 0 };

    for (const item of all) {
      const scores = this.review(item);
      for (const dim of Object.keys(totals)) {
        totals[dim] += scores[dim];
      }
    }

    const avg = {};
    for (const dim of Object.keys(totals)) {
      avg[dim] = Math.round((totals[dim] / all.length) * 100) / 100;
    }

    const overall = this._computeOverall(avg);

    return {
      ...avg,
      overall: Math.round(overall * 100) / 100,
      itemCount: all.length,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function clampConfidence(value) {
  if (value === undefined || value === null) return 0.5;
  const num = Number(value);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

// ── Exports ──────────────────────────────────────────────────

module.exports = {
  DIMENSION_WEIGHTS,
  KnowledgeCurator,
  QUALITY_DIMENSIONS,
};
