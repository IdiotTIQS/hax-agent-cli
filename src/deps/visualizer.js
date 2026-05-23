"use strict";

/**
 * ANSI escape codes for terminal styling.
 */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/**
 * Unicode box-drawing and tree characters.
 */
const BOX = {
  tee: "├── ",   // ├──
  elbow: "└── ", // └──
  pipe: "│   ",            // │
  blank: "    ",                //
  hbar: "─",               // ─
  vbar: "│",               // │
  topLeft: "┌",            // ┌
  topRight: "┐",           // ┐
  bottomLeft: "└",         // └
  bottomRight: "┘",        // ┘
  cross: "┼",              // ┼
  hbarBold: "━",           // ━
  vbarBold: "┃",           // ┃
};

/**
 * Provides text-based visual representations of module dependency structures
 * produced by ModuleDependencyAnalyzer.
 *
 * All render methods return plain strings (with ANSI codes when `useColor`
 * is true) suitable for printing to a terminal.
 */
class DependencyVisualizer {
  /**
   * @param {object} [options={}]
   * @param {boolean} [options.useColor=true] - Enable/disable ANSI color output.
   * @param {number}  [options.maxDepth=10]   - Maximum tree/graph depth.
   * @param {number}  [options.maxWidth=120]  - Maximum output width for wrapping.
   */
  constructor(options = {}) {
    this._useColor = options.useColor !== false;
    this._maxDepth = options.maxDepth || 10;
    this._maxWidth = options.maxWidth || 120;
  }

  /**
   * Renders an ASCII tree of all dependencies for a given module.
   *
   * @param {ModuleDependencyAnalyzer} analyzer - A fully-analyzed instance.
   * @param {string} module - The relative file path to start from.
   * @returns {string} Formatted multi-line string.
   */
  renderDependencyTree(analyzer, module) {
    const importGraph = analyzer.getImportGraph();
    const rootDeps = importGraph.get(module);

    if (!rootDeps) {
      return this._c(`Module "${module}" not found in analyzed project.`, "red");
    }

    const lines = [];
    lines.push(this._c(module, "bold"));
    lines.push("");

    if (rootDeps.size === 0) {
      lines.push(this._c("  (no project dependencies)", "dim"));
      return lines.join("\n");
    }

    const visited = new Set();
    this._buildTree(lines, rootDeps, importGraph, "", visited, 0);

    return lines.join("\n");
  }

  /**
   * Renders an import matrix showing who imports whom.
   *
   * Rows = importing files, columns = imported files.
   * 'X' means the row imports the column.
   *
   * @param {ModuleDependencyAnalyzer} analyzer - A fully-analyzed instance.
   * @param {string[]} [modules] - Subset of modules to include. If omitted, uses all.
   * @returns {string} Formatted multi-line string.
   */
  renderImportMatrix(analyzer, modules) {
    const importGraph = analyzer.getImportGraph();
    const fileList = modules
      ? modules.filter((m) => importGraph.has(m))
      : [...importGraph.keys()];

    if (fileList.length === 0) {
      return this._c("No modules to display.", "dim");
    }

    // Build short labels (file basename or last two path segments)
    const labels = fileList.map((f) => this._shortName(f));
    const labelWidth = Math.max(...labels.map((l) => l.length), 8);

    // Compute max column widths
    const colWidth = Math.max(
      ...labels.map((l) => l.length),
      5
    );

    const lines = [];
    lines.push(this._c("Import Matrix", "bold"));
    lines.push(this._c(`Rows = importers, Columns = targets (${fileList.length} x ${fileList.length})`, "dim"));
    lines.push("");

    // Header row
    let header = " ".repeat(labelWidth + 1);
    for (let i = 0; i < fileList.length; i++) {
      header += this._padCol(labels[i], colWidth);
    }
    lines.push(this._c(header, "bold"));

    // Separator
    lines.push(this._c("─".repeat(labelWidth + 1 + fileList.length * colWidth), "dim"));

    // Data rows
    for (let row = 0; row < fileList.length; row++) {
      const importer = fileList[row];
      const deps = importGraph.get(importer) || new Set();
      let rowStr = this._padCol(labels[row], labelWidth) + " ";
      for (let col = 0; col < fileList.length; col++) {
        const target = fileList[col];
        if (row === col) {
          rowStr += this._padCol(this._c("-", "dim"), colWidth);
        } else if (deps.has(target)) {
          rowStr += this._padCol(this._c("X", "yellow"), colWidth);
        } else {
          rowStr += this._padCol(this._c(".", "dim"), colWidth);
        }
      }
      lines.push(rowStr);
    }

    lines.push("");

    // Legend
    lines.push(this._c("Legend:", "dim"));
    lines.push(`  ${this._c("X", "yellow")} = imports  ${this._c("-", "dim")} = self  ${this._c(".", "dim")} = no import`);

    return lines.join("\n");
  }

