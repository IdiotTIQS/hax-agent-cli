"use strict";

/**
 * isolate-patch.js — Fix for CRITICAL-3 in src/plugins/isolate.js
 *
 * Bug: sandbox() calls this.isolate(plugin) which wraps every hook
 * with _isolateHook().  Then sandbox() wraps those *already-wrapped*
 * hooks again with _sandboxHook().  Both wrappers call
 * _getOrCreateStats(pluginName) and both write to the same stats
 * object.  This causes:
 *
 *   - call counts to be incremented by _isolateHook, while
 *     CPU/memory stats are accumulated by _sandboxHook — the two
 *     layers interact through a shared stats object, inflating
 *     per-hook averages and making it impossible to tell which
 *     layer contributed what.
 *   - errors can be (but are not always) double-counted.
 *   - the latency measured by _sandboxHook includes the overhead
 *     of _isolateHook, making timings pessimistic.
 *
 * Fix: patchedSandbox() wraps hooks with a SINGLE combined wrapper
 * that does error isolation AND resource tracking in one function.
 * It does NOT go through _isolateHook first, eliminating the
 * double-wrapping entirely.
 */

const { PLUGIN_HOOK_NAMES } = require("../plugins");

const PLUGIN_HOOK_SET = new Set(PLUGIN_HOOK_NAMES);

// ────────────────────────────────────────────────────────────
// Format bytes helper (duplicated to keep patch self-contained)
// ────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

// ────────────────────────────────────────────────────────────
// Combined hook wrapper: error isolation + resource tracking
// ────────────────────────────────────────────────────────────

/**
 * Create a combined hook wrapper that does both error isolation
 * and resource tracking in a single function — no nesting.
 *
 * This replaces the old layering where _sandboxHook called
 * _isolateHook (which itself wrapped the original fn).
 *
 * @param {object} self     - The PluginIsolate instance (for this access)
 * @param {string} pluginName
 * @param {string} hookName
 * @param {function} originalFn - The raw, un-wrapped hook function
 * @returns {function} A wrapped function ready to be assigned as the hook
 */
function createCombinedHook(self, pluginName, hookName, originalFn) {
  return function combinedHook(ctx) {
    const stats = self._getOrCreateStats(pluginName);
    const perHook = stats.perHook.get(hookName);

    // ---- call tracking ----
    stats.calls += 1;
    if (perHook) perHook.calls += 1;

    // ---- resource measurement ----
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const wallBefore = Date.now();

    // ---- timeout ----
    let timeoutId;
    const timeoutPromise = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        reject(
          new Error(
            'Hook "' + hookName + '" in plugin "' + pluginName +
            '" timed out after ' + self._hookTimeoutMs + "ms"
          )
        );
      }, self._hookTimeoutMs);
    });

    const executePromise = (function () {
      try {
        const result = originalFn(ctx);

        // Handle sync errors already caught above
        // Handle async hooks (returning promises)
        if (result && typeof result.then === "function") {
          return result.then(
            function (resolved) {
              return resolved;
            },
            function (err) {
              // Record the error but don't propagate
              stats.errors += 1;
              if (perHook) perHook.errors += 1;

              if (stats.errors === 1) {
                stats.firstError = {
                  hookName: hookName,
                  message: err.message,
                  timestamp: new Date().toISOString(),
                };
              }

              return undefined; // Swallow the error
            }
          );
        }

        return Promise.resolve(result);
      } catch (err) {
        // Synchronous error
        stats.errors += 1;
        if (perHook) perHook.errors += 1;

        if (stats.errors === 1) {
          stats.firstError = {
            hookName: hookName,
            message: err.message,
            timestamp: new Date().toISOString(),
          };
        }

        return Promise.resolve(undefined); // Swallow the error
      }
    })();

    return Promise.race([executePromise, timeoutPromise])
      .then(function (result) {
        clearTimeout(timeoutId);

        const wallAfter = Date.now();
        const cpuAfter = process.cpuUsage(cpuBefore);
        const memAfter = process.memoryUsage();

        const cpuTimeMs = (cpuAfter.user + cpuAfter.system) / 1000;
        const wallTimeMs = wallAfter - wallBefore;
        const memDelta = Math.max(0, memAfter.heapUsed - memBefore.heapUsed);

        // ---- accumulate stats (once, no double-counting) ----
        stats.cpuTimeMs += cpuTimeMs;
        stats.totalHookLatencyMs += wallTimeMs;
        stats.avgHookLatencyMs =
          stats.totalHookLatencyMs / Math.max(1, stats.calls);
        stats.totalMemoryDeltaBytes += memDelta;
        stats.memorySnapshots += 1;

        if (cpuTimeMs > stats.maxCpuTimeMs) stats.maxCpuTimeMs = cpuTimeMs;
        if (
          cpuTimeMs < stats.minCpuTimeMs ||
          stats.minCpuTimeMs === 0
        )
          stats.minCpuTimeMs = cpuTimeMs;
        if (wallTimeMs > stats.maxHookLatencyMs)
          stats.maxHookLatencyMs = wallTimeMs;
        if (memDelta > stats.maxMemoryDeltaBytes)
          stats.maxMemoryDeltaBytes = memDelta;

        // ---- per-hook stats ----
        if (perHook) {
          perHook.cpuTimeMs += cpuTimeMs;
          perHook.totalLatencyMs += wallTimeMs;
          perHook.memoryDeltas.push(memDelta);
          if (perHook.memoryDeltas.length > 100)
            perHook.memoryDeltas.shift();
          if (wallTimeMs > perHook.maxLatencyMs)
            perHook.maxLatencyMs = wallTimeMs;
        }

        // ---- warnings ----
        if (cpuTimeMs > self._cpuTimeLimitMs) {
          stats.lastWarning =
            "CPU time " +
            cpuTimeMs.toFixed(1) +
            'ms for hook "' +
            hookName +
            '" exceeds limit of ' +
            self._cpuTimeLimitMs +
            "ms";
        }
        if (memDelta > self._memoryLimit) {
          stats.lastWarning =
            "Memory delta " +
            formatBytes(memDelta) +
            ' for hook "' +
            hookName +
            '" exceeds limit of ' +
            formatBytes(self._memoryLimit);
        }
        if (wallTimeMs > self._hookTimeoutMs * 0.8) {
          stats.lastWarning =
            'Hook "' +
            hookName +
            '" is approaching timeout: ' +
            wallTimeMs +
            "ms / " +
            self._hookTimeoutMs +
            "ms";
        }

        return result;
      })
      .catch(function (err) {
        clearTimeout(timeoutId);

        stats.errors += 1;
        if (perHook) perHook.errors += 1;

        if (err.message && err.message.indexOf("timed out") !== -1) {
          stats.lastWarning = err.message;
        }

        return undefined; // Swallow errors in sandbox
      });
  };
}

