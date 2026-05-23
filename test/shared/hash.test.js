'use strict';

/**
 * Tests for shared/hash.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  contentHash,
  fingerprint,
  md5,
  sha256,
} = require('../../src/shared/hash');

// ---------------------------------------------------------------------------
describe('sha256', () => {

  it('produces a 64-character lowercase hex string', () => {
    const result = sha256('hello');
    assert.strictEqual(typeof result, 'string');
    assert.strictEqual(result.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(result));
  });

  it('is deterministic', () => {
    const a = sha256('hello');
    const b = sha256('hello');
    assert.strictEqual(a, b);
  });

  it('produces the expected hash for a known input', () => {
    const result = sha256('hello');
    const expected = crypto.createHash('sha256').update('hello').digest('hex');
    assert.strictEqual(result, expected);
  });

  it('produces different hashes for different inputs', () => {
    const a = sha256('hello');
    const b = sha256('world');
    assert.notStrictEqual(a, b);
  });

  it('handles an empty string', () => {
    const result = sha256('');
    assert.strictEqual(result.length, 64);
    const expected = crypto.createHash('sha256').update('').digest('hex');
    assert.strictEqual(result, expected);
  });
});

// ---------------------------------------------------------------------------
describe('md5', () => {

  it('produces a 32-character lowercase hex string', () => {
    const result = md5('hello');
    assert.strictEqual(typeof result, 'string');
    assert.strictEqual(result.length, 32);
    assert.ok(/^[a-f0-9]{32}$/.test(result));
  });

  it('is deterministic', () => {
    assert.strictEqual(md5('hello'), md5('hello'));
  });

  it('matches Node.js built-in md5', () => {
    const result = md5('hello');
    const expected = crypto.createHash('md5').update('hello').digest('hex');
    assert.strictEqual(result, expected);
  });
});

// ---------------------------------------------------------------------------
describe('fingerprint', () => {

  it('produces a 64-character hex string', () => {
    const fp = fingerprint({ a: 1 });
    assert.strictEqual(fp.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(fp));
  });

  it('is deterministic for the same object', () => {
    const obj = { x: 10, y: 20 };
    assert.strictEqual(fingerprint(obj), fingerprint(obj));
  });

  it('is stable across key insertion order', () => {
    const fp1 = fingerprint({ a: 1, b: 2 });
    const fp2 = fingerprint({ b: 2, a: 1 });
    assert.strictEqual(fp1, fp2);
  });

  it('produces different fingerprints for different objects', () => {
    const fp1 = fingerprint({ a: 1 });
    const fp2 = fingerprint({ a: 2 });
    assert.notStrictEqual(fp1, fp2);
  });

  it('handles nested objects deterministically', () => {
    const obj1 = { user: { id: 1, name: 'Alice' } };
    const obj2 = { user: { name: 'Alice', id: 1 } };
    assert.strictEqual(fingerprint(obj1), fingerprint(obj2));
  });

  it('handles arrays', () => {
    const fp1 = fingerprint([1, 2, 3]);
    const fp2 = fingerprint([1, 2, 3]);
    assert.strictEqual(fp1, fp2);

    // Different order => different fingerprint
    const fp3 = fingerprint([3, 2, 1]);
    assert.notStrictEqual(fp1, fp3);
  });

  it('ignores undefined values in objects', () => {
    // undefined keys are skipped during canonicalisation, like JSON.stringify.
    const fp1 = fingerprint({ a: 1, b: undefined });
    const fp2 = fingerprint({ a: 1 });
    assert.strictEqual(fp1, fp2);
  });

  it('handles primitives', () => {
    assert.strictEqual(typeof fingerprint('hello'), 'string');
    assert.strictEqual(typeof fingerprint(42), 'string');
    assert.strictEqual(typeof fingerprint(null), 'string');
  });
});

// ---------------------------------------------------------------------------
describe('contentHash', () => {

  it('hashes a string with default sha256', () => {
    const h = contentHash('payload');
    assert.strictEqual(h, sha256('payload'));
  });

  it('hashes a string with md5 algorithm', () => {
    const h = contentHash('payload', { algorithm: 'md5' });
    assert.strictEqual(h, md5('payload'));
  });

  it('hashes an object deterministically', () => {
    const h1 = contentHash({ b: 2, a: 1 });
    const h2 = contentHash({ a: 1, b: 2 });
    assert.strictEqual(h1, h2);
  });

  it('hashes a Buffer', () => {
    const buf = Buffer.from('hello');
    const h = contentHash(buf);
    assert.strictEqual(h, sha256('hello'));
  });

  it('hashes null / primitive values', () => {
    const hNull = contentHash(null);
    const hNum = contentHash(42);
    assert.strictEqual(typeof hNull, 'string');
    assert.strictEqual(typeof hNum, 'string');
  });

  it('defaults to sha256 when algorithm is unrecognised', () => {
    const h = contentHash('data', { algorithm: 'sha512' });
    // sha512 is not one of the recognised options ('sha256', 'md5'),
    // so it should fall back to sha256.
    assert.strictEqual(h, sha256('data'));
  });

  it('opts is optional', () => {
    assert.strictEqual(contentHash('x'), sha256('x'));
  });
});
