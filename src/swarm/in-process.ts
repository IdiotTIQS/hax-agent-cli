/** In-process teammate execution backend. Ported from OpenHarness swarm/in_process.py */
import { TaskType, TaskStatus, SpawnResult, BackendType } from "./types.js";
import { TeammateMailbox } from "./mailbox.js";
import type { TeammateSpawnConfig, TeammateMessage } from "./types.js";

interface AbortSignalLike {
  aborted: boolean;
}

class TeammateAbortController {
  private _aborted: boolean;
  private _forceAborted: boolean;
  signal: AbortSignalLike;

  constructor() {
    this._aborted = false;
    this._forceAborted = false;
    this.signal = { get aborted() { return false; } };
  }

  abort(force = false): void {
    if (force) this._forceAborted = true;
    this._aborted = true;
  }

  get isAborted(): boolean { return this._aborted; }
  get isForceAborted(): boolean { return this._forceAborted; }
}

interface TeammateContextOptions {
  agentId?: string;
  name?: string;
  team?: string;
  abortController?: TeammateAbortController;
}

class TeammateContext {
  agentId: string;
  name: string;
  team: string;
  abortController: TeammateAbortController;
  toolUseCount: number;
  totalTokens: number;
  status: string;

  constructor(o: TeammateContextOptions = {}) {
    this.agentId = o.agentId || "";
    this.name = o.name || "";
    this.team = o.team || "";
    this.abortController = o.abortController || new TeammateAbortController();
    this.toolUseCount = 0;
    this.totalTokens = 0;
    this.status = "running";
  }
}

interface ActiveContextEntry {
  ctx: TeammateContext;
  config: TeammateSpawnConfig;
  taskId: string;
  startedAt: number;
}

const _activeContexts = new Map<string, TeammateContext>();
function getTeammateContext(agentId: string): TeammateContext | null { return _activeContexts.get(agentId) || null; }
function setTeammateContext(agentId: string, ctx: TeammateContext): void { _activeContexts.set(agentId, ctx); }
function removeTeammateContext(agentId: string): void { _activeContexts.delete(agentId); }

interface AgentListEntry {
  agentId: string;
  name: string;
  status: string;
}

class InProcessBackend {
  readonly type: string;
  private _tasks: Map<string, ActiveContextEntry>;

  constructor() {
    this.type = BackendType.IN_PROCESS;
    this._tasks = new Map();
  }

  isAvailable(): boolean { return true; }

  async spawn(config: TeammateSpawnConfig): Promise<SpawnResult> {
    const agentId = `${config.name}@${config.team}`;
    const taskId = `ip_${Date.now().toString(36)}`;
    const ctx = new TeammateContext({ agentId, name: config.name, team: config.team });
    setTeammateContext(agentId, ctx);
    this._tasks.set(agentId, { ctx, config, taskId, startedAt: Date.now() });
    return new SpawnResult({ taskId, agentId, backendType: BackendType.IN_PROCESS, success: true });
  }

  async sendMessage(agentId: string, message: TeammateMessage): Promise<void> {
    const ctx = getTeammateContext(agentId);
    if (!ctx) return;
    const mailbox = new TeammateMailbox(ctx.team, agentId);
    mailbox.write(new (await import("./mailbox.js")).MailboxMessage({
      id: `${Date.now()}`,
      type: "user_message",
      sender: message.fromAgent,
      recipient: agentId,
      payload: { text: message.text },
      timestamp: Date.now() / 1000,
      read: false,
    }));
  }

  async shutdown(agentId: string, force = false): Promise<boolean> {
    const entry = this._tasks.get(agentId);
    if (!entry) return false;
    entry.ctx.abortController.abort(force);
    removeTeammateContext(agentId);
    this._tasks.delete(agentId);
    return true;
  }

  listAgents(): AgentListEntry[] {
    return [...this._tasks.entries()].map(([id, e]) => ({
      agentId: id, name: e.config.name, status: e.ctx.status,
    }));
  }
}

// Suppress unused import warnings
void TaskType; void TaskStatus;

export { TeammateAbortController, TeammateContext, getTeammateContext, setTeammateContext, removeTeammateContext, InProcessBackend };
