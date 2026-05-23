"use strict";

/**
 * @fileoverview CodeExtractor — extracts code blocks, file changes, shell
 * commands, and patches from conversation sessions.  Operates on message
 * arrays `{ role: string, content: string, timestamp?: string }` — no LLM
 * dependency, purely pattern and keyword driven.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize any message content to a plain string.
 * @param {*} content
 * @returns {string}
 */
function toText(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(toText).join(" ");
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    return JSON.stringify(content);
  }
  return String(content);
}

/**
 * Normalize a session/messages input to a stable message array.
 * Accepts a session object (with .messages) or a plain message array.
 * @param {*} input
 * @returns {Array<{role: string, content: string, timestamp?: string, _index: number}>}
 */
function normalizeMessages(input) {
  const raw = input && Array.isArray(input.messages) ? input.messages
    : Array.isArray(input) ? input
    : [];
  return raw.map((m, i) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: toText(m ? m.content : undefined),
    timestamp: (m && typeof m.timestamp === "string") ? m.timestamp : undefined,
    _index: i,
  }));
}

// ---------------------------------------------------------------------------
// Regex / pattern constants
// ---------------------------------------------------------------------------

/**
 * Matches a fenced code block: ```optionalLang \n ... \n ```.
 * Capture groups: [fullMatch, lang, body]
 */
const FENCED_BLOCK_RE = /```(\w*)\s*\n([\s\S]*?)```/g;

/**
 * Matches an indented code block (4 spaces or 1 tab per line).
 */
const INDENTED_BLOCK_RE = /^((?: {4,}|\t).*(?:\n(?: {4,}|\t).*)*)/gm;

/**
 * Filename / path patterns used to detect file references.
 */
const FILE_PATH_RE = /(?:`?)((?:[\w.\-\\]+\/)*[\w.\-]+\.\w{1,8})(?:`?)/gi;

/**
 * Phrases that signal a file operation.
 */
const FILE_OP_PATTERNS = [
  /\b(?:create|write|save|generate|produce|output)\s+(?:a\s+)?(?:file|at|to|in)\s+`?([^\s`]+)`?/gi,
  /\b(?:modify|update|edit|change|patch|fix|alter)\s+(?:file\s+)?`?([^\s`]+)`?/gi,
  /\b(?:open|read|view|see)\s+(?:file\s+)?`?([^\s`]+)`?/gi,
  /`([^\s`]+\.[\w]{1,8})`/gi,
  /\b(?:file|path)\s*[:=]\s*`?([^\s`\n,]+)`?/gi,
];

/**
 * Commands patterns: lines starting with $, >, or # (with common command words).
 */
const COMMAND_LINE_RE = /^[>#$]\s*(.+)$/gm;

/**
 * Common shell command keywords for heuristic detection.
 */
const SHELL_COMMAND_KEYWORDS = [
  "npm", "npx", "yarn", "pnpm", "node", "python", "python3", "pip", "pip3",
  "git", "docker", "kubectl", "curl", "wget", "ssh", "scp", "rsync",
  "make", "cmake", "gcc", "g++", "clang", "cargo", "go", "rustc",
  "sudo", "apt", "apt-get", "brew", "choco", "winget", "scoop",
  "ls", "cd", "mkdir", "rm", "rmdir", "cp", "mv", "cat", "echo",
  "grep", "find", "sed", "awk", "chmod", "chown", "tar", "unzip",
  "export", "source", "set", "env", "which", "type",
  "terraform", "ansible", "helm", "psql", "mysql", "redis-cli",
];

/**
 * Diff/patch patterns.
 */
const DIFF_HEADER_RE = /^(?:diff\s+--git|index\s+[0-9a-f]+|@@\s+[-+]\d+,\d+\s+[-+]\d+,\d+\s+@@)/gm;

const PATCH_LINE_RE = /^[+\-]\s/gm;

// ---------------------------------------------------------------------------
// extractCodeBlocks
// ---------------------------------------------------------------------------

/**
 * Extract all code blocks (fenced and indented) from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ language: string, code: string, sourceIndex: number, blockType: string, startLine: number, endLine: number }>}
 */
function extractCodeBlocks(session) {
  const messages = normalizeMessages(session);
  const blocks = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // --- Fenced code blocks ---
    let match;
    FENCED_BLOCK_RE.lastIndex = 0;
    while ((match = FENCED_BLOCK_RE.exec(text)) !== null) {
      const lang = (match[1] || "").trim().toLowerCase();
      const body = match[2];
      if (body.trim().length === 0) continue;

      const beforeMatch = text.slice(0, match.index);
      const startLine = beforeMatch.split("\n").length;
      const bodyLineCount = body.split("\n").length;
      const endLine = startLine + bodyLineCount + 1; // +1 for closing ```

      blocks.push({
        language: lang || "text",
        code: body,
        sourceIndex: msg._index,
        blockType: "fenced",
        startLine,
        endLine,
      });
    }

    // --- Indented code blocks ---
    INDENTED_BLOCK_RE.lastIndex = 0;
    while ((match = INDENTED_BLOCK_RE.exec(text)) !== null) {
      const body = match[1];
      // Strip the leading indent.
      const lines = body.split("\n");
      const minIndent = Math.min(
        ...lines
          .filter((l) => l.trim().length > 0)
          .map((l) => l.match(/^(\s*)/)[1].length),
      );
      const dedented = lines.map((l) => l.slice(minIndent)).join("\n");

      if (dedented.trim().length < 10) continue; // Too short to be meaningful.

      // Skip if this looks like a markdown list (bullet, numbered).
      if (/^\s*(?:[-*+]|\d+[.)])\s/.test(dedented.trimStart())) continue;

      const beforeMatch = text.slice(0, match.index);
      const startLine = beforeMatch.split("\n").length;
      const endLine = startLine + lines.length - 1;

      // Don't duplicate if this region was already captured as fenced.
      const overlap = blocks.some(
        (b) =>
          b.sourceIndex === msg._index &&
          Math.abs(b.startLine - startLine) <= 2,
      );
      if (overlap) continue;

      blocks.push({
        language: "text",
        code: dedented,
        sourceIndex: msg._index,
        blockType: "indented",
        startLine,
        endLine,
      });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// extractFileChanges
