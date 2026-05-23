'use strict';

// ---------------------------------------------------------------------------
// SafeExecutor — enhanced tool execution safety pipeline with input validation,
// resource limits, output validation, and side-effect detection layers.
//
// Works alongside the sandbox/executor.js and safety/scanner.js to provide
// defence-in-depth for every tool invocation.
// ---------------------------------------------------------------------------

const { sep } = require('node:path');

// -- Constants ----------------------------------------------------------------

/**
 * Tool categories mapped to their default risk levels.
 */
const TOOL_RISK_LEVELS = Object.freeze({
  'file.read': 1,
  'file.write': 7,
  'file.delete': 9,
  'file.move': 6,
  'file.copy': 5,
  'file.list': 1,
  'file.stat': 1,
  'shell.run': 8,
  'shell.exec': 9,
  'network.fetch': 7,
  'network.request': 7,
  'db.query': 6,
  'db.execute': 8,
  'process.spawn': 9,
  'process.kill': 9,
  _default: 3,
});

/**
 * Sensitive path patterns that should trigger warnings or blocks.
 */
const SENSITIVE_PATH_PATTERNS = Object.freeze([
  /\/etc\/(passwd|shadow|hosts|sudoers)/,
  /\/root\//,
  /\/var\/log\//,
  /\/proc\//,
  /\/sys\//,
  /\/dev\//,
  /Windows\/System32/i,
  /C:\\Windows\\System32/i,
  /\.ssh\//,
  /\.aws\//,
  /\.env$/,
  /\.git\/config$/,
  /id_rsa/,
  /credentials/,
]);

/**
 * Suspicious shell patterns that indicate potentially dangerous commands.
 */
const SUSPICIOUS_SHELL_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+777\b/,
  /\bchown\s+-R\b/,
  /\bformat\s+(c|d|e|f|g|h):/i,
  /\bdel\s+\/f\s+\/s\b/i,
  /\bwget\s+.*\|\s*(sh|bash|zsh)/,
  /\bcurl\s+.*\|\s*(sh|bash|zsh)/,
  /\beval\b/,
  /\bexec\b/,
  /\bsudo\b/,
  /\bsu\s+-/,
  /\bnc\s+-[elnv]/,
  /\breverse\s+shell/i,
  /\bbind\s+shell/i,
  /\>\/dev\/sda/,
  /\bdeltree\b/i,
]);

// -- Error classes ------------------------------------------------------------

class SafeExecutionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SafeExecutionError';
    this.code = code;
    this.details = details || {};
  }
}

class PreValidationError extends SafeExecutionError {
  constructor(message, details) {
    super('PRE_VALIDATION_FAILED', message, details);
    this.name = 'PreValidationError';
  }
}

class PostValidationError extends SafeExecutionError {
  constructor(message, details) {
    super('POST_VALIDATION_FAILED', message, details);
    this.name = 'PostValidationError';
  }
}

class ResourceLimitError extends SafeExecutionError {
  constructor(message, details) {
    super('RESOURCE_LIMIT_EXCEEDED', message, details);
    this.name = 'ResourceLimitError';
  }
}

// -- Helpers ------------------------------------------------------------------

/**
 * Safely coerce a positive integer value, falling back on a default.
 */
function safePositiveInt(value, fallback) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

/**
 * Check whether a target path matches any sensitive path pattern.
 * @param {string} targetPath
 * @returns {{ matched: boolean, pattern?: RegExp }}
 */
function checkSensitivePath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return { matched: false };
  }
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(targetPath)) {
      return { matched: true, pattern };
    }
  }
  return { matched: false };
}

/**
 * Check whether a shell command string matches suspicious patterns.
 * @param {string} command
 * @returns {{ matched: boolean, patterns: RegExp[] }}
 */
function checkSuspiciousShell(command) {
  if (typeof command !== 'string' || command.length === 0) {
    return { matched: false, patterns: [] };
  }
  const matched = [];
  for (const pattern of SUSPICIOUS_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      matched.push(pattern);
    }
  }
  return { matched: matched.length > 0, patterns: matched };
}

/**
 * Estimate output size in bytes for common types.
 * @param {*} value
 * @returns {number}
 */