  /**
   * Renders a text-based dependency graph using Unicode box-drawing characters.
   *
   * @param {ModuleDependencyAnalyzer} analyzer - A fully-analyzed instance.
   * @param {string[]} [modules] - Subset of modules to include. If omitted, uses all.
   * @returns {string} Formatted multi-line string.
   */
  renderModuleGraph(analyzer, modules) {
    const importGraph = analyzer.getImportGraph();
    const fileList = modules
      ? modules.filter((m) => importGraph.has(m))
      : [...importGraph.keys()];

    if (fileList.length === 0) {
      return this._c("No modules to display.", "dim");
    }

    const labels = new Map();
    for (let i = 0; i < fileList.length; i++) {
      labels.set(fileList[i], this._shortName(fileList[i]));
    }

    const lines = [];
    lines.push(this._c("Module Dependency Graph", "bold"));
    lines.push(this._c(`${fileList.length} files, showing import edges`, "dim"));
    lines.push("");

    // List nodes
    lines.push(this._c("Nodes:", "bold"));
    for (let i = 0; i < fileList.length; i++) {
      const nodeId = this._fmtNodeId(i);
      lines.push(`  ${nodeId}  ${labels.get(fileList[i])}  ${this._c(fileList[i], "dim")}`);
    }
    lines.push("");

    // List edges
    lines.push(this._c("Edges:", "bold"));
    let edgeCount = 0;
    for (let from = 0; from < fileList.length; from++) {
      const deps = importGraph.get(fileList[from]) || new Set();
      for (const target of deps) {
        const toIdx = fileList.indexOf(target);
        if (toIdx !== -1 && toIdx !== from) {
          edgeCount++;
          const fromId = this._fmtNodeId(from);
          const toId = this._fmtNodeId(toIdx);
          const fromLabel = labels.get(fileList[from]);
          const toLabel = labels.get(fileList[toIdx]);
          lines.push(
            `  ${fromId} ${this._c(fromLabel, "cyan")} ${this._c("──→", "yellow")} ${toId} ${this._c(toLabel, "cyan")}`
          );
        }
      }
    }

    lines.push("");
    lines.push(this._c(`Total edges: ${edgeCount}`, "dim"));

    return lines.join("\n");
  }

  /**
   * Renders a hotspot report showing the most-depended-on modules.
   *
   * @param {ModuleDependencyAnalyzer} analyzer - A fully-analyzed instance.
   * @param {number} [topN=10] - Number of top modules to show.
   * @returns {string} Formatted multi-line string.
   */
  renderHotspotReport(analyzer, topN = 10) {
    // Compute dependents count for each file
    const fileList = [...analyzer.files];
    const counts = [];

    for (const file of fileList) {
      let fanIn = 0;
      const revDeps = analyzer.getImportGraph();
      // Count how many other files import this one
      for (const [, deps] of revDeps.entries()) {
        if (deps.has(file)) {
          fanIn++;
        }
      }
      counts.push({ file, fanIn });
    }

    // Sort descending by dependents
    counts.sort((a, b) => b.fanIn - a.fanIn);
    const topModules = counts.slice(0, topN);

    const lines = [];
    lines.push(this._c("Dependency Hotspot Report", "bold"));
    lines.push(this._c(`Top ${topN} most-depended-on modules (by fan-in)`, "dim"));
    lines.push("");

    if (topModules.length === 0) {
      lines.push(this._c("  No modules have dependents.", "dim"));
      return lines.join("\n");
    }

    const maxFanIn = topModules[0].fanIn || 1;
    const maxNameLen = Math.max(...topModules.map((m) => m.file.length), 10);

    for (let i = 0; i < topModules.length; i++) {
      const { file, fanIn } = topModules[i];
      const rank = this._c(`#${String(i + 1).padStart(2)}`, "bold");
      const barLen = Math.max(1, Math.round((fanIn / maxFanIn) * 30));
      const bar = this._c("█".repeat(barLen), this._heatColor(fanIn, maxFanIn));
      const paddedName = file.padEnd(maxNameLen + 1);
      const count = this._c(String(fanIn).padStart(3), "bold");

      lines.push(`  ${rank}  ${paddedName} ${count} ${bar}`);
    }

    lines.push("");
    lines.push(this._c("Legend: █ = relative fan-in (darker = more dependents)", "dim"));

    return lines.join("\n");
  }

