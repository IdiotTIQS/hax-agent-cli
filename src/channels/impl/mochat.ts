import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

class MochatAdapter extends ChannelAdapter {
  constructor(cfg: Record<string, unknown> = {}) { super({ name: "mochat", ...cfg }); }
  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    return { ok: false, error: "Mochat adapter requires Mochat server configuration" };
  }
}

export { MochatAdapter };
