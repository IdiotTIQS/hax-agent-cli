/**
 * Notification channel implementations.
 *
 * Each channel accepts a Notification object and delivers it through
 * a specific transport: desktop toast, log file, webhook POST,
 * user callback, or a composite that fans out to many channels.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ---- Notification schema ---------------------------------------------------

/**
 * Create a well-formed notification object.
 *
 * @param {object} options
 * @param {string} options.type      - Event type (e.g. "task.complete", "task.error")
 * @param {string} [options.title]   - Short summary
 * @param {string} [options.message] - Detailed body
 * @param {'info'|'warn'|'error'|'critical'} [options.severity='info']
 * @param {number} [options.timestamp] - Epoch ms (defaults to now)
 * @param {*}      [options.data]      - Arbitrary payload
 * @param {string} [options.source]    - Originating module / agent id
 * @returns {object}
 */
function createNotification(options = {}) {
  return Object.freeze({
    type: String(options.type || "generic"),
    title: String(options.title || ""),
    message: String(options.message || ""),
    severity: normalizeSeverity(options.severity),
    timestamp: Number.isSafeInteger(options.timestamp) ? options.timestamp : Date.now(),
    data: options.data !== undefined ? options.data : null,
    source: String(options.source || "haxagent"),
  });
}

function normalizeSeverity(value) {
  const valid = new Set(["info", "warn", "error", "critical"]);
  const lowered = String(value || "info").toLowerCase();
  return valid.has(lowered) ? lowered : "info";
}

// ---- Optional node-notifier loader -----------------------------------------

let nodeNotifier = null;
try {
  // eslint-disable-next-line node/no-missing-require
  nodeNotifier = require("node-notifier");
} catch (_) {
  // node-notifier is optional; fall back to stdout on missing / unsupported OS
}

// ---- DesktopChannel --------------------------------------------------------

/**
 * Sends OS-level desktop notifications.
 *
 * When `node-notifier` is available it is used for native toast
 * notifications. Otherwise the notification content is written to
 * stdout so the process runner still sees it.
 */
class DesktopChannel {
  /**
   * @param {object} [options]
   * @param {string} [options.appName='HaxAgent'] - Application name for the toast
   * @param {boolean} [options.fallbackToStdout=true] - Print to stdout when notifier unavailable
   */
  constructor(options = {}) {
    this._appName = options.appName || "HaxAgent";
    this._fallbackToStdout = options.fallbackToStdout !== false;
  }

  /**
   * Deliver a notification to the desktop.
   * @param {object} notification
   * @returns {Promise<void>}
   */
  async send(notification) {
    const n = this._normalize(notification);

    if (nodeNotifier) {
      return new Promise((resolve) => {
        nodeNotifier.notify(
          {
            title: n.title,
            message: n.message,
            sound: n.severity === "error" || n.severity === "critical",
            wait: false,
          },
          (err) => {
            if (err) {
              // Fallback on delivery error
              if (this._fallbackToStdout) {
                this._writeToStdout(n);
              }
            }
            resolve();
          }
        );
      });
    }

    if (this._fallbackToStdout) {
      this._writeToStdout(n);
    }

    return Promise.resolve();
  }

  /**
   * Validate channel configuration.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (!this._appName || typeof this._appName !== "string") {
      errors.push("appName must be a non-empty string");
    }
    return { valid: errors.length === 0, errors };
  }

  /** @private */
  _normalize(notification) {
    return createNotification(notification);
  }

  /** @private */
  _writeToStdout(n) {
    const prefix = severityPrefix(n.severity);
    process.stdout.write(
      `[${prefix} NOTIFICATION] ${n.title}\n${n.message ? `  ${n.message}\n` : ""}`
    );
  }
}

// ---- FileChannel -----------------------------------------------------------

/**
 * Appends notification events as JSON lines to a log file.
 */
class FileChannel {
  /**
   * @param {object} options
   * @param {string} options.filePath - Absolute path to the notification log file
   * @param {boolean} [options.createDir=true] - Create parent directories if missing
   */
  constructor(options = {}) {
    this._filePath = options.filePath || "";
    this._createDir = options.createDir !== false;
  }

