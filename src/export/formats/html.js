"use strict";

/**
 * HTML export formats for HaxAgent sessions.
 *
 * Provides three HTML output modes:
 *   - Full page         (exportAsHtml)
 *   - Fragment          (exportAsHtmlFragment, for embedding)
 *   - Interactive page  (exportAsInteractiveHtml, collapsible + searchable)
 *
 * All styling is inline (no external dependencies).  The default theme is
 * dark, responsive, and print-friendly.
 */

// ── helpers ──────────────────────────────────────────────────────────────

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    result += ESCAPE_MAP[ch] || ch;
  }
  return result;
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function toRoleLabel(role) {
  switch ((role || "").toLowerCase()) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    default:
      return role || "Unknown";
  }
}

function toRoleCssClass(role) {
  switch ((role || "").toLowerCase()) {
    case "user":
      return "msg-user";
    case "assistant":
      return "msg-assistant";
    case "tool":
      return "msg-tool";
    default:
      return "msg-unknown";
  }
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ── lightweight syntax highlighting for HTML ─────────────────────────────

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "of", "package",
  "private", "protected", "public", "return", "super", "switch", "static",
  "this", "throw", "true", "try", "typeof", "var", "void", "while",
  "with", "yield",
]);

const JS_BUILTINS = new Set([
  "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math",
  "Number", "Object", "Promise", "RegExp", "Set", "String", "Symbol",
  "WeakMap", "WeakSet", "console", "process", "Buffer", "setTimeout",
  "setInterval", "clearTimeout", "clearInterval", "require", "module",
  "exports", "__dirname", "__filename",
]);

function highlightCodeToHtml(code, language) {
  if (typeof code !== "string" || code.length === 0) return escapeHtml(code);
  const lang = (language || "").toLowerCase();

  if (lang === "json" || (!lang && /^\s*[\[{]/.test(code.trim()) && /\s*[\]}]/.test(code.trim().split("\n").pop() || ""))) {
    return _highlightJsonHtml(code);
  }
  if (lang === "shell" || lang === "bash" || lang === "sh") {
    return _highlightShellHtml(code);
  }
  if (lang === "diff") {
    return _highlightDiffHtml(code);
  }
  // Default to JS/TS highlighting
  return _highlightJsHtml(code);
}

function _highlightJsHtml(code) {
  const len = code.length;
  let out = "";
  let i = 0;

  while (i < len) {
    const ch = code[i];

    // Single-line comment
    if (ch === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < len && code[i] !== "\n") i++;
      out += '<span class="hl-comment">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Block comment
    if (ch === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i < len) i += 2;
      out += '<span class="hl-comment">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Template literal
    if (ch === "`") {
      const start = i;
      i++;
      let depth = 0;
      while (i < len) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === "$" && code[i + 1] === "{") { depth++; i += 2; continue; }
        if (code[i] === "}" && depth > 0) { depth--; i++; continue; }
        if (code[i] === "`" && depth === 0) { i++; break; }
        i++;
      }
      out += '<span class="hl-string">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      while (i < len) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === ch) break;
        i++;
      }
      i = Math.min(i + 1, len);
      out += '<span class="hl-string">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Number
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < len && code[i + 1] >= "0" && code[i + 1] <= "9")) {
      const start = i;
      if (code[i] === "0" && (code[i + 1] === "x" || code[i + 1] === "X")) i += 2;
      else if (code[i] === "0" && (code[i + 1] === "b" || code[i + 1] === "B")) i += 2;
      else if (code[i] === "0" && (code[i + 1] === "o" || code[i + 1] === "O")) i += 2;
      while (i < len && /[0-9a-fA-F._]/.test(code[i])) i++;
      if (i < len && code[i] === "n") i++;
      out += '<span class="hl-number">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (JS_KEYWORDS.has(word)) {
        out += '<span class="hl-keyword">' + escapeHtml(word) + "</span>";
      } else if (JS_BUILTINS.has(word)) {
        out += '<span class="hl-builtin">' + escapeHtml(word) + "</span>";
      } else if (/^[A-Z]/.test(word) && word !== word.toUpperCase()) {
        out += '<span class="hl-type">' + escapeHtml(word) + "</span>";
      } else if (i < len && code[i] === "(") {
        out += '<span class="hl-function">' + escapeHtml(word) + "</span>";
      } else {
        out += escapeHtml(word);
      }
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }

  return out;
}

