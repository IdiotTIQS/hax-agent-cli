"use strict";

const { ANSI, THEME } = require("../renderer");

// ── Terminal-safe color aliases ──────────────────────────────────────

const KW = THEME.accent;                // keywords
const STR = THEME.toolSuccess;          // strings  (green)
const NUM = THEME.cost;                 // numbers  (yellow)
const CM = ANSI.dim + ANSI.italic;      // comments
const OP = THEME.info;                  // operators / punctuation (blue)
const FN = THEME.heading;               // function / method names
const TYPE = THEME.toolIndicator;       // type / class names
const REGEX = ANSI.brightGreen;         // regexps
const BUILTIN = ANSI.brightCyan;        // builtin globals / shell commands
const TAG = THEME.accent;               // XML/HTML tags (brightMagenta)
const ATTR = ANSI.brightYellow;         // XML/HTML attributes
const VAR_TOKEN = THEME.assistantIndicator; // template-literal expressions
const MD_HEADING = THEME.heading;
const MD_LINK = THEME.link;
const MD_EM = ANSI.italic;
const MD_CODE = THEME.codeText;

// ── JS/TS tokenisers ─────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "of", "package",
  "private", "protected", "public", "return", "super", "switch", "static",
  "this", "throw", "true", "try", "typeof", "var", "void", "while",
  "with", "yield", "abstract", "as", "from", "get", "set", "type", "namespace",
  "declare", "module", "readonly", "keyof", "is", "infer", "never", "unknown",
  "any", "boolean", "number", "string", "symbol", "object",
]);

const JS_BUILTINS = new Set([
  "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math",
  "Number", "Object", "Promise", "RegExp", "Set", "String", "Symbol",
  "WeakMap", "WeakSet", "console", "process", "Buffer", "setTimeout",
  "setInterval", "clearTimeout", "clearInterval", "require", "module",
  "exports", "__dirname", "__filename",
]);

// Characters that delimit a JS token boundary
const JS_WORD_BOUNDARY = /[^a-zA-Z0-9_$]/;

/**
 * JS/TS syntax highlighting with ANSI colors.
 * Token-based: keywords, strings, numbers, comments, operators, templates.
 *
 * @param {string} code
 * @returns {string}
 */
function highlightJs(code) {
  if (typeof code !== "string") return "";

  const len = code.length;
  let out = "";
  let i = 0;

  while (i < len) {
    const ch = code[i];

    // ── Single-line comment ──
    if (ch === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < len && code[i] !== "\n") i++;
      out += CM + code.slice(start, i) + ANSI.reset;
      continue;
    }

    // ── Block comment ──
    if (ch === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i < len) i += 2; // consume */
      out += CM + code.slice(start, i) + ANSI.reset;
      continue;
    }

    // ── RegExp literal ──  (best-effort: preceded by operator / bracket / keyword)
    if (ch === "/" && i + 1 < len && code[i + 1] !== "/" && code[i + 1] !== "*") {
      const prev = i === 0 ? " " : code[i - 1];
      if (/[=([{!&|?:;,~%^<>\s]/.test(prev) || (i >= 2 && /return|case|typeof|instanceof|delete|void|in|of|throw/.test(code.slice(Math.max(0, i - 10), i).match(/\w+$/)?.[0] || ""))) {
        const re = _consumeRegexp(code, i);
        if (re) {
          out += REGEX + re.text + ANSI.reset;
          i = re.end;
          continue;
        }
      }
    }

    // ── Template string ──
    if (ch === "`") {
      const tmpl = _consumeTemplate(code, i);
      out += tmpl.text;
      i = tmpl.end;
      continue;
    }

    // ── String literal (single/double quote) ──
    if (ch === "'" || ch === '"') {
      const str = _consumeString(code, i, ch);
      out += STR + str.text + ANSI.reset;
      i = str.end;
      continue;
    }

    // ── Number literal ──
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < len && code[i + 1] >= "0" && code[i + 1] <= "9")) {
      const num = _consumeNumber(code, i);
      out += NUM + num.text + ANSI.reset;
      i = num.end;
      continue;
    }

    // ── Identifier / keyword ──
    if (/[a-zA-Z_$]/.test(ch)) {
      const word = _consumeIdent(code, i);
      if (JS_KEYWORDS.has(word.text)) {
        out += KW + word.text + ANSI.reset;
      } else if (JS_BUILTINS.has(word.text)) {
        out += BUILTIN + word.text + ANSI.reset;
      } else if (/^[A-Z]/.test(word.text) && word.text !== word.text.toUpperCase()) {
        // PascalCase -> likely type / class
        out += TYPE + word.text + ANSI.reset;
      } else if (i + word.text.length < len && code[i + word.text.length] === "(") {
        // function call
        out += FN + word.text + ANSI.reset;
      } else {
        out += word.text;
      }
      i = word.end;
      continue;
    }

    // ── Operator / punctuation ──
    if (/[+\-*/%=<>!&|^~?:;,.()[\]{}]/.test(ch)) {
      const opLen = _operatorLength(code, i);
      out += OP + code.slice(i, i + opLen) + ANSI.reset;
      i += opLen;
      continue;
    }

    // ── Whitespace / other ──
    out += ch;
    i++;
  }

  return out;
}

