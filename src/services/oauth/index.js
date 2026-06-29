class OAuthService { constructor() { this._providers = new Map(); } registerProvider(name, handler) { this._providers.set(name, handler); return this; } async authenticate(provider, opts) { const h = this._providers.get(provider); return h ? h.authenticate(opts) : { ok: false, error: "Unknown provider: " + provider }; } }
export { OAuthService };
