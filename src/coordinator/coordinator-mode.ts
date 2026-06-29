/** Coordinator mode — agent team orchestration. Ported from OpenHarness coordinator/coordinator_mode.py */

interface AgentLike {
  name: string;
}

interface PlanStep {
  id: string;
  agent: string;
  prompt?: string;
  description?: string;
}

interface CoordinatorModeOptions {
  teamName?: string;
  plan?: PlanStep[];
}

interface StepResult {
  step: string;
  ok: boolean;
  agent?: string;
  events?: number;
  error?: string;
}

interface EngineWithSendMessage {
  sendMessage(prompt: string): AsyncIterable<unknown>;
}

class CoordinatorMode {
  private _agents: Map<string, AgentLike>;
  private _teamName: string;
  private _plan: PlanStep[];

  constructor(opts: CoordinatorModeOptions = {}) {
    this._agents = new Map();
    this._teamName = opts.teamName || "default";
    this._plan = opts.plan || [];
  }

  registerAgent(agent: AgentLike): this { this._agents.set(agent.name, agent); return this; }
  getAgent(name: string): AgentLike | null { return this._agents.get(name) || null; }
  listAgents(): AgentLike[] { return [...this._agents.values()]; }

  setPlan(steps: PlanStep[]): void { this._plan = steps; }
  getPlan(): PlanStep[] { return [...this._plan]; }

  /** Run plan steps sequentially across agents */
  async execute(engine: EngineWithSendMessage, _context: Record<string, unknown> = {}): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of this._plan) {
      const agent = this._agents.get(step.agent);
      if (!agent) { results.push({ step: step.id, ok: false, error: `Agent ${step.agent} not found` }); continue; }
      try {
        const prompt = step.prompt || step.description || "";
        const msgs: unknown[] = [];
        for await (const event of engine.sendMessage(prompt)) { msgs.push(event); }
        results.push({ step: step.id, ok: true, agent: step.agent, events: msgs.length });
      } catch (err) { results.push({ step: step.id, ok: false, error: (err as Error).message }); }
    }
    return results;
  }
}

export { CoordinatorMode };
