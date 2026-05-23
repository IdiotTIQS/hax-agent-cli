/**
 * ErrorEnhancer — enriches tool errors with context, suggestions,
 * documentation links, and debug info for more helpful error messages.
 */
"use strict";

const { ErrorCodes } = require("../../tools/error-codes");

// ── Suggestion database: maps error codes to user-facing guidance ────

const SUGGESTIONS = {
  // Validation
  INVALID_ARGUMENT:
    "Check the argument type and value — the tool expects a specific format. Review the tool's parameter schema.",
  INVALID_ENCODING:
    "Use a supported encoding (utf8, utf-8, base64, hex, latin1, ascii). Check the encoding parameter spelling.",
  INVALID_LIMIT:
    "Ensure the limit value is a positive safe integer within the tool's allowed range.",
  INVALID_REGEX:
    "Your regular expression is malformed or uses unsafe constructs. Test it against a regex validator and avoid catastrophic backtracking patterns.",
  INVALID_SHELL_ARGS:
    "Shell command arguments must be provided as an array of strings, e.g. ['ls', '-la'].",
  INVALID_URL:
    "The URL must start with http:// or https://. Verify the protocol prefix and try again.",

  // File-System
  PATH_NOT_FOUND:
    "The specified path does not exist. Double-check the file or directory path, and verify it has not been moved or deleted.",
  PATH_OUTSIDE_ROOT:
    "The path resolves outside the workspace root. All file operations must target paths within the project workspace.",
  PATH_RESOLVE_ERROR:
    "Failed to resolve the path. This may be due to filesystem permissions or a broken symlink. Verify the path and try again.",
  FILE_STAT_ERROR:
    "Could not stat the file. Check that the file exists and the process has read permissions.",
  FILE_READ_ERROR:
    "Could not read the file. Verify the file exists, is not locked by another process, and has appropriate read permissions.",
  NOT_A_FILE:
    "The target path is not a regular file. If you intended to read a directory, use a directory-specific tool instead.",
  NOT_A_DIRECTORY:
    "The target path is not a directory. If you intended to read a file, use a file-specific tool instead.",
  PARENT_NOT_DIRECTORY:
    "The parent path of the write target is not a directory. Verify the parent path exists and is a valid directory.",
  NOT_SEARCHABLE:
    "The search path is neither a file nor a directory. Provide a valid file or directory path to search.",
  CONTENT_TOO_LARGE:
    "The content exceeds the maximum allowed size. Use pagination (offset/limit) or increase the maxBytes limit if configurable.",
  FILE_OP_TIMEOUT:
    "The file operation timed out. The file may be very large or on a slow filesystem. Try increasing the timeout or operating on a smaller scope.",

  // File-Edit
  TEXT_NOT_FOUND:
    "The exact text string was not found in the target file. Verify the text matches exactly — including whitespace and indentation — and try again.",
  AMBIGUOUS_TEXT:
    "The search text appears multiple times in the file. Provide more surrounding context to make the match unique, or use replace_all to change all occurrences.",

  // Shell
  SHELL_DISABLED:
    "Shell execution is disabled by policy. Enable it in your configuration or use a non-shell tool for the task.",
  SHELL_SPAWN_ERROR:
    "Failed to spawn the child process. Verify the command exists on the system PATH and that the binary is executable.",

  // Web
  HTTP_ERROR:
    "The HTTP request returned a non-2xx status. Check the URL, authentication headers, and that the remote service is available.",
  INVALID_REDIRECT:
    "The server returned an invalid redirect URL. Check the response Location header and verify the redirect target.",
  PRIVATE_REDIRECT_BLOCKED:
    "The redirect target is a private or local address, which is blocked for security. Use a public URL instead.",
  FETCH_FAILED:
    "The network request failed after all retries. Check your internet connection, the remote service status, and any proxy or firewall settings.",
  SEARCH_FAILED:
    "The web search failed across all configured sources. Verify the query is well-formed and that the search providers are accessible.",

  // Stock
  STOCK_PARSE_ERROR:
    "Failed to parse the stock quote API response. The data format may have changed — try again or use a different data source.",
  STOCK_TIMEOUT:
    "The stock quote request timed out. The market data provider may be slow — retry with a longer timeout or try later.",
  STOCK_NO_DATA:
    "No stock data is available for the requested symbol. Verify the ticker symbol is valid and the market is currently open.",
  STOCK_FETCH_ERROR:
    "Failed to fetch stock data due to a network or HTTP error. Check your connection and the provider API status.",

  // Registry
  INVALID_TOOL_NAME:
    "The tool name must be a non-empty string. Use a descriptive, dot-separated name like 'namespace.tool'.",
  INVALID_TOOL_EXECUTOR:
    "The tool must provide an execute() function. Wrap your logic in an async function and assign it to the execute property.",
  INVALID_TOOL:
    "The tool registration object is invalid. Ensure it has the required properties: name (string), description (string), and execute (function).",
  DUPLICATE_TOOL:
    "A tool with this name is already registered. Use a unique name or unregister the existing tool first.",
  TOOL_NOT_FOUND:
    "The requested tool was not found in the registry. Check the tool name spelling and that it has been registered before calling.",
  PERMISSION_DENIED:
    "Permission denied for tool execution. Request the required permissions or adjust the tool's security policy.",

  // Fallback
  TOOL_ERROR:
    "An unexpected tool error occurred. Check the logs for detailed error information and report the issue if it persists.",
};

