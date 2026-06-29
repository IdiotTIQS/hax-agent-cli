import { ChannelAdapter } from "../adapter.js";
class WechatAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"wechat",...cfg}); }
  async send(target,message) { return {ok:false,error:"Wechat adapter requires external API configuration"}; }
}
export { WechatAdapter };
