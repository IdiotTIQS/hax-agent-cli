/**
 * Backend registry for teammate execution.
 * Ported from OpenHarness swarm/registry.py
 */

import { execSync } from "child_process";
import { BackendType } from "./types.js";
import { getPlatform, getPlatformCapabilities } from "../platforms.js";

function _detectTmux(): boolean {
  if (!process.env.TMUX) return false;
  try { execSync("which tmux 2>/dev/null || where tmux 2>nul", { encoding: "utf-8", timeout: 5000 }); return true; }
  catch (_) { return false; }
}

function _detectIterm2(): boolean { return !!process.env.ITERM_SESSION_ID; }

function _isTmuxAvailable(): boolean {
  try { execSync("tmux -V", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return true; }
  catch (_) { return false; }
}

function _getTmuxInstallInstructions(): string {
  const p = getPlatform();
  if (p === "macos") return "Install tmux: brew install tmux\nThen: tmux new-session -s claude";
  if (p === "linux" || p === "wsl") return "Install tmux: sudo apt install tmux\nThen: tmux new-session -s claude";
  return "Install tmux using your system's package manager.";
}

interface BackendExecutor {
  type: string;
  isAvailable(): boolean;
}

interface PaneBackendResult {
  backend: string;
  isNative: boolean;
  needsSetup?: boolean;
}

interface HealthCheckEntry {
  available: boolean;
  type: string;
}

interface HealthCheckResult {
  backends: Record<string, HealthCheckEntry>;
  totalCount: number;
}

class BackendRegistry {
  private _backends: Map<string, BackendExecutor>;
  private _detected: string | null;
  private _inProcessFallbackActive: boolean;

  constructor() {
    this._backends = new Map();
    this._detected = null;
    this._inProcessFallbackActive = false;
    this._registerDefaults();
  }

  private _registerDefaults(): void {
    this._backends.set(BackendType.SUBPROCESS, { type: BackendType.SUBPROCESS, isAvailable: () => true });
    if (getPlatformCapabilities().supportsSwarmMailbox) {
      this._backends.set(BackendType.IN_PROCESS, { type: BackendType.IN_PROCESS, isAvailable: () => true });
    }
  }

  registerBackend(executor: BackendExecutor): void { this._backends.set(executor.type, executor); }

  detectBackend(): string {
    if (this._detected) return this._detected;
    if (this._inProcessFallbackActive) { this._detected = BackendType.IN_PROCESS; return this._detected; }
    if (_detectTmux() && this._backends.has(BackendType.TMUX)) { this._detected = BackendType.TMUX; return this._detected; }
    this._detected = BackendType.SUBPROCESS;
    return this._detected;
  }

  detectPaneBackend(): PaneBackendResult {
    if (_detectTmux()) return { backend: BackendType.TMUX, isNative: true };
    if (_detectIterm2()) {
      if (this._backends.has(BackendType.ITERM2)) return { backend: BackendType.ITERM2, isNative: true };
      if (_isTmuxAvailable()) return { backend: BackendType.TMUX, isNative: false, needsSetup: true };
      throw new Error("iTerm2 detected but it2 CLI not installed. Install with: pip install it2");
    }
    if (_isTmuxAvailable()) return { backend: BackendType.TMUX, isNative: false };
    throw new Error(_getTmuxInstallInstructions());
  }

  getExecutor(backend?: string | null): BackendExecutor {
    const resolved = backend || this.detectBackend();
    const executor = this._backends.get(resolved);
    if (!executor) throw new Error(`Backend ${resolved} not registered. Available: ${[...this._backends.keys()].join(", ")}`);
    return executor;
  }

  markInProcessFallback(): void {
    this._inProcessFallbackActive = true;
    this._detected = null;
  }

  availableBackends(): string[] { return [...this._backends.keys()].sort(); }

  healthCheck(): HealthCheckResult {
    const results: Record<string, HealthCheckEntry> = {};
    let available = 0;
    for (const [type, exec] of this._backends) {
      const ok = exec.isAvailable();
      results[type] = { available: ok, type };
      if (ok) available++;
    }
    return { backends: results, totalCount: available };
  }
}

let _registry: BackendRegistry | null = null;
function getBackendRegistry(): BackendRegistry {
  if (!_registry) _registry = new BackendRegistry();
  return _registry;
}

export { BackendRegistry, getBackendRegistry };
