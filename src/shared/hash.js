'use strict';

/**
 * Hashing utilities.
 *
 * Provides SHA-256 and MD5 digests, deterministic object fingerprinting,
 * and content-addressable hashing.  Consolidates the two independent
 * implementations of `sha256` and `stripComments` that were duplicated
 * between `similarity/fingerprint.js` and `similarity/detector.js`.
 *
 * Only Node.js built-ins are used (no third-party deps).
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a string or Buffer.
 *
 * @param {string|Buffer} input
 * @returns {string}  64-character lowercase hex string
 *
 * @example
 *   sha256('hello')
 *   // => '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// MD5
// ---------------------------------------------------------------------------

/**
 * Compute the MD5 hex digest.
 *
 * Only suitable for **non-security** use cases: cache keys, content
 * addressing, checksums.  MD5 is cryptographically broken and must not be
 * used for password hashing or integrity verification.
 *
 * @param {string|Buffer} input
 * @returns {string}  32-character lowercase hex string
 *
 * @example
 *   md5('hello')
 *   // => '5d41402abc4b2a76b9719d911017c592'
 */
function md5(input) {
  return crypto.createHash('md5').update(input, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Deterministic object fingerprint
// ---------------------------------------------------------------------------

/**
 * Create a deterministic SHA-256 fingerprint for any value.
 *
 * Object keys are sorted before serialisation so that structurally
 * equivalent objects produce the same hash regardless of key insertion
 * order.  Functions, Symbols, and `undefined` values are silently dropped
 * during canonicalisation.
 *
 * @param {*} obj
 * @returns {string}  64-character hex fingerprint
 *
 * @example
 *   fingerprint({ b: 2, a: 1 }) === fingerprint({ a: 1, b: 2 })
 *   // => true
 */
function fingerprint(obj) {
  const canonical = _canonicalize(obj);
  return sha256(canonical);
}

// ---------------------------------------------------------------------------
// contentHash
// ---------------------------------------------------------------------------

/**
 * Compute a content-addressable hash.
 *
 * - Strings are hashed directly.
 * - Buffers are hashed directly.
 * - Plain objects are canonicalised (sorted keys) then hashed for determinism.
 * - `null` / primitives are stringified then hashed.
 *
 * @param {string|Buffer|object} content
 * @param {object} [opts]
 * @param {'sha256'|'md5'} [opts.algorithm='sha256']
 * @returns {string}  hex digest
 *
 * @example
 *   contentHash('payload')
 *   contentHash({ b: 2, a: 1 })  // key-order independent
 *   contentHash(buf, { algorithm: 'md5' })
 */
function contentHash(content, opts) {
  const algorithm =
    opts && opts.algorithm === 'md5' ? 'md5' : 'sha256';

  let input;
  if (Buffer.isBuffer(content)) {
    return crypto.createHash(algorithm).update(content).digest('hex');
  }

  if (typeof content === 'string') {
    input = content;
  } else if (typeof content === 'object' && content !== null) {
    // Deterministic serialisation so key order does not matter.
    input = _canonicalize(content);
  } else {
    input = String(content);
  }

  return crypto.createHash(algorithm).update(input, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Internal: canonicalise
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON-like representation.
 *
 * - Object keys are sorted.
 * - Arrays are serialised element-by-element.
 * - Primitives use `JSON.stringify`.
 * - Functions / Symbols / undefined are represented as `null` so they do not
 *   affect the hash (matching the behaviour of `JSON.stringify`).
 */
function _canonicalize(value) {
  if (value === null || typeof value === 'undefined') {
    return 'null';
  }

  const t = typeof value;
  if (t === 'function' || t === 'symbol') {
    return 'null';
  }

  if (t !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) {
      parts.push(_canonicalize(value[i]));
    }
    return '[' + parts.join(',') + ']';
  }

  // Plain object — sort keys for determinism.
  const keys = Object.keys(value).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = value[k];
    // Skip undefined values (consistent with JSON.stringify).
    if (typeof v === 'undefined') continue;
    parts.push(JSON.stringify(k) + ':' + _canonicalize(v));
  }
  return '{' + parts.join(',') + '}';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { contentHash, fingerprint, md5, sha256 };
