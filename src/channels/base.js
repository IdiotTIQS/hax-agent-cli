"use strict";
/** Base channel configurations. Ported from OpenHarness channels/impl/base.py */

const BaseChannelConfig = { enabled: false, allowFrom: [] };

const ChannelConfigs = {
  telegram: { ...BaseChannelConfig, token: "", chatId: null, proxy: null },
  slack: { ...BaseChannelConfig, botToken: "", appToken: "", signingSecret: "" },
  discord: { ...BaseChannelConfig, token: "" },
  feishu: { ...BaseChannelConfig, appId: "", appSecret: "" },
  dingtalk: { ...BaseChannelConfig, clientId: "", clientSecret: "" },
  email: { ...BaseChannelConfig, smtpHost: "", smtpPort: 587, smtpUsername: "", smtpPassword: "", fromAddress: "" },
  wechat: { ...BaseChannelConfig, token: "", appId: "", appSecret: "" },
  matrix: { ...BaseChannelConfig, homeserver: "", accessToken: "" },
  whatsapp: { ...BaseChannelConfig, accessToken: "", phoneNumberId: "" },
};

module.exports = { BaseChannelConfig, ChannelConfigs };
