"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  ".claude",
  "node_modules",
  "dist",
  "coverage",
]);
const checkedExtensions = new Set([".js", ".mjs"]);
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walk(path.join(directory, entry.name));
      continue;
    }

    if (!entry.isFile()) continue;
    const fullPath = path.join(directory, entry.name);
    if (checkedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
}

walk(root);

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || `${file} failed syntax check\n`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} files.`);
