"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");
const {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOOL_TURNS,
  MAX_SAME_TOOL_CALLS,
  MAX_REPEATED_INVALID_TOOL_RESULTS,
  withRetry,
  parsePositiveNumber,
  createRepeatedInvalidToolResult,
  createToolStartChunk,
  createToolResultChunk,
  createToolLimitChunk,
  createThinkingChunk,
  extractToolError,
  parseToolResultContent,
  getPermissionLevel,
} = require("./shared");

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_MAX_TOKENS = 100000;

class OpenAIProvider extends ChatProvider {
  constructor(options = {}) {
    super({
      name: options.name || "openai",
      model: options.model || DEFAULT_MODEL,
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      apiUrl: options.apiUrl || process.env.OPENAI_BASE_URL,
    });
    this.client = options.client || createOpenAIClient(this.apiKey, this.apiUrl);
    this.maxTokens = parsePositiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS);
  }

  async chat(request = {}) {
    const response = await withRetry(() => this.runToolLoop(request))();
    return {
      id: response.id,
      provider: this.name,
      model: response.model || request.model || this.model,
      role: "assistant",
      content: extractText(response),
      usage: response.usage || null,
      raw: response,
    };
  }

  async *stream(request = {}) {
    if (request.toolRegistry) {
      yield* this.streamToolLoop(request);
      return;
    }

    const stream = await this.client.chat.completions.create({
      ...this.createRequest(request),
      stream: true,
    });

    for await (const chunk of stream) {
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
      let stream;
      const requestOverrides = {
        ...request,
        messages,
      };
      if (forceTextResponse) {
        requestOverrides.tools = undefined;
        requestOverrides.tool_choice = "none";
      }
      try {
        stream = await withRetry(() => this.client.chat.completions.create(this.createRequest(requestOverrides)))();
      } catch (err) {
        yield createTextChunk(`\nError: ${err.message || 'API request failed after retries'}`);
        return;
      }

      let fullContent = "";
      let finishReason = null;
      const toolCalls = new Map();
      let reasoningContent = "";

      if (stream?.[Symbol.asyncIterator]) {
        for await (const event of stream) {
          const delta = event.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
          }
          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
          }
          if (event.choices?.[0]?.finish_reason) {
            finishReason = event.choices[0].finish_reason;
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (!toolCalls.has(index)) {
                toolCalls.set(index, {
                  id: tc.id || "",
                  type: tc.type || "function",
                  function: { name: "", arguments: "" },
                });
              }
              const existing = toolCalls.get(index);
              if (tc.id) existing.id = tc.id;
              if (tc.type) existing.type = tc.type;
              if (tc.function?.name) existing.function.name += tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        }
      } else {
        const choice = stream?.choices?.[0];
        finishReason = choice?.finish_reason;
        fullContent = choice?.message?.content || "";
        reasoningContent = choice?.message?.reasoning_content || "";
        if (choice?.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            toolCalls.set(toolCalls.size, tc);
          }
        }
      }

      if (fullContent) {
        yield createTextChunk(fullContent);
      }

      const sortedToolCalls = [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => tc);

      if (finishReason === "length" && sortedToolCalls.length === 0) {
        return;
      }

      if (!toolRegistry || sortedToolCalls.length === 0) {
        return;
      }

      if (forceTextResponse) {
        continue;
      }

      const message = {
        role: "assistant",
        content: fullContent || null,
        tool_calls: sortedToolCalls.length > 0 ? sortedToolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })) : undefined,
      };

      if (reasoningContent) {
        message.reasoning_content = reasoningContent;
      }

      messages.push(message);

      const permissionResults = await Promise.all(
        sortedToolCalls.map(async (tc) => {
          const toolName = toRegistryToolName(tc.function.name);
          const level = getPermissionLevel(toolRegistry, toolName);
          if (level === "allow") {
            return null;
          }
          const toolInput = parseToolInput(tc.function.arguments);
          return { tc, toolName, level, toolInput };
        })
      );

      const needsApproval = permissionResults.filter(Boolean);
      if (needsApproval.length > 0) {
        for (const { tc, toolName, level, toolInput } of needsApproval) {
          const toolResult = {
            type: "tool_result",
            tool_use_id: tc.id,
            toolName,
            requiresApproval: true,
            level,
            input: toolInput,
            description: tc.function?.description,
          };
          yield toolResult;
        }
        return;
      }

      for (const tc of sortedToolCalls) {
        const toolName = toRegistryToolName(tc.function.name);

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
      }

      const toolResults = [];
      for (const tc of sortedToolCalls) {
        const toolName = toRegistryToolName(tc.function.name);
        const toolInput = parseToolInput(tc.function.arguments);
        const callSignature = `${toolName}:${JSON.stringify(toolInput)}`;
        const failedCount = invalidToolCalls.get(callSignature) || 0;
        const attempt = failedCount + 1;

        if (failedCount >= 2) {
          const toolResult = createRepeatedInvalidToolResult({ id: tc.id, name: tc.function.name }, (n) => toRegistryToolName(n));
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
          toolResults.push(createToolResultBlock(tc.id, true, toolResult.content));

          if (noticeCount + 1 >= MAX_REPEATED_INVALID_TOOL_RESULTS) {
            yield createToolLimitChunk(turn + 1, "repeated_invalid_tool_call");
            return;
          }

          continue;
        }

        yield createToolStartChunk(toolName, toolInput, { attempt, turn: turn + 1 });
        const registryResult = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        const isError = registryResult.ok !== true;
        const toolError = isError ? (registryResult.error?.message || registryResult.error?.code || null) : null;
        const parsedResult = parseResultData(registryResult.data);

        yield createToolResultChunk(toolName, isError, toolError, {
          attempt,
          data: parsedResult,
          durationMs: registryResult.durationMs,
          errorCode: registryResult.error?.code,
          input: toolInput,
          turn: turn + 1,
        });

        if (isError) {
          invalidToolCalls.set(callSignature, failedCount + 1);
        } else {
          invalidToolCalls.delete(callSignature);
        }

        const resultForModel = { ...registryResult };
        delete resultForModel.repeatedSingleCall;
        toolResults.push(createToolResultBlock(tc.id, isError, JSON.stringify(resultForModel, null, 2)));

        if (registryResult.repeatedSingleCall) {
          forceTextResponse = true;
        }
      }

      messages.push(...toolResults);

      if (sortedToolCalls.some((tc) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(tc.function.name)))) {
        forceTextResponse = true;
        messages.push({
          role: "user",
          content: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or DSML/XML tags.",
        });
        continue;
      }
    }

    yield createToolLimitChunk(maxToolTurns);
  }

  createRequest(request = {}) {
    const isPreFormatted = Array.isArray(request.messages) &&
      request.messages.length > 0 &&
      request.messages[0]?.role === "system";
    const messages = isPreFormatted
      ? request.messages
      : toOpenAIMessages(request.messages || request.prompt || "", request.system);
    const toolDefinitions = createToolDefinitions(request.toolRegistry);

    const payload = {
      model: request.model || this.model,
      max_tokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
      messages,
      stream: !!request.stream,
    };

    if (toolDefinitions.length > 0) {
      payload.tools = toolDefinitions;
    }

    if (request.tool_choice) {
      payload.tool_choice = request.tool_choice;
    }

    if (request.signal) {
      payload.signal = request.signal;
    }

    return payload;
  }

  async runToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const messages = toOpenAIMessages(request.messages || request.prompt || "", request.system);
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    let forceTextResponse = false;
    let response;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const requestPayload = this.createRequest({ ...request, messages });
      if (forceTextResponse) {
        requestPayload.tool_choice = "none";
      }
      response = await withRetry(() => this.client.chat.completions.create(requestPayload))();

      const message = response.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];

      if (forceTextResponse || !toolRegistry || toolCalls.length === 0) {
        return response;
      }

      messages.push(message);

      const toolResults = [];
      for (const toolCall of toolCalls) {
        const toolName = toRegistryToolName(toolCall.function.name);
        const toolInput = parseToolInput(toolCall.function.arguments);

        const result = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        toolResults.push(createToolResultBlock(toolCall.id, result.ok !== true, JSON.stringify(result, null, 2)));
      }

      messages.push(...toolResults);

      if (toolCalls.some((tc) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(tc.function.name)))) {
        forceTextResponse = true;
        messages.push({
          role: "user",
          content: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or DSML/XML tags.",
        });
        continue;
      }
    }

    throw new Error("Tool turn limit reached before the task was completed. Please ask me to continue.");
  }

  async listModels() {
    try {
      const response = await this.client.models.list();
      const models = Array.isArray(response.data) ? response.data : [];

      if (models.length > 0) {
        return models.map((model) => ({
          id: model.id,
          name: model.id,
        }));
      }
    } catch (error) {
      // API endpoint may not support models.list or returns 404, use predefined list
    }

    return [
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'o3-mini', name: 'o3-mini' },
      { id: 'codex-mini-latest', name: 'Codex Mini' },
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

function parseToolInput(argumentsRaw) {
  if (!argumentsRaw) {
    return {};
  }

  try {
    return JSON.parse(argumentsRaw);
  } catch (_error) {
    return {};
  }
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

function extractText(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
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
