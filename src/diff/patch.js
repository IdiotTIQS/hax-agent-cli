/**
 * Unified-diff patch utilities for HaxAgent.
 *
 * Creates, applies, reverses, validates, combines, and summarizes patches
 * in standard unified diff format.
 */
"use strict";

// ---------------------------------------------------------------------------
// 1. createPatch — unified diff
// ---------------------------------------------------------------------------

/**
 * Creates a unified diff patch from old and new content.
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @param {object} [options]
 * @param {string} [options.oldLabel="a"]   - label for old file
 * @param {string} [options.newLabel="b"]   - label for new file
 * @param {number} [options.context=3]      - lines of context around hunks
 * @returns {string} unified diff patch
 */
function createPatch(oldContent, newContent, options) {
  const opts = options || {};
  const oldLabel = opts.oldLabel || "a";
  const newLabel = opts.newLabel || "b";
  const contextLen = opts.context !== undefined ? opts.context : 3;

  const oldLines = oldContent ? oldContent.replace(/\r\n/g, "\n").split("\n") : [];
  const newLines = newContent ? newContent.replace(/\r\n/g, "\n").split("\n") : [];

  const header = `--- ${oldLabel}\n+++ ${newLabel}\n`;
  const hunks = computeHunks(oldLines, newLines, contextLen);

  if (hunks.length === 0) {
    return header;
  }

  return header + hunks.map(formatHunk).join("");
}

// ---------------------------------------------------------------------------
// 2. applyPatch — applies a patch to content
// ---------------------------------------------------------------------------

/**
 * Applies a unified diff patch to content.
 *
 * @param {string} content - the content to patch
 * @param {string} patch   - the unified diff patch to apply
 * @returns {string} the patched content
 */
function applyPatch(content, patch) {
  const lines = content ? content.replace(/\r\n/g, "\n").split("\n") : [];
  const hunks = parsePatch(patch);

  // Apply hunks in reverse order so line offsets stay valid
  const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sorted) {
    const startIdx = hunk.oldStart - 1;

    // oldLines: what should be in the file at this position
    // newLines: what to replace them with
    lines.splice(startIdx, hunk.oldLines.length, ...hunk.newLines);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 3. reversePatch — creates the reverse patch
// ---------------------------------------------------------------------------

/**
 * Creates the reverse of a patch (swaps old <-> new).
 *
 * @param {string} patch
 * @returns {string} reverse patch
 */
function reversePatch(patch) {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const result = [];
  let inHunk = false;
  let oldStart = 0;
  let newStart = 0;
  let oldCount = 0;
  let newCount = 0;

  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      result.push(line);
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch) {
      oldStart = parseInt(hunkMatch[1], 10);
      oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      newStart = parseInt(hunkMatch[3], 10);
      newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
      result.push(`@@ -${newStart},${newCount} +${oldStart},${oldCount} @@`);
      inHunk = true;
      continue;
    }

    if (inHunk) {
      if (line.startsWith("+")) {
        result.push(`-${line.slice(1)}`);
      } else if (line.startsWith("-")) {
        result.push(`+${line.slice(1)}`);
      } else {
        result.push(line);
      }
    }
  }

  return result.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 4. validatePatch — checks patch integrity
// ---------------------------------------------------------------------------

/**
 * Validates a patch for syntactic correctness.
 *
 * @param {string} patch
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePatch(patch) {
  const errors = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");

  if (lines.length === 0) {
    errors.push("Patch is empty");
    return { valid: false, errors };
  }

  let i = 0;
  if (!lines[i] || !lines[i].startsWith("--- ")) {
    errors.push(`Line ${i + 1}: Expected '--- ' header`);
  }
  i++;
  if (!lines[i] || !lines[i].startsWith("+++ ")) {
    errors.push(`Line ${i + 1}: Expected '+++ ' header`);
  }
  i++;

  while (i < lines.length) {
    const line = lines[i];
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);

    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const newStart = parseInt(hunkMatch[3], 10);

      if (oldStart < 1) {
        errors.push(`Line ${i + 1}: Invalid old start line: ${oldStart}`);
      }
      if (newStart < 1) {
        errors.push(`Line ${i + 1}: Invalid new start line: ${newStart}`);
      }

      i++;
      let actualOld = 0;
      let actualNew = 0;
      while (i < lines.length && !lines[i].startsWith("@@")) {
        const ch = lines[i][0];
        if (ch === "-" || ch === " ") {
          actualOld++;
        }
        if (ch === "+" || ch === " ") {
          actualNew++;
        }
        if (ch !== "-" && ch !== "+" && ch !== " " && lines[i].trim() !== "") {
          errors.push(`Line ${i + 1}: Unexpected character '${ch}' in hunk body`);
        }
        i++;
      }
    } else if (line.trim() !== "") {
      errors.push(`Line ${i + 1}: Unexpected content outside hunk`);
      i++;
    } else {
      i++;
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 5. combinePatches — combines multiple patches into one
// ---------------------------------------------------------------------------

/**
 * Combines multiple patches into a single patch.
 *
 * @param {string[]} patches - ordered array of patches
 * @returns {string} combined patch
 */
