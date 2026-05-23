'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_LEVELS = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
});

const ENTRY_TYPES = Object.freeze({
  TOOL_EXECUTION: 'tool.execution',
  PERMISSION_CHANGE: 'permission.change',
  CONFIG_CHANGE: 'config.change',
  AUTH_EVENT: 'auth.event',
});

// Maximum number of audit entries to hold in memory before flushing
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_BUFFER_SIZE = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a monotonic sequence number. Uses a closure to maintain state.
 * @returns {function(): number}
 */
function createSequence() {
  let seq = 0;
  return () => {
    seq += 1;
    return seq;
  };
}

/**
 * Compute a SHA-256 integrity hash for an audit entry (excluding the hash itself).
 * @param {object} entry
 * @returns {string} hex-encoded hash
 */
function computeEntryHash(entry) {
  const { hash, ...rest } = entry;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Sanitize an object for logging — truncate long strings, remove secrets.
 * @param {*} value
 * @param {number} depth
 * @returns {*}
 */
function sanitizeForLog(value, depth = 0) {
  if (depth > 5) return '[MaxDepth]';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 500) {
      return value.slice(0, 500) + '...[truncated]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = sanitizeForLog(val, depth + 1);
  }
  return result;
}

/**
 * Summarize tool arguments for logging (truncate large payloads).
 * @param {string} toolName
 * @param {object} args
 * @returns {object} summarized args
 */
