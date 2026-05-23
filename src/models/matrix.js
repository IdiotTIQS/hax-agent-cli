"use strict";

// ---------------------------------------------------------------------------
// Built-in model catalogue — 34 models across 8 major providers.
// Each entry describes both boolean and numeric (1–10) capabilities.
// speed:  1=slowest, 10=fastest
// cost:   1=most expensive, 10=cheapest
// ---------------------------------------------------------------------------

const BUILTIN_MODELS = Object.freeze([
  // ── Anthropic ──────────────────────────────────────────────────────────
  {
    id: "claude-opus-4", provider: "anthropic", displayName: "Claude Opus 4",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 9, multilingual: 9, speed: 3, cost: 1,
  },
  {
    id: "claude-sonnet-4", provider: "anthropic", displayName: "Claude Sonnet 4",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 8, speed: 6, cost: 5,
  },
  {
    id: "claude-haiku-4", provider: "anthropic", displayName: "Claude Haiku 4",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 6, multilingual: 7, speed: 9, cost: 8,
  },
  {
    id: "claude-3-5-sonnet", provider: "anthropic", displayName: "Claude 3.5 Sonnet",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 7, speed: 6, cost: 5,
  },
  {
    id: "claude-3-opus", provider: "anthropic", displayName: "Claude 3 Opus",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 8, speed: 3, cost: 1,
  },
  {
    id: "claude-haiku-3-5", provider: "anthropic", displayName: "Claude Haiku 3.5",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: true, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 6, speed: 9, cost: 8,
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: "gpt-4o", provider: "openai", displayName: "GPT-4o",
    maxTokens: 128000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 8, speed: 8, cost: 5,
  },
  {
    id: "gpt-4o-mini", provider: "openai", displayName: "GPT-4o Mini",
    maxTokens: 128000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 6, speed: 9, cost: 9,
  },
  {
    id: "gpt-4.1", provider: "openai", displayName: "GPT-4.1",
    maxTokens: 1000000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 9, multilingual: 8, speed: 6, cost: 5,
  },
  {
    id: "gpt-4.1-mini", provider: "openai", displayName: "GPT-4.1 Mini",
    maxTokens: 1000000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: false, jsonMode: true,
    codeGeneration: 6, multilingual: 6, speed: 8, cost: 8,
  },
  {
    id: "gpt-4-turbo", provider: "openai", displayName: "GPT-4 Turbo",
    maxTokens: 128000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 7, speed: 6, cost: 3,
  },
  {
    id: "gpt-3.5-turbo", provider: "openai", displayName: "GPT-3.5 Turbo",
    maxTokens: 16385, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 4, multilingual: 5, speed: 10, cost: 10,
  },
  {
    id: "o1", provider: "openai", displayName: "o1",
    maxTokens: 200000, vision: true, tools: false, streaming: false,
    caching: false, longContext: false, reasoning: true, jsonMode: false,
    codeGeneration: 9, multilingual: 7, speed: 2, cost: 2,
  },
  {
    id: "o1-mini", provider: "openai", displayName: "o1 Mini",
    maxTokens: 128000, vision: false, tools: false, streaming: false,
    caching: false, longContext: false, reasoning: true, jsonMode: false,
    codeGeneration: 7, multilingual: 5, speed: 4, cost: 5,
  },
  {
    id: "o3-mini", provider: "openai", displayName: "o3 Mini",
    maxTokens: 200000, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 6, speed: 5, cost: 5,
  },
  {
    id: "o4-mini", provider: "openai", displayName: "o4 Mini",
    maxTokens: 200000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 6, speed: 5, cost: 6,
  },

  // ── Google ─────────────────────────────────────────────────────────────
  {
    id: "gemini-2.5-pro", provider: "google", displayName: "Gemini 2.5 Pro",
    maxTokens: 1000000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 9, speed: 7, cost: 6,
  },
  {
    id: "gemini-2.5-flash", provider: "google", displayName: "Gemini 2.5 Flash",
    maxTokens: 1000000, vision: true, tools: true, streaming: true,
    caching: true, longContext: true, reasoning: false, jsonMode: true,
    codeGeneration: 6, multilingual: 8, speed: 9, cost: 9,
  },
  {
    id: "gemini-1.5-pro", provider: "google", displayName: "Gemini 1.5 Pro",
    maxTokens: 2000000, vision: true, tools: true, streaming: true,
    caching: false, longContext: true, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 8, speed: 6, cost: 6,
  },
  {
    id: "gemini-1.5-flash", provider: "google", displayName: "Gemini 1.5 Flash",
    maxTokens: 1000000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 7, speed: 9, cost: 9,
  },

  // ── Meta / Llama ───────────────────────────────────────────────────────
  {
    id: "llama-3.1-405b", provider: "meta", displayName: "Llama 3.1 405B",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 7, speed: 3, cost: 6,
  },
  {
    id: "llama-3.1-70b", provider: "meta", displayName: "Llama 3.1 70B",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 6, speed: 6, cost: 8,
  },
  {
    id: "llama-3.1-8b", provider: "meta", displayName: "Llama 3.1 8B",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 4, speed: 9, cost: 10,
  },

  // ── Mistral ────────────────────────────────────────────────────────────
  {
    id: "mistral-large", provider: "mistral", displayName: "Mistral Large",
    maxTokens: 131072, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 9, speed: 5, cost: 3,
  },
  {
    id: "mistral-medium", provider: "mistral", displayName: "Mistral Medium",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 6, multilingual: 7, speed: 6, cost: 5,
  },
  {
    id: "mistral-small", provider: "mistral", displayName: "Mistral Small",
    maxTokens: 32768, vision: false, tools: false, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 4, multilingual: 5, speed: 9, cost: 9,
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────
  {
    id: "deepseek-v3", provider: "deepseek", displayName: "DeepSeek V3",
    maxTokens: 65536, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 8, multilingual: 8, speed: 7, cost: 9,
  },
  {
    id: "deepseek-r1", provider: "deepseek", displayName: "DeepSeek R1",
    maxTokens: 131072, vision: false, tools: false, streaming: false,
    caching: false, longContext: false, reasoning: true, jsonMode: false,
    codeGeneration: 9, multilingual: 6, speed: 3, cost: 7,
  },

  // ── Cohere ─────────────────────────────────────────────────────────────
  {
    id: "command-r-plus", provider: "cohere", displayName: "Command R+",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 6, multilingual: 7, speed: 6, cost: 6,
  },
  {
    id: "command-r", provider: "cohere", displayName: "Command R",
    maxTokens: 131072, vision: false, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 6, speed: 7, cost: 7,
  },

  // ── xAI ────────────────────────────────────────────────────────────────
  {
    id: "grok-2", provider: "xai", displayName: "Grok 2",
    maxTokens: 131072, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 6, speed: 6, cost: 4,
  },
  {
    id: "grok-2-mini", provider: "xai", displayName: "Grok 2 Mini",
    maxTokens: 131072, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 5, speed: 9, cost: 8,
  },

  // ── Perplexity ─────────────────────────────────────────────────────────
  {
    id: "perplexity-sonar", provider: "perplexity", displayName: "Sonar",
    maxTokens: 128000, vision: false, tools: false, streaming: true,
    caching: false, longContext: false, reasoning: false, jsonMode: true,
    codeGeneration: 5, multilingual: 7, speed: 7, cost: 7,
  },

  // ── Amazon ─────────────────────────────────────────────────────────────
  {
    id: "nova-pro", provider: "amazon", displayName: "Nova Pro",
    maxTokens: 300000, vision: true, tools: true, streaming: true,
    caching: false, longContext: false, reasoning: true, jsonMode: true,
    codeGeneration: 7, multilingual: 8, speed: 6, cost: 5,
  },
]);

// ── Task profiles: weighted capability importance per task type ─────────
const TASK_PROFILES = Object.freeze({
  coding: {
    codeGeneration: 10, reasoning: 8, maxTokens: 6, tools: 5, speed: 4, cost: 3,
  },
  chat: {
    multilingual: 6, speed: 8, cost: 7, reasoning: 5, maxTokens: 4, codeGeneration: 3,
  },
  vision: {
    vision: 10, maxTokens: 5, speed: 4, cost: 4, reasoning: 3,
  },
  reasoning: {
    reasoning: 10, maxTokens: 7, codeGeneration: 5, cost: 3, multilingual: 3,
  },
  translation: {
    multilingual: 10, speed: 6, cost: 5, maxTokens: 4, reasoning: 3,
  },
  summarization: {
    maxTokens: 8, speed: 7, cost: 6, reasoning: 5, multilingual: 3,
  },
  json_extraction: {
    jsonMode: 10, speed: 7, cost: 6, maxTokens: 4, reasoning: 3,
  },
  tool_use: {
    tools: 10, reasoning: 6, speed: 5, cost: 5, maxTokens: 3,
  },
  creative_writing: {
    multilingual: 5, speed: 6, cost: 5, maxTokens: 5, reasoning: 4, codeGeneration: 3,
  },
  code_review: {
    codeGeneration: 8, reasoning: 7, maxTokens: 5, vision: 3, speed: 3, cost: 3,
  },
});

// ── Numeric capability keys that are always 1–10 ────────────────────────
const NUMERIC_CAPABILITIES = [
  "codeGeneration", "multilingual", "speed", "cost",
];

// ── Helpers ──────────────────────────────────────────────────────────────

const _identity = (v) => v;

function _defaultModelEntry() {
  return {
    id: "", provider: "unknown", displayName: "",
    maxTokens: 4096,
    vision: false, tools: false, streaming: false,
    caching: false, longContext: false, reasoning: false, jsonMode: false,
    codeGeneration: 1, multilingual: 1, speed: 5, cost: 5,
  };
}

function _normalizeModel(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model must be a non-null object");
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error("Model must have a non-empty string id");
  }

  const src = raw.capabilities ? { ...raw, ...raw.capabilities } : raw;

  return {
    id: String(src.id),
    provider: String(src.provider || "unknown").toLowerCase(),
    displayName: String(src.displayName || src.id),
    maxTokens: Number.isFinite(src.maxTokens) && src.maxTokens > 0 ? src.maxTokens : 4096,
    vision: Boolean(src.vision),
    tools: Boolean(src.tools),
    streaming: Boolean(src.streaming),
    caching: Boolean(src.caching),
    longContext: Boolean(src.longContext),
    reasoning: Boolean(src.reasoning),
    jsonMode: Boolean(src.jsonMode),
    codeGeneration: _clampScore(src.codeGeneration),
    multilingual: _clampScore(src.multilingual),
    speed: _clampScore(src.speed),
    cost: _clampScore(src.cost),
  };
}

