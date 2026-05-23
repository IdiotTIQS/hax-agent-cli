"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadSettings } = require("../config");

/**
 * Represents a single project registered in the workspace.
 */
class ProjectEntry {
  /**
   * @param {string} root - Absolute path to project root
   * @param {object} [config] - Project-level configuration overrides
   */
  constructor(root, config = {}) {
    this.root = path.resolve(root);
    this.config = config;
    this.name = config.name || path.basename(this.root);
    this.registeredAt = new Date().toISOString();
    this.lastAccessed = this.registeredAt;
  }

  /**
   * Returns metadata for this project entry.
   * @returns {object}
   */
  metadata() {
    return {
      name: this.name,
      root: this.root,
      registeredAt: this.registeredAt,
      lastAccessed: this.lastAccessed,
      hasConfig: Object.keys(this.config).length > 0,
    };
  }

  touch() {
    this.lastAccessed = new Date().toISOString();
  }
}

/**
 * Manages multiple projects in a workspace, allowing context switching
 * and project discovery within monorepos or multi-project directories.
 */
class WorkspaceManager {
  /**
   * @param {object} [options]
   * @param {string} [options.storageDir] - Directory to persist workspace state
   * @param {object} [options.settings] - Shared settings across all projects
   */
  constructor(options = {}) {
    this._projects = new Map();
    this._current = null;
    this._storageDir = options.storageDir || null;
    this._sharedSettings = options.settings || {};
  }

  // ── Project registration ─────────────────────────────────