// ────────────────────────────────────────────────────────────
// Patched sandbox method
// ────────────────────────────────────────────────────────────

/**
 * Replacement for PluginIsolate.prototype.sandbox that wraps hooks
 * with a SINGLE combined wrapper instead of nesting _isolateHook
 * inside _sandboxHook.
 *
 * This function is designed to be used as a direct replacement for
 * the sandbox method on a PluginIsolate instance. It has access to
 * `this` (the PluginIsolate instance) and uses its private helpers.
 *
 * @param {object} plugin - Original plugin object
 * @returns {object} Wrapped plugin with combined hook wrappers
 */
function patchedSandbox(plugin) {
  if (!plugin || !plugin.name) {
    throw new TypeError("patchedSandbox: plugin must have a name");
  }

  // IMPORTANT: do NOT call this.isolate(plugin) — that's the old
  // path that causes double-wrapping.  Build the wrapper directly.

  const self = this;
  const wrapped = {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    hooks: {},
    metadata: Object.assign({}, plugin.metadata || {}, {
      isolated: true,
      sandboxed: true,
    }),
  };

  // Copy non-hook methods
  for (const key of Object.keys(plugin)) {
    if (
      key !== "hooks" &&
      key !== "name" &&
      key !== "version" &&
      key !== "description" &&
      key !== "metadata" &&
      typeof plugin[key] === "function"
    ) {
      wrapped[key] = plugin[key].bind(plugin);
    }
  }

  // Wrap each hook with the COMBINED wrapper (no double-wrapping)
  if (plugin.hooks && typeof plugin.hooks === "object") {
    for (const hookName of Object.keys(plugin.hooks)) {
      if (!PLUGIN_HOOK_SET.has(hookName)) continue;
      const originalFn = plugin.hooks[hookName];
      if (typeof originalFn !== "function") continue;

      wrapped.hooks[hookName] = createCombinedHook(
        self,
        plugin.name,
        hookName,
        originalFn
      );
    }
  }

  // Initialize stats
  self._initStats(plugin.name, wrapped);

  // Store the mapping
  self._wrapped.set(plugin.name, {
    original: plugin,
    wrapped: wrapped,
  });

  return wrapped;
}

// ────────────────────────────────────────────────────────────
// Monkey-patch
// ────────────────────────────────────────────────────────────

/**
 * Replace the sandbox method on a PluginIsolate instance with the
 * patched version that does single-wrapping.
 *
 * @param {object} isolateInstance - An instance of PluginIsolate
 * @returns {object} The instance (for chaining)
 */
