import { TelegramAdapter } from "./telegram.js";
import { SlackAdapter } from "./slack.js";
import { DiscordAdapter } from "./discord.js";
import { FeishuAdapter } from "./feishu.js";
import { WechatAdapter } from "./wechat.js";
import { DingtalkAdapter } from "./dingtalk.js";
import { EmailAdapter } from "./email.js";
import { QqAdapter } from "./qq.js";
import { MatrixAdapter } from "./matrix.js";
import { WhatsappAdapter } from "./whatsapp.js";

const ADAPTER_MAP = {
  telegram: TelegramAdapter,
  slack: SlackAdapter,
  discord: DiscordAdapter,
  feishu: FeishuAdapter,
  wechat: WechatAdapter,
  dingtalk: DingtalkAdapter,
  email: EmailAdapter,
  qq: QqAdapter,
  matrix: MatrixAdapter,
  whatsapp: WhatsappAdapter,
};

class ChannelImplManager {
  constructor() { this._impls = new Map(); }
  register(adapter) { this._impls.set(adapter.name, adapter); return this; }
  get(name) { return this._impls.get(name) || null; }
  list() { return [...this._impls.values()]; }
  static fromConfig(configs = {}) {
    const mgr = new ChannelImplManager();
    for (const [name, AdapterClass] of Object.entries(ADAPTER_MAP)) {
      const cfg = configs[name];
      if (cfg && cfg.enabled) {
        try { if (AdapterClass) mgr.register(new AdapterClass(cfg)); } catch (_) {}
      }
    }
    return mgr;
  }
}
export { ChannelImplManager };
