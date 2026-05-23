"use strict";

/**
 * ConsolidationAnalyzer — finds overlapping modules in a project and
 * recommends consolidation strategies.
 *
 * Operates on a ModuleMap: a POJO where each key is a module slug/path
 * and each value is a descriptor with exports, imports, and metadata.
 *
 * Module descriptor shape:
 *   {
 *     path: string,             // file path, e.g. "src/scheduler/cron.js"
 *     slug: string,             // short identifier, e.g. "scheduler/cron"
 *     exports: string[],        // exported names (functions, classes, constants)
 *     imports: string[],        // dependency module slugs this module imports
 *     category: string,         // functional category, e.g. "scheduler"
 *     tags: string[],           // arbitrary tags
 *     fileSize?: number,        // bytes
 *     lines?: number,           // source lines
 *     complexity?: number,      // cyclomatic / Halstead derived score (higher = more complex)
 *     deprecated?: boolean,     // whether the module is marked deprecated
 *     description?: string,     // human-readable purpose
 *   }
 */

// ---------------------------------------------------------------------------
// Similarity helpers
// ---------------------------------------------------------------------------

/**
 * Jaccard similarity = |A ∩ B| / |A ∪ B|.
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = Array.from(a).filter((x) => b.has(x)).length;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Dice similarity = 2 |A ∩ B| / (|A| + |B|).
 */
function diceSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = Array.from(a).filter((x) => b.has(x)).length;
  return (2 * intersection) / (a.size + b.size);
}

/**
 * Compute name-similarity between two slugs by splitting on common
 * delimiters and comparing the resulting tokens.
 */
function nameSimilarity(slugA, slugB) {
  const partsA = new Set(
    slugA
      .toLowerCase()
      .split(/[/\\\-_.]/)
      .filter(Boolean),
  );
  const partsB = new Set(
    slugB
      .toLowerCase()
      .split(/[/\\\-_.]/)
      .filter(Boolean),
  );
  return diceSimilarity(partsA, partsB);
}

/**
 * Cosine similarity on tokenised export name sets (using trigram tokens).
 */
function trigramSet(str) {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, " ");
  const parts = s.split(/\s+/).filter(Boolean);
  const trigrams = new Set();
  for (const part of parts) {
    // Each individual word is also a "trigram" in the wider set.
    trigrams.add(part);
    for (let i = 0; i < part.length - 2; i++) {
      trigrams.add(part.slice(i, i + 3));
    }
  }
  return trigrams;
}

