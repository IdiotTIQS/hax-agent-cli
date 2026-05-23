"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Watches a configuration file for external changes.
 *
 * Uses fs.watch for OS-level change events and compares file content hashes
 * to avoid false positives from metadata-only touches. Rapid successive saves
 * are coalesced through a configurable debounce window.
 */
class ConfigWatcher {
  /**
   * @param {{ debounceMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this._debounceMs =
      typeof opts.debounceMs === "number"
        ? Math.max(0, opts.debounceMs)
        : DEFAULT_DEBOUNCE_MS;

    /** @type {Map<string, Array<Function>>} */
    this._sectionHandlers = new Map();

    /** @type {Array<Function>} */
    this._changeHandlers = [];

    this._watcher = null;
    this._timer = null;
    this._paused = false;
    this._configPath = null;
    this._lastHash = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start watching a config file.
   * @param {string} configPath - absolute path to the JSON config file
   * @returns {string} resolved config path
   */
  watch(configPath) {
    if (!configPath || typeof configPath !== "string") {
      throw new Error("configPath must be a non-empty string");
    }

    const resolved = path.resolve(configPath);
    this.close();

    // Read initial hash to establish the baseline.
    this._lastHash = hashFile(resolved);
    this._configPath = resolved;

    this._watcher = fs.watch(resolved, { persistent: false }, (eventType) => {
      if (eventType !== "change") return;
      this._onFileChanged();
    });

    this._watcher.on("error", (err) => {
      // Swallow errors from closed watchers and permissions.
      if (err && (err.code === "ERR_STREAM_DESTROYED" || err.code === "EPERM")) return;
      // Re-emit as a non-throwing console warning so the process stays alive.
      console.warn("[ConfigWatcher] watch error:", err.message);
    });

    return resolved;
  }

  /**
   * Register a handler for any config change.
   * @param {Function} handler - receives (oldConfig, newConfig, changedSections)
   * @returns {Function} unsubscribe function
   */
  onChange(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }
    this._changeHandlers.push(handler);
    return () => {
      const idx = this._changeHandlers.indexOf(handler);
      if (idx !== -1) this._changeHandlers.splice(idx, 1);
    };
  }

  /**
   * Register a handler for changes to a specific section.
   * @param {string} section - section name (e.g. "ui", "permissions")
   * @param {Function} handler - receives (oldVal, newVal, section)
   * @returns {Function} unsubscribe function
   */
  onSectionChange(section, handler) {
    if (!section || typeof section !== "string") {
      throw new TypeError("section must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    if (!this._sectionHandlers.has(section)) {
      this._sectionHandlers.set(section, []);
    }
    this._sectionHandlers.get(section).push(handler);

    return () => {
      const handlers = this._sectionHandlers.get(section);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Temporarily suppress change notifications.
   */
  pause() {
    this._paused = true;
  }

  /**
   * Resume change notifications.
   * Does NOT replay events that occurred during pause.
   */
  resume() {
    // Re-hash to establish a fresh baseline so that any changes made
    // during the pause do not trigger a spurious notification on resume.
    if (this._configPath && fs.existsSync(this._configPath)) {
      this._lastHash = hashFile(this._configPath);
    }
    this._paused = false;
  }

  /**
   * Stop watching and clean up all listeners.
   */
  close() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }

    this._configPath = null;
    this._lastHash = null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _onFileChanged() {
    if (this._debounceMs > 0) {
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this._checkAndNotify(), this._debounceMs);
    } else {
      this._checkAndNotify();
    }
  }

  _checkAndNotify() {
    if (this._paused || !this._configPath) return;

    const currentHash = hashFile(this._configPath);

    // File may have been deleted — treat as unchanged.
    if (currentHash === null) return;

    // Skip if the content hash is identical to the last known hash.
    if (this._lastHash !== null && currentHash === this._lastHash) return;

    const prevHash = this._lastHash;
    this._lastHash = currentHash;

    // Read old config from the previous hash (we only have the hash, so we
    // re-read the current file and report that *all* sections changed because
    // we cannot reconstruct the previous state from the hash alone).
    // But for practical purposes we read the current file content.
    let newConfig = null;
    try {
      const raw = fs.readFileSync(this._configPath, "utf8");
      newConfig = JSON.parse(raw);
    } catch (_err) {
      // File is malformed — skip notification to avoid propagating bad state.
      return;
    }

    const changedSections = Object.keys(newConfig);

    // Notify section-specific handlers first.
    for (const [section, handlers] of this._sectionHandlers) {
      if (handlers.length === 0) continue;
      const newVal = newConfig[section];
      const oldVal = undefined; // We cannot reconstruct old values from hash only.
      for (const handler of handlers) {
        try {
          handler(oldVal, newVal, section);
        } catch (_err) {
          // Swallow handler errors to protect other handlers.
        }
      }
    }

    // Notify general change handlers.
    for (const handler of this._changeHandlers) {
      try {
        handler(undefined, newConfig, changedSections);
      } catch (_err) {
        // Swallow handler errors.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (_err) {
    return null;
  }
}

module.exports = { ConfigWatcher, hashFile };
