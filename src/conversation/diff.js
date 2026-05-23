"use strict";

/**
 * @fileoverview Conversation diffing, change tracking, and progress estimation.
 *
 * Operates on arrays of message objects `{ role: string, content: string }`.
 * All analysis is rule-based — no LLM dependency.
 */

const summarizer = require("./summarizer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a message list.
 * @param {*} messages
 * @returns {Array<{role: string, content: string, _index: number}>}
 */
function normalize(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m, i) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: (m && m.content !== undefined && m.content !== null)
      ? String(m.content)
      : "",
    _index: i,
  }));
}

/**
 * Compute a simple content fingerprint for de-duplication / diffing.
 * Strips whitespace and lowercases.
 * @param {string} content
 * @returns {string}
 */
function fingerprint(content) {
  return (content || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 500);
}

/**
 * Extract file paths from a message's content.
 * @param {string} content
 * @returns {string[]}
 */
function extractFilePaths(content) {
  const text = content || "";
  const paths = new Set();

  // Backtick-enclosed paths.
  const backtickPattern = /`([\w.\-/\\]+\.\w{1,6})`/g;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    paths.add(match[1]);
  }

  // Explicit "file:" or "path:" references.
  const explicitPattern = /\b(?:file|path|directory|folder)\s*:?\s*`?([\w.\-/\\]+)`?/gi;
  while ((match = explicitPattern.exec(text)) !== null) {
    paths.add(match[1].replace(/[`'"]/g, ""));
  }

  // Lines mentioning "create", "edit", "modify", "update" then a path.
  const actionPattern = /\b(?:create|edit|modif(?:y|ied)|updat(?:e|d)|delet(?:e|d)|wrote|changed|added|removed|refactored?)\s+(?:file\s+)?`?([\w.\-/\\]+\.\w{1,6})`?/gi;
  while ((match = actionPattern.exec(text)) !== null) {
    paths.add(match[1].replace(/[`'"]/g, ""));
  }

  return [...paths];
}

/**
 * Simple Levenshtein-based similarity between two strings (0-1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function textSimilarity(a, b) {
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  if (fa === fb) return 1.0;
  if (!fa || !fb) return 0.0;

  const longer = fa.length > fb.length ? fa : fb;
  const shorter = fa.length > fb.length ? fb : fa;

  if (longer.length === 0) return 1.0;

  // Simple edit-distance approximation using character overlap.
  const longerSet = new Set(longer);
  const shorterSet = new Set(shorter);
  const intersection = [...shorterSet].filter((c) => longerSet.has(c)).length;
  return intersection / longerSet.size;
}

// ---------------------------------------------------------------------------
// diffMessages
// ---------------------------------------------------------------------------

/**
 * Identify what changed between two message lists.
 *
 * Compares before/after to find:
 *  - Added messages (present in after, not in before)
 *  - Removed messages (present in before, not in after)
 *  - Modified messages (same position/role but content changed)
 *  - Reordered messages
 *
 * @param {Array<{role: string, content: *}>} before
 * @param {Array<{role: string, content: *}>} after
 * @returns {{added: Array, removed: Array, modified: Array, reordered: boolean, summary: string}}
 */
function diffMessages(before, after) {
  const normBefore = normalize(before);
  const normAfter = normalize(after);

  const beforeFP = new Map();
  for (const m of normBefore) {
    const fp = fingerprint(m.content);
    beforeFP.set(m._index, fp);
  }

  const afterFP = new Map();
  for (const m of normAfter) {
    const fp = fingerprint(m.content);
    afterFP.set(m._index, fp);
  }

  // Match by fingerprint.
  const beforeMatched = new Set();
  const afterMatched = new Set();
  const modified = [];
  const reorderCandidates = [];

  for (let ai = 0; ai < normAfter.length; ai += 1) {
    const aFP = afterFP.get(ai);
    if (!aFP) continue;

    // Try exact match at the same position first.
    if (ai < normBefore.length && beforeFP.get(ai) === aFP) {
      beforeMatched.add(ai);
      afterMatched.add(ai);
      continue;
    }

    // Look for fingerprint elsewhere in before.
    let found = false;
    for (let bi = 0; bi < normBefore.length; bi += 1) {
      if (beforeMatched.has(bi)) continue;
      if (beforeFP.get(bi) === aFP) {
        beforeMatched.add(bi);
        afterMatched.add(ai);
        reorderCandidates.push({ fromIndex: bi, toIndex: ai });
        found = true;
        break;
      }
    }

    if (!found) {
      // Check for modified (same role, similar but not identical content).
      for (let bi = 0; bi < normBefore.length; bi += 1) {
        if (beforeMatched.has(bi)) continue;
        if (normBefore[bi].role === normAfter[ai].role) {
          const sim = textSimilarity(normBefore[bi].content, normAfter[ai].content);
          if (sim > 0.5) {
            modified.push({
              beforeIndex: bi,
              afterIndex: ai,
              beforePreview: normBefore[bi].content.slice(0, 200),
              afterPreview: normAfter[ai].content.slice(0, 200),
              similarity: Math.round(sim * 100) / 100,
            });
            beforeMatched.add(bi);
            afterMatched.add(ai);
            found = true;
            break;
          }
        }
      }
    }
  }

  // Remaining unmatched in before = removed.
  const removed = [];
  for (let bi = 0; bi < normBefore.length; bi += 1) {
    if (!beforeMatched.has(bi)) {
      removed.push({
        index: bi,
        role: normBefore[bi].role,
        preview: normBefore[bi].content.slice(0, 200),
      });
    }
  }

  // Remaining unmatched in after = added.
  const added = [];
  for (let ai = 0; ai < normAfter.length; ai += 1) {
    if (!afterMatched.has(ai)) {
      added.push({
        index: ai,
        role: normAfter[ai].role,
        preview: normAfter[ai].content.slice(0, 200),
      });
    }
  }

  const reordered = reorderCandidates.length > 0;

  // Build a human-readable summary.
  const summaryParts = [];
  if (added.length > 0) summaryParts.push(`${added.length} messages added`);
  if (removed.length > 0) summaryParts.push(`${removed.length} messages removed`);
  if (modified.length > 0) summaryParts.push(`${modified.length} messages modified`);
  if (reordered) summaryParts.push("message reordering detected");
  const summaryText = summaryParts.length > 0
    ? summaryParts.join(", ") + "."
    : "No changes detected.";

  return {
    added,
    removed,
    modified,
    reordered,
    summary: summaryText,
  };
}

// ---------------------------------------------------------------------------
// detectRework
// ---------------------------------------------------------------------------

/**
 * Detect patterns that indicate wasted effort or redundant work.
 *
 * Look for:
 *  - Repeated edits to the same file (modify, revert, modify again)
 *  - Instruction correction ("no, don't do that", "actually, change it back")
 *  - Multiple attempts at the same task
 *  - Blocks of assistant output that were immediately corrected the next turn
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {{ hasRework: boolean, reworkIncidents: Array<{type: string, indices: number[], severity: "high"|"medium"|"low", description: string}>, reworkScore: number }}
 */
function detectRework(messages) {
  const normalized = normalize(messages);
  const incidents = [];

  // Pattern 1: Repeated edits to the same file.
  const fileEdits = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const paths = extractFilePaths(normalized[i].content);
    for (const path of paths) {
      fileEdits.push({ index: i, file: path, role: normalized[i].role });
    }
  }

  // Find files mentioned more than twice (suggests rework).
  const fileCounts = {};
  for (const edit of fileEdits) {
    const key = edit.file.toLowerCase();
    if (!fileCounts[key]) fileCounts[key] = [];
    fileCounts[key].push(edit.index);
  }

  for (const [file, indices] of Object.entries(fileCounts)) {
    if (indices.length >= 3) {
      incidents.push({
        type: "repeated-file-edits",
        indices,
        severity: indices.length >= 6 ? "high" : indices.length >= 4 ? "medium" : "low",
        description: `File "${file}" was referenced in ${indices.length} separate messages, suggesting repeated edits or revisions.`,
      });
    }
  }

  // Pattern 2: Correction / reversal patterns.
  const correctionPatterns = [
    /no[,.\s]*(?:don'?t|that'?s not|that is not|stop|wrong|incorrect)/i,
    /actually[,.\s]*(?:I meant|change it|do this|let'?s)/i,
    /(?:change|cancel|revert|undo|remove|delete)\s+(?:that|it|the|what)/i,
    /(?:go back|rollback|backtrack)/i,
    /(?:scratch that|never mind|nevermind|disregard)/i,
    /(?:I changed my mind|on second thought)/i,
  ];

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].role !== "user") continue;
    const text = normalized[i].content;

    for (const pattern of correctionPatterns) {
      if (pattern.test(text)) {
        // Look at the previous assistant message to see what was undone.
        const prevAsst = normalized[i - 1];
        const prevContent = prevAsst && prevAsst.role === "assistant"
          ? prevAsst.content.slice(0, 150)
          : "previous assistant work";

        incidents.push({
          type: "correction",
          indices: [i - 1, i],
          severity: "medium",
          description: `Correction detected at message ${i}: user rejected or redirected previous assistant output. Context: "${prevContent}"`,
        });
        break;
      }
    }
  }

  // Pattern 3: Repeated attempts — same or very similar user instructions
  // within a short window suggest the first attempt failed.
  for (let i = 0; i < normalized.length - 2; i += 1) {
    if (normalized[i].role !== "user") continue;
    const currentFP = fingerprint(normalized[i].content);

    for (let j = i + 1; j < Math.min(i + 4, normalized.length); j += 1) {
      if (normalized[j].role !== "user") continue;
      const otherFP = fingerprint(normalized[j].content);

      const sim = textSimilarity(normalized[i].content, normalized[j].content);
      if (sim > 0.6) {
        // Avoid duplicate reporting.
        const alreadyReported = incidents.some(
          (inc) => inc.type === "repeated-attempt" && inc.indices.includes(i),
        );
        if (!alreadyReported) {
          incidents.push({
            type: "repeated-attempt",
            indices: [i, j],
            severity: "medium",
            description: `Similar instructions repeated at messages ${i} and ${j} (similarity: ${(sim * 100).toFixed(0)}%), suggesting a retry.`,
          });
        }
        break;
      }
    }
  }

  // Compute aggregate rework score (0-100).
  let reworkScore = 0;
  for (const inc of incidents) {
    switch (inc.severity) {
      case "high": reworkScore += 30; break;
      case "medium": reworkScore += 15; break;
      case "low": reworkScore += 5; break;
    }
  }
  reworkScore = Math.min(100, reworkScore);

  return {
    hasRework: incidents.length > 0,
    reworkIncidents: incidents,
    reworkScore,
  };
}

