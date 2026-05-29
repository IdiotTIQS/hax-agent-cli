"use strict";
const { ChannelAdapter } = require("../adapter");
class DingtalkAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"dingtalk",...cfg}); }
  async send(target,message) { return {ok:false,error:"Dingtalk adapter requires external API configuration"}; }
}
module.exports = { DingtalkAdapter };
