/**
 * Shared mock factories for HaxAgent tests.
 *
 * Each factory returns a realistic mock that can be used across test files
 * without repeating setup boilerplate. All mocks are plain objects or
 * lightweight classes — they do not depend on the real implementation.
 */

import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// createMockProvider
// ---------------------------------------------------------------------------

/**
 * Create a mock ChatProvider with configurable behaviour.
 *
 * @param {object} [options]
 * @param {string} [options.name="mock"] - provider name
 * @param {string} [options.model="mock-local"] - model identifier
 * @param {string} [options.apiKey] - api key (set to trigger validation)
 * @param {string} [options.apiUrl] - api url
 * @param {number} [options.delayMs=0] - artificial delay per streamed chunk (ms)
 * @param {string|Function} [options.response] - static response string or
 *        function(messages) that returns a string
 * @param {boolean} [options.toolTrace=false] - whether stream() emits trace events
 * @param {boolean} [options.shouldFail=false] - if true, chat() rejects
 * @param {Error} [options.error] - specific error to throw when shouldFail is true
 * @param {Function} [options.interceptChat] - spy called with request before resolving
 * @returns {object} mock provider instance
 */
function createMockProvider(options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
  const name = options.name || "mock";
  const model = options.model || "mock-local";

  const provider = {
    name,
    model,
    apiKey: options.apiKey || undefined,
    apiUrl: options.apiUrl || undefined,
    delayMs,
    response: options.response || null,
    toolTrace: options.toolTrace === true,
    chatCallCount: 0,
    chatCalls: [],
    streamCallCount: 0,
    _options: options,

    async chat(request) {
      provider.chatCallCount += 1;
      provider.chatCalls.push(request);

      if (options.interceptChat) {
        options.interceptChat(request);
      }

      if (delayMs > 0) {
        await delay(delayMs);
      }

      if (options.shouldFail) {
        throw options.error || new Error(`mock provider ${name} error`);
      }

      const messages = extractMessages(request);
      const content = resolveResponse(options.response, messages);

      return {
        id: `mock-${Date.now()}-${provider.chatCallCount}`,
        provider: name,
        model: request.model || model,
        role: "assistant",
        content,
        usage: {
          inputTokens: estimateTokens(messages.map((m) => m.content).join("\n")),
          outputTokens: estimateTokens(content),
        },
        raw: null,
      };
    },

    async *stream(request) {
      provider.streamCallCount += 1;
      const response = await provider.chat(request);
      const text = String(response.content || "");
      const chunks = text.length > 0 ? text.split(/(\s+)/).filter(Boolean) : [""];

      if (provider.toolTrace) {
        yield {
          type: "thinking",
          summary: "Thinking...",
        };
        yield {
          type: "tool_start",
          name: "file.read",
          input: { path: "README.md" },
          attempt: 1,
          turn: 1,
        };
        yield {
          type: "tool_result",
          name: "file.read",
          isError: false,
          durationMs: 3,
          input: { path: "README.md" },
          data: { path: "README.md", bytes: 1234, content: "mock content" },
          attempt: 1,
          turn: 1,
        };
      }

      for (const chunk of chunks) {
        if (delayMs > 0) {
          await delay(delayMs);
        }
        yield { type: "text", delta: chunk };
      }

      yield {
        type: "usage",
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      };
    },

    async listModels() {
      return [{ id: model, name: model }];
    },

    setModel(newModel) {
      const normalized = String(newModel || "").trim();
      if (!normalized) throw new Error("Model is required");
      provider.model = normalized;
      return normalized;
    },

    setApiUrl(apiUrl) {
      provider.apiUrl = apiUrl ? String(apiUrl).trim() : undefined;
      return provider.apiUrl;
    },

    setApiKey(apiKey) {
      const normalized = String(apiKey || "").trim();
      if (!normalized) throw new Error("API key is required");
      provider.apiKey = normalized;
      return normalized;
    },
  };

  return provider;
}

// ---------------------------------------------------------------------------
// createMockSession
// ---------------------------------------------------------------------------

