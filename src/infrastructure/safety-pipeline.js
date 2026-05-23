'use strict';

const { InjectionDetector } = require('../injection/detector');
const { InjectionSanitizer } = require('../injection/sanitizer');
const { ContentScanner } = require('../safety/scanner');

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = Object.freeze(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function severityGte(a, b) {
  const aIdx = SEVERITY_ORDER.indexOf(a);
  const bIdx = SEVERITY_ORDER.indexOf(b);
  return aIdx >= bIdx;
}

// Zero-width and invisible characters (U+200B-U+200F, U+2028-U+2029, U+202A-U+202E, U+FEFF)
var ZERO_WIDTH_RX = new RegExp('[\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\uFEFF]', 'g');

// ---------------------------------------------------------------------------
// SafetyPipeline
// ---------------------------------------------------------------------------

/**
 * Composable input pipeline that sanitizes, detects injection, and
 * optionally blocks or warns on dangerous content before it reaches
 * the agent engine.
 */
class SafetyPipeline {
  /**
   * @param {object} [options]
   * @param {string}  [options.blockOnSeverity='CRITICAL'] — severity at which to block
   * @param {string}  [options.warnOnSeverity='HIGH'] — severity at which to emit warnings
   * @param {boolean} [options.enableSafetyScan=true] — run ContentScanner
   * @param {boolean} [options.sanitizeOnDetect=true] — run InjectionSanitizer after detection
   * @param {boolean} [options.strictDetection=false] — strict InjectionDetector mode
   * @param {string[]} [options.disabledDetectionTypes] — detection types to skip
   * @param {string}  [options.sanitizerLevel='MODERATE'] — InjectionSanitizer default level
   * @param {number}  [options.maxInputLength] — truncate inputs longer than this
   * @param {boolean} [options.stripInvisible=true] — strip invisible characters
   * @param {boolean} [options.failFast=false] — ContentScanner failFast
   */
  constructor(options = {}) {
    this.blockOnSeverity = options.blockOnSeverity || 'CRITICAL';
    this.warnOnSeverity = options.warnOnSeverity || 'HIGH';
    this.enableSafetyScan = options.enableSafetyScan !== false;
    this.sanitizeOnDetect = options.sanitizeOnDetect !== false;
    this.stripInvisible = options.stripInvisible !== false;

    this._detector = new InjectionDetector({
      strict: options.strictDetection === true,
      disabledTypes: Array.isArray(options.disabledDetectionTypes)
        ? options.disabledDetectionTypes
        : [],
    });

    this._sanitizer = new InjectionSanitizer({
      defaultLevel: options.sanitizerLevel || 'MODERATE',
      stripInvisible: this.stripInvisible,
      maxInputLength: Number.isSafeInteger(options.maxInputLength) && options.maxInputLength > 0
        ? options.maxInputLength
        : null,
    });

    this._scanner = this.enableSafetyScan
      ? new ContentScanner({ failFast: options.failFast === true })
      : null;
  }

  /**
   * Run input text through the full pipeline:
   *   1. Basic sanitization (null bytes, invisible characters)
   *   2. Injection detection
   *   3. If injection detected: sanitize or block
   *   4. Content safety scan
   *
   * @param {string} text - raw user input
   * @returns {{ cleaned: string, warnings: string[], blocked: boolean }}
   */
  processInput(text) {
    if (typeof text !== 'string') {
      return { cleaned: '', warnings: ['Invalid input type'], blocked: true };
    }

    var warnings = [];
    var cleaned = text;

    // Step 1 — basic input sanitization (null bytes, zero-width chars)
    cleaned = cleaned.replace(/\x00/g, '');
    if (this.stripInvisible) {
      cleaned = cleaned.replace(ZERO_WIDTH_RX, '');
    }

    // Step 2 — injection detection
    var detection = this._detector.detect(cleaned);

    if (!detection.isClean) {
      // Collect warnings from detection matches
      for (var i = 0; i < detection.matches.length; i++) {
        var match = detection.matches[i];
        warnings.push('[' + match.severity + '] ' + (match.detail || match.patternName));
      }

      // Block if severity meets threshold
      if (severityGte(detection.threatLevel, this.blockOnSeverity)) {
        return {
          cleaned: '',
          warnings: warnings,
          blocked: true,
          threatLevel: detection.threatLevel,
          matchCount: detection.matchCount,
        };
      }

      // Step 3 — sanitize on detection (if not blocked)
      if (this.sanitizeOnDetect) {
        var sanitization = this._sanitizer.sanitize(cleaned, 'MODERATE');
        cleaned = sanitization.sanitized;

        if (sanitization.actions.length > 0) {
          warnings.push('Sanitization applied: ' + sanitization.actions.join(', '));
        }
      }
    }

    // Step 4 — content safety scan
    if (this._scanner) {
      var scanResult = this._scanner.scanInput(cleaned);

      if (!scanResult.passed) {
        for (var j = 0; j < scanResult.violations.length; j++) {
          var v = scanResult.violations[j];
          var msg = v.detail || v.evidence || '';
          warnings.push('[' + v.severity + '] ' + v.type + ': ' + msg);
        }

        if (severityGte(scanResult.level, this.blockOnSeverity)) {
          return {
            cleaned: '',
            warnings: warnings,
            blocked: true,
            safetyLevel: scanResult.level,
            safetyScore: scanResult.score,
          };
        }
      }
    }

    return {
      cleaned: cleaned,
      warnings: warnings,
      blocked: false,
      threatLevel: detection.threatLevel || 'NONE',
      matchCount: detection.matchCount || 0,
    };
  }

  /**
   * Access the underlying InjectionDetector for direct use.
   * @returns {InjectionDetector}
   */
  getDetector() {
    return this._detector;
  }

  /**
   * Access the underlying InjectionSanitizer for direct use.
   * @returns {InjectionSanitizer}
   */
  getSanitizer() {
    return this._sanitizer;
  }

  /**
   * Access the underlying ContentScanner for direct use.
   * @returns {ContentScanner|null}
   */
  getScanner() {
    return this._scanner;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a configured input safety pipeline.
 *
 * @param {object} [options] — see SafetyPipeline constructor
 * @returns {SafetyPipeline}
 */
function createInputPipeline(options) {
  return new SafetyPipeline(options);
}

module.exports = {
  SafetyPipeline,
  createInputPipeline,
  SEVERITY_ORDER,
};
