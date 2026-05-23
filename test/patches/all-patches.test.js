"use strict";

/**
 * all-patches.test.js — Tests for all R5 critical bug fixes.
 *
 * Covers:
 *   - strategies-patch: _isSimilar fixes for short strings
 *   - selector-patch:   _computeFitness null-safety
 *   - isolate-patch:    sandbox() single-wrapping (no double-counting)
 *   - patches/index:    applyAll / restoreAll lifecycle
 */

const assert = require("node:assert/strict");
const test = require("node:test");

// ────────────────────────────────────────────────────────────
// Test data / helpers
// ────────────────────────────────────────────────────────────

function makeMockModel(overrides) {
  return Object.assign(
    {
      vision: true,
      tools: true,
      streaming: true,
      caching: false,
      longContext: true,
      reasoning: true,
      jsonMode: false,
      codeGeneration: 9,
      multilingual: 7,
      maxTokens: 200000,
      speed: 8,
      cost: 5,
    },
    overrides || {}
  );
}

function makeMockIsolateInstance() {
  const stored = new Map();
  const wrapped = new Map();

  return {
    _wrapped: wrapped,

    _hookTimeoutMs: 5000,
    _cpuTimeLimitMs: 10000,
    _memoryLimit: 100 * 1024 * 1024,

    _getOrCreateStats: function (pluginName) {
      if (!stored.has(pluginName)) {
        const stats = {
          version: "0.0.0",
          wrappedAt: new Date().toISOString(),
          calls: 0,
          errors: 0,
          cpuTimeMs: 0,
          maxCpuTimeMs: 0,
          minCpuTimeMs: 0,
          totalHookLatencyMs: 0,
          avgHookLatencyMs: 0,
          memorySnapshots: 0,
          maxMemoryDeltaBytes: 0,
          totalMemoryDeltaBytes: 0,
          perHook: new Map(),
          firstError: null,
          lastWarning: null,
        };

        const { PLUGIN_HOOK_NAMES } = require("../../src/plugins");
        for (const hookName of PLUGIN_HOOK_NAMES) {
          stats.perHook.set(hookName, {
            calls: 0,
            errors: 0,
            cpuTimeMs: 0,
            totalLatencyMs: 0,
            maxLatencyMs: 0,
            memoryDeltas: [],
          });
        }

        stored.set(pluginName, stats);
      }
      return stored.get(pluginName);
    },

    _initStats: function (pluginName, wrappedPlugin) {
      const stats = this._getOrCreateStats(pluginName);
      stats.version = wrappedPlugin.version || "0.0.0";
      stats.wrappedAt = new Date().toISOString();
    },

    getStats: function (pluginName) {
      return stored.get(pluginName) || null;
    },

    // Placeholder — patched by patchIsolateSandbox before use
    sandbox: function () {
      throw new Error("sandbox: not yet patched");
    },
  };
}

// ────────────────────────────────────────────────────────────
// 1. strategies-patch tests
// ────────────────────────────────────────────────────────────

const { patchedIsSimilar, patchStrategiesIsSimilar, unpatchStrategiesIsSimilar } =
  require("../../src/patches/strategies-patch");

test("strategies: identical single-word strings are similar (old bug returned false)", () => {
  assert.equal(patchedIsSimilar("hello", "hello"), true);
});

test("strategies: identical two-word strings are similar", () => {
  assert.equal(patchedIsSimilar("hello world", "hello world"), true);
});

test("strategies: different single words are not similar", () => {
  assert.equal(patchedIsSimilar("hello", "world"), false);
});

test("strategies: short vs long string comparison returns false safely", () => {
  assert.equal(
    patchedIsSimilar("hi", "the quick brown fox jumps over the lazy dog"),
    false
  );
});

test("strategies: similar multi-word strings detected via trigrams", () => {
  const a = "the quick brown fox jumps over the lazy dog";
  const b = "the quick brown fox jumps over the lazy cat";
  // 7 trigrams, 6 shared -> 6/(7+7-6) = 6/8 = 0.75 >= 0.7
  assert.equal(patchedIsSimilar(a, b), true);
});

test("strategies: dissimilar multi-word strings not matched", () => {
  const a = "the quick brown fox jumps over the lazy dog";
  const b = "completely different text about something else entirely";
  assert.equal(patchedIsSimilar(a, b), false);
});

