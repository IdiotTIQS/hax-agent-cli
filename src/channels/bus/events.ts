interface InboundMessageOptions {
  id?: string;
  channel?: string;
  sender?: string;
  text?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

interface OutboundMessageOptions {
  channel?: string;
  target?: string;
  text?: string;
  replyToId?: string | null;
}

class InboundMessage {
  id: string;
  channel: string;
  sender: string;
  text: string;
  timestamp: number;
  metadata: Record<string, unknown>;

  constructor(o: InboundMessageOptions) {
    this.id = o.id || "";
    this.channel = o.channel || "";
    this.sender = o.sender || "";
    this.text = o.text || "";
    this.timestamp = o.timestamp || Date.now();
    this.metadata = o.metadata || {};
  }
}

class OutboundMessage {
  channel: string;
  target: string;
  text: string;
  replyToId: string | null;

  constructor(o: OutboundMessageOptions) {
    this.channel = o.channel || "";
    this.target = o.target || "";
    this.text = o.text || "";
    this.replyToId = o.replyToId || null;
  }
}

export { InboundMessage, OutboundMessage };
