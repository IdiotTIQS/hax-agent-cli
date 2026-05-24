const path = require('node:path');
const { loadSettings, updateUserSettings } = require('../config');
const { createSessionId, listSessions, readTranscript } = require('../memory');
const { createProvider } = require('../providers');
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require('../skills');
const { buildSkillSystemPrompt, matchSkillByIntent, getSkillsForSession } = require('../skills/intent-matcher');
const { loadAgentDefinitions } = require('../teams/agents');
const { formatTeamPlan } = require('../teams/team-plan-formatter');
const { PERMISSION_LABELS } = require('../permissions');
const {
  THEME, TerminalScreen, MarkdownRenderer, ResponseRenderer,
  formatProviderError, VERSION, CLAUDE_BANNER, ANSI, styled,
} = require('../renderer');
const { Session, CostTracker } = require('../session');
const { checkForUpdate, performUpdate, restartProcess } = require('../updater');
const { PROVIDERS, chooseOptionWithArrows } = require('../init-wizard');
const { createTranslator, getLocaleLabel, listLocales, normalizeLocale } = require('../i18n');
const { suggestCommand } = require('../command-suggestions');
const { AgentEngine, AgentEventType } = require('../agent-engine');
const {
  SLASH_COMMANDS, SKILLS_SUBCOMMANDS, PERMISSIONS_SUBCOMMANDS,
  MEMORY_SUBCOMMANDS, CONTEXT_SUBCOMMANDS, TEAM_SUBCOMMANDS,
  PERSONALITY_SUBCOMMANDS, isThemeEnabled, setThemeEnabled,
  isVimMode, setVimMode,
} = require('./definitions');
const { handleMemoryCommand: executeMemoryCommand } = require('./memory');
const { createCliTeamRuntime, executeTeamCommand } = require('./team');
const { resolveContextWindowTokens, inferModelContextWindowTokens } = require('../context-window');
const { exportSessionToMarkdown, exportSessionToJson, exportSessionToText } = require('../export');
const { UndoStack } = require('../undo-stack');
const { handleHealthCommand, handleMetricsCommand, handleAuditCommand } = require('./dashboard');
const { handlePersonalityCommand } = require('./personality');
const { handleAnalyticsCommand, handleReportCommand } = (() => {
  try { return require('./analytics'); } catch (_) { return {}; }
})();
const { handlePluginCommand } = require('./plugin');

function getTranslator(session) {
  return createTranslator(session?.settings?.ui?.locale);
}

function getSlashCommandSuggestion(commandName) {
  const candidates = SLASH_COMMANDS.flatMap((command) => [
    { match: command.name, suggest: command.name },
    ...(command.aliases || []).map((alias) => ({ match: alias, suggest: command.name })),
  ]);
  return suggestCommand(commandName, candidates);
}

function getSubcommandSuggestion(commandName, subCommand) {
  const candidatesByCommand = {
    skills: SKILLS_SUBCOMMANDS,
    permissions: PERMISSIONS_SUBCOMMANDS,
    memory: MEMORY_SUBCOMMANDS,
    context: CONTEXT_SUBCOMMANDS,
    cache: CONTEXT_SUBCOMMANDS,
    team: TEAM_SUBCOMMANDS,
    personality: PERSONALITY_SUBCOMMANDS,
  };
  const suggestion = suggestCommand(subCommand, candidatesByCommand[commandName] || []);
  return suggestion ? `/${commandName} ${suggestion}` : null;
}

function writeCommandSuggestion(screen, t, suggestion) {
  if (!suggestion) return;
  screen.write(`${THEME.dim}${t('errors.didYouMean', { command: suggestion })}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}💡 ${t('errors.tabHint')}${ANSI.reset || ''}\n`);
}

async function promptForOption({ screen, session, name, options, defaultValue, t }) {
  if (!screen.isTTY()) return null;

  const defaultIndex = Math.max(0, options.findIndex((option) => option.value === defaultValue));
  session.interactivePromptActive = true;

  try {
    return await chooseOptionWithArrows({
      input: process.stdin,
      output: process.stdout,
      name,
      options,
      defaultIndex,
      t,
    });
  } finally {
    session.interactivePromptActive = false;
  }
}

function renderBanner(screen, session) {
  const t = getTranslator(session);
  for (const line of CLAUDE_BANNER) {
    screen.write(`${line}\n`);
  }

  const provider = session.provider?.name || 'provider';
  const model = session.provider?.model || 'model';
  screen.write(`${THEME.dim}  ${t('banner.modelProvider', { model, provider })}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}  ${t('banner.help')}${ANSI.reset || ''}\n\n`);
}

function renderStatusLine(screen, session) {
  const width = screen.columns || 80;
  const { stripAnsi } = require('../renderer');
  const statusText = stripAnsi(session.getStatusLine());
  const statusLen = statusText.length;
  const padding = Math.max(0, width - statusLen - 2);

  screen.write(`\r${ANSI.clearLine || ''}`);
  screen.write(`${THEME.statusLine} ${session.getStatusLine()} ${' '.repeat(padding)}${ANSI.reset || ''}\n`);
}

function loadRecentTranscript(session) {
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) return;

  const latestSession = sessions[0];
  const entries = latestSession.entries();
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-resolveTranscriptMessageLimit(session.settings))
    .map(e => ({ role: e.role, content: e.content || '' }));

  if (restored.length > 0) {
    session.messages = restored;
    session.id = latestSession.id;
  }

  // Restore persisted goal from transcript
  try {
    const { restoreGoal } = require('../goal-persistence');
    const savedGoal = restoreGoal(latestSession.id, { settings: session.settings });
    if (savedGoal) {
      session.goal = savedGoal;
    }
  } catch (_) {
    // goal-persistence module not available — skip
  }
}

async function handleChatMessage(content, { screen, session, markdown }) {
  const renderer = new ResponseRenderer(screen, markdown);
  const engine = new AgentEngine({ session, projectRoot: session.settings.projectRoot });

  for await (const event of engine.sendMessage(content)) {
    renderAgentEvent(event, { screen, session, renderer });
  }
}

async function handleSkillInvocation(skill, args, { screen, session, markdown }) {
  const renderer = new ResponseRenderer(screen, markdown);
  const engine = new AgentEngine({ session, projectRoot: session.settings.projectRoot });

  for await (const event of engine.invokeSkill(skill, args)) {
    renderAgentEvent(event, { screen, session, renderer });
  }
}

function renderAgentEvent(event, { screen, session, renderer }) {
  switch (event.type) {
    case AgentEventType.skillMatched:
      screen.write(`${THEME.dim}Auto-invoking skill: ${event.skill.displayName || event.skill.name}${ANSI.reset || ''}\n`);
      break;
    case AgentEventType.skillStart:
      screen.write(`${THEME.skillIndicator}Skill${ANSI.reset || ''} ${THEME.accent}${event.skill.displayName || event.skill.name}${ANSI.reset || ''}\n`);
      break;
    case AgentEventType.started:
      session.responseRenderer = renderer;
      renderer.startWaiting();
      break;
    case AgentEventType.messageDelta:
      renderer.writeText(event.delta);
      break;
    case AgentEventType.thinking:
      renderer.thinking(event);
      break;
    case AgentEventType.toolStart:
      renderer.startTool(toProviderChunk('tool_start', event));
      break;
    case AgentEventType.toolResult: {
      const chunk = toProviderChunk('tool_result', event);
      renderer.finishTool(chunk);
      // Track modified files for session change summary
      trackFileModification(session, chunk);
      break;
    }
    case AgentEventType.toolLimit:
      if (event.reason !== 'empty_tool_preamble') {
        renderer.notice(`Tool turn limit reached after ${event.maxToolTurns} turns. Type /continue if you need more.`);
      }
      break;
    case AgentEventType.completed:
      renderer.complete(event.usage);
      break;
    case AgentEventType.interrupted:
      renderer.interrupt();
      break;
    case AgentEventType.failed:
      if (event.skill && !event.provider) {
        screen.write(`${THEME.error}Skill execution failed: ${event.error.message}${ANSI.reset || ''}\n`);
      } else {
        renderer.fail(formatProviderError(event.error, session.provider));
      }
      break;
    default:
      break;
  }
}

