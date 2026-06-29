/** Autopilot service. Ported from OpenHarness autopilot/service.py */
import fs from "fs";
import path from "path";
import { AutopilotTask, AutopilotTaskStatus } from "./types.js";
import { getDataDir } from "../config/paths.js";

class AutopilotService {
  constructor(opts = {}) { this._tasks = new Map(); this._registryPath = opts.registryPath || path.join(getDataDir(), "autopilot", "registry.json"); this._running = false; }

  _load() {
    try { if (fs.existsSync(this._registryPath)) { const data = JSON.parse(fs.readFileSync(this._registryPath, "utf-8")); for (const t of (data.tasks || [])) this._tasks.set(t.id, new AutopilotTask(t)); } } catch (_) {}
  }
  _save() {
    const dir = path.dirname(this._registryPath); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._registryPath, JSON.stringify({ tasks: [...this._tasks.values()], updatedAt: new Date().toISOString() }, null, 2));
  }

  createTask(opts = {}) {
    const task = new AutopilotTask({ id: `ap_${Date.now().toString(36)}`, ...opts, createdAt: Date.now() });
    this._tasks.set(task.id, task); this._save(); return task;
  }
  getTask(id) { return this._tasks.get(id) || null; }
  listTasks(status) { const tasks = [...this._tasks.values()]; return status ? tasks.filter(t => t.status === status) : tasks; }
  updateTask(id, updates = {}) {
    const task = this._tasks.get(id); if (!task) return null;
    Object.assign(task, updates); this._save(); return task;
  }
  cancelTask(id) { const task = this._tasks.get(id); if (task) { task.status = AutopilotTaskStatus.CANCELLED; task.completedAt = Date.now(); this._save(); } return task; }
}

export { AutopilotService };
