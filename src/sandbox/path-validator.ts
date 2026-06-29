/**
 * Path validator for sandbox operations.
 * Ported from OpenHarness sandbox/path_validator.py
 */

import path from "path";
import fs from "fs";

const SENSITIVE_PATHS = [
  "/etc/passwd", "/etc/shadow", "/etc/sudoers", "/etc/ssh",
  "~/.ssh", "~/.gnupg", "~/.aws", "~/.config",
  "/proc", "/sys", "/dev",
  "C:\Windows\System32", "C:\Windows\System",
];

class PathViolationError extends Error { constructor(m) { super(m); this.name = "PathViolationError"; } }

function validateWorkspacePath(targetPath, workspaceRoot) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot || process.cwd());
  if (resolved.includes("..")) {
    const normalized = path.normalize(resolved);
    if (!normalized.startsWith(root)) throw new PathViolationError(`Path traversal detected: ${targetPath}`);
  }
  if (!resolved.startsWith(root)) throw new PathViolationError(`Path outside workspace: ${targetPath}`);
  return resolved;
}

function isSensitivePath(targetPath) {
  const resolved = path.resolve(targetPath).toLowerCase();
  for (const sp of SENSITIVE_PATHS) {
    if (resolved.startsWith(path.resolve(sp).toLowerCase())) return true;
  }
  return false;
}

function validatePath(targetPath, workspaceRoot) {
  const resolved = validateWorkspacePath(targetPath, workspaceRoot);
  if (isSensitivePath(resolved)) throw new PathViolationError(`Sensitive path: ${targetPath}`);
  return resolved;
}

export { validateWorkspacePath, isSensitivePath, validatePath, PathViolationError, SENSITIVE_PATHS };
