"use strict";

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_CIRCUIT_THRESHOLD = 5;
const DEFAULT_CIRCUIT_RESET_MS = 30 * 1000; // 30 seconds

/**
 * Composable request pipeline with middleware support.
 *
 * Middleware objects have:
 *   - name: string (required)
 *   - handler(ctx, next): async function — mutates ctx, calls next() to proceed
 *
 * Pipeline stages:
 *   pre-process (middleware before next()) → execute → post-process (after next())
 *
 * Built-in middleware factories are provided as static methods.
 */
class RequestPipeline {
  constructor(options = {}) {
    this._middlewares = [];
    this._requestHandler = typeof options.requestHandler === "function"
      ? options.requestHandler
      : null;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Register a middleware in the pipeline.
   * The middleware object must have a string `name` property and optionally
   * a `handler(ctx, next)` function.
   *
   * @param {{ name: string, handler?: Function }} middleware
   * @returns {this}
   */
  use(middleware) {
    if (!middleware || typeof middleware !== "object") {
      throw new Error("Middleware must be a non-null object");
    }
    if (typeof middleware.name !== "string" || middleware.name.length === 0) {
      throw new Error('Middleware must have a non-empty string "name" property');
    }
    if (middleware.handler !== undefined && typeof middleware.handler !== "function") {
      throw new Error("Middleware handler must be a function if provided");
    }

    this._middlewares.push(middleware);
    return this;
  }

  /**
   * Execute a request through the pipeline.
   *
   * @param {*} request - The request object (shape depends on middleware chain)
   * @returns {Promise<*>} The final response
   */
  async execute(request) {
    const ctx = {
      request,
      response: null,
      metadata: {},
      state: {},
      errors: [],
    };

    await this._runChain(ctx, 0);

    return ctx.response;
  }

  /**
   * Remove a middleware by name.
   * @param {string} name
   * @returns {this}
   */
  removeMiddleware(name) {
    const index = this._middlewares.findIndex((mw) => mw.name === name);
    if (index !== -1) {
      this._middlewares.splice(index, 1);
    }
    return this;
  }

  /**
   * Inspect the current pipeline configuration.
   * @returns {Array<{ name: string, hasHandler: boolean }>}
   */
  getPipeline() {
    return this._middlewares.map((mw) => ({
      name: mw.name,
      hasHandler: typeof mw.handler === "function",
    }));
  }

  // ── Private ─────────────────────────────────────────────────────────────

  async _runChain(ctx, index) {
    if (index >= this._middlewares.length) {
      // End of chain: run the actual request handler
      if (this._requestHandler && ctx.response === null) {
        try {
          ctx.response = await this._requestHandler(ctx.request, ctx);
        } catch (err) {
          ctx.errors.push({ stage: "execute", error: err.message, timestamp: Date.now() });
          throw err;
        }
      }
      return;
    }

    const mw = this._middlewares[index];
    const next = async () => this._runChain(ctx, index + 1);

    if (typeof mw.handler === "function") {
      await mw.handler(ctx, next);
    } else {
      // Middleware with no handler is a passthrough
      await next();
    }
  }
}

// ── Built-in middleware factories ─────────────────────────────────────────

/**
 * Transform middleware: modifies request before downstream and/or response after.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {Function} [options.transformRequest] - (ctx) => void — modify ctx.request
 * @param {Function} [options.transformResponse] - (ctx) => void — modify ctx.response
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createTransformMiddleware = function (options = {}) {
  const name = String(options.name || "transform");
  return {
    name,
    handler: async function (ctx, next) {
      if (typeof options.transformRequest === "function") {
        await options.transformRequest(ctx);
      }
      await next();
      if (typeof options.transformResponse === "function") {
        await options.transformResponse(ctx);
      }
    },
  };
};

/**
 * Cache middleware: checks cache before executing, stores response after.
 *
 * The cache instance must implement: get(key), set(key, response, ttl).
 *
 * @param {object} options
 * @param {object} options.cache - Cache instance with get/set methods
 * @param {Function} [options.keyGenerator] - (ctx) => string — custom key function
 * @param {number} [options.ttl] - TTL in ms for cached entries
 * @param {string} [options.name]
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createCacheMiddleware = function (options = {}) {
  const name = String(options.name || "cache");
  const cache = options.cache;
  const ttl = Number.isFinite(options.ttl) && options.ttl > 0 ? options.ttl : undefined;

  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") {
    throw new Error("Cache middleware requires a cache instance with get() and set() methods");
  }

  return {
    name,
    handler: async function (ctx, next) {
      const key = typeof options.keyGenerator === "function"
        ? options.keyGenerator(ctx)
        : _defaultCacheKey(ctx);

      ctx.metadata.cacheKey = key;

      const cached = cache.get(key);
      if (cached !== null && cached !== undefined) {
        ctx.response = cached;
        ctx.metadata.cacheHit = true;
        return;
      }

      ctx.metadata.cacheHit = false;
      await next();

      if (ctx.response !== null && ctx.response !== undefined) {
        cache.set(key, ctx.response, ttl);
      }
    },
  };
};

/**
 * Rate limit middleware: rejects requests that exceed configured limits.
 *
 * The limiter instance must implement: acquire(key).
 *
 * @param {object} options
 * @param {object} options.limiter - Rate limiter instance with acquire(key)
 * @param {Function} [options.keyResolver] - (ctx) => string
 * @param {string} [options.name]
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createRateLimitMiddleware = function (options = {}) {
  const name = String(options.name || "rateLimit");
  const limiter = options.limiter;

  if (!limiter || typeof limiter.acquire !== "function") {
    throw new Error("Rate limit middleware requires a limiter instance with acquire() method");
  }

  return {
    name,
    handler: async function (ctx, next) {
      const key = typeof options.keyResolver === "function"
        ? options.keyResolver(ctx)
        : _defaultRateLimitKey(ctx);

      ctx.metadata.rateLimitKey = key;

      if (!limiter.acquire(key)) {
        const err = new Error(`Rate limit exceeded for key: ${key}`);
        err.code = "RATE_LIMITED";
        err.status = 429;
        ctx.errors.push({ stage: "rateLimit", error: err.message, timestamp: Date.now() });
        ctx.response = { error: err.message, code: "RATE_LIMITED", status: 429 };
        return;
      }

      ctx.metadata.rateLimited = false;
      await next();
    },
  };
};

/**
 * Log middleware: logs request and response metadata.
 *
 * @param {object} options
 * @param {Function} [options.logger] - (level, message, data) => void
 * @param {string} [options.name]
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createLogMiddleware = function (options = {}) {
  const name = String(options.name || "log");
  const logger = typeof options.logger === "function"
    ? options.logger
    : (level, message, data) => { /* noop */ };

  return {
    name,
    handler: async function (ctx, next) {
      const start = Date.now();
      ctx.metadata.requestTime = start;

      logger("info", "request:start", {
        method: ctx.request?.method,
        url: ctx.request?.url,
        timestamp: start,
      });

      try {
        await next();
        const duration = Date.now() - start;
        ctx.metadata.duration = duration;

        logger("info", "request:end", {
          method: ctx.request?.method,
          url: ctx.request?.url,
          duration,
          cacheHit: ctx.metadata.cacheHit,
          status: ctx.response?.status || ctx.response?.code,
        });
      } catch (err) {
        const duration = Date.now() - start;
        ctx.metadata.duration = duration;

        logger("error", "request:error", {
          method: ctx.request?.method,
          url: ctx.request?.url,
          duration,
          error: err.message,
        });
        throw err;
      }
    },
  };
};

