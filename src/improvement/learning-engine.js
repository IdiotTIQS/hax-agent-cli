"use strict";

/**
 * LearningEngine — extracts learnings from sessions, persists patterns,
 * and applies accumulated knowledge to improve future behavior.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const LEARNINGS_PATH = path.join(os.homedir(), ".haxagent", "learnings.json");

// ---------------------------------------------------------------------------
// Pattern types
// ---------------------------------------------------------------------------

const PATTERN_TYPES = {
  SUCCESSFUL_TOOL_COMBO: "SUCCESSFUL_TOOL_COMBO",
  ERROR_RECOVERY: "ERROR_RECOVERY",
  EFFICIENT_PROMPT: "EFFICIENT_PROMPT",
  COMMON_PITFALL: "COMMON_PITFALL",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUserMsg(entry) {
  return entry && entry.role === "user";
}

function isAssistantMsg(entry) {
  return entry && entry.role === "assistant";
}

function isToolMsg(entry) {
  return entry && entry.role === "tool";
}

function isErrorTool(entry) {
  return isToolMsg(entry) && entry.isError === true;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// LearningEngine class
// ---------------------------------------------------------------------------

class LearningEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.learningsPath] — override default storage path
   */
  constructor(options = {}) {
    this._learningsPath = options.learningsPath || LEARNINGS_PATH;
    this._sessionCache = new Map(); // sessionId -> extracted learnings
    this._ensureStorage();
  }

  /**
   * Extracts learnings from a session and persists them.
   *
   * @param {object}   session
   * @param {string}   session.id
   * @param {object[]} [session.entries] — transcript entries
   * @param {object}   [session.analysis] — pre-computed analysis from FeedbackCollector
   * @returns {object} extracted learnings
   */
  learn(session) {
    if (!session || !session.id) {
      return { patterns: [], sessionId: null, error: "missing session id" };
    }

    const entries = this._resolveEntries(session);
    const filtered = entries.filter((e) => !e || e.type !== "session.meta");

    const patterns = [];

    // --- SUCCESSFUL_TOOL_COMBO ---
    this._extractSuccessfulToolCombos(filtered, patterns);

    // --- ERROR_RECOVERY ---
    this._extractErrorRecoveryPatterns(filtered, patterns);

    // --- EFFICIENT_PROMPT ---
    this._extractEfficientPromptPatterns(filtered, patterns);

    // --- COMMON_PITFALL ---
    this._extractCommonPitfalls(filtered, session.analysis, patterns);

    // Build learnings result
    const learnings = {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      patternCount: patterns.length,
      patterns,
    };

    // Cache
    this._sessionCache.set(session.id, learnings);

    // Persist
    this._appendLearnings(learnings);

    return learnings;
  }

  /**
   * Returns learned patterns across all sessions.
   *
   * @param {object} [options]
   * @param {string} [options.type] — filter by PATTERN_TYPES value
   * @param {number} [options.minConfidence] — minimum confidence score (0-1)
   * @param {number} [options.limit] — max patterns to return
   * @returns {object[]} patterns
   */
  getPatterns(options = {}) {
    const allLearnings = this._loadLearnings();
    let allPatterns = [];

    for (const learning of allLearnings) {
      if (Array.isArray(learning.patterns)) {
        for (const p of learning.patterns) {
          allPatterns.push({
            ...p,
            sessionId: learning.sessionId,
            learnedAt: learning.timestamp,
          });
        }
      }
    }

    // Filter by type
    if (options.type) {
      allPatterns = allPatterns.filter((p) => p.type === options.type);
    }

    // Filter by confidence
    if (typeof options.minConfidence === "number") {
      allPatterns = allPatterns.filter((p) => p.confidence >= options.minConfidence);
    }

    // Sort by confidence descending, then by timestamp
    allPatterns.sort((a, b) => {
      const confDiff = (b.confidence || 0) - (a.confidence || 0);
      if (confDiff !== 0) return confDiff;
      return (b.learnedAt || "").localeCompare(a.learnedAt || "");
    });

    // Aggregate patterns: merge duplicates, increase confidence
    const aggregated = this._aggregatePatterns(allPatterns);

    if (typeof options.limit === "number" && options.limit > 0) {
      return aggregated.slice(0, options.limit);
    }

    return aggregated;
  }

  /**
   * Applies accumulated learnings to improve future behavior.
   * Returns context modifications that can be injected into prompts.
   *
   * @param {object} context — current execution context
   * @param {string[]} [context.activeTools] — tools being used
   * @param {string}   [context.task] — current task description
   * @param {object}   [context.recentErrors] — recent error info
   * @returns {object} applied learnings with guidance
   */
  applyLearnings(context = {}) {
    const activeTools = context.activeTools || [];
    const task = (context.task || "").toLowerCase();
    const recentErrors = context.recentErrors || {};

    const patterns = this.getPatterns();
    const applicable = [];
    const guidance = [];

    for (const pattern of patterns) {
      let applies = false;

      switch (pattern.type) {
        case PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO:
          // Apply if any of the combo tools are in active set
          if (pattern.tools && pattern.tools.some((t) => activeTools.includes(t))) {
            applies = true;
            guidance.push({
              type: "tool_recommendation",
              message: `Consider using tool sequence: ${pattern.pattern} (success rate: ${_pct(pattern.confidence)})`,
              pattern,
            });
          }
          break;

        case PATTERN_TYPES.ERROR_RECOVERY:
          // Apply if we're seeing errors for a tool
          if (pattern.tool && recentErrors[pattern.tool]) {
            applies = true;
            guidance.push({
              type: "recovery_strategy",
              message: `Recovery strategy for ${pattern.tool}: ${pattern.pattern}`,
              pattern,
            });
          }
          break;

        case PATTERN_TYPES.EFFICIENT_PROMPT:
          // Apply if task description matches
          if (pattern.taskKeywords && pattern.taskKeywords.some((kw) => task.includes(kw))) {
            applies = true;
            guidance.push({
              type: "prompt_hint",
              message: `Effective approach for "${kwFirst(pattern.taskKeywords)}": ${pattern.pattern}`,
              pattern,
            });
          }
          break;

        case PATTERN_TYPES.COMMON_PITFALL:
          // Always relevant as warnings
          applies = true;
          guidance.push({
            type: "warning",
            message: `Avoid: ${pattern.pattern}`,
            pattern,
          });
          break;
      }

      if (applies) {
        applicable.push(pattern);
      }
    }

    return {
      context,
      applicablePatterns: applicable.length,
      guidance: guidance.slice(0, 5), // top 5 most relevant
      recommendedActions: guidance
        .filter((g) => g.type === "tool_recommendation")
        .map((g) => g.message),
      warnings: guidance
        .filter((g) => g.type === "warning")
        .map((g) => g.message),
    };
  }

  /**
   * Returns actionable insights derived from accumulated learnings.
   *
   * @returns {object} insights
   */
  getInsights() {
    const patterns = this.getPatterns();
    const allLearnings = this._loadLearnings();

    // Best performing tool combos
    const combos = patterns.filter((p) => p.type === PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO);
    const bestCombos = combos
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Most valuable error recovery strategies
    const recoveries = patterns.filter((p) => p.type === PATTERN_TYPES.ERROR_RECOVERY);
    const bestRecoveries = recoveries
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    // Most common pitfalls
    const pitfalls = patterns.filter((p) => p.type === PATTERN_TYPES.COMMON_PITFALL);
    const topPitfalls = pitfalls
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Efficient prompt patterns
    const promptPatterns = patterns.filter((p) => p.type === PATTERN_TYPES.EFFICIENT_PROMPT);
    const topPrompts = promptPatterns
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    // Trend analysis
    const sessionCount = allLearnings.length;
    const totalPatternsDiscovered = patterns.length;
    const highConfidenceCount = patterns.filter((p) => p.confidence >= 0.8).length;
    const typeDistribution = {};
    for (const p of patterns) {
      typeDistribution[p.type] = (typeDistribution[p.type] || 0) + 1;
    }

    // Learning velocity (patterns per session)
    const learningVelocity = sessionCount > 0
      ? Math.round((totalPatternsDiscovered / sessionCount) * 10) / 10
      : 0;

    return {
      sessionCount,
      totalPatternsDiscovered,
      highConfidencePatterns: highConfidenceCount,
      learningVelocity,
      typeDistribution,
      bestCombos,
      bestRecoveries,
      topPitfalls,
      topPrompts,
      maturityLevel: this._computeMaturity(highConfidenceCount, totalPatternsDiscovered, sessionCount),
    };
  }

  // ---------------------------------------------------------------------------
  // Pattern extraction helpers
  // ---------------------------------------------------------------------------

  _extractSuccessfulToolCombos(entries, out) {
    // Look for non-error tool sequences that lead to successful completions
    for (let i = 0; i < entries.length - 1; i++) {
      if (!isToolMsg(entries[i]) || isErrorTool(entries[i])) continue;
      if (!isToolMsg(entries[i + 1]) || isErrorTool(entries[i + 1])) continue;

      const toolA = entries[i].name || "(unnamed)";
      const toolB = entries[i + 1].name || "(unnamed)";

      // Only flag distinct tools
      if (toolA === toolB) continue;

      // Check if this combo leads to a completed solution (next assistant msg after)
      let resolved = false;
      for (let j = i + 2; j < entries.length; j++) {
        if (isAssistantMsg(entries[j])) {
          const content = typeof entries[j].content === "string" ? entries[j].content.toLowerCase() : "";
          resolved = /done|completed|fixed|resolved|success|working|created|updated|finished/i.test(content);
          break;
        }
      }

      out.push({
        type: PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO,
        pattern: `${toolA} -> ${toolB}`,
        tools: [toolA, toolB],
        confidence: resolved ? 0.8 : 0.5,
        evidence: entries[i].timestamp || null,
        frequency: 1, // will be aggregated across sessions
      });
    }
  }

  _extractErrorRecoveryPatterns(entries, out) {
    for (let i = 0; i < entries.length; i++) {
      if (!isErrorTool(entries[i])) continue;

      const errorTool = entries[i].name || "(unnamed)";
      const errorContent = typeof entries[i].content === "string" ? entries[i].content : "";

      // Look for a successful recovery within the next 3 tool calls
      for (let j = i + 1; j < Math.min(i + 4, entries.length); j++) {
        if (!isToolMsg(entries[j])) continue;
        if (isErrorTool(entries[j])) continue;
        if ((entries[j].name || "(unnamed)") === errorTool) {
          // Retry with same tool worked
          out.push({
            type: PATTERN_TYPES.ERROR_RECOVERY,
            pattern: `Retry "${errorTool}" after error (same tool)`,
            tool: errorTool,
            strategy: "retry_same",
            confidence: 0.7,
            evidence: entries[i].timestamp || null,
            frequency: 1,
          });
          break;
        }
        // Different tool after error — alternative approach
        const altTool = entries[j].name || "(unnamed)";
        out.push({
          type: PATTERN_TYPES.ERROR_RECOVERY,
          pattern: `Fallback from "${errorTool}" to "${altTool}" after error`,
          tool: errorTool,
          strategy: "fallback_to_alternative",
          confidence: 0.6,
          evidence: entries[i].timestamp || null,
          frequency: 1,
        });
        break;
      }

      // Check for assistant adapting strategy
      for (let j = i + 1; j < Math.min(i + 3, entries.length); j++) {
        if (!isAssistantMsg(entries[j])) continue;
        const content = typeof entries[j].content === "string" ? entries[j].content.toLowerCase() : "";
        if (/let me try|alternative|instead|different approach|workaround/i.test(content)) {
          out.push({
            type: PATTERN_TYPES.ERROR_RECOVERY,
            pattern: `Adaptive strategy change after ${errorTool} error`,
            tool: errorTool,
            strategy: "adaptive_replan",
            confidence: 0.65,
            evidence: entries[i].timestamp || null,
            frequency: 1,
          });
          break;
        }
      }
    }
  }

  _extractEfficientPromptPatterns(entries, out) {
    // Find user prompts that were followed by quick, successful completions
    // (short assistant replies with low retry counts)

    for (let i = 0; i < entries.length; i++) {
      if (!isUserMsg(entries[i])) continue;
      const userContent = typeof entries[i].content === "string" ? entries[i].content : "";
      if (userContent.length < 20) continue; // skip trivial

      // Check if the next assistant message was concise and successful
      let nextAsst = null;
      for (let j = i + 1; j < entries.length; j++) {
        if (isAssistantMsg(entries[j])) {
          nextAsst = entries[j];
          break;
        }
      }

      if (!nextAsst) continue;
      const asstContent = typeof nextAsst.content === "string" ? nextAsst.content : "";

      // Check for success indicators in assistant response
      const isSuccessful = /done|ready|complete|here you go|here's|created|updated|fixed/i.test(asstContent);

      // Count tool errors between this user message and next user message
      let toolErrorCount = 0;
      let nextUserIdx = entries.length;
      for (let j = i + 1; j < entries.length; j++) {
        if (isUserMsg(entries[j])) { nextUserIdx = j; break; }
        if (isErrorTool(entries[j])) toolErrorCount += 1;
      }

      // Efficient: short assistant response, no tool errors
      if (isSuccessful && toolErrorCount === 0 && asstContent.length < 500) {
        // Extract keywords from user prompt
        const keywords = userContent
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 5);

        out.push({
          type: PATTERN_TYPES.EFFICIENT_PROMPT,
          pattern: userContent.slice(0, 100),
          taskKeywords: keywords,
          confidence: 0.6,
          evidence: entries[i].timestamp || null,
          frequency: 1,
        });
      }
    }
  }

  _extractCommonPitfalls(entries, analysis, out) {
    // Detect repeated errors with the same tool
    const toolErrorSeqs = {};
    let prevError = null;

    for (const e of entries) {
      if (!isErrorTool(e)) {
        prevError = null;
        continue;
      }
      const name = e.name || "(unnamed)";
      if (prevError === name) {
        toolErrorSeqs[name] = (toolErrorSeqs[name] || 0) + 1;
      }
      prevError = name;
    }

    for (const [tool, count] of Object.entries(toolErrorSeqs)) {
      if (count >= 2) {
        out.push({
          type: PATTERN_TYPES.COMMON_PITFALL,
          pattern: `Repeated failures with tool "${tool}" (${count + 1} consecutive errors)`,
          tool,
          confidence: 0.75,
          evidence: null,
          frequency: count,
        });
      }
    }

    // Detect error cascades (multiple errors between user messages)
    let errorsSinceUser = 0;
    for (const e of entries) {
      if (isUserMsg(e)) {
        errorsSinceUser = 0;
        continue;
      }
      if (isErrorTool(e)) {
        errorsSinceUser += 1;
      }
      if (isAssistantMsg(e) && errorsSinceUser >= 3) {
        out.push({
          type: PATTERN_TYPES.COMMON_PITFALL,
          pattern: `Error cascade: ${errorsSinceUser} errors before retry/replan`,
          confidence: 0.7,
          evidence: e.timestamp || null,
          frequency: 1,
        });
        errorsSinceUser = 0;
      }
    }

    // Detect missing pre-validation from analysis
    if (analysis && analysis.toolEffectiveness) {
      const failing = analysis.toolEffectiveness.failingTools || [];
      for (const ft of failing) {
        if (ft.errorRate > 0.5) {
          out.push({
            type: PATTERN_TYPES.COMMON_PITFALL,
            pattern: `High failure rate on "${ft.tool}" (${Math.round(ft.errorRate * 100)}%) — likely missing pre-validation`,
            tool: ft.tool,
            confidence: 0.8,
            evidence: null,
            frequency: 1,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  _resolveEntries(session) {
    if (Array.isArray(session.entries)) return session.entries;
    if (typeof session.entries === "function") {
      try { return session.entries(); } catch { return []; }
    }
    return [];
  }

  _ensureStorage() {
    ensureDir(path.dirname(this._learningsPath));
    if (!fs.existsSync(this._learningsPath)) {
      fs.writeFileSync(this._learningsPath, JSON.stringify([], null, 2), "utf8");
    }
  }

  _loadLearnings() {
    try {
      if (!fs.existsSync(this._learningsPath)) return [];
      const raw = fs.readFileSync(this._learningsPath, "utf8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  _saveLearnings(data) {
    ensureDir(path.dirname(this._learningsPath));
    fs.writeFileSync(this._learningsPath, JSON.stringify(data, null, 2), "utf8");
  }

  _appendLearnings(learnings) {
    const all = this._loadLearnings();
    all.push(learnings);
    // Keep only last 500 sessions to prevent unlimited growth
    const trimmed = all.length > 500 ? all.slice(-500) : all;
    this._saveLearnings(trimmed);
  }

  _aggregatePatterns(patterns) {
    const map = new Map();

    for (const p of patterns) {
      const key = `${p.type}::${p.pattern}`;
      if (map.has(key)) {
        const existing = map.get(key);
        existing.frequency += p.frequency || 1;
        existing.confidence = Math.min(1, (existing.confidence + p.confidence) / 2 + 0.05);
        existing.sessionCount = (existing.sessionCount || 1) + 1;
        if (!existing.sessionIds) existing.sessionIds = [];
        if (p.sessionId && !existing.sessionIds.includes(p.sessionId)) {
          existing.sessionIds.push(p.sessionId);
        }
      } else {
        map.set(key, {
          ...p,
          sessionCount: 1,
          sessionIds: p.sessionId ? [p.sessionId] : [],
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  _computeMaturity(highConfidence, totalPatterns, sessions) {
    if (sessions < 5) return "emerging";
    if (totalPatterns < 10) return "collecting";
    if (highConfidence / Math.max(1, totalPatterns) < 0.3) return "developing";
    if (sessions < 20) return "established";
    return "mature";
  }
}

function kwFirst(keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return "tasks";
  return keywords[0];
}

function _pct(val) {
  return `${Math.round((val || 0) * 100)}%`;
}

module.exports = { LearningEngine, PATTERN_TYPES };
