import { loadClaudeMd } from "./claudemd.js";
import { buildEnvironmentContext } from "./environment.js";
function buildPromptContext(cwd?: string): string { const sections: string[] = []; const sources=loadClaudeMd(cwd); if(sources.length) { sections.push("<project_context>"); for(const s of sources.slice(0,2)) sections.push(s.content); sections.push("</project_context>"); } sections.push("<environment>\n"+buildEnvironmentContext()+"\n</environment>"); return sections.join("\n"); }
export { buildPromptContext };
