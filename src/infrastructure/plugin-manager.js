"use strict";

const path = require("node:path");
const { PluginRegistry, PLUGIN_HOOK_NAMES } = require("../plugins");

// Ecosystem modules — all loaded with try/catch for optional availability
let PluginIndex = null;
let PluginHotSwap = null;
let PluginIsolate = null;
let DependencyGraph = null;
let PluginRepository = null;
let PluginMarketplace = null;
let validatePlugin = null;
let assertValidPlugin = null;
let formatPluginValidationResult = null;

try {
  ({ PluginIndex } = require("../plugins/indexer"));
} catch (_) { /* optional */ }

try {
  ({ PluginHotSwap } = require("../plugins/hotswap"));
} catch (_) { /* optional */ }

try {
  ({ PluginIsolate } = require("../plugins/isolate"));
} catch (_) { /* optional */ }

try {
  ({ DependencyGraph } = require("../plugins/dependency"));
} catch (_) { /* optional */ }

try {
  ({ PluginRepository } = require("../plugins/repository"));
} catch (_) { /* optional */ }

try {
  ({ PluginMarketplace } = require("../marketplace/index"));
} catch (_) { /* optional */ }

try {
  const validator = require("../plugin-validator");
  validatePlugin = validator.validatePlugin;
  assertValidPlugin = validator.assertValidPlugin;
  formatPluginValidationResult = validator.formatPluginValidationResult;
} catch (_) { /* optional */ }

/**
 * createPluginManager(options) — Creates an enhanced plugin system that wraps
 * PluginRegistry with discovery, hot-swapping, isolation, dependency ordering,
 * remote installation, marketplace search, and pre-registration validation.
 *
 * @param {object} [options]
 * @param {string} [options.pluginsDir]         - Default directory for local plugins
 * @param {string} [options.installDir]         - Directory where plugins are installed
 * @param {Array<{name:string,url:string,type:string}>} [options.sources] - Repository sources
 * @param {boolean} [options.autoIsolate=false] - Auto-isolate all registered plugins
 * @param {boolean} [options.autoValidate=true] - Validate plugins before registration
 * @param {object}  [options.isolateOptions]    - Options for PluginIsolate
 * @param {object}  [options.hotSwapOptions]    - Options for PluginHotSwap
 * @returns {object} Enhanced plugin manager
 */