function _clampScore(raw) {
  const n = Number.isFinite(raw) ? Math.round(raw) : 5;
  return Math.max(1, Math.min(10, n));
}

function _scoreModel(model, taskProfile) {
  let score = 0;
  for (const [cap, weight] of Object.entries(taskProfile)) {
    const val = model[cap];
    if (val === undefined) continue;
    if (typeof val === "boolean") {
      score += val ? weight * 10 : 0;
    } else {
      score += (val / 10) * weight * 10;
    }
  }
  return score;
}

// ── ModelMatrix ──────────────────────────────────────────────────────────

class ModelMatrix {
  constructor(options = {}) {
    this._models = new Map();
    this._preloadBuiltins = options.preloadBuiltins !== false;
    if (this._preloadBuiltins) {
      for (const def of BUILTIN_MODELS) {
        this.registerModel(def);
      }
    }
  }

  // ── Registration ────────────────────────────────────────────────────

  registerModel(raw) {
    const model = _normalizeModel(raw);
    if (!model.id) {
      throw new Error("Model must have a non-empty id");
    }
    this._models.set(model.id.toLowerCase(), model);
    return this;
  }

  bulkRegister(models) {
    if (!Array.isArray(models)) {
      throw new Error("bulkRegister expects an array of model definitions");
    }
    for (const m of models) {
      this.registerModel(m);
    }
    return this;
  }

