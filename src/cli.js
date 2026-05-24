#!/usr/bin/env node

const readline = require('node:readline');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventBus } = require('./events/bus');
const { createProvider } = require('./providers');
const { loadSettings } = require('./config');
const { handleChatMessage, renderBanner, handleSlashCommand, formatSessionPreview, resolveTranscriptMessageLimit } = require('./commands');
const { suggestCommand } = require('./command-suggestions');
const { createLocalToolRegistry } = require('./tools');
const { UndoStack } = require('./undo-stack');
const { runBatchMode } = require('./batch');
const { registerAgentTeamTools } = require('./teams/tools');
const { createInputPipeline } = require('./infrastructure/safety-pipeline');
const { createPluginManager } = require('./infrastructure/plugin-manager');
const { setupBackgroundTasks: _setupBackgroundTasks, teardownBackgroundTasks: _teardownBackgroundTasks } = require('./infrastructure/scheduler-setup');
const { getShutdownManager: _shutdownManager, PRIORITY: _SHUTDOWN_PRIORITY } = require('./shutdown');
const { setupKnowledgeManagement } = require('./infrastructure/knowledge-setup');

let activePreset = null;

function resolveSettings() {
  const settings = loadSettings();
  if (activePreset) {
    const { applyPreset } = require('./config-presets');
    return applyPreset(settings, activePreset);
  }
  return settings;
}

const SAFE_EDITORS = new Set([
  'vi', 'vim', 'nvim', 'neovim', 'nano', 'emacs', 'emacsclient',
  'code', 'code-insiders', 'cursor', 'windsurf',
  'notepad', 'notepad.exe', 'notepad++', 'subl', 'sublime_text',
  'gedit', 'kate', 'atom', 'idea', 'pycharm', 'webstorm',
]);

function resolveEditorCommand(editor, platform) {
  if (!editor || typeof editor !== 'string') {
    return platform === 'win32' ? 'notepad' : 'vi';
  }
  const parts = editor.trim().split(/\s+/);
  const base = require('node:path').basename(parts[0]).replace(/\.exe$/i, '').toLowerCase();
  if (SAFE_EDITORS.has(base)) {
    return parts[0];
  }
  return platform === 'win32' ? 'notepad' : 'vi';
}

const { PermissionManager } = require('./permissions');
const { Session, CostTracker } = require('./session');
const { THEME, ANSI, TerminalScreen, MarkdownRenderer, stripAnsi, styled } = require('./renderer');
const { checkForUpdate, performUpdate, restartProcess, wasRestarted } = require('./updater');
const { runInitWizard, shouldRunFirstRunInit } = require('./init-wizard');
const { debug, isDebugEnabled } = require('./debug');
const { createTranslator } = require('./i18n');
const { formatPastedInputBadge, formatPastedInputSummary, shouldRunPasteAsCommandBatch } = require('./paste-utils');
const { createApprovalPrompt } = require('./approval-prompt');
const { createTerminalOutput } = require('./terminal-output');
const { createTerminalInput } = require('./terminal-input');
const { bootstrapSession } = require('./session-bootstrap');

const VERSION = require('../package.json').version;

const CLI_FLAGS = {
  NO_COLOR: '--no-color',
  DEBUG: '--debug',
  PRESET: '--preset',
  BATCH: '--batch',
  BATCH_FILE: '--batch-file',
  BATCH_OUTPUT: '--batch-output',
  MODEL: '--model',
  LIST_PRESETS: '--list-presets',
};

const PERMISSION_MODES = {
  NORMAL: 'normal',
  YOLO: 'yolo',
};

const KNOWN_COMMANDS = ['chat', 'init', 'models', 'agents', 'team', 'resume', 'sessions', 'config', 'doctor', 'help', '--help', '-h', '--version', '-v', '-V', CLI_FLAGS.NO_COLOR, CLI_FLAGS.DEBUG, CLI_FLAGS.PRESET, CLI_FLAGS.BATCH, CLI_FLAGS.BATCH_FILE, CLI_FLAGS.BATCH_OUTPUT, CLI_FLAGS.MODEL];
const TOP_LEVEL_COMMAND_SUGGESTIONS = KNOWN_COMMANDS
  .filter((command) => !command.startsWith('-'))
  .map((command) => ({ match: command, suggest: command }));

