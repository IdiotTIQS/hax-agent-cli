/**
 * Standard error codes for all tools.
 *
 * Every tool error thrown with `new ToolExecutionError(code, message, details)`
 * MUST use one of these codes. This ensures consistent error handling across
 * the tool layer and predictable error serialization for AI models.
 *
 * When adding a new code, add it to the appropriate category below.
 */

const ErrorCodes = {
  // ── Module: Validation ─────────────────────────────────
  /** Invalid argument type or value (string needed, got number) */
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  /** Unsupported encoding specified for file read/write */
  INVALID_ENCODING: "INVALID_ENCODING",
  /** Numeric limit (maxBytes, maxResults, etc.) is not positive safe integer */
  INVALID_LIMIT: "INVALID_LIMIT",
  /** Regular expression is malformed or contains unsafe patterns */
  INVALID_REGEX: "INVALID_REGEX",
  /** Shell command arguments must be an array of strings */
  INVALID_SHELL_ARGS: "INVALID_SHELL_ARGS",
  /** URL does not start with http:// or https:// */
  INVALID_URL: "INVALID_URL",

  // ── Module: File-System ────────────────────────────────
  /** Path does not exist on the filesystem */
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  /** Path resolves outside the workspace root */
  PATH_OUTSIDE_ROOT: "PATH_OUTSIDE_ROOT",
  /** Failed to resolve a path (e.g., realpath error other than ENOENT) */
  PATH_RESOLVE_ERROR: "PATH_RESOLVE_ERROR",
  /** Failed to stat a file (permissions, I/O error, etc.) */
  FILE_STAT_ERROR: "FILE_STAT_ERROR",
  /** Failed to read file content (I/O error other than ENOENT) */
  FILE_READ_ERROR: "FILE_READ_ERROR",
  /** Target is not a regular file */
  NOT_A_FILE: "NOT_A_FILE",
  /** Target is not a directory */
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  /** Parent directory of the write target is not a directory */
  PARENT_NOT_DIRECTORY: "PARENT_NOT_DIRECTORY",
  /** Search path is neither a file nor a directory */
  NOT_SEARCHABLE: "NOT_SEARCHABLE",
  /** Content exceeds maxBytes limit */
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  /** File operation timed out */
  FILE_OP_TIMEOUT: "FILE_OP_TIMEOUT",

  // ── Module: File-Edit ──────────────────────────────────
  /** Exact text string not found in target file */
  TEXT_NOT_FOUND: "TEXT_NOT_FOUND",
  /** Text appears multiple times — must be more specific */
  AMBIGUOUS_TEXT: "AMBIGUOUS_TEXT",

  // ── Module: Shell ──────────────────────────────────────
  /** Shell execution is disabled by policy */
  SHELL_DISABLED: "SHELL_DISABLED",
  /** Failed to spawn child process */
  SHELL_SPAWN_ERROR: "SHELL_SPAWN_ERROR",

  // ── Module: Web ────────────────────────────────────────
  /** HTTP error (non-2xx status) */
  HTTP_ERROR: "HTTP_ERROR",
  /** Invalid redirect URL */
  INVALID_REDIRECT: "INVALID_REDIRECT",
  /** Redirect blocked because target is private/local host */
  PRIVATE_REDIRECT_BLOCKED: "PRIVATE_REDIRECT_BLOCKED",
  /** Fetch failed after all retries */
  FETCH_FAILED: "FETCH_FAILED",
  /** Web search failed across all sources */
  SEARCH_FAILED: "SEARCH_FAILED",

  // ── Module: Stock ──────────────────────────────────────
  /** Stock quote parse error (malformed API response) */
  STOCK_PARSE_ERROR: "STOCK_PARSE_ERROR",
  /** Stock quote request timed out */
  STOCK_TIMEOUT: "STOCK_TIMEOUT",
  /** Stock quote: no data available from source */
  STOCK_NO_DATA: "STOCK_NO_DATA",
  /** Stock quote: HTTP/network request failed */
  STOCK_FETCH_ERROR: "STOCK_FETCH_ERROR",

  // ── Module: Registry ───────────────────────────────────
  /** Tool name must be a non-empty string */
  INVALID_TOOL_NAME: "INVALID_TOOL_NAME",
  /** Tool must provide an execute() function */
  INVALID_TOOL_EXECUTOR: "INVALID_TOOL_EXECUTOR",
  /** Tool registration object is invalid */
  INVALID_TOOL: "INVALID_TOOL",
  /** Tool name already registered */
  DUPLICATE_TOOL: "DUPLICATE_TOOL",
  /** Requested tool not found in registry */
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  /** Permission denied for tool execution */
  PERMISSION_DENIED: "PERMISSION_DENIED",

  // ── Module: Fallback ───────────────────────────────────
  /** Generic fallback when error cannot be classified */
  TOOL_ERROR: "TOOL_ERROR",
};

module.exports = { ErrorCodes };
