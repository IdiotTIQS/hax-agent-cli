/** Credential storage helpers. Ported from OpenHarness auth/storage.py */
import { AuthManager } from "./manager.js";

let _defaultManager = null;
function getAuthManager() { if (!_defaultManager) _defaultManager = new AuthManager(); return _defaultManager; }

function storeCredential(provider, credential) { return getAuthManager().storeCredential(provider, credential); }
function loadCredential(provider) { return getAuthManager().loadCredential(provider); }
function clearProviderCredentials(provider) { getAuthManager().clearCredential(provider); }

export { getAuthManager, storeCredential, loadCredential, clearProviderCredentials };
