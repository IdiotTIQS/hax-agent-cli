"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PluginIndex } = require("../plugins/indexer");
const { PluginRepository } = require("../plugins/repository");

// Known task → plugin hook/tag mapping for recommendations
const TASK_KEYWORDS = {
  logging: ["beforeToolCall", "afterToolCall", "onError"],
  error: ["onError"],
  monitoring: ["beforeToolCall", "afterToolCall", "onError"],
  security: ["beforeToolCall", "onError"],
  testing: ["beforeToolCall", "afterToolCall"],
  debugging: ["beforeToolCall", "afterToolCall", "onError"],
  deployment: ["onSessionStart", "onSessionEnd"],
  format: ["beforeChat", "afterChat"],
  lint: ["beforeChat", "afterChat"],
  session: ["onSessionStart", "onSessionEnd"],
  startup: ["onSessionStart"],
  shutdown: ["onSessionEnd"],
};

/**
 * PluginMarketplace — Unified plugin marketplace that aggregates plugins
 * from local indexes, community repositories, and the official registry.
 *
 *   const mp = new PluginMarketplace({ localDir: "./my-plugins" });
 *   await mp.init();
 *   const results = mp.search("logger");
 *   mp.install("my-plugin", "./installed");
 *   mp.getTrending();
 *   mp.getRecommended("debugging tool calls");
 */
