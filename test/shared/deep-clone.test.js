'use strict';

/**
 * Tests for shared/deep-clone.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { deepClone } = require('../../src/shared/deep-clone');

// ---------------------------------------------------------------------------
describe('deepClone', () => {

  // ---- Primitives ------------------------------------------------------------

  it('returns primitives unchanged', () => {
    assert.strictEqual(deepClone(42), 42);
    assert.strictEqual(deepClone('hello'), 'hello');
    assert.strictEqual(deepClone(true), true);
    assert.strictEqual(deepClone(null), null);
    assert.strictEqual(deepClone(undefined), undefined);
  });

  // ---- Plain objects ---------------------------------------------------------

  it('deep-clones a plain object', () => {
    const original = { a: 1, b: 'two', c: true, d: null };
    const copy = deepClone(original);

    assert.deepStrictEqual(copy, original);
    assert.notStrictEqual(copy, original);
  });

  // ---- Arrays ----------------------------------------------------------------

  it('deep-clones an array', () => {
    const original = [1, 'two', true, null];
    const copy = deepClone(original);

    assert.deepStrictEqual(copy, original);
    assert.notStrictEqual(copy, original);
  });

  // ---- Nested structures -----------------------------------------------------

  it('deep-clones nested objects', () => {
    const original = {
      level: 1,
      child: { level: 2, items: [10, 20, 30] },
    };
    const copy = deepClone(original);

    assert.deepStrictEqual(copy, original);
    assert.notStrictEqual(copy.child, original.child);
    assert.notStrictEqual(copy.child.items, original.child.items);
  });

  // ---- Date ------------------------------------------------------------------

  it('preserves Date objects (not lost to JSON round-trip)', () => {
    const original = { when: new Date('2024-01-15T12:00:00Z') };
    const copy = deepClone(original);

    assert.ok(copy.when instanceof Date);
    assert.strictEqual(copy.when.getTime(), original.when.getTime());

    // Mutate the copy — original must not change.
    copy.when.setFullYear(2030);
    assert.notStrictEqual(copy.when.getTime(), original.when.getTime());
  });

  // ---- Map -------------------------------------------------------------------

  it('preserves Map objects', () => {
    const original = {
      data: new Map([
        ['key1', 'value1'],
        ['key2', 42],
      ]),
    };
    const copy = deepClone(original);

    assert.ok(copy.data instanceof Map);
    assert.strictEqual(copy.data.size, 2);
    assert.strictEqual(copy.data.get('key1'), 'value1');
    assert.strictEqual(copy.data.get('key2'), 42);
    assert.notStrictEqual(copy.data, original.data);
  });

  // ---- Set -------------------------------------------------------------------

  it('preserves Set objects', () => {
    const original = { tags: new Set(['a', 'b', 'c']) };
    const copy = deepClone(original);

    assert.ok(copy.tags instanceof Set);
    assert.strictEqual(copy.tags.size, 3);
    assert.ok(copy.tags.has('a'));
    assert.ok(copy.tags.has('b'));
    assert.ok(copy.tags.has('c'));
    assert.notStrictEqual(copy.tags, original.tags);
  });

  // ---- RegExp ----------------------------------------------------------------

  it('preserves RegExp objects', () => {
    const original = { pattern: /^hello\s+world$/gi };
    const copy = deepClone(original);

    assert.ok(copy.pattern instanceof RegExp);
    assert.strictEqual(copy.pattern.source, '^hello\\s+world$');
    assert.strictEqual(copy.pattern.flags, 'gi');
    assert.notStrictEqual(copy.pattern, original.pattern);
  });

  // ---- Circular references ---------------------------------------------------

  it('handles circular references gracefully', () => {
    const original = { name: 'root' };
    original.self = original;
    original.child = { parent: original };

    const copy = deepClone(original);

    assert.strictEqual(copy.name, 'root');
    assert.strictEqual(copy.self, copy);           // self-reference preserved
    assert.strictEqual(copy.child.parent, copy);   // parent chain preserved
    assert.notStrictEqual(copy, original);
  });

  // ---- Depth limit -----------------------------------------------------------

  it('respects opts.depth=0 (shallow clone)', () => {
    const inner = { a: 1 };
    const original = { outer: inner };
    const copy = deepClone(original, { depth: 0 });

    assert.notStrictEqual(copy, original);
    // At depth 0 we create a new top-level object but the child is the same ref.
    assert.strictEqual(copy.outer, original.outer);
  });

  it('respects opts.depth=1', () => {
    const leaf = { x: 10 };
    const middle = { child: leaf };
    const original = { top: middle };

    const copy = deepClone(original, { depth: 1 });

    assert.notStrictEqual(copy, original);
    assert.notStrictEqual(copy.top, original.top);
    // Beyond depth 1: leaf is shared.
    assert.strictEqual(copy.top.child, original.top.child);
  });

  it('throws on negative depth', () => {
    assert.throws(
      () => deepClone({}, { depth: -1 }),
      /opts\.depth must be >= 0/,
    );
  });

  // ---- Edge cases ------------------------------------------------------------

  it('handles an empty object', () => {
    const copy = deepClone({});
    assert.deepStrictEqual(copy, {});
    assert.notStrictEqual(copy, {});
  });

  it('handles an empty array', () => {
    const copy = deepClone([]);
    assert.deepStrictEqual(copy, []);
    assert.notStrictEqual(copy, []);
  });

  it('handles mixed Map keys (string + number)', () => {
    const m = new Map();
    m.set(1, 'one');
    m.set('2', 'two');
    const copy = deepClone(m);
    assert.strictEqual(copy.get(1), 'one');
    assert.strictEqual(copy.get('2'), 'two');
  });

  it('handles nested Map with object values', () => {
    const key = { id: 1 };
    const m = new Map();
    m.set(key, { name: 'test' });
    const copy = deepClone(m);

    // The cloned key is a different object but .deepStrictEqual.
    const clonedKey = [...copy.keys()][0];
    assert.deepStrictEqual(clonedKey, key);
    assert.notStrictEqual(clonedKey, key);

    const val = copy.get(clonedKey);
    assert.deepStrictEqual(val, { name: 'test' });
    assert.notStrictEqual(val, m.get(key));
  });
});
