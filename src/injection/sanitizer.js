'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sanitization levels in order of increasing aggressiveness.
 */
const SANITIZATION_LEVELS = Object.freeze({
  NONE: 0,
  LIGHT: 1,
  MODERATE: 2,
  AGGRESSIVE: 3,
});

/** Named levels for validation */
const LEVEL_NAMES = Object.freeze(['NONE', 'LIGHT', 'MODERATE', 'AGGRESSIVE']);

/**
 * Common injection instruction patterns to strip or neutralize.
 * These are high-confidence patterns unlikely to appear in legitimate text.
 */
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|skip)\s+(?:all\s+)?(?:previous|above|prior|earlier)\s+(?:instructions?|prompts?|commands?|directives?)\b/gi,
  /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+are|though\s+you\s+were)|pretend\s+(?:to\s+be|you\s+are|that\s+you\s+are))\s+(?:a[n]?\s+)?(?:\w+\s+){0,3}(?:assistant|AI|bot|model|agent|system|tool)\b/gi,
  /\b(?:from\s+now\s+on|starting\s+now|henceforth|hereafter)\s+(?:you\s+(?:are|will|must|should))\b/gi,
  /\b(?:print|show|reveal|display|output|repeat|echo|tell\s+me)\s+(?:your\s+(?:system\s+)?(?:prompt|instructions?|directives?|message))\b/gi,
  /\b(?:this\s+(?:is\s+more\s+important|overrides?|takes?\s+precedence|has\s+(?:higher|top)\s+priority)\s+(?:than|over))\b/gi,
  /\bDAN\b|\b(?:jailbreak|unshackled|unchained|unfiltered|developer\s*mode|god\s*mode)\b/gi,
  /\byour\s+(?:new|updated|revised|actual|real|true)\s+(?:instructions?|prompts?|directives?|system\s+(?:prompt|message))\b/gi,
];

/**
 * Delimiter characters that could be used for injection breakout.
 */
const DANGEROUS_DELIMITERS = [
  { from: '─', to: '-' },   // ─ (BOX DRAWINGS LIGHT HORIZONTAL) → -
  { from: '━', to: '-' },   // ━ (HEAVY) → -
  { from: '│', to: '|' },   // │ (LIGHT VERTICAL) → |
  { from: '┃', to: '|' },   // ┃ (HEAVY) → |
  { from: '┌', to: '+' },   // ┌ (LIGHT DOWN AND RIGHT) → +
  { from: '┐', to: '+' },   // ┐ (LIGHT DOWN AND LEFT) → +
  { from: '└', to: '+' },   // └ (LIGHT UP AND RIGHT) → +
  { from: '┘', to: '+' },   // ┘ (LIGHT UP AND LEFT) → +
  { from: '├', to: '+' },   // ├ (LIGHT VERTICAL AND RIGHT) → +
  { from: '┤', to: '+' },   // ┤ (LIGHT VERTICAL AND LEFT) → +
  { from: '┬', to: '+' },   // ┬ (LIGHT DOWN AND HORIZONTAL) → +
  { from: '┴', to: '+' },   // ┴ (LIGHT UP AND HORIZONTAL) → +
  { from: '┼', to: '+' },   // ┼ (LIGHT VERTICAL AND HORIZONTAL) → +
  { from: '═', to: '=' },   // ═ (DOUBLE HORIZONTAL) → =
  { from: '║', to: '|' },   // ║ (DOUBLE VERTICAL) → |
  { from: '／', to: '/' },   // ／ (FULLWIDTH SOLIDUS) → /
  { from: '＼', to: '\\' },  // ＼ (FULLWIDTH REVERSE SOLIDUS) → \
  { from: '＾', to: '^' },   // ＾ (FULLWIDTH CIRCUMFLEX) → ^
  { from: '｜', to: '|' },   // ｜ (FULLWIDTH VERTICAL LINE) → |
];

/**
 * Zero-width and invisible Unicode characters to strip.
 */
const ZERO_WIDTH_CHARS = new RegExp('[\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\uFEFF]', 'g');

/**
 * Safety delimiter wrappers used by quarantine().
 */
const SAFETY_DELIMITER_START = '<<<SAFETY_BEGIN>>>';
const SAFETY_DELIMITER_END = '<<<SAFETY_END>>>';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a sanitization level from a string name or numeric value.
 *
 * @param {string|number} level
 * @returns {number}
 */
