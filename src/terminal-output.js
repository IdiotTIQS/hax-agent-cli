'use strict';

const { THEME, ANSI, styled, stripAnsi } = require('./renderer');

function createTerminalOutput({ screen, session, rl, readlineOutput }) {
  let inputAreaRows = 2;
  let inputAreaActive = false;
  let activePromptKind = 'main';
  const moveCursorUp = (rows) => (rows > 0 ? `\x1B[${rows}A` : '');
  const moveCursorDown = (rows) => (rows > 0 ? `\x1B[${rows}B` : '');

  const mainPrompt = () => {
    const width = screen.columns || 80;
    const status = session.getStatusLine();
    const statusText = stripAnsi(status);
    const padding = Math.max(0, width - statusText.length - 2);
    return `${THEME.statusLine} ${status} ${' '.repeat(padding)}${ANSI.reset || ''}\n${styled(THEME.promptPrefix, '>')} `;
  };
  const inputLinePrompt = () => `${styled(THEME.promptPrefix, '>')} `;
  const drawFixedStatusLine = () => {
    if (!screen.isTTY()) return;
    const width = screen.columns || 80;
    const status = session.getStatusLine();
    const statusText = stripAnsi(status);
    const padding = Math.max(0, width - statusText.length - 2);
    screen.cursorTo(Math.max(1, screen.rows - 1), 1);
    screen.write(`${ANSI.clearLine}${THEME.statusLine} ${status} ${' '.repeat(padding)}${ANSI.reset || ''}`);
  };
  const activateInputArea = () => {
    if (!screen.isTTY()) return false;
    screen.setScrollRegion(1, Math.max(1, screen.rows - inputAreaRows));
    inputAreaActive = true;
    return true;
  };
  const withInputAreaHidden = (writeFn) => {
    if (!inputAreaActive || !screen.isTTY()) {
      writeFn();
      return;
    }

    screen.resetScrollRegion();
    screen.cursorTo(Math.max(1, screen.rows - 1), 1);
    screen.write(ANSI.clearLine);
    screen.cursorTo(screen.rows, 1);
    screen.write(ANSI.clearLine);
    screen.setScrollRegion(1, Math.max(1, screen.rows - inputAreaRows));
    screen.cursorTo(Math.max(1, screen.rows - inputAreaRows), 1);
    writeFn();
  };
  const prompt = (preserveCursor = false) => {
    activePromptKind = 'main';
    if (screen.isTTY()) {
      drawFixedStatusLine();
      screen.cursorTo(screen.rows, 1);
      screen.write(ANSI.clearLine);
      rl.setPrompt(inputLinePrompt());
    } else {
      rl.setPrompt(mainPrompt());
    }
    rl.prompt(preserveCursor);
  };
  const setContinuationPrompt = () => {
    activePromptKind = 'continuation';
    rl.setPrompt(styled(THEME.dim, '│ ') + ' ');
  };
  const clearActivePrompt = (line = '') => {
    if (!screen.isTTY()) return;

    if (inputAreaActive && activePromptKind === 'main') {
      screen.cursorTo(screen.rows, 1);
      screen.write(ANSI.clearLine);
      screen.cursorTo(Math.max(1, screen.rows - inputAreaRows), 1);
      return;
    }

    const columns = Math.max(1, screen.columns || 80);
    const promptPrefixLength = 2;
    const inputRows = Math.max(1, Math.ceil((promptPrefixLength + stripAnsi(String(line)).length) / columns));
    const rowsToClear = inputRows + (activePromptKind === 'main' ? 1 : 0);
    process.stdout.write(moveCursorUp(rowsToClear));
    for (let i = 0; i < rowsToClear; i++) {
      process.stdout.write(`\r${ANSI.clearLine}`);
      if (i < rowsToClear - 1) {
        process.stdout.write(moveCursorDown(1));
      }
    }
    process.stdout.write(`${moveCursorDown(1)}\r`);
  };

  return {
    mainPrompt,
    inputLinePrompt,
    drawFixedStatusLine,
    activateInputArea,
    withInputAreaHidden,
    prompt,
    setContinuationPrompt,
    clearActivePrompt,
    getInputAreaActive: () => inputAreaActive,
    getInputAreaRows: () => inputAreaRows,
    setInputAreaRows: (n) => { inputAreaRows = n; },
  };
}

module.exports = { createTerminalOutput };