function _highlightJsonHtml(code) {
  let out = "";
  let i = 0;
  const len = code.length;

  while (i < len) {
    const ch = code[i];
    if (ch === '"') {
      const start = i;
      i++;
      while (i < len) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === '"') break;
        i++;
      }
      i = Math.min(i + 1, len);
      const isKey = _isJsonKey(code, start);
      const cls = isKey ? "hl-builtin" : "hl-string";
      out += '<span class="' + cls + '">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "-" && i + 1 < len && code[i + 1] >= "0" && code[i + 1] <= "9")) {
      const start = i;
      if (code[i] === "-") i++;
      while (i < len && /[0-9.eE+-]/.test(code[i])) i++;
      out += '<span class="hl-number">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }
    const remaining = code.slice(i);
    if (/^(true|false|null)/.test(remaining)) {
      const kw = remaining.match(/^(true|false|null)/)[0];
      out += '<span class="hl-keyword">' + kw + "</span>";
      i += kw.length;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

function _isJsonKey(src, pos) {
  for (let j = pos - 1; j >= 0; j--) {
    const c = src[j];
    if (c === "\n" || c === "\r" || c === " " || c === "\t") continue;
    return c === "," || c === "{" || c === "[";
  }
  return true;
}

function _highlightShellHtml(code) {
  let out = "";
  let i = 0;
  const len = code.length;

  while (i < len) {
    const ch = code[i];

    // Comment
    if (ch === "#") {
      const start = i;
      i++;
      while (i < len && code[i] !== "\n") i++;
      out += '<span class="hl-comment">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // String
    if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      while (i < len) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === ch) break;
        i++;
      }
      i = Math.min(i + 1, len);
      out += '<span class="hl-string">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Variable
    if (ch === "$" && i + 1 < len && /[a-zA-Z_{]/.test(code[i + 1])) {
      const start = i;
      i++;
      if (code[i] === "{") { while (i < len && code[i] !== "}") i++; i++; }
      else { while (i < len && /[a-zA-Z0-9_]/.test(code[i])) i++; }
      out += '<span class="hl-variable">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Flag
    if (ch === "-" && i + 1 < len && /[a-zA-Z-]/.test(code[i + 1])) {
      const start = i;
      i++;
      while (i < len && /[a-zA-Z0-9-]/.test(code[i])) i++;
      out += '<span class="hl-attribute">' + escapeHtml(code.slice(start, i)) + "</span>";
      continue;
    }

    // Pipe / redirect
    if (ch === "|" || ch === ">" || ch === "<") {
      let end = i + 1;
      if (end < len && (code[end] === ch || code[end] === "&")) end++;
      out += '<span class="hl-operator">' + escapeHtml(code.slice(i, end)) + "</span>";
      i = end;
      continue;
    }

    // Word
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < len && /[a-zA-Z0-9_-]/.test(code[i])) i++;
      const word = code.slice(start, i);
      const SHELL_KEYWORDS = new Set([
        "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
        "case", "esac", "in", "function", "return", "exit", "export", "local",
        "echo", "printf", "cd", "pwd", "ls", "cp", "mv", "rm", "mkdir",
        "git", "npm", "yarn", "node", "python", "pip", "docker", "kubectl",
        "curl", "wget", "ssh", "grep", "sed", "awk", "sort", "find",
      ]);
      if (SHELL_KEYWORDS.has(word)) {
        out += '<span class="hl-keyword">' + escapeHtml(word) + "</span>";
      } else if (word === "true" || word === "false") {
        out += '<span class="hl-keyword">' + escapeHtml(word) + "</span>";
      } else {
        out += escapeHtml(word);
      }
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }
  return out;
}

function _highlightDiffHtml(code) {
  const lines = code.split("\n");
  const out = [];
  for (const line of lines) {
    if (/^@@\s/.test(line)) {
      out.push('<span class="hl-diff-header">' + escapeHtml(line) + "</span>");
    } else if (/^---\s/.test(line) || /^\+\+\+\s/.test(line)) {
      out.push('<span class="hl-diff-file">' + escapeHtml(line) + "</span>");
    } else if (/^\+/.test(line)) {
      out.push('<span class="hl-diff-add">' + escapeHtml(line) + "</span>");
    } else if (/^-/.test(line)) {
      out.push('<span class="hl-diff-remove">' + escapeHtml(line) + "</span>");
    } else {
      out.push('<span class="hl-diff-context">' + escapeHtml(line) + "</span>");
    }
  }
  return out.join("\n");
}

// ── message rendering ───────────────────────────────────────────────────

function renderMessage(entry, index) {
  const role = String(entry.role || "unknown").toLowerCase();
  const roleLabel = toRoleLabel(role);
  const cssClass = toRoleCssClass(role);
  const time = entry.timestamp ? formatDate(entry.timestamp) : "";

  let body = "";

  if (entry.content) {
    // Detect fenced code blocks in content
    body += _renderContentWithCode(entry.content);
  }

  // Tool data
  if (entry.data !== undefined && role === "tool") {
    const dataStr = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2);
    body += '<pre class="code-block"><code>' + highlightCodeToHtml(dataStr, "json") + "</code></pre>";
  }

  if (entry.name && role === "tool") {
    roleLabel + " (" + escapeHtml(entry.name) + ")";
  }

  // Error flag
  if (entry.isError) {
    body = '<div class="msg-error-banner">⚠ Error</div>' + body;
  }

  const toolNameLine = role === "tool" && entry.name
    ? '<span class="role-tool-name">' + escapeHtml(entry.name) + "</span>"
    : "";

  return [
    '<div class="message ' + cssClass + '" data-index="' + index + '" data-role="' + escapeHtml(role) + '">',
    '  <div class="msg-header">',
    '    <span class="role-badge ' + cssClass + '">' + escapeHtml(toRoleLabel(role)) + "</span>",
    toolNameLine ? "    " + toolNameLine : "",
    time ? '    <span class="msg-time">' + escapeHtml(time) + "</span>" : "",
    '    <button class="msg-collapse-btn" onclick="this.closest(\'.message\').classList.toggle(\'collapsed\')" title="Toggle collapse">&#9660;</button>',
    "  </div>",
    '  <div class="msg-body">' + body + "</div>",
    "</div>",
  ].join("\n");
}

function _renderContentWithCode(content) {
  if (!content) return "";

  // Simple fenced-code-block detection: triple-backtick blocks
  const parts = [];
  const lines = content.split("\n");
  let inFence = false;
  let fenceLang = "";
  let fenceContent = [];
  let acc = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^```(\S*)/);
    if (fenceMatch && !inFence) {
      // Start fence
      if (acc.length) {
        parts.push({ type: "text", content: acc.join("\n") });
        acc = [];
      }
      inFence = true;
      fenceLang = fenceMatch[1] || "";
      fenceContent = [];
      continue;
    }
    if (inFence && line.trim() === "```") {
      // End fence
      parts.push({ type: "code", lang: fenceLang, content: fenceContent.join("\n") });
      inFence = false;
      fenceLang = "";
      fenceContent = [];
      continue;
    }
    if (inFence) {
      fenceContent.push(line);
    } else {
      acc.push(line);
    }
  }

  // Close unclosed fence
  if (inFence) {
    parts.push({ type: "code", lang: fenceLang, content: fenceContent.join("\n") });
  }
  if (acc.length) {
    parts.push({ type: "text", content: acc.join("\n") });
  }

  // Render parts
  const result = [];
  for (const part of parts) {
    if (part.type === "code") {
      result.push(
        '<pre class="code-block"><code>' +
          highlightCodeToHtml(part.content, part.lang) +
          "</code></pre>"
      );
    } else {
      // Simple markdown-like formatting for inline
      result.push('<div class="msg-text">' + _renderInlineMarkdown(escapeHtml(part.content)) + "</div>");
    }
  }
  return result.join("\n");
}

