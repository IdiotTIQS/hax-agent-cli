/**
 * RatingSystem — Star ratings and reviews for catalog items.
 *
 *   const ratings = new RatingSystem();
 *   ratings.rate("item-001", "user-42", 5, "Excellent!");
 *   ratings.getRating("item-001");  // { average: 5, count: 1, distribution: {...} }
 *   ratings.getTopRated("agent", 10);
 */
"use strict";

const MIN_SCORE = 1;
const MAX_SCORE = 5;

let _seq = 0;

function _now() {
  return new Date().toISOString();
}

function _nextSeq() {
  _seq += 1;
  return _seq;
}

function _validateScore(score) {
  if (!Number.isFinite(score) || score < MIN_SCORE || score > MAX_SCORE) {
    throw new Error(
      `Score must be an integer between ${MIN_SCORE} and ${MAX_SCORE}, got ${score}`,
    );
  }
  return Math.round(score);
}

class RatingSystem {
  constructor() {
    /**
     * Map<itemId, Array<{ userId, score, review, createdAt }>>
     * @type {Map<string, Array<object>>}
     */
    this._ratings = new Map();
  }

  // -------------------------------------------------------------------------
  // Rate
  // -------------------------------------------------------------------------

  /**
   * Submit a rating and optional review for a catalog item.
   *
   * Throws if the user has already rated this item.
   *
   * @param {string} itemId  - Catalog item id
   * @param {string} userId  - User identifier
   * @param {number} score   - 1 to 5
   * @param {string} [review] - Optional text review
   * @returns {object} The rating entry
   */
  rate(itemId, userId, score, review) {
    if (typeof itemId !== "string" || !itemId.trim()) {
      throw new Error("itemId is required");
    }
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("userId is required");
    }

    score = _validateScore(score);

    let entries = this._ratings.get(itemId);
    if (!entries) {
      entries = [];
      this._ratings.set(itemId, entries);
    }

    const existing = entries.find((r) => r.userId === userId);
    if (existing) {
      throw new Error(
        `User "${userId}" has already rated item "${itemId}". Use updateReview() to modify.`,
      );
    }

    const entry = {
      userId,
      score,
      review: typeof review === "string" ? review.trim() : null,
      createdAt: _now(),
      seq: _nextSeq(),
    };

