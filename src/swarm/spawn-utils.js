"use strict";
/** Spawning helpers for swarm teammates. Ported from OpenHarness swarm/spawn_utils.py */
const { execSync } = require("child_process");
const { getPlatform } = require("../platforms");

function isInsideTmux() { return !!process.env.TMUX; }
function isTmuxAvailable() { try { execSync("tmux -V", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return true; } catch (_) { return false; } }
function isIterm2Available() { try { execSync("which it2 2>/dev/null", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return true; } catch (_) { return false; } }

function resolvePreferredBackend(config = {}) {
  const mode = config.teammateMode || process.env.OPENHARNESS_TEAMMATE_MODE || "auto";
  if (mode === "in_process") return "in_process";
  if (mode === "tmux" && isTmuxAvailable()) return "tmux";
  if (mode === "iterm2" && isIterm2Available()) return "iterm2";
  if (isInsideTmux()) return "tmux";
  return "subprocess";
}

module.exports = { isInsideTmux, isTmuxAvailable, isIterm2Available, resolvePreferredBackend };
