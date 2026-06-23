"use strict";

/**
 * Provider Adapter — unified protocol for streaming LLM providers.
 * Ported from OpenHarness api/client.py (SupportsStreamingMessages protocol).
 *
 * Decouples the Agent Loop from specific provider implementations.
 * All providers (Anthropic, OpenAI, etc.) implement a common streaming interface.
 *
 * Architecture:
 *
 *   AgentEngine → ProviderAdapter.streamMessage(request)
 *     ├── AnthropicProviderAdapter  (native Anthropic API)
 *     ├── OpenAIProviderAdapter     (OpenAI-compatible API)
 *     └── Custom Adapters...
 *
 * Stream returns ApiStreamEvent objects:
 *   - ApiTextDeltaEvent       — text chunk
 *   - ApiThinkingDeltaEvent   — thinking/reasoning content
 *   - ApiToolUseStartEvent    — tool call begins
 *   - ApiToolUseDeltaEvent    — tool input chunk
 *   - ApiMessageCompleteEvent — final message with all tool_uses
 *   - ApiErrorEvent           — error occurred
 *   - ApiRetryEvent           — retrying after error
 *   - ApiUsageEvent           — token usage info
 */

const EventEmitter = require("events");

// === API Stream Event Types ===

const ApiStreamEventType = {
  TEXT_DELTA: "text_delta",
  THINKING_DELTA: "thinking_delta",
  TOOL_USE_START: "tool_use_start",
  TOOL_USE_DELTA: "tool_use_delta",
  MESSAGE_COMPLETE: "message_complete",
  ERROR: "error",
  RETRY: "retry",
  USAGE: "usage",
};

// === API Stream Events ===

class ApiTextDeltaEvent {
  constructor(text) { this.type = ApiStreamEventType.TEXT_DELTA; this.text = text; }
}

class ApiThinkingDeltaEvent {
  constructor(text) { this.type = ApiStreamEventType.THINKING_DELTA; this.text = text; }
}

class ApiToolUseStartEvent {
  constructor(id, name) { this.type = ApiStreamEventType.TOOL_USE_START; this.id = id; this.name = name; }
}

class ApiToolUseDeltaEvent {
  constructor(id, delta) { this.type = ApiStreamEventType.TOOL_USE_DELTA; this.id = id; this.delta = delta; }
}

class ApiMessageCompleteEvent {
  /**
   * @param {Object} options
   * @param {Object[]} [options.toolUses] — [{ id, name, input }]
   * @param {string} [options.text] — accumulated text
   * @param {string} [options.stopReason] — "end_turn" | "max_tokens" | "tool_use" | "stop_sequence"
   * @param {Object} [options.usage] — { inputTokens, outputTokens }
   */
  constructor(o = {}) {
    this.type = ApiStreamEventType.MESSAGE_COMPLETE;
    this.toolUses = o.toolUses || [];
    this.text = o.text || "";
    this.stopReason = o.stopReason || "end_turn";
    this.usage = o.usage || null;
  }
}

class ApiErrorEvent {
  constructor(message, code = "UNKNOWN", retryable = false) {
    this.type = ApiStreamEventType.ERROR;
    this.message = String(message);
    this.code = code;
    this.retryable = retryable;
  }
}

class ApiRetryEvent {
  constructor(attempt, delayMs, reason) {
    this.type = ApiStreamEventType.RETRY;
    this.attempt = attempt;
    this.delayMs = delayMs;
    this.reason = reason;
  }
}

class ApiUsageEvent {
  constructor(inputTokens, outputTokens) {
    this.type = ApiStreamEventType.USAGE;
    this.inputTokens = inputTokens || 0;
    this.outputTokens = outputTokens || 0;
    this.totalTokens = this.inputTokens + this.outputTokens;
  }
}

// === API Message Request ===

class ApiMessageRequest {
  /**
   * @param {Object} options
   * @param {string} [options.model] — model name
   * @param {Object[]} options.messages — conversation messages
   * @param {string} [options.system] — system prompt
   * @param {Object[]} [options.tools] — tool definitions [{ name, description, input_schema }]
   * @param {number} [options.maxTokens] — max completion tokens
   * @param {AbortSignal} [options.signal] — abort signal
   * @param {Object} [options.metadata] — extra metadata for the request
   */
  constructor(o = {}) {
    this.model = o.model || null;
    this.messages = o.messages || [];
    this.system = o.system || null;
    this.tools = o.tools || [];
    this.maxTokens = o.maxTokens || 8192;
    this.signal = o.signal || null;
    this.metadata = o.metadata || {};
  }
}

