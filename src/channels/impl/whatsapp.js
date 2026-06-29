import { ChannelAdapter } from "../adapter.js";
class WhatsappAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"whatsapp",...cfg}); }
  async send(target,message) { return {ok:false,error:"Whatsapp adapter requires external API configuration"}; }
}
export { WhatsappAdapter };
