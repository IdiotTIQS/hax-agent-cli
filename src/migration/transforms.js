/**
 * Pre-built code transforms for HaxAgent migration engine.
 *
 * Each export conforms to the transform interface:
 *   { name, description, match?(file, content), apply(content, options) }
 *
 * These transforms operate on source strings using regex/pattern matching —
 * no AST parser dependency, but with careful handling of strings, comments,
 * and template literals to avoid false positives.
 */
"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find regions of source code that are inside string literals or comments.
 * Returns an array of { start, end } byte offsets that should be skipped.
 */
function findProtectedRegions(content) {
  const regions = [];
  let i = 0;

  while (i < content.length) {
    // Single-line comment
    if (content[i] === "/" && content[i + 1] === "/") {
      const start = i;
      while (i < content.length && content[i] !== "\n") i++;
      regions.push({ start, end: i });
      continue;
    }

    // Block comment
    if (content[i] === "/" && content[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
      if (i < content.length) i += 2;
      regions.push({ start, end: i });
      continue;
    }

    // Single/double-quoted string
    if (content[i] === "\"" || content[i] === "'") {
      const quote = content[i];
      const start = i;
      i++;
      while (i < content.length) {
        if (content[i] === "\\") { i += 2; continue; }
        if (content[i] === quote) { i++; break; }
        i++;
      }
      regions.push({ start, end: i });
      continue;
    }

    // Template literal — treat text segments as protected
    if (content[i] === "`") {
      const start = i;
      i++;
      while (i < content.length) {
        if (content[i] === "\\") { i += 2; continue; }
        if (content[i] === "$" && content[i + 1] === "{") {
          i += 2;
          let braceDepth = 1;
          while (i < content.length && braceDepth > 0) {
            if (content[i] === "\\") { i += 2; continue; }
            if (content[i] === "\"" || content[i] === "'") {
              const q = content[i];
              i++;
              while (i < content.length && content[i] !== q) {
                if (content[i] === "\\") i++;
                i++;
              }
              if (i < content.length) i++;
              continue;
            }
            if (content[i] === "{") braceDepth++;
            if (content[i] === "}") braceDepth--;
            if (braceDepth === 0) { i++; break; }
            i++;
          }
          continue;
        }
        if (content[i] === "`") { i++; break; }
        i++;
      }
      regions.push({ start, end: i });
      continue;
    }

    i++;
  }

  return regions;
}

/**
 * Check whether a match range [offset, offset+length) is completely contained
 * within a single protected region (string literal, comment, template text).
 * If the match starts inside a protected region but extends beyond it into
 * unprotected code, it is NOT considered protected — the transform should run.
 */
function isFullyInsideProtected(offset, length, regions) {
  for (const r of regions) {
    if (offset >= r.start && offset + length <= r.end) {
      return true;
    }
  }
  return false;
}

/**
 * Replace content using a regex, but skip matches that are fully inside
 * protected regions (string literals, comments, template literal text parts).
 *
 * Uses position-based checking: the regex runs against the full content, and
 * each match is only transformed if it is not entirely contained within a
 * single protected region.
 */
function replaceOutsideProtected(content, regex, replacer) {
  const regions = findProtectedRegions(content);

  return content.replace(regex, (...matchArgs) => {
    // matchArgs layout: [fullMatch, ...captureGroups, offset, fullString]
    const offset = matchArgs[matchArgs.length - 2];
    const matchLength = matchArgs[0].length;

    // Only skip if the entire match is inside a single protected region
    if (isFullyInsideProtected(offset, matchLength, regions)) {
      return matchArgs[0];
    }

    return replacer(...matchArgs);
  });
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 1. requireToImport — CommonJS to ESM imports
// ---------------------------------------------------------------------------

const requireToImport = {
  name: "requireToImport",
  description: "Convert CommonJS require() calls to ESM import statements",

  match(file, content) {
    return /\.c?js$/i.test(file) && /\brequire\s*\(/.test(content);
  },

  apply(content, _options) {
    const imports = [];
    let result = content;

    // Match: const/let/var <name> = require('<module>')
    const requireRegex = /\b(const|let|var)\s+([\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g;

    result = replaceOutsideProtected(result, requireRegex, (match, keyword, varName, modulePath) => {
      imports.push({ varName, modulePath });
      return ""; // remove the require line
    });

    // Match: const { a, b } = require('<module>') — destructured
    const destructuredRegex = /\b(const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g;

    result = replaceOutsideProtected(result, destructuredRegex, (match, keyword, names, modulePath) => {
      const cleaned = names.replace(/\s+/g, " ").trim();
      imports.push({ varName: `{ ${cleaned} }`, modulePath });
      return "";
    });

    // Build import lines
    if (imports.length > 0) {
      const importLines = imports.map((imp) => {
        return `import ${imp.varName} from '${imp.modulePath}';`;
      }).join("\n");

      // Find the right insertion point: after any "use strict" or shebang, before code
      const lines = result.split("\n");
      let insertIdx = 0;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
          continue;
        }
        if (trimmed === '"use strict";' || trimmed === "'use strict';" || trimmed.startsWith("#!")) {
          insertIdx = i + 1;
          continue;
        }
        break;
      }

      // Skip past blank lines before the first real code
      while (insertIdx < lines.length && lines[insertIdx].trim() === "") {
        insertIdx++;
      }

      lines.splice(insertIdx, 0, ...importLines.split("\n"));
      result = lines.join("\n");
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 2. callbackToAsyncAwait — callback patterns to async/await
// ---------------------------------------------------------------------------

const callbackToAsyncAwait = {
  name: "callbackToAsyncAwait",
  description: "Convert Node.js callback patterns (err, result) => {...} to async/await",

  match(file, _content) {
    // Only match .js files — this is a heuristic filter
    return /\.js$/i.test(file);
  },

  apply(content, _options) {
    // Pattern: functionName(args, (err, result) => { ... })
    // Transform to: try { const result = await functionNameAsync(args); } catch (err) { ... }

    // Look for common async Node APIs: fs.readFile, fs.writeFile, etc.
    const knownAsync = [
      "readFile", "writeFile", "readdir", "mkdir", "stat", "access",
      "exec", "execFile", "spawn",
      "query", "connect",
    ];

    let result = content;

    for (const method of knownAsync) {
      // Match: <method>(<args>, (err, <resultVar>) => { <body> })
      const cbRegex = new RegExp(
        "(" + escapeRegex(method) + "\\s*\\([^)]*)\\s*,\\s*(?:async\\s+)?(?:\\(|)" +
        "(?:err(?:or)?|e)\\s*,\\s*([\\w$]+)" +
        "(?:\\)|)\\s*=>\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}",
        "g"
      );

      const matches = [];
      let match;

      // We need to find these outside protected regions. Use a region-aware approach.
      const regions = findProtectedRegions(result);

      // Simple approach: replace in the full content carefully
      // First detect the pattern
      while ((match = cbRegex.exec(result)) !== null) {
        // Verify this match is not fully inside a protected region
        if (!isFullyInsideProtected(match.index, match[0].length, regions)) {
          matches.push({
            index: match.index,
            full: match[0],
            prefix: match[1],
            resultVar: match[2],
            body: match[3],
          });
        }
      }

      // Apply replacements in reverse order
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const asyncCall = `await ${m.prefix}`;
        const wrapped = `try {\n  const ${m.resultVar} = ${asyncCall};\n  ${m.body}\n} catch (err) {\n  throw err;\n}`;
        result = result.slice(0, m.index) + wrapped + result.slice(m.index + m.full.length);
      }
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 3. varToLetConst — var to let/const
// ---------------------------------------------------------------------------

const varToLetConst = {
  name: "varToLetConst",
  description: "Convert var declarations to let (or const where possible)",

  match(file, _content) {
    return /\.js$/i.test(file);
  },

  apply(content, _options) {
    // Replace var with let for declarations
    const varRegex = /\bvar\s+([\w$]+)\s*=\s*([^;]+);/g;

    const result = replaceOutsideProtected(content, varRegex, (match, varName, value) => {
      const trimmed = value.trim();

      // Detect if the value is a constant expression: string, number, boolean, null, array/object literal
      // If so, use const; otherwise use let
      const isConst = (
        /^['"]/.test(trimmed) ||
        /^-?\d+(\.\d+)?$/.test(trimmed) ||
        /^(true|false|null|undefined)$/.test(trimmed) ||
        /^\[\s*\]$/.test(trimmed) ||
        /^\{\s*\}$/.test(trimmed) ||
        /^\[.*\]$/.test(trimmed) ||
        /^\{.*\}$/.test(trimmed) ||
        /^[A-Z][A-Z_0-9]*$/.test(trimmed)
      );

      const keyword = isConst ? "const" : "let";
      return `${keyword} ${varName} = ${value};`;
    });

    // Also handle var declarations without initializer
    const varNoInitRegex = /\bvar\s+([\w$]+)\s*;/g;

    return replaceOutsideProtected(result, varNoInitRegex, (_match, varName) => {
      return `let ${varName};`;
    });
  },
};

// ---------------------------------------------------------------------------
// 4. stringConcatToTemplate — string concatenation to template literals
// ---------------------------------------------------------------------------

const stringConcatToTemplate = {
  name: "stringConcatToTemplate",
  description: "Convert string concatenation (+) to template literals",

  match(file, _content) {
    return /\.js$/i.test(file);
  },

  apply(content, _options) {
    // Pattern: 'prefix ' + variable + ' suffix'
    // Match at least one string literal and one variable joined by +
    const concatRegex = /(['"])((?:\\.|[^\\])*?)\1\s*\+\s*([\w$.]+(?:\.[\w$]+)*(?:\[[^\]]+\])*)\s*\+\s*(['"])((?:\\.|[^\\])*?)\4/g;

    let result = content;
    const regions = findProtectedRegions(result);

    // Find all concat patterns not in protected regions
    const matches = [];

    const concatRegexGlobal = new RegExp(concatRegex.source, "g");
    let match;
    while ((match = concatRegexGlobal.exec(result)) !== null) {
      if (!isFullyInsideProtected(match.index, match[0].length, regions)) {
        matches.push({
          index: match.index,
          full: match[0],
          prefix: match[2].replace(/\\(.)/g, "$1"), // unescape
          variable: match[3],
          suffix: match[5].replace(/\\(.)/g, "$1"), // unescape
        });
      }
    }

    // Replace in reverse order
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const template = `\`${m.prefix}\${${m.variable}}${m.suffix}\``;
      result = result.slice(0, m.index) + template + result.slice(m.index + m.full.length);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 5. forEachToForOf — forEach to for...of
// ---------------------------------------------------------------------------

const forEachToForOf = {
  name: "forEachToForOf",
  description: "Convert Array.forEach() calls to for...of loops",

  match(file, content) {
    return /\.js$/i.test(file) && /\.forEach\s*\(/.test(content);
  },

  apply(content, _options) {
    // Pattern: <array>.forEach((<item>) => { <body> })
    // Transform to: for (const <item> of <array>) { <body> }

    const forEachRegex = /([\w$.]+(?:\[[^\]]*\])?(?:\.[\w$]+(?:\[[^\]]*\])?)*)\.forEach\s*\(\s*(?:async\s+)?(?:\(?\s*([\w$]+)\s*(?:,\s*[\w$]+)?\)?)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)\s*;?/g;

    const matches = [];
    const regions = findProtectedRegions(content);

    let match;
    while ((match = forEachRegex.exec(content)) !== null) {
      // Second param might be index if present — ignore for transformation
      if (!isFullyInsideProtected(match.index, match[0].length, regions)) {
        matches.push({
          index: match.index,
          full: match[0],
          arrayName: match[1],
          itemVar: match[2],
          body: match[3],
        });
      }
    }

    let result = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const forOf = `for (const ${m.itemVar} of ${m.arrayName}) {\n${m.body}\n}`;
      result = result.slice(0, m.index) + forOf + result.slice(m.index + m.full.length);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 6. promiseChainToAsyncAwait — .then() chains to async/await
// ---------------------------------------------------------------------------

const promiseChainToAsyncAwait = {
  name: "promiseChainToAsyncAwait",
  description: "Convert promise .then() chains to async/await",

  match(file, content) {
    return /\.js$/i.test(file) && /\.then\s*\(/.test(content);
  },

  apply(content, _options) {
    // Pattern: const var = promise.then(r => r.data).then(d => d.id);
    // -> const var = (async () => { const r = await promise; const d = await r.data; return d.id; })();
    //
    // Strategy: find "const varName = expression" statements that contain ".then(",
    // then manually extract the initial promise expression and each .then() step
    // using parenthesis balancing.

    const regions = findProtectedRegions(content);
    const statementRegex = /(?:const|let|var)\s+([\w$]+)\s*=\s*/g;

    // Find candidate positions, excluding protected regions
    const candidates = [];
    let stmt;
    while ((stmt = statementRegex.exec(content)) !== null) {
      if (isFullyInsideProtected(stmt.index, stmt[0].length, regions)) continue;
      // Check that this assignment involves .then() chains
      const rest = content.slice(stmt.index + stmt[0].length);
      if (/\bthen\s*\(/.test(rest.slice(0, 200))) {
        candidates.push({ index: stmt.index, varName: stmt[1], start: stmt.index + stmt[0].length });
      }
    }

    // Manually extract the promise expression and then steps for each candidate
    const parsed = [];
    for (const c of candidates) {
      // Find the initial promise expression: from c.start to the first .then(
      const afterAssign = content.slice(c.start);
      const firstThenIdx = afterAssign.indexOf(".then(");
      if (firstThenIdx === -1) continue;

      const initPromise = afterAssign.slice(0, firstThenIdx).trim();

      // Extract individual .then() steps by balancing parentheses
      const steps = [];
      let pos = firstThenIdx;

      while (pos < afterAssign.length && afterAssign.slice(pos).startsWith(".then(")) {
        // pos points to ".then("
        const openParen = pos + 5; // position of "(" in ".then("
        // Find the matching closing paren
        let parenDepth = 1;
        let j = openParen + 1;
        while (j < afterAssign.length && parenDepth > 0) {
          const ch = afterAssign[j];
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          j++;
        }
        if (parenDepth !== 0) break; // unbalanced — skip

        const stepBody = afterAssign.slice(openParen + 1, j - 1).trim();

        // Extract the parameter name from the arrow function
        const arrowIdx = stepBody.indexOf("=>");
        if (arrowIdx === -1) break;

        const param = stepBody.slice(0, arrowIdx).replace(/[()\s]/g, "").trim();
        const body = stepBody.slice(arrowIdx + 2).trim();

        if (param && body) {
          steps.push({ param, body });
        }

        pos = j; // move past the closing ) of .then()
      }

      if (steps.length === 0) continue;

      // Determine the full extent of the statement for replacement
      // after the last .then() closing paren, there might be a ; and whitespace
      let fullEnd = c.start + pos;
      while (fullEnd < content.length && /[\s;]/.test(content[fullEnd])) {
        fullEnd++;
      }

      parsed.push({
        index: c.index,
        fullEnd,
        varName: c.varName,
        initPromise,
        steps,
      });
    }

    // Apply replacements in reverse order
    let result = content;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const p = parsed[i];

      const lines = ["(async () => {"];
      lines.push(`  const ${p.steps[0].param} = await ${p.initPromise};`);

      for (let si = 1; si < p.steps.length; si++) {
        const prev = p.steps[si - 1];
        const cur = p.steps[si];
        lines.push(`  const ${cur.param} = await ${prev.body};`);
      }

      const last = p.steps[p.steps.length - 1];
      lines.push(`  return ${last.body};`);
      lines.push("})()");

      const asyncIIFE = lines.join("\n");
      result = result.slice(0, p.index) + `const ${p.varName} = ${asyncIIFE};` + result.slice(p.fullEnd);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 7. functionToArrow — function expressions to arrow functions
// ---------------------------------------------------------------------------

const functionToArrow = {
  name: "functionToArrow",
  description: "Convert named function expressions to arrow function expressions",

  match(file, _content) {
    return /\.js$/i.test(file);
  },

  apply(content, _options) {
    // Pattern: const fn = function name(args) { body }
    // Transform to: const fn = (args) => { body }

    const fnExprRegex = /\b(const|let|var)\s+([\w$]+)\s*=\s*function\s*(?:[\w$]+)?\s*\(([^)]*)\)\s*\{/g;

    const matches = [];
    const regions = findProtectedRegions(content);

    let match;
    while ((match = fnExprRegex.exec(content)) !== null) {
      if (!isFullyInsideProtected(match.index, match[0].length, regions)) {
        matches.push({
          index: match.index,
          full: match[0],
          keyword: match[1],
          fnName: match[2],
          params: match[3].trim(),
          openBraceIdx: match.index + match[0].length - 1, // position of '{'
        });
      }
    }

    let result = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];

      // Find the matching closing brace
      const closeBraceIdx = findMatchingBrace(result, m.openBraceIdx);
      if (closeBraceIdx === -1) continue;

      const body = result.slice(m.openBraceIdx + 1, closeBraceIdx);

      // Replace the function keyword with arrow syntax
      const prefix = `${m.keyword} ${m.fnName} = `;
      const arrowFn = `(${m.params}) => {\n${body}\n}`;

      result = result.slice(0, m.index) + prefix + arrowFn + result.slice(closeBraceIdx + 1);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// 8. objectAssignToSpread — Object.assign to object spread
// ---------------------------------------------------------------------------

const objectAssignToSpread = {
  name: "objectAssignToSpread",
  description: "Convert Object.assign({}, ...) to object spread syntax",

  match(file, content) {
    return /\.js$/i.test(file) && /\bObject\.assign\s*\(/.test(content);
  },

  apply(content, _options) {
    // Pattern: Object.assign(target, source1, source2, ...)
    // If target is empty object literal {}:
    //   Object.assign({}, a, b) -> { ...a, ...b }
    // If target is an existing object:
    //   Object.assign(obj, a, b) -> Object.assign(obj, a, b) (keep — mutation semantics differ)

    const assignRegex = /Object\.assign\s*\(\s*(\{\s*\}\s*,\s*)([\s\S]*?)\)\s*;?/g;

    const matches = [];
    const regions = findProtectedRegions(content);

    let match;
    while ((match = assignRegex.exec(content)) !== null) {
      if (!isFullyInsideProtected(match.index, match[0].length, regions)) {
        const sources = match[2].split(",").map((s) => s.trim()).filter(Boolean);
        matches.push({
          index: match.index,
          full: match[0],
          sources,
        });
      }
    }

    let result = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const spread = m.sources.map((s) => `...${s}`).join(", ");
      const replacement = `{ ${spread} }`;
      result = result.slice(0, m.index) + replacement + result.slice(m.index + m.full.length);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// Shared utility: find matching closing brace
// ---------------------------------------------------------------------------

function findMatchingBrace(content, openIdx) {
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let inTmpl = false;

  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];

    if (ch === "\\" && (inStr || inTmpl)) { i++; continue; }
    if ((ch === "\"" || ch === "'") && !inTmpl) {
      if (!inStr) { inStr = true; strChar = ch; }
      else if (ch === strChar) { inStr = false; }
      continue;
    }
    if (ch === "`" && !inStr) { inTmpl = !inTmpl; continue; }
    if (inStr || inTmpl) continue;

    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return i; }
  }

  return -1;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  requireToImport,
  callbackToAsyncAwait,
  varToLetConst,
  stringConcatToTemplate,
  forEachToForOf,
  promiseChainToAsyncAwait,
  functionToArrow,
  objectAssignToSpread,
  // Utility helpers for external use
  findProtectedRegions,
  replaceOutsideProtected,
  isFullyInsideProtected,
};
