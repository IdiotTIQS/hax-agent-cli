const { loadSettings, updateUserSettings } = require('./config');
const { appendTranscriptEntry, createSessionId, listSessions, readTranscript } = require('./memory');
const { createProvider } = require('./providers');
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require('./skills');
const { buildSkillSystemPrompt, matchSkillByIntent, getSkillsForSession } = require('./skills/intent-matcher');
const { loadAgentDefinitions } = require('./teams/agents');
const { createTeamRuntime } = require('./teams/runtime');
const { createLocalToolRegistry } = require('./tools');
const { formatTeamPlan } = require('./formatters/team-plan');
const { formatAgentList, formatMessages, formatRunResult, formatTeamList, formatTeamSnapshot } = require('./formatters/agent-teams');
const { PERMISSION_LABELS } = require('./permissions');
const {
  THEME, TerminalScreen, MarkdownRenderer, ResponseRenderer,
  formatProviderError, VERSION, CLAUDE_BANNER, ANSI, styled,
} = require('./renderer');
const { Session, CostTracker } = require('./session');
const { checkForUpdate, performUpdate, restartProcess } = require('./updater');
const { PROVIDERS, chooseOptionWithArrows } = require('./init-wizard');
const { createTranslator, getLocaleLabel, listLocales, normalizeLocale } = require('./i18n');
const { suggestCommand } = require('./command-suggestions');

const SLASH_COMMANDS = [
  { name: 'help', descriptionKey: 'cmd.help', description: 'Show available commands and shortcuts', aliases: ['h', '?'] },
  { name: 'exit', descriptionKey: 'cmd.exit', description: 'Exit the session', aliases: ['q', 'quit'] },
  { name: 'clear', descriptionKey: 'cmd.clear', description: 'Clear conversation and start fresh', aliases: ['c'] },
  { name: 'compact', descriptionKey: 'cmd.compact', description: 'Compact conversation to reduce context', aliases: [] },
  { name: 'tools', descriptionKey: 'cmd.tools', description: 'List available tools', aliases: ['t'] },
  { name: 'skills', descriptionKey: 'cmd.skills', description: 'List or manage skills', aliases: ['skill'], argHint: '[list|usage]' },
  { name: 'skillify', descriptionKey: 'cmd.skillify', description: 'Capture this session as a reusable skill', aliases: [], argHint: '[description]' },
  { name: 'agents', descriptionKey: 'cmd.agents', description: 'List available agents', aliases: ['a'] },
  { name: 'team', descriptionKey: 'cmd.team', description: 'Manage agent teams and teammates', aliases: ['teams'], argHint: '[new|spawn|task|run|status|send|inbox|agents]' },
  { name: 'models', descriptionKey: 'cmd.models', description: 'List available models', aliases: ['m'] },
  { name: 'model', descriptionKey: 'cmd.model', description: 'Switch the active model', aliases: [], argHint: '<model-id-or-number>' },
  { name: 'provider', descriptionKey: 'cmd.provider', description: 'Show or switch the AI provider', aliases: ['p'], argHint: '<anthropic|openai|google>' },
  { name: 'api-url', descriptionKey: 'cmd.apiUrl', description: 'Show or set the API base URL', aliases: [], argHint: '<base-url>' },
  { name: 'api-key', descriptionKey: 'cmd.apiKey', description: 'Show or set the API key', aliases: [], argHint: '<key>' },
  { name: 'language', descriptionKey: 'cmd.language', description: 'Show or switch the CLI language', aliases: ['lang', 'locale'], argHint: '<en|zh-CN|zh-TW|ru>' },
  { name: 'cost', descriptionKey: 'cmd.cost', description: 'Show token usage and cost for this session', aliases: [] },
  { name: 'sessions', descriptionKey: 'cmd.sessions', description: 'List previous sessions', aliases: ['s'] },
  { name: 'resume', descriptionKey: 'cmd.resume', description: 'Resume a previous session', aliases: ['r'], argHint: '<session-id>' },
  { name: 'config', descriptionKey: 'cmd.config', description: 'Show current configuration', aliases: [] },
  { name: 'doctor', descriptionKey: 'cmd.doctor', description: 'Run diagnostics and check setup', aliases: [] },
  { name: 'theme', descriptionKey: 'cmd.theme', description: 'Toggle color theme', aliases: [] },
  { name: 'vim', descriptionKey: 'cmd.vim', description: 'Toggle vim keybindings mode', aliases: [] },
  { name: 'memory', descriptionKey: 'cmd.memory', description: 'Manage agent memory', aliases: [], argHint: '[list|read|write|delete] [name]' },
  { name: 'permissions', descriptionKey: 'cmd.permissions', description: 'View or manage tool permission levels', aliases: ['perm'], argHint: '[status|mode <auto|ask|yolo>|reset]' },
  { name: 'update', descriptionKey: 'cmd.update', description: 'Check for CLI updates', aliases: [], argHint: '[install]' },
];

