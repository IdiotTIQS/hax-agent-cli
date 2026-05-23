"use strict";

/**
 * Template syntax:
 *   {{variable}}          — inline variable substitution
 *   {{#if variable}}      — conditional block start
 *   {{/if}}               — conditional block end
 *   {{#each items}}       — iteration block start
 *   {{/each}}             — iteration block end
 */

// ---------------------------------------------------------------------------
// TemplateEngine
// ---------------------------------------------------------------------------

class TemplateEngine {
  constructor() {
    /** @private Cache for compiled templates keyed by template string. */
    this._cache = new Map();
    /** @private Maximum number of cached templates. */
    this._maxCacheSize = 256;
  }

  // -----------------------------------------------------------------------
  // compile(template, variables)
  // -----------------------------------------------------------------------

  /**
   * Fill a template string with the provided variables.
   *
   * Supports:
   *   - `{{name}}` for simple substitution
   *   - `{{#if name}}...{{/if}}` for conditional blocks
   *   - `{{#each items}}...{{/each}}` for iteration
   *
   * @param {string} template
   * @param {object} variables
   * @param {object} [options]
   * @param {boolean} [options.noCache=false] — skip the compiled-template cache
   * @returns {string} Rendered template.
   */
  compile(template, variables = {}, options = {}) {
    const tpl = String(template ?? "");
    const vars = variables && typeof variables === "object" ? variables : {};

    if (!tpl) return "";

    const compiled = options.noCache
      ? this._compileTemplate(tpl)
      : this._getOrCompile(tpl);

    return this._render(compiled, vars);
  }

  // -----------------------------------------------------------------------
  // optimizeTemplate(template)
  // -----------------------------------------------------------------------

