"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  writeTranscript,
  createSessionId,
  readTranscript,
} = require('./memory');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`Invalid JSON at ${filePath}:${i + 1}: ${err.message}`);
    }
  }

  return records;
}

function normalizeEntry(record, fallbackTimestamp) {
  return {
    timestamp: record.timestamp || fallbackTimestamp || new Date().toISOString(),
    role: String(record.role || 'unknown').toLowerCase(),
    content: record.content !== undefined ? String(record.content) : '',
    ...(record.name ? { name: record.name } : {}),
    ...(record.data !== undefined ? { data: record.data } : {}),
    ...(record.isError ? { isError: true } : {}),
    ...(record.tool_call_id ? { tool_call_id: record.tool_call_id } : {}),
  };
}

function detectFormat(lines) {
  // Check if the file looks like it has User:/Assistant: patterns
  let userMatches = 0;
  let assistantMatches = 0;

  for (const line of lines.slice(0, 50)) {
    const trimmed = line.trim();
    if (/^(User|Human|You)\s*[:>]/.test(trimmed) ||
        /^>>>\s*/.test(trimmed) ||
        /^---\s*(User|Human|You)/.test(trimmed)) {
      userMatches++;
    }
    if (/^(Assistant|AI|Bot|Claude|Agent|Hax)\s*[:>]/.test(trimmed) ||
        /^<<<\s*/.test(trimmed) ||
        /^---\s*(Assistant|AI|Bot|Claude)/.test(trimmed)) {
      assistantMatches++;
    }
  }

  return {
    hasPatterns: userMatches > 0 || assistantMatches > 0,
    userMatches,
    assistantMatches,
  };
}

