"use strict";

/**
 * @fileoverview Conversation chunking utilities.
 *
 * Splits long conversation histories into manageable chunks using various
 * strategies: fixed turn counts, token budgets, topic boundaries, and
 * time gaps.  Includes an optimizer that finds near-optimal chunk boundaries.
 *
 * Chunk format:
 *   { messages: Array, startIndex: number, endIndex: number,
 *     estimatedTokens: number, topic: string, summary: string }
 */

const summarizer = require("./summarizer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize any message list to a standard form.
 * @param {*} messages
 * @returns {Array<{role: string, content: string, timestamp?: string}>}
 */
function normalize(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m, i) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: (m && m.content !== undefined && m.content !== null)
      ? String(m.content)
      : "",
    timestamp: (m && typeof m.timestamp === "string") ? m.timestamp : undefined,
    _index: i,
  }));
}

/**
 * Estimate token count for a message (characters / charsPerToken).
 * @param {{content: string}} msg
 * @param {number} [charsPerToken=4]
 * @returns {number}
 */
function estimateMessageTokens(msg, charsPerToken) {
  const rate = Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : 4;
  const text = msg && msg.content ? String(msg.content) : "";
  return Math.max(1, Math.ceil(text.length / rate));
}

/**
 * Estimate token count for an array of messages.
 * @param {Array} msgs
 * @param {number} [charsPerToken=4]
 * @returns {number}
 */
function estimateTotalTokens(msgs, charsPerToken) {
  return msgs.reduce((sum, m) => sum + estimateMessageTokens(m, charsPerToken) + 4, 0);
}

/**
 * Build a Chunk object.
 * @param {Array} msgs
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {number} [charsPerToken=4]
 * @returns {{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}}
 */
function makeChunk(msgs, startIdx, endIdx, charsPerToken) {
  const tokens = estimateTotalTokens(msgs, charsPerToken);
  const topicBlocks = summarizer.summarizeByTopic(msgs);
  const topic = topicBlocks.length > 0 ? topicBlocks[0].topic : "General";
  const tldr = summarizer.generateTLDR(msgs);

  return {
    messages: msgs,
    startIndex: startIdx,
    endIndex: endIdx,
    estimatedTokens: tokens,
    topic,
    summary: tldr,
  };
}

// ---------------------------------------------------------------------------
// chunkByTurns
// ---------------------------------------------------------------------------

/**
 * Split messages into fixed-size chunks by number of turns (message count).
 *
 * @param {Array<{role: string, content: *}>} messages
 * @param {number} [maxTurns=20]  Maximum messages per chunk.
 * @returns {Array<{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}>}
 */
