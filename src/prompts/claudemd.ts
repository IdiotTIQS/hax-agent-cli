import fs from "fs";
import path from "path";
const PROMPT_FILES = ["CLAUDE.md","AGENTS.md","HAX.md","GEMINI.md","README.md"];
function loadClaudeMd(cwd) { const sources=[]; let current=path.resolve(cwd||process.cwd());
  while(current!==path.dirname(current)) { for(const fn of PROMPT_FILES) { const fp=path.join(current,fn); if(fs.existsSync(fp)) { try { sources.push({file:fp,content:fs.readFileSync(fp,"utf-8").slice(0,20000)}); } catch(_) {} } } current=path.dirname(current); }
  return sources; }
export { loadClaudeMd, PROMPT_FILES };
