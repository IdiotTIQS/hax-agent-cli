import { loadClaudeMd } from "./claudemd.js";
import { buildEnvironmentContext } from "./environment.js";
function buildSystemPrompt(base?: string, cwd?: string): string { const sections: string[]=[base||"You are Hax Agent, a professional AI coding assistant."]; const sources=loadClaudeMd(cwd); if(sources.length) { sections.push("\n<project_context>"); for(const s of sources.slice(0,2)) sections.push(s.content); sections.push("</project_context>"); } sections.push("\n<environment>\n"+buildEnvironmentContext()+"\n</environment>"); return sections.join("\n"); }
export { buildSystemPrompt };
