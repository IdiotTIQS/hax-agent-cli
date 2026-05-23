"use strict";

const os = require("node:os");
const path = require("node:path");

/**
 * Platform detection and OS-specific information.
 *
 * Provides a single source of truth for OS checks used throughout
 * the codebase instead of scattering process.platform comparisons.
 */

const PLATFORM_MAP = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
  aix: "unknown",
  freebsd: "unknown",
  openbsd: "unknown",
  sunos: "unknown",
};

/**
 * Returns a stable platform name independent of Node's process.platform
 * enumerations.  Supported return values:
 *   'windows' | 'macos' | 'linux' | 'unknown'
 */
function getPlatform() {
  return PLATFORM_MAP[process.platform] || "unknown";
}

/**
 * Returns the CPU architecture reported by Node.
 * Typical values: 'x64', 'arm64', 'ia32', 'ppc64', 's390x'.
 */
function getArch() {
  return process.arch;
}

/** True when running on Windows. */
function isWindows() {
  return process.platform === "win32";
}

/** True when running on macOS. */
function isMacOS() {
  return process.platform === "darwin";
}

/** True when running on Linux. */
function isLinux() {
  return process.platform === "linux";
}

/**
 * Returns the most appropriate shell executable for the current platform.
 *
 * Priority order per platform:
 *   Windows:  pwsh.exe → powershell.exe → cmd.exe
 *   macOS:    zsh → bash → sh
 *   Linux:    bash → sh
 *   Other:    sh
 *
 * The caller can override via the SHELL or COMSPEC environment variables.
 */
function getShell() {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || process.env.COMSPEC;
    if (comspec) return comspec;

    // Prefer PowerShell when available
    const pwsh = _findWindowsShell(["pwsh.exe", "powershell.exe"]);
    if (pwsh) return pwsh;

    return "cmd.exe";
  }

  // Unix — try each common shell in preference order
  const candidates = process.platform === "darwin"
    ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
    : ["/bin/bash", "/bin/sh"];

  for (const candidate of candidates) {
    try {
      if (_isExecutableSync(candidate)) return candidate;
    } catch (_) { /* could not stat */ }
  }

  return candidates[candidates.length - 1]; // fall back to last candidate
}

/**
 * Returns the current user's home directory as a cross-platform normalised path.
 */
function getHomeDir() {
  return path.normalize(os.homedir());
}

/**
 * Returns the system temporary directory as a cross-platform normalised path.
 */
function getTempDir() {
  return path.normalize(os.tmpdir());
}

/**
 * Returns the XDG-compliant (or platform-equivalent) configuration directory.
 *
 * Linux:   $XDG_CONFIG_HOME or ~/.config
 * macOS:   ~/Library/Application Support
 * Windows: %APPDATA% or ~/AppData/Roaming
 *
 * @param {object} [options]
 * @param {string} [options.appName="HaxAgent"] — application sub-directory name
 * @returns {string}
 */
function getConfigDir(options = {}) {
  const appName = options.appName || "HaxAgent";
  const home = getHomeDir();

  if (process.platform === "linux") {
    const xdg = process.env.XDG_CONFIG_HOME;
    const base = xdg ? path.normalize(xdg) : path.join(home, ".config");
    return path.join(base, appName);
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(path.normalize(appData), appName);
  }

  // Generic fallback using XDG convention
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? path.normalize(xdg) : path.join(home, ".config");
  return path.join(base, appName);
}

/**
 * Returns the XDG-compliant (or platform-equivalent) data directory.
 *
 * Linux:   $XDG_DATA_HOME or ~/.local/share
 * macOS:   ~/Library/Application Support
 * Windows: %LOCALAPPDATA% or ~/AppData/Local
 *
 * @param {object} [options]
 * @param {string} [options.appName="HaxAgent"] — application sub-directory name
 * @returns {string}
 */
function getDataDir(options = {}) {
  const appName = options.appName || "HaxAgent";
  const home = getHomeDir();

  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    const base = xdg ? path.normalize(xdg) : path.join(home, ".local", "share");
    return path.join(base, appName);
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(path.normalize(localAppData), appName);
  }

  // Generic fallback
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ? path.normalize(xdg) : path.join(home, ".local", "share");
  return path.join(base, appName);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk the PATH looking for a candidate executable on Windows.
 * Returns the first match or null.
 */
function _findWindowsShell(candidates) {
  const envPath = process.env.PATH || "";
  const dirs = envPath.split(path.delimiter).filter(Boolean);

  for (const candidate of candidates) {
    for (const dir of dirs) {
      const full = path.join(dir, candidate);
      try {
        if (_isExecutableSync(full)) return full;
      } catch (_) { /* inaccessible */ }
    }
  }

  return null;
}

function _isExecutableSync(filePath) {
  try {
    const stat = require("node:fs").statSync(filePath);
    return stat.isFile();
  } catch (_) {
    return false;
  }
}

module.exports = {
  getPlatform,
  getArch,
  isWindows,
  isMacOS,
  isLinux,
  getShell,
  getHomeDir,
  getTempDir,
  getConfigDir,
  getDataDir,
};