    entries.push(entry);
    return Object.freeze({ ...entry });
  }

  /**
   * Update an existing rating/review for a catalog item.
   *
   * @param {string} itemId
   * @param {string} userId
   * @param {number} score    - New score (1-5)
   * @param {string} [review] - New review text
   * @returns {object} The updated rating entry
   */
  updateReview(itemId, userId, score, review) {
    if (typeof itemId !== "string" || !itemId.trim()) {
      throw new Error("itemId is required");
    }
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("userId is required");
    }

    score = _validateScore(score);

    const entries = this._ratings.get(itemId);
    if (!entries) {
      throw new Error(`No ratings found for item "${itemId}"`);
    }

    const idx = entries.findIndex((r) => r.userId === userId);
    if (idx === -1) {
      throw new Error(
        `No rating found for user "${userId}" on item "${itemId}". Use rate() to submit a new rating.`,
      );
    }

    const updated = {
      userId,
      score,
      review: typeof review === "string" ? review.trim() : null,
      createdAt: entries[idx].createdAt,
      updatedAt: _now(),
    };

    entries[idx] = updated;
    return Object.freeze({ ...updated });
  }

  /**
   * Remove a user's rating for an item.
   *
   * @param {string} itemId
   * @param {string} userId
   * @returns {boolean} True if removed
   */
  removeRating(itemId, userId) {
    const entries = this._ratings.get(itemId);
    if (!entries) return false;

    const idx = entries.findIndex((r) => r.userId === userId);
    if (idx === -1) return false;

    entries.splice(idx, 1);

    // Clean up empty arrays
    if (entries.length === 0) {
      this._ratings.delete(itemId);
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Get the aggregate rating for an item.
   *
   * @param {string} itemId
   * @returns {object} { average, count, distribution: {1,2,3,4,5} }
   */
  getRating(itemId) {
    const entries = this._ratings.get(itemId) || [];
    const count = entries.length;

    if (count === 0) {
      return { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;

    for (const r of entries) {
      total += r.score;
      distribution[r.score] = (distribution[r.score] || 0) + 1;
    }

    return {
      average: Math.round((total / count) * 100) / 100,
      count,
      distribution,
    };
  }

  /**
   * Get all reviews for an item with pagination.
   *
   * @param {string} itemId
   * @param {object} [options]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @param {boolean} [options.reviewsOnly] - Only include entries with review text
   * @returns {Array<object>}
   */
  getReviews(itemId, options = {}) {
    const entries = this._ratings.get(itemId) || [];
    let results = [...entries];

    if (options.reviewsOnly) {
      results = results.filter((r) => r.review && r.review.length > 0);
    }

    // Sort newest first, with seq tiebreaker for deterministic ordering
    results.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.seq || 0) - (a.seq || 0);
    });

    const offset = Math.max(0, options.offset || 0);
    const limit = options.limit !== undefined ? Math.max(0, options.limit) : undefined;

    if (offset > 0) {
      results = results.slice(offset);
    }
    if (limit !== undefined) {
      results = results.slice(0, limit);
    }

    return results.map((r) => Object.freeze({ ...r }));
  }

  /**
   * Get all ratings submitted by a specific user.
   *
   * @param {string} userId
   * @returns {Array<{ itemId, score, review, createdAt }>}
   */
  getUserRatings(userId) {
    if (typeof userId !== "string" || !userId.trim()) {
      return [];
    }

    const results = [];

    for (const [itemId, entries] of this._ratings) {
      const userEntry = entries.find((r) => r.userId === userId);
      if (userEntry) {
        results.push({
          itemId,
          userId,
          score: userEntry.score,
          review: userEntry.review,
          createdAt: userEntry.createdAt,
          updatedAt: userEntry.updatedAt || null,
          seq: userEntry.seq,
        });
      }
    }

    // Sort newest first, with seq tiebreaker for deterministic ordering
    results.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.seq || 0) - (a.seq || 0);
    });
    return results;
  }

  /**
   * Get the highest-rated items across all items (or filtered by type when
   * an external catalog reference is provided).
   *
   * Items with fewer than minRatings are excluded from the ranking.
   *
   * @param {object} [options]
   * @param {number} [options.limit=10]
   * @param {number} [options.minRatings=1] - Minimum number of ratings required
   * @returns {Array<{ itemId, average, count, distribution }>}
   */
  getTopRated(options = {}) {
    const limit = Math.max(1, options.limit || 10);
    const minRatings = Math.max(1, options.minRatings || 1);

    const items = [];

    for (const [itemId, entries] of this._ratings) {
      const count = entries.length;
      if (count < minRatings) continue;

      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let total = 0;

      for (const r of entries) {
        total += r.score;
        distribution[r.score] = (distribution[r.score] || 0) + 1;
      }

      items.push({
        itemId,
        average: Math.round((total / count) * 100) / 100,
        count,
        distribution,
      });
    }

    items.sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      return b.count - a.count;
    });

    return items.slice(0, limit);
  }

  /**
   * Get the total number of ratings across all items.
   *
   * @returns {number}
   */
  totalRatings() {
    let total = 0;
    for (const entries of this._ratings.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * Get the overall average rating across all items.
   *
   * @returns {number}
   */
  overallAverage() {
    let total = 0;
    let count = 0;
    for (const entries of this._ratings.values()) {
      for (const r of entries) {
        total += r.score;
        count += 1;
      }
    }
    return count > 0 ? Math.round((total / count) * 100) / 100 : 0;
  }
}

RatingSystem.MIN_SCORE = MIN_SCORE;
RatingSystem.MAX_SCORE = MAX_SCORE;

module.exports = { RatingSystem };