  /**
   * Append a notification to the log file.
   * @param {object} notification
   * @returns {Promise<void>}
   */
  async send(notification) {
    const n = createNotification(notification);
    const line = JSON.stringify(n) + "\n";

    if (this._createDir && this._filePath) {
      const dir = path.dirname(this._filePath);
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(this._filePath, line, "utf8");
  }

  /**
   * Validate channel configuration.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (!this._filePath || typeof this._filePath !== "string") {
      errors.push("filePath must be a non-empty string");
      return { valid: false, errors };
    }

    try {
      const dir = path.dirname(this._filePath);
      if (this._createDir) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Test writability
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (err) {
      errors.push(`filePath directory is not writable: ${err.message}`);
    }

    return { valid: errors.length === 0, errors };
  }
}

// ---- WebhookChannel --------------------------------------------------------

/**
 * POSTs a JSON payload to a webhook URL.
 *
 * Uses built-in `http`/`https` modules so there are no package dependencies.
 */
class WebhookChannel {
  /**
   * @param {object} options
   * @param {string} options.url - Webhook URL (http or https)
   * @param {object} [options.headers] - Extra HTTP headers
   * @param {number} [options.timeoutMs=5000] - Request timeout in ms
   * @param {Function} [options.httpTransport] - Injectable transport (for testing)
   */
  constructor(options = {}) {
    this._url = options.url || "";
    this._headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    this._timeoutMs = positiveInteger(options.timeoutMs, 5000);
    this._transport = options.httpTransport || null;
  }

  /**
   * POST the notification to the configured webhook.
   * @param {object} notification
   * @returns {Promise<void>}
   */
  async send(notification) {
    const n = createNotification(notification);
    return this._doPost(this._url, n);
  }

  /**
   * Validate channel configuration.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (!this._url || typeof this._url !== "string") {
      errors.push("url must be a non-empty string");
    } else {
      try {
        const parsed = new URL(this._url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          errors.push("url must use http or https protocol");
        }
      } catch (_) {
        errors.push("url is not a valid URL");
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /** @private */
  _doPost(url, payload) {
    const transport = this._transport || defaultTransport;
    return transport(url, {
      method: "POST",
      headers: this._headers,
      body: JSON.stringify(payload),
      timeoutMs: this._timeoutMs,
    });
  }
}

/**
 * Default HTTP transport — uses node:http / node:https.
 * @param {string} url
 * @param {object} options
 * @returns {Promise<void>}
 */
function defaultTransport(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? require("node:https") : require("node:http");

    const req = lib.request(
      url,
      {
        method: options.method,
        headers: options.headers,
        timeout: options.timeoutMs,
      },
      (res) => {
        // Consume response body to free the socket
        res.resume();
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Webhook responded with HTTP ${res.statusCode}`));
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Webhook request timed out after ${options.timeoutMs}ms`));
    });

    req.write(options.body);
    req.end();
  });
}

// ---- CallbackChannel -------------------------------------------------------

/**
 * Invokes a user-provided callback with each notification.
 *
 * Useful for wiring notifications into existing logging infrastructure,
 * metrics, or custom alerting pipelines.
 */
class CallbackChannel {
  /**
   * @param {object} options
   * @param {Function} options.callback - Called as `callback(notification)`
   * @param {boolean} [options.async=true] - Await the returned promise if true
   */
  constructor(options = {}) {
    this._callback = options.callback || null;
    this._async = options.async !== false;
  }

  /**
   * Deliver a notification to the callback.
   * @param {object} notification
   * @returns {Promise<void>}
   */
  async send(notification) {
    if (typeof this._callback !== "function") {
      return;
    }

    const n = createNotification(notification);

    if (this._async) {
      await this._callback(n);
    } else {
      this._callback(n);
    }
  }

  /**
   * Validate channel configuration.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (typeof this._callback !== "function") {
      errors.push("callback must be a function");
    }
    return { valid: errors.length === 0, errors };
  }
}

// ---- CompositeChannel ------------------------------------------------------

/**
 * Fans out a single notification to multiple child channels.
 *
 * Delivery to each child is attempted independently; failures in one
 * channel do not prevent delivery to others.
 */
class CompositeChannel {
  /**
   * @param {object} [options]
   * @param {Array<object>} [options.channels] - Child channel instances
   */
  constructor(options = {}) {
    this._channels = Array.isArray(options.channels) ? [...options.channels] : [];
  }

  /**
   * Add a child channel.
   * @param {object} channel - Channel instance (must have `send` method)
   */
  add(channel) {
    this._channels.push(channel);
  }

  /**
   * Remove a child channel by reference.
   * @param {object} channel
   * @returns {boolean} true if removed
   */
  remove(channel) {
    const idx = this._channels.indexOf(channel);
    if (idx === -1) return false;
    this._channels.splice(idx, 1);
    return true;
  }

  /**
   * Number of child channels.
   * @returns {number}
   */
  get size() {
    return this._channels.length;
  }

  /**
   * Send the notification to every child channel.
   * Errors are collected but do not stop the fan-out.
   * @param {object} notification
   * @returns {Promise<{ delivered: number, errors: Array<{channel: number, error: string}> }>}
   */
  async send(notification) {
    const n = createNotification(notification);
    const results = await Promise.allSettled(
      this._channels.map((ch) => ch.send(n))
    );

    const errors = [];
    let delivered = 0;

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        delivered += 1;
      } else {
        errors.push({ channel: i, error: results[i].reason.message || String(results[i].reason) });
      }
    }

    return { delivered, errors };
  }

  /**
   * Validate all child channels.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (this._channels.length === 0) {
      errors.push("CompositeChannel has no child channels");
    }
    for (let i = 0; i < this._channels.length; i++) {
      const child = this._channels[i];
      if (typeof child.validate === "function") {
        const result = child.validate();
        if (!result.valid) {
          for (const err of result.errors) {
            errors.push(`channel[${i}]: ${err}`);
          }
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

// ---- Helpers ---------------------------------------------------------------

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function severityPrefix(severity) {
  switch (severity) {
    case "critical": return "CRITICAL";
    case "error": return "ERROR";
    case "warn": return "WARN";
    default: return "INFO";
  }
}

// ---- Exports ---------------------------------------------------------------

module.exports = {
  createNotification,
  DesktopChannel,
  FileChannel,
  WebhookChannel,
  CallbackChannel,
  CompositeChannel,
};
