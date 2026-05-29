"use strict";
const { ChannelAdapter } = require("../adapter");
class QqAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"qq",...cfg}); }
  async send(target,message) { return {ok:false,error:"Qq adapter requires external API configuration"}; }
}
module.exports = { QqAdapter };
