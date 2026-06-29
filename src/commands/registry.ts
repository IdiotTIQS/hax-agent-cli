import path from "path";
import fs from "fs";
import { readFileSync } from "fs";
import { join } from "path";
import os from "os";
import { spawn } from "child_process";
import { execSync } from "child_process";
import { ANSI, THEME, styled } from "../shared/utils.js";
import { loadSettings, saveSettings, reloadSettings } from "../config/settings.js";
import { PermissionMode } from "../engine/agent.js";
import { ProfileManager } from "../config/profiles.js";
import { createProvider } from "../api/provider.js";
import { loadSkillRegistry } from "../skills/registry.js";
import { microcompact, estimateMessageTokens, getContextWindow } from "../memory/compact.js";
import { workspaceSearch, goToDefinition } from "../services/lsp.js";
import { MemoryStore } from "../memory/store.js";
import { listProviders } from "../api/provider.js";
import { listThemes, applyTheme } from "../shared/themes.js";
import { THEMES } from "../shared/themes.js";
import { extractLocalRules, factsToMarkdown } from "../services/personalization.js";
import { SandboxAdapter } from "../sandbox/adapter.js";
import registerExtended from "./extended-commands.js";

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")).version;

interface CommandContext {
  screen: { write(t: string): void };
  session: {
    messages: Array<{ role: string; content: unknown; internal?: boolean }>;
    provider: { name?: string; model?: string; apiKey?: string; apiUrl?: string; listModels?(): Promise<Array<{ id: string }>> } | null;
    toolRegistry?: { list(): Array<{ name: string; description: string }> } | null;
    permissionManager: { mode: string; _alwaysAllow?: Set<string>; _alwaysDeny?: Set<string>; allowTool(t: string): void; denyTool(t: string): void; } | null;
    costTracker?: { getCost(m: string): number; getPricing(m: string): unknown; turnCount: number; toolCallCount: number; } | null;
    goal?: { enabled?: boolean; text?: string; maxContinuations?: number } | null;
    sandbox?: { isRunning?: boolean; backend?: string; start(): Promise<void>; stop(): void } | null;
    hookExecutor?: { run?(event: string, payload: unknown): Promise<void> } | null;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    turnCount?: number;
    toolCallCount?: number;
    id?: string;
    _modifiedFiles?: Set<string>;
    _thinking?: boolean;
    _thinkIntensity?: string | number | null;
    _tags?: string[];
    getStatusLine?(): string;
    isStreaming?: boolean;
  };
  rl?: { prompt?(): void; close?(): void; question?(q: string, cb: (a: string) => void): void } | null;
  settings?: { projectRoot?: string; [key: string]: unknown } | null;
  mcpManager?: { getStatus(): Record<string, { status: string; tools: number }>; loadConfig(): void; startAll(): Promise<void>; stopAll(): void; discoverTools(): Promise<Array<{ name: string }>> } | null;
  engine?: { maxToolTurns?: number } | null;
}

interface CommandEntry {
  handler(args: string[], ctx: CommandContext): void | Promise<void>;
  description: string;
}

const commands: Record<string, CommandEntry> = {};

function _persist(key: string, val: unknown, sub?: string): void {
  try {
    const s = (loadSettings() ?? {}) as Record<string, unknown>;
    if (sub) { if (!s[key]) s[key] = {}; (s[key] as Record<string, unknown>)[sub] = val; }
    else s[key] = val;
    saveSettings(s as Parameters<typeof saveSettings>[0]);
  } catch (_) {}
}

function register(name: string, handler: (args: string[], ctx: CommandContext) => void | Promise<void>, desc = ""): void { commands[name] = { handler, description: desc }; }

async function execute(line: string, ctx: CommandContext): Promise<void> {
  const [cmd, ...args] = line.slice(1).trim().split(/\s+/);
  const c = commands[cmd];
  if (!c) { ctx.screen.write(`${styled(THEME.warning, `Unknown command: /${cmd}`)}\n`); ctx.rl?.prompt?.(); return; }
  await c.handler(args, ctx);
}

// === Register all commands ===

