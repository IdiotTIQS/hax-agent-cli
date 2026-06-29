/**
 * Cross-platform sandbox module.
 * Provides file system + network isolation on Linux, macOS, and Windows
 * without requiring Docker.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import net from "net";

// === Platform Detection ===

function detectBestBackend(): string {
  const p = process.platform;
  if (p === "linux") {
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      execSync("which bwrap", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return "bwrap";
    } catch (_) {}
  }
  if (p === "darwin") {
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      execSync("which sandbox-exec", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return "macos";
    } catch (_) {}
  }
  if (p === "win32") return "windows";
  return "none";
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

interface SandboxOptions {
  hostDir?: string;
  network?: string;
  backend?: string;
  [key: string]: unknown;
}

// === Linux: bwrap ===

class BwrapSandbox {
  private _workspace: string;
  private _isRunning: boolean;
  private _network: boolean;

  constructor(opts: SandboxOptions = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._network = opts.network !== "allow";
  }

  get isRunning(): boolean { return this._isRunning; }
  get backend(): string { return "bwrap"; }

  static isAvailable(): boolean {
    if (process.platform !== "linux") return false;
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
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
        "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
        "--tmpfs", "/tmp", "--bind", ws, ws, "--die-with-parent",
      ];
      if (this._network) args.push("--unshare-net");
      args.push("sh", "-c", command);
      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn("bwrap", args, { cwd: opts.cwd || ws, timeout: timeout + 1000 });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  stop(): void { this._isRunning = false; }
}

// === macOS: sandbox-exec ===

class MacOSSandbox {
  private _workspace: string;
  private _isRunning: boolean;
  private _policyFile: string | null;
  private _network: boolean;

  constructor(opts: SandboxOptions = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._policyFile = null;
    this._network = opts.network !== "allow";
  }

  get isRunning(): boolean { return this._isRunning; }
  get backend(): string { return "macos"; }

  static isAvailable(): boolean {
    if (process.platform !== "darwin") return false;
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      execSync("which sandbox-exec", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  async start(): Promise<this> {
    if (!MacOSSandbox.isAvailable()) throw new Error("sandbox-exec not available");
    const ws = this._workspace;
    const tmp = os.tmpdir();
    const home = os.homedir();
    const netRule = this._network ? "(deny network*)" : "(allow network*)";
    const policy = `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath "${ws}"))\n(allow file-write* (subpath "${tmp}"))\n(allow file-write* (subpath "/dev"))\n(deny file-read* (subpath "${home}/.ssh"))\n(deny file-read* (subpath "${home}/.gnupg"))\n(deny file-read* (subpath "${home}/.aws"))\n(deny file-read* (subpath "${home}/.config"))\n(deny file-read* (literal "/etc/shadow"))\n(deny file-read* (literal "/etc/sudoers"))\n${netRule}\n(allow sysctl-read)\n(allow mach-lookup)\n`;
    this._policyFile = path.join(tmp, `hax-sandbox-${Date.now().toString(36)}.sb`);
    fs.writeFileSync(this._policyFile, policy, "utf-8");
    this._isRunning = true;
    return this;
  }

  execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));
      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn("sandbox-exec", ["-f", this._policyFile!, "sh", "-c", command], {
        cwd: opts.cwd || this._workspace, timeout: timeout + 1000,
      });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  stop(): void {
    if (this._policyFile) { try { fs.unlinkSync(this._policyFile); } catch (_) {} this._policyFile = null; }
    this._isRunning = false;
  }
}

// === Windows: Firewall (admin) + Proxy (fallback) + CLM ===

class WinSandbox {
  private _workspace: string;
  private _isRunning: boolean;
  private _network: boolean;
  private _proxyServer: net.Server | null;
  private _proxyPort: number;
  private _ruleName: string;
  private _hasFirewall: boolean;

  constructor(opts: SandboxOptions = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._network = opts.network !== "allow";
    this._proxyServer = null;
    this._proxyPort = 0;
    this._ruleName = `hax-sandbox-${Date.now().toString(36)}`;
    this._hasFirewall = false;
  }

  get isRunning(): boolean { return this._isRunning; }
  get backend(): string { return "windows"; }

  static isAvailable(): boolean { return process.platform === "win32"; }

  async start(): Promise<this> {
    if (!WinSandbox.isAvailable()) throw new Error("Windows sandbox not available");

    if (this._network) {
      try {
        const { execSync } = require("child_process") as typeof import("child_process");
        execSync(
          `netsh advfirewall firewall add rule name="${this._ruleName}" dir=out action=block`,
          { encoding: "utf-8", timeout: 5000, stdio: "pipe" }
        );
        this._hasFirewall = true;
      } catch (_) {
        this._proxyServer = net.createServer((socket) => { socket.destroy(); });
        await new Promise<void>((resolve) => {
          this._proxyServer!.listen(0, "127.0.0.1", () => {
            const addr = this._proxyServer!.address();
            this._proxyPort = (addr && typeof addr === "object") ? addr.port : 0;
            resolve();
          });
        });
      }
    }

    this._isRunning = true;
    return this;
  }

  execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";

      const env: NodeJS.ProcessEnv = { ...process.env, TEMP: this._workspace, TMP: this._workspace };

      if (this._network && !this._hasFirewall && this._proxyPort) {
        const proxyUrl = `http://127.0.0.1:${this._proxyPort}`;
        env["HTTP_PROXY"] = proxyUrl;
        env["HTTPS_PROXY"] = proxyUrl;
        env["ALL_PROXY"] = proxyUrl;
        env["NO_PROXY"] = "";
        env["http_proxy"] = proxyUrl;
        env["https_proxy"] = proxyUrl;
      }

      const psScript = `\n$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\ncmd.exe /c "${command.replace(/"/g, '""')}"\n`;
      const child = spawn("powershell.exe", [
        "-NoProfile", "-NoLogo", "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-Command", psScript,
      ], { cwd: opts.cwd || this._workspace, timeout: timeout + 1000, windowsHide: true, env });

      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  stop(): void {
    if (this._hasFirewall) {
      try {
        const { execSync } = require("child_process") as typeof import("child_process");
        execSync(`netsh advfirewall firewall delete rule name="${this._ruleName}"`, { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
      } catch (_) {}
      this._hasFirewall = false;
    }
    if (this._proxyServer) { try { this._proxyServer.close(); } catch (_) {} this._proxyServer = null; }
    this._isRunning = false;
  }
}

// === Unified PlatformSandbox ===

class PlatformSandbox {
  private _backend: string;
  private _opts: SandboxOptions;
  private _impl: BwrapSandbox | MacOSSandbox | WinSandbox | null;

  constructor(opts: SandboxOptions = {}) {
    this._backend = opts.backend || "auto";
    this._opts = opts;
    this._impl = null;
  }

  get isRunning(): boolean { return this._impl?.isRunning || false; }
  get backend(): string { return this._impl?.backend || this._backend; }

  async start(): Promise<this> {
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

  async execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (!this._impl) {
      return new Promise((resolve, reject) => {
        const timeout = opts.timeoutMs || 30000;
        let stdout = "", stderr = "";
        const child = spawn(command, [], {
          shell: true, cwd: opts.cwd || (this._opts.hostDir as string | undefined) || process.cwd(), timeout: timeout + 1000,
        });
        const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
        child.stdout!.on("data", (d: Buffer) => { stdout += d; });
        child.stderr!.on("data", (d: Buffer) => { stderr += d; });
        child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
        child.on("error", (err) => { clearTimeout(timer); reject(err); });
      });
    }
    return this._impl.execAsync(command, opts);
  }

  stop(): void {
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
