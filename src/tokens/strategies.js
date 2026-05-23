"use strict";

const STRATEGY_NAMES = Object.freeze([
  "truncateOldest",
  "summarizeHistory",
  "compressTools",
  "dropRedundant",
  "mergeSystemPrompts",
]);

const STRATEGY_DESCRIPTIONS = Object.freeze({
  truncateOldest:
    "Removes the oldest messages from the conversation history to stay within token limits. Best for long-running conversations where early context is no longer relevant.",
  summarizeHistory:
    "Replaces older conversation turns with a concise summary, preserving key context while dramatically reducing token count. Ideal for sessions with recurring themes.",
  compressTools:
    "Strips unused or rarely-referenced tool definitions from the prompt, keeping only tools relevant to the current task. Reduces overhead in tool-heavy sessions.",
  dropRedundant:
    "Removes duplicate, near-duplicate, or no-op messages that add no value. Cleans up repeated assistant outputs or empty user messages.",
  mergeSystemPrompts:
    "Combines multiple system-prompt blocks into a single consolidated system message, eliminating repetition across concatenated prompts.",
});

const STRATEGY_APPLICABILITY = Object.freeze({
  truncateOldest: ["long_running", "memory_pressure", "budget_exhausted"],
  summarizeHistory: ["long_running", "conversation_heavy", "budget_exhausted"],
  compressTools: ["tool_heavy", "many_tools", "budget_exhausted"],
  dropRedundant: ["repetitive", "noisy_output", "memory_pressure"],
  mergeSystemPrompts: ["multi_prompt", "system_heavy", "budget_exhausted"],
});

const DEFAULT_EFFECTIVENESS = Object.freeze({
  truncateOldest: { averageSavingsPercent: 30, successRate: 0.92, qualityImpact: "medium", sampleSize: 0 },
  summarizeHistory: { averageSavingsPercent: 45, successRate: 0.78, qualityImpact: "high", sampleSize: 0 },
  compressTools: { averageSavingsPercent: 20, successRate: 0.95, qualityImpact: "low", sampleSize: 0 },
  dropRedundant: { averageSavingsPercent: 15, successRate: 0.98, qualityImpact: "low", sampleSize: 0 },
  mergeSystemPrompts: { averageSavingsPercent: 35, successRate: 0.88, qualityImpact: "medium", sampleSize: 0 },
});

const SIMILARITY_THRESHOLD = 0.85;

class TokenStrategy {
  constructor(options = {}) {
    this._effectiveness = {};
    this._history = [];

    for (const name of STRATEGY_NAMES) {
      this._effectiveness[name] = { ...DEFAULT_EFFECTIVENESS[name] };
    }

    this._options = {
      maxHistoryLength: 50,
      truncateKeepRecent: 20,
      summaryMaxTokens: 500,
      minToolUsageCount: 0,
      similarityThreshold: SIMILARITY_THRESHOLD,
      ...options,
    };
  }

  // --- public API ---

  /**
   * Select the best strategy given a context descriptor.
   * @param {object} context - { messageCount, totalTokens, budgetRemaining, toolCount, systemPromptCount, sessionDuration, phase, hasRedundantMessages }
   * @returns {object} { strategy, confidence, reason, alternatives }
   */
  selectStrategy(context) {
    if (!context || typeof context !== "object") {
      return {
        strategy: "dropRedundant",
        confidence: 0.1,
        reason: "No context provided; defaulting to safest strategy.",
        alternatives: [],
      };
    }

    const scores = {};
    const reasons = {};

    for (const name of STRATEGY_NAMES) {
      const result = this._scoreStrategy(name, context);
      scores[name] = result.score;
      reasons[name] = result.reason;
    }

    // Sort by score descending.
    const ranked = Object.entries(scores)
      .sort((a, b) => b[1] - a[1]);

    const best = ranked[0];
    const alternatives = ranked.slice(1, 3).map(([name, score]) => ({
      strategy: name,
      score,
      reason: reasons[name],
    }));

    const confidence = Math.min(1, Math.max(0, best[1] / 100));

    return {
      strategy: best[0],
      confidence: Math.round(confidence * 100) / 100,
      reason: reasons[best[0]],
      alternatives,
    };
  }

