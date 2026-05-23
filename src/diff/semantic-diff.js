/**
 * Semantic diff tools for HaxAgent.
 *
 * Understands code structure — functions, imports, exports, classes —
 * and produces diffs that are meaningful to agents editing source files.
 */
"use strict";

// ---------------------------------------------------------------------------
// 1. AST-light parsers (regex-based, zero-dependency)
// ---------------------------------------------------------------------------

const RE_NAMED_FUNCTION = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
const RE_ARROW_FUNCTION = /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\s*\(([^)]*)\)/g;
const RE_CLASS = /(?:export\s+(?:default\s+)?)?class\s+(\w+)/g;

// Simpler line-based import/export matchers
const RE_IMPORT_LINE = /^\s*import\b/mg;
const RE_IMPORT_SOURCE = /from\s+['"]([^'"]+)['"]/;
const RE_IMPORT_SIDEEFFECT = /import\s+['"]([^'"]+)['"]/;
const RE_REQUIRE = /(?:const|let|var)\s+(?:\{[\s\S]*?\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_EXPORT_NAMED = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
const RE_EXPORT_DEFAULT = /export\s+default\s+(?:function|class|async\s+function)?\s*(\w*)/g;
const RE_EXPORT_LIST = /export\s+\{([\s\S]*?)\}/g;
const RE_MODULE_EXPORTS = /module\.exports\s*=\s*(\w+)/g;
const RE_EXPORTS_ALIAS = /exports\.(\w+)\s*=/g;

// ---------------------------------------------------------------------------
// 2. Helper: normalize content
// ---------------------------------------------------------------------------

function normalizeContent(content) {
  return content.replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// 3. diffFunctions — function-level diff
// ---------------------------------------------------------------------------

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ type: 'added'|'removed'|'modified'|'unchanged', elements: Array }}
 */
function diffFunctions(oldContent, newContent) {
  const oldFn = parseFunctions(oldContent);
  const newFn = parseFunctions(newContent);

  const added = [];
  const removed = [];
  const unchanged = [];
  const modified = [];

  const oldMap = new Map(oldFn.map((f) => [f.name, f]));
  const newMap = new Map(newFn.map((f) => [f.name, f]));

  for (const fn of newFn) {
    const old = oldMap.get(fn.name);
    if (!old) {
      added.push(fn);
    } else if (old.signature !== fn.signature) {
      modified.push({
        name: fn.name,
        kind: "function",
        oldSignature: old.signature,
        newSignature: fn.signature,
        changes: ["signature-changed"],
      });
    } else {
      unchanged.push(fn);
    }
  }

  for (const fn of oldFn) {
    if (!newMap.has(fn.name)) {
      removed.push(fn);
    }
  }

  const elements = [
    ...added.map((e) => ({ ...e, change: "added" })),
    ...removed.map((e) => ({ ...e, change: "removed" })),
    ...unchanged.map((e) => ({ ...e, change: "unchanged" })),
    ...modified.map((e) => ({ ...e, change: "modified" })),
  ];

  return computeOverallType(elements, added, removed, modified);
}

function parseFunctions(content) {
  const fns = [];
  const seen = new Set();
  const norm = normalizeContent(content);

  // Named functions with params
  RE_NAMED_FUNCTION.lastIndex = 0;
  let m;
  while ((m = RE_NAMED_FUNCTION.exec(norm)) !== null) {
    const name = m[1];
    const params = m[2] ? m[2].trim() : "";
    if (!seen.has(name)) {
      seen.add(name);
      fns.push({
        name,
        kind: "function",
        type: "named",
        params,
        signature: `function ${name}(${params})`,
        raw: m[0].trim(),
      });
    }
  }

  // Arrow function assignments with params
  RE_ARROW_FUNCTION.lastIndex = 0;
  while ((m = RE_ARROW_FUNCTION.exec(norm)) !== null) {
    const name = m[1];
    const params = m[2] ? m[2].trim() : "";
    if (!seen.has(name)) {
      seen.add(name);
      fns.push({
        name,
        kind: "function",
        type: "arrow",
        params,
        signature: `${name}(${params})`,
        raw: m[0].trim(),
      });
    }
  }

  return fns;
}

// ---------------------------------------------------------------------------
// 4. diffImports — import-level diff
// ---------------------------------------------------------------------------

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ type: 'added'|'removed'|'modified'|'unchanged', elements: Array }}
 */
