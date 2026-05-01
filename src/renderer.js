const ANSI = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  italic: '\x1B[3m',
  underline: '\x1B[4m',
  strikethrough: '\x1B[9m',
  inverse: '\x1B[7m',
  hidden: '\x1B[8m',
  black: '\x1B[30m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  blue: '\x1B[34m',
  magenta: '\x1B[35m',
  cyan: '\x1B[36m',
  white: '\x1B[37m',
  brightRed: '\x1B[91m',
  brightGreen: '\x1B[92m',
  brightYellow: '\x1B[93m',
  brightBlue: '\x1B[94m',
  brightMagenta: '\x1B[95m',
  brightCyan: '\x1B[96m',
  brightWhite: '\x1B[97m',
  bgBlack: '\x1B[40m',
  bgRed: '\x1B[41m',
  bgGreen: '\x1B[42m',
  bgYellow: '\x1B[43m',
  bgBlue: '\x1B[44m',
  bgMagenta: '\x1B[45m',
  bgCyan: '\x1B[46m',
  bgWhite: '\x1B[47m',
  bgBrightBlack: '\x1B[100m',
  bgBrightBlue: '\x1B[104m',
  bgBrightMagenta: '\x1B[105m',
  bgBrightCyan: '\x1B[106m',
  clearScreen: '\x1B[2J',
  clearLine: '\x1B[2K',
  clearLineRight: '\x1B[K',
  clearLineLeft: '\x1B[1K',
  cursorHome: '\x1B[H',
  cursorUp: '\x1B[A',
  cursorDown: '\x1B[B',
  cursorRight: '\x1B[C',
  cursorLeft: '\x1B[D',
  cursorSave: '\x1B[s',
  cursorRestore: '\x1B[u',
  cursorShow: '\x1B[?25h',
  cursorHide: '\x1B[?25l',
  cursorTo: (row, col) => `\x1B[${row};${col}H`,
  scrollUp: (n) => `\x1B[${n}S`,
  scrollDown: (n) => `\x1B[${n}T`,
  setScrollRegion: (top, bottom) => `\x1B[${top};${bottom}r`,
  altScreenOn: '\x1B[?1049h',
  altScreenOff: '\x1B[?1049l',
  bracketedPasteOn: '\x1B[?2004h',
  bracketedPasteOff: '\x1B[?2004l',
  focusOn: '\x1B[?1004h',
  focusOff: '\x1B[?1004l',
};

