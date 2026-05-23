"use strict";

const { PLUGIN_HOOK_NAMES } = require("../plugins");

const PLUGIN_HOOK_SET = new Set(PLUGIN_HOOK_NAMES);

/**
 * PluginIsolate — Runs plugins in isolated contexts with resource monitoring.
 *
 * Wraps plugin hook functions to:
 *   - Catch and contain errors so a single plugin crash cannot bring down
 *     the application.
 *   - Sandbox execution with configurable resource limits (memory, CPU time).
 *   - Monitor per-hook and per-plugin resource usage (CPU time, memory delta,
 *     error count, hook latency).
 *
 * Usage:
 *   const isolator = new PluginIsolate({ memoryLimit: 50 * 1024 * 1024 });
 *   const wrapped = isolator.isolate(plugin);
 *   registry.register(wrapped);
 *   // ... later ...
 *   const stats = isolator.getIsolateStats();
 */
class PluginIsolate {
  /**
   * @param {object} [opts]
   * @param {number} [opts.memoryLimit=104857600]  Memory warning threshold in bytes (default 100 MB)
   * @param {number} [opts.cpuTimeLimitMs=10000]   CPU time warning threshold in ms per hook call
   * @param {number} [opts.hookTimeoutMs=30000]    Max time a hook is allowed to run before timeout
   * @param {boolean} [opts.monitorByDefault=true] Whether to auto-monitor wrapped plugins
   */
  constructor(opts) {
    const options = opts || {};
    this._memoryLimit = typeof options.memoryLimit === "number" ? options.memoryLimit : 100 * 1024 * 1024;
    this._cpuTimeLimitMs = typeof options.cpuTimeLimitMs === "number" ? options.cpuTimeLimitMs : 10000;
    this._hookTimeoutMs = typeof options.hookTimeoutMs === "number" ? options.hookTimeoutMs : 30000;
    this._monitorByDefault = options.monitorByDefault !== undefined ? options.monitorByDefault : true;

    // pluginName => { plugin, hooks, stats }
    this._wrapped = new Map();

    // Per-plugin stats
    // pluginName => {
    //   calls: number,
    //   errors: number,
    //   cpuTimeMs: number,
    //   maxCpuTimeMs: number,
    //   minCpuTimeMs: number,
    //   totalHookLatencyMs: number,
    //   avgHookLatencyMs: number,
    //   maxHookLatencyMs: number,
    //   memorySnapshots: number,
    //   maxMemoryDeltaBytes: number,
    //   totalMemoryDeltaBytes: number,
    //   perHook: { hookName: { calls, errors, cpuTimeMs, totalLatencyMs, maxLatencyMs, memoryDeltas: [] } },
    //   lastWarning: string | null,
    // }
    this._stats = new Map();

    // Active monitoring interval IDs
    this._intervals = new Map();
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  /**
   * Wrap a plugin so that every hook is executed inside an error-isolated
   * boundary. Errors in the hook are caught and recorded; they never
   * propagate to the caller.
   *
   * The returned wrapper object shares the same `name` and `version` as
   * the original and can be registered directly with PluginRegistry.
   *
   * @param {object} plugin - Original plugin object (name, version, hooks, ...)
   * @returns {object}       Wrapped plugin safe for registration
   */
  isolate(plugin) {
    if (!plugin || typeof plugin !== "object") {
      throw new Error("PluginIsolate.isolate requires a valid plugin object");
    }
    if (typeof plugin.name !== "string" || !plugin.name.trim()) {
      throw new Error("Plugin must have a non-empty name");
    }

    const wrapped = {
      name: plugin.name,
      version: plugin.version || "0.0.0",
      hooks: {},
    };

    // Carry forward optional fields
    if (plugin.description) {
      wrapped.description = plugin.description;
    }
    if (plugin.metadata) {
      wrapped.metadata = Object.assign({}, plugin.metadata);
      wrapped.metadata.isolated = true;
    } else {
      wrapped.metadata = { isolated: true };
    }

    // Copy non-hook methods (getState, setState, etc.)
    for (const key of Object.keys(plugin)) {
      if (key !== "hooks" && key !== "name" && key !== "version" && key !== "description" && key !== "metadata" && typeof plugin[key] === "function") {
        wrapped[key] = plugin[key].bind(plugin);
      }
    }

    // Wrap each hook
    if (plugin.hooks && typeof plugin.hooks === "object") {
      for (const hookName of Object.keys(plugin.hooks)) {
        if (!PLUGIN_HOOK_SET.has(hookName)) continue;
        const originalFn = plugin.hooks[hookName];
        if (typeof originalFn !== "function") continue;

        wrapped.hooks[hookName] = this._isolateHook(plugin.name, hookName, originalFn);
      }
    }

    // Initialize stats
    this._initStats(plugin.name, wrapped);

    // Store the mapping
    this._wrapped.set(plugin.name, {
      original: plugin,
      wrapped,
    });

    return wrapped;
  }

  /**
   * Wrap a plugin with resource-limited execution.
   *
   * In addition to error isolation, the sandbox tracks CPU time and
   * memory deltas for each hook invocation and emits warnings when
   * limits are exceeded.
   *
   * @param {object} plugin - Original plugin object
   * @returns {object}       Sandboxed, wrapped plugin
   */
  sandbox(plugin) {
    // Build on top of isolate
    const wrapped = this.isolate(plugin);
    const entry = this._wrapped.get(plugin.name);
    if (!entry) return wrapped;

    // Replace each hook with a sandboxed version
    if (wrapped.hooks) {
      for (const hookName of Object.keys(wrapped.hooks)) {
        const isolatedFn = wrapped.hooks[hookName];
        const originalFn = plugin.hooks && plugin.hooks[hookName] ? plugin.hooks[hookName] : isolatedFn;
        wrapped.hooks[hookName] = this._sandboxHook(plugin.name, hookName, originalFn, isolatedFn);
      }
    }

    // Update stored wrapped plugin
    entry.wrapped = wrapped;

    return wrapped;
  }

  /**
   * Start continuous resource monitoring for a plugin.
   *
   * Snapshots memory usage at regular intervals and records warnings
   * when thresholds are breached. Returns a monitor handle that can
   * be used to stop monitoring.
   *
   * @param {object|string} plugin - Plugin object or plugin name
   * @param {number} [intervalMs=5000] - Monitoring interval in ms
   * @returns {{ stop: function }}
   */
  monitor(plugin, intervalMs) {
    const pluginName = typeof plugin === "string" ? plugin : (plugin && plugin.name);
    if (!pluginName) {
      throw new Error("monitor requires a valid plugin name");
    }

    const interval = intervalMs || 5000;

    // Stop any existing monitor for this plugin
    this._stopMonitor(pluginName);

    const stats = this._getOrCreateStats(pluginName);
    let baseline = null;

    const id = setInterval(() => {
      try {
        const mem = process.memoryUsage();
        const heapUsed = mem.heapUsed;

        if (baseline === null) {
          baseline = heapUsed;
          return;
        }

        const delta = heapUsed - baseline;

        stats.memorySnapshots += 1;
        stats.totalMemoryDeltaBytes += Math.max(0, delta);

        if (delta > stats.maxMemoryDeltaBytes) {
          stats.maxMemoryDeltaBytes = delta;
        }

        if (delta > this._memoryLimit) {
          stats.lastWarning = `Memory growth of ${this._formatBytes(delta)} exceeds limit of ${this._formatBytes(this._memoryLimit)}`;
        }

        // Reset baseline periodically to track sustained growth
        baseline = heapUsed;
      } catch (_) {
        // Monitoring should never throw
      }
    }, interval);

    this._intervals.set(pluginName, id);

    return {
      stop: () => this._stopMonitor(pluginName),
    };
  }

  /**
   * Get isolation statistics for all wrapped plugins.
   *
   * Returns an object keyed by plugin name with per-plugin and
   * per-hook resource usage data.
   *
   * @returns {object}  { pluginName: { calls, errors, cpuTimeMs, ... perHook: { ... } } }
   */
  getIsolateStats() {
    const result = {};

    for (const [pluginName, stats] of this._stats) {
      result[pluginName] = this._snapshotStats(stats);
    }

    return result;
  }

  /**
   * Get stats for a single plugin.
   *
   * @param {string} pluginName
   * @returns {object|null}
   */
  getPluginStats(pluginName) {
    const stats = this._stats.get(pluginName);
    if (!stats) return null;
    return this._snapshotStats(stats);
  }

  /**
   * Reset all accumulated statistics. Useful after a deployment or
   * config change so stale data does not pollute the picture.
   */
  resetStats() {
    this._stats.clear();
  }

  /**
   * Stop all active monitors.
   */
  close() {
    for (const pluginName of this._intervals.keys()) {
      this._stopMonitor(pluginName);
    }
    this._wrapped.clear();
    this._stats.clear();
  }

  // ────────────────────────────────────────────────────────────
  // Hook Wrappers
  // ────────────────────────────────────────────────────────────

  /**
   * Wrap a single hook with error containment.
   */
  _isolateHook(pluginName, hookName, originalFn) {
    const self = this;

    return function isolatedHook(ctx) {
      const stats = self._getOrCreateStats(pluginName);

      try {
        // Track call count before execution
        stats.calls += 1;
        if (stats.perHook.has(hookName)) {
          stats.perHook.get(hookName).calls += 1;
        }

        const result = originalFn(ctx);

        // Handle async hooks (returning promises)
        if (result && typeof result.then === "function") {
          return result.then(
            (resolved) => resolved,
            (err) => {
              // Record the error but don't propagate
              stats.errors += 1;
              const perHook = stats.perHook.get(hookName);
              if (perHook) perHook.errors += 1;

              if (stats.errors === 1) {
                stats.firstError = {
                  hookName,
                  message: err.message,
                  timestamp: new Date().toISOString(),
                };
              }

              return undefined; // Swallow the error
            },
          );
        }

        return result;
      } catch (err) {
        // Record synchronous errors
        stats.errors += 1;
        const perHook = stats.perHook.get(hookName);
        if (perHook) perHook.errors += 1;

        if (stats.errors === 1) {
          stats.firstError = {
            hookName,
            message: err.message,
            timestamp: new Date().toISOString(),
          };
        }

        return undefined; // Swallow the error
      }
    };
  }

  /**
   * Wrap a single hook with sandboxed resource tracking.
   */
  _sandboxHook(pluginName, hookName, originalFn, isolatedFn) {
    const self = this;

    return function sandboxedHook(ctx) {
      const stats = self._getOrCreateStats(pluginName);
      const perHook = stats.perHook.get(hookName);

      const memBefore = process.memoryUsage();
      const cpuBefore = process.cpuUsage();
      const wallBefore = Date.now();

      // Create a timeout promise
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Hook "${hookName}" in plugin "${pluginName}" timed out after ${self._hookTimeoutMs}ms`));
        }, self._hookTimeoutMs);
      });

      const executePromise = (async () => {
        try {
          return await isolatedFn(ctx);
        } finally {
          clearTimeout(timeoutId);
        }
      })();

      return Promise.race([executePromise, timeoutPromise])
        .then((result) => {
          clearTimeout(timeoutId);

          const wallAfter = Date.now();
          const cpuAfter = process.cpuUsage(cpuBefore);
          const memAfter = process.memoryUsage();

          const cpuTimeMs = (cpuAfter.user + cpuAfter.system) / 1000; // microseconds to ms
          const wallTimeMs = wallAfter - wallBefore;
          const memDelta = Math.max(0, memAfter.heapUsed - memBefore.heapUsed);

          // Accumulate stats
          stats.cpuTimeMs += cpuTimeMs;
          stats.totalHookLatencyMs += wallTimeMs;
          stats.avgHookLatencyMs = stats.totalHookLatencyMs / Math.max(1, stats.calls);
          stats.totalMemoryDeltaBytes += memDelta;
          stats.memorySnapshots += 1;

          if (cpuTimeMs > stats.maxCpuTimeMs) stats.maxCpuTimeMs = cpuTimeMs;
          if (cpuTimeMs < stats.minCpuTimeMs || stats.minCpuTimeMs === 0) stats.minCpuTimeMs = cpuTimeMs;
          if (wallTimeMs > stats.maxHookLatencyMs) stats.maxHookLatencyMs = wallTimeMs;
          if (memDelta > stats.maxMemoryDeltaBytes) stats.maxMemoryDeltaBytes = memDelta;

          // Per-hook stats
          if (perHook) {
            perHook.cpuTimeMs += cpuTimeMs;
            perHook.totalLatencyMs += wallTimeMs;
            perHook.memoryDeltas.push(memDelta);
            if (perHook.memoryDeltas.length > 100) perHook.memoryDeltas.shift();
            if (wallTimeMs > perHook.maxLatencyMs) perHook.maxLatencyMs = wallTimeMs;
          }

          // Warnings
          if (cpuTimeMs > self._cpuTimeLimitMs) {
            stats.lastWarning =
              `CPU time ${cpuTimeMs.toFixed(1)}ms for hook "${hookName}" exceeds limit of ${self._cpuTimeLimitMs}ms`;
          }
          if (memDelta > self._memoryLimit) {
            stats.lastWarning =
              `Memory delta ${self._formatBytes(memDelta)} for hook "${hookName}" exceeds limit of ${self._formatBytes(self._memoryLimit)}`;
          }
          if (wallTimeMs > self._hookTimeoutMs * 0.8) {
            stats.lastWarning =
              `Hook "${hookName}" is approaching timeout: ${wallTimeMs}ms / ${self._hookTimeoutMs}ms`;
          }

          return result;
        })
        .catch((err) => {
          clearTimeout(timeoutId);

          stats.errors += 1;
          if (perHook) perHook.errors += 1;

          if (err.message && err.message.includes("timed out")) {
            stats.lastWarning = err.message;
          }

          return undefined; // Swallow errors in sandbox
        });
    };
  }

  // ────────────────────────────────────────────────────────────
  // Stats Helpers
  // ────────────────────────────────────────────────────────────

  /**
   * Initialize stats for a newly wrapped plugin.
   */
  _initStats(pluginName, wrappedPlugin) {
    const stats = this._getOrCreateStats(pluginName);
    stats.version = wrappedPlugin.version || "0.0.0";
    stats.wrappedAt = new Date().toISOString();
  }

  /**
   * Get or create a stats entry for a plugin.
   */
  _getOrCreateStats(pluginName) {
    if (!this._stats.has(pluginName)) {
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
        maxHookLatencyMs: 0,
        memorySnapshots: 0,
        maxMemoryDeltaBytes: 0,
        totalMemoryDeltaBytes: 0,
        perHook: new Map(),
        firstError: null,
        lastWarning: null,
      };

      // Pre-populate per-hook stats
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

      this._stats.set(pluginName, stats);
    }

    return this._stats.get(pluginName);
  }

  /**
   * Create a plain-object snapshot of stats.
   */
  _snapshotStats(stats) {
    const perHook = {};
    for (const [hookName, hookStats] of stats.perHook) {
      perHook[hookName] = Object.assign({}, hookStats);
    }

    return {
      version: stats.version,
      wrappedAt: stats.wrappedAt,
      calls: stats.calls,
      errors: stats.errors,
      cpuTimeMs: stats.cpuTimeMs,
      maxCpuTimeMs: stats.maxCpuTimeMs,
      minCpuTimeMs: stats.minCpuTimeMs === 0 ? undefined : stats.minCpuTimeMs,
      avgHookLatencyMs: stats.avgHookLatencyMs,
      maxHookLatencyMs: stats.maxHookLatencyMs,
      memorySnapshots: stats.memorySnapshots,
      maxMemoryDeltaBytes: stats.maxMemoryDeltaBytes,
      totalMemoryDeltaBytes: stats.totalMemoryDeltaBytes,
      perHook,
      firstError: stats.firstError ? Object.assign({}, stats.firstError) : null,
      lastWarning: stats.lastWarning,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Utilities
  // ────────────────────────────────────────────────────────────

  /**
   * Stop monitoring for a given plugin.
   */
  _stopMonitor(pluginName) {
    const id = this._intervals.get(pluginName);
    if (id) {
      clearInterval(id);
      this._intervals.delete(pluginName);
    }
  }

  /**
   * Format bytes to a human-readable string.
   */
  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

module.exports = { PluginIsolate };
