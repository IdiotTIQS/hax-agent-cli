'use strict';

const { requireEnum, requireString } = require('./utils');

const AgentStatus = Object.freeze({
  idle: 'idle',
  running: 'running',
  blocked: 'blocked',
  done: 'done',
});

class AgentDefinition {
  constructor(input = {}) {
    requireString(input.name, 'agent.name');

    this.name = input.name;
    this.role = input.role || '';
    this.goal = input.goal || '';
    this.tools = [...(input.tools || [])];
    this.status = input.status || AgentStatus.idle;
    this.metadata = { ...(input.metadata || {}) };
  }

  canUseTool(toolName) {
    return this.tools.length === 0 || this.tools.includes(toolName);
  }

  assign(taskId) {
    this.status = AgentStatus.running;
    return Object.freeze({ agent: this.name, taskId, status: this.status });
  }

  release(status = AgentStatus.idle) {
    requireEnum(status, AgentStatus, 'agent.status');
    this.status = status;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      name: this.name,
      role: this.role,
      goal: this.goal,
      tools: Object.freeze([...this.tools]),
      status: this.status,
      metadata: Object.freeze({ ...this.metadata }),
    });
  }
}

function createAgent(input) {
  return new AgentDefinition(input);
}

function createAgentDescriptor(input) {
  return createAgent(input).snapshot();
}


module.exports = { AgentDefinition, AgentStatus, createAgent, createAgentDescriptor };
