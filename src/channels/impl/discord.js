import { ChannelAdapter } from "../adapter.js";
class DiscordAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"discord",...cfg}); this._token=cfg.token||""; }
  async send(target,message) {
    if(!this._token) return {ok:false,error:"Discord token not configured"};
    try { const r=await fetch("https://discord.com/api/v10/channels/"+(target||"0")+"/messages",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bot "+this._token},body:JSON.stringify({content:(typeof message==="string"?message:message.text||"").slice(0,2000)})}); return {ok:r.ok,status:r.status}; }
    catch(e) { return {ok:false,error:e.message}; }
  }
}
export { DiscordAdapter };
