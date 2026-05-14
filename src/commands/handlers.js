"use strict";

const { loadSettings, updateUserSettings } = require("../config");
const { appendTranscriptEntry, createSessionId, listSessions, listMemories, readMemory, writeMemory, deleteMemory, readTranscript } = require("../memory");
const { createProvider } = require("../providers");
const { loadAllSkills, createSkillifySkill, recordSkillUsage, getSkillUsageStats } = require("../skills");
const { loadAgentDefinitions } = require("../teams/agents");
const { createTeamRuntime } = require("../teams/runtime");
const { createLocalToolRegistry } = require("../tools");
const { formatTeamPlan } = require("../formatters/team-plan");
const { formatAgentList, formatMessages, formatRunResult, formatTeamList, formatTeamSnapshot } = require("../formatters/agent-teams");
const { PERMISSION_LABELS } = require("../permissions");
const { THEME, ANSI, styled, VERSION, formatProviderError, MarkdownRenderer, TerminalScreen } = require("../renderer");
const { Session, CostTracker } = require("../session");
const { checkForUpdate, performUpdate, restartProcess } = require("../updater");
const { PROVIDERS, chooseOptionWithArrows } = require("../init-wizard");
const { createTranslator, getLocaleLabel, listLocales, normalizeLocale } = require("../i18n");
const { suggestCommand } = require("../command-suggestions");
const { resolveContextWindowTokens, inferModelContextWindowTokens } = require("../context-window");

const {
  SLASH_COMMANDS, SKILLS_SUBCOMMANDS, PERMISSIONS_SUBCOMMANDS,
  MEMORY_SUBCOMMANDS, CONTEXT_SUBCOMMANDS, TEAM_SUBCOMMANDS,
  isThemeEnabled, setThemeEnabled, isVimMode, setVimMode,
} = require("./definitions");

const { getTranslator, handleSkillInvocation } = require("./shell-ui");

// --------------- Utility ---------------

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
  };
  return suggestCommand(subCommand, candidatesByCommand[commandName] || []);
}

function writeCommandSuggestion(screen, t, suggestion) {
  if (!suggestion) return;
  screen.write(`${THEME.dim}${t('errors.didYouMean', { command: suggestion })}${ANSI.reset || ''}\n`);
}

async function promptForOption({ screen, session, name, options, defaultValue, t }) {
  if (typeof chooseOptionWithArrows !== 'function') return defaultValue || options[0]?.value;
  return chooseOptionWithArrows({ screen, session, name, options, defaultValue, t });
}

// --------------- Session Commands ---------------

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
  const cost = session.costTracker.getCost(session.provider?.model);
  screen.write(`${THEME.success}${t('shell.sessionEnded')}${ANSI.reset || ''} ${THEME.dim}${t('shell.sessionStats', { cost: cost.toFixed(4), turns: session.costTracker.turnCount })}${ANSI.reset || ''}\n`);
}

function clearShell({ screen, session }) {
  const t = getTranslator(session);
  session.messages = [];
  session.id = createSessionId();
  screen.write(`${THEME.success}${t('shell.contextCleared')}${ANSI.reset || ''}\n\n`);
}

function compactShell({ screen, session }) {
  const keepCount = Math.min(session.messages.length, 6);
  const removed = session.messages.length - keepCount;
  session.messages = session.messages.slice(-keepCount);
  screen.write(`${THEME.success}Compacted: removed ${removed} messages, keeping last ${keepCount}.${ANSI.reset || ''}\n\n`);
}

// --------------- Tools / Skills / Agents ---------------

