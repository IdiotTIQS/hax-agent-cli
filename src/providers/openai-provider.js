"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");

const DEFAULT_MODEL = "gpt-4o";
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

class OpenAIProvider extends ChatProvider {
  constructor(options = {}) {
    super({
      name: options.name || "openai",
      model: options.model || DEFAULT_MODEL,
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      apiUrl: options.apiUrl || process.env.HAX_AGENT_API_URL || process.env.OPENAI_BASE_URL,
    });
    this.client = options.client || createOpenAIClient(this.apiKey, this.apiUrl);
    this.maxTokens = parsePositiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS);
  }

  async chat(request = {}) {
    const response = await this.runToolLoop(request);

    return {
      id: response.id,
      provider: this.name,
      model: response.model || request.model || this.model,
      role: "assistant",
      content: extractText(response.choices?.[0]?.message?.content),
      usage: response.usage || null,
      raw: response,
    };
  }

  async *stream(request = {}) {
    if (request.toolRegistry) {
      yield* this.streamToolLoop(request);
      return;
    }

    const response = await this.client.chat.completions.create(
      { ...this.createRequest(request), stream: true },
      createRequestOptions(request)
    );

    if (!response || typeof response[Symbol.asyncIterator] !== 'function') {
      yield createTextChunk(response.choices?.[0]?.message?.content || '');
      return;
    }

    for await (const chunk of response) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        yield createTextChunk(delta.content);
      }
    }
  }

  async *streamToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toOpenAIMessages(request.messages || request.prompt || "", request.system);
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    const invalidToolCalls = new Map();
    const repeatedInvalidNotices = new Map();
    const toolCallCounts = new Map();
    const lastToolName = { current: null };
    let forceTextResponse = false;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const requestPayload = this.createRequest({ ...request, messages });
      if (forceTextResponse) {
        requestPayload.tool_choice = "none";
      }
      const response = await this.client.chat.completions.create({
        ...requestPayload,
        stream: true,
      }, createRequestOptions(request));

      if (!response || typeof response[Symbol.asyncIterator] !== 'function') {
        const content = response?.choices?.[0]?.message?.content || '';
        if (content) yield createTextChunk(content);
        return;
      }

      const stream = response;

      let fullContent = "";
      let reasoningContent = "";
      let toolCalls = [];

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
        if (delta?.content) {
          fullContent += delta.content;
          if (!forceTextResponse) {
            yield createTextChunk(delta.content);
          }
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (toolCalls[tc.index]) {
              toolCalls[tc.index].function.arguments += tc.function.arguments;
            } else {
              toolCalls[tc.index] = {
                id: tc.id,
                type: tc.type,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              };
            }
          }
        }
      }

      if (toolCalls.length > 0) {
        const firstToolName = toRegistryToolName(toolCalls[0].function.name);
        if (lastToolName.current === firstToolName) {
          const count = (toolCallCounts.get(firstToolName) || 0) + 1;
          toolCallCounts.set(firstToolName, count);
          if (count >= MAX_SAME_TOOL_CALLS) {
            yield createToolLimitChunk(turn + 1, "too_many_same_tool_calls");
            yield createTextChunk(`\n\nI've called ${firstToolName} ${count} times in a row. To prevent excessive tool usage, I'll stop here. If you need more specific information, please ask me to call it again.`);
            return;
          }
        } else {
          toolCallCounts.set(firstToolName, 1);
        }
        lastToolName.current = firstToolName;
      }

      const message = {
        role: "assistant",
        content: fullContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })) : undefined,
      };

      if (reasoningContent) {
        message.reasoning_content = reasoningContent;
      }

      if (forceTextResponse || !toolRegistry || toolCalls.length === 0) {
        if (forceTextResponse && fullContent) {
          const cleanContent = fullContent.replace(/<｜｜DSML｜｜[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '').trim();
          if (cleanContent) {
            yield createTextChunk(cleanContent);
          }
        }
        messages.push(message);
        return;
      }

      if (toolCalls.some((toolCall) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(toolCall.function.name)))) {
        forceTextResponse = true;
        messages.push({
          role: "user",
          content: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or DSML/XML tags.",
        });
        continue;
      }

      messages.push(message);

      const toolResults = [];
      for (const toolCall of toolCalls) {
        const toolName = toRegistryToolName(toolCall.function.name);
        let toolInput;
        try {
          toolInput = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          toolInput = {};
        }

        const callSignature = `${toolName}:${JSON.stringify(toolInput)}`;
        const failedCount = invalidToolCalls.get(callSignature) || 0;
        const attempt = failedCount + 1;

        if (failedCount >= 2) {
          const error = "This tool call failed repeatedly with the same input. Choose a valid path or use a different tool.";
          const noticeCount = repeatedInvalidNotices.get(callSignature) || 0;
          const shouldNotice = noticeCount === 0;
          repeatedInvalidNotices.set(callSignature, noticeCount + 1);
          yield createToolResultChunk(toolName, true, error, {
            attempt,
            input: toolInput,
            repeatedInvalid: true,
            showNotice: shouldNotice,
            turn: turn + 1,
          });
          toolResults.push(createToolResultBlock(toolCall.id, true, error));

          if (noticeCount + 1 >= MAX_REPEATED_INVALID_TOOL_RESULTS) {
            yield createToolLimitChunk(turn + 1, "repeated_invalid_tool_call");
            return;
          }

          continue;
        }

        yield createToolStartChunk(toolName, toolInput, { attempt, turn: turn + 1 });
        const result = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        const isError = result.ok !== true;
        const error = isError ? (result.error?.message || result.error?.code || null) : null;
        const parsedResult = parseResultData(result.data);

        yield createToolResultChunk(toolName, isError, error, {
          attempt,
          data: parsedResult,
          durationMs: result.durationMs,
          errorCode: result.error?.code,
          input: toolInput,
          turn: turn + 1,
        });

        if (isError) {
          invalidToolCalls.set(callSignature, failedCount + 1);
        } else {
          invalidToolCalls.delete(callSignature);
        }

        const resultForModel = { ...result };
        delete resultForModel.repeatedSingleCall;
        toolResults.push(createToolResultBlock(toolCall.id, isError, JSON.stringify(resultForModel, null, 2)));

        if (result.repeatedSingleCall) {
          forceTextResponse = true;
        }
      }

      messages.push(...toolResults);
    }

    yield createToolLimitChunk(maxToolTurns);
  }

  createRequest(request = {}) {
    const toolDefinitions = createToolDefinitions(request.toolRegistry);
    const messages = toOpenAIMessages(request.messages || request.prompt || "", request.system);
    const payload = {
      model: request.model || this.model,
      max_tokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
      messages,
    };

    if (toolDefinitions.length > 0) {
      payload.tools = toolDefinitions;
    }

    return payload;
  }

  async runToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toOpenAIMessages(request.messages || request.prompt || "", request.system);
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    let response;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      response = await this.client.chat.completions.create(this.createRequest({
        ...request,
        messages,
      }));

      const message = response.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];

      if (!toolRegistry || toolCalls.length === 0) {
        return response;
      }

      messages.push(message);

      const toolResults = [];
      for (const toolCall of toolCalls) {
        const toolName = toRegistryToolName(toolCall.function.name);
        let toolInput;
        try {
          toolInput = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          toolInput = {};
        }

        const result = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        toolResults.push(createToolResultBlock(toolCall.id, result.ok !== true, JSON.stringify(result, null, 2)));
      }

      messages.push(...toolResults);
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
          name: model.name || model.id,
        }));
      }
    } catch {
      // API 端点可能不支持 models.list 或返回 404，使用预定义列表
    }

    return [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
      { id: "o1", name: "o1" },
      { id: "o3-mini", name: "o3 Mini" },
    ];
  }

  setApiUrl(apiUrl) {
    const normalizedApiUrl = super.setApiUrl(apiUrl);
    this.client = createOpenAIClient(this.apiKey, this.apiUrl);
    return normalizedApiUrl;
  }

  setApiKey(apiKey) {
    const normalizedApiKey = super.setApiKey(apiKey);
    this.client = createOpenAIClient(this.apiKey, this.apiUrl);
    return normalizedApiKey;
  }
}

