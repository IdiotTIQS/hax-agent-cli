class CommandRegistry {
  constructor(commands = []) {
    this.commands = new Map();
    commands.forEach((command) => this.register(command));
  }

  register(input) {
    const command = createCommand(input);

    if (this.commands.has(command.name)) {
      throw new Error(`Duplicate command: ${command.name}`);
    }

    this.commands.set(command.name, command);
    return command;
  }

  get(name) {
    return this.commands.get(name) || null;
  }

  list() {
    return Array.from(this.commands.values());
  }

  async run(name, context = {}) {
    const command = this.get(name);

    if (!command) {
      throw new Error(`Unknown command: ${name}`);
    }

    return command.run(context);
  }
}

function createCommand(input) {
  const command = input || {};
  requireString(command.name, 'command.name');

  if (typeof command.run !== 'function') {
    throw new TypeError('command.run must be a function');
  }

  return Object.freeze({
    name: command.name,
    description: command.description || '',
    usage: command.usage || command.name,
    run: command.run,
    metadata: Object.freeze({ ...(command.metadata || {}) }),
  });
}

function createCommandRegistry(commands) {
  return new CommandRegistry(commands);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

module.exports = { CommandRegistry, createCommand, createCommandRegistry };
