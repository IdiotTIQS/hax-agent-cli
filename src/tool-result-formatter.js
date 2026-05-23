"use strict";

/**
 * Tool result formatter — human-friendly display helpers for tool outputs.
 *
 * Provides formatting for tool execution results, short human-readable
 * summaries of what each tool call did, and duration formatting.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATE_BYTES = 2000;
const MAX_PREVIEW_BYTES = 100;
const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// formatToolResult
// ---------------------------------------------------------------------------

/**
 * Format a serialized tool result for human-readable display.
 *
 * Input should be a serialized result object like:
 *   { type: 'tool_result', toolName, ok, data, error, durationMs }
 *
 * @param {object} result - Serialized tool result
 * @returns {string} Formatted string
 */
function formatToolResult(result) {
  if (!result || typeof result !== 'object') {
    return '[Invalid tool result]';
  }

  const toolName = result.toolName || 'unknown';
  const ok = result.ok === true;
  const durationStr = Number.isFinite(result.durationMs)
    ? ` (${formatDuration(result.durationMs)})`
    : '';

  if (ok) {
    let dataStr = '';

    if (result.data !== undefined && result.data !== null) {
      dataStr = formatContent(result.data);
    }

    if (result.repeatedSingleCall) {
      return `[${toolName}] Cached${durationStr} — ${dataStr}`;
    }

    return `[${toolName}] OK${durationStr}${dataStr ? ' — ' + dataStr : ''}`;
  }

  // Error case
  const errorInfo = result.error || {};
  const code = errorInfo.code ? ` [${errorInfo.code}]` : '';
  const message = errorInfo.message || 'Unknown error';
  return `[${toolName}] FAILED${code}${durationStr} — ${message}`;
}

/**
 * Format a `data` value from a tool result into a compact string.
 *
 * @param {*} data
 * @param {number} [maxBytes] - Byte budget for the formatted output
 * @returns {string}
 */
function formatContent(data, maxBytes = DEFAULT_TRUNCATE_BYTES) {
  if (typeof data === 'string') {
    return truncateString(data, maxBytes);
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    return `[${data.length} item${data.length !== 1 ? 's' : ''}]`;
  }
  if (data && typeof data === 'object') {
    const jsonStr = safeStringify(data);
    return truncateString(jsonStr, maxBytes);
  }
  return truncateString(String(data), maxBytes);
}

/**
 * Truncate a string to fit within a byte budget, appending an ellipsis
 * if truncation occurred.
 *
 * @param {string} str
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateString(str, maxBytes) {
  if (typeof str !== 'string') return '';
  if (str.length <= Math.floor(maxBytes / 4) + 1) {
    return str; // Quick path: string is almost certainly under the byte budget
  }

  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;

  // Walk back from the truncation point to avoid splitting multi-byte chars
  let cutoff = maxBytes - Buffer.byteLength(ELLIPSIS, 'utf8');
  if (cutoff < 0) cutoff = 0;

  // Ensure we end on a valid UTF-8 boundary
  while (cutoff > 0 && (buf[cutoff] & 0xC0) === 0x80) {
    cutoff -= 1;
  }

  return buf.subarray(0, cutoff).toString('utf8') + ELLIPSIS;
}

// ---------------------------------------------------------------------------
// summarizeToolCall
// ---------------------------------------------------------------------------

/**
 * Create a short, human-readable summary of what a tool call did.
 *
 * @param {string} name - Tool name (e.g. 'file.read', 'shell', 'web.fetch')
 * @param {object} args - Tool arguments
 * @returns {string} Human-readable summary
 */
function summarizeToolCall(name, args) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'Called unknown tool';
  }

  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

  switch (name) {
    case 'file.read':
      return summarizeReadFile(safeArgs);
    case 'file.write':
      return summarizeWriteFile(safeArgs);
    case 'file.search':
      return summarizeSearchFile(safeArgs);
    case 'file.glob':
      return summarizeGlobFile(safeArgs);
    case 'file.edit':
      return summarizeEditFile(safeArgs);
    case 'file.readDirectory':
      return summarizeReadDir(safeArgs);
    case 'file.delete':
      return summarizeDeleteFile(safeArgs);
    case 'shell':
      return summarizeShell(safeArgs);
    case 'web.fetch':
      return summarizeWebFetch(safeArgs);
    case 'web.search':
      return summarizeWebSearch(safeArgs);
    case 'stock.quote':
      return summarizeStockQuote(safeArgs);
    default:
      return summarizeGeneric(name, safeArgs);
  }
}

// ---- Individual summarizers ----

function summarizeReadFile(args) {
  const filePath = args.file_path || args.path || '<file>';
  const shortPath = shortenPath(filePath);
  if (args.offset !== undefined && args.limit !== undefined) {
    return `Read ${shortPath} (lines ${args.offset}-${args.offset + args.limit})`;
  }
  if (args.offset !== undefined) {
    return `Read ${shortPath} from line ${args.offset}`;
  }
  return `Read ${shortPath}`;
}

