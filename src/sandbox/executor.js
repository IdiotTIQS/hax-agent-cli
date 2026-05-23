'use strict';

// ---------------------------------------------------------------------------
// SandboxExecutor — high-level entry point that combines policy enforcement,
// VM sandbox creation, resource tracking, and shell execution into a single
// coherent API.
// ---------------------------------------------------------------------------

const { spawn } = require('node:child_process');
const { createSandbox, runInSandbox } = require('./vm-sandbox');
const { SandboxPolicy } = require('./policy');

// -- Error class -------------------------------------------------------------

class SandboxError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    this.details = details || {};
  }
}

// -- Cumulative statistics ---------------------------------------------------

function createStats() {
  return {
    totalExecutions: 0,
    totalShellExecutions: 0,
    totalErrors: 0,
    totalTimeouts: 0,
    totalCpuUser: 0,
    totalCpuSystem: 0,
    totalMemoryAllocated: 0,
    totalOutputBytes: 0,
    lastExecutionAt: null,
  };
}

// -- Shell execution helpers -------------------------------------------------

/**
 * Run a shell command with the given arguments, enforcing a timeout and output
 * cap. Returns a promise that resolves with the execution result.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @returns {Promise<object>}
 */
function runShellCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000;
  const maxOutput = options.maxOutput || 1_024 * 1_024; // 1 MiB
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Give it a moment; then force kill
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const piece = chunk.toString('utf8');
      if (stdout.length < maxOutput) {
        stdout += piece;
        if (stdout.length > maxOutput) stdout = stdout.slice(0, maxOutput);
      }
    });

    child.stderr.on('data', (chunk) => {
      const piece = chunk.toString('utf8');
      if (stderr.length < maxOutput) {
        stderr += piece;
        if (stderr.length > maxOutput) stderr = stderr.slice(0, maxOutput);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new SandboxError('SHELL_SPAWN_ERROR',
        `Failed to spawn "${command}": ${err.message}`,
        { syscall: err.syscall }));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const outputTruncated = (stdout.length >= maxOutput || stderr.length >= maxOutput);
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        outputTruncated,
      });
    });
  });
}

// -- Executor ----------------------------------------------------------------

/**
 * @class SandboxExecutor
 *
 * @description
 * Central executor that enforces a {@link SandboxPolicy}, runs JavaScript
 * code inside a VM sandbox, executes shell commands with resource limits,
 * and accumulates execution statistics.
 *
 * @example
 * const executor = new SandboxExecutor({ policy: SandboxPolicy.READ_ONLY });
 * const { result } = executor.run('2 + 2');
 * console.log(executor.getStats());
 */
class SandboxExecutor {
  /**
   * @param {object} [options]
   * @param {SandboxPolicy} [options.policy]       policy to enforce (default: STRICT)
   * @param {number}        [options.defaultTimeoutMs]  default JS timeout (default: 30 000)
   * @param {number}        [options.defaultMaxOutput]  default max output bytes (default: 1 MiB)
   * @param {number}        [options.defaultShellTimeoutMs] default shell timeout (default: 30 000)
   */
  constructor(options = {}) {
    this._policy = options.policy || SandboxPolicy.STRICT;
    this._defaultTimeoutMs = safePositiveInt(options.defaultTimeoutMs, 30_000);
    this._defaultMaxOutput = safePositiveInt(options.defaultMaxOutput, 1 * 1024 * 1024);
    this._defaultShellTimeoutMs = safePositiveInt(options.defaultShellTimeoutMs, 30_000);
    this._stats = createStats();
  }

  // -- Policy ---------------------------------------------------------------

  /**
   * Replace the active policy.
   * @param {SandboxPolicy} policy
   */
  setPolicy(policy) {
    if (!(policy instanceof SandboxPolicy)) {
      throw new TypeError('policy must be an instance of SandboxPolicy');
    }
    this._policy = policy;
  }

  /** @returns {SandboxPolicy} */
  getPolicy() {
    return this._policy;
  }

  // -- JavaScript execution --------------------------------------------------