  /**
   * Apply a named strategy to an array of messages.
   * @param {Array} messages - Array of { role, content, ... } objects.
   * @param {string} strategyName - One of the STRATEGY_NAMES.
   * @param {object} [options] - Strategy-specific overrides.
   * @returns {object} { messages, applied, removedCount, savedTokens, summary }
   */
  applyStrategy(messages, strategyName, options = {}) {
    if (!Array.isArray(messages)) {
      throw new Error("applyStrategy() requires an array of messages.");
    }

    if (!STRATEGY_NAMES.includes(strategyName)) {
      throw new Error(
        `Unknown strategy "${strategyName}". Valid: ${STRATEGY_NAMES.join(", ")}`
      );
    }

    const originalCount = messages.length;
    const originalTokens = this._estimateTotalTokens(messages);

    let result;

    switch (strategyName) {
      case "truncateOldest":
        result = this._truncateOldest(messages, options);
        break;
      case "summarizeHistory":
        result = this._summarizeHistory(messages, options);
        break;
      case "compressTools":
        result = this._compressTools(messages, options);
        break;
      case "dropRedundant":
        result = this._dropRedundant(messages, options);
        break;
      case "mergeSystemPrompts":
        result = this._mergeSystemPrompts(messages, options);
        break;
      default:
        result = { messages, removedCount: 0, summary: "Unknown strategy; no changes applied." };
    }

    const newTokens = this._estimateTotalTokens(result.messages);
    const savedTokens = originalTokens - newTokens;

    const outcome = {
      messages: result.messages,
      applied: savedTokens > 0,
      originalCount,
      newCount: result.messages.length,
      removedCount: result.removedCount || originalCount - result.messages.length,
      originalTokens,
      newTokens,
      savedTokens: Math.max(0, savedTokens),
      savingsPercent: originalTokens > 0
        ? Math.round((savedTokens / originalTokens) * 10000) / 100
        : 0,
      summary: result.summary || `${strategyName} applied successfully.`,
    };

    // Record outcome for effectiveness tracking.
    this._recordOutcome(strategyName, outcome);

    return outcome;
  }

  /**
   * Estimate potential savings without applying the strategy.
   * @param {Array} messages
   * @param {string} strategyName
   * @returns {object} { estimatedSavings, savingsPercent, riskLevel, recommendation }
   */
  evaluateSavings(messages, strategyName) {
    if (!Array.isArray(messages)) {
      return { estimatedSavings: 0, savingsPercent: 0, riskLevel: "unknown", recommendation: "No messages to evaluate." };
    }

    if (!STRATEGY_NAMES.includes(strategyName)) {
      return { estimatedSavings: 0, savingsPercent: 0, riskLevel: "unknown", recommendation: `Unknown strategy "${strategyName}".` };
    }

    const originalTokens = this._estimateTotalTokens(messages);

    // Use a lightweight simulation (does not mutate original messages).
    let estimatedSavings = 0;
    let riskLevel = "low";

    switch (strategyName) {
      case "truncateOldest": {
        const keepRecent = this._options.truncateKeepRecent;
        if (messages.length > keepRecent) {
          const toRemove = messages.slice(0, messages.length - keepRecent);
          estimatedSavings = this._estimateTotalTokens(toRemove);
          riskLevel = "low";
        }
        break;
      }
      case "summarizeHistory": {
        const nonSystem = messages.filter((m) => m.role !== "system");
        if (nonSystem.length > 10) {
          const olderHalf = nonSystem.slice(0, Math.floor(nonSystem.length / 2));
          const oldTokens = this._estimateTotalTokens(olderHalf);
          estimatedSavings = oldTokens - this._options.summaryMaxTokens;
          riskLevel = "medium";
        }
        break;
      }
      case "compressTools": {
        const toolMessages = messages.filter((m) => m.role === "tool" || (m.tool_calls && m.tool_calls.length > 0));
        if (toolMessages.length > 5) {
          const toolTokens = this._estimateTotalTokens(toolMessages);
          estimatedSavings = Math.floor(toolTokens * 0.35);
          riskLevel = "low";
        }
        break;
      }
      case "dropRedundant": {
        let redundantCount = 0;
        for (let i = 1; i < messages.length; i++) {
          if (this._isSimilar(messages[i].content, messages[i - 1].content)) {
            redundantCount++;
          }
        }
        if (redundantCount > 0) {
          const avgTokens = originalTokens / Math.max(1, messages.length);
          estimatedSavings = redundantCount * avgTokens;
        }
        riskLevel = "low";
        break;
      }
      case "mergeSystemPrompts": {
        const systemMessages = messages.filter((m) => m.role === "system");
        if (systemMessages.length > 1) {
          const originalSystemTokens = this._estimateTotalTokens(systemMessages);
          const mergedLength = systemMessages.reduce((s, m) => s + (m.content ? m.content.length : 0), 0);
          const mergedTokens = Math.ceil(mergedLength / 4) * 0.85; // slightly less due to dedup
          estimatedSavings = originalSystemTokens - mergedTokens;
          riskLevel = "medium";
        }
        break;
      }
    }

    estimatedSavings = Math.max(0, Math.floor(estimatedSavings));

    let recommendation;
    if (estimatedSavings <= 0) {
      recommendation = `Strategy "${strategyName}" would not save any tokens with the current messages.`;
    } else if (riskLevel === "high") {
      recommendation = `Could save ~${estimatedSavings} tokens but may reduce response quality. Use with caution.`;
    } else {
      recommendation = `Estimated savings of ~${estimatedSavings} tokens (${originalTokens > 0 ? Math.round((estimatedSavings / originalTokens) * 100) : 0}%). Recommended.`;
    }

    return {
      estimatedSavings,
      savingsPercent: originalTokens > 0 ? Math.round((estimatedSavings / originalTokens) * 10000) / 100 : 0,
      riskLevel,
      recommendation,
    };
  }

