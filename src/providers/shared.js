"use strict";

const DEFAULT_MAX_TOOL_TURNS = 500;
const MAX_SAME_TOOL_CALLS = 200;
const MAX_REPEATED_INVALID_TOOL_RESULTS = 3;

const DEFAULT_SYSTEM_PROMPT = [
  "# Role & Identity",
  "You are Hax Agent, a professional AI coding assistant with deep expertise in software development.",
  "You think like a senior engineer: deliberate, thorough, and security-conscious.",
  "",
  "# Core Principles",
  "- Always read existing files before modifying them to understand context and avoid regressions.",
  "- Preserve existing code style, conventions, and architectural patterns.",
  "- Make minimal, focused changes rather than rewriting entire files.",
  "- Explain your reasoning briefly before making significant changes.",
  "- When uncertain about file paths or code locations, use file.glob or file.search first.",
  "",
  "# Tool Usage Guidelines",
  "- Use tools carefully and only with valid, non-empty arguments.",
  "- Never call file.read with an empty path.",
  "- If a tool call fails, adapt your approach instead of repeating the same failing input.",
  "- Use shell.run only for allowlisted commands, with arguments passed in args rather than shell strings.",
  "- Before writing a file, read the existing file when it exists, then write complete updated content.",
  "- After making changes, verify correctness by reading back the modified file or running tests.",
  "- When a tool returns data (like web.fetch or web.search), use that data to answer the user. Do NOT call the same tool again.",
  "",
  "# Code Quality Standards",
  "- Write clean, readable, and well-structured code.",
  "- Follow the principle of least surprise: code should behave predictably.",
  "- Handle errors gracefully with meaningful error messages.",
  "- Avoid introducing unnecessary dependencies.",
  "- Keep functions focused and single-purpose.",
  "",
  "# Security Awareness",
  "- Never expose secrets, API keys, or credentials in code or logs.",
  "- Validate and sanitize all user inputs.",
  "- Follow least-privilege principles for file and shell operations.",
  "- Be cautious with eval(), exec(), and dynamic code execution.",
  "",
  "# Task Approach",
  "1. Understand the task by examining relevant code first.",
  "2. Plan your changes before executing them.",
  "3. Execute changes incrementally, verifying each step.",
  "4. Test your changes when test infrastructure is available.",
  "5. Summarize what you changed and why.",
  "",
  "# Communication Style",
  "- Be concise but informative in your responses.",
  "- Use code blocks with language tags for code examples.",
  "- When explaining errors, include both the cause and the fix.",
  "- Acknowledge limitations when you are uncertain about something.",
].join("\n");

function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  return async (...args) => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await fn(...args);
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        const status = err?.status || 0;
        const retryable = status >= 500 || status === 429 || !status;
        if (!retryable) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };
}

function parsePositiveNumber(value, fallback) {
  if (value === Infinity || value === Number.POSITIVE_INFINITY) {
    return Infinity;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createToolResultBlock(toolUseId, result) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: JSON.stringify(result, null, 2),
    is_error: result.ok !== true,
  };
}

function createRepeatedInvalidToolResult(toolUse, toRegistryToolName) {
  return createToolResultBlock(toolUse.id, {
    type: "tool_result",
    toolName: toRegistryToolName(toolUse.name),
    ok: false,
    error: {
      code: "REPEATED_INVALID_TOOL_CALL",
      message: "This tool call failed repeatedly with the same input. Choose a valid path or use a different tool instead of retrying the same empty arguments.",
    },
  });
}

function createToolStartChunk(name, input, metadata = {}) {
  return {
    type: "tool_start",
    name,
    input,
    displayInput: summarizeToolInput(name, input),
    ...metadata,
  };
}

function createToolResultChunk(name, isError, error, metadata = {}) {
  return {
    type: "tool_result",
    name,
    isError,
    ...(error ? { error } : {}),
    ...metadata,
  };
}

function createToolLimitChunk(maxToolTurns, reason = "max_tool_turns") {
  return {
    type: "tool_limit",
    reason,
    maxToolTurns,
  };
}

function createThinkingChunk() {
  return {
    type: "thinking",
    summary: "Thinking...",
  };
}

function extractToolError(toolResult) {
  if (!toolResult?.is_error) {
    return null;
  }

  const parsed = parseToolResultContent(toolResult);
  return parsed?.error?.message || parsed?.error?.code || null;
}

function parseToolResultContent(toolResult) {
  try {
    return JSON.parse(toolResult.content);
  } catch (_error) {
    return null;
  }
}

function summarizeToolInput(name, input) {
  const value = input && typeof input === "object" ? input : {};

  if (name === "file.read") {
    return joinInputParts([formatInputPart("file", value.path), formatInputPart("maxBytes", value.maxBytes)]);
  }

  if (name === "file.write") {
    return joinInputParts([
      formatInputPart("file", value.path),
      formatInputPart("chars", typeof value.content === "string" ? value.content.length : undefined),
      formatInputPart("maxBytes", value.maxBytes),
    ]);
  }

  if (name === "file.delete") {
    return joinInputParts([formatInputPart("file", value.path)]);
  }

  if (name === "file.glob") {
    return joinInputParts([
      formatInputPart("pattern", value.pattern),
      formatInputPart("cwd", value.cwd),
      formatInputPart("maxResults", value.maxResults),
    ]);
  }

  if (name === "file.search") {
    return joinInputParts([
      formatInputPart("query", value.query),
      formatInputPart("path", value.path),
      formatInputPart("glob", value.glob),
      formatInputPart("regex", value.regex),
    ]);
  }

  if (name === "shell.run") {
    const command = [value.command, ...(Array.isArray(value.args) ? value.args : [])].filter(Boolean).join(" ");
    return joinInputParts([
      formatInputPart("command", command),
      formatInputPart("cwd", value.cwd),
      formatInputPart("timeoutMs", value.timeoutMs),
    ]);
  }

  return joinInputParts(Object.entries(value)
    .filter(([key, item]) => isDisplayableInput(key, item))
    .slice(0, 3)
    .map(([key, item]) => formatInputPart(key, item)));
}

function isDisplayableInput(key, value) {
  return !/key|token|secret|password|content|env/i.test(key) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean");
}

function formatInputPart(key, value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const text = String(value).replace(/\s+/g, " ");
  const truncated = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return `${key}: ${truncated}`;
}

function joinInputParts(parts) {
  return parts.filter(Boolean).join(", ");
}

function getPermissionLevel(toolRegistry, toolName) {
  if (!toolRegistry?.getPermissionLevel) {
    return "allow";
  }
  return toolRegistry.getPermissionLevel(toolName);
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOOL_TURNS,
  MAX_SAME_TOOL_CALLS,
  MAX_REPEATED_INVALID_TOOL_RESULTS,
  withRetry,
  parsePositiveNumber,
  createToolResultBlock,
  createRepeatedInvalidToolResult,
  createToolStartChunk,
  createToolResultChunk,
  createToolLimitChunk,
  createThinkingChunk,
  extractToolError,
  parseToolResultContent,
  summarizeToolInput,
  isDisplayableInput,
  formatInputPart,
  joinInputParts,
  getPermissionLevel,
};