function exportSimilarity(exportsA, exportsB) {
  if (!exportsA || !exportsB || exportsA.length === 0 || exportsB.length === 0) return 0;
  const setA = new Set(exportsA.flatMap((e) => [...trigramSet(e)]));
  const setB = new Set(exportsB.flatMap((e) => [...trigramSet(e)]));
  const all = new Set([...setA, ...setB]);
  if (all.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  return intersection / all.size;
}

/**
 * Dependency overlap — proportion of shared imports.
 */
function dependencyOverlap(importsA, importsB) {
  if (!importsA || !importsB || importsA.length === 0 || importsB.length === 0) return 0;
  const setA = new Set(importsA);
  const setB = new Set(importsB);
  return jaccardSimilarity(setA, setB);
}

// ---------------------------------------------------------------------------
// DuplicatePair utility
// ---------------------------------------------------------------------------

function buildDuplicatePair(slugA, slugB, moduleMap, metadata = {}) {
  const modA = moduleMap[slugA];
  const modB = moduleMap[slugB];

  const nameSim = nameSimilarity(slugA, slugB);
  const exportSim = exportSimilarity(modA.exports || [], modB.exports || []);
  const depOverlap = dependencyOverlap(modA.imports || [], modB.imports || []);
  const sameCategory = modA.category === modB.category ? 1 : 0;

  // Composite score weighted in favour of export similarity and category.
  const score = Math.round(
    (exportSim * 0.35 + nameSim * 0.25 + depOverlap * 0.2 + sameCategory * 0.2) * 10000,
  ) / 10000;

  return {
    moduleA: slugA,
    moduleB: slugB,
    score,
    nameSimilarity: Math.round(nameSim * 10000) / 10000,
    exportSimilarity: Math.round(exportSim * 10000) / 10000,
    dependencyOverlap: Math.round(depOverlap * 10000) / 10000,
    sameCategory,
    pathA: modA.path,
    pathB: modB.path,
    exportsA: modA.exports || [],
    exportsB: modB.exports || [],
    category: modA.category === modB.category ? modA.category : `${modA.category}/${modB.category}`,
    ...metadata,
  };
}

// ---------------------------------------------------------------------------
// ConsolidationAnalyzer
// ---------------------------------------------------------------------------

class ConsolidationAnalyzer {
  /**
   * @param {object} moduleMap - the project module map (slug -> descriptor)
   * @param {object} [options]
   * @param {number} [options.duplicateThreshold=0.25] - minimum composite score to flag as duplicate
   * @param {number} [options.maxDuplicates=50] - cap on returned duplicate pairs
   */
  constructor(moduleMap, options = {}) {
    if (!moduleMap || typeof moduleMap !== "object") {
      throw new TypeError("moduleMap must be an object");
    }

    this._moduleMap = moduleMap;
    this._slugs = Object.keys(moduleMap);
    this._duplicateThreshold = Number.isFinite(options.duplicateThreshold)
      ? Math.max(0, Math.min(1, options.duplicateThreshold))
      : 0.25;
    this._maxDuplicates = Math.max(1, Number(options.maxDuplicates) || 50);
  }

  // -------------------------------------------------------------------
  // findDuplicates
  // -------------------------------------------------------------------

  /**
   * Scan the module map for pairs of modules that appear to overlap
   * based on name similarity, export similarity, dependency overlap,
   * and shared category.
   *
   * @param {object} [options]
   * @param {number} [options.threshold] - override instance threshold
   * @returns {object[]} ranked duplicate pairs (highest score first)
   */
  findDuplicates(options = {}) {
    const threshold =
      options.threshold !== undefined
        ? Math.max(0, Math.min(1, Number(options.threshold)))
        : this._duplicateThreshold;

    const pairs = [];
    const slugs = this._slugs;
    const len = slugs.length;

    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const pair = buildDuplicatePair(slugs[i], slugs[j], this._moduleMap);
        if (pair.score >= threshold) {
          pairs.push(pair);
        }
      }
    }

    pairs.sort((a, b) => b.score - a.score);
    return pairs.slice(0, this._maxDuplicates);
  }

  // -------------------------------------------------------------------
  // findOverlappingAPIs
  // -------------------------------------------------------------------

  /**
   * Find modules whose exported API surface overlaps significantly.
   * This is more focused than findDuplicates — it only considers export
   * and functional overlap, not just name similarity.
   *
   * @returns {object[]}
   */
  findOverlappingAPIs() {
    const slugs = this._slugs;
    const results = [];

    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const modA = this._moduleMap[slugs[i]];
        const modB = this._moduleMap[slugs[j]];
        const expA = modA.exports || [];
        const expB = modB.exports || [];

        if (expA.length === 0 || expB.length === 0) continue;

        // Overlapping export names (exact match).
        const setB = new Set(expB);
        const exactOverlap = expA.filter((e) => setB.has(e));

        // Partial overlaps (case-insensitive, trimmed).
        const lowerA = new Set(expA.map((e) => e.toLowerCase().trim()));
        const lowerB = new Set(expB.map((e) => e.toLowerCase().trim()));
        const fuzzyOverlap = Array.from(lowerA).filter((e) => lowerB.has(e));

        // Compute taxonomic overlap: how many exports share common prefixes.
        const prefixOverlap = [];
        for (const ea of expA) {
          for (const eb of expB) {
            if (ea !== eb) {
              const commonPrefixLen = commonPrefixLength(ea, eb);
              if (commonPrefixLen >= 4) {
                prefixOverlap.push({ a: ea, b: eb, commonPrefixLen });
              }
            }
          }
        }

        // Only report if there is meaningful overlap.
        const payload = {
          moduleA: slugs[i],
          moduleB: slugs[j],
          pathA: modA.path,
          pathB: modB.path,
          categories: `${modA.category || "?"} / ${modB.category || "?"}`,
          exactOverlap,
          exactCount: exactOverlap.length,
          fuzzyOverlap,
          fuzzyCount: fuzzyOverlap.length,
          prefixOverlap: prefixOverlap.slice(0, 10), // keep first 10
          prefixCount: prefixOverlap.length,
          exportsA: expA,
          exportsB: expB,
          severity:
            exactOverlap.length >= 3 || fuzzyOverlap.length >= 5
              ? "high"
              : exactOverlap.length >= 1
                ? "medium"
                : "low",
        };

        // Skip truly negligible cases.
        if (payload.exactCount === 0 && payload.fuzzyCount === 0 && payload.prefixCount === 0) continue;

        results.push(payload);
      }
    }

    results.sort((a, b) => {
      const sa = a.exactCount * 3 + a.fuzzyCount * 2 + a.prefixCount;
      const sb = b.exactCount * 3 + b.fuzzyCount * 2 + b.prefixCount;
      return sb - sa;
    });

    return results;
  }

  // -------------------------------------------------------------------
  // suggestConsolidation
  // -------------------------------------------------------------------

  /**
   * Recommend a set of consolidation groups — clusters of modules that
   * should be merged together.
   *
   * @returns {object[]} list of consolidation suggestions with metadata.
   */
  suggestConsolidation() {
    const duplicates = this.findDuplicates();

    // Build adjacency graph from duplicate pairs above threshold.
    const graph = new Map();
    for (const slug of this._slugs) {
      graph.set(slug, new Set());
    }
    for (const pair of duplicates) {
      graph.get(pair.moduleA).add(pair.moduleB);
      graph.get(pair.moduleB).add(pair.moduleA);
    }

    // Greedy clustering — group connected components.
    const visited = new Set();
    const clusters = [];

    for (const slug of this._slugs) {
      if (visited.has(slug)) continue;

      const cluster = [];
      const stack = [slug];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        for (const neighbor of graph.get(current) || []) {
          if (!visited.has(neighbor)) stack.push(neighbor);
        }
      }

      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    // Score each cluster.
    const suggestions = clusters.map((cluster) => {
      const modules = cluster.map((slug) => this._moduleMap[slug]);
      const totalExports = modules.reduce((s, m) => s + (m.exports || []).length, 0);
      const categories = new Set(modules.map((m) => m.category).filter(Boolean));
      const sameCat = categories.size === 1;
      const avgComplexity =
        modules.reduce(
          (s, m) => s + (typeof m.complexity === "number" ? m.complexity : 5),
          0,
        ) / Math.max(1, modules.length);

      // Priority score — higher = more urgent.
      const priority =
        (cluster.length - 1) * 3 + // reward larger clusters
        (sameCat ? 5 : 0) + // bonus if all modules share a category
        Math.min(10, totalExports / 5); // bonus for high export count

      return {
        cluster,
        size: cluster.length,
        modules,
        categories: [...categories],
        sameCategory: sameCat,
        totalExports,
        averageComplexity: Math.round(avgComplexity * 100) / 100,
        priority: Math.round(priority * 100) / 100,
      };
    });

    suggestions.sort((a, b) => b.priority - a.priority);
    return suggestions;
  }

  // -------------------------------------------------------------------
  // estimateEffort
  // -------------------------------------------------------------------

  /**
   * Estimate the effort (in story-point-like units) required to
   * consolidate a given suggestion.
   *
   * @param {object} consolidation - a suggestion entry from suggestConsolidation()
   * @returns {object} effort estimate with breakdown
   */
  estimateEffort(consolidation) {
    if (!consolidation || !Array.isArray(consolidation.modules)) {
      return { total: 0, breakdown: [], confidence: "none", message: "Invalid consolidation entry." };
    }

    const modules = consolidation.modules;
    const n = modules.length;
    if (n < 2) {
      return { total: 0, breakdown: [], confidence: "none", message: "Need at least 2 modules for consolidation." };
    }

    // Base effort: each module beyond the first adds complexity.
    let base = n * 2;

    // Export analysis: more exports = more work to reconcile.
    const totalExports = modules.reduce((s, m) => s + (m.exports || []).length, 0);
    const exportFactor = Math.min(10, totalExports / 3);

    // Complexity factor: higher complexity means more refactoring risk.
    const avgComplexity =
      modules.reduce((s, m) => s + (typeof m.complexity === "number" ? m.complexity : 5), 0) /
      Math.max(1, n);
    const complexityFactor = (avgComplexity / 5) * 3;

    // Dependency factor: how many other modules depend on these?
    const depSlugs = new Set();
    for (const mod of modules) {
      depSlugs.add(mod.slug || mod.path);
    }
    let dependencyCount = 0;
    for (const slug of this._slugs) {
      const mod = this._moduleMap[slug];
      if (depSlugs.has(slug)) continue;
      for (const imp of mod.imports || []) {
        if (depSlugs.has(imp)) {
          dependencyCount++;
          break;
        }
      }
    }
    const dependencyFactor = Math.min(8, dependencyCount * 0.5);

    // Cross-category penalty.
    const categories = new Set(modules.map((m) => m.category).filter(Boolean));
    const categoryFactor = categories.size > 1 ? (categories.size - 1) * 2 : 0;

    // Deprecated modules are easier to retire.
    const deprecatedCount = modules.filter((m) => m.deprecated).length;
    const deprecatedBonus = deprecatedCount * -1;

    // File size factor.
    const totalLines = modules.reduce((s, m) => s + (typeof m.lines === "number" ? m.lines : 0), 0);
    const sizeFactor = Math.min(5, totalLines / 500);

    const total = Math.round(
      base +
        exportFactor +
        complexityFactor +
        dependencyFactor +
        categoryFactor +
        deprecatedBonus +
        sizeFactor,
    );

    let confidence = "medium";
    if (n > 4 || categories.size > 2) confidence = "low";
    else if (n === 2 && categories.size === 1) confidence = "high";

    return {
      total: Math.max(1, total),
      confidence,
      breakdown: {
        baseCost: base,
        exportCost: Math.round(exportFactor * 100) / 100,
        complexityCost: Math.round(complexityFactor * 100) / 100,
        dependencyCost: Math.round(dependencyFactor * 100) / 100,
        categoryPenalty: categoryFactor,
        deprecatedCredit: deprecatedBonus,
        sizeCost: Math.round(sizeFactor * 100) / 100,
        modulesAffected: n,
        dependentsAffected: dependencyCount,
        totalExports,
        totalLines,
        categories: [...categories],
        deprecatedModules: deprecatedCount,
      },
      message: generateEffortMessage(total, confidence),
    };
  }

  // -------------------------------------------------------------------
  // getConsolidationPlan
  // -------------------------------------------------------------------

  /**
   * Produce a step-by-step consolidation plan for the entire project.
   *
   * @returns {object} plan with phases and milestones.
   */
  getConsolidationPlan() {
    const suggestions = this.suggestConsolidation();
    if (suggestions.length === 0) {
      return {
        phases: [],
        totalEffort: 0,
        totalModulesToMerge: 0,
        totalModulesEliminated: 0,
        summary: "No consolidation candidates found.",
      };
    }

    // Group suggestions into phases by priority / complexity.
    const high = [];
    const medium = [];
    const low = [];

    for (const sug of suggestions) {
      const effort = this.estimateEffort(sug);
      const entry = { suggestion: sug, effort };
      if (effort.total <= 5) {
        high.push(entry);
      } else if (effort.total <= 15) {
        medium.push(entry);
      } else {
        low.push(entry);
      }
    }

    const phases = [];
    let nextPhase = 1;

    if (high.length > 0) {
      phases.push({
        phase: nextPhase++,
        title: "Quick Wins",
        description:
          "Low-effort consolidations that can be completed in a single sprint.",
        items: high,
        subtotalEffort: high.reduce((s, e) => s + e.effort.total, 0),
      });
    }

    if (medium.length > 0) {
      phases.push({
        phase: nextPhase++,
        title: "Core Consolidation",
        description:
          "Medium-effort merges requiring careful API reconciliation and migration.",
        items: medium,
        subtotalEffort: medium.reduce((s, e) => s + e.effort.total, 0),
      });
    }

    if (low.length > 0) {
      phases.push({
        phase: nextPhase++,
        title: "Deep Refactors",
        description:
          "High-effort consolidations that may span multiple sprints and require stakeholder coordination.",
        items: low,
        subtotalEffort: low.reduce((s, e) => s + e.effort.total, 0),
      });
    }

    const allItems = [...high, ...medium, ...low];
    const totalEffort = allItems.reduce((s, e) => s + e.effort.total, 0);
    let totalModulesToMerge = 0;
    let totalModulesEliminated = 0;
    for (const sug of suggestions) {
      totalModulesToMerge += sug.size;
      totalModulesEliminated += sug.size - 1;
    }

    return {
      phases,
      totalEffort,
      totalModulesToMerge,
      totalModulesEliminated,
      summary: generatePlanSummary(phases, totalEffort, totalModulesEliminated),
    };
  }

  // -------------------------------------------------------------------
  // Utility accessors
  // -------------------------------------------------------------------

  getModule(slug) {
    return this._moduleMap[slug] || null;
  }

  getModuleSlugs() {
    return [...this._slugs];
  }

  getCategoryStats() {
    const stats = {};
    for (const slug of this._slugs) {
      const mod = this._moduleMap[slug];
      const cat = mod.category || "uncategorised";
      if (!stats[cat]) {
        stats[cat] = { count: 0, totalExports: 0, slugs: [] };
      }
      stats[cat].count++;
      stats[cat].totalExports += (mod.exports || []).length;
      stats[cat].slugs.push(slug);
    }
    return stats;
  }
}

