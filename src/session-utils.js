"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { escapeRegExp } = require('./tools/utils');
const {
  listSessions,
  readTranscript,
  writeTranscript,
  getSessionTranscriptPath,
} = require('./memory');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashEntry(entry) {
  const { timestamp, type, ...rest } = entry;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

function resolveEntries(input, options) {
  if (Array.isArray(input)) {
    return input;
  }
  const session = findSession(input, options);
  if (!session) {
    throw new Error(`Session not found: ${input}`);
  }
  return session.entries();
}

function findSession(sessionId, options) {
  const sessions = listSessions(options);
  if (typeof sessionId === 'string') {
    return sessions.find((s) => s.id.startsWith(sessionId)) || null;
  }
  return null;
}

function findSessionById(sessionId, options) {
  return findSession(sessionId, options);
}

function readUsageNumber(entry, ...keys) {
  const usage = entry.usage || entry;
  for (const key of keys) {
    if (Number.isFinite(usage[key])) {
      return usage[key];
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// mergeSessions
// ---------------------------------------------------------------------------

/**
 * Merge multiple session transcripts into one, deduplicating by content hash.
 *
 * @param {Array<{id: string, entries?: Array}|string>} sessions
 *   Array of session objects (with `id` and optional `entries`) or session ID strings.
 * @param {object} [options]
 * @param {boolean} [options.dedup=true] - Whether to deduplicate by content hash.
 * @returns {Array<object>} Merged entries sorted by timestamp.
 */
function mergeSessions(sessions, options = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return [];
  }

  const dedup = options.dedup !== false;
  const seen = new Set();
  const all = [];

  for (const item of sessions) {
    let entries;

    if (typeof item === 'string') {
      entries = resolveEntries(item, options);
    } else if (Array.isArray(item)) {
      entries = item.map((e) => ({ ...e }));
    } else if (item && typeof item.entries === 'function') {
      entries = item.entries().map((e) => ({ ...e }));
    } else if (item && Array.isArray(item.entries)) {
      entries = item.entries.map((e) => ({ ...e }));
    } else if (item && typeof item.id === 'string') {
      entries = resolveEntries(item.id, options);
    } else {
      continue;
    }

    for (const entry of entries) {
      const h = hashEntry(entry);
      if (dedup && seen.has(h)) {
        continue;
      }
      seen.add(h);
      all.push({ ...entry });
    }
  }

  all.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

  return all;
}

// ---------------------------------------------------------------------------
// diffSessions
// ---------------------------------------------------------------------------

/**
 * Compare two sessions and return message count differences.
 *
 * Compares entries at the same position index. Extra entries in A are "removed",
 * extra entries in B are "added", and entries at the same index with different
 * content are "changed".
 *
 * @param {string|Array<object>} sessionA - Session ID or entry array.
 * @param {string|Array<object>} sessionB - Session ID or entry array.
 * @param {object} [options]
 * @returns {{ added: number, removed: number, changed: number }}
 */
function diffSessions(sessionA, sessionB, options = {}) {
  const entriesA = resolveEntries(sessionA, options);
  const entriesB = resolveEntries(sessionB, options);

  const minLen = Math.min(entriesA.length, entriesB.length);
  let changed = 0;

  for (let i = 0; i < minLen; i++) {
    if (hashEntry(entriesA[i]) !== hashEntry(entriesB[i])) {
      changed++;
    }
  }

  const removed = Math.max(0, entriesA.length - entriesB.length) + 0;
  const added = Math.max(0, entriesB.length - entriesA.length) + 0;

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// archiveSession
// ---------------------------------------------------------------------------

/**
 * Move a session transcript to an archive directory.
 *
 * The session's .jsonl file is moved to `archiveDir`, and a companion
 * `archive-info.json` is written alongside it with compression metadata.
 *
 * @param {string} sessionId - Session ID or prefix.
 * @param {string} archiveDir - Destination directory for archived sessions.
 * @param {object} [options]
 * @param {boolean} [options.copy=false] - Copy instead of move (default: move).
 * @returns {{ sessionId: string, archivePath: string, originalPath: string, moved: boolean }}
 */
function archiveSession(sessionId, archiveDir, options = {}) {
  const session = findSessionById(sessionId, options);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const originalPath = session.path;
  const fileName = path.basename(originalPath);
  const resolvedDir = path.resolve(archiveDir);

  // Read entries BEFORE moving the file
  const entries = session.entries();
  const stats = computeSessionStats(entries);

  fs.mkdirSync(resolvedDir, { recursive: true });

  const archivePath = path.join(resolvedDir, fileName);
  const shouldCopy = options.copy === true;

  if (shouldCopy) {
    fs.copyFileSync(originalPath, archivePath);
  } else {
    fs.renameSync(originalPath, archivePath);
  }

  // Write archive metadata
  const infoPath = path.join(resolvedDir, `${path.basename(fileName, '.jsonl')}-archive-info.json`);
  const info = {
    sessionId: session.id,
    archivedAt: new Date().toISOString(),
    originalPath,
    archivePath,
    copied: shouldCopy,
    messageCount: entries.length,
    turnCount: stats.turnCount,
    firstTimestamp: stats.firstTimestamp,
    lastTimestamp: stats.lastTimestamp,
  };

  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf8');

  return {
    sessionId: session.id,
    archivePath,
    originalPath,
    moved: !shouldCopy,
  };
}

// ---------------------------------------------------------------------------
// getSessionStats
// ---------------------------------------------------------------------------

/**
 * Compute statistics for a single session.
 *
 * @param {Array<object>} entries
 * @returns {object} Stats object.
 */
function computeSessionStats(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      messageCount: 0,
      turnCount: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolMessages: 0,
      systemMessages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      estimatedCost: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      fileChanges: 0,
    };
  }

  let userMessages = 0;
  let assistantMessages = 0;
  let toolMessages = 0;
  let systemMessages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let fileChanges = 0;

  const timestamps = [];

  for (const entry of entries) {
    const role = String(entry.role || '').toLowerCase();

    if (role === 'user') userMessages++;
    else if (role === 'assistant') assistantMessages++;
    else if (role === 'tool') toolMessages++;
    else if (role === 'system') systemMessages++;

    if (entry.usage || Number.isFinite(entry.input_tokens) || Number.isFinite(entry.outputTokens)) {
      inputTokens += readUsageNumber(entry, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens');
      outputTokens += readUsageNumber(entry, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens');
      cacheCreationTokens += readUsageNumber(entry, 'cache_creation_input_tokens', 'cacheCreationInputTokens');
      cacheReadTokens += readUsageNumber(entry, 'cache_read_input_tokens', 'cacheReadInputTokens');
    }

    if (role === 'tool') {
      const name = String(entry.name || entry.toolName || '').toLowerCase();
      if (/^(file|write|edit|create|delete|remove|rename|move|copy)/.test(name) ||
          /\.(edit|write|create|delete|remove|rename|move)/.test(name)) {
        fileChanges++;
      }
    }

    if (entry.timestamp) {
      timestamps.push(new Date(entry.timestamp).getTime());
    }
  }

  const firstTimestamp = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
  const lastTimestamp = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
  const durationMs = timestamps.length > 1
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0;

  // Simple cost estimation: $3/M input, $15/M output (Sonnet default)
  const estimatedCost = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;

  return {
    messageCount: entries.length,
    turnCount: userMessages,
    userMessages,
    assistantMessages,
    toolMessages,
    systemMessages,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
    durationMs,
    firstTimestamp,
    lastTimestamp,
    fileChanges,
  };
}

/**
 * Get statistics for a session.
 *
 * @param {string} sessionId - Session ID or prefix.
 * @param {object} [options]
 * @returns {object} Stats object (see computeSessionStats).
 */
function getSessionStats(sessionId, options = {}) {
  const session = findSessionById(sessionId, options);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const entries = session.entries();
  const stats = computeSessionStats(entries);

  return {
    sessionId: session.id,
    ...stats,
  };
}

// ---------------------------------------------------------------------------
// searchSessions
// ---------------------------------------------------------------------------

/**
 * Search across ALL session transcripts for matching messages.
 *
 * @param {string} query - Search query string.
 * @param {object} [options]
 * @param {number} [options.limit=50] - Maximum results to return.
 * @param {string} [options.role] - Filter by role (user, assistant, tool, system).
 * @returns {Array<{sessionId: string, entry: object, score: number}>}
 */
function searchSessions(query, options = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return [];
  }

  const q = query.trim().toLowerCase();
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 50;
  const filterRole = typeof options.role === 'string' ? options.role.trim().toLowerCase() : null;

  const sessions = listSessions(options);
  const results = [];

  for (const session of sessions) {
    let entries;
    try {
      entries = session.entries();
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (filterRole && String(entry.role || '').toLowerCase() !== filterRole) {
        continue;
      }

      // Skip metadata entries
      if (entry.type === 'session.meta') {
        continue;
      }

      const content = String(entry.content || '');
      const name = String(entry.name || '');
      const data = entry.data !== undefined ? String(JSON.stringify(entry.data)) : '';

      const contentLower = content.toLowerCase();
      const nameLower = name.toLowerCase();
      const dataLower = data.toLowerCase();

      if (!contentLower.includes(q) && !nameLower.includes(q) && !dataLower.includes(q)) {
        continue;
      }

      let score = 0;
      if (contentLower === q) {
        score += 50;
      } else if (contentLower.includes(q)) {
        score += 20;
        // Bonus for word-boundary matches
        if (new RegExp(`\\b${escapeRegExp(q)}\\b`, 'i').test(content)) {
          score += 10;
        }
      }
      if (nameLower === q) {
        score += 30;
      } else if (nameLower.includes(q)) {
        score += 15;
      }
      if (dataLower.includes(q)) {
        score += 5;
      }

      results.push({
        sessionId: session.id,
        entry: { ...entry },
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// pruneSessions
// ---------------------------------------------------------------------------

/**
 * Delete old sessions, keeping the most recent N.
 *
 * Sessions are sorted by their last-updated time. If both `maxAge` and `maxCount`
 * are specified, the intersection is kept (sessions must satisfy both criteria).
 *
 * @param {{ maxAge?: number, maxCount?: number }} criteria
 *   - maxAge: Maximum age in milliseconds. Sessions older than this are pruned.
 *   - maxCount: Maximum number of most recent sessions to keep.
 * @param {object} [options]
 * @returns {{ deleted: number, kept: number, deletedIds: Array<string> }}
 */
function pruneSessions(criteria = {}, options = {}) {
  const maxAge = Number.isFinite(criteria.maxAge) && criteria.maxAge > 0 ? criteria.maxAge : null;
  const maxCount = Number.isFinite(criteria.maxCount) && criteria.maxCount > 0 ? criteria.maxCount : null;

  const sessions = listSessions(options);

  if (maxAge === null && maxCount === null) {
    return { deleted: 0, kept: sessions.length, deletedIds: [] };
  }

  const now = Date.now();
  const cutoff = maxAge !== null ? now - maxAge : 0;

  // Sessions already sorted newest-first by listSessions
  const keep = [];
  const deleteCandidates = [];

  for (const session of sessions) {
    const updatedAt = new Date(session.updatedAt).getTime();

    const ageOk = maxAge === null || updatedAt >= cutoff;
    const countOk = maxCount === null || keep.length < maxCount;

    if (ageOk && countOk) {
      keep.push(session);
    } else {
      deleteCandidates.push(session);
    }
  }

  const deletedIds = [];
  for (const session of deleteCandidates) {
    try {
      fs.unlinkSync(session.path);
      deletedIds.push(session.id);
    } catch {
      // File may already be gone
    }
  }

  return {
    deleted: deletedIds.length,
    kept: keep.length,
    deletedIds,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  mergeSessions,
  diffSessions,
  archiveSession,
  getSessionStats,
  searchSessions,
  pruneSessions,
  // Internal helpers exported for testing
  _hashEntry: hashEntry,
  _computeSessionStats: computeSessionStats,
};