function createPluginManager(options) {
  const opts = options || {};
  const pluginsDir = opts.pluginsDir || null;
  const installDir = opts.installDir || pluginsDir || path.join(process.cwd(), ".hax-agent", "plugins");
  const autoIsolate = opts.autoIsolate === true;
  const autoValidate = opts.autoValidate !== false;

  // ── Core registry ──────────────────────────────────────────────────────
  const registry = new PluginRegistry();

  // ── Ecosystem components ────────────────────────────────────────────────
  let indexer = null;
  let hotSwap = null;
  let isolator = null;
  let depGraph = null;
  let repository = null;
  let marketplace = null;

  if (PluginIndex) {
    indexer = new PluginIndex();
  }
  if (PluginHotSwap) {
    hotSwap = new PluginHotSwap(registry, opts.hotSwapOptions || {});
  }
  if (PluginIsolate) {
    isolator = new PluginIsolate(opts.isolateOptions || {});
  }
  if (DependencyGraph) {
    depGraph = new DependencyGraph();
  }
  if (PluginRepository) {
    repository = new PluginRepository();
  }
  if (PluginMarketplace) {
    marketplace = new PluginMarketplace({
      localDir: pluginsDir,
      installedDir: installDir,
      sources: opts.sources || [],
    });
  }

  // ── Disabled plugins tracking ───────────────────────────────────────────
  const _disabledPlugins = new Map(); // name → plugin object

  // ── Plugin registration (with validation + isolation) ──────────────────

  /**
   * Register a plugin through the enhanced pipeline:
   *   1. Validate (if autoValidate is on)
   *   2. Isolate (if autoIsolate is on)
   *   3. Register with PluginRegistry
   *   4. Add to DependencyGraph
   *   5. Track in PluginHotSwap
   *
   * @param {object} plugin - Plugin object
   * @param {object} [regOpts]
   * @param {boolean} [regOpts.skipValidate] - Skip validation
   * @param {boolean} [regOpts.skipIsolate]  - Skip isolation
   * @returns {object} Registration result
   */
  function register(plugin, regOpts) {
    const ro = regOpts || {};

    // Validate
    if (autoValidate && !ro.skipValidate && validatePlugin) {
      const validation = validatePlugin(plugin);
      if (!validation.valid) {
        const msg = formatPluginValidationResult
          ? formatPluginValidationResult(validation)
          : validation.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
        throw new Error(`Plugin validation failed for "${plugin.name}":\n${msg}`);
      }
    }

    // Wrap with isolation if requested
    let pluginToRegister = plugin;
    if (autoIsolate && !ro.skipIsolate && isolator) {
      pluginToRegister = isolator.isolate(plugin);
    }

    // Register with core registry
    const entry = registry.register(pluginToRegister);

    // Add to dependency graph
    if (depGraph && plugin.dependencies && typeof plugin.dependencies === "object") {
      depGraph.addPlugin(plugin.name, plugin.version || "0.0.0", plugin.dependencies);
    }

    // Track in hot-swap system
    if (hotSwap) {
      try {
        hotSwap.trackExisting(pluginToRegister);
      } catch (_) { /* best-effort */ }
    }

    return entry;
  }

  // ── Directory scanning ──────────────────────────────────────────────────

  /**
   * Scan a directory for plugins and load them into the registry.
   *
   * @param {string} directory
   * @returns {number} Number of plugins loaded
   */
  function scanDirectory(directory) {
    if (!indexer) {
      // Fall back to raw registry
      return registry.loadPluginsFromDirectory(directory);
    }

    const count = indexer.scan(directory);
    const entries = indexer.list();

    // Load plugins from index into registry
    let loaded = 0;
    for (const entry of entries) {
      if (!entry.path) continue;
      try {
        registerFromFile(entry.path);
        loaded += 1;
      } catch (_err) {
        // Errors loading individual plugins are non-fatal
      }
    }
    return loaded;
  }

  /**
   * Load and register a plugin from a file path.
   */
  function registerFromFile(filePath) {
    const resolved = path.resolve(filePath);
    delete require.cache[require.resolve(resolved)];
    const plugin = require(resolved);
    return register(plugin);
  }

  // ── Install / Uninstall / Update ────────────────────────────────────────

  /**
   * Install a plugin from the marketplace.
   *
   * @param {string} pluginName
   * @param {object} [instOpts]
   * @param {string} [instOpts.targetDir] - Where to install
   * @param {string} [instOpts.source]    - Source repository name
   * @param {boolean} [instOpts.autoRegister=true] - Register after install
   * @returns {object} Install result
   */
  function install(pluginName, instOpts) {
    if (!marketplace) {
      throw new Error("Plugin marketplace is not available. Ensure src/marketplace/index.js is loadable.");
    }

    const io = instOpts || {};
    const targetDir = io.targetDir || installDir;
    const autoRegister = io.autoRegister !== false;

    // Ensure marketplace is initialized
    const initPromise = marketplace._initialized ? Promise.resolve() : marketplace.init();
    // Synchronous path: marketplace.init() is async but we handle both
    if (!marketplace._initialized) {
      // Best-effort sync init
      try {
        marketplace.init();
      } catch (_) { /* init errors non-fatal */ }
    }

    const result = marketplace.install(pluginName, targetDir, io.source);

    // Auto-register the freshly installed plugin
    if (autoRegister && result.path) {
      try {
        registerFromFile(result.path);
      } catch (_err) {
        // Installation succeeded but registration failed — plugin may be invalid
      }
    }

    return result;
  }

  /**
   * Uninstall a plugin: remove from registry and delete files.
   *
   * @param {string} pluginName
   * @param {object} [uninstOpts]
   * @param {string} [uninstOpts.targetDir]
   * @returns {object} Uninstall result
   */
  function uninstall(pluginName, uninstOpts) {
    const uo = uninstOpts || {};
    const targetDir = uo.targetDir || installDir;

    // Remove from registry
    registry.unregister(pluginName);

    // Remove from dependency graph
    if (depGraph) {
      depGraph.removePlugin(pluginName);
    }

    // Remove from disabled list
    _disabledPlugins.delete(pluginName);

    // Remove files via marketplace
    if (marketplace) {
      return marketplace.uninstall(pluginName, targetDir);
    }

    return { removed: true, filesDeleted: [] };
  }

  /**
   * Update a plugin from the marketplace.
   *
   * @param {string} pluginName
   * @param {object} [updOpts]
   * @param {string} [updOpts.targetDir]
   * @param {boolean} [updOpts.hotSwap=true] - Use hot-swap if available
   * @returns {Promise<object>} Update result
   */
  async function update(pluginName, updOpts) {
    if (!marketplace) {
      throw new Error("Plugin marketplace is not available.");
    }

    const uo = updOpts || {};
    const targetDir = uo.targetDir || installDir;
    const useHotSwap = uo.hotSwap !== false;

    // Check current version
    const current = getPluginInfo(pluginName);
    const oldVersion = current ? current.version : "0.0.0";
    const oldPlugin = current ? current.raw : null;

    // Fetch update from marketplace
    const result = marketplace.update(pluginName, targetDir);

    // If version changed and we have the new plugin, re-register
    if (result.updated && result.path) {
      try {
        delete require.cache[require.resolve(result.path)];
        const newPlugin = require(result.path);

        if (useHotSwap && hotSwap && oldPlugin) {
          // Hot-swap: atomically replace old with new
          await hotSwap.safeSwap(pluginName, newPlugin);
        } else {
          // Standard: unregister old, register new
          registry.unregister(pluginName);
          register(newPlugin);
        }
      } catch (err) {
        // Re-registration failed — the file was copied but registration failed
        throw new Error(`Plugin "${pluginName}" was downloaded but failed to re-register: ${err.message}`);
      }
    }

    return {
      ...result,
      oldVersion,
    };
  }

  // ── Enable / Disable ────────────────────────────────────────────────────

  /**
   * Disable a plugin (remove hooks but keep metadata).
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  function disablePlugin(pluginName) {
    const plugins = registry._plugins;
    const existing = plugins ? plugins.find((p) => p.name === pluginName) : null;

    if (!existing) {
      return _disabledPlugins.has(pluginName); // Already disabled
    }

    // Store for re-enable
    _disabledPlugins.set(pluginName, {
      name: existing.name,
      version: existing.version,
      hooks: existing.hooks ? Object.assign({}, existing.hooks) : {},
    });

    // Remove from registry
    registry.unregister(pluginName);

    return true;
  }

  /**
   * Enable a previously disabled plugin.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  function enablePlugin(pluginName) {
    if (!_disabledPlugins.has(pluginName)) {
      // Check if it's already registered
      const plugins = registry._plugins;
      const existing = plugins ? plugins.some((p) => p.name === pluginName) : false;
      return existing; // Already enabled
    }

    const plugin = _disabledPlugins.get(pluginName);
    _disabledPlugins.delete(pluginName);

    // Re-register
    try {
      register(plugin);
      return true;
    } catch (_err) {
      // Put back in disabled list on failure
      _disabledPlugins.set(pluginName, plugin);
      return false;
    }
  }

  // ── Search / List ───────────────────────────────────────────────────────

  /**
   * Search for plugins across marketplace and local index.
   *
   * @param {string} query
   * @param {object} [searchOpts]
   * @returns {Array<object>}
   */
  function search(query, searchOpts) {
    const results = [];

    // Search marketplace
    if (marketplace) {
      try {
        const mpResults = marketplace.search(query, searchOpts);
        results.push(...mpResults);
      } catch (_) { /* marketplace search best-effort */ }
    }

    // Search local index
    if (indexer) {
      try {
        const localResults = indexer.search(query);
        for (const entry of localResults) {
          // Avoid duplicates
          if (!results.some((r) => r.name === entry.name)) {
            results.push({
              name: entry.name,
              version: entry.version,
              description: entry.description,
              source: "local",
              hooks: entry.hooks || [],
              path: entry.path || null,
              rating: 0,
              installs: 0,
              validation: entry.validation || null,
              metadata: entry.metadata || null,
            });
          }
        }
      } catch (_) { /* local search best-effort */ }
    }

    return results;
  }

  /**
   * List all installed/registered plugins with their status.
   *
   * @returns {Array<object>}
   */
  function list() {
    const result = [];

    // Registered plugins
    const plugins = registry._plugins || [];
    for (const p of plugins) {
      result.push({
        name: p.name,
        version: p.version,
        hooks: p.hooks ? Object.keys(p.hooks) : [],
        status: "active",
        isolated: p.metadata && p.metadata.isolated ? true : false,
      });
    }

    // Disabled plugins
    for (const [name, p] of _disabledPlugins) {
      result.push({
        name,
        version: p.version || "0.0.0",
        hooks: p.hooks ? Object.keys(p.hooks) : [],
        status: "disabled",
        isolated: false,
      });
    }

    return result;
  }

  /**
   * Get detailed info about a specific plugin.
   *
   * @param {string} pluginName
   * @returns {object|null}
   */
  function getPluginInfo(pluginName) {
    // Check registry
    const plugins = registry._plugins || [];
    const registered = plugins.find((p) => p.name === pluginName);
    if (registered) {
      return {
        name: registered.name,
        version: registered.version,
        hooks: registered.hooks ? Object.keys(registered.hooks) : [],
        status: "active",
        isolated: registered.metadata && registered.metadata.isolated ? true : false,
        raw: registered,
        hotSwappable: registered.metadata && registered.metadata.hotSwappable === true,
      };
    }

    // Check disabled
    const disabled = _disabledPlugins.get(pluginName);
    if (disabled) {
      return {
        name: disabled.name,
        version: disabled.version || "0.0.0",
        hooks: disabled.hooks ? Object.keys(disabled.hooks) : [],
        status: "disabled",
        isolated: false,
        raw: disabled,
        hotSwappable: disabled.metadata && disabled.metadata.hotSwappable === true,
      };
    }

    // Check indexer
    if (indexer) {
      const indexed = indexer.get(pluginName);
      if (indexed) {
        return {
          name: indexed.name,
          version: indexed.version,
          description: indexed.description,
          hooks: indexed.hooks || [],
          status: "available",
          path: indexed.path,
          isolated: false,
          raw: null,
          hotSwappable: indexed.metadata && indexed.metadata.hotSwappable === true,
        };
      }
    }

    return null;
  }

  /**
   * Get stats from the isolation system.
   *
   * @param {string} [pluginName] - If omitted, returns stats for all plugins
   * @returns {object|null}
   */
  function getPluginStats(pluginName) {
    if (!isolator) return null;
    if (pluginName) {
      return isolator.getPluginStats(pluginName);
    }
    return isolator.getIsolateStats();
  }

  /**
   * Get the dependency graph's load order.
   *
   * @returns {Array<string>}
   */
  function getLoadOrder() {
    if (!depGraph) return [];
    try {
      return depGraph.loadOrder();
    } catch (_) {
      // Cycle detected or empty graph
      return [];
    }
  }

  /**
   * Get the hot-swap history.
   *
   * @returns {Array<object>}
   */
  function getSwapHistory() {
    if (!hotSwap) return [];
    return hotSwap.getSwapHistory();
  }

  /**
   * Initialize the marketplace (fetch indexes, scan directories).
   *
   * @returns {Promise<void>}
   */
  async function init() {
    if (marketplace && !marketplace._initialized) {
      await marketplace.init();
    }

    // Scan default plugins directory if provided
    if (pluginsDir) {
      scanDirectory(pluginsDir);
    }
  }

  // ── Initial scan ────────────────────────────────────────────────────────
  if (pluginsDir) {
    try {
      scanDirectory(pluginsDir);
    } catch (_) { /* initial scan is best-effort */ }
  }

  // ── Return the public API ───────────────────────────────────────────────
  return {
    // Core
    registry,
    register,
    registerFromFile,
    scanDirectory,
    init,

    // Lifecycle
    install,
    uninstall,
    update,
    enablePlugin,
    disablePlugin,

    // Query
    search,
    list,
    getPluginInfo,
    getPluginStats,
    getLoadOrder,
    getSwapHistory,

    // Ecosystem access (for advanced usage)
    indexer,
    hotSwap,
    isolator,
    depGraph,
    repository,
    marketplace,

    // Run a hook on all plugins
    runHook: (hookName, context) => registry.runHook(hookName, context),

    // Delegate raw registry methods
    unregister: (name) => registry.unregister(name),

    // Disabled plugins (for inspection)
    get disabledPlugins() {
      return new Map(_disabledPlugins);
    },

    // Stats
    getStats: () => ({
      totalRegistered: registry._plugins ? registry._plugins.length : 0,
      totalDisabled: _disabledPlugins.size,
      totalHooks: registry.getHookCount(),
      loadOrder: getLoadOrder(),
      swapHistoryCount: hotSwap ? hotSwap.getSwapHistory().length : 0,
      marketplaceInitialized: marketplace ? marketplace._initialized : false,
    }),
  };
}

module.exports = { createPluginManager };