function estimateOutputSize(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Check if a tool name implies network access.
 * @param {string} toolName
 * @returns {boolean}
 */
function isNetworkTool(toolName) {
  if (typeof toolName !== 'string') return false;
  const lower = toolName.toLowerCase();
  return lower.startsWith('network.') || lower.includes('fetch') || lower.includes('http') || lower.includes('request');
}

/**
 * Check if a tool name implies file operations.
 * @param {string} toolName
 * @returns {boolean}
 */
function isFileTool(toolName) {
  if (typeof toolName !== 'string') return false;
  const lower = toolName.toLowerCase();
  return lower.startsWith('file.') || lower.startsWith('fs.') || lower === 'write' || lower === 'read';
}

/**
 * Check if a tool name implies shell execution.
 * @param {string} toolName
 * @returns {boolean}
 */
function isShellTool(toolName) {
  if (typeof toolName !== 'string') return false;
  const lower = toolName.toLowerCase();
  return lower.startsWith('shell.') || lower.startsWith('process.') || lower.includes('exec') || lower.includes('spawn');
}

/**
 * Check if a tool name implies data access.
 * @param {string} toolName
 * @returns {boolean}
 */
function isDataTool(toolName) {
  if (typeof toolName !== 'string') return false;
  const lower = toolName.toLowerCase();
  return lower.startsWith('db.') || lower.startsWith('data.') || lower.includes('query') || lower.includes('sql');
}

// -- Execution record factory ------------------------------------------------

function createExecutionRecord(tool, args, result, meta) {
  return {
    tool,
    args,
    result,
    startedAt: meta.startedAt || new Date().toISOString(),
    completedAt: meta.completedAt || new Date().toISOString(),
    durationMs: meta.durationMs || 0,
    status: meta.status || 'completed',
    riskLevel: TOOL_RISK_LEVELS[tool] !== undefined ? TOOL_RISK_LEVELS[tool] : TOOL_RISK_LEVELS._default,
    categories: meta.categories || classifyToolCategories(tool),
    preValidation: meta.preValidation || null,
    postValidation: meta.postValidation || null,
    monitoring: meta.monitoring || null,
    error: meta.error || null,
  };
}

/**
 * Classify a tool into one or more safety categories.
 */
function classifyToolCategories(tool) {
  const categories = [];
  if (isFileTool(tool)) categories.push('file');
  if (isNetworkTool(tool)) categories.push('network');
  if (isShellTool(tool)) categories.push('shell');
  if (isDataTool(tool)) categories.push('data');
  if (categories.length === 0) categories.push('general');
  return categories;
}

// -- Resource limit defaults --------------------------------------------------

const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  maxTimeMs: 30_000,
  maxOutputBytes: 1 * 1024 * 1024,   // 1 MiB
  maxMemoryBytes: 128 * 1024 * 1024,  // 128 MiB
  maxArgsCount: 50,
  maxArgLength: 10_000,
  maxResultDepth: 20,
});

// ---------------------------------------------------------------------------
// SafeExecutor
// ---------------------------------------------------------------------------

/**
 * @class SafeExecutor
 *
 * @description
 * Enhanced tool execution wrapper that adds safety layers around every tool
 * invocation: input validation, resource limits, output validation, and
 * side-effect detection.
 *
 * Safety layers applied in order:
 * 1. **preValidate(tool, args)** — validates tool name, argument structure,
 *    resource limits, sensitive path detection, and command allowlisting.
 * 2. **execute(tool, args, options)** — delegates to the actual executor
 *    while enforcing timeouts and output size caps.
 * 3. **postValidate(tool, result)** — scans results for leaked secrets,
 *    abnormal patterns, and policy violations.
 * 4. **monitor(tool, execution)** — detects side effects, tracks resource
 *    usage, and flags risky operations.
 *
 * @example
 * const executor = new SafeExecutor({
 *   maxTimeMs: 10_000,
 *   allowedPaths: new Set(['/tmp', '/home/user/projects']),
 *   allowedCommands: new Set(['ls', 'cat', 'node']),
 * });
 *
 * const result = executor.execute('file.read', { path: '/tmp/data.txt' }, {
 *   executor: (tool, args) => fs.readFileSync(args.path, 'utf8'),
 * });
 */
