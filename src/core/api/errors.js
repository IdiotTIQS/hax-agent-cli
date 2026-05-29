"use strict";

/**
 * API Error Types — structured error classification for API calls.
 * Ported from OpenHarness api/errors.py pattern.
 *
 * Replaces string-based error detection (isPromptTooLongError, etc.)
 * with typed error objects that carry classification, retryability,
 * and context for reliable error recovery.
 *
 * Error hierarchy:
 *   ApiError (base)
 *   ├── ContextTooLongError     — prompt exceeds context window (non-retryable)
 *   ├── RateLimitError          — rate limited (retryable with backoff)
 *   ├── ServerError             — 5xx server errors (retryable)
 *   ├── AuthError               — authentication failure (non-retryable)
 *   ├── BadRequestError         — malformed request (non-retryable)
 *   ├── TimeoutError            — request timed out (retryable)
 *   ├── NetworkError            — network failure (retryable)
 *   ├── AbortError              — request was aborted (non-retryable)
 *   └── UnknownError            — unclassified (retryable if transient)
 */

// === Error Codes ===

const ApiErrorCode = {
  CONTEXT_TOO_LONG: "CONTEXT_TOO_LONG",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  BAD_REQUEST: "BAD_REQUEST",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  ABORTED: "ABORTED",
  UNKNOWN: "UNKNOWN",
};

// === Base API Error ===

class ApiError extends Error {
  /**
   * @param {string} message — human-readable error message
   * @param {Object} options
   * @param {string} [options.code] — ApiErrorCode
   * @param {boolean} [options.retryable] — whether retrying may succeed
   * @param {number} [options.status] — HTTP status code if applicable
   * @param {Object} [options.details] — additional context (model, provider, etc.)
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code || ApiErrorCode.UNKNOWN;
    this.retryable = options.retryable !== undefined ? options.retryable : false;
    this.status = options.status || null;
    this.details = options.details || {};
  }
}

// === Context Too Long Error ===

class ContextTooLongError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.CONTEXT_TOO_LONG,
      retryable: false,
      ...options,
    });
    this.name = "ContextTooLongError";
  }
}

// === Rate Limit Error ===

class RateLimitError extends ApiError {
  /**
   * @param {string} message
   * @param {Object} options
   * @param {number} [options.retryAfterMs] — suggested retry delay from headers
   */
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.RATE_LIMITED,
      retryable: true,
      status: 429,
      ...options,
    });
    this.name = "RateLimitError";
    this.retryAfterMs = options.retryAfterMs || null;
  }
}

// === Server Error ===

class ServerError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.SERVER_ERROR,
      retryable: true,
      status: options.status || 500,
      ...options,
    });
    this.name = "ServerError";
  }
}

// === Auth Error ===

class AuthError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.AUTH_ERROR,
      retryable: false,
      status: options.status || 401,
      ...options,
    });
    this.name = "AuthError";
  }
}

// === Bad Request Error ===

class BadRequestError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.BAD_REQUEST,
      retryable: false,
      status: 400,
      ...options,
    });
    this.name = "BadRequestError";
  }
}

// === Timeout Error ===

class TimeoutError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.TIMEOUT,
      retryable: true,
      ...options,
    });
    this.name = "TimeoutError";
  }
}

// === Network Error ===

class NetworkError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.NETWORK_ERROR,
      retryable: true,
      ...options,
    });
    this.name = "NetworkError";
  }
}

// === Abort Error ===

class AbortError extends ApiError {
  constructor(message = "Request was aborted", options = {}) {
    super(message, {
      code: ApiErrorCode.ABORTED,
      retryable: false,
      ...options,
    });
    this.name = "AbortError";
  }
}

// === Unknown Error ===

class UnknownError extends ApiError {
  constructor(message, options = {}) {
    super(message, {
      code: ApiErrorCode.UNKNOWN,
      retryable: options.retryable !== undefined ? options.retryable : true,
      ...options,
    });
    this.name = "UnknownError";
  }
}

