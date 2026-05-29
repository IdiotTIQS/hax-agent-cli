"use strict";

/**
 * Observable application state store.
 * Ported from OpenHarness state/app_state.py + state/store.py
 */

class AppState {
  constructor(o = {}) {
    this.model = o.model || "";
    this.permissionMode = o.permissionMode || "default";
    this.theme = o.theme || "default";
    this.cwd = o.cwd || process.cwd();
    this.provider = o.provider || "unknown";
    this.authStatus = o.authStatus || "missing";
    this.baseUrl = o.baseUrl || "";
    this.vimEnabled = !!o.vimEnabled;
    this.voiceEnabled = !!o.voiceEnabled;
    this.voiceAvailable = !!o.voiceAvailable;
    this.voiceReason = o.voiceReason || "";
    this.fastMode = !!o.fastMode;
    this.effort = o.effort || "medium";
    this.passes = o.passes || 1;
    this.mcpConnected = o.mcpConnected || 0;
    this.mcpFailed = o.mcpFailed || 0;
    this.bridgeSessions = o.bridgeSessions || 0;
    this.outputStyle = o.outputStyle || "default";
    this.keybindings = o.keybindings || {};
  }
}

class AppStateStore {
  constructor(initialState) {
    this._state = initialState || new AppState();
    this._listeners = [];
  }

  get() { return this._state; }

  set(updates) {
    this._state = new AppState({ ...this._state, ...updates });
    for (const fn of [...this._listeners]) {
      try { fn(this._state); } catch (_) {}
    }
    return this._state;
  }

  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }
}

module.exports = { AppState, AppStateStore };
