"use strict";

/**
 * ConversationPredictor — heuristics-based prediction engine that estimates
 * session outcomes, remaining duration, and tool needs from transcript data.
 *
 * Uses lightweight heuristics rather than requiring a trained ML model:
 *   - error patterns (count, clustering, repeated failures)
 *   - tool-usage velocity (call rate, success ratio per window)
 *   - message complexity (content length trends)
 *   - session rhythm (inter-message gaps, turn tempo)
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractEntries(session) {
  if (Array.isArray(session)) return session;
  if (session && Array.isArray(session.entries)) return session.entries;
  if (session && typeof session.entries === "function") return session.entries();
  return [];
}

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

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

function getContentLength(entry) {
  return typeof entry.content === "string" ? entry.content.length : 0;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeAvg(list, fallback = 0) {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function variance(list, mean) {
  if (!Array.isArray(list) || list.length < 2) return 0;
  const m = mean !== undefined ? mean : safeAvg(list);
  return list.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / list.length;
}

// ---------------------------------------------------------------------------
// ConversationPredictor
// ---------------------------------------------------------------------------

const CONFIDENCE_WEIGHTS = {
  errorRate: 0.30,
  toolVelocity: 0.25,
  messageComplexity: 0.20,
  sessionRhythm: 0.15,
  recentTrend: 0.10,
};

const SUCCESS_THRESHOLD = 0.60;
const FAILURE_THRESHOLD = 0.35;

const KNOWN_TOOLS = [
  "file.read",
  "file.write",
  "file.edit",
  "shell.run",
  "grep",
  "glob",
  "web.fetch",
  "web.search",
  "task.create",
  "task.run",
  "memory.store",
  "memory.retrieve",
  "memory.evict",
  "agent.invoke",
  "git.commit",
  "git.push",
  "git.status",
  "diagram.render",
  "test.run",
  "docs.read",
];

const TOOL_TRANSITIONS = {
  // Tools commonly used as follow-ups
  "file.read": ["file.edit", "file.write", "grep"],
  "file.edit": ["file.read", "shell.run", "test.run"],
  "shell.run": ["file.read", "file.edit", "shell.run"],
  "grep": ["file.read", "file.edit"],
  "glob": ["file.read"],
  "test.run": ["file.edit", "file.read"],
  "memory.retrieve": ["memory.store"],
  "web.search": ["web.fetch"],
  "web.fetch": ["web.search"],
};

/**
 * Predicts conversation outcomes using heuristic analysis of transcript data.
 */
