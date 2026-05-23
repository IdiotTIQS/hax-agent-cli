"use strict";

const { ANSI, THEME } = require("../renderer");

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

class Spinner {
  constructor(stream = process.stderr) {
    this.stream = stream;
    this.frameIndex = 0;
    this.timer = null;
    this.active = false;
    this.message = "";
    this.isTTY = Boolean(stream.isTTY);
  }

  start(message = "") {
    this.stop();
    this.active = true;
    this.message = message;
    this.frameIndex = 0;

    if (!this.isTTY) return;

    this._render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this._render();
    }, SPINNER_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.active) {
      this.active = false;
      if (this.isTTY) {
        this.stream.write(`\r${ANSI.clearLine}`);
      }
    }
  }

  updateMessage(message) {
    this.message = message;
    if (this.active) this._render();
  }

  _render() {
    if (!this.isTTY) return;
    const frame = SPINNER_FRAMES[this.frameIndex];
    const line = `${THEME.spinner}${frame}${ANSI.reset} ${this.message}`;
    this.stream.write(`\r${ANSI.clearLine}${line}`);
  }
}

class ProgressBar {
  /**
   * @param {object} [options]
   * @param {number} [options.width=40] - Width of the bar (character count)
   * @param {string} [options.complete='='] - Character for completed portion
   * @param {string} [options.incomplete=' '] - Character for remaining portion
   * @param {string} [options.style='themed'] - "themed" | "plain" | "none"
   * @param {number} [options.decimals=1] - Decimal places in percentage
   * @param {boolean} [options.showPercent=true] - Show percentage label
   * @param {boolean} [options.showEta=false] - Show ETA
   * @param {number} [options.total] - Total value (100% = total), for ETA
   */
  constructor(options = {}) {
    this.width = options.width ?? 40;
    this.complete = options.complete ?? "=";
    this.incomplete = options.incomplete ?? " ";
    this.style = options.style ?? "themed";
    this.decimals = options.decimals ?? 1;
    this.showPercent = options.showPercent !== false;
    this.showEta = options.showEta === true;
    this.total = options.total;
    this._startTime = null;
  }

  /**
   * Render a percentage (0-100) into a progress bar string.
   * @param {number} percent - 0 to 100
   * @param {number} [elapsedMs] - milliseconds elapsed (for ETA)
   * @returns {string}
   */
  render(percent, elapsedMs) {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
    const completeLen = Math.round((clamped / 100) * this.width);
    const incompleteLen = this.width - completeLen;

    const bar = this.complete.repeat(completeLen) + this.incomplete.repeat(incompleteLen);

    let percentLabel = "";
    if (this.showPercent) {
      percentLabel = `${clamped.toFixed(this.decimals)}%`;
    }

    let etaLabel = "";
    if (this.showEta && elapsedMs && elapsedMs > 0 && clamped > 0 && clamped < 100 && this.total) {
      const rate = elapsedMs / clamped;
      const remaining = rate * (100 - clamped);
      etaLabel = `  ETA ${formatDuration(remaining)}`;
    }

    if (this.style === "themed") {
      return `${THEME.spinner}${bar}${ANSI.reset} ${percentLabel}${THEME.dim}${etaLabel}${ANSI.reset}`;
    }
    if (this.style === "plain") {
      return `[${bar}] ${percentLabel}${etaLabel}`;
    }
    // "none" — left/right markers only
    return bar + percentLabel + etaLabel;
  }

  /**
   * Convenience method: start timing (call when progress begins).
   */
  start() {
    this._startTime = Date.now();
  }

  /**
   * Returns elapsed ms since start().
   */
  elapsed() {
    return this._startTime ? Date.now() - this._startTime : 0;
  }
}

/**
 * Wraps an async function, displaying a spinner while it runs.
 * Returns the function's result. If the function throws, the spinner
 * is stopped before rethrowing.
 *
 * @param {Function} asyncFn - An async function (or function returning a Promise)
 * @param {string} message - Spinner label
 * @param {object} [options]
 * @param {NodeJS.WritableStream} [options.stream] - Output stream (default stderr)
 * @returns {Promise<*>} The resolved value of asyncFn
 */
async function withSpinner(asyncFn, message, options = {}) {
  const spinner = new Spinner(options.stream || process.stderr);
  spinner.start(message);
  try {
    return await asyncFn();
  } finally {
    spinner.stop();
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

module.exports = {
  Spinner,
  ProgressBar,
  withSpinner,
  SPINNER_FRAMES,
};