  /**
   * Execute JavaScript code inside a VM sandbox. The active policy determines
   * which built-in modules are injected and what resource limits apply.
   *
   * @param {string} code         JavaScript source code
   * @param {object} [options]
   * @param {number} [options.timeoutMs]   override the default timeout
   * @param {number} [options.maxOutput]   override the default max output bytes
   * @param {object} [options.extraModules]  map of additional modules to inject
   * @param {object} [options.globals]      extra globals exposed to the code
   * @returns {object}  { result, output: { stdout, stderr }, cpuUsage, memoryDelta, timedOut }
   */
  run(code, options = {}) {
    const timeoutMs = safePositiveInt(options.timeoutMs, this._defaultTimeoutMs);
    const maxOutput = safePositiveInt(options.maxOutput, this._defaultMaxOutput);
    const limits = this._policy.getResourceLimits();

    // Enforce policy timeout cap
    const effectiveTimeout = Math.min(timeoutMs, limits.maxTime);

    // Resolve allowed modules from policy
    const injectedModules = this._resolveModules(options.extraModules);

    // Build sandbox
    const sandbox = createSandbox({
      modules: injectedModules,
      globals: options.globals,
      consoleOpts: {
        maxBytes: Math.min(maxOutput, limits.maxOutput),
      },
    });

    // Execute
    let execResult;
    try {
      execResult = runInSandbox(code, sandbox, effectiveTimeout);
    } catch (err) {
      this._recordError(err);
      if (err.code === 'SANDBOX_TIMEOUT') {
        throw new SandboxError('SANDBOX_TIMEOUT',
          `Code execution timed out after ${effectiveTimeout}ms`,
          { output: err.output, cpuUsage: err.cpuUsage, memoryDelta: err.memoryDelta });
      }
      throw new SandboxError(err.code || 'SANDBOX_ERROR',
        err.message || 'Sandbox execution failed',
        { output: err.output, cpuUsage: err.cpuUsage, memoryDelta: err.memoryDelta });
    }

    // Check resource violations post-execution
    this._checkResourceViolations(execResult, limits, maxOutput);

    // Update stats
    this._recordSuccess(execResult);

    return execResult;
  }

  // -- Shell execution -------------------------------------------------------

  /**
   * Execute a shell command with resource limits. The active policy's
   * command whitelist is enforced.
   *
   * @param {string}   command    the command to run (e.g. "ls", "git")
   * @param {object}   [options]
   * @param {string[]} [options.args]       command arguments
   * @param {number}   [options.timeoutMs]  timeout override
   * @param {number}   [options.maxOutput]  max output bytes override
   * @param {string}   [options.cwd]        working directory
   * @param {object}   [options.env]        environment variables
   * @returns {Promise<object>}  { command, args, exitCode, stdout, stderr, timedOut, outputTruncated }
   */
  async runShell(command, options = {}) {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new SandboxError('SHELL_INVALID_COMMAND', 'Command must be a non-empty string');
    }

    // Extract base command name for policy check
    const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();

    if (!this._policy.isCommandAllowed(baseCmd)) {
      throw new SandboxError('SHELL_COMMAND_DENIED',
        `Shell command not allowed by policy: ${baseCmd}`);
    }

    const timeoutMs = safePositiveInt(options.timeoutMs, this._defaultShellTimeoutMs);
    const maxOutput = safePositiveInt(options.maxOutput, this._defaultMaxOutput);
    const limits = this._policy.getResourceLimits();
    const effectiveTimeout = Math.min(timeoutMs, limits.maxTime);

    const args = Array.isArray(options.args) ? options.args : [];

    let shellResult;
    try {
      shellResult = await runShellCommand(command, args, {
        timeoutMs: effectiveTimeout,
        maxOutput: Math.min(maxOutput, limits.maxOutput),
        cwd: options.cwd,
        env: options.env,
      });
    } catch (err) {
      this._stats.totalShellExecutions += 1;
      this._stats.totalErrors += 1;
      throw err;
    }

    // Update stats
    this._stats.totalShellExecutions += 1;
    this._stats.lastExecutionAt = new Date().toISOString();
    if (shellResult.timedOut) {
      this._stats.totalTimeouts += 1;
    }

