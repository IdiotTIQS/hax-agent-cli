"use strict";

/**
 * Consolidated pricing data for all supported providers.
 * All prices are per million tokens (USD).
 *
 * Sources: provider pricing pages as of 2026-05.
 * Local providers (ollama, vllm) are free.
 */

const PRICING = {
  // === Anthropic ===
  // 价格基于 2026-06 官方文档(per 1M tokens, USD)
  "claude-opus-4-7":           { input: 5.0,   output: 25.0,  cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6":           { input: 5.0,   output: 25.0,  cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5-20251101":  { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4-1-20250805":  { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6":         { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-sonnet-4-5-20250929":{ input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1.0,   output: 5.0,   cacheWrite: 1.25,  cacheRead: 0.1 },
  // 已退役/遗留模型 — 保留定价供历史会话成本计算
  "claude-opus-4-20250514":    { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-20250514":  { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022":{ input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  "claude-3-opus-20240229":    { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-3-5-haiku-20241022": { input: 0.8,   output: 4.0,   cacheWrite: 1.0,   cacheRead: 0.08 },

  // === OpenAI ===
  "gpt-4o":           { input: 2.5,  output: 10.0 },
  "gpt-4o-mini":      { input: 0.15, output: 0.6 },
  "gpt-4.1":          { input: 2.0,  output: 8.0 },
  "gpt-4.1-mini":     { input: 0.4,  output: 1.6 },
  "gpt-4.1-nano":     { input: 0.1,  output: 0.4 },
  "gpt-5.4-mini":     { input: 0.4,  output: 1.6 },
  "gpt-5.5":          { input: 2.5,  output: 10.0 },
  "o3-mini":          { input: 1.1,  output: 4.4 },
  "o3":               { input: 2.0,  output: 8.0 },
  "o4-mini":          { input: 1.1,  output: 4.4 },

  // === DeepSeek ===
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-v4-pro":   { input: 0.55, output: 2.19 },
  "deepseek-v3":       { input: 0.27, output: 1.10 },
  "deepseek-r1":       { input: 0.55, output: 2.19 },

  // === Google Gemini ===
  "gemini-2.5-pro-exp-03-25":       { input: 1.25,  output: 10.0 },
  "gemini-2.5-pro-preview-06-05":   { input: 1.25,  output: 10.0 },
  "gemini-2.5-pro":                  { input: 1.25,  output: 10.0 },
  "gemini-2.5-flash-preview-04-17": { input: 0.15,  output: 0.6 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15,  output: 0.6 },
  "gemini-2.5-flash":               { input: 0.15,  output: 0.6 },
  "gemini-2.0-flash":               { input: 0.1,   output: 0.4 },
  "gemini-2.0-flash-lite":          { input: 0.075, output: 0.3 },

  // === Groq (hosted open-source models) ===
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant":    { input: 0.05, output: 0.08 },
  "mixtral-8x7b-32768":      { input: 0.24, output: 0.24 },
  "gemma2-9b-it":            { input: 0.20, output: 0.20 },

  // === Mistral ===
  "mistral-large-latest":  { input: 2.0,  output: 6.0 },
  "mistral-medium-latest": { input: 0.4,  output: 2.0 },
  "mistral-small-latest":  { input: 0.1,  output: 0.3 },
  "codestral-latest":      { input: 0.3,  output: 0.9 },

  // === Moonshot ===
  "moonshot-v1-8k":   { input: 0.42, output: 1.26 },
  "moonshot-v1-32k":  { input: 0.84, output: 2.52 },
  "moonshot-v1-128k": { input: 1.26, output: 3.78 },

  // === Zhipu (GLM) ===
  "glm-4.5-plus":  { input: 0.71, output: 1.42 },
  "glm-4-flash":   { input: 0.0,  output: 0.0 },

  // === DashScope (Qwen) ===
  "qwen-max-latest":         { input: 0.56, output: 1.68 },
  "qwen-plus-latest":        { input: 0.14, output: 0.42 },
  "qwen-turbo-latest":       { input: 0.04, output: 0.12 },

  // === OpenRouter (pass-through, approximate) ===
  "anthropic/claude-sonnet-4":  { input: 3.0,  output: 15.0 },
  "anthropic/claude-opus-4":    { input: 15.0, output: 75.0 },
  "openai/gpt-4o":              { input: 2.5,  output: 10.0 },
  "google/gemini-2.5-pro":      { input: 1.25, output: 10.0 },
};

// Priority-ordered regex fallbacks for model name matching
const FALLBACKS = [
  [/claude.*opus/i,              "claude-opus-4-7"],
  [/claude.*haiku/i,             "claude-haiku-4-5-20251001"],
  [/claude.*sonnet/i,            "claude-sonnet-4-6"],
  [/gpt-4\.1.*nano/i,           "gpt-4.1-nano"],
  [/gpt-4\.1.*mini/i,           "gpt-4.1-mini"],
  [/gpt-4\.1/i,                  "gpt-4.1"],
  [/gpt-4o.*mini/i,             "gpt-4o-mini"],
  [/gpt-4o/i,                    "gpt-4o"],
  [/gpt-5\.4.*mini/i,           "gpt-5.4-mini"],
  [/gpt-5\.5/i,                  "gpt-5.5"],
  [/o3.*mini/i,                  "o3-mini"],
  [/o4.*mini/i,                  "o4-mini"],
  [/o3/i,                        "o3"],
  [/deepseek.*flash/i,           "deepseek-v4-flash"],
  [/deepseek.*pro/i,             "deepseek-v4-pro"],
  [/deepseek.*r1/i,              "deepseek-r1"],
  [/deepseek/i,                  "deepseek-v4-flash"],
  [/gemini-2\.5.*pro/i,          "gemini-2.5-pro"],
  [/gemini-2\.5.*flash/i,        "gemini-2.5-flash"],
  [/gemini-2\.0.*flash.*lite/i,  "gemini-2.0-flash-lite"],
  [/gemini-2\.0.*flash/i,        "gemini-2.0-flash"],
  [/llama.*70b/i,                "llama-3.3-70b-versatile"],
  [/llama.*8b/i,                 "llama-3.1-8b-instant"],
  [/mixtral/i,                   "mixtral-8x7b-32768"],
  [/mistral.*large/i,            "mistral-large-latest"],
  [/mistral.*medium/i,           "mistral-medium-latest"],
  [/mistral.*small/i,            "mistral-small-latest"],
  [/codestral/i,                 "codestral-latest"],
  [/moonshot.*128k/i,            "moonshot-v1-128k"],
  [/moonshot.*32k/i,             "moonshot-v1-32k"],
  [/moonshot/i,                  "moonshot-v1-8k"],
  [/glm-4.*flash/i,              "glm-4-flash"],
  [/glm/i,                       "glm-4.5-plus"],
  [/qwen.*max/i,                 "qwen-max-latest"],
  [/qwen.*plus/i,                "qwen-plus-latest"],
  [/qwen.*turbo/i,               "qwen-turbo-latest"],
];

// Local/free providers
const FREE_PATTERNS = [/ollama/i, /llama3/i, /vllm/i, /local/i, /default/i];

/**
 * Look up pricing for a model. Returns { input, output, cacheWrite?, cacheRead? } or null.
 * Prices are per million tokens in USD.
 */
function getPricing(model) {
  const key = String(model || "").toLowerCase();

  // Exact match
  if (PRICING[key]) return PRICING[key];

  // Free/local models
  for (const re of FREE_PATTERNS) {
    if (re.test(key)) return { input: 0, output: 0 };
  }

  // Regex fallbacks
  for (const [pattern, pricingKey] of FALLBACKS) {
    if (pattern.test(key)) return PRICING[pricingKey];
  }

  return null;
}

/**
 * Calculate cost in USD for given token counts and model.
 */
function getCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens) {
  const p = getPricing(model);
  if (!p) return 0;
  const input = ((inputTokens || 0) / 1_000_000) * p.input;
  const output = ((outputTokens || 0) / 1_000_000) * p.output;
  const cw = p.cacheWrite ? ((cacheWriteTokens || 0) / 1_000_000) * p.cacheWrite : 0;
  const cr = p.cacheRead ? ((cacheReadTokens || 0) / 1_000_000) * p.cacheRead : 0;
  return input + output + cw + cr;
}

module.exports = { PRICING, getPricing, getCost };
