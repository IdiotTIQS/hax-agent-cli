"use strict";

/**
 * MigrationGuide — generates migration instructions for consolidating
 * overlapping modules in a project.
 *
 * Given a consolidation plan (output of ConsolidationAnalyzer), this
 * class produces human-readable migration guides, breaking-change
 * catalogues, compatibility shim suggestions, and an automated
 * migration script skeleton.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function indent(str, depth = 2) {
  const prefix = " ".repeat(depth);
  return String(str)
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

function slugToVarName(slug) {
  return slug
    .replace(/^.*[/\\]/, "") // keep last path segment
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function slugToCamel(name) {
  return name
    .replace(/[^a-zA-Z0-9]/g, " ")
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

/**
 * Generate a suggested name for the merged module.
 */
function suggestMergedName(cluster) {
  if (!Array.isArray(cluster) || cluster.length === 0) return "merged";

  const cats = new Set(cluster.map((m) => m.category).filter(Boolean));
  if (cats.size === 1) return `${[...cats][0]}-consolidated`;

  const segments = [];
  for (const mod of cluster) {
    const seg = (mod.slug || "").split("/").pop();
    if (seg && seg !== "index") segments.push(seg);
  }

  if (segments.length === 1) return `${segments[0]}-consolidated`;
  if (segments.length === 2) return `${segments[0]}-${segments[1]}`;
  // Take the first common prefix.
  let prefix = segments[0];
  for (const s of segments.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.length >= 3 ? `${prefix}-core` : "consolidated-module";
}

// ---------------------------------------------------------------------------
// MigrationGuide
// ---------------------------------------------------------------------------

class MigrationGuide {
  /**
   * @param {object} [options]
   * @param {string} [options.projectRoot="src"] - relative root for import paths
   * @param {string} [options.packageManager="npm"] - package manager name
   */
  constructor(options = {}) {
    this._projectRoot = options.projectRoot || "src";
    this._packageManager = options.packageManager || "npm";
  }

  // -------------------------------------------------------------------
  // generateGuide
  // -------------------------------------------------------------------

  /**
   * Generate a step-by-step consolidation guide from a plan.
   *
   * @param {object} plan - output of ConsolidationAnalyzer.getConsolidationPlan()
   * @returns {string} formatted guide text
   */
  generateGuide(plan) {
    if (!plan || !Array.isArray(plan.phases) || plan.phases.length === 0) {
      return "# Consolidation Guide\n\nNo consolidation actions required.";
    }

    const lines = [];

    lines.push("# Consolidation Migration Guide");
    lines.push("");
    lines.push(`**Total Modules to Merge:** ${plan.totalModulesToMerge}`);
    lines.push(`**Modules Eliminated:** ${plan.totalModulesEliminated}`);
    lines.push(`**Estimated Total Effort:** ${plan.totalEffort} story points`);
    lines.push("");

    // Table of contents
    lines.push("## Contents");
    lines.push("");
    for (const phase of plan.phases) {
      lines.push(`- [Phase ${phase.phase}: ${phase.title}](#phase-${phase.phase}-${slugToVarName(phase.title)})`);
    }
    lines.push("");

    // Phase-by-phase instructions
    let stepCounter = 1;

    for (const phase of plan.phases) {
      lines.push(`## Phase ${phase.phase}: ${phase.title}`);
      lines.push("");
      lines.push(`_${phase.description}_`);
      lines.push("");
      lines.push(`**Subtotal Effort:** ${phase.subtotalEffort} story points`);
      lines.push("");

      for (const item of phase.items) {
        const sug = item.suggestion;
        const eff = item.effort;
        const clusterSlugs = sug.cluster;
        const mergedName = suggestMergedName(sug.modules);

        lines.push(`### Step ${stepCounter++}: Merge ${clusterSlugs.join(", ")}`);
        lines.push("");
        lines.push(`**Target module:** \`${mergedName}.js\``);
        lines.push(`**Effort:** ${eff.total} story points (${eff.confidence} confidence)`);
        lines.push(`**Modules affected:** ${eff.breakdown.modulesAffected}`);
        lines.push(`**Dependents affected:** ${eff.breakdown.dependentsAffected}`);
        lines.push("");

        lines.push("#### Actions");
        lines.push("");

        lines.push("1. **Create the consolidated module**");
        lines.push(`   Create \`${this._projectRoot}/${mergedName}.js\` as the new home for the merged code.`);
        lines.push("");

        lines.push("2. **Reconcile exports**");
        lines.push("   Each source module exports the following. Ensure the new module re-exports");

        lines.push("   equivalent functionality:");
        for (const mod of sug.modules) {
          const exports = mod.exports || [];
          lines.push(`   - \`${mod.path || mod.slug}\` → ${exports.length > 0 ? exports.join(", ") : "(no exports)"}`);
        }
        lines.push("");

        lines.push("3. **Migrate internals**");
        lines.push("   - Resolve naming conflicts between modules (rename internally, keep public API stable).");
        lines.push("   - Deduplicate shared utility functions (keep one canonical version).");
        lines.push("   - Unify shared dependency imports.");
        lines.push("");

        lines.push("4. **Update dependents**");
        if (eff.breakdown.dependentsAffected > 0) {
          lines.push(`   - Search for \`require("${clusterSlugs.join('")\\) or \`require("')}")\` and replace.`);
          lines.push(`   - Run \`${this._packageManager} test\` to verify correctness.`);
        } else {
          lines.push("   No external dependents detected — safe to merge.");
        }
        lines.push("");

        lines.push("5. **Deprecate and remove**");
        for (const mod of sug.modules) {
          lines.push(`   - Mark \`${mod.path || mod.slug}\` as deprecated. Add a re-export shim if needed.`);
        }
        lines.push(`   - After all dependents have migrated, delete the original ${sug.size} files.`);
        lines.push("");

        // Verification checklist
        lines.push("#### Verification");
        lines.push("");
        lines.push(`- [ ] All ${sug.totalExports} exports are present in the consolidated module`);
        lines.push(`- [ ] ${this._packageManager} test passes`);
        lines.push(`- [ ] ${this._packageManager} run lint passes`);
        lines.push(`- [ ] No circular dependency introduced`);
        lines.push("");

        lines.push("---");
        lines.push("");
      }
    }

    lines.push("## Post-Migration Checklist");
    lines.push("");
    lines.push("- [ ] Run full test suite: `npm test`");
    lines.push("- [ ] Run linter: `npm run lint`");
    lines.push("- [ ] Search codebase for stale imports: `rg \"require.*<old-module>\"`");
    lines.push("- [ ] Update CLAUDE.md / README references");
    lines.push("- [ ] Delete deprecated files");
    lines.push("- [ ] Update changelog with consolidation notes");
    lines.push("");

    return lines.join("\n");
  }

  // -------------------------------------------------------------------
  // generateBreakingChanges
  // -------------------------------------------------------------------

  /**
   * List all breaking changes a consolidation plan will introduce.
   *
   * @param {object} plan - output of ConsolidationAnalyzer.getConsolidationPlan()
   * @returns {object} structured breaking-change catalogue
   */
  generateBreakingChanges(plan) {
    const changes = [];
    let totalAffectedDependents = 0;

    if (!plan || !Array.isArray(plan.phases)) {
      return { changes: [], totalAffectedDependents: 0, severe: 0, moderate: 0, minor: 0 };
    }

    for (const phase of plan.phases) {
      for (const item of phase.items) {
        const sug = item.suggestion;
        const eff = item.effort;
        const clusterSlugs = sug.cluster;
        const mergedName = suggestMergedName(sug.modules);

        // Change 1: Import path changes
        for (const slug of clusterSlugs) {
          const mod = sug.modules.find((m) => (m.slug || m.path) === slug);
          if (!mod) continue;

          totalAffectedDependents += eff.breakdown.dependentsAffected;

          changes.push({
            type: "import_path_change",
            severity: eff.breakdown.dependentsAffected > 5 ? "severe" : eff.breakdown.dependentsAffected > 0 ? "moderate" : "minor",
            description: `Import path for "${slug}" changes to "${mergedName}"`,
            oldPath: mod.path || slug,
            newPath: `${this._projectRoot}/${mergedName}.js`,
            affectedDependents: eff.breakdown.dependentsAffected,
            mitigation: `Add a re-export shim at the old path during the transition period.`,
          });
        }

        // Change 2: Export name conflicts
        const allExports = [];
        const exportSet = new Set();
        const conflicts = new Set();
        for (const mod of sug.modules) {
          for (const exp of mod.exports || []) {
            allExports.push({ name: exp, source: mod.slug || mod.path });
            if (exportSet.has(exp)) {
              conflicts.add(exp);
            } else {
              exportSet.add(exp);
            }
          }
        }

        if (conflicts.size > 0) {
          changes.push({
            type: "export_name_conflict",
            severity: conflicts.size > 2 ? "severe" : "moderate",
            description: `${conflicts.size} export name conflict(s) must be resolved during merge`,
            conflictingNames: [...conflicts],
            allExports,
            mitigation: "Rename one of the conflicting exports, or namespace them under distinct objects.",
          });
        }

        // Change 3: Module removal
        if (clusterSlugs.length > 1) {
          changes.push({
            type: "module_removal",
            severity: eff.breakdown.modulesAffected > 3 ? "severe" : "moderate",
            description: `${clusterSlugs.length - 1} of ${clusterSlugs.length} source modules will be removed`,
            keptModule: mergedName,
            removedModules: clusterSlugs.filter((s) => !s.includes(mergedName)),
            newModule: mergedName,
            mitigation: "Re-export shims at old locations during a deprecation window.",
          });
        }

        // Change 4: Dependency graph changes
        if (eff.breakdown.categories.length > 1) {
          changes.push({
            type: "cross_category_merge",
            severity: "moderate",
            description: `Merge spans ${eff.breakdown.categories.length} categories: ${eff.breakdown.categories.join(", ")}`,
            categories: eff.breakdown.categories,
            mitigation: "Coordinate with owners of each category domain to agree on API surface.",
          });
        }
      }
    }

    const severe = changes.filter((c) => c.severity === "severe").length;
    const moderate = changes.filter((c) => c.severity === "moderate").length;
    const minor = changes.filter((c) => c.severity === "minor").length;

    return {
      changes,
      totalAffectedDependents,
      severe,
      moderate,
      minor,
      summary: `${changes.length} breaking changes: ${severe} severe, ${moderate} moderate, ${minor} minor. ${totalAffectedDependents} total dependents affected.`,
    };
  }

  // -------------------------------------------------------------------
  // generateCompatLayer
  // -------------------------------------------------------------------

  /**
   * Generate compatibility shim suggestions for each consolidation.
   *
   * @param {object} plan - output of ConsolidationAnalyzer.getConsolidationPlan()
   * @returns {object[]} list of compat-layer suggestions with code snippets
   */
  generateCompatLayer(plan) {
    const layers = [];

    if (!plan || !Array.isArray(plan.phases)) {
      return layers;
    }

    for (const phase of plan.phases) {
      for (const item of phase.items) {
        const sug = item.suggestion;
        const clusterSlugs = sug.cluster;
        const mergedName = suggestMergedName(sug.modules);

        const shims = [];

        for (const mod of sug.modules) {
          const slug = mod.slug || mod.path || "";
          const oldPath = mod.path;

          if (!oldPath) continue;

          const exportNames = mod.exports || [];
          if (exportNames.length === 0) continue;

          // Build a re-export shim.
          const newPath = `../${mergedName}`;
          const relativeNewPath = computeRelativeImport(oldPath, mergedName + ".js");

          const lines = [`"use strict";`, ``, `/**`, ` * @deprecated Use \`${relativeNewPath}\` instead.`, ` */`, ``];

          const destructured = exportNames.join(", ");
          lines.push(`const { ${destructured} } = require("${relativeNewPath}");`);
          lines.push("");

          for (const name of exportNames) {
            lines.push(`module.exports.${name} = ${name};`);
          }

          shims.push({
            sourceModule: oldPath,
            targetModule: relativeNewPath,
            exportsBridged: exportNames,
            shimPath: oldPath,
            shimContent: lines.join("\n"),
          });
        }

        layers.push({
          mergedModule: `${this._projectRoot}/${mergedName}.js`,
          mergedName,
          sourceModules: clusterSlugs,
          shims,
          summary: `${shims.length} compatibility shims needed.`,
        });
      }
    }

    return layers;
  }

  // -------------------------------------------------------------------
  // generateMigrationScript
  // -------------------------------------------------------------------

  /**
   * Generate an automated migration script skeleton.
   *
   * @param {object} plan - output of ConsolidationAnalyzer.getConsolidationPlan()
   * @returns {string} executable Node.js script text
   */
  generateMigrationScript(plan) {
    if (!plan || !Array.isArray(plan.phases) || plan.phases.length === 0) {
      return `"use strict";\n\n// No migrations needed.\nconsole.log("Nothing to migrate.");\n`;
    }

    const migrations = [];

    for (const phase of plan.phases) {
      for (const item of phase.items) {
        const sug = item.suggestion;
        const clusterSlugs = sug.cluster;

        for (const mod of sug.modules) {
          const oldPath = mod.path;
          if (!oldPath || mod.exports.length === 0) continue;

          migrations.push({
            oldRequire: computeRequirePattern(mod),
            newRequire: `${this._projectRoot}/${suggestMergedName(sug.modules)}`,
          });
        }
      }
    }

    const migrationData = JSON.stringify(migrations, null, 2);

    return [
      `"use strict";`,
      ``,
      `/**`,
      ` * Automated consolidation migration script.`,
      ` * Generated ${new Date().toISOString().slice(0, 10)}.`,
      ` *`,
      ` * Usage: node scripts/migrate-consolidation.js`,
      ` *`,
      ` * Reads source files, updates require() calls to point to`,
      ` * consolidated modules, and writes the changes back.`,
      ` */`,
      ``,
      `const fs = require("node:fs");`,
      `const path = require("node:path");`,
      ``,
      `const MIGRATIONS = ${migrationData};`,
      ``,
      `const DRY_RUN = process.argv.includes("--dry-run");`,
      ``,
      `function migrateFile(filePath) {`,
      `  const original = fs.readFileSync(filePath, "utf-8");`,
      `  let modified = original;`,
      `  let changeCount = 0;`,
      ``,
      `  for (const migration of MIGRATIONS) {`,
      `    for (const pattern of migration.oldRequire) {`,
      `      const count = (modified.match(pattern) || []).length;`,
      `      if (count === 0) continue;`,
      `      modified = modified.replace(pattern, \`require("\${migration.newRequire}")\`);`,
      `      changeCount += (modified.match(new RegExp(pattern.source)) || []).length;`,
      `    }`,
      `  }`,
      ``,
      `  if (changeCount > 0 && !DRY_RUN) {`,
      `    fs.writeFileSync(filePath, modified, "utf-8");`,
      `  }`,
      ``,
      `  return { file: filePath, changes: changeCount };`,
      `}`,
      ``,
      `function walk(dir) {`,
      `  const results = [];`,
      `  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {`,
      `    const full = path.join(dir, entry.name);`,
      `    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {`,
      `      results.push(...walk(full));`,
      `    } else if (entry.isFile() && entry.name.endsWith(".js")) {`,
      `      results.push(full);`,
      `    }`,
      `  }`,
      `  return results;`,
      `}`,
      ``,
      `console.log("Scanning project for files to migrate...");`,
      `const files = walk("${this._projectRoot}");`,
      `console.log(\`Found \${files.length} JS files.\`);`,
      ``,
      `let totalChanges = 0;`,
      `const report = [];`,
      ``,
      `for (const file of files) {`,
      `  try {`,
      `    const result = migrateFile(file);`,
      `    if (result.changes > 0) {`,
      `      report.push(result);`,
      `      totalChanges += result.changes;`,
      `    }`,
      `  } catch (err) {`,
      `    console.error(\`Error processing \${file}: \${err.message}\`);`,
      `  }`,
      `}`,
      ``,
      `console.log("");`,
      `if (DRY_RUN) {`,
      `  console.log("--- DRY RUN ---");`,
      `}`,
      `console.log(\`Migrated \${totalChanges} import(s) across \${report.length} file(s).\`);`,
      `for (const entry of report) {`,
      `  console.log(\`  \${entry.file}: \${entry.changes} change(s)\`);`,
      `}`,
      ``,
      `if (DRY_RUN) {`,
      `  console.log("");`,
      `  console.log("Run without --dry-run to apply changes.");`,
      `} else {`,
      `  console.log(\`\\nRun \${this._packageManager} test to verify correctness.\`);`,
      `}`,
      ``,
    ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the relative import path from module A's location to module B.
 */
function computeRelativeImport(fromPath, toFileName) {
  if (!fromPath) return `./${toFileName.replace(/\.js$/, "")}`;
  const parts = fromPath
    .replace(/\\/g, "/")
    .replace(/\.js$/, "")
    .split("/");
  parts.pop(); // remove file name, keep dir

  if (parts.length === 0) return `./${toFileName.replace(/\.js$/, "")}`;

  // If "from" is at root, just path to target.
  // For deeper paths, use relative "../" segments.
  // We simplify here — real implementation would compute the full relative path.
  const depth = parts.length;
  const prefix = depth > 0 ? "../".repeat(depth) : "./";
  return `${prefix}${toFileName.replace(/\.js$/, "")}`;
}

/**
 * Generate require() regex patterns for a module's old path.
 */
function computeRequirePattern(mod) {
  const paths = [];
  const rawPath = (mod.path || mod.slug || "").replace(/\\/g, "/");

  // require("./src/scheduler/cron")
  if (rawPath) {
    paths.push(new RegExp(`require\\("[^"]*${escapeRegex(rawPath)}[^"]*"\\)`, "g").source);
  }

  // Also match the slug form
  const slug = (mod.slug || "").replace(/\\/g, "/");
  if (slug && slug !== rawPath) {
    paths.push(new RegExp(`require\\("[^"]*${escapeRegex(slug)}[^"]*"\\)`, "g").source);
  }

  return paths;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  MigrationGuide,
  suggestMergedName,
  computeRelativeImport,
  computeRequirePattern,
};
