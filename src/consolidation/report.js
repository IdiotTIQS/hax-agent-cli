"use strict";

/**
 * ConsolidationReporter — generates consolidation reports in multiple
 * formats (plain-text, Markdown, JSON) from analysis data produced by
 * ConsolidationAnalyzer and MigrationGuide.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pluralise(n, singular, plural) {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;
}

function padRight(str, len) {
  return String(str).padEnd(len, " ");
}

function barChart(value, max, width = 20) {
  const filled = Math.round((value / Math.max(1, max)) * width);
  const empty = width - filled;
  return "#".repeat(filled) + "-".repeat(empty);
}

function formatPercent(value, total) {
  if (total === 0) return "0%";
  return Math.round((value / total) * 100) + "%";
}

// ---------------------------------------------------------------------------
// ConsolidationReporter
// ---------------------------------------------------------------------------

class ConsolidationReporter {
  /**
   * @param {object} analyzer - ConsolidationAnalyzer instance
   * @param {object} [options]
   * @param {object} [options.migrationGuide] - optional MigrationGuide instance
   */
  constructor(analyzer, options = {}) {
    if (!analyzer || typeof analyzer.findDuplicates !== "function") {
      throw new TypeError("analyzer must be a ConsolidationAnalyzer instance");
    }

    this._analyzer = analyzer;
    this._guide = options.migrationGuide || null;
    this._cache = {};
  }

  // -------------------------------------------------------------------
  // generateOverviewReport
  // -------------------------------------------------------------------

  /**
   * Produce a project-level consolidation overview.
   *
   * @returns {object} structured report data
   */
  generateOverviewReport() {
    if (this._cache.overview) return this._cache.overview;

    const plan = this._analyzer.getConsolidationPlan();
    const duplicates = this._analyzer.findDuplicates();
    const overlappingAPIs = this._analyzer.findOverlappingAPIs();
    const suggestions = this._analyzer.suggestConsolidation();
    const categoryStats = this._analyzer.getCategoryStats();
    const allSlugs = this._analyzer.getModuleSlugs();

    const totalModules = allSlugs.length;
    const duplicateModules = new Set();
    for (const d of duplicates) {
      duplicateModules.add(d.moduleA);
      duplicateModules.add(d.moduleB);
    }
    const duplicateModuleCount = duplicateModules.size;
    const mergeClusters = suggestions.length;
    const highSeverityAPIs = overlappingAPIs.filter((o) => o.severity === "high").length;

    // Category density: categories with the most modules per category.
    const categoryDensity = Object.entries(categoryStats)
      .map(([cat, data]) => ({
        category: cat,
        modules: data.count,
        exports: data.totalExports,
        density: data.totalExports / Math.max(1, data.count),
        percentOfProject: Math.round((data.count / Math.max(1, totalModules)) * 100),
      }))
      .sort((a, b) => b.modules - a.modules);

    // Top duplicates (most severe).
    const topDuplicates = duplicates.slice(0, 10).map((d) => ({
      moduleA: d.moduleA,
      moduleB: d.moduleB,
      score: d.score,
      exportSimilarity: d.exportSimilarity,
      category: d.category,
    }));

    // Health score: lower is worse (more duplication).
    const duplicationRatio = totalModules > 0 ? duplicateModuleCount / totalModules : 0;
    const healthScore = Math.round(Math.max(0, Math.min(100, (1 - duplicationRatio) * 100)));

    let healthLabel = "poor";
    if (healthScore >= 80) healthLabel = "good";
    else if (healthScore >= 60) healthLabel = "fair";

    const report = {
      projectSummary: {
        totalModules,
        duplicateModuleCount,
        duplicationPercent: Math.round(duplicationRatio * 100),
        mergeClusters,
        highSeverityAPIOverlaps: highSeverityAPIs,
        planPhases: plan.phases.length,
        totalEffort: plan.totalEffort,
        modulesEliminated: plan.totalModulesEliminated,
        healthScore,
        healthLabel,
      },
      categoryDensity,
      topDuplicates,
      topSuggestions: suggestions.slice(0, 5).map((s) => ({
        cluster: s.cluster,
        size: s.size,
        categories: s.categories,
        priority: s.priority,
      })),
      planSummary: plan.summary,
      generatedAt: new Date().toISOString(),
    };

    this._cache.overview = report;
    return report;
  }

  // -------------------------------------------------------------------
  // generateModuleReport
  // -------------------------------------------------------------------

  /**
   * Produce a per-module consolidation analysis.
   *
   * @param {string} modSlug - the module slug to analyse
   * @returns {object} per-module report
   */
  generateModuleReport(modSlug) {
    const mod = this._analyzer.getModule(modSlug);
    if (!mod) {
      return { error: `Module "${modSlug}" not found in the module map.` };
    }

    const allDuplicates = this._analyzer.findDuplicates();
    const allOverlaps = this._analyzer.findOverlappingAPIs();
    const suggestions = this._analyzer.suggestConsolidation();

    // Which duplicate pairs involve this module?
    const relatedDuplicates = allDuplicates.filter(
      (d) => d.moduleA === modSlug || d.moduleB === modSlug,
    );

    // Which API overlaps involve this module?
    const relatedOverlaps = allOverlaps.filter(
      (o) => o.moduleA === modSlug || o.moduleB === modSlug,
    );

    // Which consolidation clusters include this module?
    const relatedClusters = suggestions.filter((s) => s.cluster.includes(modSlug));

    // How many modules depend on this one?
    let dependentCount = 0;
    const dependents = [];
    for (const slug of this._analyzer.getModuleSlugs()) {
      if (slug === modSlug) continue;
      const other = this._analyzer.getModule(slug);
      if ((other.imports || []).some((i) => i === modSlug)) {
        dependentCount++;
        dependents.push(slug);
      }
    }

    const isDuplicated = relatedDuplicates.length > 0;
    const duplicationScore = relatedDuplicates.length > 0
      ? Math.max(...relatedDuplicates.map((d) => d.score))
      : 0;

    return {
      module: {
        slug: modSlug,
        path: mod.path,
        category: mod.category,
        exports: mod.exports || [],
        exportCount: (mod.exports || []).length,
        imports: mod.imports || [],
        importCount: (mod.imports || []).length,
        lines: mod.lines || 0,
        complexity: mod.complexity || 5,
        deprecated: mod.deprecated || false,
      },
      duplication: {
        isDuplicated,
        duplicateCount: relatedDuplicates.length,
        maxDuplicationScore: Math.round(duplicationScore * 10000) / 10000,
        topDuplicates: relatedDuplicates
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((d) => ({
            otherModule: d.moduleA === modSlug ? d.moduleB : d.moduleA,
            score: d.score,
            exportSimilarity: d.exportSimilarity,
            nameSimilarity: d.nameSimilarity,
          })),
      },
      apiOverlaps: {
        overlapCount: relatedOverlaps.length,
        severity: relatedOverlaps.some((o) => o.severity === "high")
          ? "high"
          : relatedOverlaps.length > 0
            ? "medium"
            : "low",
        topOverlaps: relatedOverlaps.slice(0, 5).map((o) => ({
          otherModule: o.moduleA === modSlug ? o.moduleB : o.moduleA,
          exactOverlap: o.exactOverlap,
          fuzzyOverlap: o.fuzzyOverlap,
          severity: o.severity,
        })),
      },
      consolidation: {
        inCluster: relatedClusters.length > 0,
        clusterCount: relatedClusters.length,
        clusters: relatedClusters.map((c) => ({
          modules: c.cluster,
          size: c.size,
          priority: c.priority,
        })),
      },
      dependencies: {
        dependents,
        dependentCount,
      },
      recommendation: generateModuleRecommendation({
        isDuplicated,
        duplicationScore,
        relatedOverlaps,
        relatedClusters,
        dependentCount,
        deprecated: mod.deprecated,
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------
  // generateROIReport
  // -------------------------------------------------------------------

  /**
   * Return-on-investment analysis for the proposed consolidations.
   *
   * @returns {object} ROI report
   */
  generateROIReport() {
    const plan = this._analyzer.getConsolidationPlan();
    const suggestions = this._analyzer.suggestConsolidation();
    const duplicates = this._analyzer.findDuplicates();

    if (suggestions.length === 0) {
      return {
        totalInvestment: 0,
        totalReturns: [],
        netROI: 0,
        paybackPeriod: "N/A",
        summary: "No consolidation needed — ROI is already optimal.",
        generatedAt: new Date().toISOString(),
      };
    }

    // Investment = total effort points (proxy for developer-hours).
    const totalInvestment = plan.totalEffort;

    // Returns (estimated benefits).
    const returns = [];

    // R1: Maintenance reduction — fewer files to maintain.
    const eliminatedModules = plan.totalModulesEliminated;
    const maintenanceSavingsPerModule = 2; // hours/month per eliminated module
    returns.push({
      category: "reduced_maintenance",
      description: `${eliminatedModules} fewer modules to maintain`,
      monthlyHoursSaved: eliminatedModules * maintenanceSavingsPerModule,
      confidence: "high",
    });

    // R2: Reduced duplication — less code to review, test, and debug.
    const duplicatedModuleCount = new Set(
      duplicates.flatMap((d) => [d.moduleA, d.moduleB]),
    ).size;
    const duplicationHours = Math.round(duplicatedModuleCount * 1.5);
    returns.push({
      category: "eliminated_duplication",
      description: `${duplicatedModuleCount} modules have duplicate functionality`,
      monthlyHoursSaved: duplicationHours,
      confidence: "medium",
    });

    // R3: Smaller API surface — fewer import paths to remember.
    const surfaceReduction = plan.totalModulesToMerge - plan.totalModulesEliminated;
    returns.push({
      category: "simpler_api_surface",
      description: `Reduced from ${plan.totalModulesToMerge} to ${surfaceReduction} public modules`,
      monthlyHoursSaved: Math.round(plan.totalModulesEliminated * 0.5),
      confidence: "medium",
    });

    // R4: Faster onboarding — fewer concepts to learn.
    const categoriesWithDuplication = new Set(
      suggestions.flatMap((s) => s.categories),
    ).size;
    returns.push({
      category: "faster_onboarding",
      description: `${categoriesWithDuplication} categories simplified`,
      monthlyHoursSaved: categoriesWithDuplication * 1,
      confidence: "low",
    });

    const totalMonthlyHoursSaved = returns.reduce((s, r) => s + r.monthlyHoursSaved, 0);

    // Assume 1 story point ≈ 4 developer-hours.
    const investmentHours = totalInvestment * 4;

    // Payback in months.
    const paybackMonths =
      totalMonthlyHoursSaved > 0
        ? Math.round((investmentHours / totalMonthlyHoursSaved) * 100) / 100
        : null;

    // Annual ROI.
    const annualSavingsHours = totalMonthlyHoursSaved * 12;
    const netROI =
      investmentHours > 0
        ? Math.round(((annualSavingsHours - investmentHours) / investmentHours) * 100)
        : 0;

    return {
      totalInvestment: totalInvestment,
      investmentHours,
      totalMonthlyHoursSaved,
      annualSavingsHours,
      netROI,
      paybackPeriod:
        paybackMonths === null
          ? "N/A"
          : paybackMonths <= 1
            ? "< 1 month"
            : `${paybackMonths} months`,
      returns,
      summary: generateROISummary(
        totalInvestment,
        investmentHours,
        totalMonthlyHoursSaved,
        netROI,
        paybackMonths,
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------
  // formatReport
  // -------------------------------------------------------------------

  /**
   * Format a report object into a text representation.
   *
   * @param {object} report - the output of generateOverviewReport, generateModuleReport, or generateROIReport
   * @param {string} [format="text"] - "text", "markdown", or "json"
   * @returns {string}
   */
  formatReport(report, format = "text") {
    if (!report || typeof report !== "object") {
      return "";
    }

    switch (format) {
      case "json":
        return JSON.stringify(report, null, 2);
      case "markdown":
        return this._formatMarkdown(report);
      case "text":
      default:
        return this._formatText(report);
    }
  }

  // ---- format: text ----

  _formatText(report) {
    const lines = [];

    // Determine report type.
    if (report.projectSummary) {
      lines.push(...this._overviewText(report));
    } else if (report.module) {
      lines.push(...this._moduleText(report));
    } else if (report.totalInvestment !== undefined && report.returns) {
      lines.push(...this._roiText(report));
    } else if (report.error) {
      lines.push(`ERROR: ${report.error}`);
    } else {
      lines.push(JSON.stringify(report, null, 2));
    }

    return lines.join("\n");
  }

  _overviewText(report) {
    const s = report.projectSummary;
    const lines = [];

    lines.push("=".repeat(60));
    lines.push("  PROJECT CONSOLIDATION OVERVIEW");
    lines.push("=".repeat(60));
    lines.push("");
    lines.push(`${padRight("Total modules:", 30)} ${s.totalModules}`);
    lines.push(`${padRight("Duplicate modules:", 30)} ${s.duplicateModuleCount} (${s.duplicationPercent}%)`);
    lines.push(`${padRight("Merge clusters:", 30)} ${s.mergeClusters}`);
    lines.push(`${padRight("High-severity API overlaps:", 30)} ${s.highSeverityAPIOverlaps}`);
    lines.push(`${padRight("Plan phases:", 30)} ${s.planPhases}`);
    lines.push(`${padRight("Total effort:", 30)} ${s.totalEffort} story points`);
    lines.push(`${padRight("Modules eliminable:", 30)} ${s.modulesEliminated}`);
    lines.push(`${padRight("Health score:", 30)} ${s.healthScore}/100 (${s.healthLabel})`);
    lines.push("");

    // Category density
    lines.push("-".repeat(60));
    lines.push("  CATEGORY DENSITY");
    lines.push("-".repeat(60));
    for (const c of report.categoryDensity.slice(0, 10)) {
      lines.push(
        `  ${padRight(c.category, 20)} ${padRight(pluralise(c.modules, "module"), 15)} ${barChart(c.modules, Math.max(...report.categoryDensity.map((x) => x.modules)), 15)} ${c.percentOfProject}%`,
      );
    }
    lines.push("");

    // Top duplicates
    lines.push("-".repeat(60));
    lines.push("  TOP DUPLICATES");
    lines.push("-".repeat(60));
    if (report.topDuplicates.length === 0) {
      lines.push("  (none)");
    } else {
      for (const d of report.topDuplicates) {
        lines.push(`  ${d.moduleA}  <->  ${d.moduleB}`);
        lines.push(`    Score: ${d.score}  Export similarity: ${d.exportSimilarity}  Category: ${d.category}`);
      }
    }
    lines.push("");

    // Top suggestions
    lines.push("-".repeat(60));
    lines.push("  TOP CONSOLIDATION SUGGESTIONS");
    lines.push("-".repeat(60));
    if (report.topSuggestions.length === 0) {
      lines.push("  (none)");
    } else {
      for (const s of report.topSuggestions) {
        lines.push(`  Merge [${s.cluster.join(", ")}]`);
        lines.push(`    Size: ${s.size}  Categories: ${s.categories.join(", ")}  Priority: ${s.priority}`);
      }
    }
    lines.push("");

    lines.push(`  ${report.planSummary}`);
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}`);

    return lines;
  }

  _moduleText(report) {
    const m = report.module;
    const d = report.duplication;
    const a = report.apiOverlaps;
    const c = report.consolidation;
    const dep = report.dependencies;

    const lines = [];

    lines.push("=".repeat(60));
    lines.push(`  MODULE REPORT: ${m.slug}`);
    lines.push("=".repeat(60));
    lines.push("");
    lines.push(`${padRight("Path:", 20)} ${m.path}`);
    lines.push(`${padRight("Category:", 20)} ${m.category}`);
    lines.push(`${padRight("Exports:", 20)} ${m.exportCount} ${m.exportCount > 0 ? "(" + m.exports.join(", ") + ")" : ""}`);
    lines.push(`${padRight("Imports:", 20)} ${m.importCount}`);
    lines.push(`${padRight("Lines:", 20)} ${m.lines}`);
    lines.push(`${padRight("Complexity:", 20)} ${m.complexity}`);
    lines.push(`${padRight("Deprecated:", 20)} ${m.deprecated ? "yes" : "no"}`);
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  DUPLICATION ANALYSIS");
    lines.push("-".repeat(60));
    lines.push(`${padRight("Is duplicated:", 25)} ${d.isDuplicated ? "YES" : "no"}`);
    lines.push(`${padRight("Duplicate count:", 25)} ${d.duplicateCount}`);
    lines.push(`${padRight("Max score:", 25)} ${d.maxDuplicationScore}`);
    for (const dd of d.topDuplicates) {
      lines.push(`  -> ${dd.otherModule} (score: ${dd.score}, export: ${dd.exportSimilarity}, name: ${dd.nameSimilarity})`);
    }
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  API OVERLAPS");
    lines.push("-".repeat(60));
    lines.push(`${padRight("Overlap count:", 25)} ${a.overlapCount}`);
    lines.push(`${padRight("Severity:", 25)} ${a.severity}`);
    for (const ao of a.topOverlaps) {
      lines.push(`  -> ${ao.otherModule} [${ao.severity}] exact: [${ao.exactOverlap.join(", ")}]`);
    }
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  CONSOLIDATION STATUS");
    lines.push("-".repeat(60));
    lines.push(`${padRight("In cluster:", 25)} ${c.inCluster ? "YES" : "no"}`);
    lines.push(`${padRight("Cluster count:", 25)} ${c.clusterCount}`);
    for (const cl of c.clusters) {
      lines.push(`  -> Cluster: [${cl.modules.join(", ")}] (size: ${cl.size}, priority: ${cl.priority})`);
    }
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  DEPENDENCIES");
    lines.push("-".repeat(60));
    lines.push(`${padRight("Dependent count:", 25)} ${dep.dependentCount}`);
    if (dep.dependents.length > 0) {
      lines.push(`  Dependents: ${dep.dependents.join(", ")}`);
    }
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  RECOMMENDATION");
    lines.push("-".repeat(60));
    lines.push(`  ${report.recommendation}`);
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}`);

    return lines;
  }

  _roiText(report) {
    const lines = [];

    lines.push("=".repeat(60));
    lines.push("  CONSOLIDATION ROI ANALYSIS");
    lines.push("=".repeat(60));
    lines.push("");
    lines.push(`${padRight("Total investment:", 30)} ${report.totalInvestment} story points (${report.investmentHours} developer-hours)`);
    lines.push(`${padRight("Monthly hours saved:", 30)} ${report.totalMonthlyHoursSaved}h`);
    lines.push(`${padRight("Annual hours saved:", 30)} ${report.annualSavingsHours}h`);
    lines.push(`${padRight("Net ROI (first year):", 30)} ${report.netROI}%`);
    lines.push(`${padRight("Payback period:", 30)} ${report.paybackPeriod}`);
    lines.push("");

    lines.push("-".repeat(60));
    lines.push("  RETURNS BREAKDOWN");
    lines.push("-".repeat(60));
    const maxSavings = Math.max(...report.returns.map((r) => r.monthlyHoursSaved), 1);
    for (const r of report.returns) {
      const bar = barChart(r.monthlyHoursSaved, maxSavings, 15);
      lines.push(
        `  ${padRight(r.category, 25)} ${bar} ${r.monthlyHoursSaved}h/mo  [${r.confidence}]`,
      );
      lines.push(`  ${r.description}`);
    }
    lines.push("");

    lines.push(`  ${report.summary}`);
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}`);

    return lines;
  }

  // ---- format: markdown ----

  _formatMarkdown(report) {
    if (report.projectSummary) {
      return this._overviewMarkdown(report);
    }
    if (report.module) {
      return this._moduleMarkdown(report);
    }
    if (report.totalInvestment !== undefined && report.returns) {
      return this._roiMarkdown(report);
    }
    if (report.error) {
      return `**ERROR:** ${report.error}\n`;
    }
    return (
      "```json\n" + JSON.stringify(report, null, 2) + "\n```\n"
    );
  }

  _overviewMarkdown(report) {
    const s = report.projectSummary;
    const lines = [];

    lines.push("# Project Consolidation Overview");
    lines.push("");

    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Total modules | ${s.totalModules} |`);
    lines.push(`| Duplicate modules | ${s.duplicateModuleCount} (${s.duplicationPercent}%) |`);
    lines.push(`| Merge clusters | ${s.mergeClusters} |`);
    lines.push(`| High-severity API overlaps | ${s.highSeverityAPIOverlaps} |`);
    lines.push(`| Plan phases | ${s.planPhases} |`);
    lines.push(`| Total effort | ${s.totalEffort} story points |`);
    lines.push(`| Modules eliminable | ${s.modulesEliminated} |`);
    lines.push(`| Health score | ${s.healthScore}/100 (**${s.healthLabel}**) |`);
    lines.push("");

    lines.push("## Category Density");
    lines.push("");
    lines.push("| Category | Modules | Share |");
    lines.push("| --- | --- | --- |");
    for (const c of report.categoryDensity.slice(0, 10)) {
      lines.push(`| ${c.category} | ${c.modules} | ${c.percentOfProject}% |`);
    }
    lines.push("");

    lines.push("## Top Duplicates");
    lines.push("");
    if (report.topDuplicates.length === 0) {
      lines.push("_None detected._");
    } else {
      for (const d of report.topDuplicates) {
        lines.push(
          `- **${d.moduleA}** <-> **${d.moduleB}** (score: ${d.score}, export similarity: ${d.exportSimilarity})`,
        );
      }
    }
    lines.push("");

    lines.push("## Top Consolidation Suggestions");
    lines.push("");
    if (report.topSuggestions.length === 0) {
      lines.push("_None._");
    } else {
      for (const s of report.topSuggestions) {
        lines.push(`- Merge \`${s.cluster.join(", ")}\` (size: ${s.size}, priority: ${s.priority})`);
      }
    }
    lines.push("");

    lines.push(`> ${report.planSummary}`);
    lines.push("");
    lines.push(`*Generated: ${report.generatedAt}*`);

    return lines.join("\n");
  }

  _moduleMarkdown(report) {
    const m = report.module;
    const d = report.duplication;
    const a = report.apiOverlaps;
    const c = report.consolidation;
    const dep = report.dependencies;

    const lines = [];

    lines.push(`# Module Report: \`${m.slug}\``);
    lines.push("");

    lines.push("## Basic Info");
    lines.push("");
    lines.push("| Property | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Path | \`${m.path}\` |`);
    lines.push(`| Category | ${m.category} |`);
    lines.push(`| Exports | ${m.exportCount} |`);
    lines.push(`| Imports | ${m.importCount} |`);
    lines.push(`| Lines | ${m.lines} |`);
    lines.push(`| Complexity | ${m.complexity} |`);
    lines.push(`| Deprecated | ${m.deprecated ? "yes" : "no"} |`);
    lines.push("");

    lines.push("## Duplication Analysis");
    lines.push("");
    lines.push(`- **Is duplicated:** ${d.isDuplicated ? "YES" : "no"}`);
    lines.push(`- **Duplicate count:** ${d.duplicateCount}`);
    lines.push(`- **Max score:** ${d.maxDuplicationScore}`);
    for (const dd of d.topDuplicates) {
      lines.push(`  - ${dd.otherModule} (score: ${dd.score})`);
    }
    lines.push("");

    lines.push("## API Overlaps");
    lines.push("");
    lines.push(`- **Overlaps:** ${a.overlapCount} (severity: **${a.severity}**)`);
    for (const ao of a.topOverlaps) {
      lines.push(`  - ${ao.otherModule} [${ao.severity}] exact: \`${ao.exactOverlap.join(", ")}\``);
    }
    lines.push("");

    lines.push("## Consolidation");
    lines.push("");
    lines.push(`- **In cluster:** ${c.inCluster ? "YES" : "no"}`);
    lines.push(`- **Cluster count:** ${c.clusterCount}`);
    lines.push("");

    lines.push("## Dependencies");
    lines.push("");
    lines.push(`- **Dependents:** ${dep.dependentCount}`);
    lines.push("");

    lines.push("## Recommendation");
    lines.push("");
    lines.push(`> ${report.recommendation}`);
    lines.push("");
    lines.push(`*Generated: ${report.generatedAt}*`);

    return lines.join("\n");
  }

  _roiMarkdown(report) {
    const lines = [];

    lines.push("# Consolidation ROI Analysis");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Total investment | ${report.totalInvestment} story points (${report.investmentHours} dev-hours) |`);
    lines.push(`| Monthly hours saved | ${report.totalMonthlyHoursSaved}h |`);
    lines.push(`| Annual hours saved | ${report.annualSavingsHours}h |`);
    lines.push(`| Net ROI (first year) | ${report.netROI}% |`);
    lines.push(`| Payback period | ${report.paybackPeriod} |`);
    lines.push("");

    lines.push("## Returns Breakdown");
    lines.push("");
    lines.push("| Category | Monthly Savings | Confidence | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of report.returns) {
      lines.push(
        `| ${r.category} | ${r.monthlyHoursSaved}h | ${r.confidence} | ${r.description} |`,
      );
    }
    lines.push("");

    lines.push(`> ${report.summary}`);
    lines.push("");
    lines.push(`*Generated: ${report.generatedAt}*`);

    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Recommendation helper
// ---------------------------------------------------------------------------

function generateModuleRecommendation(opts) {
  const parts = [];

  if (opts.deprecated) {
    parts.push("Module is deprecated. Remove after dependents are migrated.");
  }

  if (opts.isDuplicated && opts.duplicationScore >= 0.7) {
    parts.push("High duplication detected. Strongly consider merging with the top duplicate candidate.");
  } else if (opts.isDuplicated && opts.duplicationScore >= 0.4) {
    parts.push("Moderate duplication detected. Review the top duplicate candidates for merge feasibility.");
  } else if (opts.isDuplicated) {
    parts.push("Mild duplication detected. Monitor for divergence.");
  }

  if (opts.relatedOverlaps && opts.relatedOverlaps.length > 0) {
    const high = opts.relatedOverlaps.filter((o) => o.severity === "high");
    if (high.length > 0) {
      parts.push(`${high.length} high-severity API overlap(s) found. Address with priority.`);
    }
  }

  if (opts.relatedClusters && opts.relatedClusters.length > 0) {
    parts.push("Part of a consolidation cluster. Follow the migration plan for this cluster.");
  }

  if (opts.dependentCount === 0) {
    parts.push("No external dependents — safe to refactor or remove freely.");
  } else if (opts.dependentCount > 5) {
    parts.push(`High dependency count (${opts.dependentCount} dependents). Coordinate migration carefully.`);
  }

  if (parts.length === 0) {
    parts.push("No consolidation action recommended at this time.");
  }

  return parts.join(" ");
}

function generateROISummary(
  totalInvestment,
  investmentHours,
  monthlySavings,
  netROI,
  paybackMonths,
) {
  if (monthlySavings === 0) {
    return "Insufficient data to compute meaningful ROI.";
  }

  const payback =
    paybackMonths === null
      ? "N/A"
      : paybackMonths <= 1
        ? "less than a month"
        : `${paybackMonths} months`;

  if (netROI > 100) {
    return `Strong ROI: investing ${totalInvestment} story points (${investmentHours}h) yields ${monthlySavings}h/month savings. Payback in ${payback}. Net first-year ROI: ${netROI}%.`;
  }

  if (netROI > 0) {
    return `Positive ROI: ${totalInvestment} story points invested for ${monthlySavings}h/month ongoing savings. Payback in ${payback}.`;
  }

  return `Marginal ROI: the consolidation investment (${totalInvestment} points) may not fully pay back in the first year. Focus on quick wins in Phase 1 first.`;
}

module.exports = {
  ConsolidationReporter,
  generateModuleRecommendation,
  generateROISummary,
};
