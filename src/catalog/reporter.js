"use strict";

const path = require("node:path");
const fs = require("node:fs");

/**
 * CatalogReporter — generates human- and machine-readable reports from
 * a ModuleScanner catalog.
 *
 * Reports:
 *   - Full module catalog (alphabetical, with all metadata)
 *   - Orphan report (unused modules with recommendations)
 *   - Dependency report (graph data for visualisation)
 *   - Coverage report (tests vs source mapping)
 */

class CatalogReporter {
  /**
   * @param {import('./scanner').ModuleScanner} scanner
   *   A scanned ModuleScanner instance.
   * @param {object} [opts]
   * @param {string} [opts.projectRoot] — project root for computing relative paths
   */
  constructor(scanner, opts = {}) {
    this._scanner = scanner;
    this._projectRoot = opts.projectRoot || process.cwd();
  }

  // -------------------------------------------------------------------
  // Report generators
  // -------------------------------------------------------------------

  /**
   * Generate a complete module catalog report.
   *
   * @returns {object} { title, generatedAt, stats, modules[] }
   */
  generateModuleReport() {
    const stats = this._scanner.getModuleStats();
    const modules = this._scanner.getAllModules();

    const byDir = {};
    for (const mod of modules) {
      const dir = path.dirname(mod.relativePath) || "(root)";
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push(mod);
    }

    return {
      title: "Module Catalog",
      generatedAt: new Date().toISOString(),
      projectRoot: this._projectRoot,
      stats,
      modules,
      byDirectory: byDir,
    };
  }

  /**
   * Generate an orphan (unused) modules report with recommendations.
   *
   * @returns {object} { title, generatedAt, orphanCount, orphans[],
   *                     recommendations[] }
   */
  generateOrphanReport() {
    const orphans = this._scanner.getOrphanModules();
    const recommendations = [];

    for (const orphan of orphans) {
      const rec = this._classifyOrphan(orphan);
      if (rec) recommendations.push(rec);
    }

    return {
      title: "Orphan Module Report",
      generatedAt: new Date().toISOString(),
      orphanCount: orphans.length,
      orphans,
      recommendations,
    };
  }

