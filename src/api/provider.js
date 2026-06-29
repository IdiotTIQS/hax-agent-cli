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

// === Base OpenAI-compatible client ===

class BaseOpenAICompatible {
  constructor(o = {}) { this.apiKey = o.apiKey; this.apiUrl = o.apiUrl; this.model = o.model; this.name = o.name; this.maxTokens = o.maxTokens || 8192; }

  async *stream(req = {}) {
    const mod = /** @type {any} */ (await import("openai"));
    const OpenAI = mod.default || mod;
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.apiUrl });
    const model = req.model || this.model;
    if (!model) throw new Error(`${this.name}: model is required`);
    let text = "", usage = null;

    // Sanitize tool names for providers that reject dots (DeepSeek, Groq, etc.)
    const nameMap = {}; // sanitized → original
    const tools = (req.tools || []).map(t => {
      const sanitized = (t.name || "").replace(/\./g, "_");
      if (sanitized !== t.name) nameMap[sanitized] = t.name;
      return { type: "function", function: { name: sanitized, description: t.description, parameters: t.input_schema } };
    });

    // Accumulate tool calls from streaming deltas
    const toolCallAcc = {}; // index → { id, name, arguments }

    try {
      const body = {
        model, max_tokens: req.maxTokens || this.maxTokens, stream: true,
        messages: this._toMessages(req.messages || [], req.system),
      };
      if (tools.length) body.tools = tools;
      if (req.thinking) {
        var intensity = typeof req.thinkIntensity === "number" ? "high" : (req.thinkIntensity || "high");
        // DeepSeek V4: reasoning_effort is standard, thinking goes in extra_body
        if (intensity === "max" || intensity === "x-high") body.reasoning_effort = "max";
        else body.reasoning_effort = "high";
        body.extra_body = { thinking: { type: "enabled" } };
      }

      const stream = await withRetry(() => client.chat.completions.create(body, { signal: req.signal }));

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) { text += delta.content; yield { type: "text", delta: delta.content }; }
        // DeepSeek V4 thinking content - check multiple possible field names
        var thinkDelta = delta?.reasoning_content || delta?.thinking || delta?.reasoning || delta?.think;
        if (thinkDelta) { yield { type: "thinking", delta: thinkDelta }; }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAcc[idx]) toolCallAcc[idx] = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
            const acc = toolCallAcc[idx];
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }
        if (chunk.usage) usage = chunk.usage;
      }
    } catch (err) { yield { type: "error", message: err.message }; return; }

    if (usage) yield { type: "usage", inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0 };

    // Build tool_uses with reverse name mapping
    const toolUses = Object.values(toolCallAcc).map(tc => {
      let input = {};
      try { input = JSON.parse(tc.arguments || "{}"); } catch (_) {}
      return { id: tc.id, name: nameMap[tc.name] || tc.name, input };
    });

    yield { type: "tool_uses", toolUses, text, usage };
  }

  _toMessages(msgs, system) {
    var arr = system ? [{ role: "system", content: system }] : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      var msg = { role: m.role, content: content };
      // Critical for DeepSeek V4: reasoning_content must be passed back for tool-call turns
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      } else if (m.role === "assistant" && m.reasoningContent) {
        msg.reasoning_content = m.reasoningContent;
      }
      arr.push(msg);
    }
    return arr;
  }

  async listModels() { return [{ id: this.model, name: this.model }]; }
}

// === Anthropic ===

class AnthropicProvider {
  constructor(o = {}) { this.apiKey = o.apiKey || process.env.ANTHROPIC_API_KEY; this.apiUrl = o.apiUrl || "https://api.anthropic.com"; this.model = o.model || "claude-sonnet-4-6"; this.maxTokens = o.maxTokens || 8192; }
  get name() { return "anthropic"; }

