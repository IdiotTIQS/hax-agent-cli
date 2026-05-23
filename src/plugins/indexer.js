"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PLUGIN_HOOK_NAMES } = require("../plugins");
const { validatePlugin } = require("../plugin-validator");

/**
 * PluginIndex — Discovers, indexes, and searches HaxAgent plugins across
 * directory trees.  Supports serialisation to/from JSON so that an index
 * snapshot can be shared or cached without re-scanning every file.
 *
 *   const indexer = new PluginIndex();
 *   indexer.scan("./my-plugins");
 *   console.log(indexer.list());
 *   const json = indexer.toJSON();
 *   const clone = PluginIndex.fromJSON(json);
 */
class PluginIndex {
  constructor() {
    /** @type {Map<string, object>} plugin name → metadata */
    this._plugins = new Map();
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  /**
   * Recursively scan a directory tree for plugin (.js) files and index them.
   *
   * @param {string} directory  Absolute or relative path
   * @param {object} [opts]
   * @param {boolean} [opts.recursive=true]
   * @returns {number}  Number of plugins successfully indexed
   */
  scan(directory, opts) {
    const options = Object.assign({ recursive: true }, opts || {});
    const resolved = path.resolve(directory);

    if (!fs.existsSync(resolved)) {
      return 0;
    }

    if (!fs.statSync(resolved).isDirectory()) {
      return 0;
    }

    let count = 0;
    const entries = fs.readdirSync(resolved, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(resolved, entry.name);

      if (entry.isDirectory() && options.recursive) {
        count += this.scan(fullPath, options);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        try {
          this.index(fullPath);
          count += 1;
        } catch (_err) {
          // Silently skip files that fail to load (e.g. non-plugin .js)
        }
      }
    }

    return count;
  }

  /**
   * Index a single plugin file, extracting its metadata.
   *
   * @param {string} pluginPath  Absolute path to the .js plugin file
   * @returns {object}  The indexed metadata entry
   */
  index(pluginPath) {
    const resolved = path.resolve(pluginPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Plugin file not found: ${resolved}`);
    }

    // Clear cache so we always get a fresh read
    delete require.cache[require.resolve(resolved)];
    const plugin = require(resolved);

    if (!plugin || typeof plugin !== "object") {
      throw new Error(`File does not export a valid plugin object: ${resolved}`);
    }

    if (typeof plugin.name !== "string" || !plugin.name.trim()) {
      throw new Error(`Plugin at ${resolved} has no valid "name" field`);
    }

    const validation = validatePlugin(plugin);

    const entry = {
      name: plugin.name,
      version: plugin.version || "0.0.0",
      hooks: plugin.hooks ? Object.keys(plugin.hooks).filter((h) => PLUGIN_HOOK_NAMES.includes(h)) : [],
      description: typeof plugin.description === "string" ? plugin.description : "",
      path: resolved,
      validation: {
        valid: validation.valid,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
      },
    };

    // Optional metadata
    if (plugin.metadata && typeof plugin.metadata === "object" && !Array.isArray(plugin.metadata)) {
      entry.metadata = plugin.metadata;
    }

    this._plugins.set(entry.name, entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Search the index by name, description text, or hook names.
   *
   * @param {string} query  Case-insensitive search string
   * @returns {Array<object>}  Matching plugin entries, ranked (name match first)
   */
  search(query) {
    if (!query || typeof query !== "string" || !query.trim()) {
      return [];
    }

    const q = query.trim().toLowerCase();
    const results = [];

    for (const entry of this._plugins.values()) {
      const nameMatch = entry.name.toLowerCase().includes(q);
      const descMatch = entry.description.toLowerCase().includes(q);
      const hookMatch = entry.hooks.some((h) => h.toLowerCase().includes(q));

      if (nameMatch || descMatch || hookMatch) {
        results.push({
          entry,
          score: (nameMatch ? 3 : 0) + (descMatch ? 2 : 0) + (hookMatch ? 1 : 0),
        });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return results.map((r) => Object.assign({}, r.entry));
  }

  /**
   * Return all indexed plugins with their metadata.
   *
   * @returns {Array<object>}
   */
  list() {
    return Array.from(this._plugins.values());
  }

  /**
   * Find all indexed plugins that provide at least one of the named hooks.
   *
   * @param {string|Array<string>} hookNames  Hook name(s) to match
   * @returns {Array<object>}
   */
  getCompatible(hookNames) {
    const names = Array.isArray(hookNames) ? hookNames : [hookNames];
    const set = new Set(names);

    const results = [];
    for (const entry of this._plugins.values()) {
      if (entry.hooks.some((h) => set.has(h))) {
        results.push(Object.assign({}, entry));
      }
    }

    return results;
  }

  /**
   * Get a single plugin by name, or undefined if not found.
   *
   * @param {string} name
   * @returns {object|undefined}
   */
  get(name) {
    return this._plugins.get(name);
  }

  /**
   * Remove a plugin from the index by name.
   *
   * @param {string} name
   * @returns {boolean}
   */
  remove(name) {
    return this._plugins.delete(name);
  }

  /**
   * Number of plugins currently indexed.
   */
  get size() {
    return this._plugins.size;
  }

  // -------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------

  /**
   * Serialize the index to a plain object (suitable for JSON.stringify).
   *
   * @returns {object}
   */
  toJSON() {
    const plugins = {};
    for (const [name, entry] of this._plugins) {
      plugins[name] = Object.assign({}, entry);
    }
    return { plugins, count: this._plugins.size };
  }

  /**
   * Create a PluginIndex from a previously serialised JSON snapshot.
   *
   * @param {object} json
   * @returns {PluginIndex}
   */
  static fromJSON(json) {
    const index = new PluginIndex();
    if (json && json.plugins && typeof json.plugins === "object") {
      for (const [, entry] of Object.entries(json.plugins)) {
        if (entry && entry.name) {
          index._plugins.set(entry.name, Object.assign({}, entry));
        }
      }
    }
    return index;
  }

  /**
   * Save the index to a JSON file on disk.
   *
   * @param {string} filePath
   */
  saveToFile(filePath) {
    const json = JSON.stringify(this.toJSON(), null, 2);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, json, "utf8");
  }

  /**
   * Load the index from a JSON file on disk.
   *
   * @param {string} filePath
   * @returns {PluginIndex}
   */
  static loadFromFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    return PluginIndex.fromJSON(json);
  }
}

module.exports = { PluginIndex };
