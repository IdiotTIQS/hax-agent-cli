"use strict";

/**
 * Plugin System — manifest-driven plugin loading.
 * Ported from OpenHarness plugins/loader.py.
 *
 * Plugin directory:
 *   my-plugin/
 *     plugin.json    # { name, version, description, skillsDir, hooksFile }
 *     hooks.json     # [ { event, type, matcher, priority } ]
 *     skills/        # SKILL.md files
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

class PluginManifest {
  constructor(o = {}) {
    this.name = o.name || "";
    this.version = o.version || "0.1.0";
    this.description = o.description || "";
    this.enabled = o.enabled !== false;
    this.skillsDir = o.skillsDir || "skills";
    this.hooksFile = o.hooksFile || "hooks.json";
    this.dir = o.dir || "";
  }
}

class PluginRegistry {
  constructor() { this._plugins = new Map(); }

  async loadFromDir(dir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const r = await this.loadPlugin(path.join(dir, entry.name));
      if (r) results.push(r);
    }
    return results;
  }

  async loadPlugin(pluginDir) {
    const manifestPath = path.join(pluginDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) return null;

    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); }
    catch (_) { return null; }
    if (!manifest.name) return null;

    if (this._plugins.has(manifest.name)) return null;

    const plugin = {
      name: manifest.name, version: manifest.version || "0.1.0",
      description: manifest.description || "", dir: pluginDir,
      enabled: manifest.enabled !== false,
      skills: [], hooks: [],
    };

    // Load hooks
    const hooksFile = path.join(pluginDir, manifest.hooksFile || "hooks.json");
    if (fs.existsSync(hooksFile)) {
      try { plugin.hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8")); }
      catch (_) {}
    }

    // Load skills
    const skillsDir = path.join(pluginDir, manifest.skillsDir || "skills");
    if (fs.existsSync(skillsDir)) {
      for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const sf = path.join(skillsDir, e.name, "SKILL.md");
        if (fs.existsSync(sf)) {
          plugin.skills.push({ name: e.name, path: sf, content: fs.readFileSync(sf, "utf-8") });
        }
      }
    }

    this._plugins.set(manifest.name, plugin);
    return plugin;
  }

  get(name) { return this._plugins.get(name) || null; }
  list() { return [...this._plugins.values()]; }
  listEnabled() { return this.list().filter(p => p.enabled); }

  /** Get all hooks from enabled plugins */
  getAllHooks() {
    const all = [];
    for (const p of this.listEnabled()) {
      for (const h of (p.hooks || [])) all.push({ ...h, _plugin: p.name });
    }
    return all;
  }
}

/** Load plugins from standard locations */
function loadPluginRegistry(cwd = process.cwd()) {
  const registry = new PluginRegistry();
  const dirs = [
    path.join(os.homedir(), ".haxagent", "plugins"),
    path.join(cwd, ".hax-agent", "plugins"),
  ];
  for (const d of dirs) registry.loadFromDir(d);
  return registry;
}

module.exports = { PluginManifest, PluginRegistry, loadPluginRegistry };
