"use strict";

const { debug } = require('./debug');

/**
 * Graceful shutdown manager.
 *
 * Registers cleanup hooks that run on SIGINT, SIGTERM, and process
 * exit. Orders hooks by priority (lower runs first). Ensures all
 * hooks have a chance to run within a configurable timeout.
 */

const PRIORITY = {
  SAVE_STATE: 0,
  CLOSE_STREAMS: 10,
  RELEASE_LOCKS: 20,
  NOTIFY: 30,
  LOG: 40,
};

let _instance = null;

class ShutdownManager {
  constructor(options = {}) {
    this._hooks = [];
    this._timeoutMs = positiveInteger(options.timeoutMs, 5000);
    this._shuttingDown = false;
    this._signals = new Set();
    this._boundHandlers = {};
    this._onShutdownComplete = options.onShutdownComplete || null;

    this._registerSignals();
  }

  /**
   * Register a cleanup hook.
   * @param {string} name - Hook name for logging
   * @param {number} priority - Lower runs first (use PRIORITY constants)
   * @param {Function} fn - Cleanup function, can be sync or async
   * @param {object} [options]
   * @param {boolean} [options.once=true] - Remove after first run
   */
  register(name, priority, fn, options = {}) {
    this._hooks.push({
      name,
      priority,
      fn,
      once: options.once !== false,
    });

    this._hooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister all hooks with a given name.
   * @param {string} name
   */
  unregister(name) {
    this._hooks = this._hooks.filter((h) => h.name !== name);
  }

  /**
   * Trigger shutdown. Runs all registered hooks sequentially.
   * @param {object} [options]
   * @param {string} [options.reason='manual'] - Reason for shutdown
   * @param {number} [options.exitCode=0] - Process exit code
   * @returns {Promise<void>}
   */
  async shutdown(options = {}) {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    try {
      await this._runShutdownHooks(options);
    } finally {
      // Allow re-entry for testing / persistent hooks; process.exit()
      // is the real termination gate, not the flag.
      this._shuttingDown = false;
    }
  }

  async _runShutdownHooks(options = {}) {
    const reason = options.reason || 'manual';
    const exitCode = options.exitCode !== undefined ? options.exitCode : 0;

    debug('shutdown', `Shutting down: ${reason}`);

    const hooks = [...this._hooks];
    const errors = [];

    for (const hook of hooks) {
      try {
        debug('shutdown', `Running hook: ${hook.name} (priority=${hook.priority})`);

        const result = hook.fn({ reason, exitCode });
        if (result && typeof result.then === 'function') {
          await timeout(result, this._timeoutMs, `shutdown hook "${hook.name}" timed out`);
        }
      } catch (error) {
        debug('shutdown', `Hook "${hook.name}" failed: ${error.message}`);
        errors.push({ name: hook.name, error: error.message });
      }

      if (hook.once) {
        this.unregister(hook.name);
      }
    }

    if (errors.length > 0) {
      debug('shutdown', `Shutdown completed with ${errors.length} hook error(s)`);
    }

    if (this._onShutdownComplete) {
      try {
        this._onShutdownComplete({ reason, exitCode, errors });
      } catch (_) {
        // suppress errors in the completion callback
      }
    }

    if (options.exitCode !== undefined && options.exitProcess !== false) {
      process.exit(exitCode);
    }
  }

  /**
   * Shutdown on a signal. Set via registerSignal.
   */
  signalShutdown(signal) {
    this._signals.add(signal);
    this.shutdown({ reason: `signal:${signal}`, exitCode: 128 + signalToCode(signal) });
  }

  get isShuttingDown() {
    return this._shuttingDown;
  }

  get hookCount() {
    return this._hooks.length;
  }

  _registerSignals() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

    for (const signal of signals) {
      this._boundHandlers[signal] = () => {
        // Allow first SIGINT through for interactive cancellation,
        // second forces shutdown
        if (signal === 'SIGINT') {
          const previous = process.listenerCount(signal);
          if (previous > 1) {
            // let the default/other handler process first SIGINT
          }
        }

        this.signalShutdown(signal);
      };

      try {
        process.on(signal, this._boundHandlers[signal]);
      } catch (_) {
        // signal handling not available (e.g., Windows terminal quirks)
      }
    }

    // Process exit cleanup for uncaught exceptions
    this._boundHandlers['uncaughtException'] = (error) => {
      debug('shutdown', `Uncaught exception: ${error.message}`);
      this.shutdown({ reason: 'uncaughtException', exitCode: 1 });
    };

    process.on('uncaughtException', this._boundHandlers['uncaughtException']);

    // Unhandled rejection
    this._boundHandlers['unhandledRejection'] = (reason) => {
      debug('shutdown', `Unhandled rejection: ${reason}`);
      // Don't exit, but log. The process will continue.
    };

    process.on('unhandledRejection', this._boundHandlers['unhandledRejection']);

    // Before exit — last chance cleanup
    this._boundHandlers['beforeExit'] = (code) => {
      if (!this._shuttingDown && code !== 0) {
        this.shutdown({ reason: `beforeExit:${code}`, exitCode: code, exitProcess: false });
      }
    };

    process.on('beforeExit', this._boundHandlers['beforeExit']);
  }

  /**
   * Remove all signal handlers. Use for testing.
   */
  detach() {
    for (const [signal, handler] of Object.entries(this._boundHandlers)) {
      try {
        process.off(signal, handler);
      } catch (_) {
        // ignore
      }
    }

    this._boundHandlers = {};
    this._hooks = [];
  }
}

/**
 * Get or create the singleton ShutdownManager.
 * @param {object} [options]
 * @returns {ShutdownManager}
 */
function getShutdownManager(options = {}) {
  if (!_instance) {
    _instance = new ShutdownManager(options);
  }
  return _instance;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function signalToCode(signal) {
  const codes = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
  return codes[signal] || 0;
}

async function timeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

module.exports = {
  ShutdownManager,
  getShutdownManager,
  PRIORITY,
};
