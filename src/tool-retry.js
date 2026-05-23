"use strict";

const { debug } = require('./debug');
const { ToolExecutionError } = require('./tools/error');

/**
 * Tool execution retry wrapper.
 *
 * Wraps tool execute functions with configurable retry logic.
 * Supports exponential backoff, retryable error matching,
 * and per-tool configuration.
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;

/**
 * Create a retryable wrapper around a tool execute function.
 *
 * @param {object} options
 * @param {string} options.toolName - Name of the tool
 * @param {Function} options.execute - Original execute function (async)
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.baseDelayMs=500]
 * @param {number} [options.maxDelayMs=10000]
 * @param {Array<string|RegExp|Function>} [options.retryOn] - Error conditions to retry on
 * @returns {Function} Wrapped execute function with same signature
 */
function createRetryableTool(options = {}) {
  const toolName = String(options.toolName || 'unknown');
  const execute = options.execute;

  if (typeof execute !== 'function') {
    throw new ToolExecutionError('INVALID_TOOL_EXECUTOR', 'execute must be a function');
  }

  const maxRetries = positiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES);
  const baseDelayMs = positiveInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, positiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS));
  const retryOn = Array.isArray(options.retryOn) ? options.retryOn : [];

  return async function retryableExecute(args, context) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await execute(args, context);
        return result;
      } catch (error) {
        lastError = error;

        if (attempt >= maxRetries || !shouldRetry(error, retryOn)) {
          throw error;
        }

        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.random() * delay * 0.3;
        const waitMs = Math.round(delay + jitter);

        debug('tool-retry', `${toolName} attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${waitMs}ms...`);
        await sleep(waitMs);
      }
    }

    throw lastError;
  };
}

/**
 * Create a retry-adapted tool definition from an existing tool.
 * Wraps the execute function while preserving name, description, and schema.
 *
 * @param {object} tool - Tool definition { name, description, inputSchema, execute }
 * @param {object} [options] - Retry options
 * @returns {object} New tool definition with retryable execute
 */
function makeToolRetryable(tool, options = {}) {
  const retryableExecute = createRetryableTool({
    toolName: tool.name,
    execute: tool.execute,
    ...options,
  });

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: retryableExecute,
  };
}

/**
 * Create a retry policy for file operations (transient I/O errors).
 * @returns {Array<RegExp|Function>}
 */
function fileRetryPolicy() {
  return [
    /EBUSY/i,
    /EAGAIN/i,
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /EPIPE/i,
    /EMFILE/i,
    /ENFILE/i,
    /temporarily unavailable/i,
    (error) => error?.code === 'EBUSY' || error?.code === 'EAGAIN' || error?.code === 'ETIMEDOUT',
  ];
}

/**
 * Create a retry policy for network operations.
 * @returns {Array<RegExp|Function>}
 */
function networkRetryPolicy() {
  return [
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /EPIPE/i,
    /network error/i,
    /timeout/i,
    /429/i,
    /rate limit/i,
    /too many requests/i,
    /server error/i,
    /5\d\d/,
    (error) => typeof error?.status === 'number' && error.status >= 500,
    (error) => error?.code === 'ECONNRESET' || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT',
  ];
}

/**
 * Determine if an error should trigger a retry.
 * @param {Error} error
 * @param {Array<string|RegExp|Function>} retryOn
 * @returns {boolean}
 */
function shouldRetry(error, retryOn) {
  if (retryOn.length === 0) {
    return true; // retry all errors by default
  }

  const message = String(error?.message || '');
  const code = error?.code || '';
  const combined = `${message} ${code}`;

  for (const condition of retryOn) {
    if (typeof condition === 'function') {
      try {
        if (condition(error)) return true;
      } catch (_) {
        // condition evaluation failed, skip
      }
    } else if (condition instanceof RegExp) {
      if (condition.test(combined)) return true;
    } else if (typeof condition === 'string') {
      if (combined.toLowerCase().includes(condition.toLowerCase())) return true;
    }
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  createRetryableTool,
  makeToolRetryable,
  fileRetryPolicy,
  networkRetryPolicy,
  shouldRetry,
};