  removeModel(id) {
    if (typeof id !== "string" || id.length === 0) {
      return false;
    }
    return this._models.delete(id.toLowerCase());
  }

  getModel(id) {
    if (typeof id !== "string" || id.length === 0) {
      return null;
    }
    return this._models.get(id.toLowerCase()) || null;
  }

  listAll() {
    return Array.from(this._models.values());
  }

  get size() {
    return this._models.size;
  }

  // ── Capabilities ────────────────────────────────────────────────────

  getCapabilities(modelId) {
    const model = this.getModel(modelId);
    if (!model) {
      return null;
    }

    return {
      id: model.id,
      provider: model.provider,
      displayName: model.displayName,
      boolean: {
        vision: model.vision,
        tools: model.tools,
        streaming: model.streaming,
        caching: model.caching,
        longContext: model.longContext,
        reasoning: model.reasoning,
        jsonMode: model.jsonMode,
      },
      numeric: {
        maxTokens: model.maxTokens,
        codeGeneration: model.codeGeneration,
        multilingual: model.multilingual,
        speed: model.speed,
        cost: model.cost,
      },
    };
  }

  // ── Query ───────────────────────────────────────────────────────────

  query(requirements) {
    const reqs = requirements || {};
    const candidates = this.listAll();

    return candidates.filter((model) => this._matches(model, reqs));
  }

