'use strict';

const { ANSI, stripAnsi } = require('./renderer-ansi');

class TerminalScreen {
  constructor(stream = process.stdout) {
    this.stream = stream;
    this.rows = stream.rows || 24;
    this.columns = stream.columns || 80;
    this.scrollRegionTop = 1;
    this.scrollRegionBottom = this.rows;
    this.cursorRow = 1;
    this.cursorCol = 1;
    this._resizeHandler = () => this._onResize();
  }

  activate() {
    this.stream.on('resize', this._resizeHandler);
    this.write(ANSI.bracketedPasteOn);
    this.write(ANSI.focusOn);
  }

  deactivate() {
    this.stream.off('resize', this._resizeHandler);
    this.write(ANSI.bracketedPasteOff);
    this.write(ANSI.focusOff);
    this.write(ANSI.cursorShow);
  }

  _onResize() {
    this.rows = this.stream.rows || 24;
    this.columns = this.stream.columns || 80;
  }

  write(data) {
    if (!this.isTTY()) {
      this.stream.write(stripAnsi(data));
    } else {
      this.stream.write(data);
    }
  }

  clear() {
    this.write(ANSI.clearScreen + ANSI.cursorHome);
    this.cursorRow = 1;
    this.cursorCol = 1;
  }

  cursorTo(row, col) {
    this.write(ANSI.cursorTo(row, col));
    this.cursorRow = row;
    this.cursorCol = col;
  }

  clearLine() {
    this.write(ANSI.clearLine);
  }

  clearLineRight() {
    this.write(ANSI.clearLineRight);
  }

  setScrollRegion(top, bottom) {
    this.scrollRegionTop = top;
    this.scrollRegionBottom = bottom;
    this.write(ANSI.setScrollRegion(top, bottom));
  }

  resetScrollRegion() {
    this.write(ANSI.setScrollRegion(1, this.rows));
  }

  scrollUp(n = 1) {
    this.write(ANSI.scrollUp(n));
  }

  hideCursor() {
    this.write(ANSI.cursorHide);
  }

  showCursor() {
    this.write(ANSI.cursorShow);
  }

  enterAltScreen() {
    this.write(ANSI.altScreenOn);
  }

  leaveAltScreen() {
    this.write(ANSI.altScreenOff);
  }

  isTTY() {
    return Boolean(this.stream.isTTY && process.stdin.isTTY);
  }
}

module.exports = { TerminalScreen };
