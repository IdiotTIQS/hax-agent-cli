const path = require('node:path');
const { spawn } = require('node:child_process');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_FILE_BYTES,
  requireString,
  readPositiveInteger,
  resolveWithinRoot,
  toWorkspacePath,
} = require('./utils');

function createShellTool(policy) {
  return {
    name: 'shell.run',
    description: 'Run a local command without shell interpolation. Risky commands require user approval unless yolo mode is enabled.',
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
  return {
    enabled: policy.enabled === true,
    timeoutMs: readPositiveInteger(policy.timeoutMs, 10_000, 'timeoutMs'),
    maxBuffer: readPositiveInteger(policy.maxBuffer, DEFAULT_MAX_FILE_BYTES, 'maxBuffer'),
    env: policy.env && typeof policy.env === 'object' ? { ...process.env, ...policy.env } : process.env,
  };
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
      const resolved = code === 0 ? selectWindowsExecutable(stdout, command) : command;
      _winCommandCache.set(command, resolved);
      resolve(resolved);
    });
    child.on('error', () => {
      _winCommandCache.set(command, command);
      resolve(command);
    });
  });
}

function selectWindowsExecutable(whereOutput, fallback) {
  const candidates = String(whereOutput || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (candidates.length === 0) return fallback;

  const executable = candidates.find((candidate) => {
    const ext = path.extname(candidate).toLowerCase();
    return ext === '.exe' || ext === '.cmd' || ext === '.bat' || ext === '.com';
  });

  return executable || candidates[0];
}

async function runCommand(options) {
  const resolvedCommand = await resolveWindowsCommand(options.command);
  const spawnSpec = createSpawnSpec(resolvedCommand, options.args);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
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
      reject(new ToolExecutionError('SHELL_SPAWN_ERROR',
        `Failed to spawn "${options.command}": ${error.message}`,
        { syscall: error.syscall, errno: error.errno }));
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

function createSpawnSpec(command, args = []) {
  if (process.platform !== 'win32') {
    return { command, args, windowsVerbatimArguments: false };
  }

  const ext = path.extname(command).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') {
    return { command, args, windowsVerbatimArguments: false };
  }

  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandLine = ['call', command, ...args].map(quoteCmdArg).join(' ');
  return {
    command: comspec,
    args: ['/d', '/c', commandLine],
    windowsVerbatimArguments: true,
  };
}

function quoteCmdArg(value) {
  const text = String(value);
  if (text.toLowerCase() === 'call') return 'call';
  if (text.length === 0) return '""';

  const escaped = text
    .replace(/"/g, '""')
    .replace(/%/g, '%%')
    .replace(/\^/g, '^^')
    .replace(/&/g, '^&')
    .replace(/\|/g, '^|')
    .replace(/</g, '^<')
    .replace(/>/g, '^>');

  return `"${escaped}"`;
}

function appendOutput(current, chunk, maxBuffer) {
  const next = current + chunk.toString('utf8');
  return next.length > maxBuffer ? next.slice(0, maxBuffer) : next;
}

module.exports = { createShellTool, normalizeShellPolicy, selectWindowsExecutable, createSpawnSpec };