function chunkByTurns(messages, maxTurns) {
  const normalized = normalize(messages);
  const size = Math.max(1, Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 20);

  if (normalized.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < normalized.length; i += size) {
    const end = Math.min(i + size, normalized.length);
    const slice = normalized.slice(i, end);
    chunks.push(makeChunk(slice, i, end - 1));
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// chunkByTokens
// ---------------------------------------------------------------------------

/**
 * Split messages into chunks where each chunk's estimated token count stays
 * under `maxTokens`.  Messages are never split in half — a chunk may be
 * slightly under the budget.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @param {number} [maxTokens=8000]
 * @param {number} [charsPerToken=4]
 * @returns {Array<{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}>}
 */
function chunkByTokens(messages, maxTokens, charsPerToken) {
  const budget = Math.max(1, Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8000);
  const normalized = normalize(messages);

  if (normalized.length === 0) return [];

  const chunks = [];
  let current = [];
  let currentTokens = 0;
  let startIdx = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const msg = normalized[i];
    const msgTokens = estimateMessageTokens(msg, charsPerToken) + 4;

    // If adding this message exceeds the budget and we already have messages,
    // close the current chunk.
    if (currentTokens + msgTokens > budget && current.length > 0) {
      chunks.push(makeChunk(current, startIdx, i - 1, charsPerToken));
      current = [];
      currentTokens = 0;
      startIdx = i;
    }

    current.push(msg);
    currentTokens += msgTokens;
  }

  // Flush remaining messages.
  if (current.length > 0) {
    chunks.push(makeChunk(current, startIdx, normalized.length - 1, charsPerToken));
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// chunkByTopic
// ---------------------------------------------------------------------------

/**
 * Split messages at topic boundaries detected by summarizer's topic-detection
 * logic.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @param {number} [charsPerToken=4]
 * @returns {Array<{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}>}
 */
function chunkByTopic(messages, charsPerToken) {
  const normalized = normalize(messages);
  if (normalized.length === 0) return [];

  // Detect topic boundaries.
  const boundaries = detectTopicBoundaries(normalized);

  // Build chunks between boundaries.
  const chunks = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i];
    const end = (i < boundaries.length - 1)
      ? boundaries[i + 1] - 1
      : normalized.length - 1;
    const slice = normalized.slice(start, end + 1);
    if (slice.length > 0) {
      chunks.push(makeChunk(slice, start, end, charsPerToken));
    }
  }

  return chunks;
}

/**
 * Detect indices at which topic boundaries occur.
 * @param {Array} normalized
 * @returns {number[]}
 */
function detectTopicBoundaries(normalized) {
  if (normalized.length === 0) return [];

  const boundaries = [0];

  const TOPIC_TRANSITION_PATTERNS = [
    /\b(?:next|now|also|additionally|separately|regarding|about|concerning)\b/i,
    /\b(?:moving on|switching gears|changing topic|another thing|one more)\b/i,
    /\b(?:let'?s (?:talk|discuss|move|switch|address|cover|handle|focus))\b/i,
    /\b(?:that reminds me|speaking of which|by the way|on a different note)\b/i,
  ];

  for (let i = 1; i < normalized.length; i += 1) {
    const prevText = normalized[i - 1].content;
    const currText = normalized[i].content;

    // Transition phrase in current message.
    const hasTransition = TOPIC_TRANSITION_PATTERNS.some((p) => p.test(currText));

    // Jaccard distance between adjacent messages.
    const prevWords = new Set(extractSignificantWords(prevText));
    const currWords = new Set(extractSignificantWords(currText));
    const shared = [...currWords].filter((w) => prevWords.has(w)).length;
    const union = new Set([...prevWords, ...currWords]).size;
    const similarity = union > 0 ? shared / union : 0;

    const isNewTopic = hasTransition || (similarity < 0.15 && union > 5);
    if (isNewTopic) {
      boundaries.push(i);
    }
  }

  return boundaries;
}

/**
 * Extract significant words (length >= 3, not stop words).
 * @param {string} text
 * @returns {string[]}
 */
function extractSignificantWords(text) {
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "have", "from",
    "its", "that", "with", "this", "will", "just", "like", "been",
    "some", "than", "then", "also", "very", "into", "more", "them",
    "such", "only", "over", "when", "what", "how", "where", "which",
    "there", "their", "about", "would", "could", "should", "after",
    "before", "however", "though", "really", "still", "well", "good",
    "say", "said", "need", "want", "know", "think", "thing", "things",
    "going", "much", "even", "does", "make", "made",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  return [...new Set(words)].slice(0, 50);
}

// ---------------------------------------------------------------------------
// chunkByTime
// ---------------------------------------------------------------------------

/**
 * Split messages by time gaps.  When two adjacent messages have timestamps
 * that differ by more than `maxMinutes`, a chunk boundary is created.
 *
 * Messages without timestamps are treated as belonging to the same session.
 *
 * @param {Array<{role: string, content: *, timestamp?: string}>} messages
 * @param {number} [maxMinutes=30]
 * @param {number} [charsPerToken=4]
 * @returns {Array<{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}>}
 */
function chunkByTime(messages, maxMinutes, charsPerToken) {
  const gap = Math.max(1, Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 30);
  const normalized = normalize(messages);

  if (normalized.length === 0) return [];

  const chunks = [];
  let current = [];
  let startIdx = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    if (current.length === 0) {
      current.push(normalized[i]);
      startIdx = i;
      continue;
    }

    const prev = current[current.length - 1];
    const curr = normalized[i];

    if (shouldSplit(prev, curr, gap)) {
      chunks.push(makeChunk(current, startIdx, i - 1, charsPerToken));
      current = [curr];
      startIdx = i;
    } else {
      current.push(curr);
    }
  }

  // Flush remaining.
  if (current.length > 0) {
    chunks.push(makeChunk(current, startIdx, normalized.length - 1, charsPerToken));
  }

  return chunks;
}

/**
 * Determine if two adjacent messages should be in separate chunks based on
 * their timestamps.
 * @param {{timestamp?: string}} a
 * @param {{timestamp?: string}} b
 * @param {number} maxMinutes
 * @returns {boolean}
 */
function shouldSplit(a, b, maxMinutes) {
  const ta = parseTimestamp(a && a.timestamp);
  const tb = parseTimestamp(b && b.timestamp);
  if (ta === null || tb === null) return false;

  const diffMs = Math.abs(tb - ta);
  return diffMs > maxMinutes * 60 * 1000;
}

/**
 * Parse a timestamp string to Date-value.
 * Supports ISO 8601 and common formats.  Returns null if unparseable.
 * @param {string|undefined|null} ts
 * @returns {number|null}
 */
function parseTimestamp(ts) {
  if (typeof ts !== "string" || !ts.trim()) return null;
  const d = Date.parse(ts);
  return Number.isFinite(d) ? d : null;
}

// ---------------------------------------------------------------------------
// optimizeChunks
// ---------------------------------------------------------------------------

/**
 * Find near-optimal chunk boundaries that keep each chunk under
 * `maxChunkTokens` while trying to align boundaries with natural breakpoints
 * (topic shifts, large time gaps, role transitions).
 *
 * Algorithm:
 *  1. Walk forward, greedily filling chunks up to the token budget.
 *  2. When the budget is exceeded, look backward within a small window
 *     for a "better" split point (topic boundary or user→assistant transition).
 *  3. If no good boundary is found, split at the message just before overflow.
 *
 * @param {Array<{role: string, content: *, timestamp?: string}>} messages
 * @param {number} [maxChunkTokens=8000]
 * @param {number} [charsPerToken=4]
 * @returns {Array<{messages: Array, startIndex: number, endIndex: number, estimatedTokens: number, topic: string, summary: string}>}
 */
function optimizeChunks(messages, maxChunkTokens, charsPerToken) {
  const budget = Math.max(256, Number.isFinite(maxChunkTokens) && maxChunkTokens > 0 ? maxChunkTokens : 8000);
  const normalized = normalize(messages);

  if (normalized.length === 0) return [];

  // Build topic boundary set for quick lookup.
  const topicBoundaries = new Set(detectTopicBoundaries(normalized));

  // Find time-gap boundaries.
  const timeGaps = new Set();
  for (let i = 1; i < normalized.length; i += 1) {
    if (shouldSplit(normalized[i - 1], normalized[i], 30)) {
      timeGaps.add(i);
    }
  }

  const chunks = [];
  let i = 0;

  while (i < normalized.length) {
    const startIdx = i;
    let currentTokens = 0;
    let endIdx = i;

    while (i < normalized.length) {
      const msgTokens = estimateMessageTokens(normalized[i], charsPerToken) + 4;

      if (currentTokens + msgTokens > budget && i > startIdx) {
        // Look backward up to 5 messages for a better split point.
        let bestSplit = i;
        let bestScore = 0;

        const lookback = Math.min(5, i - startIdx);
        for (let j = i - lookback; j < i; j += 1) {
          let score = 0;
          // Prefer topic boundaries.
          if (topicBoundaries.has(j)) score += 100;
          // Prefer time-gap boundaries.
          if (timeGaps.has(j)) score += 80;
          // Prefer user → assistant transitions (new round).
          if (j > 0 && normalized[j - 1].role === "assistant" && normalized[j].role === "user") {
            score += 50;
          }
          // Slight penalty for splitting too early.
          const utilization = currentTokens / budget;
          if (utilization > 0.5) score += 30;

          if (score > bestScore) {
            bestScore = score;
            bestSplit = j;
          }
        }

        endIdx = bestSplit - 1;
        i = bestSplit;
        break;
      }

      currentTokens += msgTokens;
      endIdx = i;
      i += 1;
    }

    // If we ran to the end.
    if (i >= normalized.length) {
      endIdx = normalized.length - 1;
    }

    const slice = normalized.slice(startIdx, endIdx + 1);
    if (slice.length > 0) {
      chunks.push(makeChunk(slice, startIdx, endIdx, charsPerToken));
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  chunkByTurns,
  chunkByTokens,
  chunkByTopic,
  chunkByTime,
  optimizeChunks,
  // Helpers exported for testing.
  _internals: {
    normalize,
    estimateMessageTokens,
    estimateTotalTokens,
    makeChunk,
    detectTopicBoundaries,
    extractSignificantWords,
    shouldSplit,
    parseTimestamp,
  },
};