test("strategies: falsy inputs handled safely", () => {
  assert.equal(patchedIsSimilar(null, "hello"), false);
  assert.equal(patchedIsSimilar("hello", null), false);
  assert.equal(patchedIsSimilar(undefined, "hello"), false);
  assert.equal(patchedIsSimilar("", ""), true);
  assert.equal(patchedIsSimilar("", "hello"), false);
});

test("strategies: patch and unpatch cycle works", () => {
  const originalMethod = function (a, b) {
    return a === b;
  };
  const instance = { _isSimilar: originalMethod };

  patchStrategiesIsSimilar(instance);
  assert.notEqual(instance._isSimilar, originalMethod);
  assert.equal(typeof instance.__original_isSimilar, "function");

  unpatchStrategiesIsSimilar(instance);
  assert.equal(instance._isSimilar, originalMethod);
  assert.equal(instance.__original_isSimilar, undefined);
});

// ────────────────────────────────────────────────────────────
// 2. selector-patch tests
// ────────────────────────────────────────────────────────────

const { patchedComputeFitness, patchSelectorComputeFitness, unpatchSelectorComputeFitness } =
  require("../../src/patches/selector-patch");

test("selector: null task does not throw", () => {
  assert.doesNotThrow(() => {
    const result = patchedComputeFitness(makeMockModel(), null);
    assert.ok(Number.isFinite(result), "result should be a finite number");
  });
});

test("selector: undefined task does not throw", () => {
  assert.doesNotThrow(() => {
    const result = patchedComputeFitness(makeMockModel(), undefined);
    assert.ok(Number.isFinite(result));
  });
});

test("selector: hard disqualification when required capability missing", () => {
  const noVision = makeMockModel({ vision: false });
  const result = patchedComputeFitness(noVision, { needsVision: true });
  assert.equal(result, -Infinity);
});

test("selector: positive fitness when requirements match", () => {
  const result = patchedComputeFitness(makeMockModel(), {
    needsTools: true,
    needsReasoning: true,
  });
  assert.ok(result > 0, "fitness should be positive");
});

test("selector: patch and unpatch cycle works", () => {
  const originalFn = function () {
    return 42;
  };
  const target = { _computeFitness: originalFn };

  patchSelectorComputeFitness(target);
  assert.notEqual(target._computeFitness, originalFn);

  unpatchSelectorComputeFitness(target);
  assert.equal(target._computeFitness, originalFn);
});

// ────────────────────────────────────────────────────────────
// 3. isolate-patch tests
// ────────────────────────────────────────────────────────────

const { patchedSandbox, patchIsolateSandbox, unpatchIsolateSandbox, createCombinedHook } =
  require("../../src/patches/isolate-patch");

test("isolate: patchedSandbox does NOT double-count calls", () => {
  const isolate = makeMockIsolateInstance();

  // Patch the sandbox method
  patchIsolateSandbox(isolate);

  const plugin = {
    name: "test-plugin",
    version: "1.0.0",
    hooks: {
      beforeChat: function (ctx) {
        return ctx;
      },
    },
  };

  const wrapped = isolate.sandbox(plugin);

  // Invoke the hook twice
  return wrapped.hooks.beforeChat({ test: true }).then(function () {
    return wrapped.hooks.beforeChat({ test: true });
  }).then(function () {
    const stats = isolate.getStats("test-plugin");
    assert.equal(stats.calls, 2, "calls should be 2, not doubled to 4");
  });
});

test("isolate: patchedSandbox tracks errors exactly once per failure", () => {
  const isolate = makeMockIsolateInstance();
  patchIsolateSandbox(isolate);

  let callCount = 0;
  const plugin = {
    name: "err-plugin",
    version: "1.0.0",
    hooks: {
      beforeChat: function () {
        callCount++;
        throw new Error("fail");
      },
    },
  };

  const wrapped = isolate.sandbox(plugin);

  return wrapped.hooks.beforeChat({}).then(function () {
    const stats = isolate.getStats("err-plugin");
    assert.equal(stats.errors, 1, "errors should be exactly 1, not 2");
    assert.equal(stats.calls, 1);
  });
});

test("isolate: patchedSandbox does not call isolate() internally", () => {
  // If sandbox() called isolate() first, we'd see _isolateHook-style
  // wrapping.  We verify by checking that a single hook invocation
  // produces exactly one call count increment — no hidden extra.

  const isolate = makeMockIsolateInstance();
  patchIsolateSandbox(isolate);

  const plugin = {
    name: "count-check",
    version: "1.0.0",
    hooks: {
      afterChat: function (ctx) {
        return ctx;
      },
    },
  };

  const wrapped = isolate.sandbox(plugin);

  return wrapped.hooks.afterChat({ x: 1 }).then(function () {
    const stats = isolate.getStats("count-check");
    assert.equal(stats.calls, 1);
  });
});