  /**
   * Register a project in the workspace.
   * @param {string} root - Absolute or relative path to project root
   * @param {object} [config] - Project-level configuration overrides
   * @returns {ProjectEntry} the registered project entry
   */
  addProject(root, config = {}) {
    const resolved = path.resolve(root);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Project root does not exist: ${resolved}`);
    }

    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Project root is not a directory: ${resolved}`);
    }

    if (this._projects.has(resolved)) {
      throw new Error(`Project already registered: ${resolved}`);
    }

    const entry = new ProjectEntry(resolved, config);
    this._projects.set(resolved, entry);

    // Set as current if it is the first project registered
    if (this._current === null) {
      this._current = resolved;
    }

    return entry;
  }

  /**
   * Remove a project from the workspace.
   * @param {string} root - Project root path
   * @returns {boolean} true if the project was removed
   */
  removeProject(root) {
    const resolved = path.resolve(root);

    if (!this._projects.has(resolved)) {
      return false;
    }

    this._projects.delete(resolved);

    if (this._current === resolved) {
      const remaining = this.listProjects();
      this._current = remaining.length > 0 ? remaining[0].root : null;
    }

    return true;
  }

  /**
   * List all registered projects with metadata.
   * @returns {Array<object>}
   */
  listProjects() {
    const entries = [];
    for (const [, entry] of this._projects) {
      const meta = entry.metadata();
      meta.active = entry.root === this._current;
      entries.push(meta);
    }
    return entries;
  }

  /**
   * Get the currently active project.
   * @returns {ProjectEntry|null}
   */
  getCurrentProject() {
    if (this._current === null) {
      return null;
    }
    return this._projects.get(this._current) || null;
  }

  /**
   * Switch the active project context.
   * @param {string} root - Project root to switch to
   * @returns {ProjectEntry} the newly active project
   */
  switchProject(root) {
    const resolved = path.resolve(root);

    if (!this._projects.has(resolved)) {
      throw new Error(`Project not registered: ${resolved}`);
    }

    this._current = resolved;
    const entry = this._projects.get(resolved);
    entry.touch();
    return entry;
  }

  /**
   * Return the full context for a project, including settings merged
   * from project-level config files and shared workspace settings.
   * @param {string} root - Project root
   * @returns {object} context object with projectRoot, settings, etc.
   */
  getProjectContext(root) {
    const resolved = path.resolve(root);

    if (!this._projects.has(resolved)) {
      throw new Error(`Project not registered: ${resolved}`);
    }

    const entry = this._projects.get(resolved);
    let projectSettings = {};

    try {
      projectSettings = loadSettings({ projectRoot: resolved });
    } catch (_error) {
      // Use empty settings if project config is unavailable
    }

    const mergedSettings = this._mergeSettings(
      this._sharedSettings,
      projectSettings,
      entry.config,
    );

    return {
      projectRoot: resolved,
      name: entry.name,
      settings: mergedSettings,
      registeredAt: entry.registeredAt,
      lastAccessed: entry.lastAccessed,
    };
  }

  /**
   * Auto-discover projects in a directory by looking for common
   * monorepo patterns (packages/*, apps/*) or project indicators
   * (package.json, Cargo.toml, etc.).
   * @param {string} root - Directory to scan
   * @returns {Array<object>} discovered project info objects
   */
  scanWorkspace(root) {
    const resolved = path.resolve(root);
    const discovered = [];

    // Scan for monorepo packages pattern
    const packagesDir = path.join(resolved, "packages");
    if (this._isDirectory(packagesDir)) {
      const subdirs = this._listDirectories(packagesDir);
      for (const sub of subdirs) {
        const pkgPath = path.join(packagesDir, sub);
        const pkgJson = path.join(pkgPath, "package.json");
        if (fs.existsSync(pkgJson)) {
          discovered.push({
            root: pkgPath,
            name: sub,
            discoveredVia: "packages/<package.json>",
          });
        }
      }
    }

    // Scan for apps pattern (common in turborepo/nx setups)
    const appsDir = path.join(resolved, "apps");
    if (this._isDirectory(appsDir)) {
      const subdirs = this._listDirectories(appsDir);
      for (const sub of subdirs) {
        const pkgPath = path.join(appsDir, sub);
        const pkgJson = path.join(pkgPath, "package.json");
        if (fs.existsSync(pkgJson)) {
          discovered.push({
            root: pkgPath,
            name: sub,
            discoveredVia: "apps/<package.json>",
          });
        }
      }
    }

    // Scan for standalone project indicators at root level
    const rootEntries = this._listDirectories(resolved);
    for (const entry of rootEntries) {
      if (entry === "packages" || entry === "apps" || entry === "node_modules") {
        continue;
      }
      const entryPath = path.join(resolved, entry);
      if (this._hasProjectIndicator(entryPath)) {
        // Avoid duplicates from packages/apps scan
        const alreadyFound = discovered.some((d) => d.root === entryPath);
        if (!alreadyFound) {
          discovered.push({
            root: entryPath,
            name: entry,
            discoveredVia: "project indicator in root subdirectory",
          });
        }
      }
    }

    // Also check the root itself as a standalone project
    if (this._hasProjectIndicator(resolved)) {
      discovered.push({
        root: resolved,
        name: path.basename(resolved),
        discoveredVia: "project indicator at root",
      });
    }

    return discovered;
  }

  // ── Internal helpers ─────────────────────────────────────

  _isDirectory(p) {
    try {
      return fs.statSync(p).isDirectory();
    } catch (_error) {
      return false;
    }
  }

  _listDirectories(dirPath) {
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
        .map((d) => d.name);
    } catch (_error) {
      return [];
    }
  }

  _hasProjectIndicator(dirPath) {
    const indicators = [
      "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
      "setup.py", "Gemfile", "composer.json", "Makefile",
    ];
    for (const indicator of indicators) {
      if (fs.existsSync(path.join(dirPath, indicator))) {
        return true;
      }
    }
    return false;
  }

  _mergeSettings(...sources) {
    const target = {};
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const [key, value] of Object.entries(source)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          target[key] = this._mergeSettings(target[key] || {}, value);
        } else {
          target[key] = value;
        }
      }
    }
    return target;
  }
}

module.exports = {
  WorkspaceManager,
  ProjectEntry,
};
