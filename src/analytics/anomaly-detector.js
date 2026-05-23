"use strict";

/**
 * AnomalyDetector — detects unusual agent behaviour in conversation
 * transcripts by scanning for signal deviations across five dimensions:
 *
 *   1. Unusual tool sequence — tool calls in unexpected order/non-standard combos
 *   2. Excessive retries      — same tool called > N times with errors
 *   3. Sudden topic shift    — content-length or focus changes dramatically
 *   4. Token spike           — token usage jumps beyond typical variance
 *   5. Silence gap           — unusually long gaps between messages
 *
 * Each anomaly carries a severity rating: LOW, MEDIUM, HIGH, CRITICAL.
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

function mean(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function stddev(list, avg) {
  if (!Array.isArray(list) || list.length < 2) return 0;
  const m = avg !== undefined ? avg : mean(list);
  const sqDiffs = list.map((v) => Math.pow(v - m, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / list.length);
}

function parseUsageToken(usage, ...keys) {
  if (!usage) return 0;
  for (const key of keys) {
    if (Number.isFinite(usage[key])) return usage[key];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Known tool sequences that are "normal" so we can flag deviations
// ---------------------------------------------------------------------------

const NORMAL_BIGRAMS = new Set([
  "file.read|file.edit",
  "file.read|grep",
  "file.read|shell.run",
  "grep|file.read",
  "glob|file.read",
  "file.edit|shell.run",
  "shell.run|file.read",
  "shell.run|file.edit",
  "test.run|file.edit",
  "web.search|web.fetch",
  "memory.retrieve|memory.store",
  "git.status|git.commit",
  "git.commit|git.push",
]);

const AGGRESSIVE_TOOLS = new Set([
  "file.write",
  "git.push",
  "git.reset",
  "shell.run",
]);

// ---------------------------------------------------------------------------
// AnomalyDetector
// ---------------------------------------------------------------------------

const SEVERITY_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const RETRY_THRESHOLD = 3;           // Same tool + isError ≥ N times → excessive
const TOKEN_SPIKE_FACTOR = 3.0;      // Stddev multiplier for token spike
const SILENCE_GAP_MINUTES = 10;      // Minutes of inactivity considered anomalous
const TOPIC_SHIFT_RATIO = 3.0;       // Content-length ratio that signals topic shift
const AGGRESSIVE_TOOL_LIMIT = 5;     // More than N aggressive tool calls is anomalous

/**
 * Detects anomalous patterns in agent conversation sessions.
 */
class AnomalyDetector {
  /**
   * @param {object} [options]
   * @param {number} [options.retryThreshold]       — max same-tool errors before anomalous
   * @param {number} [options.tokenSpikeFactor]     — stddev multiplier for token spikes
   * @param {number} [options.silenceGapMinutes]    — inactivity threshold in minutes
   * @param {number} [options.topicShiftRatio]      — content-length ratio threshold
   * @param {number} [options.aggressiveToolLimit]  — max dangerous tool calls
   */
  constructor(options = {}) {
    this._retryThreshold = options.retryThreshold || RETRY_THRESHOLD;
    this._tokenSpikeFactor = options.tokenSpikeFactor || TOKEN_SPIKE_FACTOR;
    this._silenceGapMinutes = options.silenceGapMinutes || SILENCE_GAP_MINUTES;
    this._topicShiftRatio = options.topicShiftRatio || TOPIC_SHIFT_RATIO;
    this._aggressiveToolLimit = options.aggressiveToolLimit || AGGRESSIVE_TOOL_LIMIT;
    this._anomalies = [];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Scan a session and collect all anomalies.
   *
   * @param {object|object[]} session — session object or entry array
   * @returns {object[]} list of anomaly objects
   */
  detect(session) {
    const entries = extractEntries(session);
    this._anomalies = [];

    if (entries.length === 0) return [];

    // Run the five detectors
    this._anomalies.push(...this._detectUnusualToolSequences(entries));
    this._anomalies.push(...this._detectExcessiveRetries(entries));
    this._anomalies.push(...this._detectSuddenTopicShifts(entries));
    this._anomalies.push(...this._detectTokenSpikes(entries));
    this._anomalies.push(...this._detectSilenceGaps(entries));
    this._anomalies.push(...this._detectAggressiveToolPatterns(entries));

    // Sort by severity (most severe first), then by entry index
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    this._anomalies.sort((a, b) => {
      const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sDiff !== 0) return sDiff;
      return (a.atIndex || 0) - (b.atIndex || 0);
    });

    return this._anomalies;
  }

