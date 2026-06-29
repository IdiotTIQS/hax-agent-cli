import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

interface SlackConfig {
  botToken?: string;
  name?: string;
  enabled?: boolean;
  allowFrom?: string[];
  [key: string]: unknown;
}

class SlackAdapter extends ChannelAdapter {
  _botToken: string;

  constructor(cfg: SlackConfig = {}) {
    super({ name: "slack", ...cfg });
    this._botToken = cfg.botToken || "";
  }

  async send(target: string | null, message: SendMessage): Promise<SendResult> {
    if (!this._botToken) return { ok: false, error: "Slack bot token not configured" };
    try {
      const r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + this._botToken },
        body: JSON.stringify({ channel: target || "general", text: (typeof message === "string" ? message : message.text || "").slice(0, 40000) }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export { SlackAdapter };
