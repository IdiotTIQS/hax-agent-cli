"use strict";

const crypto = require('node:crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Sensitive keys that get redacted by default when serializing settings
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'passphrase',
  'privateKey',
  'private_key',
  'authorization',
  'authToken',
  'auth_token',
  'bearer',
  'credential',
  'key',
]);

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /passphrase/i,
  /private[_-]?key/i,
  /auth/i,
  /credential/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Session serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a session object into a portable JSON structure.
 * Captures metadata, messages, cost tracking, and runtime state.
 */
function serializeSession(session) {
  if (!session) return null;

  const serialized = {
    schemaVersion: 1,
    serializedAt: new Date().toISOString(),
    id: session.id || '',
    startTime: session.startTime || null,
    elapsedMs: Date.now() - (session.startTime || Date.now()),
    provider: null,
    settings: null,
    messages: [],
    cost: null,
    goal: session.goal || null,
    modifiedFiles: session.modifiedFiles ? [...session.modifiedFiles] : [],
    shouldExit: session.shouldExit || false,
  };

  if (session.provider) {
    serialized.provider = {
      name: session.provider.name || null,
      model: session.provider.model || null,
      apiUrl: session.provider.apiUrl || null,
    };
  }

  if (session.settings) {
    serialized.settings = serializeSettings(session.settings, { redactSecrets: true });
  }

  if (Array.isArray(session.messages)) {
    serialized.messages = serializeMessages(session.messages);
  }

  if (session.costTracker) {
    serialized.cost = {
      inputTokens: session.costTracker.inputTokens || 0,
      outputTokens: session.costTracker.outputTokens || 0,
      cacheCreationTokens: session.costTracker.cacheCreationTokens || 0,
      cacheReadTokens: session.costTracker.cacheReadTokens || 0,
      turnCount: session.costTracker.turnCount || 0,
      toolCallCount: session.costTracker.toolCallCount || 0,
    };
  }

  return serialized;
}

/**
 * Reconstruct a session-like structure from serialized JSON.
 * The result can be used for display, analysis, or re-import.
 */