  _matches(model, reqs) {
    // Boolean flags
    if (reqs.vision === true && !model.vision) return false;
    if (reqs.tools === true && !model.tools) return false;
    if (reqs.streaming === true && !model.streaming) return false;
    if (reqs.caching === true && !model.caching) return false;
    if (reqs.longContext === true && !model.longContext) return false;
    if (reqs.reasoning === true && !model.reasoning) return false;
    if (reqs.jsonMode === true && !model.jsonMode) return false;

    // Numeric minimums (capabilities scored 1–10)
    if (Number.isFinite(reqs.minCodeGeneration) && model.codeGeneration < reqs.minCodeGeneration) return false;
    if (Number.isFinite(reqs.minMultilingual) && model.multilingual < reqs.minMultilingual) return false;
    if (Number.isFinite(reqs.minSpeed) && model.speed < reqs.minSpeed) return false;
    if (Number.isFinite(reqs.maxCost) && model.cost > reqs.maxCost) return false;
    if (Number.isFinite(reqs.minMaxTokens) && model.maxTokens < reqs.minMaxTokens) return false;

    // Provider filter
    if (reqs.provider) {
      const want = String(reqs.provider).toLowerCase();
      if (model.provider !== want) return false;
    }

    // Exclusion list
    if (Array.isArray(reqs.exclude)) {
      const ex = reqs.exclude.map((id) => String(id).toLowerCase());
      if (ex.includes(model.id)) return false;
    }

    return true;
  }

  // ── Compare ─────────────────────────────────────────────────────────

  compare(modelAId, modelBId) {
    const a = this.getModel(modelAId);
    const b = this.getModel(modelBId);

    if (!a && !b) {
      throw new Error(`Neither model found: "${modelAId}", "${modelBId}"`);
    }
    if (!a) {
      throw new Error(`Model not found: "${modelAId}"`);
    }
    if (!b) {
      throw new Error(`Model not found: "${modelBId}"`);
    }

    const booleanKeys = [
      "vision", "tools", "streaming", "caching",
      "longContext", "reasoning", "jsonMode",
    ];

    const numericKeys = [
      "maxTokens", "codeGeneration", "multilingual", "speed", "cost",
    ];

    const boolDiffs = [];
    for (const key of booleanKeys) {
      boolDiffs.push({
        capability: key,
        modelA: a[key],
        modelB: b[key],
        both: a[key] && b[key],
        winner: a[key] === b[key] ? "tie" : (a[key] ? "A" : "B"),
      });
    }

    const numDiffs = [];
    for (const key of numericKeys) {
      const diff = a[key] - b[key];
      numDiffs.push({
        capability: key,
        modelA: a[key],
        modelB: b[key],
        difference: diff,
        winner: diff > 0 ? "A" : diff < 0 ? "B" : "tie",
      });
    }

    const aWins = [...boolDiffs, ...numDiffs].filter((d) => d.winner === "A").length;
    const bWins = [...boolDiffs, ...numDiffs].filter((d) => d.winner === "B").length;

    return {
      modelA: { id: a.id, provider: a.provider, displayName: a.displayName },
      modelB: { id: b.id, provider: b.provider, displayName: b.displayName },
      booleanDifferences: boolDiffs,
      numericDifferences: numDiffs,
      summary: {
        aWins,
        bWins,
        ties: (boolDiffs.length + numDiffs.length) - aWins - bWins,
        betterForCoding: this._pickBetter(a, b, ["codeGeneration", "tools", "reasoning"]),
        betterForSpeed: this._pickBetter(a, b, ["speed"]),
        betterForCost: this._pickBetter(a, b, ["cost"]),
        betterForVision: this._pickBetter(a, b, ["vision"]),
        betterForMultilingual: this._pickBetter(a, b, ["multilingual"]),
      },
    };
  }

