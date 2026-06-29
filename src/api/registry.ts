import { listProviders } from "./provider.js";

interface ProviderConfig {
  name?: string;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  [key: string]: unknown;
}

class ApiRegistry {
  private _entries: Map<string, ProviderConfig>;

  constructor() {
    this._entries = new Map();
  }

  register(name: string, config: ProviderConfig): this {
    this._entries.set(name, config);
    return this;
  }

  get(name: string): ProviderConfig | null {
    return this._entries.get(name) || null;
  }

  list(): ProviderConfig[] {
    return [...this._entries.values()];
  }
}

export { ApiRegistry };
// Re-export to silence unused import warning from listProviders
export { listProviders };
