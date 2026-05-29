"use strict";
const { ChannelAdapter } = require("../adapter");
class TelegramAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"telegram",...cfg}); this._token=cfg.token||""; }
  async send(target,message) {
    if(!this._token) return {ok:false,error:"Telegram token not configured"};
    try { const r=await fetch("https://api.telegram.org/bot"+this._token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:target||"",text:(typeof message==="string"?message:message.text||"").slice(0,4096)})}); return {ok:r.ok,status:r.status}; }
    catch(e) { return {ok:false,error:e.message}; }
  }
}
module.exports = { TelegramAdapter };
