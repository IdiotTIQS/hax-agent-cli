"use strict";

/**
 * @fileoverview Rule-based conversation summarization and key-point extraction.
 *
 * All extraction operates on an array of message objects
 * `{ role: string, content: string, timestamp?: string }`.
 * No LLM dependency — purely pattern, keyword, and structure driven.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DECISION_KEYWORDS = [
  "decided", "decision", "agree", "agreed", "finalize", "finalized",
  "conclusion", "concluded", "resolve", "resolved", "settled on",
  "we'll go with", "let's do", "going with", "will use",
  "approved", "confirmed", "locked in",
];

const ACTION_KEYWORDS = [
  "todo", "to-do", "action item", "follow up", "follow-up",
  "next step", "remaining", "pending", "need to", "needs to",
  "should do", "must do", "will do", "going to", "plan to",
  "assign", "assigned", "owner", "responsible", "due date",
  "deadline", "commit", "committed", "promise", "ensure",
];

const QUESTION_MARKERS = [
  "?", "how do", "what is", "why is", "where is", "when will",
  "can we", "could we", "should we", "is there", "are there",
  "do we", "does this", "will this", "would this",
  "not sure", "unclear", "don't know", "unknown", "need to check",
  "need to verify", "need to confirm",
];

const TOPIC_TRANSITION_PATTERNS = [
  /\b(?:next|now|also|additionally|separately|regarding|about|concerning)\b/i,
  /\b(?:moving on|switching gears|changing topic|another thing|one more)\b/i,
  /\b(?:let'?s (?:talk|discuss|move|switch|address|cover|handle|focus))\b/i,
  /\b(?:that reminds me|speaking of which|by the way|on a different note)\b/i,
];

const FILE_PATH_PATTERN = /`?([\w.\-/\\]+\.\w{1,6})`?/g;

const CONCLUDE_PATTERNS = [
  /(?:^|\n)(?:so |thus |therefore |in conclusion|to summarize|in summary|overall)/gim,
  /(?:^|\n)(?:the (?:result|outcome|conclusion|takeaway|upshot|bottom line))/gim,
];

/**
 * Normalize a message content value to a string.
 * @param {*} content
 * @returns {string}
 */
function toText(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(toText).join(" ");
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    return JSON.stringify(content);
  }
  return String(content);
}

/**
 * Normalize every message's content to a plain string (mutates shallow copy).
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{role: string, content: string, timestamp?: string}>}
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m, i) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: toText(m ? m.content : undefined),
    timestamp: (m && typeof m.timestamp === "string") ? m.timestamp : undefined,
    _index: i,
  }));
}

/**
 * Estimate token count for a string using characters-per-token heuristics.
 * @param {string} text
 * @param {number} [charsPerToken=4]
 * @returns {number}
 */
function estimateTokenCount(text, charsPerToken) {
  const rate = Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : 4;
  const t = toText(text);
  return Math.max(1, Math.ceil(t.length / rate));
}

/**
 * Score a line against a keyword list (case-insensitive).
 * @param {string} line
 * @param {string[]} keywords
 * @returns {number} Match count.
 */
