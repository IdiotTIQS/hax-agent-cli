import { AuthManager } from "./manager.js";

interface ExternalAuthProviderOptions {
  name?: string;
}

interface AuthResult {
  ok: boolean;
  error: string;
}

class ExternalAuthProvider {
  name: string;
  private _mgr: AuthManager;

  constructor(o: ExternalAuthProviderOptions = {}) {
    this.name = o.name || "";
    this._mgr = new AuthManager();
  }

  async authenticate(_opts?: Record<string, unknown>): Promise<AuthResult> {
    return { ok: false, error: "External auth requires provider-specific OAuth implementation" };
  }

  async refreshToken(): Promise<AuthResult> {
    return { ok: false, error: "Token refresh not implemented" };
  }
}

export { ExternalAuthProvider };