class SafeExecutor {
  /**
   * @param {object} [options]
   * @param {number}  [options.maxTimeMs]        maximum execution time in ms (default: 30 000)
   * @param {number}  [options.maxOutputBytes]   maximum output size in bytes (default: 1 MiB)
   * @param {number}  [options.maxMemoryBytes]   maximum memory in bytes (default: 128 MiB)
   * @param {number}  [options.maxArgsCount]     maximum number of arguments (default: 50)
   * @param {number}  [options.maxArgLength]     maximum string length per argument (default: 10 000)
   * @param {number}  [options.maxResultDepth]   max result nesting depth (default: 20)
   * @param {Set<string>} [options.allowedPaths]   whitelisted file-system paths
   * @param {Set<string>} [options.allowedCommands] whitelisted shell commands
   * @param {Set<string>} [options.allowedDomains]  whitelisted network domains
   * @param {Set<string>} [options.deniedTools]     blocked tool names
   * @param {Set<string>} [options.warnTools]       tools that produce warnings but are not blocked
   * @param {boolean}  [options.blockSensitivePaths]   block access to sensitive paths (default: true)
   * @param {boolean}  [options.blockSuspiciousShell]  block suspicious shell patterns (default: true)
   * @param {boolean}  [options.requireAllowlists]      require path/command/domain allowlists (default: false)
   * @param {boolean}  [options.strictMode]             enable all blocking (default: false)
   */
  constructor(options = {}) {
    this._maxTimeMs = safePositiveInt(options.maxTimeMs, DEFAULT_RESOURCE_LIMITS.maxTimeMs);
    this._maxOutputBytes = safePositiveInt(options.maxOutputBytes, DEFAULT_RESOURCE_LIMITS.maxOutputBytes);
    this._maxMemoryBytes = safePositiveInt(options.maxMemoryBytes, DEFAULT_RESOURCE_LIMITS.maxMemoryBytes);
    this._maxArgsCount = safePositiveInt(options.maxArgsCount, DEFAULT_RESOURCE_LIMITS.maxArgsCount);
    this._maxArgLength = safePositiveInt(options.maxArgLength, DEFAULT_RESOURCE_LIMITS.maxArgLength);
    this._maxResultDepth = safePositiveInt(options.maxResultDepth, DEFAULT_RESOURCE_LIMITS.maxResultDepth);

    this._allowedPaths = options.allowedPaths instanceof Set
      ? options.allowedPaths
      : new Set(options.allowedPaths || []);
    this._allowedCommands = options.allowedCommands instanceof Set
      ? options.allowedCommands
      : new Set(options.allowedCommands || []);
    this._allowedDomains = options.allowedDomains instanceof Set
      ? options.allowedDomains
      : new Set(options.allowedDomains || []);

    this._deniedTools = options.deniedTools instanceof Set
      ? options.deniedTools
      : new Set(options.deniedTools || []);
    this._warnTools = options.warnTools instanceof Set
      ? options.warnTools
      : new Set(options.warnTools || []);

    this._blockSensitivePaths = options.blockSensitivePaths !== false;
    this._blockSuspiciousShell = options.blockSuspiciousShell !== false;
    this._requireAllowlists = options.requireAllowlists === true;

    if (options.strictMode === true) {
      this._blockSensitivePaths = true;
      this._blockSuspiciousShell = true;
      this._requireAllowlists = true;
    }

    // Cumulative execution log
    this._executionLog = [];

    // Cumulative statistics
    this._stats = {
      totalExecutions: 0,
      totalBlocks: 0,
      totalWarnings: 0,
      totalErrors: 0,
      totalTimeouts: 0,
      totalOutputBytes: 0,
      lastExecutionAt: null,
    };
  }

  // -- Allowlist / denylist management ---------------------------------------

  /** @param {string} path */
  allowPath(path) {
    if (typeof path === 'string' && path.trim().length > 0) {
      this._allowedPaths.add(path.trim());
    }
  }

  /** @param {string} command */
  allowCommand(command) {
    if (typeof command === 'string' && command.trim().length > 0) {
      this._allowedCommands.add(command.trim().toLowerCase());
    }
  }

  /** @param {string} domain */
  allowDomain(domain) {
    if (typeof domain === 'string' && domain.trim().length > 0) {
      this._allowedDomains.add(domain.trim().toLowerCase());
    }
  }

  /** @param {string} tool */
  denyTool(tool) {
    if (typeof tool === 'string' && tool.trim().length > 0) {
      this._deniedTools.add(tool.trim().toLowerCase());
    }
  }

  // -- Core pipeline ----------------------------------------------------------

