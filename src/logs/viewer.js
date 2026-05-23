'use strict';

const readline = require('node:readline');
const { ANSI, THEME } = require('../renderer');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TAIL_LINES = 10;
const DEFAULT_FOLLOW_INTERVAL_MS = 500;

const LEVEL_COLORS = Object.freeze({
  debug: ANSI.dim + ANSI.cyan,
  info: ANSI.brightBlue,
  warn: ANSI.brightYellow,
  error: ANSI.brightRed,
  critical: ANSI.brightRed + ANSI.bold + ANSI.bgRed + ANSI.white,
});

const LEVEL_WEIGHT = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape sequences from a string.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Pad a string to a given width, ANSI-aware.
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
function padAnsi(str, width) {
  const visible = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, width - visible));
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param {number|null} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m${secs}s`;
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ---------------------------------------------------------------------------
// LogViewer
// ---------------------------------------------------------------------------

/**
 * Formats and displays log entries with ANSI color coding, filtering,
 * highlighting, grouping, and statistical summarization.
 *
 * Usage:
 *   const viewer = new LogViewer({ theme: THEME, ansi: true });
 *   viewer.tail(20, entries);
 *   viewer.follow(source, (entry) => { process.stdout.write(viewer.format(entry)); });
 *   viewer.group(entries, 'level');
 *   const stats = viewer.summary(entries);
 */
class LogViewer {
  /**
   * @param {object} [options]
   * @param {object} [options.theme] - THEME object from renderer
   * @param {boolean} [options.ansi] - enable ANSI color output (default: true)
   * @param {boolean} [options.timestamps] - show timestamps (default: true)
   * @param {number} [options.maxMessageLength] - truncate long messages (default: 0 = no truncation)
   */
  constructor(options = {}) {
    this._theme = options.theme || THEME;
    this._ansi = options.ansi !== false;
    this._timestamps = options.timestamps !== false;
    this._maxMessageLength = Number.isSafeInteger(options.maxMessageLength) && options.maxMessageLength > 0
      ? options.maxMessageLength
      : 0;
  }

  // -------------------------------------------------------------------------
  // Display
  // -------------------------------------------------------------------------

  /**
   * Show the last N log entries.
   *
   * @param {number} n - number of entries to display
   * @param {object[]} entries - log entries to view
   * @returns {string} formatted output
   */
  tail(n, entries) {
    const count = Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_TAIL_LINES;
    const lastN = entries.slice(-count);
    return lastN.map((entry) => this.format(entry)).join('\n');
  }

  /**
   * Follow a log source for live streaming output (like tail -f).
   * Calls the callback with each new entry as it arrives.
   *
   * @param {object} source - a source object with a read() method
   * @param {function} callback - called with formatted string for each entry
   * @param {object} [options]
   * @param {number} [options.interval=500] - poll interval in ms
   * @param {AbortSignal} [options.signal] - signal to stop following
   * @returns {Promise<void>}
   */
  async follow(source, callback, options = {}) {
    const interval = Number.isSafeInteger(options.interval) && options.interval > 0
      ? options.interval
      : DEFAULT_FOLLOW_INTERVAL_MS;

    let seenCount = 0;

    const poll = async () => {
      try {
        const entries = typeof source.read === 'function' ? await source.read() : [];
        const newEntries = entries.slice(seenCount);
        for (const entry of newEntries) {
          callback(this.format(entry));
        }
        seenCount = entries.length;
      } catch (_) {
        // Best-effort — don't crash on read errors
      }
    };

    return new Promise((resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearInterval(timer);
          resolve();
        }, { once: true });
      }

      const timer = setInterval(async () => {
        try {
          await poll();
        } catch (err) {
          clearInterval(timer);
          reject(err);
        }
      }, interval);

      // Allow the timer to not keep the process alive if unref is supported
      if (timer.unref) {
        timer.unref();
      }

      // Do an immediate first poll
      poll().catch(reject);
    });
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  /**
   * Format a single log entry for display.
   *
   * @param {object} entry - log entry with timestamp, level, message, source
   * @returns {string} formatted line
   */
  format(entry) {
    if (!entry || typeof entry !== 'object') {
      return this._color(ANSI.dim, '[invalid entry]');
    }

    const parts = [];

    // Timestamp
    if (this._timestamps && entry.timestamp) {
      const ts = typeof entry.timestamp === 'string'
        ? entry.timestamp.replace('T', ' ').slice(0, 19)
        : entry.timestamp;
      parts.push(this._color(ANSI.dim, `[${ts}]`));
    }

    // Level badge
    const level = entry.level || 'info';
    const levelColor = LEVEL_COLORS[level] || ANSI.brightWhite;
    const levelBadge = level.toUpperCase().padEnd(5);
    parts.push(this._color(levelColor, levelBadge));

    // Source
    if (entry.source) {
      const src = truncate(entry.source, 12);
      parts.push(this._color(ANSI.dim + ANSI.italic, src.padEnd(12)));
    }

    // Message
    let message = entry.message || '';
    if (this._maxMessageLength > 0 && message.length > this._maxMessageLength) {
      message = truncate(message, this._maxMessageLength);
    }
    parts.push(message);

    // Session / tool info
    const extras = [];
    if (entry.sessionId) {
      extras.push(this._color(ANSI.dim, `sid:${truncate(entry.sessionId, 16)}`));
    }
    if (entry.toolName) {
      extras.push(this._color(ANSI.dim, entry.toolName));
    }
    if (entry.durationMs != null) {
      extras.push(this._color(ANSI.dim, formatDuration(entry.durationMs)));
    }
    if (entry.result === 'error') {
      extras.push(this._color(THEME.error, 'FAILED'));
    }
    if (extras.length > 0) {
      parts.push(extras.join(' '));
    }

    return parts.join(' ');
  }

  /**
   * Apply syntax highlighting patterns to a formatted entry string.
   *
   * @param {string} entryStr - the formatted entry string (already ANSI-colored)
   * @param {Array<{pattern: RegExp|string, color: string}>} patterns
   * @returns {string} highlighted version
   */
  highlight(entryStr, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return entryStr;
    }

    let result = entryStr;
    for (const { pattern, color } of patterns) {
      const ansiColor = color || THEME.accent;
      const regex = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(regex, (match) => `${ansiColor}${match}${ANSI.reset}`);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Grouping
  // -------------------------------------------------------------------------

  /**
   * Group log entries by a specified field.
   *
   * @param {object[]} entries - log entries
   * @param {'level'|'source'|'hour'|string} by - the field to group by
   * @returns {object} map of group key to array of entries
   */
  group(entries, by) {
    if (!Array.isArray(entries)) {
      throw new TypeError('group: entries must be an array');
    }

    const groups = new Map();

    for (const entry of entries) {
      let key;

      switch (by) {
        case 'level':
          key = entry.level || 'unknown';
          break;
        case 'source':
          key = entry.source || 'unknown';
          break;
        case 'hour':
          if (entry.timestamp) {
            const d = new Date(entry.timestamp);
            if (!isNaN(d.getTime())) {
              key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
            } else {
              key = 'invalid-date';
            }
          } else {
            key = 'no-timestamp';
          }
          break;
        default:
          // Group by any arbitrary field
          key = entry[by] != null ? String(entry[by]) : 'undefined';
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(entry);
    }

    return Object.fromEntries(groups);
  }

  /**
   * Generate a formatted display of grouped entries with counts.
   *
   * @param {object[]} entries - log entries
   * @param {'level'|'source'|'hour'|string} by
   * @returns {string} formatted grouped view
   */
  groupDisplay(entries, by) {
    const groups = this.group(entries, by);
    const lines = [];

    const label = by.charAt(0).toUpperCase() + by.slice(1);
    lines.push(this._color(THEME.heading, `\n=== Logs by ${label} ===\n`));

    const sortedKeys = Object.keys(groups).sort();
    for (const key of sortedKeys) {
      const group = groups[key];
      const count = group.length;
      const counts = {};
      for (const entry of group) {
        const lvl = entry.level || 'unknown';
        counts[lvl] = (counts[lvl] || 0) + 1;
      }
      const levelSummary = Object.entries(counts)
        .map(([lvl, c]) => `${lvl}:${c}`)
        .join(', ');

      lines.push(`${padAnsi(this._color(THEME.bold, key), 30)} ${count} entries  (${levelSummary})`);
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Summary / Statistics
  // -------------------------------------------------------------------------

  /**
   * Generate a statistical summary of a set of log entries.
   *
   * @param {object[]} entries - log entries to analyze
   * @returns {object} summary statistics
   */
  summary(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError('summary: entries must be an array');
    }

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        levelBreakdown: {},
        sourceBreakdown: {},
        toolBreakdown: {},
        errorCount: 0,
        warnCount: 0,
        timeRange: { earliest: null, latest: null },
        avgDurationMs: 0,
      };
    }

    const levelBreakdown = {};
    const sourceBreakdown = {};
    const toolBreakdown = {};
    let errorCount = 0;
    let warnCount = 0;
    let earliest = null;
    let latest = null;
    let durations = [];
    let sessionIds = new Set();

    for (const entry of entries) {
      // Level counts
      const level = entry.level || 'unknown';
      levelBreakdown[level] = (levelBreakdown[level] || 0) + 1;
      if (level === 'error' || level === 'critical') errorCount += 1;
      if (level === 'warn') warnCount += 1;

      // Source counts
      const source = entry.source || 'unknown';
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;

      // Tool name counts
      if (entry.toolName) {
        toolBreakdown[entry.toolName] = (toolBreakdown[entry.toolName] || 0) + 1;
      }

      // Time range
      if (entry.timestamp) {
        const ts = new Date(entry.timestamp).getTime();
        if (!isNaN(ts)) {
          if (earliest === null || ts < earliest) earliest = ts;
          if (latest === null || ts > latest) latest = ts;
        }
      }

      // Duration tracking
      if (entry.durationMs != null) {
        durations.push(entry.durationMs);
      }

      // Session tracking
      if (entry.sessionId) {
        sessionIds.add(entry.sessionId);
      }
    }

    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      totalEntries: entries.length,
      levelBreakdown,
      sourceBreakdown,
      toolBreakdown,
      errorCount,
      warnCount,
      timeRange: {
        earliest: earliest ? new Date(earliest).toISOString() : null,
        latest: latest ? new Date(latest).toISOString() : null,
      },
      topTools: Object.entries(toolBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      sessionIds: sessionIds.size,
      avgDurationMs,
      errorRate: entries.length > 0
        ? ((errorCount / entries.length) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  /**
   * Render a summary as a formatted display string.
   *
   * @param {object[]} entries
   * @returns {string} formatted summary
   */
  summaryDisplay(entries) {
    const stats = this.summary(entries);
    const lines = [];

    lines.push(this._color(THEME.heading, '=== Log Summary ===\n'));

    lines.push(`Total Entries:     ${stats.totalEntries}`);
    lines.push(`Errors:            ${stats.errorCount} (${stats.errorRate})`);
    lines.push(`Warnings:          ${stats.warnCount}`);
    lines.push(`Unique Sessions:   ${stats.sessionIds}`);
    lines.push(`Avg Duration:      ${stats.avgDurationMs > 0 ? formatDuration(stats.avgDurationMs) : 'N/A'}`);

    if (stats.timeRange.earliest) {
      lines.push(`Time Range:        ${stats.timeRange.earliest} -> ${stats.timeRange.latest}`);
    }

    // Level breakdown
    lines.push(this._color(THEME.dim, '\n  Level Breakdown:'));
    for (const [level, count] of Object.entries(stats.levelBreakdown).sort()) {
      const bar = this._sparkBar(count, stats.totalEntries);
      lines.push(`    ${level.padEnd(8)} ${String(count).padStart(5)} ${bar}`);
    }

    // Source breakdown
    if (Object.keys(stats.sourceBreakdown).length > 0) {
      lines.push(this._color(THEME.dim, '\n  Source Breakdown:'));
      for (const [source, count] of Object.entries(stats.sourceBreakdown).sort()) {
        lines.push(`    ${source.padEnd(20)} ${count}`);
      }
    }

    // Top tools
    if (stats.topTools.length > 0) {
      lines.push(this._color(THEME.dim, '\n  Top Tools:'));
      for (const [tool, count] of stats.topTools) {
        lines.push(`    ${tool.padEnd(25)} ${count}`);
      }
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Apply ANSI color (or strip if ANSI disabled).
   * @param {string} ansiCode
   * @param {string} text
   * @returns {string}
   */
  _color(ansiCode, text) {
    if (!this._ansi) return text;
    return `${ansiCode}${text}${ANSI.reset}`;
  }

  /**
   * Create a simple text-based sparkline bar.
   * @param {number} value
   * @param {number} total
   * @returns {string}
   */
  _sparkBar(value, total) {
    const maxWidth = 20;
    const blocks = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const ratio = total > 0 ? value / total : 0;
    const width = Math.round(ratio * maxWidth);
    if (width === 0 && value > 0) return blocks[1];
    const fullBlocks = Math.floor(width / (blocks.length - 1));
    const remainder = width % (blocks.length - 1);
    let bar = blocks[blocks.length - 1].repeat(fullBlocks);
    if (remainder > 0) bar += blocks[remainder];
    return bar;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  LogViewer,
  LEVEL_COLORS,
  LEVEL_WEIGHT,
  stripAnsi,
  formatDuration,
  truncate,
};