function createCliTranslator() {
  try {
    const { loadSettings } = require('./config');
    const settings = loadSettings();
    return createTranslator(settings?.ui?.locale);
  } catch (_) {
    return createTranslator('en');
  }
}

async function runBatch(inputFile, outputFile, modelOverride) {
  const { loadSettings: ls } = require('./config');
  const settings = ls();
  if (modelOverride) settings.agent.model = modelOverride;

  const provider = createProvider(settings.agent, process.env);
  const toolRegistry = createLocalToolRegistry({
    root: process.cwd(),
    shellPolicy: settings.tools?.shell,
    undoStack: new UndoStack(),
  });
  registerAgentTeamTools(toolRegistry, { settings, projectRoot: process.cwd() });

  const permissionManager = new PermissionManager({ mode: PERMISSION_MODES.YOLO });
  const session = new Session({
    provider,
    settings,
    toolRegistry,
    permissionManager,
  });
  session.eventBus = new EventBus();

  const exitCode = await runBatchMode({
    session,
    settings,
    inputFile,
    outputFile,
    raw: true,
  });
  return exitCode;
}

function main(argv = process.argv) {
  const args = argv.slice(2);
  const [primary] = args;

  // Handle --no-color early, before any output
  if (args.includes(CLI_FLAGS.NO_COLOR)) {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '0';
    args.splice(args.indexOf(CLI_FLAGS.NO_COLOR), 1);
  }

  // Handle --debug early
  if (args.includes(CLI_FLAGS.DEBUG)) {
    process.env.HAX_AGENT_DEBUG = '1';
    args.splice(args.indexOf(CLI_FLAGS.DEBUG), 1);
  }

  // Handle --preset early
  const presetIdx = args.indexOf(CLI_FLAGS.PRESET);
  if (presetIdx >= 0 && presetIdx + 1 < args.length) {
    activePreset = args[presetIdx + 1];
    args.splice(presetIdx, 2);
  }

  if (args.includes(CLI_FLAGS.LIST_PRESETS)) {
    try {
      const { listPresets } = require('./config-presets');
      console.log('Available presets:');
      for (const p of listPresets()) {
        console.log(`  ${p.name.padEnd(14)} ${p.description}`);
      }
    } catch (_) {
      console.log('No presets available.');
    }
    process.exit(0);
  }

  // Batch mode: non-interactive processing
  if (args.includes(CLI_FLAGS.BATCH) || args.includes(CLI_FLAGS.BATCH_FILE)) {
    const batchInputIdx = args.indexOf(CLI_FLAGS.BATCH_FILE);
    const batchInputFile = batchInputIdx >= 0 ? args[batchInputIdx + 1] : null;
    const batchOutputIdx = args.indexOf(CLI_FLAGS.BATCH_OUTPUT);
    const batchOutputFile = batchOutputIdx >= 0 ? args[batchOutputIdx + 1] : null;
    const modelIdx = args.indexOf(CLI_FLAGS.MODEL);
    const batchModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
    runBatch(batchInputFile, batchOutputFile, batchModel).then((exitCode) => process.exit(exitCode));
    return;
  }

  switch (primary) {
    case '--version':
    case '-v':
    case '-V':
      console.log(`hax-agent-cli v${VERSION}`);
      console.log(`Node.js ${process.version} · ${process.platform} ${process.arch}`);
      break;
    case 'help':
    case '--help':
    case '-h': {
      const t = createCliTranslator();
      console.log(t('cli.help.title', { version: VERSION }));
      console.log(`  hax-agent [chat]               ${t('cli.help.chat')}`);
      console.log(`  hax-agent init                 ${t('cli.help.init')}`);
      console.log(`  hax-agent models               ${t('cli.help.models')}`);
      console.log(`  hax-agent agents               ${t('cli.help.agents')}`);
      console.log(`  hax-agent team auth-refactor   ${t('cli.help.team')}`);
      console.log(`  hax-agent doctor               ${t('cli.help.doctor')}`);
      console.log(`  hax-agent help                 ${t('cli.help.help')}`);
      console.log(`  hax-agent sessions             ${t('cli.help.sessions')}`);
      console.log(`  hax-agent resume [session-id]  ${t('cli.help.resume')}`);
      console.log(`  hax-agent config [edit]        ${t('cli.help.config')}`);
      console.log(`  hax-agent config --json        ${t('cli.help.configJson')}`);
      console.log(`  hax-agent --batch               ${t('cli.help.batch')}`);
      console.log(`  hax-agent --batch-file <file>   ${t('cli.help.batchFile')}`);
      console.log(`  hax-agent --batch-output <file> ${t('cli.help.batchOutput')}`);
      console.log(`  hax-agent --model <id>          ${t('cli.help.batchModel')}`);
      console.log(`  hax-agent --preset <name>       ${t('cli.help.preset', { presets: 'coding|autonomous|review|chat|ci|learn' })}`);
      console.log(`  hax-agent -v, --version        ${t('cli.help.version')}`);
      console.log(`  hax-agent --no-color           ${t('cli.help.noColor')}`);
      console.log(`  hax-agent --debug              ${t('cli.help.debug')}`);
      break;
    }
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
        const t = createCliTranslator();
        console.error(t('cli.errors.unknownCommand', { command: primary }));
        if (suggestion) console.error(t('cli.errors.didYouMean', { command: suggestion }));
        console.log(t('cli.errors.usage'));
        console.log(t('cli.errors.showHelp'));
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
    quickMode: args.includes('--quick'),
  }).catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    debug('cli', 'Failed to initialize: ' + errMsg);
    console.error(`Failed to initialize: ${errMsg}`);
    process.exit(1);
  });
}

