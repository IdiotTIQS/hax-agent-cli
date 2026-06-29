import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

interface DiscordConfig {
  token?: string;
  name?: string;
  enabled?: boolean;
  allowFrom?: string[];
  [key: string]: unknown;
}

class DiscordAdapter extends ChannelAdapter {
  _token: string;

  constructor(cfg: DiscordConfig = {}) {
    super({ name: "discord", ...cfg });
    this._token = cfg.token || "";
  }

  async send(target: string | null, message: SendMessage): Promise<SendResult> {
    if (!this._token) return { ok: false, error: "Discord token not configured" };
    try {
      const r = await fetch(
        "https://discord.com/api/v10/channels/" + (target || "0") + "/messages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bot " + this._token },
          body: JSON.stringify({ content: (typeof message === "string" ? message : message.text || "").slice(0, 2000) }),
        }
      );
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export { DiscordAdapter };