  /**
   * Optimize a template by removing unreachable or empty blocks and
   * simplifying trivial conditionals.
   *
   * This is a static optimization — it analyses the template structure
   * without variable values.  Useful for cleaning up generated templates.
   *
   * @param {string} template
   * @returns {string} Optimized template.
   */
  optimizeTemplate(template) {
    let tpl = String(template ?? "");

    // Remove empty conditional blocks (nothing between #if and /if).
    tpl = tpl.replace(/\{\{#if\s+\w+\}\}\s*\{\{\/if\}\}/g, "");

    // Remove empty each blocks.
    tpl = tpl.replace(/\{\{#each\s+\w+\}\}\s*\{\{\/each\}\}/g, "");

    // Collapse consecutive blank lines.
    tpl = tpl.replace(/\n{3,}/g, "\n\n");

    // Remove trailing whitespace on lines.
    tpl = tpl.replace(/[ \t]+$/gm, "");

    // Remove leading blank lines.
    tpl = tpl.replace(/^\n+/, "");

    // Remove trailing blank lines.
    tpl = tpl.replace(/\n+$/, "");

    return tpl;
  }

  // -----------------------------------------------------------------------
  // extractVariables(template)
  // -----------------------------------------------------------------------

  /**
   * Extract all variable references from a template.
   *
   * @param {string} template
   * @returns {string[]} Unique sorted list of variable names.
   */
  extractVariables(template) {
    const tpl = String(template ?? "");
    const vars = new Set();

    // Match {{variable}} — simple substitutions
    const simpleRegex = /\{\{(?!\s*[#/])(.+?)\}\}/g;
    let match;
    while ((match = simpleRegex.exec(tpl)) !== null) {
      const name = match[1].trim();
      if (name) vars.add(name);
    }

    // Match {{#if variable}} — condition conditions
    const ifRegex = /\{\{#if\s+(\w+)\}\}/g;
    while ((match = ifRegex.exec(tpl)) !== null) {
      vars.add(match[1].trim());
    }

    // Match {{#each items}} — iteration targets
    const eachRegex = /\{\{#each\s+(\w+)\}\}/g;
    while ((match = eachRegex.exec(tpl)) !== null) {
      vars.add(match[1].trim());
    }

    return [...vars].sort();
  }

  // -----------------------------------------------------------------------
  // validateTemplate(template)
  // -----------------------------------------------------------------------

  /**
   * Validate a template for structural errors: mismatched blocks, broken
   * references, unclosed conditionals.
   *
   * @param {string} template
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateTemplate(template) {
    const tpl = String(template ?? "");
    const errors = [];

    // Check block nesting.
    const stack = [];
    const blockRegex = /\{\{(#if\s+\w+|#each\s+\w+|\/if|\/each)\}\}/g;
    let match;

    while ((match = blockRegex.exec(tpl)) !== null) {
      const token = match[1].trim();

      if (token.startsWith("#if")) {
        stack.push({ type: "if", pos: match.index });
      } else if (token.startsWith("#each")) {
        stack.push({ type: "each", pos: match.index });
      } else if (token === "/if") {
        if (stack.length === 0) {
          errors.push(`Unexpected {{/if}} at position ${match.index} — no matching opening block`);
        } else {
          const top = stack.pop();
          if (top.type !== "if") {
            errors.push(`Mismatched {{/if}} at position ${match.index} — expected {{/${top.type}}} from position ${top.pos}`);
          }
        }
      } else if (token === "/each") {
        if (stack.length === 0) {
          errors.push(`Unexpected {{/each}} at position ${match.index} — no matching opening block`);
        } else {
          const top = stack.pop();
          if (top.type !== "each") {
            errors.push(`Mismatched {{/each}} at position ${match.index} — expected {{/${top.type}}} from position ${top.pos}`);
          }
        }
      }
    }

    // Check for unclosed blocks.
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const item = stack[i];
      errors.push(`Unclosed {{#${item.type}}} at position ${item.pos}`);
    }

    // Check for broken variable references (unescaped braces or malformed tags).
    const openBraces = (tpl.match(/\{\{/g) || []).length;
    const closeBraces = (tpl.match(/\}\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push("Mismatched curly braces — possible unclosed variable reference");
    }

    // Check for empty variable names ({{}})
    if (/\{\{\s*\}\}/.test(tpl)) {
      errors.push("Empty variable reference found: {{}}");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // -----------------------------------------------------------------------
  // Cache management
  // -----------------------------------------------------------------------

  /**
   * Clear the compiled-template cache.
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * Return the current cache size.
   *
   * @returns {number}
   */
  getCacheSize() {
    return this._cache.size;
  }

  // -----------------------------------------------------------------------
  // Private: compilation
  // -----------------------------------------------------------------------

  /**
   * Compile a template into an AST-like array of instruction objects.
   *
   * @param {string} template
   * @returns {Array<object>} Compiled template.
   */
  _compileTemplate(template) {
    const instructions = [];
    let pos = 0;
    const len = template.length;

    while (pos < len) {
      const openIdx = template.indexOf("{{", pos);
      if (openIdx === -1) {
        // Remainder is literal text.
        instructions.push({ type: "text", value: template.slice(pos) });
        break;
      }

      const closeIdx = template.indexOf("}}", openIdx);
      if (closeIdx === -1) {
        // Unclosed tag — treat remainder as text.
        instructions.push({ type: "text", value: template.slice(pos) });
        break;
      }

      // Text before the tag
      if (openIdx > pos) {
        instructions.push({ type: "text", value: template.slice(pos, openIdx) });
      }

      const tagContent = template.slice(openIdx + 2, closeIdx).trim();

      if (tagContent.startsWith("#if ")) {
        const condition = tagContent.slice(4).trim();
        instructions.push({ type: "ifStart", condition });
      } else if (tagContent.startsWith("#each ")) {
        const collection = tagContent.slice(6).trim();
        instructions.push({ type: "eachStart", collection });
      } else if (tagContent === "/if") {
        instructions.push({ type: "ifEnd" });
      } else if (tagContent === "/each") {
        instructions.push({ type: "eachEnd" });
      } else {
        // Simple variable substitution
        instructions.push({ type: "var", name: tagContent });
      }

      pos = closeIdx + 2;
    }

    return instructions;
  }

  // -----------------------------------------------------------------------
  // Private: rendering
  // -----------------------------------------------------------------------

  _render(instructions, variables) {
    let output = "";
    let pos = 0;

    while (pos < instructions.length) {
      const instr = instructions[pos];

      if (instr.type === "text") {
        output += instr.value;
        pos += 1;
      } else if (instr.type === "var") {
        output += this._resolve(instr.name, variables);
        pos += 1;
      } else if (instr.type === "ifStart") {
        const result = this._renderIf(instructions, pos, variables);
        output += result.output;
        pos = result.nextPos;
      } else if (instr.type === "eachStart") {
        const result = this._renderEach(instructions, pos, variables);
        output += result.output;
        pos = result.nextPos;
      } else {
        // Closing tags that appear at top level are ignored (handled by
        // renderIf / renderEach internally).
        pos += 1;
      }
    }

    return output;
  }

  _renderIf(instructions, startPos, variables) {
    // startPos points to an ifStart instruction.
    const instr = instructions[startPos];
    const conditionValue = this._resolve(instr.condition, variables);
    const isTruthy = this._isTruthy(conditionValue);

    let pos = startPos + 1;
    let output = "";

    // Collect instructions within this if block.
    while (pos < instructions.length) {
      const current = instructions[pos];

      if (current.type === "ifEnd") {
        pos += 1;
        break;
      }

      if (current.type === "ifStart") {
        const nested = this._renderIf(instructions, pos, variables);
        // In the if-context, nested blocks render into this block.
        if (isTruthy) output += nested.output;
        pos = nested.nextPos;
        continue;
      }

      if (current.type === "eachStart") {
        const nested = this._renderEach(instructions, pos, variables);
        if (isTruthy) output += nested.output;
        pos = nested.nextPos;
        continue;
      }

      if (isTruthy) {
        if (current.type === "text") output += current.value;
        else if (current.type === "var") output += this._resolve(current.name, variables);
      }

      pos += 1;
    }

    return { output, nextPos: pos };
  }

  _renderEach(instructions, startPos, variables) {
    const instr = instructions[startPos];
    const collection = variables[instr.collection];

    if (!Array.isArray(collection) || collection.length === 0) {
      // Skip to matching /each
      let pos = startPos + 1;
      let depth = 0;
      while (pos < instructions.length) {
        const current = instructions[pos];
        if (current.type === "eachStart") {
          depth += 1;
        } else if (current.type === "eachEnd") {
          if (depth === 0) {
            pos += 1;
            break;
          }
          depth -= 1;
        }
        pos += 1;
      }
      return { output: "", nextPos: pos };
    }

    let pos = startPos + 1;
    const innerStart = pos;

    // Find the end of this each block.
    let innerEnd = innerStart;
    let depth = 0;
    while (innerEnd < instructions.length) {
      const current = instructions[innerEnd];
      if (current.type === "eachStart") {
        depth += 1;
      } else if (current.type === "eachEnd") {
        if (depth === 0) break;
        depth -= 1;
      }
      innerEnd += 1;
    }

    const innerInstructions = instructions.slice(innerStart, innerEnd);
    const nextPos = innerEnd + 1; // skip /each

    let output = "";
    for (const item of collection) {
      // Merge item properties into variables (item takes precedence).
      const itemVars = item && typeof item === "object"
        ? { ...variables, ...item }
        : { ...variables, item };

      const innerResult = this._render(innerInstructions, itemVars);
      output += innerResult;
    }

    return { output, nextPos };
  }

  // -----------------------------------------------------------------------
  // Private: variable resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a dot-separated variable path against the variables object.
   * e.g. "user.name" -> variables.user.name
   *
   * @param {string} path
   * @param {object} variables
   * @returns {string}
   */
  _resolve(path, variables) {
    if (!path || !variables) return "";

    const parts = path.split(".");
    let current = variables;

    for (const part of parts) {
      if (current === null || current === undefined) return "";
      if (typeof current !== "object") return "";
      current = current[part];
    }

    if (current === null || current === undefined) return "";
    // Preserve the raw value for boolean/number checks in conditionals.
    return current;
  }

  /**
   * Determine if a resolved value is "truthy" in template context.
   *
   * @param {*} value
   * @returns {boolean}
   */
  _isTruthy(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  // -----------------------------------------------------------------------
  // Private: cache
  // -----------------------------------------------------------------------

  _getOrCompile(template) {
    if (this._cache.has(template)) {
      return this._cache.get(template);
    }

    const compiled = this._compileTemplate(template);

    // Evict oldest entry if cache is full.
    if (this._cache.size >= this._maxCacheSize) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) {
        this._cache.delete(firstKey);
      }
    }

    this._cache.set(template, compiled);
    return compiled;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  TemplateEngine,
};
