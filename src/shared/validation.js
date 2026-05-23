'use strict';

/**
 * Validation & constraint utilities.
 *
 * These are the canonical implementations that should replace the ~35
 * scattered duplicates of `requireString`, `clamp`, and similar helpers
 * across the codebase.  They provide consistent error messages and a single
 * place to tighten validation rules.
 *
 * `requireString` and `requireEnum` delegate to `runtime/utils` so that the
 * existing canonical source stays the single point of truth for those two
 * signatures.
 */

const rt = require('../runtime/utils');

// ---------------------------------------------------------------------------
// requireString
// ---------------------------------------------------------------------------

/**
 * Assert `value` is a non-empty string.
 *
 * Delegates to the canonical implementation in `runtime/utils`.
 *
 * @param {*}      value
 * @param {string} name   — parameter name used in the error message
 * @throws {TypeError} when value is not a non-empty string
 */
function requireString(value, name) {
  rt.requireString(value, name);
}

// ---------------------------------------------------------------------------
// requireNumber
// ---------------------------------------------------------------------------

/**
 * Assert `value` is a finite number, optionally constrained to a [min, max]
 * range and/or required to be a safe integer.
 *
 * @param {*}      value
 * @param {string} name
 * @param {object} [opts]
 * @param {number} [opts.min]      — inclusive lower bound
 * @param {number} [opts.max]      — inclusive upper bound
 * @param {boolean} [opts.integer] — require a safe integer (no fractional part)
 * @throws {TypeError}
 */
function requireNumber(value, name, opts) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      name + ' must be a finite number, got ' + (value === null ? 'null' : typeof value),
    );
  }

  const min = opts && opts.min;
  const max = opts && opts.max;
  const integer = opts && opts.integer;

  if (min !== undefined && value < min) {
    throw new TypeError(name + ' must be >= ' + min + ', got ' + value);
  }
  if (max !== undefined && value > max) {
    throw new TypeError(name + ' must be <= ' + max + ', got ' + value);
  }
  if (integer && !Number.isSafeInteger(value)) {
    throw new TypeError(name + ' must be a safe integer, got ' + value);
  }

  // Return for callers who want `const n = requireNumber(x, 'x')`.
  return value;
}

// ---------------------------------------------------------------------------
// requireObject
// ---------------------------------------------------------------------------

/**
 * Assert `value` is a plain object (not null, not an array).
 *
 * @param {*}      value
 * @param {string} name
 * @throws {TypeError}
 */
function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      name + ' must be a plain object, got ' + (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value),
    );
  }
}

// ---------------------------------------------------------------------------
// requireArray
// ---------------------------------------------------------------------------

/**
 * Assert `value` is an array.
 *
 * @param {*}      value
 * @param {string} name
 * @throws {TypeError}
 */
function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(name + ' must be an array, got ' + typeof value);
  }
}

// ---------------------------------------------------------------------------
// requireEnum
// ---------------------------------------------------------------------------

/**
 * Assert `value` is one of the given option values.
 *
 * Delegates to the canonical implementation in `runtime/utils`.
 *
 * @param {*}      value
 * @param {object} options  — object whose values are the allowed set
 *                           (e.g. `{ A: 'a', B: 'b' }`)
 * @param {string} name
 * @throws {TypeError}
 */
function requireEnum(value, options, name) {
  rt.requireEnum(value, options, name);
}

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

/**
 * Clamp a number between [min, max] inclusive.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 * @throws {RangeError} when min > max
 *
 * @example
 *   clamp(5,   0, 10)  // => 5
 *   clamp(-1,  0, 10)  // => 0
 *   clamp(999, 0, 10)  // => 10
 */
function clamp(value, min, max) {
  if (min > max) {
    throw new RangeError('clamp: min (' + min + ') must be <= max (' + max + ')');
  }
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  clamp,
  requireArray,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,
};
