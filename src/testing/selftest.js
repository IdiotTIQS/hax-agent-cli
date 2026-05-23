"use strict";

/**
 * SelfTest — agent self-testing framework.
 *
 * Allows agents to verify their own functionality across four dimensions:
 *   - Tools      (availability and basic exercise of the tool registry)
 *   - Providers  (mock connectivity check against a chat provider)
 *   - Memory     (read / write / delete operations on the memory API)
 *   - Plugins    (plugin loading and hook lifecycle)
 *
 * Each test returns a standardised result: { name, status, message, durationMs }.
 * The aggregate report and a 0–100 health score are computed from results.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_CATEGORIES = Object.freeze([
  "tools",
  "providers",
  "memory",
  "plugins",
]);

const CATEGORY_WEIGHTS = Object.freeze({
  tools:     0.30,
  providers: 0.25,
  memory:    0.25,
  plugins:   0.20,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build a standardised result object for a single self-test check.
 */
function result(name, status, message, durationMs = 0, details = null) {
  return { name, status, message, durationMs, details };
}

/**
 * Time a (possibly async) function, returning { elapsedMs, result }.
 */
async function timed(fn) {
  const start = process.hrtime.bigint();
  const value = await fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return { elapsedMs: Math.round(elapsed * 100) / 100, value };
}

// ---------------------------------------------------------------------------
// SelfTest
// ---------------------------------------------------------------------------

