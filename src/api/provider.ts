/**
 * Provider Clients - full provider suite matching OpenHarness registry.
 *
 * Supported: Anthropic, OpenAI, DeepSeek, Groq, Mistral, Google, Moonshot,
 *            Zhipu, DashScope, Ollama, vLLM, OpenRouter
 */

import fs from "fs";
import path from "path";
import os from "os";
import { withRetry } from "./retry.js";

// === Stream request interface ===

interface StreamRequest {
  model?: string;
  maxTokens?: number;
  messages?: RawMessage[];
  system?: string;
  tools?: ToolDefinition[];
  thinking?: boolean;
  thinkIntensity?: string | number;
  enableCache?: boolean;
  signal?: AbortSignal;
}

interface RawMessage {
  role: string;
  content: unknown;
  tool_uses?: ToolUseBlock[];
  reasoning_content?: string;
  reasoningContent?: string;
}

interface ToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

interface ToolUseBlock {
  id: string;
  name: string;
  input: unknown;
}

// === Options interfaces ===

interface BaseOpenAICompatibleOptions {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  name?: string;
  maxTokens?: number;
}

interface AnthropicProviderOptions {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  maxTokens?: number;
}

// === Base OpenAI-compatible client ===

class BaseOpenAICompatible {
  apiKey: string | undefined;
  apiUrl: string | undefined;
  model: string | undefined;
  name: string | undefined;
  maxTokens: number;

  constructor(o: BaseOpenAICompatibleOptions = {}) {
    this.apiKey = o.apiKey;
    this.apiUrl = o.apiUrl;
    this.model = o.model;
    this.name = o.name;
    this.maxTokens = o.maxTokens || 8192;
  }

  async *stream(req: StreamRequest = {}): AsyncGenerator<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("openai")) as any;
    const OpenAI = mod.default || mod;
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.apiUrl });
    const model = req.model || this.model;
    if (!model) throw new Error(`${this.name}: model is required`);
    let text = "";
    let usage: Record<string, unknown> | null = null;

    // Sanitize tool names for providers that reject dots (DeepSeek, Groq, etc.)
    const nameMap: Record<string, string> = {}; // sanitized → original
    const tools = (req.tools || []).map(t => {
      const sanitized = (t.name || "").replace(/\./g, "_");
      if (sanitized !== t.name) nameMap[sanitized] = t.name;
      return { type: "function", function: { name: sanitized, description: t.description, parameters: t.input_schema } };
    });

    // Accumulate tool calls from streaming deltas
    const toolCallAcc: Record<number, { id: string; name: string; arguments: string }> = {};

    try {
      const body: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens || this.maxTokens,
        stream: true,
        messages: this._toMessages(req.messages || [], req.system),
      };
      if (tools.length) body["tools"] = tools;
      if (req.thinking) {
        const intensity = typeof req.thinkIntensity === "number" ? "high" : (req.thinkIntensity || "high");
        // DeepSeek V4: reasoning_effort is standard, thinking goes in extra_body
        if (intensity === "max" || intensity === "x-high") body["reasoning_effort"] = "max";
        else body["reasoning_effort"] = "high";
        body["extra_body"] = { thinking: { type: "enabled" } };
      }

      const stream = await withRetry(() => client.chat.completions.create(body, { signal: req.signal }));

      for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
        const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.["delta"] as Record<string, unknown> | undefined;
        if (delta?.["content"]) {
          const content = delta["content"] as string;
          text += content;
          yield { type: "text", delta: content };
        }
        // DeepSeek V4 thinking content - check multiple possible field names
        const thinkDelta =
          (delta?.["reasoning_content"] as string | undefined) ||
          (delta?.["thinking"] as string | undefined) ||
          (delta?.["reasoning"] as string | undefined) ||
          (delta?.["think"] as string | undefined);
        if (thinkDelta) { yield { type: "thinking", delta: thinkDelta }; }
        if (delta?.["tool_calls"]) {
          for (const tc of delta["tool_calls"] as Array<Record<string, unknown>>) {
            const idx = tc["index"] as number;
            if (!toolCallAcc[idx]) {
              const fn = tc["function"] as Record<string, unknown> | undefined;
              toolCallAcc[idx] = {
                id: (tc["id"] as string) || "",
                name: (fn?.["name"] as string) || "",
                arguments: "",
              };
            }
            const acc = toolCallAcc[idx];
            if (tc["id"]) acc.id = tc["id"] as string;
            const fn = tc["function"] as Record<string, unknown> | undefined;
            if (fn?.["name"]) acc.name = fn["name"] as string;
            if (fn?.["arguments"]) acc.arguments += fn["arguments"] as string;
          }
        }
        if (chunk["usage"]) usage = chunk["usage"] as Record<string, unknown>;
      }
    } catch (err: unknown) {
      yield { type: "error", message: (err as Error).message };
      return;
    }

    if (usage) yield {
      type: "usage",
      inputTokens: (usage["prompt_tokens"] as number) || 0,
      outputTokens: (usage["completion_tokens"] as number) || 0,
    };

    // Build tool_uses with reverse name mapping
    const toolUses = Object.values(toolCallAcc).map(tc => {
      let input: unknown = {};
      try { input = JSON.parse(tc.arguments || "{}"); } catch (_) {}
      return { id: tc.id, name: nameMap[tc.name] || tc.name, input };
    });

    yield { type: "tool_uses", toolUses, text, usage };
  }

  _toMessages(msgs: RawMessage[], system?: string): Array<Record<string, unknown>> {
    const arr: Array<Record<string, unknown>> = system ? [{ role: "system", content: system }] : [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const msg: Record<string, unknown> = { role: m.role, content };
      // Critical for DeepSeek V4: reasoning_content must be passed back for tool-call turns
      if (m.reasoning_content) {
        msg["reasoning_content"] = m.reasoning_content;
      } else if (m.role === "assistant" && m.reasoningContent) {
        msg["reasoning_content"] = m.reasoningContent;
      }
      arr.push(msg);
    }
    return arr;
  }

  async listModels(): Promise<Array<{ id: string; name: string | undefined }>> {
    return [{ id: this.model || "", name: this.model }];
  }
}

