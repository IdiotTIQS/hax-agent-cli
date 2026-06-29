/**
 * Provider Adapter - unified protocol for streaming LLM providers.
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
 *   - ApiTextDeltaEvent       - text chunk
 *   - ApiThinkingDeltaEvent   - thinking/reasoning content
 *   - ApiToolUseStartEvent    - tool call begins
 *   - ApiToolUseDeltaEvent    - tool input chunk
 *   - ApiMessageCompleteEvent - final message with all tool_uses
 *   - ApiErrorEvent           - error occurred
 *   - ApiRetryEvent           - retrying after error
 *   - ApiUsageEvent           - token usage info
 *
 * Optional-dep strategy: @anthropic-ai/sdk and openai are loaded via lazy
 * `await import()` inside the async generator streamMessage() methods.
 */

import EventEmitter from "events";

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
} as const;

// === API Stream Events ===

class ApiTextDeltaEvent {
  type: string;
  text: string;
  constructor(text: string) { this.type = ApiStreamEventType.TEXT_DELTA; this.text = text; }
}

class ApiThinkingDeltaEvent {
  type: string;
  text: string;
  constructor(text: string) { this.type = ApiStreamEventType.THINKING_DELTA; this.text = text; }
}

class ApiToolUseStartEvent {
  type: string;
  id: string;
  name: string;
  constructor(id: string, name: string) { this.type = ApiStreamEventType.TOOL_USE_START; this.id = id; this.name = name; }
}

class ApiToolUseDeltaEvent {
  type: string;
  id: string;
  delta: string;
  constructor(id: string, delta: string) { this.type = ApiStreamEventType.TOOL_USE_DELTA; this.id = id; this.delta = delta; }
}

interface ToolUse {
  id: string;
  name: string;
  input: string | Record<string, unknown>;
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

interface ApiMessageCompleteOptions {
  toolUses?: ToolUse[];
  text?: string;
  stopReason?: string;
  usage?: UsageInfo | null;
}

class ApiMessageCompleteEvent {
  type: string;
  toolUses: ToolUse[];
  text: string;
  stopReason: string;
  usage: UsageInfo | null;

  constructor(o: ApiMessageCompleteOptions = {}) {
    this.type = ApiStreamEventType.MESSAGE_COMPLETE;
    this.toolUses = o.toolUses || [];
    this.text = o.text || "";
    this.stopReason = o.stopReason || "end_turn";
    this.usage = o.usage || null;
  }
}

class ApiErrorEvent {
  type: string;
  message: string;
  code: string;
  retryable: boolean;
  constructor(message: string, code = "UNKNOWN", retryable = false) {
    this.type = ApiStreamEventType.ERROR;
    this.message = String(message);
    this.code = code;
    this.retryable = retryable;
  }
}

class ApiRetryEvent {
  type: string;
  attempt: number;
  delayMs: number;
  reason: string;
  constructor(attempt: number, delayMs: number, reason: string) {
    this.type = ApiStreamEventType.RETRY;
    this.attempt = attempt;
    this.delayMs = delayMs;
    this.reason = reason;
  }
}

class ApiUsageEvent {
  type: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  constructor(inputTokens: number, outputTokens: number) {
    this.type = ApiStreamEventType.USAGE;
    this.inputTokens = inputTokens || 0;
    this.outputTokens = outputTokens || 0;
    this.totalTokens = this.inputTokens + this.outputTokens;
  }
}

/** Union of all stream event types yielded by streamMessage(). */
type ApiStreamEvent =
  | ApiTextDeltaEvent
  | ApiThinkingDeltaEvent
  | ApiToolUseStartEvent
  | ApiToolUseDeltaEvent
  | ApiMessageCompleteEvent
  | ApiErrorEvent
  | ApiRetryEvent
  | ApiUsageEvent;

// === API Message Request ===

interface ApiMessageRequestOptions {
  model?: string | null;
  messages?: unknown[];
  system?: string | null;
  tools?: unknown[];
  maxTokens?: number;
  signal?: AbortSignal | null;
  metadata?: Record<string, unknown>;
  thinking?: boolean;
  thinkIntensity?: string | null;
  enableCache?: boolean;
}

class ApiMessageRequest {
  model: string | null;
  messages: unknown[];
  system: string | null;
  tools: unknown[];
  maxTokens: number;
  signal: AbortSignal | null;
  metadata: Record<string, unknown>;
  thinking: boolean;
  thinkIntensity: string | null;
  enableCache: boolean;

