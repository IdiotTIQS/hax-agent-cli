/**
 * Permission Checker - standalone module extracted from engine/agent.js
 * Ported from OpenHarness permissions/checker.py
 *
 * Supports:
 * - 3 permission modes (DEFAULT, PLAN, FULL_AUTO) + YOLO
 * - 11 sensitive path patterns (SSH keys, cloud credentials, etc.)
 * - 7 denied command patterns (rm -rf, dd, fork bomb, etc.)
 * - Path-based allow/deny rules (glob matching)
 * - Tool-level allow/deny lists
 * - Package install detection for user awareness
 * - isReadOnly passthrough from tool definitions
 */

import path from "path";

// === Permission Modes ===

const PermissionMode = {
  DEFAULT: "normal",
  PLAN: "plan",
  FULL_AUTO: "full_auto",
  YOLO: "yolo",
} as const;

// === Sensitive Path Patterns ===

const SENSITIVE_PATH_PATTERNS = [
  "*/.ssh/*",                    // SSH keys
  "*/.aws/credentials",          // AWS credentials
  "*/.aws/config",               // AWS config
  "*/.config/gcloud/*",          // GCP credentials
  "*/.azure/*",                  // Azure credentials
  "*/.gnupg/*",                  // GPG keys
  "*/.docker/config.json",       // Docker auth
  "*/.kube/config",              // Kubernetes config
  "*/.openharness/credentials.json",
  "*/id_rsa",                    // SSH private keys
  "*/id_ed25519",
  "*/id_ecdsa",
  "*/id_dsa",
];

// === Dangerous Command Patterns ===

const DENIED_COMMAND_PATTERNS = [
  "rm -rf /*",
  "rm -rf ~/*",
  "rm -rf .",
  "rm -rf /",
  "dd if=*",
  ":(){ :|:& };:",              // fork bomb
  "> /dev/sda",
  "mkfs.*",
  "chmod 777 /*",
  "chmod -R 777 /*",
  "> /dev/null 2>&1 &",         // background redirects
];

// === Package Install Markers ===

const PACKAGE_INSTALL_MARKERS = [
  "npm install",
  "pnpm install",
  "yarn install",
  "bun install",
  "pip install",
  "uv pip install",
  "poetry install",
  "cargo install",
  "create-next-app",
  "npx create-",
  "npm create ",
  "pnpm create ",
  "npm init ",
  "pnpm init ",
  "yarn init ",
];

// === Safe (Read-Only) Commands ===

const SAFE_COMMANDS = [
  "echo", "ls", "dir", "pwd", "whoami", "date", "uname",
  "cat", "head", "tail", "wc", "which", "where", "env",
  "printenv", "type", "git status", "git log", "git diff",
  "git branch", "git tag", "git remote", "git config --list",
];

// === Interfaces ===

interface PermissionDecisionOptions {
  allowed?: boolean;
  requiresConfirmation?: boolean;
  reason?: string;
  isSensitive?: boolean;
  isPackageInstall?: boolean;
}

interface PathRule {
  pattern: string;
  allow: boolean;
}

interface PermissionCheckerOptions {
  mode?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  pathRules?: PathRule[];
  deniedCommands?: string[];
  sensitivePaths?: string[];
}

interface EvaluateOptions {
  args?: Record<string, unknown>;
  isReadOnly?: ((args: Record<string, unknown>) => boolean) | boolean;
  cwd?: string;
}

// === Permission Decision ===

class PermissionDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
  isSensitive: boolean;
  isPackageInstall: boolean;

  constructor(o: PermissionDecisionOptions = {}) {
    this.allowed = o.allowed !== undefined ? o.allowed : true;
    this.requiresConfirmation = o.requiresConfirmation || false;
    this.reason = o.reason || "";
    this.isSensitive = o.isSensitive || false;
    this.isPackageInstall = o.isPackageInstall || false;
  }

  /** Quick factory: allowed without confirmation */
  static allow(reason = ""): PermissionDecision {
    return new PermissionDecision({ allowed: true, requiresConfirmation: false, reason });
  }

  /** Quick factory: denied */
  static deny(reason = ""): PermissionDecision {
    return new PermissionDecision({ allowed: false, reason });
  }

  /** Quick factory: requires user confirmation */
  static confirm(reason = "", extra: PermissionDecisionOptions = {}): PermissionDecision {
    return new PermissionDecision({ allowed: false, requiresConfirmation: true, reason, ...extra });
  }
}

// === Permission Checker ===

class PermissionChecker {
  mode: string;
  _alwaysAllow: Set<string>;
  _alwaysDeny: Set<string>;
  _pathRules: PathRule[];
  _deniedCommands: string[];
  _sensitivePaths: string[];

