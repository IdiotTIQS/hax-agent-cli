'use strict';

/**
 * Tests for shared/validation.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  clamp,
  requireArray,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,
} = require('../../src/shared/validation');

// ---------------------------------------------------------------------------
describe('requireString', () => {

  it('passes for a non-empty string', () => {
    assert.doesNotThrow(() => requireString('hello', 'arg'));
    assert.doesNotThrow(() => requireString('  spaced  ', 'arg'));
  });

  it('throws for an empty string', () => {
    assert.throws(
      () => requireString('', 'arg'),
      /must be a non-empty string/,
    );
  });

  it('throws for a whitespace-only string', () => {
    assert.throws(
      () => requireString('   ', 'arg'),
      /must be a non-empty string/,
    );
  });

  it('throws for a non-string', () => {
    assert.throws(
      () => requireString(42, 'arg'),
      /must be a non-empty string/,
    );
    assert.throws(
      () => requireString(null, 'arg'),
      /must be a non-empty string/,
    );
    assert.throws(
      () => requireString(undefined, 'arg'),
      /must be a non-empty string/,
    );
    assert.throws(
      () => requireString({}, 'arg'),
      /must be a non-empty string/,
    );
  });

  it('includes the parameter name in the error message', () => {
    assert.throws(
      () => requireString('', 'username'),
      /username must be a non-empty string/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('requireNumber', () => {

  it('passes for a finite number', () => {
    assert.strictEqual(requireNumber(0, 'n'), 0);
    assert.strictEqual(requireNumber(3.14, 'n'), 3.14);
    assert.strictEqual(requireNumber(-100, 'n'), -100);
  });

  it('throws for NaN', () => {
    assert.throws(
      () => requireNumber(NaN, 'n'),
      /must be a finite number/,
    );
  });

  it('throws for Infinity', () => {
    assert.throws(
      () => requireNumber(Infinity, 'n'),
      /must be a finite number/,
    );
    assert.throws(
      () => requireNumber(-Infinity, 'n'),
      /must be a finite number/,
    );
  });

  it('throws for non-numbers', () => {
    assert.throws(() => requireNumber('42', 'n'), /must be a finite number/);
    assert.throws(() => requireNumber(null, 'n'), /must be a finite number/);
    assert.throws(() => requireNumber(undefined, 'n'), /must be a finite number/);
    assert.throws(() => requireNumber({}, 'n'), /must be a finite number/);
  });

  it('enforces opts.min', () => {
    assert.doesNotThrow(() => requireNumber(5, 'n', { min: 5 }));
    assert.doesNotThrow(() => requireNumber(10, 'n', { min: 5 }));
    assert.throws(
      () => requireNumber(3, 'n', { min: 5 }),
      /must be >= 5/,
    );
  });

  it('enforces opts.max', () => {
    assert.doesNotThrow(() => requireNumber(5, 'n', { max: 5 }));
    assert.doesNotThrow(() => requireNumber(2, 'n', { max: 5 }));
    assert.throws(
      () => requireNumber(10, 'n', { max: 5 }),
      /must be <= 5/,
    );
  });

  it('enforces opts.integer', () => {
    assert.doesNotThrow(() => requireNumber(42, 'n', { integer: true }));
    assert.throws(
      () => requireNumber(3.14, 'n', { integer: true }),
      /must be a safe integer/,
    );
    assert.throws(
      () => requireNumber(Number.MAX_SAFE_INTEGER + 1, 'n', { integer: true }),
      /must be a safe integer/,
    );
  });

  it('combines min, max, and integer', () => {
    assert.doesNotThrow(() => requireNumber(5, 'n', { min: 1, max: 10, integer: true }));
    assert.throws(
      () => requireNumber(0, 'n', { min: 1, max: 10, integer: true }),
      /must be >= 1/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('requireObject', () => {

  it('passes for a plain object', () => {
    assert.doesNotThrow(() => requireObject({}, 'arg'));
    assert.doesNotThrow(() => requireObject({ a: 1 }, 'arg'));
  });

  it('throws for an array', () => {
    assert.throws(
      () => requireObject([], 'arg'),
      /must be a plain object/,
    );
  });

  it('throws for null', () => {
    assert.throws(
      () => requireObject(null, 'arg'),
      /must be a plain object/,
    );
  });

  it('throws for primitives', () => {
    assert.throws(() => requireObject(42, 'arg'), /must be a plain object/);
    assert.throws(() => requireObject('hi', 'arg'), /must be a plain object/);
  });
});

// ---------------------------------------------------------------------------
describe('requireArray', () => {

  it('passes for an array', () => {
    assert.doesNotThrow(() => requireArray([], 'arg'));
    assert.doesNotThrow(() => requireArray([1, 2, 3], 'arg'));
  });

  it('throws for non-arrays', () => {
    assert.throws(() => requireArray({}, 'arg'), /must be an array/);
    assert.throws(() => requireArray(42, 'arg'), /must be an array/);
    assert.throws(() => requireArray(null, 'arg'), /must be an array/);
    assert.throws(() => requireArray('abc', 'arg'), /must be an array/);
  });
});

// ---------------------------------------------------------------------------
describe('requireEnum', () => {

  const Colors = Object.freeze({ RED: 'red', GREEN: 'green', BLUE: 'blue' });

  it('passes for a valid enum value', () => {
    assert.doesNotThrow(() => requireEnum('red', Colors, 'color'));
    assert.doesNotThrow(() => requireEnum('blue', Colors, 'color'));
  });

  it('throws for an invalid value', () => {
    assert.throws(
      () => requireEnum('yellow', Colors, 'color'),
      /must be one of/,
    );
  });

  it('throws for a non-string that is not in the enum', () => {
    assert.throws(
      () => requireEnum(42, Colors, 'color'),
      /must be one of/,
    );
  });

  it('includes the allowed values in the error message', () => {
    assert.throws(
      () => requireEnum('cyan', Colors, 'color'),
      /red, green, blue/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('clamp', () => {

  it('returns value when within range', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(0, 0, 10), 0);
    assert.strictEqual(clamp(10, 0, 10), 10);
  });

  it('clamps to min', () => {
    assert.strictEqual(clamp(-1, 0, 10), 0);
    assert.strictEqual(clamp(-100, 0, 10), 0);
  });

  it('clamps to max', () => {
    assert.strictEqual(clamp(11, 0, 10), 10);
    assert.strictEqual(clamp(999, 0, 10), 10);
  });

  it('handles negative ranges', () => {
    assert.strictEqual(clamp(-50, -100, -10), -50);
    assert.strictEqual(clamp(-200, -100, -10), -100);
    assert.strictEqual(clamp(0, -100, -10), -10);
  });

  it('throws when min > max', () => {
    assert.throws(
      () => clamp(5, 10, 0),
      /min.*must be <= max/,
    );
  });
});
