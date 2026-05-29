"use strict";
class InboundMessage { constructor(o) { this.id = o.id || ""; this.channel = o.channel || ""; this.sender = o.sender || ""; this.text = o.text || ""; this.timestamp = o.timestamp || Date.now(); this.metadata = o.metadata || {}; } }
class OutboundMessage { constructor(o) { this.channel = o.channel || ""; this.target = o.target || ""; this.text = o.text || ""; this.replyToId = o.replyToId || null; } }
module.exports = { InboundMessage, OutboundMessage };
