"use strict";
const fs = require("fs"); const path = require("path");
function generateRules(facts) { const groups = {}; for (const f of facts) { const label = f.label || f.type || "General"; if (!groups[label]) groups[label] = []; groups[label].push(f.value || f); } const lines = ["# Environment Rules", "Generated: " + new Date().toISOString(), ""]; for (const [label, values] of Object.entries(groups)) { lines.push("## " + label); for (const v of [...new Set(values)].slice(0, 10)) lines.push("- " + v); lines.push(""); } return lines.join("\n"); }
function saveRules(cwd, markdown) { const dir = path.join(cwd || process.cwd(), ".hax-agent"); if (!fs.existsSync(dir)) fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "rules.md"), markdown); }
module.exports = { generateRules, saveRules };
