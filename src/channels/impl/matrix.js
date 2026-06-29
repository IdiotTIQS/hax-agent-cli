import { ChannelAdapter } from "../adapter.js";
class MatrixAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"matrix",...cfg}); }
  async send(target,message) { return {ok:false,error:"Matrix adapter requires external API configuration"}; }
}
export { MatrixAdapter };
