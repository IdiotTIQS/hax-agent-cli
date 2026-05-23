"use strict";

/**
 * PatternMatcher — conversation pattern detection and prediction.
 *
 * Detects recurring interaction patterns in conversations by matching
 * sequences of message types, roles, and content signals against
 * predefined pattern templates. Supports partial matching for
 * in-progress conversations and pattern completion prediction.
 *
 * Pattern types:
 *   Q&A         — question → answer → follow-up cycles
 *   debugging   — error report → investigation → resolution
 *   codeReview  — code presentation → review → iteration
 *   refactoring — restructuring discussion → plan → execution
 *   onboarding  — orientation → setup guidance → confirmation
 *   exploration — open-ended browsing → discovery → synthesis
 *   planning    — requirements → design → breakdown
 *   crisis      — urgent problem → rapid triage → mitigation
 */

// ── Message type detection helpers ─────────────────────────────────────────

/**
 * Classify a single message into a semantic type.
 * @param {{ role: string, content: string }} message
 * @returns {string} message type label
 */
function classifyMessageType(message) {
  const role = (message && message.role) ? message.role.toLowerCase() : "unknown";
  const content = typeof message.content === "string" ? message.content : "";
  const lower = content.toLowerCase();

  if (role === "system") return "system";

  if (role === "user") {
    // Specialized types — checked first regardless of question pattern
    if (/\b(?:error|bug|crash|fail|broken|not working|exception|stack trace)\b/i.test(lower)) {
      return "error_report";
    }
    if (/\b(?:explain|what does|how does|walk through|meaning|understand)\b/i.test(lower)) {
      return "explanation_request";
    }
    if (/\b(?:review|check|audit|inspect|assess)\b/i.test(lower)) {
      return "review_request";
    }
    if (/\b(?:fix|debug|solve|resolve|troubleshoot)\b/i.test(lower)) {
      return "fix_request";
    }
    if (/\b(?:refactor|restructure|clean up|reorganize|simplify)\b/i.test(lower)) {
      return "refactor_request";
    }
    if (/\b(?:plan|design|architect|structure|blueprint|roadmap)\b/i.test(lower)) {
      return "planning_request";
    }
    if (/\b(?:new|setup|install|start|begin|init|scaffold|bootstrap|create project)\b/i.test(lower)) {
      return "onboarding_request";
    }
    // Code / file sharing
    if (/```[\s\S]*```/.test(content) || /\b(?:here'?s|this is|take a look|see (?:the|this)|check (?:out|this))\b/i.test(lower)) {
      return "code_share";
    }
    // General question patterns
    if (/\?$/.test(content.trim()) || /^(?:what|how|why|when|where|who|can you|could you|is it|are there)/i.test(lower)) {
      return "question";
    }
    // General directives
    if (/\b(?:do|make|create|build|write|generate|implement|add|remove|delete|update|change|modify|run|execute)\b/i.test(lower)) {
      return "directive";
    }
    // Follow-up / acknowledgment
    if (/\b(?:yes|no|ok|okay|thanks|thank you|got it|understood|makes sense|that works|perfect|great|awesome)\b/i.test(lower)
        && content.trim().length < 120) {
      return "acknowledgment";
    }
    return "message";
  }

  if (role === "assistant") {
    if (/```[\s\S]*```/.test(content)) {
      return "code_response";
    }
    if (/\b(?:error|exception|bug|issue|problem)\b/i.test(lower)
        && /\b(?:found|identified|located|caused by|root cause|trace)\b/i.test(lower)) {
      return "diagnosis";
    }
    if (/\b(?:here'?s|this is|I'?ve|I have|created|built|generated|implemented|added|wrote)\b/i.test(lower)) {
      return "delivery";
    }
    if (/\b(?:let me|I'?ll|I will|going to|plan to|first|next|then|finally)\b/i.test(lower)
        && /\b(?:check|look|investigate|review|analyze|examine|search|find)\b/i.test(lower)) {
      return "investigation_plan";
    }
    if (/\b(?:in summary|to summarize|overall|the key|the main|conclusion|takeaway)\b/i.test(lower)) {
      return "summary";
    }
    if (/\b(?:would you like|should I|do you want|let me know|what would you|how would you)\b/i.test(lower)) {
      return "clarification";
    }
    return "response";
  }

  if (role === "tool") return "tool_result";
  return "unknown";
}

/**
 * Check if a message content exhibits urgency/crisis signals.
 * @param {string} content
 * @returns {boolean}
 */
function hasCrisisSignal(content) {
  const lower = content.toLowerCase();
  const urgencyTerms = [
    "urgent", "emergency", "critical", "asap", "immediately",
    "down", "outage", "broken", "crashing", "on fire",
    "production down", "data loss", "security breach", "hacked",
    "deadline is", "needed yesterday", "blocking", "blocker",
    "customer facing", "p0", "p1", "sev 0", "sev 1",
  ];
  return urgencyTerms.some((t) => lower.includes(t));
}

/**
 * Estimate the emotional tone of message content.
 * @param {string} content
 * @returns {"positive"|"negative"|"neutral"}
 */
function detectSentiment(content) {
  const lower = content.toLowerCase();
  const positive = [
    "thanks", "great", "awesome", "perfect", "excellent", "good",
    "love", "helpful", "works", "solved", "fixed", "nice", "wow",
    "amazing", "fantastic", "brilliant",
  ];
  const negative = [
    "wrong", "bad", "terrible", "broken", "hate", "useless",
    "doesn't work", "not working", "frustrated", "annoying",
    "stupid", "waste", "fails", "error", "bug", "crash",
  ];
  let pos = 0;
  let neg = 0;
  for (const w of positive) {
    if (lower.includes(w)) pos++;
  }
  for (const w of negative) {
    if (lower.includes(w)) neg++;
  }

  if (pos > neg + 1) return "positive";
  if (neg > pos + 1) return "negative";
  return "neutral";
}

/**
 * Count code blocks (triple-backtick or indented) in content.
 * @param {string} content
 * @returns {number}
 */
function countCodeBlocks(content) {
  const fenced = (content.match(/```/g) || []).length;
  // Each pair of triple backticks = 1 block
  return Math.floor(fenced / 2);
}

/**
 * Count the number of questions in content.
 * @param {string} content
 * @returns {number}
 */
function countQuestions(content) {
  // Explicit question marks
  const explicit = (content.match(/\?/g) || []).length;
  // Implicit questions
  const implicitPatterns = [
    /\b(?:what|how|why|when|where|who|which|can you|could you|would you|is it|are there|do you|does it)\b/gi,
  ];
  let implicit = 0;
  for (const pat of implicitPatterns) {
    const matches = content.match(pat);
    if (matches) implicit += matches.length;
  }
  return explicit + implicit;
}

/**
 * Count tool usage references in content.
 * @param {string} content
 * @returns {number}
 */
function countToolReferences(content) {
  const patterns = [
    /\b(?:tool|function|api call|invoke|execute|run)\b/gi,
    /\b(?:read|write|edit|search|find|grep|glob|bash|run|execute)\b/gi,
  ];
  let count = 0;
  for (const pat of patterns) {
    const matches = content.match(pat);
    if (matches) count += matches.length;
  }
  return count;
}

// ── Built-in pattern definitions ───────────────────────────────────────────

/**
 * Default pattern library covering the eight pattern types.
 * Each pattern has:
 *   - sequence: array of expected message type tokens (order matters)
 *   - conditions: extra constraints (e.g., minMessages, maxMessages, etc.)
 *   - confidence: base confidence 0–1
 *   - expectedDuration: rough estimate in minutes
 */
const DEFAULT_PATTERNS = Object.freeze({
  Q_A: {
    sequence: ["question", "response", "question", "response"],
    conditions: {
      minMessages: 2,
      minQuestionDensity: 0.3,
      maxSentimentSkew: 0.5,
      allowOutOfOrder: true,
    },
    confidence: 0.85,
    expectedDuration: 5,
    description: "Question and answer exchange — user asks, assistant answers, with follow-ups.",
  },
  debugging: {
    sequence: ["error_report", "investigation_plan", "diagnosis", "fix_request", "code_response"],
    conditions: {
      minMessages: 3,
      requireErrorSignal: true,
      maxPositiveSentiment: 0.3,
      allowOutOfOrder: true,
    },
    confidence: 0.9,
    expectedDuration: 15,
    description: "Debugging workflow — error report, investigation, diagnosis, and resolution.",
  },
  codeReview: {
    sequence: ["code_share", "review_request", "response", "code_response", "acknowledgment"],
    conditions: {
      minMessages: 3,
      requireCodeBlocks: true,
      minCodeBlockCount: 1,
      allowOutOfOrder: true,
    },
    confidence: 0.85,
    expectedDuration: 10,
    description: "Code review cycle — sharing code, reviewing, iterating on feedback.",
  },
  refactoring: {
    sequence: ["refactor_request", "response", "planning_request", "code_response", "acknowledgment"],
    conditions: {
      minMessages: 3,
      requireRefactorKeywords: true,
      minCodeBlockCount: 1,
      allowOutOfOrder: true,
    },
    confidence: 0.8,
    expectedDuration: 20,
    description: "Refactoring session — request to restructure, plan, and implement changes.",
  },
  onboarding: {
    sequence: ["onboarding_request", "response", "question", "response", "acknowledgment"],
    conditions: {
      minMessages: 2,
      requireSetupKeywords: true,
      allowOutOfOrder: true,
    },
    confidence: 0.8,
    expectedDuration: 10,
    description: "Onboarding / orientation — getting started, setting up, initial guidance.",
  },
  exploration: {
    sequence: ["question", "response", "question", "response", "question"],
    conditions: {
      minMessages: 3,
      minQuestionDensity: 0.4,
      minUniqueTopics: 2,
      maxDirectiveRatio: 0.2,
      allowOutOfOrder: true,
    },
    confidence: 0.75,
    expectedDuration: 12,
    description: "Exploratory conversation — user browses topics, asks varied questions.",
  },
  planning: {
    sequence: ["planning_request", "response", "clarification", "response", "summary"],
    conditions: {
      minMessages: 3,
      requirePlanningKeywords: true,
      allowOutOfOrder: true,
    },
    confidence: 0.8,
    expectedDuration: 15,
    description: "Planning session — discussing requirements, architecture, and breakdown.",
  },
  crisis: {
    sequence: ["error_report", "investigation_plan", "diagnosis", "code_response"],
    conditions: {
      minMessages: 2,
      requireCrisisSignal: true,
      maxPositiveSentiment: 0.2,
      allowOutOfOrder: false,
    },
    confidence: 0.9,
    expectedDuration: 5,
    description: "Crisis / urgent issue — rapid problem report, triage, and mitigation.",
  },
});

// ── Sequence matching helpers ──────────────────────────────────────────────

/**
 * Compute the longest common subsequence (LCS) length between two arrays.
 * @param {Array} a
 * @param {Array} b
 * @returns {number}
 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  // Use two-row DP for memory efficiency
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Compute sequence similarity as a ratio 0–1.
 * For ordered matches: use LCS / maxLen.
 * For out-of-order matches: use Jaccard similarity on type sets.
 * @param {string[]} actual — actual message type sequence
 * @param {string[]} expected — pattern's expected sequence
 * @param {boolean} allowOutOfOrder
 * @returns {number} 0–1 similarity score
 */
function sequenceSimilarity(actual, expected, allowOutOfOrder) {
  if (expected.length === 0) return 0;
  if (actual.length === 0) return 0;

  if (allowOutOfOrder) {
    // Jaccard similarity on type presence
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const intersection = [...expectedSet].filter((t) => actualSet.has(t)).length;
    const union = new Set([...actual, ...expected]).size;
    return union > 0 ? intersection / union : 0;
  }

  // Ordered LCS-based similarity
  const lcs = lcsLength(actual, expected);
  return lcs / Math.max(actual.length, expected.length);
}

/**
 * Extract unique topic words from a conversation to estimate topic diversity.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number} estimated number of unique topics
 */
function countUniqueTopics(messages) {
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "have", "from",
    "its", "that", "with", "this", "will", "just", "like", "been",
    "some", "than", "then", "also", "very", "into", "more", "them",
    "such", "only", "over", "when", "what", "how", "where", "which",
    "there", "their", "about", "would", "could", "should",
  ]);

  const allWords = [];
  for (const msg of messages) {
    const text = typeof msg.content === "string" ? msg.content : "";
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));
    allWords.push(...words);
  }

  // Use unique significant words as a proxy for topic count
  const unique = new Set(allWords);
  // Scale: roughly 10 unique words ~ 1 topic
  return Math.max(1, Math.round(unique.size / 10));
}

// ── PatternMatcher class ───────────────────────────────────────────────────

class PatternMatcher {
  /**
   * @param {object} [options]
   * @param {object} [options.patterns] — custom pattern definitions to merge with defaults
   * @param {number} [options.minConfidence=0.4] — minimum confidence to report a match
   * @param {number} [options.maxAlternatives=5] — maximum alternatives to return
   */
  constructor(options = {}) {
    this._minConfidence = typeof options.minConfidence === "number" ? options.minConfidence : 0.4;
    this._maxAlternatives = typeof options.maxAlternatives === "number" ? options.maxAlternatives : 5;
    this._patterns = {};

    // Load default patterns
    for (const [name, def] of Object.entries(DEFAULT_PATTERNS)) {
      this._patterns[name] = { ...def, conditions: { ...def.conditions } };
    }

    // Merge custom patterns
    if (options.patterns) {
      for (const [name, def] of Object.entries(options.patterns)) {
        this._patterns[name] = {
          sequence: Array.isArray(def.sequence) ? [...def.sequence] : [],
          conditions: { ...(def.conditions || {}) },
          confidence: typeof def.confidence === "number" ? def.confidence : 0.5,
          expectedDuration: typeof def.expectedDuration === "number" ? def.expectedDuration : 10,
          description: typeof def.description === "string" ? def.description : "",
        };
      }
    }

    // Active pattern tracking (for in-progress conversations)
    this._activePatterns = new Map();
  }

  /**
   * Define a new pattern or override an existing one.
   * @param {string} name — unique pattern name
   * @param {object} pattern
   * @param {string[]} pattern.sequence — ordered message type tokens
   * @param {object} [pattern.conditions] — additional constraints
   * @param {number} [pattern.confidence=0.5] — base confidence 0–1
   * @param {number} [pattern.expectedDuration=10] — expected minutes
   * @param {string} [pattern.description=""] — human-readable description
   * @returns {this}
   */
  define(name, pattern) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("Pattern name must be a non-empty string");
    }
    if (!pattern || typeof pattern !== "object") {
      throw new TypeError("Pattern definition must be an object");
    }
    if (!Array.isArray(pattern.sequence) || pattern.sequence.length === 0) {
      throw new TypeError("Pattern must have a non-empty sequence array");
    }

    this._patterns[name] = {
      sequence: [...pattern.sequence],
      conditions: Object.assign({}, pattern.conditions || {}),
      confidence: typeof pattern.confidence === "number" ? pattern.confidence : 0.5,
      expectedDuration: typeof pattern.expectedDuration === "number" ? pattern.expectedDuration : 10,
      description: typeof pattern.description === "string" ? pattern.description : "",
    };

    return this;
  }

  /**
   * Find all patterns that match the conversation.
   *
   * @param {Array<{role: string, content: string}>} conversation — message array
   * @returns {Array<{
   *   pattern: string,
   *   confidence: number,
   *   coverage: number,
   *   matchedSegments: Array<{start: number, end: number}>,
   *   description: string,
   *   expectedDuration: number
   * }>} matches sorted by confidence descending
   */
  match(conversation) {
    if (!Array.isArray(conversation) || conversation.length === 0) {
      // Reset active patterns for empty conversations
      this._activePatterns.clear();
      return [];
    }

    // Classify message types
    const typeSequence = conversation.map((m) => classifyMessageType(m));

    // Compute aggregate features
    const features = this._computeFeatures(conversation, typeSequence);

    const results = [];

    for (const [name, pattern] of Object.entries(this._patterns)) {
      const conditions = pattern.conditions || {};

      // Check minimum message count
      if (conditions.minMessages && conversation.length < conditions.minMessages) {
        continue;
      }

      // Check condition flags
      if (conditions.requireCrisisSignal && !features.hasCrisisSignal) {
        // Track as partial if the sequence partially matches
        const sim = sequenceSimilarity(typeSequence, pattern.sequence, true);
        if (sim >= 0.3) {
          this._activePatterns.set(name, { sim, featureCount: features.totalMessages });
        }
        continue;
      }
      if (conditions.requireErrorSignal && !features.hasErrorSignal) continue;
      if (conditions.requireCodeBlocks && !features.hasCodeBlocks) continue;
      if (conditions.requireRefactorKeywords && !features.hasRefactorKeywords) continue;
      if (conditions.requirePlanningKeywords && !features.hasPlanningKeywords) continue;
      if (conditions.requireSetupKeywords && !features.hasSetupKeywords) continue;

      // Check quantitative conditions
      if (typeof conditions.minCodeBlockCount === "number"
          && features.codeBlockCount < conditions.minCodeBlockCount) continue;
      if (typeof conditions.minQuestionDensity === "number"
          && features.questionDensity < conditions.minQuestionDensity) continue;
      if (typeof conditions.maxPositiveSentiment === "number"
          && features.positiveSentimentRatio > conditions.maxPositiveSentiment) continue;
      if (typeof conditions.maxSentimentSkew === "number"
          && Math.abs(features.positiveSentimentRatio - features.negativeSentimentRatio) > conditions.maxSentimentSkew) continue;
      if (typeof conditions.minUniqueTopics === "number"
          && features.uniqueTopics < conditions.minUniqueTopics) continue;
      if (typeof conditions.maxDirectiveRatio === "number"
          && features.directiveRatio > conditions.maxDirectiveRatio) continue;

      // Compute sequence similarity
      const allowOutOfOrder = conditions.allowOutOfOrder !== false;
      const sim = sequenceSimilarity(typeSequence, pattern.sequence, allowOutOfOrder);

      // Compute confidence
      const coverage = Math.min(1, typeSequence.length / Math.max(pattern.sequence.length, 1));
      let confidence = pattern.confidence * sim * coverage;

      // Bonus for exact sequential matches
      if (!allowOutOfOrder && sim >= 0.9) {
        confidence = Math.min(1, confidence * 1.15);
      }

      // Penalty for very short conversations relative to pattern
      if (typeSequence.length < pattern.sequence.length * 0.5) {
        confidence *= 0.7;
      }

      if (confidence >= this._minConfidence) {
        // Find matched segment ranges
        const segments = this._findMatchedSegments(typeSequence, pattern.sequence, allowOutOfOrder);

        results.push({
          pattern: name,
          confidence: Math.round(confidence * 100) / 100,
          coverage: Math.round(coverage * 100) / 100,
          matchedSegments: segments,
          description: pattern.description,
          expectedDuration: pattern.expectedDuration,
        });

        // Track as active if confidence is substantial
        if (confidence >= 0.3) {
          this._activePatterns.set(name, { sim, featureCount: features.totalMessages });
        }
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    // Limit alternatives
    return results.slice(0, this._maxAlternatives);
  }

  /**
   * Return patterns that are currently active (partially matched).
   * @returns {Array<{ pattern: string, similarity: number, messageCount: number }>}
   */
  getActivePatterns() {
    const active = [];
    for (const [name, info] of this._activePatterns) {
      const pattern = this._patterns[name];
      if (!pattern) continue;
      active.push({
        pattern: name,
        similarity: Math.round(info.sim * 100) / 100,
        messageCount: info.featureCount,
        description: pattern.description,
      });
    }
    return active.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Predict the next likely pattern the conversation will follow.
   *
   * Uses the current active partial matches and the conversation state
   * to estimate which pattern is most likely to complete next.
   *
   * @param {Array<{role: string, content: string}>} conversation — message array
   * @returns {Array<{
   *   pattern: string,
   *   probability: number,
   *   nextExpectedType: string|null,
   *   remainingSteps: number,
   *   description: string
   * }>} predictions sorted by probability descending
   */
  predictNext(conversation) {
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return [];
    }

    const typeSequence = conversation.map((m) => classifyMessageType(m));
    const predictions = [];

    for (const [name, pattern] of Object.entries(this._patterns)) {
      const conditions = pattern.conditions || {};
      const allowOutOfOrder = conditions.allowOutOfOrder !== false;

      // Compute how much of this pattern's sequence is already matched
      const sim = sequenceSimilarity(typeSequence, pattern.sequence, allowOutOfOrder);

      if (sim < 0.2) continue;

      // Find the next expected message type
      let nextExpectedType = null;
      let remainingSteps = pattern.sequence.length;

      if (allowOutOfOrder) {
        // For out-of-order: find types in pattern not yet seen
        const seenTypes = new Set(typeSequence);
        const missing = pattern.sequence.filter((t) => !seenTypes.has(t));
        nextExpectedType = missing.length > 0 ? missing[0] : null;
        remainingSteps = missing.length;
      } else {
        // For ordered: find last matched position
        const lcs = this._getLCS(typeSequence, pattern.sequence);
        const lastMatchIndex = lcs.length > 0
          ? pattern.sequence.indexOf(lcs[lcs.length - 1])
          : -1;
        if (lastMatchIndex >= 0 && lastMatchIndex < pattern.sequence.length - 1) {
          nextExpectedType = pattern.sequence[lastMatchIndex + 1];
          remainingSteps = pattern.sequence.length - lastMatchIndex - 1;
        } else if (lastMatchIndex < 0) {
          nextExpectedType = pattern.sequence[0];
          remainingSteps = pattern.sequence.length;
        } else {
          remainingSteps = 0;
        }
      }

      // Probability based on current match similarity
      const coverage = Math.min(1, typeSequence.length / Math.max(pattern.sequence.length, 1));
      let probability = sim * coverage;

      // Adjust based on recency — if the last message type matches expected
      if (nextExpectedType && typeSequence.length > 0) {
        const lastType = typeSequence[typeSequence.length - 1];
        if (allowOutOfOrder && pattern.sequence.includes(lastType)) {
          probability *= 1.1;
        }
      }

      // Check condition compatibility for prediction boost
      const features = this._computeFeatures(conversation, typeSequence);
      let conditionBonus = 0;

      if (conditions.requireCrisisSignal && features.hasCrisisSignal) conditionBonus += 0.2;
      if (conditions.requireErrorSignal && features.hasErrorSignal) conditionBonus += 0.15;
      if (conditions.requireCodeBlocks && features.hasCodeBlocks) conditionBonus += 0.1;
      if (conditions.requireRefactorKeywords && features.hasRefactorKeywords) conditionBonus += 0.1;
      if (conditions.requirePlanningKeywords && features.hasPlanningKeywords) conditionBonus += 0.1;
      if (conditions.requireSetupKeywords && features.hasSetupKeywords) conditionBonus += 0.1;

      probability = Math.min(1, probability + conditionBonus);

      predictions.push({
        pattern: name,
        probability: Math.round(probability * 100) / 100,
        nextExpectedType,
        remainingSteps,
        description: pattern.description,
      });
    }

    predictions.sort((a, b) => b.probability - a.probability);
    return predictions.slice(0, this._maxAlternatives);
  }

  /**
   * Clear all active pattern state.
   * @returns {this}
   */
  reset() {
    this._activePatterns.clear();
    return this;
  }

  /**
   * Return all registered pattern names.
   * @returns {string[]}
   */
  getPatternNames() {
    return Object.keys(this._patterns);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Get the LCS array (not just length).
   * @param {Array} a
   * @param {Array} b
   * @returns {Array} the actual common subsequence
   */
  _getLCS(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to get actual sequence
    const result = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return result;
  }

  /**
   * Find contiguous segments in the conversation that match pattern tokens.
   * @param {string[]} typeSeq
   * @param {string[]} patternSeq
   * @param {boolean} allowOutOfOrder
   * @returns {Array<{start: number, end: number}>}
   */
  _findMatchedSegments(typeSeq, patternSeq, allowOutOfOrder) {
    const segments = [];
    let start = -1;

    for (let i = 0; i < typeSeq.length; i++) {
      const matched = allowOutOfOrder
        ? patternSeq.includes(typeSeq[i])
        : (i < patternSeq.length && typeSeq[i] === patternSeq[i]);

      if (matched && start === -1) {
        start = i;
      } else if (!matched && start !== -1) {
        segments.push({ start, end: i - 1 });
        start = -1;
      }
    }
    if (start !== -1) {
      segments.push({ start, end: typeSeq.length - 1 });
    }

    return segments;
  }

  /**
   * Compute aggregate features from a conversation and its type sequence.
   * @param {Array} conversation
   * @param {string[]} typeSequence
   * @returns {object}
   */
  _computeFeatures(conversation, typeSequence) {
    let questionCount = 0;
    let codeBlockCount = 0;
    let toolRefCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;
    let totalChars = 0;
    let crisisDetected = false;
    let hasErrorSignal = false;
    let hasCodeBlocks = false;
    let hasRefactorKeywords = false;
    let hasPlanningKeywords = false;
    let hasSetupKeywords = false;
    let directiveCount = 0;

    for (const msg of conversation) {
      const content = typeof msg.content === "string" ? msg.content : "";
      const lower = content.toLowerCase();

      questionCount += countQuestions(content);
      const cb = countCodeBlocks(content);
      codeBlockCount += cb;
      if (cb > 0) hasCodeBlocks = true;
      toolRefCount += countToolReferences(content);
      totalChars += content.length;

      const sentiment = detectSentiment(content);
      if (sentiment === "positive") positiveCount++;
      else if (sentiment === "negative") negativeCount++;
      else neutralCount++;

      if (hasCrisisSignal(content)) crisisDetected = true;
      if (/\b(?:err(?:or|ors)?|bug(?:s)?|crash(?:es|ed|ing)?|fail(?:s|ed|ing|ure)?|exception(?:s)?|stack trace)\b/i.test(lower)) hasErrorSignal = true;
      if (/\b(?:refactor|restructure|clean up|reorganize|simplify|extract|modularize)\b/i.test(lower)) hasRefactorKeywords = true;
      if (/\b(?:plan|design|architect|structure|blueprint|roadmap|milestone)\b/i.test(lower)) hasPlanningKeywords = true;
      if (/\b(?:setup|install|start|begin|init|scaffold|bootstrap|getting started|new project|configure|create project)\b/i.test(lower)) hasSetupKeywords = true;
      if (typeSequence[conversation.indexOf(msg)] === "directive") directiveCount++;
    }

    const totalMessages = conversation.length;
    const questionDensity = totalMessages > 0 ? questionCount / totalMessages : 0;
    const totalSentiment = positiveCount + negativeCount + neutralCount || 1;
    const positiveSentimentRatio = positiveCount / totalSentiment;
    const negativeSentimentRatio = negativeCount / totalSentiment;
    const directiveRatio = totalMessages > 0 ? directiveCount / totalMessages : 0;
    const avgMessageLength = totalMessages > 0 ? totalChars / totalMessages : 0;
    const uniqueTopics = countUniqueTopics(conversation);

    return {
      totalMessages,
      questionCount,
      codeBlockCount,
      toolRefCount,
      questionDensity,
      positiveSentimentRatio,
      negativeSentimentRatio,
      hasCrisisSignal: crisisDetected,
      hasErrorSignal,
      hasCodeBlocks,
      hasRefactorKeywords,
      hasPlanningKeywords,
      hasSetupKeywords,
      avgMessageLength,
      directiveRatio,
      uniqueTopics,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  PatternMatcher,
  classifyMessageType,
  DEFAULT_PATTERNS,
  _internals: {
    sequenceSimilarity,
    detectSentiment,
    countCodeBlocks,
    countQuestions,
    countToolReferences,
    hasCrisisSignal,
    countUniqueTopics,
  },
};
