"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

// === Core Layer ===

test("core/api/errors — all error types and classifier", () => {
  const {
    ApiError, ContextTooLongError, RateLimitError, ServerError,
    AuthError, classifyApiError, isContextTooLongError, ApiErrorCode,
  } = require("../src/core/api/errors");
  assert.equal(Object.keys(ApiErrorCode).length, 9);
  const ctxErr = classifyApiError(new Error("prompt is too long"));
  assert.ok(ctxErr instanceof ContextTooLongError);
  assert.equal(isContextTooLongError(new Error("context_length_exceeded")), true);
});

test("core/messages/types — StandardMessage and content blocks", () => {
  const { StandardMessage, ContentBlockType, StreamEventType } = require("../src/core/messages/types");
  const msg = StandardMessage.user("Hello");
  assert.equal(msg.role, "user");
  assert.equal(msg.text, "Hello");
  assert.ok(msg.estimateTokens() > 0);
  assert.ok(Object.keys(ContentBlockType).length >= 5);
  assert.ok(Object.keys(StreamEventType).length >= 10);
});

test("core/permissions/checker — PermissionChecker", () => {
  const { PermissionChecker, PermissionMode } = require("../src/core/permissions/checker");
  const pc = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  assert.equal(pc.mode, "default");
});

test("core/api/provider-adapter — adapter protocol", () => {
  const { ApiStreamEventType, createProviderAdapter } = require("../src/core/api/provider-adapter");
  assert.ok(Object.keys(ApiStreamEventType).length >= 7);
  const adapter = createProviderAdapter({ provider: "anthropic" });
  assert.equal(adapter.name, "anthropic");
});

// === Engine Layer ===

test("engine/agent — AgentEngine, Session, HookExecutor, 10 events", () => {
  const { AgentEngine, Session, HookExecutor, HookEvent } = require("../src/engine/agent");
  const s = new Session({ provider: { name: "test", model: "test" } });
  assert.ok(s.id.startsWith("s_"));
  assert.equal(s.messages.length, 0);
  const hooks = new HookExecutor();
  assert.equal(typeof hooks.register, "function");
  assert.equal(Object.keys(HookEvent).length, 10);
});

test("engine/query — QueryContext state tracking", () => {
  const { QueryContext } = require("../src/engine/query");
  const ctx = new QueryContext({ cwd: process.cwd(), model: "claude-sonnet-4-20250514" });
  ctx.setGoal("Test goal");
  assert.equal(ctx.taskFocus.goal, "Test goal");
  assert.ok(ctx.buildContextSummary().includes("Test goal"));
});

// === API Layer ===