  async *stream(req = {}) {
    const mod = /** @type {any} */ (await import("@anthropic-ai/sdk"));
    const Anthropic = mod.default || mod;
    const client = new Anthropic({ apiKey: this.apiKey, baseURL: this.apiUrl });
    let text = "", usage = null;

    // Accumulate native tool_use blocks keyed by content_block index
    const nativeToolUses = {}; // index -> { id, name, input_acc: string }

    try {
      const stream = await withRetry(() => client.messages.create(
        this._buildRequestBody(req),
        { signal: req.signal }
      ));

      for await (const e of stream) {
        if (e.type === "content_block_start") {
          if (e.content_block?.type === "tool_use") {
            nativeToolUses[e.index] = {
              id: e.content_block.id,
              name: e.content_block.name,
              input_acc: "",
            };
            yield { type: "thinking" }; // UI hint
          }
        } else if (e.type === "content_block_delta") {
          if (e.delta?.type === "text_delta") {
            text += e.delta.text;
            yield { type: "text", delta: e.delta.text };
          } else if (e.delta?.type === "input_json_delta" && nativeToolUses[e.index]) {
            nativeToolUses[e.index].input_acc += e.delta.partial_json || "";
          }
        } else if (e.type === "message_delta") {
          usage = e.usage;
        }
      }
    } catch (err) { yield { type: "error", message: err.message }; return; }

    if (usage) yield {
      type: "usage",
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    };

    // Prefer native tool_use; fall back to DSML when text contains DSML invokes
    const nativeUses = Object.values(nativeToolUses).map(t => {
      let input = {};
      try { input = JSON.parse(t.input_acc || "{}"); } catch (_) {}
      return { id: t.id, name: t.name, input };
    });

    const toolUses = nativeUses.length > 0 ? nativeUses : this._parseDsml(text);
    yield { type: "tool_uses", toolUses, text, usage };
  }

  _buildRequestBody(req) {
    const body = {
      model: req.model || this.model,
      max_tokens: req.maxTokens || this.maxTokens,
      stream: true,
      messages: this._toMessages(req.messages || []),
    };
    if (req.system) {
      if (req.enableCache) {
        body.system = [{
          type: "text",
          text: String(req.system),
          cache_control: { type: "ephemeral" },
        }];
      } else {
        body.system = String(req.system);
      }
    }
    if (req.tools?.length) body.tools = req.tools;
    if (req.thinking) {
      body.thinking = { type: "adaptive" };
      const intensity = req.thinkIntensity;
      let effort = "high";
      if (intensity === "low" || intensity === "medium" || intensity === "high") effort = intensity;
      else if (intensity === "x-high" || intensity === "xhigh") effort = "xhigh";
      else if (intensity === "max") effort = "max";
      body.output_config = { effort };
    }
    return body;
  }

