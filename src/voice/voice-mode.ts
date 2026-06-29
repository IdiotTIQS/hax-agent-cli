/** Voice mode controller. Ported from OpenHarness voice/voice_mode.py */
import { isWakeWord, isStopPhrase } from "./keyterms.js";

interface VoiceModeOptions {
  onTranscript?: (text: string) => void;
  onCommand?: (cmd: string) => void;
}

class VoiceMode {
  _enabled: boolean;
  _listening: boolean;
  _onTranscript: (text: string) => void;
  _onCommand: (cmd: string) => void;

  constructor(opts: VoiceModeOptions = {}) {
    this._enabled = false;
    this._listening = false;
    this._onTranscript = opts.onTranscript || (() => {});
    this._onCommand = opts.onCommand || (() => {});
  }

  get enabled(): boolean { return this._enabled; }
  get listening(): boolean { return this._listening; }

  start(): boolean { this._enabled = true; this._listening = true; return true; }
  stop(): boolean { this._enabled = false; this._listening = false; return true; }

  processTranscript(text: string): { type: string; text: string } | null {
    if (!this._listening) return null;
    if (isStopPhrase(text)) { this._listening = false; return { type: "stop", text }; }
    this._onTranscript(text);
    if (isWakeWord(text)) { const cmd = text.replace(/hey (claude|hax)|ok claude|computer/gi, "").trim(); if (cmd) { this._onCommand(cmd); return { type: "command", text: cmd }; } return { type: "wake", text }; }
    return { type: "transcript", text };
  }
}

export { VoiceMode };
