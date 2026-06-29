/**
 * Platform detection and capability matrix.
 * Ported from OpenHarness platforms.py
 */

import os from "os";
import process from "process";

const PlatformName = {
  MACOS: "macos", LINUX: "linux", WINDOWS: "windows", WSL: "wsl", UNKNOWN: "unknown",
};

function detectPlatform() {
  const system = process.platform;
  if (system === "darwin") return PlatformName.MACOS;
  if (system === "win32") {
    const release = os.release().toLowerCase();
    if (release.includes("microsoft") || process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return PlatformName.WSL;
    return PlatformName.WINDOWS;
  }
  if (system === "linux") return PlatformName.LINUX;
  return PlatformName.UNKNOWN;
}

let _cached = null;
function getPlatform() { if (!_cached) _cached = detectPlatform(); return _cached; }

function getPlatformCapabilities(name) {
  const n = name || getPlatform();
  const posix = n === PlatformName.MACOS || n === PlatformName.LINUX || n === PlatformName.WSL;
  return {
    name: n,
    supportsPosixShell: posix,
    supportsNativeWindowsShell: n === PlatformName.WINDOWS,
    supportsTmux: posix,
    supportsSwarmMailbox: posix,
    supportsSandboxRuntime: posix,
    supportsDockerSandbox: posix,
  };
}

export { PlatformName, detectPlatform, getPlatform, getPlatformCapabilities };