register("help", (_, ctx) => {
  const A = ANSI, T = THEME;
  ctx.screen.write(`\n${styled(T.heading, "Commands:")}\n`);
  const list = Object.entries(commands).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, c] of list) {
    if (name === "q") continue; // skip shorthand
    ctx.screen.write(`  ${styled(T.accent, `/${name}`.padEnd(18))} ${T.dim}${c.description}${A.reset}\n`);
  }
  // Also list skills
  try {
    const skills = loadSkillRegistry();
    if (skills.size > 0) {
      ctx.screen.write(`\n${styled(T.heading, "Skills (use /skill-name):")}\n`);
      for (const s of skills.list()) {
        ctx.screen.write(`  ${styled(T.success, `/${s.name}`.padEnd(18))} ${T.dim}${s.description || ""}${A.reset}\n`);
      }
    }
  } catch (_) {}
  ctx.screen.write("\n");
  ctx.rl?.prompt?.();
}, "Show this help");

register("exit", (_, ctx) => { ctx.rl?.close?.(); }, "Exit the session");
register("quit", (_, ctx) => { ctx.rl?.close?.(); }, "Exit the session");
register("q", (_, ctx) => { ctx.rl?.close?.(); });

register("clear", (_, ctx) => {
  ctx.session.messages = [];
  ctx.screen.write(`${styled(THEME.success, "Context cleared.")}\n`);
  ctx.rl?.prompt?.();
}, "Clear conversation context");

register("models", async (_, ctx) => {
  try {
    const models = await ctx.session.provider?.listModels?.() ?? [];
    for (const m of models) ctx.screen.write(`  ${m.id}\n`);
  } catch (err) { ctx.screen.write(`${styled(THEME.error, (err as Error).message)}\n`); }
  ctx.rl?.prompt?.();
}, "List available models");

register("model", (args, ctx) => {
  if (args.length > 0) {
    if (ctx.session.provider) ctx.session.provider.model = args[0];
    // Persist to settings
    try {
      const s = loadSettings() ?? {} as Record<string, unknown>;
      if (!s.agent) s.agent = {};
      (s.agent as Record<string, unknown>).model = args[0];
      saveSettings(s as Parameters<typeof saveSettings>[0]);
    } catch (_) {}
    ctx.screen.write(`${styled(THEME.success, "Model: " + args[0])}\n`);
  }
  else ctx.screen.write(`${styled(THEME.info, "Current model: " + ctx.session.provider?.model)}\n`);
  ctx.rl?.prompt?.();
}, "Switch model");

register("provider", async (args, ctx) => {
  const pm = new ProfileManager();
  if (args[0] === "list") {
    const profiles = pm.list();
    for (const [n, p] of Object.entries(profiles)) ctx.screen.write(`  ${n === pm.activeName ? THEME.success + "*" : " "}${ANSI.reset} ${n.padEnd(12)} ${p.provider}/${p.model || "default"}\n`);
  } else if (args[0]) {
    if (pm.use(args[0])) {
      ctx.session.provider = createProvider({ ...pm.active } as { provider?: string; model?: string });
      // Persist to settings so it survives restart
      try {
        const s = (loadSettings() ?? {}) as Record<string, unknown>;
        if (!s.agent) s.agent = {};
        (s.agent as Record<string, unknown>)._activeProfile = args[0];
        (s.agent as Record<string, unknown>).provider = pm.active.provider;
        (s.agent as Record<string, unknown>).model = pm.active.model || "default";
        saveSettings(s as Parameters<typeof saveSettings>[0]);
      } catch (_) {}
      ctx.screen.write(`${styled(THEME.success, "Profile: " + args[0] + " (" + pm.active.provider + "/" + (pm.active.model || "default") + ")")}\n`);
    } else {
      // Fallback: try raw provider name
      try {
        const prov = createProvider({ provider: args[0] });
        pm.set(args[0], { provider: args[0], model: prov.model || "", apiUrl: prov.apiUrl || "" });
        pm.use(args[0]);
        ctx.session.provider = prov;
        ctx.screen.write(`${styled(THEME.success, "Switched to " + args[0] + " (" + prov.model + ")")}\n`);
      } catch (_) {
        ctx.screen.write(`${styled(THEME.error, "Unknown: " + args[0])}\n`);
      }
    }
  } else ctx.screen.write(`${styled(THEME.info, "Profile: " + pm.activeName + " (" + pm.active.provider + "/" + (pm.active.model || "default") + ")")}\n`);
  ctx.rl?.prompt?.();
}, "Switch provider profile (use 'list' to see all)");

register("status", (_, ctx) => {
  ctx.screen.write(`${ctx.session.getStatusLine?.() ?? ""}\n`);
  ctx.rl?.prompt?.();
}, "Show session status");

