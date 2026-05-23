"use strict";

/**
 * Post-export processing utilities for HaxAgent session exports.
 *
 *   - anonymize       — strip PII (emails, phone numbers, SSN, API keys, IPs, credit cards)
 *   - beautify        — pretty-print output for the given format
 *   - validate        — check export integrity per format
 *   - compress        — reduce size via whitespace stripping and deduplication
 *   - split           — partition large exports into size-capped chunks
 *   - merge           — combine multiple export payloads into one
 */

// ── PII patterns (shared with pipeline builtins) ───────────────────────────

// NOTE: Order matters — more specific patterns must precede broader ones
// to avoid partial matches consuming tokens before specific patterns fire.
// E.g. phone regex can match digit substrings inside API keys / credit-card
// numbers, so it must run last.
const PII_PATTERNS = Object.freeze([
  // Connection strings (very specific protocol prefixes)
  { pattern: /\b(mongodb|postgres|mysql|redis|sqlite):\/\/[^\s"'<>]+/gi, replacement: "[CONNECTION_STRING]" },
  // API key patterns (specific well-known prefixes)
  { pattern: /\b(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,})\b/g, replacement: "[API_KEY]" },
  // JWT tokens (specific structural signature)
  { pattern: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, replacement: "[JWT]" },
  // AWS access keys
  { pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[AWS_KEY]" },
  // Credit card numbers (Visa, MC, Amex, Discover — structured digit patterns)
  { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, replacement: "[CREDIT_CARD]" },
  // SSN (specific xxx-xx-xxxx structure with dashes)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // Email (specific @-sign pattern)
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // US phone (broad digit pattern — must run after credit cards / API keys)
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: "[PHONE]" },
  // IP addresses (IPv4)
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP]" },
  // Generic hex-encoded secrets (long hex strings that look like secrets)
  { pattern: /\b[A-Fa-f0-9]{64,}\b/g, replacement: "[HEX_SECRET]" },
]);

// ── PostProcessor ──────────────────────────────────────────────────────────

class PostProcessor {
  /**
   * @param {object} [options]
   * @param {Array<{pattern:RegExp, replacement:string}>} [options.piiPatterns]
   *   Override default PII detection patterns.
   * @param {number} [options.maxSplitSize=100000]  Default max bytes per chunk.
   */
  constructor(options = {}) {
    this._options = Object.freeze({
      maxSplitSize: 100000,
      ...options,
    });
  }

  // ── anonymize ──────────────────────────────────────────────────────────

  /**
   * Remove personally identifiable information from export content.
   *
   * @param {string} content  The export payload.
   * @param {object} [options]
   * @param {Array<{pattern:RegExp, replacement:string}>} [options.patterns]
   *   Custom PII patterns. Defaults to PII_PATTERNS when not provided.
   * @param {boolean} [options.preserveLength=false]
   *   If true, replace each character with '*' instead of a label.
   * @returns {string} Anonymized content.
   */
  anonymize(content, options = {}) {
    if (typeof content !== "string") return "";
    const patterns = options.patterns || this._options.piiPatterns || PII_PATTERNS;
    const preserveLength = options.preserveLength === true;

    let result = content;
    for (const { pattern, replacement } of patterns) {
      if (preserveLength) {
        result = result.replace(pattern, (match) => "*".repeat(match.length));
      } else {
        result = result.replace(pattern, replacement);
      }
    }

    // Additional: collapse multiple anonymized markers of the same type
    // e.g. "[EMAIL] [EMAIL]" -> "[EMAIL] [EMAIL]" stays (they might differ)
    return result;
  }

  // ── beautify ───────────────────────────────────────────────────────────

  /**
   * Prettify export output based on format.
   *
   * @param {string} content               Raw export content.
   * @param {"html"|"json"|"markdown"|"text"|"xml"|"ipynb"} format
   * @param {object} [options]
   * @param {number} [options.indent=2]  Indent spaces for JSON/XML.
   * @returns {string} Beautified content.
   */
  beautify(content, format, options = {}) {
    if (typeof content !== "string") return "";
    const indent = options.indent != null ? options.indent : 2;

    switch ((format || "").toLowerCase()) {
      case "json": {
        try {
          const parsed = JSON.parse(content);
          return JSON.stringify(parsed, null, indent);
        } catch {
          return content;
        }
      }

      case "html":
        return _beautifyHtml(content, indent);

      case "xml":
        return _beautifyXml(content, indent);

      case "markdown":
        return _beautifyMarkdown(content);

      case "ipynb": {
        try {
          const parsed = JSON.parse(content);
          return JSON.stringify(parsed, null, indent);
        } catch {
          return content;
        }
      }

      case "text":
      default:
        // For plain text, normalize line endings and trim trailing whitespace
        return content
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((line) => line.trimEnd())
          .join("\n")
          .trim();
    }
  }

