/**
 * MigrationValidator — validates code transformations for correctness.
 *
 * Performs syntax checks, behaviour-preservation heuristics, import/dependency
 * integrity checks, and produces structured validation reports.
 */
"use strict";

const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

class MigrationValidator {
  constructor(options) {
    const opts = options || {};
    /** @type {string} working directory for resolving imports */
    this._cwd = opts.cwd || process.cwd();
    /** @type {boolean} enable verbose diagnostics */
    this._verbose = opts.verbose !== false;
  }

  // ---------------------------------------------------------------------------
  // validate — comprehensive transformation validation
  // ---------------------------------------------------------------------------

  /**
   * Run all validation checks on a transformed code payload.
   *
   * @param {string} transformed - code after transformation
   * @param {string} [original] - code before transformation (optional, for behaviour checks)
   * @param {{ filePath?: string }} [options]
   * @returns {{ valid: boolean, errors: string[], warnings: string[], suggestions: string[] }}
   */
  validate(transformed, original, options) {
    const opts = options || {};
    const errors = [];
    const warnings = [];
    const suggestions = [];

    // 1. Syntax check (always runs)
    const syntaxResult = this.checkSyntax(transformed);
    if (!syntaxResult.valid) {
      errors.push(...syntaxResult.errors.map((e) => `Syntax error: ${e}`));
    }
    if (syntaxResult.warnings) {
      warnings.push(...syntaxResult.warnings.map((w) => `Syntax warning: ${w}`));
    }

    // 2. Import validity (if filePath provided)
    if (opts.filePath) {
      const importResult = this.checkImports(transformed, opts.filePath);
      if (!importResult.valid) {
        errors.push(...importResult.errors);
      }
      warnings.push(...importResult.warnings);
      suggestions.push(...importResult.suggestions);
    } else {
      // Still do a lightweight import check
      const importResult = this.checkImports(transformed);
      if (!importResult.valid) {
        warnings.push(...importResult.warnings);
      }
    }

    // 3. Behaviour preservation check (if original provided)
    if (original !== undefined && original !== null) {
      const behaviourResult = this.checkBehavior(original, transformed);
      warnings.push(...behaviourResult.warnings);
      suggestions.push(...behaviourResult.suggestions);
    }

    // 4. General code quality checks
    const qualityWarnings = this._checkQuality(transformed);
    warnings.push(...qualityWarnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  // ---------------------------------------------------------------------------
  // checkSyntax — wrap code in new Function to detect syntax errors
  // ---------------------------------------------------------------------------

  /**
   * Check whether the given content is syntactically valid JavaScript.
   *
   * @param {string} content
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  checkSyntax(content) {
    const errors = [];
    const warnings = [];

    if (!content || typeof content !== "string") {
      errors.push("Content is empty or not a string");
      return { valid: false, errors, warnings };
    }

    try {
      // new Function gives a detailed SyntaxError including line/column
      new Function(content);
    } catch (err) {
      if (err instanceof SyntaxError) {
        // If the content looks like ESM (import/export), try stripping those lines
        if (/\b(import|export)\s+/.test(content)) {
          try {
            const stripped = content
              .split("\n")
              .map((line) => {
                const t = line.trim();
                if (t.startsWith("import ") || t.startsWith("export ")) {
                  return "// " + t;
                }
                return line;
              })
              .join("\n");
            new Function(stripped);
            // ESM body is valid after stripping import/export
            return { valid: true, errors, warnings };
          } catch (_e2) {
            errors.push(_e2.message);
            return { valid: false, errors, warnings };
          }
        }
        errors.push(err.message);
        return { valid: false, errors, warnings };
      } else {
        // VM compilation as fallback (might work where new Function fails)
        try {
          new vm.Script(content, { filename: "migration-validate.js" });
        } catch (vmErr) {
          errors.push(vmErr.message);
          return { valid: false, errors, warnings };
        }
        // VM succeeded where new Function failed — treat as a warning
        warnings.push(`new Function rejected code, but vm.Script accepted it: ${err.message.slice(0, 80)}`);
        return { valid: true, errors, warnings };
      }
    }

    // Additional heuristic checks
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect unbalanced template literal on a single line (hard to handle in regex)
      const backtickCount = (trimmed.match(/`/g) || []).length;
      if (backtickCount % 2 !== 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
        // Check if there's an interpolation that balances it out
        const dollars = (trimmed.match(/\$\{/g) || []).length;
        // Each ${ counts as an extra backtick context we can ignore
        // This is a rough heuristic
        if (backtickCount === 1 && dollars === 0) {
          warnings.push(`Line ${i + 1}: Possible unbalanced backtick (template literal)`);
        }
      }

      // Detect missing closing brace/bracket/paren (approximate)
      // We skip strings and comments for this check
      const openCount = (trimmed.match(/[\(\{\[]/g) || []).length;
      const closeCount = (trimmed.match(/[\)\}\]]/g) || []).length;
      // Only flag large single-line imbalances
      if (Math.abs(openCount - closeCount) > 2 && !trimmed.startsWith("//")) {
        warnings.push(`Line ${i + 1}: Possible unbalanced parentheses/braces/brackets`);
      }
    }

    return { valid: true, errors, warnings };
  }

  // ---------------------------------------------------------------------------
  // checkBehavior — heuristics for behaviour preservation
  // ---------------------------------------------------------------------------

  /**
   * Run heuristic checks to detect potential behaviour changes between original
   * and transformed code.
   *
   * @param {string} original
   * @param {string} transformed
   * @returns {{ warnings: string[], suggestions: string[] }}
   */
  checkBehavior(original, transformed) {
    const warnings = [];
    const suggestions = [];

    if (!original || !transformed) {
      return { warnings, suggestions };
    }

    // 1. Count function/class declarations — shouldn't change materially
    const origFnCount = (original.match(/\bfunction\s+\w+\s*\(/g) || []).length;
    const xformFnCount = (transformed.match(/\bfunction\s+\w+\s*\(/g) || []).length;
    // Allow some variation since function->arrow reduces "function" keyword count
    const arrowCount = (transformed.match(/=>\s*\{/g) || []).length;

    if (origFnCount > 0 && xformFnCount + arrowCount < origFnCount * 0.5) {
      warnings.push(`Function count dropped significantly (${origFnCount} -> ${xformFnCount} + ${arrowCount} arrows). Check for missing functions.`);
    }

    // 2. Check that exports are preserved
    const origExports = (original.match(/module\.exports\s*=|exports\.\w+\s*=/g) || []).length;
    const newExports = (transformed.match(/module\.exports\s*=|exports\.\w+\s*=/g) || []).length;
    const esmExports = (transformed.match(/\bexport\s+(?:default\s+)?/g) || []).length;

    if (origExports > 0 && newExports + esmExports === 0) {
      warnings.push("All module.exports / export statements may have been removed");
    }

    // 3. Check for removed error handling
    const origTryCatch = (original.match(/\btry\s*\{/g) || []).length;
    const xformTryCatch = (transformed.match(/\btry\s*\{/g) || []).length;
    if (origTryCatch > 0 && xformTryCatch < origTryCatch) {
      warnings.push(`try/catch blocks reduced from ${origTryCatch} to ${xformTryCatch}. Error handling may be lost.`);
    }

    // 4. Check for removed console.log / debugging
    const origDebug = (original.match(/\bconsole\.(log|error|warn|debug)\s*\(/g) || []).length;
    const xformDebug = (transformed.match(/\bconsole\.(log|error|warn|debug)\s*\(/g) || []).length;
    if (origDebug > 0 && xformDebug < origDebug) {
      warnings.push(`Console statements reduced from ${origDebug} to ${xformDebug}. Intentional logging may be removed.`);
    }

    // 5. Detect potential "this" binding issues
    const origThis = (original.match(/\bthis\./g) || []).length;
    const xformThis = (transformed.match(/\bthis\./g) || []).length;
    if (origThis > 0 && xformThis < origThis) {
      suggestions.push(`this. usage dropped from ${origThis} to ${xformThis}. Arrow functions or other changes may alter "this" binding.`);
    }

    // 6. Check line count hasn't changed drastically
    const origLines = original.split("\n").length;
    const xformLines = transformed.split("\n").length;
    const lineRatio = xformLines / Math.max(1, origLines);

    if (lineRatio < 0.3) {
      warnings.push(`Line count dropped from ${origLines} to ${xformLines} (${Math.round(lineRatio * 100)}%). Large portions may be missing.`);
    } else if (lineRatio > 3.0) {
      suggestions.push(`Line count grew from ${origLines} to ${xformLines} (${Math.round(lineRatio * 100)}%). Consider if all additions are intentional.`);
    }

    // 7. Detect potential change in async semantics
    const origAsync = (original.match(/\basync\b/g) || []).length;
    const xformAsync = (transformed.match(/\basync\b/g) || []).length;
    if (origAsync !== xformAsync) {
      suggestions.push(`async keyword count changed (${origAsync} -> ${xformAsync}). Review async/await semantics.`);
    }

    return { warnings, suggestions };
  }

  // ---------------------------------------------------------------------------
  // checkImports — validate import/require statements
  // ---------------------------------------------------------------------------

  /**
   * Check that import / require statements are valid and resolvable.
   *
   * @param {string} content
   * @param {string} [filePath] - path of the file being validated (for relative resolution)
   * @returns {{ valid: boolean, errors: string[], warnings: string[], suggestions: string[] }}
   */
  checkImports(content, filePath) {
    const errors = [];
    const warnings = [];
    const suggestions = [];

    if (!content) {
      return { valid: true, errors, warnings, suggestions };
    }

    // Check ESM imports
    const esmImportRegex = /import\s+(?:(?:[\w$*\s{},]+)\s+from\s+)?['"]([^'"]+)['"]\s*;?/g;
    let match;
    while ((match = esmImportRegex.exec(content)) !== null) {
      const modulePath = match[1];

      // Check for bare specifier without extension or path
      if (!modulePath.startsWith(".") && !modulePath.startsWith("/") && !modulePath.startsWith("@")) {
        // Node built-in or node_modules — can't easily verify without fs
        continue;
      }

      // Relative path: check existence if filePath provided
      if (filePath && (modulePath.startsWith("."))) {
        const resolved = path.resolve(path.dirname(filePath), modulePath);
        // Try common extensions
        const extensions = [".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs"];
        let found = false;
        if (fs.existsSync(resolved)) {
          found = true;
        } else {
          for (const ext of extensions) {
            if (fs.existsSync(resolved + ext)) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          warnings.push(`Import "${modulePath}" could not be resolved from "${filePath}"`);
        }
      }
    }

    // Check CommonJS requires
    const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const modulePath = match[1];

      if (!modulePath.startsWith(".") && !modulePath.startsWith("/") && !modulePath.startsWith("@")) {
        continue;
      }

      if (filePath && modulePath.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filePath), modulePath);
        const extensions = [".js", ".json", ".node", "/index.js"];
        let found = false;
        if (fs.existsSync(resolved)) {
          found = true;
        } else {
          for (const ext of extensions) {
            if (fs.existsSync(resolved + ext)) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          warnings.push(`require("${modulePath}") could not be resolved from "${filePath}"`);
        }
      }
    }

    // Detect mixed import styles (ESM + CJS in same file)
    const hasEsmImport = /import\s+/.test(content);
    const hasRequire = /\brequire\s*\(/.test(content);
    if (hasEsmImport && hasRequire) {
      suggestions.push("File mixes ESM imports and CommonJS require() calls. Consider standardizing on one style.");
    }

    // Detect duplicate imports
    const importSpecifiers = [];
    const dupCheckRegex = /import\s+(?:[\w$*\s{},]+\s+from\s+)?['"]([^'"]+)['"]\s*;?/g;
    while ((match = dupCheckRegex.exec(content)) !== null) {
      const spec = match[1];
      if (importSpecifiers.includes(spec)) {
        warnings.push(`Duplicate import of "${spec}"`);
      }
      importSpecifiers.push(spec);
    }

    return { valid: errors.length === 0, errors, warnings, suggestions };
  }

  // ---------------------------------------------------------------------------
  // checkDependencies — cross-file dependency integrity
  // ---------------------------------------------------------------------------

  /**
   * Check that dependencies between files remain intact after transformation.
   *
   * @param {Array<{file: string, original: string, transformed: string}>} files
   * @returns {{ valid: boolean, errors: string[], warnings: string[], suggestions: string[] }}
   */
  /**
   * Normalize a path for cross-platform comparison:
   * - Convert backslashes to forward slashes
   * - Strip Windows drive letter
   */
  _normalizePath(p) {
    let norm = p.replace(/\\/g, "/");
    // Strip Windows drive letter (e.g., "C:/foo" -> "/foo")
    norm = norm.replace(/^[A-Za-z]:\//, "/");
    return norm;
  }

  checkDependencies(files) {
    const errors = [];
    const warnings = [];
    const suggestions = [];

    if (!files || files.length === 0) {
      return { valid: true, errors, warnings, suggestions };
    }

    // Build a map of files that exist, normalizing path separators and drive letters
    const fileSet = new Set(files.map((f) => this._normalizePath(f.file)));

    // For each file, check that its local requires/imports point to files that exist in the set
    for (const entry of files) {
      const content = entry.transformed || entry.original || "";
      const entryDir = path.dirname(entry.file);

      // Extract all local import/require paths
      const localDeps = [];
      const importRegex = /import\s+(?:[\w$*\s{},]+\s+from\s+)?['"](\.[^'"]+)['"]\s*;?/g;
      const reqRegex = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) {
        localDeps.push(match[1]);
      }
      while ((match = reqRegex.exec(content)) !== null) {
        localDeps.push(match[1]);
      }

      for (const dep of localDeps) {
        const resolved = this._normalizePath(path.resolve(entryDir, dep));

        // Check if the exact file exists in the set (normalized form)
        if (fileSet.has(resolved)) continue;

        // Check with common extensions
        const extensions = [".js", ".mjs", ".cjs", ".json", "/index.js"];
        let found = false;
        for (const ext of extensions) {
          if (fileSet.has(resolved + ext)) {
            found = true;
            break;
          }
        }

        if (!found) {
          warnings.push(`"${entry.file}" imports "${dep}" which was not found in the transformed file set`);
        }
      }

      // Check that exported names match imports in other files
      // (lightweight: just check that module.exports keys exist)
    }

    // Check for circular dependency detection (simple)
    const adjacency = {};
    for (const entry of files) {
      const key = entry.file;
      adjacency[key] = [];
      const deps = [];

      const importRegex = /import\s+(?:[\w$*\s{},]+\s+from\s+)?['"](\.[^'"]+)['"]\s*;?/g;
      const reqRegex = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

      let match;
      while ((match = importRegex.exec(entry.transformed || entry.original)) !== null) {
        deps.push(match[1]);
      }
      while ((match = reqRegex.exec(entry.transformed || entry.original)) !== null) {
        deps.push(match[1]);
      }

      for (const dep of deps) {
        const resolved = this._normalizePath(path.resolve(path.dirname(key), dep));
        const resolvedNoExt = resolved.replace(/\.(?:js|mjs|cjs)$/, "");
        // Find the best matching file in our set
        for (const potential of fileSet) {
          const potentialNoExt = potential.replace(/\.(?:js|mjs|cjs)$/, "");
          if (potential === resolved || potentialNoExt === resolvedNoExt ||
              potential === resolved + ".js" || potential === resolved + ".mjs" || potential === resolved + ".cjs" ||
              potential === resolved + "/index.js") {
            adjacency[key].push(potential);
            break;
          }
        }
      }
    }

    const cycles = this._detectCycles(adjacency);
    for (const cycle of cycles) {
      warnings.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * General code quality warnings.
   */
  _checkQuality(content) {
    const warnings = [];

    // Check for "use strict" presence at top of file
    const lines = content.split("\n");
    const firstNonCommentLine = lines.find((l) => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("#!");
    });

    if (firstNonCommentLine && firstNonCommentLine.trim() !== '"use strict";' && firstNonCommentLine.trim() !== "'use strict';") {
      // CommonJS modules that use require should have "use strict"
      if (/\brequire\s*\(/.test(content)) {
        warnings.push('File uses require() but does not start with "use strict". Consider adding it.');
      }
    }

    // Check for unused imports (heuristic: import X but X never appears)
    const importNameRegex = /import\s+([\w$]+)\s+from\s+['"]/g;
    let match;
    while ((match = importNameRegex.exec(content)) !== null) {
      const importName = match[1];
      // Count occurrences of the name after the import statement
      const afterImport = content.slice(match.index + match[0].length);
      const usageCount = (afterImport.match(new RegExp("\\b" + importName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g")) || []).length;
      if (usageCount === 0) {
        // Double-check it's not used in a type annotation or destructured later
        warnings.push(`Imported "${importName}" does not appear to be used after its import statement`);
      }
    }

    return warnings;
  }

  /**
   * Detect directed cycles in a dependency graph using DFS.
   *
   * @param {Record<string, string[]>} graph - adjacency map
   * @returns {string[][]} list of cycles found
   */
  _detectCycles(graph) {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];

    function dfs(node) {
      if (recursionStack.has(node)) {
        // Found a cycle — extract it from the current path
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph[node] || [];
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }

      path.pop();
      recursionStack.delete(node);
    }

    for (const node of Object.keys(graph)) {
      dfs(node);
    }

    return cycles;
  }
}

module.exports = { MigrationValidator };