// === Base Provider Adapter ===

/**
 * Abstract base class for provider adapters.
 * Subclasses must implement streamMessage().
 */
class ProviderAdapter {
  constructor(o = {}) {
    this.name = o.name || "base";
    this.model = o.model || "";
    this.apiKey = o.apiKey || null;
    this.apiUrl = o.apiUrl || null;
    this._maxTokens = o.maxTokens || 8192;
  }

  /**
   * Stream a message from the LLM.
   * Must be implemented by subclasses.
   *
   * @param {ApiMessageRequest} request
   * @yields {ApiStreamEvent}
   */
  async *streamMessage(request) {
    throw new Error("ProviderAdapter.streamMessage() must be implemented by subclass");
  }

  /**
   * List available models for this provider.
   * @returns {Promise<Array<{id: string, name: string}>>}
   */
  async listModels() {
    return [{ id: this.model, name: this.model }];
  }

  /**
   * Get the provider's maximum context window (in tokens).
   * Override in subclass for model-specific values.
   */
  getMaxContextTokens() {
    return 200000; // default for Claude
  }

  /**
   * Get the recommended auto-compaction threshold.
   */
  getAutocompactThreshold() {
    return Math.floor(this.getMaxContextTokens() * 0.7);
  }
}

// === Anthropic Provider Adapter ===

class AnthropicProviderAdapter extends ProviderAdapter {
  constructor(o = {}) {
    super({ ...o, name: "anthropic" });
    this.apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY;
    this.apiUrl = o.apiUrl || "https://api.anthropic.com";
    this.model = o.model || "claude-sonnet-4-6";
  }

  async *streamMessage(request) {
    try {
      const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    } catch (e) {
      yield new ApiErrorEvent("@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk", "MISSING_DEPENDENCY", false);
      return;
    }

    if (!this.apiKey) {
      yield new ApiErrorEvent("ANTHROPIC_API_KEY not set", "MISSING_API_KEY", false);
      return;
    }

    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.apiUrl });

    const model = request.model || this.model;
    const maxTokens = request.maxTokens || this._maxTokens;

    let text = "";
    let usage = null;
    const toolUses = [];
    const toolUseMap = new Map(); // id → { name, input: "" }

    try {
      const stream = await client.messages.create({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: this._formatMessages(request.messages),
        ...(request.system ? { system: String(request.system) } : {}),
        ...(request.tools?.length ? { tools: this._formatTools(request.tools) } : {}),
      }, { signal: request.signal });

      for await (const event of stream) {
        switch (event.type) {
          case "content_block_start":
            if (event.content_block?.type === "tool_use") {
              const id = event.content_block.id;
              const name = event.content_block.name;
              toolUseMap.set(id, { id, name, input: "" });
              yield new ApiToolUseStartEvent(id, name);
            }
            break;

          case "content_block_delta":
            if (event.delta?.type === "text_delta") {
              text += event.delta.text;
              yield new ApiTextDeltaEvent(event.delta.text);
            } else if (event.delta?.type === "input_json_delta") {
              const idx = event.index;
              const tu = [...toolUseMap.values()].find((t) => {
                const toolUsesArr = [...toolUseMap.values()];
                return toolUsesArr.indexOf(t) === idx;
              });
              if (tu) {
                tu.input += event.delta.partial_json;
                yield new ApiToolUseDeltaEvent(tu.id, event.delta.partial_json);
              }
            }
            break;

          case "content_block_stop":
            // Tool use input is complete
            break;

          case "message_delta":
            usage = event.usage;
            break;

          case "message_stop":
            // Finalize
            break;
        }
      }

      // Parse completed tool uses
      for (const tu of toolUseMap.values()) {
        try {
          tu.input = JSON.parse(tu.input || "{}");
        } catch (_) {
          tu.input = {};
        }
        toolUses.push(tu);
      }

    } catch (err) {
      if (err.name === "AbortError") {
        yield new ApiErrorEvent("Request aborted", "ABORTED", false);
      } else if (err.status === 429) {
        yield new ApiErrorEvent(`Rate limited: ${err.message}`, "RATE_LIMITED", true);
      } else if (err.status >= 500) {
        yield new ApiErrorEvent(`Server error (${err.status}): ${err.message}`, "SERVER_ERROR", true);
      } else if (err.message?.includes("prompt is too long") || err.message?.includes("context_length_exceeded")) {
        yield new ApiErrorEvent(`Context length exceeded: ${err.message}`, "CONTEXT_TOO_LONG", false);
      } else {
        yield new ApiErrorEvent(err.message, "REQUEST_FAILED", err.status >= 400 && err.status < 500);
      }
      return;
    }

    if (usage) {
      yield new ApiUsageEvent(usage.input_tokens || 0, usage.output_tokens || 0);
    }

    yield new ApiMessageCompleteEvent({
      toolUses,
      text,
      stopReason: toolUses.length > 0 ? "tool_use" : "end_turn",
      usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : null,
    });
  }

  _formatMessages(messages) {
    return messages.map((m) => {
      if (m.toAnthropicFormat) return m.toAnthropicFormat();
      return { role: m.role, content: m.content };
    });
  }

  _formatTools(tools) {
    return tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      input_schema: t.input_schema || t.inputSchema || { type: "object", properties: {} },
    }));
  }

  getMaxContextTokens() {
    const modelTokens = {
      "claude-opus-4-7": 200000,
      "claude-sonnet-4-6": 200000,
      "claude-haiku-4-5-20251001": 200000,
      "claude-3-5-sonnet": 200000,
      "claude-3-opus": 200000,
      "claude-3-haiku": 200000,
    };
    return modelTokens[this.model] || 200000;
  }
}

