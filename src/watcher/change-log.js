"use strict";

/**
 * Records and queries file change events over time.
 * Supports structured querying, per-file histories, summaries,
 * and size management via pruning.
 */
class ChangeLog {
  constructor(opts = {}) {
    this._maxEntries = opts.maxEntries || 10000;
    this._entries = [];
    // Secondary index: filePath => array of entry indices
    this._fileIndex = new Map();
  }

  // ─── public API ────────────────────────────────────────

  /**
   * Record a file change event.
   * @param {{ filePath: string, event: string, source?: string, metadata?: object }} event
   * @returns {number} index of the recorded entry
   */
  record(event) {
    if (!event || typeof event.filePath !== 'string' || !event.filePath) {
      throw new Error('Event must have a non-empty filePath');
    }

    const entry = {
      index: this._entries.length,
      filePath: event.filePath,
      event: event.event || 'change',
      source: event.source || 'unknown',
      metadata: event.metadata ? { ...event.metadata } : {},
      timestamp: new Date().toISOString(),
    };

    this._entries.push(entry);

    // Update file index
    if (!this._fileIndex.has(entry.filePath)) {
      this._fileIndex.set(entry.filePath, []);
    }
    this._fileIndex.get(entry.filePath).push(entry.index);

    // Trim if over max
    while (this._entries.length > this._maxEntries) {
      this._removeOldest();
    }

    return entry.index;
  }

  /**
   * Query changes with optional filters.
   * @param {{
   *   filePath?: string,
   *   event?: string|string[],
   *   source?: string,
   *   since?: string|Date,
   *   until?: string|Date,
   *   limit?: number,
   *   offset?: number
   * }} [options]
   * @returns {object[]} matching entries
   */
  query(options = {}) {
    let results = [...this._entries];

    // Filter by filePath
    if (options.filePath) {
      const indices = this._fileIndex.get(options.filePath) || [];
      results = indices.map((i) => this._entries[i]);
    }

    // Filter by event type(s)
    if (options.event) {
      const types = Array.isArray(options.event) ? options.event : [options.event];
      const set = new Set(types);
      results = results.filter((e) => set.has(e.event));
    }

    // Filter by source
    if (options.source) {
      results = results.filter((e) => e.source === options.source);
    }

    // Filter by time range
    if (options.since) {
      const sinceMs = this._toTimestamp(options.since);
      results = results.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
    }
    if (options.until) {
      const untilMs = this._toTimestamp(options.until);
      results = results.filter((e) => new Date(e.timestamp).getTime() <= untilMs);
    }

    // Sort by timestamp ascending (oldest first)
    results.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Pagination
    const offset = options.offset || 0;
    const limit = options.limit || results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get all changes that occurred after a given timestamp.
   * @param {string|Date} timestamp
   * @returns {object[]}
   */
  getChangesSince(timestamp) {
    return this.query({ since: timestamp });
  }

  /**
   * Get the full change history for a specific file.
   * @param {string} filePath
   * @returns {object[]}
   */
  getFileHistory(filePath) {
    const indices = this._fileIndex.get(filePath) || [];
    return indices
      .map((i) => this._entries[i])
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Get a summary of recent changes.
   * @param {string|Date} [since] - only count changes after this time
   * @returns {{
   *   total: number,
   *   byEvent: object,
   *   bySource: object,
   *   filesAffected: number,
   *   since?: string
   * }}
   */
  getSummary(since) {
    const entries = since ? this.getChangesSince(since) : this._entries;

    const byEvent = {};
    const bySource = {};
    const files = new Set();

    for (const entry of entries) {
      byEvent[entry.event] = (byEvent[entry.event] || 0) + 1;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      files.add(entry.filePath);
    }

    return {
      total: entries.length,
      byEvent,
      bySource,
      filesAffected: files.size,
      ...(since ? { since: typeof since === 'string' ? since : since.toISOString() } : {}),
    };
  }

  /**
   * Remove all entries from the log.
   */
  clear() {
    this._entries = [];
    this._fileIndex.clear();
  }

  /**
   * Remove entries older than maxAge milliseconds (default: 1 hour).
   * @param {number} [maxAge] - max age in milliseconds
   * @returns {number} number of entries removed
   */
  prune(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    const keep = [];
    const newIndex = new Map();

    for (const entry of this._entries) {
      if (new Date(entry.timestamp).getTime() >= cutoff) {
        const oldIndex = entry.index;
        entry.index = keep.length;
        keep.push(entry);

        // Rebuild file index
        if (!newIndex.has(entry.filePath)) {
          newIndex.set(entry.filePath, []);
        }
        newIndex.get(entry.filePath).push(entry.index);
      }
    }

    const removed = this._entries.length - keep.length;
    this._entries = keep;
    this._fileIndex = newIndex;
    return removed;
  }

  /**
   * Total number of entries currently stored.
   * @returns {number}
   */
  get count() {
    return this._entries.length;
  }

  // ─── internals ─────────────────────────────────────────

  _removeOldest() {
    const removed = this._entries.shift();
    if (removed && this._fileIndex.has(removed.filePath)) {
      const indices = this._fileIndex.get(removed.filePath);
      // Remove the entry's original index (0) and shift remaining indices down
      const filtered = indices.filter((i) => i !== 0);
      if (filtered.length === 0) {
        this._fileIndex.delete(removed.filePath);
      } else {
        this._fileIndex.set(removed.filePath, filtered.map((i) => i - 1));
      }
    }
    // Re-index all entries
    for (let i = 0; i < this._entries.length; i++) {
      this._entries[i].index = i;
    }
  }

  _toTimestamp(val) {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const ms = Date.parse(val);
      if (!isNaN(ms)) return ms;
    }
    if (typeof val === 'number') return val;
    return 0;
  }
}

module.exports = { ChangeLog };