function toProviderChunk(type, event) {
  const chunk = { ...event, type };
  delete chunk.sessionId;
  delete chunk.timestamp;
  delete chunk.provider;
  delete chunk.status;
  return chunk;
}

async function handleSlashCommand(line, context) {
  const [commandName, ...args] = line.slice(1).split(/\s+/);

  // Use dynamic registry if available, otherwise fall back to static lookup
  const registry = context.session?.commandRegistry || null;
  const command = registry
    ? registry.findCommand(commandName)
    : SLASH_COMMANDS.find(c => c.name === commandName || c.aliases?.includes(commandName));

  if (!command) {
    const skills = loadAllSkills(context.session.settings.projectRoot || process.cwd());
    const skillify = createSkillifySkill(context.session.messages);
    const allSkills = [skillify, ...skills];
    const matchedSkill = allSkills.find((s) => s.name === commandName && !s.isHidden);

    if (matchedSkill) {
      recordSkillUsage(matchedSkill.name);
      await handleSkillInvocation(matchedSkill, args, context);
      return;
    }

    const t = getTranslator(context.session);
    const suggestion = getSlashCommandSuggestion(commandName);
    context.screen.write(`${THEME.error}${t('errors.unknownCommand', { command: commandName })}${ANSI.reset || ''}\n`);
    if (suggestion) {
      context.screen.write(`${THEME.dim}${t('errors.didYouMean', { command: `/${suggestion}` })}${ANSI.reset || ''}\n`);
    }
    context.screen.write(`${THEME.dim}${t('errors.typeHelp')}${ANSI.reset || ''}\n`);
    context.screen.write(`${THEME.dim}💡 ${t('errors.tabHint')}${ANSI.reset || ''}\n`);
    return;
  }

  const handler = registry
    ? registry.getHandler(command.name)
    : COMMAND_HANDLERS[command.name];
  if (!handler) {
    context.screen.write(`${THEME.error}Command not implemented: /${command.name}${ANSI.reset || ''}\n`);
    return;
  }

  await handler(args, context);
}

const COMMAND_HANDLERS = Object.freeze({
  help: (_args, context) => showShellHelp(context),
  exit: (_args, context) => exitShell(context),
  clear: (_args, context) => clearShell(context),
  compact: (_args, context) => compactShell(context),
  tools: (_args, context) => showTools(context),
  skills: (args, context) => showSkills(args, context),
  skillify: (args, context) => handleSkillifyCommand(args, context),
  goal: (args, context) => handleGoalCommand(args, context),
  agents: (_args, context) => showAgents(context),
  team: (args, context) => handleTeamCommand(args, context),
  models: (_args, context) => showModels(context),
  model: (args, context) => switchModel(args, context),
  provider: (args, context) => switchProvider(args, context),
  'api-url': (args, context) => switchApiUrl(args, context),
  'api-key': (args, context) => switchApiKey(args, context),
  language: (args, context) => switchLanguage(args, context),
  cost: (_args, context) => showCost(context),
  context: (args, context) => handleContextCommand(args, context),
  sessions: (args, context) => handleSessionsCommand(args, context),
  resume: (args, context) => resumeSession(args, context),
  config: (args, context) => showConfig(context, args),
  doctor: (_args, context) => runDoctor(context),
  theme: (_args, context) => toggleTheme(context),
  vim: (_args, context) => toggleVim(context),
  memory: (args, context) => handleMemoryCommand(args, context),
  permissions: (args, context) => handlePermissionsCommand(args, context),
  update: (args, context) => handleUpdateCheck(args, context),
  copy: (_args, context) => copyLastResponse(context),
  rename: (args, context) => renameSession(args, context),
  status: (_args, context) => showStatus(context),
  undo: (_args, context) => handleUndo(context),
  redo: (_args, context) => handleRedo(context),
  export: (args, context) => handleExport(args, context),
  health: (_args, context) => handleHealthCommand(_args, context),
  metrics: (_args, context) => handleMetricsCommand(_args, context),
  audit: (_args, context) => handleAuditCommand(_args, context),
  personality: (args, context) => handlePersonalityCommand(args, context),
  analytics: (args, context) => {
    if (typeof handleAnalyticsCommand === 'function') {
      return handleAnalyticsCommand(args, context);
    }
    context.screen.write(`${THEME.warning}Analytics module not available.${THEME.reset || ''}\n`);
  },
  report: (args, context) => {
    if (typeof handleReportCommand === 'function') {
      return handleReportCommand(args, context);
    }
    context.screen.write(`${THEME.warning}Report module not available.${THEME.reset || ''}\n`);
  },
  plugin: (args, context) => handlePluginCommand(args, context),
});

function listCommandHandlerNames() {
  return Object.keys(COMMAND_HANDLERS);
}

function showShellHelp({ screen, session }) {
  const t = getTranslator(session);
  const width = Math.min(screen.columns || 80, 80);
  const borderLine = THEME.border + '─'.repeat(width - 2) + (ANSI.reset || '');

  screen.write(`\n${THEME.heading}${t('help.commands')}${ANSI.reset || ''}\n`);
  screen.write(`${borderLine}\n`);

  for (const cmd of SLASH_COMMANDS) {
    const aliases = cmd.aliases.length > 0 ? ` ${THEME.dim}(${cmd.aliases.map(a => `/${a}`).join(', ')})${ANSI.reset || ''}` : '';
    const argHint = cmd.argHint ? ` ${THEME.dim}${cmd.argHint}${ANSI.reset || ''}` : '';
    const nameCol = `/${cmd.name}`.padEnd(14);
    screen.write(`  ${THEME.promptPrefix}${nameCol}${ANSI.reset || ''} ${t(cmd.descriptionKey)}${aliases}${argHint}\n`);
  }

  screen.write(`\n${THEME.heading}${t('help.shortcuts')}${ANSI.reset || ''}\n`);
  screen.write(`${borderLine}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+C${ANSI.reset || ''}       ${THEME.dim}${t('help.ctrlC')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+L${ANSI.reset || ''}       ${THEME.dim}${t('help.ctrlL')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+R${ANSI.reset || ''}       ${THEME.dim}${t('help.ctrlR')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Tab${ANSI.reset || ''}          ${THEME.dim}${t('help.tab')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+\u2190/\u2192${ANSI.reset || ''}   ${THEME.dim}${t('help.ctrlArrow')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}\u2191/\u2193${ANSI.reset || ''}         ${THEME.dim}${t('help.history')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Shift+Tab${ANSI.reset || ''}     ${THEME.dim}${t('help.shiftTab')}${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}!command${ANSI.reset || ''}      ${THEME.dim}${t('help.bang')}${ANSI.reset || ''}\n`);
  screen.write('\n');
}

