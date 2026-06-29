import fs from "fs";
class HookHotReload { constructor(o={}) { this._watchPaths=o.watchPaths||[]; this._watchers=[]; this._onReload=o.onReload||(()=>{}); }
  start() { for(const p of this._watchPaths) { if(fs.existsSync(p)) { const w=fs.watch(p,()=>this._onReload(p)); this._watchers.push(w); } } }
  stop() { for(const w of this._watchers) w.close(); this._watchers=[]; }
}
export { HookHotReload };
