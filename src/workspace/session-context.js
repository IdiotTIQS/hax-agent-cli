"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Represents a saved context snapshot for a workspace session.
 * @typedef {object} ContextSnapshot
 * @property {string} projectRoot
 * @property {object} settings
 * @property {string} memoryDir
 * @property {string} sessionDir
 * @property {string} lastAccessed
 */

/**
 * Manages session context navigation across multiple projects.
 * Provides a stack-based system for switching between project contexts,
 * saving and restoring state, and executing operations within a
 * specific project context.
 */
class SessionContext {
  /**
   * @param {object} [options]
   * @param {string} [options.storageDir] - Directory for persisting context state
   * @param {string} [options.initialProject] - Initial project root
   */
  constructor(options = {}) {
    this._storageDir = options.storageDir || path.join(os.tmpdir(), "hax-agent-session-context");
    this._stack = [];
    this._current = null;
    this._initialProject = options.initialProject || null;

    if (options.initialProject) {
      this._initContext(options.initialProject);
    }
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Save the current session context for later restoration.
   * @param {object} session - Session state to save
   * @param {string} session.projectRoot - Project root path
   * @param {object} [session.settings] - Session settings
   * @param {string} [session.memoryDir] - Memory storage directory
   * @param {string} [session.sessionDir] - Session storage directory
   * @returns {ContextSnapshot} the saved context snapshot
   */
  save(session) {
    if (!session || !session.projectRoot) {
      throw new Error("Session must have a projectRoot");
    }

    const snapshot = this._createSnapshot(session);
    this._current = snapshot;

    // Persist to disk if storage directory is configured
    this._persistToDisk(snapshot);

    return snapshot;
  }

  /**
   * Restore the most recently saved session context.
   * @returns {ContextSnapshot|null} the restored context, or null if none saved
   */
  restore() {
    // First try in-memory current, then try loading from disk
    if (this._current) {
      return this._current;
    }

    const loaded = this._loadFromDisk();
    if (loaded) {
      this._current = loaded;
      return loaded;
    }

    if (this._initialProject) {
      this._initContext(this._initialProject);
      return this._current;
    }

    return null;
  }

  /**
   * Get the full context navigation history stack.
   * @returns {ContextSnapshot[]} array of context snapshots in stack order
   */
  getContextStack() {
    return [...this._stack];
  }

  /**
   * Save the current context and switch to a new project.
   * @param {string} projectRoot - Project root to switch to
   * @param {object} [settings] - Settings for the new context
   * @returns {ContextSnapshot} the new context snapshot
   */
  pushContext(projectRoot, settings = {}) {
    const resolved = path.resolve(projectRoot);

    // Save current context to stack
    if (this._current) {
      this._stack.push({ ...this._current });
    }

    const snapshot = this._createSnapshot({
      projectRoot: resolved,
      settings,
      memoryDir: settings.memoryDir || path.join(resolved, ".hax-agent", "memory"),
      sessionDir: settings.sessionDir || path.join(resolved, ".hax-agent", "sessions"),
    });

    this._current = snapshot;
    return snapshot;
  }

  /**
   * Return to the previous project context from the stack.
   * @returns {ContextSnapshot|null} the restored context, or null if stack is empty
   */
  popContext() {
    if (this._stack.length === 0) {
      return null;
    }

    this._current = this._stack.pop();
    return this._current;
  }

  /**
   * Execute a function within a specific project context, then restore
   * the previous context when done.
   * @param {string} projectRoot - Project root to execute in
   * @param {Function} fn - Async or sync function to execute
   * @returns {Promise<any>} the return value of fn
   */
  async withContext(projectRoot, fn) {
    const resolved = path.resolve(projectRoot);

    // Save current
    const previous = this._current;

    // Push new context
    this.pushContext(resolved);

    try {
      const result = await fn(this._current);
      return result;
    } finally {
      // Restore previous context
      if (previous) {
        this._current = previous;
      } else if (this._stack.length > 0) {
        // We pushed the new context onto the stack — remove it
        // and restore whatever was below
        const toDiscard = this._stack.pop();
        // If the stack top is the context we just pushed, restore below it
        if (this._stack.length > 0) {
          this._current = this._stack.pop();
        } else {
          this._current = toDiscard;
        }
      } else {
        this._current = null;
      }
    }
  }

  /**
   * Get the current context snapshot.
   * @returns {ContextSnapshot|null}
   */
  getCurrent() {
    return this._current;
  }

  // ── Internal helpers ──────────────────────────────────────

  _createSnapshot(session) {
    const resolved = path.resolve(session.projectRoot);
    return Object.freeze({
      projectRoot: resolved,
      settings: { ...(session.settings || {}) },
      memoryDir: session.memoryDir || path.join(resolved, ".hax-agent", "memory"),
      sessionDir: session.sessionDir || path.join(resolved, ".hax-agent", "sessions"),
      lastAccessed: new Date().toISOString(),
    });
  }

  _initContext(projectRoot) {
    const resolved = path.resolve(projectRoot);
    this._current = this._createSnapshot({
      projectRoot: resolved,
      settings: {},
    });
  }

  _persistToDisk(snapshot) {
    try {
      fs.mkdirSync(this._storageDir, { recursive: true });
      const filePath = path.join(this._storageDir, "session-context.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
    } catch (_error) {
      // Non-critical: disk persistence is best-effort
    }
  }

  _loadFromDisk() {
    try {
      const filePath = path.join(this._storageDir, "session-context.json");
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);
      if (data && data.projectRoot) {
        return Object.freeze({
          projectRoot: data.projectRoot,
          settings: data.settings || {},
          memoryDir: data.memoryDir || path.join(data.projectRoot, ".hax-agent", "memory"),
          sessionDir: data.sessionDir || path.join(data.projectRoot, ".hax-agent", "sessions"),
          lastAccessed: data.lastAccessed || new Date().toISOString(),
        });
      }
    } catch (_error) {
      // Corrupt or missing — ignore
    }
    return null;
  }
}

module.exports = {
  SessionContext,
};