function toOpenAIMessages(input, systemPrompt) {
  const messages = Array.isArray(input) ? input : normalizeMessages(input);
  const result = [];

  const systemContent = createSystemPrompt(systemPrompt);
  result.push({ role: "system", content: systemContent });

  for (const message of messages) {
    if (message == null) continue;

    if (typeof message === "string") {
      result.push({ role: "user", content: message });
      continue;
    }

    if (Array.isArray(message)) {
      result.push(...toOpenAIMessages(message));
      continue;
    }

    if (typeof message !== "object") {
      result.push({ role: "user", content: String(message) });
      continue;
    }

    if (message.role === "system") {
      result.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "user") {
      result.push({
        role: "user",
        content: Array.isArray(message.content) ? message.content : (message.content || ""),
      });
      continue;
    }

    if (message.role === "assistant") {
      const assistantMessage = {
        role: "assistant",
        content: Array.isArray(message.content) ? message.content : (message.content || null),
      };
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        assistantMessage.tool_calls = message.tool_calls;
      }
      if (message.reasoning_content) {
        assistantMessage.reasoning_content = message.reasoning_content;
      }
      result.push(assistantMessage);
      continue;
    }

    if (message.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      });
    }
  }

  return result;
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
    type: "function",
    function: {
      name: toOpenAIToolName(tool.name),
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));
}

function toOpenAIToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toRegistryToolName(name) {
  return String(name).replace(/_/g, ".");
}

function createToolResultBlock(toolCallId, isError, content) {
  return {
    tool_call_id: toolCallId,
    role: "tool",
    content: typeof content === "string" ? content : JSON.stringify(content),
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

function extractText(content) {
  if (!content) return "";
  return String(content);
}

function parseResultData(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
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
  if (value === Infinity || value === Number.POSITIVE_INFINITY) {
    return Infinity;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createOpenAIClient(apiKey, apiUrl) {
  let OpenAIModule;

  try {
    OpenAIModule = require("openai");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error("Install openai before using the OpenAI provider");
    }
    throw error;
  }

  const OpenAI = OpenAIModule.default || OpenAIModule;
  const baseURL = apiUrl || process.env.HAX_AGENT_API_URL || process.env.OPENAI_BASE_URL;
  const resolvedApiKey = apiKey || process.env.OPENAI_API_KEY;

  if (!resolvedApiKey) {
    return createMockOpenAIClient();
  }

  return new OpenAI({
    apiKey: resolvedApiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

function createMockOpenAIClient() {
  return {
    chat: {
      completions: {
        create: async () => ({
          id: "mock-openai",
          choices: [{ message: { role: "assistant", content: "OpenAI provider is configured but no API key was provided. Please set OPENAI_API_KEY or use /api-key to configure it." } }],
        }),
      },
    },
    models: {
      list: async () => ({ data: [] }),
    },
  };
}

module.exports = {
  OpenAIProvider,
};
