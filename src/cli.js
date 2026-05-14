#!/usr/bin/env node

const readline = require('node:readline');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createProvider } = require('./providers');
const { loadSettings } = require('./config');
const { loadRecentTranscript, handleChatMessage, renderBanner, renderStatusLine, handleSlashCommand } = require('./slash-commands');
const { autoCompleteSlashCommand } = require('./commands/autocomplete');
const { suggestCommand } = require('./command-suggestions');
const { createLocalToolRegistry } = require('./tools');
const { registerAgentTeamTools } = require('./teams/tools');
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require('./skills');
const { PermissionManager, PermissionLevel, PERMISSION_LABELS } = require('./permissions');
const { Session, InputHistory } = require('./session');
const { THEME, ANSI, TerminalScreen, MarkdownRenderer, stripAnsi, styled } = require('./renderer');
const { checkForUpdate, performUpdate, restartProcess, wasRestarted } = require('./updater');
const { runInitWizard, shouldRunFirstRunInit } = require('./init-wizard');
const { createTranslator } = require('./i18n');

const VERSION = require('../package.json').version;

const KNOWN_COMMANDS = ['chat', 'init', 'models', 'agents', 'team', 'resume', 'sessions', 'config', 'doctor', 'help', '--help', '-h', '--version', '-V', '--no-color', '--debug'];
const TOP_LEVEL_COMMAND_SUGGESTIONS = KNOWN_COMMANDS
  .filter((command) => !command.startsWith('-'))
  .map((command) => ({ match: command, suggest: command }));

function main(argv = process.argv) {
  const args = argv.slice(2);
  const [primary] = args;

  // Handle --no-color early, before any output
  if (args.includes('--no-color')) {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '0';
    args.splice(args.indexOf('--no-color'), 1);
  }

  // Handle --debug early
  if (args.includes('--debug')) {
    process.env.HAX_AGENT_DEBUG = '1';
    args.splice(args.indexOf('--debug'), 1);
  }

  switch (primary) {
    case '--version':
    case '-V':
      console.log(VERSION);
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log('Hax Agent CLI v' + VERSION);
      console.log('  hax-agent [chat]               Start interactive shell (default)');
      console.log('  hax-agent init                 Run first-time setup wizard');
      console.log('  hax-agent models               List available models');
      console.log('  hax-agent agents               List agent definitions');
      console.log('  hax-agent team auth-refactor   Print an auth-refactor team plan');
      console.log('  hax-agent doctor               Run diagnostics');
      console.log('  hax-agent help                 Show this help');
      console.log('  hax-agent sessions             List previous sessions');
      console.log('  hax-agent resume [session-id]  Resume a previous session');
      console.log('  hax-agent config [edit]        Show or edit configuration');
      console.log('  hax-agent --version            Print version number');
      console.log('  hax-agent --no-color           Disable ANSI color output');
      console.log('  hax-agent --debug              Enable verbose debug logging');
      break;
    case 'init': runInitCommand(args.slice(1)); break;
    case 'models': runModelsCommand(args.slice(1)); break;
    case 'agents': runAgentsCommand(args.slice(1)); break;
    case 'team': runTeamCommand(args.slice(1)); break;
    case 'resume': runResumeCommand(args.slice(1)); break;
    case 'sessions': runSessionsCommand(args.slice(1)); break;
    case 'config': runConfigCommand(args.slice(1)); break;
    case 'doctor': runDoctorCommand(args.slice(1)); break;
    default:
      if (primary && !KNOWN_COMMANDS.includes(primary)) {
        const suggestion = suggestCommand(primary, TOP_LEVEL_COMMAND_SUGGESTIONS);
        console.error(`Unknown command: ${primary}`);
        if (suggestion) console.error(`Did you mean: hax-agent ${suggestion}?`);
        console.log('Usage: hax-agent <command>');
        console.log('  hax-agent help   Show available commands');
        process.exit(1);
      }
      runShell(args);
      break;
  }
}

