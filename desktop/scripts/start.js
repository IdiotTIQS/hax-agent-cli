"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(root, "node_modules", "electron", "cli.js");
const rendererConfig = path.join(root, "desktop", "renderer", "vite.config.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status || 0;
}

const buildCode = run(process.execPath, [viteBin, "build", "--config", rendererConfig]);
if (buildCode !== 0) {
  process.exit(buildCode);
}

const electronCode = run(process.execPath, [electronBin, "desktop/main/index.js"], {
  env: {
    ...process.env,
    HAX_AGENT_DESKTOP_MODE: "production",
  },
});

process.exit(electronCode);