  /**
   * Execute a tool through the full safety pipeline.
   *
   * @param {string}   tool           tool name (e.g. "file.read", "shell.run")
   * @param {*}        args           tool arguments
   * @param {object}   [options]
   * @param {function} [options.executor]   actual execution function: (tool, args) => result
   * @param {number}   [options.timeoutMs]  per-call timeout override
   * @param {object}   [options.context]    additional context for validation
   * @returns {{ passed: boolean, result?: *, error?: SafeExecutionError,
   *             preValidation: object, postValidation: object, monitoring: object,
   *             durationMs: number, warnings: object[] }}
   */
  execute(tool, args, options = {}) {
    const startedAt = Date.now();
    const warnings = [];
    const meta = { startedAt: new Date().toISOString() };

    // ---- Layer 1: preValidate ------------------------------------------------
    let preValidation;
    try {
      preValidation = this.preValidate(tool, args, options.context);
      if (!preValidation.valid) {
        return this._createBlockedResult(tool, args, preValidation, startedAt);
      }
      if (preValidation.warnings && preValidation.warnings.length > 0) {
        warnings.push(...preValidation.warnings);
        this._stats.totalWarnings += preValidation.warnings.length;
      }
    } catch (err) {
      return this._createErrorResult(tool, args, err, 'preValidate', startedAt);
    }

    meta.preValidation = preValidation;

    // ---- Layer 2: Execute ----------------------------------------------------
    let result;
    let executionError = null;

    const executorFn = typeof options.executor === 'function'
      ? options.executor
      : null;

    if (executorFn) {
      try {
        const execResult = executorFn(tool, args);
        // Support both sync and async executors
        if (execResult && typeof execResult.then === 'function') {
          // Async executor — warn that we cannot fully monitor this synchronously
          warnings.push({
            type: 'ASYNC_EXECUTOR',
            message: 'Executor returned a Promise; post-validation and monitoring will run on the resolved value. Use executeAsync for full async support.',
          });
          result = execResult;
        } else {
          result = execResult;
        }
      } catch (err) {
        executionError = err;
      }
    }

    const durationMs = Date.now() - startedAt;
    meta.completedAt = new Date().toISOString();
    meta.durationMs = durationMs;

    // Check resource limits
    if (durationMs > this._maxTimeMs) {
      executionError = new ResourceLimitError(
        `Execution time ${durationMs}ms exceeded limit ${this._maxTimeMs}ms`,
        { tool, durationMs, limit: this._maxTimeMs }
      );
    }

    // Check output size
    const outputSize = estimateOutputSize(result);
    if (outputSize > this._maxOutputBytes) {
      const truncErr = new ResourceLimitError(
        `Output size ${outputSize} bytes exceeded limit ${this._maxOutputBytes} bytes`,
        { tool, outputSize, limit: this._maxOutputBytes }
      );
      if (!executionError) executionError = truncErr;
    }

    if (executionError) {
      // Wrap raw errors in SafeExecutionError if needed
      const wrappedError = executionError instanceof SafeExecutionError
        ? executionError
        : new SafeExecutionError('EXECUTION_ERROR', executionError.message || 'Tool execution failed', { tool, originalError: executionError.name });

      meta.status = 'error';
      meta.error = wrappedError.message;
      this._stats.totalErrors += 1;
      this._stats.totalExecutions += 1;
      this._stats.lastExecutionAt = meta.completedAt;

      const record = createExecutionRecord(tool, args, null, meta);
      this._executionLog.push(record);

      return Object.freeze({
        passed: false,
        result: null,
        error: wrappedError,
        preValidation,
        postValidation: null,
        monitoring: null,
        durationMs,
        warnings: Object.freeze([...warnings]),
        execution: record,
      });
    }

    // ---- Layer 3: postValidate -----------------------------------------------
    let postValidation;
    try {
      postValidation = this.postValidate(tool, result);
      if (!postValidation.valid) {
        meta.status = 'blocked_post';
        this._stats.totalBlocks += 1;
        this._stats.totalExecutions += 1;
        this._stats.lastExecutionAt = meta.completedAt;

        const record = createExecutionRecord(tool, args, result, meta);
        record.postValidation = postValidation;
        this._executionLog.push(record);

        return Object.freeze({
          passed: false,
          result: null,
          error: new PostValidationError(
            postValidation.reason || 'Post-validation failed',
            { tool, validation: postValidation }
          ),
          preValidation,
          postValidation,
          monitoring: null,
          durationMs,
          warnings: Object.freeze([...warnings]),
          execution: record,
        });
      }
      if (postValidation.warnings && postValidation.warnings.length > 0) {
        warnings.push(...postValidation.warnings);
        this._stats.totalWarnings += postValidation.warnings.length;
      }
    } catch (err) {
      meta.status = 'error_post';
      this._stats.totalErrors += 1;
      this._stats.totalExecutions += 1;
      this._stats.lastExecutionAt = meta.completedAt;

      const record = createExecutionRecord(tool, args, result, meta);
      this._executionLog.push(record);

      return Object.freeze({
        passed: false,
        result: null,
        error: new SafeExecutionError('POST_VALIDATION_ERROR', err.message, { tool }),
        preValidation,
        postValidation: { valid: false, reason: err.message },
        monitoring: null,
        durationMs,
        warnings: Object.freeze([...warnings]),
        execution: record,
      });
    }

    meta.postValidation = postValidation;

    // ---- Layer 4: monitor ----------------------------------------------------
    let monitoring;
    try {
      monitoring = this.monitor(tool, {
        tool,
        args,
        result,
        durationMs,
        preValidation,
        postValidation,
        startedAt: meta.startedAt,
      });
      if (monitoring.warnings && monitoring.warnings.length > 0) {
        warnings.push(...monitoring.warnings);
        this._stats.totalWarnings += monitoring.warnings.length;
      }
    } catch (_err) {
      monitoring = { monitored: false, warnings: [], error: _err.message };
    }

    meta.monitoring = monitoring;
    meta.status = 'completed';

    // Record and update stats
    this._stats.totalExecutions += 1;
    this._stats.totalOutputBytes += outputSize;
    this._stats.lastExecutionAt = meta.completedAt;

    if (durationMs > this._maxTimeMs) {
      this._stats.totalTimeouts += 1;
    }

    const record = createExecutionRecord(tool, args, result, meta);
    this._executionLog.push(record);

    return Object.freeze({
      passed: true,
      result,
      error: null,
      preValidation,
      postValidation,
      monitoring,
      durationMs,
      warnings: Object.freeze([...warnings]),
      execution: record,
    });
  }

