"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AuthManager, KNOWN_PROVIDERS } = require("../src/auth/manager");

// Each manager points at an isolated temp dir — never touches the real ~/.haxagent.
function makeManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
  return { mgr: new AuthManager({ storageDir: dir }), dir };
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

test("KNOWN_PROVIDERS includes the core providers", () => {
  for (const p of ["anthropic", "openai", "google", "deepseek"]) {
    assert.ok(KNOWN_PROVIDERS.includes(p), `${p} should be known`);
  }
});

test("storeCredential persists apiKey and returns normalized record", () => {
  const { mgr, dir } = makeManager();
  try {
    const rec = mgr.storeCredential("anthropic", { apiKey: "sk-test-123" });
    assert.equal(rec.provider, "anthropic");
    assert.equal(rec.apiKey, "sk-test-123");
    assert.equal(rec.apiUrl, "");
    assert.equal(rec.token, "");
    assert.ok(rec.storedAt, "storedAt timestamp should be set");
    assert.ok(fs.existsSync(path.join(dir, "anthropic.json")));
  } finally { cleanup(dir); }
});

test("loadCredential round-trips a stored credential", () => {
  const { mgr, dir } = makeManager();
  try {
    mgr.storeCredential("openai", { apiKey: "sk-oai", apiUrl: "https://x" });
    const cred = mgr.loadCredential("openai");
    assert.equal(cred.apiKey, "sk-oai");
    assert.equal(cred.apiUrl, "https://x");
  } finally { cleanup(dir); }
});

test("loadCredential returns null for unknown provider", () => {
  const { mgr, dir } = makeManager();
  try {
    assert.equal(mgr.loadCredential("never-stored"), null);
  } finally { cleanup(dir); }
});

test("loadCredential returns null for corrupt JSON", () => {
  const { mgr, dir } = makeManager();
  try {
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not valid json");
    assert.equal(mgr.loadCredential("broken"), null);
  } finally { cleanup(dir); }
});

test("clearCredential removes the stored file", () => {
  const { mgr, dir } = makeManager();
  try {
    mgr.storeCredential("groq", { apiKey: "k" });
    assert.ok(mgr.loadCredential("groq"));
    mgr.clearCredential("groq");
    assert.equal(mgr.loadCredential("groq"), null);
  } finally { cleanup(dir); }
});

test("clearCredential on missing provider does not throw", () => {
  const { mgr, dir } = makeManager();
  try {
    assert.doesNotThrow(() => mgr.clearCredential("absent"));
  } finally { cleanup(dir); }
});

test("listStoredProviders reflects stored credentials", () => {
  const { mgr, dir } = makeManager();
  try {
    assert.deepEqual(mgr.listStoredProviders(), []);
    mgr.storeCredential("anthropic", { apiKey: "a" });
    mgr.storeCredential("openai", { apiKey: "b" });
    assert.deepEqual(mgr.listStoredProviders().sort(), ["anthropic", "openai"]);
  } finally { cleanup(dir); }
});

test("getApiKeyForProvider prefers stored credential over env", () => {
  const { mgr, dir } = makeManager();
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = "env-key";
    mgr.storeCredential("anthropic", { apiKey: "stored-key" });
    assert.equal(mgr.getApiKeyForProvider("anthropic"), "stored-key");
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
    cleanup(dir);
  }
});

test("getApiKeyForProvider falls back to env var when no credential stored", () => {
  const { mgr, dir } = makeManager();
  const saved = process.env.DEEPSEEK_API_KEY;
  try {
    process.env.DEEPSEEK_API_KEY = "env-deepseek";
    assert.equal(mgr.getApiKeyForProvider("deepseek"), "env-deepseek");
  } finally {
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
    cleanup(dir);
  }
});

test("getApiKeyForProvider returns null when neither stored nor env present", () => {
  const { mgr, dir } = makeManager();
  const saved = process.env.MOONSHOT_API_KEY;
  try {
    delete process.env.MOONSHOT_API_KEY;
    assert.equal(mgr.getApiKeyForProvider("moonshot"), null);
  } finally {
    if (saved !== undefined) process.env.MOONSHOT_API_KEY = saved;
    cleanup(dir);
  }
});
