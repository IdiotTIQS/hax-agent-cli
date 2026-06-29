import { MemoryStore } from "./store.js";

interface AgentMemoryOptions {
  dir?: string;
  autoSave?: boolean;
}

interface RememberOptions {
  category?: string;
  scope?: string;
  importance?: number;
  tags?: string[];
  ttlDays?: number;
  source?: string;
}

class AgentMemory {
  private _store: MemoryStore;
  private _autoSave: boolean;

  constructor(o: AgentMemoryOptions = {}) {
    this._store = new MemoryStore(o);
    this._autoSave = o.autoSave !== false;
  }

  async init(): Promise<void> {
    await this._store.init();
  }

  async remember(content: string, category = "project_fact", opts: RememberOptions = {}) {
    return this._store.save(content.slice(0, 80), content, { category, ...opts });
  }

  async recall(query: string, limit = 5) {
    return this._store.search(query, limit);
  }

  async forget(id: string): Promise<void> {
    await this._store.delete(id);
  }
}

export { AgentMemory };