const THEME = {
  userIndicator: ANSI.brightCyan,
  assistantIndicator: ANSI.brightMagenta,
  toolIndicator: ANSI.brightYellow,
  toolSuccess: ANSI.brightGreen,
  toolError: ANSI.brightRed,
  thinkingIndicator: ANSI.dim + ANSI.italic,
  codeBlock: ANSI.bgBrightBlack,
  codeText: ANSI.brightCyan,
  heading: ANSI.bold + ANSI.brightCyan,
  bold: ANSI.bold + ANSI.brightWhite,
  italic: ANSI.italic,
  link: ANSI.underline + ANSI.brightBlue,
  list: ANSI.brightYellow,
  hr: ANSI.dim,
  dimText: ANSI.dim,
  dim: ANSI.dim,
  statusLine: ANSI.bgBrightBlack + ANSI.brightWhite,
  promptPrefix: ANSI.brightGreen,
  promptCaret: ANSI.brightWhite,
  error: ANSI.brightRed,
  warning: ANSI.brightYellow,
  success: ANSI.brightGreen,
  info: ANSI.brightBlue,
  muted: ANSI.dim,
  accent: ANSI.brightMagenta,
  diffAdd: ANSI.brightGreen,
  diffRemove: ANSI.brightRed,
  diffContext: ANSI.dim,
  diffHeader: ANSI.brightCyan,
  spinner: ANSI.brightCyan,
  cost: ANSI.brightYellow,
  token: ANSI.dim,
  border: ANSI.dim,
  badge: ANSI.bgBrightBlack + ANSI.brightWhite,
  skillIndicator: ANSI.brightGreen + ANSI.bold,
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

const SPINNER_VERBS = [
  'Thinking', 'Analyzing', 'Processing', 'Reasoning', 'Computing',
  'Evaluating', 'Generating', 'Considering', 'Examining', 'Planning',
];

const VERSION = '1.3.2';

const CLAUDE_BANNER = [
  '',
  `${THEME.accent}   ╭${'─'.repeat(40)}╮${ANSI.reset}`,
  `${THEME.accent}   │${ANSI.reset}    ${THEME.bold}Hax Agent v${VERSION}${ANSI.reset}                    ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}   │${ANSI.reset}  ${THEME.dim}AI-powered coding assistant${ANSI.reset}           ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}   ╰${'─'.repeat(40)}╯${ANSI.reset}`,
  '',
];

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

class Spinner {
  constructor(screen) {
    this.screen = screen;
    this.frameIndex = 0;
    this.timer = null;
    this.active = false;
    this.label = '';
    this.verb = '';
    this.startTime = 0;
    this.tokenCount = 0;
    this.isTTY = true;
  }

  start(label = '', verb = '') {
    this.stop();
    this.active = true;
    this.label = label;
    this.verb = verb || SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
    this.startTime = Date.now();
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
        this.screen.write(`\r${ANSI.clearLine}`);
      }
    }
  }

  updateLabel(label) {
    this.label = label;
    if (this.active) this._render();
  }

  updateTokens(count) {
    this.tokenCount = count;
  }

  _render() {
    if (!this.isTTY) return;
    const frame = SPINNER_FRAMES[this.frameIndex];
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const timeStr = elapsed > 0 ? ` ${THEME.dim}${elapsed}s${ANSI.reset}` : '';
    const tokenStr = this.tokenCount > 0 ? ` ${THEME.token}${this.tokenCount} tokens${ANSI.reset}` : '';
    const line = `${THEME.spinner}${frame}${ANSI.reset} ${THEME.bold}${this.verb}${ANSI.reset}${this.label ? ` ${THEME.dim}${this.label}${ANSI.reset}` : ''}${timeStr}${tokenStr}`;
    this.screen.write(`\r${ANSI.clearLine}${line}`);
  }

  getElapsed() {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }
}

class MarkdownRenderer {
  constructor(columns = 80) {
    this.columns = columns;
  }

  render(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const output = [];

    let inCodeBlock = false;
    let codeLang = '';
    let codeLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          output.push(this._renderCodeBlock(codeLines, codeLang));
          codeLines = [];
          codeLang = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.match(/^#{1,6}\s/)) {
        output.push(this._renderHeading(line));
        continue;
      }

      if (line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/)) {
        output.push(this._renderListItem(line));
        continue;
      }

      if (line.match(/^>\s/)) {
        output.push(this._renderBlockquote(line));
        continue;
      }

      if (line.match(/^---+$/)) {
        output.push(this._renderHr());
        continue;
      }

      if (line.trim() === '') {
        output.push('');
        continue;
      }

