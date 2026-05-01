"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");

const DEFAULT_MODEL = "gemini-2.5-pro";
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

class GoogleProvider extends ChatProvider {
  constructor(options = {}) {
    super({
      name: options.name || "google",
      model: options.model || DEFAULT_MODEL,
      apiKey: options.apiKey || process.env.GOOGLE_API_KEY,
      apiUrl: options.apiUrl || process.env.HAX_AGENT_API_URL || process.env.GOOGLE_BASE_URL,
    });
    this.client = options.client || createGoogleClient(this.apiKey, this.apiUrl);
    this.maxTokens = parsePositiveNumber(options.maxTokens, DEFAULT_MAX_TOKENS);
  }

  async chat(request = {}) {
    const response = await this.runToolLoop(request);

    return {
      id: response.id || `google-${Date.now()}`,
      provider: this.name,
      model: response.modelVersion || request.model || this.model,
      role: "assistant",
      content: extractText(response.candidates?.[0]?.content?.parts),
      usage: response.usageMetadata ? {
        input_tokens: response.usageMetadata.promptTokenCount || 0,
        output_tokens: response.usageMetadata.candidatesTokenCount || 0,
      } : null,
      raw: response,
    };
  }

  async *stream(request = {}) {
    if (request.toolRegistry) {
      yield* this.streamToolLoop(request);
      return;
    }

    const response = await this.client.models.generateContentStream(this.createRequest(request));

    for await (const chunk of response) {
      const text = extractText(chunk.candidates?.[0]?.content?.parts);
      if (text) {
        yield createTextChunk(text);
      }
    }
  }

  async *streamToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const contents = toGoogleContents(request.messages || request.prompt || "");
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    const invalidToolCalls = new Map();
    const repeatedInvalidNotices = new Map();
    const toolCallCounts = new Map();
    const lastToolName = { current: null };
    let forceTextResponse = false;
    let chatHistory = [];

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const modelConfig = {
        model: request.model || this.model,
        tools: createGoogleTools(request.toolRegistry),
        systemInstruction: createSystemPrompt(request.system),
        generationConfig: {
          maxOutputTokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
        },
      };
      if (forceTextResponse) {
        modelConfig.toolConfig = {
          functionCallingConfig: {
            mode: "NONE",
          },
        };
      }
      const model = this.client.getGenerativeModel(modelConfig);

      const response = await model.generateContentStream({
        contents: [...contents, ...chatHistory],
      });

      let fullText = "";
      let functionCalls = [];

      for await (const chunk of response) {
        const text = extractText(chunk.candidates?.[0]?.content?.parts);
        if (text) {
          fullText += text;
          yield createTextChunk(text);
        }
        const fc = extractFunctionCalls(chunk.candidates?.[0]?.content?.parts);
        if (fc.length > 0) {
          functionCalls = fc;
        }
      }

      if (forceTextResponse || !toolRegistry || functionCalls.length === 0) {
        return;
      }

      if (functionCalls.some((fc) => toolRegistry.hasSingleCallResult?.(toRegistryToolName(fc.name)))) {
        forceTextResponse = true;
        chatHistory.push({
          role: "user",
          parts: [{ text: "Use the previous tool result to answer the user's request now in natural language. Do not call tools and do not output tool-call markup or XML tags." }],
        });
        continue;
      }

      if (functionCalls.length > 0) {
        const firstToolName = toRegistryToolName(functionCalls[0].name);
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

      chatHistory.push({
        role: "model",
        parts: functionCalls.length > 0
          ? functionCalls.map(fc => ({ functionCall: fc }))
          : [{ text: fullText }],
      });

      const functionResponses = [];
      for (const fc of functionCalls) {
        const toolName = toRegistryToolName(fc.name);
        const toolInput = fc.args || {};

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
          functionResponses.push({
            functionResponse: {
              name: fc.name,
              response: { error },
            },
          });

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

        yield createToolResultChunk(toolName, isError, error, {
          attempt,
          data: result.data,
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
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result: JSON.stringify(resultForModel, null, 2) },
          },
        });

