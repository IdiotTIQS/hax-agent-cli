"use strict";

/**
 * FeedbackCollector — analyzes individual sessions for improvement
 * opportunities across tools, prompts, errors, and latency.
 */

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

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function safeAvg(list, decimals = 1) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const sum = list.reduce((a, b) => a + b, 0);
  const avg = sum / list.length;
  return decimals >= 0 ? roundTo(avg, decimals) : avg;
}

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Vague prompt indicators — short questions, missing file references,
// lack of constraints or specificity
const VAGUE_PATTERNS = [
  { pattern: /^(fix|help|debug|hey|hi|hello)\b/i, label: "generic opening" },
  { pattern: /^.{0,15}$/, label: "very short prompt (< 15 chars)" },
  { pattern: /^(what('s| is) wrong|why doesn'?t|it (doesn'?t|is not|isn'?t) work)/i, label: "missing repro steps" },
  { pattern: /^(ok|thanks|yes|no|got it|sure|alright|fine|good|nice)[.!]?$/i, label: "low-signal response" },
];

// Missing context heuristics
const MISSING_CONTEXT_INDICATORS = [
  "file", "path", "error", "log", "output", "stack", "repro", "reproduce",
  "before", "after", "expected", "actual", "step", "version", "config",
];

// ---------------------------------------------------------------------------
// FeedbackCollector class
// ---------------------------------------------------------------------------

class FeedbackCollector {
  /**
   * @param {object} [options]
   * @param {object} [options.thresholds] — custom thresholds for severity
   */
  constructor(options = {}) {
    this._options = options;
    this._thresholds = {
      errorRate: 0.1,        // 10%+ error rate triggers warning
      vaguePromptLen: 30,    // prompts shorter than this are flagged
      highLatencyMs: 5000,   // operations taking longer than this
      toolFailureRate: 0.3,  // 30%+ failure rate per tool triggers warning
      ...options.thresholds,
    };
  }

  /**
   * Main entry point — analyzes a session for all improvement opportunities.
   *
   * @param {object}   session
   * @param {string}   session.id
   * @param {object[]} [session.entries] — transcript entries
   * @returns {object} analysis result with suggestions
   */
  collect(session) {
    if (!session) {
      return { suggestions: [], summary: { error: "no session provided" } };
    }

    const entries = Array.isArray(session.entries)
      ? session.entries
      : typeof session.entries === "function"
        ? session.entries()
        : [];

    const filtered = entries.filter(
      (e) => !e || e.type !== "session.meta"
    );

    const toolAnalysis = this.analyzeToolEffectiveness({ entries: filtered });
    const promptAnalysis = this.analyzePromptQuality({ entries: filtered });
    const errorAnalysis = this.analyzeErrorPatterns({ entries: filtered });
    const latencyAnalysis = this.analyzeLatency({ entries: filtered });

    const analysis = {
      toolEffectiveness: toolAnalysis,
      promptQuality: promptAnalysis,
      errorPatterns: errorAnalysis,
      latency: latencyAnalysis,
    };

    const suggestions = this.generateSuggestions(analysis);

    return {
      sessionId: session.id || "unknown",
      analysis,
      suggestions,
      summary: this._buildSummary(analysis, suggestions),
    };
  }

  /**
   * Analyzes which tools succeeded, failed, and patterns in tool usage.
   *
   * @param {object}   session
   * @param {object[]} session.entries
   * @returns {object} tool effectiveness analysis
   */
  analyzeToolEffectiveness(session) {
    const entries = Array.isArray(session.entries) ? session.entries : [];
    const filtered = entries.filter(
      (e) => !e || e.type !== "session.meta"
    );

    const toolStats = {};
    const toolErrors = {};

    for (const e of filtered) {
      if (!isToolMsg(e)) continue;
      const name = e.name || "(unnamed)";

      if (!toolStats[name]) {
        toolStats[name] = { calls: 0, errors: 0, success: 0 };
      }
      toolStats[name].calls += 1;

      if (isErrorTool(e)) {
        toolStats[name].errors += 1;
        if (!toolErrors[name]) toolErrors[name] = [];
        toolErrors[name].push({
          timestamp: e.timestamp || null,
          data: e.data || {},
          content: typeof e.content === "string" ? e.content.slice(0, 200) : null,
        });
      } else {
        toolStats[name].success += 1;
      }
    }

    // Compute success rates and identify patterns
    const toolList = Object.entries(toolStats).map(([name, stats]) => ({
      tool: name,
      calls: stats.calls,
      errors: stats.errors,
      success: stats.success,
      successRate: stats.calls > 0 ? roundTo(stats.success / stats.calls, 3) : 0,
      errorRate: stats.calls > 0 ? roundTo(stats.errors / stats.calls, 3) : 0,
      isReliable: stats.calls > 0 && stats.errors / stats.calls < this._thresholds.toolFailureRate,
    }));

    const failingTools = toolList.filter((t) => !t.isReliable);
    const reliableTools = toolList.filter((t) => t.isReliable);

    // Detect tool sequence patterns (e.g., read-then-edit)
    const sequences = [];
    let prevTool = null;
    for (const e of filtered) {
      if (!isToolMsg(e)) continue;
      const name = e.name || "(unnamed)";
      const wasError = isErrorTool(e);
      if (prevTool) {
        sequences.push({ from: prevTool.name, to: name, fromError: prevTool.error });
      }
      prevTool = { name, error: wasError };
    }

    // Common sequences
    const sequenceCounts = {};
    for (const seq of sequences) {
      const key = `${seq.from}->${seq.to}`;
      if (!sequenceCounts[key]) sequenceCounts[key] = { count: 0, errorAfter: 0 };
      sequenceCounts[key].count += 1;
      if (seq.fromError) sequenceCounts[key].errorAfter += 1;
    }

    const commonSequences = Object.entries(sequenceCounts)
      .map(([key, val]) => ({
        sequence: key,
        count: val.count,
        errorRecoveryRate: val.errorAfter > 0
          ? roundTo((val.count - val.errorAfter) / val.count, 3)
          : 1,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      tools: toolList,
      failingTools,
      reliableTools,
      commonSequences,
      totalToolCalls: toolList.reduce((a, t) => a + t.calls, 0),
      totalToolErrors: toolList.reduce((a, t) => a + t.errors, 0),
      overallSuccessRate: toolList.length > 0
        ? roundTo(
            toolList.reduce((a, t) => a + t.success, 0) /
            Math.max(1, toolList.reduce((a, t) => a + t.calls, 0)),
            3
          )
        : 0,
    };
  }

  /**
   * Detects vague prompts and missing context in user messages.
   *
   * @param {object}   session
   * @param {object[]} session.entries
   * @returns {object} prompt quality analysis
   */
  analyzePromptQuality(session) {
    const entries = Array.isArray(session.entries) ? session.entries : [];
    const filtered = entries.filter(
      (e) => !e || e.type !== "session.meta"
    );

    const userMessages = filtered.filter((e) => isUserMsg(e));

    const assessments = userMessages.map((msg, idx) => {
      const content = typeof msg.content === "string" ? msg.content : "";
      const issues = [];

      // Check length
      if (content.length < this._thresholds.vaguePromptLen) {
        issues.push({ type: "short_prompt", severity: "low" });
      }

      // Check vague patterns
      for (const vp of VAGUE_PATTERNS) {
        if (vp.pattern.test(content)) {
          issues.push({ type: "vague_pattern", label: vp.label, severity: "medium" });
          break; // one vague-pattern flag per message
        }
      }

      // Check missing context indicators
      const lower = content.toLowerCase();
      const missingContext = MISSING_CONTEXT_INDICATORS.filter(
        (indicator) => !lower.includes(indicator)
      );
      // If many context clues are missing, flag it
      if (missingContext.length === MISSING_CONTEXT_INDICATORS.length &&
          content.length > 0 &&
          !/^(ok|thanks|yes|no|got it|sure|alright|fine|good|nice)[.!]?$/i.test(content)) {
        // Only flag if the prompt isn't just an acknowledgment
        if (content.length > 20) {
          issues.push({
            type: "missing_context",
            severity: "medium",
            detail: "no file paths, error messages, or expected behavior mentioned",
          });
        }
      }

      return {
        turnIndex: idx,
        timestamp: msg.timestamp || null,
        content: content.slice(0, 120),
        contentLength: content.length,
        issues,
        isVague: issues.length > 0,
      };
    });

    const vagueCount = assessments.filter((a) => a.isVague).length;
    const totalUserMessages = assessments.length;

    // Check for follow-up clarification patterns (assistant asking "could you clarify")
    const assistantMessages = filtered.filter((e) => isAssistantMsg(e));
    const clarificationRequests = assistantMessages.filter((msg) => {
      const content = typeof msg.content === "string" ? msg.content.toLowerCase() : "";
      return /could you (clarify|elaborate|specify|provide more)/i.test(content) ||
             /can you (clarify|elaborate|specify|provide more)/i.test(content) ||
             /i need more (context|information|details)/i.test(content) ||
             /please (clarify|specify|elaborate)/i.test(content);
    });

    return {
      assessments,
      totalUserMessages,
      vagueCount,
      vagueRate: totalUserMessages > 0 ? roundTo(vagueCount / totalUserMessages, 3) : 0,
      clarificationRequests: clarificationRequests.length,
      clarityScore: totalUserMessages > 0
        ? roundTo(Math.max(0, 1 - (vagueCount / totalUserMessages)), 3)
        : 0,
    };
  }

  /**
   * Categorizes and groups errors found in the session.
   *
   * @param {object}   session
   * @param {object[]} session.entries
   * @returns {object} error pattern analysis
   */
  analyzeErrorPatterns(session) {
    const entries = Array.isArray(session.entries) ? session.entries : [];
    const filtered = entries.filter(
      (e) => !e || e.type !== "session.meta"
    );

    const errors = filtered.filter((e) => isErrorTool(e));

    // Categorize errors by tool and by error message
    const categories = {};
    const errorGroups = {};

    for (const err of errors) {
      const toolName = err.name || "(unnamed)";
      const errorContent = typeof err.content === "string" ? err.content : "";

      // Categorize by error type
      let category = "unknown";
      if (/timeout|timed out|ETIMEDOUT/i.test(errorContent)) {
        category = "timeout";
      } else if (/not found|ENOENT|no such file|404/i.test(errorContent)) {
        category = "not_found";
      } else if (/permission|access denied|EACCES|forbidden|403|unauthorized/i.test(errorContent)) {
        category = "permission";
      } else if (/rate limit|too many|429|throttl/i.test(errorContent)) {
        category = "rate_limit";
      } else if (/syntax|parse|invalid|malformed|unexpected token/i.test(errorContent)) {
        category = "syntax";
      } else if (/connection|ECONNREFUSED|network|ENOTFOUND|DNS/i.test(errorContent)) {
        category = "network";
      } else if (/memory|OOM|heap|allocation/i.test(errorContent)) {
        category = "memory";
      } else if (/validation|invalid input|bad request|400/i.test(errorContent)) {
        category = "validation";
      }

      categories[category] = (categories[category] || 0) + 1;

      // Group by tool
      if (!errorGroups[toolName]) {
        errorGroups[toolName] = { tool: toolName, count: 0, categories: {} };
      }
      errorGroups[toolName].count += 1;
      errorGroups[toolName].categories[category] =
        (errorGroups[toolName].categories[category] || 0) + 1;
    }

    // Sort categories by frequency
    const sortedCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));

    // Sort error groups by count
    const sortedGroups = Object.values(errorGroups)
      .sort((a, b) => b.count - a.count);

    // Detect recovery patterns: error followed by success with same tool
    const recoveryAttempts = [];
    for (let i = 0; i < filtered.length - 1; i++) {
      if (!isErrorTool(filtered[i])) continue;
      const errorTool = filtered[i].name || "(unnamed)";
      // Look ahead for a successful call of the same tool
      for (let j = i + 1; j < filtered.length; j++) {
        if (isToolMsg(filtered[j]) && !isErrorTool(filtered[j]) &&
            (filtered[j].name || "(unnamed)") === errorTool) {
          recoveryAttempts.push({
            tool: errorTool,
            errorIndex: i,
            recoveryIndex: j,
            recovered: true,
          });
          break;
        }
        // If we hit an assistant message before recovery, break
        if (isAssistantMsg(filtered[j])) break;
      }
    }

    // Detect cascading errors (failures in sequence)
    let cascadingErrorCount = 0;
    let inErrorStreak = false;
    for (const e of filtered) {
      if (isErrorTool(e)) {
        if (inErrorStreak) cascadingErrorCount += 1;
        inErrorStreak = true;
      } else if (isAssistantMsg(e)) {
        inErrorStreak = false;
      }
    }

    return {
      totalErrors: errors.length,
      categories: sortedCategories,
      errorGroups: sortedGroups,
      recoveryPatterns: {
        attempts: recoveryAttempts.length,
        details: recoveryAttempts,
        recoveryRate: errors.length > 0
          ? roundTo(recoveryAttempts.length / errors.length, 3)
          : 0,
      },
      cascadingErrors: cascadingErrorCount,
      mostFrequentCategory: sortedCategories.length > 0
        ? sortedCategories[0].category
        : null,
    };
  }

  /**
   * Identifies slow operations in the session.
   *
   * @param {object}   session
   * @param {object[]} session.entries
   * @returns {object} latency analysis
   */
  analyzeLatency(session) {
    const entries = Array.isArray(session.entries) ? session.entries : [];
    const filtered = entries.filter(
      (e) => !e || e.type !== "session.meta"
    );

    // Track inter-message latencies
    const latencies = [];
    const toolLatencies = [];
    const slowOperations = [];

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const ts = parseTs(entry);
      if (ts === null) continue;

      // Check if entry has explicit duration
      const duration = entry.duration || entry.durationMs;

      if (duration != null && Number.isFinite(duration) && duration > 0) {
        const op = {
          type: entry.role || "unknown",
          name: entry.name || null,
          durationMs: duration,
          timestamp: entry.timestamp || null,
        };
        latencies.push(op);
        if (isToolMsg(entry)) {
          toolLatencies.push(op);
        }
        if (duration > this._thresholds.highLatencyMs) {
          slowOperations.push(op);
        }
      }

      // Inter-message gap from previous entry
      if (i > 0) {
        const prevTs = parseTs(filtered[i - 1]);
        if (prevTs !== null) {
          const gap = ts - prevTs;
          if (gap > 0) {
            latencies.push({
              type: "inter_message_gap",
              from: filtered[i - 1].role || "unknown",
              to: entry.role || "unknown",
              durationMs: gap,
              timestamp: entry.timestamp || null,
              toolName: isToolMsg(filtered[i - 1]) ? (filtered[i - 1].name || null) : null,
            });
            if (gap > this._thresholds.highLatencyMs) {
              slowOperations.push({
                type: "inter_message_gap",
                from: filtered[i - 1].role || "unknown",
                to: entry.role || "unknown",
                durationMs: gap,
                timestamp: entry.timestamp || null,
              });
            }
          }
        }
      }
    }

    // Per-tool average latency
    const toolLatencyMap = {};
    for (const tl of toolLatencies) {
      if (!tl.name) continue;
      if (!toolLatencyMap[tl.name]) toolLatencyMap[tl.name] = [];
      toolLatencyMap[tl.name].push(tl.durationMs);
    }

    const toolAvgLatency = Object.entries(toolLatencyMap).map(([tool, vals]) => ({
      tool,
      avgDurationMs: safeAvg(vals),
      maxDurationMs: vals.length ? Math.max(...vals) : 0,
      minDurationMs: vals.length ? Math.min(...vals) : 0,
      sampleCount: vals.length,
    }));

    // Overall latency stats
    const durations = latencies.map((l) => l.durationMs);
    const avgLatency = safeAvg(durations);
    const maxLatency = durations.length ? Math.max(...durations) : 0;

    return {
      avgLatencyMs: avgLatency,
      maxLatencyMs: maxLatency,
      totalMeasuredOperations: latencies.length,
      slowOperations,
      slowOperationCount: slowOperations.length,
      toolAvgLatency,
      worstTool: toolAvgLatency.length > 0
        ? toolAvgLatency.reduce((worst, t) =>
            t.avgDurationMs > worst.avgDurationMs ? t : worst
          )
        : null,
    };
  }

  /**
   * Produces actionable improvement suggestions from analysis.
   *
   * @param {object} analysis — full analysis result
   * @returns {object[]} array of suggestions
   */
  generateSuggestions(analysis) {
    const suggestions = [];

    // Tool effectiveness suggestions
    if (analysis.toolEffectiveness) {
      const te = analysis.toolEffectiveness;

      for (const failing of te.failingTools.slice(0, 3)) {
        suggestions.push({
          id: uid(),
          category: "tool_reliability",
          severity: failing.errorRate > 0.5 ? "high" : "medium",
          title: `Reduce error rate for tool: ${failing.tool}`,
          description: `Tool "${failing.tool}" has a ${roundTo(failing.errorRate * 100, 1)}% error rate (${failing.errors}/${failing.calls} calls). Consider adding retry logic, pre-validation, or fallback paths.`,
          action: `Add retry wrapper to ${failing.tool} tool with exponential backoff`,
          metadata: { tool: failing.tool, errorRate: failing.errorRate },
        });
      }

      if (te.commonSequences.length > 0) {
        const topSeq = te.commonSequences[0];
        if (topSeq.errorRecoveryRate < 0.5 && topSeq.count >= 2) {
          suggestions.push({
            id: uid(),
            category: "tool_sequence",
            severity: "medium",
            title: `Improve error recovery in sequence: ${topSeq.sequence}`,
            description: `The sequence ${topSeq.sequence} has a low error recovery rate (${roundTo(topSeq.errorRecoveryRate * 100, 0)}%). Consider adding validation before the second tool call.`,
            action: `Add pre-call validation check in the ${topSeq.sequence} path`,
            metadata: { sequence: topSeq.sequence, errorRecoveryRate: topSeq.errorRecoveryRate },
          });
        }

        // Suggest successful combos
        const successfulSeqs = te.commonSequences.filter((s) => s.errorRecoveryRate >= 0.9 && s.count >= 2);
        if (successfulSeqs.length > 0) {
          suggestions.push({
            id: uid(),
            category: "tool_sequence",
            severity: "low",
            title: "High-success tool sequences detected",
            description: `The following tool sequences succeed consistently: ${successfulSeqs.map((s) => s.sequence).join(", ")}. These are strong patterns to recommend.`,
            action: "Document these successful sequences as recommended workflows",
            metadata: { sequences: successfulSeqs.map((s) => s.sequence) },
          });
        }
      }

      if (te.overallSuccessRate < 0.8 && te.totalToolCalls > 0) {
        suggestions.push({
          id: uid(),
          category: "tool_reliability",
          severity: "high",
          title: `Low overall tool success rate: ${roundTo(te.overallSuccessRate * 100, 0)}%`,
          description: `Only ${te.totalToolCalls - te.totalToolErrors} of ${te.totalToolCalls} tool calls succeeded. Investigate systemic issues.`,
          action: "Audit tool implementations for shared failure modes",
          metadata: { overallSuccessRate: te.overallSuccessRate },
        });
      }
    }

    // Prompt quality suggestions
    if (analysis.promptQuality) {
      const pq = analysis.promptQuality;

      if (pq.vagueRate > 0.3 && pq.totalUserMessages > 2) {
        suggestions.push({
          id: uid(),
          category: "prompt_quality",
          severity: "medium",
          title: `High rate of vague prompts: ${roundTo(pq.vagueRate * 100, 0)}%`,
          description: `${pq.vagueCount} of ${pq.totalUserMessages} user messages were flagged as vague or lacking context. This leads to clarification overhead.`,
          action: "Guide users to include file paths, error messages, and expected outcomes",
          metadata: { vagueRate: pq.vagueRate, vagueCount: pq.vagueCount },
        });
      }

      if (pq.clarificationRequests >= 2) {
        suggestions.push({
          id: uid(),
          category: "prompt_quality",
          severity: "medium",
          title: `${pq.clarificationRequests} clarification requests in this session`,
          description: `The assistant had to ask for clarification ${pq.clarificationRequests} times, indicating insufficient initial context.`,
          action: "Consider prompting users to include error logs and file references upfront",
          metadata: { clarificationRequests: pq.clarificationRequests },
        });
      }

      // Check for very short prompts early in session
      const earlyVague = pq.assessments.filter(
        (a, idx) => a.isVague && idx < 3
      );
      if (earlyVague.length >= 2) {
        suggestions.push({
          id: uid(),
          category: "prompt_quality",
          severity: "low",
          title: "Session started with multiple vague prompts",
          description: `The first few messages lacked specificity. A better onboarding prompt template could help.`,
          action: "Add a prompt template asking for context (files, logs, expected behavior)",
          metadata: { earlyVagueCount: earlyVague.length },
        });
      }
    }

    // Error pattern suggestions
    if (analysis.errorPatterns) {
      const ep = analysis.errorPatterns;

      if (ep.totalErrors > 0) {
        const topCat = ep.mostFrequentCategory;
        if (topCat) {
          suggestions.push({
            id: uid(),
            category: "error_pattern",
            severity: ep.categories[0].count > 3 ? "high" : "medium",
            title: `Most common error category: ${topCat} (${ep.categories[0].count} occurrences)`,
            description: `The "${topCat}" error type appears most frequently. Addressing this category would yield the largest reliability improvement.`,
            action: topCat === "timeout"
              ? "Increase timeouts and add retry logic"
              : topCat === "not_found"
                ? "Add existence checks before file operations"
                : topCat === "permission"
                  ? "Add permission pre-checks and user-friendly error messages"
                  : topCat === "validation"
                    ? "Add input validation before tool execution"
                    : `Investigate and fix root causes of "${topCat}" errors`,
            metadata: { topCategory: topCat, count: ep.categories[0].count },
          });
        }

        if (ep.cascadingErrors > 0) {
          suggestions.push({
            id: uid(),
            category: "error_pattern",
            severity: "high",
            title: `${ep.cascadingErrors} cascading errors detected`,
            description: `Errors are propagating through the session without proper recovery. Consider adding circuit breakers or early exits on consecutive failures.`,
            action: "Implement circuit breaker pattern: after 2 consecutive errors, pause and reassess",
            metadata: { cascadingErrors: ep.cascadingErrors },
          });
        }

        if (ep.recoveryPatterns.recoveryRate < 0.3 && ep.totalErrors > 1) {
          suggestions.push({
            id: uid(),
            category: "error_recovery",
            severity: "medium",
            title: `Low error recovery rate: ${roundTo(ep.recoveryPatterns.recoveryRate * 100, 0)}%`,
            description: `Only ${ep.recoveryPatterns.attempts} of ${ep.totalErrors} errors had successful recovery attempts.`,
            action: "Add automatic retry+recovery strategies for the most common error categories",
            metadata: { recoveryRate: ep.recoveryPatterns.recoveryRate },
          });
        }
      }
    }

    // Latency suggestions
    if (analysis.latency) {
      const lat = analysis.latency;

      if (lat.slowOperationCount > 0) {
        suggestions.push({
          id: uid(),
          category: "performance",
          severity: "medium",
          title: `${lat.slowOperationCount} slow operations detected (>${this._thresholds.highLatencyMs}ms)`,
          description: `The slowest operation took ${lat.maxLatencyMs}ms. Avg latency: ${lat.avgLatencyMs}ms.`,
          action: "Profile slow tools and add caching or parallel execution where possible",
          metadata: {
            slowOperationCount: lat.slowOperationCount,
            maxLatencyMs: lat.maxLatencyMs,
          },
        });
      }

      if (lat.worstTool && lat.worstTool.avgDurationMs > this._thresholds.highLatencyMs) {
        suggestions.push({
          id: uid(),
          category: "performance",
          severity: "high",
          title: `Tool "${lat.worstTool.tool}" is the slowest (avg ${lat.worstTool.avgDurationMs}ms)`,
          description: `Consider optimizing or adding a progress indicator for this tool.`,
          action: `Profile and optimize ${lat.worstTool.tool} tool execution`,
          metadata: {
            tool: lat.worstTool.tool,
            avgDurationMs: lat.worstTool.avgDurationMs,
          },
        });
      }
    }

    // Sort by severity priority: high > medium > low
    const severityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => {
      const va = a.severity in severityOrder ? severityOrder[a.severity] : 3;
      const vb = b.severity in severityOrder ? severityOrder[b.severity] : 3;
      return va - vb;
    });

    return suggestions;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _buildSummary(analysis, suggestions) {
    const highCount = suggestions.filter((s) => s.severity === "high").length;
    const mediumCount = suggestions.filter((s) => s.severity === "medium").length;
    const lowCount = suggestions.filter((s) => s.severity === "low").length;

    let overall = "good";
    if (highCount > 2 || (highCount > 0 && mediumCount > 3)) {
      overall = "needs_improvement";
    } else if (highCount > 0 || mediumCount > 2) {
      overall = "fair";
    }

    return {
      totalSuggestions: suggestions.length,
      bySeverity: { high: highCount, medium: mediumCount, low: lowCount },
      overall,
      topCategory: analysis.errorPatterns?.mostFrequentCategory || null,
    };
  }
}

module.exports = { FeedbackCollector };
