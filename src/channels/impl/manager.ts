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
import type { ChannelAdapter } from "../adapter.js";

type AdapterConstructor = new (cfg: Record<string, unknown>) => ChannelAdapter;

interface AdapterConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

const ADAPTER_MAP: Record<string, AdapterConstructor> = {
  telegram: TelegramAdapter as AdapterConstructor,
  slack: SlackAdapter as AdapterConstructor,
  discord: DiscordAdapter as AdapterConstructor,
  feishu: FeishuAdapter as AdapterConstructor,
  wechat: WechatAdapter as AdapterConstructor,
  dingtalk: DingtalkAdapter as AdapterConstructor,
  email: EmailAdapter as AdapterConstructor,
  qq: QqAdapter as AdapterConstructor,
  matrix: MatrixAdapter as AdapterConstructor,
  whatsapp: WhatsappAdapter as AdapterConstructor,
};

class ChannelImplManager {
  _impls: Map<string, ChannelAdapter>;

  constructor() { this._impls = new Map(); }

  register(adapter: ChannelAdapter): this { this._impls.set(adapter.name, adapter); return this; }
  get(name: string): ChannelAdapter | null { return this._impls.get(name) || null; }
  list(): ChannelAdapter[] { return [...this._impls.values()]; }

  static fromConfig(configs: Record<string, AdapterConfig> = {}): ChannelImplManager {
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