function resolveLevel(level) {
  if (typeof level === 'number') {
    if (Number.isSafeInteger(level) && level >= 0 && level <= 3) {
      return level;
    }
    throw new RangeError(`Invalid sanitization level number: ${level}. Must be 0-3.`);
  }

  if (typeof level !== 'string') {
    throw new TypeError('sanitization level must be a string or number');
  }

  const idx = LEVEL_NAMES.indexOf(level.toUpperCase());
  if (idx === -1) {
    throw new RangeError(`Unknown sanitization level: "${level}". Valid: ${LEVEL_NAMES.join(', ')}`);
  }
  return idx;
}

/**
 * Escape special regex characters for literal matching.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// InjectionSanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitizer for neutralizing prompt injection attempts in user input.
 * Supports four sanitization levels: NONE, LIGHT, MODERATE, AGGRESSIVE.
 */
class InjectionSanitizer {
  /**
   * @param {object} [options]
   * @param {string} [options.defaultLevel] — default sanitization level (default: 'MODERATE')
   * @param {string[]} [options.allowlist] — patterns to always preserve
   * @param {boolean} [options.stripInvisible] — always strip invisible characters (default: true)
   * @param {number} [options.maxInputLength] — truncate inputs longer than this
   */
  constructor(options = {}) {
    this._defaultLevel = resolveLevel(
      options.defaultLevel !== undefined ? options.defaultLevel : 'MODERATE',
    );
    this._allowlist = Array.isArray(options.allowlist) ? options.allowlist.map(String) : [];
    this._stripInvisible = options.stripInvisible !== false;
    this._maxInputLength =
      Number.isSafeInteger(options.maxInputLength) && options.maxInputLength > 0
        ? options.maxInputLength
        : null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Sanitize input text based on the specified threat level.
   *
   * @param {string} input — the text to sanitize
   * @param {string|number} [level] — sanitization level (defaults to constructor default)
   * @returns {object} { sanitized, original, level, actions }
   */
  sanitize(input, level) {
    const sanitizationLevel =
      level !== undefined ? resolveLevel(level) : this._defaultLevel;

    if (typeof input !== 'string') {
      return {
        sanitized: '',
        original: String(input || ''),
        level: LEVEL_NAMES[sanitizationLevel],
        actions: ['invalid_input'],
      };
    }

    if (sanitizationLevel === SANITIZATION_LEVELS.NONE) {
      return {
        sanitized: input,
        original: input,
        level: 'NONE',
        actions: [],
        changed: false,
      };
    }

    let result = input;
    const actions = [];

    // Always strip zero-width characters (configurable)
    if (this._stripInvisible) {
      const before = result;
      result = result.replace(ZERO_WIDTH_CHARS, '');
      if (result !== before) {
        actions.push('stripped_invisible_chars');
      }
    }

    // LIGHT: basic cleanup
    if (sanitizationLevel >= SANITIZATION_LEVELS.LIGHT) {
      // Normalize dangerous delimiters
      const beforeDelim = result;
      result = this.normalizeDelimiters(result);
      if (result !== beforeDelim) {
        actions.push('normalized_delimiters');
      }

      // Remove null bytes
      if (result.indexOf('\x00') !== -1) {
        result = result.replace(/\x00/g, '');
        actions.push('removed_null_bytes');
      }
    }

    // MODERATE: neutralization + instruction stripping
    if (sanitizationLevel >= SANITIZATION_LEVELS.MODERATE) {
      // Neutralize common injection patterns
      const beforeNeutralize = result;
      result = this.neutralize(result);
      if (result !== beforeNeutralize) {
        actions.push('neutralized_injection');
      }

      // Strip instruction-like patterns
      const beforeStrip = result;
      result = this.stripInstructions(result);
      if (result !== beforeStrip) {
        actions.push('stripped_instructions');
      }
    }

    // AGGRESSIVE: full quarantine
    if (sanitizationLevel === SANITIZATION_LEVELS.AGGRESSIVE) {
      const beforeQuarantine = result;
      result = this.quarantine(result);
      if (result !== beforeQuarantine) {
        actions.push('quarantined');
      }
    }

    // Enforce max length if configured
    if (this._maxInputLength && result.length > this._maxInputLength) {
      result = result.substring(0, this._maxInputLength);
      actions.push('truncated');
    }

    return {
      sanitized: result,
      original: input,
      level: LEVEL_NAMES[sanitizationLevel],
      actions,
      changed: result !== input,
    };
  }

  /**
   * Neutralize common injection patterns by replacing or escaping
   * dangerous content while preserving readability where possible.
   *
   * @param {string} input
   * @returns {string} neutralized text
   */
  neutralize(input) {
    if (typeof input !== 'string') return '';

    let result = input;

    // Replace "ignore previous instructions" type patterns
    result = result.replace(
      /\b(ignore|disregard|forget|skip|override)\s+(all\s+)?(previous|above|prior|earlier|the\s+)?\s*(instructions?|prompts?|commands?|directives?)\b/gi,
      '[NEUTRALIZED: $1 $2$3 $4]',
    );

    // Neutralize role assignment patterns
    result = result.replace(
      /\b(you\s+are\s+now|act\s+as\s+(?:if\s+you\s+are|though\s+you\s+were)|pretend\s+(?:to\s+be|you\s+are|that\s+you\s+are))\s+(a[n]?\s+)/gi,
      'I note the statement: "$1 $2" — ',
    );

    // Neutralize jailbreak terms
    result = result.replace(
      /\b(DAN|jailbreak|unshackled|unchained|developer\s*mode|god\s*mode|admin\s*mode)\b/gi,
      '[NEUTRALIZED: $1]',
    );

    // Neutralize system prompt extraction
    result = result.replace(
      /\b(print|show|reveal|display|output|repeat|echo|tell\s+me)\s+(your\s+(?:system\s+)?(?:prompt|instructions?|directives?|message))\b/gi,
      '[NEUTRALIZED: $1 $2]',
    );

    // Neutralize priority override claims
    result = result.replace(
      /\b(this\s+(?:is\s+(?:more\s+)?important|overrides?|takes?\s+precedence|has\s+(?:higher|top)\s+priority)\s+(?:than|over))\b/gi,
      '[NEUTRALIZED: priority claim]',
    );

    // Neutralize markup injection: <system>, <instructions>, etc.
    result = result.replace(
      /<\/?(?:system|instructions?|prompts?|commands?|directives?|rules?|config|settings|memory|context|persona)[^>]*>/gi,
      (match) => match.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    );

    // Neutralize shell injection patterns in tool-like contexts
    result = result.replace(
      /(\b(?:rm\s+-rf|mkfs\.\w+|dd\s+if=)|[;&|`$])\s*(rm\s+-rf|mkfs|dd\s+if|wget\s+|curl\s+)/gi,
      '[NEUTRALIZED: shell pattern]',
    );

    return result;
  }

  /**
   * Wrap suspected content in safety delimiters to clearly mark it
   * as untrusted user content, preventing prompt confusion.
   *
   * @param {string} input
   * @returns {string} wrapped content
   */
  quarantine(input) {
    if (typeof input !== 'string') return '';

    return `${SAFETY_DELIMITER_START}\n${input}\n${SAFETY_DELIMITER_END}`;
  }

  /**
   * Remove instruction-like patterns from text. More aggressive than
   * neutralize() - this actually removes content rather than marking it.
   *
   * @param {string} input
   * @returns {string} text with instruction patterns removed
   */
  stripInstructions(input) {
    if (typeof input !== 'string') return '';

    let result = input;

    for (const pattern of INSTRUCTION_PATTERNS) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, '[FILTERED]');
    }

    return result;
  }

  /**
   * Normalize special delimiters - replaces Unicode box-drawing chars,
   * fullwidth punctuation, and other lookalike characters with their
   * standard ASCII equivalents.
   *
   * @param {string} input
   * @returns {string} text with normalized delimiters
   */
  normalizeDelimiters(input) {
    if (typeof input !== 'string') return '';

    let result = input;

    for (const { from, to } of DANGEROUS_DELIMITERS) {
      if (result.indexOf(from) !== -1) {
        result = result.split(from).join(to);
      }
    }

    return result;
  }

  /**
   * Unwrap content from quarantine markers, recovering the original text.
   *
   * @param {string} input
   * @returns {string} unwrapped content, or original if not quarantined
   */
  unquarantine(input) {
    if (typeof input !== 'string') return '';

    const startIdx = input.indexOf(SAFETY_DELIMITER_START);
    const endIdx = input.indexOf(SAFETY_DELIMITER_END);

    if (startIdx === -1 || endIdx === -1) return input;

    const contentStart = startIdx + SAFETY_DELIMITER_START.length;
    const content = input.slice(contentStart, endIdx);
    return content.replace(/^\n/, '').replace(/\n$/, '');
  }

  /**
   * Update the default sanitization level.
   *
   * @param {string|number} level
   */
  setDefaultLevel(level) {
    this._defaultLevel = resolveLevel(level);
  }

  /**
   * Get the current default sanitization level name.
   *
   * @returns {string}
   */
  getDefaultLevel() {
    return LEVEL_NAMES[this._defaultLevel];
  }
}

module.exports = {
  InjectionSanitizer,
  SANITIZATION_LEVELS,
  LEVEL_NAMES,
  INSTRUCTION_PATTERNS,
  DANGEROUS_DELIMITERS,
  SAFETY_DELIMITER_START,
  SAFETY_DELIMITER_END,
  resolveLevel,
};