  /**
   * Renders a full report combining layers, hotspots, and metrics.
   *
   * @param {ModuleDependencyAnalyzer} analyzer - A fully-analyzed instance.
   * @returns {string} Formatted multi-line string.
   */
  renderFullReport(analyzer) {
    const lines = [];

    lines.push(this._c("=".repeat(60), "bold"));
    lines.push(this._c("  MODULE DEPENDENCY ANALYSIS REPORT", "bold"));
    lines.push(this._c("=".repeat(60), "bold"));
    lines.push("");

    // Summary
    const metrics = analyzer.getModuleMetrics();
    const totalFiles = metrics.length;
    const totalDeps = metrics.reduce((sum, m) => sum + m.fanOut, 0);
    const avgComplexity = totalFiles > 0
      ? Math.round(metrics.reduce((sum, m) => sum + m.complexity, 0) / totalFiles)
      : 0;
    const avgFanIn = totalFiles > 0
      ? Math.round(metrics.reduce((sum, m) => sum + m.fanIn, 0) / totalFiles)
      : 0;
    const circular = analyzer.findCircularDeps();
    const unused = analyzer.findUnusedModules();

    lines.push(this._c("Summary", "bold"));
    lines.push(`  Total files analyzed:      ${totalFiles}`);
    lines.push(`  Total dependency edges:    ${totalDeps}`);
    lines.push(`  Average complexity:        ${avgComplexity}`);
    lines.push(`  Average fan-in:            ${avgFanIn}`);
    lines.push(`  Circular dependency cycles: ${circular.length}`);
    lines.push(`  Unused modules:            ${unused.length}`);
    lines.push("");

    // Layered architecture
    const layers = analyzer.getLayeredArchitecture();
    lines.push(this._c("Architecture Layers", "bold"));
    if (layers.length === 0) {
      lines.push("  (no layers detected)");
    } else {
      for (let i = 0; i < layers.length; i++) {
        const layerLabel = i < layers.length ? `Layer ${i}` : "Orphans";
        lines.push(`  ${this._c(layerLabel, "cyan")}: ${layers[i].length} files`);
        for (const f of layers[i]) {
          lines.push(`    ${this._c(f, "dim")}`);
        }
      }
    }
    lines.push("");

    // Hotspots
    lines.push(this.renderHotspotReport(analyzer, 5));
    lines.push("");

    // Circular deps
    lines.push(this._c("Circular Dependencies", "bold"));
    if (circular.length === 0) {
      lines.push(this._c("  None detected ✓", "green"));
    } else {
      for (let i = 0; i < circular.length; i++) {
        const cycle = circular[i];
        lines.push(`  Cycle ${i + 1}:`);
        for (const f of cycle) {
          lines.push(`    ${this._c("↳", "yellow")} ${f}`);
        }
      }
    }
    lines.push("");

    // Unused modules
    lines.push(this._c("Unused Modules (no dependents)", "bold"));
    if (unused.length === 0) {
      lines.push(this._c("  All modules have dependents ✓", "green"));
    } else {
      for (const f of unused) {
        lines.push(`  ${this._c("✗", "yellow")} ${f}`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }

  // ---- Private helpers ----

  /**
   * Recursively builds an ASCII tree of dependencies.
   */
  _buildTree(lines, deps, importGraph, prefix, visited, depth) {
    if (depth >= this._maxDepth) {
      lines.push(`${prefix}${this._c("... (max depth)", "dim")}`);
      return;
    }

    const depArr = [...deps].sort();
    for (let i = 0; i < depArr.length; i++) {
      const dep = depArr[i];
      const isLast = i === depArr.length - 1;
      const connector = isLast ? BOX.elbow : BOX.tee;
      const shortName = this._shortName(dep);

      if (visited.has(dep)) {
        lines.push(`${prefix}${connector}${this._c(shortName, "yellow")} ${this._c("[circular]", "red")}`);
        continue;
      }

      visited.add(dep);
      const subDeps = importGraph.get(dep);

      if (!subDeps || subDeps.size === 0) {
        lines.push(`${prefix}${connector}${this._c(shortName, "cyan")} ${this._c("(leaf)", "dim")}`);
      } else {
        lines.push(`${prefix}${connector}${this._c(shortName, "cyan")}`);
        const childPrefix = prefix + (isLast ? BOX.blank : BOX.pipe);
        this._buildTree(lines, subDeps, importGraph, childPrefix, visited, depth + 1);
      }
    }
  }

  /**
   * Shortens a file path for display (last two segments).
   */
  _shortName(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    if (parts.length <= 2) return normalized;
    // Return last two segments
    return parts.slice(-2).join("/");
  }

  /**
   * Pads a string to a fixed width, handling ANSI codes.
   */
  _padCol(str, width) {
    const plain = this._stripAnsi(str);
    const padLen = Math.max(0, width - plain.length);
    return str + " ".repeat(padLen);
  }

  /**
   * Strips ANSI escape codes from a string for length measurement.
   */
  _stripAnsi(str) {
    return String(str).replace(/\x1b\[[0-9;]*m/g, "");
  }

  /**
   * Applies ANSI color if color is enabled.
   */
  _c(text, style) {
    if (!this._useColor) return String(text);
    const code = ANSI[style];
    if (!code) return String(text);
    return `${code}${text}${ANSI.reset}`;
  }

  /**
   * Returns an ANSI color based on a heat value (0 = cold, high = hot).
   */
  _heatColor(value, max) {
    const ratio = max > 0 ? value / max : 0;
    if (ratio >= 0.8) return "red";
    if (ratio >= 0.5) return "yellow";
    if (ratio >= 0.2) return "green";
    return "dim";
  }

  /**
   * Formats a node index for display.
   */
  _fmtNodeId(index) {
    return this._c(`[${String(index).padStart(2)}]`, "bold");
  }
}

module.exports = { DependencyVisualizer, ANSI, BOX };