  constructor(o: ApiMessageRequestOptions = {}) {
    this.model = o.model || null;
    this.messages = o.messages || [];
    this.system = o.system || null;
    this.tools = o.tools || [];
    this.maxTokens = o.maxTokens || 8192;
    this.signal = o.signal || null;
    this.metadata = o.metadata || {};
    this.thinking = o.thinking || false;
    this.thinkIntensity = o.thinkIntensity || null;
    this.enableCache = o.enableCache || false;
  }
}

// === Base Provider Adapter ===

interface ProviderAdapterOptions {
  name?: string;
  model?: string;
  apiKey?: string | null;
  apiUrl?: string | null;
  maxTokens?: number;
}

/**
 * Abstract base class for provider adapters.
 * Subclasses must implement streamMessage().
 */
class ProviderAdapter {
  name: string;
  model: string;
  apiKey: string | null;
  apiUrl: string | null;
  _maxTokens: number;

  constructor(o: ProviderAdapterOptions = {}) {
    this.name = o.name || "base";
    this.model = o.model || "";
    this.apiKey = o.apiKey || null;
    this.apiUrl = o.apiUrl || null;
    this._maxTokens = o.maxTokens || 8192;
  }

  /**
   * Stream a message from the LLM.
   * Must be implemented by subclasses.
   */
  async *streamMessage(_request: ApiMessageRequest): AsyncGenerator<ApiStreamEvent, void, unknown> {
    throw new Error("ProviderAdapter.streamMessage() must be implemented by subclass");
  }

  /**
   * List available models for this provider.
   */
  async listModels(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: this.model, name: this.model }];
  }

  /**
   * Get the provider's maximum context window (in tokens).
   * Override in subclass for model-specific values.
   */
  getMaxContextTokens(): number {
    return 200000; // default for Claude
  }

  /**
   * Get the recommended auto-compaction threshold.
   */
  getAutocompactThreshold(): number {
    return Math.floor(this.getMaxContextTokens() * 0.7);
  }
}

// === Anthropic Provider Adapter ===

class AnthropicProviderAdapter extends ProviderAdapter {
  constructor(o: ProviderAdapterOptions = {}) {
    super({ ...o, name: "anthropic" });
    this.apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY || null;
    this.apiUrl = o.apiUrl || "https://api.anthropic.com";
    this.model = o.model || "claude-sonnet-4-6";
  }

  async *streamMessage(request: ApiMessageRequest): AsyncGenerator<ApiStreamEvent, void, unknown> {
    // deliberate any: dynamic import of optional dep, shape unknown until runtime
    let Anthropic: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const mod = await import("@anthropic-ai/sdk") as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      Anthropic = mod.default || mod;
    } catch {
      yield new ApiErrorEvent("@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk", "MISSING_DEPENDENCY", false);
      return;
    }