register("tools", (_, ctx) => {
  const tools = ctx.session.toolRegistry?.list() || [];
  for (const t of tools) ctx.screen.write(`  ${t.name}: ${t.description}\n`);
  ctx.rl?.prompt?.();
}, "List available tools");

register("skills", (_, ctx) => {
  try {
    const reg = loadSkillRegistry(ctx.settings?.projectRoot || process.cwd());
    const skills = reg.list();
    if (!skills.length) ctx.screen.write(`${styled(THEME.dim, "No skills found. Create .hax-agent/skills/<name>/SKILL.md")}\n`);
    else for (const s of skills) ctx.screen.write(`  ${s.name}: ${s.description}\n`);
  } catch (_) { ctx.screen.write(`${styled(THEME.dim, "Skills system not available")}\n`); }
  ctx.rl?.prompt?.();
}, "List available skills");

register("goal", (args, ctx) => {
  const s = ctx.session;
  if (args[0] === "clear") { s.goal = null; ctx.screen.write(`${styled(THEME.success, "Goal cleared.")}\n`); }
  else if (args.length > 0) { s.goal = { enabled: true, text: args.join(" "), maxContinuations: 5 }; ctx.screen.write(`${styled(THEME.success, `Goal set: ${args.join(" ")}`)}\n`); }
  else { ctx.screen.write(s.goal?.text ? `${styled(THEME.info, `Goal: ${s.goal.text}`)}\n` : `${styled(THEME.dim, "No active goal.")}\n`); }
  ctx.rl?.prompt?.();
}, "Set or clear a persistent goal");

register("yolo", (_, ctx) => {
  const pm = ctx.session.permissionManager;
  if (pm) {
    pm.mode = pm.mode === PermissionMode.YOLO ? PermissionMode.DEFAULT : PermissionMode.YOLO;
    _persist("permissions", pm.mode, "mode");
    ctx.screen.write(`${styled(THEME.warning, "Permission: " + pm.mode.toUpperCase())}\n`);
  }
  ctx.rl?.prompt?.();
}, "Toggle YOLO mode (auto-approve all tools)");

register("plan", (_, ctx) => {
  const pm = ctx.session.permissionManager;
  if (pm) {
    pm.mode = pm.mode === PermissionMode.PLAN ? PermissionMode.DEFAULT : PermissionMode.PLAN;
    _persist("permissions", pm.mode, "mode");
    ctx.screen.write(`${styled(THEME.info, "Permission: " + pm.mode.toUpperCase() + (pm.mode === PermissionMode.PLAN ? " — all mutating tools blocked" : ""))}\n`);
  }
  ctx.rl?.prompt?.();
}, "Toggle Plan mode (block all mutating tools)");

register("think", (args, ctx) => {
  var s = ctx.session;
  if (args[0] === "off") {
    s._thinking = false; s._thinkIntensity = null;
    _persist("agent", false, "thinking"); _persist("agent", null, "thinkIntensity");
    ctx.screen.write(styled(THEME.info, "Thinking: OFF") + "\n");
  } else if (["low","medium","high","x-high","max"].includes(args[0])) {
    s._thinking = true; s._thinkIntensity = args[0];
    _persist("agent", args[0], "thinkIntensity"); _persist("agent", true, "thinking");
    ctx.screen.write(styled(THEME.success, "Thinking: ON (" + args[0] + ")") + "\n");
  } else if (args[0] && /^\d+$/.test(args[0])) {
    s._thinking = true; s._thinkIntensity = parseInt(args[0]);
    ctx.screen.write(styled(THEME.success, "Thinking: ON (" + args[0] + " tokens)") + "\n");
  } else {
    s._thinking = !s._thinking;
    if (!s._thinking) s._thinkIntensity = null;
    ctx.screen.write(styled(THEME.info, "Thinking: " + (s._thinking ? "ON" : "OFF")) + "\n");
  }
  ctx.rl?.prompt?.();
}, "Toggle thinking mode (/think low|medium|high|N or off)");

register("fullauto", (_, ctx) => {
  const pm = ctx.session.permissionManager;
  if (pm) {
    pm.mode = pm.mode === PermissionMode.FULL_AUTO ? PermissionMode.DEFAULT : PermissionMode.FULL_AUTO;
    _persist("permissions", pm.mode, "mode");
    ctx.screen.write(`${styled(THEME.warning, "Permission: " + pm.mode.toUpperCase())}\n`);
  }
  ctx.rl?.prompt?.();
}, "Toggle Full Auto mode (approve all tools silently)");

