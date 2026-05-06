const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_RESULTS = 1000;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.hg', '.svn']);

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

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalizeCommandName(command) {
  const trimmed = command.trim();
  const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');
  const base = hasPathSeparator ? trimmed : trimmed.split(/\s+/)[0];
  return path.basename(base).replace(/\.exe$/i, '').toLocaleLowerCase();
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

function splitLines(content) {
  if (content.length === 0) {
    return [];
  }
  return content.replace(/\r\n/g, '\n').split('\n');
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
  return { added: addedLines.length, removed: removedLines.length, preview };
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

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return { code: 'TOOL_ERROR', message: String(error || 'Unknown tool error.') };
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

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_RESULTS,
  IGNORED_DIRECTORY_NAMES,
  requireString,
  readPositiveInteger,
  assertPlainObject,
  isNonEmptyString,
  normalizeSlashes,
  escapeRegExp,
  normalizeCommandName,
  resolveWithinRoot,
  toWorkspacePath,
  statPath,
  readExistingFileContent,
  splitLines,
  createLineDiff,
  createFileChangeSummary,
  serializeError,
  toJsonSafe,
  serializeToolResult,
  stringifyToolResult,
};
