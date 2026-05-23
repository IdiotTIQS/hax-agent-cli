"use strict";

/**
 * selector-patch.js — Fix for CRITICAL-2 in src/models/selector.js
 *
 * Bug: In _computeFitness(model, task), line 60 creates a safe alias
 * `const t = task || {}` to handle null tasks. Most of the function
 * uses `t` (the safe alias). However, lines 120-125 in the "hard
 * disqualification" loop directly reference `task[needKey]` instead
 * of `t[needKey]`. If _computeFitness is ever called with a falsy
 * task (null/undefined), this throws:
 *
 *   TypeError: Cannot read properties of null (reading 'needsVision')
 *
 * Fix: Use the safe alias `t` consistently throughout the function,
 * including in the hard-disqualification loop.
 */

// ────────────────────────────────────────────────────────────
// Extracted constants (mirrors selector.js)
// ────────────────────────────────────────────────────────────

const CAPABILITY_WEIGHTS = {
  vision: 5,
  tools: 8,
  streaming: 2,
  caching: 3,
  longContext: 6,
  reasoning: 10,
  jsonMode: 4,
  codeGeneration: 9,
  multilingual: 3,
};

function capabilityScore(model) {
  if (!model) return 0;
  let score = 0;
  if (model.vision) score += CAPABILITY_WEIGHTS.vision;
  if (model.tools) score += CAPABILITY_WEIGHTS.tools;
  if (model.streaming) score += CAPABILITY_WEIGHTS.streaming;
  if (model.caching) score += CAPABILITY_WEIGHTS.caching;
  if (model.longContext) score += CAPABILITY_WEIGHTS.longContext;
  if (model.reasoning) score += CAPABILITY_WEIGHTS.reasoning;
  if (model.jsonMode) score += CAPABILITY_WEIGHTS.jsonMode;
  score += (model.codeGeneration / 10) * CAPABILITY_WEIGHTS.codeGeneration;
  score += (model.multilingual / 10) * CAPABILITY_WEIGHTS.multilingual;
  return score;
}

/**
 * Corrected _computeFitness — null-safe everywhere.
 *
 * The key fix: all references to task properties go through the
 * safe alias `t`, never through the raw `task` parameter.
 *
 * @param {object} model - Model capability descriptor
 * @param {object|null|undefined} task - Task requirements descriptor
 * @returns {number} Fitness score; -Infinity if hard-disqualified
 */
function patchedComputeFitness(model, task) {
  const t = task || {};
  let fitness = 0;
  let requirementsMatched = 0;
  let totalRequirements = 0;

  const bools = ["vision", "tools", "streaming", "caching", "longContext", "reasoning", "jsonMode"];
  for (const cap of bools) {
    const needKey = "needs" + cap.charAt(0).toUpperCase() + cap.slice(1);
    if (t[needKey] === true) {
      totalRequirements += 1;
      if (model[cap]) {
        fitness += CAPABILITY_WEIGHTS[cap] || 1;
        requirementsMatched += 1;
      }
    }
  }

  // Numeric requirements
  if (Number.isFinite(t.minMaxTokens)) {
    totalRequirements += 1;
    if (model.maxTokens >= t.minMaxTokens) {
      fitness += Math.min((model.maxTokens / t.minMaxTokens) * 3, 10);
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.minCodeQuality)) {
    totalRequirements += 1;
    if (model.codeGeneration >= t.minCodeQuality) {
      fitness += (model.codeGeneration / 10) * 5;
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.minSpeed)) {
    totalRequirements += 1;
    if (model.speed >= t.minSpeed) {
      fitness += (model.speed / 10) * 3;
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.maxBudget)) {
    totalRequirements += 1;
    const costScore = model.cost / 10;
    fitness += costScore * 3;
    requirementsMatched += 1;
  }

  const baseFitness = capabilityScore(model);
  fitness += baseFitness;

  // Penalize partial matches
  if (totalRequirements > 0) {
    const matchRatio = requirementsMatched / totalRequirements;
    if (matchRatio < 1) {
      fitness *= matchRatio;
    }
  }

  // Hard disqualification: missing a required boolean capability
  // FIXED: use t[needKey] instead of task[needKey]
  for (const cap of ["vision", "tools", "streaming", "caching", "longContext", "reasoning", "jsonMode"]) {
    const needKey = "needs" + cap.charAt(0).toUpperCase() + cap.slice(1);
    if (t[needKey] === true && !model[cap]) {
      return -Infinity;
    }
  }

  // Cost and speed bonuses
  fitness += (model.speed / 10) * 2;
  fitness += (model.cost / 10) * 2;

  return fitness;
}

