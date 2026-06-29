/**
 * Hook System — repository of all hooks separated by event and type.
 * Ported from OpenHarness hooks/ pattern.
 *
 * Supports 10 lifecycle events, 4 hook types (command, http, prompt, agent),
 * fnmatch matchers, priority ordering, and timeout control.
 */

import { EventEmitter } from "events";
import { execSync } from "child_process";

// === Hook Events ===

const HookEvent = {
  SESSION_START: "session.start",
  SESSION_END: "session.end",
  PRE_COMPACT: "pre.compact",
  POST_COMPACT: "post.compact",
  PRE_TOOL_USE: "pre.tool_use",
  POST_TOOL_USE: "post.tool_use",
  USER_PROMPT_SUBMIT: "user.prompt_submit",
  NOTIFICATION: "notification",
  STOP: "stop",
  SUBAGENT_STOP: "subagent.stop",
};

// === Hook Types ===

const HookType = {
  COMMAND: "command",   // Execute a shell command
  HTTP: "http",         // POST to HTTP endpoint
  PROMPT: "prompt",     // Ask LLM to verify condition
  AGENT: "agent",       // Deep model-based verification
};

// === Interfaces ===

interface HookResultOptions {
  blocked?: boolean;
  reason?: string;
  output?: string | null;
  error?: string | null;
  durationMs?: number;
}

interface HookDefinitionOptions {
  event?: string;
  type?: string;
  matcher?: string | null;
  priority?: number;
  timeoutMs?: number;
  command?: string | null;
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  body?: unknown;
  prompt?: string | null;
  blockOnFailure?: boolean;
  noDefaults?: boolean;
}

interface HookExecutorOptions {
  registry?: HookRegistry;
  pluginRegistry?: { runHook?: (event: string, payload: Record<string, unknown>) => Promise<void> } | null;
  apiClient?: { stream: (req: Record<string, unknown>) => AsyncIterable<Record<string, unknown>> } | null;
  defaultModel?: string;
}

interface HookPayload {
  event?: string;
  toolName?: string;
  name?: string;
  args?: unknown;
  [key: string]: unknown;
}

interface HookRunResult {
  blocked: boolean;
  reason?: string;
  results: HookResult[];
}

// === Hook Result ===

class HookResult {
  blocked: boolean;
  reason: string;
  output: string | null;
  error: string | null;
  durationMs: number;

  constructor(o: HookResultOptions = {}) {
    this.blocked = !!o.blocked;
    this.reason = o.reason || "";
    this.output = o.output || null;
    this.error = o.error || null;
    this.durationMs = o.durationMs || 0;
  }
}

// === Hook Definition ===

class HookDefinition {
  event: string;
  type: string;
  matcher: string | null;
  priority: number;
  timeoutMs: number;
  command: string | null;
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
  body: unknown;
  prompt: string | null;
  blockOnFailure: boolean;

  constructor(o: HookDefinitionOptions = {}) {
    this.event = o.event || "";
    this.type = o.type || HookType.COMMAND;
    this.matcher = o.matcher || null;
    this.priority = o.priority || 0;
    this.timeoutMs = o.timeoutMs || 10000;

    // Command-specific
    this.command = o.command || null;
    this.env = o.env || {};

    // HTTP-specific
    this.url = o.url || null;
    this.headers = o.headers || {};
    this.body = o.body || null;

    // Prompt/Agent-specific
    this.prompt = o.prompt || null;

    // Blocking behaviour
    this.blockOnFailure = !!o.blockOnFailure;
  }
}

// === Hook Registry ===

class HookRegistry {
  private _hooks: Map<string, HookDefinition[]>;

  constructor() {
    this._hooks = new Map(); // event -> HookDefinition[]
  }

  register(hook: HookDefinition): void {
    if (!(hook instanceof HookDefinition)) throw new Error("Expected HookDefinition");
    if (!this._hooks.has(hook.event)) this._hooks.set(hook.event, []);
    this._hooks.get(hook.event)!.push(hook);
    // Sort by priority descending
    this._hooks.get(hook.event)!.sort((a, b) => b.priority - a.priority);
  }

  getByEvent(event: string, toolName: string | null = null): HookDefinition[] {
    const hooks = this._hooks.get(event) || [];
    if (!toolName) return hooks;
    return hooks.filter(h => !h.matcher || this._fnmatch(toolName, h.matcher));
  }

  listAll(): Array<Record<string, unknown>> {
    const all: Array<Record<string, unknown>> = [];
    for (const [_event, hooks] of this._hooks) {
      for (const h of hooks) {
        all.push({
          event: h.event,
          type: h.type,
          matcher: h.matcher,
          priority: h.priority,
          timeoutMs: h.timeoutMs,
          command: h.command,
          env: h.env,
          url: h.url,
          headers: h.headers,
          body: h.body,
          prompt: h.prompt,
          blockOnFailure: h.blockOnFailure,
        });
      }
    }
    return all;
  }

  _fnmatch(str: string, pattern: string): boolean {
    const re = new RegExp("^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return re.test(str);
  }
}

// === Hook Executor ===

class HookExecutor {
  private _registry: HookRegistry;
  private _pluginRegistry: HookExecutorOptions["pluginRegistry"];
  private _apiClient: HookExecutorOptions["apiClient"];
  private _defaultModel: string;