// ---------------------------------------------------------------------------

/**
 * Detect file modifications mentioned in the conversation.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ filePath: string, operation: string, code: string|null, sourceIndex: number, confidence: string }>}
 */
function extractFileChanges(session) {
  const messages = normalizeMessages(session);
  const codeBlocks = extractCodeBlocks(messages);
  const changes = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = msg.content;
    if (!text) continue;

    // Find all file paths mentioned in the message.
    const fileReferences = extractFileReferences(text);

    for (const ref of fileReferences) {
      const operation = determineFileOperation(text, ref);

      // Find code blocks near this message (same or next message).
      const nearbyBlock = findNearbyCodeBlock(codeBlocks, i, ref);

      changes.push({
        filePath: ref,
        operation,
        code: nearbyBlock ? nearbyBlock.code : null,
        sourceIndex: i,
        confidence: nearbyBlock ? "high" : "medium",
      });
    }
  }

  // Deduplicate by file path.
  const seen = new Set();
  return changes.filter((c) => {
    const key = c.filePath.toLowerCase() + "|" + c.operation;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract file path references from text.
 * @param {string} text
 * @returns {string[]}
 */
function extractFileReferences(text) {
  const seen = new Set();
  const refs = [];

  // Pattern-based extraction.
  for (const pattern of FILE_OP_PATTERNS) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      // Get the captured group (file path).
      if (match.length < 2) {
        // For patterns without a capture group, use the full match.
        const candidate = match[0].replace(/`/g, "").trim();
        if (/\.[\w]{1,8}$/.test(candidate) && !seen.has(candidate.toLowerCase())) {
          seen.add(candidate.toLowerCase());
          refs.push(candidate);
        }
        continue;
      }
      const filePath = match[1];
      if (filePath && /\.[\w]{1,8}$/.test(filePath) && !seen.has(filePath.toLowerCase())) {
        seen.add(filePath.toLowerCase());
        refs.push(filePath);
      }
    }
  }

  // General file path pattern fallback.
  FILE_PATH_RE.lastIndex = 0;
  let m;
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    const candidate = m[1];
    if (candidate && /\.\w{2,8}$/.test(candidate) && !seen.has(candidate.toLowerCase())) {
      seen.add(candidate.toLowerCase());
      refs.push(candidate);
    }
  }

  return refs.slice(0, 20);
}

/**
 * Determine the operation being done to a file based on surrounding text.
 * @param {string} text
 * @param {string} filePath
 * @returns {string}
 */
function determineFileOperation(text, filePath) {
  // Find context around the file reference.
  const idx = text.toLowerCase().indexOf(filePath.toLowerCase());
  if (idx === -1) return "reference";

  const radius = 150;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  const context = text.slice(start, end);

  if (/\b(?:create|write|save|generate|produce|output|new)\b/i.test(context)) return "create";
  if (/\b(?:modify|update|edit|change|patch|fix|alter|rewrite|refactor)\b/i.test(context)) return "modify";
  if (/\b(?:delete|remove|drop|unlink|clean|purge)\b/i.test(context)) return "delete";
  if (/\b(?:read|open|view|inspect|examine|parse|load)\b/i.test(context)) return "read";
  if (/\b(?:run|execute|invoke|call|launch|start)\b/i.test(context)) return "execute";
  if (/\b(?:test|verify|validate|check)\b/i.test(context)) return "test";

  return "reference";
}

/**
 * Find a code block near a given message index that likely belongs to a file.
 * @param {Array} codeBlocks
 * @param {number} msgIndex
 * @param {string} filePath
 * @returns {object|null}
 */
function findNearbyCodeBlock(codeBlocks, msgIndex, filePath) {
  const fileExt = filePath.split(".").pop().toLowerCase();

  // Language extension mapping.
  const extToLang = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    sql: "sql",
    dockerfile: "dockerfile",
    toml: "toml",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
  };

  const expectedLang = extToLang[fileExt] || fileExt;

  // Prefer blocks in the same message, or the next/previous.
  const candidates = codeBlocks.filter(
    (b) =>
      Math.abs(b.sourceIndex - msgIndex) <= 1 &&
      (b.language === expectedLang || b.language === "text" || b.language === fileExt),
  );

  if (candidates.length > 0) {
    // Prefer exact language match.
    const exact = candidates.find((c) => c.language === expectedLang);
    return exact || candidates[0];
  }

  // Fallback: any nearby block.
  const nearby = codeBlocks.filter((b) => Math.abs(b.sourceIndex - msgIndex) <= 2);
  return nearby.length > 0 ? nearby[0] : null;
}

// ---------------------------------------------------------------------------
// extractCommands
// ---------------------------------------------------------------------------

/**
 * Extract shell commands from the conversation.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ command: string, sourceIndex: number, context: string, type: string }>}
 */
function extractCommands(session) {
  const messages = normalizeMessages(session);
  const commands = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // 1. Code blocks with shell language tags.
    FENCED_BLOCK_RE.lastIndex = 0;
    let match;
    while ((match = FENCED_BLOCK_RE.exec(text)) !== null) {
      const lang = (match[1] || "").trim().toLowerCase();
      if (["bash", "sh", "shell", "zsh", "powershell", "pwsh", "cmd", "bat", "fish"].includes(lang)) {
        const lines = match[2].split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
          commands.push({
            command: trimmed,
            sourceIndex: msg._index,
            context: "code-block",
            type: lang,
          });
        }
      }
    }

    // 2. Inline command prompts ($, >, #).
    COMMAND_LINE_RE.lastIndex = 0;
    while ((match = COMMAND_LINE_RE.exec(text)) !== null) {
      const cmd = match[1].trim();
      if (cmd.length < 2) continue;
      commands.push({
        command: cmd,
        sourceIndex: msg._index,
        context: "inline-prompt",
        type: "shell",
      });
    }

    // 3. Heuristic: lines that start with known shell commands.
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) continue;

      // Skip lines already captured by other methods.
      if (/^[>#$]/.test(trimmed)) continue;

      // Check if the first word is a known shell command.
      const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
      if (SHELL_COMMAND_KEYWORDS.includes(firstWord)) {
        commands.push({
          command: trimmed,
          sourceIndex: msg._index,
          context: "heuristic",
          type: "shell",
        });
      }
    }
  }

  // Deduplicate.
  const seen = new Set();
  return commands.filter((c) => {
    const key = c.command.slice(0, 80).replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// extractPatches
// ---------------------------------------------------------------------------

/**
 * Extract diff/patch content from the conversation.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ content: string, sourceIndex: number, format: string, fileCount: number }>}
 */
function extractPatches(session) {
  const messages = normalizeMessages(session);
  const patches = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // 1. Fenced code blocks with diff/patch language tags.
    FENCED_BLOCK_RE.lastIndex = 0;
    let match;
    while ((match = FENCED_BLOCK_RE.exec(text)) !== null) {
      const lang = (match[1] || "").trim().toLowerCase();
      if (["diff", "patch", "unified", "udiff"].includes(lang)) {
        const body = match[2].trim();
        if (body.length < 5) continue;

        patches.push({
          content: body,
          sourceIndex: msg._index,
          format: "diff",
          fileCount: countDiffFiles(body),
        });
      }
    }

    // 2. Inline unified diff content (starts with diff headers or @@ hunks).
    const diffSections = extractInlineDiffs(text);
    for (const section of diffSections) {
      // Avoid duplicating sections already captured in fenced blocks.
      if (isInsideFencedBlock(text, section.start)) continue;

      patches.push({
        content: section.content.trim(),
        sourceIndex: msg._index,
        format: "diff",
        fileCount: countDiffFiles(section.content),
      });
    }
  }

  return patches;
}

/**
 * Extract inline diff content from text (not inside fenced code blocks).
 * @param {string} text
 * @returns {Array<{content: string, start: number}>}
 */
function extractInlineDiffs(text) {
  const sections = [];

  // Find sections bounded by diff --git headers or @@ hunk headers.
  DIFF_HEADER_RE.lastIndex = 0;
  let match;
  while ((match = DIFF_HEADER_RE.exec(text)) !== null) {
    const start = match.index;
    // Find where this diff section ends (next blank line followed by non-diff content,
    // or next diff --git header, or end of text).
    let end = text.indexOf("\n\n", start);
    if (end === -1) end = text.length;

    // Try to extend if the following lines still look like diff content.
    const remaining = text.slice(end);
    const extension = remaining.match(/^(\n[+\- @].*)+/m);
    if (extension) {
      end += extension[0].length;
    }

    const content = text.slice(start, end);
    // Use a fresh regex for the test to avoid corrupting the outer exec() loop.
    const headerCheck = new RegExp(DIFF_HEADER_RE.source, DIFF_HEADER_RE.flags);
    const lineCheck = new RegExp(PATCH_LINE_RE.source, PATCH_LINE_RE.flags);
    if (headerCheck.test(content) || lineCheck.test(content)) {
      sections.push({ content, start });
    }
  }

  return sections;
}

/**
 * Check if a position falls inside a fenced code block.
 * Uses its own regex instance to avoid corrupting the shared FENCED_BLOCK_RE
 * that may be in use by an outer loop (extractPatches, extractCommands).
 * @param {string} text
 * @param {number} pos
 * @returns {boolean}
 */
function isInsideFencedBlock(text, pos) {
  const re = new RegExp(FENCED_BLOCK_RE.source, FENCED_BLOCK_RE.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const blockStart = match.index;
    const blockEnd = match.index + match[0].length;
    if (pos >= blockStart && pos < blockEnd) return true;
  }
  return false;
}

/**
 * Count the number of files referenced in a diff.
 * @param {string} diffContent
 * @returns {number}
 */
function countDiffFiles(diffContent) {
  const matches = diffContent.match(/^(?:diff\s+--git|---\s+\S+|^\+\+\+\s+\S+)/gm);
  return matches ? new Set(matches).size : 0;
}

// ---------------------------------------------------------------------------
// organizeByFile
// ---------------------------------------------------------------------------

/**
 * Group extractions by their target file path.
 *
 * @param {Array} extractions - array of extraction results from the methods above
 * @returns {Map<string, Array>} map of filePath -> array of related extractions
 */
function organizeByFile(extractions) {
  const byFile = new Map();

  for (const item of extractions) {
    // Items may have filePath (from extractFileChanges) or be associated via context.
    const filePath = item.filePath || item.file || item.target || "unknown";

    if (!byFile.has(filePath)) {
      byFile.set(filePath, []);
    }
    byFile.get(filePath).push(item);
  }

  return byFile;
}

// ---------------------------------------------------------------------------
// generateScript
// ---------------------------------------------------------------------------

/**
 * Generate a runnable shell script from extracted extractions.
 *
 * @param {*} extractions - single extraction object or array from the methods above
 * @returns {string} a runnable bash script
 */
function generateScript(extractions) {
  const items = Array.isArray(extractions) ? extractions : [extractions];
  const lines = [];

  lines.push("#!/usr/bin/env bash");
  lines.push("# Auto-generated script from conversation extraction");
  lines.push("# Generated: " + new Date().toISOString());
  lines.push("set -euo pipefail");
  lines.push("");

  let hasContent = false;

  for (const item of items) {
    // Commands.
    if (item.command) {
      lines.push("# Command from message index " + (item.sourceIndex || "?"));
      lines.push(item.command);
      lines.push("");
      hasContent = true;
    }

    // Code block associated with a file.
    if (item.code && item.filePath) {
      const ext = item.filePath.split(".").pop();
      const commentChar = ext === "py" || ext === "rb" || ext === "sh" || ext === "yml"
        ? "#" : "//";

      lines.push(`${commentChar} --- ${item.filePath} ---`);
      lines.push(`cat > "${item.filePath}" << 'HAXEOF'`);
      lines.push(item.code);
      lines.push("HAXEOF");
      lines.push("");
      hasContent = true;
    }

    // Zero or more patch entries.
    if (item.content && item.format === "diff") {
      lines.push("# Apply patch (message index " + (item.sourceIndex || "?") + ")");
      lines.push("cat << 'HAXPATCH' | git apply --verbose --check -");
      lines.push(item.content);
      lines.push("HAXPATCH");
      lines.push("");
      hasContent = true;
    }
  }

  if (!hasContent) {
    lines.push('echo "No actionable content extracted from conversation."');
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CodeExtractor class
// ---------------------------------------------------------------------------

class CodeExtractor {
  /**
   * @param {*} session - session object with .messages or message array
   */
  constructor(session) {
    this.session = session;
    this._messages = normalizeMessages(session);
  }

  /**
   * Extract all code blocks from the session.
   * @returns {Array<{ language: string, code: string, sourceIndex: number, blockType: string, startLine: number, endLine: number }>}
   */
  extractCodeBlocks() {
    return extractCodeBlocks(this._messages);
  }

  /**
   * Detect file modifications mentioned in the session.
   * @returns {Array<{ filePath: string, operation: string, code: string|null, sourceIndex: number, confidence: string }>}
   */
  extractFileChanges() {
    return extractFileChanges(this._messages);
  }

  /**
   * Extract shell commands from the session.
   * @returns {Array<{ command: string, sourceIndex: number, context: string, type: string }>}
   */
  extractCommands() {
    return extractCommands(this._messages);
  }

  /**
   * Extract diff/patch content from the session.
   * @returns {Array<{ content: string, sourceIndex: number, format: string, fileCount: number }>}
   */
  extractPatches() {
    return extractPatches(this._messages);
  }

  /**
   * Run all extractors and organize results by file.
   * @returns {Map<string, Array>}
   */
  organizeByFile() {
    const changes = this.extractFileChanges();
    return organizeByFile(changes);
  }

  /**
   * Generate a runnable script from all extractions.
   * @returns {string}
   */
  generateScript() {
    const allExtractions = [
      ...this.extractCodeBlocks(),
      ...this.extractFileChanges(),
      ...this.extractCommands(),
      ...this.extractPatches(),
    ];
    return generateScript(allExtractions);
  }

  /**
   * Run all extractors and return a composite result.
   * @returns {{ codeBlocks: Array, fileChanges: Array, commands: Array, patches: Array, byFile: Map, script: string }}
   */
  extractAll() {
    const codeBlocks = this.extractCodeBlocks();
    const fileChanges = this.extractFileChanges();
    const commands = this.extractCommands();
    const patches = this.extractPatches();
    const byFile = organizeByFile(fileChanges);
    const allExtractions = [...codeBlocks, ...fileChanges, ...commands, ...patches];
    const script = generateScript(allExtractions);

    return { codeBlocks, fileChanges, commands, patches, byFile, script };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CodeExtractor,
  extractCodeBlocks,
  extractFileChanges,
  extractCommands,
  extractPatches,
  organizeByFile,
  generateScript,
  // Helpers exported for testing.
  _internals: {
    toText,
    normalizeMessages,
    extractFileReferences,
    determineFileOperation,
    findNearbyCodeBlock,
    extractInlineDiffs,
    isInsideFencedBlock,
    countDiffFiles,
  },
};