function _consumeString(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === quote) break;
    i++;
  }
  i = Math.min(i + 1, src.length);
  return { text: src.slice(start, i), end: i };
}

function _consumeTemplate(src, start) {
  let i = start + 1;
  let depth = 0;
  let out = "`";
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") { out += src.slice(i, i + 2); i += 2; continue; }

    // Template expression ${ … }
    if (ch === "$" && src[i + 1] === "{") {
      if (depth === 0) {
        out += ANSI.reset + VAR_TOKEN + "${";
      } else {
        out += "${";
      }
      depth++;
      i += 2;
      continue;
    }

    if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        out += "}" + ANSI.reset + STR;
      } else {
        out += "}";
      }
      i++;
      continue;
    }

    if (ch === "`" && depth === 0) {
      i++;
      out += "`";
      break;
    }

    out += ch;
    i++;
  }
  return { text: out + ANSI.reset, end: i };
}

function _consumeRegexp(src, start) {
  let i = start + 1;
  let escaped = false;
  while (i < src.length) {
    if (escaped) { escaped = false; i++; continue; }
    if (src[i] === "\\") { escaped = true; i++; continue; }
    if (src[i] === "\n") return null; // regex on its own line is division
    if (src[i] === "/") break;
    i++;
  }
  if (i >= src.length) return null;
  i++; // consume closing /
  // flags
  while (i < src.length && /[gimsuy]/.test(src[i])) i++;
  return { text: src.slice(start, i), end: i };
}

function _consumeNumber(src, start) {
  let i = start;
  if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) i += 2;
  else if (src[i] === "0" && (src[i + 1] === "b" || src[i + 1] === "B")) i += 2;
  else if (src[i] === "0" && (src[i + 1] === "o" || src[i + 1] === "O")) i += 2;
  while (i < src.length && /[0-9a-fA-F._]/.test(src[i])) i++;
  if (i < src.length && src[i] === "n") i++; // BigInt
  return { text: src.slice(start, i), end: i };
}

function _consumeIdent(src, start) {
  let i = start + 1;
  while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) i++;
  return { text: src.slice(start, i), end: i };
}

function _operatorLength(src, start) {
  const twoChar = src.slice(start, start + 2);
  if (/^(<<|>>|>>>|==|!=|<=|>=|&&|\|\||\*\*|\?\?|\.\.\.|\+\+|--|=>|::|\*\*=|<<=|>>=|>>>=|&&=|\|\|=|\?\?=)$/.test(twoChar)) {
    if (twoChar === ">>>" && src[start + 3] === "=") return 4;
    return 2;
  }
  return 1;
}

