"use strict";

const { AnthropicProvider } = require("./anthropic-provider");
const { MockProvider } = require("./mock-provider");

const PROVIDERS = {
  anthropic: AnthropicProvider,
  claude: AnthropicProvider,
  local: MockProvider,
  mock: MockProvider,
};

function createProvider(config = {}, env = process.env) {
  const providerName = normalizeProviderName(config.provider || env.HAX_AGENT_PROVIDER || env.AI_PROVIDER || resolveProviderFromConfig(config, env));
  const Provider = PROVIDERS[providerName];

  if (!Provider) {
    throw new Error(`Unsupported chat provider: ${providerName}`);
  }

  return new Provider({
    ...config,
    name: providerName,
    apiKey: config.apiKey || env.ANTHROPIC_API_KEY,
    apiUrl: config.apiUrl || env.HAX_AGENT_API_URL || env.ANTHROPIC_BASE_URL,
    model: config.model || env.HAX_AGENT_MODEL || env.AI_MODEL,
    maxTokens: config.maxTokens || env.HAX_AGENT_MAX_TOKENS,
    response: config.response || env.HAX_AGENT_MOCK_RESPONSE,
    delayMs: parseDelay(config.delayMs ?? env.HAX_AGENT_MOCK_DELAY_MS),
    toolTrace: config.toolTrace === true || env.HAX_AGENT_MOCK_TOOL_TRACE === '1',
  });
}

function registerProvider(name, Provider) {
  const providerName = normalizeProviderName(name);

  if (!providerName) {
    throw new Error("Provider name is required");
  }

  if (typeof Provider !== "function") {
    throw new Error("Provider must be a constructor");
  }

  PROVIDERS[providerName] = Provider;
}

function normalizeProviderName(name) {
  return String(name || "").trim().toLowerCase();
}

function resolveProviderFromConfig(config, env) {
  const hasApiKey = config.apiKey || env.ANTHROPIC_API_KEY;
  const hasApiUrl = config.apiUrl || env.HAX_AGENT_API_URL || env.ANTHROPIC_BASE_URL;

  if (hasApiKey) {
    return hasApiUrl ? 'anthropic' : 'anthropic';
  }

  return 'mock';
}

function parseDelay(delayMs) {
  const delay = Number(delayMs);
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

module.exports = {
  createProvider,
  registerProvider,
};
