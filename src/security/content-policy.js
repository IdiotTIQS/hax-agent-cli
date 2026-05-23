'use strict';

const path = require('node:path');
const { sanitizeFilePath, sanitizeShellArg, validateUrl, isPrivateHost } = require('./input-sanitizer');

// ---------------------------------------------------------------------------
// Web Fetch Policy
// ---------------------------------------------------------------------------

/**
 * Policy for restricting web.fetch tool calls.
 *
 * @param {object} [options]
 * @param {string[]} [options.allowedDomains] - whitelist of allowed hostnames
 * @param {string[]} [options.blockedDomains] - blacklist of blocked hostnames
 * @param {string[]} [options.allowedUrls] - exact URL whitelist
 * @param {number[]} [options.allowedPorts] - whitelist of allowed ports (default: [80, 443])
 * @param {number} [options.maxResponseBytes] - max response size in bytes (default: 5 MB)
 * @param {boolean} [options.allowPrivateIps] - allow requests to private IPs (default: false)
 * @param {boolean} [options.enabled] - whether this policy is active (default: true)
 * @returns {object} web fetch policy object
 */
function createWebFetchPolicy(options = {}) {
  const allowedDomains = Array.isArray(options.allowedDomains)
    ? options.allowedDomains.map((d) => String(d).toLowerCase())
    : [];
  const blockedDomains = Array.isArray(options.blockedDomains)
    ? options.blockedDomains.map((d) => String(d).toLowerCase())
    : [];
  const allowedUrls = Array.isArray(options.allowedUrls)
    ? options.allowedUrls.map((u) => String(u))
    : [];
  const allowedPorts = Array.isArray(options.allowedPorts)
    ? options.allowedPorts.map(Number)
    : [80, 443];
  const maxResponseBytes = Number.isSafeInteger(options.maxResponseBytes) && options.maxResponseBytes > 0
    ? options.maxResponseBytes
    : 5 * 1024 * 1024;
  const allowPrivateIps = options.allowPrivateIps === true;
  const enabled = options.enabled !== false;

  return Object.freeze({
    type: 'webFetch',
    enabled,
    allowedDomains: Object.freeze([...allowedDomains]),
    blockedDomains: Object.freeze([...blockedDomains]),
    allowedUrls: Object.freeze([...allowedUrls]),
    allowedPorts: Object.freeze([...allowedPorts]),
    maxResponseBytes,
    allowPrivateIps,
  });
}

/**
 * Evaluate a web.fetch tool call against a web fetch policy.
 *
 * @param {object} policy - web fetch policy
 * @param {object} args - tool arguments (must have `url`)
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateWebFetch(policy, args) {
  if (!policy.enabled) {
    return { allowed: false, reason: 'Web fetch is disabled by policy' };
  }

  const rawUrl = args?.url;
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { allowed: false, reason: 'Missing or empty URL' };
  }

  const trimmed = rawUrl.trim();

  // Check for null bytes
  if (trimmed.indexOf('\x00') !== -1) {
    return { allowed: false, reason: 'URL contains null bytes' };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  // Check protocol against blocked and allowed lists
  const BLOCKED_PROTOCOLS = new Set([
    'file:', 'ftp:', 'data:', 'javascript:', 'vbscript:', 'about:',
    'chrome:', 'chrome-extension:', 'edge:', 'view-source:',
  ]);
  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
  const protocol = url.protocol.toLowerCase();

  if (BLOCKED_PROTOCOLS.has(protocol)) {
    return { allowed: false, reason: `Blocked protocol: ${protocol}` };
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    return { allowed: false, reason: `Disallowed protocol: ${protocol}` };
  }

  // Check allowed URLs (exact match wins)
  if (policy.allowedUrls.length > 0) {
    const urlString = url.toString();
    const urlNoTrailing = urlString.replace(/\/$/, '');
    const matched = policy.allowedUrls.some((allowed) => {
      const allowedNormalized = allowed.replace(/\/$/, '');
      return urlNoTrailing === allowedNormalized;
    });
    if (!matched) {
      return { allowed: false, reason: `URL not in allowed list: ${urlString}` };
    }
  }

  // Check blocked domains
  const hostname = url.hostname.toLowerCase();
  if (policy.blockedDomains.length > 0) {
    const blocked = policy.blockedDomains.some((domain) =>
      hostname === domain || hostname.endsWith('.' + domain));
    if (blocked) {
      return { allowed: false, reason: `Domain is blocked: ${hostname}` };
    }
  }

  // Check allowed domains (if specified, hostname must match)
  if (policy.allowedDomains.length > 0) {
    const domainOk = policy.allowedDomains.some((domain) =>
      hostname === domain || hostname.endsWith('.' + domain));
    if (!domainOk) {
      return { allowed: false, reason: `Domain not allowed: ${hostname}` };
    }
  }

  // Check ports
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!policy.allowedPorts.includes(port)) {
    return { allowed: false, reason: `Port not allowed: ${port}` };
  }

  // Check private IPs (only when not explicitly allowed)
  if (!policy.allowPrivateIps && isPrivateHost(hostname)) {
    return { allowed: false, reason: `Request to private/internal host blocked: ${hostname}` };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Shell Policy
// ---------------------------------------------------------------------------

/**
 * Policy for restricting shell.run tool calls.
 *
 * @param {object} [options]
 * @param {string[]} [options.allowedCommands] - whitelist of allowed command names
 * @param {string[]} [options.blockedCommands] - blacklist of blocked command names
 * @param {number} [options.maxArgs] - maximum number of arguments allowed (default: 50)
 * @param {number} [options.maxArgLength] - max length of a single argument (default: 4096)
 * @param {string[]} [options.allowedCwd] - allowed working directories
 * @param {boolean} [options.allowPipes] - allow pipe operators in command (default: false)
 * @param {boolean} [options.enabled] - whether this policy is active (default: true)
 * @returns {object} shell policy object
 */
