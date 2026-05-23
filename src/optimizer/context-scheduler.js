"use strict";

const DEFAULT_CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a string.
 *
 * @param {string} text
 * @param {number} [charsPerToken=4]
 * @returns {number}
 */
function estimateTokens(text, charsPerToken) {
  const cpt = Number.isFinite(charsPerToken) && charsPerToken > 0
    ? charsPerToken
    : DEFAULT_CHARS_PER_TOKEN;
  const t = String(text ?? "").trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / cpt));
}

/**
 * Estimate the token count of a single message object.
 *
 * @param {{ content: string }} msg
 * @param {number} [charsPerToken]
 * @returns {number}
 */
function messageTokens(msg, charsPerToken) {
  if (!msg) return 0;
  return estimateTokens(String(msg.content ?? ""), charsPerToken) + 8; // overhead
}

/**
 * Compute a relevance score for a message against a query string.
 * Higher score = more relevant.
 *
 * Uses simple TF-inspired term overlap.  Adequate for scheduling decisions
 * without requiring an embedding model.
 *
 * @param {{ content: string }} message
 * @param {string} query
 * @returns {number}
 */
function scoreRelevance(message, query) {
  if (!message || !message.content) return 0;
  if (!query || !query.trim()) return 0.5;

  const content = String(message.content).toLowerCase();
  const queryLower = query.toLowerCase();

  // Extract terms from the query (words 3+ chars).
  const queryTerms = queryLower
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3);

  if (queryTerms.length === 0) return 0.5;

  let matches = 0;
  let totalWeight = 0;

  for (const term of queryTerms) {
    const weight = term.length; // longer terms are more specific
    totalWeight += weight;
    // Count occurrences of term in content.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (content.match(new RegExp(escaped, "g")) || []).length;
    matches += count * weight;
  }

  // Normalize: low overlap gets low score, strong overlap gets high score.
  const rawScore = totalWeight > 0 ? matches / totalWeight : 0;
  return Math.min(1, rawScore / (1 + rawScore));
}

// ---------------------------------------------------------------------------
// ContextScheduler
// ---------------------------------------------------------------------------

class ContextScheduler {
  /**
   * @param {object} [options]
   * @param {number} [options.charsPerToken=4]
   */
  constructor(options = {}) {
    this.charsPerToken = Number.isFinite(options.charsPerToken) && options.charsPerToken > 0
      ? options.charsPerToken
      : DEFAULT_CHARS_PER_TOKEN;

    /** @private */
    this._lastSchedule = null;
  }