function diffImports(oldContent, newContent) {
  const oldImports = parseImports(oldContent);
  const newImports = parseImports(newContent);

  const added = [];
  const removed = [];
  const unchanged = [];
  const modified = [];

  const oldMap = new Map(oldImports.map((i) => [i.name, i]));
  const newMap = new Map(newImports.map((i) => [i.name, i]));

  for (const imp of newImports) {
    const old = oldMap.get(imp.name);
    if (!old) {
      added.push(imp);
    } else if (old.source !== imp.source || old.style !== imp.style) {
      modified.push({
        name: imp.name,
        kind: "import",
        oldSignature: old.raw,
        newSignature: imp.raw,
        changes: ["source-or-style-changed"],
      });
    } else {
      unchanged.push(imp);
    }
  }

  for (const imp of oldImports) {
    if (!newMap.has(imp.name)) {
      removed.push(imp);
    }
  }

  const elements = [
    ...added.map((e) => ({ ...e, change: "added" })),
    ...removed.map((e) => ({ ...e, change: "removed" })),
    ...unchanged.map((e) => ({ ...e, change: "unchanged" })),
    ...modified.map((e) => ({ ...e, change: "modified" })),
  ];

  return computeOverallType(elements, added, removed, modified);
}

function parseImports(content) {
  const imports = [];
  const seen = new Set();
  const norm = normalizeContent(content);

  // Process line by line for ESM imports
  const lines = norm.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

    if (/^(?:import\s)/.test(trimmed) || /^import\b/.test(trimmed)) {
      // Extract source from the line
      let source = "(side-effect)";
      let style = "esm";
      let sourceMatch = trimmed.match(RE_IMPORT_SOURCE);
      if (!sourceMatch) {
        sourceMatch = trimmed.match(RE_IMPORT_SIDEEFFECT);
      }
      if (sourceMatch) {
        source = sourceMatch[1];
      }

      if (trimmed.includes("import type")) style = "esm-type";
      else if (trimmed.includes("import typeof")) style = "esm-typeof";

      // Build a unique name key
      let specPart = trimmed
        .replace(/^import\s+(?:type\s+|typeof\s+)?/, "")
        .replace(/\s+from\s+["'][^"']+["']/, "")
        .replace(/;?\s*$/, "");
      const name = `${source}:${specPart}`;
      if (!seen.has(name)) {
        seen.add(name);
        imports.push({ name, kind: "import", style, source, raw: trimmed, spec: specPart });
      }
    }
  }

  // CJS requires (using regex across content)
  RE_REQUIRE.lastIndex = 0;
  let m;
  while ((m = RE_REQUIRE.exec(norm)) !== null) {
    const source = m[1];
    const name = `require:${source}`;
    if (!seen.has(name)) {
      seen.add(name);
      imports.push({ name, kind: "import", style: "cjs", source, raw: m[0].trim(), spec: source });
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// 5. diffExports — export-level diff
// ---------------------------------------------------------------------------

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ type: 'added'|'removed'|'modified'|'unchanged', elements: Array }}
 */
function diffExports(oldContent, newContent) {
  const oldExports = parseExports(oldContent);
  const newExports = parseExports(newContent);

  const added = [];
  const removed = [];
  const unchanged = [];
  const modified = [];

  const oldMap = new Map(oldExports.map((e) => [e.name, e]));
  const newMap = new Map(newExports.map((e) => [e.name, e]));

  for (const exp of newExports) {
    const old = oldMap.get(exp.name);
    if (!old) {
      added.push(exp);
    } else if (old.signature !== exp.signature) {
      modified.push({
        name: exp.name,
        kind: "export",
        oldSignature: old.signature,
        newSignature: exp.signature,
        changes: ["signature-changed"],
      });
    } else {
      unchanged.push(exp);
    }
  }

  for (const exp of oldExports) {
    if (!newMap.has(exp.name)) {
      removed.push(exp);
    }
  }

  const elements = [
    ...added.map((e) => ({ ...e, change: "added" })),
    ...removed.map((e) => ({ ...e, change: "removed" })),
    ...unchanged.map((e) => ({ ...e, change: "unchanged" })),
    ...modified.map((e) => ({ ...e, change: "modified" })),
  ];

  return computeOverallType(elements, added, removed, modified);
}

