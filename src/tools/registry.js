const path = require('node:path');
const { PermissionManager } = require('../permissions');
const { ToolExecutionError } = require('./error');
const { assertPlainObject, isNonEmptyString, serializeToolResult } = require('./utils');
const { withTimeout, withMetrics, getMetrics } = require('../tool-decorators');
const { validate } = require('../schema-validator');

// Optional observability integration — gracefully degrades if the module is missing.
let _getObsMetrics = null;
try {
  const obs = require("../infrastructure/observability-setup");
  _getObsMetrics = obs.getMetrics;
} catch (_) {
  // observability-setup not available — metrics become no-ops.
}
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
const { createStockQuoteTool } = require('./stock-quote');

const SINGLE_CALL_TOOLS = new Set(['web.fetch', 'web.search', 'file.readDirectory']);
const SINGLE_CALL_CACHE_MS = 300_000;

class ToolRegistry {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.tools = new Map();
    this._singleCallCache = new Map();
    this.permissionManager = options.permissionManager || new PermissionManager();
    this.approvalCallback = options.approvalCallback || null;
    this.undoStack = options.undoStack || null;
    this.pluginRegistry = options.pluginRegistry || null;
    this._enableMetrics = options.enableMetrics !== false;
    this._defaultTimeoutMs = Number.isSafeInteger(options.defaultTimeoutMs) && options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : 30_000;
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

    const key = tool.name.toLowerCase();
    if (this.tools.has(key)) {
      throw new ToolExecutionError('DUPLICATE_TOOL', `Tool "${tool.name}" is already registered.`);
    }

    let executeFn = tool.execute;

    if (this._enableMetrics) {
      executeFn = withMetrics(executeFn, tool.name);
    }

    const timeoutMs = (tool.inputSchema && Number.isSafeInteger(tool.inputSchema.timeoutMs) && tool.inputSchema.timeoutMs > 0)
      ? tool.inputSchema.timeoutMs
      : this._defaultTimeoutMs;
    executeFn = withTimeout(executeFn, timeoutMs);

    this.tools.set(key, {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || null,
      execute: executeFn,
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

      if (SINGLE_CALL_TOOLS.has(name.toLowerCase()) && this.hasSingleCallResult(name)) {
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
      const tool = this.tools.get(name.toLowerCase());

      if (!tool) {
        throw new ToolExecutionError('TOOL_NOT_FOUND', `Tool "${name}" is not registered.`);
      }

      // Validate args against the tool's inputSchema if present
      if (tool.inputSchema) {
        try {
          validate(tool.inputSchema, args);
        } catch (err) {
          throw new ToolExecutionError(
            'INVALID_ARGUMENT',
            `Validation failed for tool "${name}": ${err.message}`,
          );
        }
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

      // Fire beforeToolCall plugin hooks
      if (this.pluginRegistry) {
        await this.pluginRegistry.runHook('beforeToolCall', { toolName: name, args, session: context.session });
      }

      const data = await tool.execute(args, {
        ...context,
        root: this.root,
        registry: this,
        undoStack: this.undoStack,
      });

      if (SINGLE_CALL_TOOLS.has(name)) {
        this._singleCallCache.set(name, { data, timestamp: Date.now() });
      }

      // Fire afterToolCall plugin hooks
      if (this.pluginRegistry) {
        await this.pluginRegistry.runHook('afterToolCall', { toolName: name, args, result: data, session: context.session });
      }

      const durationMs = Date.now() - startedAt;

      // Record observability metrics (optional).
      try {
        const obsMetrics = _getObsMetrics ? _getObsMetrics() : null;
        if (obsMetrics) {
          obsMetrics.get("tool.executions")?.inc();
          obsMetrics.get("tool.duration_ms")?.observe(durationMs);
        }
      } catch (_) { /* no-op */ }

      return serializeToolResult({
        toolName: name,
        ok: true,
        data,
        durationMs,
      });
    } catch (error) {
      if (this.pluginRegistry) {
        this.pluginRegistry.runHook('onError', { error, toolName: name, session: context.session }).catch(() => {});
      }

      const durationMs = Date.now() - startedAt;

      // Record observability error + duration metrics (optional).
      try {
        const obsMetrics = _getObsMetrics ? _getObsMetrics() : null;
        if (obsMetrics) {
          obsMetrics.get("tool.executions")?.inc();
          obsMetrics.get("tool.errors")?.inc();
          obsMetrics.get("tool.duration_ms")?.observe(durationMs);
        }
      } catch (_) { /* no-op */ }

      return serializeToolResult({
        toolName: name,
        ok: false,
        error,
        durationMs,
      });
    }
  }

  /**
   * Return per-tool metrics collected by withMetrics decorators.
   * @returns {Record<string, { count: number, totalDurationMs: number, errorCount: number, avgDurationMs: number | null }>}
   */
  getStats() {
    if (!this._enableMetrics) {
      return {};
    }
    const stats = {};
    for (const toolName of this.tools.keys()) {
      stats[toolName] = getMetrics(toolName);
    }
    return stats;
  }
}

function createLocalToolRegistry(options = {}) {
  const registry = new ToolRegistry({
    root: options.root,
    permissionManager: options.permissionManager,
    undoStack: options.undoStack,
    pluginRegistry: options.pluginRegistry,
    enableMetrics: options.enableMetrics,
    defaultTimeoutMs: options.defaultTimeoutMs,
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
    .register(createDeleteFileTool())
    .register(createStockQuoteTool());

  return registry;
}

module.exports = { ToolRegistry, createLocalToolRegistry };