  // -----------------------------------------------------------------------
  // schedule(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Select the optimal subset of messages that fits within the token budget.
   *
   * Strategy:
   *   1. Always include the most recent message (the current turn).
   *   2. Walk backwards through remaining messages, greedily including those
   *      that fit within the remaining budget.
   *   3. Messages that cannot fit are candidates for dropping or summarization.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget — maximum token budget for the selected messages
   * @param {object} [options]
   * @param {string} [options.query] — current query used for relevance scoring
   * @param {number} [options.summarizeThreshold] — min tokens for auto-summary
   * @returns {{ included: Array, dropped: Array, summarized: Array,
   *             totalTokens: number, budget: number }}
   */
  schedule(messages, budget, options = {}) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      const empty = { included: [], dropped: [], summarized: [],
        totalTokens: 0, budget: budget || 0 };
      this._lastSchedule = empty;
      return empty;
    }

    const budgetTokens = Math.max(1, Number.isFinite(budget) ? budget : 0);
    const cpt = this.charsPerToken;

    // Always keep the most recent message.
    const latest = msgs[msgs.length - 1];
    const latestTokens = messageTokens(latest, cpt);
    let remaining = Math.max(0, budgetTokens - Math.min(latestTokens, budgetTokens));

    const included = [];
    // If latest fits, reserve it; otherwise we'll truncate it later.
    const latestFits = latestTokens <= budgetTokens;

    // Walk backwards through older messages.
    const pending = [];
    for (let i = msgs.length - 2; i >= 0; i -= 1) {
      const msg = msgs[i];
      const t = messageTokens(msg, cpt);

      if (remaining >= t) {
        included.push(msg);
        remaining -= t;
      } else {
        pending.push(msg);
      }
    }

    // included was built newest-first among the older messages; reverse to oldest-first.
    included.reverse();

    // Attach the latest message (possibly truncated).
    if (latestFits) {
      included.push(latest);
    } else {
      // Truncate the latest message to fit available budget.
      const truncated = this._truncateMessage(latest, budgetTokens, cpt);
      included.push(truncated);
    }

    const totalTokens = included.reduce((sum, m) => sum + messageTokens(m, cpt), 0);

    // Summarize dropped messages if they accumulated enough content.
    const summarized = [];
    const dropTokens = pending.reduce((sum, m) => sum + messageTokens(m, cpt), 0);
    if (dropTokens >= (options.summarizeThreshold ?? 100)) {
      summarized.push(...this.summarizeStaleContext(pending, { charsPerToken: cpt }));
    }

    this._lastSchedule = {
      included,
      dropped: pending,
      summarized,
      totalTokens,
      budget: budgetTokens,
    };

    return this._lastSchedule;
  }

  // -----------------------------------------------------------------------
  // prioritizeByRelevance(messages, query)
  // -----------------------------------------------------------------------

  /**
   * Rank messages by relevance to the current query.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.charsPerToken]
   * @returns {Array<{ message: object, score: number }>} Ranked list, highest score first.
   */
  prioritizeByRelevance(messages, query, options = {}) {
    const cpt = Number.isFinite(options.charsPerToken) && options.charsPerToken > 0
      ? options.charsPerToken
      : this.charsPerToken;

    const msgs = Array.isArray(messages) ? messages : [];
    const q = String(query ?? "");

    const scored = msgs.map((message) => ({
      message,
      score: scoreRelevance(message, q),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // -----------------------------------------------------------------------
  // summarizeStaleContext(oldMessages)
  // -----------------------------------------------------------------------

  /**
   * Produce a concise textual summary of stale/old messages instead of
   * discarding them entirely.
   *
   * @param {Array<{role: string, content: string}>} oldMessages
   * @param {object} [options]
   * @param {number} [options.charsPerToken]
   * @returns {Array<{role: string, content: string}>} Single message array
   *   containing the summary.
   */
  summarizeStaleContext(oldMessages, options = {}) {
    const msgs = Array.isArray(oldMessages) ? oldMessages : [];
    if (msgs.length === 0) return [];

    const summaryLines = [];
    summaryLines.push(`[Context summary of ${msgs.length} preceding messages]`);

    // Create per-role summaries with key information extraction.
    const byRole = new Map();
    let toolCallCount = 0;
    let codeBlocksDetected = 0;

    for (const msg of msgs) {
      const role = (msg && msg.role) ? msg.role : "unknown";
      const content = String(msg.content ?? "");

      if (!byRole.has(role)) {
        byRole.set(role, []);
      }
      byRole.get(role).push(content);

      // Detect tool calls
      if (role === "tool") toolCallCount += 1;
      // Detect code blocks
      if (content.includes("```")) codeBlocksDetected += 1;
    }

    for (const [role, contents] of byRole) {
      if (contents.length === 0) continue;

      // Extract first sentence of each message for a lightweight summary.
      const snippets = [];
      for (const content of contents) {
        const firstSentence = content.split(/[.!?]\s+/)[0].trim();
        if (firstSentence.length > 0 && firstSentence.length < 400) {
          snippets.push(firstSentence);
        } else if (firstSentence.length >= 400) {
          snippets.push(firstSentence.slice(0, 397) + "...");
        }
      }

      if (snippets.length > 0) {
        // Limit to max 5 snippets per role to keep summary lean.
        const trimmed = snippets.slice(0, 5);
        const suffix = snippets.length > 5
          ? ` [...and ${snippets.length - 5} more]`
          : "";
        summaryLines.push(`${role} (${contents.length} messages): ${trimmed.join(" | ")}${suffix}`);
      }
    }

    if (toolCallCount > 0) {
      summaryLines.push(`${toolCallCount} tool calls were made during this period.`);
    }
    if (codeBlocksDetected > 0) {
      summaryLines.push(`${codeBlocksDetected} code blocks were shared.`);
    }

    return [{
      role: "system",
      content: summaryLines.join("\n"),
    }];
  }

  // -----------------------------------------------------------------------
  // injectContext(messages, context)
  // -----------------------------------------------------------------------

  /**
   * Insert additional context at the optimal position within a message list.
   *
   * Strategy:
   *   - If the list contains a system message, prepend context to it.
   *   - Otherwise, insert a new system message at position 0.
   *   - If insertionPoint is specified, use that index instead.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {string|object} context — text or a message-like object
   * @param {object} [options]
   * @param {number} [options.insertionPoint] — explicit insertion index
   * @returns {Array<{role: string, content: string}>} New message list with context injected.
   */
  injectContext(messages, context, options = {}) {
    const msgs = Array.isArray(messages) ? [...messages] : [];
    const ctxText = typeof context === "string" ? context : String(context?.content ?? context ?? "");

    if (!ctxText.trim()) {
      return msgs;
    }

    const contextMessage = typeof context === "object" && context !== null && context.role
      ? { ...context, content: ctxText }
      : { role: "system", content: ctxText };

    // Use explicit insertion point if provided and valid.
    if (Number.isFinite(options.insertionPoint)) {
      const idx = Math.max(0, Math.min(options.insertionPoint, msgs.length));
      msgs.splice(idx, 0, contextMessage);
      return msgs;
    }

    // Find the last system message and append to it.
    const systemIdx = msgs.reduce((lastIdx, msg, i) => {
      return msg.role === "system" ? i : lastIdx;
    }, -1);

    if (systemIdx >= 0) {
      msgs[systemIdx] = {
        ...msgs[systemIdx],
        content: msgs[systemIdx].content + "\n\n" + ctxText,
      };
    } else {
      msgs.unshift(contextMessage);
    }

    return msgs;
  }

  // -----------------------------------------------------------------------
  // getSchedule()
  // -----------------------------------------------------------------------

  /**
   * Return the result of the last `schedule()` call.
   *
   * @returns {{ included: Array, dropped: Array, summarized: Array,
   *             totalTokens: number, budget: number } | null}
   */
  getSchedule() {
    return this._lastSchedule;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  _truncateMessage(message, budgetTokens, charsPerToken) {
    const overhead = 8;
    const contentBudget = Math.max(1, budgetTokens - overhead);
    const maxChars = Math.max(1, Math.floor(contentBudget * (charsPerToken || DEFAULT_CHARS_PER_TOKEN)));
    const content = String(message?.content ?? "");
    const suffix = "\n\n[Content truncated to fit budget.]";

    if (content.length <= maxChars) {
      return { ...message };
    }

    const keep = Math.max(1, maxChars - suffix.length);
    return {
      ...message,
      content: content.slice(0, keep) + suffix,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextScheduler,
  estimateTokens,
  messageTokens,
  scoreRelevance,
};