  /**
   * @param options
   * @param options.mode - permission mode
   * @param options.allowedTools - always-allowed tool names
   * @param options.deniedTools - always-denied tool names
   * @param options.pathRules - [{ pattern: string, allow: boolean }]
   * @param options.deniedCommands - additional denied command patterns
   * @param options.sensitivePaths - additional sensitive path patterns
   */
  constructor(o: PermissionCheckerOptions = {}) {
    this.mode = o.mode || PermissionMode.DEFAULT;
    this._alwaysAllow = new Set((o.allowedTools || []).map((t) => t.toLowerCase()));
    this._alwaysDeny = new Set((o.deniedTools || []).map((t) => t.toLowerCase()));
    this._pathRules = o.pathRules || [];
    this._deniedCommands = [...(o.deniedCommands || []), ...DENIED_COMMAND_PATTERNS];
    this._sensitivePaths = [...(o.sensitivePaths || []), ...SENSITIVE_PATH_PATTERNS];
  }

  /**
   * Evaluate whether a tool call is permitted.
   *
   * @param toolName - tool name
   * @param opts
   * @param opts.args - tool arguments
   * @param opts.isReadOnly - fn(args) => boolean (from tool definition)
   * @param opts.cwd - working directory (for path resolution)
   */
  evaluate(toolName: string, opts: EvaluateOptions = {}): PermissionDecision {
    const name = String(toolName).toLowerCase();
    const args = opts.args || {};
    const cwd = opts.cwd || process.cwd();

    // 1. Denied tool list (absolute)
    if (this._alwaysDeny.has(name)) {
      return PermissionDecision.deny(`Tool "${name}" is in the deny list`);
    }

    // 2. Always-allowed tools (bypass all checks)
    if (this._alwaysAllow.has(name)) {
      return PermissionDecision.allow(`Tool "${name}" is in the allow list`);
    }

    // 3. Check sensitive paths (always protected, regardless of mode)
    const sensitivePath = this._checkSensitivePaths(args, cwd);
    if (sensitivePath) {
      return PermissionDecision.deny(
        `Access denied: path matches sensitive pattern "${sensitivePath.pattern}". ` +
        "This path is protected and cannot be accessed by any tool."
      );
    }

    // 4. Check path rules (glob-based allow/deny)
    const pathRuleResult = this._checkPathRules(args, cwd);
    if (pathRuleResult) return pathRuleResult;

    // 5. Check dangerous commands
    const cmdResult = this._checkDangerousCommands(args);
    if (cmdResult) return cmdResult;

    // 6. Read-only check - accepts both boolean (from engine) and function
    let isRO = false;
    if (typeof opts.isReadOnly === "function") {
      try { isRO = opts.isReadOnly(args); } catch (_) {}
    } else if (typeof opts.isReadOnly === "boolean") {
      isRO = opts.isReadOnly;
    }
    if (isRO) {
      return PermissionDecision.allow(`Tool "${name}" is read-only for this operation`);
    }

    // 7. Package install check
    const pkgResult = this._checkPackageInstall(args);
    if (pkgResult) return pkgResult;

    // 8. Mode-based decision
    switch (this.mode) {
      case PermissionMode.YOLO:
      case PermissionMode.FULL_AUTO:
        return PermissionDecision.allow(`Mode is ${this.mode}`);

      case PermissionMode.PLAN:
        return PermissionDecision.deny(
          `Mode is PLAN — all modifications are blocked. ` +
          `Use /fullauto to enable modifications.`
        );

      case PermissionMode.DEFAULT:
      default: {
        // Modifying operations require confirmation
        const isModifying = !this._isReadOnlyByDefault(name, args);
        if (isModifying) {
          return PermissionDecision.confirm(
            `Tool "${name}" may modify files or system state. Confirm to proceed.`
          );
        }
        return PermissionDecision.allow(`Tool "${name}" appears to be read-only`);
      }
    }
  }

  /**
   * Check if a path matches any sensitive pattern.
   */
  _checkSensitivePaths(args: Record<string, unknown>, cwd: string): { pattern: string; path: string } | null {
    const filePaths = this._extractFilePaths(args, cwd);
    for (const filePath of filePaths) {
      for (const pattern of this._sensitivePaths) {
        if (this._fnmatch(filePath, pattern)) {
          return { pattern, path: filePath };
        }
      }
    }
    return null;
  }

  /**
   * Check path-based allow/deny rules.
   */
  _checkPathRules(args: Record<string, unknown>, cwd: string): PermissionDecision | null {
    const filePaths = this._extractFilePaths(args, cwd);
    for (const rule of this._pathRules) {
      for (const filePath of filePaths) {
        if (this._fnmatch(filePath, rule.pattern)) {
          if (rule.allow) {
            return PermissionDecision.allow(`Path matches allow rule: ${rule.pattern}`);
          } else {
            return PermissionDecision.deny(`Path matches deny rule: ${rule.pattern}`);
          }
        }
      }
    }
    return null;
  }

