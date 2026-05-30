#!/usr/bin/env node
"use strict";

const readline = require("readline");
const VERSION = require("../package.json").version;

const { ANSI, THEME, styled } = require("./shared/utils");
const { loadSettings } = require("./config/settings");
const { ProfileManager } = require("./config/profiles");
const { createProvider } = require("./api/provider");
const { createDefaultRegistry } = require("./tools/registry");
const { Session, AgentEngine, PermissionChecker, HookExecutor, PermissionMode } = require("./engine/agent");
const { loadSkillRegistry } = require("./skills/registry");
const { ResponseRenderer, MarkdownRenderer } = require("./renderer");

function main(argv) {
  if (!argv) argv = process.argv;
  var args = argv.slice(2);
  if (args.includes("-v") || args.includes("--version")) { console.log("hax-agent v" + VERSION); return; }
  if (args.includes("-h") || args.includes("help")) { console.log("hax-agent v" + VERSION + "\nUsage: hax-agent  Start interactive session"); return; }
  runInteractive(args).catch(function (err) { console.error(err.message); process.exit(1); });
}

async function runInteractive(args) {
  var noColor = args && args.includes("--no-color");

  // First-run setup wizard — reload after setup saves to disk
  var { shouldRunSetup, runSetup } = require("./setup");
  if (shouldRunSetup()) { await runSetup(); require("./config/settings").reloadSettings(); }

  var settings = loadSettings();
  var profiles = new ProfileManager();
  // Use saved profile from settings, falling back to builtin
  var savedProfile = settings.agent?._activeProfile || settings.agent?.provider || null;
  if (savedProfile && profiles.use(savedProfile)) { /* profile already active */ }
  var profileCfg = profiles.active;
  var provider = createProvider({ provider: profileCfg.provider, model: profileCfg.model, apiUrl: profileCfg.apiUrl });
  var pm = new PermissionChecker({ mode: settings.permissions?.mode || PermissionMode.DEFAULT });
  var hooks = new HookExecutor();
  var toolRegistry = createDefaultRegistry(process.cwd());
  var skills = loadSkillRegistry();
  var session = new Session({ provider, toolRegistry, permissionManager: pm, hookExecutor: hooks });
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
  var engine = new AgentEngine({ session, projectRoot: process.cwd(), skillRegistry: skills, approvalCallback: approvalCallback });

  // Restore saved settings: permission mode, thinking, theme
  if (settings.permissions?.mode) pm.mode = settings.permissions.mode;
  if (settings.permissions?.allowedTools) { for (var t of settings.permissions.allowedTools) pm.allowTool(t); }
  if (settings.permissions?.deniedTools) { for (var t of settings.permissions.deniedTools) pm.denyTool(t); }
  if (settings.agent?.thinking) { session._thinking = true; session._thinkIntensity = settings.agent.thinkIntensity || null; }
  if (settings.ui?.theme) { try { require("./shared/themes").applyTheme(settings.ui.theme, THEME); } catch (_) {} }

  var isTTY = process.stdout.isTTY;
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: isTTY });

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
        var modes = ["normal", "yolo", "plan", "fullauto"];
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
    var cost = session.provider && session.provider.name === "anthropic"
      ? "$" + ((session.inputTokens * 3 + session.outputTokens * 15) / 1000000).toFixed(4)
      : "0";
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

  rl.prompt();
}

if (require.main === module) main();
module.exports = { main };