function createShellPolicy(options = {}) {
  const allowedCommands = Array.isArray(options.allowedCommands)
    ? options.allowedCommands.map((c) => String(c).toLowerCase())
    : [];
  const blockedCommands = Array.isArray(options.blockedCommands)
    ? options.blockedCommands.map((c) => String(c).toLowerCase())
    : [];
  const maxArgs = Number.isSafeInteger(options.maxArgs) && options.maxArgs > 0
    ? options.maxArgs
    : 50;
  const maxArgLength = Number.isSafeInteger(options.maxArgLength) && options.maxArgLength > 0
    ? options.maxArgLength
    : 4096;
  const allowedCwd = Array.isArray(options.allowedCwd)
    ? options.allowedCwd.map((c) => String(c))
    : [];
  const allowPipes = options.allowPipes === true;
  const enabled = options.enabled !== false;

  return Object.freeze({
    type: 'shell',
    enabled,
    allowedCommands: Object.freeze([...allowedCommands]),
    blockedCommands: Object.freeze([...blockedCommands]),
    maxArgs,
    maxArgLength,
    allowedCwd: Object.freeze([...allowedCwd]),
    allowPipes,
  });
}

/**
 * Evaluate a shell.run tool call against a shell policy.
 *
 * @param {object} policy - shell policy
 * @param {object} args - tool arguments (must have `command`)
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateShell(policy, args) {
  if (!policy.enabled) {
    return { allowed: false, reason: 'Shell execution is disabled by policy' };
  }

  const rawCommand = args?.command;
  if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
    return { allowed: false, reason: 'Missing or empty command' };
  }

  // Sanitize and extract command name
  const sanitized = sanitizeShellArg(rawCommand);
  const commandName = sanitized.toLowerCase();

  // Blocked commands take precedence
  if (policy.blockedCommands.length > 0) {
    const blocked = policy.blockedCommands.some((cmd) =>
      commandName === cmd || commandName.startsWith(cmd + ' '));
    if (blocked) {
      return { allowed: false, reason: `Command is blocked: ${commandName}` };
    }
  }

  // Allowed commands check (if specified)
  if (policy.allowedCommands.length > 0) {
    const baseCmd = commandName.split(/\s+/)[0];
    if (!policy.allowedCommands.includes(baseCmd)) {
      return { allowed: false, reason: `Command not allowed: ${baseCmd}` };
    }
  }

  // Check for pipe operators
  if (!policy.allowPipes && (rawCommand.includes('|') || sanitized.includes('|'))) {
    return { allowed: false, reason: 'Pipe operators are not allowed' };
  }

  // Validate arguments
  const rawArgs = args?.args;
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs)) {
      return { allowed: false, reason: 'Shell args must be an array' };
    }
    if (rawArgs.length > policy.maxArgs) {
      return { allowed: false, reason: `Too many arguments (${rawArgs.length} > ${policy.maxArgs})` };
    }
    for (let i = 0; i < rawArgs.length; i += 1) {
      const arg = String(rawArgs[i]);
      if (arg.length > policy.maxArgLength) {
        return { allowed: false, reason: `Argument ${i + 1} exceeds max length (${arg.length} > ${policy.maxArgLength})` };
      }
    }
  }

  // Check working directory
  const cwd = args?.cwd;
  if (cwd !== undefined && policy.allowedCwd.length > 0) {
    const resolved = path.resolve(String(cwd));
    const allowed = policy.allowedCwd.some((allowedDir) => {
      const resolvedAllowed = path.resolve(allowedDir);
      return resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep);
    });
    if (!allowed) {
      return { allowed: false, reason: `Working directory not allowed: ${cwd}` };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// File Policy
// ---------------------------------------------------------------------------

/**
 * Policy for restricting file system tool calls (file.read, file.write, file.edit,
 * file.delete, file.glob, file.search, file.readDirectory).
 *
 * @param {object} [options]
 * @param {string[]} [options.allowedPaths] - paths where file operations are allowed
 * @param {string[]} [options.blockedPaths] - paths where file operations are blocked
 * @param {string[]} [options.allowedExtensions] - allowed file extensions (without dot, e.g. ['js', 'ts'])
 * @param {string[]} [options.blockedExtensions] - blocked file extensions
 * @param {number} [options.maxFileSizeBytes] - max file size for reads/writes (default: 50 MB)
 * @param {string[]} [options.allowedOperations] - allowed tool names; if set, only these are permitted
 * @param {boolean} [options.allowDelete] - whether file.delete is permitted (default: false)
 * @param {boolean} [options.enabled] - whether this policy is active (default: true)
 * @returns {object} file policy object
 */
