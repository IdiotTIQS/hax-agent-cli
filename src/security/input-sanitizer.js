'use strict';

const path = require('node:path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PATH_TRAVERSAL_RX = /\.\.(?:\/|\\)/g;
const NULL_BYTE_RX = /\x00/g;
const MULTIPLE_SLASH_RX = /\/{2,}/g;
const CONTROL_CHAR_RX = /[\x00-\x1f\x7f-\x9f]/g;
const HTML_SCRIPT_RX = /<script[^>]*>[\s\S]*?<\/script[^>]*>/gi;
const HTML_EVENT_ATTR_RX = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL_RX = /\bjavascript\s*:/gi;
const COMMENT_RX = /<!--[\s\S]*?-->/g;

// Built-in secret patterns for redactSecrets
const DEFAULT_SECRET_PATTERNS = [
  // API keys (common formats)
  { name: 'openai_key', pattern: /sk-[A-Za-z0-9-_]{20,}/g, replacement: 'sk-***REDACTED***' },
  { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g, replacement: 'ghp_***REDACTED***' },
  { name: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  { name: 'aws_secret', pattern: /(?<=[^A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?=[^A-Za-z0-9/+=])/g, replacement: '***REDACTED***' },
  // Bearer tokens
  { name: 'bearer_token', pattern: /(?<=bearer\s)[A-Za-z0-9\-._~+/]+/gi, replacement: '***REDACTED***' },
  // Generic key=value secrets
  { name: 'secret_kv', pattern: /(api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*(["']?)([^\s"'\n]+)\2/gi,
    replacement: (_, key, quote) => `${key}=${quote || ''}***REDACTED***${quote || ''}` },
];

// Allowed URL protocols
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Blocked protocols (even if a custom protocol is parsed as some other scheme)
const BLOCKED_PROTOCOLS = new Set([
  'file:', 'ftp:', 'data:', 'javascript:', 'vbscript:', 'about:',
  'chrome:', 'chrome-extension:', 'edge:', 'view-source:',
]);

// Private / reserved IP ranges and hostnames
const PRIVATE_IPv4_RANGES = [
  { start: ip4ToInt([10, 0, 0, 0]), end: ip4ToInt([10, 255, 255, 255]) },
  { start: ip4ToInt([127, 0, 0, 0]), end: ip4ToInt([127, 255, 255, 255]) },
  { start: ip4ToInt([0, 0, 0, 0]), end: ip4ToInt([0, 255, 255, 255]) },
  { start: ip4ToInt([169, 254, 0, 0]), end: ip4ToInt([169, 254, 255, 255]) },
  { start: ip4ToInt([172, 16, 0, 0]), end: ip4ToInt([172, 31, 255, 255]) },
  { start: ip4ToInt([192, 168, 0, 0]), end: ip4ToInt([192, 168, 255, 255]) },
  { start: ip4ToInt([100, 64, 0, 0]), end: ip4ToInt([100, 127, 255, 255]) },
  { start: ip4ToInt([198, 18, 0, 0]), end: ip4ToInt([198, 19, 255, 255]) },
];

// RFC 5322 simplified email regex (practical, not exhaustive)
const EMAIL_RX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an IPv4 octet array to a 32-bit integer.
 * @param {number[]} octets - four octets
 * @returns {number}
 */
function ip4ToInt(octets) {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/**
 * Test whether an IPv4 address falls in any of the private/reserved ranges.
 * @param {string} ip - dotted-decimal IPv4 string
 * @returns {boolean}
 */
function isPrivateIPv4(ip) {
  const match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return true;
  const intVal = ip4ToInt(octets);
  for (const range of PRIVATE_IPv4_RANGES) {
    if (intVal >= range.start && intVal <= range.end) return true;
  }
  return false;
}

/**
 * Test whether a hostname string refers to a local/private address.
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  // localhost variants
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // IPv6 loopback / link-local / unique-local
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  // IPv4 check
  return isPrivateIPv4(host);
}

/**
 * Escape special regex characters in a string.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a file path by removing path traversal sequences, null bytes,
 * control characters, and normalizing separators.
 *
 * @param {string} input - raw path input
 * @returns {string} sanitized path
 */
function sanitizeFilePath(input) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeFilePath: input must be a string');
  }

  let sanitized = input;

  // Remove null bytes
  sanitized = sanitized.replace(NULL_BYTE_RX, '');

  // Convert backslashes to forward slashes for consistent handling
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove parent-directory traversal ".." segments (but not valid ".." in filenames like "foo..bar")
  sanitized = sanitized.replace(PATH_TRAVERSAL_RX, '');

  // Collapse multiple consecutive slashes
  sanitized = sanitized.replace(MULTIPLE_SLASH_RX, '/');

  // Remove control characters (ASCII 0-31, 127-159)
  sanitized = sanitized.replace(CONTROL_CHAR_RX, '');

  // Trim leading/trailing whitespace
  sanitized = sanitized.trim();

  // Normalize to platform path
  sanitized = path.normalize(sanitized);

  return sanitized;
}

/**
 * Escape/sanitize a shell argument to prevent injection.
 * Strips shell metacharacters by removing them — this is a restrictive
 * approach suitable for constructing safe argument vectors.
 *
 * @param {string} input - raw shell argument
 * @returns {string} sanitized argument
 */
function sanitizeShellArg(input) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeShellArg: input must be a string');
  }

  // Remove null bytes
  let sanitized = input.replace(NULL_BYTE_RX, '');

  // Remove command separators, subshell markers, and redirects
  sanitized = sanitized
    .replace(/[;&|`$(){}[\]#!~<>]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

  return sanitized;
}

/**
 * Strip dangerous HTML elements from content: script tags, event handler
 * attributes, javascript: URLs, and HTML comments.
 *
 * @param {string} input - raw HTML content
 * @returns {string} sanitized HTML
 */
function sanitizeHtmlContent(input) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeHtmlContent: input must be a string');
  }

  let sanitized = input;

  // Remove script tags and their content (including multi-line)
  sanitized = sanitized.replace(HTML_SCRIPT_RX, '');

  // Remove on* event handler attributes
  sanitized = sanitized.replace(HTML_EVENT_ATTR_RX, '');

  // Remove javascript: URLs (in href, src, etc.)
  sanitized = sanitized.replace(JAVASCRIPT_URL_RX, 'blocked:');

  // Remove HTML comments
  sanitized = sanitized.replace(COMMENT_RX, '');

  return sanitized;
}

/**
 * Escape control characters in a string so it can be safely embedded
 * inside a JSON string value. Does NOT add surrounding quotes.
 *
 * @param {string} input - the string to escape
 * @returns {string} JSON-safe escaped string
 */
function sanitizeJsonString(input) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitizeJsonString: input must be a string');
  }

  let result = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    const code = input.charCodeAt(i);

    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      // Control character: escape as \uXXXX
      result += '\\u' + code.toString(16).padStart(4, '0');
    } else if (ch === '\\') {
      result += '\\\\';
    } else if (ch === '"') {
      result += '\\"';
    } else if (ch === '/') {
      // forward slash is valid JSON but escaping is safe
      result += '\\/';
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Validate a URL. Returns a result object with `valid` and `reason` fields.
 * Blocks internal/private IPs, dangerous protocols, and malformed URLs.
 *
 * @param {string} input - URL string to validate
 * @returns {{ valid: boolean, reason?: string, url?: URL }}
 */
function validateUrl(input) {
  if (typeof input !== 'string') {
    return { valid: false, reason: 'URL must be a string' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'URL must be non-empty' };
  }

  // Check for null bytes
  if (trimmed.indexOf('\x00') !== -1) {
    return { valid: false, reason: 'URL contains null bytes' };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Protocol check
  const protocol = url.protocol.toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol)) {
    return { valid: false, reason: `Blocked protocol: ${protocol}` };
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return { valid: false, reason: `Disallowed protocol: ${protocol}` };
  }

  // Private / internal IP check
  if (isPrivateHost(url.hostname)) {
    return { valid: false, reason: 'URL resolves to internal/private address' };
  }

  return { valid: true, url };
}

/**
 * Validate an email address using a simplified RFC 5322 pattern.
 *
 * @param {string} input - email string to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateEmail(input) {
  if (typeof input !== 'string') {
    return { valid: false, reason: 'Email must be a string' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Email must be non-empty' };
  }

  if (trimmed.length > 254) {
    return { valid: false, reason: 'Email exceeds maximum length (254 characters)' };
  }

  if (trimmed.indexOf('\x00') !== -1) {
    return { valid: false, reason: 'Email contains null bytes' };
  }

  if (!EMAIL_RX.test(trimmed)) {
    return { valid: false, reason: 'Email format is invalid' };
  }

  // Additional check: local part max 64 chars
  const atIndex = trimmed.lastIndexOf('@');
  const localPart = trimmed.slice(0, atIndex);
  if (localPart.length > 64) {
    return { valid: false, reason: 'Local part exceeds maximum length (64 characters)' };
  }

  return { valid: true };
}

/**
 * Redact secrets from text by replacing known patterns with placeholder values.
 *
 * @param {string} text - text that may contain secrets
 * @param {Array<{ name: string, pattern: RegExp, replacement: string|Function }>} [patterns]
 *   - optional custom patterns; merges with built-in defaults
 * @returns {string} text with secrets redacted
 */
function redactSecrets(text, patterns) {
  if (typeof text !== 'string') {
    throw new TypeError('redactSecrets: text must be a string');
  }

  const activePatterns = patterns && patterns.length > 0
    ? patterns
    : DEFAULT_SECRET_PATTERNS;

  let result = text;
  for (const { pattern, replacement } of activePatterns) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Get a copy of the built-in secret detection patterns.
 * Callers can modify this array and pass it as the second argument to redactSecrets.
 *
 * @returns {Array<{ name: string, pattern: RegExp, replacement: string|Function }>}
 */
function getDefaultSecretPatterns() {
  return DEFAULT_SECRET_PATTERNS.map((p) => ({ ...p }));
}

module.exports = {
  sanitizeFilePath,
  sanitizeShellArg,
  sanitizeHtmlContent,
  sanitizeJsonString,
  validateUrl,
  validateEmail,
  redactSecrets,
  getDefaultSecretPatterns,
  isPrivateHost,
  isPrivateIPv4,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
};
