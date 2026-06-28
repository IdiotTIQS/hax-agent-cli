"use strict";

/**
 * TUI — Terminal UI integrated with readline.
 *
 * Two-tier design:
 *   Tier 1 (TTY + readline): writes events above the prompt via rl.output.
 *     Uses rl.question() for non-blocking approval.
 *   Tier 2 (non-TTY / pipe / --no-color): plain text, no ANSI codes.
 *
 * Key principle: does NOT try to manage the screen. Works WITH readline,
 * not against it. No cursor positioning, no scroll regions, no alt-screen.
 */

const { ANSI, THEME, styled, stripAnsi } = require("../shared/utils");
const SPINNER = ["-", "\\", "|", "/"];
const SPINNER_MS = 100;

class TUI {
  /**
   * @param {Object} o
   * @param {Object} [o.rl] — readline interface
   * @param {Object} [o.session] — agent session
   * @param {boolean} [o.isTTY] — force TTY mode
   * @param {boolean} [o.noColor] — disable colors
   */
  constructor(o = {}) {
    this._rl = o.rl || null;
    this._session = o.session || null;
    this._isTTY = o.isTTY !== false;
    this._noColor = o.noColor || (this._rl ? !this._rl.output.isTTY : !process.stdout.isTTY);
    this._output = this._rl ? this._rl.output : process.stdout;
    this._spinnerTimer = null;
    this._spinnerIdx = 0;
    this._started = false;
  }

  // === Lifecycle ===

  async start() { this._started = true; }
  stop() { this._spinnerStop(); this._started = false; }

  // === Internal: write a line above the readline prompt ===

  _line(text) {
    if (!this._started) return;
    const s = this._noColor ? stripAnsi(String(text)) : String(text);
    if (this._rl) {
      this._output.write("\r" + ANSI.clearLine + s + "\n");
    } else {
      this._output.write(s + "\n");
    }
  }

  _style(ansi, text) { return this._noColor ? text : styled(ansi, text); }

  // === Spinner ===

  _spinnerStart() {
    if (!this._isTTY || this._spinnerTimer) return;
    this._output.write("\n");
    this._spinnerTimer = setInterval(() => {
      const frame = SPINNER[this._spinnerIdx % SPINNER.length];
      this._output.write("\r" + ANSI.clearLine + "  " + this._style(THEME.spinner, frame) + " Thinking...");
      this._spinnerIdx++;
    }, SPINNER_MS);
  }

  _spinnerStop() {
    if (!this._spinnerTimer) return;
    clearInterval(this._spinnerTimer);
    this._spinnerTimer = null;
    this._output.write("\r" + ANSI.clearLine);
  }

  // === Event Renderer ===

  /** Render a single engine event. Called from the async generator loop. */
  renderEvent(event) {
    if (!event) return;
    switch (event.type) {
      case "turn.started":
        this._spinnerStart();
        break;

      case "message.delta":
        this._spinnerStop();
        this._output.write(event.delta);
        break;

      case "thinking":
        break;

      case "tool.start": {
        this._spinnerStop();
        const name = this._fmtName(event.name);
        const detail = this._fmtInput(event);
        this._line("  " + this._style(THEME.accent, name) + " " + this._style(THEME.dim, detail));
        break;
      }

      case "tool.result": {
        const ok = !event.isError;
        const mark = ok ? this._style(THEME.success, "  ok") : this._style(THEME.error, "  FAIL");
        const dur = event.durationMs ? " " + this._style(THEME.dim, event.durationMs + "ms") : "";
        this._output.write(mark + dur + "\n");

        if (ok && event.data && event.name === "file.read" && event.data.content) {
          const lines = event.data.content.split("\n");
          for (const l of lines.slice(0, 3)) {
            this._line("  " + this._style(THEME.dim, "| ") + l.slice(0, 120));
          }
          if (lines.length > 3) {
            this._line("  " + this._style(THEME.dim, "| ... " + (lines.length - 3) + " more lines"));
          }
        } else if (ok && event.data && event.name === "shell.run" && event.data.stdout) {
          const lines = event.data.stdout.trim().split("\n");
          for (const l of lines.slice(0, 5)) {
            this._line("  " + this._style(THEME.dim, "| ") + l.slice(0, 120));
          }
          if (lines.length > 5) {
            this._line("  " + this._style(THEME.dim, "| ... " + (lines.length - 5) + " more lines"));
          }
        } else if (!ok && event.error) {
          this._line("  " + this._style(THEME.error, event.error.code || "") + " " + event.error.message);
        }
        break;
      }

      case "turn.completed":
        this._spinnerStop();
        break;

      case "turn.interrupted":
        this._spinnerStop();
        this._line(this._style(THEME.warning, "Interrupted"));
        break;

      case "turn.failed":
        this._spinnerStop();
        this._line(this._style(THEME.error, "Error: " + (event.error?.message || "Unknown")));
        break;

      case "tool.limit":
        this._line(this._style(THEME.warning, "Tool turn limit reached after " + event.maxToolTurns + " turns."));
        break;

      case "status":
        if (event.message) this._line(this._style(THEME.dim, event.message));
        break;

      case "usage":
        break;
    }
  }

