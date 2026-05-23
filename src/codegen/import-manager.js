/**
 * ImportManager — regex-based JS/TS import statement manipulation.
 *
 * Provides programmatic import management for agent-driven code generation
 * without an AST parser dependency. Handles ES static imports, TS type
 * imports, CommonJS require(), and dynamic import() expressions.
 *
 * All methods are synchronous and pure (no side-effects).
 */
"use strict";

// Known Node.js built-in modules (node: prefix and bare names).
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "timers", "tls", "trace_events", "tty", "url",
  "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

// JS reserved words and common globals to exclude from dependency detection.
const JS_KEYWORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package",
  "private", "protected", "public", "static", "yield", "async", "await",
  "of", "from", "as", "get", "set", "true", "false", "null", "undefined",
  "NaN", "Infinity",
]);

const BUILTIN_GLOBALS = new Set([
  "Object", "Array", "String", "Number", "Boolean", "Function", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError",
  "console", "Math", "JSON", "Date", "RegExp", "parseInt", "parseFloat",
  "isNaN", "isFinite", "eval", "Buffer", "setTimeout", "setInterval",
  "clearTimeout", "clearInterval", "setImmediate", "clearImmediate",
  "Intl", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Atomics", "globalThis", "global", "process", "require",
  "module", "exports", "__dirname", "__filename",
]);