// ── JSON highlighting ────────────────────────────────────────────────

/**
 * JSON syntax highlighting.
 * Keys in bright-cyan, strings green, numbers yellow, booleans/null in keywords.
 *
 * @param {string} text
 * @returns {string}
 */
function highlightJson(text) {
  if (typeof text !== "string") return "";

  const len = text.length;
  let out = "";
  let i = 0;

  while (i < len) {
    const ch = text[i];

    // String
    if (ch === '"') {
      const isKey = _isJsonKey(text, i);
      const str = _consumeString(text, i, '"');
      const color = isKey ? BUILTIN : STR;
      out += color + str.text + ANSI.reset;
      i = str.end;
      continue;
    }

    // Number
    if ((ch >= "0" && ch <= "9") || (ch === "-" && i + 1 < len && text[i + 1] >= "0" && text[i + 1] <= "9")) {
      const num = _consumeNumber(text, i);
      out += NUM + num.text + ANSI.reset;
      i = num.end;
      continue;
    }

    // Keywords
    const remaining = text.slice(i);
    if (/^(true|false|null)/.test(remaining)) {
      const kw = remaining.match(/^(true|false|null)/)[0];
      out += KW + kw + ANSI.reset;
      i += kw.length;
      continue;
    }

    // Brackets / punctuation
    if (/^[{}[\]\:]/.test(ch)) {
      out += OP + ch + ANSI.reset;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function _isJsonKey(src, pos) {
  // scan backwards for `:` preceded by a string — we're at a key if a colon follows after the closing quote
  // Simpler heuristic: look backwards for `{` or `,` with optional whitespace
  for (let j = pos - 1; j >= 0; j--) {
    const c = src[j];
    if (c === "\n" || c === "\r") continue;
    if (c === " " || c === "\t") continue;
    return c === "," || c === "{" || c === "[";
  }
  return true; // start of document
}

// ── Markdown highlighting ────────────────────────────────────────────

/**
 * Markdown-aware highlighting.
 * Headings, bold, italic, code spans, code blocks, links, blockquotes, lists.
 *
 * @param {string} text
 * @returns {string}
 */
function highlightMarkdown(text) {
  if (typeof text !== "string") return "";

  const lines = text.split("\n");
  const out = [];
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence blocks
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      out.push(THEME.dim + line.replace(/^```(\w*)/, `${THEME.codeText}${"`".repeat(3)}${THEME.dim}$1`) + ANSI.reset);
      continue;
    }

    if (inCodeFence) {
      out.push(MD_CODE + line + ANSI.reset);
      continue;
    }

    // Headings
    if (/^#{1,6}\s/.test(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)/);
      out.push(MD_HEADING + m[1] + " " + _highlightMdInline(m[2]) + ANSI.reset);
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      out.push(ANSI.dim + "─".repeat(Math.min(line.length, 60)) + ANSI.reset);
      continue;
    }

    // Blockquote
    if (/^>\s/.test(line)) {
      const inner = line.replace(/^>\s?/, "");
      out.push(ANSI.dim + "▎ " + _highlightMdInline(inner) + ANSI.reset);
      continue;
    }

    // Unordered list
    if (/^(\s*)[-*+]\s/.test(line) && !/^(\s*)\*{3,}/.test(line)) {
      const m = line.match(/^(\s*)([-*+])\s+(.*)/);
      out.push(m[1] + THEME.list + m[2] + ANSI.reset + " " + _highlightMdInline(m[3]));
      continue;
    }

    // Ordered list
    if (/^(\s*)\d+\.\s/.test(line)) {
      const m = line.match(/^(\s*)(\d+\.)\s+(.*)/);
      out.push(m[1] + THEME.list + m[2] + ANSI.reset + " " + _highlightMdInline(m[3]));
      continue;
    }

    out.push(_highlightMdInline(line));
  }

  return out.join("\n");
}

function _highlightMdInline(text) {
  if (!text) return "";
  let result = "";
  let cursor = 0;
  const len = text.length;

  while (cursor < len) {
    // **bold**
    const boldMatch = text.slice(cursor).match(/^\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index === 0) {
      result += ANSI.bold + boldMatch[1] + ANSI.reset;
      cursor += boldMatch[0].length;
      continue;
    }

    // *italic*
    const italicMatch = text.slice(cursor).match(/^\*(.+?)\*/);
    if (italicMatch && italicMatch.index === 0) {
      result += MD_EM + italicMatch[1] + ANSI.reset;
      cursor += italicMatch[0].length;
      continue;
    }

    // `code`
    const codeMatch = text.slice(cursor).match(/^`([^`]+)`/);
    if (codeMatch && codeMatch.index === 0) {
      result += MD_CODE + codeMatch[1] + ANSI.reset;
      cursor += codeMatch[0].length;
      continue;
    }

    // [link](url)
    const linkMatch = text.slice(cursor).match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index === 0) {
      result += MD_LINK + linkMatch[1] + ANSI.reset;
      cursor += linkMatch[0].length;
      continue;
    }

    // ~~strikethrough~~
    const sMatch = text.slice(cursor).match(/^~~(.+?)~~/);
    if (sMatch && sMatch.index === 0) {
      result += ANSI.strikethrough + sMatch[1] + ANSI.reset;
      cursor += sMatch[0].length;
      continue;
    }

    result += text[cursor];
    cursor++;
  }

  return result;
}

// ── Diff highlighting ────────────────────────────────────────────────

/**
 * Unified diff highlighting.
 * Lines starting with + in green, - in red, @@ header in cyan, ---/+++ in bold cyan.
 *
 * @param {string} text
 * @returns {string}
 */
function highlightDiff(text) {
  if (typeof text !== "string" || text.length === 0) return "";

  const lines = text.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^@@\s/.test(line)) {
      // Hunk header
      out.push(THEME.diffHeader + line + ANSI.reset);
    } else if (/^---\s/.test(line) || /^\+\+\+\s/.test(line)) {
      // File headers
      out.push(ANSI.bold + THEME.diffHeader + line + ANSI.reset);
    } else if (/^\+/.test(line)) {
      // Added line
      out.push(THEME.diffAdd + line + ANSI.reset);
    } else if (/^-/.test(line)) {
      // Removed line
      out.push(THEME.diffRemove + line + ANSI.reset);
    } else if (/^@@/.test(line)) {
      out.push(THEME.diffHeader + line + ANSI.reset);
    } else {
      out.push(ANSI.dim + line + ANSI.reset);
    }
  }

  return out.join("\n");
}

// ── Shell highlighting ───────────────────────────────────────────────

const SHELL_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
  "case", "esac", "in", "function", "return", "exit", "export", "local",
  "readonly", "declare", "source", "alias", "unalias", "break", "continue",
  "eval", "exec", "shift", "trap", "unset", "set", "echo", "printf",
  "test", "cd", "pwd", "ls", "cp", "mv", "rm", "mkdir", "rmdir",
  "cat", "head", "tail", "grep", "sed", "awk", "sort", "uniq",
  "wc", "find", "xargs", "chmod", "chown", "ln", "tar", "gzip",
  "git", "npm", "yarn", "node", "python", "pip", "docker", "kubectl",
  "curl", "wget", "ssh", "scp", "ps", "kill", "top", "df", "du",
  "diff", "patch", "make", "cmake",
]);