    return shellResult;
  }

  // -- Statistics ------------------------------------------------------------

  /** @returns {object} cumulative execution statistics */
  getStats() {
    return {
      totalExecutions: this._stats.totalExecutions,
      totalShellExecutions: this._stats.totalShellExecutions,
      totalErrors: this._stats.totalErrors,
      totalTimeouts: this._stats.totalTimeouts,
      totalCpuUser: this._stats.totalCpuUser,
      totalCpuSystem: this._stats.totalCpuSystem,
      totalMemoryAllocated: this._stats.totalMemoryAllocated,
      totalOutputBytes: this._stats.totalOutputBytes,
      lastExecutionAt: this._stats.lastExecutionAt,
    };
  }

  /** Reset cumulative statistics to zero. */
  resetStats() {
    this._stats = createStats();
  }

  // -- Internals -------------------------------------------------------------

  /**
   * Resolve which modules to inject based on the policy and optional extras.
   * Only modules explicitly allowed by the policy are injected. If the policy
   * has the wildcard, the caller is expected to provide the modules via
   * `extraModules` since we cannot safely resolve arbitrary modules.
   *
   * @param {object} [extraModules]
   * @returns {object}
   */
  _resolveModules(extraModules) {
    const modules = Object.create(null);

    // Only load modules that are explicitly allowed by the policy
    const allowedSet = this._policy._allowedModules;
    const wildcard = this._policy._wildcardModules;

    // Known safe built-in modules with their require paths
    const BUILTIN_MODULES = [
      'fs', 'path', 'os', 'util', 'crypto', 'stream', 'events',
      'buffer', 'url', 'querystring', 'string_decoder', 'timers',
    ];

    for (const modName of BUILTIN_MODULES) {
      if (this._policy.isModuleAllowed(modName)) {
        try {
          modules[modName] = require(modName);
        } catch {
          // Module not available — skip
        }
      }
    }

    // Merge in explicit extra modules (caller takes responsibility)
    if (extraModules && typeof extraModules === 'object') {
      for (const [name, mod] of Object.entries(extraModules)) {
        if (wildcard || this._policy.isModuleAllowed(name)) {
          modules[name] = mod;
        }
      }
    }

    return modules;
  }

  _checkResourceViolations(execResult, limits, maxOutput) {
    const cpuMs = cpuToMs(execResult.cpuUsage);
    if (cpuMs > limits.maxCpu) {
      throw new SandboxError('SANDBOX_CPU_EXCEEDED',
        `CPU time exceeded limit (${cpuMs}ms > ${limits.maxCpu}ms)`,
        execResult);
    }

    if (execResult.memoryDelta > limits.maxMemory) {
      throw new SandboxError('SANDBOX_MEMORY_EXCEEDED',
        `Memory usage exceeded limit (${execResult.memoryDelta} > ${limits.maxMemory} bytes)`,
        execResult);
    }

    const outputBytes = calcOutputBytes(execResult.output);
    const effectiveMax = Math.min(maxOutput, limits.maxOutput);

    // Check if output was truncated (by captureOutput's internal limit)
    const wasTruncated = execResult.output && execResult.output.truncated === true;

    if (wasTruncated || outputBytes > effectiveMax) {
      throw new SandboxError('SANDBOX_OUTPUT_EXCEEDED',
        `Output size exceeded limit (${wasTruncated ? 'truncated at ' : ''}${outputBytes} > ${effectiveMax} bytes)`,
        execResult);
    }
  }

  _recordSuccess(execResult) {
    this._stats.totalExecutions += 1;
    this._stats.lastExecutionAt = new Date().toISOString();

    const cpu = execResult.cpuUsage || { user: 0, system: 0 };
    this._stats.totalCpuUser += cpu.user;
    this._stats.totalCpuSystem += cpu.system;
    this._stats.totalMemoryAllocated += (execResult.memoryDelta || 0);
    this._stats.totalOutputBytes += calcOutputBytes(execResult.output);
  }

  _recordError(err) {
    this._stats.totalExecutions += 1;
    this._stats.totalErrors += 1;
    if (err && (err.code === 'SANDBOX_TIMEOUT' || err.timedOut)) {
      this._stats.totalTimeouts += 1;
    }
    this._stats.lastExecutionAt = new Date().toISOString();
  }
}

// -- Helpers -----------------------------------------------------------------

function cpuToMs(cpuUsage) {
  if (!cpuUsage) return 0;
  return ((cpuUsage.user + cpuUsage.system) / 1_000) | 0;
}

function calcOutputBytes(output) {
  if (!output) return 0;
  let bytes = 0;
  const stdout = Array.isArray(output.stdout) ? output.stdout : [];
  const stderr = Array.isArray(output.stderr) ? output.stderr : [];
  for (const line of stdout) bytes += Buffer.byteLength(line, 'utf8');
  for (const line of stderr) bytes += Buffer.byteLength(line, 'utf8');
  return bytes;
}

function safePositiveInt(value, fallback) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

// ---------------------------------------------------------------------------

module.exports = { SandboxExecutor, SandboxError };
