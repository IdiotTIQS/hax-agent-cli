"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "E:/HaxAgent/src";

function copyDirSync(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// === Target structure ===
const MOVE_MAP = {
  // core/
  "memory": "core/memory", "context": "core/context", "consolidation": "core/consolidation",
  "extraction": "core/extraction", "preserve": "core/preserve", "pruning": "core/pruning",
  "conversation": "core/conversation", "tokens": "core/tokens", "events": "core/events",
  "prompts": "core/prompts", "personality": "core/personality", "plugins": "core/plugins",
  "agent-engine.js": "core/agent-engine.js", "session.js": "core/session.js",
  "session-bootstrap.js": "core/session-bootstrap.js", "session-utils.js": "core/session-utils.js",
  "config.js": "core/config.js", "config-validator.js": "core/config-validator.js",
  "permissions.js": "core/permissions.js", "context-compaction.js": "core/context-compaction.js",
  "context-window.js": "core/context-window.js", "context.js": "core/context.js",

  // cli/
  "commands": "cli/commands", "tui": "cli/tui",
  "cli.js": "cli/cli.js", "renderer.js": "cli/renderer.js",

  // infra/
  "safety": "infra/safety", "security": "infra/security", "compliance": "infra/compliance",
  "governance": "infra/governance", "rbac": "infra/rbac", "trust": "infra/trust",
  "sandbox": "infra/sandbox", "bridge": "infra/bridge", "ci": "infra/ci",
  "platform": "infra/platform", "gateway": "infra/gateway", "resilience": "infra/resilience",
  "infrastructure": "infra/infrastructure", "observability": "infra/observability",
  "injection": "infra/injection", "hotreload": "infra/hotreload",
  "recorder": "infra/recorder", "scheduler": "infra/scheduler",
  "runtime": "infra/runtime", "workflow": "infra/workflow",
  "streaming": "infra/streaming", "synthesis": "infra/synthesis",
  "compat": "infra/compat", "integrations": "infra/integrations",

  // analysis/
  "review": "analysis/review", "quality": "analysis/quality",
  "improvement": "analysis/improvement", "regression": "analysis/regression",
  "benchmark": "analysis/benchmark", "explain": "analysis/explain",
  "diff": "analysis/diff", "diagram": "analysis/diagram",
  "codegen": "analysis/codegen", "visualize": "analysis/visualize",
  "generator": "analysis/generator", "testing": "analysis/testing", "sim": "analysis/sim",

  // data/
  "data": "data/data", "cache": "data/cache", "replay": "data/replay",
  "contracts": "data/contracts", "similarity": "data/similarity",
  "search": "data/search", "intel": "data/intel", "nlp": "data/nlp",
  "resources": "data/resources", "protocol": "data/protocol",

  // teams/
  "teams": "teams/teams", "coordination": "teams/coordination",
  "debate": "teams/debate", "handoff": "teams/handoff",
  "ownership": "teams/ownership", "collab": "teams/collab",
  "goals": "teams/goals", "tasks": "teams/tasks",
  "planner": "teams/planner", "strategy": "teams/strategy",
  "capability": "teams/capability", "reinforcement": "teams/reinforcement",
  "training": "teams/training", "hub": "teams/hub",

  // state/
  "state": "state/state", "isolate": "state/isolate",
  "workspace": "state/workspace", "branches": "state/branches",
  "files": "state/files", "migration": "state/migration",
  "optimizer": "state/optimizer", "versioning": "state/versioning",

  // output/
  "notify": "output/notify", "watcher": "output/watcher",
  "logs": "output/logs", "dashboard": "output/dashboard",
  "analytics": "output/analytics", "health": "output/health",
  "multimodal": "output/multimodal", "artifact": "output/artifact",
  "docs": "output/docs", "tutorial": "output/tutorial",
  "i18n": "output/i18n", "knowledge": "output/knowledge",
  "marketplace": "output/marketplace", "graph": "output/graph",
};

// Keep as-is
const KEEP = new Set([
  "tools", "providers", "skills", "shared", "utils", "registry",
  "dev-tooling", "cli-utils",
  "batch.js", "undo-stack.js", "debug.js", "shutdown.js",
  "approval-prompt.js", "command-suggestions.js", "config-presets.js",
  "init-wizard.js", "paste-utils.js", "terminal-input.js", "terminal-output.js",
  "updater.js",
]);

// === Phase 1: Build reverse map for path updates ===
function buildReverseMap() {
  const rev = {};
  for (const [old, newPath] of Object.entries(MOVE_MAP)) {
    rev[old] = newPath;
  }
  return rev;
}

// === Phase 2: Update requires in all .js files ===
function updateRequires(filePath, reverseMap) {
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    let modified = false;

    // Replace require("./X") and require("../X") patterns
    content = content.replace(/require\((["'])(\.\.?\/[^"']+)\1\)/g, (match, quote, importPath) => {
      const parts = importPath.split("/");
      const dir = parts[0];

      if (dir === "." || dir === "..") {
        // Relative path that starts with ./ or ../
        // Check if any component matches a moved directory
        for (let i = 0; i < parts.length; i++) {
          const key = parts[i];
          if (reverseMap[key]) {
            parts[i] = reverseMap[key];
            modified = true;
            break;
          }
        }
        return `require(${quote}${parts.join("/")}${quote})`;
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(filePath, content, "utf-8");
      return true;
    }
  } catch (e) {
    console.error(`Error updating ${filePath}: ${e.message}`);
  }
  return false;
}

// === Phase 3: Move files ===
function moveFiles() {
  let moved = 0;
  for (const [old, newPath] of Object.entries(MOVE_MAP)) {
    const srcPath = path.join(SRC, old);
    const dstPath = path.join(SRC, newPath);

    if (!fs.existsSync(srcPath)) continue;

    // Ensure parent dir exists
    const dstDir = path.dirname(dstPath);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

    // Move using copy + delete (avoids EPERM on locked files)
    try {
      // Skip if target already exists
      if (fs.existsSync(dstPath)) {
        console.log(`  SKIP (exists): ${old}`);
        // Delete source if target already there
        if (fs.existsSync(srcPath)) {
          if (fs.lstatSync(srcPath).isDirectory()) fs.rmSync(srcPath, { recursive: true, force: true });
          else fs.unlinkSync(srcPath);
        }
        continue;
      }
      if (fs.lstatSync(srcPath).isDirectory()) {
        copyDirSync(srcPath, dstPath);
        fs.rmSync(srcPath, { recursive: true, force: true });
      } else {
        fs.copyFileSync(srcPath, dstPath);
        fs.unlinkSync(srcPath);
      }
    } catch (e) {
      console.error(`  FAILED: ${old} → ${newPath}: ${e.message}`);
      continue;
    }
    moved++;
    console.log(`  ${old} → ${newPath}`);
  }
  return moved;
}

// === Phase 4: Walk all files and update requires ===
function walkAndUpdate(reverseMap) {
  let updated = 0;
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".js")) {
        if (updateRequires(full, reverseMap)) updated++;
      }
    }
  }
  walk(SRC);
  return updated;
}

