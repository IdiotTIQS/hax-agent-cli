'use strict';

// ---------------------------------------------------------------------------
// SandboxPolicy — whitelist/blacklist controls for modules, commands, domains,
// and resource limits for the sandbox execution system.
// ---------------------------------------------------------------------------

/**
 * Immutable resource-limit descriptor used by SandboxExecutor to cap
 * cpu time, memory, output size, and wall-clock time.
 */
class ResourceLimits {
  /**
   * @param {object} [options]
   * @param {number} [options.maxCpu]     max CPU time in ms (default: 5 000)
   * @param {number} [options.maxMemory]  max heap delta in bytes (default: 128 MiB)
   * @param {number} [options.maxOutput]  max captured output in bytes (default: 1 MiB)
   * @param {number} [options.maxTime]    max wall-clock timeout in ms (default: 30 000)
   */
  constructor(options = {}) {
    this.maxCpu = safePositiveInt(options.maxCpu, 5_000);
    this.maxMemory = safePositiveInt(options.maxMemory, 128 * 1024 * 1024);
    this.maxOutput = safePositiveInt(options.maxOutput, 1 * 1024 * 1024);
    this.maxTime = safePositiveInt(options.maxTime, 30_000);
    Object.freeze(this);
  }

  /**
   * Merge partial overrides into a new frozen ResourceLimits instance.
   * @param {object} overrides
   * @returns {ResourceLimits}
   */
  merge(overrides = {}) {
    return new ResourceLimits({
      maxCpu: overrides.maxCpu !== undefined ? overrides.maxCpu : this.maxCpu,
      maxMemory: overrides.maxMemory !== undefined ? overrides.maxMemory : this.maxMemory,
      maxOutput: overrides.maxOutput !== undefined ? overrides.maxOutput : this.maxOutput,
      maxTime: overrides.maxTime !== undefined ? overrides.maxTime : this.maxTime,
    });
  }
}

/**
 * A policy that controls which modules, shell commands, and network domains
 * are permitted inside a sandbox, together with resource limits.
 *
 * Built-in presets: STRICT, READ_ONLY, DEVELOPMENT, UNRESTRICTED.
 */
