'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_LEVELS = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  CRITICAL: 'critical',
});

const LEVEL_WEIGHT = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
});

const DEFAULT_MAX_ENTRIES = 10000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO timestamp string into a numeric epoch for comparison.
 * @param {string|Date|number} ts
 * @returns {number}
 */
function toEpoch(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}

/**
 * Lightweight keyword match against all string values in an object.
 * @param {object} entry
 * @param {string} query
 * @returns {boolean}
 */
function matchesKeyword(entry, query) {
  const q = query.toLowerCase();
  for (const value of Object.values(entry)) {
    if (value == null) continue;
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (str.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Normalize an entry into a standard structure.
 * @param {object} raw
 * @param {string} sourceName
 * @returns {object}
 */
function normalizeEntry(raw, sourceName) {
  return {
    timestamp: raw.timestamp || raw.time || raw.ts || null,
    level: raw.level || raw.severity || LOG_LEVELS.INFO,
    message: raw.message || raw.msg || raw.text || '',
    source: sourceName,
    sessionId: raw.sessionId || raw.session_id || null,
    toolName: raw.toolName || raw.tool_name || null,
    type: raw.type || null,
    durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : null,
    result: raw.result || null,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Source Adapters
// ---------------------------------------------------------------------------

/**
 * Adapter for reading logs from a file path. Supports JSONL and plain text.
 */
class FileSource {
  /**
   * @param {string} filePath
   * @param {'jsonl'|'text'} [format='jsonl']
   */
  constructor(filePath, format = 'jsonl') {
    this._filePath = filePath;
    this._format = format;
    this._name = path.basename(filePath);
  }

  get name() {
    return this._name;
  }

  /**
   * Read all entries from the file.
   * @returns {Promise<object[]>}
   */
  async read() {
    try {
      const content = await fsp.readFile(this._filePath, 'utf8');
      return this._parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Read entries matching time range.
   * @param {object} options
   * @param {Date|string|number} [options.startTime]
   * @param {Date|string|number} [options.endTime]
   * @returns {Promise<object[]>}
   */
  async readRange(options = {}) {
    const entries = await this.read();
    const startMs = options.startTime ? toEpoch(options.startTime) : 0;
    const endMs = options.endTime ? toEpoch(options.endTime) : Infinity;

    return entries.filter((entry) => {
      const ts = entry.timestamp ? toEpoch(entry.timestamp) : 0;
      return ts >= startMs && ts <= endMs;
    });
  }

  /**
   * Get file stats (size, modified time, line count).
   * @returns {Promise<{size: number, modifiedAt: Date, lineCount: number}>}
   */
  async stats() {
    try {
      const stat = await fsp.stat(this._filePath);
      const content = await fsp.readFile(this._filePath, 'utf8');
      const lineCount = content.split('\n').filter((l) => l.trim().length > 0).length;
      return {
        size: stat.size,
        modifiedAt: stat.mtime,
        lineCount,
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { size: 0, modifiedAt: null, lineCount: 0 };
      }
      throw err;
    }
  }

  /**
   * @param {string} content
   * @returns {object[]}
   */
  _parse(content) {
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (this._format === 'jsonl') {
      return lines.reduce((acc, line) => {
        try {
          const parsed = JSON.parse(line);
          acc.push(parsed);
        } catch (_) {
          // skip non-JSON lines
        }
        return acc;
      }, []);
    }
    // Plain text: each line becomes an entry
    return lines.map((line) => ({ message: line, timestamp: null, level: LOG_LEVELS.INFO }));
  }
}

/**
 * Adapter for in-memory log entries.
 */
class MemorySource {
  /**
   * @param {object[]} [entries=[]]
   * @param {string} [name='memory']
   */
  constructor(entries = [], name = 'memory') {
    this._entries = entries;
    this._name = name;
  }

  get name() {
    return this._name;
  }

  /**
   * Add an entry to the memory source.
   * @param {object} entry
   */
  push(entry) {
    this._entries.push(entry);
  }

  /**
   * @returns {object[]}
   */
  read() {
    return this._entries.slice();
  }

  /**
   * @returns {number}
   */
  get length() {
    return this._entries.length;
  }

  /**
   * @returns {{size: number, modifiedAt: Date, count: number}}
   */
  stats() {
    return {
      size: JSON.stringify(this._entries).length,
      modifiedAt: new Date(),
      count: this._entries.length,
    };
  }
}

/**
 * Adapter for readable streams.
 */
class StreamSource {
  /**
   * @param {Readable} stream
   * @param {string} [name='stream']
   */
  constructor(stream, name = 'stream') {
    this._stream = stream;
    this._name = name;
    this._buffer = [];
    this._drained = false;
  }

  get name() {
    return this._name;
  }

  /**
   * Read all available entries from the stream.
   * @returns {Promise<object[]>}
   */
  async read() {
    if (this._drained) return this._buffer.slice();

    return new Promise((resolve, reject) => {
      const chunks = [];
      this._stream.on('data', (chunk) => {
        const str = chunk.toString();
        const lines = str.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            this._buffer.push(parsed);
          } catch (_) {
            this._buffer.push({ message: line, level: LOG_LEVELS.INFO });
          }
        }
      });
      this._stream.on('end', () => {
        this._drained = true;
        resolve(this._buffer.slice());
      });
      this._stream.on('error', reject);

      // If the stream is already ended/closed, resolve immediately
      if (this._stream.readableEnded) {
        this._drained = true;
        resolve(this._buffer.slice());
      }
    });
  }

  /**
   * @returns {{modifiedAt: Date, count: number}}
   */
  stats() {
    return {
      modifiedAt: new Date(),
      count: this._buffer.length,
    };
  }
}

// ---------------------------------------------------------------------------
// LogAggregator
// ---------------------------------------------------------------------------

/**
 * Aggregates log entries from multiple sources into a unified, queryable
 * collection. Supports file, memory, and stream sources.
 *
 * Usage:
 *   const aggregator = new LogAggregator();
 *   aggregator.addSource('app', new FileSource('/var/log/app.jsonl'));
 *   aggregator.addSource('audit', new MemorySource([...]));
 *   const results = await aggregator.filter({ level: 'error' });
 *   const timeline = await aggregator.merge();
 */
class LogAggregator {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEntries=10000] - maximum entries to hold in unified buffer
   */
  constructor(options = {}) {
    this._sources = new Map();
    this._maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES;
  }

  /**
   * Register a log source.
   * @param {string} name - unique name for the source
   * @param {FileSource|MemorySource|StreamSource|object} source - the source adapter
   * @throws {TypeError} if name is not a non-empty string
   */
  addSource(name, source) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('addSource: name must be a non-empty string');
    }
    if (!source || typeof source.read !== 'function') {
      throw new TypeError('addSource: source must implement read()');
    }
    this._sources.set(name, source);
  }

  /**
   * Remove a registered source by name.
   * @param {string} name
   * @returns {boolean} true if the source was removed
   */
  removeSource(name) {
    return this._sources.delete(name);
  }

  /**
   * Collect all log entries from all registered sources.
   * Normalizes entries to a common structure.
   *
   * @param {object} [options]
   * @param {string[]} [options.sources] - restrict to specific source names
   * @returns {Promise<object[]>} normalized log entries sorted by timestamp
   */
  async collect(options = {}) {
    const sourceNames = options.sources || [...this._sources.keys()];
    const allEntries = [];

    for (const name of sourceNames) {
      const source = this._sources.get(name);
      if (!source) continue;

      const rawEntries = await source.read();
      for (const raw of rawEntries) {
        allEntries.push(normalizeEntry(raw, name));
      }
    }

    // Sort by timestamp descending (newest first), null timestamps at the bottom
    allEntries.sort((a, b) => {
      const aTs = a.timestamp ? toEpoch(a.timestamp) : -Infinity;
      const bTs = b.timestamp ? toEpoch(b.timestamp) : -Infinity;
      return bTs - aTs;
    });

    return allEntries.slice(0, this._maxEntries);
  }

  /**
   * Filter collected log entries by various criteria.
   *
   * @param {object} [options]
   * @param {string|string[]} [options.level] - log level(s) to match
   * @param {string|string[]} [options.source] - source name(s) to match
   * @param {{start: Date|string|number, end: Date|string|number}} [options.timeRange]
   * @param {string} [options.sessionId] - session identifier
   * @param {string} [options.keyword] - keyword text search
   * @param {string} [options.type] - entry type
   * @param {string} [options.result] - entry result ('ok' or 'error')
   * @param {number} [options.limit] - max entries to return
   * @param {number} [options.offset] - skip first N matches
   * @returns {Promise<object[]>} matching log entries
   */
  async filter(options = {}) {
    const entries = await this.collect({ sources: options.sources });
    const levels = options.level
      ? (Array.isArray(options.level) ? options.level : [options.level])
      : null;
    const srcNames = options.source
      ? (Array.isArray(options.source) ? options.source : [options.source])
      : null;

    const startMs = options.timeRange?.start ? toEpoch(options.timeRange.start) : 0;
    const endMs = options.timeRange?.end ? toEpoch(options.timeRange.end) : Infinity;

    let filtered = entries.filter((entry) => {
      if (levels && !levels.includes(entry.level)) return false;
      if (srcNames && !srcNames.includes(entry.source)) return false;

      const ts = entry.timestamp ? toEpoch(entry.timestamp) : 0;
      if (ts < startMs || ts > endMs) return false;

      if (options.sessionId && entry.sessionId !== options.sessionId) return false;
      if (options.type && entry.type !== options.type) return false;
      if (options.result && entry.result !== options.result) return false;
      if (options.keyword && !matchesKeyword(entry, options.keyword)) return false;

      return true;
    });

    const offset = Number.isSafeInteger(options.offset) && options.offset > 0 ? options.offset : 0;
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : filtered.length;

    filtered = filtered.slice(offset, offset + limit);

    return filtered;
  }

  /**
   * Full-text search across all log entries. Searches message, toolName,
   * type, sessionId, and raw data.
   *
   * @param {string} query - search query
   * @param {object} [options] - same options as filter()
   * @returns {Promise<object[]>} matching entries
   */
  async search(query, options = {}) {
    if (typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }
    return this.filter({ ...options, keyword: query.trim() });
  }

  /**
   * Merge all sources into a unified timeline, interleaving entries by
   * timestamp across sources.
   *
   * @returns {Promise<object[]>} entries sorted by timestamp (oldest first)
   */
  async merge() {
    const entries = await this.collect();
    // Already sorted newest-first by collect(); reverse for chronological
    entries.reverse();
    return entries;
  }

  /**
   * List all registered sources with their stats.
   *
   * @returns {Promise<Array<{name: string, stats: object}>>}
   */
  async getSources() {
    const result = [];
    for (const [name, source] of this._sources) {
      let stats = {};
      if (typeof source.stats === 'function') {
        stats = await source.stats();
      }
      result.push({
        name,
        type: source.constructor?.name || typeof source,
        stats,
      });
    }
    return result;
  }

  /**
   * Get the number of registered sources.
   * @returns {number}
   */
  get sourceCount() {
    return this._sources.size;
  }

  /**
   * Clear all registered sources.
   */
  clear() {
    this._sources.clear();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  LogAggregator,
  FileSource,
  MemorySource,
  StreamSource,
  LOG_LEVELS,
  LEVEL_WEIGHT,
  toEpoch,
  matchesKeyword,
  normalizeEntry,
};
