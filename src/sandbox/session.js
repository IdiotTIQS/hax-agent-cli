"use strict";

/**
 * Docker sandbox session management.
 * Ported from OpenHarness sandbox/ directory.
 *
 * Provides isolated execution via Docker containers for security.
 * Falls back gracefully when Docker is unavailable.
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

class SandboxUnavailableError extends Error { constructor(m) { super(m); this.name = "SandboxUnavailableError"; } }

class DockerSandbox {
  constructor(opts = {}) {
    this._containerName = opts.containerName || `hax-sandbox-${Date.now().toString(36)}`;
    this._image = opts.image || "node:18-alpine";
    this._isRunning = false;
    this._workDir = opts.workDir || "/workspace";
    this._hostDir = opts.hostDir || process.cwd();
    this._network = opts.network || "none";
    this._cpus = opts.cpus || null;
    this._memory = opts.memory || null;
  }

  get isRunning() { return this._isRunning; }
  get containerName() { return this._containerName; }

  /** Check if Docker is available. */
  static isAvailable() {
    try {
      execSync("docker info", { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
      return true;
    } catch (_) { return false; }
  }

  /** Start the sandbox container. */
  async start() {
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
      throw new SandboxUnavailableError(`Failed to start sandbox: ${err.message}`);
    }
    return this;
  }

  /** Execute a command inside the sandbox (async, non-blocking). */
  execAsync(command, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this._isRunning) return reject(new SandboxUnavailableError("Sandbox is not running"));

      const args = ["exec"];
      if (opts.workdir) args.push("-w", opts.workdir);
      // Use sh -c to handle shell syntax (pipes, redirects, etc.)
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

      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });

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
  exec(command, opts = {}) {
    if (!this._isRunning) throw new SandboxUnavailableError("Sandbox is not running");
    const cmd = `docker exec ${opts.workdir ? `-w ${opts.workdir}` : ""} ${this._containerName} sh -c "${command.replace(/"/g, '\\"')}"`;
    try {
      return execSync(cmd, { encoding: "utf-8", timeout: opts.timeoutMs || 30000, maxBuffer: opts.maxBuffer || 10 * 1024 * 1024 });
    } catch (err) {
      return err.stdout || err.message;
    }
  }

  /** Stop and remove the sandbox. */
  stop() {
    try { execSync(`docker rm -f ${this._containerName}`, { encoding: "utf-8", stdio: "pipe" }); } catch (_) {}
    this._isRunning = false;
  }
}

module.exports = { DockerSandbox, SandboxUnavailableError };