// ── Documentation links for common error codes ─────────────────────

const DOCS_BASE = "https://github.com/haxagent/haxagent";

const DOCS_LINKS = {
  INVALID_ARGUMENT: `${DOCS_BASE}/docs/tools/validation#invalid-argument`,
  INVALID_ENCODING: `${DOCS_BASE}/docs/tools/validation#invalid-encoding`,
  INVALID_URL: `${DOCS_BASE}/docs/tools/validation#invalid-url`,
  PATH_NOT_FOUND: `${DOCS_BASE}/docs/tools/filesystem#path-not-found`,
  PATH_OUTSIDE_ROOT: `${DOCS_BASE}/docs/tools/filesystem#path-outside-root`,
  TEXT_NOT_FOUND: `${DOCS_BASE}/docs/tools/file-edit#text-not-found`,
  SHELL_DISABLED: `${DOCS_BASE}/docs/tools/shell#shell-disabled`,
  HTTP_ERROR: `${DOCS_BASE}/docs/tools/web#http-error`,
  FETCH_FAILED: `${DOCS_BASE}/docs/tools/web#fetch-failed`,
  TOOL_NOT_FOUND: `${DOCS_BASE}/docs/tools/registry#tool-not-found`,
  PERMISSION_DENIED: `${DOCS_BASE}/docs/tools/registry#permission-denied`,
  TOOL_ERROR: `${DOCS_BASE}/docs/tools/troubleshooting`,
};

// ── Internals ──────────────────────────────────────────────────────

/**
 * Determine the error code from any error-like value.
 * @param {*} error
 * @returns {string}
 */
function extractCode(error) {
  if (!error) return "TOOL_ERROR";
  if (typeof error === "string") return "TOOL_ERROR";
  if (error.code && typeof error.code === "string") return error.code;
  // Inherited Error.code from Node (e.g. ENOENT) — still a valid code
  return "TOOL_ERROR";
}

/**
 * Extract a human-readable message from any error-like value.
 * @param {*} error
 * @returns {string}
 */
function extractMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message && typeof error.message === "string") return error.message;
  return String(error);
}

// ── ErrorEnhancer class ────────────────────────────────────────────

class ErrorEnhancer {
  /**
   * Enhance an error with context, suggestions, docs, and debug info.
   * Returns a new enriched error object (does not mutate the original).
   *
   * @param {Error|string|*} error - The original error
   * @param {object} [context={}] - Execution context
   * @param {string} [context.toolName] - Name of the tool that threw
   * @param {object} [context.args] - Arguments passed to the tool
   * @param {string} [context.workspaceRoot] - Workspace root path
   * @param {number} [context.timestamp] - When the error occurred (ms)
   * @param {string} [context.phase] - Execution phase (validate, execute, serialize)
   * @returns {object} Enriched error object
   */
  static enhance(error, context = {}) {
    const code = extractCode(error);
    const message = extractMessage(error);

    const enriched = {
      type: "enhanced_error",
      code,
      message,
      originalName: error && error.name ? error.name : undefined,
      timestamp: context.timestamp || Date.now(),
    };

    // Attach original details if present
    if (error && error.details && typeof error.details === "object") {
      enriched.details = { ...error.details };
    }

    // Add execution context
    if (context.toolName || context.args || context.workspaceRoot || context.phase) {
      enriched.context = this._buildContext(context);
    }

    // Attach original stack for debugging
    if (error && error.stack) {
      enriched._debugStack = error.stack;
    }

    return enriched;
  }

  /**
   * Add execution context to an already-enhanced error.
   * @param {object} error - The error object (from enhance or similar)
   * @param {object} context - Execution context to merge
   * @returns {object} Error with merged context
   */
  static addContext(error, context) {
    if (!error || typeof error !== "object") return error;
    const existing = error.context || {};
    error.context = { ...existing, ...this._buildContext(context) };
    return error;
  }

  /**
   * Add an actionable fix suggestion based on the error code.
   * @param {object} error - The error object (from enhance or similar)
   * @returns {object} Error with suggestion field added
   */
  static addSuggestion(error) {
    if (!error || typeof error !== "object") return error;
    const code = error.code || extractCode(error);
    error.suggestion = SUGGESTIONS[code] || SUGGESTIONS.TOOL_ERROR;
    return error;
  }

  /**
   * Add links to relevant documentation for the error code.
   * @param {object} error - The error object (from enhance or similar)
   * @returns {object} Error with docs field added
   */
  static addRelatedDocs(error) {
    if (!error || typeof error !== "object") return error;
    const code = error.code || extractCode(error);
    error.docs = DOCS_LINKS[code]
      ? [DOCS_LINKS[code]]
      : [`${DOCS_BASE}/docs/tools/troubleshooting`];
    return error;
  }