function exitShell({ screen, session }) {
  const t = getTranslator(session);
  session.shouldExit = true;
  // Show file change summary if any files were modified
  if (session.modifiedFiles && session.modifiedFiles.size > 0) {
    const files = [...session.modifiedFiles].sort();
    screen.write(`\n${THEME.heading}${t('shell.filesModified', { count: files.length })}${ANSI.reset || ''}\n`);
    for (const f of files) {
      screen.write(`  ${THEME.accent}${f}${ANSI.reset || ''}\n`);
    }
  }
  const cost = session.costTracker.getCost(session.provider?.model);
  screen.write(`\n${THEME.success}${t('shell.sessionEnded')}${ANSI.reset || ''} ${THEME.dim}${t('shell.sessionStats', { cost: cost.toFixed(4), turns: session.costTracker.turnCount })}${ANSI.reset || ''}\n`);
}

function clearShell({ screen, session }) {
  const t = getTranslator(session);
  const clearedCount = session.messages.length;
  session.messages = [];
  session.id = createSessionId();
  session.costTracker = new CostTracker();
  screen.clear();
  renderBanner(screen, session);
  screen.write(`${THEME.success}${t('shell.contextCleared', { count: clearedCount })}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}${t('shell.clearHint')}${ANSI.reset || ''}\n\n`);
}

function compactShell({ screen, session }) {
  const keepCount = Math.min(session.messages.length, 6);
  const removed = session.messages.length - keepCount;
  session.messages = session.messages.slice(-keepCount);
  screen.write(`${THEME.success}Compacted.${ANSI.reset || ''} ${THEME.dim}Kept last ${keepCount} messages, removed ${removed}.${ANSI.reset || ''}\n\n`);
}