/**
 * Retry middleware: retries on failure up to configured max attempts.
 *
 * @param {object} options
 * @param {number} [options.maxRetries] - Maximum retry attempts (default 3)
 * @param {number} [options.retryDelay] - Base delay in ms (default 1000)
 * @param {Function} [options.shouldRetry] - (ctx, attempt) => boolean
 * @param {Function} [options.onRetry] - (ctx, attempt, error) => void
 * @param {string} [options.name]
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createRetryMiddleware = function (options = {}) {
  const name = String(options.name || "retry");
  const maxRetries = Number.isFinite(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : DEFAULT_RETRY_COUNT;
  const retryDelay = Number.isFinite(options.retryDelay) && options.retryDelay > 0
    ? options.retryDelay
    : DEFAULT_RETRY_DELAY_MS;

  return {
    name,
    handler: async function (ctx, next) {
      let lastError = null;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          // Reset response for each attempt (except the first)
          if (attempt > 0) {
            ctx.response = null;
          }

          await next();
          return; // success
        } catch (err) {
          lastError = err;
          ctx.errors.push({
            stage: "retry",
            attempt,
            error: err.message,
            timestamp: Date.now(),
          });

          const shouldRetry = typeof options.shouldRetry === "function"
            ? options.shouldRetry(ctx, attempt)
            : attempt < maxRetries;

          if (!shouldRetry) {
            throw err;
          }

          if (typeof options.onRetry === "function") {
            options.onRetry(ctx, attempt, err);
          }

          // Exponential backoff
          const delay = retryDelay * Math.pow(2, attempt);
          await _sleep(delay);
        }
      }

      throw lastError || new Error("Retry exhausted");
    },
  };
};

/**
 * Circuit breaker middleware: opens circuit after threshold failures.
 *
 * @param {object} options
 * @param {number} [options.failureThreshold] - Failures before opening (default 5)
 * @param {number} [options.resetTimeout] - Time in ms before half-open (default 30000)
 * @param {Function} [options.onOpen] - (ctx) => void
 * @param {Function} [options.onClose] - (ctx) => void
 * @param {string} [options.name]
 * @returns {{ name: string, handler: Function }}
 */
