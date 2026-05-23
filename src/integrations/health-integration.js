"use strict";

/**
 * Health Integration Bridge
 *
 * Wires the orphan `src/health/monitor.js` (HealthMonitor) and
 * `src/health/visualizer.js` (HealthVisualizer) modules into the
 * session / agent lifecycle.
 *
 * Intent: attach continuous health monitoring to a HaxAgent session,
 * generate ANSI-rich health dashboards, and expose trend data for
 * display in CLI dashboards or export files.
 */

const { HealthMonitor } = require("../health/monitor");
const { HealthVisualizer } = require("../health/visualizer");

// ---------------------------------------------------------------------------
// attachHealthMonitor
// ---------------------------------------------------------------------------

/**
 * Attach a HealthMonitor to a HaxAgent session so that health checks
 * are automatically triggered at each session tick / turn.
 *
 * The returned object includes:
 *   - `monitor`    the HealthMonitor instance
 *   - `dispose()`  call to stop monitoring and clean up listeners
 *
 * @param {object} session
 *   The session object (must be an EventEmitter-like or have a `.on()` method).
 *   If the session is not an EventEmitter, the monitor is still created but
 *   must be driven manually via `check()`.
 * @param {object} [options]
 * @param {number} [options.intervalMs]         - polling interval (default 30000)
 * @param {boolean} [options.startImmediately]   - start monitoring now (default true)
 * @param {object} [options.initialMetrics]      - seed metrics
 * @param {object} [options.thresholds]          - override alert thresholds
 * @param {function} [options.metricCollector]   - async fn returning partial metrics to merge each tick
 * @returns {{ monitor: HealthMonitor, dispose: function }}
 */
function attachHealthMonitor(session, options) {
  const opts = options || {};

  const monitor = new HealthMonitor({
    maxHistory: opts.maxHistory || 1000,
    maxAlerts: opts.maxAlerts || 500,
    thresholds: opts.thresholds || undefined,
    initialMetrics: opts.initialMetrics || undefined,
  });

  const disposed = { value: false };
  let intervalId = null;

  /**
   * Run a single health check cycle, optionally collecting external metrics.
   */
  async function runCheck() {
    if (disposed.value) return;
    let metrics = {};
    if (typeof opts.metricCollector === "function") {
      try {
        metrics = await opts.metricCollector(session, monitor);
      } catch (_err) {
        // Collector error — skip this tick silently
      }
    }
    monitor.check(metrics);
  }

  // Wire session events when possible (turn:end triggers a check)
  if (session && typeof session.on === "function") {
    session.on("turn:end", () => {
      runCheck();
    });
  }

  if (opts.startImmediately !== false) {
    // Run an immediate check
    runCheck();

    // Start the interval loop (calls metricCollector on each tick too)
    const ms = opts.intervalMs || 30000;
    intervalId = setInterval(() => {
      runCheck();
    }, ms);
    if (intervalId && typeof intervalId === "object" && intervalId.unref) {
      intervalId.unref();
    }
  }

  return {
    monitor,

    /** Stop monitoring, remove listeners, and clean up. */
    dispose() {
      disposed.value = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// generateHealthDashboard
// ---------------------------------------------------------------------------

/**
 * Generate a rich-text (ANSI) health dashboard from a session's
 * HealthMonitor state, rendered via HealthVisualizer.
 *
 * @param {object} sessionOrMonitor
 *   Either a session object that has a `.healthMonitor` property, or a
 *   HealthMonitor instance directly.
 * @param {object} [options]
 * @param {number} [options.termWidth]        - terminal width in characters (default 80)
 * @param {boolean} [options.includeTrends]    - include sparkline trends for each dimension (default true)
 * @param {boolean} [options.includeHistory]   - include history summary (default true)
 * @param {boolean} [options.ansiColors]       - enable ANSI colors (default true)
 * @returns {{ dashboard: string, status: object, trends: object }}
 */
function generateHealthDashboard(sessionOrMonitor, options) {
  const opts = options || {};
  const termWidth = opts.termWidth || 80;

  // Resolve the monitor
  let monitor;
  if (sessionOrMonitor && typeof sessionOrMonitor.check === "function") {
    // Already a monitor instance
    monitor = sessionOrMonitor;
  } else if (sessionOrMonitor && typeof sessionOrMonitor.healthMonitor === "object") {
    monitor = sessionOrMonitor.healthMonitor;
  } else {
    throw new TypeError(
      "sessionOrMonitor must be a HealthMonitor instance or an object with a .healthMonitor property",
    );
  }

  const status = monitor.getStatus();
  const visualizer = new HealthVisualizer({
    termWidth,
    showColor: opts.ansiColors !== false,
  });

  const dashboard = visualizer.renderDashboard(status);

  // Build per-dimension trend data
  const trends = {};
  if (opts.includeTrends !== false) {
    const history = monitor.getHistory({ limit: 50 });
    const dims = ["codeHealth", "testCoverage", "debtRatio", "docCoverage", "dependencyHealth"];
    for (const dim of dims) {
      trends[dim] = visualizer.renderTrend(dim, history, {
        width: Math.min(40, termWidth - 14),
        showLabel: true,
        showStats: true,
      });
    }
  }

  return {
    dashboard,
    status: {
      overallScore: status.overallScore,
      grade: status.grade,
      monitoring: status.monitoring,
      alerts: status.alerts,
      dimensions: status.dimensionStatuses,
    },
    trends,
    history: opts.includeHistory !== false
      ? monitor.getHistory({ limit: 20, summary: true })
      : [],
  };
}

module.exports = {
  attachHealthMonitor,
  generateHealthDashboard,
};
