/** Bridge session manager. Ported from OpenHarness bridge/manager.py */
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { getDataDir } from "../config/paths.js";

interface BridgeSessionRecordOptions {
  sessionId?: string;
  command?: string;
  cwd?: string;
  pid?: number;
  status?: string;
  startedAt?: number;
  outputPath?: string;
}

class BridgeSessionRecord {
  sessionId: string;
  command: string;
  cwd: string;
  pid: number;
  status: string;
  startedAt: number;
  outputPath: string;

  constructor(o: BridgeSessionRecordOptions = {}) {
    this.sessionId = o.sessionId || "";
    this.command = o.command || "";
    this.cwd = o.cwd || "";
    this.pid = o.pid || 0;
    this.status = o.status || "pending";
    this.startedAt = o.startedAt || Date.now();
    this.outputPath = o.outputPath || "";
  }
}

interface SpawnOptions {
  sessionId?: string;
  command?: string;
  cwd?: string;
}

class BridgeSessionManager {
  private _sessions: Map<string, ChildProcess>;
  private _commands: Map<string, string>;
  private _outputPaths: Map<string, string>;
  private _processes: Map<string, ChildProcess>;

  constructor() {
    this._sessions = new Map();
    this._commands = new Map();
    this._outputPaths = new Map();
    this._processes = new Map();
  }

  spawn(opts: SpawnOptions = {}): string {
    const id = opts.sessionId || `bridge_${Date.now().toString(36)}`;
    const dir = path.join(getDataDir(), "bridge");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const outputPath = path.join(dir, `${id}.log`);
    fs.writeFileSync(outputPath, "");
    const cwd = opts.cwd || process.cwd();
    const command = opts.command || "";
    const proc = spawn(command, { shell: true, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const outStream = fs.createWriteStream(outputPath, { flags: "a" });
    proc.stdout!.pipe(outStream);
    proc.stderr!.pipe(outStream);
    this._sessions.set(id, proc);
    this._commands.set(id, command);
    this._outputPaths.set(id, outputPath);
    this._processes.set(id, proc);
    proc.on("exit", () => { try { outStream.end(); } catch (_) {} });
    return id;
  }

  listSessions(): BridgeSessionRecord[] {
    const items: BridgeSessionRecord[] = [];
    for (const [id, proc] of this._processes) {
      items.push(new BridgeSessionRecord({
        sessionId: id,
        command: this._commands.get(id) || "",
        cwd: "",
        pid: proc.pid || 0,
        status: proc.exitCode === null ? "running" : proc.exitCode === 0 ? "completed" : "failed",
        startedAt: 0,
        outputPath: this._outputPaths.get(id) || "",
      }));
    }
    return items.sort((a, b) => b.startedAt - a.startedAt);
  }

  readOutput(sessionId: string, maxBytes = 12000): string {
    const p = this._outputPaths.get(sessionId);
    if (!p || !fs.existsSync(p)) return "";
    const content = fs.readFileSync(p, "utf-8");
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  }

  stop(sessionId: string): boolean {
    const proc = this._processes.get(sessionId);
    if (proc && !proc.killed) { proc.kill(); return true; }
    return false;
  }
}

export { BridgeSessionRecord, BridgeSessionManager };
