/**
 * Bubblewrap (bwrap) sandbox backend for Linux.
 * Uses lightweight Linux namespaces without root.
 */

import { spawn, execSync } from "child_process";

interface BwrapOptions {
  hostDir?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
}

class BwrapSandbox {
  private _workspace: string;
  private _isRunning: boolean;

  constructor(opts: BwrapOptions = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
  }

  get isRunning(): boolean { return this._isRunning; }
  get backend(): string { return "bwrap"; }

  static isAvailable(): boolean {
    if (process.platform !== "linux") return false;
    try {
      execSync("which bwrap", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  async start(): Promise<this> {
    if (!BwrapSandbox.isAvailable()) throw new Error("bwrap not available");
    this._isRunning = true;
    return this;
  }

  execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const ws = this._workspace;
      const args = [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--bind", ws, ws,
        "--unshare-net",
        "--die-with-parent",
        "sh", "-c", command,
      ];

      const timeout = opts.timeoutMs || 30000;
      let stdout = "";
      let stderr = "";

      const child = spawn("bwrap", args, {
        cwd: opts.cwd || ws,
        timeout: timeout + 1000,
      });

      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);

      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  stop(): void {
    this._isRunning = false;
  }
}

export { BwrapSandbox };