class PluginMarketplace {
  /**
   * @param {object} [opts]
   * @param {string} [opts.localDir]      - Directory to scan for local plugins
   * @param {string} [opts.installedDir]  - Where plugins get installed (default: opts.localDir)
   * @param {Array<{ name: string, url: string, type: string }>} [opts.sources] - Extra repository sources
   */
  constructor(opts) {
    const options = opts || {};

    /** Local plugin index (PluginIndex) */
    this._localIndex = new PluginIndex();

    /** Repository aggregator (PluginRepository) */
    this._repository = new PluginRepository();

    /** Official registry index (PluginIndex) */
    this._officialIndex = new PluginIndex();

    /** @type {string} Directory where plugins are installed */
    this._installDir = options.installedDir || options.localDir || null;

    /** @type {Map<string, { installedAt: string, source: string, version: string }>} */
    this._installed = new Map();

    /** @type {Map<string, number>} plugin name → install count (trending tracking) */
    this._installCounts = new Map();

    /** @type {Map<string, number>} plugin name → rating sum */
    this._ratingSums = new Map();

    /** @type {Map<string, number>} plugin name → rating count */
    this._ratingCounts = new Map();

    /** @type {boolean} */
    this._initialized = false;

    // Register official registry as a source if provided
    if (options.localDir) {
      const resolved = path.resolve(options.localDir);
      if (fs.existsSync(resolved)) {
        this._localIndex.scan(resolved);
      }
    }

    // Register extra sources
    if (Array.isArray(options.sources)) {
      for (const src of options.sources) {
        this._repository.addSource(src.name, src.url, src.type);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Initialise the marketplace: fetch remote indexes and scan local dir.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;

    // Fetch all repository sources
    const sources = this._repository.listSources();
    for (const source of sources) {
      try {
        this._repository.fetchIndex(source.name);
      } catch (_err) {
        // Source fetch errors are non-fatal
      }
    }

    // Load install tracking from disk if available
    if (this._installDir) {
      this._loadInstallState();
    }

    this._initialized = true;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Search for plugins across all sources: local index, community repos,
   * and the official registry.
   *
   * @param {string} query - Case-insensitive search string
   * @param {object} [opts]
   * @param {number} [opts.limit]         - Max results
   * @param {string} [opts.source]        - Restrict to one source ("local"|"community"|"official")
   * @param {Array<string>} [opts.hooks]  - Filter by required hook names
   * @returns {Array<object>} Results with { name, version, description, source, hooks, path, rating }
   */
  search(query, opts) {
    const options = opts || {};
    const results = [];
    const seen = new Set();

    // Empty query: return all plugins (list mode)
    const isListMode = !query || typeof query !== "string" || !query.trim();

    const addResults = (entries, sourceLabel) => {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = entry.name || (entry.plugin && entry.plugin.name);
        if (!name || seen.has(`${sourceLabel}:${name}`)) continue;

        const plugin = entry.plugin || entry;
        seen.add(`${sourceLabel}:${name}`);

        // Apply hook filter
        if (options.hooks && options.hooks.length > 0) {
          const pluginHooks = plugin.hooks || [];
          const hasAllHooks = options.hooks.every((h) => pluginHooks.includes(h));
          if (!hasAllHooks) continue;
        }

        results.push({
          name: plugin.name,
          version: plugin.version || "0.0.0",
          description: plugin.description || "",
          source: sourceLabel,
          hooks: plugin.hooks || [],
          path: plugin.path || null,
          rating: this.getRating(plugin.name),
          installs: this._installCounts.get(plugin.name) || 0,
          validation: plugin.validation || null,
          metadata: plugin.metadata || null,
        });
      }
    };

    // 1. Local index
    if (!options.source || options.source === "local") {
      const localMatches = isListMode
        ? this._localIndex.list().map((e) => ({ plugin: e }))
        : this._localIndex.search(query).map((e) => ({ plugin: e }));
      addResults(localMatches, "local");
    }

    // 2. Community repository
    if (!options.source || options.source === "community") {
      const communityMatches = isListMode
        ? this._repository.listRemote()
        : this._repository.searchRemote(query);
      for (const match of communityMatches) {
        addResults([match], `community:${match.source}`);
      }
    }

    // 3. Official registry
    if (!options.source || options.source === "official") {
      const officialMatches = isListMode
        ? this._officialIndex.list().map((e) => ({ plugin: e }))
        : this._officialIndex.search(query).map((e) => ({ plugin: e }));
      addResults(officialMatches, "official");
    }

    // Sort: name match boosts score, then rating, then installs, then name
    const q = (query || "").trim().toLowerCase();
    results.sort((a, b) => {
      const aNameMatch = q && a.name.toLowerCase().includes(q) ? 1 : 0;
      const bNameMatch = q && b.name.toLowerCase().includes(q) ? 1 : 0;
      if (aNameMatch !== bNameMatch) return bNameMatch - aNameMatch;
      if (a.rating !== b.rating) return b.rating - a.rating;
      if (b.installs !== a.installs) return b.installs - a.installs;
      return a.name.localeCompare(b.name);
    });

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Install
  // -------------------------------------------------------------------------

  /**
   * One-click install: searches all sources, downloads (copies) the plugin
   * file to the target directory, and tracks the installation.
   *
   * @param {string} pluginName - Name of the plugin to install
   * @param {string} [targetDir] - Directory to install into (defaults to _installDir)
   * @param {string} [sourceName] - Specific repository source to use
   * @returns {{ path: string, name: string, version: string, source: string }}
   */
  install(pluginName, targetDir, sourceName) {
    if (!pluginName || typeof pluginName !== "string" || !pluginName.trim()) {
      throw new Error("Plugin name is required");
    }

    const resolvedTarget = targetDir
      ? path.resolve(targetDir)
      : this._installDir
        ? path.resolve(this._installDir)
        : null;

    if (!resolvedTarget) {
      throw new Error("No target directory specified and no default install directory configured");
    }

    // Search across all sources for this plugin
    const candidates = [];

    // Local
    const localEntry = this._localIndex.get(pluginName);
    if (localEntry) {
      candidates.push({ entry: localEntry, source: "local", priority: 1 });
    }

    // Repository
    const repoMatches = this._repository.findByName(pluginName);
    for (const match of repoMatches) {
      candidates.push({
        entry: match.plugin,
        source: `community:${match.source}`,
        priority: 2,
      });
    }

    // Official
    const officialEntry = this._officialIndex.get(pluginName);
    if (officialEntry) {
      candidates.push({ entry: officialEntry, source: "official", priority: 3 });
    }

    if (candidates.length === 0) {
      throw new Error(`Plugin "${pluginName}" not found in any source`);
    }

    // If sourceName is specified, filter
    let selected = candidates[0];
    if (sourceName) {
      const filtered = candidates.filter(
        (c) => c.source === sourceName || c.source.endsWith(`:${sourceName}`),
      );
      if (filtered.length === 0) {
        throw new Error(`Plugin "${pluginName}" not found in source "${sourceName}"`);
      }
      selected = filtered[0];
    }

    // Perform the install
    let destPath;
    const srcPath = selected.entry.path;

    if (srcPath && fs.existsSync(srcPath)) {
      fs.mkdirSync(resolvedTarget, { recursive: true });

      // Try to find existing installed version to determine filename
      const existingFiles = this._findInstalledFiles(resolvedTarget, pluginName);
      let fileName;
      if (existingFiles.length > 0) {
        fileName = path.basename(existingFiles[0]);
      } else {
        fileName = `${pluginName}.js`;
      }

      destPath = path.join(resolvedTarget, fileName);
      fs.copyFileSync(srcPath, destPath);
    } else if (selected.source === "local") {
      // Local index entry without a valid path — suggest scanning
      throw new Error(
        `Plugin "${pluginName}" found in local index but source file is missing. ` +
          `Re-scan the local directory to update the index.`,
      );
    } else {
      throw new Error(
        `Plugin "${pluginName}" found in source "${selected.source}" but ` +
          `no downloadable file is available.`,
      );
    }

    // Read version from installed file
    let version = "0.0.0";
    try {
      delete require.cache[require.resolve(destPath)];
      const installed = require(destPath);
      version = installed.version || "0.0.0";
    } catch (_err) {
      // Use default version
    }

    // Track installation
    this._installed.set(pluginName, {
      installedAt: new Date().toISOString(),
      source: selected.source,
      version,
    });

    // Bump install count
    this._installCounts.set(pluginName, (this._installCounts.get(pluginName) || 0) + 1);

    // Persist state
    this._saveInstallState();

    return {
      path: destPath,
      name: pluginName,
      version,
      source: selected.source,
    };
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Check for and apply updates to an installed plugin.
   *
   * @param {string} pluginName - Name of the plugin to update
   * @param {string} [targetDir] - Directory where the plugin is installed
   * @returns {{ updated: boolean, path: string, previousVersion: string, newVersion: string, source: string }}
   */
  update(pluginName, targetDir) {
    if (!pluginName || typeof pluginName !== "string" || !pluginName.trim()) {
      throw new Error("Plugin name is required");
    }

    const installedInfo = this._installed.get(pluginName);
    const resolvedTarget = targetDir
      ? path.resolve(targetDir)
      : this._installDir
        ? path.resolve(this._installDir)
        : null;

    if (!resolvedTarget) {
      throw new Error("No target directory specified");
    }

    // Find the installed file
    const installedFiles = this._findInstalledFiles(resolvedTarget, pluginName);

    let previousVersion = "0.0.0";
    let installedPath = null;

    if (installedFiles.length > 0) {
      installedPath = installedFiles[0];
      try {
        delete require.cache[require.resolve(installedPath)];
        const mod = require(installedPath);
        previousVersion = mod.version || "0.0.0";
      } catch (_err) {
        // Use default version
      }
    }

    // Try to install from the original source
    let sourceName = null;
    if (installedInfo && installedInfo.source) {
      // Check if it's a community source
      const parts = installedInfo.source.split(":");
      if (parts.length > 1 && parts[0] === "community") {
        sourceName = parts[1];
      }
    }

    let result;
    try {
      result = this.install(pluginName, resolvedTarget, sourceName);
    } catch (err) {
      throw new Error(`Update failed for "${pluginName}": ${err.message}`);
    }

    return {
      updated: result.version !== previousVersion,
      path: result.path,
      previousVersion,
      newVersion: result.version,
      source: result.source,
    };
  }

  // -------------------------------------------------------------------------
  // Uninstall
  // -------------------------------------------------------------------------

  /**
   * Cleanly remove an installed plugin: deletes the file and untracks it.
   *
   * @param {string} pluginName - Name of the plugin to uninstall
   * @param {string} [targetDir] - Directory where the plugin is installed
   * @returns {{ removed: boolean, filesDeleted: Array<string> }}
   */
  uninstall(pluginName, targetDir) {
    if (!pluginName || typeof pluginName !== "string" || !pluginName.trim()) {
      throw new Error("Plugin name is required");
    }

    const resolvedTarget = targetDir
      ? path.resolve(targetDir)
      : this._installDir
        ? path.resolve(this._installDir)
        : null;

    if (!resolvedTarget) {
      throw new Error("No target directory specified");
    }

    const installedFiles = this._findInstalledFiles(resolvedTarget, pluginName);
    const deletedFiles = [];

    for (const filePath of installedFiles) {
      try {
        // Clear require cache
        delete require.cache[require.resolve(filePath)];
        fs.unlinkSync(filePath);
        deletedFiles.push(filePath);
      } catch (err) {
        throw new Error(`Failed to delete "${filePath}": ${err.message}`);
      }
    }

    // Remove from tracking
    this._installed.delete(pluginName);

    // Persist state
    this._saveInstallState();

    return {
      removed: deletedFiles.length > 0,
      filesDeleted: deletedFiles,
    };
  }

  // -------------------------------------------------------------------------
  // Trending
  // -------------------------------------------------------------------------

  /**
   * Get the most popular plugins, ranked by install count and rating.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit=10]  - Max results
   * @param {string} [opts.period]    - "all" | "week" | "month" (default "all")
   * @returns {Array<object>}
   */
  getTrending(opts) {
    const options = Object.assign({ limit: 10, period: "all" }, opts || {});
    const all = this.search("", { limit: 0 });

    // If we have install counts, use those for ranking
    if (this._installCounts.size > 0) {
      // Merge install counts into results
      for (const plugin of all) {
        plugin.installs = this._installCounts.get(plugin.name) || 0;
      }
    }

    // Sort: weighted score of rating + installs
    all.sort((a, b) => {
      const aScore = (a.rating || 0) * 10 + Math.log2((a.installs || 0) + 1);
      const bScore = (b.rating || 0) * 10 + Math.log2((b.installs || 0) + 1);
      return bScore - aScore;
    });

    // Period filtering: for week/month, check installedAt
    if (options.period === "week" || options.period === "month") {
      const now = Date.now();
      const cutoff =
        options.period === "week"
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;

      const filtered = all.filter((plugin) => {
        const info = this._installed.get(plugin.name);
        if (!info) return false;
        return new Date(info.installedAt).getTime() >= cutoff;
      });

      return filtered.slice(0, options.limit);
    }

    return all.slice(0, options.limit);
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  /**
   * Get plugins recommended for a specific task description.
   *
   * Analyses the task text to identify relevant hook patterns, then returns
   * plugins that implement those hooks, ranked by quality signals.
   *
   * @param {string} task - Description of the task (e.g., "debug tool calls")
   * @param {object} [opts]
   * @param {number} [opts.limit=5] - Max results
   * @returns {Array<object>}
   */
  getRecommended(task, opts) {
    const options = Object.assign({ limit: 5 }, opts || {});

    if (!task || typeof task !== "string" || !task.trim()) {
      return this.getTrending({ limit: options.limit });
    }

    const taskLower = task.toLowerCase();
    const relevantHooks = new Set();

    // Match task keywords to relevant hooks
    for (const [keyword, hooks] of Object.entries(TASK_KEYWORDS)) {
      if (taskLower.includes(keyword)) {
        for (const hook of hooks) {
          relevantHooks.add(hook);
        }
      }
    }

    // If no keyword matched, search by task description directly
    if (relevantHooks.size === 0) {
      // Fall back to a full text search
      const results = this.search(task, { limit: 0 });
      // Boost plugins with more hooks
      results.sort((a, b) => (b.hooks.length || 0) - (a.hooks.length || 0));
      return results.slice(0, options.limit);
    }

    const hookNames = Array.from(relevantHooks);

    // Fetch all plugins, then rank by how many relevant hooks they implement
    const all = this.search("", { limit: 0 });

    // Score: number of matching relevant hooks + rating bonus
    const scored = all
      .filter((plugin) => {
        // Must match at least one relevant hook
        return (plugin.hooks || []).some((h) => relevantHooks.has(h));
      })
      .map((plugin) => {
        const matchCount = (plugin.hooks || []).filter((h) => relevantHooks.has(h)).length;
        return {
          ...plugin,
          relevanceScore: matchCount * 2 + (plugin.rating || 0) * 0.5,
        };
      });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, options.limit);
  }

  // -------------------------------------------------------------------------
  // Ratings
  // -------------------------------------------------------------------------

  /**
   * Rate a plugin.
   *
   * @param {string} pluginName
   * @param {number} rating - 0 to 5
   */
  rate(pluginName, rating) {
    if (typeof rating !== "number" || rating < 0 || rating > 5) {
      throw new Error("Rating must be a number between 0 and 5");
    }
    const currentSum = this._ratingSums.get(pluginName) || 0;
    const currentCount = this._ratingCounts.get(pluginName) || 0;
    this._ratingSums.set(pluginName, currentSum + rating);
    this._ratingCounts.set(pluginName, currentCount + 1);
  }

  /**
   * Get the average rating of a plugin.
   *
   * @param {string} pluginName
   * @returns {number} 0-5 scale
   */
  getRating(pluginName) {
    const count = this._ratingCounts.get(pluginName);
    if (!count || count === 0) return 0;
    const sum = this._ratingSums.get(pluginName) || 0;
    return Math.round((sum / count) * 10) / 10;
  }

  // -------------------------------------------------------------------------
  // Registry management
  // -------------------------------------------------------------------------

  /**
   * Publish a plugin to the official registry index.
   *
   * @param {object} plugin - Plugin metadata entry
   */
  registerOfficial(plugin) {
    if (!plugin || typeof plugin.name !== "string") {
      throw new Error("Plugin must have a valid name");
    }

    const entry = {
      name: plugin.name,
      version: plugin.version || "0.0.0",
      description: plugin.description || "",
      hooks: plugin.hooks || [],
      path: plugin.path || null,
      metadata: plugin.metadata || null,
      validation: plugin.validation || { valid: true, errorCount: 0, warningCount: 0 },
    };

    this._officialIndex._plugins.set(entry.name, entry);
  }

  /**
   * Remove a plugin from the official registry.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  unregisterOfficial(pluginName) {
    return this._officialIndex.remove(pluginName);
  }

  // -------------------------------------------------------------------------
  // Source management
  // -------------------------------------------------------------------------

  /**
   * Add a community repository source.
   *
   * @param {string} name
   * @param {string} url
   * @param {string} type - "local" | "git"
   */
  addSource(name, url, type) {
    this._repository.addSource(name, url, type);
  }

  /**
   * Remove a community repository source.
   *
   * @param {string} name
   * @returns {boolean}
   */
  removeSource(name) {
    return this._repository.removeSource(name);
  }

  /**
   * List all configured sources.
   *
   * @returns {Array<object>}
   */
  listSources() {
    return this._repository.listSources();
  }

  /**
   * Scan a local directory for plugins and add them to the local index.
   *
   * @param {string} directory
   * @returns {number}
   */
  scanLocal(directory) {
    return this._localIndex.scan(directory);
  }

  // -------------------------------------------------------------------------
  // Installed plugins
  // -------------------------------------------------------------------------

  /**
   * List all installed plugins.
   *
   * @returns {Array<object>}
   */
  listInstalled() {
    const result = [];
    for (const [name, info] of this._installed) {
      result.push({
        name,
        version: info.version,
        source: info.source,
        installedAt: info.installedAt,
      });
    }
    return result;
  }

  /**
   * Check if a plugin is installed.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  isInstalled(pluginName) {
    return this._installed.has(pluginName);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Get marketplace-wide statistics.
   *
   * @returns {{ totalAvailable: number, totalInstalled: number, totalSources: number,
   *             topInstalled: Array, avgRating: number }}
   */
  getStats() {
    const totalAvailable =
      this._localIndex.size +
      this._officialIndex.size +
      this._repository.listRemote().length;

    const ratings = [];
    for (const name of this._ratingCounts.keys()) {
      ratings.push(this.getRating(name));
    }

    const avgRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : 0;

    // Top installed
    const topInstalled = Array.from(this._installCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, installs: count }));

    return {
      totalAvailable,
      totalInstalled: this._installed.size,
      totalSources: this._repository.listSources().length,
      topInstalled,
      avgRating,
    };
  }

  /**
   * Check if the marketplace has been initialised.
   *
   * @returns {boolean}
   */
  get initialized() {
    return this._initialized;
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  /**
   * @returns {string} Path to the install state JSON file
   */
  _stateFilePath() {
    return path.join(this._installDir, ".marketplace-state.json");
  }

  _saveInstallState() {
    if (!this._installDir) return;

    try {
      const dir = path.resolve(this._installDir);
      fs.mkdirSync(dir, { recursive: true });

      const state = {
        installed: Object.fromEntries(this._installed),
        installCounts: Object.fromEntries(this._installCounts),
        ratingSums: Object.fromEntries(this._ratingSums),
        ratingCounts: Object.fromEntries(this._ratingCounts),
      };

      fs.writeFileSync(this._stateFilePath(), JSON.stringify(state, null, 2), "utf8");
    } catch (_err) {
      // State save is best-effort
    }
  }

  _loadInstallState() {
    if (!this._installDir) return;

    try {
      const statePath = this._stateFilePath();
      if (!fs.existsSync(statePath)) return;

      const raw = fs.readFileSync(statePath, "utf8");
      const state = JSON.parse(raw);

      if (state.installed && typeof state.installed === "object") {
        for (const [name, info] of Object.entries(state.installed)) {
          this._installed.set(name, info);
        }
      }

      if (state.installCounts && typeof state.installCounts === "object") {
        for (const [name, count] of Object.entries(state.installCounts)) {
          if (typeof count === "number") {
            this._installCounts.set(name, count);
          }
        }
      }

      if (state.ratingSums && typeof state.ratingSums === "object") {
        for (const [name, sum] of Object.entries(state.ratingSums)) {
          if (typeof sum === "number") {
            this._ratingSums.set(name, sum);
          }
        }
      }

      if (state.ratingCounts && typeof state.ratingCounts === "object") {
        for (const [name, count] of Object.entries(state.ratingCounts)) {
          if (typeof count === "number") {
            this._ratingCounts.set(name, count);
          }
        }
      }
    } catch (_err) {
      // State load is best-effort
    }
  }

  /**
   * Find files in a directory that export a plugin with the given name.
   *
   * @param {string} dir
   * @param {string} pluginName
   * @returns {Array<string>}
   */
  _findInstalledFiles(dir, pluginName) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".js")) {
          const fullPath = path.join(dir, entry.name);
          try {
            delete require.cache[require.resolve(fullPath)];
            const mod = require(fullPath);
            if (mod && mod.name === pluginName) {
              results.push(fullPath);
            }
          } catch (_err) {
            // Skip files that fail to load
          }
        }
      }
    } catch (_err) {
      // Directory read errors are non-fatal
    }

    return results;
  }
}

const { MarketplaceCurator, QUALITY_WEIGHTS, SECURITY_PATTERNS, QUALITY_PATTERNS } = require('./curation');

module.exports = { PluginMarketplace, MarketplaceCurator, TASK_KEYWORDS, QUALITY_WEIGHTS, SECURITY_PATTERNS, QUALITY_PATTERNS };
