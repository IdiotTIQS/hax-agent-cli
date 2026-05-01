"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOOL_TURNS = 30;
const MAX_SAME_TOOL_CALLS = 50;
const MAX_REPEATED_INVALID_TOOL_RESULTS = 1;
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

class AnthropicProvider extends ChatProvider {
  constructor(options = {}) {
    super({
      name: options.name || "anthropic",
      model: options.model || DEFAULT_MODEL,
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
      apiUrl: options.apiUrl || process.env.HAX_AGENT_API_URL || process.env.ANTHROPIC_BASE_URL,
    });
    this.client = options.client || createAnthropicClient(this.apiKey, this.apiUrl);
    this.maxTokens = parsePositiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS);
  }

  async chat(request = {}) {
    const response = await withRetry(() => this.runToolLoop(request))();
    return {
      id: response.id,
      provider: this.name,
      model: response.model || request.model || this.model,
      role: "assistant",
      content: extractText(response.content),
      usage: response.usage || null,
      raw: response,
    };
  }

  async *stream(request = {}) {
    if (request.toolRegistry) {
      yield* this.streamToolLoop(request);
      return;
    }

    const stream = this.client.messages.stream(this.createRequest(request), createRequestOptions(request));

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield createTextChunk(event.delta.text);
      }
    }

    const response = typeof stream.finalMessage === "function" ? await stream.finalMessage() : null;
    if (response?.usage) {
      yield {
        type: "usage",
        inputTokens: response.usage.input_tokens || 0,
        outputTokens: response.usage.output_tokens || 0,
      };
    }
  }

  async *streamToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toAnthropicMessages(request.messages || request.prompt || "");
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    const invalidToolCalls = new Map();
    const repeatedInvalidNotices = new Map();
    const toolCallCounts = new Map();
    const lastToolName = { current: null };
    let forceTextResponse = false;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const requestPayload = this.createRequest({
        ...request,
        messages,
      });
      if (forceTextResponse) {
        requestPayload.tool_choice = { type: "none" };
      }

      let stream;
      try {
        stream = await withRetry(() => this.client.messages.stream(requestPayload, createRequestOptions(request)))();
      } catch (err) {
        yield createTextChunk(`\nError: ${err.message || 'API request failed after retries'}`);
        return;
      }

      let bufferedText = "";
      let hasDsmContent = false;

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          bufferedText += event.delta.text;
        } else if (event.type === "content_block_delta" && (event.delta?.type === "thinking_delta" || event.delta?.type === "signature_delta")) {
          yield createThinkingChunk();
        }
      }

      const response = typeof stream.finalMessage === "function" ? await stream.finalMessage() : null;
      if (!response) {
        if (bufferedText) {
          yield createTextChunk(bufferedText);
        }
        return;
      }

      const toolUses = extractToolUses(response.content);
      const isDsm = toolUses.some((u) => String(u.id).startsWith("dsml_"));

      if (isDsm) {
        hasDsmContent = true;
        const cleanText = bufferedText.replace(/<\uFF5C\uFF5CDSML\uFF5C\uFF5C[\s\S]*?<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>/g, "").trim();
        if (cleanText) {
          yield createTextChunk(cleanText);
        }
      } else if (bufferedText) {
        yield createTextChunk(bufferedText);
      }

      if (forceTextResponse || !toolRegistry || toolUses.length === 0) {
        return;
      }

      if (toolUses.some((toolUse) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(toolUse.name)))) {
        forceTextResponse = true;
        messages.push({
          role: "user",
          content: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or XML tags.",
        });
        continue;
      }

      if (isDsm) {
        const textWithoutDsm = bufferedText.replace(/<\uFF5C\uFF5CDSML\uFF5C\uFF5C[\s\S]*?<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>/g, "").trim();
        messages.push({
          role: "assistant",
          content: textWithoutDsm || "I'll use the available tools to help you.",
        });
      } else {
        messages.push({ role: "assistant", content: response.content });
      }

      const toolResults = [];
      for (const toolUse of toolUses) {
        const toolName = toRegistryToolName(toolUse.name);

        if (lastToolName.current === toolName) {
          const count = (toolCallCounts.get(toolName) || 0) + 1;
          toolCallCounts.set(toolName, count);
          if (count >= MAX_SAME_TOOL_CALLS) {
            yield createToolLimitChunk(turn + 1, "too_many_same_tool_calls");
            yield createTextChunk(`\n\nI've called ${toolName} ${count} times in a row. To prevent excessive tool usage, I'll stop here. If you need more specific information, please ask me to call it again.`);
            return;
          }
        } else {
          toolCallCounts.set(toolName, 1);
        }
        lastToolName.current = toolName;

        const toolInput = toolUse.input || {};
        const callSignature = `${toolName}:${JSON.stringify(toolInput)}`;
        const failedCount = invalidToolCalls.get(callSignature) || 0;
        const attempt = failedCount + 1;

        if (failedCount >= 2) {
          const toolResult = createRepeatedInvalidToolResult(toolUse);
          const toolError = extractToolError(toolResult);
          const noticeCount = repeatedInvalidNotices.get(callSignature) || 0;
          const shouldNotice = noticeCount === 0;
          repeatedInvalidNotices.set(callSignature, noticeCount + 1);
          yield createToolResultChunk(toolName, true, toolError, {
            attempt,
            input: toolInput,
            repeatedInvalid: true,
            showNotice: shouldNotice,
            turn: turn + 1,
          });
          toolResults.push(toolResult);

          if (noticeCount + 1 >= MAX_REPEATED_INVALID_TOOL_RESULTS) {
            yield createToolLimitChunk(turn + 1, "repeated_invalid_tool_call");
            return;
          }

          continue;
        }

        yield createToolStartChunk(toolName, toolInput, { attempt, turn: turn + 1 });
        const registryResult = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        const toolResult = createToolResultBlock(toolUse.id, registryResult);
        const toolError = extractToolError(toolResult);
        const parsedToolResult = parseToolResultContent(toolResult);
        yield createToolResultChunk(toolName, toolResult.is_error, toolError, {
          attempt,
          data: parsedToolResult?.data,
          durationMs: parsedToolResult?.durationMs,
          errorCode: parsedToolResult?.error?.code,
          input: toolInput,
          turn: turn + 1,
        });

        if (toolResult.is_error) {
          invalidToolCalls.set(callSignature, failedCount + 1);
        } else {
          invalidToolCalls.delete(callSignature);
        }

        if (registryResult.repeatedSingleCall) {
          forceTextResponse = true;
        }
        delete registryResult.repeatedSingleCall;

        if (isDsm) {
          toolResults.push({ toolName, isError: toolResult.is_error, content: toolResult.content });
        } else {
          toolResults.push(toolResult);
        }
      }

      if (isDsm) {
        const resultTexts = toolResults.map((r) => `[Tool: ${r.toolName || "unknown"}] ${r.is_error ? "Error" : "Result"}: ${r.content}`);
        messages.push({
          role: "user",
          content: resultTexts.join("\n\n"),
        });
      } else {
        messages.push({
          role: "user",
          content: toolResults,
        });
      }
    }

    yield createToolLimitChunk(maxToolTurns);
  }

  createRequest(request = {}) {
    const toolDefinitions = createToolDefinitions(request.toolRegistry);
    const payload = {
      model: request.model || this.model,
      system: createSystemPrompt(request.system),
      max_tokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
      messages: toAnthropicMessages(request.messages || request.prompt || ""),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    };

    if (toolDefinitions.length > 0) {
      payload.tools = toolDefinitions;
    }

    return payload;
  }

  async runToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toAnthropicMessages(request.messages || request.prompt || "");
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    let response;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      response = await withRetry(() => this.client.messages.create(this.createRequest({
        ...request,
        messages,
      })))();

      const toolUses = extractToolUses(response.content);

      if (!toolRegistry || toolUses.length === 0) {
        return response;
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: await Promise.all(toolUses.map((toolUse) => executeToolUse(toolRegistry, toolUse))),
      });
    }

    throw new Error("Tool turn limit reached before the task was completed. Please ask me to continue.");
  }

  async listModels() {
    try {
      const page = await this.client.models.list();
      const models = Array.isArray(page.data) ? page.data : [];

      if (models.length > 0) {
        return models.map((model) => ({
          id: model.id,
          name: model.display_name || model.name || model.id,
        }));
      }
    } catch (error) {
      // API endpoint may not support models.list or returns 404, use predefined list
    }

    return [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    ];
  }

  setApiUrl(apiUrl) {
    const normalizedApiUrl = super.setApiUrl(apiUrl);
    this.client = createAnthropicClient(this.apiKey, this.apiUrl);
    return normalizedApiUrl;
  }

  setApiKey(apiKey) {
    const normalizedApiKey = super.setApiKey(apiKey);
    this.client = createAnthropicClient(this.apiKey, this.apiUrl);
    return normalizedApiKey;
  }
}