function showTools({ screen, session }) {
  const t = getTranslator(session);
  const tools = session.toolRegistry.list();
  screen.write(`\n${THEME.heading}${t('tools.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  for (const tool of tools) {
    screen.write(`  ${THEME.accent}${tool.name.padEnd(16)}${ANSI.reset || ''} ${THEME.dim}${tool.description || ''}${ANSI.reset || ''}\n`);
  }
  screen.write('\n');
}

function showSkills(args, { screen, session }) {
  const t = getTranslator(session);
  const [subCommand] = args;

  if (!subCommand || subCommand === 'list') {
    const skills = loadAllSkills(session.settings.projectRoot || process.cwd());
    if (skills.length === 0) {
      screen.write(`${THEME.dim}${t('skills.none')}${ANSI.reset || ''}\n`);
    } else {
      screen.write(`\n${THEME.heading}${t('skills.title')}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
      for (const skill of skills) {
        screen.write(`  ${THEME.accent}/${skill.name}${ANSI.reset || ''} ${THEME.dim}${skill.description || ''}${ANSI.reset || ''}\n`);
      }
    }
    screen.write(`\n${THEME.dim}${t('skills.skillifyHint')}${ANSI.reset || ''}\n\n`);
  } else if (subCommand === 'usage') {
    const stats = getSkillUsageStats();
    const skillNames = Object.keys(stats);
    if (skillNames.length === 0) {
      screen.write(`${THEME.dim}${t('skills.noUsage')}${ANSI.reset || ''}\n`);
      return;
    }
    screen.write(`\n${THEME.heading}${t('skills.usageTitle')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
    const sorted = skillNames.sort((a, b) => getSkillUsageScore(b) - getSkillUsageScore(a));
    for (const name of sorted) {
      const usage = stats[name];
      const daysAgo = Math.floor((Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24));
      const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
      screen.write(`  ${THEME.accent}${name.padEnd(18)}${ANSI.reset || ''} ${THEME.dim}${usage.usageCount} uses · last ${timeStr}${ANSI.reset || ''}\n`);
    }
    screen.write('\n');
  } else {
    const suggestion = getSubcommandSuggestion('skills', subCommand);
    screen.write(`${THEME.error}${t('skills.unknownCommand', { command: subCommand })}${ANSI.reset || ''}\n`);
    writeCommandSuggestion(screen, t, suggestion);
  }
}

function getSkillUsageScore(name) {
  const stats = getSkillUsageStats();
  const usage = stats[name];
  if (!usage) return 0;
  const daysSinceLastUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24);
  return usage.usageCount / Math.max(1, daysSinceLastUse);
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
    const selected = await promptForOption({ screen, session, name: t('permissions.actionPrompt'), options: [
      { value: 'status', label: t('permissions.actionStatus') },
      { value: 'mode:normal', label: t('permissions.actionNormal') },
      { value: 'mode:yolo', label: t('permissions.actionYolo') },
      { value: 'reset', label: t('permissions.actionReset') },
    ], defaultValue: 'status', t });
    if (selected) {
      const [nextCmd, nextVal] = selected.split(':');
      await handlePermissionsCommand(nextVal ? [nextCmd, nextVal] : [nextCmd], { screen, session });
    }
    return;
  }

  if (subCommand === 'status') {
    const summary = pm.getSummary();
    const modeLabel = summary.mode === 'yolo' ? 'YOLO' : t('common.mode.standard');
    screen.write(`\n${THEME.heading}${t('permissions.status')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
    screen.write(`  ${t('permissions.currentMode')}: ${THEME.bold}${modeLabel}${ANSI.reset || ''}\n\n`);
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
    screen.write(`\n${THEME.dim}${t('permissions.switchHint')}${ANSI.reset || ''}\n`);
    return;
  }

  if (subCommand === 'mode') {
    let newMode = rest[0];
    if (!newMode) {
      newMode = await promptForOption({ screen, session, name: t('permissions.modePrompt'), options: [
        { value: 'normal', label: t('permissions.actionNormal') },
        { value: 'yolo', label: t('permissions.actionYolo') },
      ], defaultValue: pm.mode, t });
    }
    if (!newMode || !['auto', 'ask', 'yolo'].includes(newMode)) {
      screen.write(`${THEME.error}${t('permissions.invalidMode', { mode: newMode || '(missing)' })}${ANSI.reset || ''}\n`);
      return;
    }
    pm.mode = newMode;
    const modeLabel = newMode === 'yolo' ? 'YOLO' : t('common.mode.standard');
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
}

async function handleSkillifyCommand(args, { screen, session }) {
  const description = args.join(' ');
  const skillify = createSkillifySkill(session.messages);
  try {
    const promptBlocks = await skillify.getPromptForCommand(description ? [description] : []);
    const content = promptBlocks.map((block) => block.text).join('\n');
    screen.write(`\n${THEME.heading}Skillify${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
    screen.write(content);
    screen.write('\n\n');
  } catch (error) {
    screen.write(`${THEME.error}Failed to create skill: ${error.message}${ANSI.reset || ''}\n`);
  }
}

function showAgents({ screen, session }) {
  const t = getTranslator(session);
  const definitions = loadAgentDefinitions({ projectRoot: session.settings?.projectRoot || process.cwd(), settings: session.settings });
  screen.write(`\n${THEME.heading}${t('agents.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  for (const agent of definitions.agents || []) {
    const nameCol = agent.name.padEnd(18);
    const source = agent.source ? ` ${THEME.dim}[${agent.source}]${ANSI.reset || ''}` : '';
    screen.write(`  ${THEME.accent}${nameCol}${ANSI.reset || ''} ${agent.role || agent.whenToUse || 'General teammate'}${source}\n`);
  }
  if ((definitions.failedFiles || []).length > 0) {
    screen.write(`\n${THEME.warning}Some agent files failed to load:${ANSI.reset || ''}\n`);
    for (const failure of definitions.failedFiles) {
      screen.write(`  ${THEME.dim}${failure.path}${ANSI.reset || ''} ${failure.error}\n`);
    }
  }
  screen.write('\n');
}

// --------------- Provider / Model Commands ---------------

async function showModels({ screen, session }) {
  session.availableModels = await printModels(session.provider, screen);
}

async function switchProvider(args, { screen, session }) {
  const t = getTranslator(session);
  const [providerName] = args;
  if (!providerName) {
    const selected = await promptForOption({ screen, session, name: 'Provider', options: PROVIDERS.filter(p => p.value !== 'mock'), defaultValue: session.provider.name, t });
    if (!selected) {
      screen.write(`${THEME.dim}${t('provider.current', { provider: '' })}${ANSI.reset || ''}${THEME.bold}${session.provider.name}${ANSI.reset || ''}\n`);
      return;
    }
    await switchProvider([selected], { screen, session });
    return;
  }
  const normalized = providerName.toLowerCase().trim();
  if (!['anthropic', 'claude', 'openai', 'gpt', 'google', 'gemini'].includes(normalized)) {
    screen.write(`${THEME.error}${t('provider.unknown', { provider: providerName })}${ANSI.reset || ''}\n`);
    return;
  }
  session.provider = createProvider({ provider: normalized, apiKey: session.provider.apiKey, apiUrl: session.provider.apiUrl, model: session.provider.model }, process.env);
  persistAgentSettings({ provider: session.provider.name, apiKey: session.provider.apiKey, apiUrl: session.provider.apiUrl, model: session.provider.model });
  session.availableModels = undefined;
  screen.write(`${THEME.success}${t('provider.switched', { provider: session.provider.name })}${ANSI.reset || ''}\n`);
}

async function switchModel(args, { screen, session }) {
  const t = getTranslator(session);
  const [selection] = args;
  if (!selection) {
    let models = session.availableModels;
    if (!Array.isArray(models) || models.length === 0) {
      try { models = await session.provider.listModels(); session.availableModels = models; }
      catch (e) { screen.write(`${THEME.error}${e.message}${ANSI.reset || ''}\n`); return; }
    }
    const selected = await promptForOption({ screen, session, name: t('config.model').replace(/:$/, ''), options: models.map(m => ({ value: m.id, label: m.name && m.name !== m.id ? `${m.id} (${m.name})` : m.id })), defaultValue: session.provider.model, t });
    if (selected) { await switchModel([selected], { screen, session }); return; }
    screen.write(`${THEME.dim}${t('model.current', { model: '' })}${ANSI.reset || ''}${THEME.bold}${session.provider.model || t('common.unknown')}${ANSI.reset || ''}\n`);
    return;
  }
  session.provider.setModel(resolveModelSelection(selection, session.availableModels || []));
  screen.write(`${THEME.success}${t('model.switched', { model: session.provider.model })}${ANSI.reset || ''}\n`);
}

async function switchApiUrl(args, { screen, session }) {
  const t = getTranslator(session);
  const [apiUrl] = args;
  if (!apiUrl) { screen.write(`${THEME.dim}${t('apiUrl.current', { url: session.provider.apiUrl || t('common.default') })}${ANSI.reset || ''}\n`); return; }
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
    return;
  }
  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    session.provider = createProvider({ provider: 'anthropic', apiKey, apiUrl: session.provider.apiUrl, model: session.provider.model }, process.env);
  } else {
    session.provider.setApiKey(apiKey);
  }
  persistAgentSettings({ provider: session.provider.name, apiKey: session.provider.apiKey, apiUrl: session.provider.apiUrl, model: session.provider.model });
  session.availableModels = undefined;
  screen.write(`${THEME.success}${t('apiKey.switched', { provider: session.provider.name })}${ANSI.reset || ''}\n`);
}

// --------------- Config / Doctor / Misc ---------------

async function switchLanguage(args, { screen, session }) {
  const t = getTranslator(session);
  const [localeInput] = args;
  const currentLocale = normalizeLocale(session.settings.ui?.locale);
  if (!localeInput) {
    const selected = await promptForOption({ screen, session, name: t('init.language'), options: listLocales(), defaultValue: currentLocale, t });
    if (!selected) { screen.write(`${THEME.dim}${t('language.current', { language: getLocaleLabel(currentLocale), locale: currentLocale })}${ANSI.reset || ''}\n`); return; }
    await switchLanguage([selected], { screen, session });
    return;
  }
  const locale = normalizeLocale(localeInput);
  if (!listLocales().some(item => item.value === locale)) {
    screen.write(`${THEME.error}${t('language.unknown', { locale: localeInput })}${ANSI.reset || ''}\n`);
    return;
  }
  session.settings.ui = { ...(session.settings.ui || {}), locale };
  if (session.permissionManager) session.permissionManager.locale = locale;
  updateUserSettings({ ui: { locale } });
  const nextT = createTranslator(locale);
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
  const t = getTranslator(session);
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) { screen.write(`${THEME.dim}${t('sessions.none')}${ANSI.reset || ''}\n`); return; }
  screen.write(`\n${THEME.heading}${t('sessions.title')}${ANSI.reset || ''}\n`);
  for (const s of sessions.slice(0, 20)) {
    const entries = s.entries();
    const firstMsg = entries.filter(e => e.role === 'user')[0]?.content || '(empty)';
    const preview = firstMsg.length > 50 ? firstMsg.slice(0, 47) + '...' : firstMsg;
    screen.write(`  ${THEME.dim}${s.id.slice(0, 20)}${ANSI.reset || ''}  ${new Date(s.updatedAt).toLocaleDateString()}  ${preview}\n`);
  }
  screen.write('\n');
}

async function resumeSession(args, { screen, session }) {
  const t = getTranslator(session);
  const [sessionId] = args;
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) { screen.write(`${THEME.warning}${t('sessions.none')}${ANSI.reset || ''}\n`); return; }
  let target = sessionId ? sessions.find(s => s.id.startsWith(sessionId)) : sessions[0];
  if (!target) { screen.write(`${THEME.error}${t('sessions.notFound', { id: sessionId })}${ANSI.reset || ''}\n`); return; }
  const entries = target.entries().filter(e => e.role === 'user' || e.role === 'assistant');
  session.messages = entries.slice(-200).map(e => ({ role: e.role, content: e.content || '' }));
  session.id = target.id;
  screen.write(`${THEME.success}${t('sessions.resumed', { id: target.id.slice(0, 20), count: session.messages.length })}${ANSI.reset || ''}\n\n`);
}

function showConfig({ screen, session }) {
  const t = getTranslator(session);
  const locale = normalizeLocale(session.settings.ui?.locale);
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
}

function buildDoctorReport(session, options = {}) {
  const locale = normalizeLocale(session.settings.ui?.locale);
  const report = {
    ok: true, checkedAt: new Date().toISOString(),
    node: { version: process.version, ok: true },
    provider: { name: session.provider?.name || 'unknown', model: session.provider?.model || '', apiKeySet: Boolean(session.provider?.apiKey), apiUrl: session.provider?.apiUrl || null },
    ui: { locale, language: getLocaleLabel(locale), tty: Boolean(options.isTTY ?? new TerminalScreen().isTTY()), terminal: { columns: options.columns ?? null, rows: options.rows ?? null } },
    project: { root: session.settings.projectRoot || process.cwd() },
    shell: { enabled: Boolean(session.settings.tools?.shell?.enabled), timeoutMs: session.settings.tools?.shell?.timeoutMs, maxBuffer: session.settings.tools?.shell?.maxBuffer },
    permissions: session.permissionManager?.getSummary?.() || null,
    memory: { enabled: Boolean(session.settings.memory?.enabled), directory: session.settings.memory?.directory || null, maxItems: session.settings.memory?.maxItems },
    sessions: { directory: session.settings.sessions?.directory || null, transcriptLimit: session.settings.sessions?.transcriptLimit, activeSessionId: session.id },
  };
  const warnings = [];
  if (report.provider.name !== 'mock' && !report.provider.apiKeySet) warnings.push('provider_api_key_missing');
  if (!report.shell.enabled) warnings.push('shell_tool_disabled');
  if (!report.ui.tty) warnings.push('not_running_in_tty');
  report.warnings = warnings;
  report.ok = warnings.length === 0;
  return report;
}

function runDoctor(argsOrContext, maybeContext) {
  const context = maybeContext || argsOrContext;
  const args = Array.isArray(argsOrContext) ? argsOrContext : [];
  const { screen, session } = context;
  const t = getTranslator(session);
  const report = buildDoctorReport(session);
  if (args.includes('--json')) { screen.write(`${JSON.stringify(report, null, 2)}\n`); return; }
  screen.write(`\n${THEME.heading}${t('doctor.title')}${ANSI.reset || ''}\n`);
  const checks = [
    { name: t('doctor.node'), value: report.node.version },
    { name: t('doctor.provider'), value: report.provider.name },
    { name: t('doctor.model'), value: report.provider.model },
    { name: t('doctor.apiKey'), value: report.provider.apiKeySet ? `${THEME.success}${t('doctor.okSet')}${ANSI.reset || ''}` : `${THEME.error}${t('doctor.missing')}${ANSI.reset || ''}` },
    { name: t('doctor.shellTool'), value: report.shell.enabled ? `${THEME.success}${t('common.enabled')}${ANSI.reset || ''}` : `${THEME.warning}${t('common.disabled')}${ANSI.reset || ''}` },
    { name: t('doctor.tty'), value: report.ui.tty ? `${THEME.success}${t('common.yes')}${ANSI.reset || ''}` : `${THEME.warning}${t('common.no')}${ANSI.reset || ''}` },
  ];
  for (const { name, value } of checks) { screen.write(`  ${THEME.dim}${name.padEnd(14)}${ANSI.reset || ''} ${value}\n`); }
  if (report.warnings.length > 0) { screen.write(`\n  ${THEME.warning}Warnings:${ANSI.reset || ''} ${report.warnings.join(', ')}\n`); }
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

// --------------- Memory ---------------

function handleMemoryCommand(args, { screen, session }) {
  const t = getTranslator(session);
  const [subCommand, ...subArgs] = args;
  switch (subCommand) {
    case 'list':
    case undefined: {
      const memories = listMemories(session.settings);
      if (memories.length === 0) { screen.write(`${THEME.dim}No memories stored.${ANSI.reset || ''}\n`); return; }
      screen.write(`\n${THEME.heading}Memories${ANSI.reset || ''}\n`);
      for (const mem of memories) screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''}\n`);
      screen.write('\n');
      break;
    }
    case 'read': {
      const [name] = subArgs;
      if (!name) { screen.write(`${THEME.dim}Usage: /memory read <name>${ANSI.reset || ''}\n`); return; }
      const mem = readMemory(name, session.settings);
      if (!mem) { screen.write(`${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`); return; }
      screen.write(`${THEME.heading}${mem.name}${ANSI.reset || ''}\n${mem.content}\n\n`);
      break;
    }
    case 'write': {
      const [name, ...contentParts] = subArgs;
      if (!name || contentParts.length === 0) { screen.write(`${THEME.dim}Usage: /memory write <name> <content>${ANSI.reset || ''}\n`); return; }
      writeMemory(name, contentParts.join(' '), session.settings);
      screen.write(`${THEME.success}Memory saved: ${name}${ANSI.reset || ''}\n`);
      break;
    }
    case 'delete': {
      const [name] = subArgs;
      if (!name) { screen.write(`${THEME.dim}Usage: /memory delete <name>${ANSI.reset || ''}\n`); return; }
      const deleted = deleteMemory(name, session.settings);
      screen.write(deleted ? `${THEME.success}Memory deleted: ${name}${ANSI.reset || ''}\n` : `${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
      break;
    }
    default:
      screen.write(`${THEME.error}Unknown memory command: ${subCommand}${ANSI.reset || ''}\n`);
      writeCommandSuggestion(screen, t, getSubcommandSuggestion('memory', subCommand));
  }
}

// --------------- Team ---------------

function createCliTeamRuntime(settings) {
  return createTeamRuntime({ settings, projectRoot: settings.projectRoot || process.cwd(), toolRegistryFactory: () => createLocalToolRegistry({ root: settings.projectRoot || process.cwd(), shellPolicy: settings.tools?.shell }) });
}

async function handleTeamCommand(args, { screen, session }) {
  const runtime = createCliTeamRuntime(session.settings);
  const [subCommand = 'status', ...subArgs] = args;
  const t = getTranslator(session);
  try {
    const output = await executeTeamCommand(runtime, subCommand, subArgs, { settings: session.settings, session });
    if (output) screen.write(`\n${output}\n\n`);
  } catch (error) {
    screen.write(`${THEME.error}Error: ${error.message}${ANSI.reset || ''}\n`);
    writeCommandSuggestion(screen, t, getSubcommandSuggestion('team', subCommand));
  }
}

async function executeTeamCommand(runtime, subCommand, args, context = {}) {
  function parseTeamOptions(args) {
    const options = { _: [] };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('--')) { options._.push(arg); continue; }
      const [rawKey, inlineValue] = arg.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = inlineValue !== undefined ? inlineValue : args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    }
    return options;
  }
  function parseMembersOption(value) { return value ? String(value).split(',').map(item => { const [t, n] = item.split(':'); return { agentType: t, name: n }; }).filter(m => m.agentType) : []; }

  switch (subCommand) {
    case 'help': return `Usage: hax-agent team <command>\nCommands: agents, list, new, spawn, task, run, status, send, inbox`;
    case 'agents': return formatAgentList(loadAgentDefinitions({ projectRoot: context.settings?.projectRoot || process.cwd(), settings: context.settings }));
    case 'list': return formatTeamList(runtime.listTeams());
    case 'new': case 'create': {
      const opt = parseTeamOptions(args);
      const result = runtime.createTeam({ name: opt.name || opt._[0] || 'default', mission: opt.mission || opt._.slice(1).join(' '), members: parseMembersOption(opt.members || opt.member) });
      return formatTeamSnapshot(result.team);
    }
    case 'spawn': case 'add-agent': {
      const opt = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: opt.team || opt.t || 'default' });
      const member = runtime.addMember({ agentType: opt.type || opt.agent || opt._[0] || 'general-purpose', name: opt.name || opt._[1], model: opt.model });
      return `Spawned ${member.name} (${member.agentType})\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'task': case 'add-task': {
      const opt = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: opt.team || opt.t || 'default' });
      const task = runtime.addTask({ title: opt.title || opt._.join(' '), prompt: opt.prompt || opt.title || opt._.join(' '), owner: opt.owner, agentType: opt.type || opt.agent, deliverable: opt.deliverable, dependsOn: opt.depends || opt.dependsOn, parallel: opt.parallel !== 'false' });
      return `Added task ${task.id}\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'run': { const opt = parseTeamOptions(args); runtime.loadOrCreateTeam({ name: opt.team || opt.t || 'default' }); return formatRunResult(await runtime.run({ concurrency: opt.concurrency, maxToolTurns: opt.maxToolTurns })); }
    case 'status': case 'show': { const opt = parseTeamOptions(args); return formatTeamSnapshot(runtime.loadTeam(opt.team || opt.t || opt._[0] || 'default')); }
    case 'send': { const opt = parseTeamOptions(args); runtime.loadTeam(opt.team || opt.t || 'default'); return formatMessages([runtime.sendMessage({ to: opt.to || opt._[0], body: opt.message || opt._.slice(1).join(' ') })]); }
    case 'inbox': { const opt = parseTeamOptions(args); runtime.loadTeam(opt.team || opt.t || 'default'); return formatMessages(runtime.drainMessages(opt.agent || opt._[0] || 'lead')); }
    default: throw new Error(`Unknown team command: ${subCommand}`);
  }
}

