/**
 * Context Compaction — micro-compact and full LLM summarization.
 * Ported from OpenHarness services/compact/.
 */

import { estimateStringTokens } from "../shared/utils.js";

// === Micro-compact: clear old tool results ===

const COMPACTABLE_TOOLS = new Set([
  "file.read", "shell.run", "file.search", "file.glob",
  "web.search", "web.fetch", "file.edit", "file.write",
]);

function microcompact(messages, keepRecent = 5) {
  if (!messages || !messages.length) return { messages, cleared: 0 };

  // Track last N compactable tool results
  const recent = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === "tool_result" && COMPACTABLE_TOOLS.has(b.name)) {
          if (recent.length < keepRecent) recent.push({ msgIdx: i, name: b.name });
        }
      }
    }
  }

  let cleared = 0;
  const result = messages.map((m, mi) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    const modified = m.content.map(b => {
      if (b?.type === "tool_result" && COMPACTABLE_TOOLS.has(b.name) && !recent.some(r => r.msgIdx === mi)) {
        cleared++;
        return { type: "tool_result", tool_use_id: b.tool_use_id, name: b.name, content: "[Old tool result content cleared]", is_error: false };
      }
      return b;
    });
    return { ...m, content: modified };
  });

  return { messages: result, cleared };
}

// === Token estimation ===

function estimateMessageTokens(messages) {
  let total = 0;
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    total += estimateStringTokens(c) + 4; // 4 for role overhead
  }
  return Math.ceil(total * 4 / 3); // 4/3 padding factor
}

// === Full compaction ===

async function fullCompact(messages, summarizeFn, keepRecent = 8) {
  if (!messages || messages.length <= keepRecent) return messages;

  const toSummarize = messages.slice(0, -keepRecent);
  const recent = messages.slice(-keepRecent);

  let summary;
  try { summary = await summarizeFn(toSummarize); }
  catch (_) { return messages; } // Fail safe: return original

  const boundary = {
    role: "user",
    content: `[CONVERSATION SUMMARY — ${toSummarize.length} earlier messages compacted]\n\n${summary}\n\nContinue the conversation using the context above.`,
  };

  return [boundary, ...recent];
}

// === Context window helpers ===

function getContextWindow(model) {
  if (!model) return 200000;
  const m = String(model).toLowerCase();
  if (m.includes("claude-3") || m.includes("claude-")) return 200000;
  if (m.includes("gpt-4o")) return 128000;
  if (m.includes("gpt-4-turbo")) return 128000;
  if (m.includes("gemini-2")) return 1000000;
  return 200000;
}

function getAutoCompactThreshold(model) {
  return getContextWindow(model) - 20000 - 13000; // max_output - buffer
}

// === Compaction Manager ===

class CompactionManager {
  constructor(o = {}) {
    this._summarizeFn = o.summarizeFn || null;
    this._autoCompact = o.autoCompact !== false;
    this._threshold = o.threshold || 0.75; // fraction of context window
  }

  /** Check if compaction is needed */
  needsCompaction(messages, model) {
    if (!this._autoCompact || !messages?.length) return false;
    const tokens = estimateMessageTokens(messages);
    const window = getContextWindow(model);
    return tokens >= window * this._threshold;
  }

  /** Run micro-compact + optional full compact */
  async compact(messages, model) {
    // 1. Micro-compact first (cheap)
    const { messages: mc, cleared } = microcompact(messages);
    if (cleared > 0) messages = mc;

    // 2. Check if full compact needed
    if (!this.needsCompaction(messages, model)) return messages;

    // 3. Full LLM compact
    if (this._summarizeFn) {
      return fullCompact(messages, this._summarizeFn);
    }

    // 4. Fallback: truncate
    return messages.slice(-20);
  }
}

export {
  microcompact,
  fullCompact,
  estimateMessageTokens,
  getContextWindow,
  getAutoCompactThreshold,
  CompactionManager,
  COMPACTABLE_TOOLS,
};
