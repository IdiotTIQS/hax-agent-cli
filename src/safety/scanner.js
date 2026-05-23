'use strict';

const { RulesEngine } = require('./rules-engine');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Violation types emitted by the scanner.
 */
const VIOLATION_TYPES = Object.freeze([
  'PII',
  'SECRET',
  'MALICIOUS',
  'HARMFUL',
  'OFFENSIVE',
  'INJECTION',
]);

/**
 * Severity ordering for sorting violations.
 */
const SEVERITY_ORDER = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a violation to the standard shape.
 *
 * @param {object} raw
 * @param {string} [source] — where the violation was found ('input' | 'output' | 'toolResult')
 * @returns {object}
 */
function normalizeViolation(raw, source) {
  return {
    type: VIOLATION_TYPES.includes(raw.type) ? raw.type : 'MALICIOUS',
    severity: SEVERITY_ORDER[raw.severity] !== undefined ? raw.severity : 'MEDIUM',
    location: typeof raw.location === 'number' && raw.location >= 0 ? raw.location : -1,
    evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
    rule: typeof raw.rule === 'string' ? raw.rule : 'unknown',
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    category: typeof raw.category === 'string' ? raw.category : raw.type,
    source: source || 'unknown',
    timestamp: raw.timestamp || new Date().toISOString(),
  };
}

/**
 * Serialize a value to a string for scanning, safely.
 *
 * @param {*} value
 * @returns {string}
 */
