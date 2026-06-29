/**
 * Session Memory - save and restore session snapshots.
 * Ported from OpenHarness services/session_memory/
 *
 * Captures session state (messages, tool calls, stats) to disk
 * for session resume, crash recovery, and auditing.
 */

import fs from "fs";
import path from "path";
import os from "os";

// === Session Snapshot ===

class SessionSnapshot {
  constructor(o = {}) {
    this.sessionId = o.sessionId || "";
    this.timestamp = o.timestamp || Date.now();
    this.turnCount = o.turnCount || 0;
    this.inputTokens = o.inputTokens || 0;
    this.outputTokens = o.outputTokens || 0;
    this.toolCallCount = o.toolCallCount || 0;
    this.messages = o.messages || [];
    this.goal = o.goal || null;
    this.provider = o.provider || null;
    this.permissionMode = o.permissionMode || "normal";
    this.modifiedFiles = o.modifiedFiles || [];
    this.metadata = o.metadata || {};
  }

  get totalTokens() {
    return this.inputTokens + this.outputTokens;
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      timestamp: this.timestamp,
      turnCount: this.turnCount,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      toolCallCount: this.toolCallCount,
      messages: this.messages,
      goal: this.goal,
      provider: this.provider,
      permissionMode: this.permissionMode,
      modifiedFiles: this.modifiedFiles,
      metadata: this.metadata,
    };
  }

  static fromJSON(json) {
    return new SessionSnapshot(json);
  }
}

// === Session Memory Store ===

class SessionMemoryStore {
  /**
   * @param {Object} options
   * @param {string} [options.memoryDir] - base directory for memory storage
   * @param {number} [options.maxSnapshots] - max snapshots to retain
   */
  constructor(options = {}) {
    this._memoryDir = options.memoryDir || path.join(os.homedir(), ".haxagent", "memory");
    this._sessionsDir = path.join(this._memoryDir, "sessions");
    this._maxSnapshots = options.maxSnapshots || 10;
  }

  /**
   * Save a session snapshot to disk.
   * @param {Object} session - session object with id, messages, etc.
   * @returns {string} path to saved snapshot
   */
  saveSnapshot(session) {
    if (!fs.existsSync(this._sessionsDir)) {
      fs.mkdirSync(this._sessionsDir, { recursive: true });
    }

    const snapshot = new SessionSnapshot({
      sessionId: session.id || `s_${Date.now().toString(36)}`,
      timestamp: Date.now(),
      turnCount: session.turnCount || 0,
      inputTokens: session.inputTokens || 0,
      outputTokens: session.outputTokens || 0,
      toolCallCount: session.toolCallCount || 0,
      messages: session.messages || [],
      goal: session.goal || null,
      provider: session.provider?.model || null,
      permissionMode: session.permissionManager?.mode || "normal",
      modifiedFiles: session._modifiedFiles ? [...session._modifiedFiles] : [],
      metadata: {
        savedAt: new Date().toISOString(),
        version: "1.0",
      },
    });

    const filename = `${snapshot.sessionId}_${snapshot.timestamp}.json`;
    const filePath = path.join(this._sessionsDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(snapshot.toJSON(), null, 2));

    // Prune old snapshots
    this._pruneOldSnapshots(snapshot.sessionId);

    return filePath;
  }

  /**
   * Load a session snapshot from disk.
   * @param {string} filePath - path to snapshot file
   * @returns {SessionSnapshot|null}
   */
  loadSnapshot(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return SessionSnapshot.fromJSON(data);
    } catch (_) {
      return null;
    }
  }

  /**
   * List all snapshots for a session.
   * @param {string} sessionId
   * @returns {Array<{path: string, timestamp: number, turnCount: number, tokenCount: number}>}
   */
  listSnapshots(sessionId) {
    if (!fs.existsSync(this._sessionsDir)) return [];
    try {
      const files = fs.readdirSync(this._sessionsDir);
      return files
        .filter((f) => f.startsWith(sessionId) && f.endsWith(".json"))
        .map((f) => {
          const filePath = path.join(this._sessionsDir, f);
          try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            return {
              path: filePath,
              timestamp: data.timestamp,
              turnCount: data.turnCount || 0,
              tokenCount: (data.inputTokens || 0) + (data.outputTokens || 0),
            };
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (_) {
      return [];
    }
  }

  /**
   * Get the most recent snapshot for a session.
   * @param {string} sessionId
   * @returns {SessionSnapshot|null}
   */
  getLatestSnapshot(sessionId) {
    const snapshots = this.listSnapshots(sessionId);
    if (snapshots.length === 0) return null;
    return this.loadSnapshot(snapshots[0].path);
  }

  /**
   * Prune old snapshots, keeping only the most recent ones.
   * @param {string} sessionId
   */
  _pruneOldSnapshots(sessionId) {
    const snapshots = this.listSnapshots(sessionId);
    if (snapshots.length <= this._maxSnapshots) return;

    const toDelete = snapshots.slice(this._maxSnapshots);
    for (const snap of toDelete) {
      try {
        fs.unlinkSync(snap.path);
      } catch (_) {}
    }
  }

  /**
   * Delete all snapshots for a session.
   * @param {string} sessionId
   */
  deleteAllSnapshots(sessionId) {
    const snapshots = this.listSnapshots(sessionId);
    for (const snap of snapshots) {
      try {
        fs.unlinkSync(snap.path);
      } catch (_) {}
    }
  }
}

export { SessionSnapshot, SessionMemoryStore };