// === Main ===
console.log("=== Phase 1: Building reverse map ===");
const reverseMap = buildReverseMap();
console.log(`  ${Object.keys(reverseMap).length} entries`);

console.log("\n=== Phase 2: Moving files ===");
const moved = moveFiles();
console.log(`  Moved ${moved} files/dirs`);

console.log("\n=== Phase 3: Updating require paths ===");
const updated = walkAndUpdate(reverseMap);
console.log(`  Updated ${updated} files`);

console.log("\n=== Phase 4: Cleanup empty dirs ===");
// Remove dirs that are now empty
const dirs = fs.readdirSync(SRC, { withFileTypes: true })
  .filter(e => e.isDirectory() && !KEEP.has(e.name) && !Object.values(MOVE_MAP).some(v => v.startsWith(e.name + "/")));
for (const d of dirs) {
  const p = path.join(SRC, d.name);
  const files = fs.readdirSync(p);
  if (files.length === 0) {
    fs.rmdirSync(p);
    console.log(`  removed empty: ${d.name}/`);
  }
}

console.log("\n=== Done ===");
const remaining = fs.readdirSync(SRC, { withFileTypes: true }).filter(e => e.isDirectory()).length;
console.log(`Top-level dirs: ${remaining}`);
const allDirs = fs.readdirSync(SRC, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
console.log(allDirs.join(", "));
