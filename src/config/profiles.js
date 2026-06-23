"use strict";

/**
 * Provider Profiles — manage multiple AI provider configurations.
 * Users can define named profiles (claude, gpt, local, etc.) and switch.
 *
 * Ported from OpenHarness config/settings.py ProviderProfile.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const PROFILES_FILE = path.join(os.homedir(), ".haxagent", "profiles.json");

const BUILTIN = {
  // Anthropic — updated 2026-05
  claude:    { provider: "anthropic",  model: "claude-sonnet-4-6",         apiUrl: "https://api.anthropic.com" },
  sonnet:    { provider: "anthropic",  model: "claude-sonnet-4-6" },
  haiku:     { provider: "anthropic",  model: "claude-haiku-4-5-20251001" },
  opus:      { provider: "anthropic",  model: "claude-opus-4-7" },
  // OpenAI — updated 2026-05
  gpt:       { provider: "openai",     model: "gpt-5.4-mini",              apiUrl: "https://api.openai.com/v1" },
  "gpt-pro": { provider: "openai",     model: "gpt-5.5" },
  "gpt-mini":{ provider: "openai",     model: "gpt-4o-mini" },
  "o3":      { provider: "openai",     model: "o3-2025-04-16" },
  // DeepSeek — V4 series (old deepseek-chat deprecated 2026-07)
  deepseek:  { provider: "deepseek",   model: "deepseek-v4-flash",         apiUrl: "https://api.deepseek.com" },
  "deepseek-pro": { provider: "deepseek", model: "deepseek-v4-pro" },
  // Groq
  groq:      { provider: "groq",       model: "llama-3.3-70b-versatile",   apiUrl: "https://api.groq.com/openai/v1" },
  // Mistral
  mistral:   { provider: "mistral",    model: "mistral-large-latest",       apiUrl: "https://api.mistral.ai/v1" },
  // Google — Gemini 2.5 (stable) + 3.x (preview)
  google:    { provider: "google",     model: "gemini-2.5-pro",            apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  gemini:    { provider: "google",     model: "gemini-2.5-flash" },
  "gemini-pro": { provider: "google",  model: "gemini-2.5-pro" },
  // Chinese providers
  moonshot:  { provider: "moonshot",   model: "moonshot-v1-8k",            apiUrl: "https://api.moonshot.cn/v1" },
  zhipu:     { provider: "zhipu",      model: "glm-4.5-plus",              apiUrl: "https://open.bigmodel.cn/api/paas/v4" },
  dashscope: { provider: "dashscope",  model: "qwen-max-latest",           apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  // OpenRouter
  openrouter:{ provider: "openrouter", model: "anthropic/claude-sonnet-4.6", apiUrl: "https://openrouter.ai/api/v1" },
  // Local
  ollama:    { provider: "ollama",     model: "llama3.3",                  apiUrl: "http://localhost:11434/v1", note: "Ollama" },
  local:     { provider: "ollama",     model: "",                          apiUrl: "http://localhost:11434/v1", note: "Ollama-compatible" },
  vllm:      { provider: "vllm",       model: "default",                   apiUrl: "http://localhost:8000/v1",  note: "vLLM" },
};

class ProfileManager {
  constructor(opts = {}) { this._active = opts.active || "claude"; this._custom = {}; this._load(); }

  _load() {
    try { if (fs.existsSync(PROFILES_FILE)) this._custom = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8")); } catch (_) {}
  }

  _save() { fs.writeFileSync(PROFILES_FILE, JSON.stringify(this._custom, null, 2), "utf-8"); }

  /** Get the active profile config. */
  get active() { return this.get(this._active) || BUILTIN.claude; }

  /** List all profiles (builtin + custom). */
  list() { return { ...BUILTIN, ...this._custom }; }

  /** Get a specific profile. */
  get(name) { return this._custom[name] || BUILTIN[name] || null; }

  /** Switch active profile. */
  use(name) { if (this.get(name)) { this._active = name; return true; } return false; }

  /** Add/update a custom profile. */
  set(name, cfg) { this._custom[name] = cfg; this._save(); }

  /** Remove a custom profile. */
  remove(name) { delete this._custom[name]; this._save(); }

  get activeName() { return this._active; }
}

module.exports = { ProfileManager, BUILTIN, PROFILES_FILE };
