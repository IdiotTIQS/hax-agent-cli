"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { readTranscript, listSessions } = require('./memory');
const { createTranslator } = require('./i18n');

/**
 * Export a session transcript to Markdown format.
 */
function exportSessionToMarkdown(sessionId, outputPath, options = {}) {
  const sessions = listSessions(options);
  const target = sessions.find((s) => s.id.startsWith(sessionId));

  if (!target) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const entries = target.entries();
  const metadata = target.metadata();
  const now = new Date().toISOString();
  const dateStr = new Date(target.updatedAt).toLocaleDateString();
  const timeStr = new Date(target.updatedAt).toLocaleTimeString();

  const lines = [];
  lines.push(`# Hax Agent Session Transcript`);
  lines.push('');
  lines.push(`- **Session ID:** \`${target.id}\``);
  lines.push(`- **Date:** ${dateStr} ${timeStr}`);
  lines.push(`- **Messages:** ${entries.length}`);
  if (metadata?.projectName) {
    lines.push(`- **Project:** ${metadata.projectName}`);
  }
  if (metadata?.projectRoot) {
    lines.push(`- **Root:** \`${metadata.projectRoot}\``);
  }
  lines.push(`- **Exported:** ${now}`);
  lines.push('');

  for (const entry of entries) {
    const role = String(entry.role || 'unknown').toLowerCase();
    if (role === 'user') {
      lines.push(`### You`);
      lines.push('');
      lines.push(entry.content || '');
      lines.push('');
    } else if (role === 'assistant') {
      lines.push(`### Assistant`);
      lines.push('');
      lines.push(entry.content || '');
      lines.push('');
    } else if (role === 'tool') {
      lines.push(`### Tool: ${entry.name || 'tool'}`);
      lines.push('');
      lines.push('```');
      const data = entry.data;
      lines.push(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, content, 'utf8');

  return { path: resolvedPath, format: 'markdown', entries: entries.length };
}

/**
 * Export a session transcript to JSON format.
 */
function exportSessionToJson(sessionId, outputPath, options = {}) {
  const sessions = listSessions(options);
  const target = sessions.find((s) => s.id.startsWith(sessionId));

  if (!target) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const entries = target.entries();
  const metadata = target.metadata();
  const now = new Date().toISOString();

  const exportData = {
    exportedAt: now,
    sessionId: target.id,
    updatedAt: target.updatedAt,
    projectName: metadata?.projectName || '',
    projectRoot: metadata?.projectRoot || '',
    totalEntries: entries.length,
    messages: entries.map((entry) => {
      const msg = { role: entry.role, timestamp: entry.timestamp };
      if (entry.content !== undefined) msg.content = entry.content;
      if (entry.name) msg.toolName = entry.name;
      if (entry.data !== undefined) msg.data = entry.data;
      if (entry.isError) msg.isError = true;
      return msg;
    }),
  };

  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(exportData, null, 2), 'utf8');

  return { path: resolvedPath, format: 'json', entries: entries.length };
}

/**
 * Export a session transcript to a plain text log.
 */
function exportSessionToText(sessionId, outputPath, options = {}) {
  const sessions = listSessions(options);
  const target = sessions.find((s) => s.id.startsWith(sessionId));

  if (!target) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const entries = target.entries();
  const now = new Date().toISOString();
  const dateStr = new Date(target.updatedAt).toLocaleDateString();
  const timeStr = new Date(target.updatedAt).toLocaleTimeString();

  const lines = [];
  lines.push(`=== Hax Agent Session Transcript ===`);
  lines.push(`Session ID: ${target.id}`);
  lines.push(`Date: ${dateStr} ${timeStr}`);
  lines.push(`Messages: ${entries.length}`);
  lines.push(`Exported: ${now}`);
  lines.push('');

  for (const entry of entries) {
    const role = String(entry.role || 'unknown');
    const prefix = role === 'user' ? '>>> You' : role === 'assistant' ? '<<< Assistant' : `[${role}]`;
    lines.push(prefix);
    const content = entry.content || (entry.data ? JSON.stringify(entry.data) : '');
    const trimmed = String(content).trim();
    if (trimmed) {
      lines.push(trimmed);
    }
    lines.push('');
  }

  const content = lines.join('\n');
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, content, 'utf8');

  return { path: resolvedPath, format: 'text', entries: entries.length };
}

module.exports = {
  exportSessionToMarkdown,
  exportSessionToJson,
  exportSessionToText,
};
