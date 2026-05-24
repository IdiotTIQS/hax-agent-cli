"use strict";

const { AnthropicProvider } = require("./anthropic-provider");
const { OpenAIProvider } = require("./openai-provider");
const { GoogleProvider } = require("./google-provider");
const { MockProvider } = require("./mock-provider");

// ---- optional resilience modules (degrade gracefully) ----

let HealthChecker;
let createFallbackChain;
let selectHealthiestProvider;
try {
  const fallback = require("./fallback");
  HealthChecker = fallback.HealthChecker;
  createFallbackChain = fallback.createFallbackChain;
  selectHealthiestProvider = fallback.selectHealthiestProvider;
} catch (_) { /* module not available */ }

let ModelRouter;
try {
  ModelRouter = require("./router").ModelRouter;
} catch (_) { /* module not available */ }

let CircuitBreaker;
let CircuitBreakerOpenError;
try {
  const cb = require("../resilience/circuit-breaker");
  CircuitBreaker = cb.CircuitBreaker;
  CircuitBreakerOpenError = cb.CircuitBreakerOpenError;
} catch (_) { /* module not available */ }

let RetryPolicy;
let RETRY_STRATEGY;
try {
  const retry = require("../resilience/retry");
  RetryPolicy = retry.RetryPolicy;
  RETRY_STRATEGY = retry.STRATEGY;
} catch (_) { /* module not available */ }

const PROVIDERS = {
  anthropic: AnthropicProvider,
  claude: AnthropicProvider,
  openai: OpenAIProvider,
  gpt: OpenAIProvider,
  google: GoogleProvider,
  gemini: GoogleProvider,
  local: MockProvider,
  mock: MockProvider,
};

// ---- public API ----