function combinePatches(patches) {
  if (!patches || patches.length === 0) {
    return "";
  }

  if (patches.length === 1) {
    return patches[0];
  }

  // Extract headers
  const firstLines = patches[0].replace(/\r\n/g, "\n").split("\n");
  const lastLines = patches[patches.length - 1].replace(/\r\n/g, "\n").split("\n");
  const oldHeader = firstLines.find((l) => l.startsWith("--- ")) || "--- a";
  const newHeader = lastLines.find((l) => l.startsWith("+++ ")) || "+++ b";

  // Collect all hunks
  const allHunks = [];
  for (const p of patches) {
    const hunks = parsePatch(p);
    for (const h of hunks) {
      allHunks.push(h);
    }
  }

  const combined = [oldHeader, newHeader];
  for (const hunk of allHunks) {
    combined.push(formatHunk(hunk));
  }

  return combined.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 6. summarizePatch — human-readable summary
// ---------------------------------------------------------------------------

/**
 * Produces a human-readable summary of what a patch changes.
 *
 * @param {string} patch
 * @returns {{ files: number, hunks: number, addedLines: number, removedLines: number, summary: string }}
 */
function summarizePatch(patch) {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let hunks = 0;
  let addedLines = 0;
  let removedLines = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      hunks++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removedLines++;
    }
  }

  const parts = [];
  if (addedLines > 0) parts.push(`Added ${addedLines} line${addedLines !== 1 ? "s" : ""}`);
  if (removedLines > 0) parts.push(`Removed ${removedLines} line${removedLines !== 1 ? "s" : ""}`);

  const summary = parts.length > 0
    ? `${parts.join(", ")} in ${hunks} hunk${hunks !== 1 ? "s" : ""}`
    : "No changes";

  return { files: 1, hunks, addedLines, removedLines, summary };
}

// ---------------------------------------------------------------------------
// Internal: create Hunks from two line arrays
// ---------------------------------------------------------------------------

function computeHunks(oldLines, newLines, contextLen) {
  const edits = computeEdits(oldLines, newLines);
  if (edits.length === 0) return [];

  // Group edits into hunks (nearby edits go into one hunk)
  const groups = [];
  let group = { edits: [edits[0]], minIdx: edits[0].oldIdx, maxIdx: edits[0].oldIdx };

  for (let i = 1; i < edits.length; i++) {
    const e = edits[i];
    const gap = e.oldIdx - (group.maxIdx + (edits[i - 1].oldCount || 1));
    if (gap <= contextLen * 2) {
      group.edits.push(e);
      group.maxIdx = Math.max(group.maxIdx, e.oldIdx);
      group.minIdx = Math.min(group.minIdx, e.oldIdx);
    } else {
      groups.push(group);
      group = { edits: [e], minIdx: e.oldIdx, maxIdx: e.oldIdx };
    }
  }
  groups.push(group);

  // Build hunks with context
  return groups.map((g) => buildHunk(g, oldLines, newLines, contextLen));
}

function computeEdits(oldLines, newLines) {
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const edits = [];
  let oi = 0;
  let ni = 0;

  for (const common of lcs) {
    // Removed lines
    while (oi < oldLines.length && oldLines[oi] !== common) {
      edits.push({ type: "removed", oldIdx: oi, text: oldLines[oi] });
      oi++;
    }
    // Added lines
    while (ni < newLines.length && newLines[ni] !== common) {
      edits.push({ type: "added", oldIdx: oi, text: newLines[ni] });
      ni++;
    }
    // Common line
    oi++;
    ni++;
  }

  // Leftover removed
  while (oi < oldLines.length) {
    edits.push({ type: "removed", oldIdx: oi, text: oldLines[oi] });
    oi++;
  }
  // Leftover added
  while (ni < newLines.length) {
    edits.push({ type: "added", oldIdx: oi, text: newLines[ni] });
    ni++;
  }

  return edits;
}

