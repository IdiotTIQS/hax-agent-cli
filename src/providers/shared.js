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
  "- When the user asks you to CREATE, MODIFY, or WRITE files, you MUST use file.write (or file.edit) — NEVER just paste code in a markdown block. ALWAYS write the actual file.",
  "- When the user asks you to RUN a command or install dependencies, you MUST use shell.run — NEVER just tell them the command.",
  "- Only use markdown code blocks for EXPLAINING or DISCUSSING code, NOT for delivering requested files or executing requested commands.",
  "- When explaining errors, include both the cause and the fix.",
  "- Acknowledge limitations when you are uncertain about something.",
].join("\n");

const DSML_TOOL_CALLS_PATTERN = /<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls\b[^>]*>[\s\S]*?<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>/g;
const DSML_INVOKE_PATTERN = /<\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke>/g;
const DSML_PARAMETER_PATTERN = /<\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter>/g;
const DSML_PREFIX = "<\uFF5C\uFF5CDSML\uFF5C\uFF5C";
const MAX_EMPTY_TOOL_PREAMBLE_CONTINUATIONS = 3;

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

function stripToolCallMarkup(text) {
  return String(text || "")
    .replace(DSML_TOOL_CALLS_PATTERN, "")
    .replace(/<([A-Za-z][\w.-]*)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDsmlToolCalls(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const calls = [];
  let callMatch;
  DSML_INVOKE_PATTERN.lastIndex = 0;

  while ((callMatch = DSML_INVOKE_PATTERN.exec(text)) !== null) {
    const parameters = {};
    const body = callMatch[2];
    let paramMatch;
    DSML_PARAMETER_PATTERN.lastIndex = 0;

    while ((paramMatch = DSML_PARAMETER_PATTERN.exec(body)) !== null) {
      parameters[paramMatch[1]] = parseDsmlParameterValue(paramMatch[3], paramMatch[2]);
    }

    calls.push({ name: callMatch[1], parameters });
  }

  return calls;
}

function splitPotentialDsmlPrefix(text) {
  const value = String(text || "");
  const maxLength = Math.min(value.length, DSML_PREFIX.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = value.slice(-length);
    if (DSML_PREFIX.startsWith(suffix)) {
      return {
        emit: value.slice(0, -length),
        pending: suffix,
      };
    }
  }

  return {
    emit: value,
    pending: "",
  };
}

function shouldContinueAfterToolPreamble(text, toolRegistry, count = 0) {
  if (!toolRegistry || count >= MAX_EMPTY_TOOL_PREAMBLE_CONTINUATIONS) {
    return false;
  }

  return isToolPreambleText(text);
}

function isToolPreambleText(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 220) {
    return false;
  }

  return [
    /\b(let me|i'?ll|i will|i am going to)\s+(examine|inspect|check|look|read|explore|gather|review|write|create|make|build|generate|set up|scaffold)\b/i,
    /\b(to|in order to)\s+(examine|inspect|check|understand|look into|gather)\b/i,
    /\b(directly|go ahead|now|right away)\s+(write|create)\b/i,
    /\b(writing|creating|making)\s+(the|a|an)\s+(file|project|app|server)\b/i,
    /(?:让我|我来|我将|我会|先|继续|进一步).{0,16}(?:检查|查看|读取|了解|分析|探索|浏览|确认|获取|写|创建|生成|建|搭建)/,
    /(?:检查|查看|读取|了解|分析|探索|浏览|写|创建|生成).{0,16}(?:项目|文件|代码|结构|信息|详细)/,
    /(?:直接|马上|这就|立刻|立即).{0,12}(?:写|创建|生成|建|搭建|来)/,
    /(?:好[的嘞吧啊哦]|行[的了吧]|OK|ok).{0,16}(?:写|来|创建|生成|动手)/,
    /(?:废话|当然).{0,8}(?:写|做|来)/,
    /(?:抱歉|对不起).{0,16}(?:直接|马上|这就)(?:写|来|做)/,
  ].some((pattern) => pattern.test(value));
}

function createToolPreambleContinuationPrompt() {
  return [
    "You said you would take action but did not call any tool.",
    "Do NOT describe what you plan to do — CALL a tool RIGHT NOW.",
    "Available tools include: file.read, file.write, file.edit, file.glob, file.search,",
    "shell.run, web.fetch, web.search, file.readDirectory.",
    "If the API only supports text-form tool calls, emit a valid DSML tool call.",
    `This is retry attempt. You MUST emit a tool call this time.`,
  ].join(" ");
}

function createToolPreambleLimitText() {
  return [
    "\n\nI stopped because the model repeatedly said it would inspect the project, but it did not call any available tool.",
    "Please retry, or switch to a model/provider endpoint that supports tool calls for project inspection.",
  ].join(" ");
}

function createToolPreambleFinalAnswerPrompt() {
  return [
    "Stop promising to inspect more files.",
    "Do not call tools.",
    "Using only the context and tool results already available in this conversation, give a concise final answer now.",
    "If the context is incomplete, say exactly what is missing and suggest the next concrete command or file to inspect.",
  ].join(" ");
}

function parseDsmlParameterValue(value, attributes = "") {
  const text = String(value || "");
  if (/string="false"/.test(attributes)) {
    if (/^-?\d+(?:\.\d+)?$/.test(text.trim())) {
      return Number(text);
    }
    if (text.trim() === "true") return true;
    if (text.trim() === "false") return false;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
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
  stripToolCallMarkup,
  parseDsmlToolCalls,
  splitPotentialDsmlPrefix,
  shouldContinueAfterToolPreamble,
  isToolPreambleText,
  createToolPreambleContinuationPrompt,
  createToolPreambleLimitText,
  createToolPreambleFinalAnswerPrompt,
};
