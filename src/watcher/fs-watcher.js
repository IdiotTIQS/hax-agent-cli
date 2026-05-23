"use strict";

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { debug } = require('../debug');

const DEFAULT_IGNORE = ['.git', 'node_modules', '.hax-agent'];
const DEFAULT_DEBOUNCE_MS = 100;
const POLL_INTERVAL_MS = 1000;
const VALID_EVENTS = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];

/**
 * File-system watcher with recursive directory watching,
 * event debouncing, ignore-pattern filtering, and a
 * polling fallback when the native fs.watch is unreliable.
 */
class FileWatcher extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this._ignorePatterns = opts.ignore || DEFAULT_IGNORE;
    this._usePolling = opts.usePolling === true;

    // Active watchers: Map<normalizedPath, FSWatcher | PollHandle>
    this._watchers = new Map();
    // Pending debounce timers: Map<debounceKey => timeoutId>
    this._pending = new Map();
    // Polling interval IDs: Map<normalizedPath, intervalId>
    this._pollTimers = new Map();
    // Snapshots for polling: Map<normalizedPath, Map<fileName, mtimeMs>>
    this._pollSnapshots = new Map();
  }

  // ─── public API ────────────────────────────────────────

  /**
   * Watch a file or directory (recursively).
   * @param {string|string[]} paths
   * @param {{ recursive?: boolean }} [options]
   * @returns {this}
   */
  watch(paths, options = {}) {
    const list = Array.isArray(paths) ? paths : [paths];
    const recursive = options.recursive !== false;

    for (const raw of list) {
      const resolved = path.resolve(raw);
      if (this._watchers.has(resolved)) continue;

      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          this._watchDir(resolved, recursive);
        } else {
          this._watchFile(resolved);
        }
      } catch (_) {
        // Path does not exist — try watching parent if it exists
        const parent = path.dirname(resolved);
        if (!this._watchers.has(parent)) {
          try {
            fs.statSync(parent);
            this._watchDir(parent, recursive);
          } catch (__) {
            // ignore
          }
        }
      }
    }
    return this;
  }

  /**
   * Subscribe to file events.
   * @param {string} event - add, change, unlink, addDir, unlinkDir
   * @param {function} handler
   * @returns {this}
   */
  on(event, handler) {
    if (!VALID_EVENTS.includes(event)) {
      throw new Error(`Unknown event: ${event}. Valid events: ${VALID_EVENTS.join(', ')}`);
    }
    return super.on(event, handler);
  }

  /**
   * Stop watching a specific path and all its children.
   * @param {string} rawPath
   */
  unwatch(rawPath) {
    const resolved = path.resolve(rawPath);
    const toRemove = [];

    for (const [watchedPath] of this._watchers) {
      if (watchedPath === resolved || watchedPath.startsWith(resolved + path.sep)) {
        toRemove.push(watchedPath);
      }
    }

    for (const key of toRemove) {
      this._closeWatcher(key);
    }
  }

  /**
   * Stop all watchers and release resources.
   */
  close() {
    for (const key of this._watchers.keys()) {
      this._closeWatcher(key);
    }
    this._watchers.clear();
    this._pending.clear();
    this.removeAllListeners();
  }

  /**
   * Return all currently watched paths.
   * @returns {string[]}
   */
  getWatchedPaths() {
    return [...this._watchers.keys()].sort();
  }

  // ─── internals ─────────────────────────────────────────

  _shouldIgnore(filePath) {
    const segments = filePath.split(path.sep);
    for (const pattern of this._ignorePatterns) {
      if (segments.includes(pattern)) return true;
      // Support glob-like patterns (e.g. "*.log")
      if (pattern.startsWith('*')) {
        const ext = pattern.slice(1);
        if (filePath.endsWith(ext)) return true;
      }
    }
    return false;
  }

  _debounceKey(event, filePath) {
    return `${event}::${filePath}`;
  }

  _emitDebounced(event, filePath) {
    if (this._shouldIgnore(filePath)) return;
    if (this._debounceMs <= 0) {
      this.emit(event, filePath);
      return;
    }

    const key = this._debounceKey(event, filePath);
    if (this._pending.has(key)) {
      clearTimeout(this._pending.get(key));
    }

    this._pending.set(
      key,
      setTimeout(() => {
        this._pending.delete(key);
        this.emit(event, filePath);
      }, this._debounceMs),
    );
  }

  _watchFile(resolved) {
    if (this._usePolling) {
      this._pollFile(resolved);
    } else {
      this._watchWithNative(resolved, false);
    }
  }

  _watchDir(resolved, recursive) {
    this._emitDebounced('addDir', resolved);

    // Watch the directory itself
    if (this._usePolling) {
      this._pollDir(resolved, recursive);
    } else {
      this._watchWithNative(resolved, true);
    }

    // Watch existing children recursively
    if (recursive) {
      try {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        for (const entry of entries) {
          const childPath = path.join(resolved, entry.name);
          if (this._shouldIgnore(childPath)) continue;
          try {
            if (entry.isDirectory()) {
              this._watchDir(childPath, recursive);
            } else {
              this._watchFile(childPath);
            }
          } catch (_) {
            // Permissions or race — skip
          }
        }
      } catch (_) {
        // Directory may have been deleted — ignore
      }
    }
  }

  _watchWithNative(resolved, isDir) {
    // Remove existing watcher first
    this._closeWatcher(resolved);

    try {
      const watcher = fs.watch(resolved, { persistent: true, recursive: false }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(resolved, filename);

        // Map OS event names to our event names
        if (eventType === 'rename') {
          // A rename could be add or unlink — fall through and stat
          try {
            const s = fs.statSync(fullPath);
            if (s.isDirectory()) {
              this._emitDebounced('addDir', fullPath);
              // Start watching the new directory recursively
              this._watchDir(fullPath, true);
            } else {
              this._emitDebounced('add', fullPath);
            }
          } catch (_) {
            // File/dir was removed
            this._emitDebounced(isDir ? 'unlinkDir' : 'unlink', fullPath);
            this._closeWatcher(fullPath);
          }
        } else {
          // 'change' event
          this._emitDebounced('change', resolved);
        }
      });

      watcher.on('error', (err) => {
        debug('watcher', `Native watcher error on ${resolved}: ${err.message}`);
        // Fall back to polling for this path
        this._closeWatcher(resolved);
        this._usePolling = true;
        if (isDir) {
          this._pollDir(resolved, true);
        } else {
          this._pollFile(resolved);
        }
      });

      this._watchers.set(resolved, watcher);
    } catch (err) {
      debug('watcher', `Cannot watch ${resolved}: ${err.message}`);
    }
  }

  // ─── polling fallback ──────────────────────────────────

  _pollFile(resolved) {
    if (this._watchers.has(resolved)) return;

    let lastMtime = 0;
    try {
      lastMtime = fs.statSync(resolved).mtimeMs;
    } catch (_) {
      // file doesn't exist
    }

    const interval = setInterval(async () => {
      try {
        const stat = await fsPromises.stat(resolved);
        if (stat.mtimeMs > lastMtime) {
          lastMtime = stat.mtimeMs;
          this._emitDebounced('change', resolved);
        }
      } catch (_) {
        // File was deleted
        if (lastMtime > 0) {
          this._emitDebounced('unlink', resolved);
          lastMtime = 0;
        }
      }
    }, POLL_INTERVAL_MS);

    this._watchers.set(resolved, { type: 'poll-file', interval });
    this._pollTimers.set(resolved, interval);
  }

  async _pollDir(resolved, recursive) {
    if (this._watchers.has(resolved)) return;

    // Build initial snapshot
    const snapshot = new Map();
    try {
      const entries = await fsPromises.readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (this._shouldIgnore(path.join(resolved, entry.name))) continue;
        try {
          const s = await fsPromises.stat(path.join(resolved, entry.name));
          snapshot.set(entry.name, { isDir: entry.isDirectory(), mtimeMs: s.mtimeMs });
        } catch (_) {
          // ignore stat failures
        }
      }
    } catch (_) {
      // directory removed
    }
    this._pollSnapshots.set(resolved, snapshot);

    const interval = setInterval(async () => {
      const prev = this._pollSnapshots.get(resolved);
      if (!prev) return;

      const current = new Map();
      try {
        const entries = await fsPromises.readdir(resolved, { withFileTypes: true });
        for (const entry of entries) {
          const childPath = path.join(resolved, entry.name);
          if (this._shouldIgnore(childPath)) continue;
          try {
            const s = await fsPromises.stat(childPath);
            current.set(entry.name, { isDir: entry.isDirectory(), mtimeMs: s.mtimeMs });
          } catch (_) { /* ignore */ }
        }
      } catch (_) {
        // Directory removed
        this._emitDebounced('unlinkDir', resolved);
        this._closeWatcher(resolved);
        return;
      }

      // Detect adds
      for (const [name, info] of current) {
        if (!prev.has(name)) {
          const childPath = path.join(resolved, name);
          this._emitDebounced(info.isDir ? 'addDir' : 'add', childPath);
          if (info.isDir && recursive) {
            this._pollDir(childPath, recursive);
          }
        } else if (!info.isDir && info.mtimeMs > prev.get(name).mtimeMs) {
          this._emitDebounced('change', path.join(resolved, name));
        }
      }

      // Detect removes
      for (const [name, info] of prev) {
        if (!current.has(name)) {
          this._emitDebounced(
            info.isDir ? 'unlinkDir' : 'unlink',
            path.join(resolved, name),
          );
        }
      }

      this._pollSnapshots.set(resolved, current);
    }, POLL_INTERVAL_MS);

    this._watchers.set(resolved, { type: 'poll-dir', interval });
    this._pollTimers.set(resolved, interval);
  }

  _closeWatcher(resolved) {
    const watcher = this._watchers.get(resolved);
    if (!watcher) return;

    if (typeof watcher.close === 'function') {
      // Native FSWatcher
      watcher.close();
    } else if (watcher.interval) {
      // Polling handle
      clearInterval(watcher.interval);
    }
    this._watchers.delete(resolved);
    this._pollTimers.delete(resolved);
    this._pollSnapshots.delete(resolved);
  }
}

const DEFAULT_IGNORE_PATTERNS = DEFAULT_IGNORE;

module.exports = { FileWatcher, DEFAULT_IGNORE, DEFAULT_DEBOUNCE_MS, DEFAULT_IGNORE_PATTERNS };
