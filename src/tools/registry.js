const path = require('node:path');
const { PermissionManager } = require('../permissions');
const { ToolExecutionError } = require('./error');
const { assertPlainObject, isNonEmptyString, serializeToolResult } = require('./utils');
const { createReadFileTool } = require('./file-read');
const { createWriteFileTool } = require('./file-write');
const { createGlobTool } = require('./file-glob');
const { createSearchTool } = require('./file-search');
const { createShellTool, normalizeShellPolicy } = require('./shell');
const { createWebFetchTool } = require('./web-fetch');
const { createWebSearchTool } = require('./web-search');
const { createFileEditTool } = require('./file-edit');
const { createReadDirectoryTool } = require('./file-readdir');
const { createDeleteFileTool } = require('./file-delete');

const SINGLE_CALL_TOOLS = new Set(['web.fetch', 'web.search', 'file.readDirectory']);
const SINGLE_CALL_CACHE_MS = 300_000;

class ToolRegistry {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.tools = new Map();
    this._singleCallCache = new Map();
    this.permissionManager = options.permissionManager || new PermissionManager();
    this.approvalCallback = options.approvalCallback || null;
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

  resetSingleCallTracking() {
    this._singleCallCache.clear();
  }

  hasSingleCallResult(name) {
    const entry = this._singleCallCache.get(name);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > SINGLE_CALL_CACHE_MS) {
      this._singleCallCache.delete(name);
      return false;
    }
    return true;
  }

  async execute(name, args = {}, context = {}) {
    const startedAt = Date.now();

    try {
      if (!isNonEmptyString(name)) {
        throw new ToolExecutionError('INVALID_TOOL_NAME', 'Tool name must be a non-empty string.');
      }

      if (SINGLE_CALL_TOOLS.has(name) && this.hasSingleCallResult(name)) {
        const cachedResult = this._singleCallCache.get(name).data;
        const serialized = serializeToolResult({
          toolName: name,
          ok: true,
          data: cachedResult,
          durationMs: 0,
        });
        serialized.repeatedSingleCall = true;
        return serialized;
      }

      assertPlainObject(args, 'Tool arguments');
      const tool = this.tools.get(name);

      if (!tool) {
        throw new ToolExecutionError('TOOL_NOT_FOUND', `Tool "${name}" is not registered.`);
      }

      const permissionResult = await this.permissionManager.checkPermission(
        name, args, this.approvalCallback,
      );

      if (!permissionResult.approved) {
        throw new ToolExecutionError(
          'PERMISSION_DENIED',
          `Operation denied: ${permissionResult.reason}`,
          { level: permissionResult.level, toolName: name },
        );
      }

      const data = await tool.execute(args, {
        ...context,
        root: this.root,
        registry: this,
      });

      if (SINGLE_CALL_TOOLS.has(name)) {
        this._singleCallCache.set(name, { data, timestamp: Date.now() });
      }

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
  const registry = new ToolRegistry({
    root: options.root,
    permissionManager: options.permissionManager,
  });
  const shellPolicy = normalizeShellPolicy(options.shellPolicy);

  registry
    .register(createReadFileTool())
    .register(createWriteFileTool())
    .register(createGlobTool())
    .register(createSearchTool())
    .register(createShellTool(shellPolicy))
    .register(createWebFetchTool())
    .register(createWebSearchTool())
    .register(createFileEditTool())
    .register(createReadDirectoryTool())
    .register(createDeleteFileTool());

  return registry;
}

module.exports = { ToolRegistry, createLocalToolRegistry };
