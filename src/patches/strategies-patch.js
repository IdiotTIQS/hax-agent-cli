"use strict";

/**
 * strategies-patch.js — Fix for CRITICAL-1 in src/tokens/strategies.js
 *
 * Bug: _isSimilar() computes Jaccard similarity on word trigrams via
 * _trigrams(). When input text has fewer than 3 words, _trigrams()
 * returns an empty Set. This causes allTrigrams.size === 0 to return
 * false, meaning all short strings (including two identical single-word
 * strings) are treated as "not similar". This breaks _dropRedundant()
 * for small redundant messages.
 *
 * Fix: Short-circuit with direct equality before the trigram comparison.
 * For strings with fewer than 3 words, use exact-match fallback. For
 * longer strings, use the original trigram-based Jaccard similarity.
 */

// ────────────────────────────────────────────────────────────
// Trigram helpers (inlined to avoid coupling to strategies.js)
// ────────────────────────────────────────────────────────────

function trigramsSet(text) {
  const words = text.split(/\s+/);
  const set = new Set();
  for (let i = 0; i <= words.length - 3; i++) {
    set.add(words.slice(i, i + 3).join(" "));
  }
  return set;
}

/**
 * Corrected _isSimilar replacement.
 *
 * @param {string} a - First string to compare
 * @param {string} b - Second string to compare
 * @param {number} [threshold=0.7] - Jaccard similarity threshold
 * @returns {boolean} True if the strings are similar
 */
function patchedIsSimilar(a, b, threshold) {
  // Use loose-null check so empty strings are NOT treated as falsy.
  // (The original bug was in part caused by !a rejecting "" before
  // reaching useful comparisons.)
  if (a == null || b == null) return false;

  // Exact match — identical strings are always similar
  if (a === b) return true;

  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0 && lenB === 0) return true;
  if (lenA === 0 || lenB === 0) return false;

  // Quick length ratio check
  const lenRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  if (lenRatio < 0.5) return false;

  // Count words to decide which comparison strategy to use
  const wordsA = a.split(/\s+/).length;
  const wordsB = b.split(/\s+/).length;

  // Both strings are short — fall back to exact equality
  if (wordsA < 3 && wordsB < 3) {
    return a === b;
  }

  // Mixed-length: one short, one long — cannot be trigram-similar
  if (wordsA < 3 || wordsB < 3) {
    return false;
  }

  // Both are long enough for trigram comparison
  const tgA = trigramsSet(a);
  const tgB = trigramsSet(b);
  const allTrigrams = new Set([...tgA, ...tgB]);

  if (allTrigrams.size === 0) return false;

  let intersection = 0;
  for (const tg of tgA) {
    if (tgB.has(tg)) intersection++;
  }

  return (intersection / allTrigrams.size) >= (threshold || 0.7);
}

/**
 * Monkey-patch a TokenStrategies instance so its _isSimilar method
 * uses the corrected implementation.
 *
 * @param {object} strategiesInstance - An instance of TokenStrategies
 *   (or any object with a _isSimilar method to replace)
 * @returns {object} The same instance (for chaining)
 */
function patchStrategiesIsSimilar(strategiesInstance) {
  if (!strategiesInstance || typeof strategiesInstance._isSimilar !== "function") {
    throw new TypeError("patchStrategiesIsSimilar: instance must have _isSimilar method");
  }

  // Store original for potential restoration
  strategiesInstance.__original_isSimilar = strategiesInstance._isSimilar;

  // Replace with our patched version bound to the instance
  strategiesInstance._isSimilar = patchedIsSimilar;

  return strategiesInstance;
}

/**
 * Restore the original _isSimilar method on a previously patched instance.
 *
 * @param {object} strategiesInstance
 * @returns {object} The instance
 */
function unpatchStrategiesIsSimilar(strategiesInstance) {
  if (strategiesInstance && strategiesInstance.__original_isSimilar) {
    strategiesInstance._isSimilar = strategiesInstance.__original_isSimilar;
    delete strategiesInstance.__original_isSimilar;
  }
  return strategiesInstance;
}

// ────────────────────────────────────────────────────────────
// Inline test (runs when module is executed directly)
// ────────────────────────────────────────────────────────────

if (require.main === module) {
  const assert = require("node:assert/strict");
  const test = require("node:test");

  test("patchedIsSimilar: identical short single-word strings are similar", () => {
    assert.equal(patchedIsSimilar("hello", "hello"), true);
  });

  test("patchedIsSimilar: different short single-word strings are not similar", () => {
    assert.equal(patchedIsSimilar("hello", "world"), false);
  });

  test("patchedIsSimilar: identical two-word strings are similar", () => {
    assert.equal(patchedIsSimilar("hello world", "hello world"), true);
  });

  test("patchedIsSimilar: short vs long string are not similar", () => {
    const short = "hello";
    const long = "hello world this is a long sentence with many words";
    assert.equal(patchedIsSimilar(short, long), false);
  });

  test("patchedIsSimilar: similar long strings detected", () => {
    const a = "the quick brown fox jumps over the lazy dog";
    const b = "the quick brown fox jumps over the lazy cat";
    // 7 trigrams, 6 shared -> 6/(7+7-6) = 6/8 = 0.75 >= 0.7
    assert.equal(patchedIsSimilar(a, b), true);
  });

  test("patchedIsSimilar: dissimilar long strings not matched", () => {
    const a = "the quick brown fox jumps over the lazy dog";
    const b = "completely different text about something else entirely";
    assert.equal(patchedIsSimilar(a, b), false);
  });

  test("patchedIsSimilar: falsy inputs return false", () => {
    assert.equal(patchedIsSimilar(null, "hello"), false);
    assert.equal(patchedIsSimilar("hello", null), false);
    assert.equal(patchedIsSimilar(undefined, "hello"), false);
    assert.equal(patchedIsSimilar("", ""), true);
  });
}

module.exports = {
  patchedIsSimilar,
  patchStrategiesIsSimilar,
  unpatchStrategiesIsSimilar,
  trigramsSet,
};
