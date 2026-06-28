#!/usr/bin/env node
"use strict";

const fs = require("fs");
const readline = require("readline");
const VERSION = require("../package.json").version;

const { ANSI, THEME, styled } = require("./shared/utils");
const { loadSettings, reloadSettings } = require("./config/settings");
const { ProfileManager, BUILTIN } = require("./config/profiles");
const { createProvider } = require("./api/provider");
const { createDefaultRegistry } = require("./tools/registry");
const { Session, AgentEngine, PermissionChecker, HookExecutor, PermissionMode } = require("./engine/agent");
const { loadSkillRegistry } = require("./skills/registry");
const { ResponseRenderer, MarkdownRenderer } = require("./renderer");
const { loadPluginRegistry } = require("./plugins/registry");

// === Argument Parser ===

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--" ) { positional.push(...args.slice(i + 1)); break; }

    if (a === "--help" || a === "-h") { flags.help = true; continue; }
    if (a === "--version" || a === "-v") { flags.version = true; continue; }
    if (a === "--no-color") { flags.noColor = true; continue; }
    if (a === "--sandbox") { flags.sandbox = true; continue; }

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
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      flags[key] = next;
      i++;
      continue;
    }

    // --key=value form
    if (a.startsWith("--") && a.includes("=")) {
      const [key, ...rest] = a.slice(2).split("=");
      const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      flags[camelKey] = rest.join("=");
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
    "",
    "Batch Mode:",
    "  --batch <prompt>          Run a single non-interactive turn and exit",
    "  --input <file>            Read prompt from file (use with --batch)",
    "  --output <file>           Write response to file (use with --batch)",
    "",
    "Examples:",
    "  hax-agent                                  Start interactive session",
    "  hax-agent --provider deepseek              Use DeepSeek provider",
    "  hax-agent --profile opus                   Use Claude Opus profile",
    "  hax-agent --batch \"explain this code\"      Single-turn batch mode",
    "  hax-agent --batch --input task.txt         Batch from file",
    "  hax-agent -y \"fix the bug in main.js\"     Auto-approve all tools",
  ];
  console.log(lines.join("\n"));
}

// === Batch Mode ===

async function runBatch(flags) {
  const { shouldRunSetup, runSetup } = require("./setup");

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

  const maxTurns = parseInt(flags.maxTurns, 10) || 200;
  const provider = createProvider({ provider: providerName, model: modelName });
  const pm = new PermissionChecker({ mode: permMode });
  const hooks = new HookExecutor();
  const toolRegistry = createDefaultRegistry(process.cwd());
  const skills = loadSkillRegistry();
  const session = new Session({ provider, toolRegistry, permissionManager: pm, hookExecutor: hooks });

  if (flags.apiKey) { provider.apiKey = flags.apiKey; }

  const engine = new AgentEngine({ session, projectRoot: process.cwd(), skillRegistry: skills, maxToolTurns: maxTurns });

  let output = "";
  try {
    for await (const event of engine.sendMessage(prompt)) {
      switch (event.type) {
        case "message.delta":
          process.stdout.write(event.delta || "");
          output += event.delta || "";
          break;
        case "thinking":
          if (event.thinking) { process.stdout.write(ANSI.dim + event.thinking + ANSI.reset); }
          break;
        case "tool.start":
          process.stderr.write(ANSI.dim + `[tool: ${event.name}]` + ANSI.reset + "\n");
          break;
        case "tool.result":
          break;
        case "turn.failed":
          console.error(`\nError: ${event.error?.message || "unknown"}`);
          break;
      }
    }
  } catch (err) {
    console.error(`\nError: ${err.message}`);
  }

  if (flags.output) {
    fs.writeFileSync(flags.output, output, "utf-8");
    process.stderr.write(`\nOutput written to ${flags.output}\n`);
  }

  const cost = session.costTracker ? "$" + session.costTracker.getCost(provider.model).toFixed(4) : "$0";
  process.stderr.write(`\n${session.turnCount} turns / ${session.toolCallCount} tools / ${cost}\n`);
  process.exit(0);
}

