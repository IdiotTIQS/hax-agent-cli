"use strict";

/**
 * PromptVersionControl — Tracks prompt versions over time with full history,
 * diffing, rollback, tagging, and performance-comparison capabilities.
 *
 *   const { PromptVersionControl } = require("./prompts/versioning");
 *   const pvc = new PromptVersionControl();
 *   const v1 = pvc.commit("You are a helpful assistant.", "Initial version");
 *   const v2 = pvc.commit("You are an expert developer.", "More specific role");
 *   pvc.diff(v1, v2);
 *   pvc.rollback(v1);
 *   pvc.tag(v2, "production");
 *   console.log(pvc.getHistory());
 */

const crypto = require("node:crypto");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short unique version ID.
 * @returns {string}
 */
function generateId() {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Simple line-based diff between two strings.
 * Returns an array of { type, value } chunks.
 *
 * @param {string} a  Old text
 * @param {string} b  New text
 * @returns {Array<{ type: "added"|"removed"|"unchanged", value: string }>}
 */
function lineDiff(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const result = [];

  // Compute LCS table
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce the diff
  const chunks = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      chunks.push({ type: "unchanged", value: aLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      chunks.push({ type: "added", value: bLines[j - 1] });
      j--;
    } else {
      chunks.push({ type: "removed", value: aLines[i - 1] });
      i--;
    }
  }

  // Reverse to get chronological order
  return chunks.reverse();
}

// ---------------------------------------------------------------------------
// PromptVersionControl
// ---------------------------------------------------------------------------

class PromptVersionControl {
  constructor() {
    /** @type {Map<string, object>}  id -> version record */
    this._versions = new Map();
    /** @type {Array<string>}  ordered version IDs (most recent last) */
    this._order = [];
    /** @type {Map<string, string>}  label -> version id */
    this._tags = new Map();
    /** @type {string|null}  current active version id */
    this._current = null;
  }

  // -----------------------------------------------------------------------
  // commit
  // -----------------------------------------------------------------------

  /**
   * Save a new prompt version.
   *
   * @param {string} prompt   The prompt content.
   * @param {string} message  A human-readable description of the change.
   * @param {object} [meta]   Optional metadata (author, score, tags, etc.).
   * @returns {string}        The version ID of the new snapshot.
   */
  commit(prompt, message, meta = {}) {
    if (typeof prompt !== "string") {
      throw new TypeError("commit: prompt must be a string");
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("commit: message must be a non-empty string");
    }

    const id = generateId();
    const parent = this._current;

    const entry = {
      id,
      parent,
      prompt,
      message,
      timestamp: new Date().toISOString(),
      meta: Object.freeze({ ...meta }),
    };

    this._versions.set(id, Object.freeze(entry));
    this._order.push(id);
    this._current = id;

    return id;
  }

  /**
   * Return the current (most recent) version ID.
   * @returns {string|null}
   */
  get current() {
    return this._current;
  }

  // -----------------------------------------------------------------------
  // diff
  // -----------------------------------------------------------------------

  /**
   * Show what changed between two versions.
   *
   * @param {string} v1  First version ID.
   * @param {string} v2  Second version ID.
   * @returns {object}   { from, to, addedLines, removedLines, unchangedLines, chunkCount, summary }
   */
  diff(v1, v2) {
    const r1 = this.getVersion(v1);
    const r2 = this.getVersion(v2);

    const chunks = lineDiff(r1.prompt, r2.prompt);

    const addedLines = chunks
      .filter((c) => c.type === "added")
      .map((c) => c.value);
    const removedLines = chunks
      .filter((c) => c.type === "removed")
      .map((c) => c.value);
    const unchangedLines = chunks
      .filter((c) => c.type === "unchanged")
      .map((c) => c.value);

    const totalChanges = addedLines.length + removedLines.length;
    const changeRatio = totalChanges / (totalChanges + unchangedLines.length || 1);

    let summary;
    if (totalChanges === 0) {
      summary = "No changes between versions.";
    } else if (changeRatio < 0.3) {
      summary = "Minor changes (less than 30%% of lines changed).";
    } else if (changeRatio < 0.6) {
      summary = "Moderate changes (30%%–60%% of lines changed).";
    } else {
      summary = "Major rewrite (more than 60%% of lines changed).";
    }

    return {
      from: v1,
      to: v2,
      addedLines,
      removedLines,
      unchangedLines,
      chunks,
      chunkCount: chunks.length,
      summary,
    };
  }

  // -----------------------------------------------------------------------
  // rollback
  // -----------------------------------------------------------------------

  /**
   * Revert the current pointer to an earlier version.
   *
   * This does NOT delete any versions; it only moves the `current` pointer.
   *
   * @param {string} version  Version ID to roll back to.
   * @returns {string}        The prompt content at that version.
   */
  rollback(version) {
    const entry = this.getVersion(version);
    if (!entry) {
      throw new Error(`rollback: version "${version}" not found`);
    }

    this._current = version;
    return entry.prompt;
  }

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------

  /**
   * Return the complete version history ordered chronologically.
   *
   * @returns {Array<object>}  Array of version entries.
   */
  getHistory() {
    return this._order.map((id) => this._versions.get(id));
  }

  // -----------------------------------------------------------------------
  // getVersion
  // -----------------------------------------------------------------------

  /**
   * Retrieve a specific version by ID.
   *
   * @param {string} id  Version ID.
   * @returns {object}   The version entry (frozen).
   * @throws {Error}     If the version ID is not found.
   */
  getVersion(id) {
    const entry = this._versions.get(id);
    if (!entry) {
      throw new Error(`getVersion: version "${id}" not found`);
    }
    return entry;
  }

  // -----------------------------------------------------------------------
  // comparePerformance
  // -----------------------------------------------------------------------

  /**
   * Compare the performance of two versions.
   *
   * Scores can come from `meta.score` on the version entry or be passed
   * explicitly via the `scores` map.
   *
   * @param {string} v1          First version ID.
   * @param {string} v2          Second version ID.
   * @param {object} [scores]    Optional map of version ID -> numeric score.
   * @returns {object}           { winner, winnerId, loser, loserId, delta, tie }
   */
  comparePerformance(v1, v2, scores = {}) {
    const entry1 = this.getVersion(v1);
    const entry2 = this.getVersion(v2);

    const score1 =
      typeof scores[v1] === "number"
        ? scores[v1]
        : typeof entry1.meta.score === "number"
          ? entry1.meta.score
          : null;

    const score2 =
      typeof scores[v2] === "number"
        ? scores[v2]
        : typeof entry2.meta.score === "number"
          ? entry2.meta.score
          : null;

    if (score1 === null || score2 === null) {
      return {
        winner: null,
        winnerId: null,
        loser: null,
        loserId: null,
        delta: null,
        tie: false,
        reason: "One or both versions have no score. Attach `meta.score` on commit or pass a `scores` map.",
      };
    }

    if (score1 === score2) {
      return {
        winner: null,
        winnerId: null,
        loser: null,
        loserId: null,
        delta: 0,
        tie: true,
        reason: null,
      };
    }

    const score1Wins = score1 > score2;
    return {
      winner: score1Wins ? entry1.prompt : entry2.prompt,
      winnerId: score1Wins ? v1 : v2,
      loser: score1Wins ? entry2.prompt : entry1.prompt,
      loserId: score1Wins ? v2 : v1,
      delta: Math.abs(score1 - score2),
      tie: false,
      reason: null,
    };
  }

  // -----------------------------------------------------------------------
  // tag
  // -----------------------------------------------------------------------

  /**
   * Tag a version with a label (e.g. "production", "experiment", "baseline").
   *
   * Tags are unique — setting the same tag on a different version replaces
   * the previous association.
   *
   * @param {string} version  Version ID to tag.
   * @param {string} label    Tag label.
   * @returns {this}          For chaining.
   */
  tag(version, label) {
    const entry = this.getVersion(version); // validates existence
    this._tags.set(label, version);
    return this;
  }

  /**
   * Get the version ID associated with a tag.
   *
   * @param {string} label  Tag label.
   * @returns {string|null}  Version ID, or null if the tag is not set.
   */
  getTagged(label) {
    return this._tags.get(label) || null;
  }

  /**
   * Return all tags and their version IDs.
   *
   * @returns {Map<string, string>}
   */
  getTags() {
    return new Map(this._tags);
  }

  /**
   * Return the total number of stored versions.
   *
   * @returns {number}
   */
  get count() {
    return this._versions.size;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PromptVersionControl,
};
