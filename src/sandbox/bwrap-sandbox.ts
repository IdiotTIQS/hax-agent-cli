/**
 * Bubblewrap (bwrap) sandbox backend for Linux.
 * Uses lightweight Linux namespaces without root.
 */

import { spawn, execSync } from "child_process";

class BwrapSandbox {
  constructor(opts = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "bwrap"; }

  static isAvailable() {
    if (process.platform !== "linux") return false;
    try {
      execSync("which bwrap", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  async start() {
    if (!BwrapSandbox.isAvailable()) throw new Error("bwrap not available");
    this._isRunning = true;
    return this;
  }

  execAsync(command, opts = {}) {
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

      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  stop() {
    this._isRunning = false;
  }
}

export { BwrapSandbox };
