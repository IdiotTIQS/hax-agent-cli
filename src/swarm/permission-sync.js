"use strict";
const fs = require("fs"); const path = require("path"); const os = require("os");
function syncPermissionMode(mode, teamName, agentName) { const tn = teamName || process.env.CLAUDE_CODE_TEAM_NAME || "default"; const an = agentName || process.env.CLAUDE_CODE_AGENT_NAME; if (!tn || !an) return false; const dir = path.join(os.homedir(), ".haxagent", "teams", tn); if (!fs.existsSync(dir)) return false; const fp = path.join(dir, "team.json"); if (!fs.existsSync(fp)) return false; try { const team = JSON.parse(fs.readFileSync(fp, "utf-8")); for (const [id, m] of Object.entries(team.members || {})) { if (m.name === an) { m.mode = mode; fs.writeFileSync(fp, JSON.stringify(team, null, 2)); return true; } } } catch (_) {} return false; }
module.exports = { syncPermissionMode };
