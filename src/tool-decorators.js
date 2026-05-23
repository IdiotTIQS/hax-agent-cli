"use strict";

/**
 * Tool decorators for enhancing tool execution with cross-cutting concerns.
 *
 * Decorators wrap async execute functions with additional behaviors:
 * timeouts, validation, rate limiting, caching, and metrics.
 * They are designed to be composable via composeDecorators().
 *
 * Each decorator follows the signature:
 *   (fn: asyncFunction) => asyncFunction
 */

const { ToolExecutionError } = require('./tools/error');

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

/**
 * Wrap an async function with a timeout. Throws TOOL_TIMEOUT if execution
 * exceeds the specified duration.
 *
 * @param {Function} fn - Async function to wrap
 * @param {number} ms - Timeout in milliseconds
 * @returns {Function} Wrapped function
 */
function withTimeout(fn, ms) {
  if (typeof fn !== 'function') {
    throw new TypeError('withTimeout: fn must be a function');
  }
  const timeoutMs = positiveInteger(ms, ms);

  return async function (...args) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new ToolExecutionError(
          'TOOL_TIMEOUT',
          `Operation timed out after ${timeoutMs}ms`,
        ));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([fn(...args), timeout]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// withValidation
// ---------------------------------------------------------------------------

/**
 * Field descriptor for simple schema validation.
 *
 * @typedef {object} FieldSchema
 * @property {string} type - Expected type: 'string', 'number', 'boolean', 'object', 'array'
 * @property {boolean} [required=false] - Whether the field must be present
 */

/**
 * Validate tool arguments against a simple schema before execution.
 *
 * The schema is a plain object mapping field names to field descriptors.
 * Only the first argument (typically `args`) is validated.
 *
 * @param {Function} fn - Async function to wrap
 * @param {Record<string, FieldSchema>} schema - Validation schema
 * @returns {Function} Wrapped function
 */
function withValidation(fn, schema) {
  if (typeof fn !== 'function') {
    throw new TypeError('withValidation: fn must be a function');
  }
  if (!schema || typeof schema !== 'object') {
    throw new TypeError('withValidation: schema must be an object');
  }

  return async function (args, ...rest) {
    if (!args || typeof args !== 'object') {
      throw new ToolExecutionError(
        'INVALID_ARGUMENT',
        'Tool arguments must be a plain object.',
      );
    }

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = args[fieldName];
      const isPresent = value !== undefined && value !== null;

      if (fieldSchema.required && !isPresent) {
        throw new ToolExecutionError(
          'MISSING_REQUIRED_FIELD',
          `Required field "${fieldName}" is missing.`,
        );
      }

      if (isPresent && fieldSchema.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== fieldSchema.type) {
          throw new ToolExecutionError(
            'INVALID_FIELD_TYPE',
            `Field "${fieldName}" expected type "${fieldSchema.type}" but got "${actualType}".`,
          );
        }
      }
    }

    return fn(args, ...rest);
  };
}

// ---------------------------------------------------------------------------
// withRateLimit
// ---------------------------------------------------------------------------

/**
 * Token-bucket rate limiter embedded in the decorator.
 *
 * Wraps an async function so that it will only execute if a token is available
 * in the bucket. Throws TOOL_RATE_LIMITED when the bucket is empty.
 *
 * @param {Function} fn - Async function to wrap
 * @param {object} options
 * @param {number} [options.maxPerMinute=60] - Sustained rate (tokens per minute)
 * @param {number} [options.maxBurst] - Burst capacity (defaults to maxPerMinute)
 * @returns {Function} Wrapped function
 */
function withRateLimit(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('withRateLimit: fn must be a function');
  }

  const maxPerMinute = positiveInteger(options.maxPerMinute, 60);
  const maxBurst = positiveInteger(options.maxBurst, maxPerMinute);
  const refillIntervalMs = Math.round(60_000 / maxPerMinute);

  let tokens = maxBurst;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;

    if (elapsed < refillIntervalMs) {
      return;
    }

    const earned = Math.floor(elapsed / refillIntervalMs);
    tokens = Math.min(maxBurst, tokens + earned);
    lastRefill = now - (elapsed % refillIntervalMs);
  }

  return async function (...args) {
    refill();

    if (tokens < 1) {
      throw new ToolExecutionError(
        'TOOL_RATE_LIMITED',
        `Rate limit exceeded. Max ${maxPerMinute} calls per minute.`,
      );
    }

    tokens -= 1;
    return fn(...args);
  };
}

// ---------------------------------------------------------------------------
// withCaching
// ---------------------------------------------------------------------------

/**
 * In-memory result cache for idempotent tools.
 *
 * Caches based on a shallow stringification of arguments. Supports TTL-based
 * eviction and LRU eviction when the cache exceeds maxSize.
 *
 * @param {Function} fn - Async function to wrap
 * @param {object} options
 * @param {number} [options.ttlMs=60_000] - Cache entry time-to-live in ms
 * @param {number} [options.maxSize=100] - Maximum number of cached entries
 * @returns {Function} Wrapped function
 */
