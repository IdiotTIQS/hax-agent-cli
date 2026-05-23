"use strict";

/**
 * ConversationClassifier — classify conversation types using feature extraction.
 *
 * Assigns each conversation to one of seven classification categories based on
 * aggregate feature analysis: message ratios, tool usage, question density,
 * code block frequency, turn length, and sentiment.
 *
 * Classification classes:
 *   TASK_ORIENTED  — goal-driven, directive-heavy, tool-intensive
 *   EXPLORATORY    — broad questions, varied topics, high question density
 *   EDUCATIONAL    — explanation requests, concept discussion, low code
 *   DEBUGGING      — error reports, diagnosis, fix attempts
 *   CREATIVE       — generation requests, ideation, positive sentiment
 *   ANALYTICAL     — data/code analysis, profiling, metrics discussion
 *   ADMINISTRATIVE — configuration, setup, deployment, project management
 */

// ── Classification definitions ─────────────────────────────────────────────

/**
 * Ordered list of classification classes with their feature profiles.
 * Order matters: first match with highest score wins (tie-break).
 * Each profile contains:
 *   - features: weight map for each feature axis
 *   - thresholds: optional hard minimums
 *   - description: human-readable label
 */
const CLASS_PROFILES = Object.freeze([
  {
    class: "TASK_ORIENTED",
    features: {
      directiveRatio: 1.0,        // high ratio of directive messages
      toolUsageRatio: 0.8,        // high tool usage
      codeBlockFrequency: 0.5,    // moderate code blocks
      questionDensity: -0.4,      // low question density (task, not Q&A)
      messageRatio_UserAssistant: 0.3, // balanced or user-heavy
      avgTurnLength: 0.3,         // moderate turn length
      sentimentScore: 0.1,        // slightly positive (productive)
    },
    thresholds: {
      minDirectiveRatio: 0.15,
    },
    description: "Goal-driven, task-focused conversation with directives and tool usage.",
  },
  {
    class: "EXPLORATORY",
    features: {
      questionDensity: 0.5,        // moderate question density
      topicDiversity: 0.5,         // many distinct topics (moderate weight)
      directiveRatio: -0.5,        // low directive ratio
      codeBlockFrequency: -0.3,    // low code blocks
      messageRatio_UserAssistant: 0.4, // user asks, assistant answers
      avgTurnLength: -0.2,         // shorter turns (Q&A style)
      sentimentScore: 0.2,         // neutral to slightly positive (curiosity)
      explanationRequestRatio: -0.3, // mild penalty for "explain" — education is different
    },
    thresholds: {
      minQuestionDensity: 0.3,
      minTopicDiversity: 0.4,
    },
    description: "Open-ended browsing across topics with high question density.",
  },
  {
    class: "EDUCATIONAL",
    features: {
      questionDensity: 0.6,        // moderate-high question density
      explanationRequestRatio: 1.0, // many "explain this" patterns — primary signal
      topicDiversity: -0.7,        // focused on one topic (penalize breadth vs EXPLORATORY)
      codeBlockFrequency: 0.2,     // some code but not primary
      directiveRatio: -0.6,        // very low directive count
      messageRatio_UserAssistant: 0.3, // user asks often
      avgTurnLength: 0.5,          // moderate to long assistant responses
      sentimentScore: 0.3,         // positive (learning)
    },
    thresholds: {
      minExplanationRatio: 0.15,
    },
    description: "Learning-oriented with explanation requests and concept discussion.",
  },
  {
    class: "DEBUGGING",
    features: {
      errorSignalScore: 1.0,       // strong error/crash/bug signals
      codeBlockFrequency: 0.6,     // code blocks for error reproduction
      toolUsageRatio: 0.7,         // investigation tools
      directiveRatio: 0.2,         // some directives (fix this)
      questionDensity: -0.2,       // moderate questions
      sentimentScore: -0.8,        // negative sentiment (frustration)
      messageRatio_UserAssistant: 0.2,
    },
    thresholds: {
      requiresErrorSignal: true,
    },
    description: "Bug investigation and resolution with error signals and negative sentiment.",
  },
  {
    class: "CREATIVE",
    features: {
      generationRequestRatio: 1.0, // "write", "generate", "create" patterns
      codeBlockFrequency: 0.7,     // output often includes code
      sentimentScore: 0.8,         // positive sentiment (creating)
      directiveRatio: 0.6,         // directive-heavy (do/make/create)
      questionDensity: -0.3,       // lower question density
      messageRatio_UserAssistant: -0.2, // assistant provides more
      avgTurnLength: 0.4,          // moderate to long outputs
    },
    thresholds: {
      minGenerationRatio: 0.1,
    },
    description: "Content generation — writing, creating, building things with positive sentiment.",
  },
  {
    class: "ANALYTICAL",
    features: {
      codeBlockFrequency: 0.8,     // high code blocks
      toolUsageRatio: 0.9,         // heavy tool use (analysis tools)
      questionDensity: 0.1,        // some questions
      directiveRatio: -0.1,        // fewer directives
      topicDiversity: -0.3,        // focused (deep dive on one topic)
      sentimentScore: 0.0,         // neutral (objective)
      avgTurnLength: 0.6,          // long messages (detailed analysis)
    },
    thresholds: {
      minCodeBlockCount: 2,
    },
    description: "Deep analysis of code, data, or systems with high tool usage.",
  },
  {
    class: "ADMINISTRATIVE",
    features: {
      setupConfigRatio: 1.0,       // setup/install/configure keywords
      directiveRatio: 0.4,         // some directives
      codeBlockFrequency: -0.2,    // lower code blocks
      questionDensity: 0.2,        // some questions
      sentimentScore: 0.1,         // neutral
      toolUsageRatio: 0.2,         // some tool usage
      messageRatio_UserAssistant: 0.3,
    },
    thresholds: {
      minSetupConfigRatio: 0.08,
    },
    description: "Project setup, configuration, deployment, and administrative tasks.",
  },
]);

