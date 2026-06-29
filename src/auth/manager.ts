/** Authentication manager. Ported from OpenHarness auth/manager.py */
import fs from "fs";
import path from "path";
import os from "os";

const KNOWN_PROVIDERS = ["anthropic", "openai", "deepseek", "groq", "mistral", "google", "moonshot", "zhipu", "dashscope", "openrouter", "ollama", "vllm", "bedrock", "vertex", "copilot", "minimax", "modelscope"];

interface AuthManagerOptions {
  storageDir?: string;
}

interface CredentialData {
  provider: string;
  apiKey: string;
  apiUrl: string;
  token: string;
  storedAt: string;
}

interface CredentialInput {
  apiKey?: string;
  apiUrl?: string;
  token?: string;
}

class AuthManager {
  private _storageDir: string;

  constructor(opts: AuthManagerOptions = {}) {
    this._storageDir = opts.storageDir || path.join(os.homedir(), ".haxagent", "auth");
  }

  _credentialPath(provider: string): string {
    return path.join(this._storageDir, `${provider}.json`);
  }

  storeCredential(provider: string, credential: CredentialInput): CredentialData {
    if (!fs.existsSync(this._storageDir)) fs.mkdirSync(this._storageDir, { recursive: true });
    const data: CredentialData = {
      provider,
      apiKey: credential.apiKey || "",
      apiUrl: credential.apiUrl || "",
      token: credential.token || "",
      storedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this._credentialPath(provider), JSON.stringify(data, null, 2));
    return data;
  }

  loadCredential(provider: string): CredentialData | null {
    const fp = this._credentialPath(provider);
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")) as CredentialData; } catch (_) { return null; }
  }

  clearCredential(provider: string): void {
    const fp = this._credentialPath(provider);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  listStoredProviders(): string[] {
    if (!fs.existsSync(this._storageDir)) return [];
    return fs.readdirSync(this._storageDir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  }

  getApiKeyForProvider(provider: string): string | null {
    const cred = this.loadCredential(provider);
    if (cred?.apiKey) return cred.apiKey;
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      groq: "GROQ_API_KEY",
      mistral: "MISTRAL_API_KEY",
      google: "GOOGLE_API_KEY",
      moonshot: "MOONSHOT_API_KEY",
      zhipu: "ZHIPUAI_API_KEY",
      dashscope: "DASHSCOPE_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };
    return process.env[envMap[provider]] || null;
  }
}

export { AuthManager, KNOWN_PROVIDERS };
