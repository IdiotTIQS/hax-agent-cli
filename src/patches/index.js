"use strict";

/**
 * patches/index.js — Central patch application module.
 *
 * Applies all R5 critical bug fixes via monkey-patching.  Each
 * patch module exports a `patch*` function that replaces the buggy
 * method on a target instance or object.
 *
 * Usage:
 *   const patches = require("./patches");
 *   patches.applyAll({ strategies, selector, isolate });
 *   // ... application runs with fixes applied ...
 *   patches.restoreAll({ strategies, selector, isolate });
 *
 * Or apply individually:
 *   patches.applyStrategies(strategiesInstance);
 *   patches.applySelector(selectorModule);
 *   patches.applyIsolate(isolateInstance);
 */

const {
  patchStrategiesIsSimilar,
  unpatchStrategiesIsSimilar,
} = require("./strategies-patch");

const {
  patchSelectorComputeFitness,
  unpatchSelectorComputeFitness,
} = require("./selector-patch");

const {
  patchIsolateSandbox,
  unpatchIsolateSandbox,
} = require("./isolate-patch");

/**
 * Apply all known patches.
 *
 * @param {object} targets
 * @param {object} [targets.strategies] - TokenStrategies instance
 * @param {object} [targets.selector]   - Module/object with _computeFitness
 * @param {object} [targets.isolate]    - PluginIsolate instance
 * @returns {object} Summary of what was patched
 */
function applyAll(targets) {
  const applied = [];

  if (targets && targets.strategies) {
    patchStrategiesIsSimilar(targets.strategies);
    applied.push("strategies:_isSimilar");
  }
  if (targets && targets.selector) {
    patchSelectorComputeFitness(targets.selector);
    applied.push("selector:_computeFitness");
  }
  if (targets && targets.isolate) {
    patchIsolateSandbox(targets.isolate);
    applied.push("isolate:sandbox");
  }

  return { patched: applied, count: applied.length };
}

/**
 * Restore (unpatch) all previously applied patches.
 *
 * @param {object} targets - Same object passed to applyAll
 * @returns {object} Summary of what was restored
 */
function restoreAll(targets) {
  const restored = [];

  if (targets && targets.strategies) {
    unpatchStrategiesIsSimilar(targets.strategies);
    restored.push("strategies:_isSimilar");
  }
  if (targets && targets.selector) {
    unpatchSelectorComputeFitness(targets.selector);
    restored.push("selector:_computeFitness");
  }
  if (targets && targets.isolate) {
    unpatchIsolateSandbox(targets.isolate);
    restored.push("isolate:sandbox");
  }

  return { restored: restored, count: restored.length };
}

module.exports = {
  // Unified apply / restore
  applyAll,
  restoreAll,

  // Individual patch functions
  applyStrategies: patchStrategiesIsSimilar,
  restoreStrategies: unpatchStrategiesIsSimilar,
  applySelector: patchSelectorComputeFitness,
  restoreSelector: unpatchSelectorComputeFitness,
  applyIsolate: patchIsolateSandbox,
  restoreIsolate: unpatchIsolateSandbox,

  // Direct exports for standalone use
  patchedIsSimilar: require("./strategies-patch").patchedIsSimilar,
  patchedComputeFitness: require("./selector-patch").patchedComputeFitness,
  patchedSandbox: require("./isolate-patch").patchedSandbox,
};
