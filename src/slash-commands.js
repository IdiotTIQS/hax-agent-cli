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
  formatProviderError, VERSION, CLAUDE_BANNER, ANSI,
} = require('./renderer');
const { Session, CostTracker } = require('./session');

const SLASH_COMMANDS = [
  { name: 'help', description: 'Show available commands and shortcuts', aliases: ['h', '?'] },
  { name: 'exit', description: 'Exit the session', aliases: ['q', 'quit'] },
  { name: 'clear', description: 'Clear conversation and start fresh', aliases: ['c'] },
  { name: 'compact', description: 'Compact conversation to reduce context', aliases: [] },
  { name: 'tools', description: 'List available tools', aliases: ['t'] },
  { name: 'skills', description: 'List or manage skills', aliases: ['skill'], argHint: '[list|usage]' },
  { name: 'skillify', description: 'Capture this session as a reusable skill', aliases: [], argHint: '[description]' },
  { name: 'agents', description: 'List available agents', aliases: ['a'] },
  { name: 'team', description: 'Manage agent teams and teammates', aliases: ['teams'], argHint: '[new|spawn|task|run|status|send|inbox|agents]' },
  { name: 'models', description: 'List available models', aliases: ['m'] },
  { name: 'model', description: 'Switch the active model', aliases: [], argHint: '<model-id-or-number>' },
  { name: 'provider', description: 'Show or switch the AI provider', aliases: ['p'], argHint: '<anthropic|openai|google>' },
  { name: 'api-url', description: 'Show or set the API base URL', aliases: [], argHint: '<base-url>' },
  { name: 'api-key', description: 'Show or set the API key', aliases: [], argHint: '<key>' },
  { name: 'cost', description: 'Show token usage and cost for this session', aliases: [] },
  { name: 'sessions', description: 'List previous sessions', aliases: ['s'] },
  { name: 'resume', description: 'Resume a previous session', aliases: ['r'], argHint: '<session-id>' },
  { name: 'config', description: 'Show current configuration', aliases: [] },
  { name: 'doctor', description: 'Run diagnostics and check setup', aliases: [] },
  { name: 'theme', description: 'Toggle color theme', aliases: [] },
  { name: 'vim', description: 'Toggle vim keybindings mode', aliases: [] },
  { name: 'memory', description: 'Manage agent memory', aliases: [], argHint: '[list|read|write|delete] [name]' },
  { name: 'permissions', description: 'View or manage tool permission levels', aliases: ['perm'], argHint: '[status|mode <auto|ask|yolo>|reset]' },
];

let themeEnabled = true;
let vimMode = false;

function renderBanner(screen, session) {
  for (const line of CLAUDE_BANNER) {
    screen.write(`${line}\n`);
  }

  const provider = session.provider?.name || 'provider';
  const model = session.provider?.model || 'model';
  screen.write(`${THEME.dim}  Model: ${model} · Provider: ${provider}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}  Type /help for commands, /exit to quit${ANSI.reset || ''}\n\n`);
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

    context.screen.write(`${THEME.error}Unknown command: /${commandName}${ANSI.reset || ''}\n`);
    context.screen.write(`${THEME.dim}Type /help for available commands.${ANSI.reset || ''}\n`);
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
    case 'cost': showCost(context); break;
    case 'sessions': await showSessions(context); break;
    case 'resume': await resumeSession(args, context); break;
    case 'config': showConfig(context); break;
    case 'doctor': runDoctor(context); break;
    case 'theme': toggleTheme(context); break;
    case 'vim': toggleVim(context); break;
    case 'memory': handleMemoryCommand(args, context); break;
    case 'permissions': handlePermissionsCommand(args, context); break;
    default:
      context.screen.write(`${THEME.error}Command not implemented: /${command.name}${ANSI.reset || ''}\n`);
  }
}