// --------------- Update / Models ---------------

async function printModels(provider, output) {
  const models = await provider.listModels();
  const t = createTranslator(loadSettings().ui?.locale);
  output.write(`\n${THEME.heading}${t('models.title', { provider: provider.name })}${ANSI.reset || ''}\n`);
  output.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  models.forEach((model, index) => {
    const marker = model.id === provider.model ? `${THEME.success}*${ANSI.reset || ''}` : ' ';
    const label = model.name && model.name !== model.id ? ` ${THEME.dim}(${model.name})${ANSI.reset || ''}` : '';
    output.write(` ${marker} ${THEME.dim}${String(index + 1).padStart(2)}.${ANSI.reset || ''} ${model.id}${label}\n`);
  });
  output.write('\n');
  return models;
}

function resolveModelSelection(selection, models) {
  const n = Number(selection);
  if (Number.isInteger(n) && n > 0 && n <= models.length) return models[n - 1].id;
  return selection;
}

function persistAgentSettings(agentSettings) {
  updateUserSettings({ agent: agentSettings });
}

async function handleUpdateCheck(args, { screen }) {
  const shouldInstall = args[0] === 'install';
  screen.write(`${THEME.dim}Checking for updates...${ANSI.reset || ''}\n`);
  const result = await checkForUpdate(VERSION, { force: true });
  if (result.error && !result.latestVersion) { screen.write(`${THEME.error}Failed to check for updates: ${result.error}${ANSI.reset || ''}\n`); return; }
  if (!result.hasUpdate) { screen.write(`${styled(THEME.success, `✔ You're on the latest version (v${result.currentVersion})`)}\n\n`); return; }
  screen.write(`${styled(THEME.warning, `⬆ New version available: v${result.currentVersion} → v${result.latestVersion}`)}\n`);
  if (!shouldInstall) { screen.write(`${styled(THEME.dim, '  Run /update install to update now.')}\n\n`); return; }
  try { await performUpdate(); screen.write(`${styled(THEME.success, '  ✔ Update complete.')}\n\n`); setTimeout(() => restartProcess(), 500); }
  catch (err) { screen.write(`${styled(THEME.error, `  ✖ Update failed: ${err.message}`)}\n`); }
}

module.exports = {
  showShellHelp, exitShell, clearShell, compactShell,
  showTools, showSkills, showAgents,
  handlePermissionsCommand, handleSkillifyCommand,
  showModels, switchProvider, switchModel, switchApiUrl, switchApiKey,
  switchLanguage, showCost, handleContextCommand, showSessions, resumeSession,
  showConfig, buildDoctorReport, runDoctor,
  toggleTheme, toggleVim,
  handleMemoryCommand,
  handleTeamCommand, createCliTeamRuntime, executeTeamCommand,
  printModels, resolveModelSelection, persistAgentSettings,
  handleUpdateCheck,
  getSlashCommandSuggestion, getSubcommandSuggestion,
};
