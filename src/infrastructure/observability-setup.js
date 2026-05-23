"use strict";

const path = require("node:path");
const os = require("node:os");

// Module-level singletons — set by setupObservability() and read by getters.
let _logger = null;
let _metrics = null;
let _tracer = null;

/**
 * Bootstrap the observability subsystem.
 *
 * @param {object} [options]
 * @param {string} [options.logLevel]        - override log level (default: "info" or "debug" when HAX_AGENT_DEBUG is set)
 * @param {string} [options.sessionId]       - session id for logger bindings (default: "default")
 * @param {string} [options.output]          - logger output: "stderr" | "file" | "both" (default: "stderr")
 * @param {string} [options.filePath]        - log file path (when output is "file" or "both")
 * @param {string} [options.logDir]          - directory for debug log files (default: os.tmpdir()/haxagent-logs)
 * @param {string} [options.serviceName]     - tracer service name (default: "haxagent")
 * @returns {{ logger: object, metrics: object, tracer: object }}
 */
function setupObservability(options = {}) {
  // Lazy-require so tree-shakers / bundlers don't force the dependency.
  const { Logger } = require("../observability/logger");
  const { MetricsRegistry } = require("../observability/metrics");
  const { Tracer } = require("../observability/tracer");

  const debugEnabled = !!process.env.HAX_AGENT_DEBUG;

  const loggerOptions = {
    level: options.logLevel || (debugEnabled ? "debug" : "info"),
    sessionId: options.sessionId || "default",
  };

  if (debugEnabled) {
    const logDir = options.logDir || path.join(os.tmpdir(), "haxagent-logs");
    loggerOptions.output = "both";
    loggerOptions.filePath = path.join(logDir, `agent-${Date.now()}.log`);
  } else {
    loggerOptions.output = options.output || "stderr";
    if (options.filePath) {
      loggerOptions.filePath = options.filePath;
    }
  }

  const logger = new Logger(loggerOptions);
  const metrics = new MetricsRegistry();
  const tracer = new Tracer({
    serviceName: options.serviceName || "haxagent",
  });

  _logger = logger;
  _metrics = metrics;
  _tracer = tracer;

  logger.info("observability.setup", {
    debug: debugEnabled,
    logLevel: loggerOptions.level,
    output: loggerOptions.output,
    serviceName: tracer.serviceName,
  });

  return { logger, metrics, tracer };
}

/**
 * Retrieve the global logger singleton.
 * Returns null before setupObservability() has been called.
 */
function getLogger() {
  return _logger;
}

/**
 * Retrieve the global MetricsRegistry singleton.
 * Returns null before setupObservability() has been called.
 */
function getMetrics() {
  return _metrics;
}

/**
 * Retrieve the global Tracer singleton.
 * Returns null before setupObservability() has been called.
 */
function getTracer() {
  return _tracer;
}

module.exports = { setupObservability, getLogger, getMetrics, getTracer };
