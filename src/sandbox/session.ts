/** Docker sandbox session management.
 * Ported from OpenHarness sandbox/ directory.
 *
 * Provides isolated execution via Docker containers for security.
 * Falls back gracefully when Docker is unavailable.
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Suppress unused imports
void fs; void path; void os;

class SandboxUnavailableError extends Error {
  constructor(m: string) { super(m); this.name = "SandboxUnavailableError"; }
}

interface DockerSandboxOptions {
  containerName?: string;
  image?: string;
  workDir?: string;
  hostDir?: string;
  network?: string;
  cpus?: number | null;
  memory?: string | null;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecOptions {
  workdir?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

class DockerSandbox {
  private _containerName: string;
  private _image: string;
  private _isRunning: boolean;
  private _workDir: string;
  private _hostDir: string;
  private _network: string;
  private _cpus: number | null;
  private _memory: string | null;

  constructor(opts: DockerSandboxOptions = {}) {
    this._containerName = opts.containerName || `hax-sandbox-${Date.now().toString(36)}`;
    this._image = opts.image || "node:18-alpine";
    this._isRunning = false;
    this._workDir = opts.workDir || "/workspace";
    this._hostDir = opts.hostDir || process.cwd();
    this._network = opts.network || "none";
    this._cpus = opts.cpus || null;
    this._memory = opts.memory || null;
  }

  get isRunning(): boolean { return this._isRunning; }
  get containerName(): string { return this._containerName; }
  get backend(): string { return "docker"; }

  /** Check if Docker is available. */
  static isAvailable(): boolean {
    try {
      execSync("docker info", { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  /** Start the sandbox container. */
  async start(): Promise<this> {
    if (!DockerSandbox.isAvailable()) throw new SandboxUnavailableError("Docker is not available");
    try {
      execSync(`docker rm -f ${this._containerName} 2>/dev/null || true`, { encoding: "utf-8" });

      const args = ["run", "-d", "--name", this._containerName];
      args.push("-v", `${this._hostDir}:${this._workDir}`);
      args.push("-w", this._workDir);
      args.push("--network", this._network);
      if (this._cpus) args.push("--cpus", String(this._cpus));
      if (this._memory) args.push("--memory", this._memory);
      args.push(this._image, "tail", "-f", "/dev/null");

      execSync(`docker ${args.join(" ")}`, { encoding: "utf-8", timeout: 60000 });
      this._isRunning = true;
    } catch (err) {
      throw new SandboxUnavailableError(`Failed to start sandbox: ${(err as Error).message}`);
    }
    return this;
  }

  /** Execute a command inside the sandbox (async, non-blocking). */
  execAsync(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new SandboxUnavailableError("Sandbox is not running"));

      const args = ["exec"];
      if (opts.workdir) args.push("-w", opts.workdir);
      args.push(this._containerName, "sh", "-c", command);

      const timeout = opts.timeoutMs || 30000;
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn("docker", args, { timeout: timeout + 1000 });

      const timer = setTimeout(() => {
        killed = true;
        try { child.kill("SIGKILL"); } catch (_) {}
      }, timeout);

      child.stdout!.on("data", (d: Buffer) => { stdout += d; });
      child.stderr!.on("data", (d: Buffer) => { stderr += d; });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) return reject(new Error(`Command timed out after ${timeout}ms`));
        if (code === 0) resolve({ stdout, stderr, exitCode: 0 });
        else resolve({ stdout, stderr, exitCode: code || 1 });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Execute a command inside the sandbox (sync, backward-compatible). */
  exec(command: string, opts: ExecOptions = {}): string {
    if (!this._isRunning) throw new SandboxUnavailableError("Sandbox is not running");
    const cmd = `docker exec ${opts.workdir ? `-w ${opts.workdir}` : ""} ${this._containerName} sh -c "${command.replace(/"/g, '\\"')}"`;
    try {
      return execSync(cmd, { encoding: "utf-8", timeout: opts.timeoutMs || 30000, maxBuffer: opts.maxBuffer || 10 * 1024 * 1024 }) as string;
    } catch (err) {
      return (err as NodeJS.ErrnoException & { stdout?: string }).stdout || (err as Error).message;
    }
  }

  /** Stop and remove the sandbox. */
  stop(): void {
    try { execSync(`docker rm -f ${this._containerName}`, { encoding: "utf-8", stdio: "pipe" }); } catch (_) {}
    this._isRunning = false;
  }
}

export { DockerSandbox, SandboxUnavailableError };
