"use strict";

// ---------------------------------------------------------------------------
// Summary detail levels
// ---------------------------------------------------------------------------

const SummaryLevel = Object.freeze({
  BRIEF: "BRIEF",
  STANDARD: "STANDARD",
  DETAILED: "DETAILED",
});

const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_FREQ_SAMPLE = 3;
const STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "are",
  "was", "not", "but", "you", "all", "can", "had", "her", "was", "one",
  "our", "out", "has", "will", "its", "who", "how", "did", "get",
  "just", "now", "what", "when", "where", "which", "been", "more",
  "some", "them", "then", "also", "very", "into", "only", "other",
  "new", "about", "after", "should", "would", "could", "each",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text: lowercase, strip punctuation, collapse whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first sentence from text.
 *
 * @param {string} text
 * @returns {string}
 */
function firstSentence(text) {
  const cleaned = String(text || "").replace(/\n+/g, " ").trim();
  const match = cleaned.match(/^([^.!?]+[.!?]?)/);
  return match ? match[1].trim() : cleaned.slice(0, 150);
}

/**
 * Extract file paths and names from text.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractFiles(text) {
  const cleaned = String(text || "");
  const patterns = [
    // Absolute paths with extension
    /\b(?:\/[\w.-]+)+\.[a-z]{1,6}\b/gi,
    // Relative paths like src/foo/bar.js
    /\b[\w.-]+\/[\w\/.-]+\.[a-z]{1,6}\b/gi,
    // Windows paths like E:\foo\bar.js
    /\b[A-Z]:\\(?:[\w.-]+\\)*[\w.-]+\.[a-z]{1,6}\b/gi,
    // Filenames with common extensions mentioned in text
    /\b[\w.-]+\.(?:js|ts|json|py|md|yaml|yml|toml|env|cfg|ini|css|html)\b/gi,
  ];

  const seen = new Set();
  const results = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      const file = match[0];
      if (!seen.has(file)) {
        seen.add(file);
        results.push(file);
      }
    }
    pattern.lastIndex = 0;
  }
  return results;
}

/**
 * Extract keywords from text, filtering stop words and short tokens.
 *
 * @param {string} text
 * @returns {Map<string, number>} keyword -> frequency count
 */
function extractKeywords(text) {
  const words = normalize(text).split(" ").filter((w) =>
    w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w),
  );

  const freq = new Map();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

/**
 * Detect whether a message states a decision.
 *
 * @param {string} content
 * @returns {{ isDecision: boolean, snippet: string }}
 */