  // ── validate ───────────────────────────────────────────────────────────

  /**
   * Validate export content integrity for the given format.
   *
   * @param {string} content  The export payload.
   * @param {"html"|"json"|"markdown"|"text"|"ipynb"} format
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validate(content, format) {
    const errors = [];
    const warnings = [];

    if (typeof content !== "string" || content.length === 0) {
      errors.push("Content is empty or not a string");
      return { valid: false, errors, warnings };
    }

    switch ((format || "").toLowerCase()) {
      case "json":
        _validateJson(content, errors, warnings);
        break;

      case "html":
        _validateHtml(content, errors, warnings);
        break;

      case "markdown":
        _validateMarkdown(content, errors, warnings);
        break;

      case "ipynb":
        _validateIpynb(content, errors, warnings);
        break;

      case "text":
      default:
        _validateText(content, errors, warnings);
        break;
    }

    // Always check: does the content look truncated?
    _validateTruncation(content, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ── compress ───────────────────────────────────────────────────────────

  /**
   * Compress export content by stripping redundant whitespace.
   *
   * @param {string} content  The export payload.
   * @param {object} [options]
   * @param {"safe"|"aggressive"} [options.mode="safe"]
   *   safe:     maintain readability, just trim blank lines / trailing ws
   *   aggressive: collapse all whitespace, remove comments
   * @returns {string} Compressed content.
   */
  compress(content, options = {}) {
    if (typeof content !== "string") return "";
    const mode = options.mode || "safe";

    if (mode === "aggressive") {
      // Remove HTML comments
      let result = content.replace(/<!--[\s\S]*?-->/g, "");
      // Remove JS/CSS comments
      result = result.replace(/\/\*[\s\S]*?\*\//g, "");
      // Collapse all whitespace
      result = result.replace(/\s+/g, " ").trim();
      return result;
    }

    // Safe mode
    return content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ── split ──────────────────────────────────────────────────────────────

  /**
   * Split large export content into size-capped chunks.
   *
   * Splitting tries to break at natural boundaries:
   *   - message-level for JSON exports
   *   - paragraph-level for text/markdown
   *   - line-level fallback
   *
   * @param {string} content   The export payload.
   * @param {number} [maxSize] Max bytes per chunk (default from constructor).
   * @param {object} [options]
   * @param {"json"|"text"|"html"|"markdown"} [options.format="text"]
   *   Format hint for smarter splitting.
   * @returns {string[]} Array of chunk strings.
   */
  split(content, maxSize, options = {}) {
    if (typeof content !== "string") return [];
    const max = typeof maxSize === "number" && maxSize > 0
      ? maxSize
      : (this._options.maxSplitSize || 100000);
    const format = (options.format || "text").toLowerCase();

    // If content fits in one chunk, return as-is
    if (Buffer.byteLength(content, "utf8") <= max) {
      return [content];
    }

    // Determine split strategy
    const chunks = [];
    const encoder = new TextEncoder();

    if (format === "json") {
      return this._splitJson(content, max, encoder);
    }

    if (format === "markdown" || format === "text") {
      return this._splitByParagraph(content, max, encoder);
    }

    if (format === "html") {
      return this._splitHtml(content, max, encoder);
    }

    // Generic: split by lines
    return this._splitByLines(content, max, encoder);
  }

  /**
   * Split JSON content by its top-level message entries.
   */
  _splitJson(content, maxSize, encoder) {
    try {
      const obj = JSON.parse(content);
      const messages = obj.messages || obj.entries || obj.cells || [];
      if (!Array.isArray(messages) || messages.length <= 1) {
        return this._splitByLines(content, maxSize, encoder);
      }

      const chunks = [];
      let currentMsgs = [];
      let currentStr = "";
      let headerSize = 0;

      // Determine header (everything except the messages array)
      for (const key of Object.keys(obj)) {
        if (key === "messages" || key === "entries" || key === "cells") continue;
        headerSize += encoder.encode(JSON.stringify({ [key]: obj[key] })).length;
      }

      for (let i = 0; i < messages.length; i++) {
        const msgStr = "," + (currentMsgs.length === 0 ? "" : ",") + JSON.stringify(messages[i]);
        const testStr = this._rebuildJson(obj, [...currentMsgs, messages[i]], encoder);
        if (encoder.encode(testStr).length > maxSize && currentMsgs.length > 0) {
          chunks.push(this._rebuildJson(obj, currentMsgs, encoder));
          currentMsgs = [messages[i]];
        } else {
          currentMsgs.push(messages[i]);
        }
      }

      if (currentMsgs.length > 0) {
        chunks.push(this._rebuildJson(obj, currentMsgs, encoder));
      }

      return chunks.length > 0 ? chunks : [content];
    } catch {
      return this._splitByLines(content, maxSize, encoder);
    }
  }

  _rebuildJson(original, messages, encoder) {
    const result = {};
    let msgKey = "messages";
    for (const key of Object.keys(original)) {
      if (key === "messages" || key === "entries" || key === "cells") {
        msgKey = key;
      } else {
        result[key] = original[key];
      }
    }
    result[msgKey] = messages;
    result._chunked = true;
    result._chunkSize = messages.length;
    return JSON.stringify(result, null, 2);
  }

  /**
   * Split by paragraph (double-newline boundaries).
   */
  _splitByParagraph(content, maxSize, encoder) {
    const paragraphs = content.split(/\n\n+/);
    const chunks = [];
    let current = "";

    for (const p of paragraphs) {
      const test = current ? current + "\n\n" + p : p;
      if (encoder.encode(test).length > maxSize && current) {
        chunks.push(current);
        current = p;
      } else {
        current = test;
      }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [content];
  }

  /**
   * Split HTML by top-level message divs.
   */
  _splitHtml(content, maxSize, encoder) {
    // Try splitting on message boundaries
    const messageParts = content.split(/(<div class="message\b)/);
    if (messageParts.length <= 2) {
      return this._splitByLines(content, maxSize, encoder);
    }

    const segments = [];
    for (let i = 1; i < messageParts.length; i += 2) {
      segments.push(messageParts[i] + (messageParts[i + 1] || ""));
    }

    const preamble = messageParts[0] || "";
    const footer = _extractHtmlFooter(content);

    const chunks = [];
    let current = [];
    for (const seg of segments) {
      const testBody = current.join("") + seg;
      const testDoc = preamble + testBody + footer;
      if (encoder.encode(testDoc).length > maxSize && current.length > 0) {
        chunks.push(preamble + current.join("") + footer);
        current = [seg];
      } else {
        current.push(seg);
      }
    }

    if (current.length > 0) {
      chunks.push(preamble + current.join("") + footer);
    }

    return chunks.length > 0 ? chunks : [content];
  }

  /**
   * Fallback: split by lines.
   */
  _splitByLines(content, maxSize, encoder) {
    const lines = content.split("\n");
    const chunks = [];
    let current = "";

    for (const line of lines) {
      const test = current ? current + "\n" + line : line;
      if (encoder.encode(test).length > maxSize && current) {
        chunks.push(current);
        current = line;
      } else {
        current = test;
      }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [content];
  }

  // ── merge ──────────────────────────────────────────────────────────────

  /**
   * Merge multiple export payloads into one consolidated export.
   *
   * @param {Array<string|object>} exports  Array of export strings or objects.
   * @param {object} [options]
   * @param {"json"|"text"|"markdown"|"html"} [options.format="text"]
   * @param {string} [options.separator="\\n---\\n"]
   *   Separator used between merged text/markdown exports.
   * @param {string} [options.title="Merged HaxAgent Export"]
   *   Title for the merged output.
   * @returns {string} Merged export content.
   */
  merge(exports, options = {}) {
    if (!Array.isArray(exports) || exports.length === 0) return "";
    if (exports.length === 1 && typeof exports[0] === "string") return exports[0];

    const format = (options.format || "text").toLowerCase();
    const separator = options.separator || "\n---\n";
    const title = options.title || "Merged HaxAgent Export";
    const now = new Date().toISOString();

    switch (format) {
      case "json":
        return this._mergeJson(exports, title, now);

      case "html":
        return this._mergeHtml(exports, title, now);

      case "markdown":
        return this._mergeText(exports, title, now, separator, true);

      case "text":
      default:
        return this._mergeText(exports, title, now, separator, false);
    }
  }

  _mergeJson(exports, title, now) {
    const allMessages = [];

    for (const exp of exports) {
      let obj = exp;
      if (typeof obj === "string") {
        try {
          obj = JSON.parse(obj);
        } catch {
          continue;
        }
      }
      const msgs = obj.messages || obj.entries || obj.cells || [];
      if (Array.isArray(msgs)) {
        allMessages.push(...msgs);
      }
    }

    return JSON.stringify(
      {
        mergedAt: now,
        title,
        sourceCount: exports.length,
        totalMessages: allMessages.length,
        messages: allMessages,
      },
      null,
      2
    );
  }

  _mergeHtml(exports, title, now) {
    const parts = [];

    for (const exp of exports) {
      const str = typeof exp === "object" ? JSON.stringify(exp) : String(exp);
      // Extract body content between <body> and </body>
      const bodyMatch = str.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) {
        parts.push(bodyMatch[1]);
      } else {
        parts.push(str);
      }
    }

    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="UTF-8">',
      "<title>" + _escapeHtml(title) + "</title>",
      "</head>",
      "<body>",
      "<h1>" + _escapeHtml(title) + "</h1>",
      "<p>Merged " + exports.length + " exports at " + _escapeHtml(now) + "</p>",
      ...parts,
      "</body>",
      "</html>",
    ].join("\n");
  }

  _mergeText(exports, title, now, separator, _isMd) {
    const parts = [title + "\n", "_Merged " + exports.length + " exports at " + now + "_\n"];

    for (let i = 0; i < exports.length; i++) {
      const str = typeof exports[i] === "object" ? JSON.stringify(exports[i]) : String(exports[i]);
      parts.push("\n## Export " + (i + 1) + "\n");
      parts.push(str);
      parts.push(separator);
    }

    return parts.join("\n");
  }
}

// ── internal beautify helpers ──────────────────────────────────────────────

function _beautifyHtml(content, indent) {
  // Simple formatter: add newlines around block-level tags
  const blockTags = [
    "div", "section", "article", "header", "footer", "main", "nav",
    "table", "tr", "thead", "tbody", "tfoot", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "blockquote",
    "form", "fieldset", "style", "script", "body", "head",
  ];

  let result = content;
  for (const tag of blockTags) {
    result = result.replace(new RegExp("<" + tag + "([\\s>])", "gi"), "\n<$1" + "$1");
    result = result.replace(new RegExp("</" + tag + ">", "gi"), "</$1>\n");
  }
  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  // Basic indentation
  const lines = result.split("\n");
  const out = [];
  let depth = 0;
  const sp = " ".repeat(indent);
  const selfCloseRe = /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)[^>]*\/?>/i;

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      out.push("");
      continue;
    }

    // Closing tag decreases depth before rendering
    const isClosing = /^<\/\w/.test(line);
    const isSelfClosing = selfCloseRe.test(line);
    if (isClosing && depth > 0) depth--;

    out.push(sp.repeat(depth) + line);

    // Opening tag (not self-closing, not single-line) increases depth after
    if (!isClosing && !isSelfClosing && /^<\w+[^>]*[^/]>$/.test(line)) {
      depth++;
    }
  }

  return out.join("\n");
}

function _beautifyXml(content, indent) {
  const sp = " ".repeat(indent);
  // Insert newlines between tags
  let result = content
    .replace(/>\s*</g, ">\n<")
    .trim();

  const lines = result.split("\n");
  const out = [];
  let depth = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const isClosing = /^<\//.test(line);
    const isSelfClosing = /\/>$/.test(line) || /^\?xml/.test(line) || /^<!/.test(line);

    if (isClosing && depth > 0) depth--;

    out.push(sp.repeat(depth) + line);

    if (!isClosing && !isSelfClosing && /^<[^?!/]/.test(line)) {
      depth++;
    }
  }

