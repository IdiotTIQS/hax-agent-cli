"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOOL_TURNS = Infinity;
const MAX_REPEATED_INVALID_TOOL_RESULTS = 1;
const DEFAULT_SYSTEM_PROMPT = [
  "You are Hax Agent, a local coding CLI assistant.",
  "Use tools carefully and only with valid, non-empty arguments.",
  "When a file path is uncertain, use file.glob or file.search before file.read.",
  "Never call file.read with an empty path.",
  "If a tool call fails, briefly adapt your approach instead of repeating the same failing input.",
  "Use shell.run only for allowlisted commands, with arguments passed in args rather than shell strings.",
  "Before writing a file, read the existing file when it already exists, then write the complete updated content.",
].join("\n");

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
    const response = await this.runToolLoop(request);

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
  }

  async *streamToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toAnthropicMessages(request.messages || request.prompt || "");
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    const invalidToolCalls = new Map();
    const repeatedInvalidNotices = new Map();

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const stream = this.client.messages.stream(this.createRequest({
        ...request,
        messages,
      }), createRequestOptions(request));

      for await (const event of stream) {
        const chunk = createStreamChunk(event);
        if (chunk) {
          yield chunk;
        }
      }

      const response = typeof stream.finalMessage === "function" ? await stream.finalMessage() : null;
      if (!response) {
        return;
      }

      const toolUses = extractToolUses(response.content);

      if (!toolRegistry || toolUses.length === 0) {
        return;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const toolUse of toolUses) {
        const toolName = toRegistryToolName(toolUse.name);
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
        const toolResult = await executeToolUse(toolRegistry, toolUse);
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

        toolResults.push(toolResult);
      }

      messages.push({
        role: "user",
        content: toolResults,
      });
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
      response = await this.client.messages.create(this.createRequest({
        ...request,
        messages,
      }));

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
    const page = await this.client.models.list();
    const models = Array.isArray(page.data) ? page.data : [];

    return models.map((model) => ({
      id: model.id,
      name: model.display_name || model.name || model.id,
    }));
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
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((block) => block?.type === "tool_use" && block.id && block.name);
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

function createStreamChunk(event) {
  if (event.type !== "content_block_delta") {
    return null;
  }

  if (event.delta?.type === "text_delta") {
    return createTextChunk(event.delta.text);
  }

  if (event.delta?.type === "thinking_delta" || event.delta?.type === "signature_delta") {
    return createThinkingChunk();
  }

  return null;
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