  /**
   * Add debug information: stack trace, environment details, timestamps.
   * @param {object} error - The error object (from enhance or similar)
   * @param {object} [opts={}] - Debug options
   * @param {boolean} [opts.includeStack=true] - Include stack trace
   * @param {boolean} [opts.includeEnv=false] - Include Node.js / platform info
   * @returns {object} Error with _debug field added
   */
  static addDebugInfo(error, opts = {}) {
    if (!error || typeof error !== "object") return error;
    const includeStack = opts.includeStack !== false;
    const includeEnv = opts.includeEnv === true;

    const debug = {};

    if (includeStack) {
      debug.stack = error._debugStack
        || (error instanceof Error ? error.stack : undefined)
        || new Error().stack;
    }

    if (includeEnv) {
      debug.nodeVersion = process.version;
      debug.platform = process.platform;
      debug.arch = process.arch;
      debug.pid = process.pid;
    }

    error._debug = debug;
    return error;
  }

  /**
   * Format an enhanced error for user-facing display.
   * Produces a clean, structured object suitable for console or UI rendering.
   *
   * @param {object} error - The enhanced error object
   * @returns {object} User-friendly error display object
   */
  static formatForUser(error) {
    if (!error || typeof error !== "object") {
      return {
        title: "Error",
        message: String(error || "Unknown error"),
        suggestion: SUGGESTIONS.TOOL_ERROR,
      };
    }

    const code = error.code || extractCode(error);
    const message = error.message || extractMessage(error);

    const display = {
      title: `Error [${code}]`,
      message,
    };

    if (error.suggestion) {
      display.suggestion = error.suggestion;
    } else {
      display.suggestion = SUGGESTIONS[code] || SUGGESTIONS.TOOL_ERROR;
    }

    if (error.context && error.context.toolName) {
      display.tool = error.context.toolName;
    }

    if (error.docs && error.docs.length > 0) {
      display.relevantDocs = error.docs;
    }

    if (error.timestamp) {
      display.occurredAt = new Date(error.timestamp).toISOString();
    }

    return display;
  }

  /**
   * One-shot: enhance + suggestion + docs + debug + format.
   * Useful as a single call for the common case.
   *
   * @param {Error|string|*} error - The original error
   * @param {object} [context={}] - Execution context
   * @returns {object} Fully enriched and user-formatted error
   */
  static full(error, context = {}) {
    let enriched = this.enhance(error, context);
    enriched = this.addSuggestion(enriched);
    enriched = this.addRelatedDocs(enriched);
    enriched = this.addDebugInfo(enriched);
    return this.formatForUser(enriched);
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Build a sanitized context object from raw context input.
   * @param {object} context
   * @returns {object}
   */
  static _buildContext(context) {
    const built = {};
    if (context.toolName) built.toolName = context.toolName;
    if (context.phase) built.phase = context.phase;
    if (context.workspaceRoot) built.workspaceRoot = context.workspaceRoot;
    if (context.args !== undefined) {
      // Sanitize: avoid leaking large payloads into context
      built.args = typeof context.args === "object"
        ? this._sanitizeArgs(context.args)
        : context.args;
    }
    return built;
  }

  /**
   * Sanitize tool arguments for safe inclusion in context.
   * Truncates strings and limits object depth.
   * @param {object} args
   * @returns {object}
   */
  static _sanitizeArgs(args) {
    const sanitized = {};
    for (const key of Object.keys(args)) {
      const val = args[key];
      if (typeof val === "string") {
        sanitized[key] = val.length > 200 ? val.slice(0, 200) + "..." : val;
      } else if (Buffer.isBuffer(val)) {
        sanitized[key] = `[Buffer: ${val.length} bytes]`;
      } else if (typeof val === "object" && val !== null) {
        sanitized[key] = `[Object: ${Object.keys(val).length} keys]`;
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }
}

// ── Convenience factory for chained enhancement ─────────────────────

/**
 * Create an enhancement pipeline that applies multiple enhancers in sequence.
 *
 * @param {Error|string|*} error - The original error
 * @param {object} [context={}] - Execution context
 * @returns {object} Chainable builder with .suggestion(), .docs(), .debug(), .format()
 */
function enhanceError(error, context = {}) {
  let state = ErrorEnhancer.enhance(error, context);

  return {
    suggestion() {
      state = ErrorEnhancer.addSuggestion(state);
      return this;
    },
    docs() {
      state = ErrorEnhancer.addRelatedDocs(state);
      return this;
    },
    debug(opts) {
      state = ErrorEnhancer.addDebugInfo(state, opts);
      return this;
    },
    context(ctx) {
      state = ErrorEnhancer.addContext(state, ctx);
      return this;
    },
    format() {
      return ErrorEnhancer.formatForUser(state);
    },
    get() {
      return state;
    },
  };
}

module.exports = { ErrorEnhancer, SUGGESTIONS, enhanceError };
