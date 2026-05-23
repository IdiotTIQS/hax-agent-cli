"use strict";

/**
 * @fileoverview Predictive file change analysis system.
 *
 * Predicts which files in a project are likely to change based on
 * historical change patterns, import graphs, co-change frequency,
 * recent edit activity, and task context signals.
 *
 * All analysis is rule-based and heuristic — no LLM dependency.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract imports / requires from file source content.
 * @param {string} source
 * @returns {string[]} resolved module paths
 */
function extractImports(source) {
  if (!source) return [];
  const imports = new Set();

  // CommonJS require patterns
  const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = cjsPattern.exec(source)) !== null) {
    imports.add(match[1]);
  }

  // ESM import patterns (import ... from "...")
  const esmPattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((match = esmPattern.exec(source)) !== null) {
    imports.add(match[1]);
  }

  // ESM dynamic import patterns
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    imports.add(match[1]);
  }

  return [...imports];
}

/**
 * Normalize a file path for consistent keying.
 * Strips leading ./ and ../, lowercases.
 * @param {string} filePath
 * @returns {string}
 */
function normalizePath(filePath) {
  return (filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .toLowerCase();
}

/**
 * Compute a recency weight from a timestamp (higher for newer events).
 * Uses exponential decay with a 30-day half-life.
 * @param {number} timestampMs
 * @param {number} nowMs
 * @returns {number}
 */
function recencyWeight(timestampMs, nowMs) {
  const ageDays = (nowMs - timestampMs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 1.0;
  // Half-life of 30 days
  return Math.pow(0.5, ageDays / 30);
}

/**
 * Convert a task context string into keyword tokens.
 * @param {string} context
 * @returns {string[]}
 */
function tokenizeContext(context) {
  if (!context) return [];
  return context
    .toLowerCase()
    .split(/[\s,;:|]+/)
    .filter((t) => t.length > 2)
    .map((t) => t.replace(/[^a-z0-9_-]/g, ""));
}

// ---------------------------------------------------------------------------
// FileChangePredictor
// ---------------------------------------------------------------------------

/**
 * Predicts which files in a project are likely to change.
 *
 * Uses multiple signal sources:
 *  - Co-change patterns: files that frequently change together
 *  - Import graph: files that import or are imported by recently-changed files
 *  - Recency: files edited recently are more likely to be edited again
 *  - Task context: keyword matching against file paths/content
 */
class FileChangePredictor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.coChangeThreshold=3] - minimum co-occurrences to register a co-change pattern
   * @param {number} [opts.recencyHalfLifeDays=30] - half-life for recency decay in days
   * @param {number} [opts.maxRelatedFiles=20] - max number of related files to return
   */
  constructor(opts = {}) {
    this._opts = {
      coChangeThreshold: opts.coChangeThreshold || 3,
      recencyHalfLifeDays: opts.recencyHalfLifeDays || 30,
      maxRelatedFiles: opts.maxRelatedFiles || 20,
    };

    /** @type {Map<string, {file: string, timestamp: number, operation: string, source: string}[]>} */
    this._changeHistory = new Map();

    /** @type {Map<string, Map<string, number>>} - file -> {relatedFile -> coChangeCount} */
    this._coChangePairs = new Map();

    /** @type {Map<string, string[]>} - file -> resolved imports */
    this._importGraph = new Map();

    /** @type {Map<string, string[]>} - file -> files that import it */
    this._reverseImportGraph = new Map();

    /** @type {Map<string, number>} - file -> last edit timestamp */
    this._lastEditTime = new Map();

    /** @type {Map<string, number>} - file -> change frequency score */
    this._changeFrequency = new Map();

    /** @type {Map<string, string[]>} - file -> source content for keyword matching */
    this._fileSources = new Map();
  }

  // -----------------------------------------------------------------------
  // learn
  // -----------------------------------------------------------------------

  /**
   * Learn from historical change data to build prediction models.
   *
   * The history can be an array of events from ChangeLog or a custom
   * array of `{ filePath, event, source, metadata?, timestamp }`.
   *
   * @param {Array<{filePath: string, event: string, source?: string, metadata?: object, timestamp: string}>} history
   */
  learn(history) {
    if (!Array.isArray(history)) return;

    const now = Date.now();

    for (const entry of history) {
      if (!entry || !entry.filePath) continue;

      const key = normalizePath(entry.filePath);
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : now;

      // Store change history
      if (!this._changeHistory.has(key)) {
        this._changeHistory.set(key, []);
      }
      this._changeHistory.get(key).push({
        file: entry.filePath,
        timestamp: ts,
        operation: entry.event || "change",
        source: entry.source || "unknown",
      });

      // Track last edit time
      const prevLast = this._lastEditTime.get(key) || 0;
      if (ts > prevLast) {
        this._lastEditTime.set(key, ts);
      }

      // Increment change frequency
      this._changeFrequency.set(key, (this._changeFrequency.get(key) || 0) + 1);
    }

    this._buildCoChangePairs(history);
  }

  /**
   * Register a project file with its import information and source content.
   *
   * @param {object} fileInfo
   * @param {string} fileInfo.filePath
   * @param {string} [fileInfo.source] - file source content
   * @param {string[]} [fileInfo.imports] - explicit list of imports (auto-detected if source given)
   * @param {string[]} [fileInfo.exports] - named exports from the file
   * @param {number} [fileInfo.lastModified] - last modified timestamp
   */
  addFile(fileInfo) {
    if (!fileInfo || !fileInfo.filePath) return;

    const key = normalizePath(fileInfo.filePath);

    // Store source for keyword matching
    if (fileInfo.source) {
      this._fileSources.set(key, fileInfo.source);
    }

    // Build import graph
    let imports = fileInfo.imports || [];
    if (fileInfo.source && imports.length === 0) {
      imports = extractImports(fileInfo.source);
    }

    this._importGraph.set(key, imports);

    // Build reverse import graph
    for (const imp of imports) {
      const impKey = normalizePath(imp);
      if (!this._reverseImportGraph.has(impKey)) {
        this._reverseImportGraph.set(impKey, []);
      }
      const rev = this._reverseImportGraph.get(impKey);
      if (!rev.includes(key)) {
        rev.push(key);
      }
    }

    // Track last modified
    if (fileInfo.lastModified) {
      const prev = this._lastEditTime.get(key) || 0;
      if (fileInfo.lastModified > prev) {
        this._lastEditTime.set(key, fileInfo.lastModified);
      }
    }
  }

  // -----------------------------------------------------------------------
  // predict
  // -----------------------------------------------------------------------

  /**
   * Predict which files are likely to change given a task query and the
   * current set of project files.
   *
   * @param {object} query
   * @param {string} [query.context] - task description / context string
   * @param {string[]} [query.recentlyChanged] - files changed in this session
   * @param {string[]} [query.activeFiles] - files currently being worked on
   * @param {string[]} projectFiles - full list of project file paths
   * @returns {Array<{file: string, score: number, reasons: string[]}>}
   */
  predict(query, projectFiles) {
    if (!projectFiles || projectFiles.length === 0) return [];

    const context = query && query.context ? query.context : "";
    const recentlyChanged = query && query.recentlyChanged ? query.recentlyChanged : [];
    const activeFiles = query && query.activeFiles ? query.activeFiles : [];

    const now = Date.now();
    const scores = new Map();

    /** @type {Map<string, string[]>} */
    const reasons = new Map();

    const contextTokens = tokenizeContext(context);
    const recentKeys = recentlyChanged.map(normalizePath);

    // Factor 1: Co-change expansion — files that historically change with recent files
    for (const rk of recentKeys) {
      const pairs = this._coChangePairs.get(rk);
      if (pairs) {
        for (const [relatedKey, count] of pairs) {
          const coScore = Math.min(30, count * 3);
          scores.set(relatedKey, (scores.get(relatedKey) || 0) + coScore);
          if (!reasons.has(relatedKey)) reasons.set(relatedKey, []);
          const r = reasons.get(relatedKey);
          if (!r.includes("co-change")) r.push("co-change");
        }
      }
    }

    // Factor 2: Recency — files edited recently are more likely to change
    for (const pf of projectFiles) {
      const key = normalizePath(pf);
      const lastEdit = this._lastEditTime.get(key);
      if (lastEdit) {
        const weight = recencyWeight(lastEdit, now);
        const recencyScore = Math.round(weight * 25);
        if (recencyScore > 0) {
          scores.set(key, (scores.get(key) || 0) + recencyScore);
          if (!reasons.has(key)) reasons.set(key, []);
          const r = reasons.get(key);
          if (!r.includes("recent-edit")) r.push("recent-edit");
        }
      }
    }

    // Factor 3: Change frequency — frequently changed files
    for (const pf of projectFiles) {
      const key = normalizePath(pf);
      const freq = this._changeFrequency.get(key) || 0;
      if (freq > 0) {
        const freqScore = Math.min(20, freq * 2);
        scores.set(key, (scores.get(key) || 0) + freqScore);
        if (!reasons.has(key)) reasons.set(key, []);
        const r = reasons.get(key);
        if (!r.includes("frequent-change")) r.push("frequent-change");
      }
    }

    // Factor 4: Import graph — files imported by recently changed files
    for (const rk of recentKeys) {
      const deps = this._importGraph.get(rk);
      if (deps) {
        for (const dep of deps) {
          const depKey = normalizePath(dep);
          // Look for project files that match the import
          for (const pf of projectFiles) {
            const pfKey = normalizePath(pf);
            if (pfKey === depKey || pfKey.endsWith("/" + depKey) || depKey.endsWith("/" + pfKey)) {
              scores.set(pfKey, (scores.get(pfKey) || 0) + 15);
              if (!reasons.has(pfKey)) reasons.set(pfKey, []);
              const r = reasons.get(pfKey);
              if (!r.includes("imported-by-recent")) r.push("imported-by-recent");
            }
          }
        }
      }
    }

    // Factor 5: Reverse import graph — files that import recently changed files
    for (const rk of recentKeys) {
      const consumers = this._reverseImportGraph.get(rk);
      if (consumers) {
        for (const consumer of consumers) {
          for (const pf of projectFiles) {
            const pfKey = normalizePath(pf);
            if (pfKey === consumer || pfKey.endsWith("/" + consumer)) {
              scores.set(pfKey, (scores.get(pfKey) || 0) + 12);
              if (!reasons.has(pfKey)) reasons.set(pfKey, []);
              const r = reasons.get(pfKey);
              if (!r.includes("imports-recent")) r.push("imports-recent");
            }
          }
        }
      }
    }

    // Factor 6: Task context keyword matching against file names
    if (contextTokens.length > 0) {
      for (const pf of projectFiles) {
        const key = normalizePath(pf);
        const fileName = pf.split(/[\\/]/).pop() || pf;
        const nameLower = fileName.toLowerCase().replace(/\.[^.]+$/, "");

        let matchScore = 0;
        for (const token of contextTokens) {
          if (nameLower.includes(token)) matchScore += 8;
          if (key.includes(token)) matchScore += 3;
        }

        // Also match against stored file sources
        const source = this._fileSources.get(key);
        if (source) {
          const sourceLower = source.toLowerCase();
          for (const token of contextTokens) {
            // Count occurrences (max 3 per token)
            const occurrences = (sourceLower.match(new RegExp(token, "g")) || []).length;
            matchScore += Math.min(3, occurrences);
          }
        }

        matchScore = Math.min(20, matchScore);
        if (matchScore > 0) {
          scores.set(key, (scores.get(key) || 0) + matchScore);
          if (!reasons.has(key)) reasons.set(key, []);
          const r = reasons.get(key);
          if (!r.includes("task-context")) r.push("task-context");
        }
      }
    }

    // Factor 7: Active files get a small boost
    for (const af of activeFiles) {
      const key = normalizePath(af);
      scores.set(key, (scores.get(key) || 0) + 5);
      if (!reasons.has(key)) reasons.set(key, []);
      const r = reasons.get(key);
      if (!r.includes("active-file")) r.push("active-file");
    }

    // Build sorted result array
    const results = [];
    for (const [key, score] of scores) {
      // Find the original project file path
      const matching = projectFiles.find((pf) => normalizePath(pf) === key);
      results.push({
        file: matching || key,
        score: Math.round(score * 100) / 100,
        reasons: reasons.get(key) || [],
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  // -----------------------------------------------------------------------
  // getConfidence
  // -----------------------------------------------------------------------

  /**
   * Get the prediction confidence level for a specific file.
   *
   * Confidence is based on:
   *  - Amount of historical data for this file
   *  - Strength of co-change signals
   *  - Recency of last change
   *
   * @param {string} filePath
   * @returns {{ level: "high"|"medium"|"low", score: number, factors: string[] }}
   */
  getConfidence(filePath) {
    const key = normalizePath(filePath);
    const factors = [];
    let score = 0;

    // Historical data volume
    const history = this._changeHistory.get(key);
    const historyLen = history ? history.length : 0;
    if (historyLen >= 10) {
      score += 30;
      factors.push("extensive-history");
    } else if (historyLen >= 5) {
      score += 20;
      factors.push("moderate-history");
    } else if (historyLen > 0) {
      score += 10;
      factors.push("limited-history");
    }

    // Co-change signal strength
    const coPairs = this._coChangePairs.get(key);
    if (coPairs && coPairs.size >= 5) {
      score += 25;
      factors.push("strong-cochange");
    } else if (coPairs && coPairs.size > 0) {
      score += 10;
      factors.push("moderate-cochange");
    }

    // Import graph connectivity
    const deps = this._importGraph.get(key);
    const consumers = this._reverseImportGraph.get(key);
    const connectivity = (deps ? deps.length : 0) + (consumers ? consumers.length : 0);
    if (connectivity >= 10) {
      score += 20;
      factors.push("high-connectivity");
    } else if (connectivity > 0) {
      score += 5;
      factors.push("low-connectivity");
    }

    // Recency
    const now = Date.now();
    const lastEdit = this._lastEditTime.get(key);
    if (lastEdit) {
      const weight = recencyWeight(lastEdit, now);
      if (weight > 0.5) {
        score += 25;
        factors.push("recently-edited");
      }
    }

    let level = "low";
    if (score >= 60) {
      level = "high";
    } else if (score >= 30) {
      level = "medium";
    }

    return { level, score: Math.round(score), factors };
  }

  // -----------------------------------------------------------------------
  // getRelatedFiles
  // -----------------------------------------------------------------------

  /**
   * Find files that are often changed together with the given file.
   *
   * Returns results from three sources:
   *  1. Co-change pairs from historical data
   *  2. Direct imports (files this file depends on)
   *  3. Reverse imports (files that depend on this file)
   *
   * @param {string} filePath
   * @returns {Array<{file: string, relation: "co-change"|"import"|"imported-by", strength: number}>}
   */
  getRelatedFiles(filePath) {
    const key = normalizePath(filePath);
    const results = [];

    // Co-change pairs
    const coPairs = this._coChangePairs.get(key);
    if (coPairs) {
      for (const [related, count] of coPairs) {
        results.push({ file: related, relation: "co-change", strength: count });
      }
    }

    // Direct imports
    const deps = this._importGraph.get(key);
    if (deps) {
      for (const dep of deps) {
        const depKey = normalizePath(dep);
        // Avoid duplicates with co-change
        const already = results.find((r) => r.file === depKey && r.relation === "co-change");
        if (!already) {
          results.push({ file: depKey, relation: "import", strength: 1 });
        }
      }
    }

    // Reverse imports (consumers)
    const consumers = this._reverseImportGraph.get(key);
    if (consumers) {
      for (const consumer of consumers) {
        const already = results.find(
          (r) => (r.file === consumer) && (r.relation === "co-change" || r.relation === "import"),
        );
        if (!already) {
          results.push({ file: consumer, relation: "imported-by", strength: 1 });
        }
      }
    }

    // Sort by strength descending
    results.sort((a, b) => b.strength - a.strength);

    return results.slice(0, this._opts.maxRelatedFiles);
  }

  // -----------------------------------------------------------------------
  // getChangeProbabilityMap
  // -----------------------------------------------------------------------

  /**
   * Generate a heatmap of change likelihood across all project files.
   *
   * Returns files grouped into probability tiers:
   *  - very-high (> 50)
   *  - high (30-50)
   *  - medium (15-30)
   *  - low (< 15)
   *
   * @param {string[]} projectFiles - full list of project file paths
   * @param {object} [query] - optional task context query
   * @param {string} [query.context]
   * @param {string[]} [query.recentlyChanged]
   * @param {string[]} [query.activeFiles]
   * @returns {{ veryHigh: Array<{file: string, score: number}>, high: Array<{file: string, score: number}>, medium: Array<{file: string, score: number}>, low: Array<{file: string, score: number}>, all: Array<{file: string, score: number, tier: string}> }}
   */
  getChangeProbabilityMap(projectFiles, query) {
    const predictions = this.predict(query || {}, projectFiles);

    const tiers = {
      veryHigh: [],
      high: [],
      medium: [],
      low: [],
      all: [],
    };

    for (const pred of predictions) {
      let tier;
      if (pred.score > 50) {
        tier = "very-high";
        tiers.veryHigh.push({ file: pred.file, score: pred.score });
      } else if (pred.score >= 30) {
        tier = "high";
        tiers.high.push({ file: pred.file, score: pred.score });
      } else if (pred.score >= 15) {
        tier = "medium";
        tiers.medium.push({ file: pred.file, score: pred.score });
      } else {
        tier = "low";
        tiers.low.push({ file: pred.file, score: pred.score });
      }
      tiers.all.push({ file: pred.file, score: pred.score, tier });
    }

    return tiers;
  }

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  /**
   * Clear all learned data.
   */
  clear() {
    this._changeHistory.clear();
    this._coChangePairs.clear();
    this._importGraph.clear();
    this._reverseImportGraph.clear();
    this._lastEditTime.clear();
    this._changeFrequency.clear();
    this._fileSources.clear();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Build co-change pairs from change history.
   * Files changed within the same 5-minute window are considered co-changed.
   * @param {Array} history
   */
  _buildCoChangePairs(history) {
    if (!Array.isArray(history) || history.length < 2) return;

    // Filter out invalid entries
    const valid = history.filter((e) => e && typeof e.filePath === "string" && e.filePath);
    if (valid.length < 2) return;

    // Group changes by time window (5 minutes)
    const WINDOW_MS = 5 * 60 * 1000;
    const sorted = [...valid].sort((a, b) => {
        const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return aTs - bTs;
      });

    // Sliding window: group events within 5 minutes of each other
    const groups = [];
    let currentGroup = [sorted[0]];
    let groupStart = sorted[0].timestamp
      ? new Date(sorted[0].timestamp).getTime()
      : Date.now();

    for (let i = 1; i < sorted.length; i += 1) {
      const ts = sorted[i].timestamp
        ? new Date(sorted[i].timestamp).getTime()
        : Date.now();

      if (ts - groupStart <= WINDOW_MS) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [sorted[i]];
        groupStart = ts;
      }
    }
    groups.push(currentGroup);

    // Build co-change pairs from groups
    for (const group of groups) {
      const keys = [...new Set(group.map((e) => normalizePath(e.filePath)))];

      for (let i = 0; i < keys.length; i += 1) {
        for (let j = i + 1; j < keys.length; j += 1) {
          const a = keys[i];
          const b = keys[j];

          // Increment co-change count for a->b
          if (!this._coChangePairs.has(a)) {
            this._coChangePairs.set(a, new Map());
          }
          const aMap = this._coChangePairs.get(a);
          aMap.set(b, (aMap.get(b) || 0) + 1);

          // Increment co-change count for b->a
          if (!this._coChangePairs.has(b)) {
            this._coChangePairs.set(b, new Map());
          }
          const bMap = this._coChangePairs.get(b);
          bMap.set(a, (bMap.get(a) || 0) + 1);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  FileChangePredictor,
  // Helpers exported for testing.
  _internals: {
    normalizePath,
    extractImports,
    recencyWeight,
    tokenizeContext,
  },
};
