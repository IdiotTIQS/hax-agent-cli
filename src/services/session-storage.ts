import fs from "fs";
import path from "path";
import os from "os";

const STORAGE_DIR = path.join(os.homedir(), ".haxagent", "storage");
class SessionStorage {
  constructor() { if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true }); }
  save(key: string, data: unknown) { fs.writeFileSync(path.join(STORAGE_DIR, key + ".json"), JSON.stringify(data, null, 2)); }
  load(key: string) { const fp = path.join(STORAGE_DIR, key + ".json"); if (!fs.existsSync(fp)) return null; try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (_) { return null; } }
  delete(key: string) { const fp = path.join(STORAGE_DIR, key + ".json"); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
}
export { SessionStorage };