register("perms", (_, ctx) => {
  const pm = ctx.session.permissionManager;
  ctx.screen.write(`${styled(THEME.info, `Mode: ${pm?.mode || "normal"} | Always allow: ${[...(pm?._alwaysAllow||[])].join(", ") || "none"} | Always deny: ${[...(pm?._alwaysDeny||[])].join(", ") || "none"}`)}\n`);
  ctx.rl?.prompt?.();
}, "Show permission status");

register("allow", (args, ctx) => {
  const pm = ctx.session.permissionManager;
  if (pm && args[0]) { pm.allowTool(args[0]); _persist("permissions", [...(pm._alwaysAllow || [])], "allowedTools"); ctx.screen.write(`${styled(THEME.success, "Always allow: " + args[0])}\n`); }
  ctx.rl?.prompt?.();
}, "Always allow a tool");

register("deny", (args, ctx) => {
  const pm = ctx.session.permissionManager;
  if (pm && args[0]) { pm.denyTool(args[0]); _persist("permissions", [...(pm._alwaysDeny || [])], "deniedTools"); ctx.screen.write(`${styled(THEME.warning, "Always deny: " + args[0])}\n`); }
  ctx.rl?.prompt?.();
}, "Always deny a tool");

register("config", (args, ctx) => {
  if (args[0] === "reload") {
    const cfg = reloadSettings() ?? {};
    ctx.screen.write(`${styled(THEME.success, "Configuration reloaded from disk.")}\n`);
    ctx.screen.write(`${JSON.stringify({ agent: (cfg as Record<string, unknown>).agent, permissions: (cfg as Record<string, unknown>).permissions, ui: (cfg as Record<string, unknown>).ui }, null, 2)}\n`);
  } else {
    const cfg = loadSettings() ?? {};
    ctx.screen.write(`${JSON.stringify(cfg, null, 2)}\n`);
  }
  ctx.rl?.prompt?.();
}, "Show current configuration (/config reload to re-read from disk)");

register("version", (_, ctx) => {
  ctx.screen.write(`hax-agent v${VERSION}\nNode.js ${process.version} · ${process.platform} ${process.arch}\n`);
  ctx.rl?.prompt?.();
}, "Show version info");

register("memory", async (args, ctx) => {
  const store = new MemoryStore();
  await store.init();
  if (args[0] === "search" && args[1]) {
    const results = await store.search(args.slice(1).join(" "));
    if (!results.length) ctx.screen.write(`${styled(THEME.dim, "No memories found.")}\n`);
    else for (const r of results) ctx.screen.write(`  [${r.category}] ${r.title}: ${r.content.slice(0, 100)}...\n`);
  } else {
    const memories = await store.list();
    ctx.screen.write(`${styled(THEME.info, `Memories: ${memories.length}`)}\n`);
    for (const m of memories.slice(0, 10)) ctx.screen.write(`  [${m.category}] ${m.title}\n`);
  }
  ctx.rl?.prompt?.();
}, "Manage persistent memories (search, list)");

register("compact", (_, ctx) => {
  const s = ctx.session;
  const { messages, cleared } = microcompact(s.messages);
  s.messages = messages;
  ctx.screen.write(`${styled(THEME.success, `Compacted: ${cleared} tool results cleared. ${estimateMessageTokens(messages).toLocaleString()} tokens`)}\n`);
  ctx.rl?.prompt?.();
}, "Compact conversation context");

register("lsp", async (args, ctx) => {
  const root = ctx.settings?.projectRoot || process.cwd();
  if (args[0] === "def" && args[1]) {
    const defs = goToDefinition(root, args[1]);
    for (const d of defs) ctx.screen.write(`  ${d.kind} ${d.name} — ${d.path}:${d.line}\n`);
    if (!defs.length) ctx.screen.write(`${styled(THEME.dim, "Not found.")}\n`);
  } else if (args[0] === "search" && args[1]) {
    const syms = workspaceSearch(root, args[1]);
    for (const s of syms.slice(0, 15)) ctx.screen.write(`  ${s.kind} ${s.name} — ${path.basename(s.path)}:${s.line}\n`);
  } else {
    ctx.screen.write(`${styled(THEME.info, "Usage: /lsp def <symbol> | /lsp search <query>")}\n`);
  }
  ctx.rl?.prompt?.();
}, "Code navigation (def, search)");

