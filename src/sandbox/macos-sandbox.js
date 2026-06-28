"use strict";

/**
 * macOS sandbox-exec (Seatbelt) backend.
 * Uses the built-in sandbox-exec command to restrict file/network access.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

class MacOSSandbox {
  constructor(opts = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._policyFile = null;
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "macos"; }

  static isAvailable() {
    try {
      const { execSync } = require("child_process");
      execSync("which sandbox-exec", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  async start() {
    if (!MacOSSandbox.isAvailable()) throw new Error("sandbox-exec not available");
    // Generate policy file
    const policy = this._generatePolicy();
    this._policyFile = path.join(os.tmpdir(), `hax-sandbox-${Date.now().toString(36)}.sb`);
    fs.writeFileSync(this._policyFile, policy, "utf-8");
    this._isRunning = true;
    return this;
  }

  execAsync(command, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const args = ["-f", this._policyFile, "sh", "-c", command];
      const timeout = opts.timeoutMs || 30000;
      let stdout = "";
      let stderr = "";

      const child = spawn("sandbox-exec", args, {
        cwd: opts.cwd || this._workspace,
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
    if (this._policyFile) {
      try { fs.unlinkSync(this._policyFile); } catch (_) {}
      this._policyFile = null;
    }
    this._isRunning = false;
  }

  _generatePolicy() {
    const ws = this._workspace;
    const tmp = os.tmpdir();
    return `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "${ws}"))
(allow file-write* (subpath "${tmp}"))
(allow file-write* (subpath "/dev"))
(deny network*)
(allow network* (remote unix-socket))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm-read-data)
(allow ipc-posix-shm-write-data)
`;
  }
}

module.exports = { MacOSSandbox };