// ---------------------------------------------------------------------------
// trackFileChanges
// ---------------------------------------------------------------------------

/**
 * Extract all file modifications referenced across a conversation.
 *
 * Detects mentions of files along with implied operations:
 * create, edit/update, delete, read, move/rename, refactor.
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{file: string, operations: Array<{op: string, index: number, role: string}>, firstMention: number, lastMention: number, mentionCount: number}>}
 */
function trackFileChanges(messages) {
  const normalized = normalize(messages);
  const fileMap = new Map();

  const opPatterns = [
    { op: "create",  re: /\b(?:create|creat(?:e|ed|ing)|new file|generate|scaffold)\b/i },
    { op: "edit",    re: /\b(?:edit|modif(?:y|ied|ies)|updat(?:e|ed|es)|chang(?:e|ed|es)|rewrit(?:e|en)|patch(?:ed)?)\b/i },
    { op: "delete",  re: /\b(?:delet(?:e|ed|es)|remov(?:e|ed|es)|rm\b|unlink)\b/i },
    { op: "read",    re: /\b(?:read|open|view|look at|examin(?:e|ed|es)|inspect(?:ed)?)\b/i },
    { op: "move",    re: /\b(?:mov(?:e|ed|es)|renam(?:e|ed|es)|relocat(?:e|ed|es))\b/i },
    { op: "refactor", re: /\b(?:refactor(?:ed|ing)?|restructur(?:e|ed|es)|reorganiz(?:e|ed|es)|clean(?:ed)?\s*up)\b/i },
    { op: "fix",     re: /\b(?:fix(?:ed|es)?|bug|resolv(?:e|ed|es))\b/i },
  ];

  for (let i = 0; i < normalized.length; i += 1) {
    const msg = normalized[i];
    const text = msg.content;
    const paths = extractFilePaths(text);

    if (paths.length === 0) continue;

    // Detect operations on these files.
    for (const path of paths) {
      const key = path.toLowerCase();
      if (!fileMap.has(key)) {
        fileMap.set(key, {
          file: path,
          operations: [],
          firstMention: i,
          lastMention: i,
          mentionCount: 0,
        });
      }

      const entry = fileMap.get(key);

      for (const { op, re } of opPatterns) {
        if (re.test(text)) {
          // Avoid duplicate operation types at the same index.
          const alreadyRecorded = entry.operations.some(
            (o) => o.op === op && o.index === i,
          );
          if (!alreadyRecorded) {
            entry.operations.push({ op, index: i, role: msg.role });
          }
        }
      }

      // If no operation was detected but the file was mentioned, mark as "mentioned".
      const hasOpForThisMsg = entry.operations.some((o) => o.index === i);
      if (!hasOpForThisMsg) {
        entry.operations.push({ op: "mentioned", index: i, role: msg.role });
      }

      entry.lastMention = i;
      entry.mentionCount += 1;
    }
  }

  // Sort entries by first mention.
  const entries = [...fileMap.values()];
  entries.sort((a, b) => a.firstMention - b.firstMention);

  return entries;
}

