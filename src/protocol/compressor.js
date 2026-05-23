'use strict';

const { requireString } = require('../runtime/utils');

// ---- Compression dictionaries ----

const FIELD_MAP = Object.freeze({
  id: 'i',
  from: 'f',
  to: 't',
  type: 'p',
  taskId: 'ti',
  subject: 's',
  body: 'b',
  createdAt: 'ts',
  priority: 'pr',
  priorityLevel: 'pl',
  threadId: 'th',
  read: 'rd',
  metadata: 'm',
});

const REVERSE_FIELD_MAP = Object.freeze(
  Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]))
);

const ROLE_ABBREVIATIONS = Object.freeze({
  architect: 'arc',
  reviewer: 'rev',
  tester: 'tst',
  'security-reviewer': 'sec',
  'docs-writer': 'doc',
  planner: 'pln',
  implementer: 'imp',
  explorer: 'exp',
  'test-runner': 'tst',
  lead: 'ld',
  system: 'sys',
  'general-purpose': 'gen',
});

const REVERSE_ROLE_ABBREVIATIONS = Object.freeze(
  Object.fromEntries(Object.entries(ROLE_ABBREVIATIONS).map(([k, v]) => [v, k]))
);

const DEFAULTABLE_FIELDS = Object.freeze([
  'taskId',
  'subject',
  'threadId',
  'read',
]);

const NULL_EQUIVALENT_VALUES = new Set([null, '', undefined]);

// ---- Token estimation ----

const TOKEN_PATTERN = /\w+|[^\w\s]/g;

function estimateTokens(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'object') {
    return estimateTokens(JSON.stringify(value));
  }

  const text = String(value);
  const matches = text.match(TOKEN_PATTERN);
  return matches ? matches.length : 0;
}

// ---- Internal helpers ----

function shortenRole(name) {
  if (!name || typeof name !== 'string') {
    return name;
  }

  return ROLE_ABBREVIATIONS[name] || name;
}

function expandRole(abbreviation) {
  if (!abbreviation || typeof abbreviation !== 'string') {
    return abbreviation;
  }

  return REVERSE_ROLE_ABBREVIATIONS[abbreviation] || abbreviation;
}

