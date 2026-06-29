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

// === Hook Result ===

class HookResult {
  constructor(o = {}) {
    this.blocked = !!o.blocked;
    this.reason = o.reason || "";
    this.output = o.output || null;
    this.error = o.error || null;
    this.durationMs = o.durationMs || 0;
  }
}

// === Hook Definition ===

class HookDefinition {
  constructor(o = {}) {
    this.event = o.event || "";
    this.type = o.type || HookType.COMMAND;
    this.matcher = o.matcher || null;  // fnmatch pattern for tool_name or prompt
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
  }
}

// === Hook Registry ===

class HookRegistry {
  constructor() {
    this._hooks = new Map(); // event -> HookDefinition[]
  }

  register(hook) {
    if (!(hook instanceof HookDefinition)) throw new Error("Expected HookDefinition");
    if (!this._hooks.has(hook.event)) this._hooks.set(hook.event, []);
    this._hooks.get(hook.event).push(hook);
    // Sort by priority descending
    this._hooks.get(hook.event).sort((a, b) => b.priority - a.priority);
  }

  getByEvent(event, toolName = null) {
    const hooks = this._hooks.get(event) || [];
    if (!toolName) return hooks;
    return hooks.filter(h => !h.matcher || this._fnmatch(toolName, h.matcher));
  }

  listAll() {
    const all = [];
    for (const [event, hooks] of this._hooks) {
      for (const h of hooks) all.push({ event, ...h });
    }
    return all;
  }

  _fnmatch(str, pattern) {
    const re = new RegExp("^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return re.test(str);
  }
}

// === Hook Executor ===

class HookExecutor {
  constructor(o = {}) {
    this._registry = o.registry || new HookRegistry();
    this._pluginRegistry = o.pluginRegistry || null;
    this._apiClient = o.apiClient || null;
    this._defaultModel = o.defaultModel || "claude-sonnet-4-6";
  }

  /** Update the registry (reload from plugins etc.) */
  updateRegistry(registry) { this._registry = registry; }

  /** Update execution context */
  updateContext(ctx = {}) {
    if (ctx.apiClient) this._apiClient = ctx.apiClient;
    if (ctx.defaultModel) this._defaultModel = ctx.defaultModel;
  }

  /** Run all hooks for an event */
  async run(event, payload = {}) {
    // Run plugin hooks first
    if (this._pluginRegistry) {
      try { await this._pluginRegistry.runHook?.(event, payload); } catch (_) {}
    }

    const toolName = payload.toolName || payload.name || "";
    const hooks = this._registry.getByEvent(event, toolName);
    const results = [];

    for (const hook of hooks) {
      const startedAt = Date.now();
      try {
        const result = await this._executeHook(hook, payload);
        result.durationMs = Date.now() - startedAt;
        results.push(result);
        if (result.blocked) return { blocked: true, reason: result.reason, results };
      } catch (err) {
        results.push(new HookResult({ error: err.message, durationMs: Date.now() - startedAt }));
      }
    }

    return { blocked: false, results };
  }

  async _executeHook(hook, payload) {
    switch (hook.type) {
      case HookType.COMMAND: return this._runCommandHook(hook, payload);
      case HookType.HTTP: return this._runHttpHook(hook, payload);
      case HookType.PROMPT: return this._runPromptHook(hook, payload);
      default: return new HookResult({ output: `Unknown hook type: ${hook.type}` });
    }
  }

  async _runCommandHook(hook, payload) {
    if (!hook.command) return new HookResult({ blocked: false });
    try {
      const env = { ...process.env, ...hook.env,
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
    } catch (err) {
      // If hook failure should block
      if (hook.blockOnFailure) {
        return new HookResult({ blocked: true, reason: `Hook command failed: ${err.message}` });
      }
      return new HookResult({ blocked: false, error: err.message });
    }
  }

  async _runHttpHook(hook, payload) {
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
    } catch (err) {
      return new HookResult({ blocked: false, error: err.message });
    }
  }

  async _runPromptHook(hook, payload) {
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
        if (chunk.type === "text") text += chunk.delta;
      }
      const blocked = text.toUpperCase().includes("BLOCK");
      return new HookResult({ blocked, reason: text.trim(), output: text });
    } catch (err) {
      return new HookResult({ blocked: false, error: err.message });
    }
  }
}

/** Build a standard hook registry with useful defaults */
function createDefaultHookRegistry(opts = {}) {
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

export {
  HookEvent, HookType, HookResult, HookDefinition,
  HookRegistry, HookExecutor, createDefaultHookRegistry,
};