// ---------------------------------------------------------------------------
// Report generation helpers
// ---------------------------------------------------------------------------

function generateEffortMessage(total, confidence) {
  if (total <= 3) return `Trivial consolidation (~${total} story points). High confidence.`;
  if (total <= 8) return `Moderate consolidation (~${total} story points). ${confidence} confidence.`;
  return `Significant consolidation (~${total} story points). ${confidence} confidence.`;
}

function generatePlanSummary(phases, totalEffort, modulesEliminated) {
  const phaseDescs = phases.map(
    (p) => `${p.title} (${p.items.length} merges, effort: ${p.subtotalEffort})`,
  );
  return `Consolidation plan: ${phases.length} phases, ${modulesEliminated} modules eliminated, total effort: ${totalEffort}. ${phaseDescs.join("; ")}`;
}

/**
 * Compute the length of the common prefix between two strings.
 */
function commonPrefixLength(a, b) {
  let i = 0;
  const len = Math.min(a.length, b.length);
  while (i < len && a[i] === b[i]) i++;
  return i;
}

// ---------------------------------------------------------------------------
// ModuleMap builder helper
// ---------------------------------------------------------------------------

/**
 * Build a ModuleMap from a flat array of module descriptors.
 * The slug defaults to a normalised version of the path.
 */