// === Error Classifier ===

/**
 * Classify a raw error into a typed ApiError.
 *
 * @param {Error|string|Object} err — raw error from API call
 * @param {Object} [context] — { provider, model }
 * @returns {ApiError}
 */
function classifyApiError(err, context = {}) {
  if (err instanceof ApiError) return err;

  const message = err?.message || String(err);
  const status = err?.status || err?.statusCode || err?.response?.status;

  // Abort / cancel
  if (
    err?.name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("canceled") ||
    message.includes("Request was aborted")
  ) {
    return new AbortError(message, { details: { ...context, originalError: err } });
  }

  // Rate limiting (429)
  if (status === 429 || message.match(/rate limit|too many requests|quota exceeded/i)) {
    const retryAfterMs = _parseRetryAfter(err);
    return new RateLimitError(message, {
      status: 429,
      retryAfterMs,
      details: { ...context, originalError: err },
    });
  }

  // Authentication (401, 403)
  if (status === 401 || status === 403 || message.match(/unauthorized|forbidden|invalid api key|authentication/i)) {
    return new AuthError(message, {
      status: status || 401,
      details: { ...context, originalError: err },
    });
  }

  // Context too long
  if (
    message.includes("prompt is too long") ||
    message.includes("context_length_exceeded") ||
    message.includes("maximum context length") ||
    message.includes("reduce the length") ||
    message.includes("too many tokens") ||
    message.includes("token limit") ||
    message.includes("exceeds model's maximum")
  ) {
    return new ContextTooLongError(message, {
      details: { ...context, originalError: err },
    });
  }

  // Bad request (400)
  if (status === 400) {
    return new BadRequestError(message, {
      status: 400,
      details: { ...context, originalError: err },
    });
  }

  // Server errors (5xx)
  if (status && status >= 500) {
    return new ServerError(message, {
      status,
      details: { ...context, originalError: err },
    });
  }

  // Timeout
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("ETIMEDOUT")
  ) {
    return new TimeoutError(message, {
      details: { ...context, originalError: err },
    });
  }

  // Network errors
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("ENOTFOUND") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("connection")
  ) {
    return new NetworkError(message, {
      details: { ...context, originalError: err },
    });
  }

  // Default: unknown, potentially retryable for transient errors
  return new UnknownError(message, {
    retryable: true,
    details: { ...context, originalError: err },
  });
}

/**
 * Check if an error is a "context too long" error.
 * Replaces the old isPromptTooLongError() string match.
 *
 * @param {Error|Object} err
 * @returns {boolean}
 */
function isContextTooLongError(err) {
  if (err instanceof ContextTooLongError) return true;
  const classified = classifyApiError(err);
  return classified instanceof ContextTooLongError;
}

/**
 * Check if an error is retryable.
 *
 * @param {Error|Object} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  if (err instanceof ApiError) return err.retryable;
  const classified = classifyApiError(err);
  return classified.retryable;
}

// === Retry-After Parser ===

function _parseRetryAfter(err) {
  // Try to extract from response headers
  const headers = err?.response?.headers || err?.headers || {};
  const retryAfter = headers["retry-after"] || headers["Retry-After"];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return null;
}

// === Backward Compatibility ===

/**
 * Legacy string-based check for prompt-too-long errors.
 * @deprecated Use isContextTooLongError() instead.
 */
function isPromptTooLongError(err) {
  return isContextTooLongError(err);
}

// === Exports ===

module.exports = {
  // Error codes
  ApiErrorCode,

  // Error classes
  ApiError,
  ContextTooLongError,
  RateLimitError,
  ServerError,
  AuthError,
  BadRequestError,
  TimeoutError,
  NetworkError,
  AbortError,
  UnknownError,

  // Classifier
  classifyApiError,
  isContextTooLongError,
  isRetryableError,

  // Legacy
  isPromptTooLongError,
};
