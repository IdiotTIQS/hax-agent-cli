"use strict";
/** Voice mode controller. Ported from OpenHarness voice/voice_mode.py */
const { isWakeWord, isStopPhrase } = require("./keyterms");

class VoiceMode {
  constructor(opts = {}) { this._enabled = false; this._listening = false; this._onTranscript = opts.onTranscript || (() => {}); this._onCommand = opts.onCommand || (() => {}); }

  get enabled() { return this._enabled; }
  get listening() { return this._listening; }

  start() { this._enabled = true; this._listening = true; return true; }
  stop() { this._enabled = false; this._listening = false; return true; }

  processTranscript(text) {
    if (!this._listening) return null;
    if (isStopPhrase(text)) { this._listening = false; return { type: "stop", text }; }
    this._onTranscript(text);
    if (isWakeWord(text)) { const cmd = text.replace(/hey (claude|hax)|ok claude|computer/gi, "").trim(); if (cmd) { this._onCommand(cmd); return { type: "command", text: cmd }; } return { type: "wake", text }; }
    return { type: "transcript", text };
  }
}

module.exports = { VoiceMode };
