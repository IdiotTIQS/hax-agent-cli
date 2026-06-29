/**
 * Worktree Tool — isolated git worktree management.
 * Ported from OpenHarness tools/enter_worktree_tool.py + swarm/worktree.py
 *
 * Creates isolated git worktrees for parallel agent work without
 * conflicts on the same repository.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// === Worktree Tool ===

const enterWorktreeTool = {
  name: "enter_worktree",
  description:
    "Create an isolated git worktree for the current session. " +
    "Multiple agents can work on the same repo without conflicts. " +
    "The worktree shares the git history but has its own working directory.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      branch: {
        type: "string",
        description: "Branch name for the worktree. Auto-generated if not specified.",
      },
      base_ref: {
        type: "string",
        default: "HEAD",
        description: "Base reference to create the worktree from (default: HEAD)",
      },
      description: {
        type: "string",
        description: "Description of why this worktree is needed",
      },
    },
  },

  isReadOnly: () => false,

  async execute(args, ctx) {
    const cwd = ctx.root || process.cwd();

    // Check if we're in a git repo
    if (!_isGitRepo(cwd)) {
      return {
        ok: false,
        error: {
          code: "NOT_A_GIT_REPO",
          message: "Current directory is not a git repository. Worktrees require git.",
        },
      };
    }

    const branch = args.branch || _generateBranchName(args.description);
    const baseRef = args.base_ref || "HEAD";

    try {
      // Verify branch doesn't already exist
      const existingWorktrees = _listWorktrees(cwd);
      if (existingWorktrees.some((w) => w.branch === branch)) {
        return {
          ok: false,
          error: {
            code: "WORKTREE_EXISTS",
            message: `Branch "${branch}" already has a worktree. Use a different branch name or leave_worktree first.`,
          },
        };
      }

      // Create the worktree
      const worktreePath = path.join(cwd, ".worktrees", branch);
      const cmd = `git worktree add "${worktreePath}" ${baseRef} -b ${branch}`;

      try {
        const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 }).trim();

        return {
          ok: true,
          data: {
            branch,
            worktree_path: worktreePath,
            base_ref: baseRef,
            description: args.description || null,
            output,
            message: `Worktree created at "${worktreePath}" on branch "${branch}". Session will use this isolated directory.`,
          },
        };
      } catch (err) {
        const stderr = (err.stderr || "").trim();

        // Branch already exists but no worktree — create worktree from existing branch
        if (stderr.includes("already exists") || stderr.includes("already checked out")) {
          try {
            const output = execSync(`git worktree add "${worktreePath}" ${branch}`, {
              cwd, encoding: "utf-8", timeout: 30000,
            }).trim();

            return {
              ok: true,
              data: {
                branch,
                worktree_path: worktreePath,
                base_ref: baseRef,
                description: args.description || null,
                output,
                message: `Worktree created for existing branch "${branch}".`,
              },
            };
          } catch (err2) {
            return {
              ok: false,
              error: {
                code: "WORKTREE_CREATE_FAILED",
                message: `Failed to create worktree: ${(err2.stderr || err2.message).trim()}`,
              },
            };
          }
        }

        return {
          ok: false,
          error: {
            code: "WORKTREE_CREATE_FAILED",
            message: `Failed to create worktree: ${stderr || err.message}`,
          },
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "WORKTREE_ERROR",
          message: `Worktree operation failed: ${err.message}`,
        },
      };
    }
  },
};

// === Leave Worktree Tool ===

const exitWorktreeTool = {
  name: "exit_worktree",
  description:
    "Remove a worktree and return to the main working directory. " +
    "Optionally merge or discard changes from the worktree branch.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      branch: {
        type: "string",
        description: "Branch name of the worktree to remove. Uses current branch if not specified.",
      },
      discard: {
        type: "boolean",
        default: false,
        description: "Discard changes instead of merging (default: false, changes are preserved in branch)",
      },
      force: {
        type: "boolean",
        default: false,
        description: "Force removal even if there are uncommitted changes",
      },
    },
  },

  isReadOnly: () => false,

  async execute(args, ctx) {
    const cwd = ctx.root || process.cwd();

    if (!_isGitRepo(cwd)) {
      return {
        ok: false,
        error: {
          code: "NOT_A_GIT_REPO",
          message: "Current directory is not a git repository.",
        },
      };
    }

    const branch = args.branch || _getCurrentBranch(cwd);

    try {
      const worktreePath = path.join(cwd, ".worktrees", branch);

      // Check if worktree exists
      if (!fs.existsSync(worktreePath)) {
        return {
          ok: true,
          data: {
            branch,
            message: `Worktree for branch "${branch}" not found at ${worktreePath}. Nothing to remove.`,
          },
        };
      }

      // Remove the worktree
      const forceFlag = args.force ? " --force" : "";
      const output = execSync(`git worktree remove "${worktreePath}"${forceFlag}`, {
        cwd, encoding: "utf-8", timeout: 30000,
      }).trim();

      // If discard is true, delete the branch
      if (args.discard) {
        try {
          execSync(`git branch -D ${branch}`, { cwd, encoding: "utf-8", timeout: 10000 });
        } catch (_) {
          // Branch might not exist or has upstream — that's fine
        }
      }

      // Clean up .worktrees directory if empty
      const worktreesDir = path.join(cwd, ".worktrees");
      try {
        const remaining = fs.readdirSync(worktreesDir);
        if (remaining.length === 0) {
          fs.rmdirSync(worktreesDir);
        }
      } catch (_) {}

      return {
        ok: true,
        data: {
          branch,
          removed: true,
          discarded: !!args.discard,
          output,
          message: `Worktree for branch "${branch}" removed.${args.discard ? " Branch deleted." : " Branch preserved."}`,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "WORKTREE_REMOVE_FAILED",
          message: `Failed to remove worktree: ${(err.stderr || err.message).trim()}`,
        },
      };
    }
  },
};

// === List Worktrees Tool ===

const listWorktreesTool = {
  name: "list_worktrees",
  description: "List all active git worktrees and their branches.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {},
  },

  isReadOnly: () => true,

  async execute(args, ctx) {
    const cwd = ctx.root || process.cwd();

    if (!_isGitRepo(cwd)) {
      return {
        ok: true,
        data: { worktrees: [], message: "Not a git repository." },
      };
    }

    try {
      const worktrees = _listWorktrees(cwd);

      // Also check .worktrees directory
      const worktreesDir = path.join(cwd, ".worktrees");
      if (fs.existsSync(worktreesDir)) {
        const localDirs = fs.readdirSync(worktreesDir);
        for (const dir of localDirs) {
          const exists = worktrees.some((w) => w.path && w.path.endsWith(dir));
          if (!exists) {
            worktrees.push({
              branch: dir,
              path: path.join(worktreesDir, dir),
              status: "local_only",
            });
          }
        }
      }

      return {
        ok: true,
        data: {
          worktrees,
          count: worktrees.length,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "WORKTREE_LIST_FAILED",
          message: err.message,
        },
      };
    }
  },
};

// === Helper Functions ===

function _isGitRepo(cwd) {
  try {
    execSync("git rev-parse --git-dir", { cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe" });
    return true;
  } catch (_) {
    return false;
  }
}

function _getCurrentBranch(cwd) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
  } catch (_) {
    return "main";
  }
}

function _listWorktrees(cwd) {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd, encoding: "utf-8", timeout: 10000,
    }).trim();

    const worktrees = [];
    let current = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(current);
        current = { path: line.slice(9).trim() };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice(5).trim();
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).trim().replace("refs/heads/", "");
      } else if (line.startsWith("detached")) {
        current.detached = true;
      } else if (line.startsWith("bare")) {
        current.bare = true;
      }
    }
    if (current.path) worktrees.push(current);

    return worktrees;
  } catch (_) {
    return [];
  }
}

function _generateBranchName(description) {
  const prefix = "hax";
  const timestamp = Date.now().toString(36).slice(-6);
  if (description) {
    const slug = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20);
    return `${prefix}/${slug}-${timestamp}`;
  }
  return `${prefix}/worktree-${timestamp}`;
}

export {
  enterWorktreeTool,
  exitWorktreeTool,
  listWorktreesTool,
};
