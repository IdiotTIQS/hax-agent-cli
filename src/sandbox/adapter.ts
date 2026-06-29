/**
 * Sandbox adapter — unified interface for sandbox backends.
 * Delegates to cross-platform module for actual implementation.
 * Supports: auto, docker, bwrap, macos, windows, none
 */

import { spawn, execSync } from "child_process";
import { PlatformSandbox, detectBestBackend } from "./cross-platform.js";
import { DockerSandbox } from "./session.js";

interface SandboxAdapterOptions {
  backend?: string;
  image?: string;
  network?: string;
  cpus?: number | null;
  memory?: string | null;
  hostDir?: string;
  failIfUnavailable?: boolean;
  [key: string]: unknown;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
  workdir?: string;
}

interface SandboxImpl {
  isRunning: boolean;
  backend: string;
  execAsync(command: string, opts?: ExecOptions): Promise<ExecResult>;
  exec?(command: string, opts?: ExecOptions): string;
  stop(): void;
}

class SandboxAdapter {
  private _requestedBackend: string;
  private _opts: SandboxAdapterOptions;
  private _impl: SandboxImpl | null;

  constructor(opts: SandboxAdapterOptions = {}) {
    this._requestedBackend = opts.backend || "auto";
    this._opts = opts;
    this._impl = null;
  }

  get isRunning(): boolean { return this._impl?.isRunning || false; }
  get backend(): string { return this._impl?.backend || this._requestedBackend; }

  async start(): Promise<void> {
    let backend = this._requestedBackend;

    if (backend === "docker" || (backend === "auto" && DockerSandbox.isAvailable())) {
      try {
        const docker = new DockerSandbox({
          image: this._opts.image || "node:18-alpine",
          network: this._opts.network || "none",
          cpus: this._opts.cpus ?? null,
          memory: this._opts.memory ?? null,
          hostDir: this._opts.hostDir || process.cwd(),
        });
        await docker.start();
        this._impl = docker as unknown as SandboxImpl;
        return;
      } catch (err) {
        if (backend === "docker" && this._opts.failIfUnavailable) throw err;
        // Fall through to platform sandbox
      }
    }

    if (backend === "auto") backend = detectBestBackend();
    if (backend === "none") return;

    this._impl = new PlatformSandbox({ ...this._opts, backend }) as unknown as SandboxImpl;
    try {
      await (this._impl as unknown as { start(): Promise<void> }).start();
    } catch (err) {
      if (this._opts.failIfUnavailable) throw err;
      this._impl = null;
    }
  }

  stop(): void {
    if (this._impl) { this._impl.stop(); this._impl = null; }
  }

  /** Async exec — preferred. */
  async execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this._impl) return this._impl.execAsync(command, opts);
    return new Promise((resolve, reject) => {
      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn(command, [], {
        shell: true, cwd: opts.cwd || process.cwd(), timeout: timeout + 1000,
      });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });
      child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  /** Sync exec — backward-compatible. */
  exec(command: string, opts: ExecOptions = {}): string {
    if (this._impl?.exec) return this._impl.exec(command, opts) as string;
    // Fallback: use child_process.execSync (imported at top — ESM has no require).
    return execSync(command, { encoding: "utf-8", cwd: opts.cwd || process.cwd(), timeout: opts.timeoutMs || 30000 }) as string;
  }
}

export { SandboxAdapter, detectBestBackend };