function runInitCommand(args) {
  runInitWizard({
    env: process.env,
    input: process.stdin,
    output: process.stdout,
    promptToStart: args.includes('--confirm'),
  }).catch((err) => {
    console.error(`Failed to initialize: ${err.message}`);
    process.exit(1);
  });
}

function runModelsCommand(args) {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  const { printModels } = require('./slash-commands');

  printModels(provider, { write: (s) => process.stdout.write(stripAnsi(s)) })
    .catch((err) => { console.error(`Failed to list models: ${err.message}`); process.exit(1); });
}

function runAgentsCommand() {
  const settings = loadSettings();
  const { loadAgentDefinitions } = require('./teams/agents');
  const { formatAgentList } = require('./formatters/agent-teams');

  const definitions = loadAgentDefinitions({
    projectRoot: settings.projectRoot || process.cwd(),
    settings,
  });
  console.log(formatAgentList(definitions));
}

function runTeamCommand(args) {
  if (args.length === 0) {
    console.error('Usage: hax-agent team <command> [options]');
    console.error('  hax-agent team auth-refactor   Print an auth-refactor team plan');
    console.error('  hax-agent team agents          List available agent types');
    console.error('  hax-agent team list            List saved teams');
    console.error('  hax-agent team new <name>       Create a team');
    console.error('  hax-agent team status [name]   Show team status');
    process.exit(1);
  }

  if (args[0] === 'auth-refactor') {
    const { createAuthRefactorTeam } = require('./teams/auth-refactor');
    const { formatTeamPlan } = require('./formatters/team-plan');
    const team = createAuthRefactorTeam();
    console.log(formatTeamPlan(team));
    return;
  }

  const settings = loadSettings();
  const { createCliTeamRuntime, executeTeamCommand } = require('./slash-commands');
  const runtime = createCliTeamRuntime(settings);

  executeTeamCommand(runtime, args[0] || 'help', args.slice(1), { settings })
    .then((output) => {
      if (output) console.log(output);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}

function runConfigCommand(args) {
  const { resolveSettings } = require('./config');
  const resolved = resolveSettings();
  const settings = resolved.settings;
  const configPath = resolved.sources.find(s => s.type === 'user')?.path;

  if (args[0] === 'edit') {
    // Open config file in default editor
    const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vi');
    const child = spawn(editor, configPath ? [configPath] : [], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      if (code !== 0) console.error(`Editor exited with code ${code}`);
    });
    return;
  }

  // Show config
  const { getLocaleLabel, normalizeLocale } = require('./i18n');
  const locale = normalizeLocale(settings.ui?.locale);
  console.log('Current configuration:');
  console.log(`  Provider:     ${settings.agent?.provider || 'not set'}`);
  console.log(`  Model:        ${settings.agent?.model || 'not set'}`);
  console.log(`  API Key:      ${settings.agent?.apiKey ? '********' : 'not set'}`);
  console.log(`  API URL:      ${settings.agent?.apiUrl || 'default'}`);
  console.log(`  Language:     ${getLocaleLabel(locale)} (${locale})`);
  console.log(`  Max turns:    ${settings.agent?.maxTurns ?? 20}`);
  console.log(`  Temperature:  ${settings.agent?.temperature ?? 0.2}`);
  console.log(`  Shell tools:  ${settings.tools?.shell?.enabled !== false ? 'enabled' : 'disabled'}`);
  console.log(`  Memory:       ${settings.memory?.enabled !== false ? 'enabled' : 'disabled'}`);
  if (configPath) console.log(`\nConfig file: ${configPath}`);
  console.log(`\nRun 'hax-agent config edit' to edit, or 'hax-agent init' to re-run setup.`);
}

function runResumeCommand(args) {
  const settings = loadSettings();
  const { listSessions } = require('./memory');
  const sessions = listSessions(settings);

  const [sessionId] = args;
  let targetSession;

  if (sessionId) {
    targetSession = sessions.find((s) => s.id.startsWith(sessionId));
  } else {
    targetSession = sessions[0];
  }

  if (!targetSession) {
    console.error('Session not found.');
    process.exit(1);
  }

  const entries = targetSession.entries();
  const messages = entries
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .slice(-resolveTranscriptMessageLimit(settings))
    .map((e) => ({ role: e.role, content: e.content || '' }));

  const provider = createProvider(settings.agent, process.env);
  const toolRegistry = createLocalToolRegistry({
    root: process.cwd(),
    shellPolicy: settings.tools?.shell,
  });
  registerAgentTeamTools(toolRegistry, { settings, projectRoot: process.cwd() });

  const permissionManager = new PermissionManager({ mode: 'normal' });
  const session = new Session({
    provider,
    settings,
    toolRegistry,
    permissionManager,
  });
  session.messages = messages;
  session.id = targetSession.id;

  runShell([], session);
}

function resolveTranscriptMessageLimit(settings = {}) {
  const limit = Number(settings.prompts?.maxTranscriptMessages);
  return Number.isFinite(limit) && limit > 0 ? limit : Infinity;
}

function runSessionsCommand(args) {
  const settings = loadSettings();

  if (args[0] === 'clear') {
    const { clearSessions } = require('./memory');
    const count = clearSessions(settings);
    console.log(`Cleared ${count} session(s).`);
    return;
  }

  const { listSessions } = require('./memory');
  const sessions = listSessions(settings);

  if (sessions.length === 0) {
    console.log('No previous sessions found.');
    return;
  }

  for (const s of sessions.slice(0, 50)) {
    const entries = s.entries();
    const userMessages = entries.filter((e) => e.role === 'user');
    const firstMsg = userMessages[0]?.content || '(empty)';
    const preview = firstMsg.length > 80 ? firstMsg.slice(0, 77) + '...' : firstMsg;
    const date = new Date(s.updatedAt).toLocaleDateString();
    console.log(`${s.id.slice(0, 20)}  ${date}  ${preview}`);
  }
  console.log('\nRun "hax-agent sessions clear" to delete all sessions.');
}

async function runDoctorCommand() {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  const locale = require('./i18n').normalizeLocale(settings.ui?.locale);

  const checks = [
    { name: 'Node.js', value: process.version },
    { name: 'Provider', value: provider.name },
    { name: 'Model', value: provider.model },
    { name: 'API Key', value: provider.apiKey ? 'set' : 'not set' },
    { name: 'API URL', value: provider.apiUrl || 'default' },
    { name: 'Language', value: `${require('./i18n').getLocaleLabel(locale)} (${locale})` },
    { name: 'Shell tool', value: settings.tools?.shell?.enabled !== false ? 'enabled' : 'disabled' },
    { name: 'Memory', value: settings.memory?.enabled !== false ? 'enabled' : 'disabled' },
    { name: 'Permissions', value: settings.permissions?.mode || 'normal' },
    { name: 'Config file', value: require('./config').resolveSettings().sources.find(s => s.type === 'user')?.path || 'not found' },
  ];

  console.log(`Hax Agent CLI v${VERSION} - Diagnostics\n`);
  for (const { name, value } of checks) {
    const label = (name + ':').padEnd(16);
    console.log(`  ${label} ${value}`);
  }
}

async function runShell(args, explicitSession) {
  let resolvedSettings = require('./config').resolveSettings();
  if (shouldRunFirstRunInit({
    env: process.env,
    args,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    explicitSession: Boolean(explicitSession),
    sources: resolvedSettings.sources,
  })) {
    await runInitWizard({
      env: process.env,
      input: process.stdin,
      output: process.stdout,
      promptToStart: true,
    });
    resolvedSettings = require('./config').resolveSettings();
  }

  const settings = resolvedSettings.settings;
  const provider = explicitSession ? explicitSession.provider : createProvider(settings.agent, process.env);
  const screen = new TerminalScreen();
  const markdown = new MarkdownRenderer(screen.columns);

  const permissionManager = explicitSession
    ? explicitSession.permissionManager
    : new PermissionManager({
      mode: args.includes('--yolo') ? 'yolo' : (settings.permissions?.mode || 'normal'),
      locale: settings.ui?.locale,
      persistPath: path.join(process.cwd(), '.hax-agent', 'permissions.json'),
    });

  const toolRegistry = createLocalToolRegistry({
    root: process.cwd(),
    shellPolicy: settings.tools?.shell,
    permissionManager,
  });
  registerAgentTeamTools(toolRegistry, { settings, projectRoot: process.cwd() });

  const session = explicitSession || new Session({
    provider,
    settings,
    toolRegistry,
    permissionManager,
  });
  permissionManager.locale = settings.ui?.locale;
  if (session.permissionManager) {
    session.permissionManager.locale = settings.ui?.locale;
  }

  const history = new InputHistory();
  const t = (key, values) => createTranslator(session.settings?.ui?.locale)(key, values);

  if (!explicitSession) {
    loadRecentTranscript(session);
  }

  if (!screen.isTTY()) {
    session.permissionManager.mode = 'yolo';
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.setPrompt(`${styled(THEME.promptPrefix, '>')} `);

  screen.activate();

  process.stdin.on('keypress', (_char, key) => {
    if (!key) return;
    if (session.interactivePromptActive) return;

    if (vimMode && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
      vimCommandBuffer = '';
    }

    if (vimMode && !vimInsertMode) {
      handleVimKey(key, rl);
      return;
    }

    if (key.name === 'up') {
      const input = rl.line;
      rl.line = history.up(input);
      rl.cursor = rl.line.length;
      rl._refreshLine();
    } else if (key.name === 'down') {
      rl.line = history.down(rl.line);
      rl.cursor = rl.line.length;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'left') {
      // Ctrl+Left: jump to previous word boundary
      const line = rl.line;
      let pos = rl.cursor - 1;
      while (pos > 0 && line[pos - 1] === ' ') pos--;
      while (pos > 0 && line[pos - 1] !== ' ') pos--;
      rl.cursor = pos;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'right') {
      // Ctrl+Right: jump to next word boundary
      const line = rl.line;
      let pos = rl.cursor;
      while (pos < line.length && line[pos] !== ' ') pos++;
      while (pos < line.length && line[pos] === ' ') pos++;
      rl.cursor = pos;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'r') {
      enterReverseSearch(rl, history, screen);
      return;
    } else if (key.name === 'tab') {
      // readline already inserted \t into the line; strip it so autocomplete
      // sees the actual user input, then re-insert if not a slash command
      rl.line = rl.line.replace(/\t/g, '');
      rl.cursor = rl.line.length;
      const display = autoCompleteSlashCommand(rl, session);
      if (display) {
        rl._refreshLine();
        if (display.length) {
          process.stdout.write('\n' + display.join('\n') + '\n');
          rl.prompt(true);
        }
      } else {
        // Not a slash command — restore the tab (readline default indent)
        rl.line = rl.line + '\t';
        rl.cursor = rl.line.length;
        rl._refreshLine();
      }
    }
  });

  let vimMode = false;
  let vimInsertMode = true;
  let vimCommandBuffer = '';

  function handleVimKey(key, rl) {
    if (key.name === 'i' && !key.ctrl) {
      vimInsertMode = true;
    } else if (key.name === 'escape' || key.ctrl) {
      vimInsertMode = true;
      vimCommandBuffer = '';
    } else if (key.name === 'h' && !key.ctrl) {
      rl.cursor = Math.max(0, rl.cursor - 1);
      rl._refreshLine();
    } else if (key.name === 'l' && !key.ctrl) {
      rl.cursor = Math.min(rl.line.length, rl.cursor + 1);
      rl._refreshLine();
    } else if (key.name === '0') {
      rl.cursor = 0;
      rl._refreshLine();
    } else if (key.name === 'd' && !key.shift) {
      vimCommandBuffer += 'd';
    } else if (key.name === 'd' && vimCommandBuffer === 'd') {
      rl.line = '';
      rl.cursor = 0;
      rl._refreshLine();
      vimCommandBuffer = '';
    } else if (key.name === 'w') {
      const nextSpace = rl.line.indexOf(' ', rl.cursor);
      rl.cursor = nextSpace === -1 ? rl.line.length : nextSpace + 1;
      rl._refreshLine();
    } else if (key.name === 'b') {
      const prevSpace = rl.line.lastIndexOf(' ', rl.cursor - 1);
      rl.cursor = prevSpace === -1 ? 0 : prevSpace + 1;
      rl._refreshLine();
    }
  }

  /**
   * Interactive reverse-i-search (Ctrl+R). Like bash's reverse search:
   * - Type to narrow search; match appears inline
   * - Ctrl+R again to cycle to previous match
   * - Enter to accept, Escape/Ctrl+C to cancel
   */
  function enterReverseSearch(rl, history, screen) {
    if (history.entries.length === 0) return;

    const origLine = rl.line;
    let query = '';
    let matchIndex = 0;
    let active = true;

    // Save current stdin handler and install search handler
    const origKeypress = process.stdin.listeners('keypress').pop();
    process.stdin.removeListener('keypress', origKeypress);

    function render() {
      const results = history.search(query);
      const match = results[matchIndex % Math.max(1, results.length)] || '';
      const highlight = match && query
        ? match.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `\x1b[1m\x1b[33m${m}\x1b[0m`)
        : match;

      process.stdout.write('\r\x1b[K'); // clear line
      if (query) {
        process.stdout.write(`\x1b[2m(reverse-i-search)\x1b[0m \`${query}': ${highlight}`);
      } else {
        process.stdout.write(`\x1b[2m(reverse-i-search)\x1b[0m \`': `);
      }
    }

    function accept() {
      active = false;
      const results = history.search(query);
      if (results.length > 0) {
        rl.line = results[matchIndex % results.length];
        rl.cursor = rl.line.length;
      }
      cleanup();
      process.stdout.write('\r\x1b[K');
      rl._refreshLine();
    }

    function cancel() {
      active = false;
      rl.line = origLine;
      rl.cursor = rl.line.length;
      cleanup();
      process.stdout.write('\r\x1b[K');
      rl._refreshLine();
    }

    function cleanup() {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.on('keypress', origKeypress);
    }

    function onKey(_char, key) {
      if (!active) return;
      if (!key) return;

      if (key.name === 'return' || key.name === 'enter') {
        accept();
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cancel();
      } else if (key.ctrl && key.name === 'r') {
        matchIndex++;
        render();
      } else if (key.name === 'backspace') {
        query = query.slice(0, -1);
        matchIndex = 0;
        render();
      } else if (_char && _char.length === 1 && !key.ctrl && !key.meta) {
        query += _char;
        matchIndex = 0;
        render();
      }
    }

    process.stdin.on('keypress', onKey);
    render();

    // Pause readline so it doesn't eat our keystrokes
    rl.pause();
    process.stdin.once('keypress', () => {}); // dummy to keep events flowing
  }

  function createApprovalPrompt() {
    if (!screen.isTTY()) {
      toolRegistry.permissionManager.mode = 'yolo';
      return null;
    }

    return ({ toolName, toolArgs, level, description }) => {
      return new Promise((resolve) => {
        const levelLabel = PERMISSION_LABELS[level] || level;
        const levelColor = level === PermissionLevel.DANGEROUS ? THEME.error
          : level === PermissionLevel.ASK ? THEME.warning : THEME.success;

        screen.write(`\n${levelColor}╭─ ${t('approval.title')} ─────────────────────────────────╮${ANSI.reset}\n`);
        screen.write(`${levelColor}│${ANSI.reset}  ${t('approval.level')}: ${styled(levelColor, levelLabel)}\n`);
        screen.write(`${levelColor}│${ANSI.reset}  ${t('approval.operation')}: ${styled(THEME.bold, toolName)}\n`);

        const descLines = description.split('\n');
        for (const line of descLines) {
          screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.dim, line)}\n`);
        }

        screen.write(`${levelColor}│${ANSI.reset}\n`);
        screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.promptPrefix, '[Y]')} ${t('approval.allow')}    ${styled(THEME.error, '[N]')} ${t('approval.deny')}\n`);
        screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.promptPrefix, '[A]')} ${t('approval.alwaysAllow')}  ${styled(THEME.error, '[D]')} ${t('approval.alwaysDeny')}\n`);
        screen.write(`${levelColor}╰──────────────────────────────────────────────╯${ANSI.reset}\n`);
        screen.write(styled(THEME.dim, t('approval.prompt')) + ' ');

        let resolved = false;

        const onKeyPress = (char, key) => {
          if (!key || resolved) return;
          const c = (char || '').toLowerCase();

          if (c === 'y' || (key.name === 'return' && !char)) {
            resolved = true; cleanup();
            screen.write('Y\n');
            resolve('approve');
          } else if (c === 'n') {
            resolved = true; cleanup();
            screen.write('N\n');
            resolve('deny');
          } else if (c === 'a') {
            resolved = true; cleanup();
            screen.write('A\n');
            resolve('always_allow');
          } else if (c === 'd') {
            resolved = true; cleanup();
            screen.write('D\n');
            resolve('always_deny');
          }
        };

        function cleanup() {
          process.stdin.removeListener('keypress', onKeyPress);
          if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch (_) {}
          }
        }

        process.stdin.setRawMode(true);
        process.stdin.on('keypress', onKeyPress);
      });
    };
  }

  toolRegistry.approvalCallback = createApprovalPrompt();

  renderBanner(screen, session);

  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    screen.write(styled(THEME.warning, `! ${t('shell.mockMode')}`) + '\n\n');
  }

  if (session.permissionManager.mode === 'yolo') {
    screen.write(styled(THEME.warning, `! ${t('shell.yoloMode')}`) + '\n\n');
  } else {
    const permLabel = session.permissionManager.mode === 'normal' ? t('common.mode.standard') : session.permissionManager.mode;
    screen.write(styled(THEME.dim, t('shell.permissionMode', { mode: permLabel })) + '\n\n');
  }

  // First-run tips — show if no sessions exist (fresh install)
  const { listSessions } = require('./memory');
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) {
    const tips = [
      `  ${styled(THEME.bold, '🚀 Quick Start')}`,
      `  ${styled(THEME.dim, 'Just type a question to begin — the AI will help with code, files, and more.')}`,
      ``,
      `  ${styled(THEME.bold, '💡 Tips')}`,
      `  ${styled(THEME.dim, 'Type')} / ${styled(THEME.dim, 'to see all commands   →   Tab to autocomplete')}`,
      `  ${styled(THEME.dim, 'Tab auto-completes commands and subcommands (e.g. /team Tab)')}`,
      `  ${styled(THEME.dim, 'Shift+Tab toggles permission mode (normal ↔ yolo)')}`,
      `  ${styled(THEME.dim, 'Ctrl+L clears screen   ·   /exit to quit')}`,
      ``,
    ];
    for (const tip of tips) screen.write(tip + '\n');
  }

  renderStatusLine(screen, session);
  rl.prompt();

  if (!wasRestarted()) {
    checkForUpdate(VERSION).then(async (result) => {
      if (!result.hasUpdate) return;

      screen.write(
        `\n${styled(THEME.warning, `⬆ New version available: v${result.currentVersion} → v${result.latestVersion}`)}\n`
      );

      if (!settings.updates?.autoInstall) {
        screen.write(`${styled(THEME.dim, '  Run /update install to update now.')}\n\n`);
        rl.prompt();
        return;
      }

      screen.write(`${styled(THEME.dim, '  Auto-install is enabled. Updating...')}\n`);

      try {
        await performUpdate();
        screen.write(`${styled(THEME.success, '  OK Update complete. Restarting...')}\n\n`);
        setTimeout(() => restartProcess(), 500);
      } catch (err) {
        screen.write(
          `${styled(THEME.error, `  ✖ Auto-update failed: ${err.message}`)}\n` +
          `${styled(THEME.dim, '  Run manually: npm install -g hax-agent-cli')}\n\n`
        );
        rl.prompt();
      }
    }).catch(() => {});
  }

  let pendingExitCount = 0;
  let lineQueue = Promise.resolve();
  session.interactivePromptActive = false;
  let multilineBuffer = [];

  rl.on('line', (line) => {
    // Multi-line continuation: trailing backslash (bash-style)
    if (line.endsWith('\\')) {
      multilineBuffer.push(line.slice(0, -1));
      rl.setPrompt(styled(THEME.dim, '│ ') + ' ');
      rl.prompt();
      return;
    }

    let finalLine = line;
    if (multilineBuffer.length > 0) {
      multilineBuffer.push(line);
      finalLine = multilineBuffer.join('\n');
      multilineBuffer = [];
      rl.setPrompt(`${styled(THEME.promptPrefix, '>')} `);
    }

    lineQueue = lineQueue.then(() => processLine(finalLine));
  });

  async function processLine(line) {
    history.add(line);
    const trimmed = line.trim();

    if (trimmed.startsWith('/')) {
      if (trimmed === '/exit' || trimmed === '/quit' || trimmed === '/q') {
        screen.clearLine();
        screen.write(trimmed + '\n');
        session.shouldExit = true;
        // Show file change summary if any files were modified
        if (session.modifiedFiles && session.modifiedFiles.size > 0) {
          const files = [...session.modifiedFiles].sort();
          screen.write(`\n${styled(THEME.heading, t('shell.filesModified', { count: files.length }))}\n`);
          for (const f of files) {
            screen.write(`  ${styled(THEME.accent, f)}\n`);
          }
        }
        const cost = session.costTracker.getCost(session.provider?.model);
          screen.write(`\n${styled(THEME.success, t('shell.sessionEnded'))} ${styled(THEME.dim, t('shell.sessionStats', { cost: cost.toFixed(4), turns: session.costTracker.turnCount }))}\n`);
        screen.deactivate();
        process.exit(0);
      }

      if (trimmed === '/vim') {
        vimMode = !vimMode;
        vimInsertMode = true;
        screen.clearLine();
        screen.write(trimmed + '\n');
        screen.write(styled(THEME.success, t('shell.vimMode', { state: vimMode ? t('common.enabled') : t('common.disabled') })) + '\n');
        rl.prompt();
        return;
      }

      const [commandName, ...cmdArgs] = trimmed.slice(1).split(/\s+/);

      if (commandName === 'clear' || commandName === 'c') {
        session.isStreaming = false;
        const clearedCount = session.messages.length;
        session.messages = [];
        session.id = require('./memory').createSessionId();
        session.costTracker = new (require('./session').CostTracker)();
        screen.clear();
        renderBanner(screen, session);
        screen.write(styled(THEME.success, t('shell.contextCleared', { count: clearedCount })) + '\n');
        screen.write(styled(THEME.dim, t('shell.clearHint')) + '\n\n');
        rl.prompt();
        return;
      }

      screen.clearLine();
      screen.write(trimmed + '\n');

      await handleSlashCommand(trimmed, { screen, session, markdown, rl, input: process.stdin, output: process.stdout });
      renderStatusLine(screen, session);
      rl.prompt();
      return;
    }

    if (session.isStreaming) {
      screen.write(styled(THEME.warning, t('shell.cannotSend')) + '\n');
      rl.prompt();
      return;
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('!')) {
      const shellLine = trimmed.slice(1).trim();
      if (!shellLine) {
        rl.prompt();
        return;
      }

      screen.clearLine();
      screen.write(styled(THEME.shellIndicator, `!${shellLine}`) + '\n');

      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['-Command', shellLine] : ['-c', shellLine];

      const child = spawn(shell, shellArgs, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      await new Promise((resolve) => {
        child.on('close', (code) => {
          if (code !== 0) {
            screen.write(styled(THEME.warning, `Exit code: ${code}`) + '\n');
          }
          renderStatusLine(screen, session);
          rl.prompt();
          resolve();
        });
        child.on('error', (err) => {
          screen.write(styled(THEME.error, `Command error: ${err.message}`) + '\n');
          renderStatusLine(screen, session);
          rl.prompt();
          resolve();
        });
      });
      return;
    }

    screen.clearLine();
    screen.write('\n');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Highlight slash commands in user echo: /cmd args → colored /cmd + dim args
    let echoLine = trimmed;
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      if (spaceIdx === -1) {
        echoLine = styled(THEME.accent, trimmed);
      } else {
        echoLine = styled(THEME.accent, trimmed.slice(0, spaceIdx)) + ' ' + styled(THEME.dim, trimmed.slice(spaceIdx + 1));
      }
    }
    screen.write(`${styled(THEME.userIndicator, `You ${time}`)}  ${echoLine}\n`);

    await handleChatMessage(trimmed, { screen, session, markdown });
    renderStatusLine(screen, session);
    rl.prompt();
  }

  rl.on('close', () => {
    screen.cursorTo(screen.rows, 1);
    screen.write('\n');
    if (session.shouldExit) {
      screen.deactivate();
      process.exit(0);
    }
    session.shouldExit = false;
    pendingExitCount = 0;
  });

  process.stdin.on('keypress', (char, key) => {
    if (!key) return;
    if (session.interactivePromptActive) return;

    if (key.name === 'c' && key.ctrl) {
      if (session.isStreaming) {
        session.responseInterrupted = true;
        if (session.responseAbortController) {
          session.responseAbortController.abort();
        }
        screen.write('\n' + styled(THEME.warning, '^C') + '\n');
        return;
      }

      pendingExitCount += 1;
      if (pendingExitCount === 1) {
        screen.write('\n' + styled(THEME.warning, t('shell.ctrlCExit')) + '\n');
        renderStatusLine(screen, session);
        rl.prompt();
        setTimeout(() => { pendingExitCount = 0; }, 2000);
      } else {
        screen.write('\n');
        screen.deactivate();
        process.exit(0);
      }
      return;
    }

    if (key.name === 'l' && key.ctrl) {
      screen.clear();
      renderBanner(screen, session);
      renderStatusLine(screen, session);
      rl.prompt();
      return;
    }

    if (key.name === 'tab' && key.shift) {
      const modes = ['normal', 'yolo'];
      const currentIndex = modes.indexOf(session.permissionManager.mode);
      const newMode = modes[(currentIndex + 1) % modes.length];
      session.permissionManager.mode = newMode;

      const modeLabel = newMode === 'yolo' ? 'YOLO' : t('common.mode.standard');
      const modeColor = newMode === 'yolo' ? THEME.warning : THEME.success;

      screen.write(`\n${modeColor}╭────────────────────────────────────╮${ANSI.reset}\n`);
      screen.write(`${modeColor}│${ANSI.reset}  ${t('shell.permissionSwitched', { mode: styled(modeColor + THEME.bold, modeLabel) })}\n`);
      screen.write(`${modeColor}│${ANSI.reset}\n`);
      screen.write(`${modeColor}│${ANSI.reset}  ${styled(THEME.dim, t('shell.permissionShortcut'))}\n`);
      screen.write(`${modeColor}╰────────────────────────────────────╯${ANSI.reset}\n\n`);

      renderStatusLine(screen, session);
      rl.prompt();
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = { main };
