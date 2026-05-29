"use strict";
const { execSync } = require("child_process"); const fs = require("fs"); const path = require("path");
class WorktreeManager {
  constructor(cwd) { this._cwd = cwd || process.cwd(); }
  create(branch, baseRef) { const ref = baseRef || "HEAD"; const dir = path.join(this._cwd, ".worktrees", branch); execSync("git worktree add \"" + dir + "\" " + ref + " -b " + branch, { cwd: this._cwd, encoding: "utf-8", timeout: 30000 }); return { branch, path: dir }; }
  remove(branch, force) { const dir = path.join(this._cwd, ".worktrees", branch); const flag = force ? " --force" : ""; execSync("git worktree remove \"" + dir + "\"" + flag, { cwd: this._cwd, encoding: "utf-8" }); return true; }
  list() { try { const out = execSync("git worktree list --porcelain", { cwd: this._cwd, encoding: "utf-8" }); const wts = []; let cur = {}; for (const line of out.split("\n")) { if (line.startsWith("worktree ")) { if (cur.path) wts.push(cur); cur = { path: line.slice(9).trim() }; } else if (line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace("refs/heads/", ""); else if (line.startsWith("HEAD ")) cur.head = line.slice(5).trim(); } if (cur.path) wts.push(cur); return wts; } catch (_) { return []; } }
}
module.exports = { WorktreeManager };
