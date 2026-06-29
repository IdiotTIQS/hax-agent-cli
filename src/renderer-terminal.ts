import { ANSI, stripAnsi } from './renderer-ansi.js';

class TerminalScreen {
  stream: NodeJS.WriteStream;
  rows: number;
  columns: number;
  scrollRegionTop: number;
  scrollRegionBottom: number;
  cursorRow: number;
  cursorCol: number;
  _resizeHandler: () => void;

  constructor(stream: NodeJS.WriteStream = process.stdout) {
    this.stream = stream;
    this.rows = stream.rows || 24;
    this.columns = stream.columns || 80;
    this.scrollRegionTop = 1;
    this.scrollRegionBottom = this.rows;
    this.cursorRow = 1;
    this.cursorCol = 1;
    this._resizeHandler = () => this._onResize();
  }

  activate(): void {
    this.stream.on('resize', this._resizeHandler);
    this.write(ANSI.bracketedPasteOn);
    this.write(ANSI.focusOn);
  }

  deactivate(): void {
    this.stream.off('resize', this._resizeHandler);
    this.write(ANSI.bracketedPasteOff);
    this.write(ANSI.focusOff);
    this.write(ANSI.cursorShow);
  }

  _onResize(): void {
    this.rows = this.stream.rows || 24;
    this.columns = this.stream.columns || 80;
  }

  write(data: string): void {
    if (!this.isTTY()) {
      this.stream.write(stripAnsi(data));
    } else {
      this.stream.write(data);
    }
  }

  clear(): void {
    this.write(ANSI.clearScreen + ANSI.cursorHome);
    this.cursorRow = 1;
    this.cursorCol = 1;
  }

  cursorTo(row: number, col: number): void {
    this.write(ANSI.cursorTo(row, col));
    this.cursorRow = row;
    this.cursorCol = col;
  }

  clearLine(): void {
    this.write(ANSI.clearLine);
  }

  clearLineRight(): void {
    this.write(ANSI.clearLineRight);
  }

  setScrollRegion(top: number, bottom: number): void {
    this.scrollRegionTop = top;
    this.scrollRegionBottom = bottom;
    this.write(ANSI.setScrollRegion(top, bottom));
  }

  resetScrollRegion(): void {
    this.write(ANSI.setScrollRegion(1, this.rows));
  }

  scrollUp(n: number = 1): void {
    this.write(ANSI.scrollUp(n));
  }

  hideCursor(): void {
    this.write(ANSI.cursorHide);
  }

  showCursor(): void {
    this.write(ANSI.cursorShow);
  }

  enterAltScreen(): void {
    this.write(ANSI.altScreenOn);
  }

  leaveAltScreen(): void {
    this.write(ANSI.altScreenOff);
  }

  isTTY(): boolean {
    return Boolean(this.stream.isTTY && process.stdin.isTTY);
  }
}

export { TerminalScreen };