function buildHunk(group, oldLines, newLines, contextLen) {
  const firstEdit = group.edits[0];
  const lastEdit = group.edits[group.edits.length - 1];

  // Context range in the old file
  const ctxStart = Math.max(0, firstEdit.oldIdx - contextLen);
  const ctxEnd = Math.min(
    oldLines.length,
    lastEdit.oldIdx + (lastEdit.type === "removed" ? 1 : 0) + contextLen
  );

  // Collect old-side lines and new-side lines (plain text, no prefix)
  const oldPart = [];
  const newPart = [];

  // Current position in newLines that corresponds to oi in oldLines
  let ni = findNewIdx(ctxStart, oldLines, newLines);

  for (let oi = ctxStart; oi < ctxEnd; oi++) {
    const edit = group.edits.find((e) => e.oldIdx === oi && e.type === "removed");
    const addEdits = group.edits.filter((e) => e.oldIdx === oi && e.type === "added");

    // Output any added lines at this position first
    for (const ae of addEdits) {
      newPart.push(ae.text);
      ni++;
    }

    if (edit) {
      // This line was removed — include in old but not in new
      oldPart.push(edit.text);
    } else {
      // Context line (unchanged)
      oldPart.push(oldLines[oi]);
      newPart.push(oldLines[oi]);
      ni++;
    }
  }

  // Add any remaining added lines after the context
  for (const e of group.edits) {
    if (e.type === "added" && e.oldIdx >= ctxEnd) {
      newPart.push(e.text);
    }
  }

  return {
    oldStart: ctxStart + 1,
    oldLines: oldPart,
    newLines: newPart,
    newStart: ctxStart + 1,
    oldCountH: oldPart.length,
    newCountH: newPart.length,
  };
}

/**
 * Find the index in newLines that corresponds to a line index in oldLines.
 */
function findNewIdx(oldIdx, oldLines, newLines) {
  const lcs = longestCommonSubsequence(oldLines, newLines);
  let ni = 0;
  let oi = 0;
  for (const common of lcs) {
    if (oi >= oldIdx) break;
    while (oi < oldLines.length && oldLines[oi] !== common) oi++;
    while (ni < newLines.length && newLines[ni] !== common) ni++;
    if (oi < oldIdx) {
      oi++;
      ni++;
    }
  }
  return ni;
}

// ---------------------------------------------------------------------------
// Internal: Format / Parse hunks
// ---------------------------------------------------------------------------

function formatHunk(hunk) {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines.length} +${hunk.newStart},${hunk.newLines.length} @@`;
  const body = [];

  // Walk old and new arrays, interleaving
  let oi = 0;
  let ni = 0;

  while (oi < hunk.oldLines.length || ni < hunk.newLines.length) {
    const ol = oi < hunk.oldLines.length ? hunk.oldLines[oi] : undefined;
    const nl = ni < hunk.newLines.length ? hunk.newLines[ni] : undefined;

    if (ol !== undefined && nl !== undefined && ol === nl) {
      body.push(` ${ol}`);
      oi++;
      ni++;
    } else if (ol !== undefined && nl !== undefined && ol !== nl) {
      // Replacement: output remove then add
      body.push(`-${ol}`);
      body.push(`+${nl}`);
      oi++;
      ni++;
    } else if (ol !== undefined && nl === undefined) {
      // Pure removal
      body.push(`-${ol}`);
      oi++;
    } else if (nl !== undefined && ol === undefined) {
      // Pure addition
      body.push(`+${nl}`);
      ni++;
    }
  }

  return header + "\n" + body.join("\n") + "\n";
}

function parsePatch(patch) {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunks = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);

    if (hunkMatch) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: [],
        newLines: [],
      };
      continue;
    }

    if (current) {
      if (line.startsWith("+")) {
        current.newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        current.oldLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        current.oldLines.push(line.slice(1));
        current.newLines.push(line.slice(1));
      }
      // Empty lines within hunks are treated as context
      // (skip them to avoid adding empty strings, which break line counting)
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

// ---------------------------------------------------------------------------
// Internal: LCS
// ---------------------------------------------------------------------------

function longestCommonSubsequence(a, b) {
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

// ---------------------------------------------------------------------------
// Internal: Hunk coalescing (for combinePatches)
// ---------------------------------------------------------------------------

function coalesceHunks(hunks) {
  if (!hunks || hunks.length === 0) return [];
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];
    const prevEnd = prev.oldStart + (prev.oldLines ? prev.oldLines.length : 0);

    if (curr.oldStart <= prevEnd + 4) {
      // Merge
      prev.oldLines = [...(prev.oldLines || []), ...(curr.oldLines || [])];
      prev.newLines = [...(prev.newLines || []), ...(curr.newLines || [])];
      prev.oldStart = Math.min(prev.oldStart, curr.oldStart);
    } else {
      result.push(curr);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createPatch,
  applyPatch,
  reversePatch,
  validatePatch,
  combinePatches,
  summarizePatch,
  // Internals for testing
  parsePatch,
  computeHunks,
  coalesceHunks,
};