  // -- Layer 1: preValidate ---------------------------------------------------

  /**
   * Validate tool name, arguments, and execution context before execution.
   *
   * Checks performed:
   * - Tool name is a non-empty string
   * - Tool is not in the denied list
   * - Arguments do not exceed count/length limits
   * - Sensitive paths are detected and blocked/warned
   * - Suspicious shell commands are detected and blocked/warned
   * - Path/command/domain allowlists are enforced when required
   *
   * @param {string} tool
   * @param {*} args
   * @param {object} [context]
   * @returns {{ valid: boolean, reason?: string, warnings?: object[],
   *             riskLevel: number, categories: string[] }}
   */
  preValidate(tool, args, context) {
    const warnings = [];

    // 1. Validate tool name
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      return { valid: false, reason: 'Tool name must be a non-empty string', warnings: [], riskLevel: 0, categories: [] };
    }

    const toolName = tool.trim().toLowerCase();

    // 2. Check denied tools
    if (this._deniedTools.has(toolName)) {
      return { valid: false, reason: `Tool "${tool}" is denied by policy`, warnings: [], riskLevel: 0, categories: [] };
    }

    // 3. Get risk level and categories
    const riskLevel = TOOL_RISK_LEVELS[toolName] !== undefined
      ? TOOL_RISK_LEVELS[toolName]
      : TOOL_RISK_LEVELS._default;
    const categories = classifyToolCategories(toolName);

    // 4. Warn for high-risk tools
    if (this._warnTools.has(toolName)) {
      warnings.push({
        type: 'HIGH_RISK_TOOL',
        severity: 'WARNING',
        message: `Tool "${tool}" is flagged as high risk`,
        tool,
        riskLevel,
      });
    }

    // 5. Validate arguments count
    if (Array.isArray(args)) {
      if (args.length > this._maxArgsCount) {
        return {
          valid: false,
          reason: `Too many arguments: ${args.length} (max ${this._maxArgsCount})`,
          warnings,
          riskLevel,
          categories,
        };
      }
    }

