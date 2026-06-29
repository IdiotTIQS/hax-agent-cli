/** Channel adapter base. Ported from OpenHarness channels/adapter.py */

interface ChannelAdapterOptions {
  name?: string;
  enabled?: boolean;
  allowFrom?: string[];
}

type SendMessage = string | { text?: string };

interface SendResult {
  ok: boolean;
  error?: string;
  status?: number;
  result?: unknown;
}

interface BroadcastResult {
  channel: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

class ChannelAdapter {
  name: string;
  _enabled: boolean;
  _allowFrom: string[];

  constructor(o: ChannelAdapterOptions = {}) {
    this.name = o.name || "";
    this._enabled = o.enabled !== false;
    this._allowFrom = o.allowFrom || [];
  }

  get enabled(): boolean { return this._enabled; }

  isAllowed(sender: string): boolean {
    return this._allowFrom.length === 0 || this._allowFrom.includes("*") || this._allowFrom.includes(sender);
  }

  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    throw new Error("Not implemented");
  }

  async start(): Promise<void> { this._enabled = true; }
  async stop(): Promise<void> { this._enabled = false; }
}

class ChannelManager {
  _adapters: Map<string, ChannelAdapter>;

  constructor() { this._adapters = new Map(); }

  register(adapter: ChannelAdapter): this { this._adapters.set(adapter.name, adapter); return this; }
  get(name: string): ChannelAdapter | null { return this._adapters.get(name) || null; }
  list(): ChannelAdapter[] { return [...this._adapters.values()]; }

  async broadcast(message: SendMessage, exclude: string[] = []): Promise<BroadcastResult[]> {
    const results: BroadcastResult[] = [];
    for (const [name, adapter] of this._adapters) {
      if (!adapter.enabled || exclude.includes(name)) continue;
      try {
        results.push({ channel: name, ok: true, result: await adapter.send(null, message) });
      } catch (err) {
        results.push({ channel: name, ok: false, error: (err as Error).message });
      }
    }
    return results;
  }

  async startAll(): Promise<void> { for (const a of this._adapters.values()) await a.start(); }
  async stopAll(): Promise<void> { for (const a of this._adapters.values()) await a.stop(); }
}

export { ChannelAdapter, ChannelManager };
export type { ChannelAdapterOptions, SendMessage, SendResult };
