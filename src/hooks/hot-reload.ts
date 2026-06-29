import fs from "fs";

interface HookHotReloadOptions {
  watchPaths?: string[];
  watchers?: fs.FSWatcher[];
  onReload?: (path: string) => void;
}

class HookHotReload {
  private _watchPaths: string[];
  private _watchers: fs.FSWatcher[];
  private _onReload: (path: string) => void;

  constructor(o: HookHotReloadOptions = {}) {
    this._watchPaths = o.watchPaths || [];
    this._watchers = [];
    this._onReload = o.onReload || (() => {});
  }

  start(): void {
    for (const p of this._watchPaths) {
      if (fs.existsSync(p)) {
        const w = fs.watch(p, () => this._onReload(p));
        this._watchers.push(w);
      }
    }
  }

  stop(): void {
    for (const w of this._watchers) w.close();
    this._watchers = [];
  }
}

export { HookHotReload };