const SHELL_BUILTINS = new Set([
  "true", "false", "yes", "no", "time", "env", "sudo",
]);

/**
 * Shell command highlighting.
 * Recognises flags, commands, strings, variables, comments, pipes, redirects.
 *
 * @param {string} text
 * @returns {string}
 */
function highlightShell(text) {
  if (typeof text !== "string") return "";

  const len = text.length;
  let out = "";
  let i = 0;

  while (i < len) {
    const ch = text[i];

    // Comment
    if (ch === "#") {
      const start = i;
      i++;
      while (i < len && text[i] !== "\n") i++;
      out += CM + text.slice(start, i) + ANSI.reset;
      continue;
    }

    // String: single-quoted
    if (ch === "'") {
      const str = _consumeString(text, i, "'");
      out += STR + str.text + ANSI.reset;
      i = str.end;
      continue;
    }

    // String: double-quoted
    if (ch === '"') {
      // Double-quoted with possible $variable interpolation
      let j = i + 1;
      let acc = '"';
      while (j < len) {
        if (text[j] === "\\") { acc += text.slice(j, j + 2); j += 2; continue; }
        if (text[j] === "$") {
          // Interpolated variable
          acc += ANSI.reset;
          const varStart = j;
          j++;
          if (text[j] === "{") { while (j < len && text[j] !== "}") j++; j++; }
          else { while (j < len && /[a-zA-Z0-9_]/.test(text[j])) j++; }
          acc += VAR_TOKEN + text.slice(varStart, j) + ANSI.reset + STR;
          continue;
        }
        if (text[j] === '"') { j++; acc += '"'; break; }
        acc += text[j];
        j++;
      }
      out += STR + acc + ANSI.reset;
      i = j;
      continue;
    }

    // Variable
    if (ch === "$" && i + 1 < len) {
      const next = text[i + 1];
      if (/[a-zA-Z_{]/.test(next) || next === "(") {
        let j = i + 1;
        if (text[j] === "{") { while (j < len && text[j] !== "}") j++; j++; }
        else if (text[j] === "(") { j += 2; let depth = 1; while (j < len && depth > 0) { if (text[j] === "(") depth++; if (text[j] === ")") depth--; j++; } }
        else { while (j < len && /[a-zA-Z0-9_]/.test(text[j])) j++; }
        out += VAR_TOKEN + text.slice(i, j) + ANSI.reset;
        i = j;
        continue;
      }
    }

    // Flag: -x or --flag
    if (ch === "-" && i + 1 < len && /[a-zA-Z-]/.test(text[i + 1])) {
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9-]/.test(text[j])) j++;
      out += THEME.muted + text.slice(i, j) + ANSI.reset;
      i = j;
      continue;
    }

    // Number
    if ((ch >= "0" && ch <= "9") && (i === 0 || /\s/.test(text[i - 1]) || /[<>&|]/.test(text[i - 1]))) {
      const num = _consumeNumber(text, i);
      out += NUM + num.text + ANSI.reset;
      i = num.end;
      continue;
    }

    // Word / command
    if (/[a-zA-Z_]/.test(ch)) {
      const word = _consumeIdent(text, i);
      if (SHELL_KEYWORDS.has(word.text)) {
        out += KW + word.text + ANSI.reset;
      } else if (SHELL_BUILTINS.has(word.text)) {
        out += BUILTIN + word.text + ANSI.reset;
      } else {
        out += word.text;
      }
      i = word.end;
      continue;
    }

    // Pipe / redirect
    if (ch === "|" || ch === ">" || ch === "<" || ch === "&") {
      let end = i + 1;
      if (end < len) {
        if (text[end] === ch && ch !== "&") end++; // >>  <<
        else if (ch === "|" && text[end] === "|") end++;
        else if (ch === ">" && text[end] === "&") end++;
        else if (ch === "&" && text[end] === "&") end++;
        else if (ch === "&" && (text[end] === ">" || text[end] === "<")) end++;
      }
      out += OP + text.slice(i, end) + ANSI.reset;
      i = end;
      continue;
    }

    // General punctuation
    if (/[;(){}\[\]]/.test(ch)) {
      out += OP + ch + ANSI.reset;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

// ── XML / HTML highlighting ──────────────────────────────────────────

/**
 * XML / HTML highlighting.
 * Tags in magenta, attributes in yellow, attribute values in green, text content dim.
 *
 * @param {string} text
 * @returns {string}
 */
function highlightXml(text) {
  if (typeof text !== "string") return "";

  const len = text.length;
  let out = "";
  let i = 0;
  let inTag = false;
  let inComment = false;

  while (i < len) {
    // Comment: <!-- ... -->
    if (!inComment && text.slice(i, i + 4) === "<!--") {
      inComment = true;
      const end = text.indexOf("-->", i);
      const commentEnd = end === -1 ? len : end + 3;
      out += CM + text.slice(i, commentEnd) + ANSI.reset;
      i = commentEnd;
      inComment = false;
      continue;
    }

    if (inComment) {
      out += CM + text[i] + ANSI.reset;
      i++;
      continue;
    }

    // Tag open
    if (text[i] === "<") {
      inTag = true;
      // CDATA
      if (text.slice(i, i + 9) === "<![CDATA[") {
        const end = text.indexOf("]]>", i + 9);
        const cdataEnd = end === -1 ? len : end + 3;
        out += TAG + "<![CDATA[" + ANSI.reset;
        out += ANSI.dim + text.slice(i + 9, cdataEnd === len ? undefined : end) + ANSI.reset;
        if (end !== -1) out += TAG + "]]>" + ANSI.reset;
        i = cdataEnd;
        inTag = false;
        continue;
      }
      // Processing instruction
      if (text[i + 1] === "?" && text.slice(i, i + 5) !== "<?xml") {
        const end = text.indexOf("?>", i);
        const piEnd = end === -1 ? len : end + 2;
        out += CM + text.slice(i, piEnd) + ANSI.reset;
        i = piEnd;
        inTag = false;
        continue;
      }
      out += TAG + "<" + ANSI.reset;
      i++;
      continue;
    }

    // Tag close
    if (inTag && text[i] === ">") {
      inTag = false;
      out += TAG + ">" + ANSI.reset;
      i++;
      continue;
    }

    // Self-closing
    if (inTag && text[i] === "/" && text[i + 1] === ">") {
      inTag = false;
      out += TAG + "/>" + ANSI.reset;
      i += 2;
      continue;
    }

    if (inTag) {
      // Tag name (initial word after < or </)
      if (text[i - 1] === "<" || (text[i - 1] === "/" && text[i - 2] === "<")) {
        const w = _consumeIdent(text, i);
        out += TAG + w.text + ANSI.reset;
        i = w.end;
        continue;
      }

      // Attribute name
      if (/[a-zA-Z_]/.test(text[i]) && (text[i - 1] === " " || text[i - 1] === "\t" || text[i - 1] === "\r" || text[i - 1] === "\n")) {
        const attr = _consumeIdent(text, i);
        out += ATTR + attr.text + ANSI.reset;
        i = attr.end;
        // If followed by =
        while (i < len && text[i] === " ") i++;
        if (text[i] === "=") {
          out += OP + "=";
          i++;
          if (text[i] === '"' || text[i] === "'") {
            const str = _consumeString(text, i, text[i]);
            out += (text[i] === '"' ? STR : STR) + str.text + ANSI.reset;
            i = str.end;
          }
        }
        continue;
      }

      out += text[i];
      i++;
      continue;
    }

    // Entity reference
    if (text[i] === "&") {
      const entityMatch = text.slice(i).match(/^&[a-zA-Z]+;/);
      if (entityMatch) {
        out += THEME.muted + entityMatch[0] + ANSI.reset;
        i += entityMatch[0].length;
        continue;
      }
    }

    // Content outside tags
    out += text[i];
    i++;
  }

  return out;
}

// ── Exports ───────────────────────────────────────────────────────────

module.exports = {
  highlightJs,
  highlightJson,
  highlightMarkdown,
  highlightDiff,
  highlightShell,
  highlightXml,
};
