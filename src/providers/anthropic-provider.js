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
  stripToolCallMarkup,
  parseDsmlToolCalls,
  splitPotentialDsmlPrefix,
  shouldContinueAfterToolPreamble,
  isToolPreambleText,
  createToolPreambleContinuationPrompt,
  createToolPreambleLimitText,
  createToolPreambleFinalAnswerPrompt,
} = require("./shared");

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 8192;

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
    let emptyToolPreambleContinuations = 0;
    let executedToolCount = 0;
    let forcedFinalAnswerAfterPreamble = false;

    for (let turn = 0; turn < maxToolTurns || forcedFinalAnswerAfterPreamble; turn += 1) {
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
      let streamedText = false;
      let streamedTextLength = 0;
      let suppressTextStreaming = false;
      let pendingText = "";
      const contentBlocks = [];

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          contentBlocks.push(event.content_block || { type: "text", text: "" });
        } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          bufferedText += event.delta.text;
          // Also accumulate into the last content block if it's a text block
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            lastBlock.text = (lastBlock.text || "") + event.delta.text;
          }
          if (suppressTextStreaming || containsDsmlToolMarkup(bufferedText)) {
            suppressTextStreaming = true;
            pendingText = "";
          } else {
            const safeText = pendingText + event.delta.text;
            const split = splitPotentialDsmlPrefix(safeText);
            pendingText = split.pending;
            if (split.emit) {
              streamedText = true;
              streamedTextLength += split.emit.length;
              yield createTextChunk(split.emit);
            }
          }
        } else if (event.type === "content_block_delta" && (event.delta?.type === "thinking_delta" || event.delta?.type === "signature_delta")) {
          yield createThinkingChunk();
        } else if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
          // Accumulate tool-use input JSON from stream deltas
          const lastBlock = contentBlocks[contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === "tool_use") {
            lastBlock._partialJson = (lastBlock._partialJson || "") + (event.delta.partial_json || "");
          }
        }
      }

      const response = typeof stream.finalMessage === 'function' ? await stream.finalMessage() : null;

      // Fallback: when finalMessage returns null (common with non-Anthropic
      // endpoints like DeepSeek), construct a synthetic response from accumulated
      // content blocks so tool-call extraction still works.
      let effectiveResponse;
      if (response) {
        effectiveResponse = response;
      } else if (contentBlocks.length > 0) {
        // Reconstruct from stream events: parse tool_use partial JSON
        const content = contentBlocks.map((block) => {
          if (block.type === 'tool_use' && block._partialJson) {
            try {
              return { ...block, input: JSON.parse(block._partialJson) };
            } catch (_) {
              return block;
            }
          }
          if (block.type === 'tool_use') {
            return { ...block, input: block.input || {} };
          }
          return block;
        });
        effectiveResponse = { content };
      } else if (bufferedText) {
        effectiveResponse = { content: [{ type: 'text', text: bufferedText }] };
      } else {
        effectiveResponse = null;
      }

      if (!effectiveResponse) {
        if (pendingText) {
          yield createTextChunk(pendingText);
        }
        return;
      }
      if (response?.usage) {
        yield createUsageChunk(response.usage);
      }

      const toolUses = extractToolUses(effectiveResponse.content);
      const isDsm = toolUses.some((u) => String(u.id).startsWith("dsml_"));

      if (isDsm || suppressTextStreaming) {
        hasDsmContent = true;
        const cleanText = stripToolCallMarkup(bufferedText);
        const remainingText = cleanText.slice(streamedTextLength);
        if (remainingText) {
          yield createTextChunk(remainingText);
        }
      } else if (bufferedText && !streamedText) {
        yield createTextChunk(bufferedText);
      } else if (pendingText && !containsDsmlToolMarkup(bufferedText)) {
        yield createTextChunk(pendingText);
      }

      if (forceTextResponse || !toolRegistry || toolUses.length === 0) {
        if (toolRegistry && (forceTextResponse || executedToolCount > 0 || emptyToolPreambleContinuations > 0) && isToolPreambleText(bufferedText)) {
          if (!forcedFinalAnswerAfterPreamble && (forceTextResponse || executedToolCount > 0)) {
            forcedFinalAnswerAfterPreamble = true;
            messages.push({ role: "assistant", content: bufferedText || "" });
            messages.push({ role: "user", content: createToolPreambleFinalAnswerPrompt() });
            forceTextResponse = true;
            continue;
          }
          // When forceTextResponse is already active and we've already given
          // a final-answer prompt, accept the response instead of killing it
          // as a tool preamble (fixes false positives on Chinese text like
          // "让我直接访问..." being mistaken for tool-call intent).
          if (forceTextResponse) {
            return;
          }
          yield createToolLimitChunk(turn + 1, "empty_tool_preamble");
          yield createTextChunk(createToolPreambleLimitText());
          return;
        }
        if (
          !forceTextResponse &&
          shouldContinueAfterToolPreamble(bufferedText, toolRegistry, emptyToolPreambleContinuations)
        ) {
          emptyToolPreambleContinuations += 1;
          messages.push({ role: "assistant", content: bufferedText });
          messages.push({ role: "user", content: createToolPreambleContinuationPrompt() });
          continue;
        }
        if (!forceTextResponse && toolRegistry && emptyToolPreambleContinuations > 0 && isToolPreambleText(bufferedText)) {
          yield createToolLimitChunk(turn + 1, "empty_tool_preamble");
          yield createTextChunk(createToolPreambleLimitText());
        }
        return;
      }

      emptyToolPreambleContinuations = 0;

      if (toolUses.some((toolUse) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(toolUse.name)))) {
        emptyToolPreambleContinuations += 1;
        forceTextResponse = true;
        messages.push({
          role: "user",
          content: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or XML tags.",
        });
        continue;
      }

      if (isDsm) {
        const textWithoutDsm = stripToolCallMarkup(bufferedText);
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
          const toolResult = createRepeatedInvalidToolResult(toolUse, toRegistryToolName);
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
        executedToolCount += 1;
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

      if (maxToolTurns > 1 && turn + 1 >= maxToolTurns && !forcedFinalAnswerAfterPreamble) {
        forcedFinalAnswerAfterPreamble = true;
        forceTextResponse = true;
        messages.push({ role: "user", content: createToolPreambleFinalAnswerPrompt() });
        continue;
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

  const dsmlCalls = parseDsmlToolCalls(text);
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

function containsDsmlToolMarkup(text) {
  return /<\uFF5C\uFF5CDSML\uFF5C\uFF5C/.test(String(text || ""));
}

async function executeToolUse(toolRegistry, toolUse) {
  const result = await toolRegistry.execute(toRegistryToolName(toolUse.name), toolUse.input || {});
  return createToolResultBlock(toolUse.id, result);
}

function createUsageChunk(usage) {
  return {
    type: "usage",
    inputTokens: usage.input_tokens || usage.inputTokens || 0,
    outputTokens: usage.output_tokens || usage.outputTokens || 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0,
    cacheReadInputTokens: usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0,
  };
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

function createRequestOptions(request = {}) {
  return request.signal ? { signal: request.signal } : undefined;
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