// ---------------------------------------------------------------------------
// buildChangeLog
// ---------------------------------------------------------------------------

/**
 * Build a chronological log of what changed during the conversation and why.
 *
 * Each entry includes:
 *  - When it happened (message index)
 *  - What files were involved
 *  - What operation was performed
 *  - Any rationale extracted from context
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {Array<{ index: number, timestamp: string|null, files: string[], operation: string, summary: string, rationale: string|null }>}
 */
function buildChangeLog(messages) {
  const normalized = normalize(messages);
  const fileChanges = trackFileChanges(normalized);
  const log = [];

  // Group operations by message index.
  const byIndex = new Map();

  for (const fc of fileChanges) {
    for (const op of fc.operations) {
      if (!byIndex.has(op.index)) {
        byIndex.set(op.index, []);
      }
      byIndex.get(op.index).push({
        file: fc.file,
        op: op.op,
        role: op.role,
      });
    }
  }

  // Build log entries sorted by index.
  const indices = [...byIndex.keys()].sort((a, b) => a - b);

  for (const idx of indices) {
    const ops = byIndex.get(idx);
    const msg = normalized[idx];

    // Determine the primary operation.
    const opCounts = {};
    for (const o of ops) {
      opCounts[o.op] = (opCounts[o.op] || 0) + 1;
    }
    const primaryOp = Object.entries(opCounts).sort((a, b) => b[1] - a[1])[0][0];

    const files = [...new Set(ops.map((o) => o.file))];

    // Build a summary sentence.
    const summary = `Message ${idx}: ${primaryOp === "mentioned" ? "Reference to" : primaryOp} ${files.length === 1 ? files[0] : `${files.length} files`} (${msg.role}).`;

    // Extract rationale from context — look at the user message right before
    // if this was an assistant action.
    let rationale = null;
    if (msg.role === "assistant" && idx > 0) {
      const prevMsg = normalized[idx - 1];
      if (prevMsg.role === "user") {
        // Extract the key ask from the user message.
        const userText = prevMsg.content.slice(0, 300).replace(/\n/g, " ").trim();
        rationale = `In response to user request: "${userText}"`;
      }
    } else if (msg.role === "user") {
      // For user-initiated changes, the message itself contains the rationale.
      rationale = msg.content.slice(0, 300).replace(/\n/g, " ").trim();
    }

    log.push({
      index: idx,
      timestamp: msg.timestamp || null,
      files,
      operation: primaryOp,
      summary,
      rationale,
    });
  }

  return log;
}

