import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

class WhatsappAdapter extends ChannelAdapter {
  constructor(cfg: Record<string, unknown> = {}) { super({ name: "whatsapp", ...cfg }); }
  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    return { ok: false, error: "Whatsapp adapter requires external API configuration" };
  }
}

export { WhatsappAdapter };
