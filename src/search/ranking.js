/**
 * Relevance ranking for semantic code search results.
 *
 * The Ranker class provides configurable scoring and post-processing
 * pipelines for search match arrays.
 */
"use strict";

// ---------------------------------------------------------------------------
// Ranker class
// ---------------------------------------------------------------------------

class Ranker {
  /**
   * @param {object} [options]
   * @param {number} [options.exactMatchWeight=10] - bonus for exact query matches
   * @param {number} [options.proximityWeight=3]  - bonus for proximity of terms
   * @param {number} [options.positionWeight=2]   - bonus for matches early in file
   * @param {number} [options.frequencyWeight=1]  - bonus for multiple occurrences
   * @param {number} [options.contextQualityWeight=2] - bonus for rich context
   */
  constructor(options) {
    const opts = options || {};
    this.exactMatchWeight = opts.exactMatchWeight !== undefined ? opts.exactMatchWeight : 10;
    this.proximityWeight = opts.proximityWeight !== undefined ? opts.proximityWeight : 3;
    this.positionWeight = opts.positionWeight !== undefined ? opts.positionWeight : 2;
    this.frequencyWeight = opts.frequencyWeight !== undefined ? opts.frequencyWeight : 1;
    this.contextQualityWeight = opts.contextQualityWeight !== undefined ? opts.contextQualityWeight : 2;
  }

  /**
   * Score a single match against a query string.
   *
   * Scoring factors:
   *  - **exactMatch**: match text === query (case-insensitive)
   *  - **proximity**: how close query terms appear near each other
   *  - **position**: earlier lines score higher (files often declare things up top)
   *  - **contextQuality**: presence of keywords like function/class/import in context
   *
   * @param {{ match: string, line: number, column: number, context: string, count?: number }} m
   * @param {string} query
   * @returns {number}
   */
  score(m, query) {
    let score = 0;

    // --- Exact match bonus ---
    if (m.match.toLowerCase() === query.toLowerCase()) {
      score += this.exactMatchWeight;
    }

    // --- Position bonus ---
    // Earlier lines are often more important (declarations, imports)
    if (m.line <= 10) {
      score += this.positionWeight * 2;
    } else if (m.line <= 50) {
      score += this.positionWeight;
    }

    // --- Proximity / multi-term ---
    const queryTerms = query.split(/\s+/).filter(Boolean);
    if (queryTerms.length > 1) {
      const proximityScore = computeProximityScore(m.match, queryTerms);
      score += proximityScore * this.proximityWeight;
    }

    // --- Frequency bonus ---
    if (m.count !== undefined && m.count > 1) {
      score += Math.min(this.frequencyWeight * Math.log2(m.count), this.frequencyWeight * 5);
    }

    // --- Context quality ---
    if (m.context) {
      const ctxScore = computeContextQuality(m.context);
      score += ctxScore * this.contextQualityWeight;
    }

    return score;
  }

  /**
   * Sort an array of match results by descending score.
   * Each result must have a numeric `_score` property (set by score() or
   * added externally).
   *
   * @param {object[]} results
   * @returns {object[]} - new sorted array (does not mutate input)
   */
  rank(results) {
    return results.slice().sort((a, b) => {
      const sa = typeof a._score === "number" ? a._score : 0;
      const sb = typeof b._score === "number" ? b._score : 0;
      return sb - sa;
    });
  }

  /**
   * Multiply the score of results that match a predicate on *field*.
   *
   * @param {object[]} results - results with _score properties
   * @param {string} field - field name to check (e.g. "match", "file")
   * @param {number} weight - boost multiplier (1 = no-op, 2 = double, etc.)
   * @param {string|RegExp} [value] - if provided, only boost when field matches this
   * @returns {object[]}
   */
  boost(results, field, weight, value) {
    for (const r of results) {
      if (r[field] !== undefined) {
        if (value !== undefined) {
          if (value instanceof RegExp) {
            if (!value.test(String(r[field]))) {
              continue;
            }
          } else if (String(r[field]) !== String(value)) {
            continue;
          }
        }
        r._score = (r._score || 0) * weight;
      }
    }
    return results;
  }

  /**
   * Reorder results so that consecutive entries come from different files,
   * ensuring a diverse top-N.
   *
   * Algorithm: bucket by file, then interleave.
   *
   * @param {object[]} results - sorted results with file property
   * @returns {object[]}
   */
  diversify(results) {
    if (results.length <= 1) return results;

    // Group by file
    const buckets = new Map();
    const order = [];
    for (const r of results) {
      const file = r.file || "(unknown)";
      if (!buckets.has(file)) {
        buckets.set(file, []);
        order.push(file);
      }
      buckets.get(file).push(r);
    }

    // Interleave
    const diversified = [];
    const indexes = new Map();
    for (const file of order) {
      indexes.set(file, 0);
    }

    let added = true;
    while (added) {
      added = false;
      for (const file of order) {
        const bucket = buckets.get(file);
        const idx = indexes.get(file);
        if (idx < bucket.length) {
          diversified.push(bucket[idx]);
          indexes.set(file, idx + 1);
          added = true;
        }
      }
    }

    return diversified;
  }
}

// ---------------------------------------------------------------------------
// Internal scoring helpers
// ---------------------------------------------------------------------------

/**
 * Compute how closely the query terms appear near each other in the match
 * text.  Normalised to [0, 1].
 */
function computeProximityScore(matchText, terms) {
  if (terms.length <= 1) return 0;

  const lower = matchText.toLowerCase();
  const positions = [];
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx === -1) continue;
    positions.push(idx);
  }

  if (positions.length <= 1) return 0;

  // Sort positions and compute average gap
  positions.sort((a, b) => a - b);
  let totalGap = 0;
  for (let i = 1; i < positions.length; i += 1) {
    totalGap += positions[i] - positions[i - 1];
  }
  const avgGap = totalGap / (positions.length - 1);

  // Closer gaps = higher score.  Normalise so gap of 0 → 1, gap >= 100 → 0.
  return Math.max(0, 1 - avgGap / 100);
}

/**
 * Heuristically rate the "quality" of the context lines.
 * Higher score for contexts containing structural keywords.
 */
const QUALITY_KEYWORDS = [
  /\bfunction\b/i,
  /\bclass\b/i,
  /\bimport\b/i,
  /\bexport\b/i,
  /\bconst\b/i,
  /\blet\b/i,
  /\bvar\b/i,
  /\breturn\b/i,
  /\basync\b/i,
  /\bawait\b/i,
  /\binterface\b/i,
  /\btype\b/i,
  /\bextends\b/i,
  /\bimplements\b/i,
  /\btry\b/i,
  /\bcatch\b/i,
];

function computeContextQuality(context) {
  let score = 0;
  const lowerCtx = context.toLowerCase();

  for (const kw of QUALITY_KEYWORDS) {
    if (kw.test(lowerCtx)) {
      score += 1;
    }
  }

  // Cap so a single context cannot dominate scoring
  return Math.min(score, 5);
}

module.exports = { Ranker };
