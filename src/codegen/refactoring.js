/**
 * RefactoringEngine — regex/pattern-based code transformations for agent-driven refactoring.
 *
 * Provides extract-function, rename-variable, convert-to-arrow, error-handling wrapping,
 * logging instrumentation, basic formatting, and code smell detection.
 * Pure functions operating on source strings — no AST parser dependency.
 */
"use strict";

class RefactoringEngine {
  /**
   * Extract selected code into a new function and replace with a call.
   *
   * @param {string} content - source code
   * @param {{startLine: number, endLine: number}|string} selection - line range or code text to extract
   * @param {{functionName?: string, insertAfter?: boolean}} [options]
   * @returns {{content: string, extractedFunction: {name: string, params: string[], body: string}, callSite: string}}
   */
  extractFunction(content, selection, options = {}) {
    const functionName = options.functionName || this._generateFunctionName();
    const insertAfter = options.insertAfter !== false;

    let extractLines;
    let startLineNum;
    let endLineNum;

    if (typeof selection === "string") {
      // Find the selection in content.
      const idx = content.indexOf(selection);
      if (idx === -1) {
        throw new Error("Selection text not found in content.");
      }
      const before = content.slice(0, idx);
      startLineNum = before.split("\n").length;
      extractLines = selection;
      endLineNum = startLineNum + selection.split("\n").length - 1;
    } else {
      startLineNum = selection.startLine;
      endLineNum = selection.endLine;
      const allLines = content.split("\n");
      extractLines = allLines.slice(startLineNum - 1, endLineNum).join("\n");
    }

    // Analyze what outer variables the selection uses.
    const outerVars = this._findOuterVariables(content, extractLines, startLineNum, endLineNum);
    const params = outerVars.map((v) => v.name);

    // Build the extracted function.
    const fnBody = extractLines;
    const newFnDef = `function ${functionName}(${params.join(", ")}) {\n${this._indent(fnBody, 2)}\n}`;

    // Build the call site replacement.
    const callArgs = params.join(", ");
    const callSite = `${functionName}(${callArgs});`;

    // Find the containing function to know where to insert the extracted function.
    const allLines = content.split("\n");
    const beforeSelection = allLines.slice(0, startLineNum - 1);
    let afterSelection = allLines.slice(endLineNum);

    // Replace the selection with the call site.
    const callSiteLines = callSite.split("\n");
    const replaced = [...beforeSelection, ...callSiteLines, ...afterSelection];

    // Insert the new function definition.
    let result;
    if (insertAfter) {
      // Insert after the selection location.
      const insertPos = beforeSelection.length + callSiteLines.length;
      const beforeInsert = replaced.slice(0, insertPos);
      const afterInsert = replaced.slice(insertPos);
      result = [...beforeInsert, "", newFnDef, ...afterInsert];
    } else {
      // Insert before the selection location.
      result = [...beforeSelection, newFnDef, "", ...callSiteLines, ...afterSelection];
    }

    return {
      content: result.join("\n"),
      extractedFunction: {
        name: functionName,
        params,
        body: fnBody,
      },
      callSite,
    };
  }

  /**
   * Rename a variable throughout its scope in the source code.
   * Uses word-boundary matching and skips strings/comments.
   *
   * @param {string} content - source code
   * @param {string} oldName - variable to rename
   * @param {string} newName - new variable name
   * @returns {string} updated content
   */
  renameVariable(content, oldName, newName) {
    if (!oldName || !newName || oldName === newName) return content;

    // Remove comments and strings before renaming, then restore.
    const regions = this._findStringAndCommentRegions(content);
    const result = [];

    let lastEnd = 0;
    for (const region of regions) {
      // Process the non-comment/non-string segment before this region.
      const segment = content.slice(lastEnd, region.start);
      const renamed = segment.replace(
        new RegExp("\\b" + this._escapeRegex(oldName) + "\\b", "g"),
        newName
      );
      result.push(renamed);

      // Preserve the string/comment region as-is.
      result.push(content.slice(region.start, region.end));

      lastEnd = region.end;
    }

    // Process remaining text after last region.
    const tail = content.slice(lastEnd);
    result.push(
      tail.replace(
        new RegExp("\\b" + this._escapeRegex(oldName) + "\\b", "g"),
        newName
      )
    );

    return result.join("");
  }

