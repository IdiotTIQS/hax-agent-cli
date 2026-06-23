"use strict";

/**
 * Agent Engine — core agent loop with QueryContext, parallel tool execution,
 * reactive compaction, and comprehensive permissions.
 * Based on OpenHarness engine/query_engine.py + engine/query.py pattern.
 */

const { EventEmitter } = require("events");
const path = require("path");
const { ANSI, THEME, styled } = require("../shared/utils");
const {
  QueryContext, offloadToolOutput, isPromptTooLongError,
  boundedCompletionTokens, rememberToolContext,
} = require("./query");
const { PermissionChecker: CorePermissionChecker, PermissionMode, SENSITIVE_PATH_PATTERNS } = require("../core/permissions/checker");

// === CostTracker ===

const { getPricing, getCost } = require("../pricing");

class CostTracker {
  constructor() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheCreationTokens = 0;
    this.cacheReadTokens = 0;
    this.turnCount = 0;
    this.toolCallCount = 0;
    this.startTime = Date.now();
  }
  addUsage(usage) {
    if (!usage) return;
    this.inputTokens += num(usage, "input_tokens", "inputTokens", "prompt_tokens") || 0;
    this.outputTokens += num(usage, "output_tokens", "outputTokens", "completion_tokens") || 0;
    this.cacheCreationTokens += num(usage, "cache_creation_input_tokens", "cacheCreationInputTokens") || 0;
    this.cacheReadTokens += num(usage, "cache_read_input_tokens", "cacheReadInputTokens") || 0;
    this.turnCount += 1;
  }
  addToolCall() { this.toolCallCount += 1; }
  getCost(model) { return getCost(model, this.inputTokens, this.outputTokens, this.cacheCreationTokens, this.cacheReadTokens); }
  getPricing(model) { return getPricing(model); }
}

function num(obj, ...keys) {
  for (const k of keys) { if (Number.isFinite(obj[k])) return obj[k]; }
  return 0;
}

// === Session ===

class Session {
  constructor(o = {}) {
    this.id = o.id || `s_${Date.now().toString(36)}`;
    this.provider = o.provider;
    this.toolRegistry = o.toolRegistry;
    this.permissionManager = o.permissionManager || null;
    this.hookExecutor = o.hookExecutor || null;
    this.pluginRegistry = o.pluginRegistry || null;
    this.sandbox = o.sandbox || null;
    this.messages = [];
    this.isStreaming = false;
    this.responseInterrupted = false;
    this.responseAbortController = null;
    this.inputTokens = 0; this.outputTokens = 0; this.toolCallCount = 0; this.turnCount = 0;
    this.goal = o.goal || null;
    this._modifiedFiles = new Set();
    this.costTracker = new CostTracker();
  }
  getStatusLine() {
    const m = this.provider?.model || "?";
    const cost = this.costTracker.getCost(m);
    const t = this.inputTokens + this.outputTokens;
    const pm = this.permissionManager?.mode || "normal";
    return `${this.provider?.name || "?"} · ${m} · $${cost.toFixed(4)} · ${t}t · ${this.turnCount} turns · ${pm}`;
  }
}

// === Hook Executor ===

class HookEvent {
  static SESSION_START = "session.start";
  static SESSION_END = "session.end";
  static PRE_COMPACT = "pre.compact";
  static POST_COMPACT = "post.compact";
  static PRE_TOOL_USE = "pre.tool_use";
  static POST_TOOL_USE = "post.tool_use";
  static USER_PROMPT_SUBMIT = "user.prompt_submit";
  static NOTIFICATION = "notification";
  static STOP = "stop";
  static SUBAGENT_STOP = "subagent.stop";
}

class HookExecutor {
  constructor(o = {}) {
    this._hooks = new Map(); // event -> [{ handler, matcher, priority }]
    this._registry = o.pluginRegistry || null;
  }

  register(event, handler, opts = {}) {
    if (!this._hooks.has(event)) this._hooks.set(event, []);
    const entry = { event, handler, matcher: opts.matcher || null, priority: opts.priority || 0 };
    const list = this._hooks.get(event);
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
  }

  async run(eventName, payload = {}) {
    // Run plugin hooks first
    if (this._registry) {
      try { await this._registry.runHook?.(eventName, payload); } catch (_) {}
    }

    const hooks = this._hooks.get(eventName) || [];
    const results = [];
    for (const h of hooks) {
      // Matcher check: if matcher is a string fnmatch against toolName or pattern
      if (h.matcher) {
        const target = payload.toolName || payload.pattern || "";
        if (!this._match(target, h.matcher)) continue;
      }
      try {
        const r = await h.handler(payload);
        if (r) results.push(r);
        if (r?.blocked) return { blocked: true, reason: r.reason, results };
      } catch (_) {}
    }
    return { blocked: false, results };
  }

