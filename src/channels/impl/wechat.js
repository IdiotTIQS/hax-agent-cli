"use strict";
const { ChannelAdapter } = require("../adapter");
class WechatAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"wechat",...cfg}); }
  async send(target,message) { return {ok:false,error:"Wechat adapter requires external API configuration"}; }
}
module.exports = { WechatAdapter };