        if (result.repeatedSingleCall) {
          forceTextResponse = true;
        }
      }

      chatHistory.push({
        role: "function",
        parts: functionResponses,
      });
    }

    yield createToolLimitChunk(maxToolTurns);
  }

  createRequest(request = {}) {
    return {
      model: request.model || this.model,
      contents: toGoogleContents(request.messages || request.prompt || ""),
      tools: createGoogleTools(request.toolRegistry),
      systemInstruction: createSystemPrompt(request.system),
      generationConfig: {
        maxOutputTokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
      },
    };
  }

  async runToolLoop(request = {}) {
    const toolRegistry = request.toolRegistry;
    const contents = toGoogleContents(request.messages || request.prompt || "");
    const maxToolTurns = parsePositiveNumber(request.maxToolTurns, DEFAULT_MAX_TOOL_TURNS);
    let chatHistory = [];

    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const model = this.client.getGenerativeModel({
        model: request.model || this.model,
        tools: createGoogleTools(request.toolRegistry),
        systemInstruction: createSystemPrompt(request.system),
        generationConfig: {
          maxOutputTokens: parsePositiveNumber(request.maxTokens, this.maxTokens),
        },
      });

      const response = await model.generateContent({
        contents: [...contents, ...chatHistory],
      });

      const functionCalls = extractFunctionCalls(response.candidates?.[0]?.content?.parts);

      if (!toolRegistry || functionCalls.length === 0) {
        return response;
      }

      chatHistory.push({
        role: "model",
        parts: functionCalls.map(fc => ({ functionCall: fc })),
      });

      const functionResponses = [];
      for (const fc of functionCalls) {
        const toolName = toRegistryToolName(fc.name);
        const toolInput = fc.args || {};
        const result = await toolRegistry.execute(toolName, toolInput, { root: process.cwd() });
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result: JSON.stringify(result, null, 2) },
          },
        });
      }

      chatHistory.push({
        role: "function",
        parts: functionResponses,
      });
    }

    throw new Error("Tool turn limit reached before the task was completed. Please ask me to continue.");
  }

  async listModels() {
    try {
      const response = await this.client.listModels();
      const models = Array.isArray(response.models) ? response.models : [];

      if (models.length > 0) {
        return models.map((model) => ({
          id: model.name?.replace("models/", "") || model.name,
          name: model.displayName || model.name,
        }));
      }
    } catch {
      // API 端点可能不支持 models.list 或返回 404，使用预定义列表
    }

    return [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
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

function toGoogleContents(input) {
  const messages = Array.isArray(input) ? input : normalizeMessages(input);
  const contents = [];

  for (const message of messages) {
    if (message == null) continue;

    if (typeof message === "string") {
      contents.push({ role: "user", parts: [{ text: message }] });
      continue;
    }

    if (Array.isArray(message)) {
      contents.push(...toGoogleContents(message));
      continue;
    }

    if (typeof message !== "object") {
      contents.push({ role: "user", parts: [{ text: String(message) }] });
      continue;
    }

    if (message.role === "user") {
      const content = Array.isArray(message.content)
        ? message.content.map(c => typeof c === "string" ? { text: c } : c)
        : [{ text: message.content || "" }];
      contents.push({ role: "user", parts: content });
    } else if (message.role === "assistant") {
      const content = Array.isArray(message.content)
        ? message.content.map(c => typeof c === "string" ? { text: c } : c)
        : [{ text: message.content || "" }];
      contents.push({ role: "model", parts: content });
    }
  }

  return contents;
}

function extractText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(p => p?.text)
    .map(p => p.text)
    .join("");
}

function extractFunctionCalls(parts) {
  if (!Array.isArray(parts)) return [];
  return parts
    .filter(p => p?.functionCall)
    .map(p => p.functionCall);
}

function createSystemPrompt(systemPrompt) {
  const extraPrompt = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  const basePrompt = DEFAULT_SYSTEM_PROMPT;
  return extraPrompt ? `${basePrompt}\n\n${extraPrompt}` : basePrompt;
}

function createGoogleTools(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  return [{
    functionDeclarations: toolRegistry.list().map((tool) => ({
      name: toGoogleToolName(tool.name),
      description: tool.description,
      parameters: toOpenAPISchema(tool.inputSchema),
    })),
  }];
}

function toGoogleToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, "_");
}

function toRegistryToolName(name) {
  return String(name).replace(/_/g, ".");
}

function toOpenAPISchema(schema) {
  if (!schema || schema.type !== "object") {
    return { type: "object", properties: {} };
  }
  return {
    type: schema.type || "object",
    properties: schema.properties || {},
    required: schema.required || [],
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

function createGoogleClient(apiKey, apiUrl) {
  let GoogleModule;

  try {
    GoogleModule = require("@google/generative-ai");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error("Install @google/generative-ai before using the Google provider");
    }
    throw error;
  }

  const { GoogleGenerativeAI } = GoogleModule;
  const resolvedApiKey = apiKey || process.env.GOOGLE_API_KEY;

  if (!resolvedApiKey) {
    return createMockGoogleClient();
  }

  return new GoogleGenerativeAI(resolvedApiKey);
}

function createMockGoogleClient() {
  return {
    getGenerativeModel: () => ({
      generateContent: async () => ({
        response: {
          text: () => "Google provider is configured but no API key was provided. Please set GOOGLE_API_KEY or use /api-key to configure it.",
        },
      }),
      generateContentStream: async function* () {
        yield {
          candidates: [{ content: { parts: [{ text: "Google provider is configured but no API key was provided. Please set GOOGLE_API_KEY or use /api-key to configure it." }] } }],
        };
      },
    }),
    listModels: async () => ({ models: [] }),
  };
}

module.exports = {
  GoogleProvider,
};
