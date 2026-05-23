/**
 * function-extractor — regex-based JS/TS function, class, export, and JSDoc extraction.
 *
 * Extracts structural information from source code without an AST parser.
 * All functions return structured objects with name, type, params, body,
 * and source location (startLine, endLine).
 */
"use strict";

// JS reserved words to exclude from dependency analysis.
const JS_KEYWORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package",
  "private", "protected", "public", "static", "yield", "async", "await",
  "of", "from", "as", "get", "set", "true", "false", "null", "undefined",
  "NaN", "Infinity", "arguments",
]);

const BUILTIN_GLOBALS = new Set([
  "Object", "Array", "String", "Number", "Boolean", "Function", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError",
  "console", "Math", "JSON", "Date", "RegExp", "parseInt", "parseFloat",
  "isNaN", "isFinite", "eval", "Buffer", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "setImmediate", "clearImmediate",
  "Intl", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics",
  "globalThis", "global", "process", "require", "module", "exports",
  "__dirname", "__filename", "document", "window", "Int8Array", "Uint8Array",
  "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array",
]);

/**
 * Extract all function declarations and expressions from source code.
 * @param {string} content - JS/TS source code
 * @returns {Array<{name: string, type: string, params: string[], body: string, startLine: number, endLine: number, async: boolean, generator: boolean}>}
 */