function extractRoleAndContent(line) {
  const trimmed = line.trim();

  // Pattern: "User: message" or "Human: message"
  let m = trimmed.match(/^(User|Human|You)\s*[:>]\s*(.*)/i);
  if (m) {
    return { role: 'user', content: m[2].trim() };
  }

  // Pattern: ">>> message"
  m = trimmed.match(/^>>>\s*(.*)/);
  if (m) {
    return { role: 'user', content: m[1].trim() };
  }

  // Pattern: "--- User" section header
  m = trimmed.match(/^---\s*(User|Human|You)/i);
  if (m) {
    return { role: 'user', content: '' };
  }

  // Pattern: "Assistant: message" or "AI: message"
  m = trimmed.match(/^(Assistant|AI|Bot|Claude|Agent|Hax)\s*[:>]\s*(.*)/i);
  if (m) {
    return { role: 'assistant', content: m[2].trim() };
  }

  // Pattern: "<<< message"
  m = trimmed.match(/^<<<\s*(.*)/);
  if (m) {
    return { role: 'assistant', content: m[1].trim() };
  }

  // Pattern: "--- Assistant" section header
  m = trimmed.match(/^---\s*(Assistant|AI|Bot|Claude)/i);
  if (m) {
    return { role: 'assistant', content: '' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// importFromJsonl
// ---------------------------------------------------------------------------

/**
 * Import a .jsonl file as a session transcript.
 *
 * Each line must be valid JSON with at least a `role` field. Optional fields
 * include `content`, `timestamp`, `name`, `data`, and `isError`.
 *
 * @param {string} jsonlPath - Path to the .jsonl file.
 * @param {object} [options]
 * @param {string} [options.sessionId] - Custom session ID (auto-generated if not provided).
 * @returns {{ sessionId: string, path: string, imported: number, skipped: number }}
 */
function importFromJsonl(jsonlPath, options = {}) {
  const resolvedPath = path.resolve(jsonlPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const records = readJsonlFile(resolvedPath);
  const sessionId = options.sessionId || createSessionId();
  const now = new Date().toISOString();

  const entries = [];
  let skipped = 0;

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      skipped++;
      continue;
    }

    if (!record.role && !record.type) {
      skipped++;
      continue;
    }

    // Skip metadata-type entries
    if (record.type === 'session.meta') {
      continue;
    }

    entries.push(normalizeEntry(record, now));
  }

  const outputPath = writeTranscript(sessionId, entries, options);

  return {
    sessionId,
    path: outputPath,
    imported: entries.length,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// importFromChatLog
// ---------------------------------------------------------------------------

/**
 * Import a plain text chat log, detecting user/assistant turns.
 *
 * Supports formats like:
 *   User: message text
 *   Assistant: response text
 *   >>> message text
 *   <<< response text
 *
 * Multi-line messages are accumulated until the next role marker or blank line
 * separator.
 *
 * @param {string} textPath - Path to the plain text chat log.
 * @param {object} [options]
 * @param {string} [options.sessionId] - Custom session ID (auto-generated if not provided).
 * @returns {{ sessionId: string, path: string, imported: number, format: object }}
 */
function importFromChatLog(textPath, options = {}) {
  const resolvedPath = path.resolve(textPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const format = detectFormat(lines);

  if (!format.hasPatterns) {
    throw new Error(
      `No recognizable chat format detected in ${resolvedPath}. ` +
      `Supported patterns: "User:", "Assistant:", ">>>", "<<<", "--- User/Assistant"`
    );
  }

  const entries = [];
  let currentRole = null;
  let currentContent = [];
  const fallbackTimestamp = new Date().toISOString();

  function flushEntry() {
    if (currentRole && currentContent.length > 0) {
      const text = currentContent.join('\n').trim();
      if (text) {
        entries.push({
          timestamp: fallbackTimestamp,
          role: currentRole,
          content: text,
        });
      }
    }
    currentContent = [];
  }

  for (const line of lines) {
    const parsed = extractRoleAndContent(line);

    if (parsed) {
      // Flush previous entry
      flushEntry();
      currentRole = parsed.role;
      if (parsed.content) {
        currentContent.push(parsed.content);
      }
    } else if (currentRole) {
      // Accumulate multi-line content
      currentContent.push(line);
    }
  }

  // Flush last entry
  flushEntry();

  if (entries.length === 0) {
    throw new Error(`No chat messages found in ${resolvedPath}`);
  }

  const sessionId = options.sessionId || createSessionId();
  const outputPath = writeTranscript(sessionId, entries, options);

  return {
    sessionId,
    path: outputPath,
    imported: entries.length,
    format: {
      userPatterns: format.userMatches,
      assistantPatterns: format.assistantMatches,
    },
  };
}

// ---------------------------------------------------------------------------
// batchImport
// ---------------------------------------------------------------------------

/**
 * Import all importable files from a directory.
 *
 * Scans the directory for .jsonl, .json, .txt, and .log files, then imports
 * each using the appropriate importer.
 *
 * @param {string} directoryPath - Directory to scan.
 * @param {object} [options]
 * @param {boolean} [options.recursive=false] - Recurse into subdirectories.
 * @param {Array<string>} [options.extensions=['.jsonl','.txt','.log','.json']]
 *   - File extensions to process.
 * @returns {Array<{ file: string, sessionId: string, imported: number, type: string, error?: string }>}
 */
function batchImport(directoryPath, options = {}) {
  const resolvedDir = path.resolve(directoryPath);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${resolvedDir}`);
  }

  if (!fs.statSync(resolvedDir).isDirectory()) {
    throw new Error(`Not a directory: ${resolvedDir}`);
  }

  const exts = Array.isArray(options.extensions) && options.extensions.length > 0
    ? options.extensions
    : ['.jsonl', '.txt', '.log', '.json'];
  const recursive = options.recursive === true;

  const files = [];

  function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory() && recursive) {
        collectFiles(fullPath);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  collectFiles(resolvedDir);

  const results = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();

    try {
      if (ext === '.jsonl') {
        const r = importFromJsonl(filePath, options);
        results.push({
          file: filePath,
          sessionId: r.sessionId,
          imported: r.imported,
          type: 'jsonl',
        });
      } else if (ext === '.json') {
        // Treat .json as a single-message JSONL (one record per file)
        const r = importFromJsonl(filePath, options);
        results.push({
          file: filePath,
          sessionId: r.sessionId,
          imported: r.imported,
          type: 'json',
        });
      } else if (ext === '.txt' || ext === '.log') {
        const r = importFromChatLog(filePath, options);
        results.push({
          file: filePath,
          sessionId: r.sessionId,
          imported: r.imported,
          type: 'chatlog',
        });
      }
    } catch (err) {
      results.push({
        file: filePath,
        sessionId: null,
        imported: 0,
        type: ext.replace('.', ''),
        error: err.message,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  importFromJsonl,
  importFromChatLog,
  batchImport,
  // Internal helpers exported for testing
  _detectFormat: detectFormat,
  _extractRoleAndContent: extractRoleAndContent,
  _normalizeEntry: normalizeEntry,
};
