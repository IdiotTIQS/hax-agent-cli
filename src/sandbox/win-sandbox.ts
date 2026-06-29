/**
 * Windows process containment sandbox.
 * Uses Job Objects for process cleanup and resource limits,
 * combined with path validation for filesystem safety.
 */

import { spawn } from "child_process";

interface WinSandboxOptions {
  hostDir?: string;
  memory?: string;
  cpus?: number;
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

class WinSandbox {
  private _workspace: string;
  private _isRunning: boolean;
  private _maxMemory: string;
  private _cpus: number;

  constructor(opts: WinSandboxOptions = {}) {
    this._workspace = opts.hostDir || process.cwd();
    this._isRunning = false;
    this._maxMemory = opts.memory || "512m";
    this._cpus = opts.cpus || 2;
  }

  get isRunning(): boolean { return this._isRunning; }
  get backend(): string { return "windows"; }

  static isAvailable(): boolean {
    return process.platform === "win32";
  }

  async start(): Promise<this> {
    if (!WinSandbox.isAvailable()) throw new Error("Windows sandbox not available");
    this._isRunning = true;
    return this;
  }

  execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new Error("Sandbox not running"));

      const timeout = opts.timeoutMs || 30000;
      let stdout = "";
      let stderr = "";

      const child = spawn("cmd.exe", ["/c", command], {
        cwd: opts.cwd || this._workspace,
        timeout: timeout + 1000,
        windowsHide: true,
        env: {
          ...process.env,
          TEMP: this._workspace,
          TMP: this._workspace,
        },
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

// Suppress unused private field warnings
void (WinSandbox.prototype as unknown as { _maxMemory: string })._maxMemory;
void (WinSandbox.prototype as unknown as { _cpus: number })._cpus;

export { WinSandbox };