function createFilePolicy(options = {}) {
  const allowedPaths = Array.isArray(options.allowedPaths)
    ? options.allowedPaths.map((p) => String(p))
    : [];
  const blockedPaths = Array.isArray(options.blockedPaths)
    ? options.blockedPaths.map((p) => String(p))
    : [];
  const allowedExtensions = Array.isArray(options.allowedExtensions)
    ? options.allowedExtensions.map((e) => String(e).toLowerCase().replace(/^\./, ''))
    : [];
  const blockedExtensions = Array.isArray(options.blockedExtensions)
    ? options.blockedExtensions.map((e) => String(e).toLowerCase().replace(/^\./, ''))
    : [];
  const maxFileSizeBytes = Number.isSafeInteger(options.maxFileSizeBytes) && options.maxFileSizeBytes > 0
    ? options.maxFileSizeBytes
    : 50 * 1024 * 1024;
  const allowedOperations = Array.isArray(options.allowedOperations)
    ? options.allowedOperations.map((op) => String(op))
    : [];
  const allowDelete = options.allowDelete === true;
  const enabled = options.enabled !== false;

  return Object.freeze({
    type: 'file',
    enabled,
    allowedPaths: Object.freeze([...allowedPaths]),
    blockedPaths: Object.freeze([...blockedPaths]),
    allowedExtensions: Object.freeze([...allowedExtensions]),
    blockedExtensions: Object.freeze([...blockedExtensions]),
    maxFileSizeBytes,
    allowedOperations: Object.freeze([...allowedOperations]),
    allowDelete,
  });
}

/**
 * Check if a file path is within any of the allowed paths (or not in any blocked path).
 *
 * @param {string[]} allowedPaths
 * @param {string[]} blockedPaths
 * @param {string} filePath
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkPathAccess(allowedPaths, blockedPaths, filePath) {
  const resolved = path.resolve(sanitizeFilePath(filePath));

  // Blocked paths take precedence
  if (blockedPaths.length > 0) {
    for (const blocked of blockedPaths) {
      const resolvedBlocked = path.resolve(blocked);
      if (resolved === resolvedBlocked || resolved.startsWith(resolvedBlocked + path.sep)) {
        return { allowed: false, reason: `Path is blocked: ${filePath}` };
      }
    }
  }

  // Allowed paths check (if specified)
  if (allowedPaths.length > 0) {
    const matched = allowedPaths.some((allowed) => {
      const resolvedAllowed = path.resolve(allowed);
      return resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep);
    });
    if (!matched) {
      return { allowed: false, reason: `Path not in allowed paths: ${filePath}` };
    }
  }

  return { allowed: true };
}

/**
 * Check file extension against allowed/blocked lists.
 *
 * @param {string[]} allowedExtensions
 * @param {string[]} blockedExtensions
 * @param {string} filePath
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkExtension(allowedExtensions, blockedExtensions, filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (!ext) return { allowed: true };

  if (blockedExtensions.length > 0 && blockedExtensions.includes(ext)) {
    return { allowed: false, reason: `File extension is blocked: .${ext}` };
  }

  if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) {
    return { allowed: false, reason: `File extension not allowed: .${ext}` };
  }

  return { allowed: true };
}

/**
 * Evaluate a file system tool call against a file policy.
 *
 * @param {object} policy - file policy
 * @param {string} toolName - e.g. 'file.read', 'file.write'
 * @param {object} args - tool arguments (must have `path` for most operations)
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateFile(policy, toolName, args) {
  if (!policy.enabled) {
    return { allowed: false, reason: 'File operations are disabled by policy' };
  }

  // Allowed operations check
  if (policy.allowedOperations.length > 0 && !policy.allowedOperations.includes(toolName)) {
    return { allowed: false, reason: `Operation not allowed: ${toolName}` };
  }

  // Delete operations
  if (toolName === 'file.delete' && !policy.allowDelete) {
    return { allowed: false, reason: 'File deletion is not allowed by policy' };
  }

  const filePath = args?.path;
  const hasFilePath = typeof filePath === 'string' && filePath.trim().length > 0;

  if (hasFilePath) {
    // Path access check
    const pathCheck = checkPathAccess(policy.allowedPaths, policy.blockedPaths, filePath);
    if (!pathCheck.allowed) return pathCheck;

    // Extension check
    const extCheck = checkExtension(policy.allowedExtensions, policy.blockedExtensions, filePath);
    if (!extCheck.allowed) return extCheck;

    // File size check for write operations
    if (toolName === 'file.write') {
      const content = args?.content;
      if (typeof content === 'string') {
        const byteLength = Buffer.byteLength(content, 'utf8');
        if (byteLength > policy.maxFileSizeBytes) {
          return {
            allowed: false,
            reason: `Content exceeds max file size (${byteLength} > ${policy.maxFileSizeBytes} bytes)`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------

/**
 * A policy engine that evaluates tool calls against a collection of security
 * policies. Supports combining multiple policies and provides a unified
 * evaluation interface.
 */