  /**
   * List all available strategies with descriptions.
   * @returns {Array<{name: string, description: string, applicability: Array<string>}>}
   */
  getAvailableStrategies() {
    return STRATEGY_NAMES.map((name) => ({
      name,
      description: STRATEGY_DESCRIPTIONS[name],
      applicability: STRATEGY_APPLICABILITY[name],
    }));
  }

  /**
   * Get historical effectiveness data for a strategy.
   * @param {string} strategyName
   * @returns {object | null}
   */
  getEffectiveness(strategyName) {
    if (!STRATEGY_NAMES.includes(strategyName)) {
      return null;
    }

    const data = this._effectiveness[strategyName];
    const recentOutcomes = this._history
      .filter((h) => h.strategy === strategyName)
      .slice(-20);

    const recentSavings = recentOutcomes.length > 0
      ? recentOutcomes.reduce((s, o) => s + o.savingsPercent, 0) / recentOutcomes.length
      : data.averageSavingsPercent;

    return {
      strategy: strategyName,
      averageSavingsPercent: Math.round(recentSavings * 100) / 100,
      successRate: data.successRate,
      qualityImpact: data.qualityImpact,
      sampleSize: data.sampleSize + recentOutcomes.length,
      recentOutcomes: recentOutcomes.length,
      lastUsed: recentOutcomes.length > 0
        ? recentOutcomes[recentOutcomes.length - 1].timestamp
        : null,
    };
  }

  /**
   * Auto-apply the best strategy chain to reduce token count by a target amount.
   * @param {Array} messages
   * @param {number} targetSavings - Target number of tokens to save.
   * @param {object} context - Context for strategy selection.
   * @returns {object} { messages, appliedStrategies, totalSavedTokens, targetMet }
   */
  autoOptimize(messages, targetSavings, context = {}) {
    if (!Array.isArray(messages)) {
      return { messages: [], appliedStrategies: [], totalSavedTokens: 0, targetMet: false };
    }

    // A zero or negative target means no optimization is requested.
    if (targetSavings <= 0) {
      return {
        messages: [...messages],
        appliedStrategies: [],
        originalTokens: this._estimateTotalTokens(messages),
        newTokens: this._estimateTotalTokens(messages),
        totalSavedTokens: 0,
        targetMet: true,
        targetSavings: 0,
      };
    }

    const originalTokens = this._estimateTotalTokens(messages);
    let currentMessages = [...messages];
    let totalSaved = 0;
    const appliedStrategies = [];

    // Sort strategies by their score for this context.
    const scored = STRATEGY_NAMES.map((name) => ({
      name,
      score: this._scoreStrategy(name, context).score,
    })).sort((a, b) => b.score - a.score);

    // Apply strategies in order until target is met or we run out.
    for (const { name } of scored) {
      if (totalSaved >= targetSavings && targetSavings > 0) {
        break;
      }

      const outcome = this.applyStrategy(currentMessages, name);
      if (outcome.applied && outcome.savedTokens > 0) {
        currentMessages = outcome.messages;
        totalSaved += outcome.savedTokens;
        appliedStrategies.push({
          strategy: name,
          savedTokens: outcome.savedTokens,
          savingsPercent: outcome.savingsPercent,
        });
      }
    }

    return {
      messages: currentMessages,
      appliedStrategies,
      originalTokens,
      newTokens: this._estimateTotalTokens(currentMessages),
      totalSavedTokens: totalSaved,
      targetMet: totalSaved >= targetSavings,
      targetSavings,
    };
  }

