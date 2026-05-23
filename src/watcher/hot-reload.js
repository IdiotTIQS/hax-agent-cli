"use strict";

const path = require('node:path');
const { debug } = require('../debug');
const { FileWatcher } = require('./fs-watcher');

/**
 * Manages hot-reloading of plugins, skills, config, and
 * dependency manifests when file changes are detected.
 */
class HotReloadManager {
  constructor(opts = {}) {
    this._throttleMs = opts.throttleMs || 300;
    this._paused = false;
    this._watcher = new FileWatcher(opts);
    this._reloadHistory = [];
    this._pendingReloads = new Map();  // filePath => timeoutId
    this._callbacks = new Map();       // filePath => { type, target }
  }

  // ─── public API ────────────────────────────────────────

  /**
   * Watch a plugin file and reload it in the registry on change.
   * @param {string} filePath
   * @param {object} registry - PluginRegistry instance
   * @returns {this}
   */
  watchPlugin(filePath, registry) {
    const resolved = path.resolve(filePath);
    this._callbacks.set(resolved, { type: 'plugin', target: registry });
    this._watcher.watch(resolved);
    this._watcher.on('change', (changedPath) => {
      if (path.resolve(changedPath) === resolved) {
        this._scheduleReload(resolved, this._reloadPlugin.bind(this));
      }
    });
    return this;
  }

  /**
   * Watch a skill file and reload it in the registry on change.
   * @param {string} filePath
   * @param {object} registry - Skill registry instance
   * @returns {this}
   */
  watchSkill(filePath, registry) {
    const resolved = path.resolve(filePath);
    this._callbacks.set(resolved, { type: 'skill', target: registry });
    this._watcher.watch(resolved);
    this._watcher.on('change', (changedPath) => {
      if (path.resolve(changedPath) === resolved) {
        this._scheduleReload(resolved, this._reloadSkill.bind(this));
      }
    });
    return this;
  }

  /**
   * Watch a config file and invoke the callback on change.
   * @param {string} filePath
   * @param {function} callback - receives (filePath, oldConfig) or just (filePath)
   * @returns {this}
   */
  watchConfig(filePath, callback) {
    const resolved = path.resolve(filePath);
    this._callbacks.set(resolved, { type: 'config', target: callback });
    this._watcher.watch(resolved);
    this._watcher.on('change', (changedPath) => {
      if (path.resolve(changedPath) === resolved) {
        this._scheduleReload(resolved, async () => {
          try {
            await callback(resolved);
            this._logReload(resolved, 'config', true);
          } catch (err) {
            debug('hot-reload', `Config callback error for ${resolved}: ${err.message}`);
            this._logReload(resolved, 'config', false, err.message);
          }
        });
      }
    });
    return this;
  }

  /**
   * Watch a package.json for dependency changes.
   * @param {string} packagePath - path to package.json
   * @param {function} [onChange] - optional callback(deps, oldDeps)
   * @returns {this}
   */
  watchDependencies(packagePath, onChange) {
    const resolved = path.resolve(packagePath);
    let lastDeps = null;

    try {
      const pkg = require(resolved);
      lastDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch (_) {
      lastDeps = {};
    }

    this._callbacks.set(resolved, { type: 'deps', target: onChange || null, lastDeps });
    this._watcher.watch(resolved);
    this._watcher.on('change', (changedPath) => {
      if (path.resolve(changedPath) === resolved) {
        this._scheduleReload(resolved, () => {
          this._reloadDependencies(resolved, lastDeps, onChange);
        });
      }
    });
    return this;
  }

  /**
   * Temporarily suppress all reloads.
   */
  pause() {
    this._paused = true;
    debug('hot-reload', 'Hot-reload paused');
  }

  /**
   * Resume reloads after a pause.
   */
  resume() {
    this._paused = false;
    debug('hot-reload', 'Hot-reload resumed');
  }

  /**
   * Get the reload history log.
   * @returns {Array<{ filePath: string, type: string, timestamp: string, success: boolean, error?: string }>}
   */
  getReloadHistory() {
    return [...this._reloadHistory];
  }

  /**
   * Set the minimum time (ms) between reloads for the same file.
   * @param {number} ms
   */
  setThrottle(ms) {
    this._throttleMs = Math.max(0, ms);
  }

  /**
   * Stop all file watching.
   */
  close() {
    for (const [, timer] of this._pendingReloads) {
      clearTimeout(timer);
    }
    this._pendingReloads.clear();
    this._watcher.close();
  }

  /**
   * Check if the manager is currently paused.
   * @returns {boolean}
   */
  isPaused() {
    return this._paused;
  }

  // ─── internals ─────────────────────────────────────────

  _scheduleReload(resolved, reloadFn) {
    if (this._paused) return;

    // Throttle: clear any pending reload for this file
    if (this._pendingReloads.has(resolved)) {
      clearTimeout(this._pendingReloads.get(resolved));
    }

    this._pendingReloads.set(
      resolved,
      setTimeout(() => {
        this._pendingReloads.delete(resolved);
        if (!this._paused) {
          reloadFn(resolved);
        }
      }, this._throttleMs),
    );
  }

  async _reloadPlugin(resolved) {
    const meta = this._callbacks.get(resolved);
    if (!meta) return;

    try {
      // Clear require cache so we get the updated module
      delete require.cache[require.resolve(resolved)];
      const plugin = require(resolved);

      // Unregister old version then re-register
      if (typeof meta.target.unregister === 'function' && plugin.name) {
        meta.target.unregister(plugin.name);
      }
      meta.target.register(plugin);

      this._logReload(resolved, 'plugin', true);
    } catch (err) {
      debug('hot-reload', `Plugin reload failed for ${resolved}: ${err.message}`);
      this._logReload(resolved, 'plugin', false, err.message);
    }
  }

  async _reloadSkill(resolved) {
    const meta = this._callbacks.get(resolved);
    if (!meta) return;

    try {
      delete require.cache[require.resolve(resolved)];
      const skill = require(resolved);

      // Try skill registry's loadSkill or register method
      if (typeof meta.target.unregister === 'function' && skill.name) {
        meta.target.unregister(skill.name);
      }
      if (typeof meta.target.loadSkill === 'function') {
        meta.target.loadSkill(resolved);
      } else if (typeof meta.target.register === 'function') {
        meta.target.register(skill);
      }

      this._logReload(resolved, 'skill', true);
    } catch (err) {
      debug('hot-reload', `Skill reload failed for ${resolved}: ${err.message}`);
      this._logReload(resolved, 'skill', false, err.message);
    }
  }

  _reloadDependencies(resolved, lastDeps, onChange) {
    const meta = this._callbacks.get(resolved);
    let newDeps = {};

    try {
      delete require.cache[require.resolve(resolved)];
      const pkg = require(resolved);
      newDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch (err) {
      debug('hot-reload', `Failed to read ${resolved}: ${err.message}`);
    }

    if (onChange && typeof onChange === 'function') {
      try {
        onChange(newDeps, lastDeps);
      } catch (err) {
        debug('hot-reload', `Deps callback error: ${err.message}`);
      }
    }

    // Update stored deps
    if (meta) {
      meta.lastDeps = newDeps;
    }

    this._logReload(resolved, 'dependencies', true);
  }

  _logReload(filePath, type, success, error) {
    const entry = {
      filePath,
      type,
      timestamp: new Date().toISOString(),
      success,
    };
    if (error) {
      entry.error = error;
    }
    this._reloadHistory.push(entry);
  }
}

module.exports = { HotReloadManager };
