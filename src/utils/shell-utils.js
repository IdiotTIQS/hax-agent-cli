"use strict";

/**
 * Shared shell and subprocess helpers.
 * Ported from OpenHarness utils/shell.py
 */

const { spawn } = require("child_process");
const path = require("path");
const { getPlatform, PlatformName } = require("../platforms");

function resolveShellCommand(command, opts = {}) {
  const plat = opts.platformName || getPlatform();

  if (plat === PlatformName.WINDOWS) {
    // Try bash first (Git Bash, WSL bash)
    const bash = _which("bash");
    if (bash && _bashIsUsable(bash)) return { argv: [bash, "-lc", command], shell: "bash" };
    // Try PowerShell
    const pwsh = _which("pwsh") || _which("powershell");
    if (pwsh) return { argv: [pwsh, "-NoLogo", "-NoProfile", "-Command", command], shell: "powershell" };
    // Fallback to cmd
    return { argv: ["cmd.exe", "/d", "/s", "/c", command], shell: "cmd" };
  }

  const bash = _which("bash");
  if (bash) return { argv: [bash, "-lc", command], shell: "bash" };
  const sh = _which("sh") || process.env.SHELL || "/bin/sh";
  return { argv: [sh, "-lc", command], shell: "sh" };
}

function spawnShell(command, opts = {}) {
  const { argv } = resolveShellCommand(command, opts);
  const cwd = opts.cwd || process.cwd();
  return spawn(argv[0], argv.slice(1), {
    cwd, stdio: opts.stdio || "pipe",
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs || 30000,
  });
}

function _which(cmd) {
  try {
    const result = require("child_process").execSync(
      process.platform === "win32" ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    return result.split("\n")[0] || null;
  } catch (_) { return null; }
}

function _bashIsUsable(bashPath) {
  try {
    const result = require("child_process").spawnSync(bashPath, ["-lc", "exit 0"], { timeout: 5000 });
    return result.status === 0;
  } catch (_) { return false; }
}

module.exports = { resolveShellCommand, spawnShell };