function createProvider(config = {}, env = process.env) {
  const providerName = normalizeProviderName(config.provider || env.HAX_AGENT_PROVIDER || env.AI_PROVIDER || resolveProviderFromConfig(config, env));
  const Provider = PROVIDERS[providerName];

  if (!Provider) {
    throw new Error(`Unsupported chat provider: ${providerName}`);
  }

  const provider = new Provider({
    ...config,
    name: providerName,
    apiKey: resolveApiKey(config, env, providerName),
    apiUrl: resolveApiUrl(config, env, providerName),
    model: config.model || env.HAX_AGENT_MODEL || env.AI_MODEL,
    maxTokens: config.maxTokens || env.HAX_AGENT_MAX_TOKENS,
    response: config.response || env.HAX_AGENT_MOCK_RESPONSE,
    delayMs: parseDelay(config.delayMs ?? env.HAX_AGENT_MOCK_DELAY_MS),
    toolTrace: config.toolTrace === true || env.HAX_AGENT_MOCK_TOOL_TRACE === '1',
  });

  // Mark apiKey non-enumerable so it won't appear in JSON.stringify or console.log.
  Object.defineProperty(provider, 'apiKey', { enumerable: false });

  if (config.enableResilience) {
    return wrapWithResilience(provider, config);
  }

  return provider;
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

// ---- resilience wrapper ----

function wrapWithResilience(provider, config) {
  const _health = HealthChecker
    ? new HealthChecker({ providerName: provider.name || "unknown" })
    : null;

  const _breaker = CircuitBreaker
    ? new CircuitBreaker({
        failureThreshold: 5,
        name: provider.name || "provider",
      })
    : null;

  const _retry = RetryPolicy
    ? new RetryPolicy({
        maxRetries: 3,
        baseDelay: 500,
        maxDelay: 10_000,
        strategy: (RETRY_STRATEGY && RETRY_STRATEGY.EXPONENTIAL) || "EXPONENTIAL",
        retryOn: [
          function shouldRetryOnTransient(err) { return isTransientError(err); },
        ],
        retryAllErrors: false,
        name: provider.name || "retry",
      })
    : null;

  // ModelRouter with fallback chain if multiple models are configured
  let _router = null;
  let _fallbackChain = null;

  if (ModelRouter && Array.isArray(config.models) && config.models.length > 0) {
    _router = new ModelRouter();
    for (const m of config.models) {
      _router.registerModel(m);
    }
  }

  // Build a fallback chain if fallback providers are configured
  if (createFallbackChain && Array.isArray(config.fallbackProviders) && config.fallbackProviders.length > 0) {
    _fallbackChain = createFallbackChain(config.fallbackProviders);
  }

  // ---- decorated provider ----

  const decorated = {
    name: provider.name || "provider",

    async chat(request) {
      return _resilientCall(
        () => _tryChat(request),
        _health, _breaker, _retry,
      );
    },

    async stream(request) {
      return _resilientCall(
        () => _tryStream(request),
        _health, _breaker, _retry,
      );
    },

    setModel(model) { return provider.setModel(model); },
    setApiUrl(url) { return provider.setApiUrl(url); },
    setApiKey(key) { return provider.setApiKey(key); },

    listModels() { return provider.listModels(); },
    getModel() { return typeof provider.getModel === "function" ? provider.getModel() : undefined; },
    getApiUrl() { return typeof provider.getApiUrl === "function" ? provider.getApiUrl() : undefined; },

    // Health and diagnostics
    getProviderHealth() {
      return _buildHealthReport(_health, _breaker, _retry, _router);
    },

    get health() {
      return _health ? _health.toJSON() : null;
    },

    get circuitBreakerState() {
      return _breaker ? _breaker.getState() : null;
    },
  };

  return decorated;

  // ---- inner helpers (encapsulated so they can close over _router, _fallbackChain, provider) ----

  async function _tryChat(request) {
    // 1. If router is configured, select best model
    if (_router) {
      const task = _buildTask(request, config);
      const bestModel = _router.route(task);
      if (bestModel && bestModel.modelName) {
        provider.setModel(bestModel.modelName);
      }
    }

    // 2. Try primary provider first
    try {
      return await provider.chat(request);
    } catch (primaryErr) {
      // 3. Fallback chain — try alternate models / providers
      if (_fallbackChain) {
        try {
          return await _fallbackChain(request);
        } catch (_fallbackErr) {
          throw primaryErr; // re-throw original error
        }
      }
      throw primaryErr;
    }
  }

  async function _tryStream(request) {
    if (_router) {
      const task = _buildTask(request, config);
      const bestModel = _router.route(task);
      if (bestModel && bestModel.modelName) {
        provider.setModel(bestModel.modelName);
      }
    }

    return provider.stream(request);
  }
}

function _resilientCall(fn, health, breaker, retry) {
  const startTime = Date.now();

  // Build the layered executor: breaker envelops retry envelops fn
  const execute = () => {
    if (breaker && retry) {
      return breaker.execute(() => retry.execute(fn));
    }
    if (breaker) {
      return breaker.execute(fn);
    }
    if (retry) {
      return retry.execute(fn);
    }
    return fn();
  };

  return execute().then(
    (result) => {
      if (health) health.recordSuccess(Date.now() - startTime);
      return result;
    },
    (err) => {
      if (health) health.recordFailure(err);
      throw err;
    },
  );
}

function _buildHealthReport(health, breaker, retry, router) {
  const report = {};

  if (health) {
    Object.assign(report, health.toJSON());
  }

  if (breaker) {
    report.circuitBreaker = breaker.getState();
  }

  if (retry) {
    report.retry = {
      attempt: retry.getAttempt(),
      config: retry.config,
    };
  }

  if (router) {
    try {
      report.modelStats = router.getModelStats();
    } catch (_) { /* model stats unavailable */ }
  }

  return report;
}

function _buildTask(request, config) {
  return {
    estimatedInputTokens: request?.estimatedInputTokens,
    estimatedOutputTokens: request?.estimatedOutputTokens,
    maxTokens: request?.maxTokens || config?.maxTokens,
    needsVision: Boolean(request?.needsVision),
    needsTools: Boolean(request?.needsTools),
    needsStreaming: Boolean(request?.needsStreaming),
    needsCaching: Boolean(request?.needsCaching),
    needsLongContext: Boolean(request?.needsLongContext),
    needsReasoning: Boolean(request?.needsReasoning),
    maxCost: request?.maxCost || config?.maxCost,
    preferredProvider: request?.preferredProvider || config?.provider,
  };
}

function isTransientError(err) {
  if (!err) return false;

  // Auth errors — never retry
  const status = err.status || err.statusCode;
  if (status === 401 || status === 403) return false;

  // Retryable HTTP status codes
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;

  // Network / transport errors
  const code = String(err.code || "").toUpperCase();
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE"
  ) {
    return true;
  }

  // Check message text for timeout / transport indicators
  const msg = String(err.message || "").toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("network error") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }

  return false;
}

// ---- configuration resolution ----

/**
 * Resolve the API key for a given provider.
 *
 * WARNING: The returned value is a raw, sensitive API key.  Callers MUST NOT
 * log, serialize, or transmit it unnecessarily.  The `apiKey` property on the
 * provider instance is marked non-enumerable so it won't appear in
 * JSON.stringify or console.log output.
 */
function resolveApiKey(config, env, providerName) {
  if (config.apiKey) return config.apiKey;
  if (providerName === "openai" || providerName === "gpt") return env.OPENAI_API_KEY;
  if (providerName === "google" || providerName === "gemini") return env.GOOGLE_API_KEY;
  return env.ANTHROPIC_API_KEY;
}

function resolveApiUrl(config, env, providerName) {
  if (config.apiUrl) return config.apiUrl;
  if (env.HAX_AGENT_API_URL) return env.HAX_AGENT_API_URL;
  if (providerName === "openai" || providerName === "gpt") return env.OPENAI_BASE_URL;
  if (providerName === "google" || providerName === "gemini") return env.GOOGLE_BASE_URL;
  return env.ANTHROPIC_BASE_URL;
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
