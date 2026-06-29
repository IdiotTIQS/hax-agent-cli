/** In-process teammate execution backend. Ported from OpenHarness swarm/in_process.py */
import { TaskType, TaskStatus, SpawnResult, BackendType } from "./types.js";
import { TeammateMailbox } from "./mailbox.js";

class TeammateAbortController {
  constructor() { this._aborted = false; this._forceAborted = false; this.signal = { get aborted() { return false; } }; }
  abort(force = false) { if (force) this._forceAborted = true; this._aborted = true; }
  get isAborted() { return this._aborted; }
  get isForceAborted() { return this._forceAborted; }
}

class TeammateContext {
  constructor(o = {}) { this.agentId = o.agentId || ""; this.name = o.name || ""; this.team = o.team || ""; this.abortController = o.abortController || new TeammateAbortController(); this.toolUseCount = 0; this.totalTokens = 0; this.status = "running"; }
}

const _activeContexts = new Map();
function getTeammateContext(agentId) { return _activeContexts.get(agentId) || null; }
function setTeammateContext(agentId, ctx) { _activeContexts.set(agentId, ctx); }
function removeTeammateContext(agentId) { _activeContexts.delete(agentId); }

class InProcessBackend {
  constructor() { this.type = BackendType.IN_PROCESS; this._tasks = new Map(); }
  isAvailable() { return true; }

  async spawn(config) {
    const agentId = `${config.name}@${config.team}`;
    const taskId = `ip_${Date.now().toString(36)}`;
    const ctx = new TeammateContext({ agentId, name: config.name, team: config.team });
    setTeammateContext(agentId, ctx);
    this._tasks.set(agentId, { ctx, config, taskId, startedAt: Date.now() });
    const result = new SpawnResult({ taskId, agentId, backendType: BackendType.IN_PROCESS, success: true });
    return result;
  }

  async sendMessage(agentId, message) {
    const ctx = getTeammateContext(agentId);
    if (!ctx) return;
    const mailbox = new TeammateMailbox(ctx.team, agentId);
    mailbox.write({ id: `${Date.now()}`, type: "user_message", sender: message.fromAgent, recipient: agentId, payload: { text: message.text }, timestamp: Date.now() / 1000, read: false });
  }

  async shutdown(agentId, force = false) {
    const entry = this._tasks.get(agentId);
    if (!entry) return false;
    if (force) entry.ctx.abortController.abort(true);
    else entry.ctx.abortController.abort(false);
    removeTeammateContext(agentId);
    this._tasks.delete(agentId);
    return true;
  }

  listAgents() { return [...this._tasks.entries()].map(([id, e]) => ({ agentId: id, name: e.config.name, status: e.ctx.status })); }
}

export { TeammateAbortController, TeammateContext, getTeammateContext, setTeammateContext, removeTeammateContext, InProcessBackend };
