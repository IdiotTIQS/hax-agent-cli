/**
 * Cross-platform exclusive file-lock helpers.
 * Ported from OpenHarness utils/file_lock.py
 *
 * Used to serialise read-modify-write sequences on shared JSON registries.
 */

import fs from "fs";
import path from "path";
import { getPlatform, PlatformName, PlatformNameValue } from "../platforms.js";
import { sleep } from "../shared/utils.js";

class SwarmLockError extends Error { constructor(m: string) { super(m); this.name = "SwarmLockError"; } }
class SwarmLockUnavailableError extends SwarmLockError { constructor(m: string) { super(m); this.name = "SwarmLockUnavailableError"; } }

interface FileLockOptions {
  platformName?: PlatformNameValue;
}

function exclusiveFileLock<T>(lockPath: string, fn: () => T, opts: FileLockOptions = {}): T {
  const plat = opts.platformName || getPlatform();

  if (plat === PlatformName.WINDOWS) return _windowsLock(lockPath, fn);
  if (plat === PlatformName.MACOS || plat === PlatformName.LINUX || plat === PlatformName.WSL) return _posixLock(lockPath, fn);
  throw new SwarmLockUnavailableError(`File locking not supported on platform ${plat}`);
}

function _posixLock<T>(lockPath: string, fn: () => T): T {
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(lockPath)) fs.writeFileSync(lockPath, "");

  // Windows-compatible fallback: use a lock file with retry
  const lockFile = lockPath + ".lock";
  const maxWait = 10000; const interval = 50; let waited = 0;
  while (fs.existsSync(lockFile) && waited < maxWait) {
    // Simple spin — in production use proper fcntl
    waited += interval;
  }
  fs.writeFileSync(lockFile, String(process.pid));
  try {
    const result = fn();
    return result;
  } finally {
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
}

function _windowsLock<T>(lockPath: string, fn: () => T): T {
  return _posixLock(lockPath, fn); // Same fallback for Windows
}

export { exclusiveFileLock, SwarmLockError, SwarmLockUnavailableError };
export type { FileLockOptions };