function toStringSafe(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

/**
 * Truncate text for evidence display.
 *
 * @param {string} text
 * @param {number} [maxLen] — max characters (default 200)
 * @returns {string}
 */
function truncateEvidence(text, maxLen) {
  const limit = maxLen || 200;
  if (text.length <= limit) return text;
  return text.substring(0, limit) + '...';
}

// ---------------------------------------------------------------------------
// ContentScanner
// ---------------------------------------------------------------------------

/**
 * Scanner for content safety: input filtering, output moderation, sensitive
 * data detection, and policy enforcement.
 *
 * Uses an internal RulesEngine to evaluate text against a configurable set
 * of safety rules.
 */
class ContentScanner {
  /**
   * @param {object} [options]
   * @param {object[]} [options.rules] — custom rules for the underlying RulesEngine
   * @param {boolean} [options.failFast] — stop scanning on first CRITICAL violation (default: false)
   * @param {number} [options.maxEvidenceLength] — max characters for evidence in violations (default: 200)
   * @param {function} [options.onViolation] — callback invoked per violation: (violation) => void
   */
  constructor(options = {}) {
    this._engine = new RulesEngine(options.rules);
    this._violations = [];
    this._failFast = options.failFast === true;
    this._maxEvidenceLength = Number.isSafeInteger(options.maxEvidenceLength) && options.maxEvidenceLength > 0
      ? options.maxEvidenceLength
      : 200;
    this._onViolation = typeof options.onViolation === 'function' ? options.onViolation : null;
  }

  /**
   * Scan user input for safety concerns (injection, harmful content, PII, etc.).
   *
   * @param {string} text — user-provided input text
   * @returns {object} scan result with `passed`, `violations`, `score`, and `level`
   */
  scanInput(text) {
    this.clearViolations();

    if (typeof text !== 'string') {
      return this._makeResult(true, []);
    }

    const input = text.trim();
    if (input.length === 0) {
      return this._makeResult(true, []);
    }

    const result = this._engine.evaluate(input, { source: 'input' });

    for (const raw of result.violations) {
      const violation = normalizeViolation(raw, 'input');
      violation.evidence = truncateEvidence(violation.evidence, this._maxEvidenceLength);
      this._violations.push(violation);

      if (this._onViolation) {
        this._onViolation(violation);
      }

      if (this._failFast && violation.severity === 'CRITICAL') {
        break;
      }
    }

    return this._makeResult(this._violations.length === 0, this._violations);
  }

  /**
   * Scan AI-generated output for policy violations.
   *
   * @param {string} text — AI output text
   * @returns {object} scan result with `passed`, `violations`, `score`, and `level`
   */
  scanOutput(text) {
    this.clearViolations();

    if (typeof text !== 'string') {
      return this._makeResult(true, []);
    }

    const output = text.trim();
    if (output.length === 0) {
      return this._makeResult(true, []);
    }

    const result = this._engine.evaluate(output, { source: 'output' });

    for (const raw of result.violations) {
      const violation = normalizeViolation(raw, 'output');
      violation.evidence = truncateEvidence(violation.evidence, this._maxEvidenceLength);
      this._violations.push(violation);

      if (this._onViolation) {
        this._onViolation(violation);
      }

      if (this._failFast && violation.severity === 'CRITICAL') {
        break;
      }
    }

    return this._makeResult(this._violations.length === 0, this._violations);
  }

  /**
   * Scan a tool execution result for leaked secrets or other safety issues.
   * Accepts string results or object results (serialized to JSON for scanning).
   *
   * @param {string} toolName — name of the tool that produced the result
   * @param {*} result — the tool's result (string, object, array, etc.)
   * @returns {object} scan result with `passed`, `violations`, `score`, and `level`
   */
  scanToolResult(toolName, result) {
    this.clearViolations();

    const text = toStringSafe(result);
    if (text.length === 0) {
      return this._makeResult(true, []);
    }

    const engineResult = this._engine.evaluate(text, { source: 'toolResult', toolName });

    for (const raw of engineResult.violations) {
      const violation = normalizeViolation(raw, 'toolResult');
      violation.evidence = truncateEvidence(violation.evidence, this._maxEvidenceLength);
      violation.toolName = toolName;
      this._violations.push(violation);

      if (this._onViolation) {
        this._onViolation(violation);
      }

      if (this._failFast && violation.severity === 'CRITICAL') {
        break;
      }
    }

    return this._makeResult(this._violations.length === 0, this._violations);
  }

  /**
   * Get all violations found during the most recent scan.
   *
   * @returns {object[]} array of violation objects
   */
  getViolations() {
    return [...this._violations];
  }

  /**
   * Get violations filtered by severity.
   *
   * @param {string} severity — severity level to filter by
   * @returns {object[]}
   */
  getViolationsBySeverity(severity) {
    return this._violations.filter((v) => v.severity === severity);
  }

  /**
   * Get violations filtered by type.
   *
   * @param {string} type — violation type to filter by
   * @returns {object[]}
   */
  getViolationsByType(type) {
    return this._violations.filter((v) => v.type === type);
  }

  /**
   * Reset the scanner state, clearing all stored violations.
   */
  clearViolations() {
    this._violations = [];
  }

  /**
   * Get the underlying RulesEngine (for direct rule management).
   *
   * @returns {RulesEngine}
   */
  getEngine() {
    return this._engine;
  }

  /**
   * Build a standardized result object.
   *
   * @param {boolean} passed — true if no violations
   * @param {object[]} violations
   * @returns {object}
   * @private
   */
  _makeResult(passed, violations) {
    // Compute score: weighted by severity
    const weights = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3, INFO: 1 };
    let score = 0;
    for (const v of violations) {
      score += weights[v.severity] || 1;
    }
    score = Math.min(score, 100);

    let level;
    if (score >= 75) level = 'CRITICAL';
    else if (score >= 50) level = 'HIGH';
    else if (score >= 25) level = 'MEDIUM';
    else if (score >= 10) level = 'LOW';
    else if (score > 0) level = 'INFO';
    else level = 'NONE';

    return Object.freeze({
      passed,
      violations: Object.freeze([...violations]),
      score,
      level,
      violationCount: violations.length,
      summary: passed
        ? 'Content passed all safety checks.'
        : `Found ${violations.length} violation(s). Risk level: ${level} (${score}/100).`,
    });
  }

  /**
   * Scan a batch of items. Each item is { text, source }.
   * Source can be 'input', 'output', or 'toolResult'.
   *
   * @param {Array<{ text: string, source: string, toolName?: string }>} items
   * @returns {object} aggregated result
   */
  scanBatch(items) {
    if (!Array.isArray(items)) {
      throw new TypeError('scanBatch: items must be an array');
    }

    this.clearViolations();

    for (const item of items) {
      if (!item || typeof item.text !== 'string') continue;

      const input = item.text.trim();
      if (input.length === 0) continue;

      const source = item.source || 'unknown';
      const result = this._engine.evaluate(input, { source, toolName: item.toolName });

      for (const raw of result.violations) {
        const violation = normalizeViolation(raw, source);
        violation.evidence = truncateEvidence(violation.evidence, this._maxEvidenceLength);
        if (item.toolName) {
          violation.toolName = item.toolName;
        }
        this._violations.push(violation);

        if (this._onViolation) {
          this._onViolation(violation);
        }

        if (this._failFast && violation.severity === 'CRITICAL') {
          break;
        }
      }

      if (this._failFast && this._violations.some((v) => v.severity === 'CRITICAL')) {
        break;
      }
    }

    return this._makeResult(this._violations.length === 0, this._violations);
  }
}

module.exports = {
  ContentScanner,
  VIOLATION_TYPES,
  SEVERITY_ORDER,
  normalizeViolation,
  toStringSafe,
  truncateEvidence,
};
