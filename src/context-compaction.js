"use strict";

/**
 * Default number of most-recent messages to preserve during compaction.
 * Messages older than this window become candidates for summarisation.
 */
const DEFAULT_PRESERVE_COUNT = 20;

/**
 * Absolute minimum number of messages that must remain in the preserve
 * zone regardless of the caller's preference.  Keeps at least one
 * conversational round-trip (user + assistant) intact.
 */
const MINIMUM_PRESERVE_COUNT = 2;

/** Maximum total characters allowed in the compaction prompt's history section. */
const MAX_COMPACTION_CHARS = 50000;

/**
 * Split a message list into two zones.
 *
 * The *summary zone* contains older messages that are candidates for
 * LLM summarisation.  The *preserve zone* contains the most recent
 * messages that should be kept verbatim.
 *
 * @param {Array<{role: string, content: string}>} messages
 *   The full conversation message list (oldest-first).
 * @param {object} [options]
 * @param {number} [options.preserveCount=20]
 *   How many of the most-recent messages to keep verbatim.
 *   Clamped to a minimum of {@link MINIMUM_PRESERVE_COUNT}.
 * @returns {{ summaryZone: Array, preserveZone: Array }}
 */
function compactMessages(messages, options = {}) {
  if (!Array.isArray(messages)) {
    return { summaryZone: [], preserveZone: [] };
  }

  const preserveCount = Math.max(
    MINIMUM_PRESERVE_COUNT,
    Number.isFinite(options.preserveCount)
      ? options.preserveCount
      : DEFAULT_PRESERVE_COUNT,
  );

  // When there are too few messages everything goes to the preserve zone.
  if (messages.length <= preserveCount) {
    return {
      summaryZone: [],
      preserveZone: [...messages],
    };
  }

  const splitIndex = messages.length - preserveCount;

  return {
    summaryZone: messages.slice(0, splitIndex),
    preserveZone: messages.slice(splitIndex),
  };
}

/**
 * Build a prompt string suitable for sending to an LLM to condense the
 * summary-zone messages into a short, lossy recap.
 *
 * @param {Array<{role: string, content: string}>} summaryMessages
 *   Messages from the summary zone (oldest-first).
 * @param {number} [maxTokens]
 *   Optional soft hint for the desired summary token budget.
 * @returns {string} The prompt text.
 */
function buildCompactionPrompt(summaryMessages, maxTokens) {
  const messages = Array.isArray(summaryMessages) ? summaryMessages : [];
  const count = messages.length;

  const tokenHint =
    Number.isFinite(maxTokens)
      ? ` Keep the summary under approximately ${maxTokens} tokens.`
      : "";

  let historyLines = messages.map((msg, i) => {
    const role = (msg && msg.role) ? msg.role : "unknown";
    const content = (msg && msg.content !== undefined && msg.content !== null)
      ? String(msg.content)
      : "";
    return `[${i + 1}] ${role}: ${content}`;
  });

  // Enforce a size limit to avoid blowing up the compaction prompt.
  let totalChars = 0;
  let omittedCount = 0;
  const limited = [];
  // Walk from newest (most relevant) backward so truncation drops oldest first.
  for (let i = historyLines.length - 1; i >= 0; i -= 1) {
    const lineLen = historyLines[i].length + 1; // +1 for newline
    if (totalChars + lineLen > MAX_COMPACTION_CHARS) {
      omittedCount = i + 1;
      break;
    }
    totalChars += lineLen;
    limited.unshift(historyLines[i]);
  }
  historyLines = limited;

  const preamble = [
    `Summarize the following conversation history (${count} messages) into a concise but comprehensive summary.`,
    "Include key decisions, facts, code changes, files modified, and any important context.",
    "Focus on information that will be useful to continue the conversation without losing context.",
    tokenHint,
    omittedCount > 0 ? `(${omittedCount} older summaries omitted due to size)` : "",
    "",
    "Conversation history:",
  ];

  return [...preamble, ...historyLines, "", "Summary:"].filter(Boolean).join("\n");
}

/**
 * Rebuild a compacted message list from the original conversation.
 *
 * When a summary is provided the first preserved message has the summary
 * prepended inside a `<conversation-summary>` block so the LLM can see the
 * lost context.  The last `preserveCount` messages are then appended
 * verbatim.
 *
 * @param {Array<{role: string, content: string}>} originalMessages
 *   The full, uncompacted message list (oldest-first).
 * @param {string} summary
 *   The summary text produced by an earlier compaction step.
 *   An empty / whitespace-only summary is treated as no summary.
 * @param {number} [preserveCount]
 *   How many messages to retain from the tail.  Defaults to
 *   {@link DEFAULT_PRESERVE_COUNT} and is clamped to a minimum of
 *   {@link MINIMUM_PRESERVE_COUNT}.
 * @returns {Array<{role: string, content: string}>} The rebuilt message list.
 */
function buildCompactMessages(originalMessages, summary, preserveCount) {
  const messages = Array.isArray(originalMessages) ? originalMessages : [];

  if (messages.length === 0) {
    return [];
  }

  const count = Math.max(
    MINIMUM_PRESERVE_COUNT,
    Number.isFinite(preserveCount) ? preserveCount : DEFAULT_PRESERVE_COUNT,
  );

  // Extract the tail that should stay verbatim.
  const preserveZone = messages.slice(-Math.min(count, messages.length));

  const summaryText = (typeof summary === "string" ? summary : "").trim();

  if (!summaryText) {
    return [...preserveZone];
  }

  // Prepend the summary to the first message in the preserve zone.
  const first = { ...preserveZone[0] };
  first.content = [
    "<conversation-summary>",
    summaryText,
    "</conversation-summary>",
    "",
    first.content || "",
  ].join("\n");

  return [first, ...preserveZone.slice(1)];
}

module.exports = {
  compactMessages,
  buildCompactionPrompt,
  buildCompactMessages,
};