  /**
   * Get the list of anomalies discovered by the last detect() call.
   *
   * @returns {object[]}
   */
  getAnomalies() {
    return this._anomalies;
  }

  /**
   * Get anomalies grouped by category.
   *
   * @returns {object} { toolSequence: [...], excessiveRetries: [...], ... }
   */
  getAnomaliesByCategory() {
    const grouped = {
      unusualToolSequence: [],
      excessiveRetries: [],
      suddenTopicShift: [],
      tokenSpike: [],
      silenceGap: [],
      aggressiveToolPattern: [],
    };

    for (const a of this._anomalies) {
      if (grouped[a.type]) {
        grouped[a.type].push(a);
      }
    }

    return grouped;
  }

  /**
   * Get the severity level of an anomaly.
   *
   * @param {object} anomaly — single anomaly object returned by detect()
   * @returns {string} "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
   */
  getSeverity(anomaly) {
    if (!anomaly || !anomaly.severity) return SEVERITY_LEVELS.LOW;
    return anomaly.severity;
  }

  /**
   * Get a summary count by severity.
   *
   * @returns {object} { LOW: n, MEDIUM: n, HIGH: n, CRITICAL: n, total: n }
   */
  getSeveritySummary() {
    const summary = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, total: 0 };
    for (const a of this._anomalies) {
      if (summary[a.severity] !== undefined) {
        summary[a.severity] += 1;
        summary.total += 1;
      }
    }
    return summary;
  }

  // -------------------------------------------------------------------------
  // Detector 1: Unusual tool sequence
  // -------------------------------------------------------------------------

  _detectUnusualToolSequences(entries) {
    const toolEntries = [];
    for (let i = 0; i < entries.length; i++) {
      if (isToolMsg(entries[i])) {
        toolEntries.push({ ...entries[i], _idx: i });
      }
    }

    if (toolEntries.length < 2) return [];

    const anomalies = [];

    for (let i = 0; i < toolEntries.length - 1; i++) {
      const current = toolEntries[i].name || "(unnamed)";
      const next = toolEntries[i + 1].name || "(unnamed)";
      const bigram = `${current}|${next}`;

      if (NORMAL_BIGRAMS.has(bigram)) continue;

      // Self-call (same tool called back-to-back with no assistant in between)
      if (current === next) {
        // Some self-calls are normal (e.g., shell.run → shell.run)
        // but triple self-calls are suspicious
        if (
          i < toolEntries.length - 2 &&
          (toolEntries[i + 2].name || "(unnamed)") === current
        ) {
          anomalies.push({
            type: "unusualToolSequence",
            severity: SEVERITY_LEVELS.HIGH,
            atIndex: toolEntries[i]._idx,
            message: `Tool "${current}" called 3+ times consecutively without assistant intervention`,
            details: { tool: current, count: 3, consecutive: true },
          });
          i += 1; // Skip ahead to avoid duplicate reports
        }
      }

      // Cross-category odd combinations
      if (/^(file\.|shell\.|test\.)/.test(current) && /^(web\.|docs\.|diagram\.)/.test(next)) {
        anomalies.push({
          type: "unusualToolSequence",
          severity: SEVERITY_LEVELS.MEDIUM,
          atIndex: toolEntries[i]._idx,
          message: `Unusual transition from "${current}" to "${next}" — cross-domain jump`,
          details: { from: current, to: next, bigram },
        });
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Detector 2: Excessive retries
  // -------------------------------------------------------------------------

  _detectExcessiveRetries(entries) {
    // Count consecutive errors per tool
    const streaks = {};
    const anomalies = [];

    let currentStreakTool = null;
    let currentStreakCount = 0;
    let streakStartIdx = -1;

    for (let i = 0; i < entries.length; i++) {
      if (isErrorTool(entries[i])) {
        const name = entries[i].name || "(unnamed)";
        if (name === currentStreakTool) {
          currentStreakCount += 1;
        } else {
          // Finalize previous streak if it was significant
          if (currentStreakTool && currentStreakCount >= this._retryThreshold) {
            streaks[currentStreakTool] = (streaks[currentStreakTool] || 0) + currentStreakCount;
            anomalies.push({
              type: "excessiveRetries",
              severity: currentStreakCount >= 6
                ? SEVERITY_LEVELS.CRITICAL
                : SEVERITY_LEVELS.HIGH,
              atIndex: streakStartIdx,
              message: `Excessive retries on "${currentStreakTool}": ${currentStreakCount} consecutive error attempts`,
              details: { tool: currentStreakTool, attempts: currentStreakCount, consecutive: true },
            });
          }
          currentStreakTool = name;
          currentStreakCount = 1;
          streakStartIdx = i;
        }
      } else if (isToolMsg(entries[i]) && !entries[i].isError) {
        // Successful tool call breaks the streak
        if (currentStreakTool && currentStreakCount >= this._retryThreshold) {
          streaks[currentStreakTool] = (streaks[currentStreakTool] || 0) + currentStreakCount;
          anomalies.push({
            type: "excessiveRetries",
            severity: currentStreakCount >= 6
              ? SEVERITY_LEVELS.CRITICAL
              : SEVERITY_LEVELS.HIGH,
            atIndex: streakStartIdx,
            message: `Excessive retries on "${currentStreakTool}": ${currentStreakCount} error attempts`,
            details: { tool: currentStreakTool, attempts: currentStreakCount, consecutive: true },
          });
        }
        currentStreakTool = null;
        currentStreakCount = 0;
        streakStartIdx = -1;
      }
    }

    // Finalize last streak
    if (currentStreakTool && currentStreakCount >= this._retryThreshold) {
      streaks[currentStreakTool] = (streaks[currentStreakTool] || 0) + currentStreakCount;
      anomalies.push({
        type: "excessiveRetries",
        severity: currentStreakCount >= 6
          ? SEVERITY_LEVELS.CRITICAL
          : SEVERITY_LEVELS.HIGH,
        atIndex: streakStartIdx,
        message: `Excessive retries on "${currentStreakTool}": ${currentStreakCount} consecutive error attempts`,
        details: { tool: currentStreakTool, attempts: currentStreakCount, consecutive: true },
      });
    }

    // Also detect non-consecutive but frequent same-tool errors
    const totalErrorCounts = {};
    for (const e of entries) {
      if (isErrorTool(e)) {
        const name = e.name || "(unnamed)";
        totalErrorCounts[name] = (totalErrorCounts[name] || 0) + 1;
      }
    }

    for (const [tool, count] of Object.entries(totalErrorCounts)) {
      if (count >= this._retryThreshold + 2 && !anomalies.some((a) => a.details.tool === tool)) {
        anomalies.push({
          type: "excessiveRetries",
          severity: SEVERITY_LEVELS.LOW,
          atIndex: 0,
          message: `Repeated errors on "${tool}": ${count} total error calls (non-consecutive)`,
          details: { tool, attempts: count, consecutive: false },
        });
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Detector 3: Sudden topic shift
  // -------------------------------------------------------------------------

  _detectSuddenTopicShifts(entries) {
    const contentMsgs = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!isUserMsg(e) && !isAssistantMsg(e)) continue;
      if (typeof e.content !== "string") continue;
      const len = e.content.length;
      if (len < 5) continue; // Skip very short messages
      contentMsgs.push({ ...e, _idx: i, _len: len });
    }

    if (contentMsgs.length < 3) return [];

    // Collect lengths to compute mean + stddev
    const lengths = contentMsgs.map((m) => m._len);
    const avg = mean(lengths);
    const sd = stddev(lengths, avg);
    if (sd === 0 && avg === 0) return [];

    const anomalies = [];

    for (let i = 1; i < contentMsgs.length; i++) {
      const prevLen = contentMsgs[i - 1]._len;
      const currLen = contentMsgs[i]._len;

      if (prevLen === 0) continue;

      const ratio = Math.max(prevLen / currLen, currLen / prevLen);

      if (ratio >= this._topicShiftRatio) {
        const direction = currLen > prevLen ? "lengthened" : "shortened";
        const normalizedDev = sd > 0 ? Math.abs(currLen - avg) / sd : 0;
        const magnitude = normalizedDev > 2.5 ? "extreme" : normalizedDev > 1.5 ? "moderate" : "mild";

        const severity = normalizedDev > 2.5
          ? SEVERITY_LEVELS.HIGH
          : normalizedDev > 1.8
            ? SEVERITY_LEVELS.MEDIUM
            : SEVERITY_LEVELS.LOW;

        anomalies.push({
          type: "suddenTopicShift",
          severity,
          atIndex: contentMsgs[i]._idx,
          message: `Message content ${direction} dramatically (${roundTo(ratio, 2)}x) at index ${contentMsgs[i]._idx} (${magnitude} deviation)`,
          details: {
            fromLength: prevLen,
            toLength: currLen,
            ratio: roundTo(ratio, 2),
            magnitude,
            role: contentMsgs[i].role,
          },
        });

        // Only flag the most significant shifts (max 3 per session)
        if (anomalies.length >= 3) break;
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Detector 4: Token spike
  // -------------------------------------------------------------------------

  _detectTokenSpikes(entries) {
    // Extract token usage per entry that has it
    const tokenEntries = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].usage) {
        const input = parseUsageToken(
          entries[i].usage,
          "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"
        );
        const output = parseUsageToken(
          entries[i].usage,
          "output_tokens", "outputTokens", "completion_tokens", "completionTokens"
        );
        if (input > 0 || output > 0) {
          tokenEntries.push({
            _idx: i,
            input,
            output,
            total: input + output,
          });
        }
      }
    }

    if (tokenEntries.length < 3) return [];

    const totals = tokenEntries.map((t) => t.total);
    const avg = mean(totals);
    const sd = stddev(totals, avg);
    if (sd === 0) return [];

    const anomalies = [];

    for (const te of tokenEntries) {
      const deviation = Math.abs(te.total - avg) / sd;

      if (deviation >= this._tokenSpikeFactor) {
        const direction = te.total > avg ? "spike" : "drop";
        const severity = deviation >= 5
          ? SEVERITY_LEVELS.CRITICAL
          : deviation >= 4
            ? SEVERITY_LEVELS.HIGH
            : SEVERITY_LEVELS.MEDIUM;

        anomalies.push({
          type: "tokenSpike",
          severity,
          atIndex: te._idx,
          message: `Token ${direction} detected: ${te.total} tokens (${roundTo(deviation, 2)} stddev from mean ${roundTo(avg, 0)})`,
          details: {
            inputTokens: te.input,
            outputTokens: te.output,
            totalTokens: te.total,
            mean: roundTo(avg, 0),
            stddev: roundTo(sd, 0),
            deviation: roundTo(deviation, 2),
            direction,
          },
        });
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Detector 5: Silence gap
  // -------------------------------------------------------------------------

  _detectSilenceGaps(entries) {
    // Find gaps between entries
    const gaps = [];
    for (let i = 1; i < entries.length; i++) {
      const prevTs = parseTs(entries[i - 1]);
      const currTs = parseTs(entries[i]);
      if (prevTs !== null && currTs !== null) {
        gaps.push({ beforeIdx: i - 1, afterIdx: i, gapMs: currTs - prevTs });
      }
    }

    if (gaps.length === 0) return [];

    const gapValues = gaps.map((g) => g.gapMs);
    const avgGap = mean(gapValues);
    const sdGap = stddev(gapValues, avgGap);

    const thresholdMs = this._silenceGapMinutes * 60 * 1000;
    const anomalies = [];

    // Flag gaps that exceed the absolute threshold
    for (const gap of gaps) {
      if (gap.gapMs >= thresholdMs) {
        const minutes = roundTo(gap.gapMs / 60000, 1);
        const relativeDev = (avgGap > 0 && sdGap > 0)
          ? (gap.gapMs - avgGap) / sdGap
          : 0;

        const severity = gap.gapMs >= thresholdMs * 3
          ? SEVERITY_LEVELS.CRITICAL
          : gap.gapMs >= thresholdMs * 2
            ? SEVERITY_LEVELS.HIGH
            : SEVERITY_LEVELS.MEDIUM;

        anomalies.push({
          type: "silenceGap",
          severity,
          atIndex: gap.beforeIdx,
          message: `Silence gap of ${minutes} minutes between entries ${gap.beforeIdx} and ${gap.afterIdx} (${roundTo(relativeDev, 2)}σ from mean)`,
          details: {
            gapMinutes: minutes,
            gapMs: gap.gapMs,
            beforeIndex: gap.beforeIdx,
            afterIndex: gap.afterIdx,
            avgGapMs: roundTo(avgGap, 0),
          },
        });
      }
    }

    // Also check for trailing silence (stalled at end)
    const lastEntry = entries[entries.length - 1];
    const lastTs = parseTs(lastEntry);
    if (lastTs !== null) {
      const trailingMs = Date.now() - lastTs;
      if (trailingMs >= thresholdMs * 6) {
        // 60+ minutes trailing
        anomalies.push({
          type: "silenceGap",
          severity: SEVERITY_LEVELS.CRITICAL,
          atIndex: entries.length - 1,
          message: `Session appears abandoned: no activity for ${roundTo(trailingMs / 60000, 1)} minutes after last entry`,
          details: {
            trailingMs,
            trailingMinutes: roundTo(trailingMs / 60000, 1),
            lastEntryIndex: entries.length - 1,
          },
        });
      } else if (trailingMs >= thresholdMs * 2) {
        anomalies.push({
          type: "silenceGap",
          severity: SEVERITY_LEVELS.MEDIUM,
          atIndex: entries.length - 1,
          message: `Extended pause: no activity for ${roundTo(trailingMs / 60000, 1)} minutes after last entry`,
          details: {
            trailingMs,
            trailingMinutes: roundTo(trailingMs / 60000, 1),
            lastEntryIndex: entries.length - 1,
          },
        });
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------------------
  // Detector 6: Aggressive tool patterns
  // -------------------------------------------------------------------------

  _detectAggressiveToolPatterns(entries) {
    // Count aggressive tool calls
    const aggressiveCalls = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!isToolMsg(e) || e.isError) continue;
      const name = e.name || "";
      if (AGGRESSIVE_TOOLS.has(name)) {
        aggressiveCalls.push({ ...e, _idx: i });
      }
    }

    if (aggressiveCalls.length < this._aggressiveToolLimit) return [];

    const anomalies = [];

    anomalies.push({
      type: "aggressiveToolPattern",
      severity: aggressiveCalls.length >= this._aggressiveToolLimit * 2
        ? SEVERITY_LEVELS.HIGH
        : SEVERITY_LEVELS.MEDIUM,
      atIndex: aggressiveCalls[0]._idx,
      message: `High volume of aggressive tool calls: ${aggressiveCalls.length} instances of potentially destructive operations (limit: ${this._aggressiveToolLimit})`,
      details: {
        count: aggressiveCalls.length,
        tools: [...new Set(aggressiveCalls.map((c) => c.name || ""))],
        limit: this._aggressiveToolLimit,
      },
    });

    // Check for file.write followed by file.write without read → dangerous pattern
    const toolNames = entries
      .filter((e) => isToolMsg(e) && !e.isError)
      .map((e) => e.name || "");

    let writeWithoutRead = 0;
    for (let i = 1; i < toolNames.length; i++) {
      if (toolNames[i] === "file.write" && toolNames[i - 1] === "file.write") {
        writeWithoutRead += 1;
      }
    }

    if (writeWithoutRead >= 3) {
      anomalies.push({
        type: "aggressiveToolPattern",
        severity: SEVERITY_LEVELS.HIGH,
        atIndex: 0,
        message: `Dangerous pattern: ${writeWithoutRead + 1} consecutive file.write calls without intermediate file.read`,
        details: { consecutiveWrites: writeWithoutRead + 1 },
      });
    }

    return anomalies;
  }
}

module.exports = {
  AnomalyDetector,
  SEVERITY_LEVELS,
  RETRY_THRESHOLD,
  TOKEN_SPIKE_FACTOR,
  SILENCE_GAP_MINUTES,
  TOPIC_SHIFT_RATIO,
  AGGRESSIVE_TOOL_LIMIT,
  NORMAL_BIGRAMS,
  AGGRESSIVE_TOOLS,
};
