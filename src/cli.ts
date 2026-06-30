#!/usr/bin/env node

import fs from "fs";
import readline from "readline";
import { readFileSync } from "fs";
import { join } from "path";

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version;

import { ANSI, THEME, styled } from "./shared/utils.js";
import { loadSettings, reloadSettings, saveSettings } from "./config/settings.js";
import { ProfileManager, BUILTIN } from "./config/profiles.js";
import { createProvider, BaseOpenAICompatible, AnthropicProvider } from "./api/provider.js";
import { createDefaultRegistry } from "./tools/registry.js";
import { Session, AgentEngine, PermissionChecker, HookExecutor, PermissionMode } from "./engine/agent.js";
import type { SessionProvider, SessionOptions, Sandbox, PluginRegistry } from "./engine/agent.js";
import { loadSkillRegistry } from "./skills/registry.js";
import { ResponseRenderer, MarkdownRenderer } from "./renderer.js";
import { loadPluginRegistry } from "./plugins/registry.js";
import { shouldRunSetup, runSetup } from "./setup.js";
import { SandboxAdapter } from "./sandbox/adapter.js";
import { applyTheme } from "./shared/themes.js";
import * as commandsRegistryMod from "./commands/registry.js";
import { bootstrapMcp } from "./services/mcp-bootstrap.js";

// === Argument Parser ===

interface ParsedFlags {
  help?: boolean;
  version?: boolean;
  noColor?: boolean;
  sandbox?: boolean;
  /** --ink is now a no-op (ink is the default), kept for backward compat. */
  ink?: boolean;
  /** --legacy / --no-ink: fall back to classic readline interface. */
  legacy?: boolean;
  provider?: string;
  model?: string;
  profile?: string;
  permissionMode?: string;
  maxTurns?: string;
  batch?: string;
  input?: string;
  output?: string;
  apiKey?: string;
  _: string[];
  [key: string]: unknown;
}

function parseArgs(argv: string[]): ParsedFlags {
  const args = argv.slice(2);
  const flags: ParsedFlags = { _: [] };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--" ) { positional.push(...args.slice(i + 1)); break; }

    if (a === "--help" || a === "-h") { flags.help = true; continue; }
    if (a === "--version" || a === "-v") { flags.version = true; continue; }
    if (a === "--no-color") { flags.noColor = true; continue; }
    if (a === "--sandbox") { flags.sandbox = true; continue; }
    if (a === "--ink") { flags.ink = true; continue; }  // no-op: ink is now default
    if (a === "--legacy" || a === "--no-ink") { flags.legacy = true; continue; }

    // Value-taking flags
    const valFlags = [
      "--provider", "--model", "--profile", "--permission-mode",
      "--max-turns", "--batch", "--input", "--output", "--api-key",
    ];
    if (valFlags.includes(a)) {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error(`Error: ${a} requires a value`);
        process.exit(1);
      }
      const key = a.slice(2).replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      (flags as Record<string, unknown>)[key] = next;
      i++;
      continue;
    }

    // --key=value form
    if (a.startsWith("--") && a.includes("=")) {
      const [key, ...rest] = a.slice(2).split("=");
      const camelKey = key.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      (flags as Record<string, unknown>)[camelKey] = rest.join("=");
      continue;
    }

    // Short boolean flags
    if (a === "-y") { flags.permissionMode = "yolo"; continue; }

    positional.push(a);
  }

  flags._ = positional;
  return flags;
}

