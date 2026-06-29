import path from "path"; import os from "os"; import fs from "fs";
function getMemoryDir() { const d=path.join(os.homedir(),".haxagent","memory"); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function getMemoryFilePath(id) { return path.join(getMemoryDir(),id+".md"); }
export { getMemoryDir, getMemoryFilePath };
