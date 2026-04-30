const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULTS = 1000;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.hg', '.svn']);

class ToolExecutionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.details = details;
  }
}

class ToolRegistry {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.tools = new Map();
  }

  register(tool) {
    if (!tool || typeof tool !== 'object') {
      throw new ToolExecutionError('INVALID_TOOL', 'Tool must be an object.');
    }

    if (!isNonEmptyString(tool.name)) {
      throw new ToolExecutionError('INVALID_TOOL_NAME', 'Tool name must be a non-empty string.');
    }

    if (typeof tool.execute !== 'function') {
      throw new ToolExecutionError('INVALID_TOOL_EXECUTOR', `Tool "${tool.name}" must provide an execute function.`);
    }

    if (this.tools.has(tool.name)) {
      throw new ToolExecutionError('DUPLICATE_TOOL', `Tool "${tool.name}" is already registered.`);
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || null,
      execute: tool.execute,
    });

    return this;
  }

  list() {
    return Array.from(this.tools.values(), (tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(name, args = {}, context = {}) {
    const startedAt = Date.now();

    try {
      if (!isNonEmptyString(name)) {
        throw new ToolExecutionError('INVALID_TOOL_NAME', 'Tool name must be a non-empty string.');
      }

      assertPlainObject(args, 'Tool arguments');
      const tool = this.tools.get(name);

      if (!tool) {
        throw new ToolExecutionError('TOOL_NOT_FOUND', `Tool "${name}" is not registered.`);
      }

      const data = await tool.execute(args, {
        ...context,
        root: this.root,
        registry: this,
      });

      return serializeToolResult({
        toolName: name,
        ok: true,
        data,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return serializeToolResult({
        toolName: name,
        ok: false,
        error,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

function createLocalToolRegistry(options = {}) {
  const registry = new ToolRegistry({ root: options.root });
  const shellPolicy = normalizeShellPolicy(options.shellPolicy);

  registry
    .register(createReadFileTool())
    .register(createWriteFileTool())
    .register(createGlobTool())
    .register(createSearchTool())
    .register(createShellTool(shellPolicy));

  return registry;
}

function createReadFileTool() {
  return {
    name: 'file.read',
    description: 'Read a UTF-8 text file inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const maxBytes = readPositiveInteger(args.maxBytes, DEFAULT_MAX_FILE_BYTES, 'maxBytes');

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      const resolvedPath = resolveWithinRoot(context.root, filePath);
      const stats = await statPath(resolvedPath);

      if (!stats.isFile()) {
        throw new ToolExecutionError('NOT_A_FILE', `Path is not a file: ${filePath}`);
      }

      if (stats.size > maxBytes) {
        throw new ToolExecutionError('FILE_TOO_LARGE', `File exceeds maxBytes (${maxBytes}).`, {
          bytes: stats.size,
          maxBytes,
        });
      }

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        bytes: stats.size,
        encoding,
        content: await fs.readFile(resolvedPath, { encoding }),
      };
    },
  };
}

function createWriteFileTool() {
  return {
    name: 'file.write',
    description: 'Write a UTF-8 text file inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        overwrite: { type: 'boolean', default: true },
        createParentDirectories: { type: 'boolean', default: false },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const content = requireString(args.content, 'content');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const overwrite = args.overwrite !== false;
      const createParentDirectories = args.createParentDirectories === true;
      const maxBytes = readPositiveInteger(args.maxBytes, DEFAULT_MAX_FILE_BYTES, 'maxBytes');

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      const bytes = Buffer.byteLength(content, encoding);

      if (bytes > maxBytes) {
        throw new ToolExecutionError('CONTENT_TOO_LARGE', `Content exceeds maxBytes (${maxBytes}).`, {
          bytes,
          maxBytes,
        });
      }

      const resolvedPath = resolveWithinRoot(context.root, filePath);
      const parentPath = resolveWithinRoot(context.root, path.dirname(filePath));
      const previousContent = await readExistingFileContent(resolvedPath, encoding);

      if (createParentDirectories) {
        await fs.mkdir(parentPath, { recursive: true });
      } else {
        const parentStats = await statPath(parentPath);

        if (!parentStats.isDirectory()) {
          throw new ToolExecutionError('PARENT_NOT_DIRECTORY', `Parent path is not a directory: ${path.dirname(filePath)}`);
        }
      }

      await fs.writeFile(resolvedPath, content, {
        encoding,
        flag: overwrite ? 'w' : 'wx',
      });

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        bytes,
        encoding,
        overwritten: previousContent !== null,
        change: createFileChangeSummary(previousContent, content),
      };
    },
  };
}

function createGlobTool() {
  return {
    name: 'file.glob',
    description: 'List files matching a glob pattern inside the workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', default: '**/*' },
        cwd: { type: 'string', default: '.' },
        includeDirectories: { type: 'boolean', default: false },
        maxResults: { type: 'number', default: DEFAULT_MAX_RESULTS },
      },
    },
    async execute(args, context) {
      const pattern = args.pattern === undefined ? '**/*' : requireString(args.pattern, 'pattern');
      const cwd = args.cwd === undefined ? '.' : requireString(args.cwd, 'cwd');
      const includeDirectories = args.includeDirectories === true;
      const maxResults = readPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, 'maxResults');
      const matches = await collectGlobMatches({
        root: context.root,
        cwd,
        pattern,
        includeDirectories,
        maxResults,
      });

      return {
        pattern,
        cwd: toWorkspacePath(context.root, resolveWithinRoot(context.root, cwd)),
        matches: matches.items,
        truncated: matches.truncated,
      };
    },
  };
}

function createSearchTool() {
  return {
    name: 'file.search',
    description: 'Search text files inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        path: { type: 'string', default: '.' },
        glob: { type: 'string', default: '**/*' },
        regex: { type: 'boolean', default: false },
        caseSensitive: { type: 'boolean', default: true },
        maxResults: { type: 'number', default: 100 },
        maxFileBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const query = requireString(args.query, 'query');
      const searchPath = args.path === undefined ? '.' : requireString(args.path, 'path');
      const glob = args.glob === undefined ? '**/*' : requireString(args.glob, 'glob');
      const useRegex = args.regex === true;
      const caseSensitive = args.caseSensitive !== false;
      const maxResults = readPositiveInteger(args.maxResults, 100, 'maxResults');
      const maxFileBytes = readPositiveInteger(args.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 'maxFileBytes');
      const matcher = createLineMatcher(query, { useRegex, caseSensitive });
      const files = await collectSearchFiles({
        root: context.root,
        searchPath,
        glob,
        maxResults: Math.max(maxResults * 10, maxResults),
      });
      const matches = [];

      for (const file of files.items) {
        if (matches.length >= maxResults) {
          break;
        }

        const resolvedPath = resolveWithinRoot(context.root, file.path);
        const stats = await statPath(resolvedPath);

        if (!stats.isFile() || stats.size > maxFileBytes) {
          continue;
        }

        const content = await fs.readFile(resolvedPath, { encoding: 'utf8' });

        if (content.includes('\0')) {
          continue;
        }

        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const column = matcher(line);

          if (column !== -1) {
            matches.push({
              path: file.path,
              line: index + 1,
              column: column + 1,
              text: line,
            });
          }

          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return {
        query,
        path: toWorkspacePath(context.root, resolveWithinRoot(context.root, searchPath)),
        glob,
        regex: useRegex,
        caseSensitive,
        matches,
        truncated: matches.length >= maxResults || files.truncated,
      };
    },
  };
}

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

function resolveWithinRoot(root, requestedPath) {
  const value = requireString(requestedPath, 'path');
  const resolvedPath = path.resolve(root, value);
  const relativePath = path.relative(root, resolvedPath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  throw new ToolExecutionError('PATH_OUTSIDE_ROOT', `Path escapes workspace root: ${value}`);
}

function toWorkspacePath(root, resolvedPath) {
  const relativePath = path.relative(root, resolvedPath);
  return relativePath === '' ? '.' : normalizeSlashes(relativePath);
}

async function statPath(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new ToolExecutionError('PATH_NOT_FOUND', `Path does not exist: ${filePath}`);
    }

    throw error;
  }
}

