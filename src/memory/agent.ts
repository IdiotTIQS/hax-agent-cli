import { MemoryStore } from "./store.js";
class AgentMemory {
  constructor(o={}) { this._store=new MemoryStore(o); this._autoSave=o.autoSave!==false; }
  async init() { await this._store.init(); }
  async remember(content,category="project_fact",opts={}) { return this._store.save(content.slice(0,80),content,{category,...opts}); }
  async recall(query,limit=5) { return this._store.search(query,limit); }
  async forget(id) { await this._store.delete(id); }
}
export { AgentMemory };
