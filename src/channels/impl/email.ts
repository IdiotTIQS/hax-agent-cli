import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

class EmailAdapter extends ChannelAdapter {
  constructor(cfg: Record<string, unknown> = {}) { super({ name: "email", ...cfg }); }
  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    return { ok: false, error: "Email adapter requires external API configuration" };
  }
}

export { EmailAdapter };