RequestPipeline.createCircuitBreakerMiddleware = function (options = {}) {
  const name = String(options.name || "circuit");
  const failureThreshold = Number.isFinite(options.failureThreshold) && options.failureThreshold > 0
    ? options.failureThreshold
    : DEFAULT_CIRCUIT_THRESHOLD;
  const resetTimeout = Number.isFinite(options.resetTimeout) && options.resetTimeout > 0
    ? options.resetTimeout
    : DEFAULT_CIRCUIT_RESET_MS;

  let failures = 0;
  let lastFailureTime = 0;
  let circuitOpen = false;

  return {
    name,
    handler: async function (ctx, next) {
      // Check if circuit is open
      if (circuitOpen) {
        const elapsed = Date.now() - lastFailureTime;
        if (elapsed >= resetTimeout) {
          // Half-open: allow one trial request
          circuitOpen = false;
          failures = 0;
        } else {
          const err = new Error(`Circuit breaker open. Retry after ${Math.ceil((resetTimeout - elapsed) / 1000)}s`);
          err.code = "CIRCUIT_OPEN";
          err.status = 503;
          ctx.errors.push({ stage: "circuit", error: err.message, timestamp: Date.now() });
          ctx.response = { error: err.message, code: "CIRCUIT_OPEN", status: 503 };
          return;
        }
      }

      try {
        await next();
        // Success resets failure count
        failures = 0;
      } catch (err) {
        failures += 1;
        lastFailureTime = Date.now();

        if (failures >= failureThreshold) {
          circuitOpen = true;
          if (typeof options.onOpen === "function") {
            options.onOpen(ctx);
          }
        }

        throw err;
      }
    },
  };
};

// ── Internal helpers ──────────────────────────────────────────────────────

function _defaultCacheKey(ctx) {
  const method = String(ctx.request?.method || "GET").toUpperCase();
  const url = String(ctx.request?.url || "");
  const body = ctx.request?.body
    ? (typeof ctx.request.body === "string" ? ctx.request.body : JSON.stringify(ctx.request.body))
    : "";
  return `${method}:${url}:${body || "empty"}`;
}

function _defaultRateLimitKey(ctx) {
  return String(ctx.request?.url || ctx.request?.method || "default");
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { RequestPipeline };
