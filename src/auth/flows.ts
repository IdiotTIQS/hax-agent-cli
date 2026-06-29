import http from "http";
class OAuthFlow { static async deviceCodeFlow(opts: Record<string, unknown>) { return { ok: false, error: "Device code flow requires a browser and OAuth server endpoint" }; } static async authorizationCodeFlow(opts: Record<string, unknown>) { return { ok: false, error: "Authorization code flow requires a callback URL and OAuth server" }; } }
export { OAuthFlow };