test("isolate: resource tracking accumulates on successful calls", () => {
  const isolate = makeMockIsolateInstance();
  patchIsolateSandbox(isolate);

  const plugin = {
    name: "resource-plugin",
    version: "1.0.0",
    hooks: {
      beforeChat: function (ctx) {
        return ctx;
      },
    },
  };

  const wrapped = isolate.sandbox(plugin);

  return wrapped.hooks.beforeChat({ a: 1 }).then(function () {
    const stats = isolate.getStats("resource-plugin");
    assert.ok(stats.memorySnapshots > 0, "should record a memory snapshot");
    assert.ok(typeof stats.cpuTimeMs === "number", "should track CPU time");
    assert.ok(typeof stats.totalHookLatencyMs === "number", "should track latency");
    assert.ok(typeof stats.avgHookLatencyMs === "number", "should compute avg latency");
  });
});

test("isolate: patch and unpatch cycle works", () => {
  const originalSandbox = function (p) {
    return p;
  };
  const instance = { sandbox: originalSandbox };

  patchIsolateSandbox(instance);
  assert.notEqual(instance.sandbox, originalSandbox);
  assert.equal(typeof instance.__original_sandbox, "function");

  unpatchIsolateSandbox(instance);
  assert.equal(instance.sandbox, originalSandbox);
});

test("isolate: patchedSandbox throws for invalid plugin", () => {
  const isolate = makeMockIsolateInstance();
  patchIsolateSandbox(isolate);

  assert.throws(
    function () {
      isolate.sandbox(null);
    },
    /plugin must have a name/
  );

  assert.throws(
    function () {
      isolate.sandbox({});
    },
    /plugin must have a name/
  );
});

// ────────────────────────────────────────────────────────────
// 4. patches/index tests
// ────────────────────────────────────────────────────────────

const patches = require("../../src/patches");

test("index: applyAll patches all three targets", () => {
  const strategiesInst = { _isSimilar: function (a, b) { return a === b; } };
  const selectorObj = { _computeFitness: function () { return 0; } };
  const isolateInst = { sandbox: function () {} };

  const result = patches.applyAll({
    strategies: strategiesInst,
    selector: selectorObj,
    isolate: isolateInst,
  });

  assert.equal(result.count, 3);
  assert.deepEqual(result.patched.sort(), [
    "isolate:sandbox",
    "selector:_computeFitness",
    "strategies:_isSimilar",
  ]);
});

test("index: restoreAll puts original methods back", () => {
  const origIsSimilar = function (a, b) { return a === b; };
  const origFitness = function () { return 0; };
  const origSandbox = function () {};

  const targets = {
    strategies: { _isSimilar: origIsSimilar },
    selector: { _computeFitness: origFitness },
    isolate: { sandbox: origSandbox },
  };

  patches.applyAll(targets);

  // After apply, methods should be different
  assert.notEqual(targets.strategies._isSimilar, origIsSimilar);
  assert.notEqual(targets.selector._computeFitness, origFitness);
  assert.notEqual(targets.isolate.sandbox, origSandbox);

  const result = patches.restoreAll(targets);
  assert.equal(result.count, 3);

  // After restore, originals should be back
  assert.equal(targets.strategies._isSimilar, origIsSimilar);
  assert.equal(targets.selector._computeFitness, origFitness);
  assert.equal(targets.isolate.sandbox, origSandbox);
});

test("index: applyAll with empty targets returns zero patches", () => {
  const result = patches.applyAll({});
  assert.equal(result.count, 0);
  assert.deepEqual(result.patched, []);
});

test("index: patchedIsSimilar is directly accessible", () => {
  assert.equal(typeof patches.patchedIsSimilar, "function");
  assert.equal(patches.patchedIsSimilar("same", "same"), true);
  assert.equal(patches.patchedIsSimilar("same", "different"), false);
});

test("index: patchedComputeFitness is null-safe", () => {
  assert.doesNotThrow(() => {
    const result = patches.patchedComputeFitness(makeMockModel(), null);
    assert.ok(Number.isFinite(result));
  });
});
