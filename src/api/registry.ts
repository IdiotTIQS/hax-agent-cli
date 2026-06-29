import { listProviders } from "./provider.js";
class ApiRegistry { constructor() { this._entries = new Map(); }
  register(name,config) { this._entries.set(name,config); return this; }
  get(name) { return this._entries.get(name)||null; }
  list() { return [...this._entries.values()]; }
}
export { ApiRegistry };
