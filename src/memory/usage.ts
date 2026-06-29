import fs from "fs";
import path from "path";
import { getMemoryDir } from "./memdir.js";

interface UsageLogOptions {
  [key: string]: unknown;
}

interface UsageStats {
  totalActions: number;
  lastAction?: unknown;
}

class MemoryUsageTracker {
  private _logPath: string;

  constructor() {
    this._logPath = path.join(getMemoryDir(), "usage.jsonl");
  }

  log(action: string, opts: UsageLogOptions = {}): void {
    const entry = { action, timestamp: Date.now(), ...opts };
    fs.appendFileSync(this._logPath, JSON.stringify(entry) + "\n");
  }

  getStats(): UsageStats {
    if (!fs.existsSync(this._logPath)) return { totalActions: 0 };
    const lines = fs.readFileSync(this._logPath, "utf-8").trim().split("\n").filter(Boolean);
    return {
      totalActions: lines.length,
      lastAction: lines.length ? JSON.parse(lines[lines.length - 1]) as unknown : null,
    };
  }
}

export { MemoryUsageTracker };