register("cost", (_, ctx) => {
  const s = ctx.session;
  const input = s.inputTokens ?? 0; const output = s.outputTokens ?? 0;
  const model = s.provider?.model || "?";
  const cost = s.costTracker ? s.costTracker.getCost(model) : 0;
  const pricing = s.costTracker ? s.costTracker.getPricing(model) : null;
  const source = pricing ? `${s.provider?.name || "unknown"} pricing` : "no pricing data";
  ctx.screen.write(`  Provider: ${s.provider?.name || "?"} / ${model}\n`);
  ctx.screen.write(`  Input:    ${input.toLocaleString()} tokens\n`);
  ctx.screen.write(`  Output:   ${output.toLocaleString()} tokens\n`);
  ctx.screen.write(`  Total:    ${(input + output).toLocaleString()} tokens\n`);
  if ((s.cacheCreationTokens ?? 0) > 0) ctx.screen.write(`  Cache write: ${(s.cacheCreationTokens ?? 0).toLocaleString()} tokens\n`);
  if ((s.cacheReadTokens ?? 0) > 0) ctx.screen.write(`  Cache read:  ${(s.cacheReadTokens ?? 0).toLocaleString()} tokens\n`);
  ctx.screen.write(`  Cost:     ~$${cost.toFixed(4)} (${source})\n`);
  ctx.screen.write(`  Turns:    ${s.turnCount} · Tools: ${s.toolCallCount}\n`);
  ctx.rl?.prompt?.();
}, "Show cost and usage breakdown");

register("context", (_, ctx) => {
  const msgs = ctx.session.messages;
  const tokens = estimateMessageTokens(msgs);
  const model = ctx.session.provider?.model || "?";

  const window = getContextWindow(model);
  const pct = ((tokens / window) * 100).toFixed(1);
  ctx.screen.write(`  Messages: ${msgs.length}\n`);
  ctx.screen.write(`  Tokens:   ${tokens.toLocaleString()} / ${window.toLocaleString()} (${pct}%)\n`);
  ctx.screen.write(`  Model:    ${model} (${window.toLocaleString()} context window)\n`);
  ctx.rl?.prompt?.();
}, "Show context window usage");

register("doctor", async (_, ctx) => {
  const providers = listProviders();
  const s = ctx.session;
  let ok = 0, warn = 0, err = 0;
  ctx.screen.write(`${styled(THEME.heading, "Doctor Report")}\n\n`);
  // Provider check
  ctx.screen.write(`  Provider: ${s.provider?.name || "?"} / ${s.provider?.model || "?"}`);
  if (s.provider?.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) { ctx.screen.write(` ${styled(THEME.success, "✓")}\n`); ok++; }
  else { ctx.screen.write(` ${styled(THEME.error, "✗ No API key")}\n`); err++; }
  // Tools check
  const tools = s.toolRegistry?.list() || [];
  ctx.screen.write(`  Tools:    ${tools.length} registered`);
  if (tools.length >= 5) { ctx.screen.write(` ${styled(THEME.success, "✓")}\n`); ok++; }
  else { ctx.screen.write(` ${styled(THEME.warning, "⚠")}\n`); warn++; }
  // Available providers
  ctx.screen.write(`  Providers:${providers.length} available (${providers.map(p => p.name).slice(0, 6).join(", ")}...)\n`);
  ok++;
  // Summary
  ctx.screen.write(`\n  ${styled(THEME.success, `${ok} ready`)}, ${styled(THEME.warning, `${warn} warnings`)}, ${styled(THEME.error, `${err} errors`)}\n`);
  ctx.rl?.prompt?.();
}, "Run diagnostic check");