  /**
   * Convert a named function declaration to an arrow function expression.
   *
   * @param {string} content - source code
   * @param {string} functionName - name of the function to convert
   * @returns {string} updated content
   */
  convertToArrow(content, functionName) {
    // Find the function declaration.
    const regex = new RegExp(
      "((?:async\\s+)?)function\\s+" + this._escapeRegex(functionName) + "\\s*\\(([^)]*)\\)\\s*\\{",
      "m"
    );
    const match = content.match(regex);

    if (!match) {
      return content; // Function not found or already arrow.
    }

    const asyncPrefix = match[1];
    const params = match[2];
    const fullMatchStart = match.index;

    // Find the matching closing brace.
    const openBraceIdx = match.index + match[0].length - 1; // position of '{'
    const closeBraceIdx = this._findMatchingBrace(content, openBraceIdx);

    if (closeBraceIdx === -1) return content;

    // Extract the body.
    const body = content.slice(openBraceIdx + 1, closeBraceIdx);

    // Build the arrow function.
    const arrowFn = `const ${functionName} = ${asyncPrefix}(${params.trim()}) => {\n${body}\n};`;

    // Replace in content.
    return (
      content.slice(0, fullMatchStart) +
      arrowFn +
      content.slice(closeBraceIdx + 1)
    );
  }

  /**
   * Wrap a function body in try/catch error handling.
   *
   * @param {string} content - source code
   * @param {string} functionName - name of the function to wrap
   * @returns {string} updated content
   */
  addErrorHandling(content, functionName) {
    const fnPatterns = [
      // function declaration
      new RegExp(
        "(function\\s+" + this._escapeRegex(functionName) + "\\s*\\([^)]*\\)\\s*)\\{",
        "m"
      ),
      // arrow function: const name = (...) => {
      new RegExp(
        "(const\\s+" + this._escapeRegex(functionName) + "\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*)\\{",
        "m"
      ),
      // method shorthand: name(...) {
      new RegExp(
        "(" + this._escapeRegex(functionName) + "\\s*\\([^)]*\\)\\s*)\\{",
        "m"
      ),
    ];

    for (const regex of fnPatterns) {
      const match = content.match(regex);
      if (!match) continue;

      const prefix = match[1];
      const openBraceIdx = match.index + match[0].length - 1;
      const closeBraceIdx = this._findMatchingBrace(content, openBraceIdx);

      if (closeBraceIdx === -1) continue;

      const body = content.slice(openBraceIdx + 1, closeBraceIdx);
      const indentedBody = this._indent(body, 2);

      const wrappedBody =
        "{\n" +
        "  try {\n" +
        indentedBody + "\n" +
        "  } catch (error) {\n" +
        `    console.error('Error in ${functionName}:', error);\n` +
        "    throw error;\n" +
        "  }\n" +
        "}";

      return (
        content.slice(0, match.index) +
        prefix +
        wrappedBody +
        content.slice(closeBraceIdx + 1)
      );
    }

    return content;
  }