// === OpenAI-compatible Provider Adapter ===

class OpenAIProviderAdapter extends ProviderAdapter {
  constructor(o = {}) {
    super({ ...o, name: o.name || "openai" });
    this.apiKey = o.apiKey || process.env.OPENAI_API_KEY;
    this.apiUrl = o.apiUrl || "https://api.openai.com/v1";
    this.model = o.model || "gpt-4o";
  }

  async *streamMessage(request) {
    try {
      require("openai");
    } catch (e) {
      yield new ApiErrorEvent("openai package is not installed. Run: npm install openai", "MISSING_DEPENDENCY", false);
      return;
    }

    if (!this.apiKey) {
      yield new ApiErrorEvent("OPENAI_API_KEY not set", "MISSING_API_KEY", false);
      return;
    }

    const OpenAI = require("openai").default || require("openai");
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.apiUrl });

    const model = request.model || this.model;
    const maxTokens = request.maxTokens || this._maxTokens;

    let text = "";
    let usage = null;
    const toolUseMap = new Map();
    const toolUses = [];

    try {
      const body = {
        model,
        max_completion_tokens: maxTokens,
        stream: true,
        messages: this._formatMessages(request.messages, request.system),
      };

      if (request.tools?.length) {
        body.tools = this._formatTools(request.tools);
      }

      const stream = await client.chat.completions.create(body, { signal: request.signal });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;

        if (delta?.content) {
          text += delta.content;
          yield new ApiTextDeltaEvent(delta.content);
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolUseMap.has(idx)) {
              toolUseMap.set(idx, { id: tc.id || `call_${idx}`, name: tc.function?.name || "", input: "" });
              yield new ApiToolUseStartEvent(toolUseMap.get(idx).id, tc.function?.name || "");
            }
            const tu = toolUseMap.get(idx);
            if (tc.id) tu.id = tc.id;
            if (tc.function?.arguments) {
              tu.input += tc.function.arguments;
              yield new ApiToolUseDeltaEvent(tu.id, tc.function.arguments);
            }
          }
        }

        if (chunk.usage) usage = chunk.usage;
      }

      // Parse completed tool uses
      for (const tu of toolUseMap.values()) {
        try {
          tu.input = JSON.parse(tu.input || "{}");
        } catch (_) {
          tu.input = {};
        }
        toolUses.push(tu);
      }

    } catch (err) {
      if (err.name === "AbortError") {
        yield new ApiErrorEvent("Request aborted", "ABORTED", false);
      } else if (err.status === 429) {
        yield new ApiErrorEvent(`Rate limited: ${err.message}`, "RATE_LIMITED", true);
      } else if (err.status >= 500) {
        yield new ApiErrorEvent(`Server error (${err.status}): ${err.message}`, "SERVER_ERROR", true);
      } else if (err.message?.includes("context_length_exceeded") || err.message?.includes("maximum context length")) {
        yield new ApiErrorEvent(`Context length exceeded: ${err.message}`, "CONTEXT_TOO_LONG", false);
      } else {
        yield new ApiErrorEvent(err.message, "REQUEST_FAILED", err.status >= 400 && err.status < 500);
      }
      return;
    }

    if (usage) {
      yield new ApiUsageEvent(usage.prompt_tokens || 0, usage.completion_tokens || 0);
    }

    yield new ApiMessageCompleteEvent({
      toolUses,
      text,
      stopReason: toolUses.length > 0 ? "tool_use" : "end_turn",
      usage: usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : null,
    });
  }

  _formatMessages(messages, systemPrompt) {
    const result = [];
    if (systemPrompt) {
      result.push({ role: "system", content: String(systemPrompt) });
    }
    for (const m of messages) {
      if (m.toOpenAIFormat) {
        result.push(m.toOpenAIFormat());
      } else {
        result.push({ role: m.role, content: m.content });
      }
    }
    return result;
  }

  _formatTools(tools) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || t.inputSchema || { type: "object", properties: {} },
      },
    }));
  }

  getMaxContextTokens() {
    const modelTokens = {
      "gpt-4o": 128000,
      "gpt-4o-mini": 128000,
      "gpt-4-turbo": 128000,
      "gpt-4": 8192,
      "gpt-3.5-turbo": 16385,
      "o1": 200000,
      "o1-mini": 128000,
      "o3-mini": 200000,
    };
    return modelTokens[this.model] || 128000;
  }
}