// ── Feature extraction helpers ─────────────────────────────────────────────

/**
 * @param {string} content
 * @returns {number} number of questions
 */
function countQuestions(content) {
  if (typeof content !== "string") return 0;
  const explicit = (content.match(/\?/g) || []).length;
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
 * @param {string} content
 * @returns {number} number of code blocks
 */
function countCodeBlocks(content) {
  if (typeof content !== "string") return 0;
  const fenced = (content.match(/```/g) || []).length;
  return Math.floor(fenced / 2);
}

/**
 * Detect the sentiment of a single message.
 * @param {string} content
 * @returns {number} -1 (negative) to 1 (positive)
 */
function detectSentimentScore(content) {
  if (typeof content !== "string") return 0;
  const lower = content.toLowerCase();

  const positiveTerms = [
    "thanks", "great", "awesome", "perfect", "excellent", "good",
    "love", "helpful", "works", "solved", "fixed", "nice", "wow",
    "amazing", "fantastic", "brilliant", "thank you", "appreciate",
  ];
  const negativeTerms = [
    "wrong", "bad", "terrible", "broken", "hate", "useless",
    "doesn't work", "not working", "frustrated", "annoying",
    "stupid", "waste", "fails", "error", "bug", "crash",
    "sorry", "unfortunately", "unacceptable",
  ];

  let pos = 0;
  let neg = 0;
  for (const w of positiveTerms) {
    if (lower.includes(w)) pos++;
  }
  for (const w of negativeTerms) {
    if (lower.includes(w)) neg++;
  }

  const total = pos + neg;
  if (total === 0) return 0;
  // Scale: (pos - neg) / (pos + neg) gives range [-1, 1]
  return (pos - neg) / (pos + neg);
}

/**
 * Count directive messages (do/make/create/implement/etc.).
 * @param {string} content
 * @returns {number} 0 or 1 per message
 */
function isDirective(content) {
  if (typeof content !== "string") return 0;
  const lower = content.toLowerCase();
  return /\b(?:do|make|create|build|write|generate|implement|add|remove|delete|update|change|modify|run|execute|perform|produce)\b/i.test(lower) ? 1 : 0;
}

/**
 * Count tool usage references.
 * @param {string} content
 * @returns {number}
 */
function countToolReferences(content) {
  if (typeof content !== "string") return 0;
  const patterns = [
    /\b(?:tool|function|api call|invoke|execut(?:ed?|ing)|ran?)\b/gi,
    /\b(?:Read|Write|Edit|Grep|Glob|Bash|search|find)\b/g,
    /\b(?:using|use(d)?|via|through)\s+(?:the\s+)?(?:tool|function|api)\b/gi,
  ];
  let count = 0;
  for (const pat of patterns) {
    const matches = content.match(pat);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Check if content is an explanation request.
 * @param {string} content
 * @returns {number} 0 or 1
 */
function isExplanationRequest(content) {
  if (typeof content !== "string") return 0;
  const lower = content.toLowerCase();
  return /\b(?:explain|what does|how does|walk through|describe|what is|why is|elaborate|clarify|meaning of|understand)\b/i.test(lower) ? 1 : 0;
}

/**
 * Check if content is a generation request.
 * @param {string} content
 * @returns {number} 0 or 1
 */
function isGenerationRequest(content) {
  if (typeof content !== "string") return 0;
  const lower = content.toLowerCase();
  return /\b(?:write|generate|create|build|make|develop|craft|compose|produce|construct|design)\b/i.test(lower) ? 1 : 0;
}

/**
 * Check for setup/configuration keywords.
 * @param {string} content
 * @returns {number} 0 or 1
 */
function isSetupConfig(content) {
  if (typeof content !== "string") return 0;
  const lower = content.toLowerCase();
  return /\b(?:setup|install|configure|config|init|scaffold|bootstrap|deploy|publish|release|environment|env var|settings?|project init)\b/i.test(lower) ? 1 : 0;
}

/**
 * Estimate number of unique topics from messages.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
function countUniqueTopics(messages) {
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "have", "from",
    "its", "that", "with", "this", "will", "just", "like", "been",
    "some", "than", "then", "also", "very", "into", "more", "them",
    "such", "only", "over", "when", "what", "how", "where", "which",
    "there", "their", "about", "would", "could", "should",
    "your", "this", "want", "need",
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
  const unique = new Set(allWords);
  return Math.max(1, Math.round(unique.size / 10));
}

// ── Helper: normalize a conversation message ──────────────────────────────

/**
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
 * Normalize conversation messages to a consistent format.
 * @param {Array} messages
 * @returns {Array<{role: string, content: string}>}
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: toText(m ? m.content : undefined),
  }));
}

// ── ConversationClassifier class ───────────────────────────────────────────

class ConversationClassifier {
  /**
   * @param {object} [options]
   * @param {number} [options.minConfidence=0.25] — minimum confidence to return a classification
   * @param {number} [options.maxAlternatives=3] — maximum alternative classifications
   */
  constructor(options = {}) {
    this._minConfidence = typeof options.minConfidence === "number" ? options.minConfidence : 0.25;
    this._maxAlternatives = typeof options.maxAlternatives === "number" ? options.maxAlternatives : 3;

    /** @type {{ class: string, confidence: number }|null} */
    this._lastResult = null;
    /** @type {Array<{ class: string, confidence: number }>} */
    this._lastAlternatives = [];
    /** @type {object|null} */
    this._lastFeatures = null;
  }

  /**
   * Classify a conversation into one of the predefined types.
   *
   * @param {Array<{role: string, content: string}>} conversation — message array
   * @returns {{
   *   classification: string|null,
   *   confidence: number,
   *   features: object,
   *   reason: string
   * }}
   */
  classify(conversation) {
    const normalized = normalizeMessages(conversation);

    if (normalized.length === 0) {
      this._lastResult = null;
      this._lastAlternatives = [];
      this._lastFeatures = null;
      return {
        classification: null,
        confidence: 0,
        features: {},
        reason: "Empty conversation",
      };
    }

    // Extract feature vector
    const features = this._extractFeatures(normalized);
    this._lastFeatures = features;

    // Score each class profile
    const scored = CLASS_PROFILES.map((profile) => {
      const score = this._scoreProfile(features, profile);
      return { class: profile.class, score, description: profile.description };
    });

    // Check hard thresholds
    const eligible = scored.filter((s) => {
      const profile = CLASS_PROFILES.find((p) => p.class === s.class);
      if (!profile) return false;
      return this._checkThresholds(features, profile.thresholds);
    });

    // Sort by score descending
    eligible.sort((a, b) => b.score - a.score);

    // Store alternatives
    this._lastAlternatives = eligible.map((s) => ({
      class: s.class,
      confidence: Math.round(s.score * 100) / 100,
      description: s.description,
    }));

    // Pick best
    if (eligible.length === 0 || eligible[0].score < this._minConfidence) {
      this._lastResult = null;
      return {
        classification: null,
        confidence: 0,
        features,
        reason: eligible.length === 0
          ? "No classification meets thresholds"
          : "Confidence below minimum",
      };
    }

    const best = eligible[0];
    this._lastResult = { class: best.class, confidence: Math.round(best.score * 100) / 100 };

    return {
      classification: best.class,
      confidence: Math.round(best.score * 100) / 100,
      features,
      reason: best.description,
    };
  }

  /**
   * Return the confidence of the most recent classification.
   * @returns {number} 0–1
   */
  getConfidence() {
    return this._lastResult ? this._lastResult.confidence : 0;
  }

  /**
   * Return alternative classifications from the most recent classify() call.
   * @returns {Array<{ class: string, confidence: number, description: string }>}
   */
  getAlternatives() {
    return this._lastAlternatives.slice(0, this._maxAlternatives);
  }

  /**
   * Re-classify a conversation — useful when new messages have been added.
   * Internally calls classify() again with the updated conversation.
   *
   * @param {Array<{role: string, content: string}>} conversation — updated message array
   * @returns {{
   *   classification: string|null,
   *   confidence: number,
   *   features: object,
   *   reason: string,
   *   changed: boolean,
   *   previousClassification: string|null
   * }}
   */
  reclassify(conversation) {
    const previousClassification = this._lastResult ? this._lastResult.class : null;
    const previousFeatures = this._lastFeatures;

    const result = this.classify(conversation);
    const changed = result.classification !== previousClassification;

    // If confidence changed meaningfully, flag as changed
    const featuresChanged = previousFeatures
      ? JSON.stringify(result.features) !== JSON.stringify(previousFeatures)
      : true;

    return {
      ...result,
      changed: changed || featuresChanged,
      previousClassification,
    };
  }

  /**
   * Return the feature vector from the most recent classification.
   * @returns {object|null}
   */
  getFeatures() {
    return this._lastFeatures;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Extract a feature vector from normalized messages.
   * @param {Array<{role: string, content: string}>} messages
   * @returns {object}
   */
  _extractFeatures(messages) {
    const userMsgs = messages.filter((m) => m.role === "user");
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const totalMessages = messages.length;

    // Message ratio: value > 0 means user-heavy, < 0 means assistant-heavy, 0 = balanced
    const messageRatio_UserAssistant = totalMessages > 0
      ? (userMsgs.length - assistantMsgs.length) / totalMessages
      : 0;

    // Question density: questions per message
    let totalQuestions = 0;
    for (const msg of messages) {
      totalQuestions += countQuestions(msg.content);
    }
    const questionDensity = totalMessages > 0 ? totalQuestions / totalMessages : 0;

    // Directive ratio
    let directiveCount = 0;
    let explanationCount = 0;
    let generationCount = 0;
    let setupConfigCount = 0;
    let totalChars = 0;

    for (const msg of messages) {
      directiveCount += isDirective(msg.content);
      explanationCount += isExplanationRequest(msg.content);
      generationCount += isGenerationRequest(msg.content);
      setupConfigCount += isSetupConfig(msg.content);
      totalChars += msg.content.length;
    }
    const directiveRatio = totalMessages > 0 ? directiveCount / totalMessages : 0;
    const explanationRequestRatio = totalMessages > 0 ? explanationCount / totalMessages : 0;
    const generationRequestRatio = totalMessages > 0 ? generationCount / totalMessages : 0;
    const setupConfigRatio = totalMessages > 0 ? setupConfigCount / totalMessages : 0;

    // Code block frequency
    let totalCodeBlocks = 0;
    for (const msg of messages) {
      totalCodeBlocks += countCodeBlocks(msg.content);
    }
    const codeBlockFrequency = totalMessages > 0 ? totalCodeBlocks / totalMessages : 0;

    // Tool usage ratio
    let totalToolRefs = 0;
    for (const msg of messages) {
      totalToolRefs += countToolReferences(msg.content);
    }
    const toolUsageRatio = totalMessages > 0 ? Math.min(1, totalToolRefs / totalMessages) : 0;

    // Average turn length (normalized: 500 chars = 1.0)
    const avgTurnLength = totalMessages > 0
      ? Math.min(1, (totalChars / totalMessages) / 500)
      : 0;

    // Aggregate sentiment score across all messages
    let sentimentTotal = 0;
    for (const msg of messages) {
      sentimentTotal += detectSentimentScore(msg.content);
    }
    const sentimentScore = totalMessages > 0 ? sentimentTotal / totalMessages : 0;

    // Has error signal
    let hasErrorSignal = false;
    for (const msg of messages) {
      if (typeof msg.content === "string"
          && /\b(?:error|bug|crash|fail|exception|stack trace|not working|broken)\b/i.test(msg.content)) {
        hasErrorSignal = true;
        break;
      }
    }

    // Normalize error signal to a 0-1 score
    const errorSignalScore = hasErrorSignal ? 1 : 0;

    // Topic diversity (normalized to [0, 1] — raw count divided by 5 and clamped)
    const topicDiversity = Math.min(1, countUniqueTopics(messages) / 5);

    return {
      directiveRatio,
      toolUsageRatio,
      codeBlockFrequency,
      questionDensity,
      messageRatio_UserAssistant,
      avgTurnLength,
      sentimentScore,
      explanationRequestRatio,
      generationRequestRatio,
      setupConfigRatio,
      errorSignalScore,
      topicDiversity,
      totalMessages,
    };
  }

  /**
   * Score a class profile against a feature vector.
   * Uses dot product with normalization to produce a 0–1 score.
   * @param {object} features
   * @param {object} profile
   * @returns {number} 0–1 score
   */
  _scoreProfile(features, profile) {
    let dotProduct = 0;
    let weightSum = 0;

    for (const [feature, weight] of Object.entries(profile.features)) {
      if (typeof features[feature] !== "number") continue;

      // Some features need to be scaled to [0, 1] range
      let featureValue = features[feature];
      const absWeight = Math.abs(weight);
      weightSum += absWeight;

      // The feature value is already in [0,1] range for most features,
      // but some need clamping
      featureValue = Math.max(-1, Math.min(1, featureValue));

      // For negative weights, we want the feature to be LOW for a high score
      // Convert: if weight is negative and feature is low -> high contribution
      if (weight < 0) {
        // Invert: low feature value (near 0) gives high contribution
        dotProduct += (1 - Math.abs(featureValue)) * absWeight;
      } else {
        dotProduct += featureValue * weight;
      }
    }

    // Normalize to [0, 1]
    const normalizedScore = weightSum > 0 ? dotProduct / weightSum : 0;

    return Math.max(0, Math.min(1, normalizedScore));
  }

  /**
   * Check if a feature vector meets a profile's hard thresholds.
   * @param {object} features
   * @param {object} thresholds
   * @returns {boolean}
   */
  _checkThresholds(features, thresholds) {
    if (!thresholds) return true;

    if (typeof thresholds.minDirectiveRatio === "number"
        && features.directiveRatio < thresholds.minDirectiveRatio) return false;

    if (typeof thresholds.minQuestionDensity === "number"
        && features.questionDensity < thresholds.minQuestionDensity) return false;

    if (typeof thresholds.minTopicDiversity === "number"
        && features.topicDiversity < thresholds.minTopicDiversity) return false;

    if (typeof thresholds.minCodeBlockCount === "number"
        && features.codeBlockFrequency * features.totalMessages < thresholds.minCodeBlockCount) return false;

    if (typeof thresholds.minExplanationRatio === "number"
        && features.explanationRequestRatio < thresholds.minExplanationRatio) return false;

    if (typeof thresholds.minGenerationRatio === "number"
        && features.generationRequestRatio < thresholds.minGenerationRatio) return false;

    if (typeof thresholds.minSetupConfigRatio === "number"
        && features.setupConfigRatio < thresholds.minSetupConfigRatio) return false;

    if (thresholds.requiresErrorSignal === true && features.errorSignalScore < 1) return false;

    return true;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  ConversationClassifier,
  CLASS_PROFILES,
  _internals: {
    countQuestions,
    countCodeBlocks,
    detectSentimentScore,
    isDirective,
    countToolReferences,
    isExplanationRequest,
    isGenerationRequest,
    isSetupConfig,
    countUniqueTopics,
    toText,
    normalizeMessages,
  },
};