function printHelp() {
  const lines = [
    `hax-agent v${VERSION}`,
    "",
    "Usage: hax-agent [options] [prompt]",
    "",
    "Options:",
    "  -h, --help                Show this help message",
    "  -v, --version             Show version",
    "  --provider <name>         LLM provider (anthropic, openai, deepseek, groq,",
    "                            mistral, google, moonshot, zhipu, dashscope,",
    "                            openrouter, ollama, vllm)",
    "  --model <name>            Model identifier (e.g. claude-sonnet-4-6, gpt-4o)",
    "  --profile <name>          Use a builtin profile shortcut:",
    "                              claude, sonnet, haiku, opus",
    "                              gpt, gpt-pro, gpt-mini, o3",
    "                              deepseek, deepseek-pro",
    "                              groq, mistral, google, gemini, gemini-pro",
    "                              moonshot, zhipu, dashscope, openrouter",
    "                              ollama, local, vllm",
    "  --permission-mode <mode>  Permission mode: normal, yolo, plan, full_auto",
    "  -y                        Shorthand for --permission-mode yolo",
    "  --api-key <key>           API key (overrides env var and saved key)",
    "  --max-turns <n>           Maximum tool execution turns (default: 200)",
    "  --sandbox                 Enable Docker sandbox isolation for shell commands",
    "  --no-color                Disable ANSI colors",
    "  --legacy, --no-ink        Use classic readline interface instead of ink TUI",
    "  --ink                     (no-op, kept for compat — ink is now the default)",
    "",
    "Batch Mode:",
    "  --batch <prompt>          Run a single non-interactive turn and exit",
    "  --input <file>            Read prompt from file (use with --batch)",
    "  --output <file>           Write response to file (use with --batch)",
    "",
    "Interface:",
    "  Default: ink TUI (full-screen terminal UI with approval prompts and streaming).",
    "  Use --legacy or --no-ink to fall back to the classic readline interface.",
    "  Set HAXAGENT_LEGACY=1 to make readline the default in all shells.",
    "",
    "Examples:",
    "  hax-agent                                  Start interactive session (ink TUI)",
    "  hax-agent --legacy                         Start with classic readline interface",
    "  hax-agent --provider deepseek              Use DeepSeek provider",
    "  hax-agent --profile opus                   Use Claude Opus profile",
    "  hax-agent --batch \"explain this code\"      Single-turn batch mode",
    "  hax-agent --batch --input task.txt         Batch from file",
    "  hax-agent -y \"fix the bug in main.js\"     Auto-approve all tools",
  ];
  console.log(lines.join("\n"));
}

// === Batch Mode ===

async function runBatch(flags: ParsedFlags) {
  let prompt = flags.batch;
  if (flags.input) {
    if (!fs.existsSync(flags.input)) {
      console.error(`Error: input file not found: ${flags.input}`);
      process.exit(1);
    }
    prompt = fs.readFileSync(flags.input, "utf-8").trim();
  }
  if (!prompt) {
    console.error("Error: --batch requires a prompt string or --input <file>");
    process.exit(1);
  }

  // Setup if needed
  if (shouldRunSetup()) { await runSetup(); reloadSettings(); }

  const settings = loadSettings();
  const profiles = new ProfileManager();

  // CLI flag overrides
  let providerName = flags.provider || settings.agent?.provider;
  let modelName = flags.model || settings.agent?.model;
  let permMode = flags.permissionMode || settings.permissions?.mode || PermissionMode.DEFAULT;

  if (flags.profile) {
    if (profiles.use(flags.profile)) {
      const p = profiles.active;
      providerName = p.provider;
      modelName = p.model;
    } else {
      console.error(`Error: unknown profile "${flags.profile}"`);
      process.exit(1);
    }
  }

  const maxTurns = parseInt(flags.maxTurns as string, 10) || 200;
  const provider = createProvider({ provider: providerName, model: modelName });
  const pm = new PermissionChecker({ mode: permMode });
  const hooks = new HookExecutor();
  const toolRegistry = createDefaultRegistry(process.cwd());
  const skills = loadSkillRegistry();
  const session = new Session({ provider: provider as SessionProvider, toolRegistry, permissionManager: pm, hookExecutor: hooks });

  if (flags.apiKey) { provider.apiKey = flags.apiKey; }

  const engine = new AgentEngine({ session, projectRoot: process.cwd(), skillRegistry: skills, maxToolTurns: maxTurns });

  let output = "";
  try {
    for await (const event of engine.sendMessage(prompt)) {
      switch (event.type) {
        case "message.delta":
          process.stdout.write((event.delta as string) || "");
          output += (event.delta as string) || "";
          break;
        case "thinking":
          if (event.thinking) { process.stdout.write(ANSI.dim + (event.thinking as string) + ANSI.reset); }
          break;
        case "tool.start":
          process.stderr.write(ANSI.dim + `[tool: ${event.name}]` + ANSI.reset + "\n");
          break;
        case "tool.result":
          break;
        case "turn.failed":
          console.error(`\nError: ${(event as { error?: { message?: string } }).error?.message || "unknown"}`);
          break;
      }
    }
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
  }

  if (flags.output) {
    fs.writeFileSync(flags.output, output, "utf-8");
    process.stderr.write(`\nOutput written to ${flags.output}\n`);
  }

  const cost = "$0"; // engine Session tracks tokens but not cost; use turnCount/toolCallCount directly
  process.stderr.write(`\n${session.turnCount} turns / ${session.toolCallCount} tools / ${cost}\n`);
  process.exit(0);
}

