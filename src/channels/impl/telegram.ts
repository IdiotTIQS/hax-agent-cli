import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

interface TelegramConfig {
  token?: string;
  name?: string;
  enabled?: boolean;
  allowFrom?: string[];
  [key: string]: unknown;
}

class TelegramAdapter extends ChannelAdapter {
  _token: string;

  constructor(cfg: TelegramConfig = {}) {
    super({ name: "telegram", ...cfg });
    this._token = cfg.token || "";
  }

  async send(target: string | null, message: SendMessage): Promise<SendResult> {
    if (!this._token) return { ok: false, error: "Telegram token not configured" };
    try {
      const r = await fetch(
        "https://api.telegram.org/bot" + this._token + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: target || "", text: (typeof message === "string" ? message : message.text || "").slice(0, 4096) }),
        }
      );
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export { TelegramAdapter };
