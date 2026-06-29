import { ChannelAdapter } from "../adapter.js";
class QqAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"qq",...cfg}); }
  async send(target,message) { return {ok:false,error:"Qq adapter requires external API configuration"}; }
}
export { QqAdapter };