  /**
   * Add console.log instrumentation at function entry and exit.
   *
   * @param {string} content - source code
   * @param {string} functionName - name of the function to instrument
   * @returns {string} updated content
   */
  addLogging(content, functionName) {
    const fnPatterns = [
      new RegExp(
        "(function\\s+" + this._escapeRegex(functionName) + "\\s*\\(([^)]*)\\)\\s*)\\{",
        "m"
      ),
      new RegExp(
        "(const\\s+" + this._escapeRegex(functionName) + "\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*=>\\s*)\\{",
        "m"
      ),
      new RegExp(
        "(" + this._escapeRegex(functionName) + "\\s*\\(([^)]*)\\)\\s*)\\{",
        "m"
      ),
    ];

    for (const regex of fnPatterns) {
      const match = content.match(regex);
      if (!match) continue;

      const prefix = match[1];
      let params = match[2] ? match[2].trim() : "";
      const openBraceIdx = match.index + match[0].length - 1;
      const closeBraceIdx = this._findMatchingBrace(content, openBraceIdx);

      if (closeBraceIdx === -1) continue;

      const body = content.slice(openBraceIdx + 1, closeBraceIdx);

      // Build parameter logging string.
      let paramLog = "";
      if (params) {
        const paramNames = params.split(",").map((p) => {
          const trimmed = p.trim();
          // Handle destructured params.
          const nameMatch = trimmed.match(/^([\w$]+)/);
          return nameMatch ? nameMatch[1] : trimmed;
        });
        if (paramNames.length === 1) {
          paramLog = `, ${paramNames[0]}`;
        } else if (paramNames.length > 1) {
          paramLog = `, { ${paramNames.join(", ")} }`;
        }
      }

      const entryLog = `  console.log('${functionName}: entry'${paramLog});\n`;

      // Add exit logging before each return statement.
      let instrumentedBody = entryLog + body;

      // Replace return statements to add exit logging.
      instrumentedBody = instrumentedBody.replace(
        /(\n\s*)(return\s+)(.+?)(;)(\s*\n|$)/g,
        (fullMatch, newline, retKeyword, expr, semi, end) => {
          const trimmedExpr = expr.trim();
          return `${newline}console.log('${functionName}: exit', ${trimmedExpr});\n${newline}${retKeyword}${expr}${semi}${end}`;
        }
      );

      // Handle bare return; (no value).
      instrumentedBody = instrumentedBody.replace(
        /(\n\s*)(return\s*;)(\s*\n|$)/g,
        (fullMatch, newline, retStmt, end) => {
          return `${newline}console.log('${functionName}: exit');\n${newline}${retStmt}${end}`;
        }
      );

      // Handle implicit return in final expression.
      if (!/return\s/.test(body)) {
        // Check if the last line is an expression (implicit return for arrow functions).
        const lines = body.split("\n");
        const lastNonEmpty = lines.filter((l) => l.trim()).pop();
        if (lastNonEmpty && !lastNonEmpty.trim().startsWith("//") && !lastNonEmpty.trim().startsWith("console")) {
          const indented = this._indent(body, 0);
          instrumentedBody = entryLog + indented;
        }
      }

      const newBody = "{\n" + instrumentedBody + "\n}";

      return (
        content.slice(0, match.index) +
        prefix +
        newBody +
        content.slice(closeBraceIdx + 1)
      );
    }

    return content;
  }

