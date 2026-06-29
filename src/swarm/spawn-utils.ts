/** Spawning helpers for swarm teammates. Ported from OpenHarness swarm/spawn_utils.py */
import { execSync } from "child_process";
import { getPlatform } from "../platforms.js";

function isInsideTmux(): boolean { return !!process.env.TMUX; }

function isTmuxAvailable(): boolean {
  try { execSync("tmux -V", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return true; }
  catch (_) { return false; }
}

function isIterm2Available(): boolean {
  try { execSync("which it2 2>/dev/null", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return true; }
  catch (_) { return false; }
}

interface ResolveBackendConfig {
  teammateMode?: string;
}

function resolvePreferredBackend(config: ResolveBackendConfig = {}): string {
  const mode = config.teammateMode || process.env.OPENHARNESS_TEAMMATE_MODE || "auto";
  if (mode === "in_process") return "in_process";
  if (mode === "tmux" && isTmuxAvailable()) return "tmux";
  if (mode === "iterm2" && isIterm2Available()) return "iterm2";
  if (isInsideTmux()) return "tmux";
  return "subprocess";
}

// Suppress unused import warning
void getPlatform;

export { isInsideTmux, isTmuxAvailable, isIterm2Available, resolvePreferredBackend };
