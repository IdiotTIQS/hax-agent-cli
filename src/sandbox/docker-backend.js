/** Docker-based sandbox backend. Ported from OpenHarness sandbox/docker_backend.py */
import { execSync } from "child_process";
import { getPlatformCapabilities } from "../platforms.js";
import { DockerSandbox } from "./session.js";

class SandboxAvailability {
  constructor(o = {}) { this.enabled = !!o.enabled; this.available = !!o.available; this.reason = o.reason || ""; this.command = o.command || null; }
}

function getDockerAvailability(settings = {}) {
  if (!settings.sandbox?.enabled || settings.sandbox?.backend !== "docker") return new SandboxAvailability({ enabled: false, available: false, reason: "Docker sandbox is not enabled" });
  const caps = getPlatformCapabilities();
  if (!caps.supportsDockerSandbox) return new SandboxAvailability({ enabled: true, available: false, reason: `Docker not supported on ${caps.name}` });
  const docker = _which("docker");
  if (!docker) return new SandboxAvailability({ enabled: true, available: false, reason: "Docker CLI not found" });
  try { execSync("docker info", { encoding: "utf-8", timeout: 5000, stdio: "pipe" }); return new SandboxAvailability({ enabled: true, available: true, command: docker }); }
  catch (_) { return new SandboxAvailability({ enabled: true, available: false, reason: "Docker daemon not running", command: docker }); }
}

function _which(cmd) { try { return execSync(process.platform === "win32" ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0]; } catch (_) { return null; } }

export { SandboxAvailability, getDockerAvailability };