  /**
   * Basic code formatting: normalize indentation, spacing, and semicolons.
   *
   * @param {string} content - source code
   * @returns {string} formatted code
   */
  formatCode(content) {
    const lines = content.split("\n");
    const result = [];
    let indentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Trim trailing whitespace.
      line = line.replace(/\s+$/, "");

      // Skip empty lines.
      if (line.trim() === "") {
        result.push("");
        continue;
      }

      // Adjust indent level based on closing braces/brackets at the start.
      const trimmed = line.trim();
      const closeCount = (trimmed.match(/^[\}\)\]]/g) || []).length;

      if (closeCount > 0) {
        indentLevel = Math.max(0, indentLevel - closeCount);
      }

      // Apply indentation.
      const indent = "  ".repeat(indentLevel);
      line = indent + trimmed;

      // Normalize spacing around operators.
      line = line.replace(/\s*([+\-*/%=<>!&|^]=?)\s*/g, " $1 ");
      if (line.includes("  =  ")) line = line.replace("  =  ", " = ");
      line = line.replace(/\s*,\s*/g, ", ");
      line = line.replace(/\s*:\s*/g, ": "); // object properties

      // Add missing semicolons for simple statements.
      if (
        !trimmed.endsWith(";") &&
        !trimmed.endsWith("{") &&
        !trimmed.endsWith("}") &&
        !trimmed.endsWith(":") &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("if ") &&
        !trimmed.startsWith("for ") &&
        !trimmed.startsWith("while ") &&
        !trimmed.startsWith("switch ") &&
        !trimmed.startsWith("function ") &&
        !trimmed.startsWith("class ") &&
        !trimmed.startsWith("try ") &&
        !trimmed.startsWith("catch") &&
        !trimmed.startsWith("else ") &&
        !trimmed.startsWith("do ") &&
        line.includes("=") &&
        !line.match(/[=!<>]=/)
      ) {
        line = line + ";";
      }

      result.push(line);

      // Adjust indent level based on opening braces/brackets at the end.
      const openCount = (trimmed.match(/[\{\(\[]/g) || []).length;
      indentLevel += openCount;

      // Subtract closing braces/brackets at the end.
      const endCloseCount = (trimmed.match(/[\}\)\]]/g) || []).length;
      // Already handled start closes, so only handle end closes.
      const adjustedEndClose = Math.max(0, endCloseCount - closeCount);
      indentLevel = Math.max(0, indentLevel - adjustedEndClose);
    }

    // Clean up multiple consecutive blank lines.
    const cleaned = [];
    let prevEmpty = false;
    for (const line of result) {
      if (line === "") {
        if (!prevEmpty) {
          cleaned.push(line);
        }
        prevEmpty = true;
      } else {
        cleaned.push(line);
        prevEmpty = false;
      }
    }

    return cleaned.join("\n");
  }

  /**
   * Detect code smells: long functions, deep nesting, duplicated code, too many params.
   *
   * @param {string} content - source code
   * @returns {Array<{type: string, message: string, line: number, severity: string}>}
   */
  detectCodeSmells(content) {
    const smells = [];
    const lines = content.split("\n");

    // Detect long functions (> 50 lines).
    const fnRegex = /(?:async\s+)?function\s+([\w$]+)\s*\(/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const fnName = match[1];
      const openBrace = content.indexOf("{", match.index);
      if (openBrace === -1) continue;
      const closeBrace = this._findMatchingBrace(content, openBrace);
      if (closeBrace === -1) continue;

      const fnContent = content.slice(openBrace, closeBrace);
      const fnLines = fnContent.split("\n").length;

      const startLine = content.slice(0, match.index).split("\n").length;

      if (fnLines > 50) {
        smells.push({
          type: "long-function",
          message: `Function '${fnName}' is ${fnLines} lines long (threshold: 50). Consider splitting.`,
          line: startLine,
          severity: "warning",
        });
      }
    }

    // Detect too many parameters (> 5).
    const paramRegex = /(?:async\s+)?function\s+([\w$]+)\s*\(([^)]*)\)/g;
    while ((match = paramRegex.exec(content)) !== null) {
      const fnName = match[1];
      const params = match[2].split(",").filter((p) => p.trim());
      if (params.length > 5) {
        const startLine = content.slice(0, match.index).split("\n").length;
        smells.push({
          type: "too-many-params",
          message: `Function '${fnName}' has ${params.length} parameters (threshold: 5). Consider using an options object.`,
          line: startLine,
          severity: "warning",
        });
      }
    }

    // Detect deep nesting (> 4 levels) by tracking cumulative brace depth.
    let cumulativeDepth = 0;
    let maxDepth = 0;
    let maxDepthLine = 0;
    let inString2 = false;
    let stringChar2 = "";
    let inTemplate2 = false;
    let inLineComment2 = false;
    let inBlockComment2 = false;

    for (let idx = 0; idx < content.length; idx++) {
      const ch = content[idx];
      const nextChar = content[idx + 1] || "";

      // Track line number.
      if (ch === "\n") continue; // handled below via content slice

      if (!inString2 && !inTemplate2 && ch === "/" && nextChar === "/" && !inBlockComment2) {
        inLineComment2 = true;
        idx++;
        continue;
      }
      if (inLineComment2) {
        if (ch === "\n") inLineComment2 = false;
        continue;
      }
      if (!inString2 && !inTemplate2 && ch === "/" && nextChar === "*" && !inBlockComment2) {
        inBlockComment2 = true;
        idx++;
        continue;
      }
      if (inBlockComment2) {
        if (ch === "*" && nextChar === "/") { inBlockComment2 = false; idx++; }
        continue;
      }

      if (ch === "\\" && (inString2 || inTemplate2)) { idx++; continue; }
      if ((ch === "\"" || ch === "'") && !inTemplate2) {
        if (!inString2) { inString2 = true; stringChar2 = ch; }
        else if (ch === stringChar2) inString2 = false;
        continue;
      }
      if (ch === "`" && !inString2) {
        inTemplate2 = !inTemplate2;
        continue;
      }
      if (inString2 || inTemplate2) continue;

      if (ch === "{") {
        cumulativeDepth++;
        if (cumulativeDepth > maxDepth) {
          maxDepth = cumulativeDepth;
          maxDepthLine = content.slice(0, idx).split("\n").length;
        }
      }
      if (ch === "}") cumulativeDepth = Math.max(0, cumulativeDepth - 1);
    }

    if (maxDepth > 4) {
      smells.push({
        type: "deep-nesting",
        message: `Maximum nesting depth is ${maxDepth} at line ${maxDepthLine}. Consider extracting inner blocks into functions.`,
        line: maxDepthLine,
        severity: "warning",
      });
    }

    // Detect duplicated code (> 5 identical consecutive lines).
    const normalizedLines = lines.map((l) => l.trim());
    const minDupLines = 5;

    for (let i = 0; i < normalizedLines.length - minDupLines; i++) {
      if (!normalizedLines[i]) continue;

      for (let j = i + minDupLines; j < normalizedLines.length - minDupLines; j++) {
        let matchLen = 0;
        while (
          i + matchLen < normalizedLines.length &&
          j + matchLen < normalizedLines.length &&
          normalizedLines[i + matchLen] === normalizedLines[j + matchLen] &&
          normalizedLines[i + matchLen].length > 0
        ) {
          matchLen++;
        }
        if (matchLen >= minDupLines) {
          smells.push({
            type: "duplicated-code",
            message: `Lines ${i + 1}-${i + matchLen} are duplicated at lines ${j + 1}-${j + matchLen} (${matchLen} lines). Consider extracting into a shared function.`,
            line: i + 1,
            severity: "warning",
          });
          i += matchLen; // Skip ahead.
          break;
        }
      }
    }

    return smells;
  }

  // ---- Private helpers ----

  /**
   * Find variables from the outer scope that are used in the selection.
   */
  _findOuterVariables(fullContent, selection, startLine, endLine) {
    // Find all identifiers in the selection.
    const idRegex = /\b([a-zA-Z_$][\w$]*)\b/g;
    const usedIds = new Set();
    let match;
    while ((match = idRegex.exec(selection)) !== null) {
      usedIds.add(match[1]);
    }

    // Find variables defined within the selection.
    const localVars = new Set();
    const varRegex = /(?:const|let|var)\s+([\w$]+)/g;
    while ((match = varRegex.exec(selection)) !== null) {
      localVars.add(match[1]);
    }
    // Parameters of functions defined in the selection.
    const paramRegex = /function\s+\w*\s*\(([^)]*)\)/g;
    while ((match = paramRegex.exec(selection)) !== null) {
      for (const p of match[1].split(",")) {
        const name = p.trim().split(/\s*[:=]/)[0].trim();
        if (name && /^[\w$]+$/.test(name)) localVars.add(name);
      }
    }
    // Arrow function params.
    const arrowParamRegex = /\(([^)]*)\)\s*=>/g;
    while ((match = arrowParamRegex.exec(selection)) !== null) {
      for (const p of match[1].split(",")) {
        const name = p.trim().split(/\s*[:=]/)[0].trim();
        if (name && /^[\w$]+$/.test(name)) localVars.add(name);
      }
    }

    // Find identifiers that are defined in the outer scope but used in the selection.
    // Look at code before the selection for definitions.
    const beforeLines = fullContent.split("\n").slice(0, startLine - 1);
    const beforeContent = beforeLines.join("\n");
    const outerDefs = new Set();

    const defRegex = /(?:const|let|var|function)\s+([\w$]+)/g;
    while ((match = defRegex.exec(beforeContent)) !== null) {
      outerDefs.add(match[1]);
    }
    // Also check function parameters in the containing scope.
    const parentFnMatch = this._findContainingFunction(fullContent, startLine);
    if (parentFnMatch) {
      const params = parentFnMatch.params;
      if (params) {
        for (const p of params.split(",")) {
          const name = p.trim().split(/\s*[:=]/)[0].trim();
          if (name && /^[\w$]+$/.test(name)) outerDefs.add(name);
        }
      }
    }

    // JS keywords and builtins to exclude.
    const excludeWords = new Set([
      "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
      "return", "throw", "try", "catch", "finally", "new", "delete", "typeof",
      "instanceof", "in", "of", "this", "super", "true", "false", "null",
      "undefined", "NaN", "Infinity", "async", "await", "yield", "function",
      "class", "const", "let", "var", "import", "export", "default", "from",
      "as", "static", "get", "set", "extends", "debugger", "void", "with",
      "console", "Math", "JSON", "Object", "Array", "String", "Number",
      "Boolean", "Symbol", "Map", "Set", "Promise", "Error", "Date", "RegExp",
      "parseInt", "parseFloat", "isNaN", "isFinite", "require", "module",
      "exports", "process", "Buffer", "setTimeout", "setInterval",
      "clearTimeout", "clearInterval", "globalThis", "global", "window",
      "document", "__dirname", "__filename",
    ]);

    const outerVars = [];
    for (const id of usedIds) {
      if (excludeWords.has(id)) continue;
      if (localVars.has(id)) continue;
      if (outerDefs.has(id)) {
        outerVars.push({ name: id });
      }
    }

    return outerVars;
  }

  /**
   * Find the containing function for a given line number.
   */
  _findContainingFunction(content, lineNum) {
    const lines = content.split("\n");
    const fnRegex = /(?:async\s+)?function\s+\w*\s*\(([^)]*)\)/g;

    let bestMatch = null;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const fnLine = content.slice(0, match.index).split("\n").length;
      if (fnLine < lineNum) {
        const openBrace = content.indexOf("{", match.index);
        if (openBrace === -1) continue;
        const closeBrace = this._findMatchingBrace(content, openBrace);
        if (closeBrace === -1) continue;
        const endLine = content.slice(0, closeBrace).split("\n").length;
        if (lineNum > fnLine && lineNum < endLine) {
          bestMatch = { params: match[1] };
        }
      }
    }
    return bestMatch;
  }

  /**
   * Find the matching closing brace for a given opening brace position.
   */
  _findMatchingBrace(content, openIdx) {
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let inTemplate = false;

    for (let i = openIdx; i < content.length; i++) {
      const ch = content[i];

      if (ch === "\\" && (inString || inTemplate)) {
        i++; // skip escaped char
        continue;
      }
      if ((ch === "\"" || ch === "'") && !inTemplate) {
        if (!inString) {
          inString = true;
          stringChar = ch;
        } else if (ch === stringChar) {
          inString = false;
        }
        continue;
      }
      if (ch === "`" && !inString) {
        inTemplate = !inTemplate;
        continue;
      }
      if (inString || inTemplate) continue;

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }

    return -1;
  }

  /**
   * Find string and comment regions in content that should be excluded from renaming.
   */
  _findStringAndCommentRegions(content) {
    const regions = [];
    let i = 0;

    while (i < content.length) {
      // Single-line comment.
      if (content[i] === "/" && content[i + 1] === "/") {
        const start = i;
        while (i < content.length && content[i] !== "\n") i++;
        regions.push({ start, end: i });
        continue;
      }

      // Block comment.
      if (content[i] === "/" && content[i + 1] === "*") {
        const start = i;
        i += 2;
        while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
        i += 2;
        regions.push({ start, end: i });
        continue;
      }

      // Single/double-quoted string literal — exclude entirely.
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

      // Template literal — exclude only the text parts, not ${...} expressions.
      if (content[i] === "`") {
        i++; // skip opening backtick
        let segStart = i;

        while (i < content.length) {
          if (content[i] === "\\") { i += 2; continue; }
          if (content[i] === "$" && content[i + 1] === "{") {
            // End of text segment.
            if (i > segStart) {
              regions.push({ start: segStart, end: i });
            }
            i += 2;
            // Find matching } for the expression (leave renameable).
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
            segStart = i;
            continue;
          }
          if (content[i] === "`") {
            if (i > segStart) {
              regions.push({ start: segStart, end: i });
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      i++;
    }

    return regions;
  }

  /**
   * Generate a unique function name for extracted functions.
   */
  _generateFunctionName() {
    return "extractedFn_" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Indent a block of text by the given number of spaces.
   */
  _indent(text, spaces) {
    const prefix = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => (line.trim() === "" ? "" : prefix + line))
      .join("\n");
  }

  /**
   * Escape special regex characters in a string.
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

module.exports = { RefactoringEngine };
