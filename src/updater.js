"use strict";

const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const REGISTRY_URL = "https://registry.npmjs.org/hax-agent-cli/latest";
const CACHE_FILE = path.join(os.homedir(), ".hax-agent", "update-cache.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    const request = https.get(REGISTRY_URL, { timeout: 5000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`npm registry returned ${response.statusCode}`));
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve(data.version);
        } catch (err) {
          reject(new Error("Failed to parse npm registry response"));
        }
      });
    });
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Request to npm registry timed out"));
    });
  });
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(data) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // best effort
  }
}

async function checkForUpdate(currentVersion, { force = false } = {}) {
  const result = {
    currentVersion,
    latestVersion: null,
    hasUpdate: false,
    checkedAt: null,
    error: null,
  };

  try {
    if (!force) {
      const cache = await readCache();
      if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
        result.latestVersion = cache.latestVersion;
        result.hasUpdate = compareVersions(cache.latestVersion, currentVersion) > 0;
        result.checkedAt = cache.checkedAt;
        return result;
      }
    }

    const latestVersion = await fetchLatestVersion();
    const now = Date.now();

    await writeCache({ latestVersion, checkedAt: now });

    result.latestVersion = latestVersion;
    result.hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
    result.checkedAt = now;
  } catch (err) {
    result.error = err.message;

    const cache = await readCache();
    if (cache) {
      result.latestVersion = cache.latestVersion;
      result.hasUpdate = compareVersions(cache.latestVersion, currentVersion) > 0;
      result.checkedAt = cache.checkedAt;
    }
  }

  return result;
}

function performUpdate() {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "-g", "hax-agent-cli"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (err) => {
      reject(new Error(`Failed to run npm: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        reject(new Error(stderr.trim() || `npm install exited with code ${code}`));
      }
    });
  });
}

function restartProcess() {
  const args = process.argv.slice(2);
  const child = spawn(process.argv[0], [process.argv[1], ...args], {
    stdio: "inherit",
    env: { ...process.env, HAX_AGENT_RESTARTED: "1" },
    detached: true,
  });
  child.unref();
  process.exit(0);
}

function wasRestarted() {
  return process.env.HAX_AGENT_RESTARTED === "1";
}

module.exports = { checkForUpdate, parseSemver, compareVersions, performUpdate, restartProcess, wasRestarted };
