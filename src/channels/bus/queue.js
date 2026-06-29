import { EventEmitter } from "events";
class MessageBus extends EventEmitter {
  constructor() { super(); this._inbound = []; this._outbound = []; }
  pushInbound(msg) { this._inbound.push(msg); this.emit("message", msg); }
  pushOutbound(msg) { this._outbound.push(msg); this.emit("outbound", msg); }
  drainInbound() { const msgs = [...this._inbound]; this._inbound = []; return msgs; }
  drainOutbound() { const msgs = [...this._outbound]; this._outbound = []; return msgs; }
}
export { MessageBus };
