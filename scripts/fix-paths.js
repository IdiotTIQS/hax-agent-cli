"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "E:/HaxAgent/src";

// Old dir names → relative path prefix to prepend
const DIR_MOVED = new Set([
  "memory", "context", "consolidation", "extraction", "preserve", "pruning",
  "conversation", "tokens", "events", "prompts", "personality", "plugins",
  "commands", "tui",
  "safety", "security", "compliance", "governance", "rbac", "trust",
  "sandbox", "bridge", "ci", "platform", "gateway", "resilience",
  "infrastructure", "observability", "injection", "hotreload", "recorder",
  "scheduler", "runtime", "workflow", "streaming", "synthesis", "compat",
  "review", "quality", "improvement", "regression", "benchmark", "explain",
  "diff", "diagram", "codegen", "visualize", "generator", "testing", "sim",
  "data", "cache", "replay", "contracts", "similarity", "search", "intel",
  "nlp", "resources", "protocol",
  "teams", "coordination", "debate", "handoff", "ownership", "collab",
  "goals", "tasks", "planner", "strategy", "capability", "reinforcement",
  "training", "hub",
  "state", "isolate", "workspace", "branches", "files", "migration", "optimizer",
  "notify", "watcher", "logs", "dashboard", "analytics", "health",
  "multimodal", "artifact", "docs", "tutorial",
  "i18n", "knowledge", "marketplace", "graph",
]);

let fixed = 0;
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      walk(full);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      fixed += fixFile(full);
    }
  }
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  let modified = false;

  // Fix require("./dir/...") or require("../dir/...")
  content = content.replace(/require\((["'])(\.\.?\/)([^"']+)\1\)/g, (match, quote, prefix, rest) => {
    const dir = rest.split("/")[0];
    if (DIR_MOVED.has(dir)) {
      modified = true;
      return `require(${quote}${prefix}../${rest}${quote})`;
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(filePath, content, "utf-8");
  }
  return modified ? 1 : 0;
}

walk(SRC);
console.log(`Fixed ${fixed} files`);
