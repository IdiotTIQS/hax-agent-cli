'use strict';

// ---------------------------------------------------------------------------
// VM Sandbox — creates a hardened Node.js vm context with captured I/O,
// whitelisted globals, and resource tracking.
// ---------------------------------------------------------------------------

const vm = require('node:vm');

// -- Globals whitelisted inside the sandbox ----------------------------------

const WHITELISTED_GLOBALS = {
  // Data interchange
  JSON,
  // Math & numbers
  Math,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  // Encoding / decoding
  encodeURI,
  encodeURIComponent,
  decodeURI,
  decodeURIComponent,
  // Binary
  Buffer,
  TextEncoder,
  TextDecoder,
  // Core constructors
  Date,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Map,
  Set,
  WeakMap,
  WeakSet,
  RegExp,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  URIError,
  EvalError,
  AggregateError,
  Promise,
  Symbol,
  BigInt,
  // Typed arrays
  ArrayBuffer,
  SharedArrayBuffer,
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView,
  // Iteration helpers
  ArrayPrototype: undefined, // will be replaced
};

// These globals are explicitly stripped from the sandbox, even if code tries
// to access them through constructor chains or prototype lookups.
const BLOCKED_GLOBALS = new Set([
  'require',
  'process',
  'global',
  'globalThis',
  '__dirname',
  '__filename',
  'module',
  'exports',
]);

// -- Console capture ---------------------------------------------------------

/**
 * Creates a console-like object whose methods capture output into memory
 * buffers. The captured lines are accessible via `_stdout` and `_stderr`.
 *
 * @param {object} [options]
 * @param {number} [options.maxLines]  max lines to keep per stream (default: 10 000)
 * @param {number} [options.maxBytes]  max total bytes across both streams (default: 1 MiB)
 * @returns {object}
 */
function captureOutput(options = {}) {
  const maxLines = safePositiveInt(options.maxLines, 10_000);
  const maxBytes = safePositiveInt(options.maxBytes, 1 * 1024 * 1024);

  const stdout = [];
  const stderr = [];
  let totalBytes = 0;
  let truncated = false;

  function append(target, args) {
    if (totalBytes >= maxBytes) {
      truncated = true;
      return;
    }
    const line = args.map(serializeArg).join(' ');
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (totalBytes + lineBytes > maxBytes) {
      truncated = true;
      return;
    }
    totalBytes += lineBytes;
    if (target.length < maxLines) {
      target.push(line);
    }
  }

  const capturer = {
    log: (...args) => append(stdout, args),
    info: (...args) => append(stdout, args),
    debug: (...args) => append(stdout, args),
    warn: (...args) => append(stderr, args),
    error: (...args) => append(stderr, args),
    _stdout: stdout,
    _stderr: stderr,
    _truncated: () => truncated,
  };

  return capturer;
}

// -- Sandbox creation --------------------------------------------------------

/**
 * Build a plain object that will serve as the global object inside the vm
 * context. Includes whitelisted built-ins, captured console, and any
 * explicitly-provided modules. The resulting object is suitable for passing
 * to `vm.runInNewContext`.
 *
 * @param {object}   [options]
 * @param {object}   [options.modules]       map of module-name -> module-exports to inject
 * @param {object}   [options.globals]       extra globals to expose
 * @param {object}   [options.consoleOpts]   options forwarded to captureOutput
 * @returns {object}
 */
function createSandbox(options = {}) {
  const sandbox = Object.create(null);

  // Copy whitelisted globals
  for (const [key, value] of Object.entries(WHITELISTED_GLOBALS)) {
    if (value !== undefined) {
      sandbox[key] = value;
    }
  }

  // Explicitly null out blocked globals so any access returns undefined
  for (const key of BLOCKED_GLOBALS) {
    sandbox[key] = undefined;
  }

  // Captured console
  sandbox.console = captureOutput(options.consoleOpts);

  // Injected modules
  if (options.modules && typeof options.modules === 'object') {
    for (const [name, mod] of Object.entries(options.modules)) {
      if (BLOCKED_GLOBALS.has(name)) continue;
      sandbox[name] = mod;
    }
  }

  // Extra globals (overrides anything above)
  if (options.globals && typeof options.globals === 'object') {
    for (const [key, value] of Object.entries(options.globals)) {
      if (BLOCKED_GLOBALS.has(key)) continue;
      sandbox[key] = value;
    }
  }

  return sandbox;
}

// -- Execution ---------------------------------------------------------------

/**
 * Run JavaScript code inside a fresh vm context created from the supplied
 * sandbox object. This is a **synchronous** call — the timeout option on
 * `vm.runInNewContext` will interrupt infinite loops.
 *
 * @param {string} code      JavaScript source code to execute
 * @param {object} sandbox   the sandbox object (from createSandbox)
 * @param {number} [timeoutMs]  execution timeout in ms (default: 30 000)
 * @returns {{ result: any, output: { stdout: string[], stderr: string[] }, cpuUsage: object, memoryDelta: number, timedOut: boolean }}
 * @throws {object}  thrown object has shape { message, code, output, cpuUsage, memoryDelta, timedOut }
 */
function runInSandbox(code, sandbox, timeoutMs = 30_000) {
  if (typeof code !== 'string') {
    throw Object.assign(new Error('Code must be a non-empty string'), {
      code: 'SANDBOX_INVALID_CODE',
    });
  }

  const timeout = safePositiveInt(timeoutMs, 30_000);
  const memBefore = process.memoryUsage();
  const cpuStart = process.cpuUsage();

  let result;
  let timedOut = false;

  try {
    result = vm.runInNewContext(code, sandbox, {
      timeout,
      displayErrors: true,
      filename: 'sandbox.js',
      breakOnSigint: true,
    });
  } catch (err) {
    const memAfter = process.memoryUsage();
    const cpuDelta = process.cpuUsage(cpuStart);
    const isTimeout =
      err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
      (err.message && err.message.includes('timed out'));

    const enriched = {
      message: err.message,
      code: isTimeout ? 'SANDBOX_TIMEOUT' : (err.code || 'SANDBOX_ERROR'),
      output: extractOutput(sandbox),
      cpuUsage: cpuDelta,
      memoryDelta: memAfter.heapUsed - memBefore.heapUsed,
      timedOut: isTimeout,
    };
    throw enriched;
  }

  const memAfter = process.memoryUsage();
  const cpuDelta = process.cpuUsage(cpuStart);

  return {
    result,
    output: extractOutput(sandbox),
    cpuUsage: cpuDelta,
    memoryDelta: memAfter.heapUsed - memBefore.heapUsed,
    timedOut,
  };
}

// -- Helpers -----------------------------------------------------------------

function extractOutput(sandbox) {
  const con = sandbox && sandbox.console;
  if (!con) return { stdout: [], stderr: [], truncated: false };
  return {
    stdout: Array.isArray(con._stdout) ? con._stdout.slice() : [],
    stderr: Array.isArray(con._stderr) ? con._stderr.slice() : [],
    truncated: typeof con._truncated === 'function' ? con._truncated() : false,
  };
}

function serializeArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safePositiveInt(value, fallback) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  return fallback;
}

// ---------------------------------------------------------------------------

module.exports = { createSandbox, runInSandbox, captureOutput, WHITELISTED_GLOBALS, BLOCKED_GLOBALS };
