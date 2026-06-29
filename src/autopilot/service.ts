/** Autopilot service. Ported from OpenHarness autopilot/service.py */
import fs from "fs";
import path from "path";
import { AutopilotTask, AutopilotTaskStatus } from "./types.js";
import { getDataDir } from "../config/paths.js";

interface AutopilotServiceOptions {
  registryPath?: string;
}

interface AutopilotTaskCreateOptions {
  name?: string;
  prompt?: string;
  triggerType?: string;
  metadata?: Record<string, unknown>;
}

interface AutopilotTaskUpdates {
  status?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  result?: unknown;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

class AutopilotService {
  private _tasks: Map<string, AutopilotTask>;
  private _registryPath: string;
  private _running: boolean;

  constructor(opts: AutopilotServiceOptions = {}) {
    this._tasks = new Map();
    this._registryPath = opts.registryPath || path.join(getDataDir(), "autopilot", "registry.json");
    this._running = false;
  }

  _load(): void {
    try {
      if (fs.existsSync(this._registryPath)) {
        const data = JSON.parse(fs.readFileSync(this._registryPath, "utf-8")) as { tasks?: AutopilotTaskCreateOptions[] };
        for (const t of (data.tasks || [])) this._tasks.set((t as AutopilotTask).id || "", new AutopilotTask(t));
      }
    } catch (_) {}
  }

  _save(): void {
    const dir = path.dirname(this._registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._registryPath, JSON.stringify({ tasks: [...this._tasks.values()], updatedAt: new Date().toISOString() }, null, 2));
  }

  createTask(opts: AutopilotTaskCreateOptions = {}): AutopilotTask {
    const task = new AutopilotTask({ id: `ap_${Date.now().toString(36)}`, ...opts, createdAt: Date.now() });
    this._tasks.set(task.id, task);
    this._save();
    return task;
  }

  getTask(id: string): AutopilotTask | null { return this._tasks.get(id) || null; }

  listTasks(status?: string): AutopilotTask[] {
    const tasks = [...this._tasks.values()];
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  updateTask(id: string, updates: AutopilotTaskUpdates = {}): AutopilotTask | null {
    const task = this._tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    this._save();
    return task;
  }

  cancelTask(id: string): AutopilotTask | undefined {
    const task = this._tasks.get(id);
    if (task) {
      task.status = AutopilotTaskStatus.CANCELLED;
      task.completedAt = Date.now();
      this._save();
    }
    return task;
  }
}

export { AutopilotService };