const SKILLS_SUBCOMMANDS = ['list', 'usage'];
const PERMISSIONS_SUBCOMMANDS = ['status', 'mode', 'reset'];
const MEMORY_SUBCOMMANDS = ['list', 'read', 'write', 'delete'];
const TEAM_SUBCOMMANDS = [
  'help',
  'agents',
  'list',
  'new',
  'create',
  'spawn',
  'add-agent',
  'task',
  'add-task',
  'run',
  'status',
  'show',
  'send',
  'inbox',
];

let themeEnabled = true;
let vimMode = false;

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
    team: TEAM_SUBCOMMANDS,
  };
  const suggestion = suggestCommand(subCommand, candidatesByCommand[commandName] || []);
  return suggestion ? `/${commandName} ${suggestion}` : null;
}

function writeCommandSuggestion(screen, t, suggestion) {
  if (!suggestion) return;
  screen.write(`${THEME.dim}${t('errors.didYouMean', { command: suggestion })}${ANSI.reset || ''}\n`);
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
  const { stripAnsi } = require('./renderer');
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
  const limit = session.settings.prompts?.maxTranscriptMessages || 20;
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-limit)
    .map(e => ({ role: e.role, content: e.content || '' }));

  if (restored.length > 0) {
    session.messages = restored;
    session.id = latestSession.id;
  }
}

async function handleChatMessage(content, { screen, session, markdown }) {
  const skillMatch = content.match(/^\/(\S+)(?:\s+(.*))?$/);

  if (skillMatch) {
    const skillName = skillMatch[1];
    const skillArgs = skillMatch[2] ? skillMatch[2].split(/\s+/) : [];
    const skills = loadAllSkills(session.settings.projectRoot || process.cwd());
    const skillify = createSkillifySkill(session.messages);
    const allSkills = [skillify, ...skills];
    const matchedSkill = allSkills.find((s) => s.name === skillName && !s.isHidden);

    if (matchedSkill) {
      recordSkillUsage(matchedSkill.name);
      await handleSkillInvocation(matchedSkill, skillArgs, { screen, session, markdown });
      return;
    }
  }

  const skills = getSkillsForSession(session.settings.projectRoot, session.messages);
  const intentMatchedSkill = matchSkillByIntent(content, skills);

  if (intentMatchedSkill) {
    recordSkillUsage(intentMatchedSkill.name);
    screen.write(`${THEME.dim}Auto-invoking skill: ${intentMatchedSkill.displayName || intentMatchedSkill.name}${ANSI.reset || ''}\n`);
    await handleSkillInvocation(intentMatchedSkill, [], { screen, session, markdown });
    return;
  }

  const skillSystemPrompt = buildSkillSystemPrompt(skills);
  const userMessage = { role: 'user', content };
  const abortController = new AbortController();
  const renderer = new ResponseRenderer(screen, markdown);
  let assistantText = '';

  session.toolRegistry.resetSingleCallTracking();
  session.messages.push(userMessage);
  session.isStreaming = true;
  session.responseInterrupted = false;
  session.responseAbortController = abortController;
  session.responseRenderer = renderer;
  renderer.startWaiting();
  const turnInputTokens = session.costTracker.inputTokens;
  const turnOutputTokens = session.costTracker.outputTokens;

  try {
    for await (const chunk of session.provider.stream({
      messages: session.messages,
      toolRegistry: session.toolRegistry,
      signal: abortController.signal,
      system: skillSystemPrompt,
    })) {
      if (session.responseInterrupted) break;

      if (chunk.type === 'text') {
        assistantText += chunk.delta;
        renderer.writeText(chunk.delta);

        if (process.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === '1') {
          session.responseInterrupted = true;
          renderer.interrupt();
          break;
        }
      } else if (chunk.type === 'thinking') {
        renderer.thinking(chunk);
      } else if (chunk.type === 'tool_start') {
        session.costTracker.addToolCall();
        renderer.startTool(chunk);
      } else if (chunk.type === 'tool_result') {
        renderer.finishTool(chunk);
      } else if (chunk.type === 'tool_limit') {
        renderer.notice(`Tool turn limit reached after ${chunk.maxToolTurns} turns. Type /continue if you need more.`);
      } else if (chunk.type === 'usage') {
        session.costTracker.addUsage(chunk, session.provider.model);
      }
    }
  } catch (error) {
    if (session.responseInterrupted || error?.name === 'AbortError') {
      session.messages.pop();
      return;
    }

    renderer.fail(formatProviderError(error, session.provider));
    session.messages.pop();
    return;
  } finally {
    session.isStreaming = false;
    session.responseAbortController = null;
    session.responseRenderer = null;
  }

  if (session.responseInterrupted) {
    session.messages.pop();
    return;
  }

  const turnUsage = {
    inputTokens: session.costTracker.inputTokens - turnInputTokens,
    outputTokens: session.costTracker.outputTokens - turnOutputTokens,
  };

  renderer.complete(turnUsage);
  session.messages.push({ role: 'assistant', content: assistantText });
  appendTranscriptEntry(session.id, userMessage, session.settings);
  appendTranscriptEntry(session.id, { role: 'assistant', content: assistantText }, session.settings);
}