// === Interactive Mode ===

async function runInteractive(flags: ParsedFlags) {
  // First-run setup wizard — reload after setup saves to disk
  if (shouldRunSetup()) { await runSetup(); reloadSettings(); }

  const settings = loadSettings();
  const profiles = new ProfileManager();

  // CLI flag overrides
  let providerName: string | undefined = flags.provider || settings.agent?.provider;
  let modelName: string | undefined = flags.model || settings.agent?.model;
  const permMode: string = flags.permissionMode || settings.permissions?.mode || PermissionMode.DEFAULT;

  if (flags.profile) {
    if (profiles.use(flags.profile)) {
      const p = profiles.active;
      providerName = p.provider;
      modelName = p.model;
    } else {
      console.error(`Error: unknown profile "${flags.profile}"`);
      process.exit(1);
    }
  } else {
    // Use saved profile from settings
    const savedProfile = settings.agent?._activeProfile || providerName;
    if (savedProfile && profiles.use(savedProfile)) { /* profile active */ }
    const profileCfg = profiles.active;
    providerName = providerName || profileCfg.provider;
    modelName = modelName || profileCfg.model;
  }

  let provider: BaseOpenAICompatible | AnthropicProvider = createProvider({ provider: providerName, model: modelName });
  if (flags.apiKey) { provider.apiKey = flags.apiKey; }

  const pm = new PermissionChecker({ mode: permMode });
  const hooks = new HookExecutor();
  const toolRegistry = createDefaultRegistry(process.cwd());
  const skills = loadSkillRegistry();

  // Bootstrap MCP: load config, start servers, register tools into toolRegistry.
  // Failures are caught inside bootstrapMcp — CLI always continues.
  const mcpManager = await bootstrapMcp(toolRegistry);

  // Wire plugin system
  const pluginRegistry = loadPluginRegistry(process.cwd());
  const pluginHooks = (pluginRegistry.getAllHooks() as Array<{ event?: string; matcher?: string; priority?: number }>);
  for (const h of pluginHooks) {
    hooks.register(h.event || "pre.tool_use", async () => {}, { matcher: h.matcher, priority: h.priority || 0 });
  }

  // Sandbox setup
  let sandbox: SandboxAdapter | null = null;
  const explicitSandbox = !!flags.sandbox;
  const sandboxSettings = settings.sandbox as { enabled?: boolean; backend?: string; image?: string; network?: string; cpus?: number; memory?: string } | undefined;
  const sandboxEnabled = explicitSandbox || !!sandboxSettings?.enabled;
  if (sandboxEnabled) {
    sandbox = new SandboxAdapter({
      backend: sandboxSettings?.backend || "docker",
      image: sandboxSettings?.image || "node:18-alpine",
      network: sandboxSettings?.network || "none",
      cpus: sandboxSettings?.cpus || 2,
      memory: sandboxSettings?.memory || "512m",
      hostDir: process.cwd(),
    });
    try {
      await sandbox.start();
      if (sandbox.isRunning) process.stdout.write(styled(THEME.success, "Sandbox: docker (running)") + "\n");
    } catch (err) {
      if (explicitSandbox) process.stdout.write(styled(THEME.warning, "Sandbox unavailable: " + (err as Error).message) + "\n");
      sandbox = null;
    }
  }

  const session = new Session({ provider: provider as SessionProvider, toolRegistry, permissionManager: pm, hookExecutor: hooks, pluginRegistry: pluginRegistry as PluginRegistry, sandbox: sandbox as Sandbox | null, mcpManager });

  // Approval callback — uses readline.question for non-YOLO confirmations
  const approvalCallback = function(toolName: string, toolInput: Record<string, unknown>) {
    const detail = JSON.stringify(toolInput || {}).slice(0, 80);
    return new Promise<string>(function(resolve) {
      rl.question("\n" + styled(THEME.warning, "  ? Approve ") + styled(THEME.accent, toolName) + " " + THEME.dim + detail + ANSI.reset + " [Y/n/a]? ", function(a) {
        a = a.trim().toLowerCase();
        if (a === "n" || a === "no") resolve("deny");
        else if (a === "a" || a === "always") resolve("always");
        else resolve("approve");
      });
    });
  };

  const maxTurns = parseInt(flags.maxTurns as string, 10) || undefined;
  const engine = new AgentEngine({ session, projectRoot: process.cwd(), skillRegistry: skills, approvalCallback: approvalCallback, maxToolTurns: maxTurns });

  // Restore saved settings: permission mode, thinking, theme
  if (settings.permissions?.allowedTools) { for (const allowedTool of settings.permissions.allowedTools) pm.allowTool(allowedTool); }
  if (settings.permissions?.deniedTools) { for (const deniedTool of settings.permissions.deniedTools) pm.denyTool(deniedTool); }
  if (settings.agent?.thinking) { session._thinking = true; session._thinkIntensity = settings.agent.thinkIntensity || null; }
  if (settings.ui?.theme) { try { applyTheme(settings.ui.theme, THEME); } catch (_) {} }

  const isTTY = process.stdout.isTTY;

  // Load commands
  const commands = commandsRegistryMod;

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: isTTY,
    completer: function (line: string): readline.CompleterResult {
      const hits: string[] = [];
      if (line.startsWith("/")) {
        const partial = line.slice(1).toLowerCase();
        const cmdNames = Object.keys(commands.commands || {});
        try { for (const s of skills.list()) { cmdNames.push(s.name); } } catch (_) {}
        return [cmdNames.filter(function (c: string) { return c.startsWith(partial); }).map(function (c: string) { return "/" + c; }), line];
      }
      return [hits.length ? hits : [], line];
    }
  });

  // Old proven renderer
  const screen = { isTTY: function() { return isTTY; }, columns: process.stdout.columns || 80, write: function(t: string) { process.stdout.write(t); }, clear: function() { process.stdout.write(ANSI.clearScreen); } };
  const renderer = new ResponseRenderer(screen, new MarkdownRenderer(screen.columns));
  const markdown = new MarkdownRenderer(screen.columns);

  function refreshPrompt() {
    const model = (session.provider && session.provider.model) || "?";
    const mode = (pm && pm.mode) || "normal";
    const tokens = (session.inputTokens || 0) + (session.outputTokens || 0);
    rl.setPrompt(THEME.dim + model + " | " + mode + " | " + tokens.toLocaleString() + "t" + ANSI.reset + " > ");
  }

  // Banner
  function banner() {
    return "\n" + styled(THEME.heading, "Hax Agent v" + VERSION) + "\n" +
      styled(THEME.dim, provider.name + " / " + provider.model + " | /help for commands | /exit to quit") + "\n\n";
  }
  // Restore saved profile from last session
  function getSavedProfile() {
    try { const s = loadSettings(); return s?.agent?._activeProfile || null; } catch (_) { return null; }
  }
  function saveActiveProfile() {
    try {
      const s = loadSettings();
      if (!s.agent) s.agent = {};
      s.agent._activeProfile = profiles.activeName;
      s.agent.provider = profiles.active.provider;
      s.agent.model = profiles.active.model;
      saveSettings(s);
    } catch (_) {}
  }
  const saved = getSavedProfile();
  if (saved && profiles.use(saved)) {
    provider = createProvider({ ...profiles.active });
    session.provider = provider as SessionProvider;
  }

  process.stdout.write(banner());
  refreshPrompt();

  rl.on("line", async function (line: string) {
    const trimmed = line.trim();

    if (!trimmed) { refreshPrompt(); rl.prompt(); return; }

    // Slash commands
    if (trimmed.startsWith("/")) {
      if (trimmed === "/clear" || trimmed === "/c") {
        session.messages = [];
        session.isStreaming = false;
        process.stdout.write(ANSI.clearScreen);
        process.stdout.write(banner());
        refreshPrompt(); rl.prompt(); return;
      }
      // Extract command name
      const cmdName = trimmed.slice(1).trim().split(/\s+/)[0].toLowerCase();
      // Check if it's a known command
      if (commands.commands[cmdName]) {
        await commands.execute(trimmed, { screen: { write: function(t: string) { process.stdout.write(t); } }, session: session as Parameters<typeof commands.execute>[1]["session"], rl: rl, settings: settings, mcpManager });
      } else {
        // Check if it's a skill
        const skill = skills.get(cmdName);
        if (skill) {
          process.stdout.write("\n" + styled(THEME.heading, "Skill: " + skill.name) + "\n" + styled(THEME.dim, skill.description || "") + "\n\n");
          // Preserve any text the user typed after the skill name, e.g.
          // "/frontend-design build a login page" → userArgs = "build a login page".
          const userArgs = trimmed.replace(/^\/\S+\s*/, "").trim();
          const skillPrompt = "Execute skill \"" + skill.name + "\".\n\n" + skill.content
            + (userArgs ? "\n\n---\nUser request:\n" + userArgs : "");
          try {
            for await (const event of engine.sendMessage(skillPrompt)) {
              switch (event.type) {
                case "turn.started": renderer.startWaiting(); break;
                case "message.delta": renderer.writeText((event as { delta?: string }).delta || ""); break;
                case "thinking": renderer.thinking(event as Parameters<typeof renderer.thinking>[0]); break;
                case "tool.start": renderer.startTool(event as Parameters<typeof renderer.startTool>[0]); break;
                case "tool.result": renderer.finishTool(event as Parameters<typeof renderer.finishTool>[0]); break;
                case "tool.limit": renderer.notice("Tool limit reached"); break;
                case "turn.completed": renderer.complete((event as { usage?: { outputTokens?: number; inputTokens?: number } }).usage); break;
                case "turn.interrupted": renderer.interrupt(); break;
                case "turn.failed": renderer.fail((event as { error?: { message?: string } }).error?.message || ""); break;
              }
            }
          } catch (err) { process.stdout.write(styled(THEME.error, "Error: " + (err as Error).message) + "\n"); }
        } else {
          await commands.execute(trimmed, { screen: { write: function(t: string) { process.stdout.write(t); } }, session: session as Parameters<typeof commands.execute>[1]["session"], rl: rl, settings: settings, mcpManager });
        }
      }
      refreshPrompt();
      return;
    }

    if (session.isStreaming) { refreshPrompt(); rl.prompt(); return; }

    // Replace readline prompt line with styled "You" prefix
    // \x1b[1A = cursor up, \x1b[2K = clear line
    process.stdout.write("\x1b[1A\x1b[2K" + styled(THEME.accent, "You") + "  " + trimmed + "\n");

    try {
      for await (const event of engine.sendMessage(trimmed)) {
        switch (event.type) {
          case "turn.started": renderer.startWaiting(); break;
          case "message.delta": renderer.writeText((event as { delta?: string }).delta || ""); break;
          case "thinking": renderer.thinking(event as Parameters<typeof renderer.thinking>[0]); break;
          case "tool.start": renderer.startTool(event as Parameters<typeof renderer.startTool>[0]); break;
          case "tool.result": renderer.finishTool(event as Parameters<typeof renderer.finishTool>[0]); break;
          case "tool.limit": renderer.notice("Tool limit reached"); break;
          case "turn.completed": renderer.complete((event as { usage?: { outputTokens?: number; inputTokens?: number } }).usage); break;
          case "turn.interrupted": renderer.interrupt(); break;
          case "turn.failed": renderer.fail((event as { error?: { message?: string } }).error?.message || ""); break;
        }
      }
    } catch (err) {
      process.stdout.write(styled(THEME.error, "Error: " + (err as Error).message) + "\n");
    }
    refreshPrompt();
    rl.prompt();
  });

  // Ctrl+L = clear screen, Shift+Tab = cycle permission mode
  if (isTTY) {
    process.stdin.on("keypress", function (str: unknown, key: { shift?: boolean; ctrl?: boolean; name?: string }) {
      if (key && key.shift && key.name === "tab") {
        const modes = ["normal", "yolo", "plan", "full_auto"];
        const idx = modes.indexOf(pm.mode);
        pm.mode = modes[(idx + 1) % modes.length];
        try { const s = loadSettings(); if (!s.permissions) s.permissions = {}; s.permissions.mode = pm.mode; saveSettings(s); } catch (_) {}
        process.stdout.write("\r" + ANSI.clearLine + styled(THEME.warning, "[" + pm.mode.toUpperCase() + "]") + " ");
        refreshPrompt();
      }
      if (key && key.ctrl && key.name === "l") {
        process.stdout.write(ANSI.clearScreen);
        process.stdout.write(banner());
        refreshPrompt();
        rl.prompt();
      }
    });
  }

  rl.on("close", function () {
    if (sandbox) { try { sandbox.stop(); } catch (_) {} }
    try { mcpManager.stopAll(); } catch (_) {}
    const costTracker = (session as unknown as { costTracker?: { getCost(m: string): number } }).costTracker;
    const cost = costTracker ? "$" + costTracker.getCost(session.provider?.model ?? "").toFixed(4) : "$0";
    process.stdout.write("\n" + ANSI.dim + "Session: " + session.turnCount + " turns / " + session.toolCallCount + " tools / " + cost + " / " + (session.inputTokens + session.outputTokens).toLocaleString() + " tokens" + ANSI.reset + "\n");
    process.exit(0);
  });

  let _sigintCount = 0;
  rl.on("SIGINT", function () {
    _sigintCount++;
    if (session.isStreaming) {
      engine.interrupt();
      _sigintCount = 0;
    } else if (_sigintCount >= 2) {
      rl.close();
    } else {
      process.stdout.write("\n" + ANSI.dim + "Press Ctrl+C again to exit, or type /exit" + ANSI.reset + "\n");
      setTimeout(function () { _sigintCount = 0; }, 1000);
      refreshPrompt();
      rl.prompt();
    }
  });

  // Auto-execute prompt from positional arg (e.g. hax-agent "fix the bug")
  if (flags._.length > 0) {
    const autoPrompt = flags._.join(" ");
    process.stdout.write("\x1b[1A\x1b[2K" + styled(THEME.accent, "You") + "  " + autoPrompt + "\n");
    try {
      for await (const event of engine.sendMessage(autoPrompt)) {
        switch (event.type) {
          case "turn.started": renderer.startWaiting(); break;
          case "message.delta": renderer.writeText((event as { delta?: string }).delta || ""); break;
          case "thinking": renderer.thinking(event as Parameters<typeof renderer.thinking>[0]); break;
          case "tool.start": renderer.startTool(event as Parameters<typeof renderer.startTool>[0]); break;
          case "tool.result": renderer.finishTool(event as Parameters<typeof renderer.finishTool>[0]); break;
          case "tool.limit": renderer.notice("Tool limit reached"); break;
          case "turn.completed": renderer.complete((event as { usage?: { outputTokens?: number; inputTokens?: number } }).usage); break;
          case "turn.interrupted": renderer.interrupt(); break;
          case "turn.failed": renderer.fail((event as { error?: { message?: string } }).error?.message || ""); break;
        }
      }
    } catch (err) {
      process.stdout.write(styled(THEME.error, "Error: " + (err as Error).message) + "\n");
    }
    refreshPrompt();
  }

  rl.prompt();
}

// === Main ===

function main(argv?: string[]) {
  if (!argv) argv = process.argv;
  const flags = parseArgs(argv);

  if (flags.version) { console.log("hax-agent v" + VERSION); return; }
  if (flags.help) { printHelp(); return; }

  if (flags.batch) {
    runBatch(flags).catch(function (err) { console.error((err as Error).message); process.exit(1); });
  } else if (flags.legacy || process.env["HAXAGENT_LEGACY"] === "1") {
    // --legacy / --no-ink / HAXAGENT_LEGACY=1 → classic readline interface
    runInteractive(flags).catch(function (err) { console.error((err as Error).message); process.exit(1); });
  } else {
    // Default: ink TUI. Lazy import so the readline path pays no cost for ink's React deps.
    import("./tui-ink/run.js").then(function (mod) {
      return mod.runInteractiveInk(flags);
    }).catch(function (err) { console.error((err as Error).message); process.exit(1); });
  }
}

// ESM equivalent of `if (require.main === module)`
const isMain = process.argv[1] &&
  (process.argv[1].replace(/\\/g, "/").endsWith("src/cli.js") ||
   import.meta.url === new URL("file://" + process.argv[1].replace(/\\/g, "/")).href);
if (isMain) main();

export { main, parseArgs };
