"use strict";
const fs = require("fs"); const path = require("path"); const { HookDefinition, HookType } = require("./registry");
function loadHooksFromDir(dir) { if(!fs.existsSync(dir)) return []; const hooks=[];
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".json"))) { try { const data=JSON.parse(fs.readFileSync(path.join(dir,f),"utf-8")); for(const h of (Array.isArray(data)?data:[data])) { hooks.push(new HookDefinition({event:h.event,type:h.type||HookType.COMMAND,matcher:h.matcher||null,priority:h.priority||0,command:h.command||null,url:h.url||null})); } } catch(_) {} }
  return hooks; }
module.exports = { loadHooksFromDir };
