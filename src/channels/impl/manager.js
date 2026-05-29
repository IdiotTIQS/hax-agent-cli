"use strict";
class ChannelImplManager {
  constructor() { this._impls = new Map(); }
  register(adapter) { this._impls.set(adapter.name, adapter); return this; }
  get(name) { return this._impls.get(name) || null; }
  list() { return [...this._impls.values()]; }
  static fromConfig(configs = {}) {
    const mgr = new ChannelImplManager();
    const names = ["telegram","slack","discord","feishu","wechat","dingtalk","email","qq","matrix","whatsapp"];
    for (const name of names) {
      const cfg = configs[name];
      if (cfg && cfg.enabled) {
        try { const mod = require("./"+name); const key = name.charAt(0).toUpperCase()+name.slice(1)+"Adapter"; if (mod[key]) mgr.register(new mod[key](cfg)); } catch (_) {}
      }
    }
    return mgr;
  }
}
module.exports = { ChannelImplManager };
