/**
 * Agent Engine — core agent loop with QueryContext, parallel tool execution,
 * reactive compaction, and comprehensive permissions.
 * Based on OpenHarness engine/query_engine.py + engine/query.py pattern.
 */

import { EventEmitter } from "events";
import path from "path";
import { ANSI, THEME, styled } from "../shared/utils.js";
import {
  QueryContext, offloadToolOutput, isPromptTooLongError,
  boundedCompletionTokens, rememberToolContext,
} from "./query.js";
import { PermissionChecker as CorePermissionChecker, PermissionMode, SENSITIVE_PATH_PATTERNS } from "../core/permissions/checker.js";
import type { ToolRegistry } from "../tools/registry.js";

// Suppress unused import warnings — these are re-exported below
void ANSI; void THEME; void styled;

// === Session ===

interface SessionOptions {
  id?: string;
  provider?: SessionProvider | null;
  toolRegistry?: ToolRegistry | null;
  permissionManager?: CorePermissionChecker | null;
  hookExecutor?: HookExecutor | null;
  pluginRegistry?: PluginRegistry | null;
  sandbox?: Sandbox | null;
  goal?: SessionGoal | null;
  mcpManager?: McpManagerHandle | null;
}

/** Minimal interface for McpClientManager — avoids a hard import cycle. */
interface McpManagerHandle {
  getStatus(name?: string | null): unknown;
  loadConfig(filePath?: string | null): void;
  startAll(): Promise<unknown>;
  stopAll(): void;
  discoverTools(name?: string | null): Promise<Array<{ name: string; _mcpServer: string }>>;
}

interface SessionProvider {
  model?: string;
  name?: string;
  stream(opts: unknown): AsyncIterable<StreamChunk>;
  apiKey?: string;
  apiUrl?: string;
}

interface StreamChunk {
  type: string;
  delta?: string;
  text?: string;
  toolUses?: ToolUse[];
  usage?: UsageInfo;
  inputTokens?: number;
  outputTokens?: number;
  message?: string;
  [key: string]: unknown;
}

interface ToolUse {
  id?: string;
  name: string;
  input?: Record<string, unknown>;
}

interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  [key: string]: unknown;
}

interface AgentToolResult {
  ok: boolean;
  data?: ToolResultData;
  error?: { code: string; message: string };
  durationMs?: number;
}

interface ToolResultData {
  content?: string;
  _offloaded?: unknown;
  [key: string]: unknown;
}

interface PluginRegistry {
  runHook?(event: string, payload: unknown): Promise<void>;
}

