"use strict";
/** Authentication manager. Ported from OpenHarness auth/manager.py */
const fs = require("fs");
const path = require("path");
const os = require("os");

const KNOWN_PROVIDERS = ["anthropic", "openai", "deepseek", "groq", "mistral", "google", "moonshot", "zhipu", "dashscope", "openrouter", "ollama", "vllm", "bedrock", "vertex", "copilot", "minimax", "modelscope"];

class AuthManager {
  constructor(opts = {}) { this._storageDir = opts.storageDir || path.join(os.homedir(), ".haxagent", "auth"); }

  _credentialPath(provider) { return path.join(this._storageDir, `${provider}.json`); }

  storeCredential(provider, credential) {
    if (!fs.existsSync(this._storageDir)) fs.mkdirSync(this._storageDir, { recursive: true });
    const data = { provider, apiKey: credential.apiKey || "", apiUrl: credential.apiUrl || "", token: credential.token || "", storedAt: new Date().toISOString() };
    fs.writeFileSync(this._credentialPath(provider), JSON.stringify(data, null, 2));
    return data;
  }

  loadCredential(provider) {
    const fp = this._credentialPath(provider);
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (_) { return null; }
  }

  clearCredential(provider) {
    const fp = this._credentialPath(provider);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  listStoredProviders() {
    if (!fs.existsSync(this._storageDir)) return [];
    return fs.readdirSync(this._storageDir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  }

  getApiKeyForProvider(provider) {
    const cred = this.loadCredential(provider);
    if (cred?.apiKey) return cred.apiKey;
    const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY", groq: "GROQ_API_KEY", mistral: "MISTRAL_API_KEY", google: "GOOGLE_API_KEY", moonshot: "MOONSHOT_API_KEY", zhipu: "ZHIPUAI_API_KEY", dashscope: "DASHSCOPE_API_KEY", openrouter: "OPENROUTER_API_KEY" };
    return process.env[envMap[provider]] || null;
  }
}

module.exports = { AuthManager, KNOWN_PROVIDERS };