function showShellHelp({ screen }) {
  const width = Math.min(screen.columns || 80, 80);
  const borderLine = THEME.border + '─'.repeat(width - 2) + (ANSI.reset || '');

  screen.write(`\n${THEME.heading}Commands${ANSI.reset || ''}\n`);
  screen.write(`${borderLine}\n`);

  for (const cmd of SLASH_COMMANDS) {
    const aliases = cmd.aliases.length > 0 ? ` ${THEME.dim}(${cmd.aliases.map(a => `/${a}`).join(', ')})${ANSI.reset || ''}` : '';
    const argHint = cmd.argHint ? ` ${THEME.dim}${cmd.argHint}${ANSI.reset || ''}` : '';
    const nameCol = `/${cmd.name}`.padEnd(14);
    screen.write(`  ${THEME.promptPrefix}${nameCol}${ANSI.reset || ''} ${cmd.description}${aliases}${argHint}\n`);
  }

  screen.write(`\n${THEME.heading}Keyboard Shortcuts${ANSI.reset || ''}\n`);
  screen.write(`${borderLine}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+C${ANSI.reset || ''}       ${THEME.dim}Interrupt or exit${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+L${ANSI.reset || ''}       ${THEME.dim}Clear screen${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}\u2191/\u2193${ANSI.reset || ''}         ${THEME.dim}Navigate input history${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}Shift+Tab${ANSI.reset || ''}     ${THEME.dim}Cycle permission mode${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.promptPrefix}!command${ANSI.reset || ''}      ${THEME.dim}Run a shell command directly${ANSI.reset || ''}\n`);
  screen.write('\n');
}

function exitShell({ screen, session }) {
  session.shouldExit = true;
  const cost = session.costTracker.getCost(session.provider?.model);
  screen.write(`${THEME.success}Session ended.${ANSI.reset || ''} ${THEME.dim}Cost: $${cost.toFixed(4)} · Turns: ${session.costTracker.turnCount}${ANSI.reset || ''}\n`);
}

function clearShell({ screen, session }) {
  session.messages = [];
  session.id = createSessionId();
  session.costTracker = new CostTracker();
  screen.clear();
  renderBanner(screen, session);
  screen.write(`${THEME.success}Context cleared.${ANSI.reset || ''}\n\n`);
}

function compactShell({ screen, session }) {
  const keepCount = Math.min(session.messages.length, 6);
  const removed = session.messages.length - keepCount;
  session.messages = session.messages.slice(-keepCount);
  screen.write(`${THEME.success}Compacted.${ANSI.reset || ''} ${THEME.dim}Kept last ${keepCount} messages, removed ${removed}.${ANSI.reset || ''}\n\n`);
}