class SandboxPolicy {
  /**
   * @param {string}   name
   * @param {object}   [options]
   * @param {string[]} [options.allowedModules]
   * @param {string[]} [options.deniedModules]
   * @param {string[]} [options.allowedCommands]
   * @param {string[]} [options.allowedDomains]
   * @param {object}   [options.resourceLimits]
   */
  constructor(name, options = {}) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('SandboxPolicy requires a non-empty name');
    }
    this.name = name;

    this._allowedModules = new Set(normalizeList(options.allowedModules));
    this._deniedModules = new Set(normalizeList(options.deniedModules));
    this._allowedCommands = new Set(normalizeList(options.allowedCommands));
    this._deniedCommands = new Set(normalizeList(options.deniedCommands));
    this._allowedDomains = new Set(normalizeList(options.allowedDomains));

    this._resourceLimits = new ResourceLimits(options.resourceLimits);

    // A wildcard entry means "allow everything" for that category.
    this._wildcardModules = this._allowedModules.has('*');
    this._wildcardCommands = this._allowedCommands.has('*');
    this._wildcardDomains = this._allowedDomains.has('*');
  }

  // -- Module whitelist / blacklist ------------------------------------------

  /** @param {string} name */
  allowModule(name) {
    if (typeof name !== 'string' || name.trim().length === 0) return;
    name = name.trim().toLowerCase();
    this._allowedModules.add(name);
    if (name === '*') this._wildcardModules = true;
    this._deniedModules.delete(name);
  }

  /** @param {string} name */
  denyModule(name) {
    if (typeof name !== 'string' || name.trim().length === 0) return;
    name = name.trim().toLowerCase();
    this._deniedModules.add(name);
    this._allowedModules.delete(name);
    if (name === '*') this._wildcardModules = false;
  }

  /**
   * Check whether a module is allowed. Denied list takes precedence.
   * @param {string} name
   * @returns {boolean}
   */
  isModuleAllowed(name) {
    if (typeof name !== 'string') return false;
    name = name.trim().toLowerCase();
    if (this._deniedModules.has(name)) return false;
    if (this._wildcardModules) return true;
    return this._allowedModules.has(name);
  }

  // -- Command whitelist -----------------------------------------------------

  /** @param {string} command */
  allowCommand(command) {
    if (typeof command !== 'string' || command.trim().length === 0) return;
    command = command.trim().toLowerCase();
    this._allowedCommands.add(command);
    if (command === '*') this._wildcardCommands = true;
    this._deniedCommands.delete(command);
  }

  /** @param {string} command */
  denyCommand(command) {
    if (typeof command !== 'string' || command.trim().length === 0) return;
    command = command.trim().toLowerCase();
    this._deniedCommands.add(command);
    this._allowedCommands.delete(command);
    if (command === '*') this._wildcardCommands = false;
  }

  /**
   * Check whether a shell command is allowed.
   * @param {string} command
   * @returns {boolean}
   */
  isCommandAllowed(command) {
    if (typeof command !== 'string') return false;
    command = command.trim().toLowerCase();
    if (this._deniedCommands.has(command)) return false;
    if (this._wildcardCommands) return true;
    return this._allowedCommands.has(command);
  }

  // -- Domain whitelist ------------------------------------------------------

  /** @param {string} domain */
  allowDomain(domain) {
    if (typeof domain !== 'string' || domain.trim().length === 0) return;
    domain = domain.trim().toLowerCase();
    this._allowedDomains.add(domain);
    if (domain === '*') this._wildcardDomains = true;
  }

  /** @param {string} domain */
  denyDomain(domain) {
    if (typeof domain !== 'string' || domain.trim().length === 0) return;
    domain = domain.trim().toLowerCase();
    this._allowedDomains.delete(domain);
    if (domain === '*') this._wildcardDomains = false;
  }

  /**
   * Check whether a network domain is allowed.
   * @param {string} domain
   * @returns {boolean}
   */
  isDomainAllowed(domain) {
    if (typeof domain !== 'string') return false;
    domain = domain.trim().toLowerCase();
    if (this._wildcardDomains) return true;
    return this._allowedDomains.has(domain);
  }

  // -- Resource limits -------------------------------------------------------

  /**
   * Set resource limits. Accepts partial overrides — unspecified keys keep
   * their current values.
   * @param {object} limits
   */
  setResourceLimits(limits = {}) {
    this._resourceLimits = this._resourceLimits.merge(limits);
  }

  /** @returns {ResourceLimits} */
  getResourceLimits() {
    return this._resourceLimits;
  }

  // -- Snapshot / introspection ----------------------------------------------

  /**
   * Return a read-only snapshot of the policy state.
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      allowedModules: [...this._allowedModules].sort(),
      deniedModules: [...this._deniedModules].sort(),
      allowedCommands: [...this._allowedCommands].sort(),
      deniedCommands: [...this._deniedCommands].sort(),
      allowedDomains: [...this._allowedDomains].sort(),
      resourceLimits: { ...this._resourceLimits },
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

/** Nothing allowed — the safest default. */
SandboxPolicy.STRICT = new SandboxPolicy('STRICT', {
  allowedModules: [],
  allowedCommands: [],
  allowedDomains: [],
  resourceLimits: { maxCpu: 5_000, maxMemory: 64 * 1024 * 1024, maxOutput: 512 * 1024, maxTime: 15_000 },
});

/**
 * Read-only file-system access (fs.read*, no writes), basic shell
 * inspection commands (ls, cat, head, tail, grep, find, wc, git log/status).
 */
SandboxPolicy.READ_ONLY = new SandboxPolicy('READ_ONLY', {
  allowedModules: ['fs', 'path', 'os'],
  allowedCommands: ['ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'git', 'node'],
  allowedDomains: [],
  resourceLimits: { maxCpu: 10_000, maxMemory: 128 * 1024 * 1024, maxOutput: 1 * 1024 * 1024, maxTime: 30_000 },
});

/** Typical dev-tool modules and all commands / domains. */
SandboxPolicy.DEVELOPMENT = new SandboxPolicy('DEVELOPMENT', {
  allowedModules: ['fs', 'path', 'os', 'util', 'crypto', 'child_process', 'stream', 'events', 'buffer', 'url', 'querystring'],
  allowedCommands: ['*'],
  allowedDomains: ['*'],
  resourceLimits: { maxCpu: 30_000, maxMemory: 256 * 1024 * 1024, maxOutput: 5 * 1024 * 1024, maxTime: 60_000 },
});

/** Everything is permitted — use with extreme caution. */
SandboxPolicy.UNRESTRICTED = new SandboxPolicy('UNRESTRICTED', {
  allowedModules: ['*'],
  allowedCommands: ['*'],
  allowedDomains: ['*'],
  resourceLimits: { maxCpu: 60_000, maxMemory: 512 * 1024 * 1024, maxOutput: 10 * 1024 * 1024, maxTime: 120_000 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safePositiveInt(value, fallback) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------

module.exports = { SandboxPolicy, ResourceLimits };