class PolicyEngine {
  /**
   * @param {object[]} [policies] - initial set of policy objects
   */
  constructor(policies = []) {
    this._policies = [];
    for (const policy of policies) {
      this.addPolicy(policy);
    }
  }

  /**
   * Add a policy to the engine.
   * @param {object} policy - a policy object (webFetch, shell, or file)
   */
  addPolicy(policy) {
    if (!policy || typeof policy.type !== 'string') {
      throw new TypeError('Policy must have a valid type property');
    }
    this._policies.push(policy);
  }

  /**
   * Remove a policy by reference.
   * @param {object} policy - reference to the policy to remove
   * @returns {boolean} true if removed
   */
  removePolicy(policy) {
    const index = this._policies.indexOf(policy);
    if (index !== -1) {
      this._policies.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all policies currently registered.
   * @returns {object[]}
   */
  getPolicies() {
    return [...this._policies];
  }

  /**
   * Get policies of a specific type.
   * @param {string} type - 'webFetch', 'shell', or 'file'
   * @returns {object[]}
   */
  getPoliciesByType(type) {
    return this._policies.filter((p) => p.type === type);
  }

  /**
   * Evaluate a tool call against all applicable policies.
   * Returns the first denial, or an allow if all pass.
   *
   * @param {string} toolName - e.g. 'web.fetch', 'shell.run', 'file.write'
   * @param {object} args - tool call arguments
   * @returns {{ allowed: boolean, reason?: string, checkedPolicies?: number }}
   */
  evaluate(toolName, args) {
    let applicableCount = 0;

    if (toolName === 'web.fetch' || toolName === 'web.search') {
      const webPolicies = this.getPoliciesByType('webFetch');
      for (const policy of webPolicies) {
        applicableCount += 1;
        const result = evaluateWebFetch(policy, args);
        if (!result.allowed) return { allowed: false, reason: result.reason, checkedPolicies: applicableCount };
      }
    }

    if (toolName === 'shell.run') {
      const shellPolicies = this.getPoliciesByType('shell');
      for (const policy of shellPolicies) {
        applicableCount += 1;
        const result = evaluateShell(policy, args);
        if (!result.allowed) return { allowed: false, reason: result.reason, checkedPolicies: applicableCount };
      }
    }

    if (toolName.startsWith('file.')) {
      const filePolicies = this.getPoliciesByType('file');
      for (const policy of filePolicies) {
        applicableCount += 1;
        const result = evaluateFile(policy, toolName, args);
        if (!result.allowed) return { allowed: false, reason: result.reason, checkedPolicies: applicableCount };
      }
    }

    return { allowed: true, checkedPolicies: applicableCount };
  }

  /**
   * Reset the engine to empty state.
   */
  reset() {
    this._policies = [];
  }
}

/**
 * Evaluate a tool call against an array of policies (standalone function).
 * Convenience wrapper around PolicyEngine for stateless use.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object[]} policies
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateToolCall(toolName, args, policies) {
  const engine = new PolicyEngine(policies);
  return engine.evaluate(toolName, args);
}

module.exports = {
  createWebFetchPolicy,
  createShellPolicy,
  createFilePolicy,
  evaluateWebFetch,
  evaluateShell,
  evaluateFile,
  PolicyEngine,
  evaluateToolCall,
  checkPathAccess,
  checkExtension,
};
