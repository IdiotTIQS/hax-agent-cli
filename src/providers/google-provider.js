"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
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
  getPermissionLevel,
} = require("./shared");

const DEFAULT_MODEL = "gemini-2.5-flash-preview-05-20";
const DEFAULT_MAX_TOKENS = 65536;

class GoogleProvider extends ChatProvider {
  constructor(options = {}) {
    super({
      name: options.name || "google",
      model: options.model || DEFAULT_MODEL,
      apiKey: options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      apiUrl: options.apiUrl || process.env.GOOGLE_BASE_URL,
    });
    this.client = options.client || createGoogleClient(this.apiKey, this.apiUrl);
    this.maxTokens = parsePositiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS);
  }

  async chat(request = {}) {
    const response = await withRetry(() => this.runToolLoop(request))();
    return {
      id: response.responseId || undefined,
      provider: this.name,
      model: response.modelVersion || request.model || this.model,
      role: "assistant",
      content: extractText(response),
      usage: extractUsage(response),
      raw: response,
    };
  }

  async *stream(request = {}) {
    if (request.toolRegistry) {
      yield* this.streamToolLoop(request);
      return;
    }

    const { model, contents, systemInstruction, tools, generationConfig } = this.createRequest(request);
    const stream = await this.client.models.generateContentStream({
      model,
      contents,
      ...(systemInstruction ? { config: { systemInstruction } } : {}),
      ...(tools ? { tools } : {}),
      ...(generationConfig ? { generationConfig } : {}),
    });

    for await (const chunk of stream) {
      const text = chunk?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (text) {
        yield createTextChunk(text);
      }
    }
  }

  async *streamToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    const invalidToolCalls = new Map();
    const repeatedInvalidNotices = new Map();
    const toolCallCounts = new Map();
    const lastToolName = { current: null };
    let conversationHistory = [];
    let forceTextResponse = false;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      let response;
      try {
        const requestPayload = this.createRequest({
          ...request,
          messages: [...conversationHistory, ...(request.messages || (request.prompt ? [{ role: "user", content: request.prompt }] : []))],
          ...(forceTextResponse ? { toolRegistry: undefined } : {}),
        });
        const { model, contents, systemInstruction, tools, generationConfig } = requestPayload;
        response = await withRetry(() => this.client.models.generateContent({
          model,
          contents,
          ...(systemInstruction ? { config: { systemInstruction } } : {}),
          ...(tools && !forceTextResponse ? { tools } : {}),
          ...(generationConfig ? { generationConfig } : {}),
        }))();
      } catch (err) {
        yield createTextChunk(`\nError: ${err.message || 'API request failed after retries'}`);
        return;
      }

      const text = extractText(response);
      if (text) {
        yield createTextChunk(text);
      }

      const functionCalls = extractFunctionCalls(response);
      if (forceTextResponse || !toolRegistry || functionCalls.length === 0) {
        return;
      }

      if (functionCalls.some((fc) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(fc.name)))) {
        forceTextResponse = true;
        conversationHistory.push({
          role: "model",
          parts: [{ text: text || "" }],
        });
        conversationHistory.push({
          role: "user",
          parts: [{ text: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or XML tags." }],
        });
        continue;
      }

      conversationHistory.push({
        role: "model",
        parts: [
          ...(text ? [{ text }] : []),
          ...functionCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args || {} } })),
        ],
      });

      for (const fc of functionCalls) {
        const toolName = toRegistryToolName(fc.name);

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

      const permissionResults = await Promise.all(
        functionCalls.map(async (fc) => {
          const toolName = toRegistryToolName(fc.name);
          const level = getPermissionLevel(toolRegistry, toolName);
          if (level === "allow") {
            return null;
          }
          return { fc, toolName, level, toolInput: fc.args || {} };
        })
      );

      const needsApproval = permissionResults.filter(Boolean);
      if (needsApproval.length > 0) {
        for (const { fc, toolName, level, toolInput } of needsApproval) {
          const toolResult = {
            type: "tool_result",
            tool_use_id: fc.name,
            toolName,
            requiresApproval: true,
            level,
            input: toolInput,
            description: fc.description,
          };
          yield toolResult;
        }
        return;
      }

      const toolResultParts = [];
      for (const fc of functionCalls) {
        const toolName = toRegistryToolName(fc.name);
        const toolInput = fc.args || {};
        const callSignature = `${toolName}:${JSON.stringify(toolInput)}`;
        const failedCount = invalidToolCalls.get(callSignature) || 0;
        const attempt = failedCount + 1;

        if (failedCount >= 2) {
          const toolResult = createRepeatedInvalidToolResult({ id: fc.name, name: fc.name }, (n) => toRegistryToolName(n));
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
          toolResultParts.push({
            functionResponse: {
              name: fc.name,
              response: { error: toolResult.content },
            },
          });

          if (noticeCount + 1 >= MAX_REPEATED_INVALID_TOOL_RESULTS) {
            yield createToolLimitChunk(turn + 1, "repeated_invalid_tool_call");
            return;
          }

          continue;
        }

        yield createToolStartChunk(toolName, toolInput, { attempt, turn: turn + 1 });
        const registryResult = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        const toolResult = createToolResultBlock(fc.name, registryResult);
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

        toolResultParts.push({
          functionResponse: {
            name: fc.name,
            response: registryResult,
          },
        });
      }

      conversationHistory.push({
        role: "user",
        parts: toolResultParts,
      });
    }

    yield createToolLimitChunk(maxToolTurns);
  }

  createRequest(request = {}) {
    const model = request.model || this.model;
    const maxTokens = parsePositiveNumber(request.maxTokens, this.maxTokens);

    const systemPrompt = createSystemPrompt(request.system);
    const systemInstruction = systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined;

    const rawMessages = Array.isArray(request.messages) ? request.messages : (request.prompt ? [{ role: "user", content: request.prompt }] : []);
    const contents = toGeminiContents(rawMessages);

    const toolDefinitions = createToolDefinitions(request.toolRegistry);

    return {
      model,
      contents,
      systemInstruction,
      ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
      },
    };
  }

  async runToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    let conversationHistory = [];
    let response;

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const { model, contents, systemInstruction, tools, generationConfig } = this.createRequest({
        ...request,
        messages: [...conversationHistory, ...(request.messages || (request.prompt ? [{ role: "user", content: request.prompt }] : []))],
      });

      response = await withRetry(() => this.client.models.generateContent({
        model,
        contents,
        ...(systemInstruction ? { config: { systemInstruction } } : {}),
        ...(tools ? { tools } : {}),
        ...(generationConfig ? { generationConfig } : {}),
      }))();

      const functionCalls = extractFunctionCalls(response);

      if (!toolRegistry || functionCalls.length === 0) {
        return response;
      }

      const text = extractText(response);
      conversationHistory.push({
        role: "model",
        parts: [
          ...(text ? [{ text }] : []),
          ...functionCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args || {} } })),
        ],
      });

      const toolResultParts = await Promise.all(
        functionCalls.map(async (fc) => {
          const toolName = toRegistryToolName(fc.name);
          const result = await toolRegistry.execute(toolName, fc.args || {}, { root: process.cwd() });
          return {
            functionResponse: {
              name: fc.name,
              response: result,
            },
          };
        })
      );

      conversationHistory.push({
        role: "user",
        parts: toolResultParts,
      });
    }

    throw new Error("Tool turn limit reached before the task was completed. Please ask me to continue.");
  }

  async listModels() {
    try {
      const response = await this.client.models.list();
      const models = Array.isArray(response.models) ? response.models : [];

      if (models.length > 0) {
        return models.map((model) => ({
          id: model.name?.replace("models/", "") || model.name,
          name: model.displayName || model.name,
        }));
      }
    } catch (error) {
      // API endpoint may not support models.list or returns 404, use predefined list
    }

    return [
      { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
    ];
  }

  setApiUrl(apiUrl) {
    const normalizedApiUrl = super.setApiUrl(apiUrl);
    this.client = createGoogleClient(this.apiKey, this.apiUrl);
    return normalizedApiUrl;
  }

  setApiKey(apiKey) {
    const normalizedApiKey = super.setApiKey(apiKey);
    this.client = createGoogleClient(this.apiKey, this.apiUrl);
    return normalizedApiKey;
  }
}