  /**
   * Generate a dependency report suitable for visualisation (e.g. a DAG).
   *
   * @returns {object} { title, generatedAt, nodes[], edges[],
   *                     summary: { totalNodes, totalEdges, maxInDegree, maxOutDegree } }
   */
  generateDependencyReport() {
    const graph = this._scanner.getModuleGraph();
    const inDegree = new Map();
    const outDegree = new Map();

    // Build node list and degree maps
    for (const [mod, imports] of Object.entries(graph)) {
      outDegree.set(mod, imports.length);
      if (!inDegree.has(mod)) inDegree.set(mod, 0);
      for (const imp of imports) {
        inDegree.set(imp, (inDegree.get(imp) || 0) + 1);
      }
    }

    const nodes = [];
    for (const [mod] of Object.entries(graph)) {
      nodes.push({
        id: mod,
        label: path.basename(mod, ".js"),
        inDegree: inDegree.get(mod) || 0,
        outDegree: outDegree.get(mod) || 0,
      });
    }

    const edges = [];
    for (const [mod, imports] of Object.entries(graph)) {
      for (const imp of imports) {
        edges.push({ source: mod, target: imp });
      }
    }

    const allIn = [...inDegree.values()];
    const allOut = [...outDegree.values()];

    return {
      title: "Dependency Report",
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
      summary: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        maxInDegree: allIn.length > 0 ? Math.max(...allIn) : 0,
        maxOutDegree: allOut.length > 0 ? Math.max(...allOut) : 0,
      },
    };
  }

  /**
   * Generate a test coverage overview by comparing modules under src/
   * with test files under test/.
   *
   * A module `src/foo.js` is considered "covered" if a corresponding
   * test file exists (e.g. `test/foo.test.js` or `test/foo-test.js`).
   *
   * @returns {object} { title, generatedAt, summary: { total, covered,
   *                     uncovered, coveragePct }, covered[], uncovered[] }
   */
  generateCoverageReport() {
    const all = this._scanner.getAllModules();

    // Only consider source modules (src/), not tests or config files
    const srcModules = all.filter((m) => {
      const rel = m.relativePath;
      return (
        (rel.startsWith("src/") || rel.startsWith("src\\")) &&
        !rel.includes("node_modules") &&
        !rel.match(/\.(test|spec|smoke)\.js$/) &&
        !rel.match(/(^|\/)test\//)
      );
    });

    // Build set of covered module names
    const covered = [];
    const uncovered = [];

    for (const mod of srcModules) {
      const basename = path.basename(mod.relativePath, ".js");

      // Look for corresponding test files
      const possibleTests = [
        `test/${mod.relativePath.replace(/^src[\\/]/, "").replace(/\.js$/, ".test.js")}`,
        `test/${mod.relativePath.replace(/^src[\\/]/, "").replace(/\.js$/, "-test.js")}`,
        `test/${basename}.test.js`,
      ];

      // Check if any of the catalog'd modules match these paths
      const allRelPaths = all.map((a) => a.relativePath.replace(/\\/g, "/"));
      const hasTest = possibleTests.some((pt) =>
        allRelPaths.includes(pt.replace(/\\/g, "/"))
      );

      if (hasTest) {
        covered.push({ module: mod.relativePath, linesOfCode: mod.linesOfCode });
      } else {
        uncovered.push({ module: mod.relativePath, linesOfCode: mod.linesOfCode });
      }
    }

    const total = covered.length + uncovered.length;
    const coveragePct =
      total > 0 ? Math.round((covered.length / total) * 10000) / 100 : 0;

    return {
      title: "Test Coverage Overview",
      generatedAt: new Date().toISOString(),
      summary: {
        total,
        covered: covered.length,
        uncovered: uncovered.length,
        coveragePct,
      },
      covered,
      uncovered,
    };
  }

  // -------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------

  /**
   * Format any report object as Markdown.
   *
   * @param {object} report — a report object from one of the generate* methods
   * @returns {string} markdown string
   */
  formatAsMarkdown(report) {
    const type = report.title || "";

    switch (type) {
      case "Module Catalog":
        return this._formatCatalogMarkdown(report);
      case "Orphan Module Report":
        return this._formatOrphanMarkdown(report);
      case "Dependency Report":
        return this._formatDependencyMarkdown(report);
      case "Test Coverage Overview":
        return this._formatCoverageMarkdown(report);
      default:
        return this._formatGenericMarkdown(report);
    }
  }

  // -------------------------------------------------------------------
  // Private: orphan classification
  // -------------------------------------------------------------------

  /**
   * Classify an orphan module and suggest a recommendation.
   */
  _classifyOrphan(orphan) {
    const rel = orphan.relativePath;
    const name = path.basename(rel, ".js");
    const dir = path.dirname(rel);

    // Test helper — may be intentionally separate
    if (
      rel.includes("test") ||
      name.endsWith(".test") ||
      name.endsWith(".spec") ||
      name.endsWith(".smoke")
    ) {
      return {
        module: rel,
        category: "test-utility",
        recommendation: "Test helper files are often standalone — verify they are imported by test runners.",
      };
    }

    // Entry point
    if (name === "index" || name === "main" || name === "cli") {
      return {
        module: rel,
        category: "entry-point",
        recommendation: "Entry point — may not need to be imported elsewhere. Verify it is referenced in package.json or CLI setup.",
      };
    }

    // Script/runner
    if (dir.includes("scripts") || dir.includes("bin")) {
      return {
        module: rel,
        category: "script",
        recommendation: "Standalone script — confirm it is invoked directly (not via require).",
      };
    }

    // Utility / config — might be loaded dynamically
    if (name.includes("config") || name.includes("constant")) {
      return {
        module: rel,
        category: "config",
        recommendation: "Config file — may be loaded dynamically. Check if it is referenced in any JSON or YAML config.",
      };
    }

    // Truly orphan — consider removing or integrating
    return {
      module: rel,
      category: "potential-orphan",
      recommendation: `Module has zero inbound imports. Consider removing if unused, or wrap in an integration test to prevent accidental deletion.`,
    };
  }

  // -------------------------------------------------------------------
  // Private: markdown formatters
  // -------------------------------------------------------------------

  _formatCatalogMarkdown(report) {
    let md = "";
    md += `# ${report.title}\n\n`;
    md += `**Generated:** ${report.generatedAt}  \n`;
    md += `**Project:** ${report.projectRoot}\n\n`;
    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total modules | ${report.stats.totalModules} |\n`;
    md += `| Total lines of code | ${report.stats.totalLinesOfCode} |\n`;
    md += `| Total exports | ${report.stats.totalExports} |\n`;
    md += `| Total imports | ${report.stats.totalImports} |\n`;
    md += `| Modules with JSDoc | ${report.stats.modulesWithJSDoc} |\n`;
    md += `| Avg LOC / module | ${report.stats.avgLinesPerModule} |\n\n`;

    md += `## Modules by Directory\n\n`;
    const dirs = Object.keys(report.byDirectory).sort();
    for (const dir of dirs) {
      md += `### ${dir}\n\n`;
      md += `| File | LOC | Exports | Imports | JSDoc |\n`;
      md += `|------|-----|---------|---------|-------|\n`;
      for (const mod of report.byDirectory[dir]) {
        const name = path.basename(mod.relativePath);
        const jsdocStatus = mod.jsdoc ? "yes" : "no";
        md += `| ${name} | ${mod.linesOfCode} | ${mod.exports.length} | ${mod.imports.length} | ${jsdocStatus} |\n`;
      }
      md += "\n";
    }

    return md;
  }

  _formatOrphanMarkdown(report) {
    let md = "";
    md += `# ${report.title}\n\n`;
    md += `**Generated:** ${report.generatedAt}  \n`;
    md += `**Orphan count:** ${report.orphanCount}\n\n`;

    if (report.orphans.length === 0) {
      md += `No orphan modules detected. All scanned modules have at least one inbound dependency.\n`;
      return md;
    }

    md += `## Orphan Modules\n\n`;
    md += `| Module | LOC | Recommendation |\n`;
    md += `|--------|-----|----------------|\n`;
    for (const rec of report.recommendations) {
      const orphan = report.orphans.find(
        (o) => o.relativePath === rec.module
      );
      const loc = orphan ? orphan.linesOfCode : "?";
      md += `| ${rec.module} | ${loc} | ${rec.category}: ${rec.recommendation} |\n`;
    }

    // Include any orphans without a recommendation
    const recModules = new Set(report.recommendations.map((r) => r.module));
    const leftover = report.orphans.filter(
      (o) => !recModules.has(o.relativePath)
    );
    if (leftover.length > 0) {
      for (const orphan of leftover) {
        md += `| ${orphan.relativePath} | ${orphan.linesOfCode} | No specific recommendation |\n`;
      }
    }

    return md;
  }

  _formatDependencyMarkdown(report) {
    let md = "";
    md += `# ${report.title}\n\n`;
    md += `**Generated:** ${report.generatedAt}\n\n`;

    md += `## Graph Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total nodes | ${report.summary.totalNodes} |\n`;
    md += `| Total edges | ${report.summary.totalEdges} |\n`;
    md += `| Max in-degree | ${report.summary.maxInDegree} |\n`;
    md += `| Max out-degree | ${report.summary.maxOutDegree} |\n\n`;

    md += `## Most Depended-Upon Modules\n\n`;
    md += `| Module | In-Degree | Out-Degree |\n`;
    md += `|--------|-----------|------------|\n`;
    const sorted = [...report.nodes].sort(
      (a, b) => b.inDegree - a.inDegree
    );
    for (const node of sorted.slice(0, 20)) {
      if (node.inDegree === 0) break;
      md += `| ${node.id} | ${node.inDegree} | ${node.outDegree} |\n`;
    }

    md += `\n## Edges\n\n`;
    md += `| Source | Target |\n`;
    md += `|--------|--------|\n`;
    for (const edge of report.edges.slice(0, 100)) {
      md += `| ${edge.source} | ${edge.target} |\n`;
    }
    if (report.edges.length > 100) {
      md += `| ... | *${report.edges.length - 100} more edges* |\n`;
    }

    return md;
  }

  _formatCoverageMarkdown(report) {
    let md = "";
    md += `# ${report.title}\n\n`;
    md += `**Generated:** ${report.generatedAt}\n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total source modules | ${report.summary.total} |\n`;
    md += `| Covered | ${report.summary.covered} |\n`;
    md += `| Uncovered | ${report.summary.uncovered} |\n`;
    md += `| Coverage | ${report.summary.coveragePct}% |\n\n`;

    if (report.uncovered.length > 0) {
      md += `## Uncovered Modules\n\n`;
      md += `| Module | LOC |\n`;
      md += `|--------|-----|\n`;
      for (const m of report.uncovered) {
        md += `| ${m.module} | ${m.linesOfCode} |\n`;
      }
      md += "\n";
    } else {
      md += `All source modules have corresponding test files. Great job!\n`;
    }

    if (report.covered.length > 0) {
      md += `## Covered Modules\n\n`;
      md += `| Module | LOC |\n`;
      md += `|--------|-----|\n`;
      for (const m of report.covered) {
        md += `| ${m.module} | ${m.linesOfCode} |\n`;
      }
    }

    return md;
  }

  _formatGenericMarkdown(report) {
    // Fallback: pretty-print JSON-like
    let md = `# Report\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n\n`;
    md += "```json\n";
    md += JSON.stringify(report, null, 2);
    md += "\n```\n";
    return md;
  }
}

module.exports = { CatalogReporter };
