/**
 * ErrorRecovery — suggests and optionally executes recovery actions
 * for tool errors. Provides step-by-step recovery plans and can
 * attempt automatic recovery for known recoverable error codes.
 */
"use strict";

const { ErrorCodes } = require("../tools/error-codes");

// ── Recovery action constants ──────────────────────────────────────

const ACTIONS = {
  /** Retry the operation immediately */
  RETRY: "RETRY",
  /** Retry with exponential backoff delay */
  RETRY_WITH_BACKOFF: "RETRY_WITH_BACKOFF",
  /** Check and fix configuration settings */
  CHECK_CONFIG: "CHECK_CONFIG",
  /** Validate and correct input parameters */
  VALIDATE_INPUT: "VALIDATE_INPUT",
  /** Escalate to a human operator or higher-level handler */
  ESCALATE: "ESCALATE",
  /** Reduce request scope (smaller file, shorter text, etc.) */
  REDUCE_SCOPE: "REDUCE_SCOPE",
  /** Try an alternative approach or tool */
  TRY_ALTERNATIVE: "TRY_ALTERNATIVE",
  /** Wait for external service to become available */
  WAIT_AND_RETRY: "WAIT_AND_RETRY",
  /** Verify filesystem permissions */
  CHECK_PERMISSIONS: "CHECK_PERMISSIONS",
  /** Check network connectivity */
  CHECK_NETWORK: "CHECK_NETWORK",
};

// ── Recovery plan database ─────────────────────────────────────────

/**
 * Each entry defines a sequence of recovery steps for a given error code.
 * Steps are tried in order. The first step that succeeds resolves the plan.
 */
const RECOVERY_PLANS = {
  // Network and fetch errors — transient by nature
  FETCH_FAILED: [
    { action: ACTIONS.RETRY_WITH_BACKOFF, delayMs: 500, maxAttempts: 3 },
    { action: ACTIONS.CHECK_NETWORK },
    { action: ACTIONS.ESCALATE },
  ],
  HTTP_ERROR: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Verify the URL and request headers" },
    { action: ACTIONS.RETRY_WITH_BACKOFF, delayMs: 1000, maxAttempts: 2 },
    { action: ACTIONS.ESCALATE },
  ],
  SEARCH_FAILED: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Simplify or rephrase the search query" },
    { action: ACTIONS.WAIT_AND_RETRY, delayMs: 2000 },
    { action: ACTIONS.ESCALATE },
  ],
  STOCK_TIMEOUT: [
    { action: ACTIONS.WAIT_AND_RETRY, delayMs: 3000 },
    { action: ACTIONS.ESCALATE },
  ],
  STOCK_FETCH_ERROR: [
    { action: ACTIONS.RETRY_WITH_BACKOFF, delayMs: 1000, maxAttempts: 2 },
    { action: ACTIONS.CHECK_NETWORK },
    { action: ACTIONS.ESCALATE },
  ],

  // File-system errors — often recoverable via validation
  PATH_NOT_FOUND: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Check the file path spelling and that the file exists" },
    { action: ACTIONS.ESCALATE },
  ],
  PATH_OUTSIDE_ROOT: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Use a relative path inside the workspace" },
    { action: ACTIONS.CHECK_CONFIG, hint: "Verify workspaceRoot configuration" },
    { action: ACTIONS.ESCALATE },
  ],
  PATH_RESOLVE_ERROR: [
    { action: ACTIONS.CHECK_PERMISSIONS, hint: "Check filesystem permissions for the path" },
    { action: ACTIONS.ESCALATE },
  ],
  FILE_STAT_ERROR: [
    { action: ACTIONS.CHECK_PERMISSIONS },
    { action: ACTIONS.RETRY, delayMs: 100 },
    { action: ACTIONS.ESCALATE },
  ],
  FILE_READ_ERROR: [
    { action: ACTIONS.CHECK_PERMISSIONS },
    { action: ACTIONS.RETRY, delayMs: 100 },
    { action: ACTIONS.ESCALATE },
  ],
  CONTENT_TOO_LARGE: [
    { action: ACTIONS.REDUCE_SCOPE, hint: "Use pagination with offset/limit or reduce maxBytes" },
    { action: ACTIONS.ESCALATE },
  ],
  FILE_OP_TIMEOUT: [
    { action: ACTIONS.REDUCE_SCOPE, hint: "Try a smaller file or increase the timeout" },
    { action: ACTIONS.RETRY, delayMs: 500 },
    { action: ACTIONS.ESCALATE },
  ],

  // File-edit errors
  TEXT_NOT_FOUND: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Verify the text matches exactly including whitespace" },
    { action: ACTIONS.TRY_ALTERNATIVE, hint: "Try reading the file first to find the exact text" },
    { action: ACTIONS.ESCALATE },
  ],
  AMBIGUOUS_TEXT: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Add more surrounding context to make the match unique" },
    { action: ACTIONS.TRY_ALTERNATIVE, hint: "Use replaceAll mode to change all occurrences" },
    { action: ACTIONS.ESCALATE },
  ],

  // Shell errors
  SHELL_SPAWN_ERROR: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Verify the command exists and is on the system PATH" },
    { action: ACTIONS.CHECK_CONFIG, hint: "Check the shell configuration and allowed commands" },
    { action: ACTIONS.ESCALATE },
  ],

  // Registry and validation errors
  INVALID_TOOL_NAME: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Use a non-empty dot-separated name like 'ns.tool'" },
    { action: ACTIONS.ESCALATE },
  ],
  DUPLICATE_TOOL: [
    { action: ACTIONS.CHECK_CONFIG, hint: "Use a unique tool name or unregister the existing one" },
    { action: ACTIONS.ESCALATE },
  ],
  TOOL_NOT_FOUND: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Check the tool name spelling" },
    { action: ACTIONS.CHECK_CONFIG, hint: "Verify the tool is registered before calling" },
    { action: ACTIONS.ESCALATE },
  ],
  PERMISSION_DENIED: [
    { action: ACTIONS.CHECK_CONFIG, hint: "Check tool permission settings in configuration" },
    { action: ACTIONS.ESCALATE },
  ],

  // Validation errors — always recoverable through input correction
  INVALID_ARGUMENT: [
    { action: ACTIONS.VALIDATE_INPUT },
    { action: ACTIONS.ESCALATE },
  ],
  INVALID_ENCODING: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Use a supported encoding: utf8, base64, hex, latin1, ascii" },
    { action: ACTIONS.ESCALATE },
  ],
  INVALID_LIMIT: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Provide a positive safe integer within the allowed range" },
    { action: ACTIONS.ESCALATE },
  ],
  INVALID_REGEX: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Fix the regex pattern — check for syntax errors" },
    { action: ACTIONS.TRY_ALTERNATIVE, hint: "Use a simpler pattern or test with a regex validator" },
    { action: ACTIONS.ESCALATE },
  ],
  INVALID_SHELL_ARGS: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Provide arguments as an array of strings: ['arg1', 'arg2']" },
    { action: ACTIONS.ESCALATE },
  ],
  INVALID_URL: [
    { action: ACTIONS.VALIDATE_INPUT, hint: "Ensure the URL starts with http:// or https://" },
    { action: ACTIONS.ESCALATE },
  ],

  // Fallback
  TOOL_ERROR: [
    { action: ACTIONS.CHECK_CONFIG },
    { action: ACTIONS.VALIDATE_INPUT },
    { action: ACTIONS.ESCALATE },
  ],
};

