/** Channel adapter base. Ported from OpenHarness channels/adapter.py */

/**
 * @typedef {Object} SendResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [status]
 * @property {*} [result]
 */

class ChannelAdapter {
  constructor(o = {}) { this.name = o.name || ""; this._enabled = o.enabled !== false; this._allowFrom = o.allowFrom || []; }
  get enabled() { return this._enabled; }
  isAllowed(sender) { return this._allowFrom.length === 0 || this._allowFrom.includes("*") || this._allowFrom.includes(sender); }
  /**
   * Send a message through this channel. Implemented by subclasses.
   * @param {string|null} target
   * @param {string|{text?: string}} message
   * @returns {Promise<SendResult>}
   */
  async send(target, message) { throw new Error("Not implemented"); }
  async start() { this._enabled = true; }
  async stop() { this._enabled = false; }
}

class ChannelManager {
  constructor() { this._adapters = new Map(); }
  register(adapter) { this._adapters.set(adapter.name, adapter); return this; }
  get(name) { return this._adapters.get(name) || null; }
  list() { return [...this._adapters.values()]; }
  async broadcast(message, exclude = []) {
    const results = [];
    for (const [name, adapter] of this._adapters) {
      if (!adapter.enabled || exclude.includes(name)) continue;
      try { results.push({ channel: name, ok: true, result: await adapter.send(null, message) }); } catch (err) { results.push({ channel: name, ok: false, error: err.message }); }
    }
    return results;
  }
  async startAll() { for (const a of this._adapters.values()) await a.start(); }
  async stopAll() { for (const a of this._adapters.values()) await a.stop(); }
}

export { ChannelAdapter, ChannelManager };