async function handleSkillInvocation(skill, args, { screen, session, markdown }) {
  screen.write(`${THEME.skillIndicator}Skill${ANSI.reset || ''} ${THEME.accent}${skill.displayName || skill.name}${ANSI.reset || ''}\n`);

  try {
    const promptBlocks = await skill.getPromptForCommand(args);
    const skillContent = promptBlocks.map((b) => b.text).join('\n');

    const userMessage = { role: 'user', content: skillContent };
    session.messages.push(userMessage);

    const abortController = new AbortController();
    const renderer = new ResponseRenderer(screen, markdown);
    let assistantText = '';

    session.isStreaming = true;
    session.responseInterrupted = false;
    session.responseAbortController = abortController;
    session.responseRenderer = renderer;
    renderer.startWaiting();

    const otherSkills = getSkillsForSession(session.settings.projectRoot, session.messages).filter((s) => s.name !== skill.name);
    const skillSystemPrompt = buildSkillSystemPrompt(otherSkills);

    for await (const chunk of session.provider.stream({
      messages: session.messages,
      toolRegistry: session.toolRegistry,
      signal: abortController.signal,
      system: skillSystemPrompt,
    })) {
      if (session.responseInterrupted) break;

      if (chunk.type === 'text') {
        assistantText += chunk.delta;
        renderer.writeText(chunk.delta);
      } else if (chunk.type === 'thinking') {
        renderer.thinking(chunk);
      } else if (chunk.type === 'tool_start') {
        session.costTracker.addToolCall();
        renderer.startTool(chunk);
      } else if (chunk.type === 'tool_result') {
        renderer.finishTool(chunk);
      } else if (chunk.type === 'usage') {
        session.costTracker.addUsage(chunk, session.provider.model);
      }
    }

    if (!session.responseInterrupted) {
      renderer.complete({ inputTokens: 0, outputTokens: 0 });
      session.messages.push({ role: 'assistant', content: assistantText });
      appendTranscriptEntry(session.id, userMessage, session.settings);
      appendTranscriptEntry(session.id, { role: 'assistant', content: assistantText }, session.settings);
    } else {
      session.messages.pop();
    }
  } catch (error) {
    screen.write(`${THEME.error}Skill execution failed: ${error.message}${ANSI.reset || ''}\n`);
  } finally {
    session.isStreaming = false;
    session.responseAbortController = null;
    session.responseRenderer = null;
  }
}

