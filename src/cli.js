#!/usr/bin/env node

const readline = require('node:readline');
const path = require('node:path');
const { createProvider } = require('./providers');
const { loadSettings } = require('./config');
const { loadRecentTranscript, handleChatMessage, renderBanner, renderStatusLine, handleSlashCommand } = require('./slash-commands');
const { createLocalToolRegistry } = require('./tools');
const { registerAgentTeamTools } = require('./teams/tools');
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require('./skills');
const { PermissionManager, PermissionLevel, PERMISSION_LABELS } = require('./permissions');
const { Session, InputHistory } = require('./session');
const { THEME, TerminalScreen, MarkdownRenderer, stripAnsi } = require('./renderer');

const VERSION = '1.3.2';

const KNOWN_COMMANDS = ['chat', 'models', 'agents', 'team', 'resume', 'sessions', 'help', '--help', '-h'];

function main(argv = process.argv) {
  const args = argv.slice(2);
  const [primary] = args;

  switch (primary) {
    case 'help':
    case '--help':
    case '-h':
      console.log('Hax Agent CLI v' + VERSION);
      console.log('  hax-agent [chat]               Start interactive shell (default)');
      console.log('  hax-agent models               List available models');
      console.log('  hax-agent agents               List agent definitions');
      console.log('  hax-agent team auth-refactor   Print an auth-refactor team plan');
      console.log('  hax-agent help                 Show this help');
      console.log('  hax-agent sessions             List previous sessions');
      console.log('  hax-agent resume [session-id]  Resume a previous session');
      break;
    case 'models': runModelsCommand(args.slice(1)); break;
    case 'agents': runAgentsCommand(args.slice(1)); break;
    case 'team': runTeamCommand(args.slice(1)); break;
    case 'resume': runResumeCommand(args.slice(1)); break;
    case 'sessions': runSessionsCommand(args.slice(1)); break;
    default:
      if (primary && !KNOWN_COMMANDS.includes(primary)) {
        console.error(`Unknown command: ${primary}`);
        console.log('Usage: hax-agent <command>');
        console.log('  hax-agent help   Show available commands');
        process.exit(1);
      }
      runShell(args);
      break;
  }
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
  const limit = settings.prompts?.maxTranscriptMessages || 20;
  const messages = entries
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .slice(-limit)
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

function runSessionsCommand() {
  const settings = loadSettings();
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
}

async function runShell(args, explicitSession) {
  const settings = loadSettings();
  const provider = explicitSession ? explicitSession.provider : createProvider(settings.agent, process.env);
  const screen = new TerminalScreen();
  const markdown = new MarkdownRenderer(screen.columns);

  const permissionManager = explicitSession
    ? explicitSession.permissionManager
    : new PermissionManager({
      mode: args.includes('--yolo') ? 'yolo' : (settings.permissions?.mode || 'normal'),
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

  const history = new InputHistory();

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

  rl.setPrompt(`${THEME.promptPrefix}>${stripAnsi(THEME.ANSI?.reset || '')} `);

  screen.activate();

  process.stdin.on('keypress', (_char, key) => {
    if (!key) return;

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
    } else if (key.name === 'tab') {
      autoCompleteSlashCommand(rl, session);
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

  function autoCompleteSlashCommand(rl, session) {
    const line = rl.line;
    const { SLASH_COMMANDS } = require('./slash-commands');

    if (line.startsWith('/')) {
      const partial = line.slice(1).split(' ')[0];
      const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(partial));
      if (matches.length === 1) {
        rl.line = '/' + matches[0].name + ' ';
        rl.cursor = rl.line.length;
        rl._refreshLine();
      } else if (matches.length > 1) {
        const commonPrefix = matches.reduce((acc, c) => {
          let i = 0;
          while (i < acc.length && i < c.name.length && acc[i] === c.name[i]) i++;
          return c.name.slice(0, i);
        }, matches[0].name);
        if (commonPrefix.length > partial.length) {
          rl.line = '/' + commonPrefix;
          rl.cursor = rl.line.length;
          rl._refreshLine();
        }
      }
    }
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

        screen.write(`\n${levelColor}╭─ 权限请求 ─────────────────────────────────╮${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}  级别: ${levelColor}${levelLabel}${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}  操作: ${THEME.bold}${toolName}${stripAnsi(THEME.ANSI?.reset || '')}\n`);

        const descLines = description.split('\n');
        for (const line of descLines) {
          screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}  ${THEME.dim}${line}${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        }

        screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}  ${THEME.promptPrefix}[Y]${stripAnsi(THEME.ANSI?.reset || '')} 允许    ${THEME.error}[N]${stripAnsi(THEME.ANSI?.reset || '')} 拒绝\n`);
        screen.write(`${levelColor}│${stripAnsi(THEME.ANSI?.reset || '')}  ${THEME.promptPrefix}[A]${stripAnsi(THEME.ANSI?.reset || '')} 永久允许  ${THEME.error}[D]${stripAnsi(THEME.ANSI?.reset || '')} 永久拒绝\n`);
        screen.write(`${levelColor}╰──────────────────────────────────────────────╯${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        screen.write(`${THEME.dim}请选择 (Y/N/A/D):${stripAnsi(THEME.ANSI?.reset || '')} `);

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
    screen.write(`${THEME.warning}⚠ Local mock mode is active. Set /api-url and /api-key to chat with a real model.${stripAnsi(THEME.ANSI?.reset || '')}\n\n`);
  }

  if (session.permissionManager.mode === 'yolo') {
    screen.write(`${THEME.warning}⚠ YOLO 模式已启用 - 所有操作将自动执行，无需确认${stripAnsi(THEME.ANSI?.reset || '')}\n\n`);
  } else {
    screen.write(`${THEME.dim}权限模式: ${session.permissionManager.mode === 'normal' ? '标准' : session.permissionManager.mode} · 使用 /permissions 管理权限${stripAnsi(THEME.ANSI?.reset || '')}\n\n`);
  }

  renderStatusLine(screen, session);
  rl.prompt();

  let pendingExitCount = 0;
  let lineQueue = Promise.resolve();

  rl.on('line', (line) => {
    lineQueue = lineQueue.then(() => processLine(line));
  });

  async function processLine(line) {
    history.add(line);
    const trimmed = line.trim();

    if (trimmed.startsWith('/')) {
      if (trimmed === '/exit' || trimmed === '/quit' || trimmed === '/q') {
        screen.clearLine();
        screen.write(trimmed + '\n');
        session.shouldExit = true;
        const cost = session.costTracker.getCost(session.provider?.model);
        screen.write(`${THEME.success}Session ended.${stripAnsi(THEME.ANSI?.reset || '')} ${THEME.dim}Cost: $${cost.toFixed(4)} · Turns: ${session.costTracker.turnCount}${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        screen.deactivate();
        process.exit(0);
      }

      if (trimmed === '/vim') {
        vimMode = !vimMode;
        vimInsertMode = true;
        screen.clearLine();
        screen.write(trimmed + '\n');
        screen.write(`${THEME.success}Vim mode ${vimMode ? 'enabled' : 'disabled'}.${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        rl.prompt();
        return;
      }

      const [commandName, ...cmdArgs] = trimmed.slice(1).split(/\s+/);

      if (commandName === 'clear' || commandName === 'c') {
        session.isStreaming = false;
        session.messages = [];
        session.id = require('./memory').createSessionId();
        session.costTracker = new (require('./session').CostTracker)();
        screen.clear();
        renderBanner(screen, session);
        screen.write(`${THEME.success}Context cleared.${stripAnsi(THEME.ANSI?.reset || '')}\n\n`);
        rl.prompt();
        return;
      }

      screen.clearLine();
      screen.write(trimmed + '\n');

      await handleSlashCommand(trimmed, { screen, session, markdown, rl });
      renderStatusLine(screen, session);
      rl.prompt();
      return;
    }

    if (session.isStreaming) {
      screen.write(`${THEME.warning}Cannot send while the assistant is generating a response.${stripAnsi(THEME.ANSI?.reset || '')}\n`);
      rl.prompt();
      return;
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('!')) {
      const shellLine = trimmed.slice(1).trim();
      screen.clearLine();
      screen.write(trimmed + '\n');

      await handleChatMessage(shellLine, { screen, session, markdown });
      renderStatusLine(screen, session);
      rl.prompt();
      return;
    }

    screen.clearLine();
    screen.write('\n');
    screen.write(`${THEME.userIndicator}You ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${stripAnsi(THEME.ANSI?.reset || '')}  ${trimmed}\n`);

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

    if (key.name === 'c' && key.ctrl) {
      if (session.isStreaming) {
        session.responseInterrupted = true;
        if (session.responseAbortController) {
          session.responseAbortController.abort();
        }
        screen.write(`\n${THEME.warning}^C${stripAnsi(THEME.ANSI?.reset || '')}\n`);
        return;
      }

      pendingExitCount += 1;
      if (pendingExitCount === 1) {
        screen.write(`\n${THEME.warning}Press Ctrl+C again to exit.${stripAnsi(THEME.ANSI?.reset || '')}\n`);
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

      const modeLabel = newMode === 'yolo' ? 'YOLO (自动执行)' : '标准 (需确认)';
      const modeColor = newMode === 'yolo' ? THEME.warning : THEME.success;

      screen.write(`\n${modeColor}╭────────────────────────────────────╮${stripAnsi(THEME.ANSI?.reset || '')}\n`);
      screen.write(`${modeColor}│${stripAnsi(THEME.ANSI?.reset || '')}  权限模式已切换: ${modeColor}${THEME.bold}${modeLabel}${stripAnsi(THEME.ANSI?.reset || '')}\n`);
      screen.write(`${modeColor}│${stripAnsi(THEME.ANSI?.reset || '')}\n`);
      screen.write(`${modeColor}│${stripAnsi(THEME.ANSI?.reset || '')}  ${THEME.dim}按 Shift+Tab 循环切换模式${stripAnsi(THEME.ANSI?.reset || '')}\n`);
      screen.write(`${modeColor}╰────────────────────────────────────╯${stripAnsi(THEME.ANSI?.reset || '')}\n\n`);

      renderStatusLine(screen, session);
      rl.prompt();
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = { main };