  _toMessages(msgs) {
    return msgs.map(m => {
      // user message carrying tool_result blocks \u2192 convert to Anthropic content blocks
      if (m.role === "user" && Array.isArray(m.content)) {
        const blocks = m.content.map(c => {
          if (c && c.type === "tool_result") {
            return {
              type: "tool_result",
              tool_use_id: c.tool_use_id,
              content: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
            };
          }
          return c;
        });
        return { role: "user", content: blocks };
      }
      // assistant message with recorded tool_uses \u2192 restore as Anthropic blocks
      if (m.role === "assistant" && Array.isArray(m.tool_uses) && m.tool_uses.length) {
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tu of m.tool_uses) {
          blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        }
        return { role: "assistant", content: blocks };
      }
      return { role: m.role, content: m.content };
    });
  }

  _parseDsml(text) {
    const re = /\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke>/g;
    const uses = []; let m; let i = 0;
    while ((m = re.exec(text)) !== null) {
      const p = {}; const pr = /\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter>/g; let pm;
      while ((pm = pr.exec(m[2])) !== null) p[pm[1]] = pm[2].trim();
      uses.push({ id: `dsml_${Date.now()}_${i++}`, name: m[1], input: p });
    }
    return uses;
  }

  async listModels() { return [{ id: "claude-opus-4-7" }, { id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5-20251001" }]; }
}

// === Provider Registry ===

const REGISTRY = {
  anthropic:    { cls: AnthropicProvider, envKey: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com",         model: "claude-sonnet-4-6" },
  claude:       { alias: "anthropic" },
  openai:       { cls: BaseOpenAICompatible, envKey: "OPENAI_API_KEY",    url: "https://api.openai.com/v1",               model: "gpt-5.4-mini",    name: "openai" },
  gpt:          { alias: "openai" },
  deepseek:     { cls: BaseOpenAICompatible, envKey: "DEEPSEEK_API_KEY",  url: "https://api.deepseek.com",               model: "deepseek-v4-flash", name: "deepseek" },
  groq:         { cls: BaseOpenAICompatible, envKey: "GROQ_API_KEY",       url: "https://api.groq.com/openai/v1",         model: "llama-3.3-70b-versatile", name: "groq" },
  mistral:      { cls: BaseOpenAICompatible, envKey: "MISTRAL_API_KEY",    url: "https://api.mistral.ai/v1",              model: "mistral-large-latest",    name: "mistral" },
  google:       { cls: BaseOpenAICompatible, envKey: "GOOGLE_API_KEY",     url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", name: "google" },
  gemini:       { alias: "google" },
  moonshot:     { cls: BaseOpenAICompatible, envKey: "MOONSHOT_API_KEY",  url: "https://api.moonshot.cn/v1",             model: "moonshot-v1-8k",  name: "moonshot" },
  zhipu:        { cls: BaseOpenAICompatible, envKey: "ZHIPUAI_API_KEY",   url: "https://open.bigmodel.cn/api/paas/v4",   model: "glm-4.5-plus",    name: "zhipu" },
  dashscope:    { cls: BaseOpenAICompatible, envKey: "DASHSCOPE_API_KEY", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max-latest", name: "dashscope" },
  openrouter:   { cls: BaseOpenAICompatible, envKey: "OPENROUTER_API_KEY",url: "https://openrouter.ai/api/v1",           model: "anthropic/claude-sonnet-4", name: "openrouter" },
  ollama:       { cls: BaseOpenAICompatible, envKey: null,                url: "http://localhost:11434/v1",             model: "llama3.2",        name: "ollama" },
  vllm:         { cls: BaseOpenAICompatible, envKey: null,                url: "http://localhost:8000/v1",              model: "default",         name: "vllm" },
};

function createProvider(cfg = {}, env = process.env) {
  const name = (cfg.provider || env.HAX_AGENT_PROVIDER || "anthropic").toLowerCase();
  let entry = REGISTRY[name];
  if (!entry) throw new Error(`Unknown provider: ${name}. Try: ${Object.keys(REGISTRY).filter(k => !REGISTRY[k].alias).join(", ")}`);
  if (entry.alias) entry = REGISTRY[entry.alias];

  const cls = entry.cls;
  // Try: explicit cfg.apiKey → env var → saved apikeys.json
  let apiKey = cfg.apiKey || (entry.envKey ? env[entry.envKey] : null);
  if (!apiKey) {
    try {
      const kp = path.join(os.homedir(), ".haxagent", "apikeys.json");
      const saved = JSON.parse(fs.readFileSync(kp, "utf-8"));
      apiKey = saved[name] || saved[entry.name || ""] || null;
    } catch (_) {}
  }
  const apiUrl = cfg.apiUrl || entry.url;
  const model = cfg.model || entry.model;
  const providerName = entry.name || name;

  return new cls({ apiKey, apiUrl, model, name: providerName });
}

function listProviders() {
  const result = [];
  for (const [n, e] of Object.entries(REGISTRY)) {
    if (e.alias) continue;
    result.push({ name: n, envKey: e.envKey, url: e.url, model: e.model });
  }
  return result;
}

export { createProvider, listProviders, REGISTRY, AnthropicProvider, BaseOpenAICompatible };