  _pickBetter(a, b, keys) {
    let aScore = 0;
    let bScore = 0;
    for (const k of keys) {
      const va = typeof a[k] === "boolean" ? (a[k] ? 1 : 0) : (a[k] / 10);
      const vb = typeof b[k] === "boolean" ? (b[k] ? 1 : 0) : (b[k] / 10);
      aScore += va;
      bScore += vb;
    }
    if (aScore > bScore) return "A";
    if (bScore > aScore) return "B";
    return "tie";
  }

  // ── Rank ────────────────────────────────────────────────────────────

  rank(taskType, models) {
    const profile = TASK_PROFILES[taskType];
    if (!profile) {
      throw new Error(
        `Unknown task type: "${taskType}". Valid: ${Object.keys(TASK_PROFILES).join(", ")}`,
      );
    }

    const candidateList = Array.isArray(models) && models.length > 0
      ? models.map((m) => (typeof m === "string" ? this.getModel(m) : m)).filter(Boolean)
      : this.listAll();

    if (candidateList.length === 0) {
      return [];
    }

    const scored = candidateList.map((model) => ({
      model,
      score: _scoreModel(model, profile),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.map((entry) => ({
      id: entry.model.id,
      provider: entry.model.provider,
      displayName: entry.model.displayName,
      score: Math.round(entry.score * 100) / 100,
    }));
  }

  // ── Provider summaries ──────────────────────────────────────────────

  getProviderBreakdown() {
    const map = new Map();
    for (const model of this._models.values()) {
      if (!map.has(model.provider)) {
        map.set(model.provider, []);
      }
      map.get(model.provider).push(model.id);
    }
    const result = {};
    for (const [provider, ids] of map) {
      result[provider] = ids;
    }
    return result;
  }

  getModelsByProvider(provider) {
    const want = String(provider || "").toLowerCase();
    return this.listAll().filter((m) => m.provider === want);
  }

  // ── Batch query helpers ─────────────────────────────────────────────

  findCheapest(requirements) {
    const matches = this.query(requirements);
    if (matches.length === 0) return null;
    return matches.reduce((best, m) => (m.cost > best.cost ? m : best));
  }

  findFastest(requirements) {
    const matches = this.query(requirements);
    if (matches.length === 0) return null;
    return matches.reduce((best, m) => (m.speed > best.speed ? m : best));
  }

  findHighestCapability(requirements) {
    const matches = this.query(requirements);
    if (matches.length === 0) return null;

    let best = matches[0];
    let bestTotal = 0;
    for (const m of matches) {
      const total =
        (m.vision ? 1 : 0) +
        (m.tools ? 1 : 0) +
        (m.reasoning ? 1 : 0) +
        (m.jsonMode ? 1 : 0) +
        m.codeGeneration +
        m.multilingual;
      if (total > bestTotal) {
        bestTotal = total;
        best = m;
      }
    }
    return best;
  }
}

module.exports = {
  ModelMatrix,
  BUILTIN_MODELS,
  TASK_PROFILES,
};