/**
 * Create a mock Session with preset messages, cost tracker, and settings.
 *
 * @param {object} [options]
 * @param {string} [options.id] - session id (auto-generated if omitted)
 * @param {string} [options.cwd] - working directory
 * @param {Date|string} [options.createdAt] - creation date
 * @param {object} [options.metadata] - arbitrary metadata
 * @param {Array<{role:string, content:string}>} [options.messages] - preset messages
 * @param {object} [options.settings] - merged settings
 * @param {string} [options.goalText] - active goal text
 * @param {boolean} [options.goalCompleted] - whether goal is complete
 * @param {boolean} [options.responseInterrupted] - whether response was interrupted
 * @returns {object} mock session
 */
function createMockSession(options = {}) {
  const now = new Date();
  const id = options.id || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const session = {
    id,
    cwd: options.cwd || process.cwd(),
    createdAt: toIso(options.createdAt || now),
    updatedAt: toIso(options.updatedAt || now),
    metadata: { ...(options.metadata || {}) },
    messages: [...(options.messages || [])],
    settings: createMockSettings(options.settings),
    costTracker: createMockCostTracker(options.costTracker || {}),

    // goal support
    goal: {
      text: options.goalText || null,
      completed: options.goalCompleted === true,
      continuations: 0,
    },

    // interruption support
    responseInterrupted: options.responseInterrupted === true,
    responseAbortController: null,

    addMessage(message) {
      if (!message || typeof message.role !== "string" || typeof message.content !== "string") {
        throw new TypeError("session message requires role and content");
      }
      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
      return message;
    },

    getTranscript() {
      return session.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    },

    snapshot() {
      return Object.freeze({
        id: session.id,
        cwd: session.cwd,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        metadata: Object.freeze({ ...session.metadata }),
        messages: Object.freeze([...session.messages]),
      });
    },

    touch(value = new Date()) {
      session.updatedAt = toIso(value);
    },

    setGoal(text) {
      session.goal.text = text;
      session.goal.completed = false;
      session.goal.continuations = 0;
    },

    completeGoal() {
      session.goal.completed = true;
    },
  };

  return session;
}

// ---------------------------------------------------------------------------
// createMockCostTracker
// ---------------------------------------------------------------------------

