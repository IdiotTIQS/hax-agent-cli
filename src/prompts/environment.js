"use strict";
const os = require("os");
function buildEnvironmentContext() { const p=[]; p.push("OS: "+process.platform+" "+process.arch); p.push("Shell: "+(process.env.SHELL||"unknown")); p.push("Workspace: "+process.cwd()); p.push("Date: "+new Date().toISOString().split("T")[0]); p.push("Node: "+process.version); if(process.env.VIRTUAL_ENV) p.push("venv: "+process.env.VIRTUAL_ENV); if(process.env.CONDA_DEFAULT_ENV) p.push("conda: "+process.env.CONDA_DEFAULT_ENV); try { const git=require("child_process").execSync("git branch --show-current 2>/dev/null",{encoding:"utf-8",timeout:3000}).trim(); if(git) p.push("Git branch: "+git); } catch(_) {} return p.join("\n"); }
module.exports = { buildEnvironmentContext };
