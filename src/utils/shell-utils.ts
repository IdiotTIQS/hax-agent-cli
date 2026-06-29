/**
 * Shared shell and subprocess helpers.
 * Ported from OpenHarness utils/shell.py
 */

import { spawn, execSync, spawnSync, ChildProcess, StdioOptions } from "child_process";
import path from "path";
import { getPlatform, PlatformName, PlatformNameValue } from "../platforms.js";

interface ResolveShellOptions {
  platformName?: PlatformNameValue;
}

interface ResolvedShellCommand {
  argv: string[];
  shell: string;
}

interface SpawnShellOptions {
  platformName?: PlatformNameValue;
  cwd?: string;
  stdio?: StdioOptions;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function resolveShellCommand(command: string, opts: ResolveShellOptions = {}): ResolvedShellCommand {
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

function spawnShell(command: string, opts: SpawnShellOptions = {}): ChildProcess {
  const { argv } = resolveShellCommand(command, opts);
  const cwd = opts.cwd || process.cwd();
  return spawn(argv[0], argv.slice(1), {
    cwd, stdio: opts.stdio || "pipe",
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs || 30000,
  });
}

function _which(cmd: string): string | null {
  try {
    const result = execSync(
      process.platform === "win32" ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    return result.split("\n")[0] || null;
  } catch (_) { return null; }
}

function _bashIsUsable(bashPath: string): boolean {
  try {
    const result = spawnSync(bashPath, ["-lc", "exit 0"], { timeout: 5000 });
    return result.status === 0;
  } catch (_) { return false; }
}

export { resolveShellCommand, spawnShell };
export type { ResolveShellOptions, ResolvedShellCommand, SpawnShellOptions };
