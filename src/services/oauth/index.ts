interface OAuthHandler {
  authenticate(opts: unknown): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
}

class OAuthService {
  _providers: Map<string, OAuthHandler>;

  constructor() { this._providers = new Map(); }

  registerProvider(name: string, handler: OAuthHandler): this {
    this._providers.set(name, handler);
    return this;
  }

  async authenticate(provider: string, opts: unknown): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
    const h = this._providers.get(provider);
    return h ? h.authenticate(opts) : { ok: false, error: "Unknown provider: " + provider };
  }
}

export { OAuthService };