  /**
   * Extract file paths from tool arguments.
   */
  _extractFilePaths(args: Record<string, unknown>, cwd: string): string[] {
    const paths: string[] = [];
    if (args.path) paths.push(this._normalizePath(String(args.path), cwd));
    if (args.filePath) paths.push(this._normalizePath(String(args.filePath), cwd));
    if (args.target) paths.push(this._normalizePath(String(args.target), cwd));
    if (args.output) paths.push(this._normalizePath(String(args.output), cwd));
    if (args.source) paths.push(this._normalizePath(String(args.source), cwd));
    if (args.dest) paths.push(this._normalizePath(String(args.dest), cwd));
    if (Array.isArray(args.paths)) {
      for (const p of args.paths) paths.push(this._normalizePath(String(p), cwd));
    }
    return paths;
  }

  _normalizePath(p: string, cwd: string): string {
    if (!p || typeof p !== "string") return "";
    try {
      const resolved = path.resolve(cwd, p);
      return resolved.replace(/\\/g, "/");
    } catch (_) {
      return String(p).replace(/\\/g, "/");
    }
  }

  /**
   * Check if a command matches any dangerous pattern.
   */
  _checkDangerousCommands(args: Record<string, unknown>): PermissionDecision | null {
    const cmd = (String(args.command || "")).toLowerCase().trim();
    if (!cmd) return null;

    for (const pattern of this._deniedCommands) {
      if (this._fnmatch(cmd, pattern.toLowerCase())) {
        return PermissionDecision.deny(
          `Command matches dangerous pattern "${pattern}". This command is blocked for safety.`
        );
      }
    }
    return null;
  }

  /**
   * Check if command is a package install operation.
   */
  _checkPackageInstall(args: Record<string, unknown>): PermissionDecision | null {
    const cmd = (String(args.command || "")).trim();
    for (const marker of PACKAGE_INSTALL_MARKERS) {
      if (cmd.startsWith(marker) || cmd.includes(" " + marker)) {
        return PermissionDecision.confirm(
          `This looks like a package install command (${marker}). Please confirm.`,
          { isPackageInstall: true }
        );
      }
    }
    return null;
  }

  /**
   * Default read-only check based on tool name.
   */
  _isReadOnlyByDefault(name: string, args: Record<string, unknown>): boolean {
    const readOnlyTools = new Set([
      "file.read", "file.glob", "file.search", "file.readdir",
      "web.fetch", "web.search",
      "skill", "help", "doctor", "tool.search", "config",
      "mcp.list.resources", "mcp.read.resource",
    ]);

    if (readOnlyTools.has(name)) return true;

    // shell.run with safe commands
    if (name === "shell.run") {
      const cmd = (String(args.command || "")).toLowerCase();
      return SAFE_COMMANDS.some((s) => cmd === s || cmd.startsWith(s + " "));
    }

    return false;
  }

  /**
   * fnmatch-style glob matching.
   * Supports *, ?, [charset]
   */
  _fnmatch(str: string, pattern: string): boolean {
    if (!str || !pattern) return false;
    const reStr = "^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // Escape regex specials
      .replace(/\*/g, ".*")                   // * → .*
      .replace(/\?/g, ".")                    // ? → .
      + "$";
    try {
      return new RegExp(reStr, "i").test(str);
    } catch (_) {
      return str.toLowerCase().includes(pattern.toLowerCase());
    }
  }

  /**
   * Change permission mode.
   */
  setMode(mode: string): boolean {
    const valid = [PermissionMode.DEFAULT, PermissionMode.PLAN, PermissionMode.FULL_AUTO, PermissionMode.YOLO];
    if ((valid as string[]).includes(mode)) {
      this.mode = mode;
      return true;
    }
    return false;
  }

  /**
   * Add a tool to the always-allow list.
   */
  allowTool(name: string): void {
    this._alwaysAllow.add(name.toLowerCase());
  }

  /**
   * Add a tool to the always-deny list.
   */
  denyTool(name: string): void {
    this._alwaysDeny.add(name.toLowerCase());
    this._alwaysAllow.delete(name.toLowerCase());
  }

  /**
   * Add a path rule.
   */
  addPathRule(pattern: string, allow = true): void {
    this._pathRules.push({ pattern, allow });
  }

  /**
   * Add a sensitive path pattern.
   */
  addSensitivePath(pattern: string): void {
    this._sensitivePaths.push(pattern);
  }

  /**
   * Get a human-readable summary of current configuration.
   */
  getStatus(): Record<string, unknown> {
    return {
      mode: this.mode,
      allowedTools: [...this._alwaysAllow],
      deniedTools: [...this._alwaysDeny],
      pathRules: this._pathRules.length,
      sensitivePathPatterns: this._sensitivePaths.length,
      deniedCommandPatterns: this._deniedCommands.length,
    };
  }
}

// === Exports ===

export {
  PermissionMode,
  PermissionDecision,
  PermissionChecker,
  SENSITIVE_PATH_PATTERNS,
  DENIED_COMMAND_PATTERNS,
  PACKAGE_INSTALL_MARKERS,
  SAFE_COMMANDS,
};

export type { PermissionDecisionOptions, PathRule, PermissionCheckerOptions, EvaluateOptions };
