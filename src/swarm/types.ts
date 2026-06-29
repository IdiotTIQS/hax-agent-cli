/**
 * Swarm backend type definitions.
 * Ported from OpenHarness swarm/types.py
 */

const BackendType = {
  SUBPROCESS: "subprocess",
  IN_PROCESS: "in_process",
  TMUX: "tmux",
  ITERM2: "iterm2",
} as const;

type BackendTypeValue = typeof BackendType[keyof typeof BackendType];

const PaneBackendType = { TMUX: "tmux", ITERM2: "iterm2" } as const;

const TaskType = {
  LOCAL_BASH: "local_bash",
  LOCAL_AGENT: "local_agent",
  REMOTE_AGENT: "remote_agent",
  IN_PROCESS_TEAMMATE: "in_process_teammate",
  DREAM: "dream",
} as const;

const TaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  KILLED: "killed",
} as const;

interface TeammateIdentityOptions {
  agentId?: string;
  name?: string;
  team?: string;
  color?: string | null;
  parentSessionId?: string | null;
}

class TeammateIdentity {
  agentId: string;
  name: string;
  team: string;
  color: string | null;
  parentSessionId: string | null;

  constructor(o: TeammateIdentityOptions = {}) {
    this.agentId = o.agentId || "";
    this.name = o.name || "";
    this.team = o.team || "";
    this.color = o.color || null;
    this.parentSessionId = o.parentSessionId || null;
  }
}

interface TeammateSpawnConfigOptions {
  name?: string;
  team?: string;
  prompt?: string;
  cwd?: string;
  parentSessionId?: string;
  model?: string | null;
  command?: string | null;
  systemPrompt?: string | null;
  systemPromptMode?: string;
  color?: string | null;
  colorOverride?: string | null;
  permissions?: string[];
  planModeRequired?: boolean;
  allowPermissionPrompts?: boolean;
  worktreePath?: string | null;
  sessionId?: string | null;
  subscriptions?: string[];
  taskType?: string;
}

class TeammateSpawnConfig {
  name: string;
  team: string;
  prompt: string;
  cwd: string;
  parentSessionId: string;
  model: string | null;
  command: string | null;
  systemPrompt: string | null;
  systemPromptMode: string;
  color: string | null;
  colorOverride: string | null;
  permissions: string[];
  planModeRequired: boolean;
  allowPermissionPrompts: boolean;
  worktreePath: string | null;
  sessionId: string | null;
  subscriptions: string[];
  taskType: string;

  constructor(o: TeammateSpawnConfigOptions = {}) {
    this.name = o.name || "";
    this.team = o.team || "";
    this.prompt = o.prompt || "";
    this.cwd = o.cwd || process.cwd();
    this.parentSessionId = o.parentSessionId || "";
    this.model = o.model || null;
    this.command = o.command || null;
    this.systemPrompt = o.systemPrompt || null;
    this.systemPromptMode = o.systemPromptMode || "default";
    this.color = o.color || null;
    this.colorOverride = o.colorOverride || null;
    this.permissions = o.permissions || [];
    this.planModeRequired = !!o.planModeRequired;
    this.allowPermissionPrompts = !!o.allowPermissionPrompts;
    this.worktreePath = o.worktreePath || null;
    this.sessionId = o.sessionId || null;
    this.subscriptions = o.subscriptions || [];
    this.taskType = o.taskType || TaskType.LOCAL_AGENT;
  }
}

interface SpawnResultOptions {
  taskId?: string;
  agentId?: string;
  backendType?: string;
  success?: boolean;
  error?: string | null;
  paneId?: string | null;
}

class SpawnResult {
  taskId: string;
  agentId: string;
  backendType: string;
  success: boolean;
  error: string | null;
  paneId: string | null;

  constructor(o: SpawnResultOptions = {}) {
    this.taskId = o.taskId || "";
    this.agentId = o.agentId || "";
    this.backendType = o.backendType || BackendType.SUBPROCESS;
    this.success = o.success !== false;
    this.error = o.error || null;
    this.paneId = o.paneId || null;
  }
}

interface TeammateMessageOptions {
  text?: string;
  fromAgent?: string;
  color?: string | null;
  timestamp?: string;
  summary?: string | null;
}

class TeammateMessage {
  text: string;
  fromAgent: string;
  color: string | null;
  timestamp: string;
  summary: string | null;

  constructor(o: TeammateMessageOptions = {}) {
    this.text = o.text || "";
    this.fromAgent = o.fromAgent || "";
    this.color = o.color || null;
    this.timestamp = o.timestamp || new Date().toISOString();
    this.summary = o.summary || null;
  }
}

function isPaneBackend(type: string): boolean {
  return type === BackendType.TMUX || type === BackendType.ITERM2;
}

export {
  BackendType, PaneBackendType, TaskType, TaskStatus,
  TeammateIdentity, TeammateSpawnConfig, SpawnResult, TeammateMessage, isPaneBackend,
};
export type { BackendTypeValue };
