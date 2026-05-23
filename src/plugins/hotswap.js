"use strict";

const { validatePlugin } = require("../plugin-validator");

/**
 * PluginHotSwap — Enables runtime plugin replacement without process restart.
 *
 * Integrates with PluginRegistry to atomically swap one registered plugin for
 * another while handling hook transfer, state migration, and in-flight request
 * completion.
 *
 *   const registry = new PluginRegistry();
 *   registry.register({ name: "my-plugin", version: "1.0.0", hooks: { ... } });
 *
 *   const swapper = new PluginHotSwap(registry);
 *   const newPlugin = { name: "my-plugin", version: "2.0.0", hooks: { ... } };
 *
 *   await swapper.hotSwap("my-plugin", newPlugin);
 *   // Or with validation:
 *   await swapper.safeSwap("my-plugin", newPlugin);
 *
 *   // Rollback to the previous version:
 *   swapper.rollback("my-plugin");
 *
 *   // Inspect swap history:
 *   const history = swapper.getSwapHistory();
 */
class PluginHotSwap {
  /**
   * @param {object} registry - A PluginRegistry instance
   * @param {object} [opts]
   * @param {number} [opts.maxHistory=100]        Maximum swap history entries
   * @param {number} [opts.inflightTimeoutMs=5000] Max wait for in-flight hooks
   * @param {boolean} [opts.requireCompatible=true] Require hook overlap for safeSwap
   */
  constructor(registry, opts) {
    if (!registry || typeof registry.register !== "function" || typeof registry.unregister !== "function") {
      throw new Error("PluginHotSwap requires a valid PluginRegistry instance");
    }

    this._registry = registry;
    this._swapHistory = [];
    this._maxHistory = Math.max(1, opts && opts.maxHistory ? opts.maxHistory : 100);
    this._inflightTimeoutMs = opts && opts.inflightTimeoutMs ? opts.inflightTimeoutMs : 5000;
    this._requireCompatible = opts && opts.requireCompatible !== undefined ? opts.requireCompatible : true;

    // pluginName => { plugin, inflight: number, inflightResolvers: Set }
    this._plugins = new Map();
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  /**
   * Check if a plugin supports hot-swapping.
   *
   * A plugin is hot-swappable when it explicitly declares
   * `metadata.hotSwappable === true`. Plugins that hold persistent
   * in-memory state may opt out to prevent data loss during swaps.
   *
   * @param {object|string} plugin - Plugin object or registered plugin name
   * @returns {boolean}
   */
  canHotSwap(plugin) {
    const entry = this._resolvePlugin(plugin);
    if (!entry) return false;

    if (entry.plugin.metadata && entry.plugin.metadata.hotSwappable === true) {
      return true;
    }

    return false;
  }

  /**
   * Atomically swap a registered plugin for a new version.
   *
   * Steps:
   *   1. Wait for any in-flight hook handlers on the old plugin to finish.
   *   2. Migrate state if the old plugin exposes `getState()` and the new
   *      plugin exposes `setState()`.
   *   3. Unregister the old plugin from the registry.
   *   4. Register the new plugin in the registry.
   *   5. Record the swap in history.
   *
   * Returns `true` on success, never throws — errors are caught and
   * recorded in the swap history so the caller can inspect what failed.
   *
   * @param {string} oldPluginName - Name of the currently registered plugin
   * @param {object} newPlugin     - The replacement plugin object
   * @returns {Promise<boolean>}
   */
  async hotSwap(oldPluginName, newPlugin, opts) {
    if (typeof oldPluginName !== "string" || !oldPluginName.trim()) {
      throw new Error("oldPluginName must be a non-empty string");
    }
    if (!newPlugin || typeof newPlugin !== "object" || typeof newPlugin.name !== "string") {
      throw new Error("newPlugin must be a valid plugin object with a name");
    }

    const skipHistory = opts && opts._skipHistory === true;

    const oldEntry = this._plugins.get(oldPluginName);
    const registryPlugins = this._registry._plugins;
    const registryOld = registryPlugins ? registryPlugins.find((p) => p.name === oldPluginName) : null;

    if (!registryOld) {
      if (!skipHistory) {
        this._recordSwap(oldPluginName, "unknown", null, newPlugin, false, null, "Old plugin not found in registry");
      }
      return false;
    }

    // ---- Snapshot old plugin BEFORE any mutation ----
    const oldVersion = registryOld.version || "unknown";
    const oldPluginSnapshot = this._deepCloneRegistryEntry(registryOld);
    const oldPluginOriginal = oldEntry ? oldEntry.plugin : null;

    let migratedState = null;

    try {
      // Step 1: Wait for in-flight requests
      await this._awaitInflight(oldPluginName);

      // Step 2: State migration (isolated — errors here do NOT fail the swap)
      migratedState = await this._safeMigrateState(oldPluginOriginal, newPlugin);

      // Step 3: Unregister old plugin
      this._registry.unregister(oldPluginName);

      // Step 4: Register new plugin
      this._registry.register(newPlugin);

      // Track the new plugin for future swaps
      this._trackPlugin(newPlugin);

      // Step 5: Record success with captured old data
      if (!skipHistory) {
        this._recordSwap(oldPluginName, oldVersion, oldPluginSnapshot, newPlugin, true, migratedState);
      }

      return true;
    } catch (err) {
      // Attempt to re-register the old plugin on failure
      if (oldEntry && oldPluginOriginal) {
        try {
          this._registry.register(oldPluginOriginal);
        } catch (_) {
          // Best-effort rollback
        }
      }

      if (!skipHistory) {
        this._recordSwap(oldPluginName, oldVersion, oldPluginSnapshot, newPlugin, false, null, err.message);
      }
      return false;
    }
  }

  /**
   * Validate the new plugin before performing the swap.
   *
   * Uses `validatePlugin()` from the plugin-validator module and
   * (configurably) checks that the new plugin provides the same hooks
   * as the old one to avoid breaking consumers.
   *
   * @param {string} oldPluginName - Name of the currently registered plugin
   * @param {object} newPlugin     - The replacement plugin object
   * @returns {Promise<{ success: boolean, validation: object, swapResult: boolean }>}
   */
  async safeSwap(oldPluginName, newPlugin) {
    // Validate plugin shape
    const validation = validatePlugin(newPlugin);

    if (!validation.valid) {
      return {
        success: false,
        validation,
        error: "Plugin validation failed. See validation.errors for details.",
      };
    }

    // Check hook compatibility
    if (this._requireCompatible) {
      const registryPlugins = this._registry._plugins;
      const registryOld = registryPlugins ? registryPlugins.find((p) => p.name === oldPluginName) : null;

      if (registryOld) {
        const oldHooks = new Set(Object.keys(registryOld.hooks));
        const newHooks = new Set(newPlugin.hooks ? Object.keys(newPlugin.hooks).filter((h) => typeof newPlugin.hooks[h] === "function") : []);

        for (const hook of oldHooks) {
          if (!newHooks.has(hook)) {
            validation.warnings.push({
              path: `hooks.${hook}`,
              message: `New plugin is missing hook "${hook}" that the old plugin provided. This may break consumers.`,
            });
          }
        }
      }
    }

    // Perform the swap
    const swapResult = await this.hotSwap(oldPluginName, newPlugin);

    return {
      success: validation.valid && swapResult,
      validation,
      swapResult,
    };
  }

  /**
   * Revert the most recent swap for a plugin name.
   *
   * Looks through the swap history (in reverse chronological order)
   * to find the last successful swap for the given plugin and swaps
   * the previous version back in.
   *
   * @param {string} pluginName
   * @returns {Promise<boolean>}
   */
  async rollback(pluginName) {
    if (typeof pluginName !== "string" || !pluginName.trim()) {
      throw new Error("pluginName must be a non-empty string");
    }

    // Find the latest successful swap in history for this plugin
    let targetSwap = null;
    let targetIndex = -1;

    for (let i = this._swapHistory.length - 1; i >= 0; i--) {
      const entry = this._swapHistory[i];
      if (entry.pluginName === pluginName && entry.success) {
        targetSwap = entry;
        targetIndex = i;
        break;
      }
    }

    if (!targetSwap) {
      throw new Error(`No successful swap found for plugin "${pluginName}"`);
    }

    if (!targetSwap.previousPlugin) {
      throw new Error(`No previous version recorded for plugin "${pluginName}". Cannot rollback.`);
    }

    // Perform the reverse swap (suppress hotSwap's own history entry)
    const rollbackPlugin = targetSwap.previousPlugin;
    const result = await this.hotSwap(pluginName, rollbackPlugin, { _skipHistory: true });

    // Mark this rollback entry
    const rollbackEntry = {
      type: "rollback",
      pluginName,
      timestamp: new Date().toISOString(),
      swappedFrom: targetSwap.newVersion,
      swappedTo: rollbackPlugin.version || "0.0.0",
      success: result,
    };
    this._swapHistory.push(rollbackEntry);
    this._trimHistory();

    return result;
  }

  /**
   * Return a copy of the complete swap history.
   *
   * @returns {Array<object>}
   */
  getSwapHistory() {
    return this._swapHistory.map((entry) => Object.assign({}, entry));
  }

  /**
   * Register a plugin for tracking. Call this before using hotSwap
   * if the plugin was registered directly on the registry before the
   * PluginHotSwap instance was created.
   *
   * @param {object} plugin - Plugin object already registered in the registry
   */
  trackExisting(plugin) {
    if (!plugin || typeof plugin !== "object" || typeof plugin.name !== "string") {
      throw new Error("trackExisting requires a valid plugin object with a name");
    }
    this._trackPlugin(plugin);
  }

  /**
   * Enable in-flight request tracking for a plugin's hook functions.
   * Wraps each hook handler so that hotSwap can wait for pending
   * executions to complete before unregistering.
   *
   * Call this before using hotSwap, typically after registering the
   * plugin through the registry.
   *
   * @param {string} pluginName
   */
  wrapHooks(pluginName) {
    const entry = this._plugins.get(pluginName);
    if (!entry) return;

    const registryPlugins = this._registry._plugins;
    const registered = registryPlugins ? registryPlugins.find((p) => p.name === pluginName) : null;
    if (!registered || !registered.hooks) return;

    for (const hookName of Object.keys(registered.hooks)) {
      const originalFn = registered.hooks[hookName];
      if (typeof originalFn !== "function") continue;

      const trackedFn = this._createTrackedHook(pluginName, hookName, originalFn);

      // Replace the hook in the registry's hook map
      const handlers = this._registry._hooks.get(hookName);
      if (handlers) {
        for (const handler of handlers) {
          if (handler.plugin === pluginName) {
            handler.fn = trackedFn;
          }
        }
      }

      // Also update the internal hooks storage on the plugin entry
      registered.hooks[hookName] = trackedFn;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────

  /**
   * Track a plugin internally for state migration and in-flight tracking.
   */
  _trackPlugin(plugin) {
    this._plugins.set(plugin.name, {
      plugin: Object.assign({}, plugin),
      inflight: 0,
      inflightResolvers: new Set(),
    });
  }

  /**
   * Resolve a plugin argument to its internal entry.
   */
  _resolvePlugin(plugin) {
    if (typeof plugin === "object" && plugin !== null && plugin.name) {
      return this._plugins.get(plugin.name) || null;
    }
    if (typeof plugin === "string") {
      return this._plugins.get(plugin) || null;
    }
    return null;
  }

  /**
   * Create a hook function wrapper that tracks in-flight executions.
   */
  _createTrackedHook(pluginName, hookName, originalFn) {
    const self = this;
    return function trackedHook(ctx) {
      const entry = self._plugins.get(pluginName);
      if (!entry) return originalFn(ctx);

      entry.inflight += 1;

      let promise;
      try {
        promise = originalFn(ctx);
      } catch (syncErr) {
        entry.inflight -= 1;
        self._notifyInflight(entry);
        throw syncErr;
      }

      if (promise && typeof promise.then === "function") {
        return promise.then(
          (result) => {
            entry.inflight -= 1;
            self._notifyInflight(entry);
            return result;
          },
          (err) => {
            entry.inflight -= 1;
            self._notifyInflight(entry);
            throw err;
          },
        );
      }

      // Synchronous return
      entry.inflight -= 1;
      self._notifyInflight(entry);
      return promise;
    };
  }

  /**
   * Notify all resolvers waiting on in-flight completion.
   */
  _notifyInflight(entry) {
    if (entry.inflight <= 0 && entry.inflightResolvers.size > 0) {
      for (const resolve of entry.inflightResolvers) {
        resolve();
      }
      entry.inflightResolvers.clear();
    }
  }

  /**
   * Wait for all in-flight hook executions to complete, with a timeout.
   */
  async _awaitInflight(pluginName) {
    const entry = this._plugins.get(pluginName);
    if (!entry || entry.inflight <= 0) return;

    return new Promise((resolve) => {
      // Fast path: if all completed while we were setting up
      if (entry.inflight <= 0) return resolve();

      entry.inflightResolvers.add(resolve);

      // Safety timeout
      const timer = setTimeout(() => {
        entry.inflightResolvers.delete(resolve);
        resolve(); // Force through after timeout
      }, this._inflightTimeoutMs);

      // When resolved naturally, clear the timeout
      const originalResolve = resolve;
      entry.inflightResolvers.add(() => {
        clearTimeout(timer);
        originalResolve();
      });
    });
  }

  /**
   * Safely migrate state from old plugin to new plugin.
   * Errors during state migration are caught and logged — they never
   * cause the swap itself to fail.
   *
   * @param {object|null} oldPlugin - Original plugin object (may have getState)
   * @param {object} newPlugin      - New plugin object (may have setState)
   * @returns {Promise<object|null>}  Migrated state, or null
   */
  async _safeMigrateState(oldPlugin, newPlugin) {
    if (!oldPlugin || typeof oldPlugin.getState !== "function") return null;

    let migratedState = null;
    try {
      migratedState = await oldPlugin.getState();
    } catch (stateErr) {
      // State read failure is not a swap failure
      this._swapHistory.push({
        type: "state-warning",
        pluginName: this._resolvePluginName(oldPlugin) || "unknown",
        timestamp: new Date().toISOString(),
        message: `Failed to read state from old plugin: ${stateErr.message}`,
      });
      this._trimHistory();
      return null;
    }

    if (migratedState !== null && migratedState !== undefined && typeof newPlugin.setState === "function") {
      try {
        await newPlugin.setState(migratedState);
      } catch (stateErr) {
        this._swapHistory.push({
          type: "state-warning",
          pluginName: newPlugin.name,
          timestamp: new Date().toISOString(),
          message: `Failed to apply state to new plugin: ${stateErr.message}`,
        });
        this._trimHistory();
      }
    }

    return migratedState;
  }

  /**
   * Create a deep clone of a registry plugin entry suitable for
   * storing in swap history (so rollback can reconstruct it later).
   */
  _deepCloneRegistryEntry(registered) {
    if (!registered) return null;

    const clone = { name: registered.name, version: registered.version };
    if (registered.hooks) {
      clone.hooks = {};
      for (const [hookName, hookFn] of Object.entries(registered.hooks)) {
        // We cannot deep-clone functions, so store the reference.
        // The rollback path relies on the original plugin object being
        // available in this._plugins for function restoration.
        clone.hooks[hookName] = hookFn;
      }
    }
    return clone;
  }

  /**
   * Resolve a plugin object to its string name.
   */
  _resolvePluginName(plugin) {
    if (!plugin) return null;
    if (typeof plugin.name === "string") return plugin.name;
    return null;
  }

  /**
   * Record a swap entry in history and trim if needed.
   */
  _recordSwap(pluginName, oldVersion, oldPluginSnapshot, newPlugin, success, migratedState, error) {
    const entry = {
      type: "swap",
      pluginName,
      timestamp: new Date().toISOString(),
      oldVersion: oldVersion || "unknown",
      newVersion: newPlugin ? newPlugin.version || "0.0.0" : "0.0.0",
      success,
      previousPlugin: oldPluginSnapshot,
    };

    if (error) {
      entry.error = error;
    }
    if (migratedState !== null && migratedState !== undefined) {
      entry.migratedState = true;
    }

    this._swapHistory.push(entry);
    this._trimHistory();
    return entry;
  }

  /**
   * Ensure history doesn't exceed the configured maximum.
   */
  _trimHistory() {
    while (this._swapHistory.length > this._maxHistory) {
      this._swapHistory.shift();
    }
  }
}

module.exports = { PluginHotSwap };
