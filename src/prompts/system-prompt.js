"use strict";
const { loadClaudeMd } = require("./claudemd");
const { buildEnvironmentContext } = require("./environment");
function buildSystemPrompt(base,cwd) { const sections=[base||"You are Hax Agent, a professional AI coding assistant."]; const sources=loadClaudeMd(cwd); if(sources.length) { sections.push("\n<project_context>"); for(const s of sources.slice(0,2)) sections.push(s.content); sections.push("</project_context>"); } sections.push("\n<environment>\n"+buildEnvironmentContext()+"\n</environment>"); return sections.join("\n"); }
module.exports = { buildSystemPrompt };