  return out.join("\n");
}

function _beautifyMarkdown(content) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Ensure blank line before headings
    .replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2")
    // Ensure blank line around fenced code blocks
    .replace(/([^\n])\n```/g, "$1\n\n```")
    .replace(/```\n([^\n`])/g, "```\n\n$1")
    // Trim trailing whitespace
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

// ── internal validate helpers ──────────────────────────────────────────────

function _validateJson(content, errors, warnings) {
  try {
    JSON.parse(content);
  } catch (e) {
    errors.push("Invalid JSON: " + e.message);
    return;
  }

  // Check for common issues
  if (content.length > 50 * 1024 * 1024) {
    warnings.push("JSON content is very large (>" + Math.round(content.length / 1024 / 1024) + "MB)");
  }

  // Check for balanced braces/brackets
  let braces = 0, brackets = 0;
  let inString = false, escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
  }
  if (braces !== 0) warnings.push("Unbalanced braces in JSON");
  if (brackets !== 0) warnings.push("Unbalanced brackets in JSON");
}

function _validateHtml(content, errors, warnings) {
  const lower = content.toLowerCase();

  // Must have <html or <body or doctype
  if (!/<html|<body|<!doctype/i.test(lower)) {
    warnings.push("HTML content does not contain <html>, <body>, or DOCTYPE");
  }

  // Check for basic structural elements
  const openHtml = (lower.match(/<html/g) || []).length;
  const closeHtml = (lower.match(/<\/html>/g) || []).length;
  if (openHtml !== closeHtml) {
    warnings.push("Unmatched <html> tags: " + openHtml + " open, " + closeHtml + " close");
  }

  // Check for common issues
  if (/<script[^>]*src\s*=\s*["'][^"']*["'][^>]*>/.test(content)) {
    warnings.push("HTML contains external script references");
  }

  // Detect if content appears truncated (no closing html tag)
  if (!/<\/html>/i.test(content)) {
    warnings.push("HTML content appears truncated (no </html>)");
  }
}