  _match(target, matcher) {
    if (typeof matcher === "string") {
      // fnmatch-style: convert glob to regex
      const re = new RegExp("^" + matcher.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
      return re.test(target);
    }
    if (matcher instanceof RegExp) return matcher.test(target);
    return false;
  }
}

/**
 * Backward-compatible PermissionChecker extending core module.
 * All permission logic is in src/core/permissions/checker.js.
 * This class exists for compatibility with existing code that expects
 * PermissionChecker from this module.
 */
class PermissionChecker extends CorePermissionChecker {}

// === Agent Engine ===

class AgentEngine extends EventEmitter {
  constructor(o = {}) {
    super();
    this.session = o.session;
    this._approvalCallback = o.approvalCallback || null;
    this.projectRoot = o.projectRoot || process.cwd();
    this.maxToolTurns = o.maxToolTurns ?? 200;
    this._skillRegistry = o.skillRegistry || null;
    this._skillSystemPrompt = o.skillSystemPrompt || "";
    this._pluginHooks = o.pluginHooks || [];
    this._queryContext = new QueryContext({
      cwd: this.projectRoot,
      model: this.session.provider?.model || "",
      maxTurns: this.maxToolTurns,
      permissionChecker: this.session.permissionManager,
      hookExecutor: this.session.hookExecutor,
    });
  }

  get queryContext() { return this._queryContext; }

  async *sendMessage(content, opts = {}) {
    const s = this.session;
    s.messages.push({ role: "user", content });
    s.isStreaming = true; s.responseInterrupted = false;
    s.responseAbortController = new AbortController(); s.turnCount++;

    // Run user_prompt_submit hooks
    if (s.hookExecutor) {
      await s.hookExecutor.run(HookEvent.USER_PROMPT_SUBMIT, { prompt: content, session: s });
    }

    // Track goal
    this._queryContext.setGoal(content);

    yield { type: "turn.started", sessionId: s.id };

    try {
      yield* this._runToolLoop(opts.system || this._buildSystemPrompt(), s.responseAbortController.signal);
    } catch (err) {
      if (s.responseInterrupted) yield { type: "turn.interrupted" };
      else yield { type: "turn.failed", error: { message: err.message } };
    } finally { s.isStreaming = false; s.responseAbortController = null; }

    // Goal continuation
    if (s.goal?.enabled && s.goal.text) {
      for (let i = 0; i < (s.goal.maxContinuations || 3); i++) {
        const gc = `[goal continuation]\nActive goal: ${s.goal.text}\nContinue working toward the goal. If complete, say GOAL_STATUS: complete.`;
        s.messages.push({ role: "user", content: gc, internal: true });
        s.responseAbortController = new AbortController();
        try { yield* this._runToolLoop(this._buildSystemPrompt(), s.responseAbortController.signal); }
        catch (_) { break; }
        finally { s.responseAbortController = null; }
        const last = s.messages[s.messages.length - 1];
        if (last?.role === "assistant" && (last.content || "").match(/GOAL_STATUS:\s*complete|blocked/i)) break;
      }
    }

    // Run session end hooks
    if (s.hookExecutor) {
      await s.hookExecutor.run(HookEvent.SESSION_END, { session: s, turnCount: s.turnCount });
    }
  }

  interrupt() { const s = this.session; s.responseInterrupted = true; s.responseAbortController?.abort(); }