// === Provider Adapter Factory ===

/**
 * Create a provider adapter from configuration.
 *
 * @param {Object} config
 * @param {string} config.provider — provider name (anthropic, openai, deepseek, etc.)
 * @param {string} [config.apiKey] — API key
 * @param {string} [config.apiUrl] — API base URL
 * @param {string} [config.model] — model name
 * @param {Object} [env] — environment variables (defaults to process.env)
 * @returns {ProviderAdapter}
 */
function createProviderAdapter(config = {}, env = process.env) {
  const provider = (config.provider || env.HAX_AGENT_PROVIDER || "anthropic").toLowerCase();

  switch (provider) {
    case "anthropic":
    case "claude":
      return new AnthropicProviderAdapter({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        model: config.model,
        maxTokens: config.maxTokens,
      });

    case "openai":
    case "gpt":
      return new OpenAIProviderAdapter({
        name: "openai",
        apiKey: config.apiKey || env.OPENAI_API_KEY,
        apiUrl: config.apiUrl || "https://api.openai.com/v1",
        model: config.model || "gpt-4o",
        maxTokens: config.maxTokens,
      });

    case "deepseek":
      return new OpenAIProviderAdapter({
        name: "deepseek",
        apiKey: config.apiKey || env.DEEPSEEK_API_KEY,
        apiUrl: config.apiUrl || "https://api.deepseek.com",
        model: config.model || "deepseek-chat",
        maxTokens: config.maxTokens,
      });

    case "groq":
      return new OpenAIProviderAdapter({
        name: "groq",
        apiKey: config.apiKey || env.GROQ_API_KEY,
        apiUrl: config.apiUrl || "https://api.groq.com/openai/v1",
        model: config.model || "llama-3.3-70b-versatile",
        maxTokens: config.maxTokens,
      });

    // Generic OpenAI-compatible
    default:
      return new OpenAIProviderAdapter({
        name: provider,
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        model: config.model,
        maxTokens: config.maxTokens,
      });
  }
}

// === Exports ===

module.exports = {
  // Types
  ApiStreamEventType,

  // Events
  ApiTextDeltaEvent,
  ApiThinkingDeltaEvent,
  ApiToolUseStartEvent,
  ApiToolUseDeltaEvent,
  ApiMessageCompleteEvent,
  ApiErrorEvent,
  ApiRetryEvent,
  ApiUsageEvent,

  // Request
  ApiMessageRequest,

  // Adapters
  ProviderAdapter,
  AnthropicProviderAdapter,
  OpenAIProviderAdapter,

  // Factory
  createProviderAdapter,
};