function parseExports(content) {
  const exports = [];
  const seen = new Set();
  const norm = normalizeContent(content);

  // Named exports
  RE_EXPORT_NAMED.lastIndex = 0;
  let m;
  while ((m = RE_EXPORT_NAMED.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      exports.push({
        name,
        kind: "export",
        style: "named",
        signature: m[0].trim(),
        raw: m[0].trim(),
      });
    }
  }

  // Default exports
  RE_EXPORT_DEFAULT.lastIndex = 0;
  while ((m = RE_EXPORT_DEFAULT.exec(norm)) !== null) {
    const name = m[1] || "(default)";
    if (!seen.has(name)) {
      seen.add(name);
      exports.push({
        name,
        kind: "export",
        style: "default",
        signature: m[0].trim(),
        raw: m[0].trim(),
      });
    }
  }

  // Export lists
  RE_EXPORT_LIST.lastIndex = 0;
  while ((m = RE_EXPORT_LIST.exec(norm)) !== null) {
    const list = m[1];
    const names = list.split(",").map((s) => s.trim().replace(/^(\w+).*/, "$1")).filter(Boolean);
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        exports.push({
          name,
          kind: "export",
          style: "named-list",
          signature: `export { ${name} }`,
          raw: m[0].trim(),
        });
      }
    }
  }

  // module.exports = X
  RE_MODULE_EXPORTS.lastIndex = 0;
  while ((m = RE_MODULE_EXPORTS.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      exports.push({
        name,
        kind: "export",
        style: "cjs-default",
        signature: m[0].trim(),
        raw: m[0].trim(),
      });
    }
  }

  // exports.name = X
  RE_EXPORTS_ALIAS.lastIndex = 0;
  while ((m = RE_EXPORTS_ALIAS.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      exports.push({
        name,
        kind: "export",
        style: "cjs-named",
        signature: m[0].trim(),
        raw: m[0].trim(),
      });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// 6. diffStructure — high-level structural changes
// ---------------------------------------------------------------------------

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ type: 'added'|'removed'|'modified'|'unchanged', elements: Array }}
 */
function diffStructure(oldContent, newContent) {
  const oldStructure = parseStructure(oldContent);
  const newStructure = parseStructure(newContent);

  const additions = [];
  const deletions = [];
  const mutations = [];
  const same = [];

  const oldNames = new Map(oldStructure.map((e) => [e.name, e]));
  const newNames = new Map(newStructure.map((e) => [e.name, e]));

  for (const elem of newStructure) {
    const old = oldNames.get(elem.name);
    if (!old) {
      additions.push(elem);
    } else if (old.type !== elem.type) {
      mutations.push({
        name: elem.name,
        kind: "structure",
        oldSignature: `${old.type} ${old.name}`,
        newSignature: `${elem.type} ${elem.name}`,
        changes: ["type-changed"],
      });
    } else {
      same.push(elem);
    }
  }

  for (const elem of oldStructure) {
    if (!newNames.has(elem.name)) {
      deletions.push(elem);
    }
  }

  const elements = [
    ...additions.map((e) => ({ ...e, change: "added" })),
    ...deletions.map((e) => ({ ...e, change: "removed" })),
    ...same.map((e) => ({ ...e, change: "unchanged" })),
    ...mutations.map((e) => ({ ...e, change: "modified" })),
  ];

  return computeOverallType(elements, additions, deletions, mutations);
}

function parseStructure(content) {
  const elements = [];
  const seen = new Set();
  const norm = normalizeContent(content);

  // Classes
  RE_CLASS.lastIndex = 0;
  let m;
  while ((m = RE_CLASS.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      elements.push({ name, type: "class", kind: "structure" });
    }
  }

  // Named functions
  RE_NAMED_FUNCTION.lastIndex = 0;
  while ((m = RE_NAMED_FUNCTION.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      elements.push({ name, type: "function", kind: "structure" });
    }
  }

  // Arrow function assignments
  RE_ARROW_FUNCTION.lastIndex = 0;
  while ((m = RE_ARROW_FUNCTION.exec(norm)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      elements.push({ name, type: "arrow-function", kind: "structure" });
    }
  }

  return elements;
}

// ---------------------------------------------------------------------------
// 7. diffFiles — orchestrates all semantic diffs
// ---------------------------------------------------------------------------

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @param {object} [options]
 * @param {('all'|'functions'|'imports'|'exports'|'structure')[]} [options.scopes]
 * @returns {object}
 */
function diffFiles(oldContent, newContent, options) {
  const scopes = (options && options.scopes) || ["all"];
  const useAll = scopes.includes("all");

  return {
    functions: useAll || scopes.includes("functions") ? diffFunctions(oldContent, newContent) : null,
    imports: useAll || scopes.includes("imports") ? diffImports(oldContent, newContent) : null,
    exports: useAll || scopes.includes("exports") ? diffExports(oldContent, newContent) : null,
    structure: useAll || scopes.includes("structure") ? diffStructure(oldContent, newContent) : null,
  };
}

// ---------------------------------------------------------------------------
// 8. Utility
// ---------------------------------------------------------------------------

function computeOverallType(elements, added, removed, modified) {
  let type = "unchanged";
  if (added.length > 0 || removed.length > 0 || modified.length > 0) {
    if (added.length > 0 && removed.length === 0 && modified.length === 0) {
      type = "added";
    } else if (removed.length > 0 && added.length === 0 && modified.length === 0) {
      type = "removed";
    } else {
      type = "modified";
    }
  }
  return { type, elements };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  diffFiles,
  diffFunctions,
  diffImports,
  diffExports,
  diffStructure,
  // Internals exposed for testing
  parseImports,
  parseExports,
  parseStructure,
};
