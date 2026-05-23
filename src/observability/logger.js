"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const LEVEL_LABELS = Object.freeze({
  10: "debug",
  20: "info",
  30: "warn",
  40: "error",
});

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "apikey",
  "api_key",
  "token",
  "password",
  "passwd",
  "secret",
  "authorization",
  "auth",
  "credential",
  "privateKey",
  "private_key",
]);

const REDACTED_VALUE = "[REDACTED]";

// Provider API key patterns for value-level redaction
const API_KEY_PATTERNS = [
  /sk-ant-api[0-9]{2}-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
];

function buildTimestamp() {
  return new Date().toISOString();
}

class Logger {
  constructor(options = {}) {
    this.level = resolveLevel(options.level || (process.env.LOG_LEVEL || "info"));
    this.sessionId = options.sessionId || "default";
    this.output = options.output || "stderr";
    this.filePath = options.filePath || null;
    this.fd = null;

    if (this.output === "file" || this.output === "both") {
      if (!this.filePath) {
        throw new TypeError("Logger file output requires a filePath option.");
      }
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.fd = fs.openSync(this.filePath, "a");
    }
  }

  debug(message, data = {}) {
    this._log("debug", message, data);
  }

  info(message, data = {}) {
    this._log("info", message, data);
  }

  warn(message, data = {}) {
    this._log("warn", message, data);
  }

  error(message, data = {}) {
    this._log("error", message, data);
  }

  child(bindings = {}) {
    const childLogger = new Logger({
      level: LEVEL_LABELS[this.level],
      sessionId: this.sessionId,
      output: this.output,
      filePath: this.filePath,
    });
    childLogger._bindings = { ...this._bindings, ...bindings };
    childLogger.fd = this.fd;
    return childLogger;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  _log(levelName, message, data = {}) {
    if (LEVELS[levelName] < this.level) {
      return;
    }

    const entry = {
      timestamp: buildTimestamp(),
      level: levelName,
      sessionId: this.sessionId,
      message: String(message),
      ...this._bindings,
      ...redactSensitiveData(data),
    };

    const line = JSON.stringify(entry) + "\n";

    if (this.output === "stdout" || this.output === "both") {
      process.stderr.write(line);
    }

    if ((this.output === "file" || this.output === "both") && this.fd !== null) {
      fs.writeSync(this.fd, line);
    }
  }
}

function createLogger(options = {}) {
  return new Logger(options);
}

function resolveLevel(raw) {
  if (typeof raw === "number" && raw >= 10 && raw <= 40) {
    return raw;
  }
  const normalized = String(raw).toLowerCase().trim();
  if (LEVELS.hasOwnProperty(normalized)) {
    return LEVELS[normalized];
  }
  return LEVELS.info;
}

function redactApiKeyFromString(str) {
  let result = str;
  for (const pattern of API_KEY_PATTERNS) {
    result = result.replace(pattern, REDACTED_VALUE);
  }
  return result;
}

function redactSensitiveData(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj !== "object") {
    // Scan scalar strings for API key patterns
    if (typeof obj === "string") {
      return redactApiKeyFromString(obj);
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lowerKey) ||
      [...SENSITIVE_KEYS].some((sk) => lowerKey.includes(sk.toLowerCase()));
    if (isSensitive && typeof value === "string" && value.length > 0) {
      result[key] = REDACTED_VALUE;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveData(value);
    } else if (typeof value === "string") {
      result[key] = redactApiKeyFromString(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = { Logger, createLogger, LEVELS, LEVEL_LABELS };
