"use strict";

/**
 * Middleware functions that wrap or augment the EventBus emit pipeline.
 *
 * Each middleware factory returns a function with the signature:
 *   (event: string, data: any, next: (event, data) => void) => void
 *
 * The `applyMiddleware` helper creates a decorated bus where every emit/emitAsync
 * passes through the middleware chain before reaching the original bus.
 */

/**
 * Create a middleware that logs every event passing through the bus.
 *
 * @param {object} logger - Logger with a `.info(msg, meta)` method
 * @returns {Function} Middleware function
 */
function createLoggingMiddleware(logger) {
  if (!logger || typeof logger.info !== "function") {
    throw new Error("Logger must have an info() method");
  }

  return function loggingMiddleware(event, data, next) {
    const start = Date.now();
    next(event, data);
    logger.info("event emitted", {
      event,
      durationMs: Date.now() - start,
      hasData: data !== undefined && data !== null,
    });
  };
}

/**
 * Create a middleware that increments a metric counter for each event.
 *
 * @param {object} metrics - Metrics registry with a `.counter(name, help)` method
 *                           that returns an object with `.inc()`.
 * @returns {Function} Middleware function
 */
function createMetricsMiddleware(metrics) {
  if (!metrics || typeof metrics.counter !== "function") {
    throw new Error("Metrics must have a counter() method");
  }

  /** @type {Map<string, object>} */
  const counters = new Map();

  function getCounter(event) {
    let c = counters.get(event);
    if (!c) {
      c = metrics.counter(`events.${event}.total`, `Count of ${event} events emitted`);
      counters.set(event, c);
    }
    return c;
  }

  return function metricsMiddleware(event, data, next) {
    try {
      const c = getCounter(event);
      c.inc();
    } catch (_err) {
      // Best-effort metrics — never fail the pipeline
    }
    next(event, data);
  };
}

/**
 * Create a middleware that throttles high-frequency events.  Events of the
 * specified type that arrive within `minIntervalMs` of the previous one are
 * silently dropped.
 *
 * @param {string} event - Event name or wildcard pattern to throttle
 * @param {number} minIntervalMs - Minimum interval between deliveries (ms)
 * @returns {Function} Middleware function
 */
function createThrottleMiddleware(event, minIntervalMs) {
  if (typeof event !== "string" || event.length === 0) {
    throw new Error("Event name must be a non-empty string");
  }
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error("minIntervalMs must be a non-negative number");
  }

  let lastEmit = 0;

  return function throttleMiddleware(evt, data, next) {
    if (evt !== event) {
      next(evt, data);
      return;
    }

    const now = Date.now();
    if (now - lastEmit < minIntervalMs) {
      return; // Drop the event
    }

    lastEmit = now;
    next(evt, data);
  };
}

/**
 * Create a middleware that filters events.  Only events for which the
 * predicate returns true are passed through.
 *
 * The predicate receives (event, data).
 *
 * @param {Function} predicate - (event: string, data: any) => boolean
 * @returns {Function} Middleware function
 */
function createFilterMiddleware(predicate) {
  if (typeof predicate !== "function") {
    throw new Error("Predicate must be a function");
  }

  return function filterMiddleware(event, data, next) {
    if (predicate(event, data)) {
      next(event, data);
    }
    // Otherwise silently drop
  };
}

/**
 * Create a middleware that times out slow synchronous handlers.  If the
 * `next()` call exceeds `ms` milliseconds a warning is logged via the
 * provided logger.
 *
 * Note: This middleware uses a busy-wait approximation because synchronous
 * handlers cannot truly be interrupted from outside.  As a result it only
 * *reports* slow handlers rather than aborting them.  For real timeouts
 * combine with emitAsync where possible.
 *
 * @param {number} ms - Timeout threshold in milliseconds
 * @param {object} [logger] - Logger with a `.warn()` method (defaults to stderr)
 * @returns {Function} Middleware function
 */
function createTimeoutMiddleware(ms, logger) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("ms must be a positive number");
  }

  const log = logger && typeof logger.warn === "function"
    ? logger
    : { warn: (msg, meta) => process.stderr.write(`[timeout-warn] ${msg} ${JSON.stringify(meta)}\n`) };

  return function timeoutMiddleware(event, data, next) {
    const start = Date.now();
    next(event, data);
    const elapsed = Date.now() - start;

    if (elapsed > ms) {
      log.warn("slow event handler", {
        event,
        elapsedMs: elapsed,
        thresholdMs: ms,
      });
    }
  };
}

/**
 * Create a new bus that wraps the original bus's emit/emitAsync methods
 * with a chain of middlewares. Each middleware has the signature:
 *   (event, data, next) => void
 * where `next` is the next middleware in the chain (or the original emit).
 *
 * @param {import('./bus').EventBus} bus - The EventBus instance to wrap
 * @param {...Function} middlewares - Middleware functions
 * @returns {import('./bus').EventBus} A proxy-like bus with middleware applied
 */
function applyMiddleware(bus, ...middlewares) {
  if (!bus || typeof bus.emit !== "function") {
    throw new Error("bus must be an EventBus instance");
  }

  // Build the chain: the innermost function is the original bus.emit
  function buildChain(original) {
    let chain = original;
    // Apply middlewares from right to left so the first one in the list
    // is the outermost wrapper.
    for (let i = middlewares.length - 1; i >= 0; i -= 1) {
      const middleware = middlewares[i];
      const prev = chain;
      chain = (event, data) => {
        middleware(event, data, (evt, d) => prev(evt, d));
      };
    }
    return chain;
  }

  const emitChain = buildChain((event, data) => bus.emit(event, data));

  // For emitAsync we build a parallel chain.
  const emitAsyncChain = buildChain((event, data) => bus.emitAsync(event, data));

  return Object.assign(Object.create(Object.getPrototypeOf(bus)), bus, {
    emit(event, data) {
      return emitChain(event, data);
    },
    emitAsync(event, data) {
      return emitAsyncChain(event, data);
    },
  });
}

module.exports = {
  createLoggingMiddleware,
  createMetricsMiddleware,
  createThrottleMiddleware,
  createFilterMiddleware,
  createTimeoutMiddleware,
  applyMiddleware,
};
