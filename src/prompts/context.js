"use strict";
const { loadClaudeMd } = require("./claudemd");
const { buildEnvironmentContext } = require("./environment");
function buildPromptContext(cwd) { const sections=[]; const sources=loadClaudeMd(cwd); if(sources.length) { sections.push("<project_context>"); for(const s of sources.slice(0,2)) sections.push(s.content); sections.push("</project_context>"); } sections.push("<environment>\n"+buildEnvironmentContext()+"\n</environment>"); return sections.join("\n"); }
module.exports = { buildPromptContext };