function shouldDropField(key, value) {
  return DEFAULTABLE_FIELDS.includes(key) && NULL_EQUIVALENT_VALUES.has(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
}

// ---- ProtocolCompressor ----

class ProtocolCompressor {
  constructor(options = {}) {
    this._dedupWindow = Math.max(0, Number(options.dedupWindow) || 5);
    this._recentBodies = [];
    this._totalSaved = 0;
    this._totalMessagesCompressed = 0;
  }

  /**
   * Compress a single message to reduce token overhead.
   *
   * Strategies applied:
   *   1. Abbreviate field names (e.g. "from" -> "f")
   *   2. Shorten role names (e.g. "architect" -> "arc")
   *   3. Drop fields with null/empty default values
   *   4. Deduplicate repeated context in body text
   *
   * @param {object} message
   * @returns {object} The compressed message (frozen).
   */
  compress(message) {
    if (!message || typeof message !== 'object') {
      throw new TypeError('message must be a non-null object');
    }

    const compressed = {};
    let bodyText = '';

    for (const [key, value] of Object.entries(message)) {
      if (shouldDropField(key, value)) {
        continue;
      }

      const shortKey = FIELD_MAP[key] || key;

      if (key === 'from' || key === 'to') {
        compressed[shortKey] = shortenRole(value);
      } else if (key === 'body') {
        bodyText = typeof value === 'string' ? value : '';
        compressed[shortKey] = this._deduplicateBody(bodyText);
      } else if (key === 'metadata') {
        const compactMeta = this._compressMetadata(value);
        if (compactMeta && Object.keys(compactMeta).length > 0) {
          compressed[shortKey] = compactMeta;
        }
      } else {
        compressed[shortKey] = value;
      }
    }

    // Always include version marker so decompress knows it's compressed
    compressed._v = 1;

    this._trackBody(bodyText);
    this._totalMessagesCompressed++;

    return deepFreeze(compressed);
  }

  /**
   * Restore a compressed message to its full form.
   *
   * @param {object} compressed
   * @returns {object} The decompressed message.
   */
  decompress(compressed) {
    if (!compressed || typeof compressed !== 'object') {
      throw new TypeError('compressed must be a non-null object');
    }

    if (compressed._v !== 1) {
      throw new Error('Unknown compression version or not a compressed message');
    }

    const message = {};

    for (const [shortKey, value] of Object.entries(compressed)) {
      if (shortKey === '_v') {
        continue;
      }

      const fullKey = REVERSE_FIELD_MAP[shortKey] || shortKey;

      if (fullKey === 'from' || fullKey === 'to') {
        message[fullKey] = expandRole(value);
      } else if (fullKey === 'metadata') {
        message[fullKey] = this._expandMetadata(value);
      } else {
        message[fullKey] = value;
      }
    }

    // Re-apply defaults for fields that were dropped during compression
    if (!('taskId' in message)) {
      message.taskId = null;
    }
    if (!('subject' in message)) {
      message.subject = '';
    }
    if (!('threadId' in message)) {
      message.threadId = null;
    }
    if (!('read' in message)) {
      message.read = null;
    }

    return message;
  }

  /**
   * Estimate token savings for a batch of messages.
   *
   * @param {object[]} messages
   * @returns {object} Savings report.
   */
  estimateSavings(messages) {
    if (!Array.isArray(messages)) {
      throw new TypeError('messages must be an array');
    }

    let originalTokens = 0;
    let compressedTokens = 0;
    const perMessage = [];

    for (const message of messages) {
      const origTokens = estimateTokens(message);
      const comp = this.compress(message);
      const compTokens = estimateTokens(comp);

      originalTokens += origTokens;
      compressedTokens += compTokens;
      perMessage.push({
        messageId: message.id || null,
        originalTokens: origTokens,
        compressedTokens: compTokens,
        saved: origTokens - compTokens,
        savingsPercent: origTokens > 0
          ? Math.round(((origTokens - compTokens) / origTokens) * 100)
          : 0,
      });
    }

    const totalSaved = originalTokens - compressedTokens;

    return {
      messageCount: messages.length,
      originalTokens,
      compressedTokens,
      totalSaved,
      savingsPercent: originalTokens > 0
        ? Math.round((totalSaved / originalTokens) * 100)
        : 0,
      perMessage,
    };
  }

  /**
   * Total tokens saved across all compress() calls.
   * @returns {number}
   */
  get totalSaved() {
    return this._totalSaved;
  }

  /**
   * Number of messages compressed so far.
   * @returns {number}
   */
  get totalMessagesCompressed() {
    return this._totalMessagesCompressed;
  }

  /**
   * Reset internal state (dedup window, counters).
   */
  reset() {
    this._recentBodies = [];
    this._totalSaved = 0;
    this._totalMessagesCompressed = 0;
  }

  // ---- Internal ----

  _trackBody(bodyText) {
    if (typeof bodyText === 'string' && bodyText.length > 0) {
      this._recentBodies.push(bodyText);

      if (this._recentBodies.length > this._dedupWindow) {
        this._recentBodies.shift();
      }
    }
  }

  _deduplicateBody(bodyText) {
    if (typeof bodyText !== 'string' || bodyText.length === 0) {
      return bodyText;
    }

    // Find longest common prefix with any recent body
    let bestTrim = 0;

    for (const recent of this._recentBodies) {
      if (recent === bodyText) {
        // Exact duplicate — replace with a short reference
        return '[...]';
      }

      // Find common prefix length
      let commonLen = 0;
      const minLen = Math.min(bodyText.length, recent.length);

      while (commonLen < minLen && bodyText[commonLen] === recent[commonLen]) {
        commonLen++;
      }

      if (commonLen > bestTrim) {
        bestTrim = commonLen;
      }
    }

    if (bestTrim >= 20) {
      const trimmed = bodyText.slice(bestTrim);

      if (trimmed.length > 0) {
        return `[...] ${trimmed}`;
      }

      return '[...]';
    }

    return bodyText;
  }

  _compressMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const entries = Object.entries(metadata);

    if (entries.length === 0) {
      return null;
    }

    const compressed = {};

    for (const [key, value] of entries) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      const shortKey = FIELD_MAP[key] || key;
      compressed[shortKey] = value;
    }

    return Object.keys(compressed).length > 0 ? compressed : null;
  }

  _expandMetadata(compressed) {
    if (!compressed || typeof compressed !== 'object') {
      return {};
    }

    const expanded = {};

    for (const [shortKey, value] of Object.entries(compressed)) {
      const fullKey = REVERSE_FIELD_MAP[shortKey] || shortKey;
      expanded[fullKey] = value;
    }

    return expanded;
  }
}

function createCompressor(options) {
  return new ProtocolCompressor(options);
}

module.exports = {
  FIELD_MAP,
  ProtocolCompressor,
  REVERSE_FIELD_MAP,
  ROLE_ABBREVIATIONS,
  createCompressor,
  estimateTokens,
};
