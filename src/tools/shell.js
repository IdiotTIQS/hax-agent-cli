const path = require('node:path');
const { spawn } = require('node:child_process');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_FILE_BYTES,
  requireString,
  readPositiveInteger,
  normalizeCommandName,
  resolveWithinRoot,
  toWorkspacePath,
} = require('./utils');

function createShellTool(policy) {
  return {
    name: 'shell.run',
    description: 'Run an allowlisted local command without shell interpolation.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        cwd: { type: 'string', default: '.' },
        timeoutMs: { type: 'number' },
      },
    },
    execute(args, context) {
      const command = requireString(args.command, 'command');
      const commandArgs = args.args === undefined ? [] : args.args;
      const cwd = args.cwd === undefined ? '.' : requireString(args.cwd, 'cwd');
      const timeoutMs = readPositiveInteger(args.timeoutMs, policy.timeoutMs, 'timeoutMs');

      if (!policy.enabled) {
        throw new ToolExecutionError('SHELL_DISABLED', 'Shell execution is disabled by policy.');
      }

      if (!Array.isArray(commandArgs) || !commandArgs.every((item) => typeof item === 'string')) {
        throw new ToolExecutionError('INVALID_SHELL_ARGS', 'Shell args must be an array of strings.');
      }

      assertCommandAllowed(command, policy);

      return runCommand({
        command,
        args: commandArgs,
        cwd: resolveWithinRoot(context.root, cwd),
        root: context.root,
        timeoutMs,
        maxBuffer: policy.maxBuffer,
        env: policy.env,
      });
    },
  };
}

function normalizeShellPolicy(policy = {}) {
  const allowedCommands = Array.isArray(policy.allowedCommands) ? policy.allowedCommands : [];

  return {
    enabled: policy.enabled === true,
    allowedCommands: new Set(allowedCommands.map(normalizeCommandName)),
    timeoutMs: readPositiveInteger(policy.timeoutMs, 10_000, 'timeoutMs'),
    maxBuffer: readPositiveInteger(policy.maxBuffer, DEFAULT_MAX_FILE_BYTES, 'maxBuffer'),
    env: policy.env && typeof policy.env === 'object' ? { ...process.env, ...policy.env } : process.env,
  };
}

function assertCommandAllowed(command, policy) {
  if (!policy.allowedCommands.has(normalizeCommandName(command))) {
    throw new ToolExecutionError('COMMAND_NOT_ALLOWED', `Command is not allowed by policy: ${command}`);
  }
}

const _winCommandCache = new Map();

function resolveWindowsCommand(command) {
  if (process.platform !== 'win32') return Promise.resolve(command);
  if (path.isAbsolute(command)) return Promise.resolve(command);
  if (command.includes('/') || command.includes('\\')) return Promise.resolve(command);

  const cached = _winCommandCache.get(command);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const child = spawn('where', [command], { shell: true, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => {
      const resolved = code === 0 ? stdout.trim().split(/\r?\n/)[0].trim() : command;
      _winCommandCache.set(command, resolved);
      resolve(resolved);
    });
    child.on('error', () => {
      _winCommandCache.set(command, command);
      resolve(command);
    });
  });
}

async function runCommand(options) {
  const resolvedCommand = await resolveWindowsCommand(options.command);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const child = spawn(resolvedCommand, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk, options.maxBuffer);
      outputExceeded = outputExceeded || stdout.length >= options.maxBuffer;

      if (outputExceeded) {
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk, options.maxBuffer);
      outputExceeded = outputExceeded || stderr.length >= options.maxBuffer;

      if (outputExceeded) {
        child.kill('SIGTERM');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);

      resolve({
        command: options.command,
        args: options.args,
        cwd: toWorkspacePath(options.root, options.cwd),
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        outputExceeded,
      });
    });
  });
}

function appendOutput(current, chunk, maxBuffer) {
  const next = current + chunk.toString('utf8');
  return next.length > maxBuffer ? next.slice(0, maxBuffer) : next;
}

module.exports = { createShellTool, normalizeShellPolicy };
