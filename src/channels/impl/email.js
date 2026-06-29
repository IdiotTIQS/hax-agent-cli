import { ChannelAdapter } from "../adapter.js";
class EmailAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"email",...cfg}); }
  async send(target,message) { return {ok:false,error:"Email adapter requires external API configuration"}; }
}
export { EmailAdapter };
