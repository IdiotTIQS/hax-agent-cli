import { ChannelAdapter } from "../adapter.js";
class FeishuAdapter extends ChannelAdapter {
  constructor(cfg={}) { super({name:"feishu",...cfg}); this._appId=cfg.appId||""; this._appSecret=cfg.appSecret||""; this._domain=cfg.domain||"https://open.feishu.cn"; }
  async send(target,message) {
    if(!this._appId||!this._appSecret) return {ok:false,error:"Feishu credentials not configured"};
    try {
      const tr=await fetch(this._domain+"/open-apis/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:this._appId,app_secret:this._appSecret})});
      const td=/** @type {any} */(await tr.json());
      if(!td.tenant_access_token) return {ok:false,error:"Failed to get Feishu token"};
      const text=(typeof message==="string"?message:message.text||"").slice(0,30000);
      const r=await fetch(this._domain+"/open-apis/im/v1/messages?receive_id_type=chat_id",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+td.tenant_access_token},body:JSON.stringify({receive_id:target||"",msg_type:"text",content:JSON.stringify({text})})});
      return {ok:r.ok,status:r.status};
    } catch(e) { return {ok:false,error:e.message}; }
  }
}
export { FeishuAdapter };
