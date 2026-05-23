"use strict";

/**
 * Auto-fix engine — registers and applies automatic fixes for common
 * code quality issues discovered during quality gate checks.
 */

/**
 * Remove trailing whitespace from each line of content.
 * @param {string} content
 * @returns {string}
 */
function fixTrailingWhitespace(content) {
  if (typeof content !== "string") return content;
  return content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

/**
 * Ensure the content ends with exactly one newline character.
 * @param {string} content
 * @returns {string}
 */
function fixMissingNewline(content) {
  if (typeof content !== "string") return content;
  // Strip trailing newlines, then add one
  return content.replace(/\n+$/, "") + "\n";
}

/**
 * Fix common spelling mistakes in content.
 * @param {string} content
 * @returns {string}
 */
function fixCommonTypos(content) {
  if (typeof content !== "string") return content;

  const TYPO_MAP = {
    recieve: "receive",
    seperate: "separate",
    occured: "occurred",
    occurence: "occurrence",
    accomodate: "accommodate",
    acheive: "achieve",
    arguement: "argument",
    begining: "beginning",
    calender: "calendar",
    commited: "committed",
    concensus: "consensus",
    definately: "definitely",
    enviroment: "environment",
    existance: "existence",
    forseeable: "foreseeable",
    goverment: "government",
    guarentee: "guarantee",
    hierachy: "hierarchy",
    independant: "independent",
    indispensible: "indispensable",
    irresponsible: "irresponsible",
    liason: "liaison",
    lisence: "license",
    maintainance: "maintenance",
    neccessary: "necessary",
    noticable: "noticeable",
    ocassion: "occasion",
    occured: "occurred",
    permenant: "permanent",
    persistant: "persistent",
    priviledge: "privilege",
    reccomend: "recommend",
    refered: "referred",
    relevent: "relevant",
    responsability: "responsibility",
    rhythym: "rhythm",
    sucessful: "successful",
    supercede: "supersede",
    suprise: "surprise",
    tendancy: "tendency",
    threshhold: "threshold",
    tounge: "tongue",
    truely: "truly",
    unforseen: "unforeseen",
    untill: "until",
    useable: "usable",
    vaccum: "vacuum",
    visable: "visible",
  };

  let result = content;
  for (const [typo, correction] of Object.entries(TYPO_MAP)) {
    // Case-insensitive replacement preserving first-letter case
    const regex = new RegExp("\\b" + typo + "\\b", "gi");
    result = result.replace(regex, (match) => {
      if (match[0] === match[0].toUpperCase()) {
        return correction[0].toUpperCase() + correction.slice(1);
      }
      return correction;
    });
  }
  return result;
}

/**
 * Sort import lines alphabetically, grouping by type:
 *   - Node built-in modules
 *   - External packages
 *   - Local/project imports
 * @param {string} content
 * @returns {string}
 */
function fixImportOrder(content) {
  if (typeof content !== "string") return content;

  const lines = content.split("\n");
  const importLines = [];
  const importLineNumbers = [];
  const otherLines = [];

  const importRegex = /^(\s*(?:import|const|let|var)\s+.*?(?:require\(|from\s+['"]))/;

  for (let i = 0; i < lines.length; i++) {
    if (importRegex.test(lines[i])) {
      importLines.push(lines[i]);
      importLineNumbers.push(i);
    } else {
      otherLines.push(lines[i]);
    }
  }

  if (importLines.length <= 1) return content;

  // Categorize imports
  const nodeBuiltins = [];
  const externalPkgs = [];
  const localImports = [];

  for (const line of importLines) {
    // Extract the module path
    const requireMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
    const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    const modulePath = requireMatch ? requireMatch[1] : importMatch ? importMatch[1] : "";

    if (modulePath.startsWith(".") || modulePath.startsWith("/")) {
      localImports.push(line);
    } else if (modulePath.startsWith("node:")) {
      nodeBuiltins.push(line);
    } else if (isNodeBuiltin(modulePath)) {
      nodeBuiltins.push(line);
    } else {
      externalPkgs.push(line);
    }
  }

  // Sort each group
  nodeBuiltins.sort();
  externalPkgs.sort();
  localImports.sort();

  const sortedImports = [...nodeBuiltins, ...externalPkgs, ...localImports];

  // Reconstruct: need to place sorted imports at the positions of original imports.
  // Strategy: replace all consecutive import blocks with sorted imports.
  const result = [];
  let importIndex = 0;
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (importRegex.test(lines[i])) {
      if (!inImportBlock) {
        // Output all sorted imports at the start of the block
        for (const sorted of sortedImports) {
          result.push(sorted);
        }
        inImportBlock = true;
      }
      // Skip original import lines
    } else {
      result.push(lines[i]);
    }
  }

  return result.join("\n");
}

/**
 * Check if a module path is a Node.js built-in.
 * @param {string} name
 * @returns {boolean}
 */
function isNodeBuiltin(name) {
  const builtins = [
    "assert", "buffer", "child_process", "cluster", "crypto", "dgram",
    "dns", "events", "fs", "http", "https", "net", "os", "path",
    "perf_hooks", "process", "punycode", "querystring", "readline",
    "repl", "stream", "string_decoder", "timers", "tls", "tty",
    "url", "util", "v8", "vm", "worker_threads", "zlib",
  ];
  return builtins.includes(name);
}

const PREBUILT_FIXERS = {
  trailingWhitespace: fixTrailingWhitespace,
  missingNewline: fixMissingNewline,
  commonTypos: fixCommonTypos,
  importOrder: fixImportOrder,
};

/**
 * AutoFixEngine — suggests and applies automatic fixes.
 */
class AutoFixEngine {
  constructor() {
    this._fixers = new Map();

    // Register pre-built fixers
    for (const [name, fn] of Object.entries(PREBUILT_FIXERS)) {
      this._fixers.set(name, { fn, pattern: name });
    }
  }

  /**
   * Register a fix for a common issue.
   * @param {string|RegExp} pattern — pattern to match in check results to trigger fix
   * @param {function} fixFn — (context) => modified context or content
   */
  registerFix(pattern, fixFn) {
    if (typeof fixFn !== "function") {
      throw new Error("fixFn must be a function");
    }
    const name = typeof pattern === "string" ? pattern : pattern.toString();
    this._fixers.set(name, { fn: fixFn, pattern });
    return this;
  }

  /**
   * Get registered fixer names.
   * @returns {string[]}
   */
  listFixes() {
    return [...this._fixers.keys()];
  }

  /**
   * Suggest fixes for a set of failed check results.
   * @param {object[]} checkResults — array of quality check result objects
   * @returns {Array<{ checkName: string, suggestedFixes: string[] }>}
   */
  suggestFixes(checkResults) {
    const suggestions = [];

    for (const result of checkResults) {
      if (result.status === "pass") continue;

      const suggested = [];

      switch (result.name) {
        case "lint":
          if (result.details && result.details.errors > 0) {
            suggested.push("trailingWhitespace — removes trailing whitespace");
            suggested.push("missingNewline — ensures files end with a newline");
          }
          break;
        case "typeCheck":
          suggested.push("importOrder — sort imports (may fix module resolution)");
          suggested.push("commonTypos — fix common spelling errors");
          break;
        case "security":
        case "dependencies":
          suggested.push("Run `npm audit fix` to automatically resolve dependency vulnerabilities");
          break;
        case "coverage":
          suggested.push("Add missing test files to improve coverage");
          break;
        default:
          // Generic suggestions for custom checks
          for (const [name] of this._fixers) {
            suggested.push(`${name} — automatic fix`);
          }
          break;
      }

      if (suggested.length > 0) {
        suggestions.push({ checkName: result.name, suggestedFixes: suggested });
      }
    }

    return suggestions;
  }

  /**
   * Apply auto-fixes to check result context or content.
   * @param {object[]} checkResults — array of quality check result objects
   * @param {{ content?: string, autoApprove?: boolean, selectedFixes?: string[] }} [options]
   * @returns {{ fixed: boolean, content?: string, appliedFixes: string[], skippedFixes: string[] }}
   */
  applyFixes(checkResults, options = {}) {
    const appliedFixes = [];
    const skippedFixes = [];
    let content = options.content || "";

    const fixToApply = options.selectedFixes || [...this._fixers.keys()];
    const autoApprove = options.autoApprove !== undefined ? options.autoApprove : false;

    // Determine which fixers are relevant based on failed checks
    const relevantFixerNames = new Set();

    for (const result of checkResults) {
      if (result.status === "pass") continue;

      switch (result.name) {
        case "lint":
          relevantFixerNames.add("trailingWhitespace");
          relevantFixerNames.add("missingNewline");
          relevantFixerNames.add("commonTypos");
          relevantFixerNames.add("importOrder");
          break;
        case "typeCheck":
          relevantFixerNames.add("importOrder");
          relevantFixerNames.add("commonTypos");
          break;
        case "security":
        case "dependencies":
          // These can't be auto-fixed on file content; skip
          break;
        default:
          // For custom checks, consider all fixers
          for (const name of this._fixers.keys()) {
            relevantFixerNames.add(name);
          }
          break;
      }
    }

    if (autoApprove) {
      // Apply all relevant fixers
      for (const name of relevantFixerNames) {
        if (!fixToApply.includes(name)) {
          skippedFixes.push(name);
          continue;
        }
        const entry = this._fixers.get(name);
        if (entry && entry.fn) {
          try {
            content = entry.fn(content);
            appliedFixes.push(name);
          } catch (error) {
            skippedFixes.push(`${name} (error: ${error.message})`);
          }
        }
      }
    } else {
      // Only apply explicitly selected fixes
      for (const name of fixToApply) {
        if (!relevantFixerNames.has(name)) {
          skippedFixes.push(`${name} (not relevant to failed checks)`);
          continue;
        }
        const entry = this._fixers.get(name);
        if (entry && entry.fn) {
          try {
            content = entry.fn(content);
            appliedFixes.push(name);
          } catch (error) {
            skippedFixes.push(`${name} (error: ${error.message})`);
          }
        }
      }
    }

    return {
      fixed: appliedFixes.length > 0,
      content: appliedFixes.length > 0 ? content : undefined,
      appliedFixes,
      skippedFixes,
    };
  }
}

module.exports = {
  AutoFixEngine,
  PREBUILT_FIXERS,
  fixTrailingWhitespace,
  fixMissingNewline,
  fixCommonTypos,
  fixImportOrder,
};
