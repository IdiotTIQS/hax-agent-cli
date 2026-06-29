/**
 * Extended Commands — session, MCP, plugin, git, and utility commands.
 * Appended to commands/registry.js for clean loading.
 */

import fs from "fs";
import path from "path";
import { SessionMemoryStore } from "../services/session-memory.js";
import { McpClientManager } from "../services/mcp.js";
import { PluginRegistry } from "../plugins/registry.js";
import { MemoryExtractor } from "../services/memory-extract.js";
import { execSync } from "child_process";

export default function registerExtended(
  registerFn: (name: string, handler: (args: string[], ctx: any) => void | Promise<void>, desc?: string) => void,
  styledFn: (color: string, text: string) => string,
  THEME: Record<string, string>,
  ANSI: Record<string, string>
): void {
  const register = registerFn;
  const styled = styledFn;

  // Session management
  register("session", (args, ctx) => {
    const store = new SessionMemoryStore();
    const sid = ctx.session.id;

    if (args[0] === "save") {
      const fp = store.saveSnapshot(ctx.session);
      ctx.screen.write(`${styled(THEME.success, `Session saved to ${fp}`)}\n`);
    } else if (args[0] === "list") {
      const snaps = store.listSnapshots(sid);
      if (snaps.length === 0) { ctx.screen.write(`${styled(THEME.dim, "No saved snapshots.")}\n`); }
      else {
        for (const s of snaps) {
          const dt = new Date(s.timestamp).toLocaleString();
          ctx.screen.write(`  ${dt}  turns:${s.turnCount}  tokens:${s.tokenCount}\n`);
        }
      }
    } else if (args[0] === "restore") {
      const snap = store.getLatestSnapshot(sid);
      if (!snap) { ctx.screen.write(`${styled(THEME.warning, "No snapshot to restore.")}\n`); }
      else {
        ctx.session.messages = snap.messages.slice(-50);
        ctx.screen.write(`${styled(THEME.success, `Restored ${snap.messages.length} messages (${snap.turnCount} turns)`)}\n`);
      }
    } else {
      ctx.screen.write("Usage: /session [save|list|restore]\n");
    }
    ctx.rl?.prompt?.();
  }, "Save, list, or restore session snapshots");

  // Continue last session
  register("continue", (args, ctx) => {
    const store = new SessionMemoryStore();
    const sid = args[0] || ctx.session.id;
    const snap = store.getLatestSnapshot(sid);
    if (!snap) { ctx.screen.write(`${styled(THEME.warning, "No saved session to continue.")}\n`); }
    else {
      ctx.session.messages = snap.messages.slice(-50);
      ctx.session.turnCount = snap.turnCount;
      ctx.screen.write(`${styled(THEME.success, `Continuing session: ${snap.turnCount} turns, ${snap.totalTokens} tokens`)}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Continue a previous session");

  // Session Summary
  register("summary", (args, ctx) => {
    const msgs = ctx.session.messages;
    if (msgs.length === 0) { ctx.screen.write(`${styled(THEME.dim, "No messages in session.")}\n`); ctx.rl?.prompt?.(); return; }
    const userMsgs = msgs.filter(function(m: { role: string; internal?: boolean }) { return m.role === "user" && !m.internal; });
    const totalInput = ctx.session.inputTokens || 0;
    const totalOutput = ctx.session.outputTokens || 0;
    const files = ctx.session._modifiedFiles ? [...ctx.session._modifiedFiles] : [];

    ctx.screen.write(`${styled(THEME.heading, "Session Summary")}\n`);
    ctx.screen.write(`  Messages: ${msgs.length} (${userMsgs.length} user prompts)\n`);
    ctx.screen.write(`  Turns: ${ctx.session.turnCount}\n`);
    ctx.screen.write(`  Tokens: ${totalInput + totalOutput} (${totalInput} in / ${totalOutput} out)\n`);
    ctx.screen.write(`  Tool calls: ${ctx.session.toolCallCount}\n`);
    if (files.length) ctx.screen.write(`  Modified files: ${files.join(", ")}\n`);
    ctx.screen.write(`  Mode: ${ctx.session.permissionManager?.mode || "normal"}\n`);
    ctx.rl?.prompt?.();
  }, "Show session summary");

  // Rewind
  register("rewind", (args, ctx) => {
    const n = parseInt(args[0]) || 2;
    if (ctx.session.messages.length >= n * 2) {
      ctx.session.messages = ctx.session.messages.slice(0, -n * 2);
      ctx.screen.write(`${styled(THEME.success, `Rewound ${n} turns. ${ctx.session.messages.length} messages remain.`)}\n`);
    } else {
      ctx.screen.write(`${styled(THEME.warning, `Only ${Math.floor(ctx.session.messages.length/2)} turns available.`)}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Rewind N conversation turns");

  // MCP
  register("mcp", async (args, ctx) => {
    let manager = ctx.mcpManager;
    if (!manager) {
      try { manager = new McpClientManager(); manager.loadConfig(); ctx.mcpManager = manager; }
      catch (err) { ctx.screen.write(`${styled(THEME.error, `MCP not available: ${(err as Error).message}`)}\n`); ctx.rl?.prompt?.(); return; }
    }

    if (args[0] === "status" || !args[0]) {
      const status = manager.getStatus() as Record<string, { status: string; tools: number }>;
      if (!status || Object.keys(status).length === 0) { ctx.screen.write(`${styled(THEME.dim, "No MCP servers configured.")}\n`); }
      else {
        for (const [name, s] of Object.entries(status)) {
          const icon = s.status === "running" ? THEME.success + "\u25CF" : THEME.warning + "\u25CB";
          ctx.screen.write(`  ${icon} ${ANSI.reset} ${name.padEnd(16)} ${s.status}  (${s.tools} tools)\n`);
        }
      }
    } else if (args[0] === "start") {
      try { await manager.startAll(); ctx.screen.write(`${styled(THEME.success, "MCP servers started.")}\n`); }
      catch (err) { ctx.screen.write(`${styled(THEME.error, (err as Error).message)}\n`); }
    } else if (args[0] === "stop") {
      manager.stopAll(); ctx.screen.write(`${styled(THEME.info, "MCP servers stopped.")}\n`);
    } else if (args[0] === "tools") {
      const tools = await manager.discoverTools();
      ctx.screen.write(`${styled(THEME.info, `MCP tools (${tools.length}):`)}\n`);
      for (const t of tools) ctx.screen.write(`  ${t.name}\n`);
    } else {
      ctx.screen.write("Usage: /mcp [status|start|stop|tools]\n");
    }
    ctx.rl?.prompt?.();
  }, "Manage MCP servers");

  // Plugin
  register("plugin", (args, ctx) => {
    try {
      const registry = new PluginRegistry();
      if (args[0] === "list") {
        const plugins = registry.list();
        if (plugins.length === 0) { ctx.screen.write(`${styled(THEME.dim, "No plugins installed.")}\n`); }
        else for (const p of plugins) {
          const enabled = p.enabled !== false ? THEME.success + "enabled" : THEME.dim + "disabled";
          ctx.screen.write(`  ${p.name.padEnd(16)} v${p.version || "0.0.0"}  ${enabled}${ANSI.reset}\n`);
        }
      } else if (args[0] === "load" && args[1]) {
        registry.loadFromDir(args[1]); ctx.screen.write(`${styled(THEME.success, `Plugin loaded: ${args[1]}`)}\n`);
      } else {
        ctx.screen.write("Usage: /plugin [list|load <path>]\n");
      }
    } catch (err) { ctx.screen.write(`${styled(THEME.error, `Plugin error: ${(err as Error).message}`)}\n`); }
    ctx.rl?.prompt?.();
  }, "Manage plugins");

  // Agents
  register("agents", (args, ctx) => {
    if (args[0] === "stop") {
      ctx.screen.write(`${styled(THEME.warning, "Stopping sub-agents...")}\n`);
      ctx.session.hookExecutor?.run?.("subagent.stop", { session: ctx.session });
    } else {
      ctx.screen.write(`${styled(THEME.info, "Active agents:")}\n`);
      ctx.screen.write(`  main (this session) - ${ctx.session.turnCount} turns\n`);
    }
    ctx.rl?.prompt?.();
  }, "Manage sub-agents");

  // Dream / memory consolidation
  register("dream", async (args, ctx) => {
    const extractor = new MemoryExtractor();

    if (!extractor.shouldExtract(ctx.session.turnCount)) {
      ctx.screen.write(`${styled(THEME.dim, "Memory extraction not due yet.")}\n`);
      ctx.rl?.prompt?.(); return;
    }

    const msgs = ctx.session.messages.slice(-20);
    const prompt = extractor.buildExtractionPrompt(msgs);
    ctx.screen.write(`${styled(THEME.info, "Analyzing for durable memories...")}\n`);

    try {
      const provider = ctx.session.provider;
      if (!provider) throw new Error("No provider");
      let response = "";
      for await (const chunk of provider.stream({
        messages: [{ role: "user", content: prompt }],
        system: "You are a memory extraction system. Always output valid JSON.",
        maxTokens: 500,
      })) {
        if (chunk.type === "text") response += chunk.delta;
      }
      const entries = extractor.parseExtraction(response);
      extractor.recordExtraction();
      if (entries.length === 0) {
        ctx.screen.write(`${styled(THEME.dim, "No new durable memories found.")}\n`);
      } else {
        ctx.screen.write(`${styled(THEME.success, `Extracted ${entries.length} memories:`)}\n`);
        for (const e of entries) {
          ctx.screen.write(`  [${e.category}] ${e.content} (confidence: ${e.confidence}/5)\n`);
        }
      }
    } catch (err) {
      ctx.screen.write(`${styled(THEME.warning, `Extraction skipped: ${(err as Error).message}`)}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Extract durable memories from conversation");

  // Git diff
  register("diff", (args, ctx) => {
    try {
      const cwd = ctx.settings?.projectRoot || process.cwd();
      const output = execSync("git diff --stat", { cwd, encoding: "utf-8", timeout: 10000 }).trim();
      if (!output) { ctx.screen.write(`${styled(THEME.dim, "No changes in working tree.")}\n`); }
      else ctx.screen.write(output + "\n");
    } catch (err) { ctx.screen.write(`${styled(THEME.dim, "No git repository available.")}\n`); }
    ctx.rl?.prompt?.();
  }, "Show git working tree changes");

  // Git branch
  register("branch", (args, ctx) => {
    try {
      const cwd = ctx.settings?.projectRoot || process.cwd();
      const output = execSync("git branch", { cwd, encoding: "utf-8", timeout: 10000 });
      ctx.screen.write(output);
    } catch (err) {
      const msg = ((err as NodeJS.ErrnoException & { stderr?: string }).stderr || (err as Error).message || "").trim();
      ctx.screen.write(`${styled(THEME.error, msg || "git command failed")}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Show git branches");

  // Keybindings
  register("keybindings", (_, ctx) => {
    ctx.screen.write(`${styled(THEME.heading, "Keybindings:")}\n`);
    const bindings = [
      ["Ctrl+C", "Interrupt / abort current action"],
      ["Ctrl+D", "Exit session"],
      ["Ctrl+R", "Search command history"],
      ["Ctrl+L", "Clear screen"],
      ["Ctrl+U", "Delete line before cursor"],
      ["Up/Down", "Navigate command history"],
      ["Tab", "Auto-complete"],
      ["Enter", "Submit (Shift+Enter for multiline)"],
    ];
    for (const [key, desc] of bindings) {
      ctx.screen.write(`  ${styled(THEME.accent, key.padEnd(14))} ${THEME.dim}${desc}${ANSI.reset}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Show keyboard shortcuts");

  // Feedback
  register("feedback", (args, ctx) => {
    const msg = args.join(" ");
    const home = process.env.HOME || process.env.USERPROFILE || ".";
    const fp = path.join(home, ".haxagent", "feedback.log");
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(fp, `[${new Date().toISOString()}] ${msg || "<no message>"}\n`);
    ctx.screen.write(`${styled(THEME.success, "Feedback recorded. Thank you!")}\n`);
    ctx.rl?.prompt?.();
  }, "Submit feedback or bug report");

  // Files
  register("files", (_, ctx) => {
    const files = ctx.session._modifiedFiles ? [...ctx.session._modifiedFiles] : [];
    if (files.length === 0) {
      ctx.screen.write(`${styled(THEME.dim, "No files modified in this session.")}\n`);
    } else {
      ctx.screen.write(`${styled(THEME.info, `Modified files (${files.length}):`)}\n`);
      for (const f of files) ctx.screen.write(`  ${f}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Show files modified in this session");

  // Max turns
  register("turns", (args, ctx) => {
    const engine = ctx.engine;
    if (!engine) { ctx.screen.write(`${styled(THEME.dim, "Engine not available.")}\n`); ctx.rl?.prompt?.(); return; }
    if (args[0]) {
      const n = parseInt(args[0]);
      if (n > 0) { engine.maxToolTurns = n; ctx.screen.write(`${styled(THEME.success, `Max turns set to ${n}`)}\n`); }
      else ctx.screen.write(`${styled(THEME.warning, "Invalid number")}\n`);
    } else {
      ctx.screen.write(`${styled(THEME.info, `Max turns: ${engine.maxToolTurns}`)}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Show or set max agent turns");

  // Release notes
  register("release-notes", (_, ctx) => {
    const pkgPath = path.join(import.meta.dirname, "../../package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      ctx.screen.write(`${styled(THEME.heading, `HaxAgent v${pkg.version}`)}\n`);
      ctx.screen.write(`  ${pkg.description || "AI coding assistant"}\n`);
    } catch (_) { ctx.screen.write(`${styled(THEME.dim, "No release notes available.")}\n`); }
    ctx.rl?.prompt?.();
  }, "Show version and release info");

  // Reload plugins
  register("reload", (args, ctx) => {
    try {
      const registry = new PluginRegistry();
      registry.loadFromDir(path.join(ctx.settings?.projectRoot || process.cwd(), ".hax-agent", "plugins"));
      ctx.screen.write(`${styled(THEME.success, "Plugins reloaded.")}\n`);
    } catch (err) { ctx.screen.write(`${styled(THEME.error, `Reload failed: ${(err as Error).message}`)}\n`); }
    ctx.rl?.prompt?.();
  }, "Reload plugins");

  // Tag
  register("tag", (args, ctx) => {
    if (!args[0]) { ctx.screen.write("Usage: /tag <name>\n"); ctx.rl?.prompt?.(); return; }
    ctx.session._tags = ctx.session._tags || [];
    if (ctx.session._tags.includes(args[0])) {
      ctx.screen.write(`${styled(THEME.dim, `Already tagged: ${args[0]}`)}\n`);
    } else {
      ctx.session._tags.push(args[0]);
      ctx.screen.write(`${styled(THEME.success, `Tagged: ${args[0]}`)}\n`);
    }
    ctx.rl?.prompt?.();
  }, "Tag the current conversation");

  register("tags", (_, ctx) => {
    const tags = ctx.session._tags || [];
    ctx.screen.write(tags.length === 0
      ? `${styled(THEME.dim, "No tags on this session.")}\n`
      : `${styled(THEME.info, `Tags: ${tags.join(", ")}`)}\n`);
    ctx.rl?.prompt?.();
  }, "Show conversation tags");
};
