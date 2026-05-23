/**
 * DiscoveryEngine — Browse, discover, and get recommendations for catalog
 * items in the HaxAgent marketplace and sharing hub.
 *
 *   const discovery = new DiscoveryEngine(catalog, ratings);
 *   discovery.getFeatured();
 *   discovery.getTrending();
 *   discovery.getRecommended("user-42");
 *   discovery.getSimilar("item-000001");
 *   discovery.getByCategory("CODE_REVIEW");
 *   discovery.getStats();
 */
"use strict";

const CATEGORIES = Object.freeze([
  "CODE_GEN",
  "CODE_REVIEW",
  "TESTING",
  "DEVOPS",
  "SECURITY",
  "DATA",
  "DOCS",
  "REFACTORING",
  "DEBUGGING",
  "CUSTOM",
]);

function _now() {
  return new Date().toISOString();
}

function _daysAgo(isoString) {
  if (!isoString) return Infinity;
  const diff = Date.now() - new Date(isoString).getTime();
  return diff / (1000 * 60 * 60 * 24);
}

function _tagOverlap(tagsA, tagsB) {
  if (!tagsA || !tagsB || tagsA.length === 0 || tagsB.length === 0) return 0;
  const setB = new Set(tagsB);
  let overlap = 0;
  for (const tag of tagsA) {
    if (setB.has(tag)) overlap += 1;
  }
  return overlap;
}

class DiscoveryEngine {
  /**
   * @param {import("./catalog").AgentCatalog} catalog
   * @param {import("./rating").RatingSystem}   ratings
   */
  constructor(catalog, ratings) {
    if (!catalog || typeof catalog.getAll !== "function") {
      throw new Error("DiscoveryEngine requires an AgentCatalog instance");
    }
    if (!ratings || typeof ratings.getRating !== "function") {
      throw new Error("DiscoveryEngine requires a RatingSystem instance");
    }

    /** @type {import("./catalog").AgentCatalog} */
    this.catalog = catalog;

    /** @type {import("./rating").RatingSystem} */
    this.ratings = ratings;

    /**
     * Track which items each user has downloaded / viewed, for
     * collaborative-style recommendations.
     * @type {Map<string, Set<string>>}  userId → Set<itemId>
     */
    this._userInteractions = new Map();

    /**
     * Timestamped view/download events for trending calculations.
     * @type {Array<{ itemId: string, userId: string, action: string, timestamp: string }>}
     */
    this._events = [];
  }

  // -------------------------------------------------------------------------
  // Event tracking (for trending / recommendations)
  // -------------------------------------------------------------------------

  /**
   * Record a user interaction with an item.
   *
   * @param {string} itemId
   * @param {string} userId
   * @param {string} action - "view" | "download" | "share"
   */
  trackInteraction(itemId, userId, action) {
    if (typeof itemId !== "string" || !itemId.trim() || typeof userId !== "string" || !userId.trim()) return;

    const event = { itemId, userId, action, timestamp: _now() };
    this._events.push(event);

    // Keep only the last 10,000 events
    if (this._events.length > 10000) {
      this._events = this._events.slice(-10000);
    }

    // Track per-user interactions
    let userSet = this._userInteractions.get(userId);
    if (!userSet) {
      userSet = new Set();
      this._userInteractions.set(userId, userSet);
    }
    userSet.add(itemId);

    return event;
  }

  // -------------------------------------------------------------------------
  // Discovery methods
  // -------------------------------------------------------------------------

  /**
   * Get featured items — highest-rated items across the catalog.
   *
   * @param {number} [limit=6]
   * @returns {Array<object>} Catalog items with rating info attached
   */
  getFeatured(limit = 6) {
    const allItems = this.catalog.getAll();
    if (allItems.length === 0) return [];

    // Compute rating for each item
    const scored = allItems.map((item) => {
      const rating = this.ratings.getRating(item.id);
      return {
        ...item,
        _ratingAvg: rating.average,
        _ratingCount: rating.count,
      };
    });

    // Sort by rating (desc), then by count (desc), then by downloads (desc)
    scored.sort((a, b) => {
      if (b._ratingAvg !== a._ratingAvg) return b._ratingAvg - a._ratingAvg;
      if (b._ratingCount !== a._ratingCount) return b._ratingCount - a._ratingCount;
      return b.downloads - a.downloads;
    });

    return scored.slice(0, Math.max(1, limit));
  }

  /**
   * Get trending items — items with the most recent activity.
   *
   * Looks at events from the last 7 days and ranks by activity count.
   *
   * @param {number} [limit=10]
   * @returns {Array<object>} Catalog items with trending score
   */
  getTrending(limit = 10) {
    const allItems = this.catalog.getAll();
    if (allItems.length === 0) return [];

    // Count recent events per item (last 7 days)
    const recentActivity = new Map();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - sevenDaysMs;

    for (const event of this._events) {
      if (new Date(event.timestamp).getTime() >= cutoff) {
        recentActivity.set(event.itemId, (recentActivity.get(event.itemId) || 0) + 1);
      }
    }

    // If no recent events, fall back to most recently updated items
    if (recentActivity.size === 0) {
      const sorted = [...allItems];
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return sorted.slice(0, Math.max(1, limit));
    }

    // Score items by recent activity + rating
    const scored = allItems.map((item) => {
      const activity = recentActivity.get(item.id) || 0;
      const rating = this.ratings.getRating(item.id);
      const trendingScore = activity * 2 + rating.average;

      return {
        ...item,
        _activity: activity,
        _ratingAvg: rating.average,
        _trendingScore: trendingScore,
      };
    });

    scored.sort((a, b) => b._trendingScore - a._trendingScore);
    return scored.slice(0, Math.max(1, limit));
  }