// ── Codes eligible for automatic recovery ──────────────────────────

/**
 * Error codes for which automatic recovery can be attempted.
 * These are transient errors likely to resolve on retry.
 */
const AUTO_RECOVERABLE = new Set([
  "STOCK_TIMEOUT",
  "FETCH_FAILED",
  "HTTP_ERROR",
  "SEARCH_FAILED",
  "STOCK_FETCH_ERROR",
  "FILE_READ_ERROR",
  "FILE_STAT_ERROR",
  "FILE_OP_TIMEOUT",
]);

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
  return "TOOL_ERROR";
}

// ── ErrorRecovery class ────────────────────────────────────────────

class ErrorRecovery {
  /**
   * Get the list of recovery actions for an error code.
   * @param {string} action - Action constant (e.g. ACTIONS.RETRY)
   * @returns {{ action: string, description: string }}
   */
  static suggest(action) {
    const descriptions = {
      [ACTIONS.RETRY]: "Retry the operation — transient errors often resolve on subsequent attempts.",
      [ACTIONS.RETRY_WITH_BACKOFF]: "Retry with increasing delays between attempts to avoid overwhelming the system.",
      [ACTIONS.CHECK_CONFIG]: "Review and fix relevant configuration settings.",
      [ACTIONS.VALIDATE_INPUT]: "Examine the input parameters — correct any type or value errors.",
      [ACTIONS.ESCALATE]: "Escalate to a human operator or higher-level error handler for manual intervention.",
      [ACTIONS.REDUCE_SCOPE]: "Reduce the scope of the operation — use smaller files, shorter text, or pagination.",
      [ACTIONS.TRY_ALTERNATIVE]: "Try a different approach or alternative tool to accomplish the same goal.",
      [ACTIONS.WAIT_AND_RETRY]: "Wait for external conditions to improve, then retry — useful for rate limits and service unavailability.",
      [ACTIONS.CHECK_PERMISSIONS]: "Verify filesystem permissions and process access rights.",
      [ACTIONS.CHECK_NETWORK]: "Check internet connectivity, proxy settings, and firewall rules.",
    };

    return {
      action,
      description: descriptions[action] || "No description available for this action.",
    };
  }

