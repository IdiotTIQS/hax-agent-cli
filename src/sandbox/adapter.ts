// @ts-nocheck — sandbox 子系统开发中（半成品）；暂不做类型检查，待其稳定后移除本行并纳入护栏。

/**
 * Sandbox adapter — unified interface for sandbox backends.
 * Delegates to cross-platform module for actual implementation.
 * Supports: auto, docker, bwrap, macos, windows, none
 */

import { spawn, execSync } from "child_process";
import { PlatformSandbox, detectBestBackend } from "./cross-platform.js";
import { DockerSandbox } from "./session.js";

class SandboxAdapter {
  constructor(opts = {}) {
    this._requestedBackend = opts.backend || "auto";
    this._opts = opts;
    this._impl = null;
  }

  get isRunning() { return this._impl?.isRunning || false; }
  get backend() { return this._impl?.backend || this._requestedBackend; }

  async start() {
    let backend = this._requestedBackend;

    // Docker gets special treatment (uses existing DockerSandbox)
    if (backend === "docker" || (backend === "auto" && DockerSandbox.isAvailable())) {
      try {
        const docker = new DockerSandbox({
          image: this._opts.image || "node:18-alpine",
          network: this._opts.network || "none",
          cpus: this._opts.cpus,
          memory: this._opts.memory,
          hostDir: this._opts.hostDir || process.cwd(),
        });
        await docker.start();
        this._impl = docker;
        return;
      } catch (_) {
        if (backend === "docker" && this._opts.failIfUnavailable) throw _;
        // Fall through to platform sandbox
      }
    }

    // Use cross-platform sandbox
    if (backend === "auto") backend = detectBestBackend();
    if (backend === "none") return;

    this._impl = new PlatformSandbox({ ...this._opts, backend });
    try {
      await this._impl.start();
    } catch (err) {
      if (this._opts.failIfUnavailable) throw err;
      this._impl = null;
    }
  }

  stop() {
    if (this._impl) { this._impl.stop(); this._impl = null; }
  }

  /** Async exec — preferred. */
  async execAsync(command, opts = {}) {
    if (this._impl) return this._impl.execAsync(command, opts);
    // Fallback: direct execution
    return new Promise((resolve, reject) => {
      const timeout = opts.timeoutMs || 30000;
      let stdout = "", stderr = "";
      const child = spawn(command, [], { shell: true, cwd: opts.cwd || process.cwd(), timeout: timeout + 1000 });
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, timeout);
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code || 0 }); });
      child.on("error", err => { clearTimeout(timer); reject(err); });
    });
  }

  /** Sync exec — backward-compatible. */
  exec(command, opts = {}) {
    if (this._impl?.exec) return this._impl.exec(command, opts);
    return execSync(command, { encoding: "utf-8", cwd: opts.cwd || process.cwd(), timeout: opts.timeoutMs || 30000 });
  }
}

export { SandboxAdapter, detectBestBackend };
