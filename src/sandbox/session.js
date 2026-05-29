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
  }

  get isRunning() { return this._isRunning; }

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
      execSync(`docker run -d --name ${this._containerName} -v "${this._hostDir}:${this._workDir}" -w ${this._workDir} ${this._image} tail -f /dev/null`, { encoding: "utf-8", timeout: 30000 });
      this._isRunning = true;
    } catch (err) {
      throw new SandboxUnavailableError(`Failed to start sandbox: ${err.message}`);
    }
    return this;
  }

  /** Execute a command inside the sandbox. */
  exec(command, opts = {}) {
    if (!this._isRunning) throw new SandboxUnavailableError("Sandbox is not running");
    const cmd = `docker exec ${opts.workdir ? `-w ${opts.workdir}` : ""} ${this._containerName} ${command}`;
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
