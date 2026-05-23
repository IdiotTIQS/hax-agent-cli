'use strict';

const { autoCompleteSlashCommand } = require('./commands/autocomplete');
const { formatPastedInputSummary, shouldRunPasteAsCommandBatch } = require('./paste-utils');

const PASTE_THRESHOLD_MS = 80;

/**
 * Creates the terminal input subsystem. Extracted from cli.js to encapsulate
 * keyboard input handling, vim mode, paste detection, reverse-i-search, and
 * the readline 'line' event handler.
 *
 * @param {Object} opts
 * @param {readline.Interface} opts.rl - The shared readline interface
 * @param {Object} opts.screen - TerminalScreen instance
 * @param {Object} opts.session - Session object (used for interactivePromptActive, provider, etc.)
 * @param {Object} opts.history - Input history object with .entries, .up(), .down(), .search(), .add()
 * @param {Object} opts.callbacks
 * @param {Function} opts.callbacks.onProcessLine - (line, options?) => Promise - main line processor
 * @param {Function} opts.callbacks.onPerformCleanExit - () => void - exit handler
 * @param {Function} opts.callbacks.getMainPrompt - () => string - returns current prompt string
 * @param {Function} opts.callbacks.onSetContinuationPrompt - () => void - switch to continuation prompt
 * @param {Function} opts.callbacks.onAutoComplete - (text) => ? - tab completion (reserved)
 * @param {Function} opts.callbacks.withInputAreaHidden - (fn) => void - hide input area during output
 * @param {Function} opts.callbacks.clearActivePrompt - (line?) => void - clear the active prompt
 * @param {Function} opts.callbacks.prompt - (preserveCursor?) => void - re-display prompt
 * @returns {Object} public API
 */
