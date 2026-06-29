import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

class WechatAdapter extends ChannelAdapter {
  constructor(cfg: Record<string, unknown> = {}) { super({ name: "wechat", ...cfg }); }
  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    return { ok: false, error: "Wechat adapter requires external API configuration" };
  }
}

export { WechatAdapter };
