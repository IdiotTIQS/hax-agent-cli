"use strict";
/** Coordinator mode — agent team orchestration. Ported from OpenHarness coordinator/coordinator_mode.py */

class CoordinatorMode {
  constructor(opts = {}) { this._agents = new Map(); this._teamName = opts.teamName || "default"; this._plan = opts.plan || []; }

  registerAgent(agent) { this._agents.set(agent.name, agent); return this; }
  getAgent(name) { return this._agents.get(name) || null; }
  listAgents() { return [...this._agents.values()]; }

  setPlan(steps) { this._plan = steps; }
  getPlan() { return [...this._plan]; }

  /** Run plan steps sequentially across agents */
  async execute(engine, context = {}) {
    const results = [];
    for (const step of this._plan) {
      const agent = this._agents.get(step.agent);
      if (!agent) { results.push({ step: step.id, ok: false, error: `Agent ${step.agent} not found` }); continue; }
      try {
        const prompt = step.prompt || step.description || "";
        const msgs = [];
        for await (const event of engine.sendMessage(prompt)) { msgs.push(event); }
        results.push({ step: step.id, ok: true, agent: step.agent, events: msgs.length });
      } catch (err) { results.push({ step: step.id, ok: false, error: err.message }); }
    }
    return results;
  }
}

module.exports = { CoordinatorMode };