// === Anthropic ===

class AnthropicProvider {
  apiKey: string | undefined;
  apiUrl: string;
  model: string;
  maxTokens: number;
  /** Sanitized→original tool-name map, set per request in _buildRequestBody. */
  _toolNameMap: Record<string, string> | null = null;

  constructor(o: AnthropicProviderOptions = {}) {
    this.apiKey = o.apiKey || process.env["ANTHROPIC_API_KEY"];
    this.apiUrl = o.apiUrl || "https://api.anthropic.com";
    this.model = o.model || "claude-sonnet-4-6";
    this.maxTokens = o.maxTokens || 8192;
  }

  get name(): string { return "anthropic"; }

  async *stream(req: StreamRequest = {}): AsyncGenerator<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("@anthropic-ai/sdk")) as any;
    const Anthropic = mod.default || mod;
    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.apiUrl });
    let text = "";
    let usage: Record<string, unknown> | null = null;

    // Accumulate native tool_use blocks keyed by content_block index
    const nativeToolUses: Record<number, { id: string; name: string; input_acc: string }> = {};

    try {
      const stream = await withRetry(() => client.messages.create(
        this._buildRequestBody(req),
        { signal: req.signal }
      ));

      for await (const e of stream as AsyncIterable<Record<string, unknown>>) {
        if (e["type"] === "content_block_start") {
          const cb = e["content_block"] as Record<string, unknown> | undefined;
          if (cb?.["type"] === "tool_use") {
            const idx = e["index"] as number;
            nativeToolUses[idx] = {
              id: cb["id"] as string,
              name: cb["name"] as string,
              input_acc: "",
            };
            yield { type: "thinking" }; // UI hint
          }
        } else if (e["type"] === "content_block_delta") {
          const delta = e["delta"] as Record<string, unknown> | undefined;
          if (delta?.["type"] === "text_delta") {
            const t = delta["text"] as string;
            text += t;
            yield { type: "text", delta: t };
          } else if (delta?.["type"] === "input_json_delta") {
            const idx = e["index"] as number;
            if (nativeToolUses[idx]) {
              nativeToolUses[idx].input_acc += (delta["partial_json"] as string) || "";
            }
          }
        } else if (e["type"] === "message_delta") {
          usage = e["usage"] as Record<string, unknown>;
        }
      }
    } catch (err: unknown) {
      yield { type: "error", message: (err as Error).message };
      return;
    }

    if (usage) yield {
      type: "usage",
      inputTokens: (usage["input_tokens"] as number) || 0,
      outputTokens: (usage["output_tokens"] as number) || 0,
      cache_creation_input_tokens: (usage["cache_creation_input_tokens"] as number) || 0,
      cache_read_input_tokens: (usage["cache_read_input_tokens"] as number) || 0,
    };

    // Prefer native tool_use; fall back to DSML when text contains DSML invokes
    const nameMap = this._toolNameMap || {};
    const nativeUses = Object.values(nativeToolUses).map(t => {
      let input: unknown = {};
      try { input = JSON.parse(t.input_acc || "{}"); } catch (_) {}
      // Reverse the sanitized name (file_write → file.write) so the engine
      // finds the tool in the registry.
      return { id: t.id, name: nameMap[t.name] || t.name, input };
    });

    const toolUses = nativeUses.length > 0 ? nativeUses : this._parseDsml(text);
    yield { type: "tool_uses", toolUses, text, usage };
  }

  _buildRequestBody(req: StreamRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model || this.model,
      max_tokens: req.maxTokens || this.maxTokens,
      stream: true,
      messages: this._toMessages(req.messages || []),
    };
    if (req.system) {
      if (req.enableCache) {
        body["system"] = [{
          type: "text",
          text: String(req.system),
          cache_control: { type: "ephemeral" },
        }];
      } else {
        body["system"] = String(req.system);
      }
    }
    if (req.tools?.length) {
      // Anthropic tool names must match ^[a-zA-Z0-9_-]{1,64}$ — dots are
      // rejected, so "file.write" → "file_write". Keep a reverse map so the
      // tool_use that comes back can be resolved to the registry's real name.
      const nameMap: Record<string, string> = {};
      body["tools"] = req.tools.map((t) => {
        const sanitized = (t.name || "").replace(/\./g, "_");
        if (sanitized !== t.name) nameMap[sanitized] = t.name as string;
        return { name: sanitized, description: t.description, input_schema: t.input_schema };
      });
      this._toolNameMap = nameMap;
    }
    if (req.thinking) {
      body["thinking"] = { type: "adaptive" };
      const intensity = req.thinkIntensity;
      let effort = "high";
      if (intensity === "low" || intensity === "medium" || intensity === "high") effort = intensity as string;
      else if (intensity === "x-high" || intensity === "xhigh") effort = "xhigh";
      else if (intensity === "max") effort = "max";
      body["output_config"] = { effort };
    }
    return body;
  }

  _toMessages(msgs: RawMessage[]): Array<Record<string, unknown>> {
    return msgs.map(m => {
      // user message carrying tool_result blocks → convert to Anthropic content blocks
      if (m.role === "user" && Array.isArray(m.content)) {
        const blocks = (m.content as Array<Record<string, unknown>>).map(c => {
          if (c && c["type"] === "tool_result") {
            return {
              type: "tool_result",
              tool_use_id: c["tool_use_id"],
              content: typeof c["content"] === "string" ? c["content"] : JSON.stringify(c["content"]),
            };
          }
          return c;
        });
        return { role: "user", content: blocks };
      }
      // assistant message with recorded tool_uses → restore as Anthropic blocks
      if (m.role === "assistant" && Array.isArray(m.tool_uses) && m.tool_uses.length) {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tu of m.tool_uses) {
          // Sanitize the name to match what was sent in the tools list
          // (file.write → file_write); Anthropic validates tool_use names too.
          blocks.push({ type: "tool_use", id: tu.id, name: (tu.name || "").replace(/\./g, "_"), input: tu.input });
        }
        return { role: "assistant", content: blocks };
      }
      return { role: m.role, content: m.content };
    });
  }

  _parseDsml(text: string): Array<{ id: string; name: string; input: Record<string, string> }> {
    const re = /｜｜DSML｜｜invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
    const uses: Array<{ id: string; name: string; input: Record<string, string> }> = [];
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text)) !== null) {
      const p: Record<string, string> = {};
      const pr = /｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;
      let pm: RegExpExecArray | null;
      while ((pm = pr.exec(m[2])) !== null) p[pm[1]] = pm[2].trim();
      uses.push({ id: `dsml_${Date.now()}_${i++}`, name: m[1], input: p });
    }
    return uses;
  }

  async listModels(): Promise<Array<{ id: string }>> {
    return [{ id: "claude-opus-4-7" }, { id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5-20251001" }];
  }
}

// === Provider Registry ===

interface ProviderEntry {
  cls: new (o: BaseOpenAICompatibleOptions | AnthropicProviderOptions) => BaseOpenAICompatible | AnthropicProvider;
  envKey: string | null;
  url: string;
  model: string;
  name?: string;
}

interface AliasEntry {
  alias: string;
}

type RegistryEntry = ProviderEntry | AliasEntry;

function isAlias(e: RegistryEntry): e is AliasEntry {
  return "alias" in e;
}

const REGISTRY: Record<string, RegistryEntry> = {
  anthropic:    { cls: AnthropicProvider as unknown as ProviderEntry["cls"], envKey: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com",                                      model: "claude-sonnet-4-6" },
  claude:       { alias: "anthropic" },
  openai:       { cls: BaseOpenAICompatible, envKey: "OPENAI_API_KEY",       url: "https://api.openai.com/v1",                                      model: "gpt-5.4-mini",             name: "openai" },
  gpt:          { alias: "openai" },
  deepseek:     { cls: BaseOpenAICompatible, envKey: "DEEPSEEK_API_KEY",     url: "https://api.deepseek.com",                                       model: "deepseek-v4-flash",        name: "deepseek" },
  groq:         { cls: BaseOpenAICompatible, envKey: "GROQ_API_KEY",         url: "https://api.groq.com/openai/v1",                                 model: "llama-3.3-70b-versatile",  name: "groq" },
  mistral:      { cls: BaseOpenAICompatible, envKey: "MISTRAL_API_KEY",      url: "https://api.mistral.ai/v1",                                      model: "mistral-large-latest",     name: "mistral" },
  google:       { cls: BaseOpenAICompatible, envKey: "GOOGLE_API_KEY",       url: "https://generativelanguage.googleapis.com/v1beta/openai",        model: "gemini-2.5-pro",           name: "google" },
  gemini:       { alias: "google" },
  moonshot:     { cls: BaseOpenAICompatible, envKey: "MOONSHOT_API_KEY",     url: "https://api.moonshot.cn/v1",                                     model: "moonshot-v1-8k",           name: "moonshot" },
  zhipu:        { cls: BaseOpenAICompatible, envKey: "ZHIPUAI_API_KEY",      url: "https://open.bigmodel.cn/api/paas/v4",                           model: "glm-4.5-plus",             name: "zhipu" },
  dashscope:    { cls: BaseOpenAICompatible, envKey: "DASHSCOPE_API_KEY",    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",              model: "qwen-max-latest",          name: "dashscope" },
  openrouter:   { cls: BaseOpenAICompatible, envKey: "OPENROUTER_API_KEY",   url: "https://openrouter.ai/api/v1",                                   model: "anthropic/claude-sonnet-4", name: "openrouter" },
  ollama:       { cls: BaseOpenAICompatible, envKey: null,                   url: "http://localhost:11434/v1",                                       model: "llama3.2",                 name: "ollama" },
  vllm:         { cls: BaseOpenAICompatible, envKey: null,                   url: "http://localhost:8000/v1",                                        model: "default",                  name: "vllm" },
};

interface CreateProviderConfig extends BaseOpenAICompatibleOptions {
  provider?: string;
}

function createProvider(
  cfg: CreateProviderConfig = {},
  env: NodeJS.ProcessEnv = process.env
): BaseOpenAICompatible | AnthropicProvider {
  const name = (cfg.provider || env["HAX_AGENT_PROVIDER"] || "anthropic").toLowerCase();
  let entry = REGISTRY[name];
  if (!entry) throw new Error(`Unknown provider: ${name}. Try: ${Object.keys(REGISTRY).filter(k => !isAlias(REGISTRY[k])).join(", ")}`);
  if (isAlias(entry)) entry = REGISTRY[entry.alias];

  const providerEntry = entry as ProviderEntry;
  const cls = providerEntry.cls;
  // Try: explicit cfg.apiKey → env var → saved apikeys.json
  let apiKey: string | undefined = cfg.apiKey || (providerEntry.envKey ? (env[providerEntry.envKey] ?? undefined) : undefined);
  if (!apiKey) {
    try {
      const kp = path.join(os.homedir(), ".haxagent", "apikeys.json");
      const saved = JSON.parse(fs.readFileSync(kp, "utf-8")) as Record<string, string>;
      apiKey = saved[name] || saved[providerEntry.name || ""] || undefined;
    } catch (_) {}
  }
  const apiUrl = cfg.apiUrl || providerEntry.url;
  const model = cfg.model || providerEntry.model;
  const providerName = providerEntry.name || name;

  return new cls({ apiKey, apiUrl, model, name: providerName });
}

function listProviders(): Array<{ name: string; envKey: string | null; url: string; model: string }> {
  const result: Array<{ name: string; envKey: string | null; url: string; model: string }> = [];
  for (const [n, e] of Object.entries(REGISTRY)) {
    if (isAlias(e)) continue;
    const pe = e as ProviderEntry;
    result.push({ name: n, envKey: pe.envKey, url: pe.url, model: pe.model });
  }
  return result;
}

export { createProvider, listProviders, REGISTRY, AnthropicProvider, BaseOpenAICompatible };