    if (!this.apiKey) {
      yield new ApiErrorEvent("ANTHROPIC_API_KEY not set", "MISSING_API_KEY", false);
      return;
    }

    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.apiUrl });

    const model = request.model || this.model;
    const maxTokens = request.maxTokens || this._maxTokens;

    let text = "";
    let usage: Record<string, number> | null = null;
    const toolUses: ToolUse[] = [];
    const toolUseMap = new Map<string, { id: string; name: string; input: string }>();

    try {
      // deliberate any: Anthropic SDK body has many optional fields not worth retyping
      const body: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: this._formatMessages(request.messages),
        ...(request.system
          ? {
              system: request.enableCache
                ? [{
                    type: "text",
                    text: String(request.system),
                    cache_control: { type: "ephemeral" },
                  }]
                : String(request.system),
            }
          : {}),
        ...((request.tools as unknown[])?.length ? { tools: this._formatTools(request.tools) } : {}),
      };
      if (request.thinking) {
        body.thinking = { type: "adaptive" };
        const intensity = request.thinkIntensity;
        let effort = "high";
        if (intensity === "low" || intensity === "medium" || intensity === "high") effort = intensity;
        else if (intensity === "x-high" || intensity === "xhigh") effort = "xhigh";
        else if (intensity === "max") effort = "max";
        body.output_config = { effort };
      }
      const stream = await client.messages.create(body, { signal: request.signal });

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
              const tu = [...toolUseMap.values()].find((_t, i) => i === idx);
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
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(tu.input || "{}") as Record<string, unknown>;
        } catch (_) {
          parsedInput = {};
        }
        toolUses.push({ id: tu.id, name: tu.name, input: parsedInput });
      }

    } catch (err: unknown) {
      const e = err as { name?: string; status?: number; message?: string };
      if (e.name === "AbortError") {
        yield new ApiErrorEvent("Request aborted", "ABORTED", false);
      } else if (e.status === 429) {
        yield new ApiErrorEvent(`Rate limited: ${e.message}`, "RATE_LIMITED", true);
      } else if (typeof e.status === "number" && e.status >= 500) {
        yield new ApiErrorEvent(`Server error (${e.status}): ${e.message}`, "SERVER_ERROR", true);
      } else if (e.message?.includes("prompt is too long") || e.message?.includes("context_length_exceeded")) {
        yield new ApiErrorEvent(`Context length exceeded: ${e.message}`, "CONTEXT_TOO_LONG", false);
      } else {
        const retryable = typeof e.status === "number" && e.status >= 400 && e.status < 500;
        yield new ApiErrorEvent(e.message ?? String(err), "REQUEST_FAILED", retryable);
      }
      return;
    }

    if (usage) {
      yield new ApiUsageEvent((usage as Record<string, number>).input_tokens || 0, (usage as Record<string, number>).output_tokens || 0);
    }

    yield new ApiMessageCompleteEvent({
      toolUses,
      text,
      stopReason: toolUses.length > 0 ? "tool_use" : "end_turn",
      usage: usage ? { inputTokens: (usage as Record<string, number>).input_tokens, outputTokens: (usage as Record<string, number>).output_tokens } : null,
    });
  }

  _formatMessages(messages: unknown[]): unknown[] {
    return messages.map((m) => {
      const msg = m as { toAnthropicFormat?: () => unknown; role: string; content: unknown };
      if (msg.toAnthropicFormat) return msg.toAnthropicFormat();
      return { role: msg.role, content: msg.content };
    });
  }

  _formatTools(tools: unknown[]): unknown[] {
    return tools.map((t) => {
      const tool = t as { name: string; description?: string; input_schema?: unknown; inputSchema?: unknown };
      return {
        name: tool.name,
        description: tool.description || "",
        input_schema: tool.input_schema || tool.inputSchema || { type: "object", properties: {} },
      };
    });
  }

  getMaxContextTokens(): number {
    const modelTokens: Record<string, number> = {
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
  constructor(o: ProviderAdapterOptions = {}) {
    super({ ...o, name: o.name || "openai" });
    this.apiKey = o.apiKey || process.env.OPENAI_API_KEY || null;
    this.apiUrl = o.apiUrl || "https://api.openai.com/v1";
    this.model = o.model || "gpt-4o";
  }

  async *streamMessage(request: ApiMessageRequest): AsyncGenerator<ApiStreamEvent, void, unknown> {
    // deliberate any: dynamic import of optional dep
    let OpenAI: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const mod = await import("openai") as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      OpenAI = mod.default || mod;
    } catch {
      yield new ApiErrorEvent("openai package is not installed. Run: npm install openai", "MISSING_DEPENDENCY", false);
      return;
    }

    if (!this.apiKey) {
      yield new ApiErrorEvent("OPENAI_API_KEY not set", "MISSING_API_KEY", false);
      return;
    }

    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.apiUrl });

    const model = request.model || this.model;
    const maxTokens = request.maxTokens || this._maxTokens;

    let text = "";
    let usage: Record<string, number> | null = null;
    const toolUseMap = new Map<number, { id: string; name: string; input: string }>();
    const toolUses: ToolUse[] = [];

    try {
      // deliberate any: OpenAI SDK body has many optional fields
      const body: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        model,
        max_completion_tokens: maxTokens,
        stream: true,
        messages: this._formatMessages(request.messages, request.system),
      };

      if ((request.tools as unknown[])?.length) {
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
            const idx: number = tc.index;
            if (!toolUseMap.has(idx)) {
              const newEntry = { id: tc.id || `call_${idx}`, name: tc.function?.name || "", input: "" };
              toolUseMap.set(idx, newEntry);
              yield new ApiToolUseStartEvent(newEntry.id, tc.function?.name || "");
            }
            const tu = toolUseMap.get(idx)!;
            if (tc.id) tu.id = tc.id;
            if (tc.function?.arguments) {
              tu.input += tc.function.arguments;
              yield new ApiToolUseDeltaEvent(tu.id, tc.function.arguments);
            }
          }
        }

        if (chunk.usage) usage = chunk.usage as Record<string, number>;
      }

      // Parse completed tool uses
      for (const tu of toolUseMap.values()) {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(tu.input || "{}") as Record<string, unknown>;
        } catch (_) {
          parsedInput = {};
        }
        toolUses.push({ id: tu.id, name: tu.name, input: parsedInput });
      }

    } catch (err: unknown) {
      const e = err as { name?: string; status?: number; message?: string };
      if (e.name === "AbortError") {
        yield new ApiErrorEvent("Request aborted", "ABORTED", false);
      } else if (e.status === 429) {
        yield new ApiErrorEvent(`Rate limited: ${e.message}`, "RATE_LIMITED", true);
      } else if (typeof e.status === "number" && e.status >= 500) {
        yield new ApiErrorEvent(`Server error (${e.status}): ${e.message}`, "SERVER_ERROR", true);
      } else if (e.message?.includes("context_length_exceeded") || e.message?.includes("maximum context length")) {
        yield new ApiErrorEvent(`Context length exceeded: ${e.message}`, "CONTEXT_TOO_LONG", false);
      } else {
        const retryable = typeof e.status === "number" && e.status >= 400 && e.status < 500;
        yield new ApiErrorEvent(e.message ?? String(err), "REQUEST_FAILED", retryable);
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

  _formatMessages(messages: unknown[], systemPrompt?: string | null): unknown[] {
    const result: unknown[] = [];
    if (systemPrompt) {
      result.push({ role: "system", content: String(systemPrompt) });
    }
    for (const m of messages) {
      const msg = m as { toOpenAIFormat?: () => unknown; role: string; content: unknown };
      if (msg.toOpenAIFormat) {
        result.push(msg.toOpenAIFormat());
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
    return result;
  }

  _formatTools(tools: unknown[]): unknown[] {
    return tools.map((t) => {
      const tool = t as { name: string; description?: string; input_schema?: unknown; inputSchema?: unknown };
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.input_schema || tool.inputSchema || { type: "object", properties: {} },
        },
      };
    });
  }

  getMaxContextTokens(): number {
    const modelTokens: Record<string, number> = {
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

interface ProviderAdapterConfig {
  provider?: string;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  maxTokens?: number;
  name?: string;
}

/**
 * Create a provider adapter from configuration.
 */
function createProviderAdapter(config: ProviderAdapterConfig = {}, env: NodeJS.ProcessEnv = process.env): ProviderAdapter {
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

export {
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

export type { ApiStreamEvent, ToolUse, UsageInfo, ApiMessageRequestOptions, ProviderAdapterOptions, ProviderAdapterConfig };
