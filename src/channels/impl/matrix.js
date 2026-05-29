"use strict";
const { ChannelAdapter } = require("../adapter");
class MatrixAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"matrix",...cfg}); }
  async send(target,message) { return {ok:false,error:"Matrix adapter requires external API configuration"}; }
}
module.exports = { MatrixAdapter };
