import { EventEmitter } from "events";

class MessageBus extends EventEmitter {
  _inbound: unknown[];
  _outbound: unknown[];

  constructor() {
    super();
    this._inbound = [];
    this._outbound = [];
  }

  pushInbound(msg: unknown): void { this._inbound.push(msg); this.emit("message", msg); }
  pushOutbound(msg: unknown): void { this._outbound.push(msg); this.emit("outbound", msg); }
  drainInbound(): unknown[] { const msgs = [...this._inbound]; this._inbound = []; return msgs; }
  drainOutbound(): unknown[] { const msgs = [...this._outbound]; this._outbound = []; return msgs; }
}

export { MessageBus };