function createMockCostTracker(options = {}) {
  return {
    inputTokens: options.inputTokens || 0,
    outputTokens: options.outputTokens || 0,
    cacheCreationTokens: options.cacheCreationTokens || 0,
    cacheReadTokens: options.cacheReadTokens || 0,
    turnCount: options.turnCount || 0,
    toolCallCount: options.toolCallCount || 0,
    startTime: options.startTime || Date.now(),
    pricing: {
      "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
      "gpt-4o": { input: 2.5, output: 10.0 },
    },

    addUsage(usage, model) {
      if (!usage) return;
      this.inputTokens += usage.inputTokens || 0;
      this.outputTokens += usage.outputTokens || 0;
      this.cacheCreationTokens += usage.cacheCreationTokens || 0;
      this.cacheReadTokens += usage.cacheReadTokens || 0;
      this.turnCount += 1;
      if (model) this._lastModel = model;
    },

    addToolCall() {
      this.toolCallCount += 1;
    },

    totalCost() {
      const pricing = this.pricing[this._lastModel || "claude-sonnet-4-20250514"] || this.pricing["claude-sonnet-4-20250514"];
      return (
        ((this.inputTokens / 1_000_000) * (pricing.input || 3.0)) +
        ((this.outputTokens / 1_000_000) * (pricing.output || 15.0)) +
        ((this.cacheCreationTokens / 1_000_000) * (pricing.cacheWrite || 3.75)) +
        ((this.cacheReadTokens / 1_000_000) * (pricing.cacheRead || 0.3))
      );
    },

    reset() {
      this.inputTokens = 0;
      this.outputTokens = 0;
      this.cacheCreationTokens = 0;
      this.cacheReadTokens = 0;
      this.turnCount = 0;
      this.toolCallCount = 0;
      this.startTime = Date.now();
    },

    snapshot() {
      return {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        cacheCreationTokens: this.cacheCreationTokens,
        cacheReadTokens: this.cacheReadTokens,
        turnCount: this.turnCount,
        toolCallCount: this.toolCallCount,
        startTime: this.startTime,
        totalCost: this.totalCost(),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// createMockTool
// ---------------------------------------------------------------------------

/**
 * Create a mock tool with configurable execute behavior.
 *
 * @param {object} [options]
 * @param {string} [options.name="mock.tool"] - tool name (must be non-empty)
 * @param {string} [options.description="Mock tool for testing"] - tool description
 * @param {object} [options.inputSchema] - JSON Schema for inputs
 * @param {Function} [options.execute] - custom execute function
 * @param {any} [options.result] - value to return from execute (ignored if execute is provided)
 * @param {boolean} [options.shouldFail=false] - if true, execute rejects
 * @param {Error} [options.error] - specific error to throw
 * @param {number} [options.delayMs=0] - artificial delay before execute resolves
 * @param {number} [options.durationMs=1] - reported duration in result
 * @param {boolean} [options.isLongRunning=false] - tool returns a promise that must be polled
 * @returns {object} mock tool
 */
function createMockTool(options = {}) {
  const name = options.name || "mock.tool";
  const description = options.description || "Mock tool for testing";
  const inputSchema = options.inputSchema || null;
  const shouldFail = options.shouldFail === true;
  const error = options.error || new Error(`tool ${name} error`);
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
  const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : 1;

  const tool = {
    name,
    description,
    inputSchema,
    executeCallCount: 0,
    executeCalls: [],

    async execute(args, context) {
      tool.executeCallCount += 1;
      tool.executeCalls.push({ args, context });

      if (delayMs > 0) {
        await delay(delayMs);
      }

      if (shouldFail) {
        throw error;
      }

      if (typeof options.execute === "function") {
        const result = await options.execute(args, context);
        return formatToolResult(name, true, result, durationMs);
      }

      const value = "result" in options ? options.result : { ok: true, mock: true };
      return formatToolResult(name, true, value, durationMs);
    },
  };

  return tool;
}

// ---------------------------------------------------------------------------
// createMockToolRegistry
// ---------------------------------------------------------------------------

/**
 * Create a mock ToolRegistry pre-populated with tools.
 *
 * @param {Array<object>} [tools] - array of tool objects (from createMockTool or raw)
 * @param {object} [options]
 * @param {string} [options.root] - workspace root
 * @param {object} [options.permissionManager] - mock permission manager
 * @param {Function} [options.approvalCallback] - approval callback
 * @param {object} [options.undoStack] - undo stack instance
 * @param {object} [options.pluginRegistry] - plugin registry instance
 * @returns {object} mock tool registry
 */
function createMockToolRegistry(tools = [], options = {}) {
  const toolMap = new Map();

  for (const tool of tools) {
    if (tool && typeof tool.name === "string" && typeof tool.execute === "function") {
      toolMap.set(tool.name, {
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || null,
        execute: tool.execute,
      });
    }
  }

  return {
    root: path.resolve(options.root || process.cwd()),
    tools: toolMap,
    _singleCallCache: new Map(),
    permissionManager: options.permissionManager || null,
    approvalCallback: options.approvalCallback || null,
    undoStack: options.undoStack || null,
    pluginRegistry: options.pluginRegistry || null,

    register(tool) {
      if (!tool || typeof tool !== "object") {
        throw new Error("Tool must be an object.");
      }
      if (typeof tool.name !== "string" || !tool.name.trim()) {
        throw new Error("Tool name must be a non-empty string.");
      }
      if (typeof tool.execute !== "function") {
        throw new Error(`Tool "${tool.name}" must provide an execute function.`);
      }
      if (toolMap.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
      }
      toolMap.set(tool.name, {
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || null,
        execute: tool.execute,
      });
      return this;
    },

    has(name) {
      return toolMap.has(name);
    },

    get(name) {
      return toolMap.get(name) || null;
    },

    list() {
      return Array.from(toolMap.values(), (t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },

    async execute(name, args, context) {
      const tool = toolMap.get(name);
      if (!tool) {
        throw new Error(`Tool "${name}" is not registered.`);
      }
      return tool.execute(args, context);
    },

    resetSingleCallTracking() {
      this._singleCallCache.clear();
    },

    hasSingleCallResult(name) {
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// createMockScreen
// ---------------------------------------------------------------------------

/**
 * Create a mock TerminalScreen that captures all output for test assertions.
 *
 * @param {object} [options]
 * @param {number} [options.columns=80] - terminal width
 * @param {number} [options.rows=24] - terminal height
 * @returns {object} mock screen with captured output buffer
 */
function createMockScreen(options = {}) {
  const columns = options.columns || 80;
  const rows = options.rows || 24;
  const buffer = [];

  return {
    columns,
    rows,
    buffer,
    cursorRow: 0,
    cursorCol: 0,

    write(text) {
      buffer.push({ type: "write", text: String(text), timestamp: Date.now() });
    },

    writeln(text) {
      buffer.push({ type: "writeln", text: String(text || ""), timestamp: Date.now() });
    },

    clear() {
      buffer.push({ type: "clear", timestamp: Date.now() });
    },

    clearLine() {
      buffer.push({ type: "clearLine", timestamp: Date.now() });
    },

    moveCursor(row, col) {
      this.cursorRow = row;
      this.cursorCol = col;
      buffer.push({ type: "moveCursor", row, col, timestamp: Date.now() });
    },

    getCursorPosition() {
      return { row: this.cursorRow, col: this.cursorCol };
    },

    /**
     * Get all output as a single string (write/writeln joined).
     * @returns {string}
     */
    getOutput() {
      return buffer
        .filter((e) => e.type === "write" || e.type === "writeln")
        .map((e) => e.type === "writeln" ? e.text + "\n" : e.text)
        .join("");
    },

    /**
     * Get raw buffer entries for detailed inspection.
     * @returns {Array<object>}
     */
    getEntries() {
      return [...buffer];
    },

    /**
     * Get only lines (writeln calls) as an array of strings.
     * @returns {Array<string>}
     */
    getLines() {
      return buffer
        .filter((e) => e.type === "writeln")
        .map((e) => e.text);
    },

    /**
     * Check if output contains a substring.
     * @param {string} substr
     * @returns {boolean}
     */
    outputContains(substr) {
      return this.getOutput().includes(substr);
    },

    /**
     * Reset the buffer.
     */
    reset() {
      buffer.length = 0;
      this.cursorRow = 0;
      this.cursorCol = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// createMockSettings
// ---------------------------------------------------------------------------

/**
 * Create realistic settings with sensible defaults, merged with overrides.
 *
 * Mirrors the shape of DEFAULT_SETTINGS from src/config.js so mocks feel
 * authentic and work with settings-consuming code.
 *
 * @param {object} [overrides] - partial settings to merge on top
 * @returns {object} merged settings object
 */
function createMockSettings(overrides = {}) {
  const defaults = {
    agent: {
      name: "hax-agent",
      model: "claude-sonnet-4-20250514",
      apiKey: undefined,
      apiUrl: undefined,
      maxTurns: 20,
      temperature: 0.2,
    },
    memory: {
      enabled: true,
      directory: undefined,
      maxItems: 20,
    },
    sessions: {
      directory: undefined,
      transcriptLimit: 100,
    },
    prompts: {
      includeSettings: true,
      includeMemory: true,
      includeTranscript: true,
      maxTranscriptMessages: undefined,
    },
    context: {
      enabled: true,
      windowTokens: undefined,
      reserveOutputTokens: 8192,
      charsPerToken: 4,
    },
    instructions: {
      custom: undefined,
    },
    fileContext: {
      enabled: true,
      maxFiles: 8,
      maxIndexFiles: 2000,
      maxFileSize: 512000,
      maxBytesPerFile: 32000,
      maxTotalBytes: 120000,
    },
    permissions: {
      mode: "normal",
    },
    updates: {
      autoInstall: false,
    },
    desktop: {
      workspace: undefined,
    },
    ui: {
      locale: "en",
    },
    tools: {
      shell: {
        enabled: true,
        timeoutMs: 10000,
        maxBuffer: 52428800,
      },
    },
  };

  return deepMerge(defaults, overrides);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function estimateTokens(text) {
  const s = String(text || "").trim();
  return s.length === 0 ? 0 : Math.ceil(s.length / 4);
}

function extractMessages(request) {
  if (Array.isArray(request.messages)) return request.messages;
  if (typeof request.prompt === "string") return [{ role: "user", content: request.prompt }];
  return [];
}

function resolveResponse(response, messages) {
  if (typeof response === "function") {
    return String(response(messages));
  }
  if (typeof response === "string") {
    return response;
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    return `Mock response to: ${lastUser.content}`;
  }
  return "Mock response (no input).";
}

function formatToolResult(name, ok, data, durationMs) {
  return {
    toolName: name,
    ok,
    data,
    durationMs: durationMs || 0,
    timestamp: new Date().toISOString(),
  };
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key]) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  createMockProvider,
  createMockSession,
  createMockTool,
  createMockToolRegistry,
  createMockScreen,
  createMockSettings,
  // lower-level exports for advanced tests
  createMockCostTracker,
};
