import fs from "fs"; import path from "path"; import { getMemoryDir } from "./memdir.js";
class MemoryUsageTracker {
  constructor() { this._logPath=path.join(getMemoryDir(),"usage.jsonl"); }
  log(action,opts={}) { const entry={action,timestamp:Date.now(),...opts}; fs.appendFileSync(this._logPath,JSON.stringify(entry)+"\n"); }
  getStats() { if(!fs.existsSync(this._logPath)) return {totalActions:0}; const lines=fs.readFileSync(this._logPath,"utf-8").trim().split("\n").filter(Boolean); return {totalActions:lines.length,lastAction:lines.length?JSON.parse(lines[lines.length-1]):null}; }
}
export { MemoryUsageTracker };