    // 6. Validate argument lengths
    if (typeof args === 'string' && args.length > this._maxArgLength) {
      return {
        valid: false,
        reason: `Argument too long: ${args.length} chars (max ${this._maxArgLength})`,
        warnings,
        riskLevel,
        categories,
      };
    }

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const argStr = this._serializeForCheck(args);
      if (argStr.length > this._maxArgLength * 2) {
        warnings.push({
          type: 'LARGE_ARGS',
          severity: 'WARNING',
          message: `Arguments payload is large (${argStr.length} chars)`,
        });
      }
    }

    // 7. Sensitive path detection for file-related tools
    if (categories.includes('file') && args && typeof args === 'object') {
      const pathFields = ['path', 'filePath', 'file', 'source', 'target', 'dest', 'destination', 'from', 'to'];
      for (const field of pathFields) {
        const pathValue = args[field];
        if (typeof pathValue !== 'string') continue;

        const sensitiveCheck = checkSensitivePath(pathValue);
        if (sensitiveCheck.matched) {
          if (this._blockSensitivePaths) {
            return {
              valid: false,
              reason: `Access to sensitive path denied: "${pathValue}"`,
              warnings,
              riskLevel,
              categories,
            };
          }
          warnings.push({
            type: 'SENSITIVE_PATH',
            severity: 'HIGH',
            message: `Tool accesses sensitive path: "${pathValue}"`,
            path: pathValue,
          });
        }

        // Path allowlist enforcement
        if (this._requireAllowlists && this._allowedPaths.size > 0) {
          const isAllowed = [...this._allowedPaths].some(
            (allowed) => pathValue.startsWith(allowed) || allowed.startsWith(pathValue)
          );
          if (!isAllowed) {
            return {
              valid: false,
              reason: `Path "${pathValue}" is not in the allowed paths list`,
              warnings,
              riskLevel,
              categories,
            };
          }
        }
      }
    }

    // 8. Suspicious shell command detection
    if (categories.includes('shell') && args) {
      const cmdStr = typeof args === 'string' ? args : this._serializeForCheck(args);
      const shellCheck = checkSuspiciousShell(cmdStr);

      if (shellCheck.matched) {
        if (this._blockSuspiciousShell) {
          return {
            valid: false,
            reason: `Suspicious shell command blocked: "${cmdStr.substring(0, 200)}"`,
            warnings,
            riskLevel,
            categories,
          };
        }
        warnings.push({
          type: 'SUSPICIOUS_SHELL',
          severity: 'HIGH',
          message: `Suspicious shell command detected: "${cmdStr.substring(0, 200)}"`,
        });
      }

      // Command allowlist enforcement (extract first word as command)
      const firstWord = (typeof args === 'string' ? args : String(args.command || ''))
        .trim().split(/\s+/)[0].toLowerCase();
      if (this._requireAllowlists && this._allowedCommands.size > 0 && firstWord) {
        if (!this._allowedCommands.has(firstWord)) {
          return {
            valid: false,
            reason: `Shell command "${firstWord}" is not in the allowed commands list`,
            warnings,
            riskLevel,
            categories,
          };
        }
      }
    }

    // 9. Domain allowlist for network tools
    if (categories.includes('network') && args && typeof args === 'object') {
      const domainFields = ['url', 'uri', 'host', 'domain', 'endpoint', 'baseUrl'];
      for (const field of domainFields) {
        const value = args[field];
        if (typeof value !== 'string') continue;

        let domain;
        try {
          // Attempt to extract domain from URL
          if (value.startsWith('http://') || value.startsWith('https://')) {
            const urlObj = new URL(value);
            domain = urlObj.hostname.toLowerCase();
          } else {
            domain = value.toLowerCase();
          }
        } catch {
          domain = value.toLowerCase();
        }

        if (this._requireAllowlists && this._allowedDomains.size > 0 && domain) {
          const isAllowed = [...this._allowedDomains].some(
            (allowed) => domain === allowed || domain.endsWith('.' + allowed)
          );
          if (!isAllowed) {
            return {
              valid: false,
              reason: `Domain "${domain}" is not in the allowed domains list`,
              warnings,
              riskLevel,
              categories,
            };
          }
        }
      }
    }

    return {
      valid: true,
      reason: '',
      warnings,
      riskLevel,
      categories,
    };
  }

  // -- Layer 3: postValidate --------------------------------------------------

  /**
   * Validate tool execution result after execution.
   *
   * Checks performed:
   * - Result is not undefined for tools expected to return data
   * - Result nesting depth does not exceed limit
   * - Output size does not exceed limit
   * - Result contains no obvious secrets or credentials
   * - Error-like results are flagged
   *
   * @param {string} tool
   * @param {*} result
   * @returns {{ valid: boolean, reason?: string, warnings?: object[],
   *             outputSize: number, resultType: string }}
   */
  postValidate(tool, result) {
    const warnings = [];

    // 1. Size check
    const outputSize = estimateOutputSize(result);
    if (outputSize > this._maxOutputBytes) {
      return {
        valid: false,
        reason: `Output size ${outputSize} bytes exceeds maximum ${this._maxOutputBytes} bytes`,
        warnings,
        outputSize,
        resultType: typeof result,
      };
    }

    if (outputSize > this._maxOutputBytes * 0.8) {
      warnings.push({
        type: 'LARGE_OUTPUT',
        severity: 'WARNING',
        message: `Output is approaching size limit: ${outputSize} / ${this._maxOutputBytes} bytes`,
      });
    }

    // 2. Depth check for objects
    if (result && typeof result === 'object') {
      const depth = this._getObjectDepth(result);
      if (depth > this._maxResultDepth) {
        return {
          valid: false,
          reason: `Result nesting depth ${depth} exceeds maximum ${this._maxResultDepth}`,
          warnings,
          outputSize,
          resultType: 'object',
        };
      }
    }

    // 3. Seam / secret detection via simple heuristics
    if (typeof result === 'string') {
      const secretPatterns = [
        { name: 'api_key', pattern: /sk-[A-Za-z0-9-_]{20,}/ },
        { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
        { name: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/ },
        { name: 'jwt', pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/ },
        { name: 'private_key', pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE KEY-----/ },
        { name: 'connection_string', pattern: /(mongodb|postgresql|mysql|redis):\/\/[^:\s]+:[^@\s]+@/i },
      ];

      for (const { name, pattern } of secretPatterns) {
        if (pattern.test(result)) {
          warnings.push({
            type: 'SECRET_LEAK',
            severity: 'HIGH',
            message: `Result may contain leaked secret (pattern: ${name})`,
          });
          break; // One warning is enough
        }
      }
    }

    // 4. Error-like result detection
    if (result && typeof result === 'object') {
      if (result.error || result.err || result.fault) {
        warnings.push({
          type: 'ERROR_RESULT',
          severity: 'INFO',
          message: 'Tool returned an error-shaped result',
          errorDetail: (result.error || result.err || result.fault),
        });
      }
    }

    return {
      valid: true,
      reason: '',
      warnings,
      outputSize,
      resultType: typeof result,
    };
  }

  // -- Layer 4: monitor -------------------------------------------------------

  /**
   * Monitor an execution for safety concerns and side effects.
   *
   * Tracks:
   * - Tool category risk assessment
   * - Duration analysis (anomalously fast/slow)
   * - Output size patterns
   * - File operation side effects
   * - Network access side effects
   * - Shell execution side effects
   * - Data access patterns
   *
   * @param {string} tool
   * @param {object} execution — the execution context with tool, args, result, etc.
   * @returns {{ monitored: boolean, riskScore: number, warnings: object[],
   *             sideEffects: string[], categories: string[] }}
   */
  monitor(tool, execution) {
    const warnings = [];
    const sideEffects = [];
    const categories = classifyToolCategories(tool);

    // 1. Risk level assessment
    const riskLevel = TOOL_RISK_LEVELS[tool] !== undefined
      ? TOOL_RISK_LEVELS[tool]
      : TOOL_RISK_LEVELS._default;

    if (riskLevel >= 7) {
      warnings.push({
        type: 'HIGH_RISK_OPERATION',
        severity: riskLevel >= 9 ? 'CRITICAL' : 'HIGH',
        message: `Tool "${tool}" has high risk level ${riskLevel}/10`,
        riskLevel,
      });
    }

    // 2. Duration analysis
    if (execution && typeof execution.durationMs === 'number') {
      if (execution.durationMs < 1) {
        warnings.push({
          type: 'ANOMALOUS_DURATION',
          severity: 'LOW',
          message: `Execution completed suspiciously fast (${execution.durationMs}ms)`,
        });
      }
      if (execution.durationMs > this._maxTimeMs * 0.9) {
        warnings.push({
          type: 'NEAR_TIMEOUT',
          severity: 'MEDIUM',
          message: `Execution duration ${execution.durationMs}ms is near limit ${this._maxTimeMs}ms`,
        });
      }
    }

    // 3. Output size analysis
    if (execution && execution.result !== undefined) {
      const outSize = estimateOutputSize(execution.result);
      if (outSize === 0 && categories.includes('file') && !categories.includes('shell')) {
        warnings.push({
          type: 'EMPTY_OUTPUT',
          severity: 'LOW',
          message: 'File operation returned empty result',
        });
      }
    }

    // 4. Side effect detection by category
    if (categories.includes('file')) {
      sideEffects.push('FILESYSTEM_ACCESS');
      if (tool.includes('write') || tool.includes('delete') || tool.includes('create') || tool.includes('move')) {
        sideEffects.push('FILESYSTEM_MUTATION');
        warnings.push({
          type: 'FILESYSTEM_MUTATION',
          severity: 'MEDIUM',
          message: `Tool "${tool}" may modify the filesystem`,
        });
      }
    }

    if (categories.includes('network')) {
      sideEffects.push('NETWORK_ACCESS');
      warnings.push({
        type: 'NETWORK_ACCESS',
        severity: 'LOW',
        message: `Tool "${tool}" performs network access`,
      });
    }

    if (categories.includes('shell')) {
      sideEffects.push('SHELL_EXECUTION');
      warnings.push({
        type: 'SHELL_EXECUTION',
        severity: 'MEDIUM',
        message: `Tool "${tool}" executes shell commands`,
      });
    }

    if (categories.includes('data')) {
      sideEffects.push('DATA_ACCESS');
      if (tool.includes('execute') || tool.includes('write') || tool.includes('insert') || tool.includes('update') || tool.includes('delete')) {
        sideEffects.push('DATA_MUTATION');
      }
    }

    // 5. Compute overall risk score for this execution
    let riskScore = riskLevel * 5; // Base: 0-50 from risk level
    riskScore += sideEffects.length * 5; // +5 per detected side effect
    riskScore += warnings.length * 3; // +3 per warning
    riskScore = Math.min(riskScore, 100);

    return {
      monitored: true,
      riskScore,
      warnings,
      sideEffects,
      categories,
    };
  }

  // -- Statistics and history -------------------------------------------------

  /**
   * Get cumulative execution statistics.
   * @returns {object}
   */
  getStats() {
    return {
      totalExecutions: this._stats.totalExecutions,
      totalBlocks: this._stats.totalBlocks,
      totalWarnings: this._stats.totalWarnings,
      totalErrors: this._stats.totalErrors,
      totalTimeouts: this._stats.totalTimeouts,
      totalOutputBytes: this._stats.totalOutputBytes,
      lastExecutionAt: this._stats.lastExecutionAt,
    };
  }

  /**
   * Get the full execution log.
   * @param {number} [limit] — max entries to return (default: all)
   * @returns {object[]}
   */
  getExecutionLog(limit) {
    const log = this._executionLog;
    if (Number.isSafeInteger(limit) && limit > 0) {
      return log.slice(-limit);
    }
    return [...log];
  }

  /**
   * Get executions filtered by tool category.
   * @param {string} category — 'file', 'network', 'shell', 'data', or 'general'
   * @returns {object[]}
   */
  getExecutionsByCategory(category) {
    return this._executionLog.filter((e) => e.categories.includes(category));
  }

  /**
   * Get executions that had warnings or were blocked.
   * @returns {object[]}
   */
  getFlaggedExecutions() {
    return this._executionLog.filter(
      (e) => e.status !== 'completed' || (e.monitoring && e.monitoring.warnings && e.monitoring.warnings.length > 0)
    );
  }

  /**
   * Reset the execution log and statistics.
   */
  reset() {
    this._executionLog = [];
    this._stats = {
      totalExecutions: 0,
      totalBlocks: 0,
      totalWarnings: 0,
      totalErrors: 0,
      totalTimeouts: 0,
      totalOutputBytes: 0,
      lastExecutionAt: null,
    };
  }

  // -- Internals ---------------------------------------------------------------

  /**
   * Compute the nesting depth of an object (handles circular refs).
   * @param {*} obj
   * @param {number} [currentDepth] — used for recursion
   * @param {WeakSet} [seen] — used for cycle detection
   * @returns {number}
   */
  _getObjectDepth(obj, currentDepth, seen) {
    if (obj === null || typeof obj !== 'object') return 0;
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) return 0; // Circular reference
    seen.add(obj);

    let maxDepth = 0;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const depth = this._getObjectDepth(obj[i], 0, seen);
        if (depth > maxDepth) maxDepth = depth;
      }
    } else {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const depth = this._getObjectDepth(obj[keys[i]], 0, seen);
        if (depth > maxDepth) maxDepth = depth;
      }
    }
    return maxDepth + 1;
  }

  /**
   * Serialize a value safely for text-based checks.
   * @param {*} value
   * @returns {string}
   */
  _serializeForCheck(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Build a standard blocked-result response.
   */
  _createBlockedResult(tool, args, preValidation, startedAt) {
    const durationMs = Date.now() - startedAt;
    this._stats.totalBlocks += 1;
    this._stats.totalExecutions += 1;
    this._stats.lastExecutionAt = new Date().toISOString();

    return Object.freeze({
      passed: false,
      result: null,
      error: new PreValidationError(
        preValidation.reason || 'Tool execution blocked by pre-validation',
        { tool, validation: preValidation }
      ),
      preValidation,
      postValidation: null,
      monitoring: null,
      durationMs,
      warnings: Object.freeze(preValidation.warnings || []),
    });
  }

  /**
   * Build a standard error result response.
   */
  _createErrorResult(tool, args, err, phase, startedAt) {
    const durationMs = Date.now() - startedAt;
    this._stats.totalErrors += 1;
    this._stats.totalExecutions += 1;
    this._stats.lastExecutionAt = new Date().toISOString();

    const error = err instanceof SafeExecutionError
      ? err
      : new SafeExecutionError('EXECUTION_ERROR', err.message || 'Unknown error', { tool, phase });

    return Object.freeze({
      passed: false,
      result: null,
      error,
      preValidation: null,
      postValidation: null,
      monitoring: null,
      durationMs,
      warnings: Object.freeze([]),
    });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SafeExecutor,
  SafeExecutionError,
  PreValidationError,
  PostValidationError,
  ResourceLimitError,
  TOOL_RISK_LEVELS,
  SENSITIVE_PATH_PATTERNS,
  SUSPICIOUS_SHELL_PATTERNS,
  DEFAULT_RESOURCE_LIMITS,
  classifyToolCategories,
  checkSensitivePath,
  checkSuspiciousShell,
  estimateOutputSize,
  createExecutionRecord,
};