function showTools({ screen, session }) {
  screen.write(`\n${THEME.heading}Available Tools${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  for (const tool of session.toolRegistry.list()) {
    const nameCol = tool.name.padEnd(14);
    screen.write(`  ${THEME.toolIndicator}${nameCol}${ANSI.reset || ''} ${tool.description}\n`);
  }
  screen.write('\n');
}

function showSkills(args, { screen, session }) {
  const [subCommand] = args;

  if (!subCommand || subCommand === 'list') {
    const skills = loadAllSkills(session.settings.projectRoot || process.cwd());
    const skillify = createSkillifySkill(session.messages);
    const allSkills = [skillify, ...skills];

    screen.write(`\n${THEME.heading}Available Skills${ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

    for (const skill of allSkills) {
      if (skill.isHidden) continue;
      const nameCol = skill.displayName.padEnd(18);
      const source = skill.source !== 'bundled' ? ` ${THEME.dim}[${skill.source}]${ANSI.reset || ''}` : '';
      const hint = skill.argumentHint ? ` ${THEME.dim}${skill.argumentHint}${ANSI.reset || ''}` : '';
      screen.write(`  ${THEME.accent}/${nameCol}${ANSI.reset || ''} ${skill.description}${source}${hint}\n`);
    }

    if (allSkills.length === 0) {
      screen.write(`  ${THEME.dim}No skills available.${ANSI.reset || ''}\n`);
    }

    screen.write(`\n${THEME.dim}Use /skillify to capture a session as a skill.${ANSI.reset || ''}\n\n`);
  } else if (subCommand === 'usage') {
    const { getSkillUsageStats } = require('./skills');
    const stats = getSkillUsageStats();
    const skillNames = Object.keys(stats);

    if (skillNames.length === 0) {
      screen.write(`${THEME.dim}No skill usage recorded yet.${ANSI.reset || ''}\n`);
      return;
    }

    screen.write(`\n${THEME.heading}Skill Usage Statistics${ANSI.reset || ''}\n`);
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
    screen.write(`${THEME.error}Unknown skill command: ${subCommand}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}Usage: /skills [list|usage]${ANSI.reset || ''}\n`);
  }
}

function handlePermissionsCommand(args, { screen, session }) {
  const pm = session.permissionManager;
  if (!pm) {
    screen.write(`${THEME.error}权限管理器未初始�?{ANSI.reset || ''}\n`);
    return;
  }

  const [subCommand, ...rest] = args;

  if (!subCommand || subCommand === 'status') {
    const summary = pm.getSummary();
    const modeLabel = summary.mode === 'yolo' ? 'YOLO (自动执行所�?' : '标准 (需确认危险操作)';

    screen.write(`\n${THEME.heading}权限状�?{ANSI.reset || ''}\n`);
    screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
    screen.write(`  当前模式: ${THEME.bold}${modeLabel}${ANSI.reset || ''}\n\n`);

    screen.write(`  ${THEME.heading}工具权限等级:${ANSI.reset || ''}\n`);
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
      screen.write(`\n  ${THEME.success}永久允许:${ANSI.reset || ''} ${THEME.dim}${summary.alwaysAllow.join(', ')}${ANSI.reset || ''}\n`);
    }
    if (summary.alwaysDeny.length > 0) {
      screen.write(`  ${THEME.error}永久拒绝:${ANSI.reset || ''} ${THEME.dim}${summary.alwaysDeny.join(', ')}${ANSI.reset || ''}\n`);
    }

    screen.write(`\n${THEME.dim}使用 /permissions mode <auto|ask|yolo> 切换模式${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}使用 /permissions reset 重置所有永久设�?{ANSI.reset || ''}\n\n`);
    return;
  }

  if (subCommand === 'mode') {
    const newMode = rest[0];
    if (!newMode || !['auto', 'ask', 'yolo'].includes(newMode)) {
      screen.write(`${THEME.error}无效模式: ${newMode || '(未指�?'}${ANSI.reset || ''}\n`);
      screen.write(`${THEME.dim}可用模式: auto, ask, yolo${ANSI.reset || ''}\n`);
      return;
    }

    pm.mode = newMode;
    const modeLabel = newMode === 'yolo' ? 'YOLO' : newMode === 'auto' ? '自动' : '标准';
    screen.write(`${THEME.success}权限模式已切换为: ${modeLabel}${ANSI.reset || ''}\n\n`);
    return;
  }

  if (subCommand === 'reset') {
    pm.resetOverrides();
    screen.write(`${THEME.success}所有永久允�?拒绝设置已重�?{ANSI.reset || ''}\n\n`);
    return;
  }

  screen.write(`${THEME.error}未知子命�? ${subCommand}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.dim}用法: /permissions [status|mode <auto|ask|yolo>|reset]${ANSI.reset || ''}\n`);
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
  const [providerName] = args;

  if (!providerName) {
    screen.write(`${THEME.dim}Current provider: ${ANSI.reset || ''}${THEME.bold}${session.provider.name}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}Available: anthropic, openai, google${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}Usage: /provider <anthropic|openai|google>${ANSI.reset || ''}\n`);
    return;
  }

  const normalized = providerName.toLowerCase().trim();
  const validProviders = ['anthropic', 'claude', 'openai', 'gpt', 'google', 'gemini'];

  if (!validProviders.includes(normalized)) {
    screen.write(`${THEME.error}Unknown provider: ${providerName}${ANSI.reset || ''}\n`);
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
  screen.write(`${THEME.success}Switched provider to ${session.provider.name}${ANSI.reset || ''}\n`);
}

async function switchModel(args, { screen, session }) {
  const [selection] = args;

  if (!selection) {
    screen.write(`${THEME.dim}Current model: ${ANSI.reset || ''}${THEME.bold}${session.provider.model || 'unknown'}${ANSI.reset || ''}\n`);
    screen.write(`${THEME.dim}Usage: /model <model-id-or-number>${ANSI.reset || ''}\n`);
    return;
  }

  const model = resolveModelSelection(selection, session.availableModels || []);
  session.provider.setModel(model);
  screen.write(`${THEME.success}Switched model to ${session.provider.model}${ANSI.reset || ''}\n`);
}

async function switchApiUrl(args, { screen, session }) {
  const [apiUrl] = args;

  if (!apiUrl) {
    screen.write(`${THEME.dim}Current API URL: ${ANSI.reset || ''}${session.provider.apiUrl || 'default'}\n`);
    screen.write(`${THEME.dim}Usage: /api-url <base-url>${ANSI.reset || ''}\n`);
    return;
  }

  session.provider.setApiUrl(apiUrl);
  persistAgentSettings({ apiUrl: session.provider.apiUrl });
  session.availableModels = undefined;
  screen.write(`${THEME.success}Switched API URL to ${session.provider.apiUrl || 'default'}${ANSI.reset || ''}\n`);
}

async function switchApiKey(args, { screen, session }) {
  const [apiKey] = args;

  if (!apiKey) {
    screen.write(`${THEME.dim}API key: ${ANSI.reset || ''}${session.provider.apiKey ? `${THEME.success}set${ANSI.reset || ''}` : `${THEME.warning}not set${ANSI.reset || ''}`}\n`);
    screen.write(`${THEME.dim}Usage: /api-key <key>${ANSI.reset || ''}\n`);
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
  screen.write(`${THEME.success}API key set for ${session.provider.name}.${ANSI.reset || ''}\n`);
}

function showCost({ screen, session }) {
  screen.write(`\n${session.costTracker.formatSummary(session.provider?.model)}\n\n`);
}

async function showSessions({ screen, session }) {
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) {
    screen.write(`${THEME.dim}No previous sessions found.${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Previous Sessions${ANSI.reset || ''}\n`);
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
  const [sessionId] = args;
  const sessions = listSessions(session.settings);

  if (sessions.length === 0) {
    screen.write(`${THEME.warning}No previous sessions found.${ANSI.reset || ''}\n`);
    return;
  }

  let targetSession;
  if (sessionId) {
    targetSession = sessions.find(s => s.id.startsWith(sessionId));
  } else {
    targetSession = sessions[0];
  }

  if (!targetSession) {
    screen.write(`${THEME.error}Session not found: ${sessionId}${ANSI.reset || ''}\n`);
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
  screen.write(`${THEME.success}Resumed session ${targetSession.id.slice(0, 20)}${ANSI.reset || ''} ${THEME.dim}(${restored.length} messages restored)${ANSI.reset || ''}\n\n`);
}

function showConfig({ screen, session }) {
  screen.write(`\n${THEME.heading}Configuration${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);
  screen.write(`  ${THEME.dim}Provider:${ANSI.reset || ''}     ${session.provider.name}\n`);
  screen.write(`  ${THEME.dim}Model:${ANSI.reset || ''}       ${session.provider.model}\n`);
  screen.write(`  ${THEME.dim}API URL:${ANSI.reset || ''}     ${session.provider.apiUrl || 'default'}\n`);
  screen.write(`  ${THEME.dim}API Key:${ANSI.reset || ''}     ${session.provider.apiKey ? '●●●●●●●●' : 'not set'}\n`);
  screen.write(`  ${THEME.dim}Max Turns:${ANSI.reset || ''}    ${session.settings.agent?.maxTurns || 20}\n`);
  screen.write(`  ${THEME.dim}Temperature:${ANSI.reset || ''}  ${session.settings.agent?.temperature || 0.2}\n`);
  screen.write(`  ${THEME.dim}Project Root:${ANSI.reset || ''} ${session.settings.projectRoot || process.cwd()}\n`);
  screen.write(`  ${THEME.dim}Shell:${ANSI.reset || ''}        ${session.settings.tools?.shell?.enabled ? 'enabled' : 'disabled'}\n`);
  screen.write('\n');
}

function runDoctor({ screen, session }) {
  screen.write(`\n${THEME.heading}Diagnostics${ANSI.reset || ''}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ''}\n`);

  const checks = [
    { name: 'Node.js', check: () => process.version },
    { name: 'Provider', check: () => session.provider.name },
    { name: 'Model', check: () => session.provider.model },
    { name: 'API Key', check: () => session.provider.apiKey ? `${THEME.success}�?set${ANSI.reset || ''}` : `${THEME.error}�?not set${ANSI.reset || ''}` },
    { name: 'API URL', check: () => session.provider.apiUrl || 'default' },
    { name: 'Shell Tool', check: () => session.settings.tools?.shell?.enabled ? `${THEME.success}�?enabled${ANSI.reset || ''}` : `${THEME.warning}�?disabled${ANSI.reset || ''}` },
    { name: 'TTY', check: () => new TerminalScreen().isTTY() ? `${THEME.success}�?yes${ANSI.reset || ''}` : `${THEME.warning}�?no${ANSI.reset || ''}` },
    { name: 'Terminal', check: () => `${process.stdout.columns}x${process.stdout.rows}` },
    { name: 'Session ID', check: () => session.id.slice(0, 20) },
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
      screen.write(`${THEME.dim}Usage: /memory [list|read|write|delete]${ANSI.reset || ''}\n`);
  }
}

async function handleTeamCommand(args, { screen, session }) {
  const runtime = createCliTeamRuntime(session.settings);
  const [subCommand = 'status', ...subArgs] = args;

  try {
    const output = await executeTeamCommand(runtime, subCommand, subArgs, { settings: session.settings, session });
    if (output) {
      screen.write(`\n${output}\n\n`);
    }
  } catch (error) {
    screen.write(`${THEME.error}Error: ${error.message}${ANSI.reset || ''}\n`);
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

  output.write(`\n${THEME.heading}Available Models for ${provider.name}${ANSI.reset || ''}\n`);
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

function persistAgentSettings(agentSettings) {
  updateUserSettings({ agent: agentSettings });
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
};