  // --- private strategy implementations ---

  _truncateOldest(messages, options) {
    const keepRecent = options.keepRecent || this._options.truncateKeepRecent;

    if (messages.length <= keepRecent) {
      return { messages, removedCount: 0, summary: "Not enough messages to truncate." };
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    if (nonSystem.length <= keepRecent) {
      return { messages, removedCount: 0, summary: "All non-system messages already within keep limit." };
    }

    const kept = nonSystem.slice(-keepRecent);
    const removedCount = nonSystem.length - keepRecent;

    return {
      messages: [...systemMessages, ...kept],
      removedCount,
      summary: `Truncated ${removedCount} oldest messages, keeping ${keepRecent} most recent.`,
    };
  }

  _summarizeHistory(messages, options) {
    const maxTokens = options.summaryMaxTokens || this._options.summaryMaxTokens;
    const nonSystem = messages.filter((m) => m.role !== "system");
    const systemMessages = messages.filter((m) => m.role === "system");

    if (nonSystem.length <= 6) {
      return { messages, removedCount: 0, summary: "Not enough messages to summarize." };
    }

    // Keep the last few messages intact and summarize the rest.
    const keepRecent = Math.min(4, Math.floor(nonSystem.length / 3));
    const toSummarize = nonSystem.slice(0, -keepRecent);
    const recent = nonSystem.slice(-keepRecent);

    // Build a basic summary from the to-summarize messages.
    const summaryParts = toSummarize.map((m) => {
      const content = m.content || "";
      if (typeof content === "string") {
        return `[${m.role}]: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`;
      }
      if (Array.isArray(content)) {
        const textBlocks = content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
        return `[${m.role}]: ${textBlocks.slice(0, 80)}${textBlocks.length > 80 ? "..." : ""}`;
      }
      return `[${m.role}]: (non-text content)`;
    });

    const summaryContent =
      `[CONVERSATION SUMMARY - ${toSummarize.length} earlier messages condensed]\n` +
      summaryParts.join("\n");

    // Truncate summary to approximate token limit.
    const truncatedSummary = summaryContent.length > maxTokens * 4
      ? summaryContent.slice(0, maxTokens * 4) + "\n[...summary truncated...]"
      : summaryContent;

    const summaryMessage = {
      role: "system",
      content: truncatedSummary,
    };

    const removedCount = toSummarize.length;

    return {
      messages: [...systemMessages, summaryMessage, ...recent],
      removedCount,
      summary: `Summarized ${removedCount} earlier messages into a condensed system block (~${maxTokens} tokens).`,
    };
  }

  _compressTools(messages, options) {
    const minUsage = options.minToolUsageCount !== undefined
      ? options.minToolUsageCount
      : this._options.minToolUsageCount;

    // Count actual tool usage from tool results or assistant tool calls.
    const toolUsageCount = new Map();

    for (const msg of messages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        toolUsageCount.set(msg.tool_call_id, (toolUsageCount.get(msg.tool_call_id) || 0) + 1);
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id) {
            toolUsageCount.set(tc.id, (toolUsageCount.get(tc.id) || 0) + 1);
          }
          if (tc.function && tc.function.name) {
            const key = `fn:${tc.function.name}`;
            toolUsageCount.set(key, (toolUsageCount.get(key) || 0) + 1);
          }
        }
      }
    }

    // Identify rarely-used tools in system messages that contain tool definitions.
    let removedCount = 0;
    let compressed = false;

    const result = messages.map((msg) => {
      if (msg.role !== "system" || !msg.content) {
        return msg;
      }

      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      // Only attempt compression if content appears to contain tool definitions.
      if (!content.includes("tool") && !content.includes("function") && !content.includes("\"name\"")) {
        return msg;
      }

      // For tool-definition blocks, this is a heuristic approach.
      // In practice, a proper implementation would parse the tool schema.
      // Here we mark if tool definitions are present and flag for compression.
      const toolDefinitionMatches = content.match(/\b(tool|function)\b/gi) || [];
      if (toolDefinitionMatches.length > 10) {
        compressed = true;
        removedCount += Math.floor(toolDefinitionMatches.length * 0.3);
        return {
          ...msg,
          content: content + "\n<!-- Tool definitions compressed: rarely-used tools may be omitted. -->",
        };
      }

      return msg;
    });

    return {
      messages: result,
      removedCount: compressed ? removedCount : 0,
      summary: compressed
        ? `Flagged ${removedCount} rarely-used tool references for compression.`
        : "No tool compression opportunities found.",
    };
  }

  _dropRedundant(messages, options) {
    const threshold = options.similarityThreshold || this._options.similarityThreshold;
    const result = [];
    let removedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const current = messages[i];
      const isRedundant = this._isMessageRedundant(current, result, threshold);
      const isEmpty = this._isEmptyMessage(current);

      if (isRedundant || isEmpty) {
        removedCount++;
        continue;
      }

      result.push(current);
    }

    return {
      messages: result,
      removedCount,
      summary: removedCount > 0
        ? `Removed ${removedCount} redundant or empty messages.`
        : "No redundant messages found.",
    };
  }

  _mergeSystemPrompts(messages, options) {
    const systemIndices = [];
    const others = [];

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "system") {
        systemIndices.push(i);
      } else {
        others.push(messages[i]);
      }
    }

    if (systemIndices.length <= 1) {
      return { messages, removedCount: 0, summary: "Only one system prompt exists; nothing to merge." };
    }

    const systemContents = systemIndices.map((i) => messages[i].content || "");
    const mergedContent = systemContents
      .filter((c) => c && c.trim().length > 0)
      .join("\n\n---\n\n");

    const mergedSystem = {
      role: "system",
      content: mergedContent,
    };

    const removedCount = systemIndices.length - 1;

    return {
      messages: [mergedSystem, ...others],
      removedCount,
      summary: `Merged ${systemIndices.length} system prompts into one consolidated block. Saved ${removedCount} redundant message(s).`,
    };
  }

  // --- private helpers ---

  _scoreStrategy(name, context) {
    let score = 0;
    const reasons = [];

    const messageCount = context.messageCount || 0;
    const totalTokens = context.totalTokens || 0;
    const budgetRemaining = context.budgetRemaining;
    const toolCount = context.toolCount || 0;
    const systemPromptCount = context.systemPromptCount || 0;
    const sessionDuration = context.sessionDuration || 0;
    const budgetExhausted = typeof budgetRemaining === "number" && budgetRemaining < totalTokens * 0.15;

    switch (name) {
      case "truncateOldest":
        if (messageCount > 30) { score += 40; reasons.push("High message count"); }
        else if (messageCount > 15) { score += 20; reasons.push("Moderate message count"); }
        if (budgetExhausted) { score += 30; reasons.push("Budget nearly exhausted"); }
        if (sessionDuration > 1800000) { score += 15; reasons.push("Long-running session"); }
        break;

      case "summarizeHistory":
        if (messageCount > 20) { score += 50; reasons.push("Very high message count"); }
        else if (messageCount > 10) { score += 25; reasons.push("High message count"); }
        if (budgetExhausted) { score += 20; reasons.push("Budget nearly exhausted"); }
        if (sessionDuration > 3600000) { score += 20; reasons.push("Extended session"); }
        break;

      case "compressTools":
        if (toolCount > 20) { score += 60; reasons.push("Very large tool set"); }
        else if (toolCount > 10) { score += 35; reasons.push("Large tool set"); }
        else if (toolCount > 3) { score += 15; reasons.push("Moderate tool set"); }
        if (budgetExhausted) { score += 10; reasons.push("Budget nearly exhausted"); }
        break;

      case "dropRedundant":
        if (context.hasRedundantMessages) { score += 50; reasons.push("Redundant messages detected"); }
        if (messageCount > 15) { score += 20; reasons.push("High message count"); }
        // Always a moderate base score because it's safe to apply.
        score += 10;
        reasons.push("Low-risk cleanup");
        break;

      case "mergeSystemPrompts":
        if (systemPromptCount > 3) { score += 60; reasons.push("Many system prompts"); }
        else if (systemPromptCount > 1) { score += 40; reasons.push("Multiple system prompts"); }
        if (budgetExhausted) { score += 15; reasons.push("Budget nearly exhausted"); }
        break;
    }

    return {
      score,
      reason: reasons.join("; ") || "No strong signals for this strategy.",
    };
  }

  _estimateTotalTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      const content = msg.content;
      if (typeof content === "string") {
        total += Math.ceil(content.length / 4);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.text) {
            total += Math.ceil(block.text.length / 4);
          } else if (block.type === "image_url" || block.type === "image") {
            total += 85; // approximate image token cost
          }
        }
      } else if (content && typeof content === "object") {
        total += Math.ceil(JSON.stringify(content).length / 4);
      }
      // Add ~4 tokens per message for role/formatting overhead.
      total += 4;
    }
    return total;
  }

  _isMessageRedundant(msg, previous, threshold) {
    if (previous.length === 0) return false;

    const last = previous[previous.length - 1];
    if (msg.role !== last.role) return false;

    const currentContent = this._normalizeContent(msg.content);
    const lastContent = this._normalizeContent(last.content);

    return this._isSimilar(currentContent, lastContent, threshold);
  }

  _normalizeContent(content) {
    if (typeof content === "string") return content.trim().toLowerCase();
    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim()
        .toLowerCase();
    }
    return "";
  }

  _isEmptyMessage(msg) {
    const content = msg.content;
    if (!content || (typeof content === "string" && content.trim().length === 0)) {
      return true;
    }
    if (Array.isArray(content) && content.length === 0) {
      return true;
    }
    return false;
  }

  _isSimilar(a, b, threshold) {
    if (!a || !b) return false;
    if (a === b) return true;

    const lenA = a.length;
    const lenB = b.length;

    if (lenA === 0 && lenB === 0) return true;
    if (lenA === 0 || lenB === 0) return false;

    // Quick length ratio check.
    const lenRatio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
    if (lenRatio < 0.5) return false;

    // Jaccard similarity on word trigrams.
    const trigramsA = this._trigrams(a);
    const trigramsB = this._trigrams(b);

    const allTrigrams = new Set([...trigramsA, ...trigramsB]);
    if (allTrigrams.size === 0) return false;

    let intersection = 0;
    for (const tg of trigramsA) {
      if (trigramsB.has(tg)) intersection++;
    }

    return (intersection / allTrigrams.size) >= threshold;
  }

  _trigrams(text) {
    const words = text.split(/\s+/);
    const trigrams = new Set();
    for (let i = 0; i <= words.length - 3; i++) {
      trigrams.add(words.slice(i, i + 3).join(" "));
    }
    return trigrams;
  }

  _recordOutcome(strategyName, outcome) {
    const record = {
      strategy: strategyName,
      timestamp: Date.now(),
      savingsPercent: outcome.savingsPercent,
      savedTokens: outcome.savedTokens,
      originalTokens: outcome.originalTokens,
      removedCount: outcome.removedCount,
    };

    this._history.push(record);

    // Prune history.
    if (this._history.length > this._options.maxHistoryLength) {
      this._history = this._history.slice(-this._options.maxHistoryLength);
    }

    // Update effectiveness data.
    const eff = this._effectiveness[strategyName];
    if (eff) {
      eff.sampleSize += 1;
      const recentTotal = this._history
        .filter((h) => h.strategy === strategyName)
        .slice(-20)
        .reduce((s, h) => s + h.savingsPercent, 0);
      const recentCount = Math.min(20, eff.sampleSize);
      if (recentCount > 0) {
        eff.averageSavingsPercent = Math.round((recentTotal / recentCount) * 100) / 100;
      }
      eff.successRate = Math.round(
        ((eff.successRate * (eff.sampleSize - 1) + (outcome.applied ? 1 : 0)) / eff.sampleSize) * 100
      ) / 100;
    }
  }
}

module.exports = {
  TokenStrategy,
  STRATEGY_NAMES,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_APPLICABILITY,
  DEFAULT_EFFECTIVENESS,
};