class ConversationPredictor {
  /**
   * @param {object} [options]
   * @param {object} [options.weights] — override heuristic weights
   * @param {number} [options.successThreshold] — score above which success predicted
   * @param {number} [options.failureThreshold] — score below which failure predicted
   */
  constructor(options = {}) {
    this._weights = { ...CONFIDENCE_WEIGHTS, ...(options.weights || {}) };
    this._successThreshold = options.successThreshold || SUCCESS_THRESHOLD;
    this._failureThreshold = options.failureThreshold || FAILURE_THRESHOLD;
    this._lastConfidence = null;
    this._lastPrediction = null;
    this._toolNeedCache = null;
    this._toolNeedScores = null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Predict whether the session will succeed (score 0–1).
   *
   * @param {object|object[]} session — session object or entry array
   * @returns {object} { score, prediction, factors }
   */
  predictSuccess(session) {
    const entries = extractEntries(session);
    if (entries.length === 0) {
      this._lastConfidence = 0;
      this._lastPrediction = { score: 0.50, prediction: "uncertain", factors: {} };
      return this._lastPrediction;
    }

    // --- Factor 1: Error rate & pattern ---
    const errorScore = this._evaluateErrorPatterns(entries);

    // --- Factor 2: Tool usage velocity ---
    const velocityScore = this._evaluateToolVelocity(entries);

    // --- Factor 3: Message complexity ---
    const complexityScore = this._evaluateMessageComplexity(entries);

    // --- Factor 4: Session rhythm ---
    const rhythmScore = this._evaluateSessionRhythm(entries);

    // --- Factor 5: Recent trend (last 20% of session) ---
    const recentScore = this._evaluateRecentTrend(entries);

    const w = this._weights;
    const weightedScore = roundTo(
      (errorScore * w.errorRate +
        velocityScore * w.toolVelocity +
        complexityScore * w.messageComplexity +
        rhythmScore * w.sessionRhythm +
        recentScore * w.recentTrend) /
        (w.errorRate + w.toolVelocity + w.messageComplexity + w.sessionRhythm + w.recentTrend),
      4
    );

    let prediction;
    if (weightedScore >= this._successThreshold) {
      prediction = "success";
    } else if (weightedScore <= this._failureThreshold) {
      prediction = "failure";
    } else {
      prediction = "uncertain";
    }

    this._lastConfidence = this._calculateConfidence(entries, weightedScore);
    this._lastPrediction = {
      score: weightedScore,
      prediction,
      factors: {
        errorPatterns: roundTo(errorScore, 3),
        toolVelocity: roundTo(velocityScore, 3),
        messageComplexity: roundTo(complexityScore, 3),
        sessionRhythm: roundTo(rhythmScore, 3),
        recentTrend: roundTo(recentScore, 3),
      },
      confidence: this._lastConfidence,
    };

    return this._lastPrediction;
  }

  /**
   * Estimate remaining session duration (ms).
   *
   * @param {object|object[]} session — session object or entry array
   * @returns {object} { estimatedMs, confidence, reasoning }
   */
  predictDuration(session) {
    const entries = extractEntries(session);
    if (entries.length < 2) {
      return { estimatedMs: 0, confidence: 0, reasoning: "insufficient data (fewer than 2 entries)" };
    }

    const timestamps = entries
      .map(parseTs)
      .filter((t) => t !== null);

    if (timestamps.length < 2) {
      return { estimatedMs: 0, confidence: 0, reasoning: "insufficient timestamp data" };
    }

    const elapsedMs = Math.max(0, timestamps[timestamps.length - 1] - timestamps[0]);
    const userMsgs = entries.filter((e) => isUserMsg(e));
    const usableTurns = userMsgs.length > 0 ? userMsgs.length : 1;

    // Average time per user turn
    const avgTimePerTurn = elapsedMs / usableTurns;

    // Estimate remaining turns from error/complexity signals
    const errorTools = entries.filter((e) => isErrorTool(e)).length;
    const complexity = safeAvg(
      entries.filter((e) => isUserMsg(e) || isAssistantMsg(e)).map(getContentLength),
      200
    );

    // Heuristic: more errors → more remaining turns needed
    // Higher complexity → more deliberate pacing
    const baseRemaining = 4;
    const errorPenalty = Math.min(errorTools * 2, 10);
    const complexityFactor = Math.min(Math.floor(complexity / 150), 6);
    const estimatedRemainingTurns = baseRemaining + errorPenalty + complexityFactor;

    // Discount for sessions that are already resolving
    const recencyFactor = this._evaluateRecentTrend(entries);
    const adjustedTurns = Math.round(estimatedRemainingTurns * (2 - recencyFactor));

    const estimatedMs = Math.round(adjustedTurns * avgTimePerTurn);

    // Confidence based on data quantity
    const dataAdequacy = clamp(usableTurns / 5, 0.3, 1.0);
    const confidence = roundTo(dataAdequacy * recencyFactor, 2);

    return {
      estimatedMs,
      estimatedRemainingTurns: adjustedTurns,
      avgTimePerTurnMs: roundTo(avgTimePerTurn, 0),
      elapsedMs,
      confidence,
      reasoning: `avg ${roundTo(avgTimePerTurn / 1000, 1)}s/turn, ~${adjustedTurns} remaining turns (${errorTools} errors, comp=${Math.round(complexity)})`,
    };
  }

  /**
   * Predict which tools the session will need next.
   *
   * @param {object|object[]} session — session object or entry array
   * @returns {object} { predictions, confidence }
   */
  predictToolNeeds(session) {
    const entries = extractEntries(session);
    if (entries.length === 0) {
      return { predictions: [], confidence: 0 };
    }

    // Score every known tool based on several signals
    const scores = {};

    for (const toolName of KNOWN_TOOLS) {
      scores[toolName] = 0;
    }

    // Signal 1: Previously used tools are likely to recur
    const toolCounts = {};
    const toolErrors = {};
    const toolSuccesses = {};

    for (const e of entries) {
      if (!isToolMsg(e)) continue;
      const name = e.name || "";
      toolCounts[name] = (toolCounts[name] || 0) + 1;
      if (e.isError) {
        toolErrors[name] = (toolErrors[name] || 0) + 1;
      } else {
        toolSuccesses[name] = (toolSuccesses[name] || 0) + 1;
      }
    }

    // Base score from usage frequency
    const maxCount = Math.max(1, ...Object.values(toolCounts));
    for (const [name, count] of Object.entries(toolCounts)) {
      if (scores[name] !== undefined) {
        scores[name] += (count / maxCount) * 0.4;
      }
    }

    // Signal 2: Failed tools need retry
    for (const [name, errCount] of Object.entries(toolErrors)) {
      if (scores[name] !== undefined && errCount > 0) {
        scores[name] += Math.min(errCount / 2, 1) * 0.3;
      }
    }

    // Signal 3: Successful tools with no errors are likely done
    for (const [name, count] of Object.entries(toolCounts)) {
      const errs = toolErrors[name] || 0;
      if (errs === 0 && count >= 2 && scores[name] !== undefined) {
        scores[name] -= 0.15; // Diminishing returns on repeated success
      }
    }

    // Signal 4: Transitional prediction — based on most recent successful tool
    const recentTools = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (isToolMsg(entries[i]) && !entries[i].isError) {
        recentTools.push(entries[i].name || "");
      }
      if (recentTools.length >= 3) break;
    }

    if (recentTools.length > 0) {
      const lastTool = recentTools[0];
      const nextTools = TOOL_TRANSITIONS[lastTool] || [];
      for (const next of nextTools) {
        if (scores[next] !== undefined) {
          scores[next] += 0.25;
        }
      }
    }

    // Signal 5: Recent assistant messages may contain tool call mentions
    const recentAssistantContent = [];
    for (let i = entries.length - 1; i >= 0 && recentAssistantContent.length < 3; i--) {
      if (isAssistantMsg(entries[i]) && typeof entries[i].content === "string") {
        recentAssistantContent.push(entries[i].content.toLowerCase());
      }
    }

    const contentHints = recentAssistantContent.join(" ");
    for (const toolName of KNOWN_TOOLS) {
      if (contentHints.includes(toolName.toLowerCase())) {
        scores[toolName] += 0.2;
      }
    }

    // Build sorted predictions
    const predictions = KNOWN_TOOLS
      .filter((name) => scores[name] > 0)
      .map((name) => ({ name, score: roundTo(clamp(scores[name], 0, 1), 3) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Confidence decays with fewer tool interactions seen
    const toolEventsSeen = Object.keys(toolCounts).length;
    const confidence = roundTo(clamp(toolEventsSeen / 5, 0.2, 1.0), 2);

    this._toolNeedCache = predictions;
    this._toolNeedScores = scores;

    return { predictions, confidence };
  }

  /**
   * Get the confidence level of the last prediction.
   *
   * @returns {object|null} { level, value, dataPoints }
   */
  getConfidence() {
    if (this._lastConfidence === null) {
      return null;
    }
    return this._lastConfidence;
  }

  /**
   * Get the complete last prediction with factors.
   *
   * @returns {object|null}
   */
  getLastPrediction() {
    return this._lastPrediction;
  }

  // -------------------------------------------------------------------------
  // Factor evaluators
  // -------------------------------------------------------------------------

  _evaluateErrorPatterns(entries) {
    const toolEntries = entries.filter((e) => isToolMsg(e));
    const errorEntries = toolEntries.filter((e) => e.isError === true);

    // No tool calls at all — neutral
    if (toolEntries.length === 0) return 0.50;

    // No errors at all — strong positive signal
    if (errorEntries.length === 0) return 0.95;

    const errorRate = errorEntries.length / toolEntries.length;

    // Clustered errors (consecutive failures) → worse than scattered
    let consecutiveErrors = 0;
    let maxConsecutive = 0;
    for (const e of entries) {
      if (isErrorTool(e)) {
        consecutiveErrors += 1;
        maxConsecutive = Math.max(maxConsecutive, consecutiveErrors);
      } else if (isToolMsg(e)) {
        consecutiveErrors = 0;
      }
    }

    const clusterPenalty = maxConsecutive >= 3 ? 0.25 : maxConsecutive >= 2 ? 0.10 : 0;

    // Same tool erroring repeatedly → very bad signal
    const errorToolNames = {};
    let repeatedFailurePenalty = 0;
    for (const e of errorEntries) {
      const name = e.name || "(unnamed)";
      errorToolNames[name] = (errorToolNames[name] || 0) + 1;
      if (errorToolNames[name] >= 3) {
        repeatedFailurePenalty = 0.3;
      }
    }

    // Last N tool calls: are errors trending up or down?
    const recentToolCalls = toolEntries.slice(-6);
    const recentErrors = recentToolCalls.filter((e) => e.isError === true).length;
    const recentErrorRate = recentToolCalls.length > 0
      ? recentErrors / recentToolCalls.length
      : 0;

    // Composite score
    let score = 1.0 - errorRate * 2 - clusterPenalty - repeatedFailurePenalty;

    // Bias toward recent trend
    score = score * 0.4 + (1.0 - recentErrorRate) * 0.6;

    return clamp(roundTo(score, 3), 0.01, 1.0);
  }

  _evaluateToolVelocity(entries) {
    const toolMsgs = entries.filter((e) => isToolMsg(e));
    if (toolMsgs.length === 0) return 0.50;

    const userMsgs = entries.filter((e) => isUserMsg(e));
    const assistantMsgs = entries.filter((e) => isAssistantMsg(e));

    // Successful tool calls per user turn (healthy indicator)
    const successTools = toolMsgs.filter((e) => !e.isError).length;
    const turns = Math.max(userMsgs.length, 1);
    const successPerTurn = successTools / turns;

    // A healthy session has 1-3 successful tools per user turn
    let velocityScore;
    if (successPerTurn >= 1 && successPerTurn <= 4) {
      velocityScore = 0.90;
    } else if (successPerTurn > 4) {
      // Too many tools per turn — might be thrashing
      velocityScore = 0.60;
    } else {
      // Very low tool usage — maybe stuck
      velocityScore = 0.40;
    }

    // Tool-to-message ratio: very high ratio suggests tool-heavy workflow
    const totalMessages = turns + toolMsgs.length + assistantMsgs.length;
    const toolRatio = totalMessages > 0 ? toolMsgs.length / totalMessages : 0;

    // Normal range: 0.2 – 0.6 is healthy
    if (toolRatio >= 0.2 && toolRatio <= 0.6) {
      velocityScore = velocityScore * 0.7 + 0.95 * 0.3;
    } else if (toolRatio > 0.6) {
      velocityScore = velocityScore * 0.7 + 0.55 * 0.3;
    }

    return clamp(roundTo(velocityScore, 3), 0.01, 1.0);
  }

  _evaluateMessageComplexity(entries) {
    const userLengths = entries.filter((e) => isUserMsg(e)).map(getContentLength);
    const asstLengths = entries.filter((e) => isAssistantMsg(e)).map(getContentLength);

    if (userLengths.length === 0) return 0.50;

    const avgUserLen = safeAvg(userLengths, 0);
    const avgAsstLen = safeAvg(asstLengths, 0);

    // Very short messages → user disengaged, low score
    let complexityScore = 0.50;

    // User message length heuristic
    if (avgUserLen > 200) {
      complexityScore += 0.25; // Detailed requests
    } else if (avgUserLen < 30) {
      complexityScore -= 0.20; // One-liners may indicate frustration
    }

    // Assistant message length heuristic
    if (avgAsstLen > 300) {
      complexityScore += 0.10; // Detailed responses
    } else if (avgAsstLen < 50 && asstLengths.length > 2) {
      complexityScore -= 0.20; // Terse responses may indicate trouble
    }

    // Message length trend (shrinking = bad, growing = good)
    if (userLengths.length >= 3) {
      const firstHalf = userLengths.slice(0, Math.floor(userLengths.length / 2));
      const secondHalf = userLengths.slice(Math.floor(userLengths.length / 2));
      const firstAvg = safeAvg(firstHalf, avgUserLen);
      const secondAvg = safeAvg(secondHalf, avgUserLen);
      if (firstAvg > 0 && secondAvg > 0) {
        const ratio = secondAvg / firstAvg;
        if (ratio > 1.5) complexityScore += 0.10;
        else if (ratio < 0.5) complexityScore -= 0.10;
      }
    }

    return clamp(roundTo(complexityScore, 3), 0.01, 1.0);
  }

  _evaluateSessionRhythm(entries) {
    const timestamps = entries.map(parseTs).filter((t) => t !== null);
    if (timestamps.length < 3) return 0.50;

    // Compute inter-message gaps (ms)
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgGap = safeAvg(gaps, 60000);
    const gapVariance = variance(gaps, avgGap);

    // Very long gaps suggest the session is abandoned or stuck
    let rhythmScore = 0.60;

    // Average gap: <2 min = fast cadence (good), 2-10 min = normal, >10 min = slow
    if (avgGap < 2 * 60 * 1000) {
      rhythmScore += 0.20;
    } else if (avgGap > 10 * 60 * 1000) {
      rhythmScore -= 0.30;
    }

    // High variance = erratic (bad sign)
    const normalizedVariance = gapVariance / Math.max(avgGap * avgGap, 1);
    if (normalizedVariance > 5) {
      rhythmScore -= 0.15;
    } else if (normalizedVariance < 0.5) {
      rhythmScore += 0.10; // Consistent pacing
    }

    // Check for silence gap at the end (stalled session)
    const lastTs = timestamps[timestamps.length - 1];
    const now = Date.now();
    const timeSinceLast = now - lastTs;
    if (timeSinceLast > 30 * 60 * 1000) {
      // 30+ minutes since last message — likely stalled
      rhythmScore -= 0.25;
    }

    return clamp(roundTo(rhythmScore, 3), 0.01, 1.0);
  }

  _evaluateRecentTrend(entries) {
    if (entries.length < 5) return 0.50;

    const windowSize = Math.max(Math.ceil(entries.length * 0.2), 3);
    const recent = entries.slice(-windowSize);

    // Recent error presence
    const recentErrors = recent.filter((e) => isErrorTool(e)).length;
    const recentToolCount = recent.filter((e) => isToolMsg(e)).length;

    let trendScore = 0.60;

    if (recentToolCount > 0) {
      const recentErrorRate = recentErrors / recentToolCount;
      if (recentErrorRate === 0) trendScore += 0.25;
      else if (recentErrorRate > 0.5) trendScore -= 0.30;
      else trendScore -= recentErrorRate * 0.3;
    }

    // Last user message complexity
    const recentUsers = recent.filter((e) => isUserMsg(e));
    if (recentUsers.length > 0) {
      const lastUserLen = getContentLength(recentUsers[recentUsers.length - 1]);
      if (lastUserLen < 20) trendScore -= 0.10; // Frustration signal
    }

    // Look for gratitude/closing signals
    for (const e of recent) {
      if (!isUserMsg(e) && !isAssistantMsg(e)) continue;
      const content = (e.content || "").toLowerCase();
      if (/thank|great|perfect|done|resolved|works now/i.test(content)) {
        trendScore += 0.15;
        break; // One positive signal is enough
      }
    }

    return clamp(roundTo(trendScore, 3), 0.01, 1.0);
  }

  _calculateConfidence(entries, score) {
    const numEntries = entries.length;
    const numToolCalls = entries.filter((e) => isToolMsg(e)).length;
    const numUserTurns = entries.filter((e) => isUserMsg(e)).length;

    // Confidence grows with data points
    const dataPoints = numEntries + numToolCalls + numUserTurns * 2;

    let level, value;

    if (dataPoints < 10) {
      value = 0.25 + (dataPoints / 10) * 0.25;
      level = "low";
    } else if (dataPoints < 30) {
      value = 0.50 + ((dataPoints - 10) / 20) * 0.25;
      level = "medium";
    } else {
      value = 0.75 + Math.min((dataPoints - 30) / 40, 1) * 0.20;
      level = "high";
    }

    // Penalize confidence if the score is near the decision boundary
    const distanceFromBoundary = Math.min(
      Math.abs(score - this._successThreshold),
      Math.abs(score - this._failureThreshold)
    );
    if (distanceFromBoundary < 0.10) {
      value *= 0.70; // Near boundary → less confident
    }

    return {
      level,
      value: roundTo(clamp(value, 0.05, 0.95), 2),
      dataPoints,
    };
  }
}

module.exports = {
  ConversationPredictor,
  CONFIDENCE_WEIGHTS,
  SUCCESS_THRESHOLD,
  FAILURE_THRESHOLD,
  KNOWN_TOOLS,
  TOOL_TRANSITIONS,
};