function summarizeWriteFile(args) {
  const filePath = args.file_path || args.path || '<file>';
  const shortPath = shortenPath(filePath);
  const contentLen = typeof args.content === 'string' ? args.content.length : 0;
  const byteLabel = contentLen > 0 ? ` (${formatBytes(contentLen)})` : '';
  return `Write ${shortPath}${byteLabel}`;
}

function summarizeSearchFile(args) {
  const pattern = args.pattern || '<pattern>';
  const filePath = args.path ? ` in ${shortenPath(args.path)}` : '';
  return `Search "${truncateString(pattern, 60)}"${filePath}`;
}

function summarizeGlobFile(args) {
  const pattern = args.pattern || '<pattern>';
  const filePath = args.path ? ` in ${shortenPath(args.path)}` : '';
  return `Glob "${truncateString(pattern, 60)}"${filePath}`;
}

function summarizeEditFile(args) {
  const filePath = args.file_path || args.path || '<file>';
  return `Edit ${shortenPath(filePath)}`;
}

function summarizeReadDir(args) {
  const dirPath = args.path || '<directory>';
  return `List ${shortenPath(dirPath)}`;
}

function summarizeDeleteFile(args) {
  const filePath = args.file_path || args.path || '<file>';
  return `Delete ${shortenPath(filePath)}`;
}

function summarizeShell(args) {
  const cmd = args.command || args.cmd || '<command>';
  const shortCmd = truncateString(String(cmd), 80);
  return `Shell: ${shortCmd}`;
}

function summarizeWebFetch(args) {
  const url = args.url || '<url>';
  const shortUrl = formatUrl(args.url);
  const maxLen = args.maxLength ? ` (max ${formatBytes(args.maxLength)})` : '';
  return `Fetch ${shortUrl}${maxLen}`;
}

function summarizeWebSearch(args) {
  const query = args.query || args.q || '<query>';
  return `Search web: "${truncateString(String(query), 80)}"`;
}

function summarizeStockQuote(args) {
  const symbol = args.symbol || args.ticker || '<symbol>';
  return `Stock quote: ${String(symbol).toUpperCase()}`;
}

function summarizeGeneric(name, args) {
  const argKeys = Object.keys(args);
  if (argKeys.length === 0) {
    return `Run ${name}`;
  }
  const firstArg = args[argKeys[0]];
  if (typeof firstArg === 'string' && firstArg.length < 50) {
    return `${name} (${truncateString(firstArg, 40)})`;
  }
  return `${name} (${argKeys.length} arg${argKeys.length !== 1 ? 's' : ''})`;
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

/**
 * Format a millisecond duration as a human-readable string.
 *
 * Examples:
 *   500     → "500ms"
 *   1200    → "1.2s"
 *   65000   → "1m 5s"
 *   3661000 → "1h 1m 1s"
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted string
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '?';

  const absMs = Math.abs(ms);

  if (absMs < 1) {
    return '<1ms';
  }

  if (absMs < 1000) {
    return `${Math.round(absMs)}ms`;
  }

  const seconds = absMs / 1000;

  if (seconds < 60) {
    return `${toPrecision(seconds, 1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    if (remainderSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainderSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  if (remainderMinutes === 0 && remainderSeconds === 0) {
    return `${hours}h`;
  }
  if (remainderSeconds === 0) {
    return `${hours}h ${remainderMinutes}m`;
  }
  return `${hours}h ${remainderMinutes}m ${remainderSeconds}s`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shorten a file path for display by keeping only the filename and
 * the nearest parent directory.
 *
 * @param {string} filePath
 * @returns {string}
 */
function shortenPath(filePath) {
  if (typeof filePath !== 'string') return String(filePath);
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1] || normalized;

  if (parts.length <= 1) return fileName;

  // Include one level of parent directory for context
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2];
    if (parent.length > 0) {
      return `${parent}/${fileName}`;
    }
  }
  return fileName;
}

/**
 * Shorten a URL for display (strip protocol, truncate path).
 *
 * @param {string} url
 * @returns {string}
 */
function formatUrl(url) {
  if (typeof url !== 'string') return String(url);
  let short = url.replace(/^https?:\/\//, '');
  if (short.endsWith('/')) short = short.slice(0, -1);
  return truncateString(short, 60);
}

/**
 * Format a byte count for display.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (value < 10 && unitIndex > 0) {
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }
  return `${Math.round(value)} ${units[unitIndex]}`;
}

/**
 * Round a number to a given number of decimal places.
 *
 * @param {number} value
 * @param {number} places
 * @returns {number}
 */
function toPrecision(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Safe JSON.stringify that handles circular references.
 *
 * @param {*} value
 * @returns {string}
 */
function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, val) => {
      if (val !== null && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch (_) {
    return String(value);
  }
}

module.exports = {
  formatToolResult,
  formatContent,
  truncateString,
  summarizeToolCall,
  formatDuration,
  formatBytes,
};
