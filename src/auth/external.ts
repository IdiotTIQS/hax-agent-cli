import { AuthManager } from "./manager.js";
class ExternalAuthProvider { constructor(o) { this.name = o.name || ""; this._mgr = new AuthManager(); } async authenticate(opts) { return { ok: false, error: "External auth requires provider-specific OAuth implementation" }; } async refreshToken() { return { ok: false, error: "Token refresh not implemented" }; } }
export { ExternalAuthProvider };