// === Interactive Mode ===

async function runInteractive(flags) {
  // First-run setup wizard — reload after setup saves to disk
  var { shouldRunSetup, runSetup } = require("./setup");
  if (shouldRunSetup()) { await runSetup(); reloadSettings(); }

  var settings = loadSettings();
  var profiles = new ProfileManager();

  // CLI flag overrides
  var providerName = flags.provider || settings.agent?.provider;
  var modelName = flags.model || settings.agent?.model;
  var permMode = flags.permissionMode || settings.permissions?.mode || PermissionMode.DEFAULT;

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
    var savedProfile = settings.agent?._activeProfile || providerName;
    if (savedProfile && profiles.use(savedProfile)) { /* profile active */ }
    var profileCfg = profiles.active;
    providerName = providerName || profileCfg.provider;
    modelName = modelName || profileCfg.model;
  }

  var provider = createProvider({ provider: providerName, model: modelName });
  if (flags.apiKey) { provider.apiKey = flags.apiKey; }

  var pm = new PermissionChecker({ mode: permMode });
  var hooks = new HookExecutor();
  var toolRegistry = createDefaultRegistry(process.cwd());
  var skills = loadSkillRegistry();

  // Wire plugin system
  var pluginRegistry = loadPluginRegistry(process.cwd());
  var pluginHooks = pluginRegistry.getAllHooks();
  for (const h of pluginHooks) {
    hooks.register(h.event || "pre.tool_use", async () => {}, { matcher: h.matcher, priority: h.priority || 0 });
  }

  // Sandbox setup
  var sandbox = null;
  var explicitSandbox = !!flags.sandbox;
  var sandboxEnabled = explicitSandbox || settings.sandbox?.enabled;
  if (sandboxEnabled) {
    var { SandboxAdapter } = require("./sandbox/adapter");
    sandbox = new SandboxAdapter({
      backend: settings.sandbox?.backend || "docker",
      image: settings.sandbox?.image || "node:18-alpine",
      network: settings.sandbox?.network || "none",
      cpus: settings.sandbox?.cpus || 2,
      memory: settings.sandbox?.memory || "512m",
      hostDir: process.cwd(),
    });
    try {
      await sandbox.start();
      if (sandbox.isRunning) process.stdout.write(styled(THEME.success, "Sandbox: docker (running)") + "\n");
    } catch (err) {
      if (explicitSandbox) process.stdout.write(styled(THEME.warning, "Sandbox unavailable: " + err.message) + "\n");
      sandbox = null;
    }
  }

  var session = new Session({ provider, toolRegistry, permissionManager: pm, hookExecutor: hooks, pluginRegistry: pluginRegistry, sandbox: sandbox });

  // Approval callback — uses readline.question for non-YOLO confirmations
  var approvalCallback = function(toolName, toolInput) {
    var detail = JSON.stringify(toolInput || {}).slice(0, 80);
    return new Promise(function(resolve) {
      rl.question("\n" + styled(THEME.warning, "  ? Approve ") + styled(THEME.accent, toolName) + " " + THEME.dim + detail + ANSI.reset + " [Y/n/a]? ", function(a) {
        a = a.trim().toLowerCase();
        if (a === "n" || a === "no") resolve("deny");
        else if (a === "a" || a === "always") resolve("always");
        else resolve("approve");
      });
    });
  };

  var maxTurns = parseInt(flags.maxTurns, 10) || undefined;
  var engine = new AgentEngine({ session, projectRoot: process.cwd(), skillRegistry: skills, approvalCallback: approvalCallback, maxToolTurns: maxTurns });

  // Restore saved settings: permission mode, thinking, theme
  if (settings.permissions?.allowedTools) { for (var t of settings.permissions.allowedTools) pm.allowTool(t); }
  if (settings.permissions?.deniedTools) { for (var t of settings.permissions.deniedTools) pm.denyTool(t); }
  if (settings.agent?.thinking) { session._thinking = true; session._thinkIntensity = settings.agent.thinkIntensity || null; }
  if (settings.ui?.theme) { try { require("./shared/themes").applyTheme(settings.ui.theme, THEME); } catch (_) {} }

  var isTTY = process.stdout.isTTY;
  var rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: isTTY,
    completer: function (line) {
      var hits = [];
      if (line.startsWith("/")) {
        var partial = line.slice(1).toLowerCase();
        var cmdNames = Object.keys(commands.commands || {});
        try { for (var s of skills.list()) { cmdNames.push(s.name); } } catch (_) {}
        hits = cmdNames.filter(function (c) { return c.startsWith(partial); }).map(function (c) { return "/" + c; });
      }
      return [hits.length ? hits : [], line];
    }
  });

  // Old proven renderer
  var screen = { isTTY: function() { return isTTY; }, columns: process.stdout.columns || 80, write: function(t) { process.stdout.write(t); }, clear: function() { process.stdout.write(ANSI.clearScreen); } };
  var renderer = new ResponseRenderer(screen, new MarkdownRenderer(screen.columns));
  var markdown = new MarkdownRenderer(screen.columns);

  function refreshPrompt() {
    var model = (session.provider && session.provider.model) || "?";
    var mode = (pm && pm.mode) || "normal";
    var tokens = (session.inputTokens || 0) + (session.outputTokens || 0);
    rl.setPrompt(THEME.dim + model + " | " + mode + " | " + tokens.toLocaleString() + "t" + ANSI.reset + " > ");
  }

  // Banner
  function banner() {
    return "\n" + styled(THEME.heading, "Hax Agent v" + VERSION) + "\n" +
      styled(THEME.dim, provider.name + " / " + provider.model + " | /help for commands | /exit to quit") + "\n\n";
  }
  // Restore saved profile from last session
  function getSavedProfile() {
    try { const s = loadSettings(); return s.agent?._activeProfile || null; } catch (_) { return null; }
  }
  function saveActiveProfile() {
    try {
      const s = loadSettings();
      if (!s.agent) s.agent = {};
      s.agent._activeProfile = pm.activeName;
      s.agent.provider = pm.active.provider;
      s.agent.model = pm.active.model;
      require("./config/settings").saveSettings(s);
    } catch (_) {}
  }
  var saved = getSavedProfile();
  if (saved && profiles.use(saved)) {
    provider = createProvider({ ...profiles.active });
    session.provider = provider;
  }

  process.stdout.write(banner());
  refreshPrompt();

  // Load commands and screen adapter
  var commands = require("./commands/registry");

  rl.on("line", async function (line) {
    var trimmed = line.trim();

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
      var cmdName = trimmed.slice(1).trim().split(/\s+/)[0].toLowerCase();
      // Check if it's a known command
      if (commands.commands[cmdName]) {
        await commands.execute(trimmed, { screen: { write: function(t) { process.stdout.write(t); } }, session: session, rl: rl, settings: settings });
      } else {
        // Check if it's a skill
        var skill = skills.get(cmdName);
        if (skill) {
          process.stdout.write("\n" + styled(THEME.heading, "Skill: " + skill.name) + "\n" + styled(THEME.dim, skill.description || "") + "\n\n");
          var skillPrompt = "Execute skill \"" + skill.name + "\".\n\n" + skill.content;
          try {
            for await (var event of engine.sendMessage(skillPrompt)) {
              switch (event.type) {
                case "turn.started": renderer.startWaiting?.(); break;
                case "message.delta": renderer.writeText?.(event.delta); break;
                case "thinking": renderer.thinking?.(event); break;
                case "tool.start": renderer.startTool?.(event); break;
                case "tool.result": renderer.finishTool?.(event); break;
                case "tool.limit": renderer.notice?.("Tool limit reached"); break;
                case "turn.completed": renderer.complete?.(event.usage); break;
                case "turn.interrupted": renderer.interrupt?.(); break;
                case "turn.failed": renderer.fail?.(event.error?.message); break;
              }
            }
          } catch (err) { process.stdout.write(styled(THEME.error, "Error: " + err.message) + "\n"); }
        } else {
          await commands.execute(trimmed, { screen: { write: function(t) { process.stdout.write(t); } }, session: session, rl: rl, settings: settings });
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
      for await (var event of engine.sendMessage(trimmed)) {
        switch (event.type) {
          case "turn.started": renderer.startWaiting?.(); break;
          case "message.delta": renderer.writeText?.(event.delta); break;
          case "thinking": renderer.thinking?.(event); break;
          case "tool.start": renderer.startTool?.(event); break;
          case "tool.result": renderer.finishTool?.(event); break;
          case "tool.limit": renderer.notice?.("Tool limit reached"); break;
          case "turn.completed": renderer.complete?.(event.usage); break;
          case "turn.interrupted": renderer.interrupt?.(); break;
          case "turn.failed": renderer.fail?.(event.error?.message); break;
        }
      }
    } catch (err) {
      process.stdout.write(styled(THEME.error, "Error: " + err.message) + "\n");
    }
    refreshPrompt();
    rl.prompt();
  });

  // Ctrl+L = clear screen, Shift+Tab = cycle permission mode
  if (isTTY) {
    process.stdin.on("keypress", function (str, key) {
      if (key && key.shift && key.name === "tab") {
        var modes = ["normal", "yolo", "plan", "full_auto"];
        var idx = modes.indexOf(pm.mode);
        pm.mode = modes[(idx + 1) % modes.length];
        try { var s = require("./config/settings").loadSettings(); if (!s.permissions) s.permissions = {}; s.permissions.mode = pm.mode; require("./config/settings").saveSettings(s); } catch (_) {}
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
    var cost = session.costTracker ? "$" + session.costTracker.getCost(session.provider?.model).toFixed(4) : "$0";
    process.stdout.write("\n" + ANSI.dim + "Session: " + session.turnCount + " turns / " + session.toolCallCount + " tools / " + cost + " / " + (session.inputTokens + session.outputTokens).toLocaleString() + " tokens" + ANSI.reset + "\n");
    process.exit(0);
  });

  var _sigintCount = 0;
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
    var autoPrompt = flags._.join(" ");
    process.stdout.write("\x1b[1A\x1b[2K" + styled(THEME.accent, "You") + "  " + autoPrompt + "\n");
    try {
      for await (var event of engine.sendMessage(autoPrompt)) {
        switch (event.type) {
          case "turn.started": renderer.startWaiting?.(); break;
          case "message.delta": renderer.writeText?.(event.delta); break;
          case "thinking": renderer.thinking?.(event); break;
          case "tool.start": renderer.startTool?.(event); break;
          case "tool.result": renderer.finishTool?.(event); break;
          case "tool.limit": renderer.notice?.("Tool limit reached"); break;
          case "turn.completed": renderer.complete?.(event.usage); break;
          case "turn.interrupted": renderer.interrupt?.(); break;
          case "turn.failed": renderer.fail?.(event.error?.message); break;
        }
      }
    } catch (err) {
      process.stdout.write(styled(THEME.error, "Error: " + err.message) + "\n");
    }
    refreshPrompt();
  }

  rl.prompt();
}

// === Main ===

function main(argv) {
  if (!argv) argv = process.argv;
  const flags = parseArgs(argv);

  if (flags.version) { console.log("hax-agent v" + VERSION); return; }
  if (flags.help) { printHelp(); return; }

  if (flags.batch) {
    runBatch(flags).catch(function (err) { console.error(err.message); process.exit(1); });
  } else {
    runInteractive(flags).catch(function (err) { console.error(err.message); process.exit(1); });
  }
}

if (require.main === module) main();
module.exports = { main, parseArgs };