// ---------------------------------------------------------------------------
// estimateProgress
// ---------------------------------------------------------------------------

/**
 * Heuristically estimate task completion percentage from the conversation.
 *
 * Indicators of progress:
 *  - Number of files modified (more = more work done)
 *  - Assistant-to-user message ratio (high ratio = extensive work)
 *  - Presence of concluding/summary language
 *  - Last message sentiment / tone
 *  - Number of checkboxes / todo items marked complete
 *  - Conversation length (very long suggests significant progress)
 *
 * @param {Array<{role: string, content: *}>} messages
 * @returns {{ percent: number, confidence: "high"|"medium"|"low", indicators: Array<{factor: string, contribution: number}> }}
 */
function estimateProgress(messages) {
  const normalized = normalize(messages);
  const indicators = [];

  if (normalized.length === 0) {
    return { percent: 0, confidence: "high", indicators: [] };
  }

  let score = 0;
  let maxScore = 0;

  // Factor 1: File modification count.
  const fileChanges = trackFileChanges(normalized);
  const totalFileOps = fileChanges.reduce((sum, fc) => sum + fc.operations.length, 0);
  const fileScore = Math.min(40, totalFileOps * 5);
  score += fileScore;
  maxScore += 40;
  indicators.push({ factor: "file modifications", contribution: fileScore });

  // Factor 2: Assistant response richness.
  const assistantMsgs = normalized.filter((m) => m.role === "assistant");
  const totalAsstChars = assistantMsgs.reduce((sum, m) => sum + m.content.length, 0);
  const richnessScore = Math.min(20, Math.floor(totalAsstChars / 500));
  score += richnessScore;
  maxScore += 20;
  indicators.push({ factor: "assistant response volume", contribution: richnessScore });

  // Factor 3: Conclusion signals in the last few messages.
  const tailCount = Math.min(5, normalized.length);
  const tail = normalized.slice(-tailCount);
  const conclusionPatterns = [
    /\b(?:done|complete|finished|resolved|all set|good to go|ready)\b/i,
    /\b(?:that covers|that should|this should|you should be)\b/i,
    /\b(?:that'?s it|that'?s all|everything is|all (?:of )?the)/i,
    /\b(?:wrapping up|finaliz(?:e|ed)|last (?:step|thing))\b/i,
  ];
  let conclusionHits = 0;
  for (const msg of tail) {
    for (const pattern of conclusionPatterns) {
      if (pattern.test(msg.content)) conclusionHits += 1;
    }
  }
  const conclusionScore = Math.min(20, conclusionHits * 5);
  score += conclusionScore;
  maxScore += 20;
  indicators.push({ factor: "conclusion signals", contribution: conclusionScore });

  // Factor 4: Action item completion (checkbox heuristic).
  let checkboxChecked = 0;
  let checkboxTotal = 0;
  for (const msg of normalized) {
    const checked = (msg.content.match(/\[x\]/gi) || []).length;
    const unchecked = (msg.content.match(/\[ \]/g) || []).length;
    checkboxChecked += checked;
    checkboxTotal += checked + unchecked;
  }
  const checkboxRatio = checkboxTotal > 0 ? checkboxChecked / checkboxTotal : 0;
  const checkboxScore = Math.min(10, Math.floor(checkboxRatio * 10));
  score += checkboxScore;
  maxScore += 10;
  indicators.push({ factor: "checkbox completion ratio", contribution: checkboxScore });

  // Factor 5: Conversation structure (multiple rounds suggests depth).
  const roundScore = Math.min(10, Math.floor(normalized.length / 4));
  score += roundScore;
  maxScore += 10;
  indicators.push({ factor: "conversation depth", contribution: roundScore });

  // Compute percentage.
  const percent = maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : 0;

  // Determine confidence based on indicator dispersion.
  const contributions = indicators.map((i) => i.contribution);
  const hasStrongSignal = contributions.some((c) => c > 0);
  const hasMultipleSignals = contributions.filter((c) => c > 0).length >= 3;

  let confidence = "low";
  if (hasMultipleSignals && percent > 20) {
    confidence = "high";
  } else if (hasStrongSignal) {
    confidence = "medium";
  }

  return { percent, confidence, indicators };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  diffMessages,
  detectRework,
  trackFileChanges,
  buildChangeLog,
  estimateProgress,
  // Helpers exported for testing.
  _internals: {
    normalize,
    fingerprint,
    extractFilePaths,
    textSimilarity,
  },
};