register("api-key", (args, ctx) => {
  const dir = path.join(os.homedir(), ".haxagent");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const cfgPath = path.join(dir, "apikeys.json");
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch (_) {}

  // Determine provider and key
  let provider, key;
  if (args.length >= 2) {
    provider = args[0]; key = args.slice(1).join(" ");
  } else if (args.length === 1 && args[0]) {
    // Single arg: if it looks like a key (starts with sk- or similar), use current provider
    if (args[0].match(/^(sk-|AIza|glm-|kp-)/) && ctx.session.provider?.name) {
      provider = ctx.session.provider.name;
      key = args[0];
    } else {
      ctx.screen.write(`${styled(THEME.info, "Usage: /api-key <key>  or  /api-key <provider> <key>")}\n`);
      ctx.rl?.prompt?.(); return;
    }
  } else {
    // Show current status
    const prov = ctx.session.provider?.name || "unknown";
    ctx.screen.write(`${styled(THEME.info, "API key for " + prov + ": " + (keys[prov] ? "set" : "not set"))}\n`);
    ctx.rl?.prompt?.(); return;
  }

  keys[provider] = key;
  fs.writeFileSync(cfgPath, JSON.stringify(keys, null, 2));
  // Also set on the provider object directly
  if (ctx.session.provider) ctx.session.provider.apiKey = key;
  ctx.screen.write(`${styled(THEME.success, "API key set for " + provider)}\n`);
  ctx.rl?.prompt?.();
}, "Set API key (auto-detects current provider)");

register("api-url", (args, ctx) => {
  if (args[0]) {
    if (ctx.session.provider) ctx.session.provider.apiUrl = args[0];
    ctx.screen.write(`${styled(THEME.success, `API URL set to: ${args[0]}`)}\n`);
  } else {
    ctx.screen.write(`${styled(THEME.info, `API URL: ${ctx.session.provider?.apiUrl || "default"}`)}\n`);
  }
  ctx.rl?.prompt?.();
}, "Set or show API base URL");

register("export", (_, ctx) => {
  const s = ctx.session;
  const data = {
    sessionId: s.id, model: s.provider?.model, turns: s.turnCount,
    toolCalls: s.toolCallCount, tokens: { input: s.inputTokens, output: s.outputTokens },
    messages: s.messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 500) : "[complex]" })),
    exportedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(data, null, 2);
  const fp = `./hax-session-${s.id}.json`;
  fs.writeFileSync(fp, json);
  ctx.screen.write(`${styled(THEME.success, `Exported to: ${fp}`)}\n`);
  ctx.rl?.prompt?.();
}, "Export session to JSON");

register("copy", (_, ctx) => {
  const last = [...ctx.session.messages].reverse().find(m => m.role === "assistant");
  if (!last?.content) { ctx.screen.write(`${styled(THEME.dim, "No assistant response to copy.")}\n`); ctx.rl?.prompt?.(); return; }
  const text = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
  const platform = process.platform;
  const cmd = platform === "win32" ? ["clip"] : platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
  child.on("error", () => ctx.screen.write(`${styled(THEME.warning, "Clipboard not available.")}\n`));
  child.stdin.write(text); child.stdin.end();
  ctx.screen.write(`${styled(THEME.success, `Copied ${text.length} chars to clipboard.`)}\n`);
  ctx.rl?.prompt?.();
}, "Copy last response to clipboard");

register("init", (_, ctx) => {
  const cwd = ctx.settings?.projectRoot || process.cwd();
  const dir = path.join(cwd, ".hax-agent");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dirs = ["skills", "plugins", "memories"];
  for (const d of dirs) { const dp = path.join(dir, d); if (!fs.existsSync(dp)) fs.mkdirSync(dp); }
  ctx.screen.write(`${styled(THEME.success, `Initialized .hax-agent/ in ${cwd}`)}\n`);
  ctx.rl?.prompt?.();
}, "Initialize .hax-agent project directory");

register("permissions", (args, ctx) => {
  const pm = ctx.session.permissionManager;
  if (!pm) { ctx.rl?.prompt?.(); return; }
  if (args[0] === "allow" && args[1]) { pm.allowTool(args[1]); ctx.screen.write(`${styled(THEME.success, "Always allow: " + args[1])}\n`); }
  else if (args[0] === "deny" && args[1]) { pm.denyTool(args[1]); ctx.screen.write(`${styled(THEME.warning, "Always deny: " + args[1])}\n`); }
  else if (args[0] === "reset") { pm._alwaysAllow?.clear(); pm._alwaysDeny?.clear(); ctx.screen.write(`${styled(THEME.success, "Permissions reset.")}\n`); }
  else if (args[0] === "yolo") { pm.mode = "yolo"; ctx.screen.write(`${styled(THEME.warning, "YOLO mode: all tools auto-approved.")}\n`); }
  else if (args[0] === "normal") { pm.mode = "normal"; ctx.screen.write(`${styled(THEME.info, "Normal mode: tools require approval.")}\n`); }
  else {
    ctx.screen.write(`${styled(THEME.info, `Mode: ${pm.mode}`)}\n`);
    ctx.screen.write(`  Allow: ${[...(pm._alwaysAllow || [])].join(", ") || "none"}\n`);
    ctx.screen.write(`  Deny:  ${[...(pm._alwaysDeny || [])].join(", ") || "none"}\n`);
    ctx.screen.write(`  Usage: /permissions [allow|deny|reset|yolo|normal] [tool]\n`);
  }
  ctx.rl?.prompt?.();
}, "Manage tool permissions");

