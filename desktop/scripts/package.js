"use strict";

/**
 * package.js — Desktop distribution validation and instructions
 *
 * Run:  node desktop/scripts/package.js
 *
 * This script does NOT install packaging dependencies. Instead it:
 *  1. Validates that all runtime prerequisites exist
 *  2. Verifies the renderer build is current
 *  3. Prints platform-specific packaging instructions
 *
 * Add any of these to devDependencies for one-step packaging:
 *   • electron-builder      (npm install --save-dev electron-builder)
 *   • @electron/packager    (npm install --save-dev @electron/packager)
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

// Paths that every desktop distribution must include
const requiredFiles = [
  {
    label: "Electron main process",
    path: path.join(root, "desktop", "main", "index.js"),
  },
  {
    label: "Preload script",
    path: path.join(root, "desktop", "preload", "index.js"),
  },
  {
    label: "Renderer build (index.html)",
    path: path.join(root, "desktop", "renderer", "dist", "index.html"),
  },
  {
    label: "Renderer build (JS bundle)",
    path: path.join(root, "desktop", "renderer", "dist", "assets"),
  },
];

// Also required at runtime by the main process
const mainRequires = [
  { label: "src/agent-engine.js", path: path.join(root, "src", "agent-engine.js") },
  { label: "src/config.js", path: path.join(root, "src", "config.js") },
  { label: "src/session.js", path: path.join(root, "src", "session.js") },
  { label: "src/hub.js", path: path.join(root, "src", "hub.js") },
  { label: "src/permissions.js", path: path.join(root, "src", "permissions.js") },
  { label: "src/providers/", path: path.join(root, "src", "providers") },
  { label: "src/tools/", path: path.join(root, "src", "tools") },
  { label: "src/teams/tools.js", path: path.join(root, "src", "teams", "tools.js") },
  { label: "src/shared/serialization.js", path: path.join(root, "src", "shared", "serialization.js") },
  { label: "src/desktop-services.js", path: path.join(root, "src", "desktop-services.js") },
  { label: "src/undo-stack.js", path: path.join(root, "src", "undo-stack.js") },
  { label: "src/context-compaction.js", path: path.join(root, "src", "context-compaction.js") },
  { label: "src/context-window.js", path: path.join(root, "src", "context-window.js") },
];

// -- helpers ------------------------------------------------------------

function fail(message) {
  console.error(`\n  [ERROR] ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`  [WARN]  ${message}`);
}

function ok(message) {
  console.log(`  [OK]    ${message}`);
}

// -- checks -------------------------------------------------------------

console.log("\n=== HaxAgent Desktop — Distribution Readiness ===\n");

let missing = 0;

for (const file of requiredFiles) {
  if (fs.existsSync(file.path)) {
    ok(file.label);
  } else {
    missing += 1;
    fail(`Missing: ${file.label}\n          ${file.path}`);
  }
}

console.log("\n  --- Runtime module dependencies ---\n");

for (const dep of mainRequires) {
  if (fs.existsSync(dep.path)) {
    ok(dep.label);
  } else {
    missing += 1;
    fail(`Missing: ${dep.label}\n          ${dep.path}`);
  }
}

// -- build freshness ----------------------------------------------------
const distHtml = path.join(root, "desktop", "renderer", "dist", "index.html");
const distStat = fs.statSync(distHtml);
const distTime = distStat.mtimeMs;

const rendererSrcDir = path.join(root, "desktop", "renderer", "src");
let sourcesModifiedAfterBuild = [];

function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (/\.(vue|js|mjs|css|html)$/.test(entry.name)) {
      const stat = fs.statSync(full);
      if (stat.mtimeMs > distTime) {
        sourcesModifiedAfterBuild.push(path.relative(root, full));
      }
    }
  }
}

if (fs.existsSync(rendererSrcDir)) {
  scanDir(rendererSrcDir);
}

console.log("\n  --- Build freshness ---\n");

if (sourcesModifiedAfterBuild.length > 0) {
  warn(`Dist is older than ${sourcesModifiedAfterBuild.length} source file(s):`);
  for (const f of sourcesModifiedAfterBuild.slice(0, 10)) {
    console.error(`         ${f}`);
  }
  if (sourcesModifiedAfterBuild.length > 10) {
    console.error(`         ... and ${sourcesModifiedAfterBuild.length - 10} more`);
  }
  warn("Run `npm run desktop:build` to rebuild the renderer before packaging.");
} else {
  ok("Dist is up to date with renderer sources.");
}

// -- Electron version ---------------------------------------------------

const electronPkgPath = path.join(root, "node_modules", "electron", "package.json");
let electronVersion = "unknown";
if (fs.existsSync(electronPkgPath)) {
  electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, "utf-8")).version;
}

console.log("\n  --- Environment ---\n");
console.log(`  Electron:   ${electronVersion}`);
console.log(`  Platform:   ${process.platform} (${process.arch})`);
console.log(`  Node.js:    ${process.version}`);
console.log(`  App name:   ${pkg.name}`);
console.log(`  App ver:    ${pkg.version}`);

// -- packaging instructions ---------------------------------------------

const electronMajor = parseInt(String(electronVersion).split(".")[0], 10) || 37;

console.log("\n=== Packaging Instructions ===\n");

console.log("  No packaging tool is currently installed. Choose one:\n");

console.log("  Option A — electron-builder (recommended, most features):");
console.log("    npm install --save-dev electron-builder\n");
console.log("    Then add to package.json:");
console.log('    "build": {');
console.log('      "appId": "com.haxagent.app",');
console.log('      "productName": "HaxAgent",');
console.log('      "directories": { "output": "release" },');
console.log('      "files": [');
console.log('        "desktop/main/**/*",');
console.log('        "desktop/preload/**/*",');
console.log('        "desktop/renderer/dist/**/*",');
console.log('        "src/**/*.js",');
console.log('        "desktop/services/**/*.js"');
console.log('      ],');
console.log(`      "electronVersion": "${electronVersion}"`);
console.log('    }\n');
console.log("    Then:  npx electron-builder --win --mac --linux");

  console.log("\n  Option B — @electron/packager (simpler, just bundles files):");
  console.log("    npm install --save-dev @electron/packager\n");
  console.log("    npx @electron/packager . HaxAgent \\");
  console.log("      --platform=win32 \\");
  console.log(`      --electron-version=${electronVersion} \\`);
  console.log("      --out=release \\");
  console.log("      --overwrite \\");
  console.log("      --ignore='node_modules/(?!electron)'");

  console.log("\n  Option C — Manual distribution (no extra tooling):");
  console.log("    1. Ensure renderer is built:   npm run desktop:build");
  console.log("    2. Copy these to a folder:");
  console.log("       - desktop/main/");
  console.log("       - desktop/preload/");
  console.log("       - desktop/renderer/dist/");
  console.log("       - src/");
  console.log("       - node_modules/ (or bundle with a packager)");
  console.log("       - package.json");
  console.log("    3. Users launch with:  npx electron desktop/main/index.js");
  console.log("       (Electron must be installed globally or bundled)");

if (missing > 0) {
  console.log(`\n  [FAIL] ${missing} required file(s) missing. Fix before packaging.\n`);
  process.exit(1);
} else {
  console.log("\n  [READY] All required files present.\n");
}
