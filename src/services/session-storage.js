"use strict";
const fs = require("fs"); const path = require("path"); const os = require("os");
const STORAGE_DIR = path.join(os.homedir(), ".haxagent", "storage");
class SessionStorage {
  constructor() { if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true }); }
  save(key, data) { fs.writeFileSync(path.join(STORAGE_DIR, key + ".json"), JSON.stringify(data, null, 2)); }
  load(key) { const fp = path.join(STORAGE_DIR, key + ".json"); if (!fs.existsSync(fp)) return null; try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (_) { return null; } }
  delete(key) { const fp = path.join(STORAGE_DIR, key + ".json"); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
}
module.exports = { SessionStorage };
