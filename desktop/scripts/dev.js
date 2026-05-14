"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const rendererConfig = path.join(root, "desktop", "renderer", "vite.config.js");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(root, "node_modules", "electron", "cli.js");
const devUrl = process.env.HAX_AGENT_DESKTOP_URL || "http://127.0.0.1:5173";
const parsedDevUrl = new URL(devUrl);
const devPort = parsedDevUrl.port || (parsedDevUrl.protocol === "https:" ? "443" : "80");

const vite = spawn(process.execPath, [
  viteBin,
  "--config",
  rendererConfig,
  "--host",
  parsedDevUrl.hostname,
  "--port",
  devPort,
  "--strictPort",
], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    HAX_AGENT_DESKTOP_URL: devUrl,
  },
  windowsHide: true,
});

let electron = null;
let stopping = false;

function startElectron() {
  electron = spawn(process.execPath, [electronBin, "desktop/main/index.js"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HAX_AGENT_DESKTOP_URL: devUrl,
    },
    windowsHide: true,
  });

  electron.on("exit", (code) => {
    if (!stopping) {
      stopping = true;
      vite.kill();
      process.exit(code || 0);
    }
  });
}

function waitForDevServer(deadline = Date.now() + 30_000) {
  return new Promise((resolve, reject) => {
    function probe() {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for Vite dev server at ${devUrl}`));
        return;
      }

      const request = http.get(devUrl, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        setTimeout(probe, 150);
      });
      request.setTimeout(1000, () => {
        request.destroy();
      });
    }

    probe();
  });
}

waitForDevServer()
  .then(() => {
    if (!stopping) startElectron();
  })
  .catch((error) => {
    console.error(error.message);
    stop();
    process.exit(1);
  });

function stop() {
  if (stopping) return;
  stopping = true;
  if (electron) electron.kill();
  vite.kill();
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

vite.on("exit", (code) => {
  if (!stopping) {
    stopping = true;
    if (electron) electron.kill();
    process.exit(code || 0);
  }
});
