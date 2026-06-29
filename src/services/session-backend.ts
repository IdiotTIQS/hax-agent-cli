import fs from "fs";
import path from "path";
import os from "os";

interface SessionMessage { role: string; content: unknown; internal?: boolean }
interface SessionData { id: string; messages?: SessionMessage[]; turnCount?: number }

const SESSION_DIR = path.join(os.homedir(), ".haxagent", "sessions");
class SessionBackend {
  constructor() { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); }
  save(session: SessionData) { const ts = new Date().toISOString().replace(/[:.]/g, "-"); const fp = path.join(SESSION_DIR, session.id + "_" + ts + ".json"); fs.writeFileSync(fp, JSON.stringify({ id: session.id, messages: (session.messages || []).map((m: SessionMessage) => ({ role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 2000) : "[complex]" })), turnCount: session.turnCount, timestamp: Date.now() }, null, 2)); return fp; }
  load(filePath: string) { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  list(sessionId?: string) { if (!fs.existsSync(SESSION_DIR)) return []; return fs.readdirSync(SESSION_DIR).filter((f: string) => f.startsWith(sessionId || "") && f.endsWith(".json")).sort().reverse().map((f: string) => ({ path: path.join(SESSION_DIR, f), name: f })); }
}
export { SessionBackend };
