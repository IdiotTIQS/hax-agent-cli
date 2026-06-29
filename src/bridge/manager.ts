/** Bridge session manager. Ported from OpenHarness bridge/manager.py */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getDataDir } from "../config/paths.js";

class BridgeSessionRecord {
  constructor(o = {}) { this.sessionId = o.sessionId || ""; this.command = o.command || ""; this.cwd = o.cwd || ""; this.pid = o.pid || 0; this.status = o.status || "pending"; this.startedAt = o.startedAt || Date.now(); this.outputPath = o.outputPath || ""; }
}

class BridgeSessionManager {
  constructor() { this._sessions = new Map(); this._commands = new Map(); this._outputPaths = new Map(); this._processes = new Map(); }

  spawn(opts = {}) {
    const id = opts.sessionId || `bridge_${Date.now().toString(36)}`;
    const dir = path.join(getDataDir(), "bridge");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, `${id}.log`);
    fs.writeFileSync(outputPath, "");
    const cwd = opts.cwd || process.cwd();
    const proc = spawn(opts.command, { shell: true, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const outStream = fs.createWriteStream(outputPath, { flags: "a" });
    proc.stdout.pipe(outStream); proc.stderr.pipe(outStream);
    this._sessions.set(id, proc); this._commands.set(id, opts.command); this._outputPaths.set(id, outputPath); this._processes.set(id, proc);
    proc.on("exit", () => { try { outStream.end(); } catch (_) {} });
    return id;
  }

  listSessions() {
    const items = [];
    for (const [id, proc] of this._processes) {
      items.push(new BridgeSessionRecord({ sessionId: id, command: this._commands.get(id) || "", cwd: "", pid: proc.pid || 0, status: proc.exitCode === null ? "running" : proc.exitCode === 0 ? "completed" : "failed", startedAt: 0, outputPath: this._outputPaths.get(id) || "" }));
    }
    return items.sort((a, b) => b.startedAt - a.startedAt);
  }

  readOutput(sessionId, maxBytes = 12000) {
    const p = this._outputPaths.get(sessionId);
    if (!p || !fs.existsSync(p)) return "";
    const content = fs.readFileSync(p, "utf-8");
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  }

  stop(sessionId) {
    const proc = this._processes.get(sessionId);
    if (proc && !proc.killed) { proc.kill(); return true; }
    return false;
  }
}

export { BridgeSessionRecord, BridgeSessionManager };