async function handleSlashCommand(line, context) {
  const [commandName, ...args] = line.slice(1).split(/\s+/);

  const command = SLASH_COMMANDS.find(c =>
    c.name === commandName || c.aliases?.includes(commandName)
  );

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
    return;
  }

  switch (command.name) {
    case 'help': showShellHelp(context); break;
    case 'exit': exitShell(context); break;
    case 'clear': clearShell(context); break;
    case 'compact': compactShell(context); break;
    case 'tools': showTools(context); break;
    case 'skills': showSkills(args, context); break;
    case 'skillify': await handleSkillifyCommand(args, context); break;
    case 'agents': showAgents(context); break;
    case 'team': await handleTeamCommand(args, context); break;
    case 'models': await showModels(context); break;
    case 'model': await switchModel(args, context); break;
    case 'provider': await switchProvider(args, context); break;
    case 'api-url': await switchApiUrl(args, context); break;
    case 'api-key': await switchApiKey(args, context); break;
    case 'language': await switchLanguage(args, context); break;
    case 'cost': showCost(context); break;
    case 'sessions': await showSessions(context); break;
    case 'resume': await resumeSession(args, context); break;
    case 'config': showConfig(context); break;
    case 'doctor': runDoctor(context); break;
    case 'theme': toggleTheme(context); break;
    case 'vim': toggleVim(context); break;
    case 'memory': handleMemoryCommand(args, context); break;
    case 'permissions': await handlePermissionsCommand(args, context); break;
    case 'update': await handleUpdateCheck(args, context); break;
    default:
      context.screen.write(`${THEME.error}Command not implemented: /${command.name}${ANSI.reset || ''}\n`);
  }
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
  session.costTracker = new CostTracker();
  screen.clear();
  renderBanner(screen, session);
  screen.write(`${THEME.success}${t('shell.contextCleared')}${ANSI.reset || ''}\n\n`);
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
    const { getSkillUsageStats } = require('./skills');
    const stats = getSkillUsageStats();
    const skillNames = Object.keys(stats);

    if (skillNames.length === 0) {
      screen.write(`${THEME.dim}${t('skills.noUsage')}${ANSI.reset || ''}\n`);
      return;
    }

    screen.write(`\n${THEME.heading}${t('skills.usageTitle')}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

    const sorted = skillNames.sort((a, b) => {
      const { getSkillUsageScore } = require('./skills');
      return getSkillUsageScore(b) - getSkillUsageScore(a);
    });

    for (const name of sorted) {
      const { getSkillUsageScore } = require('./skills');
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

async function handleSkillifyCommand(args, { screen, session }) {
  const description = args.join(' ');
  const skillify = createSkillifySkill(session.messages);

  screen.write(`\n${THEME.heading}Skillify${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}Capturing session as a reusable skill...${ANSI.reset || ''}\n\n`);

  const promptBlocks = await skillify.getPromptForCommand(description ? [description] : []);
  const skillContent = promptBlocks.map((b) => b.text).join('\n');

  const userMessage = { role: 'user', content: skillContent };
  session.messages.push(userMessage);

  const abortController = new AbortController();
  const markdown = new MarkdownRenderer(screen.columns);
  const renderer = new ResponseRenderer(screen, markdown);
  let assistantText = '';

  session.isStreaming = true;
  session.responseInterrupted = false;
  session.responseAbortController = abortController;
  session.responseRenderer = renderer;
  renderer.startWaiting();

  try {
    for await (const chunk of session.provider.stream({
      messages: session.messages,
      toolRegistry: session.toolRegistry,
      signal: abortController.signal,
    })) {
      if (session.responseInterrupted) break;

      if (chunk.type === 'text') {
        assistantText += chunk.delta;
        renderer.writeText(chunk.delta);
      } else if (chunk.type === 'thinking') {
        renderer.thinking(chunk);
      } else if (chunk.type === 'tool_start') {
        session.costTracker.addToolCall();
        renderer.startTool(chunk);
      } else if (chunk.type === 'tool_result') {
        renderer.finishTool(chunk);
      } else if (chunk.type === 'usage') {
        session.costTracker.addUsage(chunk, session.provider.model);
      }
    }

    if (!session.responseInterrupted) {
      renderer.complete({ inputTokens: 0, outputTokens: 0 });
      session.messages.push({ role: 'assistant', content: assistantText });
      appendTranscriptEntry(session.id, userMessage, session.settings);
      appendTranscriptEntry(session.id, { role: 'assistant', content: assistantText }, session.settings);
    } else {
      session.messages.pop();
    }
  } catch (error) {
    renderer.fail(`Skillify failed: ${error.message}`);
    session.messages.pop();
  } finally {
    session.isStreaming = false;
    session.responseAbortController = null;
    session.responseRenderer = null;
  }
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

async function showSessions({ screen, session }) {
  const t = getTranslator(session);
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) {
    screen.write(`${THEME.dim}${t('sessions.none')}${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}${t('sessions.title')}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  for (const s of sessions.slice(0, 20)) {
    const entries = s.entries();
    const userMessages = entries.filter(e => e.role === 'user');
    const firstMsg = userMessages[0]?.content || '(empty)';
    const preview = firstMsg.length > 50 ? firstMsg.slice(0, 47) + '...' : firstMsg;
    const date = new Date(s.updatedAt).toLocaleDateString();
    screen.write(`  ${THEME.dim}${s.id.slice(0, 20)}${ANSI.reset || ''}  ${THEME.dim}${date}${ANSI.reset || ''}  ${preview}\n`);
  }
  screen.write('\n');
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
  const limit = session.settings.prompts?.maxTranscriptMessages || 20;
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-limit)
    .map(e => ({ role: e.role, content: e.content || '' }));

  session.messages = restored;
  session.id = targetSession.id;
  screen.write(`${THEME.success}${t('sessions.resumed', { id: targetSession.id.slice(0, 20), count: restored.length })}${ANSI.reset || ''}\n\n`);
}