function keywordScore(line, keywords) {
  const lower = line.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Group lines into semantic paragraphs by double-newline boundaries.
 * @param {string} text
 * @returns {string[]}
 */
function splitParagraphs(text) {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/**
 * Extract a concise snippet around a match position.
 * @param {string} text
 * @param {number} matchIndex
 * @param {number} [radius=120]
 * @returns {string}
 */
function snippetAround(text, matchIndex, radius) {
  const r = radius || 120;
  const start = Math.max(0, matchIndex - r);
  const end = Math.min(text.length, matchIndex + r);
  let snip = text.slice(start, end).trim();
  if (start > 0) snip = "…" + snip;
  if (end < text.length) snip = snip + "…";
  return snip;
}

// ---------------------------------------------------------------------------
// extractKeyPoints
// ---------------------------------------------------------------------------

/**
 * Extract key decisions, findings, and conclusions from a conversation.
 *
 * The algorithm walks every message looking for lines that:
 *  - Contain decision / conclusion keywords
 *  - Appear to state a finding or result
 *  - Match structural patterns (e.g. "The result was …")
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ point: string, confidence: "high"|"medium"|"low", sourceIndex: number, category: string }>}
 */
function extractKeyPoints(messages) {
  const normalized = normalizeMessages(messages);
  const points = [];

  for (const msg of normalized) {
    const text = msg.content;
    if (!text) continue;

    // Break into lines and paragraphs for structural analysis.
    const paragraphs = splitParagraphs(text);
    const lines = text.split(/\n/).filter((l) => l.trim().length > 0);

    for (const para of paragraphs) {
      const score = keywordScore(para, DECISION_KEYWORDS);
      if (score > 0) {
        points.push({
          point: para.trim().slice(0, 500),
          confidence: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
          sourceIndex: msg._index,
          category: "decision",
        });
      }
    }

    // Check for concluding patterns.
    for (const pattern of CONCLUDE_PATTERNS) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        const rest = text.slice(match.index + match[0].length);
        const sentenceEnd = Math.min(
          ...[...rest.matchAll(/[.!?]\s+/g)].map((m) => m.index + m[0].length).filter((i) => i > 0),
          rest.length,
        );
        const conclusion = rest.slice(0, sentenceEnd + 1).trim();
        if (conclusion.length > 15) {
          points.push({
            point: conclusion.slice(0, 500),
            confidence: "high",
            sourceIndex: msg._index,
            category: "conclusion",
          });
        }
      }
    }

    // Check for findings (lines starting with a bullet or pattern).
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(?:- |\* |\d+\. |[>▪✓✅❌])/.test(trimmed)) {
        const body = trimmed.replace(/^[-*\d.>▪✓✅❌]+\s*/, "");
        if (body.length >= 10 && body.length <= 500) {
          const decisionScore = keywordScore(body, DECISION_KEYWORDS);
          if (decisionScore > 0) continue; // Already captured as decision.
          points.push({
            point: body,
            confidence: "medium",
            sourceIndex: msg._index,
            category: "finding",
          });
        }
      }
    }
  }

  // Deduplicate points with near-identical text.
  const seen = new Set();
  return points.filter((p) => {
    const key = p.point.slice(0, 80).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// summarizeByTopic
// ---------------------------------------------------------------------------

/**
 * Group messages by detected topic boundaries and produce a summary for each
 * topic block.
 *
 * Topic boundaries are detected via:
 *  - Transition phrases (e.g. "moving on", "next, let's talk about")
 *  - Content similarity drops (Jaccard distance on significant words)
 *  - Role patterns (e.g. user asks a new type of question)
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ topic: string, messageCount: number, summary: string, keyPoints: string[] }>}
 */
function summarizeByTopic(messages) {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) return [];

  // Step 1 – detect topic boundaries.
  const boundaries = [0];
  for (let i = 1; i < normalized.length; i += 1) {
    const prevText = normalized[i - 1].content;
    const currText = normalized[i].content;

    // Transition phrase in current message.
    const hasTransition = TOPIC_TRANSITION_PATTERNS.some((p) => p.test(currText));

    // Significant Jaccard distance drop between adjacent messages.
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
  boundaries.push(normalized.length);

  // Step 2 – summarize each block.
  const results = [];
  for (let b = 0; b < boundaries.length - 1; b += 1) {
    const start = boundaries[b];
    const end = boundaries[b + 1];
    const block = normalized.slice(start, end);

    if (block.length === 0) continue;

    const topic = inferTopicName(block);
    const points = extractKeyPoints(block);
    const summary = buildBlockSummary(block, topic);

    results.push({
      topic,
      messageCount: block.length,
      summary,
      keyPoints: points.slice(0, 5).map((p) => p.point),
    });
  }

  return results;
}

/**
 * Extract "significant" words from text (length >= 3, not stop words).
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
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  // Return up to 50 unique significant words to keep performance bounded.
  return [...new Set(words)].slice(0, 50);
}

/**
 * Infer a human-readable topic name from a block of messages.
 * @param {Array} block
 * @returns {string}
 */
function inferTopicName(block) {
  if (block.length === 0) return "General";

  // Scan for explicit topic mentions.
  const userMessages = block.filter((m) => m.role === "user");
  for (const msg of userMessages) {
    const text = msg.content;
    const aboutMatch = text.match(/(?:about|regarding|concerning|re:)\s+([\w\s-]{5,40})/i);
    if (aboutMatch) return aboutMatch[1].trim();

    const letsMatch = text.match(/let'?s\s+(?:talk\s+about\s+|discuss\s+|address\s+|cover\s+|handle\s+)?([\w\s-]{5,40})/i);
    if (letsMatch) return letsMatch[1].trim();
  }

  // Fall back to significant words from the first user message.
  const firstUserMsg = userMessages[0] || block[0];
  const words = extractSignificantWords(firstUserMsg.content);
  return words.length >= 2 ? words.slice(0, 3).join(" ") : "General";
}

/**
 * Build a short summary string for a topic block.
 * @param {Array} block
 * @param {string} topic
 * @returns {string}
 */
function buildBlockSummary(block, topic) {
  const userMsgs = block.filter((m) => m.role === "user");
  const assistantMsgs = block.filter((m) => m.role === "assistant");
  const totalChars = block.reduce((sum, m) => sum + m.content.length, 0);

  // Collect key terms.
  const allWords = [];
  for (const m of block) {
    allWords.push(...extractSignificantWords(m.content));
  }

  const freq = {};
  for (const w of allWords) {
    freq[w] = (freq[w] || 0) + 1;
  }
  const topTerms = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((e) => e[0]);

  const parts = [];
  parts.push(`Discussion about ${topic}.`);
  parts.push(`${userMsgs.length} user queries, ${assistantMsgs.length} assistant responses.`);
  if (topTerms.length > 0) {
    parts.push(`Key terms: ${topTerms.join(", ")}.`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// generateTLDR
// ---------------------------------------------------------------------------

/**
 * Generate a 1-3 sentence TL;DR summary of the entire conversation.
 *
 * Uses:
 *  - First user message as the starting context.
 *  - Extracted key points for the middle.
 *  - Last assistant message for the outcome.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {string}
 */
function generateTLDR(messages) {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) return "No conversation to summarize.";

  // Get initial intent from first user message.
  const firstUser = normalized.find((m) => m.role === "user");
  const initialIntent = firstUser
    ? firstUser.content.slice(0, 200).replace(/\n/g, " ").trim()
    : "an unspecified task";

  // Get outcome from last significant response.
  const lastAssistant = [...normalized].reverse().find((m) => m.role === "assistant");
  const lastUser = [...normalized].reverse().find((m) => m.role === "user");
  const outcomeText = lastAssistant
    ? lastAssistant.content.slice(0, 200).replace(/\n/g, " ").trim()
    : (lastUser ? lastUser.content.slice(0, 200).replace(/\n/g, " ").trim() : "");

  // Count message dynamics.
  const userCount = normalized.filter((m) => m.role === "user").length;
  const assistantCount = normalized.filter((m) => m.role === "assistant").length;

  // Extract key points to enrich the summary.
  const keyPoints = extractKeyPoints(normalized);

  // Build TL;DR sentences.
  const sentences = [];

  // Sentence 1: What was discussed.
  sentences.push(
    `The conversation covers ${initialIntent.endsWith(".") ? initialIntent.slice(0, -1) : initialIntent}, spanning ${userCount} user messages and ${assistantCount} assistant responses.`,
  );

  // Sentence 2: Key findings / decisions (if any).
  if (keyPoints.length > 0) {
    const top = keyPoints.slice(0, 2).map((p) => p.point).join("; ");
    sentences.push(`Key points: ${top}.`);
  }

  // Sentence 3: Outcome / current state.
  if (outcomeText && outcomeText.length > 10) {
    const truncated = outcomeText.split(/[.!?] /)[0];
    sentences.push(`Latest status: ${truncated}.`);
  }

  return sentences.join(" ");
}

// ---------------------------------------------------------------------------
// extractActionItems
// ---------------------------------------------------------------------------

/**
 * Extract todos, commitments, and follow-up items from the conversation.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ action: string, assignee: string|null, sourceIndex: number, priority: "high"|"medium"|"low" }>}
 */
function extractActionItems(messages) {
  const normalized = normalizeMessages(messages);
  const items = [];

  const assigneePattern = /(?:@(\w+)|assigned\s+to\s+(\w+)|(\w+)\s+(?:will|should|must|needs?\s+to)\s+(?:handle|do|take|own|work\s+on))/i;

  for (const msg of normalized) {
    const text = msg.content;
    if (!text) continue;

    const paragraphs = splitParagraphs(text);
    const lines = text.split(/\n/).filter((l) => l.trim().length > 0);

    // Check each paragraph and line for action items.
    const candidates = [...paragraphs, ...lines];

    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed.length < 10) continue;

      // Skip if it looks like regular conversation.
      const score = keywordScore(trimmed, ACTION_KEYWORDS);
      if (score === 0) continue;

      // Look for bullet-style items.
      const isBullet = /^[-*]\s|^\d+\.\s/.test(trimmed);
      const isCheckbox = /^[-*]\s\[[ x]\]/.test(trimmed);
      const isExplicitTask = /^(?:todo|to-do|action|task|next|follow.?up)/i.test(trimmed);

      // Context-aware check: lines near "action items" section headers get
      // a lower threshold for inclusion.
      const isNearHeader = /action\s*(?:item|plan)s?:?\s*$/im.test(trimmed) ||
        /^(?:todo|to-do|next steps?)\s*:?\s*$/im.test(trimmed) ||
        /^(?:remaining|pending|outstanding):?\s*$/im.test(trimmed);

      if (isNearHeader) {
        // This is a section header; the actual items will be caught in
        // subsequent lines. Skip the header itself but signal context.
        continue;
      }

      let shouldInclude = false;
      let priority = "low";

      if (isBullet && score >= 1) {
        shouldInclude = true;
        priority = score >= 3 ? "high" : score >= 2 ? "medium" : "low";
      } else if (isExplicitTask || score >= 2) {
        shouldInclude = true;
        priority = score >= 3 ? "high" : "medium";
      }

      if (!shouldInclude) continue;

      // Clean the text to get a clean action description.
      let actionText = trimmed
        .replace(/^[-*\d.]+\s*/, "")
        .replace(/^\[[ x]\]\s*/, "")
        .replace(/^(?:todo|to-do|action|task|next|follow.?up)\s*:?\s*/i, "")
        .slice(0, 300);

      // Extract assignee.
      let assignee = null;
      const aMatch = actionText.match(assigneePattern);
      if (aMatch) {
        assignee = aMatch[1] || aMatch[2] || aMatch[3] || null;
      }

      items.push({
        action: actionText,
        assignee,
        sourceIndex: msg._index,
        priority,
      });
    }
  }

  // Deduplicate near-identical items.
  const seen = new Set();
  return items.filter((item) => {
    const key = item.action.slice(0, 60).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// extractDecisions
// ---------------------------------------------------------------------------

/**
 * Extract decisions made during the conversation and their rationale when
 * detectable.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ decision: string, rationale: string|null, sourceIndex: number, confidence: "high"|"medium"|"low" }>}
 */
function extractDecisions(messages) {
  const normalized = normalizeMessages(messages);
  const decisions = [];

  for (const msg of normalized) {
    const text = msg.content;
    if (!text) continue;

    const paragraphs = splitParagraphs(text);

    for (let i = 0; i < paragraphs.length; i += 1) {
      const para = paragraphs[i];
      const score = keywordScore(para, DECISION_KEYWORDS);
      if (score === 0) continue;

      // Check for rationale in adjacent paragraphs (before or after).
      let rationale = null;
      if (i > 0) {
        const prev = paragraphs[i - 1];
        if (/\b(?:because|since|reason|due to|rationale|justification|why)\b/i.test(prev)) {
          rationale = prev.slice(0, 300).trim();
        }
      }
      if (!rationale && i < paragraphs.length - 1) {
        const next = paragraphs[i + 1];
        if (/\b(?:because|since|reason|due to|rationale|justification|why)\b/i.test(next)) {
          rationale = next.slice(0, 300).trim();
        }
      }

      // Try to extract the decision sentence itself.
      const sentences = para.split(/(?<=[.!?])\s+/);
      const decisionSentence = sentences
        .find((s) => keywordScore(s, DECISION_KEYWORDS) > 0) || para;

      decisions.push({
        decision: decisionSentence.trim().slice(0, 500),
        rationale,
        sourceIndex: msg._index,
        confidence: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
      });
    }
  }

  // Deduplicate.
  const seen = new Set();
  return decisions.filter((d) => {
    const key = d.decision.slice(0, 60).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// extractQuestions
// ---------------------------------------------------------------------------

/**
 * Find questions that remain unanswered in the conversation.
 *
 * A question is "unanswered" if:
 *  - It appears in a user message, and
 *  - No subsequent assistant message acknowledges or addresses it.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ question: string, askerIndex: number, confidence: "high"|"medium"|"low" }>}
 */
function extractQuestions(messages) {
  const normalized = normalizeMessages(messages);
  const unanswered = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const msg = normalized[i];
    if (msg.role !== "user") continue;

    const text = msg.content;
    const questions = extractQuestionSentences(text);
    if (questions.length === 0) continue;

    // For each question, check if it was answered later in the conversation.
    for (const q of questions) {
      const answered = isQuestionAnswered(q, normalized, i);
      if (!answered) {
        // Determine confidence. High: explicit question mark, medium: keyword-based.
        const isExplicit = q.includes("?");
        unanswered.push({
          question: q.slice(0, 300).trim(),
          askerIndex: i,
          confidence: isExplicit ? "high" : "medium",
        });
      }
    }
  }

  return unanswered;
}

/**
 * Extract individual question sentences from a block of text.
 * @param {string} text
 * @returns {string[]}
 */
function extractQuestionSentences(text) {
  const questions = [];

  // Find explicit question sentences (ending with ?).
  const qRegex = /[^.!?\n]+\?/g;
  let match;
  while ((match = qRegex.exec(text)) !== null) {
    questions.push(match[0].trim());
  }

  // Also find implicit questions by keyword patterns.
  const implicitPatterns = [
    /(?:I|we)\s+(?:need to|have to|must|should)\s+(?:know|find|check|verify|confirm|figure out|understand|determine)\s+([^.!?\n]+)/gi,
    /(?:it'?s|that'?s|this\s+is)\s+(?:unclear|unknown|not clear|ambiguous)\s+(?:whether|if|how|what|why|when|where)\s+([^.!?\n]+)/gi,
    /(?:I|we)\s+(?:don'?t know|am not sure|are not sure|have no idea)\s+(?:if|whether|how|what|why|when|where|who)\s+([^.!?\n]+)/gi,
    /can\s+(?:you|we|I)\s+(?:check|verify|confirm|clarify|explain|tell me)\s+([^.!?\n]+\?)/gi,
  ];

  for (const pattern of implicitPatterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const q = m[0].trim();
      if (q.length > 10 && !questions.some((existing) => existing.includes(q.slice(0, 30)))) {
        questions.push(q);
      }
    }
  }

  return questions;
}

/**
 * Heuristically determine if a question was answered later in the conversation.
 * @param {string} question
 * @param {Array} normalized
 * @param {number} askerIndex
 * @returns {boolean}
 */
function isQuestionAnswered(question, normalized, askerIndex) {
  // Extract key terms from the question.
  const qTerms = extractSignificantWords(question);

  if (qTerms.length === 0) return false;

  // Check subsequent assistant messages for content overlap.
  for (let j = askerIndex + 1; j < normalized.length; j += 1) {
    if (normalized[j].role !== "assistant") continue;

    const responseText = normalized[j].content;
    const overlapCount = qTerms.filter((term) =>
      responseText.toLowerCase().includes(term),
    ).length;

    // Check for direct answer signals.
    const hasAnswerSignal = /\b(?:yes|no|correct|that'?s right|here'?s|the answer|to answer)\b/i.test(responseText);
    const hasCodeOrList = /```|^[-*]\s|^\d+\.\s/m.test(responseText);

    // If there's a high term overlap and it looks responsive, consider answered.
    if (overlapCount >= Math.max(1, Math.floor(qTerms.length * 0.4))) {
      if (hasAnswerSignal || hasCodeOrList || responseText.length > 100) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  extractKeyPoints,
  summarizeByTopic,
  generateTLDR,
  extractActionItems,
  extractDecisions,
  extractQuestions,
  // Helpers exported for testing.
  _internals: {
    normalizeMessages,
    toText,
    estimateTokenCount,
    keywordScore,
    splitParagraphs,
    extractSignificantWords,
    extractQuestionSentences,
    isQuestionAnswered,
    inferTopicName,
    buildBlockSummary,
  },
};
