"use strict";

const { createTranslator } = require("../i18n");
const { THEME, ANSI, VERSION, formatProviderError, MarkdownRenderer, ResponseRenderer } = require("../renderer");
const { AgentEventType } = require("../agent-engine");
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require("../skills");

function getTranslator(session) {
  return createTranslator(session?.settings?.ui?.locale);
}

function renderBanner(screen, session) {
  const t = getTranslator(session);
  const width = Math.min(screen.columns || 80, 80);
  const borderTop = `╭${'─'.repeat(width - 2)}╮`;
  const borderBottom = `╰${'─'.repeat(width - 2)}╯`;
  const tagline = "AI-powered coding assistant";

  screen.write(`\n${THEME.heading}${borderTop}${ANSI.reset || ''}\n`);
  screen.write(`${THEME.heading}   │    Hax Agent v${VERSION}${' '.repeat(Math.max(0, width - 33))}│${ANSI.reset || ''}\n`);
  screen.write(`${THEME.heading}   │  ${tagline}${' '.repeat(Math.max(0, width - 28 - tagline.length))}│${ANSI.reset || ''}\n`);
  screen.write(`${THEME.heading}   ${borderBottom}${ANSI.reset || ''}\n`);

  if (session.provider?.model) {
    screen.write(`\n  ${THEME.dim}${t('banner.modelProvider', { model: session.provider.model, provider: session.provider.name })}${ANSI.reset || ''}\n`);
  }

  screen.write(`  ${THEME.dim}${t('banner.help')}${ANSI.reset || ''}\n\n`);

  if (session.provider?.name === 'mock' || session.provider?.name === 'local') {
    screen.write(`${THEME.warning}${t('shell.mockMode')}${ANSI.reset || ''}\n\n`);
  }

  if (session.permissionManager?.mode === 'yolo') {
    screen.write(`${THEME.warning}! ${t('shell.yoloMode')}${ANSI.reset || ''}\n\n`);
  }
}

function renderStatusLine(screen, session) {
  const statusLine = session.getStatusLine();
  screen.write(`\r${statusLine}                    \n`);
}

function loadRecentTranscript(session) {
  const { readTranscript } = require("../memory");
  const entries = readTranscript(session.settings, 20);
  const userMessages = entries.filter((entry) => entry.role === "user");
  const lastUserIndex = entries.reduce((last, entry, index) => (entry.role === "user" ? index : last), -1);

  if (lastUserIndex < 0) return;
  const assistantMessages = entries.slice(lastUserIndex + 1).filter((entry) => entry.role === "assistant");

  if (userMessages.length === 0) return;

  const lastUserMessage = userMessages[userMessages.length - 1];
  session.messages.push({ role: "user", content: lastUserMessage.content || "" });

  for (const msg of assistantMessages) {
    session.messages.push({ role: "assistant", content: msg.content || "" });
  }
}

async function handleChatMessage(content, { screen, session, markdown }) {
  const { AgentEngine } = require("../agent-engine");
  const { createLocalToolRegistry } = require("../tools");
  const { registerAgentTeamTools } = require("../teams/tools");

  const engine = new AgentEngine({ session, env: process.env });
  const renderer = new ResponseRenderer(screen, markdown);

  for await (const event of engine.sendMessage(content)) {
    renderAgentEvent(event, { screen, session, renderer });
  }
}

async function handleSkillInvocation(skill, args, { screen, session, markdown }) {
  const { AgentEngine } = require("../agent-engine");
  const engine = new AgentEngine({ session, env: process.env });
  const renderer = new ResponseRenderer(screen, markdown);

  for await (const event of engine.invokeSkill(skill, args)) {
    renderAgentEvent(event, { screen, session, renderer });
  }
}

function renderAgentEvent(event, { screen, session, renderer }) {
  if (event.type === AgentEventType.messageDelta) {
    renderer.text(event.delta);
    return;
  }

  if (event.type === AgentEventType.thinking && event.summary) {
    screen.write(`${THEME.dim}  ${event.summary}${ANSI.reset || ''}\n`);
    return;
  }

  if (event.type === AgentEventType.toolStart) {
    screen.write(`\n  ${THEME.accent}✓ ${event.name}${ANSI.reset || ''}`);
    if (event.displayInput) {
      screen.write(`${THEME.dim} ${event.displayInput}${ANSI.reset || ''}`);
    }
    screen.write('\n');
    return;
  }

  if (event.type === AgentEventType.toolResult) {
    const prefix = event.isError ? `${THEME.error}✗${ANSI.reset || ''}` : `${THEME.success}  ✓ Done${ANSI.reset || ''}`;
    const duration = event.durationMs ? `${THEME.dim} in ${event.durationMs}ms${ANSI.reset || ''}` : '';
    screen.write(`  ${prefix} ${duration}\n`);
    if (event.error) {
      screen.write(`    ${THEME.dim}└─ ${event.error}${ANSI.reset || ''}\n`);
    }
    return;
  }

  if (event.type === AgentEventType.completed) {
    renderer.flush();
    if (event.usage) {
      screen.write(`${THEME.dim}  ${(event.usage.inputTokens + event.usage.outputTokens).toLocaleString()} tokens${ANSI.reset || ''}\n`);
    }
    return;
  }

  if (event.type === AgentEventType.failed) {
    renderer.flush();
    screen.write(`\n${formatProviderError(event.error)}`);
    return;
  }

  if (event.type === AgentEventType.skillMatched) {
    if (event.skill?.name) {
      screen.write(`${THEME.dim}  skill: ${event.skill.name}${ANSI.reset || ''}\n`);
    }
    return;
  }
}

module.exports = {
  getTranslator,
  renderBanner,
  renderStatusLine,
  loadRecentTranscript,
  handleChatMessage,
  handleSkillInvocation,
  renderAgentEvent,
};