function _validateMarkdown(content, errors, warnings) {
  if (content.length < 3) {
    warnings.push("Markdown content is very short");
  }

  // Check fenced code block balance
  const fences = content.match(/```/g);
  if (fences && fences.length % 2 !== 0) {
    warnings.push("Unbalanced fenced code blocks (odd number of ``` markers)");
  }

  // Check for broken links [text](url without closing paren
  const links = content.match(/\[[^\]]+\]\([^)]*$/gm);
  if (links) {
    warnings.push("Possible broken links (unclosed URL parens)");
  }
}

function _validateIpynb(content, errors, warnings) {
  try {
    const obj = JSON.parse(content);
    if (!obj.nbformat && obj.nbformat !== 0) {
      warnings.push("Missing nbformat field");
    }
    if (!Array.isArray(obj.cells)) {
      errors.push("Missing or invalid cells array");
    } else if (obj.cells.length === 0) {
      warnings.push("Notebook has no cells");
    }
    // Runtime metadata check
    const meta = obj.metadata;
    if (meta && meta.kernelspec) {
      if (typeof meta.kernelspec !== "object") {
        warnings.push("kernelspec metadata should be an object");
      }
    }
  } catch (e) {
    errors.push("Invalid notebook JSON: " + e.message);
  }
}

function _validateText(content, errors, warnings) {
  if (content.length < 2) {
    warnings.push("Text content is very short");
  }

  // Check for null bytes (often indicates corruption)
  if (content.includes("\0")) {
    errors.push("Content contains null bytes (possible corruption)");
  }

  // Check for excessive line length
  const lines = content.split("\n");
  const tooLong = lines.filter((l) => l.length > 10000);
  if (tooLong.length > 0) {
    warnings.push(tooLong.length + " line(s) exceed 10,000 characters");
  }
}

function _validateTruncation(content, errors, warnings) {
  // Common truncation patterns
  if (/(\.\.\.|…)\s*$/.test(content.trim())) {
    warnings.push("Content appears truncated (trailing ellipsis)");
  }
  if (/\[content truncated\]/i.test(content)) {
    errors.push("Content contains explicit truncation marker");
  }
}

function _extractHtmlFooter(content) {
  const bodyClose = content.lastIndexOf("</body>");
  const htmlClose = content.lastIndexOf("</html>");
  if (htmlClose > 0) {
    return content.slice(bodyClose > 0 ? bodyClose : htmlClose);
  }
  if (bodyClose > 0) {
    return content.slice(bodyClose);
  }
  return "";
}

function _escapeHtml(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── exports ────────────────────────────────────────────────────────────────

module.exports = {
  PostProcessor,
  PII_PATTERNS,
};