test("api/provider — 12 providers", () => {
  const { createProvider, listProviders } = require("../src/api/provider");
  assert.ok(listProviders().length >= 12);
  const p = createProvider({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
  assert.equal(p.name, "anthropic");
});

test("api/retry — withRetry and isRetryable", () => {
  const { withRetry, isRetryable } = require("../src/api/retry");
  assert.equal(typeof withRetry, "function");
  assert.equal(isRetryable({ status: 429 }), true);
});

// === Tools Layer ===

test("tools/registry — ToolRegistry with 42 tools", () => {
  const { createDefaultRegistry } = require("../src/tools/registry");
  const r = createDefaultRegistry(process.cwd());
  assert.ok(r.list().length >= 40);
  assert.equal(r.get("file.read").isReadOnly(), true);
  assert.equal(r.get("file.write").isReadOnly(), false);
});

test("tools/extended — all extended tools present", () => {
  const { extendedTools } = require("../src/tools/extended");
  assert.ok(extendedTools.length >= 28);
  const names = extendedTools.map((t) => t.name);
  for (const n of ["agent", "send_message", "task.create", "enter_plan_mode", "enter_worktree", "cron.create", "grep", "lsp"]) {
    assert.ok(names.includes(n), `Missing tool: ${n}`);
  }
});

// === Services Layer ===

test("services/lsp — goToDefinition, findReferences, workspaceSearch", () => {
  const lsp = require("../src/services/lsp");
  assert.equal(typeof lsp.goToDefinition, "function");
  assert.equal(typeof lsp.findReferences, "function");
  assert.equal(typeof lsp.workspaceSearch, "function");
});

test("services/personalization — extractFacts, extractLocalRules", () => {
  const { extractFacts, extractLocalRules, factsToMarkdown } = require("../src/services/personalization");
  const facts = extractFacts("ssh user@host.example.com\nconda activate myenv\npython 3.12");
  assert.ok(facts.length > 0);
  const rules = extractLocalRules([{ role: "user", content: "python 3.12" }]);
  assert.ok(Array.isArray(rules));
  assert.ok(factsToMarkdown(facts).includes("Environment Facts"));
});

test("services/mcp — McpClientManager", () => {
  const { McpClientManager } = require("../src/services/mcp");
  assert.equal(typeof new McpClientManager().addServer, "function");
});

test("services/session-memory — SessionSnapshot", () => {
  const { SessionSnapshot } = require("../src/services/session-memory");
  const snap = new SessionSnapshot({ sessionId: "test", turnCount: 5 });
  assert.equal(snap.toJSON().turnCount, 5);
});

test("services/memory-extract — MemoryExtractor", () => {
  const { MemoryExtractor, buildExtractionRequest } = require("../src/services/memory-extract");
  const ex = new MemoryExtractor();
  assert.equal(ex.shouldExtract(5), true);
  const prompt = ex.buildExtractionPrompt([{ role: "user", content: "I prefer tabs" }], []);
  assert.ok(prompt.includes("Extract durable memories"));
});

test("services/autodream — AutodreamManager", () => {
  const { AutodreamManager } = require("../src/services/autodream");
  assert.equal(typeof new AutodreamManager().shouldRun, "function");
});

// === Memory Layer ===

test("memory/store — MemoryStore CRUD", () => {
  const { MemoryStore } = require("../src/memory/store");
  const store = new MemoryStore();
  assert.equal(typeof store.init, "function");
  assert.equal(typeof store.save, "function");
});

test("memory/compact — microcompact and context window", () => {
  const { microcompact, getContextWindow } = require("../src/memory/compact");
  assert.equal(typeof microcompact, "function");
  assert.equal(getContextWindow("claude-sonnet-4-20250514"), 200000);
});

// === Core Compaction ===

test("core/memory/compaction — full compaction suite", () => {
  const { microCompact, contextCollapse, splitPreservingToolPairs, getContextWindow, CompactionType } = require("../src/core/memory/compaction");
  assert.equal(typeof microCompact, "function");
  assert.equal(typeof contextCollapse, "function");
  assert.equal(typeof splitPreservingToolPairs, "function");
  assert.equal(Object.keys(CompactionType).length, 4);
  assert.equal(getContextWindow("gpt-4o"), 128000);
});

// === Hooks & Plugins ===

test("hooks/registry — 10 events, 4 hook types", () => {
  const { HookEvent, HookType, HookRegistry, HookExecutor } = require("../src/hooks/registry");
  assert.equal(Object.keys(HookEvent).length, 10);
  assert.equal(Object.keys(HookType).length, 4);
  assert.equal(typeof new HookRegistry().register, "function");
});

test("plugins/registry — PluginRegistry", () => {
  const { PluginRegistry } = require("../src/plugins/registry");
  assert.equal(typeof new PluginRegistry().loadPlugin, "function");
});

test("plugins/schema — manifest validation", () => {
  const { validatePluginManifest, securityAudit } = require("../src/plugins/schema");
  const result = validatePluginManifest({ name: "test-plugin", version: "1.0.0" });
  assert.equal(result.valid, true);
  assert.equal(securityAudit({ name: "test", version: "1.0.0" }).risk, "low");
});

test("plugins/installer — PluginInstaller", () => {
  const { PluginInstaller } = require("../src/plugins/installer");
  assert.equal(typeof new PluginInstaller().installFromDir, "function");
});

// === Skills ===

test("skills/registry — Skill loading and registry", () => {
  const { Skill, SkillRegistry, parseFrontmatter } = require("../src/skills/registry");
  const registry = new SkillRegistry();
  registry.register(new Skill({ name: "test", description: "Test skill" }));
  assert.equal(registry.size, 1);
  const prompt = registry.buildSystemPrompt();
  assert.ok(prompt.includes("test"));
});

// === Config ===

test("config/settings — defaults and loading", () => {
  const { loadSettings, DEFAULTS } = require("../src/config/settings");
  assert.equal(DEFAULTS.agent.provider, "anthropic");
});

test("config/profiles — 6 builtin profiles", () => {
  const { ProfileManager, BUILTIN } = require("../src/config/profiles");
  assert.ok(Object.keys(BUILTIN).length >= 6);
  assert.equal(new ProfileManager().activeName, "claude");
});

// === Prompts ===

test("prompts/manager — prompt assembly", () => {
  const { loadProjectContext, buildEnvironmentContext, buildFullSystemPrompt } = require("../src/prompts/manager");
  const ctx = buildEnvironmentContext();
  assert.ok(ctx.includes(process.platform));
  const prompt = buildFullSystemPrompt("You are a helpful assistant.", { skipEnvironment: false });
  assert.ok(prompt.includes("You are a helpful assistant."));
});

// === TUI ===

test("tui/index — Terminal UI", () => {
  const { TUI } = require("../src/tui/index");
  const tui = new TUI({ isTTY: false });
  assert.equal(typeof tui.renderEvent, "function");
  assert.equal(typeof tui.getPrompt, "function");
  assert.equal(typeof tui.createApprovalCallback, "function");
  // Verify events render without crashing
  tui._started = true;
  tui.renderEvent({ type: "turn.started" });
  tui.renderEvent({ type: "message.delta", delta: "Hello" });
  tui.renderEvent({ type: "tool.start", name: "file.read", input: { path: "test.js" } });
  tui.renderEvent({ type: "tool.result", name: "file.read", isError: false, durationMs: 5 });
  tui.renderEvent({ type: "turn.completed" });
  tui.renderEvent({ type: "turn.failed", error: { message: "test error" } });
  tui.stop();
});

// === Shared ===

test("shared/utils — ANSI, THEME, helpers", () => {
  const { ANSI, THEME, stripAnsi, estimateStringTokens } = require("../src/shared/utils");
  assert.ok(ANSI.reset);
  assert.ok(THEME.accent);
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
  assert.ok(estimateStringTokens("Hello world") > 0);
});

// === CLI and Library ===

test("cli — CLI entry exports main()", () => {
  const cli = require("../src/cli");
  assert.equal(typeof cli.main, "function");
});

test("index — library exports all 8 subsystems", () => {
  const lib = require("../src/index");
  for (const key of ["engine", "tools", "api", "config", "skills", "memory", "tui", "commands"]) {
    assert.ok(key in lib, `Missing export: ${key}`);
  }
});

// === Integration ===

test("integration — full wiring works", () => {
  const { Session, AgentEngine, HookExecutor } = require("../src/engine/agent");
  const { createProvider } = require("../src/api/provider");
  const { createDefaultRegistry } = require("../src/tools/registry");
  const { PermissionChecker } = require("../src/core/permissions/checker");

  const provider = createProvider({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
  const registry = createDefaultRegistry(process.cwd());
  const pm = new PermissionChecker();
  const session = new Session({ provider, toolRegistry: registry, permissionManager: pm });
  const engine = new AgentEngine({ session, projectRoot: process.cwd() });

  assert.ok(session.id);
  assert.ok(registry.list().length >= 40);
  assert.equal(typeof engine.sendMessage, "function");
});