  /**
   * Get a step-by-step recovery plan for the given error.
   * Returns an ordered array of recovery steps to try.
   *
   * @param {Error|string|object} error - The error to recover from
   * @returns {Array<{ step: number, action: string, hint?: string, delayMs?: number, maxAttempts?: number }>}
   */
  static getRecoveryPlan(error) {
    const code = extractCode(error);
    const plan = RECOVERY_PLANS[code] || RECOVERY_PLANS.TOOL_ERROR;

    return plan.map((step, index) => ({
      step: index + 1,
      action: step.action,
      hint: step.hint || undefined,
      delayMs: step.delayMs || undefined,
      maxAttempts: step.maxAttempts || undefined,
    }));
  }

  /**
   * Attempt automatic recovery for the given error.
   * Currently supports RETRY and RETRY_WITH_BACKOFF actions.
   * For other actions, returns a result indicating manual intervention is needed.
   *
   * @param {Error|string|object} error - The error to recover from
   * @param {object} context - Recovery context
   * @param {Function} context.retryFn - Function to call for retry attempts (receives no args)
   * @param {number} [context.timeoutMs=30000] - Maximum total recovery time
   * @returns {Promise<{ recovered: boolean, result?: *, action: string, message: string }>}
   */
  static async autoRecover(error, context = {}) {
    const code = extractCode(error);
    const retryFn = context.retryFn;
    const timeoutMs = context.timeoutMs || 30000;

    if (!retryFn || typeof retryFn !== "function") {
      return {
        recovered: false,
        action: ACTIONS.ESCALATE,
        message: "Cannot auto-recover: no retry function provided in context.",
      };
    }

    if (!AUTO_RECOVERABLE.has(code)) {
      return {
        recovered: false,
        action: ACTIONS.ESCALATE,
        message: `Error code ${code} is not eligible for automatic recovery. Review the recovery plan for manual steps.`,
      };
    }

    const plan = RECOVERY_PLANS[code];
    if (!plan) {
      return {
        recovered: false,
        action: ACTIONS.ESCALATE,
        message: "No recovery plan found for this error code.",
      };
    }

    const deadline = Date.now() + timeoutMs;

    for (const step of plan) {
      if (step.action === ACTIONS.RETRY) {
        const delay = step.delayMs || 0;
        if (Date.now() + delay > deadline) {
          return {
            recovered: false,
            action: ACTIONS.ESCALATE,
            message: "Auto-recovery timed out before retry could complete.",
          };
        }
        if (delay > 0) {
          await this._sleep(delay);
        }
        try {
          const result = await retryFn();
          return {
            recovered: true,
            result,
            action: ACTIONS.RETRY,
            message: "Operation succeeded on retry.",
          };
        } catch (_retryErr) {
          // Continue to the next step
          continue;
        }
      }

      if (step.action === ACTIONS.RETRY_WITH_BACKOFF) {
        const baseDelay = step.delayMs || 500;
        const maxAttempts = step.maxAttempts || 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          if (Date.now() + delay > deadline) {
            return {
              recovered: false,
              action: ACTIONS.ESCALATE,
              message: `Auto-recovery timed out after ${attempt - 1} of ${maxAttempts} backoff retry attempts.`,
            };
          }
          await this._sleep(delay);
          try {
            const result = await retryFn();
            return {
              recovered: true,
              result,
              action: ACTIONS.RETRY_WITH_BACKOFF,
              message: `Operation succeeded on retry attempt ${attempt} of ${maxAttempts} (backoff).`,
            };
          } catch (_retryErr) {
            // Continue to next attempt
            continue;
          }
        }
        // All backoff attempts exhausted, continue to next step
        continue;
      }

      // For non-retry actions, auto-recovery stops here
      return {
        recovered: false,
        action: step.action,
        message: `Automatic recovery cannot proceed. Next action required: ${step.action}${step.hint ? ` — ${step.hint}` : ""}.`,
      };
    }

    return {
      recovered: false,
      action: ACTIONS.ESCALATE,
      message: "All automatic recovery steps were exhausted without success.",
    };
  }

  /**
   * Check whether a given error code is eligible for automatic recovery.
   *
   * @param {string} errorCode - The error code string
   * @returns {boolean}
   */
  static canAutoRecover(errorCode) {
    if (!errorCode || typeof errorCode !== "string") return false;
    return AUTO_RECOVERABLE.has(errorCode);
  }

  /**
   * Get all defined recovery action constants.
   * @returns {object} ACTIONS constants
   */
  static getActions() {
    return { ...ACTIONS };
  }

  /**
   * Get the set of auto-recoverable error codes.
   * @returns {string[]}
   */
  static getAutoRecoverableCodes() {
    return [...AUTO_RECOVERABLE].sort();
  }

  // ── Private ──────────────────────────────────────────────────────

  /**
   * Promise-based sleep.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  static _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { ErrorRecovery, ACTIONS, AUTO_RECOVERABLE };
