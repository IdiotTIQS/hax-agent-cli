/** Subprocess teammate execution backend. Ported from OpenHarness swarm/subprocess_backend.py */
import { BackendType, SpawnResult } from "./types.js";
import type { TeammateSpawnConfig, TeammateMessage } from "./types.js";
import { BackgroundTaskManager } from "../tasks/manager.js";

interface AgentTaskEntry {
  taskId: string;
  config: TeammateSpawnConfig;
}

interface AgentListEntry {
  agentId: string;
  taskId: string;
}

class SubprocessBackend {
  readonly type: string;
  private _taskMgr: BackgroundTaskManager;
  private _agentTasks: Map<string, AgentTaskEntry>;

  constructor() {
    this.type = BackendType.SUBPROCESS;
    this._taskMgr = new BackgroundTaskManager();
    this._agentTasks = new Map();
  }

  isAvailable(): boolean { return true; }

  async spawn(config: TeammateSpawnConfig): Promise<SpawnResult> {
    const agentId = `${config.name}@${config.team}`;
    const record = this._taskMgr.createAgentTask({
      description: config.prompt?.slice(0, 100) || config.name,
      cwd: config.cwd,
      prompt: config.prompt,
      taskType: "local_agent",
      env: config.worktreePath ? { WORKTREE_PATH: config.worktreePath } : undefined,
    });
    this._agentTasks.set(agentId, { taskId: record.id, config });
    return new SpawnResult({ taskId: record.id, agentId, backendType: BackendType.SUBPROCESS, success: true });
  }

  async sendMessage(agentId: string, message: TeammateMessage): Promise<void> {
    const entry = this._agentTasks.get(agentId);
    if (!entry) return;
    try { this._taskMgr.writeToTask(entry.taskId, JSON.stringify(message)); } catch (_) {}
  }

  async shutdown(agentId: string, _force = false): Promise<boolean> {
    const entry = this._agentTasks.get(agentId);
    if (!entry) return false;
    try { this._taskMgr.stopTask(entry.taskId); } catch (_) {}
    this._agentTasks.delete(agentId);
    return true;
  }

  listAgents(): AgentListEntry[] {
    return [...this._agentTasks.entries()].map(([id, e]) => ({ agentId: id, taskId: e.taskId }));
  }
}

export { SubprocessBackend };