  async *_runToolLoop(systemPrompt, signal) {
    const s = this.session;
    const registry = s.toolRegistry;
    const pm = s.permissionManager;
    const hooks = s.hookExecutor;
    const ctx = this._queryContext;
    let msgs = [...s.messages];
    let ptlRetries = 0;
    const MAX_PTL_RETRIES = 3;

    for (let turn = 0; turn < this.maxToolTurns; turn++) {
      if (signal.aborted) break;

      // 每轮注入动态上下文为 system-reminder(不污染稳定 system 前缀)
      const dynamicReminder = this._buildDynamicContextReminder();
      const msgsWithReminder = dynamicReminder
        ? [...msgs, { role: "user", content: dynamicReminder, internal: true }]
        : msgs;

      // === API Call with bounded tokens ===
      const maxTok = boundedCompletionTokens(ctx.maxTokens, ctx.contextWindowTokens);
      let text = ""; let toolUses = []; let usage = null;
      let reasoningText = ""; // Accumulate DeepSeek V4 reasoning_content

      try {
        for await (const chunk of s.provider.stream({
          messages: msgsWithReminder,
          system: this._buildStableSystemPrompt(),
          tools: registry?.toApiSchema() || [],
          signal, maxTokens: maxTok,
          thinking: s._thinking || false,
          thinkIntensity: s._thinkIntensity || null,
          enableCache: s.provider?.name === "anthropic",
        })) {
          if (chunk.type === "text") { text += chunk.delta; yield { type: "message.delta", delta: chunk.delta }; }
          else if (chunk.type === "thinking") {
            if (chunk.delta) reasoningText += chunk.delta;
            yield chunk;
          }
          else if (chunk.type === "tool_uses") { toolUses = chunk.toolUses || []; text = chunk.text || text; usage = chunk.usage; }
          else if (chunk.type === "usage") { usage = chunk; s.inputTokens += chunk.inputTokens || 0; s.outputTokens += chunk.outputTokens || 0; if (s.costTracker) s.costTracker.addUsage(chunk); yield chunk; }
          else if (chunk.type === "error") {
            // Reactive compaction: if prompt too long, compact and retry
            if (isPromptTooLongError(chunk) && ptlRetries < MAX_PTL_RETRIES) {
              ptlRetries++;
              yield { type: "status", message: `Prompt too long; compacting and retrying (${ptlRetries}/${MAX_PTL_RETRIES})...` };
              if (hooks) await hooks.run(HookEvent.PRE_COMPACT, { messages: msgs, session: s });
              msgs = this._compactMessages(msgs);
              if (hooks) await hooks.run(HookEvent.POST_COMPACT, { messages: msgs, session: s });
              turn--; // Don't count this turn
              break; // Retry the loop iteration
            }
            yield { type: "turn.failed", error: { message: chunk.message } }; return;
          }
        }
      } catch (err) {
        if (isPromptTooLongError(err) && ptlRetries < MAX_PTL_RETRIES) {
          ptlRetries++;
          yield { type: "status", message: `Prompt too long; compacting and retrying (${ptlRetries}/${MAX_PTL_RETRIES})...` };
          msgs = this._compactMessages(msgs);
          turn--;
          continue;
        }
        yield { type: "turn.failed", error: { message: err.message } }; return;
      }

      if (usage) yield { type: "usage", inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 };

      // No tools -> done
      if (!toolUses.length) {
        var aMsg = { role: "assistant", content: text };
        if (reasoningText) aMsg.reasoning_content = reasoningText;
        msgs.push(aMsg);
        s.messages.push({ ...aMsg });
        yield { type: "turn.completed", text, usage, context: ctx.buildContextSummary() };
        return;
      }

      // Track assistant message with reasoning_content for DeepSeek V4
      var aMsg = { role: "assistant", content: text };
      if (reasoningText) aMsg.reasoning_content = reasoningText;
      msgs.push(aMsg);

      // === Tool Execution (sequential for safety) ===
      const results = [];
      for (const tu of toolUses) {
        const name = tu.name, input = tu.input || {};

        // Pre-tool hook
        if (hooks) {
          const hookResult = await hooks.run(HookEvent.PRE_TOOL_USE, { toolName: name, args: input, session: s });
          if (hookResult?.blocked) {
            results.push({ type: "tool_result", content: JSON.stringify({ ok: false, error: { code: "HOOK_BLOCKED", message: hookResult.reason || "Blocked by hook" } }) });
            continue;
          }
        }

        // Permission check
        if (pm) {
          const tool = registry?.get ? registry.get(name) : null;
          const isReadOnly = tool?.isReadOnly ? tool.isReadOnly(input) : false;
          const pr = pm.evaluate(name, { isReadOnly, filePath: input.path || null, command: input.command || null });
          if (!pr.allowed) {
            // If requires confirmation and we have a callback, ask user
            if (pr.requiresConfirmation && this._approvalCallback) {
              const answer = await this._approvalCallback(name, input);
              if (answer !== "approve" && answer !== "always") {
                yield { type: "tool.result", name, isError: true, error: { code: "PERMISSION_DENIED", message: "User denied" } };
                results.push({ type: "tool_result", content: JSON.stringify({ ok: false, error: { code: "PERMISSION_DENIED", message: "User denied" } }) });
                continue;
              }
              if (answer === "always") pm.allowTool(name);
            } else {
              yield { type: "tool.result", name, isError: true, error: { code: "PERMISSION_DENIED", message: pr.reason } };
              results.push({ type: "tool_result", content: JSON.stringify({ ok: false, error: { code: "PERMISSION_DENIED", message: pr.reason } }) });
              continue;
            }
          }
        }

        yield { type: "tool.start", name, input };
        let execResult;
        try {
          execResult = await registry.execute(name, input, { root: this.projectRoot, session: s });
          s.toolCallCount++;
          if (s.costTracker) s.costTracker.addToolCall();
        } catch (err) {
          execResult = { ok: false, error: { code: "EXECUTION_ERROR", message: err.message } };
        }

        // Offload large outputs
        if (execResult.ok && execResult.data) {
          const output = typeof execResult.data.content === "string" ? execResult.data.content :
                         typeof execResult.data === "string" ? execResult.data :
                         JSON.stringify(execResult.data);
          const offloaded = offloadToolOutput(name, tu.id || name, output);
          if (offloaded.file) execResult.data._offloaded = offloaded;
        }

        yield { type: "tool.result", name, isError: !execResult.ok, data: execResult.data, error: execResult.error, durationMs: execResult.durationMs };

        // Track context
        rememberToolContext(ctx, name, input, execResult.data?.content || JSON.stringify(execResult.data || ""));

        // Post-tool hook
        if (hooks) await hooks.run(HookEvent.POST_TOOL_USE, { toolName: name, args: input, result: execResult, session: s });

        results.push({ type: "tool_result", content: JSON.stringify(execResult) });
      }

      msgs.push({ role: "user", content: results });
      s.messages.push(...msgs.slice(-2));
    }

    yield { type: "tool.limit", maxToolTurns: this.maxToolTurns };
  }

