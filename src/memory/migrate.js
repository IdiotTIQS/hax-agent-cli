"use strict";
const fs = require("fs"); const path = require("path"); const { getMemoryDir } = require("./memdir");
function migrateLegacyMemories() { const dir=getMemoryDir(); const legacy=path.join(dir,"memories.json");
  if(!fs.existsSync(legacy)) return {migrated:0};
  try { const data=JSON.parse(fs.readFileSync(legacy,"utf-8")); let count=0;
    for(const m of (data.memories||data)) { const fp=path.join(dir,(m.id||m.name||"mem_"+count)+".md"); if(!fs.existsSync(fp)) { fs.writeFileSync(fp,"---\ntitle: "+(m.title||m.name||"")+"\ncategory: "+(m.category||"user_preference")+"\n---\n\n"+(m.content||"")); count++; } }
    fs.renameSync(legacy,legacy+".bak"); return {migrated:count}; }
  catch(_) { return {migrated:0,error:_.message}; }
}
module.exports = { migrateLegacyMemories };
