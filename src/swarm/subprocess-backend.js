"use strict";
/** Subprocess teammate execution backend. Ported from OpenHarness swarm/subprocess_backend.py */
const { BackendType, SpawnResult } = require("./types");
const { BackgroundTaskManager } = require("../tasks/manager");

class SubprocessBackend {
  constructor() { this.type = BackendType.SUBPROCESS; this._taskMgr = new BackgroundTaskManager(); this._agentTasks = new Map(); }
  isAvailable() { return true; }

  async spawn(config) {
    const agentId = `${config.name}@${config.team}`;
    const record = this._taskMgr.createAgentTask({ description: config.prompt?.slice(0, 100) || config.name, cwd: config.cwd, prompt: config.prompt, taskType: "local_agent", env: config.worktreePath ? { WORKTREE_PATH: config.worktreePath } : undefined });
    this._agentTasks.set(agentId, { taskId: record.id, config });
    return new SpawnResult({ taskId: record.id, agentId, backendType: BackendType.SUBPROCESS, success: true });
  }

  async sendMessage(agentId, message) {
    const entry = this._agentTasks.get(agentId);
    if (!entry) return;
    try { this._taskMgr.writeToTask(entry.taskId, JSON.stringify(message)); } catch (_) {}
  }

  async shutdown(agentId, force = false) {
    const entry = this._agentTasks.get(agentId);
    if (!entry) return false;
    try { this._taskMgr.stopTask(entry.taskId); } catch (_) {}
    this._agentTasks.delete(agentId);
    return true;
  }

  listAgents() { return [...this._agentTasks.entries()].map(([id, e]) => ({ agentId: id, taskId: e.taskId })); }
}

module.exports = { SubprocessBackend };
