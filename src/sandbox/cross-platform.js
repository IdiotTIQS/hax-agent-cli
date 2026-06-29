// @ts-nocheck — sandbox 子系统开发中（半成品）；暂不做类型检查，待其稳定后移除本行并纳入护栏。

/**
 * Cross-platform sandbox module.
 * Provides file system + network isolation on Linux, macOS, and Windows
 * without requiring Docker.
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import net from "net";

// === Platform Detection ===

function detectBestBackend() {
  const p = process.platform;
  if (p === "linux") {
    try { execSync("which bwrap", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }); return "bwrap"; } catch (_) {}
  }
  if (p === "darwin") {
    try { execSync("which sandbox-exec", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }); return "macos"; } catch (_) {}
  }
  if (p === "win32") return "windows";
  return "none";
}

// === Linux: bwrap ===

class BwrapSandbox {
  constructor(opts) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._network = opts.network !== "allow";
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "bwrap"; }

  static isAvailable() {
    if (process.platform !== "linux") return false;
    try { execSync("which bwrap", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }); return true; } catch (_) { return false; }
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
        "--die-with-parent",
      ];
      if (this._network) args.push("--unshare-net");
      args.push("sh", "-c", command);

      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn("bwrap", args, { cwd: opts.cwd || ws, timeout: timeout + 1000 });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", err => { clearTimeout(timer); reject(err); });
    });
  }

  stop() { this._isRunning = false; }
}

// === macOS: sandbox-exec ===

class MacOSSandbox {
  constructor(opts) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._policyFile = null;
    this._network = opts.network !== "allow";
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "macos"; }

  static isAvailable() {
    if (process.platform !== "darwin") return false;
    try { execSync("which sandbox-exec", { encoding: "utf-8", timeout: 3000, stdio: "pipe" }); return true; } catch (_) { return false; }
  }

  async start() {
    if (!MacOSSandbox.isAvailable()) throw new Error("sandbox-exec not available");
    const ws = this._workspace;
    const tmp = os.tmpdir();
    const home = os.homedir();
    const netRule = this._network ? "(deny network*)" : "(allow network*)";
    const policy = `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "${ws}"))
(allow file-write* (subpath "${tmp}"))
(allow file-write* (subpath "/dev"))
(deny file-read* (subpath "${home}/.ssh"))
(deny file-read* (subpath "${home}/.gnupg"))
(deny file-read* (subpath "${home}/.aws"))
(deny file-read* (subpath "${home}/.config"))
(deny file-read* (literal "/etc/shadow"))
(deny file-read* (literal "/etc/sudoers"))
${netRule}
(allow sysctl-read)
(allow mach-lookup)
`;
    this._policyFile = path.join(tmp, `hax-sandbox-${Date.now().toString(36)}.sb`);
    fs.writeFileSync(this._policyFile, policy, "utf-8");
    this._isRunning = true;
    return this;
  }

  execAsync(command, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));
      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn("sandbox-exec", ["-f", this._policyFile, "sh", "-c", command], {
        cwd: opts.cwd || this._workspace, timeout: timeout + 1000,
      });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", err => { clearTimeout(timer); reject(err); });
    });
  }

  stop() {
    if (this._policyFile) { try { fs.unlinkSync(this._policyFile); } catch (_) {} this._policyFile = null; }
    this._isRunning = false;
  }
}

// === Windows: Firewall (admin) + Proxy (fallback) + CLM ===

class WinSandbox {
  constructor(opts) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._network = opts.network !== "allow";
    this._proxyServer = null;
    this._proxyPort = 0;
    this._ruleName = `hax-sandbox-${Date.now().toString(36)}`;
    this._hasFirewall = false;
  }

  get isRunning() { return this._isRunning; }
  get backend() { return "windows"; }

  static isAvailable() { return process.platform === "win32"; }

  async start() {
    if (!WinSandbox.isAvailable()) throw new Error("Windows sandbox not available");

    if (this._network) {
      // Try firewall first (requires admin, but blocks ALL traffic including PS)
      try {
        execSync(
          `netsh advfirewall firewall add rule name="${this._ruleName}" dir=out action=block`,
          { encoding: "utf-8", timeout: 5000, stdio: "pipe" }
        );
        this._hasFirewall = true;
      } catch (_) {
        // Fallback: local block proxy (blocks curl, wget, node, etc.)
        this._proxyServer = net.createServer((socket) => { socket.destroy(); });
        await new Promise((resolve) => {
          this._proxyServer.listen(0, "127.0.0.1", () => {
            this._proxyPort = this._proxyServer.address().port;
            resolve();
          });
        });
      }
    }

    this._isRunning = true;
    return this;
  }

  execAsync(command, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";

      const env = { ...process.env, TEMP: this._workspace, TMP: this._workspace };

      // If no firewall, use proxy env vars for network blocking
      if (this._network && !this._hasFirewall && this._proxyPort) {
        const proxyUrl = `http://127.0.0.1:${this._proxyPort}`;
        env.HTTP_PROXY = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        env.ALL_PROXY = proxyUrl;
        env.NO_PROXY = "";
        env.http_proxy = proxyUrl;
        env.https_proxy = proxyUrl;
      }

      // PowerShell Constrained Language Mode
      const psScript = `
$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'
cmd.exe /c "${command.replace(/"/g, '""')}"
`;
      const child = spawn("powershell.exe", [
        "-NoProfile", "-NoLogo", "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-Command", psScript,
      ], {
        cwd: opts.cwd || this._workspace,
        timeout: timeout + 1000,
        windowsHide: true,
        env,
      });

      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", err => { clearTimeout(timer); reject(err); });
    });
  }

  stop() {
    // Remove firewall rule if we added one
    if (this._hasFirewall) {
      try { execSync(`netsh advfirewall firewall delete rule name="${this._ruleName}"`, { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); } catch (_) {}
      this._hasFirewall = false;
    }
    // Close proxy server
    if (this._proxyServer) {
      try { this._proxyServer.close(); } catch (_) {}
      this._proxyServer = null;
    }
    this._isRunning = false;
  }
}

// === Unified PlatformSandbox ===

class PlatformSandbox {
  constructor(opts = {}) {
    this._backend = opts.backend || "auto";
    this._opts = opts;
    this._impl = null;
  }

  get isRunning() { return this._impl?.isRunning || false; }
  get backend() { return this._impl?.backend || this._backend; }

  async start() {
    let backend = this._backend;
    if (backend === "auto") backend = detectBestBackend();

    switch (backend) {
      case "bwrap": this._impl = new BwrapSandbox(this._opts); break;
      case "macos": this._impl = new MacOSSandbox(this._opts); break;
      case "windows": this._impl = new WinSandbox(this._opts); break;
      default: this._impl = null; return this;
    }

    await this._impl.start();
    return this;
  }

  async execAsync(command, opts = {}) {
    if (!this._impl) {
      // No sandbox — direct execution fallback
      return new Promise((resolve, reject) => {
        const timeout = opts.timeoutMs || 30000;
        let stdout = "", stderr = "";
        const child = spawn(command, [], { shell: true, cwd: opts.cwd || this._opts.hostDir || process.cwd(), timeout: timeout + 1000 });
        const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
        child.stdout.on("data", d => { stdout += d; });
        child.stderr.on("data", d => { stderr += d; });
        child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
        child.on("error", err => { clearTimeout(timer); reject(err); });
      });
    }
    return this._impl.execAsync(command, opts);
  }

  stop() {
    if (this._impl) { this._impl.stop(); this._impl = null; }
  }
}

export {
  PlatformSandbox,
  BwrapSandbox,
  MacOSSandbox,
  WinSandbox,
  detectBestBackend,
};
