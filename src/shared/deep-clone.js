'use strict';

/**
 * deepClone(value, [options])
 *
 * Produces a deep clone of `value`.  Uses `structuredClone` when available
 * (Node >= 17), falling back to a recursive walker that handles Date, Map,
 * Set, RegExp, and circular references — all of which are lost by the common
 * `JSON.parse(JSON.stringify(x))` pattern found in 21+ files across the
 * codebase.
 *
 * @param {*}      value          Value to clone
 * @param {object} [opts]
 * @param {number} [opts.depth]   Maximum nesting depth (default Infinity, 0 = shallow)
 * @returns {*}                   Deep clone of `value`
 *
 * @example
 *   const copy = deepClone(original);
 *   const shallow = deepClone(obj, { depth: 0 });
 */

const DEFAULT_MAX_DEPTH = Infinity;

function deepClone(value, opts) {
  const hasDepthLimit = opts && Number.isFinite(opts.depth);
  const maxDepth = hasDepthLimit ? opts.depth : DEFAULT_MAX_DEPTH;

  if (maxDepth < 0) {
    throw new RangeError('deepClone: opts.depth must be >= 0, got ' + maxDepth);
  }

  // When a concrete depth limit is provided we must use the recursive walker
  // because structuredClone always clones the full object graph and cannot
  // honour a depth cap.
  if (!hasDepthLimit && typeof structuredClone === 'function') {
    try {
      return structuredClone(value, { transfer: [] });
    } catch (_err) {
      // structuredClone throws on functions / Symbols / DOM nodes.
      // Fall through to the recursive walker.
    }
  }

  return _walk(value, new WeakMap(), 0, maxDepth);
}

// ---------------------------------------------------------------------------
// Recursive walker (fallback)
// ---------------------------------------------------------------------------

function _walk(val, seen, depth, maxDepth) {
  // Depth guard — return the reference once we exceed maxDepth.
  if (depth > maxDepth) {
    return val;
  }

  // Primitives pass through unchanged (typeof null === 'object', caught below).
  if (val === null || typeof val !== 'object') {
    return val;
  }

  // Circular reference guard.
  if (seen.has(val)) {
    return seen.get(val);
  }

  // ---- Typed wrappers (JSON.stringify loses these) --------------------------

  if (val instanceof Date) {
    // `Date` is not a subclass instance check before structural checks.
    const copy = new Date(val.getTime());
    seen.set(val, copy);
    return copy;
  }

  if (val instanceof RegExp) {
    const copy = new RegExp(val.source, val.flags);
    seen.set(val, copy);
    return copy;
  }

  if (val instanceof Map) {
    const copy = new Map();
    seen.set(val, copy);
    for (const [k, v] of val) {
      copy.set(
        _walk(k, seen, depth + 1, maxDepth),
        _walk(v, seen, depth + 1, maxDepth),
      );
    }
    return copy;
  }

  if (val instanceof Set) {
    const copy = new Set();
    seen.set(val, copy);
    for (const item of val) {
      copy.add(_walk(item, seen, depth + 1, maxDepth));
    }
    return copy;
  }

  // ---- Array -----------------------------------------------------------------

  if (Array.isArray(val)) {
    const copy = [];
    seen.set(val, copy);
    for (let i = 0; i < val.length; i++) {
      copy[i] = _walk(val[i], seen, depth + 1, maxDepth);
    }
    return copy;
  }

  // ---- Plain object ----------------------------------------------------------

  const copy = {};
  seen.set(val, copy);
  const keys = Object.keys(val);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    copy[key] = _walk(val[key], seen, depth + 1, maxDepth);
  }
  return copy;
}

module.exports = { deepClone };
