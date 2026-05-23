/**
 * Provider factory edge-case tests: createProvider, registerProvider,
 * API key resolution, delay parsing.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProvider,
  registerProvider,
} = require("../src/providers/factory");

test("createProvider: selects anthropic when api key matches Anthropic", () => {
  const provider = createProvider(
    {},
    { ANTHROPIC_API_KEY: "test-key" }
  );
  assert.equal(provider.name, "anthropic");
});

test("createProvider: selects openai provider by name", () => {
  const provider = createProvider(
    { provider: "openai", apiKey: "sk-test" },
    {}
  );
  assert.equal(provider.name, "openai");
});

test("createProvider: selects google provider by name", () => {
  const provider = createProvider(
    { provider: "google", apiKey: "google-key" },
    {}
  );
  assert.equal(provider.name, "google");
});

test('createProvider: "claude" alias resolves to anthropic', () => {
  const provider = createProvider(
    { provider: "claude", apiKey: "test-key" },
    {}
  );
  assert.equal(provider.name, "claude");
});

test('createProvider: "gpt" alias resolves to openai', () => {
  const provider = createProvider(
    { provider: "gpt", apiKey: "sk-test" },
    {}
  );
  assert.equal(provider.name, "gpt");
});

test('createProvider: "gemini" alias resolves to google', () => {
  const provider = createProvider(
    { provider: "gemini", apiKey: "google-key" },
    {}
  );
  assert.equal(provider.name, "gemini");
});

test("createProvider: falls back to mock when no api key", () => {
  const provider = createProvider({}, {});
  assert.equal(provider.name, "mock");
});

test("createProvider: throws for unsupported provider name", () => {
  assert.throws(
    () => createProvider({ provider: "nonexistent-provider" }),
    { message: /Unsupported chat provider/ }
  );
});

test("createProvider: HAX_AGENT_PROVIDER env takes priority", () => {
  const provider = createProvider(
    {},
    {
      HAX_AGENT_PROVIDER: "openai",
      ANTHROPIC_API_KEY: "ant-key",
      OPENAI_API_KEY: "openai-key",
    }
  );
  assert.equal(provider.name, "openai");
  assert.equal(provider.apiKey, "openai-key");
});

test("createProvider: AI_PROVIDER env as fallback", () => {
  const provider = createProvider(
    {},
    {
      AI_PROVIDER: "google",
      GOOGLE_API_KEY: "google-key",
    }
  );
  assert.equal(provider.name, "google");
});

test("createProvider: resolves api key from config over env", () => {
  const provider = createProvider(
    { provider: "anthropic", apiKey: "config-key" },
    { ANTHROPIC_API_KEY: "env-key" }
  );
  assert.equal(provider.apiKey, "config-key");
});

test("createProvider: resolves api url from config over env", () => {
  const provider = createProvider(
    { provider: "anthropic", apiKey: "k", apiUrl: "https://custom.test" },
    { HAX_AGENT_API_URL: "https://env.test" }
  );
  assert.equal(provider.apiUrl, "https://custom.test");
});

test("createProvider: resolves api url from HAX_AGENT_API_URL", () => {
  const provider = createProvider(
    { provider: "openai", apiKey: "k" },
    { HAX_AGENT_API_URL: "https://hax.test" }
  );
  assert.equal(provider.apiUrl, "https://hax.test");
});

test("createProvider: resolves openai base url", () => {
  const provider = createProvider(
    { provider: "openai", apiKey: "k" },
    { OPENAI_BASE_URL: "https://openai.test" }
  );
  assert.equal(provider.apiUrl, "https://openai.test");
});

test("createProvider: resolves google base url", () => {
  const provider = createProvider(
    { provider: "google", apiKey: "k" },
    { GOOGLE_BASE_URL: "https://google.test" }
  );
  assert.equal(provider.apiUrl, "https://google.test");
});

test("createProvider: uses HAX_AGENT_MODEL from env", () => {
  const provider = createProvider(
    { provider: "mock" },
    { HAX_AGENT_MODEL: "custom-model" }
  );
  assert.equal(provider.model, "custom-model");
});

test("createProvider: uses AI_MODEL from env as fallback", () => {
  const provider = createProvider(
    { provider: "mock" },
    { AI_MODEL: "ai-fallback-model" }
  );
  assert.equal(provider.model, "ai-fallback-model");
});

test("createProvider: config model takes priority over env", () => {
  const provider = createProvider(
    { provider: "mock", model: "config-model" },
    { HAX_AGENT_MODEL: "env-model" }
  );
  assert.equal(provider.model, "config-model");
});

test("createProvider: mock provider respects delayMs", () => {
  const provider = createProvider(
    { provider: "mock", delayMs: 42 },
    {}
  );
  assert.equal(provider.delayMs, 42);
});

test("createProvider: mock provider respects toolTrace", () => {
  const provider = createProvider(
    { provider: "mock", toolTrace: true },
    {}
  );
  assert.equal(provider.toolTrace, true);
});

test("createProvider: mock provider reads delayMs from env", () => {
  const provider = createProvider(
    { provider: "mock" },
    { HAX_AGENT_MOCK_DELAY_MS: "100" }
  );
  assert.equal(provider.delayMs, 100);
});

test("createProvider: mock provider reads toolTrace from env", () => {
  const provider = createProvider(
    { provider: "mock" },
    { HAX_AGENT_MOCK_TOOL_TRACE: "1" }
  );
  assert.equal(provider.toolTrace, true);
});

test("createProvider: ignores invalid delayMs values", () => {
  const provider = createProvider(
    { provider: "mock", delayMs: -5 },
    {}
  );
  assert.equal(provider.delayMs, 0);
});

test("createProvider: mock provider reads response from config", () => {
  const provider = createProvider(
    { provider: "mock", response: "custom response" },
    {}
  );
  assert.equal(provider.response, "custom response");
});

test("createProvider: mock provider reads response from env", () => {
  const provider = createProvider(
    { provider: "mock" },
    { HAX_AGENT_MOCK_RESPONSE: "env response" }
  );
  assert.equal(provider.response, "env response");
});

test("registerProvider: adds new provider alias", () => {
  class TestProvider {
    constructor(opts) {
      this.name = opts.name || "test";
      this.model = opts.model;
    }
  }

  registerProvider("test-provider", TestProvider);
  const provider = createProvider(
    { provider: "test-provider" },
    {}
  );
  assert.equal(provider.name, "test-provider");
});

test("registerProvider: throws for empty name", () => {
  assert.throws(
    () => registerProvider("", class {}),
    { message: /Provider name is required/ }
  );
});

test("registerProvider: throws for non-constructor", () => {
  assert.throws(
    () => registerProvider("bad", "not-a-class"),
    { message: /Provider must be a constructor/ }
  );
});
