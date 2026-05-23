"use strict";

// ---------------------------------------------------------------------------
// Scoring weights (sum to 1.0 across the factors that contribute)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  DECISION_CONTENT: 0.22,
  ERROR_CONTENT: 0.18,
  RECENCY: 0.18,
  UNIQUENESS: 0.14,
  REFERENCED_LATER: 0.13,
  USER_EXPLICIT: 0.15,
};

const CRITICAL_THRESHOLD = 0.55;
const EXPENDABLE_THRESHOLD = 0.25;

const MIN_UNIQUE_WORD_LENGTH = 3;
const MAX_SIMILARITY_SAMPLE = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text for comparison: lowercase, strip punctuation, collapse
 * whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract meaningful words from text (min length 3).
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractWords(text) {
  return normalizeText(text)
    .split(" ")
    .filter((w) => w.length >= MIN_UNIQUE_WORD_LENGTH);
}

/**
 * Compute Jaccard-like overlap between two word sets.  0 = no overlap,
 * 1 = identical.
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
function wordSetOverlap(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap += 1;
  }
  const union = setA.size + setB.size - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Detect decision-related language in message content.
 *
 * @param {string} content
 * @returns {boolean}
 */
function hasDecisionLanguage(content) {
  const text = String(content || "").toLowerCase();
  const patterns = [
    /\bdecided?\b/,
    /\bdecision\b/,
    /\bchose\b/,
    /\bselected\b/,
    /\bfinal(?:ly)?\b/,
    /\bconfirmed\b/,
    /\bagreed?\b/,
    /\bplan\b.*\bis\b/,
    /\bwill (?:now |)implement\b/,
    /\bgo with\b/,
    /\blet['’]s\b/,
    /\bapproach\b.*\bwill be\b/,
    /\bwe['’]ll\b/,
    /\bconclusion\b/,
    /\b[sS]tart(?:ing)?\b/,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Detect error-related language in message content.
 *
 * @param {string} content
 * @returns {boolean}
 */
function hasErrorLanguage(content) {
  const text = String(content || "").toLowerCase();
  const patterns = [
    /\berror\b/,
    /\bbug\b/,
    /\bfailed?\b/,
    /\bfailure\b/,
    /\bcrash(?:ed|ing)?\b/,
    /\bexception\b/,
    /\bstack\s?trace\b/,
    /\bundefined\b/,
    /\bnull\b.*\breference\b/,
    /\btype\s?error\b/,
    /\b[sS]yntax\s?error\b/,
    /\bfix\b/,
    /\bbroken\b/,
    /\bdoesn['’]t work\b/,
    /\bnot working\b/,
    /\bunexpected\b/,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Detect explicit importance markers from the user.
 *
 * @param {string} content
 * @returns {boolean}
 */
function hasUserExplicitImportance(content) {
  const text = String(content || "").toLowerCase();
  const patterns = [
    /\bimportant\b/,
    /\bcritical\b/,
    /\bessential\b/,
    /\bkey\b/,
    /\bremember\b/,
    /\bnote\b.*\bthis\b/,
    /\bdon['’]t forget\b/,
    /\bnote well\b/,
    /\bplease note\b/,
    /\bthis is (?:very |extremely |)important\b/,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Check whether later messages refer back to this message's content.
 *
 * Strategy: look at up to MAX_SIMILARITY_SAMPLE subsequent messages and
 * compute word overlap.  High overlap suggests the content was referenced.
 *
 * @param {number} msgIndex
 * @param {Array<{content: string}>} conversation
 * @param {Set<string>} msgWords
 * @returns {number} 0-1 score
 */
function referencedLaterScore(msgIndex, conversation, msgWords) {
  if (msgWords.size === 0) return 0;
  const end = Math.min(conversation.length, msgIndex + 1 + MAX_SIMILARITY_SAMPLE);
  let bestOverlap = 0;

  for (let i = msgIndex + 1; i < end; i += 1) {
    const laterMsg = conversation[i];
    const laterContent = typeof laterMsg === "string"
      ? laterMsg
      : String(laterMsg?.content || "");
    const laterWords = new Set(extractWords(laterContent));
    const overlap = wordSetOverlap(msgWords, laterWords);
    if (overlap > bestOverlap) bestOverlap = overlap;
  }

  return bestOverlap;
}

/**
 * Compute uniqueness: how different is this message's content from
 * surrounding messages?  Lower similarity = higher uniqueness.
 *
 * @param {number} msgIndex
 * @param {Array<{content: string}>} conversation
 * @param {Set<string>} msgWords
 * @returns {number} 0-1 where 1 = completely unique
 */
function uniquenessScore(msgIndex, conversation, msgWords) {
  if (msgWords.size === 0) return 0;
  if (conversation.length <= 1) return 1;

  // Compare against the immediate neighbor (previous message).
  if (msgIndex > 0) {
    const prevContent = String(conversation[msgIndex - 1]?.content || "");
    const prevWords = new Set(extractWords(prevContent));
    const similarity = wordSetOverlap(msgWords, prevWords);
    return 1 - similarity;
  }

  // If it's the first message, compare against the next one.
  if (conversation.length > 1) {
    const nextContent = String(conversation[msgIndex + 1]?.content || "");
    const nextWords = new Set(extractWords(nextContent));
    const similarity = wordSetOverlap(msgWords, nextWords);
    return 1 - similarity;
  }

  return 1;
}

/**
 * Compute recency score based on position in the conversation.
 * More recent messages score higher.
 *
 * @param {number} msgIndex
 * @param {number} totalMessages
 * @returns {number} 0-1
 */
function recencyScore(msgIndex, totalMessages) {
  if (totalMessages <= 1) return 1;
  // Linear scale: last message = 1.0, first message = 0.0
  return msgIndex / Math.max(1, totalMessages - 1);
}

// ---------------------------------------------------------------------------
// ImportanceScorer
// ---------------------------------------------------------------------------

class ImportanceScorer {
  /**
   * @param {object} [options]
   * @param {number} [options.criticalThreshold=0.55] — score >= this = critical
   * @param {number} [options.expendableThreshold=0.25] — score < this = expendable
   * @param {object} [options.weights] — custom scoring weights
   */
  constructor(options = {}) {
    this.criticalThreshold =
      Number.isFinite(options.criticalThreshold) && options.criticalThreshold > 0
        ? options.criticalThreshold
        : CRITICAL_THRESHOLD;

    this.expendableThreshold =
      Number.isFinite(options.expendableThreshold) && options.expendableThreshold > 0
        ? options.expendableThreshold
        : EXPENDABLE_THRESHOLD;

    this.weights = { ...WEIGHTS, ...(options.weights || {}) };
  }

  // -----------------------------------------------------------------------
  // score(message, conversation)
  // -----------------------------------------------------------------------

  /**
   * Score a single message's importance (0-1) within the context of a
   * conversation.
   *
   * Factors considered:
   *   - Decision content: does the message state a decision?
   *   - Error content: does the message describe an error or bug?
   *   - Recency: how recent is the message?
   *   - Uniqueness: how different is it from surrounding messages?
   *   - Referenced later: does subsequent content refer back to it?
   *   - User explicit: does the user mark this as important?
   *
   * @param {{role: string, content: string}} message
   * @param {Array<{role: string, content: string}>} conversation
   *   Full conversation (oldest-first). Used for context-aware scoring.
   * @returns {number} Score between 0 and 1.
   */
  score(message, conversation = []) {
    const content = String(message?.content || "");
    if (!content.trim()) return 0;

    const msgs = Array.isArray(conversation) ? conversation : [];
    const msgIndex = msgs.indexOf(message);
    const effectiveIndex = msgIndex >= 0 ? msgIndex : msgs.length;
    const total = Math.max(msgs.length, effectiveIndex + 1);
    const msgWords = new Set(extractWords(content));

    const w = this.weights;

    const decisionScore = hasDecisionLanguage(content) ? 1 : 0;
    const errorScore = hasErrorLanguage(content) ? 1 : 0;
    const recency = recencyScore(effectiveIndex, total);
    const uniqueness = uniquenessScore(effectiveIndex, msgs, msgWords);
    const referenced = referencedLaterScore(effectiveIndex, msgs, msgWords);
    const userExplicit = hasUserExplicitImportance(content) ? 1 : 0;

    return Math.min(1, Math.max(0,
      decisionScore * w.DECISION_CONTENT +
      errorScore * w.ERROR_CONTENT +
      recency * w.RECENCY +
      uniqueness * w.UNIQUENESS +
      referenced * w.REFERENCED_LATER +
      userExplicit * w.USER_EXPLICIT,
    ));
  }

  // -----------------------------------------------------------------------
  // scoreBatch(messages)
  // -----------------------------------------------------------------------

  /**
   * Score and rank all messages in a conversation.  Each message is scored
   * in the context of the full list.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{ message: object, index: number, score: number }>}
   *   Sorted by score descending.
   */
  scoreBatch(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) return [];

    const results = msgs.map((message, index) => ({
      message,
      index,
      score: this.score(message, msgs),
    }));

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // -----------------------------------------------------------------------
  // identifyCritical(messages)
  // -----------------------------------------------------------------------

  /**
   * Identify messages that must be kept (score >= criticalThreshold).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{role: string, content: string}>} Critical messages
   *   in their original order.
   */
  identifyCritical(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    return msgs.filter((message) => this.score(message, msgs) >= this.criticalThreshold);
  }

  // -----------------------------------------------------------------------
  // identifyExpendable(messages)
  // -----------------------------------------------------------------------

  /**
   * Identify messages that can safely be dropped (score < expendableThreshold).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{role: string, content: string}>} Expendable messages
   *   in their original order.
   */
  identifyExpendable(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    return msgs.filter((message) => this.score(message, msgs) < this.expendableThreshold);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ImportanceScorer,
  CRITICAL_THRESHOLD,
  EXPENDABLE_THRESHOLD,
  WEIGHTS,
  hasDecisionLanguage,
  hasErrorLanguage,
  hasUserExplicitImportance,
  recencyScore,
  uniquenessScore,
  referencedLaterScore,
};
