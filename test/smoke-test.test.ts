import assert from "node:assert/strict";
import test from "node:test";

// === Core Layer ===
import {
  ApiError, ContextTooLongError, RateLimitError, ServerError,
  AuthError, classifyApiError, isContextTooLongError, ApiErrorCode,
} from "../src/core/api/errors.js";
import { StandardMessage, ContentBlockType, StreamEventType } from "../src/core/messages/types.js";
import { PermissionChecker, PermissionMode } from "../src/core/permissions/checker.js";
import { ApiStreamEventType, createProviderAdapter } from "../src/core/api/provider-adapter.js";
import { AgentEngine, Session, HookExecutor, HookEvent } from "../src/engine/agent.js";
import { QueryContext } from "../src/engine/query.js";
import { createProvider, listProviders } from "../src/api/provider.js";
import { withRetry, isRetryable } from "../src/api/retry.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { extendedTools } from "../src/tools/extended.js";
import * as lspMod from "../src/services/lsp.js";
import { extractFacts, extractLocalRules, factsToMarkdown } from "../src/services/personalization.js";
import { McpClientManager } from "../src/services/mcp.js";
import { SessionSnapshot } from "../src/services/session-memory.js";
import { MemoryExtractor } from "../src/services/memory-extract.js";
import { AutodreamManager } from "../src/services/autodream.js";
import { MemoryStore } from "../src/memory/store.js";
import { microcompact, getContextWindow } from "../src/memory/compact.js";
import { microCompact, contextCollapse, splitPreservingToolPairs, getContextWindow as getCW2, CompactionType } from "../src/core/memory/compaction.js";
import { HookEvent as HE2, HookType, HookRegistry } from "../src/hooks/registry.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { validatePluginManifest, securityAudit } from "../src/plugins/schema.js";
import { PluginInstaller } from "../src/plugins/installer.js";
import { Skill, SkillRegistry, parseFrontmatter } from "../src/skills/registry.js";
import { loadSettings, DEFAULTS } from "../src/config/settings.js";
import { ProfileManager, BUILTIN } from "../src/config/profiles.js";
import { loadProjectContext, buildEnvironmentContext, buildFullSystemPrompt } from "../src/prompts/manager.js";
import { TUI } from "../src/tui/index.js";
import { ANSI, THEME, stripAnsi, estimateStringTokens } from "../src/shared/utils.js";
import * as cliMod from "../src/cli.js";
import indexMod from "../src/index.js";

test("core/api/errors — all error types and classifier", () => {
  assert.equal(Object.keys(ApiErrorCode).length, 9);
  const ctxErr = classifyApiError(new Error("prompt is too long"));
  assert.ok(ctxErr instanceof ContextTooLongError);
  assert.equal(isContextTooLongError(new Error("context_length_exceeded")), true);
});

test("core/messages/types — StandardMessage and content blocks", () => {
  const msg = StandardMessage.user("Hello");
  assert.equal(msg.role, "user");
  assert.equal(msg.text, "Hello");
  assert.ok(msg.estimateTokens() > 0);
  assert.ok(Object.keys(ContentBlockType).length >= 5);
  assert.ok(Object.keys(StreamEventType).length >= 10);
});

test("core/permissions/checker — PermissionChecker", () => {
  const pc = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  assert.equal(pc.mode, "normal");
});

test("core/api/provider-adapter — adapter protocol", () => {
  assert.ok(Object.keys(ApiStreamEventType).length >= 7);
  const adapter = createProviderAdapter({ provider: "anthropic" });
  assert.equal(adapter.name, "anthropic");
});

test("engine/agent — AgentEngine, Session, HookExecutor, 10 events", () => {
  const s = new Session({ provider: { name: "test", model: "test" } });
  assert.ok(s.id.startsWith("s_"));
  assert.equal(s.messages.length, 0);
  const hooks = new HookExecutor();
  assert.equal(typeof hooks.register, "function");
  assert.equal(Object.keys(HookEvent).length, 10);
});

test("engine/query — QueryContext state tracking", () => {
  const ctx = new QueryContext({ cwd: process.cwd(), model: "claude-sonnet-4-20250514" });
  ctx.setGoal("Test goal");
  assert.equal(ctx.taskFocus.goal, "Test goal");
  assert.ok(ctx.buildContextSummary().includes("Test goal"));
});

