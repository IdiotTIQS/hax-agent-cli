/**
 * Three-way merge engine for HaxAgent.
 *
 * Merges file changes from two branches (ours/theirs) against a common base,
 * with conflict detection and resolution strategies.
 */
"use strict";

const { diffFunctions, diffImports, diffExports } = require("./semantic-diff");
const { createPatch, applyPatch } = require("./patch");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRATEGIES = Object.freeze(["OURS", "THEIRS", "UNION", "SMART"]);

// ---------------------------------------------------------------------------
// 1. mergeFiles — three-way merge
// ---------------------------------------------------------------------------

/**
 * Performs a three-way merge of two file versions against a common base.
 *
 * @param {string} baseContent   - the common ancestor content
 * @param {string} oursContent   - our branch content
 * @param {string} theirsContent - their branch content
 * @returns {{ merged: string, conflicts: Array, resolved: number, unresolved: number }}
 */
function mergeFiles(baseContent, oursContent, theirsContent) {
  // If both sides are identical, no merge needed
  if (oursContent === theirsContent) {
    return { merged: oursContent, conflicts: [], resolved: 0, unresolved: 0 };
  }

  // If ours is unchanged from base, theirs wins
  if (oursContent === baseContent) {
    return { merged: theirsContent, conflicts: [], resolved: 0, unresolved: 0 };
  }

  // If theirs is unchanged from base, ours wins
  if (theirsContent === baseContent) {
    return { merged: oursContent, conflicts: [], resolved: 0, unresolved: 0 };
  }

  const conflicts = detectConflicts(baseContent, oursContent, theirsContent);

  // Try SMART resolution
  const { resolvedConflicts, unresolvedConflicts } = resolveConflicts(conflicts, "SMART");

  // If all resolved, apply merge
  if (unresolvedConflicts.length === 0) {
    const merged = applyMerge(baseContent, oursContent, theirsContent, resolvedConflicts);
    return {
      merged,
      conflicts,
      resolved: resolvedConflicts.length,
      unresolved: 0,
    };
  }

  // Otherwise produce a conflict-marked file
  const merged = produceConflictMarkers(baseContent, oursContent, theirsContent, unresolvedConflicts);
  return {
    merged,
    conflicts,
    resolved: resolvedConflicts.length,
    unresolved: unresolvedConflicts.length,
  };
}

// ---------------------------------------------------------------------------
// 2. detectConflicts — finds merge conflicts
// ---------------------------------------------------------------------------

/**
 * Detects merge conflicts by comparing changes from base to ours and base to theirs.
 *
 * @param {string} base
 * @param {string} ours
 * @param {string} theirs
 * @returns {Array<{ region: string, ours: string, theirs: string, base: string, kind: string }>}
 */
function detectConflicts(base, ours, theirs) {
  const conflicts = [];
  const baseLines = base.split(/\r?\n/);
  const oursLines = ours.split(/\r?\n/);
  const theirsLines = theirs.split(/\r?\n/);

  // Use LCS to find changed regions
  const oursDiff = computeLineDiff(baseLines, oursLines);
  const theirsDiff = computeLineDiff(baseLines, theirsLines);

  // Find overlapping change regions
  const oursChangedRegions = extractChangedRegions(oursDiff);
  const theirsChangedRegions = extractChangedRegions(theirsDiff);

  // Check for overlapping changes
  for (const oRegion of oursChangedRegions) {
    for (const tRegion of theirsChangedRegions) {
      if (regionsOverlap(oRegion, tRegion)) {
        const conflictRegion = mergeOverlappingRegions(oRegion, tRegion);

        // Skip if the changes are identical
        const oursSlice = oursLines.slice(conflictRegion.oursStart, conflictRegion.oursEnd).join("\n");
        const theirsSlice = theirsLines.slice(conflictRegion.theirsStart, conflictRegion.theirsEnd).join("\n");
        if (oursSlice === theirsSlice) {
          continue;
        }

        const baseSlice = baseLines.slice(conflictRegion.start, conflictRegion.end).join("\n");

        conflicts.push({
          region: baseSlice || "(beginning of file)",
          ours: oursSlice,
          theirs: theirsSlice,
          base: baseSlice,
          kind: classifyConflict(oursSlice, theirsSlice, baseSlice),
          ...conflictRegion,
        });
      }
    }
  }

  // Detect import-level conflicts
  const importConflicts = detectImportConflicts(base, ours, theirs);
  conflicts.push(...importConflicts);

  // Detect export-level conflicts
  const exportConflicts = detectExportConflicts(base, ours, theirs);
  conflicts.push(...exportConflicts);

  return deduplicateConflicts(conflicts);
}

