"use strict";
const path = require("path"); const fs = require("fs"); const os = require("os");
function getTeamMemoryDir(teamName) { const d=path.join(os.homedir(),".haxagent","teams",teamName,"memory"); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function saveTeamMemory(teamName,memory) { const dir=getTeamMemoryDir(teamName); const fp=path.join(dir,(memory.id||Date.now().toString(36))+".json"); fs.writeFileSync(fp,JSON.stringify(memory,null,2)); return fp; }
function loadTeamMemories(teamName) { const dir=getTeamMemoryDir(teamName); if(!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),"utf-8"))); }
module.exports = { getTeamMemoryDir, saveTeamMemory, loadTeamMemories };