async function readExistingFileContent(filePath, encoding) {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    return await fs.readFile(filePath, { encoding });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function createFileChangeSummary(previousContent, nextContent) {
  const previousLines = splitLines(previousContent || '');
  const nextLines = splitLines(nextContent || '');
  const diff = createLineDiff(previousLines, nextLines);

  return {
    operation: previousContent === null ? 'create' : 'update',
    added: diff.added,
    removed: diff.removed,
    changed: diff.preview.length,
    preview: diff.preview.slice(0, 8),
  };
}

function createLineDiff(previousLines, nextLines) {
  let prefixLength = 0;

  while (
    prefixLength < previousLines.length &&
    prefixLength < nextLines.length &&
    previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < previousLines.length - prefixLength &&
    suffixLength < nextLines.length - prefixLength &&
    previousLines[previousLines.length - 1 - suffixLength] === nextLines[nextLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removedLines = previousLines.slice(prefixLength, previousLines.length - suffixLength);
  const addedLines = nextLines.slice(prefixLength, nextLines.length - suffixLength);
  const preview = addedLines.map((line, index) => ({
    line: prefixLength + index + 1,
    marker: '+',
    text: line,
  }));

  return {
    added: addedLines.length,
    removed: removedLines.length,
    preview,
  };
}

function splitLines(content) {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, '\n').split('\n');
}

async function collectGlobMatches(options) {
  const cwdPath = resolveWithinRoot(options.root, options.cwd);
  const stats = await statPath(cwdPath);

  if (!stats.isDirectory()) {
    throw new ToolExecutionError('NOT_A_DIRECTORY', `Glob cwd is not a directory: ${options.cwd}`);
  }

  const matcher = globToMatcher(options.pattern);
  const items = [];
  let truncated = false;

  async function walk(currentPath, relativePath) {
    if (items.length >= options.maxResults) {
      truncated = true;
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (items.length >= options.maxResults) {
        truncated = true;
        return;
      }

      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const entryPath = path.join(currentPath, entry.name);
      const type = entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file';

      if ((type !== 'directory' || options.includeDirectories) && matcher(entryRelativePath)) {
        items.push({ path: toWorkspacePath(options.root, entryPath), type });
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(entryPath, entryRelativePath);
      }
    }
  }

  await walk(cwdPath, '');

  return { items, truncated };
}

async function collectSearchFiles(options) {
  const resolvedPath = resolveWithinRoot(options.root, options.searchPath);
  const stats = await statPath(resolvedPath);

  if (stats.isFile()) {
    return {
      items: [{ path: toWorkspacePath(options.root, resolvedPath), type: 'file' }],
      truncated: false,
    };
  }

  if (!stats.isDirectory()) {
    throw new ToolExecutionError('NOT_SEARCHABLE', `Search path is not a file or directory: ${options.searchPath}`);
  }

  return collectGlobMatches({
    root: options.root,
    cwd: options.searchPath,
    pattern: options.glob,
    includeDirectories: false,
    maxResults: options.maxResults,
  });
}

function globToMatcher(pattern) {
  const normalizedPattern = normalizeSlashes(pattern || '**/*').replace(/^\.\//, '');
  let source = '^';

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    const afterNext = normalizedPattern[index + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*\/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  const expression = new RegExp(`${source}$`);
  return (value) => expression.test(normalizeSlashes(value));
}

function createLineMatcher(query, options) {
  if (!options.useRegex) {
    const needle = options.caseSensitive ? query : query.toLocaleLowerCase();

    return (line) => {
      const haystack = options.caseSensitive ? line : line.toLocaleLowerCase();
      return haystack.indexOf(needle);
    };
  }

  let expression;

  try {
    expression = new RegExp(query, options.caseSensitive ? '' : 'i');
  } catch (error) {
    throw new ToolExecutionError('INVALID_REGEX', error.message);
  }

  return (line) => {
    const match = expression.exec(line);
    return match ? match.index : -1;
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

function runCommand(options) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const child = spawn(options.command, options.args, {
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

function serializeToolResult(result) {
  const serialized = {
    type: 'tool_result',
    toolName: result.toolName || null,
    ok: result.ok === true,
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
  };

  if (serialized.ok) {
    serialized.data = toJsonSafe(result.data);
  } else {
    serialized.error = serializeError(result.error);
  }

  return serialized;
}

function stringifyToolResult(result) {
  return JSON.stringify(serializeToolResult(result), null, 2);
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return {
      code: 'TOOL_ERROR',
      message: String(error || 'Unknown tool error.'),
    };
  }

  return {
    code: error.code || 'TOOL_ERROR',
    message: error.message || 'Unknown tool error.',
    details: toJsonSafe(error.details),
  };
}

function toJsonSafe(value, seen = new WeakSet()) {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item, seen));
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item, seen)]));
  }

  return String(value);
}

function requireString(value, name) {
  if (!isNonEmptyString(value)) {
    throw new ToolExecutionError('INVALID_ARGUMENT', `${name} must be a non-empty string.`);
  }

  return value;
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ToolExecutionError('INVALID_LIMIT', `${name} must be a positive safe integer.`);
  }

  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolExecutionError('INVALID_ARGUMENT', `${name} must be an object.`);
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function normalizeCommandName(command) {
  return path.basename(command).replace(/\.exe$/i, '').toLocaleLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

module.exports = {
  ToolExecutionError,
  ToolRegistry,
  createLocalToolRegistry,
  createReadFileTool,
  createWriteFileTool,
  createGlobTool,
  createSearchTool,
  createShellTool,
  serializeToolResult,
  stringifyToolResult,
};