function createSystemPrompt(systemPrompt) {
  const extraPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  return extraPrompt ? `${DEFAULT_SYSTEM_PROMPT}\n\n${extraPrompt}` : DEFAULT_SYSTEM_PROMPT;
}

function toGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    if (message == null) {
      continue;
    }

    if (typeof message === "string") {
      contents.push({ role: "user", parts: [{ text: message }] });
      continue;
    }

    if (typeof message !== "object") {
      contents.push({ role: "user", parts: [{ text: String(message) }] });
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    const parts = [];

    if (typeof message.content === "string" && message.content) {
      parts.push({ text: message.content });
    }

    if (role === "model" && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        const args = parseToolInput(tc.function?.arguments);
        parts.push({
          functionCall: {
            name: toGeminiToolName(tc.function?.name || ""),
            args,
          },
        });
      }
    }

    if (role === "user" && message.role === "tool" && message.tool_call_id) {
      parts.push({
        functionResponse: {
          name: message.tool_call_id,
          response: { content: message.content || "" },
        },
      });
      contents.push({ role: "user", parts });
      continue;
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
}

function createToolDefinitions(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  const functionDeclarations = toolRegistry.list().map((tool) => {
    const schema = tool.inputSchema || { type: "object", properties: {} };

    return {
      name: toGeminiToolName(tool.name),
      description: tool.description,
      parameters: normalizeSchemaForGemini(schema),
    };
  });

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
}

function normalizeSchemaForGemini(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT" };
  }

  const normalized = {};

  if (schema.type) {
    normalized.type = String(schema.type).toUpperCase();
  }

  if (schema.description) {
    normalized.description = schema.description;
  }

  if (schema.properties) {
    normalized.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      normalized.properties[key] = normalizeSchemaForGemini(value);
    }
  }

  if (Array.isArray(schema.required)) {
    normalized.required = schema.required;
  }

  if (schema.items) {
    normalized.items = normalizeSchemaForGemini(schema.items);
  }

  if (schema.enum) {
    normalized.enum = schema.enum;
  }

  return normalized;
}

function toGeminiToolName(name) {
  return String(name).replace(/\./g, "_");
}

function toRegistryToolName(name) {
  return String(name).replace(/_/g, ".");
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

function extractFunctionCalls(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args || {},
    }));
}

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.text)
    .map((part) => part.text)
    .join("");
}

function extractUsage(response) {
  const usage = response?.usageMetadata;
  if (!usage) {
    return null;
  }

  return {
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
  };
}

function createGoogleClient(apiKey, apiUrl) {
  let GoogleGenAIModule;

  try {
    GoogleGenAIModule = require("@google/genai");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error("Install @google/genai before using the Google provider");
    }
    throw error;
  }

  const { GoogleGenAI } = GoogleGenAIModule;
  const resolvedApiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!resolvedApiKey) {
    throw new Error("No API key provided. Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable, or use config set google.apiKey");
  }

  return new GoogleGenAI({ apiKey: resolvedApiKey });
}

module.exports = {
  GoogleProvider,
};
