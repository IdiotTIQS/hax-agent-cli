const { createCommandRegistry } = require('./commands');
const { createSession } = require('./sessions');
const { createTaskList } = require('./tasks');

class RuntimeComposition {
  constructor(input = {}) {
    this.commands = input.commands || createCommandRegistry();
    this.session = input.session || createSession(input.sessionOptions);
    this.tasks = input.tasks || createTaskList();
    this.providers = new Map(Object.entries(input.providers || {}));
    this.tools = new Map(Object.entries(input.tools || {}));
    this.agents = new Map(Object.entries(input.agents || {}));
  }

  registerProvider(name, provider) {
    requireString(name, 'provider.name');
    this.providers.set(name, provider);
    return provider;
  }

  registerTool(name, tool) {
    requireString(name, 'tool.name');
    this.tools.set(name, tool);
    return tool;
  }

  registerAgent(name, agent) {
    requireString(name, 'agent.name');
    this.agents.set(name, agent);
    return agent;
  }

  snapshot() {
    return Object.freeze({
      commands: Object.freeze(this.commands.list()),
      session: this.session.snapshot(),
      tasks: Object.freeze(this.tasks.list()),
      providers: Object.freeze(Array.from(this.providers.keys())),
      tools: Object.freeze(Array.from(this.tools.keys())),
      agents: Object.freeze(Array.from(this.agents.keys())),
    });
  }
}

function createRuntimeComposition(input) {
  return new RuntimeComposition(input);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

module.exports = { RuntimeComposition, createRuntimeComposition };
