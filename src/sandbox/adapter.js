"use strict";

/**
 * Sandbox adapter — unified interface for sandbox backends.
 * Ported from OpenHarness sandbox/adapter.py
 */

const { DockerSandbox } = require("./session");

class SandboxAdapter {
  constructor(opts = {}) {
    this._backend = opts.backend || "none"; // "docker" | "none"
    this._session = null;
    this._failIfUnavailable = !!opts.failIfUnavailable;
  }

  get isAvailable() {
    if (this._backend === "docker") return DockerSandbox.isAvailable();
    return true; // "none" is always available
  }

  async start() {
    if (this._backend === "docker") {
      if (!DockerSandbox.isAvailable()) {
        if (this._failIfUnavailable) throw new Error("Docker sandbox required but not available");
        this._backend = "none";
        return;
      }
      this._session = new DockerSandbox();
      await this._session.start();
    }
  }

  stop() {
    if (this._session) { this._session.stop(); this._session = null; }
  }

  exec(command, opts = {}) {
    if (this._session) return this._session.exec(command, opts);
    // Direct execution (no sandbox)
    const { execSync } = require("child_process");
    return execSync(command, { encoding: "utf-8", cwd: opts.cwd || process.cwd(), timeout: opts.timeoutMs || 30000 });
  }
}

module.exports = { SandboxAdapter };
