/**
 * Plugin System — manifest-driven plugin loading.
 * Ported from OpenHarness plugins/loader.py.
 */

import fs from "fs";
import path from "path";
import os from "os";

interface PluginManifestOptions {
  name?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  skillsDir?: string;
  hooksFile?: string;
  dir?: string;
}

class PluginManifest {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  skillsDir: string;
  hooksFile: string;
  dir: string;

  constructor(o: PluginManifestOptions = {}) {
    this.name = o.name || "";
    this.version = o.version || "0.1.0";
    this.description = o.description || "";
    this.enabled = o.enabled !== false;
    this.skillsDir = o.skillsDir || "skills";
    this.hooksFile = o.hooksFile || "hooks.json";
    this.dir = o.dir || "";
  }
}

interface PluginSkill {
  name: string;
  path: string;
  content: string;
}

interface LoadedPlugin {
  name: string;
  version: string;
  description: string;
  dir: string;
  enabled: boolean;
  skills: PluginSkill[];
  hooks: unknown[];
}

interface RawManifest {
  name?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  skillsDir?: string;
  hooksFile?: string;
}

class PluginRegistry {
  private _plugins: Map<string, LoadedPlugin>;

  constructor() {
    this._plugins = new Map();
  }

  async loadFromDir(dir: string): Promise<LoadedPlugin[]> {
    if (!fs.existsSync(dir)) return [];
    const results: LoadedPlugin[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const r = await this.loadPlugin(path.join(dir, entry.name));
      if (r) results.push(r);
    }
    return results;
  }

  async loadPlugin(pluginDir: string): Promise<LoadedPlugin | null> {
    const manifestPath = path.join(pluginDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) return null;

    let manifest: RawManifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as RawManifest; }
    catch (_) { return null; }
    if (!manifest.name) return null;

    if (this._plugins.has(manifest.name)) return null;

    const plugin: LoadedPlugin = {
      name: manifest.name, version: manifest.version || "0.1.0",
      description: manifest.description || "", dir: pluginDir,
      enabled: manifest.enabled !== false,
      skills: [], hooks: [],
    };

    // Load hooks
    const hooksFile = path.join(pluginDir, manifest.hooksFile || "hooks.json");
    if (fs.existsSync(hooksFile)) {
      try { plugin.hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8")) as unknown[]; }
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

  get(name: string): LoadedPlugin | null { return this._plugins.get(name) || null; }
  list(): LoadedPlugin[] { return [...this._plugins.values()]; }
  listEnabled(): LoadedPlugin[] { return this.list().filter(p => p.enabled); }

  /** Get all hooks from enabled plugins */
  getAllHooks(): Array<unknown & { _plugin: string }> {
    const all: Array<Record<string, unknown> & { _plugin: string }> = [];
    for (const p of this.listEnabled()) {
      for (const h of (p.hooks || [])) {
        all.push({ ...(h as Record<string, unknown>), _plugin: p.name });
      }
    }
    return all;
  }
}

/** Load plugins from standard locations (synchronous convenience wrapper). */
function loadPluginRegistry(cwd = process.cwd()): PluginRegistry {
  const registry = new PluginRegistry();
  const dirs = [
    path.join(os.homedir(), ".haxagent", "plugins"),
    path.join(cwd, ".hax-agent", "plugins"),
  ];
  for (const d of dirs) {
    registry.loadFromDir(d).catch(() => {});
  }
  return registry;
}

export { PluginManifest, PluginRegistry, loadPluginRegistry };