function buildModuleMap(modules) {
  if (!Array.isArray(modules)) {
    throw new TypeError("buildModuleMap expects an array of module descriptors");
  }
  const map = {};
  for (const mod of modules) {
    const slug = mod.slug || normalisePath(mod.path || `unknown-${Math.random().toString(36).slice(2, 8)}`);
    map[slug] = {
      path: mod.path || "",
      slug,
      exports: [...(mod.exports || [])],
      imports: [...(mod.imports || [])],
      category: mod.category || "uncategorised",
      tags: [...(mod.tags || [])],
      fileSize: typeof mod.fileSize === "number" ? mod.fileSize : 0,
      lines: typeof mod.lines === "number" ? mod.lines : 0,
      complexity: typeof mod.complexity === "number" ? mod.complexity : 5,
      deprecated: Boolean(mod.deprecated),
      description: mod.description || "",
    };
  }
  return map;
}

function normalisePath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.js$/, "")
    .replace(/\/index$/, "");
}

module.exports = {
  ConsolidationAnalyzer,
  buildModuleMap,
  buildDuplicatePair,
  // helpers exported for testing
  jaccardSimilarity,
  diceSimilarity,
  nameSimilarity,
  exportSimilarity,
  dependencyOverlap,
  commonPrefixLength,
};