function patchIsolateSandbox(isolateInstance) {
  if (
    !isolateInstance ||
    typeof isolateInstance.sandbox !== "function"
  ) {
    throw new TypeError(
      "patchIsolateSandbox: instance must have a sandbox method"
    );
  }

  // Store original for restoration
  isolateInstance.__original_sandbox = isolateInstance.sandbox;

  // Bind patchedSandbox to the instance so `this` works correctly
  isolateInstance.sandbox = patchedSandbox.bind(isolateInstance);

  return isolateInstance;
}

/**
 * Restore the original sandbox method on a previously patched instance.
 *
 * @param {object} isolateInstance
 * @returns {object} The instance
 */
function unpatchIsolateSandbox(isolateInstance) {
  if (isolateInstance && isolateInstance.__original_sandbox) {
    isolateInstance.sandbox = isolateInstance.__original_sandbox;
    delete isolateInstance.__original_sandbox;
  }
  return isolateInstance;
}

// ────────────────────────────────────────────────────────────
// Inline test
// ────────────────────────────────────────────────────────────

if (require.main === module) {
  const assert = require("node:assert/strict");
  const test = require("node:test");

  test("createCombinedHook returns a function", () => {
    const self = {
      _getOrCreateStats: function () {
        return {
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
          perHook: new Map([["beforeChat", { calls: 0, errors: 0 }]]),
          firstError: null,
          lastWarning: null,
        };
      },
      _hookTimeoutMs: 5000,
      _cpuTimeLimitMs: 1000,
      _memoryLimit: 100 * 1024 * 1024,
    };

    const hook = createCombinedHook(self, "testPlugin", "beforeChat", function (ctx) {
      return ctx;
    });

    assert.equal(typeof hook, "function");
  });

  test("createCombinedHook increments call count when invoked", () => {
    let stored = null;
    const self = {
      _getOrCreateStats: function () {
        if (!stored) {
          stored = {
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
          stored.perHook.set("beforeChat", { calls: 0, errors: 0,
            cpuTimeMs: 0, totalLatencyMs: 0, maxLatencyMs: 0, memoryDeltas: [] });
        }
        return stored;
      },
      _hookTimeoutMs: 5000,
      _cpuTimeLimitMs: 1000,
      _memoryLimit: 100 * 1024 * 1024,
    };

    const hook = createCombinedHook(self, "testPlugin", "beforeChat", function (ctx) {
      return ctx;
    });

    return hook({ test: true }).then(function () {
      assert.equal(stored.calls, 1, "top-level calls should be 1 (not doubled)");
      assert.equal(stored.perHook.get("beforeChat").calls, 1);
    });
  });

  test("createCombinedHook catches sync errors", () => {
    let stored = null;
    const self = {
      _getOrCreateStats: function () {
        if (!stored) {
          stored = {
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
          stored.perHook.set("beforeChat", { calls: 0, errors: 0,
            cpuTimeMs: 0, totalLatencyMs: 0, maxLatencyMs: 0, memoryDeltas: [] });
        }
        return stored;
      },
      _hookTimeoutMs: 5000,
      _cpuTimeLimitMs: 1000,
      _memoryLimit: 100 * 1024 * 1024,
    };

    const hook = createCombinedHook(self, "testPlugin", "beforeChat", function () {
      throw new Error("sync kaboom");
    });

    return hook({}).then(function (result) {
      assert.equal(result, undefined, "error should be swallowed, returning undefined");
      assert.equal(stored.errors, 1, "should record exactly 1 error, not doubled");
      assert.equal(stored.calls, 1, "should count exactly 1 call");
    });
  });

  test("createCombinedHook catches async errors", () => {
    let stored = null;
    const self = {
      _getOrCreateStats: function () {
        if (!stored) {
          stored = {
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
          stored.perHook.set("beforeChat", { calls: 0, errors: 0,
            cpuTimeMs: 0, totalLatencyMs: 0, maxLatencyMs: 0, memoryDeltas: [] });
        }
        return stored;
      },
      _hookTimeoutMs: 5000,
      _cpuTimeLimitMs: 1000,
      _memoryLimit: 100 * 1024 * 1024,
    };

    const hook = createCombinedHook(self, "testPlugin", "beforeChat", function () {
      return Promise.reject(new Error("async kaboom"));
    });

    return hook({}).then(function (result) {
      assert.equal(result, undefined);
      assert.equal(stored.errors, 1);
      assert.equal(stored.calls, 1);
    });
  });

  test("patch and unpatch cycle preserves original", () => {
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
}

module.exports = {
  patchedSandbox,
  createCombinedHook,
  patchIsolateSandbox,
  unpatchIsolateSandbox,
  formatBytes,
};