class SelfTest {
  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs=5000]  - per-test timeout in ms
   */
  constructor(options = {}) {
    this._options = options;
    this._timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000;

    // Internal test registry: category => [{ name, fn }]
    this._registry = new Map();

    // Per-category results populated by testTools/testProviders/etc.
    this._results = new Map();

    // Overall state
    this._lastRunAt = null;
    this._totalDurationMs = 0;
  }

  // -----------------------------------------------------------------------
  // Core test runners
  // -----------------------------------------------------------------------

  /**
   * Run all registered self-tests concurrently (per category) and in sequence
   * across categories. Returns the aggregate report.
   *
   * @returns {Promise<object>} full report (same shape as getReport())
   */
  async testAll() {
    const start = process.hrtime.bigint();
    this._results.clear();

    for (const category of TEST_CATEGORIES) {
      const entries = this._registry.get(category);
      if (!entries || entries.length === 0) {
        this._results.set(category, [
          result(category, "skip", `No tests registered for "${category}"`, 0),
        ]);
        continue;
      }

      const catResults = [];
      for (const { name, fn } of entries) {
        let r;
        try {
          const timedResult = await Promise.race([
            timed(fn),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout after ${this._timeoutMs}ms`)), this._timeoutMs)
            ),
          ]);
          r = result(
            name,
            "pass",
            `Completed in ${timedResult.elapsedMs}ms`,
            timedResult.elapsedMs,
            timedResult.value,
          );
        } catch (err) {
          r = result(name, "fail", err.message || String(err), 0, { error: err.message });
        }
        catResults.push(r);
      }
      this._results.set(category, catResults);
    }

    this._lastRunAt = nowISO();
    this._totalDurationMs = Math.round(
      (Number(process.hrtime.bigint() - start) / 1e6) * 100
    ) / 100;

    return this.getReport();
  }

  /**
   * Test tool availability and basic functionality.
   * Registers checks that assert the registry exists, tools can be listed,
   * and (optionally) that a named tool can be retrieved & executed.
   *
   * @param {object} toolRegistry - a ToolRegistry-like object
   * @param {object} [options]
   * @param {string[]} [options.expectedTools] - tool names that must be present
   * @param {{ name: string, args: object }} [options.exercise] - tool name + args to execute
   * @returns {SelfTest} this instance for chaining
   */
  testTools(toolRegistry, options = {}) {
    const expected = Array.isArray(options.expectedTools) ? options.expectedTools : [];
    const exercise = options.exercise || null;

    const checks = [];

    // Check 1: registry is a truthy object
    checks.push({
      name: "tools:registry-exists",
      fn: () => {
        if (!toolRegistry || typeof toolRegistry !== "object") {
          throw new Error("Tool registry is not an object");
        }
        return { registryType: typeof toolRegistry };
      },
    });

    // Check 2: tools can be listed
    if (toolRegistry && typeof toolRegistry.list === "function") {
      checks.push({
        name: "tools:list",
        fn: async () => {
          const tools = await toolRegistry.list();
          if (!Array.isArray(tools)) {
            throw new Error("toolRegistry.list() did not return an array");
          }
          return { count: tools.length, tools: tools.slice(0, 10).map((t) => t.name) };
        },
      });
    }

    // Check 3: expected tools are present
    if (expected.length > 0) {
      checks.push({
        name: "tools:expected-present",
        fn: async () => {
          const tools = typeof toolRegistry.list === "function"
            ? await toolRegistry.list()
            : [];
          const names = new Set(tools.map((t) => (t && t.name) || t));
          const missing = expected.filter((n) => !names.has(n));
          if (missing.length > 0) {
            throw new Error(`Missing expected tools: ${missing.join(", ")}`);
          }
          return { present: expected.length };
        },
      });
    }

    // Check 4: exercise a specific tool
    if (exercise && typeof toolRegistry.execute === "function") {
      checks.push({
        name: `tools:execute-${exercise.name}`,
        fn: async () => {
          const out = await toolRegistry.execute(exercise.name, exercise.args || {});
          if (!out || out.ok === false) {
            throw new Error(`Tool "${exercise.name}" execution returned ok=false`);
          }
          return { toolName: out.toolName || exercise.name, ok: out.ok };
        },
      });
    }

    this._registry.set("tools", checks);
    return this;
  }

  /**
   * Test provider connectivity (mock-friendly).
   *
   * @param {object} provider - a ChatProvider-like object
   * @returns {SelfTest} this instance for chaining
   */
  testProviders(provider) {
    const checks = [];

    // Check 1: provider is an object
    checks.push({
      name: "providers:exists",
      fn: () => {
        if (!provider || typeof provider !== "object") {
          throw new Error("Provider is not an object");
        }
        return { providerName: provider.name || "(unnamed)", model: provider.model || "(unknown)" };
      },
    });

    // Check 2: provider has a chat method
    checks.push({
      name: "providers:has-chat",
      fn: () => {
        if (typeof provider.chat !== "function") {
          throw new Error("Provider is missing chat() method");
        }
        return { method: "chat" };
      },
    });

    // Check 3: provider model is set
    if (typeof provider.model === "string" || typeof provider.setModel === "function") {
      checks.push({
        name: "providers:model-configured",
        fn: () => {
          const model = provider.model || "(none)";
          if (!model || model === "(none)") {
            throw new Error("Provider has no model configured");
          }
          return { model };
        },
      });
    }

    // Check 4: list models (if available)
    if (typeof provider.listModels === "function") {
      checks.push({
        name: "providers:list-models",
        fn: async () => {
          const models = await provider.listModels();
          if (!Array.isArray(models) || models.length === 0) {
            throw new Error("No models returned from listModels()");
          }
          return { modelCount: models.length };
        },
      });
    }

    // Check 5: basic chat round-trip (uses mock / test payload, should be fast)
    checks.push({
      name: "providers:chat-basic",
      fn: async () => {
        const response = await provider.chat({
          messages: [{ role: "user", content: "ping" }],
          model: provider.model,
        });
        if (!response || typeof response.content !== "string") {
          throw new Error("Provider chat() returned unexpected response shape");
        }
        return { contentLength: response.content.length };
      },
    });

    this._registry.set("providers", checks);
    return this;
  }

  /**
   * Test memory read / write / delete.
   *
   * @param {object} memoryApi - an object with { writeMemory, readMemory, deleteMemory, listMemories }
   * @returns {SelfTest} this instance for chaining
   */
  testMemory(memoryApi) {
    const api = memoryApi || {};
    const checks = [];

    const testKey = `__selftest_${Date.now()}__`;
    const testValue = "Self-test value";

    // Check 1: api object exists
    checks.push({
      name: "memory:api-exists",
      fn: () => {
        if (!api || typeof api !== "object") {
          throw new Error("Memory API is not an object");
        }
        const available = ["writeMemory", "readMemory", "deleteMemory", "listMemories"]
          .filter((k) => typeof api[k] === "function");
        return { available };
      },
    });

    // Check 2: write
    if (typeof api.writeMemory === "function") {
      checks.push({
        name: "memory:write",
        fn: () => {
          api.writeMemory(testKey, testValue);
          return { key: testKey, value: testValue };
        },
      });
    } else {
      checks.push({
        name: "memory:write",
        fn: () => { throw new Error("writeMemory not available"); },
      });
    }

    // Check 3: read
    if (typeof api.readMemory === "function") {
      checks.push({
        name: "memory:read",
        fn: () => {
          const entry = api.readMemory(testKey);
          if (!entry) {
            throw new Error(`Memory key "${testKey}" not found after write`);
          }
          return { found: true, name: entry.name };
        },
      });
    } else {
      checks.push({
        name: "memory:read",
        fn: () => { throw new Error("readMemory not available"); },
      });
    }

    // Check 4: list
    if (typeof api.listMemories === "function") {
      checks.push({
        name: "memory:list",
        fn: () => {
          const entries = api.listMemories();
          if (!Array.isArray(entries)) {
            throw new Error("listMemories did not return an array");
          }
          return { count: entries.length };
        },
      });
    } else {
      checks.push({
        name: "memory:list",
        fn: () => { throw new Error("listMemories not available"); },
      });
    }

    // Check 5: delete
    if (typeof api.deleteMemory === "function") {
      checks.push({
        name: "memory:delete",
        fn: () => {
          const removed = api.deleteMemory(testKey);
          const after = api.readMemory(testKey);
          if (after) {
            throw new Error("Memory entry still exists after delete");
          }
          return { removed };
        },
      });
    } else {
      checks.push({
        name: "memory:delete",
        fn: () => { throw new Error("deleteMemory not available"); },
      });
    }

    this._registry.set("memory", checks);
    return this;
  }

  /**
   * Test plugin loading and hook lifecycle.
   *
   * @param {object} pluginRegistry - a PluginRegistry-like object
   * @returns {SelfTest} this instance for chaining
   */
  testPlugins(pluginRegistry) {
    const checks = [];

    // Check 1: registry exists
    checks.push({
      name: "plugins:registry-exists",
      fn: () => {
        if (!pluginRegistry || typeof pluginRegistry !== "object") {
          throw new Error("Plugin registry is not an object");
        }
        return { registryType: typeof pluginRegistry };
      },
    });

    // Check 2: can list plugins
    if (typeof pluginRegistry.list === "function") {
      checks.push({
        name: "plugins:list",
        fn: () => {
          const plugins = pluginRegistry.list();
          if (!Array.isArray(plugins)) {
            throw new Error("pluginRegistry.list() did not return an array");
          }
          return { count: plugins.length };
        },
      });
    } else {
      checks.push({
        name: "plugins:list",
        fn: () => { throw new Error("list() not available on plugin registry"); },
      });
    }

    // Check 3: can register a test plugin
    if (typeof pluginRegistry.register === "function") {
      checks.push({
        name: "plugins:register",
        fn: () => {
          const testName = `__selftest_plugin_${Date.now()}__`;
          // Guard against duplicates
          try {
            pluginRegistry.unregister && pluginRegistry.unregister(testName);
          } catch (_) { /* ignore */ }

          pluginRegistry.register({
            name: testName,
            version: "0.0.0-test",
            hooks: {
              beforeToolCall(ctx) {
                return { ...ctx, _selftest: true };
              },
            },
          });

          const list = pluginRegistry.list();
          const found = list.some((p) => p.name === testName);
          if (!found) {
            throw new Error("Registered plugin not found in list()");
          }

          // Cleanup
          if (typeof pluginRegistry.unregister === "function") {
            pluginRegistry.unregister(testName);
          }

          return { registered: true };
        },
      });
    } else {
      checks.push({
        name: "plugins:register",
        fn: () => { throw new Error("register() not available on plugin registry"); },
      });
    }

    // Check 4: hook execution
    if (typeof pluginRegistry.runHook === "function" && typeof pluginRegistry.register === "function") {
      checks.push({
        name: "plugins:hook-execution",
        fn: async () => {
          const testName = `__selftest_hook_${Date.now()}__`;
          let hookCalled = false;

          try {
            pluginRegistry.unregister && pluginRegistry.unregister(testName);
          } catch (_) { /* ignore */ }

          pluginRegistry.register({
            name: testName,
            hooks: {
              beforeToolCall(ctx) {
                hookCalled = true;
                return ctx;
              },
            },
          });

          await pluginRegistry.runHook("beforeToolCall", { toolName: "test.tool" });

          if (typeof pluginRegistry.unregister === "function") {
            pluginRegistry.unregister(testName);
          }

          if (!hookCalled) {
            throw new Error("Hook was not called during runHook");
          }
          return { hookCalled: true };
        },
      });
    } else {
      checks.push({
        name: "plugins:hook-execution",
        fn: () => { throw new Error("runHook() and/or register() not available"); },
      });
    }

    // Check 5: unregister works
    if (typeof pluginRegistry.unregister === "function" && typeof pluginRegistry.register === "function") {
      checks.push({
        name: "plugins:unregister",
        fn: () => {
          const testName = `__selftest_unreg_${Date.now()}__`;
          try {
            pluginRegistry.unregister(testName);
          } catch (_) { /* ignore */ }

          pluginRegistry.register({ name: testName, hooks: {} });
          const before = pluginRegistry.list().filter((p) => p.name === testName).length;
          const unregistered = pluginRegistry.unregister(testName);
          const after = pluginRegistry.list().filter((p) => p.name === testName).length;

          if (!unregistered || after !== 0) {
            throw new Error("Plugin was not fully unregistered");
          }
          return { beforeCount: before, afterCount: after, unregistered };
        },
      });
    } else {
      checks.push({
        name: "plugins:unregister",
        fn: () => { throw new Error("unregister() and/or register() not available"); },
      });
    }

    this._registry.set("plugins", checks);
    return this;
  }

  // -----------------------------------------------------------------------
  // Report & scoring
  // -----------------------------------------------------------------------

  /**
   * Build a detailed test report.
   *
   * @returns {object}
   *   {
   *     timestamp: string,
   *     totalTests: number,
   *     passed: number,
   *     failed: number,
   *     skipped: number,
   *     categories: { [category]: { tests: Array, passed, failed, skipped } },
   *     healthScore: number,
   *     totalDurationMs: number,
   *   }
   */
  getReport() {
    const categories = {};
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const category of TEST_CATEGORIES) {
      const catResults = this._results.get(category) || [];
      const catPassed = catResults.filter((r) => r.status === "pass").length;
      const catFailed = catResults.filter((r) => r.status === "fail").length;
      const catSkipped = catResults.filter((r) => r.status === "skip").length;

      categories[category] = {
        tests: catResults,
        passed: catPassed,
        failed: catFailed,
        skipped: catSkipped,
      };

      totalTests += catResults.length;
      passed += catPassed;
      failed += catFailed;
      skipped += catSkipped;
    }

    return {
      timestamp: this._lastRunAt || nowISO(),
      totalTests,
      passed,
      failed,
      skipped,
      categories,
      healthScore: this.getHealthScore(),
      totalDurationMs: this._totalDurationMs,
    };
  }

  /**
   * Compute a 0–100 health score based on test results.
   *
   * Scoring:
   *   - Each category contributes 0–100 based on pass rate within that category
   *   - Categories are weighted per CATEGORY_WEIGHTS
   *   - If a category has no results (never run), its contribution is 0
   */
  getHealthScore() {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const category of TEST_CATEGORIES) {
      const weight = CATEGORY_WEIGHTS[category] || 0;
      const catResults = this._results.get(category);

      // If no tests were ever registered for this category, it does not
      // contribute to the health score at all (avoid penalising unregistered categories).
      if (!this._registry.has(category) || this._registry.get(category).length === 0) {
        continue;
      }

      if (!catResults || catResults.length === 0) {
        // Registered but not yet run — contributes 0
        weightedSum += 0;
        totalWeight += weight;
        continue;
      }

      const passCount = catResults.filter((r) => r.status === "pass").length;
      const total = catResults.filter((r) => r.status !== "skip").length;

      if (total === 0) {
        // All skipped — treat as neutral
        totalWeight += weight;
        continue;
      }

      const catScore = Math.round((passCount / total) * 100);
      weightedSum += catScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  /**
   * Convenience: set the tool registry via method-chaining compatible call.
   */
  setToolRegistry(reg, options) {
    return this.testTools(reg, options);
  }

  /**
   * Convenience: set the provider via method-chaining compatible call.
   */
  setProvider(provider) {
    return this.testProviders(provider);
  }

  /**
   * Convenience: set the memory api via method-chaining compatible call.
   */
  setMemoryApi(api) {
    return this.testMemory(api);
  }

  /**
   * Convenience: set the plugin registry via method-chaining compatible call.
   */
  setPluginRegistry(reg) {
    return this.testPlugins(reg);
  }

  /**
   * Reset all internal state (results and registry).
   */
  reset() {
    this._registry.clear();
    this._results.clear();
    this._lastRunAt = null;
    this._totalDurationMs = 0;
    return this;
  }
}

module.exports = {
  SelfTest,
  TEST_CATEGORIES,
  CATEGORY_WEIGHTS,
};
