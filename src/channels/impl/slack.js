"use strict";
const { ChannelAdapter } = require("../adapter");
class SlackAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"slack",...cfg}); this._botToken=cfg.botToken||""; }
  async send(target,message) {
    if(!this._botToken) return {ok:false,error:"Slack bot token not configured"};
    try { const r=await fetch("https://slack.com/api/chat.postMessage",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+this._botToken},body:JSON.stringify({channel:target||"general",text:(typeof message==="string"?message:message.text||"").slice(0,40000)})}); return {ok:r.ok,status:r.status}; }
    catch(e) { return {ok:false,error:e.message}; }
  }
}
module.exports = { SlackAdapter };
