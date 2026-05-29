"use strict";
const { ChannelAdapter } = require("../adapter");
class EmailAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"email",...cfg}); }
  async send(target,message) { return {ok:false,error:"Email adapter requires external API configuration"}; }
}
module.exports = { EmailAdapter };