function _renderInlineMarkdown(escapedText) {
  if (!escapedText) return "";
  // Bold **text**
  let result = escapedText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic *text*
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code `text`
  result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Newlines to <br>
  result = result.replace(/\n/g, "<br>");
  return result;
}

// ── CSS (inline, dark theme, responsive, print-friendly) ─────────────────

function buildBaseCss() {
  return `
    :root {
      --bg: #1a1b26;
      --bg-secondary: #24283b;
      --bg-tertiary: #2f3348;
      --text: #c0caf5;
      --text-muted: #787c99;
      --border: #3b4261;
      --accent: #7aa2f7;
      --accent-dim: #3d59a1;
      --green: #9ece6a;
      --red: #f7768e;
      --yellow: #e0af68;
      --cyan: #7dcfff;
      --orange: #ff9e64;
      --purple: #bb9af7;
      --magenta: #c292c4;
      --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --radius: 6px;
      --shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      --max-width: 900px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 15px;
      line-height: 1.65;
      padding: 0;
    }

    .container {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 32px 20px 80px;
    }

    /* Header */
    .export-header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 24px 0;
      margin-bottom: 32px;
      text-align: center;
    }
    .export-header h1 {
      font-size: 1.6rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 8px;
    }
    .export-header .meta {
      font-size: 0.85rem;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;
    }
    .export-header .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .export-header .meta-item code {
      background: var(--bg-tertiary);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    /* Messages */
    .message {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 16px;
      overflow: hidden;
      box-shadow: var(--shadow);
      transition: max-height 0.3s ease;
    }
    .message.collapsed .msg-body {
      max-height: 0;
      overflow: hidden;
      padding-top: 0;
      padding-bottom: 0;
      opacity: 0;
    }
    .msg-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      user-select: none;
    }
    .msg-header:hover { background: var(--accent-dim); }
    .role-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .role-badge.msg-user { background: var(--accent-dim); color: var(--accent); }
    .role-badge.msg-assistant { background: rgba(158, 206, 106, 0.15); color: var(--green); }
    .role-badge.msg-tool { background: rgba(224, 175, 104, 0.15); color: var(--yellow); }
    .role-badge.msg-unknown { background: var(--bg); color: var(--text-muted); }

    .role-tool-name {
      font-size: 0.8rem;
      color: var(--orange);
      font-family: var(--font-mono);
    }
    .msg-time {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .msg-collapse-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 3px;
      transition: transform 0.2s, color 0.2s;
    }
    .msg-collapse-btn:hover { color: var(--text); }
    .message.collapsed .msg-collapse-btn { transform: rotate(-90deg); }
    .msg-body {
      padding: 16px;
      overflow-wrap: break-word;
      transition: max-height 0.3s, opacity 0.3s, padding 0.3s;
    }
    .msg-error-banner {
      background: rgba(247, 118, 142, 0.15);
      border-left: 3px solid var(--red);
      color: var(--red);
      padding: 6px 12px;
      margin-bottom: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 0 var(--radius) var(--radius) 0;
    }
    .msg-text {
      margin-bottom: 8px;
    }
    .msg-text:last-child { margin-bottom: 0; }

    /* Code blocks */
    .code-block {
      background: #1a1b26;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.55;
      margin: 8px 0;
    }
    .code-block:last-child { margin-bottom: 0; }
    .code-block code {
      color: var(--text);
      white-space: pre;
    }
    .inline-code {
      background: var(--bg-tertiary);
      color: var(--cyan);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 0.88em;
    }

    /* Syntax highlighting */
    .hl-keyword  { color: var(--purple); font-weight: 600; }
    .hl-string   { color: var(--green); }
    .hl-number   { color: var(--orange); }
    .hl-comment  { color: #565f89; font-style: italic; }
    .hl-builtin  { color: var(--cyan); }
    .hl-type     { color: var(--yellow); }
    .hl-function { color: var(--accent); }
    .hl-variable { color: var(--orange); }
    .hl-attribute{ color: var(--yellow); }
    .hl-operator { color: var(--magenta); }

    /* Diff highlighting */
    .hl-diff-add     { color: var(--green); }
    .hl-diff-remove  { color: var(--red); }
    .hl-diff-header  { color: var(--cyan); font-weight: 600; }
    .hl-diff-file    { color: var(--accent); font-weight: 600; }
    .hl-diff-context { color: var(--text-muted); }

    /* Search bar (interactive mode) */
    .search-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .search-bar input {
      flex: 1;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: var(--radius);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      outline: none;
    }
    .search-bar input:focus { border-color: var(--accent); }
    .search-bar .btn {
      background: var(--accent-dim);
      border: 1px solid var(--accent);
      color: var(--accent);
      padding: 8px 16px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .search-bar .btn:hover { background: var(--accent); color: var(--bg); }
    .search-bar .search-count {
      font-size: 0.8rem;
      color: var(--text-muted);
      min-width: 60px;
    }
    .message.hidden { display: none; }
    .message.search-match .msg-header { background: rgba(224, 175, 104, 0.2); }
    mark.search-highlight {
      background: var(--yellow);
      color: var(--bg);
      padding: 0 2px;
      border-radius: 2px;
    }

    /* Footer */
    .export-footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.78rem;
      padding: 24px 0 0;
      border-top: 1px solid var(--border);
      margin-top: 40px;
    }

    /* Print styles */
    @media print {
      :root {
        --bg: #fff;
        --bg-secondary: #f4f4f5;
        --bg-tertiary: #e5e5e7;
        --text: #1a1a1a;
        --text-muted: #666;
        --border: #ccc;
        --accent: #2563eb;
        --accent-dim: #dbeafe;
        --green: #166534;
        --red: #991b1b;
        --yellow: #92400e;
        --cyan: #155e75;
        --orange: #9a3412;
        --purple: #6b21a8;
        --magenta: #86198f;
        --shadow: none;
      }
      .search-bar { display: none; }
      .msg-collapse-btn { display: none; }
      .message.collapsed .msg-body {
        max-height: none;
        opacity: 1;
        padding: 16px;
      }
      .message { break-inside: avoid; }
      .code-block { white-space: pre-wrap; word-break: break-all; }
      body { font-size: 12px; }
    }

    /* Responsive */
    @media (max-width: 640px) {
      .container { padding: 16px 12px 60px; }
      .export-header h1 { font-size: 1.3rem; }
      .msg-header { padding: 8px 12px; gap: 8px; }
      .msg-body { padding: 12px; }
      .message { margin-bottom: 12px; }
    }
  `;
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Generate a full, standalone HTML page for a session.
 *
 * @param {object}  session    Session-like object: { id, entries(), metadata()?, updatedAt? }
 * @param {object}  [options]  { title?, language? }
 * @returns {string}           Complete HTML document as a string.
 */
function exportAsHtml(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const updatedAt = session.updatedAt || metadata?.updatedAt || "";
  const projectName = metadata?.projectName || metadata?.project_root || "";
  const title = options.title || "Hax Agent Session Transcript";
  const now = new Date().toISOString();

  const messagesHtml = entries.map((entry, idx) => renderMessage(entry, idx)).join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="generator" content="HaxAgent Export">',
    "<title>" + escapeHtml(title) + "</title>",
    "<style>" + buildBaseCss() + "</style>",
    "</head>",
    "<body>",
    '<div class="export-header">',
    "  <h1>" + escapeHtml(title) + "</h1>",
    '  <div class="meta">',
    '    <span class="meta-item">Session: <code>' + escapeHtml(session.id || "") + "</code></span>",
    updatedAt ? '    <span class="meta-item">Updated: ' + escapeHtml(formatDate(updatedAt)) + "</span>" : "",
    projectName ? '    <span class="meta-item">Project: ' + escapeHtml(projectName) + "</span>" : "",
    '    <span class="meta-item">Messages: ' + entries.length + "</span>",
    '    <span class="meta-item">Exported: ' + escapeHtml(formatDate(now)) + "</span>",
    "  </div>",
    "</div>",
    '<div class="container">',
    messagesHtml,
    "</div>",
    '<div class="export-footer">',
    "Exported by HaxAgent",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Generate an HTML fragment (no <html>/<head>/<body> wrapper).
 *
 * @param {object} session  Session-like object.
 * @returns {string}        HTML fragment string.
 */
function exportAsHtmlFragment(session) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const messagesHtml = entries.map((entry, idx) => renderMessage(entry, idx)).join("\n");

  return [
    '<div class="hax-conversation" style="' + _fragmentWrapperStyle() + '">',
    "<style>" + buildBaseCss() + "</style>",
    '<div class="container" style="padding:0;max-width:none;">',
    messagesHtml,
    "</div>",
    "</div>",
  ].join("\n");
}

function _fragmentWrapperStyle() {
  return [
    "background:#1a1b26;color:#c0caf5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "font-size:15px;line-height:1.65;padding:16px;border-radius:6px;",
  ].join("");
}

/**
 * Generate interactive HTML: collapsible messages + search bar.
 *
 * @param {object}  session    Session-like object.
 * @param {object}  [options]  { title? }
 * @returns {string}           Complete HTML document with inline JS.
 */
function exportAsInteractiveHtml(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const updatedAt = session.updatedAt || metadata?.updatedAt || "";
  const projectName = metadata?.projectName || metadata?.project_root || "";
  const title = options.title || "Hax Agent Session Transcript";
  const now = new Date().toISOString();

  const messagesHtml = entries.map((entry, idx) => renderMessage(entry, idx)).join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "<title>" + escapeHtml(title) + "</title>",
    "<style>" + buildBaseCss() + "</style>",
    "</head>",
    "<body>",
    '<div class="search-bar" id="searchBar">',
    '  <input type="text" id="searchInput" placeholder="Search messages..." oninput="doSearch()">',
    '  <span class="search-count" id="searchCount"></span>',
    '  <button class="btn" onclick="expandAll()">Expand All</button>',
    '  <button class="btn" onclick="collapseAll()">Collapse All</button>',
    '  <button class="btn" onclick="clearSearch()">Clear</button>',
    "</div>",
    '<div class="export-header">',
    "  <h1>" + escapeHtml(title) + "</h1>",
    '  <div class="meta">',
    '    <span class="meta-item">Session: <code>' + escapeHtml(session.id || "") + "</code></span>",
    updatedAt ? '    <span class="meta-item">Updated: ' + escapeHtml(formatDate(updatedAt)) + "</span>" : "",
    projectName ? '    <span class="meta-item">Project: ' + escapeHtml(projectName) + "</span>" : "",
    '    <span class="meta-item">Messages: ' + entries.length + "</span>",
    "  </div>",
    "</div>",
    '<div class="container" id="messagesContainer">',
    messagesHtml,
    "</div>",
    '<div class="export-footer">Exported by HaxAgent</div>',
    // Inline JavaScript for interactivity
    "<script>",
    "(function() {",
    '  var searchTimeout = null;',
    "",
    "  window.doSearch = function() {",
    '    clearTimeout(searchTimeout);',
    "    searchTimeout = setTimeout(_performSearch, 100);",
    "  };",
    "",
    "  window.clearSearch = function() {",
    "    var input = document.getElementById('searchInput');",
    "    input.value = '';",
    "    _performSearch();",
    "  };",
    "",
    "  window.expandAll = function() {",
    "    var msgs = document.querySelectorAll('.message');",
    "    for (var i = 0; i < msgs.length; i++) {",
    "      msgs[i].classList.remove('collapsed');",
    "    }",
    "  };",
    "",
    "  window.collapseAll = function() {",
    "    var msgs = document.querySelectorAll('.message');",
    "    for (var i = 0; i < msgs.length; i++) {",
    "      msgs[i].classList.add('collapsed');",
    "    }",
    "  };",
    "",
    "  function _performSearch() {",
    "    var query = (document.getElementById('searchInput').value || '').trim().toLowerCase();",
    "    var messages = document.querySelectorAll('.message');",
    "    var count = 0;",
    "    var matched = 0;",
    "",
    "    // Remove old highlights",
    "    _removeHighlights();",
    "",
    "    for (var i = 0; i < messages.length; i++) {",
    "      var msg = messages[i];",
    "      msg.classList.remove('hidden', 'search-match');",
    "",
    "      if (!query) { count++; continue; }",
    "",
    "      var body = msg.querySelector('.msg-body');",
    "      var text = (body ? body.textContent : '') + ' ' + (msg.getAttribute('data-role') || '');",
    "",
    "      if (text.toLowerCase().indexOf(query) !== -1) {",
    "        msg.classList.add('search-match');",
    "        count++;",
    "        matched++;",
    "        _highlightText(body, query);",
    "      } else {",
    "        msg.classList.add('hidden');",
    "      }",
    "    }",
    "",
    "    var countEl = document.getElementById('searchCount');",
    "    if (countEl) {",
    "      if (query) {",
    "        countEl.textContent = matched + ' / ' + messages.length + ' matches';",
    "      } else {",
    "        countEl.textContent = messages.length + ' messages';",
    "      }",
    "    }",
    "  }",
    "",
    "  function _removeHighlights() {",
    "    var marks = document.querySelectorAll('mark.search-highlight');",
    "    for (var i = 0; i < marks.length; i++) {",
    "      var parent = marks[i].parentNode;",
    "      if (parent) {",
    "        parent.replaceChild(document.createTextNode(marks[i].textContent), marks[i]);",
    "        parent.normalize();",
    "      }",
    "    }",
    "  }",
    "",
    "  function _highlightText(el, query) {",
    "    if (!el || !query) return;",
    "    _highlightNode(el, query);",
    "  }",
    "",
    "  function _highlightNode(node, query) {",
    "    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);",
    "    var textNodes = [];",
    "    var tn;",
    "    while ((tn = walker.nextNode())) {",
    "      textNodes.push(tn);",
    "    }",
    "    for (var i = 0; i < textNodes.length; i++) {",
    "      var textNode = textNodes[i];",
    "      var val = textNode.nodeValue;",
    "      var lower = val.toLowerCase();",
    "      if (lower.indexOf(query) === -1) continue;",
    "      var frag = document.createDocumentFragment();",
    "      var pos = 0;",
    "      var idx;",
    "      while ((idx = lower.indexOf(query, pos)) !== -1) {",
    "        if (idx > pos) {",
    "          frag.appendChild(document.createTextNode(val.slice(pos, idx)));",
    "        }",
    "        var mark = document.createElement('mark');",
    "        mark.className = 'search-highlight';",
    "        mark.textContent = val.slice(idx, idx + query.length);",
    "        frag.appendChild(mark);",
    "        pos = idx + query.length;",
    "      }",
    "      if (pos < val.length) {",
    "        frag.appendChild(document.createTextNode(val.slice(pos)));",
    "      }",
    "      textNode.parentNode.replaceChild(frag, textNode);",
    "    }",
    "  }",
    "})();",
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

// ── exports ──────────────────────────────────────────────────────────────

module.exports = {
  exportAsHtml,
  exportAsHtmlFragment,
  exportAsInteractiveHtml,
  // These are exported for testing but not part of the public API
  _highlightCodeToHtml: highlightCodeToHtml,
  _escapeHtml: escapeHtml,
};
