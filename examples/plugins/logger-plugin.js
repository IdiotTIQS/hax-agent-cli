"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Logger Plugin — Logs all tool calls, errors, chat events, and session
 * lifecycle events to `.hax-agent/logs/plugin.log`.
 *
 * Install:
 *   Copy this file to `.hax-agent/plugins/` and restart the agent.
 *
 * The log file is created automatically and entries are appended with
 * ISO-8601 timestamps.  Log rotation is *not* included — the file grows
 * indefinitely; purge it manually when it gets too large.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _logStream = null;

/**
 * Resolve the project root from the session or fall back to cwd.
 * We look for `.hax-agent/` so the log lands inside the project's own agent
 * metadata directory rather than somewhere in the home folder.
 */
function resolveProjectRoot(session) {
  if (session && typeof session.cwd === "string" && session.cwd.length > 0) {
    return session.cwd;
  }
  return process.cwd();
}

/**
 * Lazily open (or reopen) the append-only log stream.
 */
function getLogStream(session) {
  const root = resolveProjectRoot(session);
  const dir = path.join(root, ".hax-agent", "logs");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "plugin.log");

  // If the stream already points to a different file, close it first.
  if (_logStream && _logStream.path !== filePath) {
    _logStream.end();
    _logStream = null;
  }

  if (!_logStream) {
    _logStream = fs.createWriteStream(filePath, { flags: "a" });
  }

  return _logStream;
}

/**
 * Write a structured JSON log line (one entry per line → easy to grep / jq).
 */
function writeLogEntry(session, level, hook, data) {
  try {
    const stream = getLogStream(session);
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      hook,
      ...data,
    });
    stream.write(entry + "\n");
  } catch (_err) {
    // Swallow logging errors — we must never crash the host process.
  }
}

/**
 * Safely serialise an object for logging.  Truncates long strings and removes
 * circular references so the JSON line stays readable.
 */
function safe(obj, maxLen) {
  if (maxLen === undefined) maxLen = 500;
  try {
    const seen = new WeakSet();
    const s = JSON.stringify(obj, function replacer(_key, val) {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      if (typeof val === "string" && val.length > maxLen) {
        return val.slice(0, maxLen) + "…";
      }
      if (val instanceof Error) {
        return { message: val.message, name: val.name, stack: val.stack };
      }
      return val;
    });
    // Parse back so we can spread it into the entry.
    return JSON.parse(s);
  } catch (_err) {
    return { _serializeError: "Could not serialize value" };
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function onBeforeToolCall(ctx) {
  writeLogEntry(ctx.session, "info", "beforeToolCall", {
    toolName: ctx.toolName || "unknown",
    args: safe(ctx.args),
  });
  return ctx;
}

function onAfterToolCall(ctx) {
  const ok = !!(ctx.result && ctx.result.ok);
  writeLogEntry(ctx.session, ok ? "info" : "warn", "afterToolCall", {
    toolName: ctx.toolName || "unknown",
    ok,
    durationMs: (ctx.result && ctx.result.durationMs) || null,
    error: !ok ? safe(ctx.result && ctx.result.error) : undefined,
  });
  return ctx;
}

function onError(ctx) {
  writeLogEntry(ctx.session, "error", "onError", {
    toolName: ctx.toolName || "unknown",
    pluginName: ctx.pluginName || null,
    hookName: ctx.hookName || null,
    error: safe(ctx.error),
  });
  return ctx;
}

function onBeforeChat(ctx) {
  writeLogEntry(ctx.session, "info", "beforeChat", {
    messagePreview: safe(ctx.message, 200),
  });
  return ctx;
}

function onAfterChat(ctx) {
  writeLogEntry(ctx.session, "info", "afterChat", {
    messagePreview: safe(ctx.message, 200),
    responsePreview: safe(ctx.response, 200),
  });
  return ctx;
}

function onSessionStart(ctx) {
  writeLogEntry(ctx.session, "info", "onSessionStart", {
    sessionId: (ctx.session && ctx.session.id) || null,
    cwd: resolveProjectRoot(ctx.session),
  });
  return ctx;
}

function onSessionEnd(ctx) {
  writeLogEntry(ctx.session, "info", "onSessionEnd", {
    sessionId: (ctx.session && ctx.session.id) || null,
  });

  // Flush and close the stream so the last log lines are not lost.
  if (_logStream) {
    try {
      _logStream.end();
    } catch (_err) { /* ignore */ }
    _logStream = null;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Plugin descriptor
// ---------------------------------------------------------------------------

const LoggerPlugin = {
  name: "logger-plugin",
  version: "1.0.0",

  hooks: {
    beforeToolCall: onBeforeToolCall,
    afterToolCall: onAfterToolCall,
    onError,
    beforeChat: onBeforeChat,
    afterChat: onAfterChat,
    onSessionStart,
    onSessionEnd,
  },
};

/**
 * Convenience: if loaded directly via `require()`, auto-register with the
 * provided PluginRegistry instance.
 *
 *   const { PluginRegistry } = require('./src/plugins');
 *   const registry = new PluginRegistry();
 *   require('./examples/plugins/logger-plugin').register(registry);
 */
function register(registry) {
  registry.register(LoggerPlugin);
}

module.exports = LoggerPlugin;
module.exports.register = register;
