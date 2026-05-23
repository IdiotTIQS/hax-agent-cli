"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PluginIndex } = require("./indexer");

/**
 * PluginRepository — Manages remote plugin sources and installation.
 *
 * Supports two source types:
 *   - "local"  — a directory on the local filesystem containing plugin .js files
 *   - "git"    — a git repository URL (stub — does not actually clone)
 *
 *   const repo = new PluginRepository();
 *   repo.addSource("community", "./community-plugins", "local");
 *   repo.fetchIndex("community");
 *   repo.install("logger-plugin", "./installed");
 */
class PluginRepository {
  constructor() {
    /** @type {Map<string, { name: string, url: string, type: string }>} */
    this._sources = new Map();

    /** @type {Map<string, PluginIndex>} source name → PluginIndex */
    this._caches = new Map();
  }

  // -------------------------------------------------------------------------
  // Source management
  // -------------------------------------------------------------------------

  /**
   * Add a plugin source.
   *
   * @param {string} name    Unique name for this source
   * @param {string} url     Directory path (local) or git URL (git)
   * @param {string} type    "local" or "git"
   */
  addSource(name, url, type) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Source name is required");
    }
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("Source URL is required");
    }
    if (type !== "local" && type !== "git") {
      throw new Error(`Unsupported source type "${type}". Use "local" or "git".`);
    }

    this._sources.set(name, { name, url, type });
    this._caches.delete(name); // Invalidate cache
  }

  /**
   * Remove a source by name.
   *
   * @param {string} name
   * @returns {boolean}
   */
  removeSource(name) {
    this._caches.delete(name);
    return this._sources.delete(name);
  }

  /**
   * List all configured sources.
   *
   * @returns {Array<object>}
   */
  listSources() {
    return Array.from(this._sources.values()).map((s) => ({
      name: s.name,
      url: s.url,
      type: s.type,
    }));
  }

  /**
   * Get a single source by name.
   */
  getSource(name) {
    return this._sources.get(name) || null;
  }

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  /**
   * Fetch (build) a plugin index from a named source.
   *
   * For "local" sources this scans the directory tree.
   * For "git" sources this returns an empty index (stub).
   *
   * @param {string} sourceName
   * @returns {PluginIndex}
   */
  fetchIndex(sourceName) {
    const source = this._sources.get(sourceName);
    if (!source) {
      throw new Error(`Unknown source: ${sourceName}`);
    }

    const index = new PluginIndex();

    if (source.type === "local") {
      const resolved = path.resolve(source.url);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Local source directory not found: ${resolved}`);
      }
      index.scan(resolved);
    } else if (source.type === "git") {
      // Git stub — no actual cloning.  An empty index is returned.
      // Integrators can subclass or monkey-patch to add real git support.
    }

    this._caches.set(sourceName, index);
    return index;
  }

  /**
   * Get the cached index for a source, or fetch it if not cached.
   *
   * @param {string} sourceName
   * @returns {PluginIndex}
   */
  getIndex(sourceName) {
    if (this._caches.has(sourceName)) {
      return this._caches.get(sourceName);
    }
    return this.fetchIndex(sourceName);
  }

  // -------------------------------------------------------------------------
  // Search & list
  // -------------------------------------------------------------------------

  /**
   * Search for plugins across all remote sources.
   *
   * @param {string} query
   * @returns {Array<{ plugin: object, source: string }>}
   */
  searchRemote(query) {
    const results = [];

    for (const sourceName of this._sources.keys()) {
      const index = this.getIndex(sourceName);
      const matches = index.search(query);
      for (const plugin of matches) {
        results.push({ plugin, source: sourceName });
      }
    }

    return results;
  }

  /**
   * List all available plugins from remote sources.
   *
   * @returns {Array<{ plugin: object, source: string }>}
   */
  listRemote() {
    const results = [];

    for (const sourceName of this._sources.keys()) {
      const index = this.getIndex(sourceName);
      for (const plugin of index.list()) {
        results.push({ plugin, source: sourceName });
      }
    }

    return results;
  }

  /**
   * Search for a specific plugin by name across all sources.
   *
   * @param {string} pluginName
   * @returns {Array<{ plugin: object, source: string }>}
   */
  findByName(pluginName) {
    const results = [];

    for (const sourceName of this._sources.keys()) {
      const index = this.getIndex(sourceName);
      const found = index.get(pluginName);
      if (found) {
        results.push({ plugin: found, source: sourceName });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Install & update
  // -------------------------------------------------------------------------

  /**
   * Install a plugin from a remote source to a target directory.
   *
   * Copies the plugin .js file into targetDir, preserving the filename.
   * Returns the installed file path.
   *
   * @param {string} pluginName
   * @param {string} targetDir   Where to copy the plugin file
   * @param {string} [sourceName]  Optional — auto-discovers if omitted
   * @returns {string}  Path to the installed file
   */
  install(pluginName, targetDir, sourceName) {
    const sources = sourceName
      ? [{ name: sourceName }]
      : Array.from(this._sources.keys()).map((n) => ({ name: n }));

    let foundEntry = null;
    let foundSource = null;

    for (const { name } of sources) {
      const index = this.getIndex(name);
      const entry = index.get(pluginName);
      if (entry && entry.path) {
        foundEntry = entry;
        foundSource = name;
        break;
      }
    }

    if (!foundEntry) {
      throw new Error(`Plugin "${pluginName}" not found in any source`);
    }

    const source = this._sources.get(foundSource);
    if (!source) {
      throw new Error(`Source "${foundSource}" not found`);
    }

    // For local sources, copy the file
    if (source.type === "local") {
      const srcPath = foundEntry.path;
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Plugin file not found at source: ${srcPath}`);
      }

      const resolvedTarget = path.resolve(targetDir);
      fs.mkdirSync(resolvedTarget, { recursive: true });

      const destPath = path.join(resolvedTarget, path.basename(srcPath));
      fs.copyFileSync(srcPath, destPath);
      return destPath;
    }

    // Git source — stub
    if (source.type === "git") {
      throw new Error(
        `Cannot install from git source "${foundSource}" — git clone is not implemented (stub). ` +
          `Integrate a git client to enable this feature.`,
      );
    }

    throw new Error(`Cannot install from source type: ${source.type}`);
  }

  /**
   * Update a plugin to the latest version from its source.
   *
   * For local sources this re-copies the file from the source to the
   * target directory.  For git sources this is a stub.
   *
   * @param {string} pluginName
   * @param {string} targetDir
   * @param {string} [sourceName]
   * @returns {{ path: string, previousVersion: string, newVersion: string }}
   */
  update(pluginName, targetDir, sourceName) {
    const resolvedTarget = path.resolve(targetDir);
    const targetFile = path.join(resolvedTarget, `${pluginName}.js`);

    let previousVersion = null;
    let previousPath = null;

    // Try to find existing installed version
    const altFiles = [targetFile];
    try {
      const entries = fs.readdirSync(resolvedTarget, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".js")) {
          const full = path.join(resolvedTarget, entry.name);
          if (full !== targetFile) {
            altFiles.push(full);
          }
        }
      }
    } catch (_er) {
      // Directory may not exist yet — that's fine
    }

    for (const f of altFiles) {
      if (fs.existsSync(f)) {
        try {
          delete require.cache[require.resolve(f)];
          const installed = require(f);
          if (installed && installed.name === pluginName) {
            previousVersion = installed.version || "0.0.0";
            previousPath = f;
            break;
          }
        } catch (_err) {
          // Not a valid plugin file, skip
        }
      }
    }

    // Install (copy) the latest from source
    const destPath = this.install(pluginName, targetDir, sourceName);

    // Read newly installed version
    let newVersion = null;
    try {
      // Clear require cache so we get the freshly-copied version
      delete require.cache[require.resolve(destPath)];
      const fresh = require(destPath);
      newVersion = fresh.version || "0.0.0";
    } catch (_err) {
      newVersion = "unknown";
    }

    return {
      path: destPath,
      previousVersion: previousVersion || "none",
      newVersion,
    };
  }
}

module.exports = { PluginRepository };