interface Sandbox {
  isRunning: boolean;
  execAsync(cmd: string, opts?: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

interface SessionGoal {
  enabled?: boolean;
  text?: string;
  maxContinuations?: number;
}

interface AssistantMessage {
  role: string;
  content: string;
  reasoning_content?: string;
  tool_uses?: ToolUse[];
  internal?: boolean;
}

class Session {
  id: string;
  provider: SessionProvider | null;
  toolRegistry: ToolRegistry | null;
  permissionManager: CorePermissionChecker | null;
  hookExecutor: HookExecutor | null;
  pluginRegistry: PluginRegistry | null;
  sandbox: Sandbox | null;
  mcpManager: McpManagerHandle | null;
  messages: Array<AssistantMessage | { role: string; content: unknown; internal?: boolean }>;
  isStreaming: boolean;
  responseInterrupted: boolean;
  responseAbortController: AbortController | null;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  turnCount: number;
  goal: SessionGoal | null;
  _modifiedFiles: Set<string>;
  // Optional fields used by tools/session-memory
  _thinking?: boolean;
  _thinkIntensity?: unknown;
  settings?: unknown;

  constructor(o: SessionOptions = {}) {
    this.id = o.id || `s_${Date.now().toString(36)}`;
    this.provider = o.provider || null;
    this.toolRegistry = o.toolRegistry || null;
    this.permissionManager = o.permissionManager || null;
    this.hookExecutor = o.hookExecutor || null;
    this.pluginRegistry = o.pluginRegistry || null;
    this.sandbox = o.sandbox || null;
    this.mcpManager = o.mcpManager || null;
    this.messages = [];
    this.isStreaming = false;
    this.responseInterrupted = false;
    this.responseAbortController = null;
    this.inputTokens = 0; this.outputTokens = 0; this.toolCallCount = 0; this.turnCount = 0;
    this.goal = o.goal || null;
    this._modifiedFiles = new Set();
  }

  getStatusLine(): string {
    const m = this.provider?.model || "?";
    const t = this.inputTokens + this.outputTokens;
    const pm = this.permissionManager?.mode || "normal";
    return `${this.provider?.name || "?"} · ${m} · ${t}t · ${this.turnCount} turns · ${pm}`;
  }
}

// === Hook Executor ===

interface HookEntry {
  event: string;
  handler: (payload: HookPayload) => Promise<HookResult | void>;
  matcher: string | RegExp | null;
  priority: number;
}

interface HookPayload {
  toolName?: string;
  pattern?: string;
  [key: string]: unknown;
}

interface HookResult {
  blocked?: boolean;
  reason?: string;
}

interface HookRunResult {
  blocked: boolean;
  reason?: string;
  results: HookResult[];
}

interface HookExecutorOptions {
  pluginRegistry?: PluginRegistry | null;
}

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
  _hooks: Map<string, HookEntry[]>;
  _registry: PluginRegistry | null;

  constructor(o: HookExecutorOptions = {}) {
    this._hooks = new Map();
    this._registry = o.pluginRegistry || null;
  }

  register(
    event: string,
    handler: (payload: HookPayload) => Promise<HookResult | void>,
    opts: { matcher?: string | RegExp | null; priority?: number } = {}
  ): void {
    if (!this._hooks.has(event)) this._hooks.set(event, []);
    const entry: HookEntry = { event, handler, matcher: opts.matcher || null, priority: opts.priority || 0 };
    const list = this._hooks.get(event)!;
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
  }

  async run(eventName: string, payload: HookPayload = {}): Promise<HookRunResult> {
    if (this._registry) {
      try { await this._registry.runHook?.(eventName, payload); } catch (_) {}
    }

    const hooks = this._hooks.get(eventName) || [];
    const results: HookResult[] = [];
    for (const h of hooks) {
      if (h.matcher) {
        const target = payload.toolName || payload.pattern || "";
        if (!this._match(target, h.matcher)) continue;
      }
      try {
        const r = await h.handler(payload);
        if (r) results.push(r);
        if (r && r.blocked) return { blocked: true, reason: r.reason, results };
      } catch (_) {}
    }
    return { blocked: false, results };
  }

  _match(target: string, matcher: string | RegExp): boolean {
    if (typeof matcher === "string") {
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

interface AgentEngineOptions {
  session?: Session;
  approvalCallback?: ((name: string, input: Record<string, unknown>) => Promise<string>) | null;
  projectRoot?: string;
  maxToolTurns?: number;
  skillRegistry?: SkillRegistry | null;
  skillSystemPrompt?: string;
  pluginHooks?: unknown[];
}

interface SkillRegistry {
  size?: number;
  buildSystemPrompt(): string;
}

interface SendMessageOptions {
  system?: string;
}

class AgentEngine extends EventEmitter {
  session: Session;
  _approvalCallback: ((name: string, input: Record<string, unknown>) => Promise<string>) | null;
  projectRoot: string;
  maxToolTurns: number;
  _skillRegistry: SkillRegistry | null;
  _skillSystemPrompt: string;
  _pluginHooks: unknown[];
  _queryContext: QueryContext;

  constructor(o: AgentEngineOptions = {}) {
    super();
    this.session = o.session!;
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

  get queryContext(): QueryContext { return this._queryContext; }

  async *sendMessage(content: string, opts: SendMessageOptions = {}): AsyncGenerator<Record<string, unknown>> {
    const s = this.session;
    s.messages.push({ role: "user", content });
    s.isStreaming = true; s.responseInterrupted = false;
    s.responseAbortController = new AbortController(); s.turnCount++;

    if (s.hookExecutor) {
      await s.hookExecutor.run(HookEvent.USER_PROMPT_SUBMIT, { prompt: content, session: s });
    }

    this._queryContext.setGoal(content);

    yield { type: "turn.started", sessionId: s.id };

    try {
      const stableSystem = opts.system || this._buildStableSystemPrompt();
      const hasCustomSystem = !!opts.system;
      yield* this._runToolLoop(stableSystem, s.responseAbortController.signal, hasCustomSystem);
    } catch (err) {
      if (s.responseInterrupted) yield { type: "turn.interrupted" };
      else yield { type: "turn.failed", error: { message: (err as Error).message } };
    } finally { s.isStreaming = false; s.responseAbortController = null; }

    // Goal continuation
    if (s.goal?.enabled && s.goal.text) {
      for (let i = 0; i < (s.goal.maxContinuations || 3); i++) {
        const gc = `[goal continuation]\nActive goal: ${s.goal.text}\nContinue working toward the goal. If complete, say GOAL_STATUS: complete.`;
        s.messages.push({ role: "user", content: gc, internal: true });
        s.responseAbortController = new AbortController();
        try { yield* this._runToolLoop(this._buildStableSystemPrompt(), s.responseAbortController.signal, false); }
        catch (_) { break; }
        finally { s.responseAbortController = null; }
        const last = s.messages[s.messages.length - 1];
        if (last?.role === "assistant" && typeof last.content === "string" && last.content.match(/GOAL_STATUS:\s*complete|blocked/i)) break;
      }
    }

    if (s.hookExecutor) {
      await s.hookExecutor.run(HookEvent.SESSION_END, { session: s, turnCount: s.turnCount });
    }
  }

  interrupt(): void { const s = this.session; s.responseInterrupted = true; s.responseAbortController?.abort(); }

  async *_runToolLoop(
    stableSystem: string,
    signal: AbortSignal,
    hasCustomSystem = false
  ): AsyncGenerator<Record<string, unknown>> {
    const s = this.session;
    const registry = s.toolRegistry;
    const pm = s.permissionManager;
    const hooks = s.hookExecutor;
    const ctx = this._queryContext;
    let msgs = [...s.messages];
    let ptlRetries = 0;
    const MAX_PTL_RETRIES = 3;
    const allowReminder = !hasCustomSystem && s.provider?.name === "anthropic";

    for (let turn = 0; turn < this.maxToolTurns; turn++) {
      if (signal.aborted) break;

      const dynamicReminder = allowReminder ? this._buildDynamicContextReminder() : null;
      const msgsWithReminder = dynamicReminder
        ? [...msgs, { role: "user", content: dynamicReminder, internal: true }]
        : msgs;

      const maxTok = boundedCompletionTokens(ctx.maxTokens, ctx.contextWindowTokens);
      let text = "";
      let toolUses: ToolUse[] = [];
      let usage: UsageInfo | null = null;
      let reasoningText = "";

      try {
        for await (const chunk of s.provider!.stream({
          messages: msgsWithReminder,
          system: stableSystem,
          tools: registry?.toApiSchema() || [],
          signal, maxTokens: maxTok,
          thinking: s._thinking || false,
          thinkIntensity: s._thinkIntensity || null,
          enableCache: s.provider?.name === "anthropic",
        })) {
          const c = chunk as StreamChunk;
          if (c.type === "text") { text += c.delta; yield { type: "message.delta", delta: c.delta }; }
          else if (c.type === "thinking") {
            if (c.delta) reasoningText += c.delta;
            yield c as Record<string, unknown>;
          }
          else if (c.type === "tool_uses") { toolUses = c.toolUses || []; text = c.text || text; usage = c.usage || null; }
          else if (c.type === "usage") { usage = c; s.inputTokens += c.inputTokens || 0; s.outputTokens += c.outputTokens || 0; yield c as Record<string, unknown>; }
          else if (c.type === "error") {
            if (isPromptTooLongError(c) && ptlRetries < MAX_PTL_RETRIES) {
              ptlRetries++;
              yield { type: "status", message: `Prompt too long; compacting and retrying (${ptlRetries}/${MAX_PTL_RETRIES})...` };
              if (hooks) await hooks.run(HookEvent.PRE_COMPACT, { messages: msgs, session: s });
              msgs = this._compactMessages(msgs);
              if (hooks) await hooks.run(HookEvent.POST_COMPACT, { messages: msgs, session: s });
              turn--;
              break;
            }
            yield { type: "turn.failed", error: { message: c.message } }; return;
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
        yield { type: "turn.failed", error: { message: (err as Error).message } }; return;
      }

      if (usage) yield { type: "usage", inputTokens: (usage as UsageInfo).inputTokens || 0, outputTokens: (usage as UsageInfo).outputTokens || 0 };

      if (!toolUses.length) {
        const aMsg: AssistantMessage = { role: "assistant", content: text };
        if (reasoningText) aMsg.reasoning_content = reasoningText;
        msgs.push(aMsg);
        s.messages.push({ ...aMsg });
        yield { type: "turn.completed", text, usage, context: ctx.buildContextSummary() };
        return;
      }

      const aMsg: AssistantMessage = { role: "assistant", content: text };
      if (reasoningText) aMsg.reasoning_content = reasoningText;
      if (toolUses.length) aMsg.tool_uses = toolUses;
      msgs.push(aMsg);

      const results: unknown[] = [];
      for (const tu of toolUses) {
        const name = tu.name;
        const input: Record<string, unknown> = (tu.input || {}) as Record<string, unknown>;

        if (hooks) {
          const hookResult = await hooks.run(HookEvent.PRE_TOOL_USE, { toolName: name, args: input, session: s });
          if (hookResult?.blocked) {
            results.push({ type: "tool_result", tool_use_id: tu.id || null, tool_name: name, content: JSON.stringify({ ok: false, error: { code: "HOOK_BLOCKED", message: hookResult.reason || "Blocked by hook" } }) });
            continue;
          }
        }

        if (pm) {
          const tool = registry?.get ? registry.get(name) : null;
          const isReadOnly = tool?.isReadOnly ? tool.isReadOnly(input) : false;
          const pr = pm.evaluate(name, { isReadOnly, args: input });
          if (!pr.allowed) {
            if (pr.requiresConfirmation && this._approvalCallback) {
              const answer = await this._approvalCallback(name, input);
              if (answer !== "approve" && answer !== "always") {
                yield { type: "tool.result", name, isError: true, error: { code: "PERMISSION_DENIED", message: "User denied" } };
                results.push({ type: "tool_result", tool_use_id: tu.id || null, tool_name: name, content: JSON.stringify({ ok: false, error: { code: "PERMISSION_DENIED", message: "User denied" } }) });
                continue;
              }
              if (answer === "always") pm.allowTool(name);
            } else {
              yield { type: "tool.result", name, isError: true, error: { code: "PERMISSION_DENIED", message: pr.reason } };
              results.push({ type: "tool_result", tool_use_id: tu.id || null, tool_name: name, content: JSON.stringify({ ok: false, error: { code: "PERMISSION_DENIED", message: pr.reason } }) });
              continue;
            }
          }
        }

        yield { type: "tool.start", name, input };
        let execResult: AgentToolResult;
        try {
          execResult = await registry!.execute(name, input, { root: this.projectRoot, session: s as unknown as Record<string, unknown>, mcpManager: s.mcpManager }) as AgentToolResult;
          s.toolCallCount++;
        } catch (err) {
          execResult = { ok: false, error: { code: "EXECUTION_ERROR", message: (err as Error).message } };
        }

        if (execResult.ok && execResult.data) {
          const output = typeof execResult.data.content === "string" ? execResult.data.content :
                         JSON.stringify(execResult.data);
          const offloaded = offloadToolOutput(name, tu.id || name, output);
          if (offloaded.file) execResult.data._offloaded = offloaded;
        }

        yield { type: "tool.result", name, isError: !execResult.ok, data: execResult.data, error: execResult.error, durationMs: execResult.durationMs };

        rememberToolContext(ctx, name, input, execResult.data?.content || JSON.stringify(execResult.data || ""));

        if (hooks) await hooks.run(HookEvent.POST_TOOL_USE, { toolName: name, args: input, result: execResult, session: s });

        results.push({
          type: "tool_result",
          tool_use_id: tu.id || null,
          tool_name: name,
          content: JSON.stringify(execResult),
        });
      }

      msgs.push({ role: "user", content: results });
      s.messages.push(...(msgs.slice(-2) as typeof s.messages));
    }

    yield { type: "tool.limit", maxToolTurns: this.maxToolTurns };
  }

  /** Simple compaction — truncate old messages */
  _compactMessages(msgs: typeof Session.prototype.messages): typeof Session.prototype.messages {
    if (msgs.length <= 4) return msgs;
    const keep = msgs.slice(-Math.floor(msgs.length * 0.6));
    const summary = `[Conversation compacted: ${msgs.length - keep.length} older messages summarized. Continue from here.]`;
    return [{ role: "user", content: summary }, ...keep];
  }

  _getSkillsPrompt(): string {
    if (this._skillRegistry?.size && this._skillRegistry.size > 0) return this._skillRegistry.buildSystemPrompt();
    return this._skillSystemPrompt || "";
  }

  /** Return the stable system prompt prefix (used for prompt caching). */
  _buildStableSystemPrompt(): string {
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
  _buildDynamicContextReminder(): string | null {
    const ctx = this._queryContext.buildContextSummary();
    if (!ctx) return null;
    return `<system-reminder>\nCurrent Context:\n${ctx}\n</system-reminder>`;
  }

  /** Compatibility: legacy callers can still fetch the full system prompt (not split). */
  _buildSystemPrompt(): string {
    const stable = this._buildStableSystemPrompt();
    const dynamic = this._buildDynamicContextReminder();
    return dynamic ? `${stable}\n\n${dynamic}` : stable;
  }
}

export {
  Session, AgentEngine, HookExecutor, PermissionChecker,
  HookEvent, PermissionMode, SENSITIVE_PATH_PATTERNS,
};

// Named type exports so cli.ts / run.tsx can use real types instead of `as never`.
export type { SessionProvider, SessionOptions, Sandbox, PluginRegistry };
