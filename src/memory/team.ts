import path from "path"; import fs from "fs"; import os from "os";
function getTeamMemoryDir(teamName: string) { const d=path.join(os.homedir(),".haxagent","teams",teamName,"memory"); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function saveTeamMemory(teamName: string, memory: Record<string, unknown>) { const dir=getTeamMemoryDir(teamName); const fp=path.join(dir,((memory.id as string)||Date.now().toString(36))+".json"); fs.writeFileSync(fp,JSON.stringify(memory,null,2)); return fp; }
function loadTeamMemories(teamName: string) { const dir=getTeamMemoryDir(teamName); if(!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter((f: string)=>f.endsWith(".json")).map((f: string)=>JSON.parse(fs.readFileSync(path.join(dir,f),"utf-8"))); }
export { getTeamMemoryDir, saveTeamMemory, loadTeamMemories };