function summarizeArgs(toolName, args) {
  if (!args || typeof args !== 'object') return {};
  const summary = sanitizeForLog(args);
  // For file write/edit, truncate content
  if ((toolName === 'file.write' || toolName === 'file.edit') && typeof summary.content === 'string') {
    summary.contentLength = summary.content.length;
    summary.content = summary.content.slice(0, 200) + (summary.content.length > 200 ? '...[truncated]' : '');
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Audit Logger
// ---------------------------------------------------------------------------

/**
 * Immutable audit trail logger that writes append-only JSONL entries with
 * monotonic sequence numbers and integrity hashes.
 *
 * Usage:
 *   const logger = new AuditLogger({ logPath: '/var/log/hax-agent/audit.jsonl' });
 *   await logger.init();
 *   logger.logToolExecution({ toolName: 'shell.run', args: {...}, result: 'ok', ... });
 *   const entries = await logger.query({ toolName: 'shell.run', from: '2026-01-01' });
 *   await logger.shutdown();
 */
class AuditLogger {
  /**
   * @param {object} [options]
   * @param {string} [options.logPath] - path to the JSONL log file (required for persistence)
   * @param {number} [options.flushIntervalMs] - auto-flush interval in ms (default: 5000)
   * @param {number} [options.maxBufferSize] - max entries before forced flush (default: 100)
   * @param {boolean} [options.enabled] - whether logging is active (default: true)
   */
  constructor(options = {}) {
    this._logPath = options.logPath || null;
    this._flushIntervalMs = Number.isSafeInteger(options.flushIntervalMs) && options.flushIntervalMs > 0
      ? options.flushIntervalMs
      : DEFAULT_FLUSH_INTERVAL_MS;
    this._maxBufferSize = Number.isSafeInteger(options.maxBufferSize) && options.maxBufferSize > 0
      ? options.maxBufferSize
      : DEFAULT_MAX_BUFFER_SIZE;
    this._enabled = options.enabled !== false;

    this._nextSeq = createSequence();
    this._buffer = [];
    this._flushTimer = null;
    this._flushing = false;
    this._initialized = false;
    this._totalEntries = 0;
  }

  /**
   * Initialize the audit logger. Creates the log directory if needed.
   * Must be called before logging.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;
    if (this._logPath) {
      const dir = path.dirname(this._logPath);
      await fsp.mkdir(dir, { recursive: true });
    }
    this._initialized = true;

    // Start auto-flush timer
    if (this._enabled && this._flushIntervalMs > 0) {
      this._flushTimer = setInterval(() => this._flush(), this._flushIntervalMs);
      // Allow the timer to not keep the process alive
      if (this._flushTimer.unref) {
        this._flushTimer.unref();
      }
    }
  }

  /**
   * Shut down the logger, flushing any remaining entries.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    await this._flush();
    this._initialized = false;
  }

  /**
   * Create an audit entry with common fields.
   * @param {object} fields
   * @returns {object} the constructed entry (before hashing)
   */
  _createEntry(fields) {
    const entry = {
      seq: this._nextSeq(),
      timestamp: new Date().toISOString(),
      type: fields.type || ENTRY_TYPES.TOOL_EXECUTION,
      severity: fields.severity || SEVERITY_LEVELS.INFO,
      toolName: fields.toolName || null,
      argsSummary: fields.argsSummary || null,
      result: fields.result || null,
      error: fields.error || null,
      durationMs: Number.isFinite(fields.durationMs) ? fields.durationMs : null,
      details: fields.details || null,
      user: fields.user || null,
      sessionId: fields.sessionId || null,
    };

    // Compute integrity hash
    entry.hash = computeEntryHash(entry);

    return entry;
  }

  /**
   * Buffer an entry and flush if needed.
   * @param {object} entry
   */
  _enqueue(entry) {
    if (!this._enabled) return;

    this._buffer.push(entry);
    this._totalEntries += 1;
    if (this._buffer.length >= this._maxBufferSize) {
      this._flush().catch(() => {});
    }
  }

  /**
   * Write buffered entries to the log file.
   * @returns {Promise<void>}
   */
  async _flush() {
    if (this._flushing || this._buffer.length === 0) return;
    this._flushing = true;

    try {
      const lines = this._buffer.map((entry) => JSON.stringify(entry));
      lines.push(''); // trailing newline
      const data = lines.join('\n');

      if (this._logPath) {
        await fsp.appendFile(this._logPath, data, 'utf8');
      }

      this._buffer = [];
    } catch (_) {
      // Silently fail — audit log best-effort
    } finally {
      this._flushing = false;
    }
  }

  // -------------------------------------------------------------------------
  // Public logging methods
  // -------------------------------------------------------------------------

  /**
   * Log a tool execution event.
   *
   * @param {object} entry
   * @param {string} entry.toolName - e.g. 'shell.run', 'file.write'
   * @param {object} [entry.args] - tool call arguments
   * @param {string} [entry.result] - 'ok' | 'error'
   * @param {object} [entry.error] - error details if result is 'error'
   * @param {number} [entry.durationMs] - execution duration
   * @param {string} [entry.sessionId] - session identifier
   * @param {string} [entry.user] - user identifier
   */
  logToolExecution(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('logToolExecution: entry must be an object');
    }

    const severity = entry.result === 'error' ? SEVERITY_LEVELS.ERROR : SEVERITY_LEVELS.INFO;

    const auditEntry = this._createEntry({
      type: ENTRY_TYPES.TOOL_EXECUTION,
      severity,
      toolName: entry.toolName || null,
      argsSummary: summarizeArgs(entry.toolName, entry.args),
      result: entry.result || 'ok',
      error: entry.error ? sanitizeForLog(entry.error) : null,
      durationMs: entry.durationMs,
      sessionId: entry.sessionId || null,
      user: entry.user || null,
    });

    this._enqueue(auditEntry);
  }

  /**
   * Log a permission mode change event.
   *
   * @param {object} entry
   * @param {string} entry.mode - new permission mode (normal, yolo, etc.)
   * @param {string} [entry.previousMode] - previous permission mode
   * @param {string} [entry.source] - what triggered the change (e.g. 'user', 'config')
   * @param {string} [entry.sessionId]
   * @param {string} [entry.user]
   */
  logPermissionChange(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('logPermissionChange: entry must be an object');
    }

    const auditEntry = this._createEntry({
      type: ENTRY_TYPES.PERMISSION_CHANGE,
      severity: SEVERITY_LEVELS.WARNING,
      details: {
        mode: entry.mode || null,
        previousMode: entry.previousMode || null,
        source: entry.source || 'unknown',
      },
      sessionId: entry.sessionId || null,
      user: entry.user || null,
    });

    this._enqueue(auditEntry);
  }

  /**
   * Log a configuration change event.
   *
   * @param {object} entry
   * @param {string} entry.key - the config key that changed
   * @param {*} [entry.previousValue] - value before change
   * @param {*} [entry.newValue] - value after change
   * @param {string} [entry.source] - what triggered the change
   * @param {string} [entry.sessionId]
   * @param {string} [entry.user]
   */
  logConfigChange(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('logConfigChange: entry must be an object');
    }

    const auditEntry = this._createEntry({
      type: ENTRY_TYPES.CONFIG_CHANGE,
      severity: SEVERITY_LEVELS.INFO,
      details: {
        key: entry.key || null,
        previousValue: entry.previousValue !== undefined ? sanitizeForLog(entry.previousValue) : undefined,
        newValue: entry.newValue !== undefined ? sanitizeForLog(entry.newValue) : undefined,
        source: entry.source || 'unknown',
      },
      sessionId: entry.sessionId || null,
      user: entry.user || null,
    });

    this._enqueue(auditEntry);
  }

  /**
   * Log an authentication event (API key usage, provider switch).
   *
   * @param {object} entry
   * @param {string} entry.event - the auth event type (e.g. 'key.used', 'provider.switch')
   * @param {string} [entry.provider] - AI provider name
   * @param {string} [entry.model] - model identifier
   * @param {string} [entry.result] - 'ok' | 'error'
   * @param {string} [entry.sessionId]
   * @param {string} [entry.user]
   */
  logAuthEvent(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('logAuthEvent: entry must be an object');
    }

    const severity = entry.result === 'error' ? SEVERITY_LEVELS.ERROR : SEVERITY_LEVELS.INFO;

    const auditEntry = this._createEntry({
      type: ENTRY_TYPES.AUTH_EVENT,
      severity,
      details: {
        event: entry.event || null,
        provider: entry.provider || null,
        model: entry.model || null,
      },
      result: entry.result || 'ok',
      error: entry.error ? sanitizeForLog(entry.error) : null,
      sessionId: entry.sessionId || null,
      user: entry.user || null,
    });

    this._enqueue(auditEntry);
  }

  // -------------------------------------------------------------------------
  // Querying
  // -------------------------------------------------------------------------

  /**
   * Query audit entries by various criteria. If a logPath was configured,
   * reads from the persisted file. Otherwise queries only in-memory buffer.
   *
   * @param {object} [options]
   * @param {string} [options.from] - ISO timestamp lower bound (inclusive)
   * @param {string} [options.to] - ISO timestamp upper bound (inclusive)
   * @param {string} [options.toolName] - filter by tool name
   * @param {string} [options.type] - filter by entry type
   * @param {string} [options.result] - filter by result ('ok' or 'error')
   * @param {string} [options.severity] - filter by severity
   * @param {number} [options.limit] - max entries to return (default: 100)
   * @param {number} [options.offset] - skip first N matches (default: 0)
   * @returns {Promise<object[]>} matching audit entries
   */
  async query(options = {}) {
    const from = options.from ? new Date(options.from).getTime() : 0;
    const to = options.to ? new Date(options.to).getTime() : Infinity;
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 100;
    const offset = Number.isSafeInteger(options.offset) && options.offset > 0 ? options.offset : 0;

    let entries = [];

    // Collect from in-memory buffer first
    entries.push(...this._buffer);

    // Read from persisted log file
    if (this._logPath) {
      try {
        const content = await fsp.readFile(this._logPath, 'utf8');
        const lines = content.split('\n').filter((line) => line.trim().length > 0);
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch (_) {
            // skip corrupted lines
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    // Sort by sequence number descending (newest first)
    entries.sort((a, b) => (b.seq || 0) - (a.seq || 0));

    // Deduplicate by sequence number (in-memory buffer may overlap with disk)
    const seen = new Set();
    entries = entries.filter((entry) => {
      if (seen.has(entry.seq)) return false;
      seen.add(entry.seq);
      return true;
    });

    // Apply filters
    let filtered = entries.filter((entry) => {
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

      if (ts < from || ts > to) return false;
      if (options.toolName && entry.toolName !== options.toolName) return false;
      if (options.type && entry.type !== options.type) return false;
      if (options.result && entry.result !== options.result) return false;
      if (options.severity && entry.severity !== options.severity) return false;

      return true;
    });

    // Apply offset and limit
    filtered = filtered.slice(offset, offset + limit);

    return filtered;
  }

  /**
   * Get the total number of entries logged since init (across all sessions).
   * @returns {number}
   */
  getTotalEntries() {
    return this._totalEntries;
  }

  /**
   * Get the current buffer size (unflushed entries).
   * @returns {number}
   */
  getBufferSize() {
    return this._buffer.length;
  }

  /**
   * Force flush all buffered entries to disk.
   * @returns {Promise<void>}
   */
  async flush() {
    await this._flush();
  }
}

module.exports = {
  AuditLogger,
  SEVERITY_LEVELS,
  ENTRY_TYPES,
  computeEntryHash,
};
