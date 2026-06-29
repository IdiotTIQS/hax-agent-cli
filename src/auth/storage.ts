/** Credential storage helpers. Ported from OpenHarness auth/storage.py */
import { AuthManager } from "./manager.js";

let _defaultManager: AuthManager | null = null;
function getAuthManager(): AuthManager {
  if (!_defaultManager) _defaultManager = new AuthManager();
  return _defaultManager;
}

function storeCredential(provider: string, credential: Record<string, string>) {
  return getAuthManager().storeCredential(provider, credential);
}
function loadCredential(provider: string) {
  return getAuthManager().loadCredential(provider);
}
function clearProviderCredentials(provider: string) {
  getAuthManager().clearCredential(provider);
}

export { getAuthManager, storeCredential, loadCredential, clearProviderCredentials };