  // === Dynamic Prompt ===

  /** Return the readline prompt string showing current session state. */
  getPrompt() {
    if (!this._session || !this._session.provider) return "> ";
    const s = this._session;
    const model = s.provider.model || "?";
    const mode = (s.permissionManager && s.permissionManager.mode) || "normal";
    const total = (s.inputTokens || 0) + (s.outputTokens || 0);
    const costVal = s.costTracker ? s.costTracker.getCost(s.provider?.model) : 0;
    const cost = costVal > 0 ? " $" + costVal.toFixed(4) : (s.costTracker ? " $0" : "");
    const left = " " + model + " | " + mode + " | " + total.toLocaleString() + "t" + cost;
    return this._style(THEME.statusLine, left) + " > ";
  }

  // === Approval ===

  /**
   * Create an approval handler that uses rl.question().
   * IMPORTANT: readline.question temporarily pauses the main prompt and
   * creates a new one-line prompt. This is the correct way to ask for
   * approval without blocking the event loop.
   */
  createApprovalCallback() {
    const self = this;
    return async function (toolName, toolInput) {
      if (!self._rl || !self._isTTY) return "approve"; // auto-approve in non-interactive mode

      const name = self._fmtName(toolName);
      const detail = JSON.stringify(toolInput || {}).slice(0, 60);
      const question = "\r\n" +
        self._style(THEME.warning, "  ? Approve ") +
        self._style(THEME.accent, name) +
        (detail !== "{}" ? " " + self._style(THEME.dim, detail) : "") +
        " " + self._style(THEME.success, "[Y]es") +
        " / " + self._style(THEME.error, "[N]o") +
        " / " + self._style(THEME.accent, "[A]lways") +
        " > ";

      return new Promise(function (resolve) {
        self._rl.question(question, function (answer) {
          var a = answer.trim().toLowerCase();
          if (a === "y" || a === "yes" || a === "") resolve("approve");
          else if (a === "a" || a === "always") resolve("always");
          else resolve("deny");
        });
      });
    };
  }

  // === Helpers ===

  _fmtName(name) {
    var parts = String(name).split(".");
    return parts.map(function (p, i) { return i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join(" ");
  }

  _fmtInput(event) {
    var input = event.input || {};
    if (event.name === "file.read" || event.name === "file.write" || event.name === "file.edit" || event.name === "file.delete") {
      return input.path || "";
    }
    if (event.name === "shell.run") {
      var cmd = [input.command].concat(input.args || []).filter(Boolean).join(" ");
      return cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd;
    }
    if (event.name === "file.glob") return input.pattern || "";
    if (event.name === "file.search" || event.name === "grep") return "\"" + (input.query || input.pattern || "") + "\"";
    if (event.name === "web.fetch" || event.name === "web.search") return (input.url || input.query || "").slice(0, 50);
    return "";
  }
}

module.exports = { TUI };