register("sandbox", (args, ctx) => {
  const s = ctx.session;
  if (args[0] === "on" || args[0] === "enable") {
    if (s.sandbox) { ctx.screen.write(`${styled(THEME.info, "Sandbox already running (" + s.sandbox.backend + ")")}\n`); }
    else {
      const settings = loadSettings() ?? {} as Record<string, unknown>;
      const sandboxCfg = (settings as Record<string, unknown>).sandbox as Record<string, unknown> | undefined;
      s.sandbox = new SandboxAdapter({ backend: sandboxCfg?.backend || "docker", image: sandboxCfg?.image || "node:18-alpine", network: sandboxCfg?.network || "none", cpus: sandboxCfg?.cpus || 2, memory: sandboxCfg?.memory || "512m", hostDir: process.cwd() });
      s.sandbox.start().then(() => {
        ctx.screen.write(`${styled(THEME.success, "Sandbox started (" + s.sandbox!.backend + ")")}\n`);
        ctx.rl?.prompt?.();
      }).catch((err) => {
        ctx.screen.write(`${styled(THEME.error, "Sandbox failed: " + (err as Error).message)}\n`);
        s.sandbox = null;
        ctx.rl?.prompt?.();
      });
      return;
    }
  } else if (args[0] === "off" || args[0] === "disable") {
    if (s.sandbox) { s.sandbox.stop(); s.sandbox = null; ctx.screen.write(`${styled(THEME.success, "Sandbox stopped")}\n`); }
    else { ctx.screen.write(`${styled(THEME.info, "Sandbox is not running")}\n`); }
  } else {
    const running = s.sandbox?.isRunning;
    const backend = s.sandbox?.backend || "none";
    ctx.screen.write(`${styled(THEME.info, `Sandbox: ${running ? "running (" + backend + ")" : "disabled"}`)}\n`);
    ctx.screen.write(`  Usage: /sandbox [on|off]\n`);
  }
  ctx.rl?.prompt?.();
}, "Docker sandbox isolation for shell commands");

register("providers", (_, ctx) => {
  const providers = listProviders();
  ctx.screen.write(`${styled(THEME.info, `Available providers (${providers.length}):`)}\n`);
  for (const p of providers) ctx.screen.write(`  ${p.name.padEnd(12)} ${p.model}${p.envKey ? ` (env: ${p.envKey})` : ""}\n`);
  ctx.rl?.prompt?.();
}, "List all available AI providers");

register("theme", (args, ctx) => {
  if (args[0] === "list") {
    for (const t of listThemes()) ctx.screen.write(`  ${t.name.padEnd(12)} ${t.description}\n`);
  } else if (args[0]) {
    applyTheme(args[0], THEME);
    _persist("ui", args[0], "theme");
    ctx.screen.write(`${styled(THEME.success, "Theme: " + args[0])}\n`);
  } else {
    ctx.screen.write(`${styled(THEME.info, "Usage: /theme <name> | /theme list")}\n`);
    ctx.screen.write(`  Available: ${Object.keys(THEMES).join(", ")}\n`);
  }
  ctx.rl?.prompt?.();
}, "Switch terminal theme");

register("personalize", (_, ctx) => {
  const facts = extractLocalRules(ctx.session.messages);
  ctx.screen.write(`${styled(THEME.info, `Extracted ${facts.length} environment facts`)}\n`);
  if (facts.length > 0) {
    const md = factsToMarkdown(facts);
    // Save to .hax-agent/rules.md
    const fp = path.join(ctx.settings?.projectRoot || process.cwd(), ".hax-agent", "rules.md");
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, md);
    ctx.screen.write(`${styled(THEME.success, `Saved to ${fp}`)}\n`);
  }
  ctx.rl?.prompt?.();
}, "Extract environment facts from conversation");

// Load extended commands
registerExtended(register, styled, THEME as unknown as Record<string, string>, ANSI as unknown as Record<string, string>);

export { register, execute, commands };