function toAnthropicMessages(input) {
  const messages = Array.isArray(input) ? input : normalizeMessages(input);

  return messages.flatMap((message) => {
    if (message == null) {
      return [];
    }

    if (typeof message === "string") {
      return [{ role: "user", content: message }];
    }

    if (Array.isArray(message)) {
      return toAnthropicMessages(message);
    }

    if (typeof message !== "object") {
      return [{ role: "user", content: String(message) }];
    }

    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    return [{
      role: message.role,
      content: Array.isArray(message.content) ? message.content : normalizeMessages([message])[0]?.content || "",
    }];
  });
}

function createSystemPrompt(systemPrompt) {
  const extraPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  return extraPrompt ? `${DEFAULT_SYSTEM_PROMPT}\n\n${extraPrompt}` : DEFAULT_SYSTEM_PROMPT;
}

function createToolDefinitions(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  return toolRegistry.list().map((tool) => ({
    name: toAnthropicToolName(tool.name),
    description: tool.description,
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}

function toAnthropicToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toRegistryToolName(name) {
  return String(name).replace(/_/g, ".");
}

function extractToolUses(content) {
  if (Array.isArray(content)) {
    const nativeUses = content.filter((block) => block?.type === "tool_use" && block.id && block.name);
    if (nativeUses.length > 0) {
      return nativeUses;
    }
  }

  const text = Array.isArray(content)
    ? content.filter((block) => block?.type === "text").map((block) => block.text || "").join("")
    : "";

  const dsmlCalls = parseDsmToolCalls(text);
  if (dsmlCalls.length > 0) {
    return dsmlCalls.map((call, index) => ({
      type: "tool_use",
      id: `dsml_${Date.now()}_${index}`,
      name: call.name,
      input: call.parameters,
    }));
  }

  return [];
}

function parseDsmToolCalls(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const calls = [];
  const callPattern = /<\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke>/g;
  let callMatch;

  while ((callMatch = callPattern.exec(text)) !== null) {
    const name = callMatch[1];
    const body = callMatch[2];
    const parameters = {};
    const paramPattern = /<\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter>/g;
    let paramMatch;

    while ((paramMatch = paramPattern.exec(body)) !== null) {
      parameters[paramMatch[1]] = paramMatch[2];
    }

    calls.push({ name, parameters });
  }

  return calls;
}

async function executeToolUse(toolRegistry, toolUse) {
  const result = await toolRegistry.execute(toRegistryToolName(toolUse.name), toolUse.input || {});
  return createToolResultBlock(toolUse.id, result);
}

function createRepeatedInvalidToolResult(toolUse) {
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

function createToolResultBlock(toolUseId, result) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: JSON.stringify(result, null, 2),
    is_error: result.ok !== true,
  };
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

function extractText(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
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

function createRequestOptions(request = {}) {
  return request.signal ? { signal: request.signal } : undefined;
}

function parsePositiveNumber(value, fallback) {
  if (value === Infinity || value === Number.POSITIVE_INFINITY) {
    return Infinity;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createAnthropicClient(apiKey, apiUrl) {
  let AnthropicModule;

  try {
    AnthropicModule = require("@anthropic-ai/sdk");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error("Install @anthropic-ai/sdk before using the Anthropic provider");
    }
    throw error;
  }

  const Anthropic = AnthropicModule.default || AnthropicModule;
  const baseURL = apiUrl || process.env.HAX_AGENT_API_URL || process.env.ANTHROPIC_BASE_URL;

  return new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    ...(baseURL ? { baseURL } : {}),
  });
}

module.exports = {
  AnthropicProvider,
};
