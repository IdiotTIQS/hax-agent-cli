/**
 * NotificationAggregator — smart notification grouping and digest
 * generation.
 *
 * Aggregates notifications by source, type, severity, and time window,
 * then produces periodic digests at configurable frequencies.
 *
 *   const agg = new NotificationAggregator();
 *   agg.aggregate([n1, n2, n3]);
 *   agg.getDigest({ frequency: 'hourly' });
 *   agg.shouldDeliver(notification);
 */
"use strict";

// ---- Constants ---------------------------------------------------------------

const SEVERITY_RANKS = { info: 0, warn: 1, error: 2, critical: 3 };

const DIGEST_FREQUENCIES = {
  immediate: 0,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// ---- NotificationAggregator --------------------------------------------------

class NotificationAggregator {
  /**
   * @param {object} [options]
   * @param {string} [options.defaultFrequency='immediate'] — Default digest frequency
   * @param {number} [options.maxBufferSize=1000] — Max notifications to buffer
   * @param {number} [options.groupWindowMs=300000] — 5 min default grouping window
   * @param {boolean} [options.deduplicate=true] — Deduplicate by title+message
   * @param {Function} [options.groupKeyFn] — Custom grouping key function: (n) => string
   */
  constructor(options = {}) {
    this._buffer = [];                   // all received notifications
    this._suppressed = [];               // suppressed notifications
    this._groups = new Map();            // groupKey -> notifications[]
    this._defaultFrequency = validateFrequency(options.defaultFrequency, "immediate");
    this._maxBufferSize = positiveInt(options.maxBufferSize, 1000);
    this._groupWindowMs = positiveInt(options.groupWindowMs, 300000);
    this._deduplicate = options.deduplicate !== false;
    this._groupKeyFn = options.groupKeyFn || null;
    this._lastDigestAt = null;
    this._digestHistory = [];
  }

  // -- Aggregation ------------------------------------------------------------

  /**
   * Aggregate one or more notifications into groups.
   *
   * Returns the groups that the notifications were assigned to.
   *
   * @param {object|object[]} notifications — Single or array of notification objects
   * @returns {object} { groups: Map<string, object[]>, groupCount: number, newGroups: string[] }
   */
  aggregate(notifications) {
    const list = Array.isArray(notifications) ? notifications : [notifications];
    if (list.length === 0) {
      return { groups: this._groups, groupCount: this._groups.size, newGroups: [] };
    }

    const newGroupKeys = new Set();

    for (const n of list) {
      if (!n || typeof n !== "object") continue;

      // Deduplicate
      if (this._deduplicate && this._isDuplicate(n)) {
        this._suppressed.push({
          notification: n,
          reason: "duplicate",
          timestamp: Date.now(),
        });
        continue;
      }

      // Add to buffer (with timestamp if missing)
      const enriched = {
        ...n,
        _receivedAt: n._receivedAt || Date.now(),
      };
      this._buffer.push(enriched);
      this._trimBuffer();

      // Assign to group
      const key = this._computeGroupKey(enriched);
      if (!this._groups.has(key)) {
        this._groups.set(key, []);
        newGroupKeys.add(key);
      }
      this._groups.get(key).push(enriched);

      // Prune groups that have aged out of the grouping window
      this._pruneGroups();
    }

    return {
      groups: this._groups,
      groupCount: this._groups.size,
      newGroups: Array.from(newGroupKeys),
    };
  }

  /**
   * Get a digest for a given time window or frequency.
   *
   * @param {object} [options]
   * @param {string} [options.frequency] — "immediate", "hourly", "daily", "weekly"
   * @param {number} [options.since] — Epoch ms, overrides frequency
   * @param {number} [options.until=Date.now()] — End of window
   * @param {number} [options.maxGroups=20] — Max groups to include in digest
   * @returns {object} Digest summary
   */
  getDigest(options = {}) {
    const freq = options.frequency || this._defaultFrequency;
    const windowMs = DIGEST_FREQUENCIES[freq] || DIGEST_FREQUENCIES.immediate;
    const until = options.until || Date.now();
    const since = options.since || (until - windowMs);
    const maxGroups = positiveInt(options.maxGroups, 20);

    // Filter notifications within the time window
    const inWindow = this._buffer.filter(
      (n) => n._receivedAt >= since && n._receivedAt <= until
    );

    // Group in-window notifications
    const digestGroups = new Map();
    for (const n of inWindow) {
      const key = this._computeGroupKey(n);
      if (!digestGroups.has(key)) {
        digestGroups.set(key, []);
      }
      digestGroups.get(key).push(n);
    }

    // Build digest entries sorted by count (desc)
    const entries = Array.from(digestGroups.entries())
      .map(([key, items]) => ({
        key,
        count: items.length,
        latestTimestamp: Math.max(...items.map((n) => n._receivedAt)),
        severities: countSeverities(items),
        sources: uniqueValues(items, "source"),
        types: uniqueValues(items, "type"),
        sample: items[items.length - 1],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxGroups);

    const digest = {
      frequency: freq,
      windowMs,
      since,
      until,
      totalNotifications: inWindow.length,
      totalGroups: digestGroups.size,
      displayedGroups: entries.length,
      groups: entries,
      generatedAt: Date.now(),
    };

    this._lastDigestAt = digest.generatedAt;
    this._digestHistory.push(digest);

    // Keep digest history bounded
    if (this._digestHistory.length > 50) {
      this._digestHistory = this._digestHistory.slice(-50);
    }

    return digest;
  }

  /**
   * Get suppressed notifications.
   *
   * @param {object} [options]
   * @param {string} [options.reason] — Filter by suppression reason
   * @param {number} [options.since] — Only suppressions since this timestamp
   * @returns {object[]}
   */
  getSuppressed(options = {}) {
    let result = [...this._suppressed];

    if (options.reason) {
      result = result.filter((s) => s.reason === options.reason);
    }

    if (options.since) {
      result = result.filter((s) => s.timestamp >= options.since);
    }

    return result;
  }

  /**
   * Clear suppressed notifications.
   */
  clearSuppressed() {
    this._suppressed.length = 0;
  }

  /**
   * Decide whether a notification should be delivered, considering
   * deduplication, frequency, and severity.
   *
   * @param {object} notification
   * @param {object} [options]
   * @param {number} [options.minSeverity=0] — Minimum severity rank to allow
   * @param {number} [options.cooldownMs=0] — Minimum ms since last similar notification
   * @param {number} [options.maxPerWindow=0] — Max notifications in window (0 = unlimited)
   * @param {number} [options.windowMs=60000] — Window for maxPerWindow
   * @returns {object} { deliver: boolean, reason: string }
   */
  shouldDeliver(notification, options = {}) {
    if (!notification || typeof notification !== "object") {
      return { deliver: false, reason: "Invalid notification" };
    }

    const now = Date.now();
    const minRank = positiveInt(options.minSeverity, 0);

    // Severity check
    const sevRank = SEVERITY_RANKS[String(notification.severity || "info").toLowerCase()] ?? 0;
    if (sevRank < minRank) {
      return {
        deliver: false,
        reason: `Severity rank ${sevRank} is below minimum ${minRank}`,
      };
    }

    // Duplicate check
    if (this._deduplicate && this._isDuplicate(notification)) {
      return { deliver: false, reason: "Duplicate notification" };
    }

    // Cooldown check
    if (options.cooldownMs > 0) {
      const key = this._computeGroupKey(notification);
      const group = this._groups.get(key) || [];
      if (group.length > 0) {
        const lastTime = Math.max(...group.map((n) => n._receivedAt));
        if (now - lastTime < options.cooldownMs) {
          return {
            deliver: false,
            reason: `Cooldown active: last similar ${now - lastTime}ms ago (minimum ${options.cooldownMs}ms)`,
          };
        }
      }
    }

    // Max per window check
    if (options.maxPerWindow > 0) {
      const windowMs = positiveInt(options.windowMs, 60000);
      const key = this._computeGroupKey(notification);
      const group = this._groups.get(key) || [];
      const recentCount = group.filter((n) => n._receivedAt >= now - windowMs).length;
      if (recentCount >= options.maxPerWindow) {
        return {
          deliver: false,
          reason: `Max per window reached: ${recentCount}/${options.maxPerWindow} in last ${windowMs}ms`,
        };
      }
    }

    return { deliver: true, reason: "Notification approved for delivery" };
  }

  /**
   * Aggregate notifications specifically by source.
   *
   * @param {object[]} [notifications] — If omitted, uses the buffer
   * @returns {Map<string, object[]>} source -> notifications
   */
  aggregateBySource(notifications) {
    const list = notifications || this._buffer;
    return groupBy(list, (n) => n.source || "unknown");
  }

  /**
   * Aggregate notifications specifically by type.
   *
   * @param {object[]} [notifications]
   * @returns {Map<string, object[]>} type -> notifications
   */
  aggregateByType(notifications) {
    const list = notifications || this._buffer;
    return groupBy(list, (n) => n.type || "unknown");
  }

  /**
   * Aggregate notifications specifically by severity.
   *
   * @param {object[]} [notifications]
   * @returns {Map<string, object[]>} severity -> notifications
   */
  aggregateBySeverity(notifications) {
    const list = notifications || this._buffer;
    return groupBy(list, (n) => String(n.severity || "info").toLowerCase());
  }

  /**
   * Aggregate notifications by time window chunks.
   *
   * @param {object[]} [notifications]
   * @param {number} [chunkMs=60000] — Chunk size in ms (default 1 minute)
   * @returns {Map<string, object[]>} timeChunk -> notifications
   */
  aggregateByTimeWindow(notifications, chunkMs = 60000) {
    const list = notifications || this._buffer;
    const chunked = new Map();

    for (const n of list) {
      const ts = n._receivedAt || 0;
      const chunkStart = Math.floor(ts / chunkMs) * chunkMs;
      const key = new Date(chunkStart).toISOString();

      if (!chunked.has(key)) {
        chunked.set(key, []);
      }
      chunked.get(key).push(n);
    }

    return chunked;
  }

  // -- Buffer management -------------------------------------------------------

  /**
   * Get all buffered notifications.
   * @param {number} [limit]
   * @returns {object[]}
   */
  getBuffer(limit) {
    if (limit !== undefined) {
      return this._buffer.slice(-limit);
    }
    return [...this._buffer];
  }

  /**
   * Clear the notification buffer and groups.
   */
  clear() {
    this._buffer.length = 0;
    this._groups.clear();
    this._suppressed.length = 0;
  }

  /**
   * Number of buffered notifications.
   * @returns {number}
   */
  get bufferSize() {
    return this._buffer.length;
  }

  /**
   * Number of active groups.
   * @returns {number}
   */
  get groupCount() {
    return this._groups.size;
  }

  /**
   * Number of suppressed notifications.
   * @returns {number}
   */
  get suppressedCount() {
    return this._suppressed.length;
  }

  /**
   * Get all groups.
   * @returns {Map<string, object[]>}
   */
  getGroups() {
    return this._groups;
  }

  // -- Digest history ----------------------------------------------------------

  /**
   * Get digest history.
   * @returns {object[]}
   */
  getDigestHistory() {
    return [...this._digestHistory];
  }

  // -- Internal helpers --------------------------------------------------------

  /** @private */
  _computeGroupKey(notification) {
    if (this._groupKeyFn && typeof this._groupKeyFn === "function") {
      return this._groupKeyFn(notification);
    }

    // Default: composite key of source + type + severity
    const source = notification.source || "__nosource__";
    const type = notification.type || "__notype__";
    const severity = String(notification.severity || "info").toLowerCase();
    return `${source}::${type}::${severity}`;
  }

  /** @private */
  _isDuplicate(notification) {
    // Check if a notification with the same title and message already
    // exists in the buffer
    const title = notification.title || "";
    const message = notification.message || "";
    if (!title && !message) return false;

    return this._buffer.some(
      (n) => n.title === title && n.message === message
    );
  }

  /** @private */
  _trimBuffer() {
    while (this._buffer.length > this._maxBufferSize) {
      const removed = this._buffer.shift();
      // Optionally remove from groups (best-effort)
      for (const [key, group] of this._groups) {
        const idx = group.indexOf(removed);
        if (idx !== -1) {
          group.splice(idx, 1);
          if (group.length === 0) {
            this._groups.delete(key);
          }
          break;
        }
      }
    }
  }

  /** @private */
  _pruneGroups() {
    const cutoff = Date.now() - this._groupWindowMs;
    for (const [key, group] of this._groups) {
      const filtered = group.filter((n) => n._receivedAt >= cutoff);
      if (filtered.length === 0) {
        this._groups.delete(key);
      } else if (filtered.length !== group.length) {
        this._groups.set(key, filtered);
      }
    }
  }
}

// ---- Helpers ---------------------------------------------------------------

function validateFrequency(value, fallback) {
  if (value && DIGEST_FREQUENCIES.hasOwnProperty(value)) return value;
  return fallback;
}

function positiveInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = String(keyFn(item));
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  }
  return map;
}

function countSeverities(items) {
  const counts = {};
  for (const item of items) {
    const sev = String(item.severity || "info").toLowerCase();
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return counts;
}

function uniqueValues(items, field) {
  const values = new Set();
  for (const item of items) {
    if (item[field] !== undefined && item[field] !== null) {
      values.add(item[field]);
    }
  }
  return Array.from(values);
}

// ---- Exports ---------------------------------------------------------------

module.exports = {
  NotificationAggregator,
  DIGEST_FREQUENCIES,
};