function withCaching(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('withCaching: fn must be a function');
  }

  const ttlMs = positiveInteger(options.ttlMs, 60_000);
  const maxSize = positiveInteger(options.maxSize, 100);
  const cache = new Map(); // key -> { value, timestamp }
  const accessOrder = []; // LRU tracking

  function makeKey(args) {
    try {
      return JSON.stringify(args);
    } catch (_) {
      return String(args);
    }
  }

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > ttlMs) {
        cache.delete(key);
        const idx = accessOrder.indexOf(key);
        if (idx !== -1) accessOrder.splice(idx, 1);
      }
    }
  }

  function evictOldest() {
    if (accessOrder.length === 0) return;
    const oldest = accessOrder.shift();
    cache.delete(oldest);
  }

  return async function (...args) {
    const key = makeKey(args);

    // Evict expired entries on every call
    evictExpired();

    // Check cache hit
    if (cache.has(key)) {
      const entry = cache.get(key);
      if (Date.now() - entry.timestamp <= ttlMs) {
        // Update LRU order
        const idx = accessOrder.indexOf(key);
        if (idx !== -1) accessOrder.splice(idx, 1);
        accessOrder.push(key);
        return entry.value;
      }
      // Expired, remove it
      cache.delete(key);
      const idx = accessOrder.indexOf(key);
      if (idx !== -1) accessOrder.splice(idx, 1);
    }

    // Execute and cache
    const result = await fn(...args);

    // Evict oldest if at capacity
    if (accessOrder.length >= maxSize) {
      evictOldest();
    }

    cache.set(key, { value: result, timestamp: Date.now() });
    accessOrder.push(key);

    return result;
  };
}

// ---------------------------------------------------------------------------
// withMetrics
// ---------------------------------------------------------------------------

/**
 * Global metrics store shared across all withMetrics instances.
 * @type {Map<string, { count: number, totalDurationMs: number, errorCount: number }>}
 */
const metricsStore = new Map();

/**
 * Record execution metrics for a tool: invocation count, total duration,
 * and error count.
 *
 * @param {Function} fn - Async function to wrap
 * @param {string} toolName - Name of the tool for metrics grouping
 * @returns {Function} Wrapped function
 */
function withMetrics(fn, toolName) {
  if (typeof fn !== 'function') {
    throw new TypeError('withMetrics: fn must be a function');
  }
  if (typeof toolName !== 'string' || toolName.trim().length === 0) {
    throw new TypeError('withMetrics: toolName must be a non-empty string');
  }

  const name = toolName.trim();

  if (!metricsStore.has(name)) {
    metricsStore.set(name, { count: 0, totalDurationMs: 0, errorCount: 0 });
  }

  return async function (...args) {
    const startedAt = Date.now();
    const metrics = metricsStore.get(name);

    try {
      const result = await fn(...args);
      metrics.count += 1;
      metrics.totalDurationMs += Date.now() - startedAt;
      return result;
    } catch (error) {
      metrics.errorCount += 1;
      metrics.count += 1;
      metrics.totalDurationMs += Date.now() - startedAt;
      throw error;
    }
  };
}

/**
 * Retrieve metrics for a specific tool.
 *
 * @param {string} toolName
 * @returns {{ count: number, totalDurationMs: number, errorCount: number, avgDurationMs: number | null }}
 */
function getMetrics(toolName) {
  const metrics = metricsStore.get(toolName);
  if (!metrics) {
    return { count: 0, totalDurationMs: 0, errorCount: 0, avgDurationMs: null };
  }
  return {
    count: metrics.count,
    totalDurationMs: metrics.totalDurationMs,
    errorCount: metrics.errorCount,
    avgDurationMs: metrics.count > 0
      ? Math.round((metrics.totalDurationMs / metrics.count) * 100) / 100
      : null,
  };
}

/**
 * Reset all collected metrics.
 */
function resetMetrics() {
  metricsStore.clear();
}

/**
 * Reset metrics for a specific tool.
 * @param {string} toolName
 */
function resetToolMetrics(toolName) {
  metricsStore.delete(toolName);
}

// ---------------------------------------------------------------------------
// composeDecorators
// ---------------------------------------------------------------------------

/**
 * Compose multiple decorators on a function. Decorators are applied from
 * outermost to innermost (last decorator in the list is applied first).
 *
 * @param {Function} fn - Async function to decorate
 * @param {...Function} decorators - Decorator functions (fn) => fn
 * @returns {Function} Fully decorated function
 */
function composeDecorators(fn, ...decorators) {
  if (typeof fn !== 'function') {
    throw new TypeError('composeDecorators: fn must be a function');
  }

  let result = fn;
  // Apply right-to-left so the first decorator listed is the outermost wrapper
  for (let i = decorators.length - 1; i >= 0; i -= 1) {
    const decorator = decorators[i];
    if (typeof decorator !== 'function') {
      throw new TypeError('composeDecorators: each decorator must be a function');
    }
    result = decorator(result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function positiveInteger(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  withTimeout,
  withValidation,
  withRateLimit,
  withCaching,
  withMetrics,
  getMetrics,
  resetMetrics,
  resetToolMetrics,
  composeDecorators,
};