function formatSessionOption(session) {
  const entries = session.entries();
  const userMessages = entries.filter(e => e.role === 'user');
  const firstMsg = userMessages[0]?.content || '(empty)';
  const preview = firstMsg.length > 48 ? firstMsg.slice(0, 45) + '...' : firstMsg;
  const date = new Date(session.updatedAt).toLocaleString();
  return `${session.id.slice(0, 12)}  ${date}  ${preview}`;
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
  themeEnabled = !themeEnabled;
  screen.write(`${THEME.success}Theme ${themeEnabled ? 'enabled' : 'disabled'}.${ANSI.reset || ''}\n`);
}

function toggleVim({ screen }) {
  vimMode = !vimMode;
  screen.write(`${THEME.success}Vim mode ${vimMode ? 'enabled' : 'disabled'}.${ANSI.reset || ''}\n`);
}

function handleMemoryCommand(args, { screen, session }) {
  const { listMemories, readMemory, writeMemory, deleteMemory } = require('./memory');
  const t = getTranslator(session);
  const [subCommand, ...subArgs] = args;

  switch (subCommand) {
    case 'list':
    case undefined: {
      const memories = listMemories(session.settings);
      if (memories.length === 0) {
        screen.write(`${THEME.dim}No memories stored.${ANSI.reset || ''}\n`);
        return;
      }
      screen.write(`\n${THEME.heading}Memories${ANSI.reset || ''}\n`);
      for (const mem of memories) {
        screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''} ${THEME.dim}${mem.updatedAt ? new Date(mem.updatedAt).toLocaleDateString() : ''}${ANSI.reset || ''}\n`);
      }
      screen.write('\n');
      break;
    }
    case 'read': {
      const [name] = subArgs;
      if (!name) {
        screen.write(`${THEME.dim}Usage: /memory read <name>${ANSI.reset || ''}\n`);
        return;
      }
      const mem = readMemory(name, session.settings);
      if (!mem) {
        screen.write(`${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
        return;
      }
      screen.write(`${THEME.heading}${mem.name}${ANSI.reset || ''}\n${mem.content}\n\n`);
      break;
    }
    case 'write': {
      const [name, ...contentParts] = subArgs;
      if (!name || contentParts.length === 0) {
        screen.write(`${THEME.dim}Usage: /memory write <name> <content>${ANSI.reset || ''}\n`);
        return;
      }
      writeMemory(name, contentParts.join(' '), session.settings);
      screen.write(`${THEME.success}Memory saved: ${name}${ANSI.reset || ''}\n`);
      break;
    }
    case 'delete': {
      const [name] = subArgs;
      if (!name) {
        screen.write(`${THEME.dim}Usage: /memory delete <name>${ANSI.reset || ''}\n`);
        return;
      }
      const deleted = deleteMemory(name, session.settings);
      screen.write(deleted ? `${THEME.success}Memory deleted: ${name}${ANSI.reset || ''}\n` : `${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
      break;
    }
    default:
      screen.write(`${THEME.error}Unknown memory command: ${subCommand}${ANSI.reset || ''}\n`);
      writeCommandSuggestion(screen, t, getSubcommandSuggestion('memory', subCommand));
      screen.write(`${THEME.dim}Usage: /memory [list|read|write|delete]${ANSI.reset || ''}\n`);
  }
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

function createCliTeamRuntime(settings) {
  return createTeamRuntime({
    settings,
    projectRoot: settings.projectRoot || process.cwd(),
    toolRegistryFactory: () => createLocalToolRegistry({ root: settings.projectRoot || process.cwd(), shellPolicy: settings.tools?.shell }),
  });
}

async function executeTeamCommand(runtime, subCommand, args, context = {}) {
  function formatTeamUsage() {
    return [
      'Usage: hax-agent team <command> [options]',
      '',
      'Commands:',
      '  team agents                         List available agent types',
      '  team list                           List saved teams',
      '  team new <name> --mission <text>     Create a team state file',
      '  team spawn <agent-type> [name]       Add a teammate to a team',
      '  team task <title> --owner <agent>    Add a task to the team board',
      '  team run --team <name>               Run ready tasks with teammates',
      '  team status [name]                   Show roster, task board, and progress',
      '  team send <agent> <message>          Send a mailbox message',
      '  team inbox <agent>                   Read unread mailbox messages',
    ].join('\n');
  }

  function parseTeamOptions(args) {
    const options = { _: [] };
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg.startsWith('--')) {
        options._.push(arg);
        continue;
      }
      const [rawKey, inlineValue] = arg.slice(2).split('=');
      const key = rawKey.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
      const value = inlineValue !== undefined ? inlineValue : args[index + 1] && !args[index + 1].startsWith('--') ? args[++index] : 'true';
      options[key] = value;
    }
    return options;
  }

  function parseMembersOption(value) {
    if (!value) return [];
    return String(value).split(',').map((item) => {
      const [agentType, name] = item.split(':');
      return { agentType, name };
    }).filter((member) => member.agentType);
  }

  switch (subCommand) {
    case 'help': return formatTeamUsage();
    case 'agents':
      return formatAgentList(loadAgentDefinitions({ projectRoot: context.settings?.projectRoot || process.cwd(), settings: context.settings }));
    case 'list': return formatTeamList(runtime.listTeams());
    case 'new':
    case 'create': {
      const options = parseTeamOptions(args);
      const members = parseMembersOption(options.members || options.member);
      const result = runtime.createTeam({
        name: options.name || options._[0] || 'default',
        mission: options.mission || options._.slice(1).join(' '),
        members,
      });
      return formatTeamSnapshot(result.team);
    }
    case 'spawn':
    case 'add-agent': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const member = runtime.addMember({
        agentType: options.type || options.agent || options._[0] || 'general-purpose',
        name: options.name || options._[1],
        model: options.model,
      });
      return `Spawned ${member.name} (${member.agentType}) in team ${runtime.snapshot().teamName}.\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'task':
    case 'add-task': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const title = options.title || options._.join(' ');
      const task = runtime.addTask({
        title,
        prompt: options.prompt || title,
        owner: options.owner,
        agentType: options.type || options.agent,
        deliverable: options.deliverable,
        dependsOn: options.depends || options.dependsOn,
        parallel: options.parallel !== 'false',
      });
      return `Added task ${task.id}.\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'run': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const result = await runtime.run({ concurrency: options.concurrency, maxToolTurns: options.maxToolTurns });
      return formatRunResult(result);
    }
    case 'status':
    case 'show': {
      const options = parseTeamOptions(args);
      const snapshot = runtime.loadTeam(options.team || options.t || options._[0] || 'default');
      return formatTeamSnapshot(snapshot);
    }
    case 'send': {
      const options = parseTeamOptions(args);
      runtime.loadTeam(options.team || options.t || 'default');
      const message = runtime.sendMessage({
        to: options.to || options._[0],
        body: options.message || options._.slice(1).join(' '),
      });
      return formatMessages([message]);
    }
    case 'inbox': {
      const options = parseTeamOptions(args);
      runtime.loadTeam(options.team || options.t || 'default');
      const messages = runtime.drainMessages(options.agent || options._[0] || 'lead');
      return formatMessages(messages);
    }
    default:
      throw new Error(`Unknown team command: ${subCommand}.\n${formatTeamUsage()}`);
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

module.exports = {
  SLASH_COMMANDS,
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
};
