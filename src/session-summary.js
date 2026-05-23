"use strict";

/**
 * Generate human-readable session summaries for display and export.
 */
const { listSessions, readTranscript } = require('./memory');

function summarizeSession(sessionId, options = {}) {
  const sessions = listSessions(options);
  const target = sessions.find((s) => s.id.startsWith(sessionId));
  if (!target) return null;

  const entries = target.entries();
  const metadata = target.metadata();

  const userMessages = entries.filter((e) => e.role === 'user').length;
  const assistantMessages = entries.filter((e) => e.role === 'assistant').length;
  const toolCalls = entries.filter((e) => e.role === 'tool').length;
  const errors = entries.filter((e) => e.isError).length;

  const firstMessage = entries.length > 0 ? entries[0] : null;
  const lastMessage = entries.length > 0 ? entries[entries.length - 1] : null;

  const filesModified = new Set();
  for (const entry of entries) {
    if (entry.role === 'tool' && entry.data?.path) {
      filesModified.add(entry.data.path);
    }
  }

  return {
    sessionId: target.id,
    projectName: metadata?.projectName || null,
    projectRoot: metadata?.projectRoot || null,
    createdAt: firstMessage?.timestamp || target.updatedAt,
    updatedAt: target.updatedAt,
    messageCount: entries.length,
    userMessages,
    assistantMessages,
    toolCalls,
    errors,
    filesModified: [...filesModified],
    hasGoal: entries.some((e) => e.type === 'goal.meta' && e.goal?.enabled),
    summary: buildSummary(entries),
  };
}

function buildSummary(entries) {
  const userMessages = entries
    .filter((e) => e.role === 'user')
    .map((e) => (e.content || '').trim())
    .filter(Boolean);

  if (userMessages.length === 0) return 'Empty session';

  if (userMessages.length === 1) {
    const msg = userMessages[0];
    return msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
  }

  const first = userMessages[0];
  const last = userMessages[userMessages.length - 1];

  const firstLine = first.length > 40 ? first.slice(0, 37) + '...' : first;
  const lastLine = last.length > 40 ? last.slice(0, 37) + '...' : last;

  return `${firstLine} → ${lastLine} (${userMessages.length} turns)`;
}

function listSummaries(options = {}) {
  const sessions = listSessions(options);
  return sessions.map((s) => ({
    id: s.id,
    updatedAt: s.updatedAt,
    entryCount: s.entries().length,
    projectName: s.metadata()?.projectName || null,
  }));
}

function getSessionTimeline(sessionId, options = {}) {
  const sessions = listSessions(options);
  const target = sessions.find((s) => s.id.startsWith(sessionId));
  if (!target) return [];

  const entries = target.entries();
  const timeline = [];
  let currentTurn = 0;

  for (const entry of entries) {
    if (entry.role === 'user') {
      currentTurn += 1;
    }
    timeline.push({
      turn: currentTurn,
      timestamp: entry.timestamp,
      role: entry.role,
      preview: getEntryPreview(entry),
    });
  }

  return timeline;
}

function getEntryPreview(entry) {
  if (entry.role === 'user') {
    const text = (entry.content || '').trim();
    return text.length > 60 ? text.slice(0, 57) + '...' : text;
  }
  if (entry.role === 'tool') {
    return `Tool: ${entry.name || 'unknown'}` + (entry.isError ? ' (error)' : '');
  }
  if (entry.role === 'assistant') {
    const text = (entry.content || '').trim();
    return text.length > 60 ? text.slice(0, 57) + '...' : text;
  }
  return `[${entry.role}]`;
}

module.exports = {
  summarizeSession,
  listSummaries,
  getSessionTimeline,
};