function runModelsCommand(args) {
  const settings = resolveSettings();
  const provider = createProvider(settings.agent, process.env);
  const { printModels } = require('./commands');

  printModels(provider, { write: (s) => process.stdout.write(stripAnsi(s)) })
    .catch((err) => { const errMsg = err instanceof Error ? err.message : String(err); debug('cli', 'Failed to list models: ' + errMsg); console.error(`Failed to list models: ${errMsg}`); process.exit(1); });
}

function runAgentsCommand() {
  const settings = resolveSettings();
  const { loadAgentDefinitions } = require('./teams/agents');
  const { formatAgentList } = require('./teams/agent-teams-formatter');

  const definitions = loadAgentDefinitions({
    projectRoot: settings.projectRoot || process.cwd(),
    settings,
  });
  console.log(formatAgentList(definitions));
}

function runTeamCommand(args) {
  if (args.length === 0) {
    debug('cli', 'No team command specified');
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
    const { formatTeamPlan } = require('./teams/team-plan-formatter');
    const team = createAuthRefactorTeam();
    console.log(formatTeamPlan(team));
    return;
  }

  const settings = resolveSettings();
  const { createCliTeamRuntime, executeTeamCommand } = require('./commands');
  const runtime = createCliTeamRuntime(settings);

  executeTeamCommand(runtime, args[0] || 'help', args.slice(1), { settings })
    .then((output) => {
      if (output) console.log(output);
    })
    .catch((err) => {
      debug('cli', 'Team command error: ' + err.message);
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
    const editor = process.env.EDITOR || process.env.VISUAL;
    const editorCmd = resolveEditorCommand(editor, process.platform);
    const editorArgs = configPath ? [configPath] : [];
    const child = spawn(editorCmd, editorArgs, {
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => {
      if (code !== 0) console.error(`Editor exited with code ${code}`);
    });
    return;
  }

  if (args[0] === '--json') {
    const clone = JSON.parse(JSON.stringify(settings));
    if (clone.agent?.apiKey) clone.agent.apiKey = '***';
    console.log(JSON.stringify(clone, null, 2));
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

async function runResumeCommand(args) {
  const settings = resolveSettings();
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
    debug('cli', 'Session not found: ' + (sessionId || 'latest'));
    console.error('Session not found.');
    process.exit(1);
  }

  const entries = targetSession.entries();
  const messages = entries
    .filter((e) => e.role === 'user' || e.role === 'assistant')
    .slice(-resolveTranscriptMessageLimit(settings))
    .map((e) => ({ role: e.role, content: e.content || '' }));

  let session;
  try {
    ({ session } = await bootstrapSession({
      settings,
      args: [],
      root: process.cwd(),
      createInputPipeline,
      createPluginManager,
      _setupBackgroundTasks,
      _teardownBackgroundTasks,
      _shutdownManager,
      _SHUTDOWN_PRIORITY,
      setupKnowledgeManagement,
      createTranslator,
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    debug('cli', 'Failed to resume session: ' + errMsg);
    console.error(`Failed to resume session: ${errMsg}`);
    process.exit(1);
  }

  session.messages = messages;
  session.id = targetSession.id;

  runShell([], session);
}

function createReadlineOutput(output = process.stdout) {
  return {
    muted: false,
    get columns() { return output.columns; },
    get rows() { return output.rows; },
    get isTTY() { return output.isTTY; },
    write(data, ...args) {
      if (this.muted) {
        const callback = args.find((arg) => typeof arg === 'function');
        if (callback) process.nextTick(callback);
        return true;
      }
      return output.write(data, ...args);
    },
    on: (...args) => output.on(...args),
    off: (...args) => output.off(...args),
    once: (...args) => output.once(...args),
    removeListener: (...args) => output.removeListener(...args),
  };
}

function runSessionsCommand(args) {
  const settings = resolveSettings();

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
    const preview = formatSessionPreview(s, 80);
    const date = new Date(s.updatedAt).toLocaleDateString();
    console.log(`${s.id.slice(0, 20)}  ${date}  ${preview}`);
  }
  console.log('\nRun "hax-agent sessions clear" to delete all sessions.');
}

async function runDoctorCommand() {
  const settings = resolveSettings();
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
  try {
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
  
    const {
      settings: bootSettings,
      provider,
      screen,
      markdown,
      permissionManager,
      toolRegistry,
      session: bootSession,
      history,
      t,
      pluginRegistry,
      pluginManager,
    } = await bootstrapSession({
      args,
      settings: resolvedSettings.settings,
      explicitSession,
      root: process.cwd(),
      createInputPipeline,
      createPluginManager,
      _setupBackgroundTasks,
      _teardownBackgroundTasks,
      _shutdownManager,
      _SHUTDOWN_PRIORITY,
      setupKnowledgeManagement,
      createTranslator,
    });
  
    const settings = bootSettings;
    const session = bootSession;
  
    const readlineOutput = createReadlineOutput(process.stdout);
    const rl = readline.createInterface({
      input: process.stdin,
      output: readlineOutput,
      terminal: true,
    });
  
    const terminalOutput = createTerminalOutput({ screen, session, rl, readlineOutput });
    const {
      mainPrompt,
      withInputAreaHidden,
      prompt,
      setContinuationPrompt,
      clearActivePrompt,
      activateInputArea,
    } = terminalOutput;
  
    rl.setPrompt(screen.isTTY() ? terminalOutput.inputLinePrompt() : mainPrompt());
  
    screen.activate();
  
    if (settings.ui?.autoClearScreen) {
      screen.clear();
    }
  
    // Input handling (keypress, vim mode, reverse search, tab complete)
    // is managed by the terminal-input module — see createTerminalInput below.
  
    toolRegistry.approvalCallback = createApprovalPrompt({ screen, t });
  
    renderBanner(screen, session);
  
    if (session.provider.name === 'mock' || session.provider.name === 'local') {
      screen.write(styled(THEME.warning, `! ${t('shell.mockMode')}`) + '\n\n');
    }
  
    if (session.permissionManager.mode === PERMISSION_MODES.YOLO) {
      screen.write(styled(THEME.warning, `! ${t('shell.yoloMode')}`) + '\n\n');
    } else {
      const permLabel = session.permissionManager.mode === PERMISSION_MODES.NORMAL ? t('common.mode.standard') : session.permissionManager.mode;
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
  
    activateInputArea();
    prompt();
  
    if (!wasRestarted()) {
      checkForUpdate(VERSION).then(async (result) => {
        if (!result.hasUpdate) return;
  
        withInputAreaHidden(() => {
          screen.write(
            `\n${styled(THEME.warning, `⬆ New version available: v${result.currentVersion} → v${result.latestVersion}`)}\n`
          );
        });
  
        if (!settings.updates?.autoInstall) {
          withInputAreaHidden(() => {
            screen.write(`${styled(THEME.dim, '  Run /update install to update now.')}\n\n`);
          });
          prompt();
          return;
        }
  
        withInputAreaHidden(() => {
          screen.write(`${styled(THEME.dim, '  Auto-install is enabled. Updating...')}\n`);
        });
  
        try {
          await performUpdate();
          withInputAreaHidden(() => {
            screen.write(`${styled(THEME.success, '  OK Update complete. Restarting...')}\n\n`);
          });
          setTimeout(() => restartProcess(), 500);
        } catch (err) {
          withInputAreaHidden(() => {
            screen.write(
              `${styled(THEME.error, `  ✖ Auto-update failed: ${err.message}`)}\n` +
              `${styled(THEME.dim, '  Run manually: npm install -g hax-agent-cli')}\n\n`
            );
          });
          prompt();
        }
      }).catch((err) => {
        debug('updater', `Update check failed: ${err.message}`);
      });
    }
  
    // Input state managed by terminal-input module.
    session.interactivePromptActive = false;
  
    const terminalInput = createTerminalInput({
      rl,
      screen,
      session,
      history,
      callbacks: {
        onProcessLine: processLine,
        getMainPrompt: mainPrompt,
        onSetContinuationPrompt: setContinuationPrompt,
        clearActivePrompt,
        prompt,
        withInputAreaHidden,
      },
    });
  
    /**
     * Perform a clean exit: show file changes, session stats, save transcript, then quit.
     * Shared by /exit, /quit, /q, and double-Ctrl+C.
     */
    function performCleanExit(session, screen, t) {
      session.shouldExit = true;
      withInputAreaHidden(() => {
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
      });
      screen.deactivate();
  
      // Delegate to ShutdownManager for coordinated teardown.
      // Hooks run in priority order: bg-teardown → flush-logs → release-locks → session-end → shutdown-log.
      // If ShutdownManager is unavailable, perform a direct process.exit.
      if (_shutdownManager) {
        try {
          const sm = _shutdownManager();
          sm.shutdown({ reason: 'user', exitCode: 0 });
          return; // shutdown() calls process.exit internally
        } catch (_) { /* fall through to direct exit */ }
      }
  
      // Fallback: direct exit when ShutdownManager is not available
      if (session.eventBus) {
        try {
          session.eventBus.emit('session:end', {
            sessionId: session.id,
            timestamp: new Date().toISOString(),
          });
        } catch (_) {}
      }
      if (session.pluginRegistry) {
        session.pluginRegistry.runHook('onSessionEnd', { session }).catch(() => {});
      }
      process.exit(0);
    }
  
    // Line handling and paste detection are managed by terminal-input module.
    // See createTerminalInput() call above.
  
    async function processLine(line, options = {}) {
      history.add(line);
      const trimmed = line.trim();
      const isSingleLineInput = !String(line).includes('\n');
  
      if (isSingleLineInput && trimmed.startsWith('/')) {
        if (trimmed === '/exit' || trimmed === '/quit' || trimmed === '/q') {
          withInputAreaHidden(() => {
            screen.clearLine();
            screen.write(trimmed + '\n');
          });
          performCleanExit(session, screen, t);
          return;
        }
  
        if (trimmed === '/vim') {
          const newVimMode = !terminalInput.getVimMode();
          terminalInput.setVimMode(newVimMode);
          terminalInput.setVimInsertMode(true);
          withInputAreaHidden(() => {
            screen.clearLine();
            screen.write(trimmed + '\n');
            screen.write(styled(THEME.success, t('shell.vimMode', { state: newVimMode ? t('common.enabled') : t('common.disabled') })) + '\n');
          });
          prompt();
          return;
        }
  
        const [commandName, ...cmdArgs] = trimmed.slice(1).split(/\s+/);
  
        if (commandName === 'clear' || commandName === 'c') {
          session.isStreaming = false;
          const clearedCount = session.messages.length;
          session.messages = [];
          session.id = require('./memory').createSessionId();
          session.costTracker = new CostTracker();
          screen.clear();
          renderBanner(screen, session);
          screen.write(styled(THEME.success, t('shell.contextCleared', { count: clearedCount })) + '\n');
          screen.write(styled(THEME.dim, t('shell.clearHint')) + '\n\n');
          prompt();
          return;
        }
  
        withInputAreaHidden(() => {
          screen.clearLine();
          screen.write(trimmed + '\n');
        });
  
        await handleSlashCommand(trimmed, { screen, session, markdown, rl, input: process.stdin, output: process.stdout });
        prompt();
        return;
      }
  
      if (session.isStreaming) {
        withInputAreaHidden(() => {
          screen.write(styled(THEME.warning, t('shell.cannotSend')) + '\n');
        });
        prompt();
        return;
      }
  
      if (!trimmed) {
        prompt();
        return;
      }
  
      if (isSingleLineInput && trimmed.startsWith('!')) {
        const shellLine = trimmed.slice(1).trim();
        if (!shellLine) {
          prompt();
          return;
        }
  
        // Check permission before executing !command
        const bangPermission = await session.permissionManager.checkPermission(
          'shell.run',
          { command: shellLine },
          session.toolRegistry.approvalCallback || null,
        );
        if (!bangPermission.approved) {
          withInputAreaHidden(() => {
            screen.write(styled(THEME.warning, `! Command denied: ${bangPermission.reason}`) + '\n');
          });
          prompt();
          return;
        }
  
        withInputAreaHidden(() => {
          screen.clearLine();
          screen.write(styled(THEME.shellIndicator, `!${shellLine}`) + '\n');
        });

        // Reject commands containing newlines (command injection via pasted input)
        if (shellLine.includes('\n') || shellLine.includes('\r')) {
          withInputAreaHidden(() => {
            screen.write(styled(THEME.error, '! Command rejected: multi-line input not allowed') + '\n');
          });
          prompt();
          return;
        }

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
              withInputAreaHidden(() => {
                screen.write(styled(THEME.warning, `Exit code: ${code}`) + '\n');
              });
            }
            prompt();
            resolve();
          });
          child.on('error', (err) => {
            withInputAreaHidden(() => {
              screen.write(styled(THEME.error, `Command error: ${err.message}`) + '\n');
            });
            prompt();
            resolve();
          });
        });
        return;
      }
  
      // --- Safety pipeline: sanitize, detect, warn, block ---
      let cleanedText = trimmed;
      if (session.inputPipeline) {
        try {
          const result = session.inputPipeline.processInput(trimmed);
          if (result.blocked) {
            withInputAreaHidden(() => {
              screen.write(styled(THEME.error, `\n  Input blocked:`));
              if (result.warnings.length > 0) {
                screen.write(' ' + result.warnings.join('; '));
              }
              screen.write('\n\n');
            });
            prompt();
            return;
          }
          if (result.warnings.length > 0) {
            withInputAreaHidden(() => {
              screen.write(styled(THEME.warning, `  Warning: ${result.warnings.join('; ')}`));
              screen.write('\n');
            });
          }
          cleanedText = result.cleaned || trimmed;
        } catch (_) { /* safety pipeline is best-effort */ }
      }
  
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Highlight slash commands in user echo: /cmd args → colored /cmd + dim args
      let echoLine = options.pasted ? formatPastedInputBadge(trimmed) : trimmed;
      if (!options.pasted && trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) {
          echoLine = styled(THEME.accent, trimmed);
        } else {
          echoLine = styled(THEME.accent, trimmed.slice(0, spaceIdx)) + ' ' + styled(THEME.dim, trimmed.slice(spaceIdx + 1));
        }
      }
      withInputAreaHidden(() => {
        screen.clearLine();
        screen.write('\n');
        screen.write(`${styled(THEME.userIndicator, `You ${time}`)}  ${echoLine}\n`);
      });
  
      await handleChatMessage(cleanedText, { screen, session, markdown });
      prompt();
    }
  
    rl.on('close', () => {
      if (terminalOutput.getInputAreaActive() && screen.isTTY()) {
        screen.resetScrollRegion();
      }
      screen.cursorTo(screen.rows, 1);
      screen.write('\n');
      if (session.shouldExit) {
        screen.deactivate();
        process.exit(0);
      }
      session.shouldExit = false;
      terminalInput.setPendingExitCount(0);
    });
  
    process.stdin.on('keypress', (char, key) => {
      if (!key) return;
      if (session.interactivePromptActive) return;
      if (key.name === 'paste-start' || key.name === 'paste-end' || terminalInput.getBracketedPasteActive()) return;
  
      if (key.name === 'c' && key.ctrl) {
        if (session.isStreaming) {
          session.responseInterrupted = true;
          if (session.responseAbortController) {
            session.responseAbortController.abort();
          }
          withInputAreaHidden(() => {
            screen.write('\n' + styled(THEME.warning, '^C') + '\n');
          });
          return;
        }
  
        const count = terminalInput.getPendingExitCount() + 1;
        terminalInput.setPendingExitCount(count);
        if (count === 1) {
          withInputAreaHidden(() => {
            screen.write('\n' + styled(THEME.warning, t('shell.ctrlCExit')) + '\n');
          });
          prompt();
          setTimeout(() => { terminalInput.setPendingExitCount(0); }, 2000);
        } else {
          withInputAreaHidden(() => {
            screen.write('\n');
          });
          performCleanExit(session, screen, t);
        }
        return;
      }
  
      if (key.name === 'l' && key.ctrl) {
        if (terminalOutput.getInputAreaActive() && screen.isTTY()) {
          screen.resetScrollRegion();
        }
        screen.clear();
        renderBanner(screen, session);
        activateInputArea();
        prompt();
        return;
      }
  
      if (key.name === 'tab' && key.shift) {
        const modes = [PERMISSION_MODES.NORMAL, PERMISSION_MODES.YOLO];
        const currentIndex = modes.indexOf(session.permissionManager.mode);
        const newMode = modes[(currentIndex + 1) % modes.length];
        session.permissionManager.mode = newMode;
  
        const modeLabel = newMode === PERMISSION_MODES.YOLO ? 'YOLO' : t('common.mode.standard');
        const modeColor = newMode === PERMISSION_MODES.YOLO ? THEME.warning : THEME.success;
  
        withInputAreaHidden(() => {
          screen.write(`\n${modeColor}╭────────────────────────────────────╮${ANSI.reset}\n`);
          screen.write(`${modeColor}│${ANSI.reset}  ${t('shell.permissionSwitched', { mode: styled(modeColor + THEME.bold, modeLabel) })}\n`);
          screen.write(`${modeColor}│${ANSI.reset}\n`);
          screen.write(`${modeColor}│${ANSI.reset}  ${styled(THEME.dim, t('shell.permissionShortcut'))}\n`);
          screen.write(`${modeColor}╰────────────────────────────────────╯${ANSI.reset}\n\n`);
        });
  
        prompt();
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (process.stdout.isTTY) {
      process.stdout.write('\x1B[?25h');
      process.stdout.write('\x1B[0m');
    }
    process.stderr.write(`\nFatal error in interactive shell: ${errMsg}\n`);
    if (isDebugEnabled()) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  setupErrorHandlers();
  main();
}

function setupErrorHandlers() {
  const isDebug = process.env.HAX_AGENT_DEBUG === '1';

  process.on('uncaughtException', (error) => {
    // Try to reset terminal state
    if (process.stdout.isTTY) {
      process.stdout.write('\x1B[?25h'); // show cursor
      process.stdout.write('\x1B[0m');  // reset colors
    }
    process.stderr.write(`\n\x1B[91mFatal error:\x1B[0m ${error.message}\n`);
    if (isDebug) {
      process.stderr.write(`\n${error.stack}\n`);
    }
    process.stderr.write('\nRun with --debug for full stack trace.\n');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1B[?25h');
      process.stdout.write('\x1B[0m');
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`\n\x1B[91mUnhandled rejection:\x1B[0m ${message}\n`);
    if (isDebug && reason instanceof Error) {
      process.stderr.write(`\n${reason.stack}\n`);
    }
    process.stderr.write('\nRun with --debug for full stack trace.\n');
    process.exit(1);
  });
}

module.exports = { main, shouldRunPasteAsCommandBatch, formatPastedInputSummary, formatPastedInputBadge };