  /** Simple compaction — truncate old messages */
  _compactMessages(msgs) {
    if (msgs.length <= 4) return msgs;
    const keep = msgs.slice(-Math.floor(msgs.length * 0.6));
    const summary = `[Conversation compacted: ${msgs.length - keep.length} older messages summarized. Continue from here.]`;
    return [{ role: "user", content: summary }, ...keep];
  }

  _getSkillsPrompt() {
    if (this._skillRegistry?.size > 0) return this._skillRegistry.buildSystemPrompt();
    return this._skillSystemPrompt || "";
  }

  /** Return the stable system prompt prefix (used for prompt caching). */
  _buildStableSystemPrompt() {
    const skillsPrompt = this._getSkillsPrompt();
    return [
      "You are Hax Agent, a professional AI coding assistant with deep expertise in software development.",
      "Think like a senior engineer: deliberate, thorough, security-conscious.",
      "",
      "Core Principles:",
      "- Always read existing files before modifying them.",
      "- Make minimal, focused changes. Preserve existing code style.",
      "- Use tools carefully with valid, non-empty arguments.",
      "- If a tool fails, adapt instead of repeating the same failing input.",
      "- After making changes, verify correctness by reading back the file.",
      "",
      "Tool Usage:",
      "- file.read: Read files. Always read before editing.",
      "- file.write: Create/overwrite files.",
      "- file.edit: Find and replace text in files. Use replace_all:true for all occurrences.",
      "- file.glob: Find files by pattern.",
      "- file.search: Search file contents with regex.",
      "- file.readDirectory: List directory contents.",
      "- file.delete: Delete files (moves to trash by default).",
      "- shell.run: Execute shell commands with arguments array.",
      "- web.fetch: Fetch URL content.",
      "- web.search: Search the web.",
      "- agent: Spawn a sub-agent for ONE truly independent task. Do NOT spawn more than 2-3 agents per turn.",
      "- task.create/get/list/stop: Manage background tasks.",
      skillsPrompt || "",
    ].filter(Boolean).join("\n");
  }

  /** Return the per-turn dynamic context summary, injected as a separate user message. */
  _buildDynamicContextReminder() {
    const ctx = this._queryContext.buildContextSummary();
    if (!ctx) return null;
    return `<system-reminder>\nCurrent Context:\n${ctx}\n</system-reminder>`;
  }

  /** Compatibility: legacy callers can still fetch the full system prompt (not split). */
  _buildSystemPrompt() {
    const stable = this._buildStableSystemPrompt();
    const dynamic = this._buildDynamicContextReminder();
    return dynamic ? `${stable}\n\n${dynamic}` : stable;
  }
}

module.exports = {
  Session, AgentEngine, HookExecutor, PermissionChecker,
  HookEvent, PermissionMode, SENSITIVE_PATH_PATTERNS,
};
