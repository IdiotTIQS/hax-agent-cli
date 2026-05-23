'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Redaction type labels.
 */
const REDACTION_TYPES = Object.freeze([
  'API_KEYS',
  'PASSWORDS',
  'EMAILS',
  'PHONES',
  'CREDIT_CARDS',
  'IP_ADDRESSES',
  'TOKENS',
  'SSN',
]);

/**
 * Default placeholder format: [REDACTED:{type}]
 */
const DEFAULT_PLACEHOLDER_TEMPLATE = '[REDACTED:{type}]';

// ---------------------------------------------------------------------------
// Built-in detection patterns
// ---------------------------------------------------------------------------

/**
 * Built-in patterns for auto-detection.
 * Each entry has a `type`, a `pattern` RegExp, and an optional `validate` function
 * that rejects false positives.
 */
function createDefaultPatterns() {
  return [
    // API keys — common service key formats
    {
      type: 'API_KEYS',
      pattern: /(?:sk|pk|rk)-[A-Za-z0-9-_]{20,}/g,
      validate: null,
    },
    // Bearer / auth tokens
    {
      type: 'TOKENS',
      pattern: /(?:bearer|token)\s+[A-Za-z0-9\-._~+/]{8,}/gi,
      validate: null,
    },
    // GitHub tokens
    {
      type: 'TOKENS',
      pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g,
      validate: null,
    },
    // AWS access key IDs
    {
      type: 'API_KEYS',
      pattern: /AKIA[0-9A-Z]{16}/g,
      validate: null,
    },
    // JWT tokens
    {
      type: 'TOKENS',
      pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      validate: null,
    },
    // Key-value secrets in key=value or key: value form
    {
      type: 'PASSWORDS',
      pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*\S+/gi,
      validate: null,
    },
    // Email addresses
    {
      type: 'EMAILS',
      pattern: /\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}\b/g,
      validate: null,
    },
    // Phone numbers
    {
      type: 'PHONES',
      pattern: /\b(?:\+\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g,
      validate: null,
    },
    // Credit card numbers (13-19 digits with or without separators)
    {
      type: 'CREDIT_CARDS',
      pattern: /\b(?:\d[ -]*?){12,18}\d\b/g,
      validate: null,
    },
    // IPv4 addresses
    {
      type: 'IP_ADDRESSES',
      pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
      validate: null,
    },
    // SSN (US Social Security Number) — xxx-xx-xxxx or xxx xx xxxx
    {
      type: 'SSN',
      pattern: /\b(?!000|666|9\d{2})\d{3}[ -]?(?!00)\d{2}[ -]?(?!0000)\d{4}\b/g,
      validate: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Luhn check helper
// ---------------------------------------------------------------------------

/**
 * Validate a numeric string using the Luhn algorithm.
 * @param {string} digits — only digit characters
 * @returns {boolean}
 */
function luhnCheck(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = parseInt(digits.charAt(i), 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?*.]/g, '\\$&');
}

/**
 * Build a placeholder string for a given redaction type.
 * @param {string} type — one of REDACTION_TYPES
 * @param {string} [template] — custom template with optional `{type}` token
 * @returns {string}
 */
function buildPlaceholder(type, template) {
  const tpl = template || DEFAULT_PLACEHOLDER_TEMPLATE;
  return tpl.replace(/\{type\}/g, type);
}

// ---------------------------------------------------------------------------
// RedactionEngine
// ---------------------------------------------------------------------------

/**
 * Engine for redacting sensitive content from text and optionally restoring it.
 */
class RedactionEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.placeholder] — custom placeholder template (default: '[REDACTED:{type}]')
   * @param {boolean} [options.keepMap] — preserve redaction map for undo (default: true)
   * @param {Array<{ type: string, pattern: RegExp, validate?: function }>} [options.patterns]
   *   — custom patterns to use instead of built-in defaults
   */
  constructor(options = {}) {
    this._placeholder = typeof options.placeholder === 'string'
      ? options.placeholder
      : DEFAULT_PLACEHOLDER_TEMPLATE;

    this._keepMap = options.keepMap !== false;

    this._patterns = Array.isArray(options.patterns) && options.patterns.length > 0
      ? options.patterns.map((p) => ({
          type: p.type,
          pattern: new RegExp(p.pattern.source, p.pattern.flags),
          validate: typeof p.validate === 'function' ? p.validate : null,
        }))
      : createDefaultPatterns().map((p) => ({
          type: p.type,
          pattern: new RegExp(p.pattern.source, p.pattern.flags),
          validate: p.validate,
        }));

    // Redaction map: maps placeholder keys to original values
    // Key format: {type}:{index}
    this._redactionMap = new Map();

    // Reverse map counter per type
    this._counter = new Map();

    // For undo: track order of redactions
    this._redactionOrder = [];
  }

  /**
   * Redact specific types of sensitive content from text.
   *
   * @param {string} text — text to redact
   * @param {object} [options]
   * @param {string[]} [options.types] — which REDACTION_TYPES to apply (default: all)
   * @param {Array<{ type: string, pattern: RegExp }>} [options.extraPatterns] — additional patterns
   * @returns {string} redacted text
   */
  redact(text, options = {}) {
    if (typeof text !== 'string') {
      throw new TypeError('redact: text must be a string');
    }

    const types = Array.isArray(options.types) && options.types.length > 0
      ? new Set(options.types.filter((t) => REDACTION_TYPES.includes(t)))
      : null; // null means all types

    const extraPatterns = Array.isArray(options.extraPatterns) ? options.extraPatterns : [];

    // Collect all replacements
    const replacements = [];

    // Process built-in patterns
    for (const entry of this._patterns) {
      if (types && !types.has(entry.type)) continue;

      const regex = new RegExp(entry.pattern.source, entry.pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const evidence = match[0];
        if (evidence.length === 0) continue;
        if (entry.validate && !entry.validate(evidence)) continue;
        // For CREDIT_CARDS, apply Luhn validation
        if (entry.type === 'CREDIT_CARDS') {
          const digits = evidence.replace(/[^0-9]/g, '');
          if (!luhnCheck(digits)) continue;
        }

        const cnt = (this._counter.get(entry.type) || 0) + 1;
        this._counter.set(entry.type, cnt);

        const key = `${entry.type}:${cnt}`;
        const placeholder = buildPlaceholder(entry.type, this._placeholder);

        replacements.push({
          start: match.index,
          end: match.index + evidence.length,
          evidence,
          type: entry.type,
          key,
          placeholder,
        });
      }
    }

    // Process extra patterns
    for (const extra of extraPatterns) {
      const regex = new RegExp(extra.pattern.source, extra.pattern.flags);
      const extraType = extra.type || 'CUSTOM';

      let match;
      while ((match = regex.exec(text)) !== null) {
        const evidence = match[0];
        if (evidence.length === 0) continue;

        const cnt = (this._counter.get(extraType) || 0) + 1;
        this._counter.set(extraType, cnt);

        const key = `${extraType}:${cnt}`;
        const placeholder = buildPlaceholder(extraType, this._placeholder);

        replacements.push({
          start: match.index,
          end: match.index + evidence.length,
          evidence,
          type: extraType,
          key,
          placeholder,
        });
      }
    }

    // Sort replacements by start index descending so indices stay valid
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements
    let result = text;
    const applied = [];

    for (const rep of replacements) {
      // Check for overlapping replacements (skip if this region was already replaced)
      const overlaps = applied.some((a) =>
        (rep.start >= a.start && rep.start < a.end) ||
        (rep.end > a.start && rep.end <= a.end));
      if (overlaps) continue;

      result = result.substring(0, rep.start) + rep.placeholder + result.substring(rep.end);

      if (this._keepMap) {
        this._redactionMap.set(rep.key, {
          original: rep.evidence,
          type: rep.type,
          placeholder: rep.placeholder,
          position: rep.start,
          length: rep.evidence.length,
        });
        this._redactionOrder.push(rep.key);
      }

      applied.push({ start: rep.start, end: rep.start + rep.placeholder.length });
    }

    return result;
  }

  /**
   * Auto-detect and redact all sensitive content in one call.
   * Convenience method identical to `redact(text)` with no options.
   *
   * @param {string} text
   * @returns {string} redacted text
   */
  detectAndRedact(text) {
    return this.redact(text);
  }

  /**
   * Get the redaction map showing what was redacted and where.
   *
   * @returns {Array<{ key: string, type: string, original: string, placeholder: string, position: number, length: number }>}
   */
  getRedactionMap() {
    if (!this._keepMap) {
      return [];
    }

    const result = [];
    for (const key of this._redactionOrder) {
      const entry = this._redactionMap.get(key);
      if (entry) {
        result.push({ key, ...entry });
      }
    }
    return result;
  }

  /**
   * Undo redaction by restoring original values from the redaction map.
   *
   * @param {string} redactedText — text with `[REDACTED:type]` placeholders
   * @returns {string} text with original values restored
   */
  undoRedaction(redactedText) {
    if (typeof redactedText !== 'string') {
      throw new TypeError('undoRedaction: redactedText must be a string');
    }
    if (!this._keepMap) {
      return redactedText;
    }

    let result = redactedText;

    // Build a search pattern for each redacted entry's placeholder
    // Process in reverse order so earlier indices remain valid
    const entries = this.getRedactionMap();
    for (const entry of entries) {
      // Find the specific placeholder instance
      // We use a simple string replace approach — replace the first occurrence
      // of this placeholder with the original text
      const idx = result.indexOf(entry.placeholder);
      if (idx !== -1) {
        result = result.substring(0, idx) + entry.original + result.substring(idx + entry.placeholder.length);
      }
    }

    return result;
  }

  /**
   * Clear the redaction map and counters.
   */
  clearRedactionMap() {
    this._redactionMap.clear();
    this._counter.clear();
    this._redactionOrder = [];
  }

  /**
   * Get the current placeholder template.
   * @returns {string}
   */
  getPlaceholder() {
    return this._placeholder;
  }

  /**
   * Get a summary of redactions performed.
   * @returns {{ total: number, byType: Record<string, number> }}
   */
  getRedactionSummary() {
    const byType = {};
    let total = 0;

    for (const key of this._redactionOrder) {
      const entry = this._redactionMap.get(key);
      if (entry) {
        byType[entry.type] = (byType[entry.type] || 0) + 1;
        total += 1;
      }
    }

    return Object.freeze({ total, byType: Object.freeze(byType) });
  }
}

module.exports = {
  RedactionEngine,
  REDACTION_TYPES,
  DEFAULT_PLACEHOLDER_TEMPLATE,
  createDefaultPatterns,
  buildPlaceholder,
  luhnCheck,
  escapeRegExp,
};