function extractFunctions(content) {
  const results = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match patterns: function name(, async function name(, function* name(
    let match;
    let async = false;
    let generator = false;
    let name = null;
    let arrowFunc = false;

    // Named function declaration: function name(...) or async function name(
    // Handles: function, function*, async function, async function*
    if ((match = line.match(/(?:async\s+)?function\s*(\*)?\s*([\w$]+)\s*\(/))) {
      async = /^\s*async\s+/.test(line);
      generator = match[1] === "*";
      name = match[2];
    }
    // Arrow function assigned to variable: const name = (...) => or const name = async (...) =>
    else if ((match = line.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(/))) {
      name = match[1];
      arrowFunc = true;
      async = /\basync\b/.test(line.match(/(?:const|let|var)\s+[\w$]+\s*=\s*(.*)/)?.[1] || "");
    }
    // Arrow function without parens: const name = x =>
    else if ((match = line.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?([\w$]+)\s*=>/))) {
      name = match[1];
      arrowFunc = true;
      async = /\basync\b/.test(line.match(/(?:const|let|var)\s+[\w$]+\s*=\s*(.*)/)?.[1] || "");
    }
    // Function expression assigned to variable: const name = function(
    else if ((match = line.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?function\s*\(/))) {
      name = match[1];
      async = /\basync\b/.test(line);
    }
    // Method shorthand in object: methodName(
    else if ((match = line.match(/^\s*(?:async\s+)?(\*?)\s*([\w$]+)\s*\(/)) && !/^(?:if|for|while|switch|catch|with)\b/.test(line.trim())) {
      // Be careful not to match control flow keywords.
      async = /^\s*async\s+/.test(line);
      generator = match[1] === "*";
      name = match[2];
    }

    if (!name) continue;

    // Extract parameters and body.
    const fnInfo = _extractFunctionBlock(lines, i, name);
    if (!fnInfo) continue;

    results.push({
      name,
      type: arrowFunc ? "arrow" : "declaration",
      params: fnInfo.params,
      body: fnInfo.body,
      startLine: i + 1,
      endLine: fnInfo.endLine,
      async,
      generator,
    });

    i = fnInfo.endLine - 1; // Skip ahead (will be incremented by loop).
  }

  return results;
}

/**
 * Extract all class declarations from source code.
 * @param {string} content - JS/TS source code
 * @returns {Array<{name: string, type: string, superClass: string|null, body: string, startLine: number, endLine: number, methods: Array}>}
 */
function extractClasses(content) {
  const results = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // class Name { or class Name extends Base {
    let match;
    if ((match = line.match(/^\s*class\s+([\w$]+)(?:\s+extends\s+([\w$.]+))?\s*\{/))) {
      // continue — found class start
    } else if ((match = line.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*class(?:\s+extends\s+([\w$.]+))?\s*\{/))) {
      // class expression
    } else {
      continue;
    }

    const name = match[1];
    const superClass = match[2] || null;

    // Extract the class body.
    const bodyInfo = _extractBraceBlock(lines, i);
    if (!bodyInfo) continue;

    // Extract methods from the body.
    const methods = _extractClassMethods(bodyInfo.body);

    results.push({
      name,
      type: "class",
      superClass,
      body: bodyInfo.body,
      startLine: i + 1,
      endLine: bodyInfo.endLine,
      methods,
    });

    i = bodyInfo.endLine - 1;
  }

  return results;
}

/**
 * Extract all exports from source code.
 * @param {string} content - JS/TS source code
 * @returns {Array<{name: string, type: string, source: string|null, startLine: number}>}
 */
function extractExports(content) {
  const results = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // export default expression
    if (/^\s*export\s+default\s+/.test(line)) {
      const rest = line.replace(/^\s*export\s+default\s+/, "").trim();
      // Get name if it's a function or class declaration.
      let name = "default";
      const fnMatch = rest.match(/^(?:async\s+)?function\s+([\w$]*)\s*\(/);
      const clsMatch = rest.match(/^class\s+([\w$]*)\s*\{/);
      if (fnMatch) name = fnMatch[1] || "default";
      if (clsMatch) name = clsMatch[1] || "default";
      if (!fnMatch && !clsMatch) {
        // Expression — extract variable name or literal.
        const varMatch = rest.match(/^([\w$]+)/);
        if (varMatch) name = varMatch[1];
      }

      results.push({
        name,
        type: "default",
        source: null,
        startLine: i + 1,
      });
      continue;
    }

    // export { a, b } or export { a as b }
    if (/^\s*export\s+\{/.test(line)) {
      const inner = line.replace(/^\s*export\s+\{/, "").replace(/\}\s*;?$/, "").trim();
      const items = inner.split(",");
      for (const item of items) {
        const trimmed = item.trim();
        const asMatch = trimmed.match(/^(\w[\w$]*)(?:\s+as\s+(\w[\w$]*))?$/);
        if (asMatch) {
          results.push({
            name: asMatch[2] || asMatch[1],
            type: "named",
            source: null,
            startLine: i + 1,
          });
        }
      }
      continue;
    }

    // export function/const/let/var/class name
    let match;
    if ((match = line.match(/^\s*export\s+(?:async\s+)?function\s+([\w$]+)/))) {
      results.push({ name: match[1], type: "named", source: null, startLine: i + 1 });
    } else if ((match = line.match(/^\s*export\s+(?:const|let|var)\s+([\w$]+)/))) {
      results.push({ name: match[1], type: "named", source: null, startLine: i + 1 });
    } else if ((match = line.match(/^\s*export\s+class\s+([\w$]+)/))) {
      results.push({ name: match[1], type: "named", source: null, startLine: i + 1 });
    }

    // export * from 'source' or export { x } from 'source'
    if ((match = line.match(/^\s*export\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/))) {
      const source = match[1];
      const isStar = /\*\s+from/.test(line);
      if (isStar) {
        results.push({ name: "*", type: "reexport", source, startLine: i + 1 });
      }
      // Named re-exports were already partially handled.
    }

    // module.exports =
    if ((match = line.match(/^\s*module\.exports\s*=\s*/))) {
      // Check if it's assigning an object with named properties.
      const rest = line.slice(match[0].length).trim();
      if (rest.startsWith("{")) {
        // Named exports via module.exports = { a, b }
        const inner = rest.slice(1, rest.lastIndexOf("}"));
        if (inner) {
          const items = inner.split(",");
          for (const item of items) {
            const trimmed = item.trim();
            const name = trimmed.split(/[:=]/)[0].trim();
            if (name && /^[\w$]+$/.test(name)) {
              results.push({ name, type: "cjs-named", source: null, startLine: i + 1 });
            }
          }
        }
      } else {
        // Single export
        const nameMatch = rest.match(/^([\w$]+)/);
        results.push({
          name: nameMatch ? nameMatch[1] : "module",
          type: "cjs",
          source: null,
          startLine: i + 1,
        });
      }
    }

    // exports.name =
    if ((match = line.match(/^\s*exports\.([\w$]+)\s*=/))) {
      results.push({ name: match[1], type: "cjs-named", source: null, startLine: i + 1 });
    }
  }

  return results;
}

/**
 * Extract JSDoc comments with their associated declarations.
 * @param {string} content - JS/TS source code
 * @returns {Array<{comment: string, tags: Array<{tag: string, name: string, type: string, description: string}>, associatedName: string|null, startLine: number, endLine: number}>}
 */
function extractJsDoc(content) {
  const results = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // JSDoc starts with /**
    if (trimmed.startsWith("/**") && !trimmed.startsWith("/***")) {
      // Collect the full JSDoc comment.
      let comment = "";
      let endLine = i;

      while (i < lines.length) {
        comment += (comment ? "\n" : "") + lines[i];
        if (lines[i].includes("*/")) {
          endLine = i + 1;
          i++;
          break;
        }
        i++;
      }

      if (!comment.includes("*/")) continue;

      // Extract tags.
      const tags = _parseJsDocTags(comment);

      // Look for the associated declaration on the next line(s).
      let associatedName = null;
      const nextLineIdx = endLine; // i is already past the comment
      if (endLine < lines.length) {
        const nextLine = lines[endLine]?.trim() || "";
        let fnMatch;
        if ((fnMatch = nextLine.match(/(?:async\s+)?function\s+([\w$]+)/))) {
          associatedName = fnMatch[1];
        } else if ((fnMatch = nextLine.match(/(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/))) {
          associatedName = fnMatch[1];
        } else if ((fnMatch = nextLine.match(/class\s+([\w$]+)/))) {
          associatedName = fnMatch[1];
        } else if ((fnMatch = nextLine.match(/(?:get|set)\s+([\w$]+)\s*\(/))) {
          associatedName = fnMatch[1];
        }
      }

      results.push({
        comment,
        tags,
        associatedName,
        startLine: endLine - comment.split("\n").length + 1, // approximate
        endLine,
      });

      continue;
    }

    i++;
  }

  return results;
}

/**
 * Get the signature of a function: parameter list and return type.
 * @param {{params: string[], body: string, name: string, async: boolean}} func - function object from extractFunctions
 * @returns {{name: string, params: Array<{name: string, type: string|null, defaultValue: string|null}>, returnType: string|null}}
 */
function getFunctionSignature(func) {
  const params = func.params.map((p) => {
    const parts = p.trim().split(/\s*=\s*/);
    const paramPart = parts[0].trim();
    const defaultVal = parts.length > 1 ? parts.slice(1).join("=").trim() : null;

    // Check for TypeScript type annotation: name: Type
    const typeMatch = paramPart.match(/^([\w$]+)\s*:\s*(.+)$/);
    if (typeMatch) {
      return { name: typeMatch[1], type: typeMatch[2].trim(), defaultValue: defaultVal };
    }

    // Destructured parameter: { name } or [ items ]
    if (/^\{|^\[/.test(paramPart)) {
      return { name: paramPart, type: null, defaultValue: defaultVal };
    }

    return { name: paramPart, type: null, defaultValue: defaultVal };
  });

  // Infer return type from body analysis.
  let returnType = null;
  if (func.body) {
    // Check return statements for type hints.
    const returnMatches = func.body.match(/return\s+(.+?)(?:;|\n|$)/g);
    if (returnMatches) {
      const types = new Set();
      for (const ret of returnMatches) {
        const expr = ret.replace(/^return\s+/, "").replace(/[;\s]+$/, "").trim();
        if (/^["'`]/.test(expr) || /["'`]\s*\+/.test(expr) || /\+\s*["'`]/.test(expr)) {
          types.add("string");
        } else if (/^\d+\.?\d*$/.test(expr)) {
          types.add("number");
        } else if (/^(true|false)$/.test(expr)) {
          types.add("boolean");
        } else if (/^\[/.test(expr)) {
          types.add("Array");
        } else if (/^\{/.test(expr)) {
          types.add("Object");
        } else if (/^new\s+(\w+)/.test(expr)) {
          types.add(expr.match(/^new\s+(\w+)/)[1]);
        }
      }
      if (types.size === 1) returnType = [...types][0];
    }
  }

  return {
    name: func.name,
    params,
    returnType,
  };
}

/**
 * Find identifiers that a function body depends on (external references).
 * @param {string} funcBody - the function body string (from extractFunctions)
 * @returns {string[]} list of dependency names
 */
function getDependencies(funcBody) {
  if (!funcBody) return [];

  // Extract all identifier-like tokens.
  const identifiers = new Set();
  const regex = /\b([a-zA-Z_$][\w$]*)\b/g;
  let match;

  while ((match = regex.exec(funcBody)) !== null) {
    const name = match[1];
    if (!JS_KEYWORDS.has(name) && !BUILTIN_GLOBALS.has(name)) {
      identifiers.add(name);
    }
  }

  return [...identifiers].sort();
}

// ---- Private helpers ----

/**
 * Extract a function block (parameters and body) starting from a given line.
 */
function _extractFunctionBlock(lines, startIdx, name) {
  // Find the opening parenthesis and extract parameters.
  const startLine = lines[startIdx];
  let combined = startLine;

  // Collect lines until we have the full parameter list and opening brace.
  let paramStr = "";
  let bodyStartIdx = startIdx;
  let foundParenOpen = false;
  let parenDepth = 0;
  let foundArrow = false;

  for (let i = startIdx; i < lines.length && i <= startIdx + 10; i++) {
    const l = lines[i];
    if (i > startIdx) combined += " " + l.trim();

    for (let j = 0; j < l.length; j++) {
      const ch = l[j];
      if (ch === "(" && !foundParenOpen) {
        foundParenOpen = true;
        parenDepth = 1;
        paramStr = "";
        continue;
      }
      if (foundParenOpen && !foundArrow) {
        if (ch === "(") parenDepth++;
        if (ch === ")") {
          parenDepth--;
          if (parenDepth === 0) {
            foundParenOpen = false; // params done
          }
        }
        if (parenDepth > 0) {
          paramStr += ch;
        }
      }
      if (ch === "=" && l[j + 1] === ">" && parenDepth === 0 && !foundArrow) {
        foundArrow = true;
      }
    }

    // Check if this line contains the opening brace or arrow with expression body.
    if ((foundArrow || parenDepth === 0) && /\{/.test(l)) {
      bodyStartIdx = i;
      break;
    }
    // Arrow function without braces: const x = (a) => expr;
    if (foundArrow && !/\{/.test(l) && !/=>\s*$/.test(l.trim())) {
      // Single-expression arrow function.
      const arrowIdx = l.indexOf("=>");
      const expr = l.slice(arrowIdx + 2).trim();
      const semicolonIdx = expr.indexOf(";");
      const bodyExpr = semicolonIdx >= 0 ? expr.slice(0, semicolonIdx) : expr;

      return {
        params: paramStr ? paramStr.split(",").map((p) => p.trim()).filter(Boolean) : [],
        body: `return ${bodyExpr};`,
        endLine: i + 1,
      };
    }
  }

  if (!bodyStartIdx && foundArrow) {
    // Arrow function that may have body on next line.
    bodyStartIdx = startIdx;
  }

  if (bodyStartIdx < startIdx) bodyStartIdx = startIdx;

  // Now extract the body by matching braces.
  const bodyInfo = _extractBraceBlock(lines, bodyStartIdx);
  if (!bodyInfo) {
    // Try single-expression body.
    const combinedTrimmed = combined.replace(/\s+/g, " ").trim();
    const arrowMatch = combinedTrimmed.match(/=>\s*(.+?)(?:;|\s*)$/);
    if (arrowMatch) {
      return {
        params: paramStr ? paramStr.split(",").map((p) => p.trim()).filter(Boolean) : [],
        body: `return ${arrowMatch[1].replace(/;$/, "")};`,
        endLine: bodyStartIdx + 1,
      };
    }
    return null;
  }

  return {
    params: paramStr ? paramStr.split(",").map((p) => p.trim()).filter(Boolean) : [],
    body: bodyInfo.body,
    endLine: bodyInfo.endLine,
  };
}

/**
 * Extract a brace-delimited block starting from a given line.
 * Returns { body: string, endLine: number } or null.
 */
function _extractBraceBlock(lines, startIdx) {
  let braceDepth = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;
  let inComment = false;
  let bodyStarted = false;
  let bodyLines = [];
  let foundOpen = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    let lineContent = "";

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1] || "";

      // Handle comments.
      if (!inString && !inTemplate && ch === "/" && next === "/" && !inComment) {
        // Rest of line is comment — skip.
        break;
      }
      if (!inString && !inTemplate && ch === "/" && next === "*" && !inComment) {
        inComment = true;
        j++; // skip *
        continue;
      }
      if (inComment && ch === "*" && next === "/") {
        inComment = false;
        j++; // skip /
        continue;
      }
      if (inComment) continue;

      // Handle strings.
      if (ch === "\\" && (inString || inTemplate)) {
        lineContent += ch + next;
        j++;
        continue;
      }
      if (ch === "\"" || ch === "'") {
        if (!inTemplate && !inString) {
          inString = true;
          stringChar = ch;
        } else if (inString && ch === stringChar) {
          inString = false;
        }
        lineContent += ch;
        continue;
      }
      if (ch === "`") {
        if (!inString) {
          inTemplate = !inTemplate;
        }
        lineContent += ch;
        continue;
      }

      if (inString || inTemplate) {
        lineContent += ch;
        continue;
      }

      // Track braces.
      if (ch === "{") {
        braceDepth++;
        foundOpen = true;
        if (!bodyStarted && braceDepth === 1) {
          bodyStarted = true;
          // Don't include the opening brace character in the body.
          continue;
        }
      }
      if (ch === "}") {
        braceDepth--;
        if (braceDepth === 0 && foundOpen) {
          // Closing brace — end of body.
          return {
            body: bodyLines.join("\n") + (lineContent ? "\n" : "") + lineContent,
            endLine: i + 1,
          };
        }
      }

      if (bodyStarted) {
        lineContent += ch;
      }
    }

    if (bodyStarted) {
      bodyLines.push(lineContent);
    }
  }

  return null;
}

/**
 * Extract methods from a class body string.
 */
function _extractClassMethods(body) {
  const methods = [];
  const methodRegex = /(?:static\s+)?(?:async\s+)?(?:\*?\s*)?(?:get\s+|set\s+)?([\w$]+)\s*\(/g;
  let match;

  while ((match = methodRegex.exec(body)) !== null) {
    // Filter out constructor body references.
    if (!/^(?:if|for|while|switch|return|throw|new|typeof|instanceof|in|of)\b/.test(match[1])) {
      const fullMatch = match[0];
      const isStatic = /static/.test(fullMatch);
      const isAsync = /async/.test(fullMatch);
      const isGetter = /get\s+/.test(fullMatch);
      const isSetter = /set\s+/.test(fullMatch);

      // Avoid duplicates.
      if (!methods.some((m) => m.name === match[1])) {
        methods.push({
          name: match[1],
          isStatic,
          isAsync,
          isGetter,
          isSetter,
        });
      }
    }
  }

  return methods;
}

/**
 * Parse JSDoc tags from a comment block.
 */
function _parseJsDocTags(comment) {
  const tags = [];
  const tagRegex = /@(\w+)(?:\s+\{([^}]+)\})?\s+(?:\[?([\w$.]+)\]?)?\s*-?\s*(.*)/g;
  let match;

  // Remove the opening and closing comment markers.
  const cleanComment = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join("\n");

  while ((match = tagRegex.exec(cleanComment)) !== null) {
    tags.push({
      tag: match[1],
      type: match[2] || null,
      name: match[3] || null,
      description: (match[4] || "").trim(),
    });
  }

  return tags;
}

module.exports = {
  extractFunctions,
  extractClasses,
  extractExports,
  extractJsDoc,
  getFunctionSignature,
  getDependencies,
};