function showTools({ screen, session }) {
  const t = getTranslator(session);
  screen.write(`\n${THEME.heading}${t('tools.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  for (const tool of session.toolRegistry.list()) {
    const nameCol = tool.name.padEnd(14);
    screen.write(`  ${THEME.toolIndicator}${nameCol}${ANSI.reset || ''} ${tool.description}\n`);
  }
  screen.write('\n');
}

function showSkills(args, { screen, session }) {
  const t = getTranslator(session);
  const [subCommand] = args;

  if (!subCommand || subCommand === 'list') {
    const skills = loadAllSkills(session.settings.projectRoot || process.cwd());
    const skillify = createSkillifySkill(session.messages);
    const allSkills = [skillify, ...skills];

    screen.write(`\n${THEME.heading}${t('skills.title')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

    for (const skill of allSkills) {
      if (skill.isHidden) continue;
      const nameCol = skill.displayName.padEnd(18);
      const source = skill.source !== 'bundled' ? ` ${THEME.dim}[${skill.source}]${ANSI.reset || ''}` : '';
      const hint = skill.argumentHint ? ` ${THEME.dim}${skill.argumentHint}${ANSI.reset || ''}` : '';
      screen.write(`  ${THEME.accent}/${nameCol}${ANSI.reset || ''} ${skill.description}${source}${hint}\n`);
    }

    if (allSkills.length === 0) {
      screen.write(`  ${THEME.dim}${t('skills.none')}${ANSI.reset || ''}\n`);
    }

    screen.write(`\n${THEME.dim}${t('skills.skillifyHint')}${ANSI.reset || ''}\n\n`);
  } else if (subCommand === 'usage') {
    const { getSkillUsageStats } = require('../skills');
    const stats = getSkillUsageStats();
    const skillNames = Object.keys(stats);

    if (skillNames.length === 0) {
      screen.write(`${THEME.dim}${t('skills.noUsage')}${ANSI.reset || ''}\n`);
      return;
    }

    screen.write(`\n${THEME.heading}${t('skills.usageTitle')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

    const sorted = skillNames.sort((a, b) => {
      const { getSkillUsageScore } = require('../skills');
      return getSkillUsageScore(b) - getSkillUsageScore(a);
    });

    for (const name of sorted) {
      const { getSkillUsageScore } = require('../skills');
      const score = getSkillUsageScore(name);
      const usage = stats[name];
      const daysAgo = Math.floor((Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24));
      const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
      screen.write(`  ${THEME.accent}${name.padEnd(18)}${ANSI.reset || ''} ${THEME.dim}${usage.usageCount} uses · last ${timeStr} · score ${score.toFixed(2)}${ANSI.reset || ''}\n`);
    }
    screen.write('\n');
  } else {
    const suggestion = getSubcommandSuggestion('skills', subCommand);
    screen.write(`${THEME.error}${t('skills.unknownCommand', { command: subCommand })}${ANSI.reset || ''}\n`);
    writeCommandSuggestion(screen, t, suggestion);
    screen.write(`${THEME.dim}${t('skills.usage')}${ANSI.reset || ''}\n`);
  }
}

async function handlePermissionsCommand(args, { screen, session }) {
  const t = getTranslator(session);
  const pm = session.permissionManager;
  if (!pm) {
    screen.write(`${THEME.error}${t('permissions.notInitialized')}${ANSI.reset || ''}\n`);
    return;
  }

  const [subCommand, ...rest] = args;

  if (!subCommand) {
    const selected = await promptForOption({
      screen,
      session,
      name: t('permissions.actionPrompt'),
      options: [
        { value: 'status', label: t('permissions.actionStatus') },
        { value: 'mode:normal', label: t('permissions.actionNormal') },
        { value: 'mode:yolo', label: t('permissions.actionYolo') },
        { value: 'reset', label: t('permissions.actionReset') },
      ],
      defaultValue: 'status',
      t,
    });
    if (selected) {
      const [nextCommand, nextValue] = selected.split(':');
      await handlePermissionsCommand(nextValue ? [nextCommand, nextValue] : [nextCommand], { screen, session });
      return;
    }
  }

  if (!subCommand || subCommand === 'status') {
    const summary = pm.getSummary();
    const modeLabel = summary.mode === 'yolo' ? 'YOLO' : t('common.mode.standard');

    screen.write(`\n${THEME.heading}${t('permissions.status')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
    screen.write(`  ${t('permissions.currentMode')}: ${THEME.bold}${modeLabel}${ANSI.reset || ''}\n\n`);

    screen.write(`  ${THEME.heading}${t('permissions.toolLevels')}${ANSI.reset || ''}\n`);
    const levelGroups = { auto: [], ask: [], dangerous: [], dynamic: [] };
    for (const entry of summary.toolPermissions) {
      const group = entry.level || 'dynamic';
      if (!levelGroups[group]) levelGroups[group] = [];
      levelGroups[group].push(entry.tool);
    }

    for (const [level, tools] of Object.entries(levelGroups)) {
      if (tools.length === 0) continue;
      const label = PERMISSION_LABELS[level] || level;
      const color = level === 'auto' ? THEME.success : level === 'dangerous' ? THEME.error : THEME.warning;
      screen.write(`    ${color}${label}${ANSI.reset || ''}: ${THEME.dim}${tools.join(', ')}${ANSI.reset || ''}\n`);
    }

    if (summary.alwaysAllow.length > 0) {
      screen.write(`\n  ${THEME.success}${t('permissions.alwaysAllow')}${ANSI.reset || ''} ${THEME.dim}${summary.alwaysAllow.join(', ')}${ANSI.reset || ''}\n`);
    }
    if (summary.alwaysDeny.length > 0) {
      screen.write(`  ${THEME.error}${t('permissions.alwaysDeny')}${ANSI.reset || ''} ${THEME.dim}${summary.alwaysDeny.join(', ')}${ANSI.reset || ''}\n`);
    }

    screen.write(`\n${THEME.dim}${t('permissions.switchHint')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}${t('permissions.resetHint')}${ANSI.reset || ''}\n\n`);
    return;
  }

  if (subCommand === 'mode') {
    let newMode = rest[0];
    if (!newMode) {
      newMode = await promptForOption({
        screen,
        session,
        name: t('permissions.modePrompt'),
        options: [
          { value: 'normal', label: t('permissions.actionNormal') },
          { value: 'yolo', label: t('permissions.actionYolo') },
        ],
        defaultValue: pm.mode === 'yolo' ? 'yolo' : 'normal',
        t,
      });
      if (!newMode) {
        screen.write(`${THEME.error}${t('permissions.invalidMode', { mode: '(missing)' })}${ANSI.reset || ''}\n`);
        screen.write(`${THEME.dim}${t('permissions.availableModes')}${ANSI.reset || ''}\n`);
        return;
      }
    }
    if (!newMode || !['auto', 'ask', 'yolo'].includes(newMode)) {
      screen.write(`${THEME.error}${t('permissions.invalidMode', { mode: newMode || '(missing)' })}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}${t('permissions.availableModes')}${ANSI.reset || ''}\n`);
      return;
    }

    pm.mode = newMode;
    const modeLabel = newMode === 'yolo' ? 'YOLO' : newMode === 'auto' ? t('common.mode.auto') : t('common.mode.standard');
    screen.write(`${THEME.success}${t('permissions.modeSwitched', { mode: modeLabel })}${ANSI.reset || ''}\n\n`);
    return;
  }

  if (subCommand === 'reset') {
    pm.resetOverrides();
    screen.write(`${THEME.success}${t('permissions.resetDone')}${ANSI.reset || ''}\n\n`);
    return;
  }

  const suggestion = getSubcommandSuggestion('permissions', subCommand);
  screen.write(`${THEME.error}${t('permissions.unknownSubcommand', { command: subCommand })}${ANSI.reset || ''}\n`);
  writeCommandSuggestion(screen, t, suggestion);
  screen.write(`${THEME.dim}${t('permissions.usage')}${ANSI.reset || ''}\n`);
}

async function handleSkillifyCommand(args, { screen, session, markdown }) {
  const description = args.join(' ');
  const skillify = createSkillifySkill(session.messages);

  screen.write(`\n${THEME.heading}Skillify${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}Capturing session as a reusable skill...${ANSI.reset || ''}\n\n`);

  const promptBlocks = await skillify.getPromptForCommand(description ? [description] : []);
  const skillContent = promptBlocks.map((b) => b.text).join('\n');

  const renderer = new ResponseRenderer(screen, markdown);
  const engine = new AgentEngine({ session, projectRoot: session.settings.projectRoot });

  for await (const event of engine.sendMessage(skillContent, { disableIntentMatching: true })) {
    renderAgentEvent(event, { screen, session, renderer });
  }
}

function handleGoalCommand(args, { screen, session }) {
  const subCommand = String(args[0] || '').toLowerCase();

  if (!args.length || subCommand === 'status') {
    if (session.goal?.enabled && session.goal.text) {
      screen.write(`\n${THEME.heading}Goal${ANSI.reset || ''}\n`);
      screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
      screen.write(`  ${THEME.success}active${ANSI.reset || ''}: ${session.goal.text}\n`);
      const max = Number.isInteger(Number(session.goal.maxContinuations)) ? session.goal.maxContinuations : 'default';
      screen.write(`  ${THEME.dim}max continuations: ${max}${ANSI.reset || ''}\n\n`);
    } else {
      screen.write(`${THEME.dim}No active goal. Usage: /goal [--max <turns>] <goal>${ANSI.reset || ''}\n`);
    }
    return;
  }

  if (subCommand === 'clear' || subCommand === 'off' || subCommand === 'reset') {
    session.goal = null;
    try {
      const { persistGoal } = require('../goal-persistence');
      persistGoal(session.id, null, { settings: session.settings });
    } catch (_) { /* optional module */ }
    screen.write(`${THEME.success}Goal cleared.${ANSI.reset || ''}\n`);
    return;
  }

  const { goalText, maxContinuations } = parseGoalArgs(args);
  if (!goalText) {
    screen.write(`${THEME.dim}Usage: /goal [--max <turns>] <goal>${ANSI.reset || ''}\n`);
    return;
  }

  session.goal = {
    enabled: true,
    text: goalText,
    maxContinuations,
    createdAt: new Date().toISOString(),
  };
  try {
    const { persistGoal } = require('../goal-persistence');
    persistGoal(session.id, session.goal, { settings: session.settings });
  } catch (_) { /* optional module */ }
  screen.write(`${THEME.success}Goal set:${ANSI.reset || ''} ${goalText}\n`);
  screen.write(`${THEME.dim}I will keep pushing toward this goal until it is complete, blocked, reaches the continuation limit, or you clear it with /goal clear.${ANSI.reset || ''}\n`);
}

function parseGoalArgs(args) {
  const parts = [];
  let maxContinuations;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--max' || arg === '--max-continuations') {
      const value = Number(args[index + 1]);
      if (Number.isInteger(value) && value >= 0) {
        maxContinuations = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--max=')) {
      const value = Number(arg.slice('--max='.length));
      if (Number.isInteger(value) && value >= 0) maxContinuations = value;
      continue;
    }
    parts.push(arg);
  }
  return { goalText: parts.join(' ').trim(), maxContinuations };
}

function showAgents({ screen, session }) {
  const definitions = loadAgentDefinitions({ projectRoot: session.settings.projectRoot || process.cwd(), settings: session.settings });
  screen.write(`\n${THEME.heading}Available Agents${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  for (const agent of definitions.activeAgents) {
    const nameCol = agent.agentType.padEnd(18);
    const source = agent.source ? ` ${THEME.dim}[${agent.source}]${ANSI.reset || ''}` : '';
    screen.write(`  ${THEME.accent}${nameCol}${ANSI.reset || ''} ${agent.role || agent.whenToUse || 'General teammate'}${source}\n`);
  }

  if (definitions.failedFiles.length > 0) {
    screen.write(`\n${THEME.warning}Some agent files failed to load:${ANSI.reset || ''}\n`);
    for (const failure of definitions.failedFiles) {
      screen.write(`  ${THEME.dim}${failure.path}${ANSI.reset || ''} ${failure.error}\n`);
    }
  }
  screen.write('\n');
}

async function showModels({ screen, session }) {
  session.availableModels = await printModels(session.provider, screen);
}

async function switchProvider(args, { screen, session }) {
  const t = getTranslator(session);
  const [providerName] = args;

  if (!providerName) {
    const selectedProvider = await promptForOption({
      screen,
      session,
      name: 'Provider',
      options: PROVIDERS.filter((provider) => provider.value !== 'mock'),
      defaultValue: session.provider.name,
      t,
    });
    if (!selectedProvider) {
      screen.write(`${THEME.dim}${t('provider.current', { provider: '' })}${ANSI.reset || ''}${THEME.bold}${session.provider.name}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}${t('provider.available')}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}${t('provider.usage')}${ANSI.reset || ''}\n`);
      return;
    }
    await switchProvider([selectedProvider], { screen, session });
    return;
  }

  const normalized = providerName.toLowerCase().trim();
  const validProviders = ['anthropic', 'claude', 'openai', 'gpt', 'google', 'gemini'];

  if (!validProviders.includes(normalized)) {
    screen.write(`${THEME.error}${t('provider.unknown', { provider: providerName })}${ANSI.reset || ''}\n`);
    return;
  }

  session.provider = createProvider({
    provider: normalized,
    apiKey: session.provider.apiKey,
    apiUrl: session.provider.apiUrl,
    model: session.provider.model,
  }, process.env);

  persistAgentSettings({
    provider: session.provider.name,
    apiKey: session.provider.apiKey,
    apiUrl: session.provider.apiUrl,
    model: session.provider.model,
  });
  session.availableModels = undefined;
  screen.write(`${THEME.success}${t('provider.switched', { provider: session.provider.name })}${ANSI.reset || ''}\n`);
}

async function switchModel(args, { screen, session }) {
  const t = getTranslator(session);
  const [selection] = args;

  if (!selection) {
    let models = session.availableModels;
    if (!Array.isArray(models) || models.length === 0) {
      try {
        models = await session.provider.listModels();
        session.availableModels = models;
      } catch (error) {
        screen.write(`${THEME.error}${error.message}${ANSI.reset || ''}\n`);
        return;
      }
    }

    const selectedModel = await promptForOption({
      screen,
      session,
      name: t('config.model').replace(/:$/, ''),
      options: models.map((model) => ({
        value: model.id,
        label: model.name && model.name !== model.id ? `${model.id} (${model.name})` : model.id,
      })),
      defaultValue: session.provider.model,
      t,
    });
    if (selectedModel) {
      await switchModel([selectedModel], { screen, session });
      return;
    }

    screen.write(`${THEME.dim}${t('model.current', { model: '' })}${ANSI.reset || ''}${THEME.bold}${session.provider.model || t('common.unknown')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}${t('model.usage')}${ANSI.reset || ''}\n`);
    return;
  }

  const model = resolveModelSelection(selection, session.availableModels || []);
  session.provider.setModel(model);
  screen.write(`${THEME.success}${t('model.switched', { model: session.provider.model })}${ANSI.reset || ''}\n`);
}

async function switchApiUrl(args, { screen, session }) {
  const t = getTranslator(session);
  const [apiUrl] = args;

  if (!apiUrl) {
    screen.write(`${THEME.dim}${t('apiUrl.current', { url: session.provider.apiUrl || t('common.default') })}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}${t('apiUrl.usage')}${ANSI.reset || ''}\n`);
    return;
  }

  session.provider.setApiUrl(apiUrl);
  persistAgentSettings({ apiUrl: session.provider.apiUrl });
  session.availableModels = undefined;
  screen.write(`${THEME.success}${t('apiUrl.switched', { url: session.provider.apiUrl || t('common.default') })}${ANSI.reset || ''}\n`);
}

async function switchApiKey(args, { screen, session }) {
  const t = getTranslator(session);
  const [apiKey] = args;

  if (!apiKey) {
    const state = session.provider.apiKey ? `${THEME.success}${t('common.set')}${ANSI.reset || ''}` : `${THEME.warning}${t('common.notSet')}${ANSI.reset || ''}`;
    screen.write(`${THEME.dim}${t('apiKey.status', { state })}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}${t('apiKey.usage')}${ANSI.reset || ''}\n`);
    return;
  }

  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    session.provider = createProvider({
      provider: 'anthropic',
      apiKey,
      apiUrl: session.provider.apiUrl,
      model: session.provider.model,
    }, process.env);
  } else {
    session.provider.setApiKey(apiKey);
  }

  persistAgentSettings({
    provider: session.provider.name,
    apiKey: session.provider.apiKey,
    apiUrl: session.provider.apiUrl,
    model: session.provider.model,
  });
  session.availableModels = undefined;
  screen.write(`${THEME.success}${t('apiKey.switched', { provider: session.provider.name })}${ANSI.reset || ''}\n`);
}

async function switchLanguage(args, { screen, session }) {
  const t = getTranslator(session);
  const [localeInput] = args;
  const currentLocale = normalizeLocale(session.settings.ui?.locale);

  if (!localeInput) {
    const selectedLocale = await promptForOption({
      screen,
      session,
      name: t('init.language'),
      options: listLocales(),
      defaultValue: currentLocale,
      t,
    });
    if (!selectedLocale) {
      screen.write(`${THEME.dim}${t('language.current', { language: getLocaleLabel(currentLocale), locale: currentLocale })}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}${t('language.available', { locales: listLocales().map((locale) => `${locale.value}=${locale.label}`).join(', ') })}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}${t('language.usage')}${ANSI.reset || ''}\n`);
      return;
    }
    await switchLanguage([selectedLocale], { screen, session });
    return;
  }

  const locale = normalizeLocale(localeInput);
  const supported = listLocales().some((item) => item.value === locale);
  if (!supported || (locale === 'en' && !/^en|english$/i.test(localeInput) && localeInput !== 'en')) {
    screen.write(`${THEME.error}${t('language.unknown', { locale: localeInput })}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}${t('language.available', { locales: listLocales().map((item) => item.value).join(', ') })}${ANSI.reset || ''}\n`);
    return;
  }

  session.settings.ui = { ...(session.settings.ui || {}), locale };
  if (session.permissionManager) {
    session.permissionManager.locale = locale;
  }
  updateUserSettings({ ui: { locale } });
  const nextT = getTranslator(session);
  screen.write(`${THEME.success}${nextT('language.switched', { language: getLocaleLabel(locale), locale })}${ANSI.reset || ''}\n`);
}

function showCost({ screen, session }) {
  screen.write(`\n${session.costTracker.formatSummary(session.provider?.model)}\n\n`);
}

function handleContextCommand(args, { screen, session }) {
  const [subCommand = 'status', value] = args;
  const context = session.settings.context || {};

  if (subCommand === 'status') {
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'on' || subCommand === 'enable') {
    session.settings.context = { ...context, enabled: true };
    updateUserSettings({ context: { enabled: true } });
    screen.write(`${THEME.success}Context window management enabled.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'off' || subCommand === 'disable') {
    session.settings.context = { ...context, enabled: false };
    updateUserSettings({ context: { enabled: false } });
    screen.write(`${THEME.success}Context window management disabled.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'auto' || subCommand === 'reset') {
    session.settings.context = { ...context, enabled: true, windowTokens: undefined };
    updateUserSettings({ context: { enabled: true, windowTokens: undefined } });
    screen.write(`${THEME.success}Context window reset to auto model detection.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'window') {
    const tokens = parseTokenSetting(value);
    if (!tokens) {
      screen.write(`${THEME.dim}Usage: /context window <tokens|auto>  e.g. /context window 1m${ANSI.reset || ''}\n`);
      return;
    }
    const update = { enabled: true, windowTokens: tokens === 'auto' ? undefined : tokens };
    session.settings.context = { ...context, ...update };
    updateUserSettings({ context: update });
    screen.write(`${THEME.success}Context window ${tokens === 'auto' ? 'set to auto' : `set to ${formatContextTokens(tokens)}`}.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'reserve') {
    const tokens = parseTokenSetting(value);
    if (!tokens || tokens === 'auto') {
      screen.write(`${THEME.dim}Usage: /context reserve <tokens>  e.g. /context reserve 32k${ANSI.reset || ''}\n`);
      return;
    }
    session.settings.context = { ...context, reserveOutputTokens: tokens };
    updateUserSettings({ context: { reserveOutputTokens: tokens } });
    screen.write(`${THEME.success}Reserved output tokens set to ${formatContextTokens(tokens)}.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  if (subCommand === 'chars-per-token' || subCommand === 'cpt') {
    const charsPerToken = Number(value);
    if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
      screen.write(`${THEME.dim}Usage: /context chars-per-token <number>  e.g. /context chars-per-token 3.5${ANSI.reset || ''}\n`);
      return;
    }
    session.settings.context = { ...context, charsPerToken };
    updateUserSettings({ context: { charsPerToken } });
    screen.write(`${THEME.success}Context token estimator set to ${charsPerToken} chars/token.${ANSI.reset || ''}\n`);
    showContextSettings(screen, session);
    return;
  }

  const t = getTranslator(session);
  screen.write(`${THEME.error}Unknown context command: ${subCommand}${ANSI.reset || ''}\n`);
  writeCommandSuggestion(screen, t, getSubcommandSuggestion('context', subCommand));
  screen.write(`${THEME.dim}Usage: /context [status|window <tokens|auto>|reserve <tokens>|chars-per-token <number>|auto|on|off]${ANSI.reset || ''}\n`);
}

function showContextSettings(screen, session) {
  const context = session.settings.context || {};
  const model = session.provider?.model || session.settings.agent?.model;
  const inferred = inferModelContextWindowTokens(model);
  const windowTokens = resolveContextWindowTokens(session.settings, model);
  const reserve = Number(context.reserveOutputTokens) > 0 ? Number(context.reserveOutputTokens) : 8192;
  const budget = Math.max(1, windowTokens - reserve);
  const mode = context.windowTokens ? 'manual' : 'auto';

  screen.write(`\n${THEME.heading}Context Cache${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  screen.write(`  Enabled:        ${context.enabled === false ? 'no' : 'yes'}\n`);
  screen.write(`  Model:          ${model || 'unknown'}\n`);
  screen.write(`  Window:         ${formatContextTokens(windowTokens)} (${mode}${mode === 'auto' ? `, inferred ${formatContextTokens(inferred)}` : ''})\n`);
  screen.write(`  Output reserve: ${formatContextTokens(reserve)}\n`);
  screen.write(`  Input budget:   ${formatContextTokens(budget)}\n`);
  screen.write(`  Estimator:      ${context.charsPerToken || 4} chars/token\n`);
  screen.write(`\n${THEME.dim}  /context window 1m  ·  /context reserve 32k  ·  /context auto${ANSI.reset || ''}\n\n`);
}

function parseTokenSetting(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'auto') return 'auto';

  const match = text.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const suffix = match[2] || '';
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  const tokens = Math.round(amount * multiplier);
  return tokens > 0 ? tokens : null;
}

function formatContextTokens(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.max(0, Math.round(tokens)));
}

async function showSessions({ screen, session }) {
  // kept for backwards compat - same as list
  await handleSessionsCommand([], { screen, session });
}

async function handleSessionsCommand(args, { screen, session }) {
  const t = getTranslator(session);
  const [subCommand] = args;

  if (subCommand === 'clear') {
    const { clearSessions } = require('../memory');
    const count = clearSessions(session.settings);
    screen.write(`${THEME.success}Cleared ${count} session(s).${ANSI.reset || ''}\n`);
    return;
  }

  const sessions = listSessions(session.settings);
  if (sessions.length === 0) {
    screen.write(`${THEME.dim}${t('sessions.none')}${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}${t('sessions.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  for (const s of sessions.slice(0, 20)) {
    const preview = formatSessionPreview(s, 50);
    const date = new Date(s.updatedAt).toLocaleDateString();
    screen.write(`  ${THEME.dim}${s.id.slice(0, 20)}${ANSI.reset || ''}  ${THEME.dim}${date}${ANSI.reset || ''}  ${preview}\n`);
  }
  screen.write(`\n${THEME.dim}/sessions clear to delete all${ANSI.reset || ''}\n\n`);
}

async function resumeSession(args, { screen, session }) {
  const t = getTranslator(session);
  const [sessionId] = args;
  const sessions = listSessions(session.settings);

  if (sessions.length === 0) {
    screen.write(`${THEME.warning}${t('sessions.none')}${ANSI.reset || ''}\n`);
    return;
  }

  let targetSession;
  if (sessionId) {
    targetSession = sessions.find(s => s.id.startsWith(sessionId));
  } else {
    const selectedSessionId = await promptForOption({
      screen,
      session,
      name: t('sessions.title'),
      options: sessions.slice(0, 20).map((candidate) => ({
        value: candidate.id,
        label: formatSessionOption(candidate),
      })),
      defaultValue: sessions[0]?.id,
      t,
    });
    targetSession = selectedSessionId
      ? sessions.find(s => s.id === selectedSessionId)
      : sessions[0];
  }

  if (!targetSession) {
    screen.write(`${THEME.error}${t('sessions.notFound', { id: sessionId })}${ANSI.reset || ''}\n`);
    return;
  }

  const entries = targetSession.entries();
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-resolveTranscriptMessageLimit(session.settings))
    .map(e => ({ role: e.role, content: e.content || '' }));

  session.messages = restored;
  session.id = targetSession.id;
  screen.write(`${THEME.success}${t('sessions.resumed', { id: targetSession.id.slice(0, 20), count: restored.length })}${ANSI.reset || ''}\n\n`);
}

function formatSessionOption(session) {
  const preview = formatSessionPreview(session, 48);
  const date = new Date(session.updatedAt).toLocaleString();
  return `${session.id.slice(0, 12)}  ${date}  ${preview}`;
}

/**
 * Format a session's first user message as a truncated preview string.
 * Default maxLen of 50 covers the most common case (sessions listing).
 *
 * @param {{ entries(): Array, updatedAt: number }} session
 * @param {number} [maxLen=50]
 * @returns {string}
 */
function formatSessionPreview(session, maxLen = 50) {
  const entries = session.entries();
  const userMessages = entries.filter(e => e.role === 'user');
  const firstMsg = userMessages[0]?.content || '(empty)';
  if (firstMsg.length > maxLen) {
    return firstMsg.slice(0, maxLen - 3) + '...';
  }
  return firstMsg;
}

function resolveTranscriptMessageLimit(settings = {}) {
  const limit = Number(settings.prompts?.maxTranscriptMessages);
  return Number.isFinite(limit) && limit > 0 ? limit : Infinity;
}

function showConfig({ screen, session }, args = []) {
  const t = getTranslator(session);
  const locale = normalizeLocale(session.settings.ui?.locale);

  // /config reload — re-read settings from disk and update the running session
  if (args[0] === 'reload') {
    try {
      const { resolveSettings } = require('../config');
      const fresh = resolveSettings();
      session.settings = fresh.settings;

      // Update provider if model/provider changed
      if (fresh.settings.agent) {
        const { createProvider } = require('../providers');
        const newProvider = createProvider(fresh.settings.agent, process.env);
        if (newProvider) {
          session.provider = newProvider;
        }
      }

      screen.write(`${THEME.success}${t('config.reloaded')}${ANSI.reset || ''}\n`);
      // Show the fresh config
    } catch (err) {
      screen.write(`${THEME.error}${t('config.reloadFailed', { error: err.message })}${ANSI.reset || ''}\n`);
      return;
    }
  }
  screen.write(`\n${THEME.heading}${t('config.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.dim}${t('config.provider')}${ANSI.reset || ''}     ${session.provider.name}\n`);
  screen.write(`  ${THEME.dim}${t('config.model')}${ANSI.reset || ''}       ${session.provider.model}\n`);
  screen.write(`  ${THEME.dim}${t('config.apiUrl')}${ANSI.reset || ''}     ${session.provider.apiUrl || t('common.default')}\n`);
  screen.write(`  ${THEME.dim}${t('config.apiKey')}${ANSI.reset || ''}     ${session.provider.apiKey ? '********' : t('common.notSet')}\n`);
  screen.write(`  ${THEME.dim}${t('config.language')}${ANSI.reset || ''}     ${getLocaleLabel(locale)} (${locale})\n`);
  screen.write(`  ${THEME.dim}${t('config.maxTurns')}${ANSI.reset || ''}    ${session.settings.agent?.maxTurns || 20}\n`);
  screen.write(`  ${THEME.dim}${t('config.temperature')}${ANSI.reset || ''}  ${session.settings.agent?.temperature || 0.2}\n`);
  screen.write(`  ${THEME.dim}${t('config.projectRoot')}${ANSI.reset || ''} ${session.settings.projectRoot || process.cwd()}\n`);
  screen.write(`  ${THEME.dim}${t('config.shell')}${ANSI.reset || ''}        ${session.settings.tools?.shell?.enabled ? t('common.enabled') : t('common.disabled')}\n`);
  const contextWindow = resolveContextWindowTokens(session.settings, session.provider?.model);
  const reserve = Number(session.settings.context?.reserveOutputTokens) > 0 ? Number(session.settings.context.reserveOutputTokens) : 8192;
  screen.write(`  ${THEME.dim}Context:${ANSI.reset || ''}      ${session.settings.context?.enabled === false ? t('common.disabled') : `${formatContextTokens(contextWindow)} window · ${formatContextTokens(Math.max(1, contextWindow - reserve))} input budget`}\n`);
  screen.write('\n');

  // Show config file paths and priority so users know where to edit
  try {
    const { resolveSettings } = require('../config');
    const resolved = resolveSettings();
    const loadedSources = resolved.sources.filter((s) => s.loaded);
    if (loadedSources.length > 0) {
      screen.write(`  ${THEME.heading}${t('config.sources')}${ANSI.reset || ''}\n`);
      const labels = { user: t('config.sourceUser'), project: t('config.sourceProject'), explicit: t('config.sourceExplicit') };
      for (const src of loadedSources) {
        const label = labels[src.type] || src.type;
        screen.write(`    ${THEME.dim}[${label}]${ANSI.reset || ''} ${src.path}\n`);
      }
      screen.write(`  ${THEME.dim}${t('config.priorityNote')}${ANSI.reset || ''}\n`);
    } else {
      screen.write(`  ${THEME.warning}${t('config.noConfigFile')}${ANSI.reset || ''}\n`);
    }
    screen.write(`  ${THEME.dim}${t('config.reloadHint')}${ANSI.reset || ''}\n`);
  } catch (_) { /* best-effort */ }
  screen.write('\n');
}

function runDoctor({ screen, session }) {
  const t = getTranslator(session);
  const locale = normalizeLocale(session.settings.ui?.locale);
  screen.write(`\n${THEME.heading}${t('doctor.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  const checks = [
    { name: t('doctor.node'), check: () => process.version },
    { name: t('doctor.provider'), check: () => session.provider.name },
    { name: t('doctor.model'), check: () => session.provider.model },
    { name: t('doctor.apiKey'), check: () => session.provider.apiKey ? `${THEME.success}${t('doctor.okSet')}${ANSI.reset || ''}` : `${THEME.error}${t('doctor.missing')}${ANSI.reset || ''}` },
    { name: t('doctor.apiUrl'), check: () => session.provider.apiUrl || t('common.default') },
    { name: t('doctor.language'), check: () => `${getLocaleLabel(locale)} (${locale})` },
    { name: t('doctor.shellTool'), check: () => session.settings.tools?.shell?.enabled ? `${THEME.success}${t('common.enabled')}${ANSI.reset || ''}` : `${THEME.warning}${t('common.disabled')}${ANSI.reset || ''}` },
    { name: t('doctor.tty'), check: () => new TerminalScreen().isTTY() ? `${THEME.success}${t('common.yes')}${ANSI.reset || ''}` : `${THEME.warning}${t('common.no')}${ANSI.reset || ''}` },
    { name: t('doctor.terminal'), check: () => `${process.stdout.columns}x${process.stdout.rows}` },
    { name: t('doctor.sessionId'), check: () => session.id.slice(0, 20) },
  ];

  for (const { name, check } of checks) {
    const result = check();
    screen.write(`  ${THEME.dim}${name.padEnd(14)}${ANSI.reset || ''} ${result}\n`);
  }
  screen.write('\n');
}

function toggleTheme({ screen }) {
  setThemeEnabled(!isThemeEnabled());
  screen.write(`${THEME.success}Theme ${isThemeEnabled() ? 'enabled' : 'disabled'}.${ANSI.reset || ''}\n`);
}

function toggleVim({ screen }) {
  setVimMode(!isVimMode());
  screen.write(`${THEME.success}Vim mode ${isVimMode() ? 'enabled' : 'disabled'}.${ANSI.reset || ''}\n`);
}

function handleMemoryCommand(args, { screen, session }) {
  const t = getTranslator(session);

  executeMemoryCommand(args, {
    screen,
    session,
    onUnknownSubcommand(subCommand) {
      screen.write(`${THEME.error}Unknown memory command: ${subCommand}${ANSI.reset || ''}\n`);
      writeCommandSuggestion(screen, t, getSubcommandSuggestion('memory', subCommand));
      screen.write(`${THEME.dim}Usage: /memory [list|read|write|delete]${ANSI.reset || ''}\n`);
    },
  });
}

async function handleTeamCommand(args, { screen, session }) {
  const runtime = createCliTeamRuntime(session.settings);
  const [subCommand = 'status', ...subArgs] = args;
  const t = getTranslator(session);

  try {
    const output = await executeTeamCommand(runtime, subCommand, subArgs, { settings: session.settings, session });
    if (output) {
      screen.write(`\n${output}\n\n`);
    }
  } catch (error) {
    screen.write(`${THEME.error}Error: ${error.message}${ANSI.reset || ''}\n`);
    writeCommandSuggestion(screen, t, getSubcommandSuggestion('team', subCommand));
  }
}

async function printModels(provider, output) {
  const models = await provider.listModels();
  const t = createTranslator(loadSettings().ui?.locale);

  output.write(`\n${THEME.heading}${t('models.title', { provider: provider.name })}${ANSI.reset || ''}\n`);
  output.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  models.forEach((model, index) => {
    const marker = model.id === provider.model ? `${THEME.success}*${ANSI.reset || ''}` : ' ';
    const label = model.name && model.name !== model.id ? ` ${THEME.dim}(${model.name})${ANSI.reset || ''}` : '';
    const numStr = String(index + 1).padStart(2);
    output.write(` ${marker} ${THEME.dim}${numStr}.${ANSI.reset || ''} ${model.id}${label}\n`);
  });

  output.write('\n');
  return models;
}

function resolveModelSelection(selection, models) {
  const modelNumber = Number(selection);
  if (Number.isInteger(modelNumber) && modelNumber > 0 && modelNumber <= models.length) {
    return models[modelNumber - 1].id;
  }
  return selection;
}

function persistAgentSettings(agentSettings, settings = {}) {
  updateUserSettings({ agent: agentSettings }, { env: settings.env });
}

async function handleUpdateCheck(args, { screen }) {
  const shouldInstall = args[0] === 'install';

  screen.write(`${THEME.dim}Checking for updates...${ANSI.reset || ''}\n`);

  const result = await checkForUpdate(VERSION, { force: true });

  if (result.error && !result.latestVersion) {
    screen.write(`${THEME.error}Failed to check for updates: ${result.error}${ANSI.reset || ''}\n`);
    return;
  }

  if (!result.hasUpdate) {
    screen.write(`${styled(THEME.success, `✔ You're on the latest version (v${result.currentVersion})`)}\n\n`);
    return;
  }

  screen.write(
    `${styled(THEME.warning, `⬆ New version available: v${result.currentVersion} → v${result.latestVersion}`)}\n`
  );

  if (!shouldInstall) {
    screen.write(`${styled(THEME.dim, '  Run /update install to update now.')}\n\n`);
    return;
  }

  screen.write(`${styled(THEME.dim, '  Updating...')}\n`);

  try {
    await performUpdate();
    screen.write(`${styled(THEME.success, '  ✔ Update complete. Restarting...')}\n\n`);
    setTimeout(() => restartProcess(), 500);
  } catch (err) {
    screen.write(
      `${styled(THEME.error, `  ✖ Update failed: ${err.message}`)}\n` +
      `${styled(THEME.dim, '  Run manually: npm install -g hax-agent-cli')}\n\n`
    );
  }
}

function trackFileModification(session, chunk) {
  if (!session || !chunk) return;
  const data = chunk.data || {};
  const path = data.path;
  if (!path) return;

  if (chunk.name === 'file.write' && !chunk.isError) {
    session.modifiedFiles.add(path);
  } else if (chunk.name === 'file.edit' && !chunk.isError && data.changed) {
    session.modifiedFiles.add(path);
  }
}

function copyLastResponse({ screen, session }) {
  const t = getTranslator(session);
  const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant || !lastAssistant.content) {
    screen.write(`${THEME.warning}${t('shell.copyNoResponse')}${ANSI.reset || ''}\n`);
    return;
  }

  const text = typeof lastAssistant.content === 'string'
    ? lastAssistant.content
    : JSON.stringify(lastAssistant.content);

  const { spawn } = require('node:child_process');
  const platform = process.platform;
  let child;

  if (platform === 'win32') {
    child = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  } else if (platform === 'darwin') {
    child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  } else {
    // Linux: try xclip (X11) first, wl-copy (Wayland) as fallback
    child = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {
      // xclip not found, try wl-copy
      const wlChild = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      wlChild.on('error', (wlErr) => {
        screen.write(`${THEME.error}${t('shell.copyFailed', { error: 'xclip or wl-copy not found. Install: sudo apt install xclip' })}${ANSI.reset || ''}\n`);
      });
      wlChild.on('close', (wlCode) => {
        if (wlCode === 0) {
          screen.write(`${THEME.success}${t('shell.copySuccess', { chars: text.length })}${ANSI.reset || ''}\n`);
        }
      });
      wlChild.stdin.write(text);
      wlChild.stdin.end();
    });
  }

  child.on('error', (err) => {
    screen.write(`${THEME.error}${t('shell.copyFailed', { error: err.message })}${ANSI.reset || ''}\n`);
  });

  child.on('close', (code) => {
    if (code === 0) {
      screen.write(`${THEME.success}${t('shell.copySuccess', { chars: text.length })}${ANSI.reset || ''}\n`);
    } else {
      screen.write(`${THEME.error}${t('shell.copyFailed', { error: `exit code ${code}` })}${ANSI.reset || ''}\n`);
    }
  });

  child.stdin.write(text);
  child.stdin.end();
}

function renameSession(args, { screen, session }) {
  const t = getTranslator(session);
  const name = (args || []).join(' ').trim();
  if (!name) {
    screen.write(`${THEME.warning}${t('shell.renameNoName')}${ANSI.reset || ''}\n`);
    return;
  }
  session.customName = name;
  screen.write(`${THEME.success}${t('shell.renameSuccess', { name })}${ANSI.reset || ''}\n`);
}

function showStatus({ screen, session }) {
  const t = getTranslator(session);
  const cost = session.costTracker.getCost(session.provider?.model);
  const provider = session.provider?.name || '?';
  const model = session.provider?.model || '?';
  const permMode = session.permissionManager?.mode || '?';
  const msgCount = session.messages?.length || 0;
  const turnCount = session.costTracker.turnCount || 0;
  const tokenUsed = session.costTracker.totalTokens || 0;
  const sessionId = session.id?.slice(0, 12) || '?';
  const { listSessions } = require('../memory');
  const sessions = listSessions(session.settings);

  screen.write(`\n${THEME.heading}Session Status${ANSI.reset || ''}\n`);
  screen.write(`  Session:     ${sessionId}\n`);
  screen.write(`  Provider:    ${provider} / ${model}\n`);
  screen.write(`  Messages:    ${msgCount}\n`);
  screen.write(`  Turns:       ${turnCount}\n`);
  screen.write(`  Tokens:      ${tokenUsed.toLocaleString()}\n`);
  screen.write(`  Cost:        $${cost.toFixed(4)}\n`);
  screen.write(`  Permissions: ${permMode}\n`);
  screen.write(`  Sessions:    ${sessions.length} saved\n`);
  screen.write(`\n${THEME.dim}  /help for commands  ·  /sessions to browse history${ANSI.reset || ''}\n\n`);
}

async function handleUndo({ session, screen }) {
  const undoStack = session.toolRegistry?.undoStack;
  if (!undoStack) {
    screen.write('Undo is not available in this session.\n');
    return;
  }
  if (!undoStack.canUndo()) {
    screen.write('Nothing to undo.\n');
    return;
  }
  const result = await undoStack.undo();
  if (result.undone) {
    screen.write(`${result.description}\n`);
  } else {
    screen.write(`${result.description}\n`);
  }
}

async function handleRedo({ session, screen }) {
  const undoStack = session.toolRegistry?.undoStack;
  if (!undoStack) {
    screen.write('Redo is not available in this session.\n');
    return;
  }
  if (!undoStack.canRedo()) {
    screen.write('Nothing to redo.\n');
    return;
  }
  const result = await undoStack.redo();
  if (result.redone) {
    screen.write(`${result.description}\n`);
  } else {
    screen.write(`${result.description}\n`);
  }
}

function handleExport(args, { session, screen }) {
  const format = (args[0] || 'md').toLowerCase();
  const validFormats = { md: 'markdown', json: 'json', text: 'text', txt: 'text' };
  const resolvedFormat = validFormats[format] || 'markdown';

  const exportDir = path.join(process.cwd(), '.hax-agent', 'exports');
  const timestamp = Date.now();
  const ext = resolvedFormat === 'markdown' ? 'md' : resolvedFormat === 'json' ? 'json' : 'txt';
  const outputPath = path.join(exportDir, `${session.id}-${timestamp}.${ext}`);

  try {
    let result;
    if (resolvedFormat === 'markdown') {
      result = exportSessionToMarkdown(session.id, outputPath, { settings: session.settings });
    } else if (resolvedFormat === 'json') {
      result = exportSessionToJson(session.id, outputPath, { settings: session.settings });
    } else {
      result = exportSessionToText(session.id, outputPath, { settings: session.settings });
    }
    screen.write(`Exported ${result.entries} messages to ${result.path}\n`);
  } catch (err) {
    screen.write(`Export failed: ${err.message}\n`);
  }
}

module.exports = {
  SLASH_COMMANDS,
  COMMAND_HANDLERS,
  renderBanner,
  renderStatusLine,
  loadRecentTranscript,
  handleChatMessage,
  handleSlashCommand,
  handleSkillInvocation,
  executeTeamCommand,
  printModels,
  resolveModelSelection,
  persistAgentSettings,
  createCliTeamRuntime,
  getSlashCommandSuggestion,
  getSubcommandSuggestion,
  listCommandHandlerNames,
  formatSessionPreview,
  resolveTranscriptMessageLimit,
};