  /**
   * Get personalized recommendations for a user based on their interaction
   * history and item similarity.
   *
   * @param {string} userId
   * @param {number} [limit=10]
   * @returns {Array<object>} Recommended catalog items
   */
  getRecommended(userId, limit = 10) {
    const allItems = this.catalog.getAll();
    if (allItems.length === 0) return [];

    const userItems = this._userInteractions.get(userId);
    if (!userItems || userItems.size === 0) {
      // New user — return featured items
      return this.getFeatured(limit);
    }

    // Build a tag profile from items the user has interacted with
    const tagScores = new Map(); // tag → score
    const typeScores = new Map(); // type → score
    const categoryScores = new Map(); // category → score

    for (const itemId of userItems) {
      const item = this.catalog.getItem(itemId);
      if (!item) continue;

      typeScores.set(item.type, (typeScores.get(item.type) || 0) + 1);
      if (item.category) {
        categoryScores.set(item.category, (categoryScores.get(item.category) || 0) + 1);
      }
      for (const tag of item.tags) {
        tagScores.set(tag, (tagScores.get(tag) || 0) + 1);
      }
    }

    // Score items the user hasn't interacted with yet
    const candidates = allItems.filter((item) => !userItems.has(item.id));

    const scored = candidates.map((item) => {
      let score = 0;

      // Tag match
      for (const tag of item.tags) {
        score += (tagScores.get(tag) || 0) * 3;
      }

      // Type match
      score += (typeScores.get(item.type) || 0) * 2;

      // Category match
      if (item.category) {
        score += (categoryScores.get(item.category) || 0) * 2;
      }

      // Rating boost
      const rating = this.ratings.getRating(item.id);
      score += rating.average;

      // Downloads boost
      score += Math.log2(item.downloads + 1);

      return { ...item, _recommendationScore: Math.round(score * 100) / 100 };
    });

    scored.sort((a, b) => b._recommendationScore - a._recommendationScore);
    return scored.slice(0, Math.max(1, limit));
  }

  /**
   * Get items similar to a given item, based on tag overlap.
   *
   * @param {string} itemId
   * @param {number} [limit=10]
   * @returns {Array<object>} Similar catalog items with similarity score
   */
  getSimilar(itemId, limit = 10) {
    const source = this.catalog.getItem(itemId);
    if (!source) return [];

    const allItems = this.catalog.getAll();
    const candidates = allItems.filter((item) => item.id !== itemId);

    const scored = candidates.map((item) => {
      let score = 0;

      // Tag overlap (highest weight)
      score += _tagOverlap(source.tags, item.tags) * 5;

      // Same type bonus
      if (item.type === source.type) score += 3;

      // Same category bonus
      if (item.category && item.category === source.category) score += 2;

      // Rating and downloads as tie-breakers
      const rating = this.ratings.getRating(item.id);
      score += rating.average * 0.5;
      score += Math.log2(item.downloads + 1) * 0.5;

      return { ...item, _similarityScore: Math.round(score * 100) / 100 };
    });

    // Only include items with at least some similarity
    const relevant = scored.filter((item) => item._similarityScore > 0);

    relevant.sort((a, b) => b._similarityScore - a._similarityScore);
    return relevant.slice(0, Math.max(1, limit));
  }

  /**
   * Browse items by category.
   *
   * @param {string} category - One of the CATEGORIES constants
   * @param {object} [options]
   * @param {string} [options.sortBy] - "rating" | "downloads" | "name" | "updatedAt"
   * @param {number} [options.limit]
   * @returns {Array<object>}
   */
  getByCategory(category, options = {}) {
    if (!CATEGORIES.includes(category)) {
      return [];
    }

    let items = this.catalog.list({ category });
    const sortBy = options.sortBy || "rating";

    if (sortBy === "rating") {
      items = items.map((item) => {
        const rating = this.ratings.getRating(item.id);
        return { ...item, _ratingAvg: rating.average, _ratingCount: rating.count };
      });
      items.sort((a, b) => {
        if (b._ratingAvg !== a._ratingAvg) return b._ratingAvg - a._ratingAvg;
        return b.downloads - a.downloads;
      });
    } else if (sortBy === "downloads") {
      items.sort((a, b) => b.downloads - a.downloads);
    } else if (sortBy === "name") {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "updatedAt") {
      items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    const limit = options.limit || 0;
    if (limit > 0) {
      items = items.slice(0, limit);
    }

    return items;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Get comprehensive catalog statistics.
   *
   * @returns {object} { totalItems, byType, byCategory, totalRatings,
   *                     overallAverage, totalInteractions, uniqueUsers }
   */
  getStats() {
    const catalogStats = this.catalog.stats();
    const allItems = this.catalog.getAll();

    let totalDownloads = 0;
    for (const item of allItems) {
      totalDownloads += item.downloads;
    }

    // Count unique users
    const uniqueUsers = new Set();
    for (const event of this._events) {
      uniqueUsers.add(event.userId);
    }

    return {
      totalItems: catalogStats.total,
      byType: catalogStats.byType,
      byCategory: catalogStats.byCategory,
      totalDownloads,
      totalRatings: this.ratings.totalRatings(),
      overallAverage: this.ratings.overallAverage(),
      totalInteractions: this._events.length,
      uniqueUsers: uniqueUsers.size,
    };
  }
}

DiscoveryEngine.CATEGORIES = CATEGORIES;

module.exports = { DiscoveryEngine, CATEGORIES };
