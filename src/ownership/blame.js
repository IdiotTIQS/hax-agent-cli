"use strict";

/**
 * Provides line-by-line attribution for files by analyzing recorded change history.
 * Simulates git-blame functionality using the OwnershipTracker's change log.
 */
class BlameEngine {
  /**
   * @param {import('./tracker').OwnershipTracker} tracker - an OwnershipTracker instance
   */
  constructor(tracker) {
    if (!tracker || typeof tracker.getFileChanges !== "function") {
      throw new Error("BlameEngine requires an OwnershipTracker instance");
    }
    this._tracker = tracker;
  }

  // ─── public API ──────────────────────────────────────────

  /**
   * Get line-by-line attribution for a file.
   * Returns an array where each element describes who last changed that line.
   * Lines are 1-indexed. Returns an empty array if no history exists.
   *
   * @param {string} filePath
   * @param {{ maxLines?: number }} [opts]
   * @returns {Array<{ line: number, author: string, timestamp: string, type: string }>}
   */
  blame(filePath, opts = {}) {
    const changes = this._tracker.getFileChanges(filePath);
    if (changes.length === 0) {
      if (opts.maxLines) {
        return _emptyLines(opts.maxLines);
      }
      return [];
    }

    // Sort changes by timestamp ascending
    const sorted = [...changes].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    // Build line attribution: lineNumber -> { author, timestamp, type }
    const lineMap = new Map();

    for (const change of sorted) {
      const lines = change.lines || [];
      if (lines.length === 0) {
        // Change affects all lines (no specific line info)
        // For simulated blame, mark all lines in range
        if (opts.maxLines) {
          for (let i = 1; i <= opts.maxLines; i++) {
            lineMap.set(i, {
              line: i,
              author: change.author,
              timestamp: change.timestamp,
              type: change.type,
              message: change.message,
            });
          }
        } else {
          // Unknown line range — clear and mark as unknown
          for (const key of lineMap.keys()) {
            lineMap.set(key, {
              line: key,
              author: change.author,
              timestamp: change.timestamp,
              type: change.type,
              message: change.message,
            });
          }
        }
      } else {
        for (const lineNum of lines) {
          lineMap.set(lineNum, {
            line: lineNum,
            author: change.author,
            timestamp: change.timestamp,
            type: change.type,
            message: change.message,
          });
        }
      }
    }

    // Convert to sorted array
    const result = [];
    if (opts.maxLines) {
      for (let i = 1; i <= opts.maxLines; i++) {
        if (lineMap.has(i)) {
          result.push(lineMap.get(i));
        } else {
          result.push({
            line: i,
            author: "unknown",
            timestamp: null,
            type: "unmodified",
          });
        }
      }
    } else {
      for (const entry of lineMap.values()) {
        result.push(entry);
      }
      result.sort((a, b) => a.line - b.line);
    }

    return result;
  }

  /**
   * Get the author who last modified a specific line.
   * @param {string} filePath
   * @param {number} line - 1-indexed line number
   * @returns {{ author: string, timestamp: string, type: string } | null}
   */
  getLastModified(filePath, line) {
    const blameLines = this.blame(filePath);
    const entry = blameLines.find((l) => l.line === line);
    if (!entry || entry.author === "unknown") return null;

    return {
      author: entry.author,
      timestamp: entry.timestamp,
      type: entry.type,
    };
  }

  /**
   * Get the complete change history for a specific line.
   * Returns all changes that affected this line, sorted chronologically.
   * @param {string} filePath
   * @param {number} line - 1-indexed line number
   * @returns {Array<{ author: string, timestamp: string, type: string, message: string }>}
   */
  getLineHistory(filePath, line) {
    const changes = this._tracker.getFileChanges(filePath);
    if (changes.length === 0) return [];

    const sorted = [...changes].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    const history = [];

    for (const change of sorted) {
      const lines = change.lines || [];
      if (lines.length === 0 || lines.includes(line)) {
        history.push({
          author: change.author,
          timestamp: change.timestamp,
          type: change.type,
          message: change.message,
          index: change.index,
        });
      }
    }

    return history;
  }

