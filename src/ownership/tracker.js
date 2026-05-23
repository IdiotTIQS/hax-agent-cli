"use strict";

/**
 * Tracks code ownership by recording file changes, identifying primary owners,
 * listing contributors, and suggesting reviewers based on contribution history.
 */
class OwnershipTracker {
  constructor(opts = {}) {
    this._maxChanges = opts.maxChanges || 50000;
    this._changes = [];
    // filePath -> Map<author, changeCount>
    this._fileAuthorIndex = new Map();
    // author -> Set<filePath>
    this._authorFileIndex = new Map();
    // filePath -> sorted contributor array (cached, cleared on record)
    this._contributorCache = new Map();
    // author -> sorted file array (cached, cleared on record)
    this._ownedByAuthorCache = null;
  }

  // ─── public API ──────────────────────────────────────────

  /**
   * Record a file change event.
   * @param {string} filePath - path to the changed file
   * @param {string} author - agent or user who made the change
   * @param {{
   *   type?: string,
   *   lines?: number[] | { start: number, end: number },
   *   message?: string,
   *   timestamp?: string
   * }} change - details about the change
   * @returns {number} index of the recorded change
   */
  recordChange(filePath, author, change = {}) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("filePath must be a non-empty string");
    }
    if (!author || typeof author !== "string") {
      throw new Error("author must be a non-empty string");
    }

    const normalizedPath = _normalize(filePath);
    const entry = {
      index: this._changes.length,
      filePath: normalizedPath,
      author,
      type: change.type || "modified",
      lines: _normalizeLines(change.lines),
      message: change.message || "",
      timestamp: change.timestamp || new Date().toISOString(),
    };

    this._changes.push(entry);

    // Update file-author index
    if (!this._fileAuthorIndex.has(normalizedPath)) {
      this._fileAuthorIndex.set(normalizedPath, new Map());
    }
    const authorMap = this._fileAuthorIndex.get(normalizedPath);
    authorMap.set(author, (authorMap.get(author) || 0) + 1);

    // Update author-file index
    if (!this._authorFileIndex.has(author)) {
      this._authorFileIndex.set(author, new Set());
    }
    this._authorFileIndex.get(author).add(normalizedPath);

    // Invalidate caches
    this._contributorCache.delete(normalizedPath);
    this._ownedByAuthorCache = null;

    // Trim if over max
    while (this._changes.length > this._maxChanges) {
      this._removeOldest();
    }

    return entry.index;
  }

  /**
   * Get the primary owner of a file (author with the most changes).
   * @param {string} filePath
   * @returns {{ author: string, changeCount: number, share: number } | null}
   */
  getOwner(filePath) {
    const normalizedPath = _normalize(filePath);
    const authorMap = this._fileAuthorIndex.get(normalizedPath);
    if (!authorMap || authorMap.size === 0) return null;

    let topAuthor = null;
    let topCount = 0;
    let total = 0;

    for (const [author, count] of authorMap) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topAuthor = author;
      }
    }

    if (!topAuthor) return null;

    return {
      author: topAuthor,
      changeCount: topCount,
      share: total > 0 ? Math.round((topCount / total) * 10000) / 10000 : 0,
    };
  }

  /**
   * Get all contributors for a file, sorted by contribution count (descending).
   * @param {string} filePath
   * @returns {Array<{ author: string, changeCount: number, share: number }>}
   */
  getContributors(filePath) {
    const normalizedPath = _normalize(filePath);
    if (this._contributorCache.has(normalizedPath)) {
      return this._contributorCache.get(normalizedPath);
    }

    const authorMap = this._fileAuthorIndex.get(normalizedPath);
    if (!authorMap || authorMap.size === 0) return [];

    let total = 0;
    for (const count of authorMap.values()) {
      total += count;
    }

    const contributors = [];
    for (const [author, count] of authorMap) {
      contributors.push({
        author,
        changeCount: count,
        share: total > 0 ? Math.round((count / total) * 10000) / 10000 : 0,
      });
    }

    contributors.sort((a, b) => b.changeCount - a.changeCount);
    this._contributorCache.set(normalizedPath, contributors);
    return contributors;
  }

  /**
   * Get all files where the given author is the primary owner.
   * @param {string} author
   * @returns {Array<{ filePath: string, changeCount: number, share: number }>}
   */
  getOwnedFiles(author) {
    const files = this._authorFileIndex.get(author);
    if (!files || files.size === 0) return [];

    const owned = [];

    for (const filePath of files) {
      const owner = this.getOwner(filePath);
      if (owner && owner.author === author) {
        owned.push({
          filePath,
          changeCount: owner.changeCount,
          share: owner.share,
        });
      }
    }

    owned.sort((a, b) => b.changeCount - a.changeCount);
    return owned;
  }

  /**
   * Get a complete mapping of every file to its primary owner.
   * @returns {Map<string, { author: string, changeCount: number, share: number }>}
   */
  getOwnershipMap() {
    const map = new Map();

    for (const filePath of this._fileAuthorIndex.keys()) {
      const owner = this.getOwner(filePath);
      if (owner) {
        map.set(filePath, owner);
      }
    }

    return map;
  }

  /**
   * Suggest reviewers for a set of files based on ownership and contribution history.
   * @param {string[]} files - list of file paths to find reviewers for
   * @returns {Array<{ author: string, score: number, filesCovered: number, ownedFiles: number }>}
   */
  suggestReviewers(files) {
    if (!files || files.length === 0) return [];

    const normalized = files.map((f) => _normalize(f));
    const authorScores = new Map();

    for (const filePath of normalized) {
      const contributors = this.getContributors(filePath);
      const weight = contributors.length > 0 ? 1 : 0;

      for (let i = 0; i < contributors.length; i++) {
        const { author, share } = contributors[i];
        // Score: primary owner gets full weight, secondary gets half, etc.
        const positionBonus = i === 0 ? 1.0 : 1.0 / (i + 1);
        const fileScore = share * positionBonus * weight;

        if (!authorScores.has(author)) {
          authorScores.set(author, { totalScore: 0, filesCovered: new Set(), ownedFiles: 0 });
        }
        const entry = authorScores.get(author);
        entry.totalScore += fileScore;
        entry.filesCovered.add(filePath);
        if (i === 0) entry.ownedFiles++;
      }
    }

    const results = [];
    for (const [author, { totalScore, filesCovered, ownedFiles }] of authorScores) {
      results.push({
        author,
        score: Math.round(totalScore * 10000) / 10000,
        filesCovered: filesCovered.size,
        ownedFiles,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Get all files tracked by this instance.
   * @returns {string[]}
   */
  get trackedFiles() {
    return Array.from(this._fileAuthorIndex.keys());
  }

  /**
   * Get all authors tracked by this instance.
   * @returns {string[]}
   */
  get trackedAuthors() {
    return Array.from(this._authorFileIndex.keys());
  }

  /**
   * Get the total number of changes recorded.
   * @returns {number}
   */
  get changeCount() {
    return this._changes.length;
  }

  /**
   * Get all changes for a specific file.
   * @param {string} filePath
   * @returns {object[]}
   */
  getFileChanges(filePath) {
    const normalizedPath = _normalize(filePath);
    return this._changes.filter((c) => c.filePath === normalizedPath);
  }

  /**
   * Get all changes made by a specific author.
   * @param {string} author
   * @returns {object[]}
   */
  getAuthorChanges(author) {
    return this._changes.filter((c) => c.author === author);
  }

  /**
   * Clear all tracked data.
   */
  clear() {
    this._changes = [];
    this._fileAuthorIndex.clear();
    this._authorFileIndex.clear();
    this._contributorCache.clear();
    this._ownedByAuthorCache = null;
  }

  // ─── internals ───────────────────────────────────────────

  _removeOldest() {
    const removed = this._changes.shift();
    if (!removed) return;

    // Update file-author index
    const authorMap = this._fileAuthorIndex.get(removed.filePath);
    if (authorMap) {
      const count = authorMap.get(removed.author);
      if (count !== undefined) {
        if (count <= 1) {
          authorMap.delete(removed.author);
        } else {
          authorMap.set(removed.author, count - 1);
        }
      }
      if (authorMap.size === 0) {
        this._fileAuthorIndex.delete(removed.filePath);
      }
    }

    // Update author-file index
    const fileSet = this._authorFileIndex.get(removed.author);
    if (fileSet) {
      // Check if author still has changes for this file
      const remaining = this._changes.filter(
        (c) => c.filePath === removed.filePath && c.author === removed.author
      );
      if (remaining.length === 0) {
        fileSet.delete(removed.filePath);
      }
      if (fileSet.size === 0) {
        this._authorFileIndex.delete(removed.author);
      }
    }

    // Re-index
    for (let i = 0; i < this._changes.length; i++) {
      this._changes[i].index = i;
    }

    // Invalidate caches
    this._contributorCache.delete(removed.filePath);
    this._ownedByAuthorCache = null;
  }
}

// ─── module helpers ───────────────────────────────────────

function _normalize(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function _normalizeLines(lines) {
  if (!lines) return [];
  if (Array.isArray(lines)) return lines;
  if (typeof lines === "object" && lines.start !== undefined && lines.end !== undefined) {
    const result = [];
    for (let i = lines.start; i <= lines.end; i++) {
      result.push(i);
    }
    return result;
  }
  return [];
}

module.exports = { OwnershipTracker };
