/**
 * Swarm backend type definitions.
 * Ported from OpenHarness swarm/types.py
 */

const BackendType = { SUBPROCESS: "subprocess", IN_PROCESS: "in_process", TMUX: "tmux", ITERM2: "iterm2" };
const PaneBackendType = { TMUX: "tmux", ITERM2: "iterm2" };
const TaskType = { LOCAL_BASH: "local_bash", LOCAL_AGENT: "local_agent", REMOTE_AGENT: "remote_agent", IN_PROCESS_TEAMMATE: "in_process_teammate", DREAM: "dream" };
const TaskStatus = { PENDING: "pending", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", KILLED: "killed" };

class TeammateIdentity {
  constructor(o = {}) { Object.assign(this, { agentId: "", name: "", team: "", color: null, parentSessionId: null }, o); }
}
class TeammateSpawnConfig {
  constructor(o = {}) {
    Object.assign(this, {
      name: "", team: "", prompt: "", cwd: process.cwd(), parentSessionId: "",
      model: null, command: null, systemPrompt: null, systemPromptMode: "default",
      color: null, colorOverride: null, permissions: [], planModeRequired: false,
      allowPermissionPrompts: false, worktreePath: null, sessionId: null,
      subscriptions: [], taskType: TaskType.LOCAL_AGENT,
    }, o);
  }
}
class SpawnResult {
  constructor(o = {}) { Object.assign(this, { taskId: "", agentId: "", backendType: BackendType.SUBPROCESS, success: true, error: null, paneId: null }, o); }
}
class TeammateMessage {
  constructor(o = {}) { Object.assign(this, { text: "", fromAgent: "", color: null, timestamp: new Date().toISOString(), summary: null }, o); }
}

function isPaneBackend(type) { return type === BackendType.TMUX || type === BackendType.ITERM2; }

export {
  BackendType, PaneBackendType, TaskType, TaskStatus,
  TeammateIdentity, TeammateSpawnConfig, SpawnResult, TeammateMessage, isPaneBackend,
};