      output.push(this._renderInline(line));
    }

    if (inCodeBlock && codeLines.length > 0) {
      output.push(this._renderCodeBlock(codeLines, codeLang));
    }

    return output.join('\n');
  }

  _renderHeading(line) {
    const match = line.match(/^(#{1,6})\s+(.*)/);
    if (!match) return this._renderInline(line);
    const level = match[1].length;
    const text = this._renderInline(match[2]);
    const prefix = level === 1 ? '▎ ' : level === 2 ? '┃ ' : '│ ';
    return `\n${THEME.heading}${prefix}${text}${ANSI.reset}`;
  }

  _renderCodeBlock(lines, lang) {
    const width = Math.min(this.columns - 4, 100);
    const topBorder = `${THEME.border}╭${'─'.repeat(width)}╮${ANSI.reset}`;
    const bottomBorder = `${THEME.border}╰${'─'.repeat(width)}╯${ANSI.reset}`;
    const langLabel = lang ? `${THEME.dim} ${lang}${ANSI.reset}` : '';

    const rendered = [topBorder + langLabel];
    for (const line of lines) {
      const content = line.length > width - 2 ? line.slice(0, width - 5) + '...' : line;
      rendered.push(`${THEME.border}│${ANSI.reset} ${THEME.codeText}${content.padEnd(width - 1)}${ANSI.reset}${THEME.border}│${ANSI.reset}`);
    }
    rendered.push(bottomBorder);

    return rendered.join('\n');
  }

  _renderListItem(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
    if (!match) return this._renderInline(line);
    const indent = match[1];
    const marker = match[2];
    const text = this._renderInline(match[3]);
    const displayMarker = /^\d+$/.test(marker) ? `${marker}.` : marker;
    return `${indent}${THEME.list}${displayMarker}${ANSI.reset} ${text}`;
  }

  _renderBlockquote(line) {
    const text = line.replace(/^>\s*/, '');
    return `${THEME.dim}▎ ${this._renderInline(text)}${ANSI.reset}`;
  }

  _renderHr() {
    const width = Math.min(this.columns - 2, 60);
    return `${THEME.hr}${'─'.repeat(width)}${ANSI.reset}`;
  }

  _renderInline(text) {
    if (!text) return '';
    let result = '';
    let cursor = 0;

    while (cursor < text.length) {
      const remaining = text.slice(cursor);

      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
      if (boldMatch && boldMatch.index === 0 && boldMatch[1].length > 0) {
        result += `${THEME.bold}${boldMatch[1]}${ANSI.reset}`;
        cursor += boldMatch[0].length;
        continue;
      }

      const italicMatch = remaining.match(/^\*(.+?)\*/);
      if (italicMatch && italicMatch.index === 0 && italicMatch[1].length > 0 && !remaining.startsWith('**')) {
        result += `${THEME.italic}${italicMatch[1]}${ANSI.reset}`;
        cursor += italicMatch[0].length;
        continue;
      }

      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch && codeMatch.index === 0) {
        result += `${THEME.codeText}${codeMatch[1]}${ANSI.reset}`;
        cursor += codeMatch[0].length;
        continue;
      }

      const strikethroughMatch = remaining.match(/^~~(.+?)~~/);
      if (strikethroughMatch && strikethroughMatch.index === 0) {
        result += `${ANSI.strikethrough}${strikethroughMatch[1]}${ANSI.reset}`;
        cursor += strikethroughMatch[0].length;
        continue;
      }

      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch && linkMatch.index === 0) {
        result += `${THEME.link}${linkMatch[1]}${ANSI.reset}`;
        cursor += linkMatch[0].length;
        continue;
      }

      if (text[cursor] === '*' || text[cursor] === '`' || text[cursor] === '[' || text[cursor] === '~') {
        result += text[cursor];
        cursor += 1;
        continue;
      }

      const nextSpecial = text.slice(cursor).search(/[*`\[~]/);
      if (nextSpecial === -1) {
        result += text.slice(cursor);
        break;
      } else if (nextSpecial > 0) {
        result += text.slice(cursor, cursor + nextSpecial);
        cursor += nextSpecial;
      } else {
        result += text[cursor];
        cursor += 1;
      }
    }

    return result;
  }
}

class NullWritable {
  constructor() { this.writable = true; }
  write() { return true; }
  end() { return this; }
  on() {}
  once() {}
  removeListener() {}
  off() {}
}

class ResponseRenderer {
  constructor(screen, markdown) {
    this.screen = screen;
    this.markdown = markdown;
    this.spinner = new Spinner(screen);
    this.spinner.isTTY = screen.isTTY();
    this.assistantStarted = false;
    this.textStarted = false;
    this.lineOpen = false;
    this.lineBuffer = '';
    this.currentToolName = '';
    this.currentToolInput = {};
    this.thinkingSummary = '';
    this.toolCount = 0;
    this.startTime = Date.now();
    this.outputTokens = 0;
    this.inputTokens = 0;
  }

  startWaiting() {
    this.screen.write('\n');
    this.spinner.start('', 'Thinking');
  }

  writeText(delta) {
    this.spinner.stop();
    if (!this.textStarted) {
      this.screen.write(`\n${THEME.assistantIndicator}Assistant${ANSI.reset}\n`);
      this.assistantStarted = true;
      this.textStarted = true;
      this.lineOpen = false;
    }

    this.textStarted = true;
    this.lineBuffer += delta;

    const parts = this.lineBuffer.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      const rendered = this.markdown._renderInline(parts[i]);
      this.screen.write(`${rendered}\n`);
    }
    this.lineBuffer = parts[parts.length - 1];
    this.lineOpen = true;
  }

  thinking(chunk) {
    if (!this.assistantStarted) {
      this.spinner.stop();
      this.assistantStarted = true;
    }
    if (this.spinner.isTTY) {
      this.thinkingSummary = chunk.summary || 'Thinking...';
      this.spinner.start('', this.thinkingSummary);
    }
  }

  startTool(chunk) {
    this.toolCount++;
    this.currentToolName = chunk.name;
    this.currentToolInput = chunk.input || {};
    const toolLine = formatToolStart(chunk);
    if (!this.spinner.isTTY) {
      this.screen.write(`  ${toolLine}\n`);
      return;
    }
    this.spinner.start(toolLine, 'Running');
  }

  finishTool(chunk) {
    this.spinner.stop();

    if (!this.assistantStarted) {
      this.screen.write(`\n${THEME.assistantIndicator}Assistant${ANSI.reset}\n`);
      this.assistantStarted = true;
    }

    if (this.lineOpen) {
      this.screen.write('\n');
      this.lineOpen = false;
    }

    const modificationNotice = formatFileModificationNotice(chunk);
    if (modificationNotice) {
      for (const line of modificationNotice) {
        this.screen.write(`${line}\n`);
      }
    } else {
      this.screen.write(`${formatToolResult(chunk)}\n`);
    }

    if (chunk.repeatedInvalid && chunk.showNotice) {
      this.screen.write(`${THEME.warning}  Same invalid call failed twice; asking the model to choose different input.${ANSI.reset}\n`);
    }
  }

  notice(message) {
    this.spinner.stop();
    if (this.lineOpen) {
      this.screen.write('\n');
      this.lineOpen = false;
    }
    this.screen.write(`${THEME.info}  ${message}${ANSI.reset}\n`);
  }

  complete(usage) {
    this.spinner.stop();

    if (this.lineBuffer.length > 0) {
      const rendered = this.markdown._renderInline(this.lineBuffer);
      this.screen.write(`${rendered}\n`);
      this.lineBuffer = '';
    }

    const outputTokens = usage?.outputTokens || 0;
    const hasOutput = this.textStarted || this.toolCount > 0 || outputTokens > 0;

    if (hasOutput && !this.assistantStarted) {
      this.screen.write(`\n${THEME.assistantIndicator}Assistant${ANSI.reset}\n`);
    }

    if (hasOutput) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const inputTokens = usage?.inputTokens || 0;
      const tokenInfo = outputTokens > 0 ? ` ${THEME.dim}${inputTokens.toLocaleString()}→${outputTokens.toLocaleString()} tokens${ANSI.reset}` : '';
      this.screen.write(`${THEME.dim}  ${elapsed}s${tokenInfo}${ANSI.reset}\n`);
    }

    if (this.lineOpen) {
      this.screen.write('\n');
      this.lineOpen = false;
    }

    this.assistantStarted = false;
    this.textStarted = false;
  }

  fail(message) {
    this.spinner.stop();
    if (!this.assistantStarted) {
      this.screen.write(`\n${THEME.assistantIndicator}Assistant${ANSI.reset}\n`);
      this.assistantStarted = true;
    }
    if (this.lineBuffer.length > 0) {
      this.screen.write(`${this.lineBuffer}\n`);
      this.lineBuffer = '';
    }
    this.screen.write(`${THEME.error}${message}${ANSI.reset}\n`);
    this.assistantStarted = false;
    this.textStarted = false;
  }

  interrupt() {
    this.spinner.stop();
    if (this.lineBuffer.length > 0) {
      this.screen.write(`${this.lineBuffer}\n`);
      this.lineBuffer = '';
    }
    this.screen.write(`${THEME.warning}Interrupted.${ANSI.reset}\n`);
    this.assistantStarted = false;
    this.textStarted = false;
  }

  reset() {
    this.assistantStarted = false;
    this.textStarted = false;
    this.lineOpen = false;
    this.lineBuffer = '';
    this.currentToolName = '';
    this.currentToolInput = {};
    this.thinkingSummary = '';
    this.toolCount = 0;
  }
}

function formatToolStart(chunk) {
  const label = toToolLabel(chunk.name);
  const inputSummary = formatToolInputSummary(chunk.name, chunk.input);
  const attemptLabel = chunk.attempt && chunk.attempt > 1 ? ` ${THEME.warning}(attempt ${chunk.attempt})${ANSI.reset}` : '';
  if (!inputSummary) return `${THEME.toolIndicator}${label}${ANSI.reset}${attemptLabel}`;
  return `${THEME.toolIndicator}${label}${ANSI.reset}${attemptLabel}${THEME.dim}${inputSummary}${ANSI.reset}`;
}

function formatToolInputSummary(name, input) {
  if (!input || typeof input !== 'object') return '';

  if (name === 'file.read') {
    return input.path ? `(${THEME.accent}${formatDisplayPath(input.path)}${ANSI.reset})` : '';
  }
  if (name === 'file.write') {
    return input.path ? `(${THEME.accent}${formatDisplayPath(input.path)}${ANSI.reset})` : '';
  }
  if (name === 'file.delete') {
    return input.path ? `(${THEME.accent}${formatDisplayPath(input.path)}${ANSI.reset})` : '';
  }
  if (name === 'file.glob') {
    const parts = [input.pattern ? `${THEME.accent}"${input.pattern}"${ANSI.reset}` : ''];
    if (input.cwd && input.cwd !== '.') parts.push(`${THEME.dim}in ${formatDisplayPath(input.cwd)}${ANSI.reset}`);
    return parts.filter(Boolean).length > 0 ? `(${parts.join(' ')})` : '';
  }
  if (name === 'file.search') {
    const parts = [input.query ? `${THEME.accent}"${input.query}"${ANSI.reset}` : ''];
    if (input.path && input.path !== '.') parts.push(`${THEME.dim}in ${formatDisplayPath(input.path)}${ANSI.reset}`);
    return parts.filter(Boolean).length > 0 ? `(${parts.join(' ')})` : '';
  }
  if (name === 'shell.run') {
    const command = [input.command, ...(Array.isArray(input.args) ? input.args : [])].filter(Boolean).join(' ');
    return command ? `(${THEME.codeText}${command}${ANSI.reset})` : '';
  }

  const visibleEntries = Object.entries(input)
    .filter(([key, val]) => isDisplayableInput(key, val))
    .slice(0, 2)
    .map(([key, val]) => `${key}: ${String(val).length > 40 ? String(val).slice(0, 37) + '...' : val}`);
  return visibleEntries.length > 0 ? `(${visibleEntries.join(', ')})` : '';
}

function formatToolResult(chunk) {
  const name = chunk.name;
  const duration = formatDuration(chunk.durationMs);

  if (chunk.isError) {
    const code = chunk.errorCode && chunk.errorCode !== 'TOOL_ERROR' ? `${chunk.errorCode}: ` : '';
    const message = chunk.error ? `${code}${chunk.error}` : `${code}tool failed`;
    const path = chunk.input?.path;
    const pathDisplay = path ? `(${THEME.accent}${formatDisplayPath(path)}${ANSI.reset})` : '';
    return `  ${THEME.toolError}✗ ${name}${pathDisplay} failed${THEME.dim}${duration}${ANSI.reset}\n    ${THEME.dim}└─ ${message}${ANSI.reset}`;
  }

  const detail = formatToolSuccessDetail(chunk);
  if (!detail) {
    return `  ${THEME.toolSuccess}✓ ${toToolLabel(name)} done${THEME.dim}${duration}${ANSI.reset}`;
  }

  return `  ${THEME.toolSuccess}✓ ${toToolLabel(name)}${THEME.dim}${duration}${ANSI.reset}\n    ${THEME.dim}${detail}${ANSI.reset}`;
}

function formatToolSuccessDetail(chunk) {
  const data = chunk.data || {};
  const name = chunk.name;

  if (name === 'file.read') {
    const content = data.content || '';
    const lineCount = content.split('\n').length;
    const byteSize = formatBytes(data.bytes);
    return `${THEME.accent}${formatDisplayPath(data.path)}${ANSI.reset} · ${byteSize} · ${lineCount} ${pluralize('line', lineCount)}`;
  }

  if (name === 'file.write') {
    const action = data.overwritten ? 'Updated' : 'Created';
    const change = data.change;
    const byteSize = formatBytes(data.bytes);

    if (change && change.operation === 'update') {
      const diffParts = [];
      if (change.added > 0) diffParts.push(`${THEME.diffAdd}+${change.added}${ANSI.reset}`);
      if (change.removed > 0) diffParts.push(`${THEME.diffRemove}-${change.removed}${ANSI.reset}`);
      return `${THEME.accent}${formatDisplayPath(data.path)}${ANSI.reset} · ${byteSize} (${diffParts.join(', ')})`;
    }
    return `${THEME.accent}${formatDisplayPath(data.path)}${ANSI.reset} · ${byteSize}`;
  }

  if (name === 'file.delete') {
    return `${THEME.accent}${formatDisplayPath(data.path)}${ANSI.reset} · ${formatBytes(data.bytes)} deleted`;
  }

  if (name === 'file.glob') {
    const matchCount = Array.isArray(data.matches) ? data.matches.length : 0;
    const truncated = data.truncated ? ' (truncated)' : '';
    return `${matchCount} ${pluralize('file', matchCount)}${truncated}`;
  }

  if (name === 'file.search') {
    const matchCount = Array.isArray(data.matches) ? data.matches.length : 0;
    const fileCount = new Set(Array.isArray(data.matches) ? data.matches.map(m => m.path) : []).size;
    const truncated = data.truncated ? ' (truncated)' : '';
    return `${matchCount} ${pluralize('match', matchCount)} in ${fileCount} ${pluralize('file', fileCount)}${truncated}`;
  }

  if (name === 'shell.run') {
    const parts = [];
    if (data.exitCode !== null && data.exitCode !== undefined) parts.push(`exit ${data.exitCode}`);
    if (data.signal) parts.push(`signal ${data.signal}`);
    if (data.timedOut) parts.push('timed out');
    const status = parts.length > 0 ? ` (${parts.join(', ')})` : '';

    if (data.stdout) {
      const output = data.stdout.trim();
      if (output.length > 0) {
        const lines = output.split('\n');
        const preview = lines.length > 5 ? lines.slice(0, 5).join('\n') + '\n    ...' : output;
        const display = preview.length > 300 ? preview.slice(0, 297) + '...' : preview;
        return `exit ${data.exitCode || 0}${status}\n    └─ ${display.replace(/\n/g, '\n    ')}`;
      }
    }
    if (data.stderr) {
      const errOut = data.stderr.trim();
      if (errOut.length > 0) {
        const preview = errOut.length > 200 ? `${errOut.slice(0, 197)}...` : errOut;
        return `exit ${data.exitCode || 0}${status}\n    ─ ${THEME.toolError}${preview}${ANSI.reset}`;
      }
    }
    return `completed${status}`;
  }

  return '';
}

function formatFileModificationNotice(chunk) {
  if (chunk.name !== 'file.write' || chunk.isError || !chunk.data?.path || !chunk.data?.change) {
    return null;
  }

  const change = chunk.data.change;
  const action = change.operation === 'create' ? 'Create' : 'Update';
  const pathDisplay = `${THEME.toolIndicator}${action}${ANSI.reset}(${THEME.accent}${formatDisplayPath(chunk.data.path)}${ANSI.reset})`;
  const lines = [
    pathDisplay,
    `  ${THEME.border}└─${ANSI.reset}  ${formatChangeSummary(change)}`,
  ];

  if (change.preview && Array.isArray(change.preview) && change.preview.length > 0) {
    const maxPreview = 6;
    const preview = change.preview.slice(0, maxPreview);
    for (const item of preview) {
      const lineNum = String(item.line).padStart(4);
      const marker = item.marker === '+' ? THEME.diffAdd : item.marker === '-' ? THEME.diffRemove : THEME.diffContext;
      const textColor = item.marker === '+' ? THEME.diffAdd : item.marker === '-' ? THEME.diffRemove : THEME.diffContext;
      lines.push(`    ${THEME.dim}${lineNum} ${ANSI.reset}${marker}${item.marker}${ANSI.reset} ${textColor}${item.text || ''}${ANSI.reset}`);
    }
    if (change.preview.length > maxPreview) {
      lines.push(`    ${THEME.dim}… +${change.preview.length - maxPreview} more ${pluralize('line', change.preview.length - maxPreview)}${ANSI.reset}`);
    }
  }

  return lines;
}

function formatChangeSummary(change) {
  const parts = [];
  if (change.added > 0) parts.push(`${THEME.diffAdd}Added ${change.added} ${pluralize('line', change.added)}${ANSI.reset}`);
  if (change.removed > 0) parts.push(`${THEME.diffRemove}Removed ${change.removed} ${pluralize('line', change.removed)}${ANSI.reset}`);
  if (parts.length === 0) {
    const changed = Number.isFinite(change.changed) && change.changed > 0 ? change.changed : 1;
    parts.push(`Modified ${changed} ${pluralize('line', changed)}`);
  }
  return parts.join(', ');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function formatDuration(durationMs) {
  return Number.isFinite(durationMs) ? ` in ${durationMs}ms` : '';
}

function formatDisplayPath(filePath) {
  return String(filePath).replace(/\//g, '\\');
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function toToolLabel(name) {
  return String(name || 'tool')
    .split('.')
    .map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function isDisplayableInput(key, value) {
  return !/key|token|secret|password|content|env/i.test(key) &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}

function formatProviderError(error, provider) {
  const message = error?.message || String(error);
  if (provider?.name === 'anthropic' && /\b(401|403|forbidden|unauthorized)\b/i.test(message)) {
    return `${message}\nCheck /api-key and /api-url, then try again.`;
  }
  return message;
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

module.exports = {
  ANSI,
  THEME,
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  SPINNER_VERBS,
  VERSION,
  CLAUDE_BANNER,
  TerminalScreen,
  Spinner,
  MarkdownRenderer,
  NullWritable,
  ResponseRenderer,
  formatToolStart,
  formatToolInputSummary,
  formatToolResult,
  formatToolSuccessDetail,
  formatFileModificationNotice,
  formatChangeSummary,
  formatBytes,
  formatDuration,
  formatDisplayPath,
  pluralize,
  toToolLabel,
  isDisplayableInput,
  formatProviderError,
  stripAnsi,
};