function classifyConflict(ours, theirs, base) {
  if (ours === base && theirs !== base) return "theirs-only";
  if (theirs === base && ours !== base) return "ours-only";
  if (ours !== base && theirs !== base && ours !== theirs) return "both-modified";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 3. resolveConflicts — auto-resolves where possible
// ---------------------------------------------------------------------------

/**
 * Attempts to resolve conflicts using the given strategy.
 *
 * @param {Array} conflicts
 * @param {string} strategy - OURS | THEIRS | UNION | SMART
 * @returns {{ resolvedConflicts: Array, unresolvedConflicts: Array }}
 */
function resolveConflicts(conflicts, strategy) {
  const resolved = [];
  const unresolved = [];

  for (const conflict of conflicts) {
    const resolution = resolveOne(conflict, strategy);
    if (resolution) {
      resolved.push(resolution);
    } else {
      unresolved.push(conflict);
    }
  }

  return { resolvedConflicts: resolved, unresolvedConflicts: unresolved };
}

function resolveOne(conflict, strategy) {
  switch (strategy.toUpperCase()) {
    case "OURS":
      return { ...conflict, resolvedWith: "ours", resolution: conflict.ours };

    case "THEIRS":
      return { ...conflict, resolvedWith: "theirs", resolution: conflict.theirs };

    case "UNION":
      return { ...conflict, resolvedWith: "union", resolution: conflict.ours + "\n" + conflict.theirs };

    case "SMART":
      return resolveSmart(conflict);

    default:
      return null;
  }
}

function resolveSmart(conflict) {
  // Case 1: either side is empty → choose non-empty
  if (!conflict.ours || conflict.ours.trim() === "") {
    return { ...conflict, resolvedWith: "theirs", resolution: conflict.theirs };
  }
  if (!conflict.theirs || conflict.theirs.trim() === "") {
    return { ...conflict, resolvedWith: "ours", resolution: conflict.ours };
  }

  // Case 2: import conflicts → deduplicate and union
  if (conflict.kind === "import-conflict") {
    const oursImports = conflict.ours.split("\n").filter(Boolean);
    const theirsImports = conflict.theirs.split("\n").filter(Boolean);
    const merged = unionDedup(oursImports, theirsImports);
    return { ...conflict, resolvedWith: "smart-union", resolution: merged.join("\n") };
  }

  // Case 3: export conflicts → union non-overlapping exports
  if (conflict.kind === "export-conflict") {
    const oursExports = conflict.ours.split("\n").filter(Boolean);
    const theirsExports = conflict.theirs.split("\n").filter(Boolean);
    const merged = unionDedup(oursExports, theirsExports);
    return { ...conflict, resolvedWith: "smart-union", resolution: merged.join("\n") };
  }

  // Case 4: same content modified identically
  if (conflict.ours === conflict.theirs) {
    return { ...conflict, resolvedWith: "identical", resolution: conflict.ours };
  }

  // Case 5: one side is a superset of the other
  if (conflict.ours.includes(conflict.theirs.trim())) {
    return { ...conflict, resolvedWith: "ours-superset", resolution: conflict.ours };
  }
  if (conflict.theirs.includes(conflict.ours.trim())) {
    return { ...conflict, resolvedWith: "theirs-superset", resolution: conflict.theirs };
  }

  // Case 6: trivial whitespace-only difference → prefer ours
  const oursNoWs = conflict.ours.replace(/\s+/g, "");
  const theirsNoWs = conflict.theirs.replace(/\s+/g, "");
  if (oursNoWs === theirsNoWs) {
    return { ...conflict, resolvedWith: "ours-whitespace", resolution: conflict.ours };
  }

  // Cannot auto-resolve
  return null;
}

function unionDedup(a, b) {
  const seen = new Set();
  const result = [];
  for (const item of [...a, ...b]) {
    const key = item.trim().replace(/\s+/g, " ");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 4. applyMerge — produces merged file
// ---------------------------------------------------------------------------

/**
 * Applies the merge result using resolved conflicts.
 *
 * @param {string} base
 * @param {string} ours
 * @param {string} theirs
 * @param {Array} resolvedConflicts
 * @returns {string}
 */
function applyMerge(base, ours, theirs, resolvedConflicts) {
  let result = base;

  // Build a map of base regions to their resolutions
  const resolutionMap = new Map();
  for (const rc of resolvedConflicts) {
    if (rc.resolution !== undefined) {
      const key = rc.region || "";
      resolutionMap.set(key, rc.resolution);
    }
  }

  // If no resolutions, return ours as the merge result (ours-first strategy)
  if (resolutionMap.size === 0 && resolvedConflicts.length === 0) {
    return ours;
  }

  // Apply resolutions: for each base region in the conflict, replace with resolution
  for (const [region, resolution] of resolutionMap) {
    if (region && result.includes(region)) {
      result = result.replace(region, () => resolution);
    }
  }

  // If we replaced nothing, return ours
  if (result === base && resolvedConflicts.length > 0) {
    return ours;
  }

  return result;
}

/**
 * Produces a conflict-marked file for unresolved conflicts.
 */
function produceConflictMarkers(base, ours, theirs, unresolvedConflicts) {
  let result = base;

  for (const conflict of unresolvedConflicts) {
    if (conflict.region && result.includes(conflict.region)) {
      const marker =
        "<<<<<<< OURS\n" +
        conflict.ours +
        "\n=======\n" +
        conflict.theirs +
        "\n>>>>>>> THEIRS\n\n" +
        conflict.region;
      result = result.replace(conflict.region, () => marker);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5. Specialized conflict detectors
// ---------------------------------------------------------------------------

function detectImportConflicts(base, ours, theirs) {
  const baseImports = diffImports(base, base).imports || { elements: [] };
  const oursResult = diffImports(base, ours);
  const theirsResult = diffImports(base, theirs);

  const conflicts = [];

  // If both sides added different imports at the same position
  const oursAdded = oursResult.elements.filter((e) => e.change === "added");
  const theirsAdded = theirsResult.elements.filter((e) => e.change === "added");

  for (const oa of oursAdded) {
    for (const ta of theirsAdded) {
      if (oa.source !== ta.source && oa.name !== ta.name) {
        // Only flag as conflict if they are different imports likely to be in same region
        conflicts.push({
          region: "",
          ours: oa.raw || oa.name,
          theirs: ta.raw || ta.name,
          base: "",
          kind: "import-conflict",
        });
      }
    }
  }

  // If one side removed an import the other side modified
  const oursRemoved = oursResult.elements.filter((e) => e.change === "removed");
  const theirsModified = theirsResult.elements.filter((e) => e.change === "modified");

  for (const rm of oursRemoved) {
    for (const tm of theirsModified) {
      if (rm.name === tm.name) {
        conflicts.push({
          region: rm.raw || rm.name,
          ours: "(removed)",
          theirs: tm.newSignature || tm.raw || tm.name,
          base: rm.raw || rm.name,
          kind: "import-conflict",
        });
      }
    }
  }

  return conflicts;
}

function detectExportConflicts(base, ours, theirs) {
  const oursResult = diffExports(base, ours);
  const theirsResult = diffExports(base, theirs);

  const conflicts = [];

  const oursAdded = oursResult.elements.filter((e) => e.change === "added");
  const theirsAdded = theirsResult.elements.filter((e) => e.change === "added");

  for (const oa of oursAdded) {
    for (const ta of theirsAdded) {
      if (oa.name === ta.name && oa.signature !== ta.signature) {
        conflicts.push({
          region: "",
          ours: oa.signature || oa.name,
          theirs: ta.signature || ta.name,
          base: "",
          kind: "export-conflict",
        });
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// 6. Line-level diff utilities
// ---------------------------------------------------------------------------

function computeLineDiff(aLines, bLines) {
  const result = [];
  const lcs = longestCommonSubsequence(aLines, bLines);

  let ai = 0;
  let bi = 0;

  for (const line of lcs) {
    // Lines in A not in LCS → removed
    while (ai < aLines.length && aLines[ai] !== line) {
      result.push({ type: "removed", line: aLines[ai], aIndex: ai, bIndex: -1 });
      ai++;
    }
    // Lines in B not in LCS → added
    while (bi < bLines.length && bLines[bi] !== line) {
      result.push({ type: "added", line: bLines[bi], aIndex: -1, bIndex: bi });
      bi++;
    }
    // Common line
    result.push({ type: "unchanged", line, aIndex: ai, bIndex: bi });
    ai++;
    bi++;
  }

  // Remaining lines in A
  while (ai < aLines.length) {
    result.push({ type: "removed", line: aLines[ai], aIndex: ai, bIndex: -1 });
    ai++;
  }
  // Remaining lines in B
  while (bi < bLines.length) {
    result.push({ type: "added", line: bLines[bi], aIndex: -1, bIndex: bi });
    bi++;
  }

  return result;
}

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

  // Reconstruct
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

function extractChangedRegions(diff) {
  const regions = [];
  let current = null;

  for (const entry of diff) {
    if (entry.type === "unchanged") {
      if (current) {
        current.end = entry.aIndex !== -1 ? entry.aIndex : current.end;
        regions.push(current);
        current = null;
      }
    } else {
      if (!current) {
        current = {
          start: entry.aIndex !== -1 ? entry.aIndex : entry.bIndex,
          end: entry.aIndex !== -1 ? entry.aIndex + 1 : entry.bIndex + 1,
        };
      } else {
        current.end = entry.aIndex !== -1 ? entry.aIndex + 1 : entry.bIndex + 1;
      }
    }
  }
  if (current) {
    // Estimate end
    current.end = Math.max(current.end, diff[diff.length - 1].aIndex + 1 || diff[diff.length - 1].bIndex + 1);
    regions.push(current);
  }

  return regions;
}

function regionsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function mergeOverlappingRegions(a, b) {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    oursStart: a.start,
    oursEnd: a.end,
    theirsStart: b.start,
    theirsEnd: b.end,
  };
}

function deduplicateConflicts(conflicts) {
  const seen = new Set();
  return conflicts.filter((c) => {
    const key = JSON.stringify({ ours: c.ours, theirs: c.theirs, base: c.base, kind: c.kind });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  mergeFiles,
  detectConflicts,
  resolveConflicts,
  applyMerge,
  STRATEGIES,
  // Internals exposed for testing
  longestCommonSubsequence,
  computeLineDiff,
};
