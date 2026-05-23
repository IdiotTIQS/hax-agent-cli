"use strict";

/**
 * DynamicCommandRegistry — extends the static SLASH_COMMANDS + COMMAND_HANDLERS
 * pattern with runtime registration/unregistration of slash commands.
 *
 * Plugins, extensions, and optional modules can add or remove commands
 * without modifying the core definitions file.
 */

const {
  SLASH_COMMANDS: BUILTIN_COMMANDS,
} = require("../commands/definitions");

const {
  listCommandHandlerNames,
} = require("../commands");

class DynamicCommandRegistry {
  constructor() {
    /** @type {Array<{name:string, descriptionKey:string, description:string, aliases:string[], argHint?:string}>} */
    this._dynamicCommands = [];
    /** @type {Map<string, Function>} */
    this._dynamicHandlers = new Map();
  }

  /**
   * Register a new slash command with its handler function.
   *
   * @param {object} opts
   * @param {string} opts.name            — command name (without slash)
   * @param {string} [opts.descriptionKey] — i18n key for description
   * @param {string} [opts.description]    — fallback description text
   * @param {string[]} [opts.aliases]      — alternative command names
   * @param {string} [opts.argHint]        — hint for arguments
   * @param {Function} opts.handler        — async (args, context) => void
   * @param {string} [opts.source]         — tag for who registered it (e.g. plugin name)
   */
  register(opts) {
    if (!opts || !opts.name || typeof opts.name !== "string") {
      throw new TypeError("DynamicCommandRegistry.register: opts.name (string) is required");
    }
    if (!opts.handler || typeof opts.handler !== "function") {
      throw new TypeError("DynamicCommandRegistry.register: opts.handler (function) is required");
    }

    const name = opts.name.trim();
    if (!name) throw new Error("DynamicCommandRegistry.register: name must not be empty");

    // Prevent overwriting built-ins
    const builtin = BUILTIN_COMMANDS.find(
      (c) => c.name === name || (c.aliases && c.aliases.includes(name))
    );
    if (builtin) {
      throw new Error(
        `DynamicCommandRegistry.register: "${name}" conflicts with built-in command "/${builtin.name}"`
      );
    }

    // Remove any existing dynamic registration under the same name
    this.unregister(name);

    this._dynamicCommands.push({
      name,
      descriptionKey: opts.descriptionKey || `cmd.${name}`,
      description: opts.description || `Dynamic command: /${name}`,
      aliases: Array.isArray(opts.aliases) ? opts.aliases : [],
      argHint: opts.argHint || undefined,
      source: opts.source || "dynamic",
    });

    this._dynamicHandlers.set(name, opts.handler);
  }

  /**
   * Unregister a dynamically registered command (by name).
   * Built-in commands cannot be unregistered.
   *
   * @param {string} name
   * @returns {boolean} true if a dynamic command was removed
   */
  unregister(name) {
    const idx = this._dynamicCommands.findIndex((c) => c.name === name);
    if (idx === -1) return false;

    this._dynamicCommands.splice(idx, 1);
    this._dynamicHandlers.delete(name);
    return true;
  }

  /**
   * Return the complete command list — built-in commands first, then dynamic.
   *
   * @returns {Array<{name:string, descriptionKey:string, description:string, aliases:string[], argHint?:string, source?:string}>}
   */
  getCommands() {
    return [
      ...BUILTIN_COMMANDS,
      ...this._dynamicCommands,
    ];
  }

  /**
   * Find a command definition by name or alias across built-in + dynamic.
   *
   * @param {string} commandName
   * @returns {object|undefined}
   */
  findCommand(commandName) {
    const all = this.getCommands();
    return all.find(
      (c) => c.name === commandName || (c.aliases && c.aliases.includes(commandName))
    );
  }

  /**
   * Return the handler function for a given command name.
   * Looks up built-in handlers first, then dynamic.
   *
   * @param {string} name
   * @returns {Function|undefined}
   */
  getHandler(name) {
    const builtinNames = listCommandHandlerNames();
    if (builtinNames.includes(name)) {
      const { COMMAND_HANDLERS } = require("../commands");
      return COMMAND_HANDLERS[name];
    }
    return this._dynamicHandlers.get(name);
  }

  /**
   * Check whether a command name is known (built-in or dynamic).
   *
   * @param {string} commandName
   * @returns {boolean}
   */
  hasCommand(commandName) {
    if (listCommandHandlerNames().includes(commandName)) return true;
    return this._dynamicHandlers.has(commandName);
  }
}

module.exports = { DynamicCommandRegistry };