/**
 * Monkey-patch the _computeFitness function reference used by a
 * ModelSelector (or any module that exports it).
 *
 * This replaces the function in whatever module/object the caller
 * passes. Typically you'd pass the selector module or the selector
 * instance.
 *
 * @param {object} target - Object whose _computeFitness or
 *   computeFitness property should be replaced
 * @param {string} [propName="_computeFitness"] - Property name to patch
 * @returns {object} The target (for chaining)
 */
function patchSelectorComputeFitness(target, propName) {
  const key = propName || "_computeFitness";
  if (!target || typeof target[key] !== "function") {
    throw new TypeError(
      "patchSelectorComputeFitness: target must have a '" + key + "' method"
    );
  }

  target["__original_" + key.replace(/^_/, "")] = target[key];
  target[key] = patchedComputeFitness;

  return target;
}

/**
 * Restore the original computeFitness function.
 *
 * @param {object} target
 * @param {string} [propName="_computeFitness"]
 * @returns {object} The target
 */
function unpatchSelectorComputeFitness(target, propName) {
  const key = propName || "_computeFitness";
  const originalKey = "__original_" + key.replace(/^_/, "");

  if (target && target[originalKey]) {
    target[key] = target[originalKey];
    delete target[originalKey];
  }
  return target;
}

// ────────────────────────────────────────────────────────────
// Inline test
// ────────────────────────────────────────────────────────────

if (require.main === module) {
  const assert = require("node:assert/strict");
  const test = require("node:test");

  const mockModel = {
    vision: true,
    tools: true,
    streaming: true,
    caching: true,
    longContext: true,
    reasoning: true,
    jsonMode: false,
    codeGeneration: 9,
    multilingual: 7,
    maxTokens: 200000,
    speed: 8,
    cost: 5,
  };

  test("patchedComputeFitness: null task does not throw", () => {
    assert.doesNotThrow(() => {
      const result = patchedComputeFitness(mockModel, null);
      assert.ok(Number.isFinite(result));
    });
  });

  test("patchedComputeFitness: undefined task does not throw", () => {
    assert.doesNotThrow(() => {
      const result = patchedComputeFitness(mockModel, undefined);
      assert.ok(Number.isFinite(result));
    });
  });

  test("patchedComputeFitness: missing required vision capability disqualifies", () => {
    const noVision = Object.assign({}, mockModel, { vision: false });
    const result = patchedComputeFitness(noVision, { needsVision: true });
    assert.equal(result, -Infinity);
  });

  test("patchedComputeFitness: matching capabilities produce positive score", () => {
    const result = patchedComputeFitness(mockModel, { needsTools: true, needsReasoning: true });
    assert.ok(result > 0);
  });

  test("patchedComputeFitness: code generation requirement", () => {
    const result = patchedComputeFitness(mockModel, { minCodeQuality: 8 });
    assert.ok(result > 0, "fitness should be positive when code quality meets threshold");
  });
}

module.exports = {
  patchedComputeFitness,
  patchSelectorComputeFitness,
  unpatchSelectorComputeFitness,
  capabilityScore,
  CAPABILITY_WEIGHTS,
};