function createTerminalInput({ rl, screen, session, history, callbacks }) {
  // ── State variables ──────────────────────────────────────────────────

  let vimMode = false;
  let vimInsertMode = true;
  let vimCommandBuffer = '';

  let pendingExitCount = 0;
  let lineQueue = Promise.resolve();
  let multilineBuffer = [];
  let pasteBuffer = [];
  let pasteTimer = null;
  let stagedPastedInput = null;
  let bracketedPasteActive = false;
  let bracketedPasteLines = [];

  // ── Vim key handler ──────────────────────────────────────────────────

  function handleVimKey(key, rl) {
    if (key.name === 'i' && !key.ctrl) {
      vimInsertMode = true;
    } else if (key.name === 'escape' || key.ctrl) {
      vimInsertMode = true;
      vimCommandBuffer = '';
    } else if (key.name === 'h' && !key.ctrl) {
      rl.cursor = Math.max(0, rl.cursor - 1);
      rl._refreshLine();
    } else if (key.name === 'l' && !key.ctrl) {
      rl.cursor = Math.min(rl.line.length, rl.cursor + 1);
      rl._refreshLine();
    } else if (key.name === '0') {
      rl.cursor = 0;
      rl._refreshLine();
    } else if (key.name === 'd' && !key.shift) {
      vimCommandBuffer += 'd';
    } else if (key.name === 'd' && vimCommandBuffer === 'd') {
      rl.line = '';
      rl.cursor = 0;
      rl._refreshLine();
      vimCommandBuffer = '';
    } else if (key.name === 'w') {
      const nextSpace = rl.line.indexOf(' ', rl.cursor);
      rl.cursor = nextSpace === -1 ? rl.line.length : nextSpace + 1;
      rl._refreshLine();
    } else if (key.name === 'b') {
      const prevSpace = rl.line.lastIndexOf(' ', rl.cursor - 1);
      rl.cursor = prevSpace === -1 ? 0 : prevSpace + 1;
      rl._refreshLine();
    }
  }

  // ── Reverse-i-search (Ctrl+R) ────────────────────────────────────────

  /**
   * Interactive reverse-i-search (Ctrl+R). Like bash's reverse search:
   * - Type to narrow search; match appears inline
   * - Ctrl+R again to cycle to previous match
   * - Enter to accept, Escape/Ctrl+C to cancel
   */
  function enterReverseSearch(rl, history, screen) {
    if (history.entries.length === 0) return;

    const origLine = rl.line;
    let query = '';
    let matchIndex = 0;
    let active = true;

    // Save current stdin handler and install search handler
    const origKeypress = process.stdin.listeners('keypress').pop();
    process.stdin.removeListener('keypress', origKeypress);

    function render() {
      const results = history.search(query);
      const match = results[matchIndex % Math.max(1, results.length)] || '';
      let highlight = match;
      if (match && query) {
        try {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Guard against ReDoS: limit regex complexity
          if (escaped.length <= 200) {
            highlight = match.replace(new RegExp(escaped, 'gi'), m => `\x1b[1m\x1b[33m${m}\x1b[0m`);
          } else {
            // Fallback: plain highlight without regex
            const idx = match.toLowerCase().indexOf(query.toLowerCase());
            if (idx >= 0) {
              highlight = match.slice(0, idx) + `\x1b[1m\x1b[33m${match.slice(idx, idx + query.length)}\x1b[0m` + match.slice(idx + query.length);
            }
          }
        } catch {
          // Regex failed — use plain match fallback
          const idx = match.toLowerCase().indexOf(query.toLowerCase());
          if (idx >= 0) {
            highlight = match.slice(0, idx) + `\x1b[1m\x1b[33m${match.slice(idx, idx + query.length)}\x1b[0m` + match.slice(idx + query.length);
          }
        }
      }

      process.stdout.write('\r\x1b[K'); // clear line
      if (query) {
        process.stdout.write(`\x1b[2m(reverse-i-search)\x1b[0m \`${query}': ${highlight}`);
      } else {
        process.stdout.write(`\x1b[2m(reverse-i-search)\x1b[0m \`': `);
      }
    }

    function accept() {
      active = false;
      const results = history.search(query);
      if (results.length > 0) {
        rl.line = results[matchIndex % results.length];
        rl.cursor = rl.line.length;
      }
      cleanup();
      process.stdout.write('\r\x1b[K');
      rl._refreshLine();
    }

    function cancel() {
      active = false;
      rl.line = origLine;
      rl.cursor = rl.line.length;
      cleanup();
      process.stdout.write('\r\x1b[K');
      rl._refreshLine();
    }

    function cleanup() {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.on('keypress', origKeypress);
    }

    function onKey(_char, key) {
      if (!active) return;
      if (!key) return;

      if (key.name === 'return' || key.name === 'enter') {
        accept();
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cancel();
      } else if (key.ctrl && key.name === 'r') {
        matchIndex++;
        render();
      } else if (key.name === 'backspace') {
        query = query.slice(0, -1);
        matchIndex = 0;
        render();
      } else if (_char && _char.length === 1 && !key.ctrl && !key.meta) {
        query += _char;
        matchIndex = 0;
        render();
      }
    }

    process.stdin.on('keypress', onKey);
    render();

    // Pause readline so it doesn't eat our keystrokes
    rl.pause();
    process.stdin.once('keypress', () => {}); // dummy to keep events flowing
  }

  // ── Paste helpers ────────────────────────────────────────────────────

  function startBracketedPaste() {
    bracketedPasteActive = true;
    bracketedPasteLines = [];
    rl.line = '';
    rl.cursor = 0;
    rl.output.muted = true;
  }

  function endBracketedPaste() {
    if (!bracketedPasteActive) return;

    bracketedPasteActive = false;
    rl.output.muted = false;
    if (rl.line) {
      bracketedPasteLines.push(rl.line);
    }
    const input = bracketedPasteLines.join('\n');
    bracketedPasteLines = [];
    rl.line = '';
    rl.cursor = 0;

    callbacks.clearActivePrompt('');
    processPastedInput(input);
  }

  function processLineNormal(line) {
    // Multi-line continuation: trailing backslash (bash-style)
    if (line.endsWith('\\')) {
      multilineBuffer.push(line.slice(0, -1));
      callbacks.onSetContinuationPrompt();
      rl.prompt();
      return;
    }

    let finalLine = line;
    if (multilineBuffer.length > 0) {
      multilineBuffer.push(line);
      finalLine = multilineBuffer.join('\n');
      multilineBuffer = [];
      rl.setPrompt(callbacks.getMainPrompt());
    }

    lineQueue = lineQueue.then(() => callbacks.onProcessLine(finalLine));
  }

  function processPastedInput(input) {
    if (shouldRunPasteAsCommandBatch(input)) {
      for (const pastedLine of input.split(/\r?\n/)) {
        if (pastedLine.trim()) {
          lineQueue = lineQueue.then(() => callbacks.onProcessLine(pastedLine));
        }
      }
      return;
    }

    const content = String(input || '');
    const lineCount = content.split(/\r?\n/).length;

    // Short paste: auto-process silently, no badge or confirmation needed.
    if (lineCount < 3 || content.length < 200) {
      lineQueue = lineQueue.then(() => callbacks.onProcessLine(content, { pasted: true }));
      callbacks.prompt();
      return;
    }

    // Long paste: stage with "Pasted N lines" badge, wait for Enter to confirm.
    stagePastedInput(content);
  }

  // Stage long pasted input for manual confirmation via Enter.
  function stagePastedInput(input) {
    const content = String(input || '');
    const summary = formatPastedInputSummary(content);
    stagedPastedInput = { content, summary };
    rl.line = summary;
    rl.cursor = summary.length;
    callbacks.prompt(true);
  }

  // ── Main keypress handler ────────────────────────────────────────────

  process.stdin.on('keypress', (_char, key) => {
    if (!key) return;
    if (session.interactivePromptActive) return;

    if (key.name === 'paste-start') {
      startBracketedPaste();
      return;
    }

    if (key.name === 'paste-end') {
      endBracketedPaste();
      return;
    }

    if (bracketedPasteActive) return;

    if (vimMode && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
      vimCommandBuffer = '';
    }

    if (vimMode && !vimInsertMode) {
      handleVimKey(key, rl);
      return;
    }

    if (key.name === 'up') {
      const input = rl.line;
      rl.line = history.up(input);
      rl.cursor = rl.line.length;
      rl._refreshLine();
    } else if (key.name === 'down') {
      rl.line = history.down(rl.line);
      rl.cursor = rl.line.length;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'left') {
      // Ctrl+Left: jump to previous word boundary
      const line = rl.line;
      let pos = rl.cursor - 1;
      while (pos > 0 && line[pos - 1] === ' ') pos--;
      while (pos > 0 && line[pos - 1] !== ' ') pos--;
      rl.cursor = pos;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'right') {
      // Ctrl+Right: jump to next word boundary
      const line = rl.line;
      let pos = rl.cursor;
      while (pos < line.length && line[pos] !== ' ') pos++;
      while (pos < line.length && line[pos] === ' ') pos++;
      rl.cursor = pos;
      rl._refreshLine();
    } else if (key.ctrl && key.name === 'r') {
      enterReverseSearch(rl, history, screen);
      return;
    } else if (key.name === 'tab') {
      // readline already inserted \t into the line; strip it so autocomplete
      // sees the actual user input, then re-insert if not a slash command
      rl.line = rl.line.replace(/\t/g, '');
      rl.cursor = rl.line.length;
      const display = autoCompleteSlashCommand(rl, session);
      if (display) {
        rl._refreshLine();
        if (display.length) {
          process.stdout.write('\n' + display.join('\n') + '\n');
          callbacks.prompt(true);
        }
      } else {
        // Not a slash command — restore the tab (readline default indent)
        rl.line = rl.line + '\t';
        rl.cursor = rl.line.length;
        rl._refreshLine();
      }
    }
  });

  // ── Readline 'line' handler ──────────────────────────────────────────

  rl.on('line', (line) => {
    if (bracketedPasteActive) {
      bracketedPasteLines.push(line);
      return;
    }

    callbacks.clearActivePrompt(line);

    if (stagedPastedInput) {
      const staged = stagedPastedInput;
      stagedPastedInput = null;
      if (line.trim() === staged.summary) {
        lineQueue = lineQueue.then(() => callbacks.onProcessLine(staged.content, { pasted: true }));
        return;
      }
      processLineNormal(line);
      return;
    }

    // Paste detection: if lines arrive rapidly, buffer and join them
    if (pasteTimer) {
      clearTimeout(pasteTimer);
      pasteBuffer.push(line);
      pasteTimer = setTimeout(() => {
        const joined = pasteBuffer.join('\n');
        pasteBuffer = [];
        pasteTimer = null;
        rl.setPrompt(callbacks.getMainPrompt());
        processPastedInput(joined);
      }, PASTE_THRESHOLD_MS);
      return;
    }

    if (!screen.isTTY()) {
      processLineNormal(line);
      return;
    }

    // Start paste detection window — if next line arrives within threshold, we're pasting
    pasteBuffer = [line];
    pasteTimer = setTimeout(() => {
      // No rapid follow-up — single line, process normally
      const singleLine = pasteBuffer[0];
      pasteBuffer = [];
      pasteTimer = null;
      processLineNormal(singleLine);
    }, PASTE_THRESHOLD_MS);
    return;
  });

  // ── Public API ───────────────────────────────────────────────────────

  return {
    getVimMode: () => vimMode,
    setVimMode: (v) => { vimMode = v; },
    getVimInsertMode: () => vimInsertMode,
    setVimInsertMode: (v) => { vimInsertMode = v; },
    getVimCommandBuffer: () => vimCommandBuffer,
    setVimCommandBuffer: (v) => { vimCommandBuffer = v; },
    getPendingExitCount: () => pendingExitCount,
    setPendingExitCount: (v) => { pendingExitCount = v; },
    getLineQueue: () => lineQueue,
    setLineQueue: (q) => { lineQueue = q; },
    getMultilineBuffer: () => multilineBuffer,
    getPasteBuffer: () => pasteBuffer,
    getPasteTimer: () => pasteTimer,
    setPasteTimer: (v) => { pasteTimer = v; },
    getStagedPastedInput: () => stagedPastedInput,
    getBracketedPasteActive: () => bracketedPasteActive,
    stagePastedInput,
  };
}

module.exports = { createTerminalInput };