  /**
   * Get the complete change history for a file.
   * @param {string} filePath
   * @returns {Array<{ index: number, author: string, type: string, timestamp: string, message: string, lines: number[] }>}
   */
  getFileHistory(filePath) {
    const changes = this._tracker.getFileChanges(filePath);
    return [...changes]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map((c) => ({
        index: c.index,
        author: c.author,
        type: c.type,
        timestamp: c.timestamp,
        message: c.message,
        lines: c.lines || [],
      }));
  }

  /**
   * Get the most frequently changed files (hot files).
   * @param {number} [limit=10] - maximum number of files to return
   * @param {{ author?: string }} [opts] - optionally filter by author
   * @returns {Array<{ filePath: string, changeCount: number, lastModified: string, topContributors: string[] }>}
   */
  getHotFiles(limit = 10, opts = {}) {
    const fileCounts = new Map();

    let changes;
    if (opts.author) {
      changes = this._tracker.getAuthorChanges(opts.author);
    } else {
      const files = this._tracker.trackedFiles;
      for (const filePath of files) {
        const fileChanges = this._tracker.getFileChanges(filePath);
        for (const c of fileChanges) {
          changes = changes || [];
          changes.push(c);
        }
      }
    }

    // Collect directly from tracker's internal data
    for (const filePath of this._tracker.trackedFiles) {
      const contributors = this._tracker.getContributors(filePath);
      const fileChanges = this._tracker.getFileChanges(filePath);

      if (opts.author) {
        const authorChanges = fileChanges.filter((c) => c.author === opts.author);
        if (authorChanges.length > 0) {
          let lastMod = null;
          for (const c of fileChanges) {
            if (c.author === opts.author) {
              if (!lastMod || new Date(c.timestamp) > new Date(lastMod)) {
                lastMod = c.timestamp;
              }
            }
          }
          fileCounts.set(filePath, {
            changeCount: authorChanges.length,
            lastModified: lastMod,
            topContributors: contributors.slice(0, 3).map((c) => c.author),
          });
        }
      } else if (fileChanges.length > 0) {
        let lastMod = null;
        for (const c of fileChanges) {
          if (!lastMod || new Date(c.timestamp) > new Date(lastMod)) {
            lastMod = c.timestamp;
          }
        }
        fileCounts.set(filePath, {
          changeCount: fileChanges.length,
          lastModified: lastMod,
          topContributors: contributors.slice(0, 3).map((c) => c.author),
        });
      }
    }

    const sorted = Array.from(fileCounts.entries())
      .map(([filePath, data]) => ({
        filePath,
        ...data,
      }))
      .sort((a, b) => b.changeCount - a.changeCount);

    return sorted.slice(0, limit);
  }

  /**
   * Get files changed between two timestamps.
   * @param {string|Date} since
   * @param {string|Date} [until]
   * @returns {Array<{ filePath: string, changeCount: number, authors: string[] }>}
   */
  getFilesChangedBetween(since, until) {
    const sinceMs = _toTimestamp(since);
    const untilMs = until ? _toTimestamp(until) : Date.now();

    const fileData = new Map();

    for (const filePath of this._tracker.trackedFiles) {
      const changes = this._tracker.getFileChanges(filePath);
      const matching = changes.filter((c) => {
        const ts = new Date(c.timestamp).getTime();
        return ts >= sinceMs && ts <= untilMs;
      });

      if (matching.length > 0) {
        const authors = new Set(matching.map((c) => c.author));
        fileData.set(filePath, {
          filePath,
          changeCount: matching.length,
          authors: Array.from(authors),
        });
      }
    }

    return Array.from(fileData.values()).sort(
      (a, b) => b.changeCount - a.changeCount
    );
  }
}

// ─── module helpers ───────────────────────────────────────

function _emptyLines(maxLines) {
  const result = [];
  for (let i = 1; i <= maxLines; i++) {
    result.push({
      line: i,
      author: "unknown",
      timestamp: null,
      type: "unmodified",
    });
  }
  return result;
}

function _toTimestamp(val) {
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const ms = Date.parse(val);
    if (!isNaN(ms)) return ms;
  }
  if (typeof val === "number") return val;
  return 0;
}

module.exports = { BlameEngine };