function deserializeSession(json) {
  if (!json || typeof json !== 'object') return null;

  const data = json;

  return {
    schemaVersion: data.schemaVersion || 0,
    serializedAt: data.serializedAt || null,
    id: data.id || '',
    startTime: data.startTime || null,
    elapsedMs: data.elapsedMs || 0,
    provider: data.provider ? { ...data.provider } : null,
    settings: data.settings || null,
    messages: Array.isArray(data.messages) ? data.messages.map((m) => ({ ...m })) : [],
    cost: data.cost ? { ...data.cost } : null,
    goal: data.goal ? { ...data.goal } : null,
    modifiedFiles: Array.isArray(data.modifiedFiles) ? [...data.modifiedFiles] : [],
    shouldExit: data.shouldExit || false,
    // Attach convenience getters
    getMessageCount() {
      return this.messages.length;
    },
    getUserMessages() {
      return this.messages.filter((m) => m.role === 'user');
    },
    getAssistantMessages() {
      return this.messages.filter((m) => m.role === 'assistant');
    },
    getToolMessages() {
      return this.messages.filter((m) => m.role === 'tool');
    },
    getElapsedFormatted() {
      const ms = this.elapsedMs || 0;
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize settings with optional secret redaction.
 * @param {object} settings
 * @param {{ redactSecrets?: boolean }} [options]
 * @returns {object}
 */
function serializeSettings(settings, options = {}) {
  if (!settings || typeof settings !== 'object') return null;

  const redactSecrets = options.redactSecrets !== false;

  function redact(value, key) {
    if (typeof value === 'string' && isSensitiveKey(key)) {
      if (value.length === 0) return '';
      if (value.length <= 8) return '***';
      return value.slice(0, 4) + '***' + value.slice(-4);
    }
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        return value.map((item, idx) => redact(item, String(idx)));
      }
      const result = {};
      for (const k of Object.keys(value)) {
        result[k] = redact(value[k], k);
      }
      return result;
    }
    return value;
  }

  if (redactSecrets) {
    return redact(settings, '');
  }

  return deepClone(settings);
}

function isSensitiveKey(key) {
  if (SENSITIVE_KEYS.has(key)) return true;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(key)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format messages for external consumption (e.g., export, display).
 * Normalizes role, content, tool usage, and errors.
 */
function serializeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.map((msg, index) => {
    if (!msg) return { role: 'unknown', index };

    const entry = {
      role: msg.role || 'unknown',
      index,
    };

    if (msg.timestamp) {
      entry.timestamp = msg.timestamp;
    }

    if (msg.content !== undefined) {
      entry.content = msg.content;
    }

    if (msg.name) {
      entry.toolName = msg.name;
    }

    if (msg.data !== undefined) {
      entry.data = msg.data;
    }

    if (msg.isError) {
      entry.isError = true;
    }

    if (msg.tool_call_id) {
      entry.toolCallId = msg.tool_call_id;
    }

    if (msg.tool_use_id) {
      entry.toolUseId = msg.tool_use_id;
    }

    return entry;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON (newline-delimited JSON)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an array of records to a newline-delimited JSON string.
 */
function toNdjson(records) {
  if (!Array.isArray(records)) return '';
  return records
    .map((record) => {
      try {
        return JSON.stringify(record);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n') + (records.length > 0 ? '\n' : '');
}

/**
 * Parse NDJSON text into an array of objects.
 * Skips empty lines and recovers from malformed JSON lines.
 * @returns {{ records: object[], errors: { line: number, error: string }[] }}
 */
function fromNdjson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { records: [], errors: [] };
  }

  const lines = text.split(/\r?\n/);
  const records = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const record = JSON.parse(line);
      records.push(record);
    } catch (err) {
      errors.push({
        line: i + 1,
        error: err.message,
      });
    }
  }

  return { records, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an array of objects to a CSV string.
 * @param {object[]} records
 * @param {string[]} [columns] - explicit column list; auto-detected from first record if omitted
 * @returns {string} CSV text with header row
 */
function toCsv(records, columns) {
  if (!Array.isArray(records) || records.length === 0) return '';

  const cols = columns || Object.keys(records[0] || {});
  if (cols.length === 0) return '';

  const header = cols.map((c) => csvEscape(String(c))).join(',');

  const rows = records.map((record) => {
    return cols
      .map((col) => {
        const raw = record[col];
        if (raw === null || raw === undefined) return '';
        if (typeof raw === 'object') return csvEscape(JSON.stringify(raw));
        return csvEscape(String(raw));
      })
      .join(',');
  });

  return [header, ...rows].join('\n') + '\n';
}

/**
 * Parse CSV text into an array of objects.
 * @param {string} text
 * @param {{ columns?: string[], header?: boolean }} [options]
 * @returns {object[]}
 */
function fromCsv(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];

  const hasHeader = options.header !== false;
  let columns;

  if (hasHeader) {
    columns = csvParseLine(lines[0]).map((c) => c.trim());
    lines.shift();
  } else if (options.columns && Array.isArray(options.columns)) {
    columns = options.columns;
  } else {
    // Auto-generate column names
    const firstRowCols = csvParseLine(lines[0]);
    columns = firstRowCols.map((_, i) => `col${i + 1}`);
  }

  return lines.map((line) => {
    const values = csvParseLine(line);
    const record = {};
    for (let i = 0; i < columns.length; i++) {
      record[columns[i]] = i < values.length ? values[i] : '';
    }
    return record;
  });
}

function csvEscape(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function csvParseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  result.push(current);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const copy = {};
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key]);
  }
  return copy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  serializeSession,
  deserializeSession,
  serializeSettings,
  serializeMessages,
  toNdjson,
  fromNdjson,
  toCsv,
  fromCsv,
  SENSITIVE_KEYS,       // exported for testing
  SENSITIVE_PATTERNS,   // exported for testing
};
