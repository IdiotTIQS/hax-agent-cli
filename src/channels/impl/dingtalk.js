import { ChannelAdapter } from "../adapter.js";
class DingtalkAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"dingtalk",...cfg}); }
  async send(target,message) { return {ok:false,error:"Dingtalk adapter requires external API configuration"}; }
}
export { DingtalkAdapter };