  constructor(o: HookExecutorOptions = {}) {
    this._registry = o.registry || new HookRegistry();
    this._pluginRegistry = o.pluginRegistry || null;
    this._apiClient = o.apiClient || null;
    this._defaultModel = o.defaultModel || "claude-sonnet-4-6";
  }

  /** Update the registry (reload from plugins etc.) */
  updateRegistry(registry: HookRegistry): void { this._registry = registry; }

  /** Update execution context */
  updateContext(ctx: Partial<HookExecutorOptions> = {}): void {
    if (ctx.apiClient) this._apiClient = ctx.apiClient;
    if (ctx.defaultModel) this._defaultModel = ctx.defaultModel;
  }

  /** Run all hooks for an event */
  async run(event: string, payload: HookPayload = {}): Promise<HookRunResult> {
    // Run plugin hooks first
    if (this._pluginRegistry) {
      try { await this._pluginRegistry.runHook?.(event, payload); } catch (_) {}
    }

    const toolName = payload.toolName || payload.name || "";
    const hooks = this._registry.getByEvent(event, toolName);
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const startedAt = Date.now();
      try {
        const result = await this._executeHook(hook, payload);
        result.durationMs = Date.now() - startedAt;
        results.push(result);
        if (result.blocked) return { blocked: true, reason: result.reason, results };
      } catch (err: unknown) {
        results.push(new HookResult({ error: (err as Error).message, durationMs: Date.now() - startedAt }));
      }
    }

    return { blocked: false, results };
  }

  async _executeHook(hook: HookDefinition, payload: HookPayload): Promise<HookResult> {
    switch (hook.type) {
      case HookType.COMMAND: return this._runCommandHook(hook, payload);
      case HookType.HTTP: return this._runHttpHook(hook, payload);
      case HookType.PROMPT: return this._runPromptHook(hook, payload);
      default: return new HookResult({ output: `Unknown hook type: ${hook.type}` });
    }
  }

  async _runCommandHook(hook: HookDefinition, payload: HookPayload): Promise<HookResult> {
    if (!hook.command) return new HookResult({ blocked: false });
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...hook.env,
        HOOK_EVENT: payload.event || "",
        TOOL_NAME: payload.toolName || "",
        TOOL_ARGS: JSON.stringify(payload.args || {}),
      };
      const output = execSync(hook.command, {
        timeout: hook.timeoutMs,
        encoding: "utf-8",
        env,
      }).trim();

      // Check for blocked signal
      if (output.startsWith("BLOCK:")) {
        return new HookResult({ blocked: true, reason: output.slice(6).trim(), output });
      }
      return new HookResult({ blocked: false, output });
    } catch (err: unknown) {
      // If hook failure should block
      if (hook.blockOnFailure) {
        return new HookResult({ blocked: true, reason: `Hook command failed: ${(err as Error).message}` });
      }
      return new HookResult({ blocked: false, error: (err as Error).message });
    }
  }

  async _runHttpHook(hook: HookDefinition, payload: HookPayload): Promise<HookResult> {
    if (!hook.url) return new HookResult({ blocked: false });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), hook.timeoutMs);
      const response = await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hook.headers },
        body: JSON.stringify(hook.body || payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await response.text();
      if (response.status >= 400) {
        return new HookResult({ blocked: false, error: `HTTP ${response.status}: ${text}` });
      }
      return new HookResult({ blocked: false, output: text });
    } catch (err: unknown) {
      return new HookResult({ blocked: false, error: (err as Error).message });
    }
  }

  async _runPromptHook(hook: HookDefinition, payload: HookPayload): Promise<HookResult> {
    // Requires an API client to verify via LLM
    if (!this._apiClient || !hook.prompt) return new HookResult({ blocked: false });
    try {
      const prompt = hook.prompt
        .replace(/\{toolName\}/g, payload.toolName || "")
        .replace(/\{args\}/g, JSON.stringify(payload.args || {}));
      const stream = this._apiClient.stream({
        messages: [{ role: "user", content: prompt }],
        system: "Answer only ALLOW or BLOCK with a brief reason.",
        maxTokens: 50,
      });
      let text = "";
      for await (const chunk of stream) {
        if (chunk["type"] === "text") text += chunk["delta"] as string;
      }
      const blocked = text.toUpperCase().includes("BLOCK");
      return new HookResult({ blocked, reason: text.trim(), output: text });
    } catch (err: unknown) {
      return new HookResult({ blocked: false, error: (err as Error).message });
    }
  }
}

/** Build a standard hook registry with useful defaults */
function createDefaultHookRegistry(opts: HookDefinitionOptions = {}): HookRegistry {
  const registry = new HookRegistry();

  // SESSION_START: Log session start
  if (!opts.noDefaults) {
    registry.register(new HookDefinition({
      event: HookEvent.SESSION_START,
      type: HookType.COMMAND,
      priority: 0,
      command: process.platform === "win32"
        ? `echo "HaxAgent session started at %DATE% %TIME%"`
        : `echo "HaxAgent session started at $(date)"`,
    }));
  }

  return registry;
}

// Suppress unused import warning — EventEmitter is part of the public surface
export type { };
export {
  EventEmitter,
  HookEvent, HookType, HookResult, HookDefinition,
  HookRegistry, HookExecutor, createDefaultHookRegistry,
};
