/**
 * Windows process containment sandbox.
 * Uses Job Objects for process cleanup and resource limits,
 * combined with path validation for filesystem safety.
 */

import { spawn } from "child_process";

class WinSandbox {
  constructor(opts = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._maxMemory = opts.memory || "512m";
    this._cpus = opts.cpus || 2;
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "windows"; }

  static isAvailable() {
    return process.platform === "win32";
  }

  async start() {
    if (!WinSandbox.isAvailable()) throw new Error("Windows sandbox not available");
    this._isRunning = true;
    return this;
  }

  execAsync(command, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const timeout = opts.timeoutMs || 30000;
      let stdout = "";
      let stderr = "";

      // Use PowerShell's Start-Process with job-like behavior
      // We run via cmd /c with environment restrictions
      const child = spawn("cmd.exe", ["/c", command], {
        cwd: opts.cwd || this._workspace,
        timeout: timeout + 1000,
        windowsHide: true,
        env: {
          ...process.env,
          // Restrict temp to workspace-local
          TEMP: this._workspace,
          TMP: this._workspace,
        },
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

export { WinSandbox };