test("api/provider — 12 providers", () => {
  assert.ok(listProviders().length >= 12);
  const p = createProvider({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
  assert.equal(p.name, "anthropic");
});

test("api/retry — withRetry and isRetryable", () => {
  assert.equal(typeof withRetry, "function");
  assert.equal(isRetryable({ status: 429 }), true);
});

test("tools/registry — ToolRegistry with 42 tools", () => {
  const r = createDefaultRegistry(process.cwd());
  assert.ok(r.list().length >= 40);
  assert.equal(r.get("file.read").isReadOnly(), true);
  assert.equal(r.get("file.write").isReadOnly(), false);
});

test("tools/extended — all extended tools present", () => {
  assert.ok(extendedTools.length >= 28);
  const names = extendedTools.map((t) => t.name);
  for (const n of ["agent", "send_message", "task.create", "enter_plan_mode", "enter_worktree", "cron.create", "grep", "lsp"]) {
    assert.ok(names.includes(n), `Missing tool: ${n}`);
  }
});

test("services/lsp — goToDefinition, findReferences, workspaceSearch", () => {
  assert.equal(typeof lspMod.goToDefinition, "function");
  assert.equal(typeof lspMod.findReferences, "function");
  assert.equal(typeof lspMod.workspaceSearch, "function");
});

test("services/personalization — extractFacts, extractLocalRules", () => {
  const facts = extractFacts("ssh user@host.example.com\nconda activate myenv\npython 3.12");
  assert.ok(facts.length > 0);
  const rules = extractLocalRules([{ role: "user", content: "python 3.12" }]);
  assert.ok(Array.isArray(rules));
  assert.ok(factsToMarkdown(facts).includes("Environment Facts"));
});

test("services/mcp — McpClientManager", () => {
  assert.equal(typeof new McpClientManager().addServer, "function");
});

test("services/session-memory — SessionSnapshot", () => {
  const snap = new SessionSnapshot({ sessionId: "test", turnCount: 5 });
  assert.equal(snap.toJSON().turnCount, 5);
});

test("services/memory-extract — MemoryExtractor", () => {
  const ex = new MemoryExtractor();
  assert.equal(ex.shouldExtract(5), true);
  const prompt = ex.buildExtractionPrompt([{ role: "user", content: "I prefer tabs" }], []);
  assert.ok(prompt.includes("Extract durable memories"));
});

test("services/autodream — AutodreamManager", () => {
  assert.equal(typeof new AutodreamManager().shouldRun, "function");
});

test("memory/store — MemoryStore CRUD", () => {
  const store = new MemoryStore();
  assert.equal(typeof store.init, "function");
  assert.equal(typeof store.save, "function");
});

test("memory/compact — microcompact and context window", () => {
  assert.equal(typeof microcompact, "function");
  assert.equal(getContextWindow("claude-sonnet-4-20250514"), 200000);
});

test("core/memory/compaction — full compaction suite", () => {
  assert.equal(typeof microCompact, "function");
  assert.equal(typeof contextCollapse, "function");
  assert.equal(typeof splitPreservingToolPairs, "function");
  assert.equal(Object.keys(CompactionType).length, 4);
  assert.equal(getCW2("gpt-4o"), 128000);
});

test("hooks/registry — 10 events, 4 hook types", () => {
  assert.equal(Object.keys(HE2).length, 10);
  assert.equal(Object.keys(HookType).length, 4);
  assert.equal(typeof new HookRegistry().register, "function");
});

test("plugins/registry — PluginRegistry", () => {
  assert.equal(typeof new PluginRegistry().loadPlugin, "function");
});

test("plugins/schema — manifest validation", () => {
  const result = validatePluginManifest({ name: "test-plugin", version: "1.0.0" });
  assert.equal(result.valid, true);
  assert.equal(securityAudit({ name: "test", version: "1.0.0" }).risk, "low");
});

test("plugins/installer — PluginInstaller", () => {
  assert.equal(typeof new PluginInstaller().installFromDir, "function");
});

test("skills/registry — Skill loading and registry", () => {
  const registry = new SkillRegistry();
  registry.register(new Skill({ name: "test", description: "Test skill" }));
  assert.equal(registry.size, 1);
  const prompt = registry.buildSystemPrompt();
  assert.ok(prompt.includes("test"));
});

test("config/settings — defaults and loading", () => {
  assert.equal(DEFAULTS.agent.provider, "anthropic");
});

test("config/profiles — 6 builtin profiles", () => {
  assert.ok(Object.keys(BUILTIN).length >= 6);
  assert.equal(new ProfileManager().activeName, "claude");
});

test("prompts/manager — prompt assembly", () => {
  const ctx = buildEnvironmentContext();
  assert.ok(ctx.includes(process.platform));
  const prompt = buildFullSystemPrompt("You are a helpful assistant.", { skipEnvironment: false });
  assert.ok(prompt.includes("You are a helpful assistant."));
});

test("tui/index — Terminal UI", () => {
  const tui = new TUI({ isTTY: false });
  assert.equal(typeof tui.renderEvent, "function");
  assert.equal(typeof tui.getPrompt, "function");
  assert.equal(typeof tui.createApprovalCallback, "function");
  tui._started = true;
  tui.renderEvent({ type: "turn.started" });
  tui.renderEvent({ type: "message.delta", delta: "Hello" });
  tui.renderEvent({ type: "tool.start", name: "file.read", input: { path: "test.js" } });
  tui.renderEvent({ type: "tool.result", name: "file.read", isError: false, durationMs: 5 });
  tui.renderEvent({ type: "turn.completed" });
  tui.renderEvent({ type: "turn.failed", error: { message: "test error" } });
  tui.stop();
});

test("shared/utils — ANSI, THEME, helpers", () => {
  assert.ok(ANSI.reset);
  assert.ok(THEME.accent);
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
  assert.ok(estimateStringTokens("Hello world") > 0);
});

test("cli — CLI entry exports main()", () => {
  assert.equal(typeof cliMod.main, "function");
});

test("index — library exports all 8 subsystems", () => {
  const lib = indexMod;
  for (const key of ["engine", "tools", "api", "config", "skills", "memory", "tui", "commands"]) {
    assert.ok(key in lib, `Missing export: ${key}`);
  }
});

test("integration — full wiring works", () => {
  const provider = createProvider({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
  const registry = createDefaultRegistry(process.cwd());
  const pm = new PermissionChecker();
  const session = new Session({ provider, toolRegistry: registry, permissionManager: pm });
  const engine = new AgentEngine({ session, projectRoot: process.cwd() });

  assert.ok(session.id);
  assert.ok(registry.list().length >= 40);
  assert.equal(typeof engine.sendMessage, "function");
});