class ImportManager {
  /**
   * Parse all import/require statements from JS/TS source content.
   * @param {string} content - source code
   * @returns {ImportInfo[]}
   */
  parse(content) {
    const imports = [];
    const lines = content.split("\n");

    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (/^(?:import\s|import\{|import\()/.test(trimmed)) {
        const parsed = this._scanImportBlock(lines, i);
        if (parsed) {
          imports.push(parsed.import);
          i = parsed.nextLine;
          continue;
        }
      }

      if (trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("var ")) {
        const parsed = this._scanRequireLine(lines, i);
        if (parsed) {
          imports.push(parsed.import);
          i = parsed.nextLine;
          continue;
        }
      }

      if (trimmed.startsWith("import(") || trimmed.includes("= import(") || trimmed.includes("await import(")) {
        const parsed = this._scanDynamicImportLine(lines, i);
        if (parsed) {
          imports.push(parsed.import);
          i = parsed.nextLine;
          continue;
        }
      }

      i++;
    }

    return imports;
  }

  /**
   * Add an import if not already present. Returns updated content.
   *
   * @param {string} content - source code
   * @param {string} module - module source path (e.g., 'react', './utils')
   * @param {string|object|null} specifier - what to import
   *   - 'defaultName' → import defaultName from 'module'
   *   - '{ a, b }' → import { a, b } from 'module'
   *   - '* as ns' → import * as ns from 'module'
   *   - { default: 'Name', named: ['a','b'], namespace: 'ns' } → mixed
   *   - null/undefined → import 'module' (side-effect)
   * @param {string} [source] - 'type' for TS type imports, or import kind
   * @returns {string} updated content
   */
  addImport(content, module, specifier, source) {
    if (this.hasImport(content, module, specifier)) {
      return content;
    }

    const lines = content.split("\n");
    const existingImports = this.parse(content);

    // If we have existing imports from the same source, try to merge into one.
    if (specifier && typeof specifier === "string" && specifier.startsWith("{")) {
      const sameSource = existingImports.filter(
        (imp) => imp.source === module && imp.type === "es" && imp.isType === (source === "type")
      );
      if (sameSource.length > 0) {
        return this._mergeIntoExistingImport(content, module, specifier, sameSource[0]);
      }
    }

    const newStmt = this._buildImportStatement(module, specifier, source);
    const lastImport = existingImports.length > 0 ? existingImports[existingImports.length - 1] : null;

    if (lastImport) {
      const insertLine = lastImport.endLine;
      const before = lines.slice(0, insertLine).join("\n");
      const after = lines.slice(insertLine).join("\n");
      if (before && !before.endsWith("\n")) {
        return before + "\n" + newStmt + "\n" + after;
      }
      return before + newStmt + "\n" + after;
    }

    // No existing imports — insert at top after any hashbang or header comment.
    let insertIdx = 0;
    if (lines.length > 0 && lines[0].startsWith("#!")) {
      insertIdx = 1;
    }
    while (insertIdx < lines.length && (lines[insertIdx].trim() === "" || lines[insertIdx].trim().startsWith("//") || lines[insertIdx].trim().startsWith("/*"))) {
      if (lines[insertIdx].trim().startsWith("/*")) {
        while (insertIdx < lines.length && !lines[insertIdx].includes("*/")) {
          insertIdx++;
        }
        insertIdx++;
        continue;
      }
      insertIdx++;
    }

    const before = lines.slice(0, insertIdx).join("\n");
    const after = lines.slice(insertIdx).join("\n");
    const sep = before ? "\n" : "";
    return before + sep + newStmt + "\n" + (after ? "\n" : "") + after;
  }

  /**
   * Remove an import matching the given module source or specifier name.
   * @param {string} content - source code
   * @param {string} module - module source path or import specifier to remove
   * @returns {string} updated content
   */
  removeImport(content, module) {
    const imports = this.parse(content);
    const target = imports.find(
      (imp) => imp.source === module || imp.default === module ||
        imp.named.some((n) => n.name === module || n.alias === module)
    );

    if (!target) {
      return content;
    }

    // If this is a named import we want to remove from a multi-specifier import,
    // try to remove just that specifier.
    if (target.named.length > 0 && target.named.some((n) => n.name === module || n.alias === module)) {
      const remaining = target.named.filter((n) => n.name !== module && n.alias !== module);
      if (remaining.length > 0 || target.default || target.namespace) {
        return this._removeSpecifierFromImport(content, target, module);
      }
    }

    const lines = content.split("\n");
    const before = lines.slice(0, target.startLine - 1);
    const after = lines.slice(target.endLine);

    // Trim trailing blank lines from before and leading from after.
    while (before.length > 0 && before[before.length - 1].trim() === "") {
      before.pop();
    }
    while (after.length > 0 && after[0].trim() === "") {
      after.shift();
    }

    return before.join("\n") + (before.length > 0 && after.length > 0 ? "\n" : "") + after.join("\n");
  }

  /**
   * Sort imports: builtin → external → internal → relative, alphabetical within each group.
   * @param {string} content - source code
   * @returns {string} updated content
   */
  sortImports(content) {
    const imports = this.parse(content);
    if (imports.length === 0) return content;

    const categorized = this._categorizeImports(imports);

    // Sort each category alphabetically by source.
    for (const cat of Object.values(categorized)) {
      cat.sort((a, b) => a.raw.localeCompare(b.raw));
    }

    const order = ["builtin", "external", "internal", "relative"];
    const sortedStatements = [];
    for (const cat of order) {
      if (categorized[cat] && categorized[cat].length > 0) {
        for (const imp of categorized[cat]) {
          sortedStatements.push(imp.raw);
        }
        // Leave a marker for blank line between groups (handled during rebuild).
      }
    }

    return this._replaceImportBlock(content, imports, sortedStatements);
  }

  /**
   * Merge duplicate imports from the same source into combined statements.
   * @param {string} content - source code
   * @returns {string} updated content
   */
  mergeImports(content) {
    const imports = this.parse(content);
    if (imports.length === 0) return content;

    // Group by source + isType.
    const groups = new Map();
    for (const imp of imports) {
      const key = imp.source + "|" + (imp.isType ? "type" : "value");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(imp);
    }

    const merged = [];
    for (const [key, group] of groups) {
      if (group.length === 1) {
        merged.push(group[0].raw);
        continue;
      }

      // Merge all named imports.
      const allNamed = [];
      let defaultName = null;
      let namespaceName = null;
      const isType = group[0].isType;
      const source = group[0].source;

      for (const imp of group) {
        if (imp.default) defaultName = imp.default;
        if (imp.namespace) namespaceName = imp.namespace;
        for (const n of imp.named) {
          if (!allNamed.some((existing) => existing.name === n.name)) {
            allNamed.push(n);
          }
        }
      }

      // Rebuild statement.
      const parts = [];
      if (defaultName) parts.push(defaultName);
      if (allNamed.length > 0) {
        parts.push("{ " + allNamed.map((n) => n.alias ? n.name + " as " + n.alias : n.name).join(", ") + " }");
      }
      if (namespaceName) parts.push("* as " + namespaceName);

      const typePrefix = isType ? "type " : "";
      if (parts.length === 0) {
        merged.push(`import ${typePrefix}'${source}';`);
      } else {
        merged.push(`import ${typePrefix}${parts.join(", ")} from '${source}';`);
      }
    }

    // Restore non-import content. Use raw statement replacement.
    return this._replaceImportBlock(content, imports, merged);
  }

  /**
   * List all imports with structured details.
   * @param {string} content - source code
   * @returns {ImportInfo[]}
   */
  getImports(content) {
    return this.parse(content);
  }

  /**
   * Check if an import for the given module or specifier exists.
   * @param {string} content - source code
   * @param {string} module - module source path or import name
   * @param {string|object} [specifier] - optional specific specifier to check
   * @returns {boolean}
   */
  hasImport(content, module, specifier) {
    const imports = this.parse(content);

    if (!specifier) {
      return imports.some((imp) => imp.source === module);
    }

    // Check if a specific import from this module exists.
    const fromSource = imports.filter((imp) => imp.source === module);

    if (typeof specifier === "string") {
      if (specifier.startsWith("{")) {
        // Check named imports.
        const names = this._parseNamedSpecifiers(specifier);
        return fromSource.some((imp) =>
          names.every((n) => imp.named.some((existing) => existing.name === n.name))
        );
      }
      if (specifier.startsWith("*")) {
        return fromSource.some((imp) => imp.namespace !== null);
      }
      // Default import.
      return fromSource.some((imp) => imp.default === specifier);
    }

    if (specifier && typeof specifier === "object") {
      return fromSource.some((imp) => {
        if (specifier.default && imp.default !== specifier.default) return false;
        if (specifier.named) {
          const names = Array.isArray(specifier.named) ? specifier.named : [specifier.named];
          for (const n of names) {
            if (!imp.named.some((e) => e.name === n)) return false;
          }
        }
        if (specifier.namespace && imp.namespace !== specifier.namespace) return false;
        return true;
      });
    }

    return false;
  }

  // ---- private helpers ----

  /**
   * Scan an ES import statement (may span multiple lines).
   */
  _scanImportBlock(lines, startLine) {
    let stmt = "";
    let braceDepth = 0;
    let inString = false;
    let stringChar = "";
    let seenFrom = false;
    let i = startLine;

    while (i < lines.length) {
      const line = lines[i];
      stmt += (stmt ? "\n" : "") + line;

      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (inString) {
          if (ch === stringChar && line[j - 1] !== "\\") {
            inString = false;
          }
          continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
          inString = true;
          stringChar = ch;
          continue;
        }
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      if (/from\s*['"]/.test(line)) {
        seenFrom = true;
      }

      // Import ends with semicolon, or is side-effect, or braces balanced after 'from'.
      const hasSemicolon = line.includes(";");
      const isSideEffect = /^\s*import\s+['"]/.test(stmt.trim());
      const bracesBalanced = braceDepth === 0 && seenFrom && !line.trim().endsWith(",");

      if (hasSemicolon || isSideEffect || bracesBalanced) {
        i++;
        break;
      }
      i++;
    }

    if (!stmt.trim()) return null;

    const info = this._parseImportStmt(stmt);
    if (!info) return null;

    info.startLine = startLine + 1; // 1-based
    info.endLine = i; // 1-based
    info.raw = stmt.trim();

    return { import: info, nextLine: i };
  }

  /**
   * Parse a single import statement string into an ImportInfo object.
   */
  _parseImportStmt(stmt) {
    stmt = stmt.trim();
    if (!stmt.startsWith("import")) return null;

    // Remove trailing semicolon.
    if (stmt.endsWith(";")) stmt = stmt.slice(0, -1).trim();

    // Check for type/typeof import.
    let isType = false;
    let rest = stmt.slice(6).trim(); // after 'import'
    if (rest.startsWith("type ")) {
      isType = true;
      rest = rest.slice(5).trim();
    } else if (rest.startsWith("typeof ")) {
      isType = true;
      rest = rest.slice(7).trim();
    }

    // Side-effect import: import 'module'
    const sideMatch = rest.match(/^['"]([^'"]+)['"]$/);
    if (sideMatch) {
      return {
        type: "es",
        source: sideMatch[1],
        default: null,
        namespace: null,
        named: [],
        isType: isType,
        startLine: 0,
        endLine: 0,
        raw: stmt,
      };
    }

    // Check for dynamic import: import('module') — should have been caught elsewhere, but handle.
    const dynMatch = rest.match(/^\(['"]([^'"]+)['"]\)/);
    if (dynMatch) {
      return {
        type: "dynamic",
        source: dynMatch[1],
        default: null,
        namespace: null,
        named: [],
        isType: false,
        startLine: 0,
        endLine: 0,
        raw: stmt,
      };
    }

    // Extract source from 'from' clause.
    const fromMatch = rest.match(/from\s+['"]([^'"]+)['"]/);
    if (!fromMatch) return null;

    const source = fromMatch[1];
    const specPart = rest.slice(0, rest.indexOf("from")).trim();

    return this._parseSpecifiers(specPart, source, isType);
  }

  /**
   * Parse the specifier portion of an import statement.
   */
  _parseSpecifiers(specPart, source, isType) {
    let defaultName = null;
    let namespaceName = null;
    const named = [];

    // Check for namespace: * as Name
    const nsMatch = specPart.match(/^\*\s+as\s+(\w[\w$]*)/);
    if (nsMatch) {
      namespaceName = nsMatch[1];
      return {
        type: "es",
        source,
        default: defaultName,
        namespace: namespaceName,
        named,
        isType,
        startLine: 0,
        endLine: 0,
        raw: "",
      };
    }

    // Split by commas that are not inside braces.
    const parts = this._splitSpecifiers(specPart);

    for (const part of parts) {
      const trimmed = part.trim();

      // Named imports: { a, b, c as d }
      if (trimmed.startsWith("{")) {
        const inner = trimmed.slice(1, trimmed.lastIndexOf("}")).trim();
        if (inner) {
          const items = inner.split(",");
          for (const item of items) {
            const iTrimmed = item.trim();
            const asMatch = iTrimmed.match(/^(\w[\w$]*)(?:\s+as\s+(\w[\w$]*))?$/);
            if (asMatch) {
              named.push({
                name: asMatch[1],
                alias: asMatch[2] || null,
              });
            }
          }
        }
        continue;
      }

      // Namespace (standalone * as Name): * as Name
      if (trimmed.startsWith("*")) {
        const nsOnly = trimmed.match(/^\*\s+as\s+(\w[\w$]*)/);
        if (nsOnly) {
          namespaceName = nsOnly[1];
        }
        continue;
      }

      // Default import.
      if (/^[\w$]+$/.test(trimmed)) {
        defaultName = trimmed;
        continue;
      }
    }

    return {
      type: "es",
      source,
      default: defaultName,
      namespace: namespaceName,
      named,
      isType,
      startLine: 0,
      endLine: 0,
      raw: "",
    };
  }

  /**
   * Split specifier string by commas, respecting brace depth.
   */
  _splitSpecifiers(specPart) {
    const parts = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < specPart.length; i++) {
      const ch = specPart[i];
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  /**
   * Scan a require() call line (may span multiple lines with destructuring).
   */
  _scanRequireLine(lines, startLine) {
    // Collect lines until we have the full statement.
    let stmt = "";
    let i = startLine;
    let braceDepth = 0;
    let inString = false;
    let stringChar = "";
    let foundRequire = false;

    while (i < lines.length) {
      const line = lines[i];
      stmt += (stmt ? " " : "") + line.trim();

      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (inString) {
          if (ch === stringChar && line[j - 1] !== "\\") inString = false;
          continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") { inString = true; stringChar = ch; }
        else if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }

      if (/require\s*\(/.test(line)) foundRequire = true;

      // Statement complete when we have semicolon and braces balanced.
      if (foundRequire && braceDepth === 0 && line.includes(";")) {
        i++;
        break;
      }
      if (foundRequire && braceDepth === 0 && !line.includes(";") && !line.includes("=")) {
        // require() without destructuring on one line.
        i++;
        break;
      }
      i++;
    }

    if (!foundRequire) return null;

    // Parse: (const|let|var) NAME = require('source')
    // Or: const { a, b } = require('source')
    const sourceMatch = stmt.match(/require\s*\(\s*(['"])([^'"]+)\1\s*\)/);
    if (!sourceMatch) return null;

    const source = sourceMatch[2];
    let defaultName = null;
    const named = [];

    const declMatch = stmt.match(/^(?:const|let|var)\s+(.+?)\s*=\s*require/);
    if (declMatch) {
      const decl = declMatch[1].trim();
      if (decl.startsWith("{")) {
        const inner = decl.slice(1, decl.lastIndexOf("}"));
        if (inner) {
          const items = inner.split(",");
          for (const item of items) {
            const iTrimmed = item.trim();
            const asMatch = iTrimmed.match(/^(\w[\w$]*)(?:\s*:\s*(\w[\w$]*))?$/);
            if (asMatch) {
              named.push({
                name: asMatch[1],
                alias: asMatch[2] || null,
              });
            }
          }
        }
      } else {
        defaultName = decl.split(/\s/)[0].trim();
      }
    }

    return {
      import: {
        type: "cjs",
        source,
        default: defaultName,
        namespace: null,
        named,
        isType: false,
        startLine: startLine + 1,
        endLine: i,
        raw: stmt.trim(),
      },
      nextLine: i,
    };
  }

  /**
   * Scan a dynamic import() call.
   */
  _scanDynamicImportLine(lines, startLine) {
    const line = lines[startLine];
    const match = line.match(/import\s*\(\s*(['"])([^'"]+)\1\s*\)/);
    if (!match) return null;

    const source = match[2];
    let defaultName = null;

    // Check if assigned to a variable: const X = await import(...) or const X = import(...)
    const assignMatch = line.match(/(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:await\s+)?import\s*\(/);
    if (assignMatch) {
      defaultName = assignMatch[1];
    }

    return {
      import: {
        type: "dynamic",
        source,
        default: defaultName,
        namespace: null,
        named: [],
        isType: false,
        startLine: startLine + 1,
        endLine: startLine + 1,
        raw: line.trim(),
      },
      nextLine: startLine + 1,
    };
  }

  /**
   * Build an import statement string from specifier description.
   */
  _buildImportStatement(module, specifier, sourceKind) {
    const typePrefix = sourceKind === "type" ? "type " : "";

    if (!specifier) {
      return `import ${typePrefix}'${module}';`;
    }

    if (typeof specifier === "string") {
      if (specifier.startsWith("{")) {
        return `import ${typePrefix}${specifier} from '${module}';`;
      }
      if (specifier.startsWith("*")) {
        return `import ${typePrefix}${specifier} from '${module}';`;
      }
      return `import ${typePrefix}${specifier} from '${module}';`;
    }

    if (typeof specifier === "object") {
      const parts = [];
      if (specifier.default) parts.push(specifier.default);
      if (specifier.named) {
        const names = Array.isArray(specifier.named) ? specifier.named : [specifier.named];
        parts.push("{ " + names.join(", ") + " }");
      }
      if (specifier.namespace) parts.push("* as " + specifier.namespace);
      if (parts.length === 0) {
        return `import ${typePrefix}'${module}';`;
      }
      return `import ${typePrefix}${parts.join(", ")} from '${module}';`;
    }

    return `import ${typePrefix}'${module}';`;
  }

  /**
   * Merge a new named import into an existing import statement.
   */
  _mergeIntoExistingImport(content, module, specifier, existing) {
    const names = this._parseNamedSpecifiers(specifier);
    const allNamed = [...existing.named];
    for (const n of names) {
      if (!allNamed.some((e) => e.name === n.name)) {
        allNamed.push(n);
      }
    }
    allNamed.sort((a, b) => a.name.localeCompare(b.name));

    // Rebuild the import statement.
    const parts = [];
    if (existing.default) parts.push(existing.default);
    if (allNamed.length > 0) {
      parts.push("{ " + allNamed.map((n) => n.alias ? n.name + " as " + n.alias : n.name).join(", ") + " }");
    }
    if (existing.namespace) parts.push("* as " + existing.namespace);

    const typePrefix = existing.isType ? "type " : "";
    const newStmt = `import ${typePrefix}${parts.join(", ")} from '${existing.source}';`;

    const lines = content.split("\n");
    const beforeLines = lines.slice(0, existing.startLine - 1);
    const afterLines = lines.slice(existing.endLine);

    return [...beforeLines, newStmt, ...afterLines].join("\n");
  }

  /**
   * Remove a specific named specifier from a multi-import statement.
   */
  _removeSpecifierFromImport(content, target, module) {
    const remainingNamed = target.named.filter(
      (n) => n.name !== module && n.alias !== module
    );

    if (remainingNamed.length === 0 && !target.default && !target.namespace) {
      // Remove the entire import line.
      return this.removeImport(content, target.source);
    }

    const parts = [];
    if (target.default) parts.push(target.default);
    if (remainingNamed.length > 0) {
      parts.push("{ " + remainingNamed.map((n) => n.alias ? n.name + " as " + n.alias : n.name).join(", ") + " }");
    }
    if (target.namespace) parts.push("* as " + target.namespace);

    const typePrefix = target.isType ? "type " : "";
    const newStmt = `import ${typePrefix}${parts.join(", ")} from '${target.source}';`;

    const lines = content.split("\n");
    const beforeLines = lines.slice(0, target.startLine - 1);
    const afterLines = lines.slice(target.endLine);

    return [...beforeLines, newStmt, ...afterLines].join("\n");
  }

  /**
   * Parse named specifiers from a "{ a, b, c as d }" string.
   */
  _parseNamedSpecifiers(specifier) {
    const inner = specifier.replace(/^\{|\}$/g, "").trim();
    if (!inner) return [];
    return inner.split(",").map((item) => {
      const trimmed = item.trim();
      const asMatch = trimmed.match(/^(\w[\w$]*)(?:\s+as\s+(\w[\w$]*))?$/);
      return { name: asMatch ? asMatch[1] : trimmed, alias: asMatch ? (asMatch[2] || null) : null };
    });
  }

  /**
   * Categorize imports for sorting.
   */
  _categorizeImports(imports) {
    const cats = { builtin: [], external: [], internal: [], relative: [] };

    for (const imp of imports) {
      if (this._isBuiltin(imp.source)) {
        cats.builtin.push(imp);
      } else if (imp.source.startsWith("./") || imp.source.startsWith("../")) {
        cats.relative.push(imp);
      } else if (imp.source.startsWith("@/") || imp.source.startsWith("~/") || imp.source.startsWith("#/")) {
        cats.internal.push(imp);
      } else {
        cats.external.push(imp);
      }
    }

    return cats;
  }

  /**
   * Check if a module path is a Node.js builtin.
   */
  _isBuiltin(source) {
    if (source.startsWith("node:")) return true;
    return NODE_BUILTINS.has(source);
  }

  /**
   * Replace the import block in content with sorted/merged statements.
   * Preserves blank lines between import groups.
   */
  _replaceImportBlock(content, originalImports, newStatements) {
    if (originalImports.length === 0) return content;

    const lines = content.split("\n");
    const firstLine = originalImports[0].startLine - 1;
    const lastLine = originalImports[originalImports.length - 1].endLine;

    const before = lines.slice(0, firstLine);
    const after = lines.slice(lastLine);

    // Trim excess blank lines around the import block.
    while (before.length > 0 && before[before.length - 1].trim() === "") {
      before.pop();
    }
    while (after.length > 0 && after[0].trim() === "") {
      after.shift();
    }

    const result = [...before];

    // Group new statements into categories and add blank lines between groups.
    const categorized = {};
    for (const stmt of newStatements) {
      const source = this._extractSourceFromStmt(stmt);
      const cat = this._categorizeSource(source);
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push(stmt);
    }

    const catOrder = ["builtin", "external", "internal", "relative"];
    let firstCat = true;
    for (const cat of catOrder) {
      if (!categorized[cat] || categorized[cat].length === 0) continue;
      if (!firstCat && result.length > 0) {
        result.push("");
      }
      result.push(...categorized[cat]);
      firstCat = false;
    }

    result.push(...after);

    return result.join("\n");
  }

  /**
   * Extract source path from an import statement string.
   */
  _extractSourceFromStmt(stmt) {
    const match = stmt.match(/from\s+['"]([^'"]+)['"]/) || stmt.match(/import\s+(?:type\s+)?['"]([^'"]+)['"]/) ||
      stmt.match(/(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    return match ? match[1] : "";
  }

  /**
   * Categorize a source path.
   */
  _categorizeSource(source) {
    if (this._isBuiltin(source)) return "builtin";
    if (source.startsWith("./") || source.startsWith("../")) return "relative";
    if (source.startsWith("@/") || source.startsWith("~/") || source.startsWith("#/")) return "internal";
    return "external";
  }
}

/**
 * @typedef {Object} ImportInfo
 * @property {'es'|'cjs'|'dynamic'|'side-effect'} type - import style
 * @property {string} source - module source path
 * @property {string|null} default - default import name
 * @property {string|null} namespace - namespace import name
 * @property {Array<{name: string, alias: string|null}>} named - named imports
 * @property {boolean} isType - whether it's a TS type import
 * @property {number} startLine - 1-based start line
 * @property {number} endLine - 1-based end line
 * @property {string} raw - raw import statement text
 */

module.exports = { ImportManager };
