/**
 * Observable application state store.
 * Ported from OpenHarness state/app_state.py + state/store.py
 */

interface AppStateOptions {
  model?: string;
  permissionMode?: string;
  theme?: string;
  cwd?: string;
  provider?: string;
  authStatus?: string;
  baseUrl?: string;
  vimEnabled?: boolean;
  voiceEnabled?: boolean;
  voiceAvailable?: boolean;
  voiceReason?: string;
  fastMode?: boolean;
  effort?: string;
  passes?: number;
  mcpConnected?: number;
  mcpFailed?: number;
  bridgeSessions?: number;
  outputStyle?: string;
  keybindings?: Record<string, unknown>;
}

class AppState {
  model: string;
  permissionMode: string;
  theme: string;
  cwd: string;
  provider: string;
  authStatus: string;
  baseUrl: string;
  vimEnabled: boolean;
  voiceEnabled: boolean;
  voiceAvailable: boolean;
  voiceReason: string;
  fastMode: boolean;
  effort: string;
  passes: number;
  mcpConnected: number;
  mcpFailed: number;
  bridgeSessions: number;
  outputStyle: string;
  keybindings: Record<string, unknown>;

  constructor(o: AppStateOptions = {}) {
    this.model = o.model || "";
    this.permissionMode = o.permissionMode || "normal";
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

type StateListener = (state: AppState) => void;

class AppStateStore {
  private _state: AppState;
  private _listeners: StateListener[];

  constructor(initialState?: AppState) {
    this._state = initialState || new AppState();
    this._listeners = [];
  }

  get(): AppState { return this._state; }

  set(updates: AppStateOptions): AppState {
    this._state = new AppState({ ...this._state, ...updates });
    for (const fn of [...this._listeners]) {
      try { fn(this._state); } catch (_) {}
    }
    return this._state;
  }

  subscribe(listener: StateListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }
}

export { AppState, AppStateStore };