function detectDecision(content) {
  const text = String(content || "");
  const patterns = [
    /\b(?:decided?|chose|selected|confirmed) (?:to |that |on |the )(.{10,120}?)[.!?]/i,
    /\b(?:plan|approach|strategy) (?:is|will be) (?:to |that )?(.{10,120}?)[.!?]/i,
    /\b(?:go(?:ing)? with|let['’]s) (.{10,120}?)[.!?]/i,
    /\b(?:final|conclusion)[:\s]+(.{10,120}?)[.!?]/i,
    /\b(?:implement|build|create) (.{10,120}?)[.!?]/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { isDecision: true, snippet: (match[1] || text.slice(0, 120)).trim() };
    }
  }

  return { isDecision: false, snippet: "" };
}

/**
 * Detect open questions in text.
 *
 * @param {string} content
 * @returns {string[]}
 */
function detectOpenQuestions(content) {
  const text = String(content || "");
  const questions = [];
  const patterns = [
    /\b(?:still need(?:s)? to|remains to|yet to|haven['’]t|not sure|unsure|unclear|pending|outstanding|TBD|TODO)\b.{5,120}?[.!?]/gi,
    /\b(?:what|how|which|should we|can we|do we|is it|are we|does it|is there|are there)\b.{5,120}?\?/gi,
    /\b(?:question|unknown|unresolved|undetermined)[:\s]+(.{5,120}?)[.!?]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const q = (match[1] || match[0]).trim();
      if (q.length > 5 && !questions.includes(q)) {
        questions.push(q);
      }
    }
  }

  return questions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// ContextSummarizer
// ---------------------------------------------------------------------------

class ContextSummarizer {
  /**
   * @param {object} [options]
   * @param {number} [options.maxKeywords=20] — cap on keyword extraction
   * @param {number} [options.minKeywordLength=3] — minimum word length for keywords
   */
  constructor(options = {}) {
    this.maxKeywords =
      Number.isFinite(options.maxKeywords) && options.maxKeywords > 0
        ? options.maxKeywords
        : MAX_KEYWORDS;

    this.minKeywordLength =
      Number.isFinite(options.minKeywordLength) && options.minKeywordLength >= 2
        ? options.minKeywordLength
        : MIN_KEYWORD_LENGTH;
  }

  // -----------------------------------------------------------------------
  // summarizeContext(messages, level)
  // -----------------------------------------------------------------------

  /**
   * Summarize a conversation at the requested detail level.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} [level="STANDARD"] — BRIEF | STANDARD | DETAILED
   * @returns {object}
   *   - level: string
   *   - keyDecisions: string[]
   *   - currentTask: string
   *   - openQuestions: string[]
   *   - relevantFiles: string[]
   *   - summary: string — the composite summary text
   *   - messageCount: number
   */
  summarizeContext(messages, level = SummaryLevel.STANDARD) {
    const msgs = Array.isArray(messages) ? messages : [];

    if (msgs.length === 0) {
      return {
        level,
        keyDecisions: [],
        currentTask: "(no messages)",
        openQuestions: [],
        relevantFiles: [],
        summary: "(empty conversation)",
        messageCount: 0,
      };
    }

    switch (level) {
      case SummaryLevel.BRIEF:
        return this._summarizeBrief(msgs);
      case SummaryLevel.DETAILED:
        return this._summarizeDetailed(msgs);
      case SummaryLevel.STANDARD:
      default:
        return this._summarizeStandard(msgs);
    }
  }

  // -----------------------------------------------------------------------
  // createContextCard(messages)
  // -----------------------------------------------------------------------

  /**
   * Create a one-paragraph context summary (approximately 3-5 sentences)
   * suitable for a "context card" display.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {string}
   */
  createContextCard(messages) {
    const result = this.summarizeContext(messages, SummaryLevel.STANDARD);
    const parts = [];

    if (result.currentTask && result.currentTask !== "(no messages)") {
      parts.push(`Currently working on: ${result.currentTask}.`);
    }

    if (result.keyDecisions.length > 0) {
      const decisions = result.keyDecisions.slice(0, 3).join("; ");
      parts.push(`Key decisions: ${decisions}.`);
    }

    if (result.relevantFiles.length > 0) {
      const files = result.relevantFiles.slice(0, 5).join(", ");
      parts.push(`Relevant files: ${files}.`);
    }

    if (result.openQuestions.length > 0) {
      const questions = result.openQuestions.slice(0, 2).join(" ");
      parts.push(`Open questions: ${questions}`);
    }

    if (parts.length === 0) {
      parts.push(`Conversation with ${result.messageCount} messages.`);
    }

    return parts.join(" ");
  }

  // -----------------------------------------------------------------------
  // createContextBrief(messages)
  // -----------------------------------------------------------------------

  /**
   * Create an ultra-brief one-sentence summary.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {string}
   */
  createContextBrief(messages) {
    const result = this.summarizeContext(messages, SummaryLevel.BRIEF);
    return result.summary;
  }

  // -----------------------------------------------------------------------
  // createContextIndex(messages)
  // -----------------------------------------------------------------------

  /**
   * Create a keyword/topic index from the conversation.
   *
   * Each keyword is scored by frequency across the conversation weighted
   * by the role of the message (user and assistant content weighted higher
   * than system messages).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{ keyword: string, score: number, frequency: number }>}
   *   Sorted by score descending.
   */
  createContextIndex(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) return [];

    const freqMap = new Map();

    for (const msg of msgs) {
      const role = msg?.role || "unknown";
      const weight = role === "user" ? 1.5 : role === "assistant" ? 1.0 : 0.5;
      const content = String(msg?.content || "");
      const keywords = extractKeywords(content);

      for (const [keyword, count] of keywords) {
        const prev = freqMap.get(keyword) || { frequency: 0, score: 0 };
        prev.frequency += count;
        prev.score += count * weight;
        freqMap.set(keyword, prev);
      }
    }

    const entries = [];
    for (const [keyword, data] of freqMap) {
      entries.push({
        keyword,
        score: Math.round(data.score * 100) / 100,
        frequency: data.frequency,
      });
    }

    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, this.maxKeywords);
  }

  // -----------------------------------------------------------------------
  // injectSummary(messages, summary)
  // -----------------------------------------------------------------------

  /**
   * Inject a summary into a message list.  The summary is placed as a system
   * message at the front of the list, or appended to the first existing
   * system message.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {string|object} summary — summary text or a full summary object
   *   from summarizeContext()
   * @returns {Array<{role: string, content: string}>} New message list with
   *   summary injected.
   */
  injectSummary(messages, summary) {
    const msgs = Array.isArray(messages) ? [...messages] : [];
    const summaryText = this._formatSummaryForInjection(summary);

    if (!summaryText.trim()) {
      return msgs;
    }

    // Find the first system message and prepend the summary there.
    const systemIdx = msgs.findIndex((m) => m?.role === "system");

    if (systemIdx >= 0) {
      msgs[systemIdx] = {
        ...msgs[systemIdx],
        content: [
          "<context-summary>",
          summaryText,
          "</context-summary>",
          "",
          msgs[systemIdx].content || "",
        ].join("\n"),
      };
    } else {
      msgs.unshift({
        role: "system",
        content: [
          "<context-summary>",
          summaryText,
          "</context-summary>",
        ].join("\n"),
      });
    }

    return msgs;
  }

  // -----------------------------------------------------------------------
  // Private: summarization methods
  // -----------------------------------------------------------------------

  /**
   * Standard-level summary (3-5 sentences, covering all summary fields).
   * @private
   */
  _summarizeStandard(messages) {
    const keyDecisions = [];
    const allFiles = new Set();
    const openQuestions = [];
    let lastUserContent = "";
    let messageCount = messages.length;

    for (const msg of messages) {
      const content = String(msg?.content || "");
      const role = msg?.role || "unknown";

      // Extract files from all messages.
      for (const file of extractFiles(content)) {
        allFiles.add(file);
      }

      // Track last user message for current task detection.
      if (role === "user") {
        lastUserContent = content;
      }

      // Detect decisions in assistant messages.
      if (role === "assistant") {
        const { isDecision, snippet } = detectDecision(content);
        if (isDecision && snippet) {
          keyDecisions.push(snippet);
        }
      }

      // Collect open questions from all messages.
      const questions = detectOpenQuestions(content);
      for (const q of questions) {
        if (!openQuestions.includes(q)) openQuestions.push(q);
      }
    }

    // Deduplicate decisions by first-sentence similarity.
    const uniqueDecisions = [];
    for (const d of keyDecisions) {
      const exists = uniqueDecisions.some((existing) => {
        const wordsA = new Set(existing.toLowerCase().split(" "));
        const wordsB = new Set(d.toLowerCase().split(" "));
        let overlap = 0;
        for (const w of wordsA) {
          if (wordsB.has(w)) overlap += 1;
        }
        return overlap / Math.max(wordsA.size, 1) > 0.6;
      });
      if (!exists) uniqueDecisions.push(d);
    }

    const currentTask = lastUserContent
      ? firstSentence(lastUserContent)
      : "(no current task)";

    const summary = this._buildSummaryText(
      uniqueDecisions,
      currentTask,
      openQuestions.slice(0, 5),
      [...allFiles],
    );

    return {
      level: SummaryLevel.STANDARD,
      keyDecisions: uniqueDecisions,
      currentTask,
      openQuestions: openQuestions.slice(0, 5),
      relevantFiles: [...allFiles],
      summary,
      messageCount,
    };
  }

  /**
   * Brief-level summary (1-2 sentences).
   * @private
   */
  _summarizeBrief(messages) {
    const standard = this._summarizeStandard(messages);

    let summary = "";

    if (standard.currentTask && standard.currentTask !== "(no current task)") {
      summary = `Conversation about ${standard.currentTask.toLowerCase()}`;
      if (standard.keyDecisions.length > 0) {
        summary += ` — ${standard.keyDecisions[0]}.`;
      } else {
        summary += ".";
      }
    } else {
      summary = `Conversation with ${standard.messageCount} messages.`;
    }

    return {
      level: SummaryLevel.BRIEF,
      keyDecisions: standard.keyDecisions.slice(0, 2),
      currentTask: standard.currentTask,
      openQuestions: standard.openQuestions.slice(0, 2),
      relevantFiles: standard.relevantFiles.slice(0, 5),
      summary,
      messageCount: standard.messageCount,
    };
  }

  /**
   * Detailed-level summary (paragraph-level, all fields).
   * @private
   */
  _summarizeDetailed(messages) {
    const standard = this._summarizeStandard(messages);

    // Add per-message role breakdown.
    const roleCounts = new Map();
    let totalContentLength = 0;
    for (const msg of messages) {
      const role = msg?.role || "unknown";
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
      totalContentLength += String(msg?.content || "").length;
    }

    const roleSummary = [...roleCounts.entries()]
      .map(([role, count]) => `${role}:${count}`)
      .join(", ");

    const detailParts = [];
    detailParts.push(`[Total messages: ${standard.messageCount} | Roles: ${roleSummary}]`);

    if (standard.currentTask && standard.currentTask !== "(no current task)") {
      detailParts.push(`Current task: ${standard.currentTask}`);
    }

    if (standard.keyDecisions.length > 0) {
      detailParts.push("Key decisions:");
      for (const d of standard.keyDecisions) {
        detailParts.push(`  - ${d}`);
      }
    }

    if (standard.relevantFiles.length > 0) {
      detailParts.push(`Relevant files: ${standard.relevantFiles.join(", ")}`);
    }

    if (standard.openQuestions.length > 0) {
      detailParts.push("Open questions:");
      for (const q of standard.openQuestions) {
        detailParts.push(`  - ${q}`);
      }
    }

    const summary = detailParts.join("\n");

    return {
      level: SummaryLevel.DETAILED,
      keyDecisions: standard.keyDecisions,
      currentTask: standard.currentTask,
      openQuestions: standard.openQuestions,
      relevantFiles: standard.relevantFiles,
      summary,
      messageCount: standard.messageCount,
      roleBreakdown: Object.fromEntries(roleCounts),
    };
  }

  // -----------------------------------------------------------------------
  // Private: helpers
  // -----------------------------------------------------------------------

  /**
   * Build a composite summary text from the components.
   * @private
   */
  _buildSummaryText(decisions, currentTask, questions, files) {
    const parts = [];

    if (currentTask && currentTask !== "(no current task)") {
      parts.push(`Current task: ${currentTask}`);
    }

    if (decisions.length > 0) {
      const listed = decisions.slice(0, 3).map((d, i) => `  ${i + 1}. ${d}`).join("\n");
      parts.push(`Key decisions:\n${listed}`);
    }

    if (files.length > 0) {
      parts.push(`Relevant files: ${files.slice(0, 8).join(", ")}`);
    }

    if (questions.length > 0) {
      const listed = questions.map((q, i) => `  ${i + 1}. ${q}`).join("\n");
      parts.push(`Open questions:\n${listed}`);
    }

    return parts.join("\n\n") || "(no significant content)";
  }

  /**
   * Format a summary (string or object) for injection into a message list.
   * @private
   */
  _formatSummaryForInjection(summary) {
    if (typeof summary === "string") {
      return summary.trim();
    }

    if (summary && typeof summary === "object") {
      // If it's a summary object from summarizeContext, format it.
      if (summary.summary && typeof summary.summary === "string") {
        return summary.summary.trim();
      }

      const parts = [];
      if (summary.currentTask) {
        parts.push(`Task: ${summary.currentTask}`);
      }
      if (Array.isArray(summary.keyDecisions) && summary.keyDecisions.length > 0) {
        parts.push(`Decisions: ${summary.keyDecisions.join("; ")}`);
      }
      if (Array.isArray(summary.openQuestions) && summary.openQuestions.length > 0) {
        parts.push(`Open: ${summary.openQuestions.join("; ")}`);
      }
      if (Array.isArray(summary.relevantFiles) && summary.relevantFiles.length > 0) {
        parts.push(`Files: ${summary.relevantFiles.join(", ")}`);
      }
      return parts.join(" | ");
    }

    return String(summary || "").trim();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextSummarizer,
  SummaryLevel,
  extractFiles,
  extractKeywords,
  detectDecision,
  detectOpenQuestions,
};
