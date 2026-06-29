import { execSync } from "child_process";
import path from "path";

interface WorktreeInfo {
  branch?: string;
  path: string;
  head?: string;
}

interface WorktreeResult {
  branch: string;
  path: string;
}

class WorktreeManager {
  private _cwd: string;

  constructor(cwd?: string) {
    this._cwd = cwd || process.cwd();
  }

  create(branch: string, baseRef?: string): WorktreeResult {
    const ref = baseRef || "HEAD";
    const dir = path.join(this._cwd, ".worktrees", branch);
    execSync(`git worktree add "${dir}" ${ref} -b ${branch}`, {
      cwd: this._cwd, encoding: "utf-8", timeout: 30000,
    });
    return { branch, path: dir };
  }

  remove(branch: string, force?: boolean): boolean {
    const dir = path.join(this._cwd, ".worktrees", branch);
    const flag = force ? " --force" : "";
    execSync(`git worktree remove "${dir}"${flag}`, { cwd: this._cwd, encoding: "utf-8" });
    return true;
  }

  list(): WorktreeInfo[] {
    try {
      const out = execSync("git worktree list --porcelain", { cwd: this._cwd, encoding: "utf-8" });
      const wts: WorktreeInfo[] = [];
      let cur: Partial<WorktreeInfo> = {};
      for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (cur.path) wts.push(cur as WorktreeInfo);
          cur = { path: line.slice(9).trim() };
        } else if (line.startsWith("branch ")) {
          cur.branch = line.slice(7).trim().replace("refs/heads/", "");
        } else if (line.startsWith("HEAD ")) {
          cur.head = line.slice(5).trim();
        }
      }
      if (cur.path) wts.push(cur as WorktreeInfo);
      return wts;
    } catch (_) { return []; }
  }
}

export { WorktreeManager };
