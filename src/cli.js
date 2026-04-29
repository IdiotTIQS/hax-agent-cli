#!/usr/bin/env node

const readline = require('readline');
const { loadSettings, updateUserSettings } = require('./config');
const { appendTranscriptEntry, createSessionId, listSessions, readTranscript } = require('./memory');
const { createProvider } = require('./providers');
const { createAuthRefactorTeam } = require('./teams/auth-refactor');
const { formatTeamPlan } = require('./formatters/team-plan');
const { createLocalToolRegistry } = require('./tools');

const VERSION = '0.2.0';

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
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

const SPINNER_VERBS = [
  'Thinking', 'Analyzing', 'Processing', 'Reasoning', 'Computing',
  'Evaluating', 'Generating', 'Considering', 'Examining', 'Planning',
];

const CLAUDE_BANNER = [
  '',
  `${THEME.accent}     ╭──────────────────────────────────────────╮${ANSI.reset}`,
  `${THEME.accent}     │${ANSI.reset}  ${THEME.bold}ʜᴀx ᴀɢᴇɴᴛ${ANSI.reset}  ${THEME.dim}v${VERSION}${ANSI.reset}                    ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}     │${ANSI.reset}  ${THEME.dim}AI-powered coding assistant${ANSI.reset}            ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}     ╰──────────────────────────────────────────╯${ANSI.reset}`,
  '',
];

const SLASH_COMMANDS = [
  { name: 'help', description: 'Show available commands and shortcuts', aliases: ['h', '?'] },
  { name: 'exit', description: 'Exit the session', aliases: ['q', 'quit'] },
  { name: 'clear', description: 'Clear conversation and start fresh', aliases: ['c'] },
  { name: 'compact', description: 'Compact conversation to reduce context', aliases: [] },
  { name: 'tools', description: 'List available tools', aliases: ['t'] },
  { name: 'agents', description: 'List available agents', aliases: ['a'] },
  { name: 'models', description: 'List available models', aliases: ['m'] },
  { name: 'model', description: 'Switch the active model', aliases: [], argHint: '<model-id-or-number>' },
  { name: 'api-url', description: 'Show or set the API base URL', aliases: [], argHint: '<base-url>' },
  { name: 'api-key', description: 'Show or set the API key', aliases: [], argHint: '<key>' },
  { name: 'cost', description: 'Show token usage and cost for this session', aliases: [] },
  { name: 'sessions', description: 'List previous sessions', aliases: ['s'] },
  { name: 'resume', description: 'Resume a previous session', aliases: ['r'], argHint: '<session-id>' },
  { name: 'config', description: 'Show current configuration', aliases: [] },
  { name: 'doctor', description: 'Run diagnostics and check setup', aliases: [] },
  { name: 'theme', description: 'Toggle color theme', aliases: [] },
  { name: 'vim', description: 'Toggle vim keybindings mode', aliases: [] },
  { name: 'memory', description: 'Manage agent memory', aliases: [], argHint: '[list|read|write|delete] [name]' },
];

const AGENTS = [
  { name: 'explore', description: 'Map code paths and summarize findings', icon: '🔍' },
  { name: 'implement', description: 'Make focused code changes', icon: '✏️' },
  { name: 'review', description: 'Check changes for bugs and regressions', icon: '🔎' },
  { name: 'test', description: 'Run validation and report failures', icon: '🧪' },
];

const TOP_LEVEL_COMMANDS = [
  { name: 'chat', description: 'Start the interactive agent shell (default)', aliases: [] },
  { name: 'help', description: 'Show available commands', aliases: ['--help', '-h'] },
  { name: 'models', description: 'List available provider models', aliases: [] },
  { name: 'team', description: 'Create an agent team plan', aliases: [], argHint: 'auth-refactor' },
  { name: 'version', description: 'Show version information', aliases: ['-v', '--version'] },
  { name: 'resume', description: 'Resume a previous session', aliases: ['-r'], argHint: '[session-id]' },
  { name: 'sessions', description: 'List previous sessions', aliases: [] },
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

class InputHistory {
  constructor(maxSize = 1000) {
    this.entries = [];
    this.maxSize = maxSize;
    this.index = -1;
    this.partial = '';
  }

  add(entry) {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (this.entries.length > 0 && this.entries[0] === trimmed) return;
    this.entries.unshift(trimmed);
    if (this.entries.length > this.maxSize) this.entries.pop();
    this.index = -1;
    this.partial = '';
  }

  up(current) {
    if (this.entries.length === 0) return current;
    if (this.index === -1) {
      this.partial = current;
      this.index = 0;
    } else if (this.index < this.entries.length - 1) {
      this.index += 1;
    }
    return this.entries[this.index];
  }

  down(current) {
    if (this.index === -1) return current;
    if (this.index === 0) {
      this.index = -1;
      return this.partial;
    }
    this.index -= 1;
    return this.entries[this.index];
  }

  reset() {
    this.index = -1;
    this.partial = '';
  }

  search(query) {
    if (!query) return [];
    const lower = query.toLowerCase();
    return this.entries.filter(e => e.toLowerCase().includes(lower)).slice(0, 10);
  }
}

class CostTracker {
  constructor() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheCreationTokens = 0;
    this.cacheReadTokens = 0;
    this.turnCount = 0;
    this.toolCallCount = 0;
    this.startTime = Date.now();
    this.pricing = {
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
      'claude-opus-4-7': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
      'claude-haiku-3-5-20241022': { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
    };
  }

  addUsage(usage, model) {
    if (!usage) return;
    this.inputTokens += usage.input_tokens || 0;
    this.outputTokens += usage.output_tokens || 0;
    this.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
    this.cacheReadTokens += usage.cache_read_input_tokens || 0;
    this.turnCount += 1;
  }

  addToolCall() {
    this.toolCallCount += 1;
  }

  getCost(model) {
    const p = this.pricing[model] || this.pricing['claude-sonnet-4-20250514'];
    const inputCost = (this.inputTokens / 1_000_000) * p.input;
    const outputCost = (this.outputTokens / 1_000_000) * p.output;
    const cacheWriteCost = (this.cacheCreationTokens / 1_000_000) * p.cacheWrite;
    const cacheReadCost = (this.cacheReadTokens / 1_000_000) * p.cacheRead;
    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  formatSummary(model) {
    const cost = this.getCost(model);
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return [
      `${THEME.heading}Session Statistics${ANSI.reset}`,
      `${THEME.border}──────────────────────────────────${ANSI.reset}`,
      `  ${THEME.dim}Duration:${ANSI.reset}       ${timeStr}`,
      `  ${THEME.dim}Turns:${ANSI.reset}         ${this.turnCount}`,
      `  ${THEME.dim}Tool calls:${ANSI.reset}    ${this.toolCallCount}`,
      `  ${THEME.dim}Input tokens:${ANSI.reset}   ${formatNumber(this.inputTokens)}`,
      `  ${THEME.dim}Output tokens:${ANSI.reset}  ${formatNumber(this.outputTokens)}`,
      this.cacheCreationTokens > 0 ? `  ${THEME.dim}Cache write:${ANSI.reset}   ${formatNumber(this.cacheCreationTokens)}` : null,
      this.cacheReadTokens > 0 ? `  ${THEME.dim}Cache read:${ANSI.reset}    ${formatNumber(this.cacheReadTokens)}` : null,
      `  ${THEME.cost}Estimated cost:${ANSI.reset} $${cost.toFixed(4)}`,
    ].filter(Boolean).join('\n');
  }
}

class SmartInput {
  constructor(screen, options = {}) {
    this.screen = screen;
    this.history = new InputHistory(options.historySize || 1000);
    this.buffer = '';
    this.cursorPos = 0;
    this.slashCommands = options.slashCommands || [];
    this.onSubmit = options.onSubmit || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.onInterrupt = options.onInterrupt || (() => {});
    this.onSlashCommand = options.onSlashCommand || (() => {});
    this.multiline = false;
    this.multilineBuffer = [];
    this.tabCompletion = options.tabCompletion || null;
    this.enabled = false;
    this.rl = null;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.screen.showCursor();
    this._createReadline();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  _createReadline() {
    if (this.rl) this.rl.close();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: new NullWritable(),
      terminal: true,
    });

    this.rl.on('line', (line) => this._handleLine(line));
    this.rl.on('close', () => {
      if (this.enabled) this._createReadline();
    });

    this._renderPrompt();
  }

  _renderPrompt() {
    if (!this.enabled) return;

    const promptChar = this.multiline ? '…' : '>';
    const prefix = `${THEME.promptPrefix}${promptChar}${ANSI.reset} `;

    this.screen.write(`\r${ANSI.clearLine}${prefix}`);
    this.screen.write(this._renderBuffer());
    this.screen.write(ANSI.clearLineRight);

    const displayLen = stripAnsi(prefix).length + this.cursorPos;
    this.screen.write(`\r${ANSI.cursorRight(stripAnsi(prefix).length + this.cursorPos)}`);
  }

  _renderBuffer() {
    if (this.buffer.length === 0) return '';
    const before = this.buffer.slice(0, this.cursorPos);
    const after = this.buffer.slice(this.cursorPos);
    return `${before}${after}`;
  }

  _handleLine(line) {
    if (!this.enabled) return;

    const input = this.buffer + line;
    this.buffer = '';
    this.cursorPos = 0;

    if (this.multiline) {
      if (line.trim() === '') {
        this.multiline = false;
        const fullInput = this.multilineBuffer.join('\n');
        this.multilineBuffer = [];
        this._submit(fullInput);
      } else {
        this.multilineBuffer.push(line);
        this.screen.write(`\n${THEME.promptPrefix}…${ANSI.reset} `);
      }
      return;
    }

    this._submit(input);
  }

  _submit(input) {
    const trimmed = input.trim();
    if (!trimmed) {
      this._renderPrompt();
      return;
    }

    this.history.add(trimmed);

    if (trimmed.startsWith('/')) {
      this.onSlashCommand(trimmed);
    } else {
      this.onSubmit(trimmed);
    }
  }

  setBuffer(text) {
    this.buffer = text;
    this.cursorPos = text.length;
    this._renderPrompt();
  }

  clearBuffer() {
    this.buffer = '';
    this.cursorPos = 0;
    this._renderPrompt();
  }

  insertText(text) {
    const before = this.buffer.slice(0, this.cursorPos);
    const after = this.buffer.slice(this.cursorPos);
    this.buffer = before + text + after;
    this.cursorPos += text.length;
    this._renderPrompt();
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

    if (!this.assistantStarted) {
      this.screen.write(`\n${THEME.assistantIndicator}Assistant${ANSI.reset}\n`);
    }

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const inputTokens = usage?.inputTokens || 0;
    const outputTokens = usage?.outputTokens || 0;
    const tokenInfo = outputTokens > 0 ? ` ${THEME.dim}${formatNumber(inputTokens)}→${formatNumber(outputTokens)} tokens${ANSI.reset}` : '';
    this.screen.write(`${THEME.dim}  ${elapsed}s${tokenInfo}${ANSI.reset}\n`);

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

class Session {
  constructor(options = {}) {
    this.id = createSessionId();
    this.messages = [];
    this.provider = options.provider;
    this.settings = options.settings;
    this.toolRegistry = options.toolRegistry;
    this.costTracker = new CostTracker();
    this.shouldExit = false;
    this.isStreaming = false;
    this.pendingExit = false;
    this.responseAbortController = null;
    this.responseRenderer = null;
    this.responseInterrupted = false;
    this.availableModels = undefined;
    this.startTime = Date.now();
  }

  getElapsedTime() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  }

  getStatusLine() {
    const provider = this.provider?.name || 'provider';
    const model = this.provider?.model || 'model';
    const cost = this.costTracker.getCost(model);
    const turns = this.costTracker.turnCount;
    const elapsed = this.getElapsedTime();
    return `${THEME.dim}${provider}${ANSI.reset} · ${THEME.dim}${model}${ANSI.reset} · ${THEME.cost}$${cost.toFixed(4)}${ANSI.reset} · ${THEME.dim}${turns} turns${ANSI.reset} · ${THEME.dim}${elapsed}${ANSI.reset}`;
  }
}

async function main(argv) {
  const [commandName = 'chat', ...args] = argv;

  if (commandName === '-h' || commandName === '--help') {
    showHelp();
    return;
  }

  if (commandName === '-v' || commandName === '--version' || commandName === 'version') {
    console.log(`${VERSION} (Hax Agent)`);
    return;
  }

  const command = TOP_LEVEL_COMMANDS.find(c => c.name === commandName || c.aliases?.includes(commandName));

  if (!command) {
    console.error(`${THEME.error}Unknown command: ${commandName}${ANSI.reset}`);
    showHelp();
    process.exitCode = 1;
    return;
  }

  switch (command.name) {
    case 'chat': await runShell(args); break;
    case 'models': await runModelsCommand(); break;
    case 'team': runTeamCommand(args); break;
    case 'resume': await runResumeCommand(args); break;
    case 'sessions': await runSessionsCommand(); break;
    default: showHelp();
  }
}

async function runShell(args) {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  const screen = new TerminalScreen();
  const markdown = new MarkdownRenderer(screen.columns);
  const session = new Session({ provider, settings, toolRegistry: createLocalToolRegistry({ root: process.cwd(), shellPolicy: settings.tools?.shell }) });

  if (!screen.isTTY()) {
    await runNonInteractiveShell(session, screen, markdown);
    return;
  }

  screen.activate();

  const cleanup = () => {
    screen.deactivate();
    process.exit(0);
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.setPrompt(`${THEME.promptPrefix}>${ANSI.reset} `);

  renderBanner(screen, session);

  if (provider.name === 'mock' || provider.name === 'local') {
    screen.write(`${THEME.warning}⚠ Local mock mode is active. Set /api-url and /api-key to chat with a real model.${ANSI.reset}\n\n`);
  }

  renderStatusLine(screen, session);
  rl.prompt();

  function handleInterrupt() {
    if (session.isStreaming) {
      session.isStreaming = false;
      session.responseInterrupted = true;
      session.pendingExit = false;
      session.responseAbortController?.abort();
      session.responseRenderer?.interrupt();
      return;
    }

    if (session.pendingExit) {
      screen.write(`\n${THEME.dim}Goodbye.${ANSI.reset}\n`);
      screen.deactivate();
      rl.close();
      process.exit(0);
    }

    session.pendingExit = true;
    screen.write(`${THEME.dim}Press Ctrl+C again to exit, or type /exit.${ANSI.reset}\n`);
    renderStatusLine(screen, session);
  }

  rl.on('SIGINT', handleInterrupt);
  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    session.pendingExit = false;

    if (trimmed.startsWith('/')) {
      screen.write(`${ANSI.cursorUp}\r${ANSI.clearLine}`);
      await handleSlashCommand(trimmed, { screen, session, markdown });
    } else {
      screen.write(`${ANSI.cursorUp}\r${ANSI.clearLine}`);
      screen.write(`${THEME.userIndicator}You${ANSI.reset} ${THEME.dim}${new Date().toLocaleTimeString()}${ANSI.reset}\n`);
      screen.write(`${trimmed}\n\n`);
      await handleChatMessage(trimmed, { screen, session, markdown });
    }

    if (session.shouldExit) {
      screen.write(`\n${THEME.dim}Goodbye.${ANSI.reset}\n`);
      screen.deactivate();
      rl.close();
      process.exit(0);
    }

    rl.prompt();
  });

  process.stdin.on('keypress', (char, key) => {
    if (!key) return;

    if (key.name === 'l' && key.ctrl) {
      screen.clear();
      renderBanner(screen, session);
      renderStatusLine(screen, session);
      rl.prompt();
      return;
    }
  });

  await new Promise(() => {});
}

async function runNonInteractiveShell(session, screen, markdown) {
  const rl = readline.createInterface({ input: process.stdin });

  screen.write(`${THEME.accent}Hax Agent${ANSI.reset} ${THEME.dim}v${VERSION}${ANSI.reset}\n`);
  screen.write(`${THEME.dim}Type /help for commands, /exit to quit${ANSI.reset}\n`);

  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    screen.write(`${THEME.warning}Local mock mode is active. Set /api-url and /api-key to chat with a real model.${ANSI.reset}\n`);
  }

  loadRecentTranscript(session);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed, { screen, session, markdown });
    } else {
      screen.write(`You: ${trimmed}\n`);
      await handleChatMessage(trimmed, { screen, session, markdown });
    }

    if (session.shouldExit) break;
  }

  rl.close();
}

function loadRecentTranscript(session) {
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) return;

  const latestSession = sessions[0];
  const entries = latestSession.entries();
  const limit = session.settings.prompts?.maxTranscriptMessages || 20;
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-limit)
    .map(e => ({ role: e.role, content: e.content || '' }));

  if (restored.length > 0) {
    session.messages = restored;
    session.id = latestSession.id;
  }
}

function renderBanner(screen, session) {
  for (const line of CLAUDE_BANNER) {
    screen.write(`${line}\n`);
  }

  const provider = session.provider?.name || 'provider';
  const model = session.provider?.model || 'model';
  screen.write(`${THEME.dim}  Model: ${model} · Provider: ${provider}${ANSI.reset}\n`);
  screen.write(`${THEME.dim}  Type /help for commands, /exit to quit${ANSI.reset}\n\n`);
}

function renderStatusLine(screen, session) {
  const width = screen.columns || 80;
  const statusText = stripAnsi(session.getStatusLine());
  const statusLen = statusText.length;
  const padding = Math.max(0, width - statusLen - 2);

  screen.write(`\r${ANSI.clearLine}`);
  screen.write(`${THEME.statusLine} ${session.getStatusLine()} ${' '.repeat(padding)}${ANSI.reset}\n`);
}

function renderPromptLine(screen) {
  screen.write(`${THEME.promptPrefix}>${ANSI.reset} `);
}

async function handleChatMessage(content, { screen, session, markdown }) {
  const userMessage = { role: 'user', content };
  const abortController = new AbortController();
  const renderer = new ResponseRenderer(screen, markdown);
  let assistantText = '';

  session.messages.push(userMessage);
  session.isStreaming = true;
  session.responseInterrupted = false;
  session.responseAbortController = abortController;
  session.responseRenderer = renderer;
  renderer.startWaiting();
  const turnInputTokens = session.costTracker.inputTokens;
  const turnOutputTokens = session.costTracker.outputTokens;

  try {
    let toolLimitReached = false;

    for await (const chunk of session.provider.stream({
      messages: session.messages,
      toolRegistry: session.toolRegistry,
      signal: abortController.signal,
    })) {
      if (session.responseInterrupted) break;

      if (chunk.type === 'text') {
        assistantText += chunk.delta;
        renderer.writeText(chunk.delta);

        if (process.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === '1') {
          session.responseInterrupted = true;
          renderer.interrupt();
          break;
        }
      } else if (chunk.type === 'thinking') {
        renderer.thinking(chunk);
      } else if (chunk.type === 'tool_start') {
        session.costTracker.addToolCall();
        renderer.startTool(chunk);
      } else if (chunk.type === 'tool_result') {
        renderer.finishTool(chunk);
      } else if (chunk.type === 'tool_limit') {
        toolLimitReached = true;
        renderer.notice(`Tool turn limit reached after ${chunk.maxToolTurns} turns. Continuing automatically...`);
      } else if (chunk.type === 'usage') {
        session.costTracker.addUsage(chunk, session.provider.model);
      }
    }

    if (toolLimitReached && !session.responseInterrupted) {
      renderer.notice('Continuing with the next batch of tool calls...');
      for await (const chunk of session.provider.stream({
        messages: session.messages,
        toolRegistry: session.toolRegistry,
        signal: abortController.signal,
      })) {
        if (session.responseInterrupted) break;

        if (chunk.type === 'text') {
          assistantText += chunk.delta;
          renderer.writeText(chunk.delta);
        } else if (chunk.type === 'thinking') {
          renderer.thinking(chunk);
        } else if (chunk.type === 'tool_start') {
          session.costTracker.addToolCall();
          renderer.startTool(chunk);
        } else if (chunk.type === 'tool_result') {
          renderer.finishTool(chunk);
        } else if (chunk.type === 'tool_limit') {
          renderer.notice('Tool turn limit reached again. Ask me to continue if you need more.');
        } else if (chunk.type === 'usage') {
          session.costTracker.addUsage(chunk, session.provider.model);
        }
      }
    }
  } catch (error) {
    if (session.responseInterrupted || error?.name === 'AbortError') {
      session.messages.pop();
      return;
    }

    renderer.fail(formatProviderError(error, session.provider));
    session.messages.pop();
    return;
  } finally {
    session.isStreaming = false;
    session.responseAbortController = null;
    session.responseRenderer = null;
  }

  if (session.responseInterrupted) {
    session.messages.pop();
    return;
  }

  const turnUsage = {
    inputTokens: session.costTracker.inputTokens - turnInputTokens,
    outputTokens: session.costTracker.outputTokens - turnOutputTokens,
  };

  renderer.complete(turnUsage);
  session.messages.push({ role: 'assistant', content: assistantText });
  appendTranscriptEntry(session.id, userMessage, session.settings);
  appendTranscriptEntry(session.id, { role: 'assistant', content: assistantText }, session.settings);
}

async function handleSlashCommand(line, context) {
  const [commandName, ...args] = line.slice(1).split(/\s+/);

  const command = SLASH_COMMANDS.find(c =>
    c.name === commandName || c.aliases?.includes(commandName)
  );

  if (!command) {
    context.screen.write(`${THEME.error}Unknown command: /${commandName}${ANSI.reset}\n`);
    context.screen.write(`${THEME.dim}Type /help for available commands.${ANSI.reset}\n`);
    return;
  }

  switch (command.name) {
    case 'help': showShellHelp(context); break;
    case 'exit': exitShell(context); break;
    case 'clear': clearShell(context); break;
    case 'compact': compactShell(context); break;
    case 'tools': showTools(context); break;
    case 'agents': showAgents(context); break;
    case 'models': await showModels(context); break;
    case 'model': await switchModel(args, context); break;
    case 'api-url': await switchApiUrl(args, context); break;
    case 'api-key': await switchApiKey(args, context); break;
    case 'cost': showCost(context); break;
    case 'sessions': await showSessions(context); break;
    case 'resume': await resumeSession(args, context); break;
    case 'config': showConfig(context); break;
    case 'doctor': runDoctor(context); break;
    case 'theme': toggleTheme(context); break;
    case 'vim': toggleVim(context); break;
    case 'memory': handleMemoryCommand(args, context); break;
    default:
      context.screen.write(`${THEME.error}Command not implemented: /${command.name}${ANSI.reset}\n`);
  }
}

function showShellHelp({ screen }) {
  const width = Math.min(screen.columns || 80, 80);
  const borderLine = THEME.border + '─'.repeat(width - 2) + ANSI.reset;

  screen.write(`\n${THEME.heading}Commands${ANSI.reset}\n`);
  screen.write(`${borderLine}\n`);

  for (const cmd of SLASH_COMMANDS) {
    const aliases = cmd.aliases.length > 0 ? ` ${THEME.dim}(${cmd.aliases.map(a => `/${a}`).join(', ')})${ANSI.reset}` : '';
    const argHint = cmd.argHint ? ` ${THEME.dim}${cmd.argHint}${ANSI.reset}` : '';
    const nameCol = `/${cmd.name}`.padEnd(14);
    screen.write(`  ${THEME.promptPrefix}${nameCol}${ANSI.reset} ${cmd.description}${aliases}${argHint}\n`);
  }

  screen.write(`\n${THEME.heading}Keyboard Shortcuts${ANSI.reset}\n`);
  screen.write(`${borderLine}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+C${ANSI.reset}       ${THEME.dim}Interrupt or exit${ANSI.reset}\n`);
  screen.write(`  ${THEME.promptPrefix}Ctrl+L${ANSI.reset}       ${THEME.dim}Clear screen${ANSI.reset}\n`);
  screen.write(`  ${THEME.promptPrefix}↑ / ↓${ANSI.reset}         ${THEME.dim}Navigate input history${ANSI.reset}\n`);
  screen.write(`  ${THEME.promptPrefix}Enter${ANSI.reset}         ${THEME.dim}Send message${ANSI.reset}\n`);
  screen.write(`  ${THEME.promptPrefix}!command${ANSI.reset}      ${THEME.dim}Run a shell command directly${ANSI.reset}\n`);
  screen.write('\n');
}

function exitShell({ screen, session }) {
  session.shouldExit = true;
  const cost = session.costTracker.getCost(session.provider?.model);
  screen.write(`${THEME.success}Session ended.${ANSI.reset} ${THEME.dim}Cost: $${cost.toFixed(4)} · Turns: ${session.costTracker.turnCount}${ANSI.reset}\n`);
}

function clearShell({ screen, session }) {
  const oldMessages = session.messages;
  session.messages = [];
  session.id = createSessionId();
  session.costTracker = new CostTracker();
  screen.clear();
  renderBanner(screen, session);
  screen.write(`${THEME.success}Context cleared.${ANSI.reset}\n\n`);
}

function compactShell({ screen, session }) {
  const keepCount = Math.min(session.messages.length, 6);
  const removed = session.messages.length - keepCount;
  session.messages = session.messages.slice(-keepCount);
  screen.write(`${THEME.success}Compacted.${ANSI.reset} ${THEME.dim}Kept last ${keepCount} messages, removed ${removed}.${ANSI.reset}\n\n`);
}

function showTools({ screen, session }) {
  screen.write(`\n${THEME.heading}Available Tools${ANSI.reset}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);

  for (const tool of session.toolRegistry.list()) {
    const nameCol = tool.name.padEnd(14);
    screen.write(`  ${THEME.toolIndicator}${nameCol}${ANSI.reset} ${tool.description}\n`);
  }
  screen.write('\n');
}

function showAgents({ screen }) {
  screen.write(`\n${THEME.heading}Available Agents${ANSI.reset}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);

  for (const agent of AGENTS) {
    const nameCol = agent.name.padEnd(14);
    screen.write(`  ${agent.icon} ${THEME.accent}${nameCol}${ANSI.reset} ${agent.description}\n`);
  }
  screen.write('\n');
}

async function showModels({ screen, session }) {
  session.availableModels = await printModels(session.provider, screen);
}

async function switchModel(args, { screen, session }) {
  const [selection] = args;

  if (!selection) {
    screen.write(`${THEME.dim}Current model: ${ANSI.reset}${THEME.bold}${session.provider.model || 'unknown'}${ANSI.reset}\n`);
    screen.write(`${THEME.dim}Usage: /model <model-id-or-number>${ANSI.reset}\n`);
    return;
  }

  const model = resolveModelSelection(selection, session.availableModels || []);
  session.provider.setModel(model);
  screen.write(`${THEME.success}Switched model to ${session.provider.model}${ANSI.reset}\n`);
}

async function switchApiUrl(args, { screen, session }) {
  const [apiUrl] = args;

  if (!apiUrl) {
    screen.write(`${THEME.dim}Current API URL: ${ANSI.reset}${session.provider.apiUrl || 'default'}\n`);
    screen.write(`${THEME.dim}Usage: /api-url <base-url>${ANSI.reset}\n`);
    return;
  }

  session.provider.setApiUrl(apiUrl);
  persistAgentSettings({ apiUrl: session.provider.apiUrl });
  session.availableModels = undefined;
  screen.write(`${THEME.success}Switched API URL to ${session.provider.apiUrl || 'default'}${ANSI.reset}\n`);
}

async function switchApiKey(args, { screen, session }) {
  const [apiKey] = args;

  if (!apiKey) {
    screen.write(`${THEME.dim}API key: ${ANSI.reset}${session.provider.apiKey ? `${THEME.success}set${ANSI.reset}` : `${THEME.warning}not set${ANSI.reset}`}\n`);
    screen.write(`${THEME.dim}Usage: /api-key <key>${ANSI.reset}\n`);
    return;
  }

  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    session.provider = createProvider({
      provider: 'anthropic',
      apiKey,
      apiUrl: session.provider.apiUrl,
      model: session.provider.model,
    }, process.env);
  } else {
    session.provider.setApiKey(apiKey);
  }

  persistAgentSettings({
    provider: session.provider.name,
    apiKey: session.provider.apiKey,
    apiUrl: session.provider.apiUrl,
    model: session.provider.model,
  });
  session.availableModels = undefined;
  screen.write(`${THEME.success}API key set for ${session.provider.name}.${ANSI.reset}\n`);
}

function showCost({ screen, session }) {
  screen.write(`\n${session.costTracker.formatSummary(session.provider?.model)}\n\n`);
}

async function showSessions({ screen, session }) {
  const sessions = listSessions(session.settings);
  if (sessions.length === 0) {
    screen.write(`${THEME.dim}No previous sessions found.${ANSI.reset}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Previous Sessions${ANSI.reset}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);

  for (const s of sessions.slice(0, 20)) {
    const entries = s.entries();
    const userMessages = entries.filter(e => e.role === 'user');
    const firstMsg = userMessages[0]?.content || '(empty)';
    const preview = firstMsg.length > 50 ? firstMsg.slice(0, 47) + '...' : firstMsg;
    const date = new Date(s.updatedAt).toLocaleDateString();
    screen.write(`  ${THEME.dim}${s.id.slice(0, 20)}${ANSI.reset}  ${THEME.dim}${date}${ANSI.reset}  ${preview}\n`);
  }
  screen.write('\n');
}

async function resumeSession(args, { screen, session }) {
  const [sessionId] = args;
  const sessions = listSessions(session.settings);

  if (sessions.length === 0) {
    screen.write(`${THEME.warning}No previous sessions found.${ANSI.reset}\n`);
    return;
  }

  let targetSession;
  if (sessionId) {
    targetSession = sessions.find(s => s.id.startsWith(sessionId));
  } else {
    targetSession = sessions[0];
  }

  if (!targetSession) {
    screen.write(`${THEME.error}Session not found: ${sessionId}${ANSI.reset}\n`);
    return;
  }

  const entries = targetSession.entries();
  const limit = session.settings.prompts?.maxTranscriptMessages || 20;
  const restored = entries
    .filter(e => e.role === 'user' || e.role === 'assistant')
    .slice(-limit)
    .map(e => ({ role: e.role, content: e.content || '' }));

  session.messages = restored;
  session.id = targetSession.id;
  screen.write(`${THEME.success}Resumed session ${targetSession.id.slice(0, 20)}${ANSI.reset} ${THEME.dim}(${restored.length} messages restored)${ANSI.reset}\n\n`);
}

function showConfig({ screen, session }) {
  const settings = session.settings;
  screen.write(`\n${THEME.heading}Configuration${ANSI.reset}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);
  screen.write(`  ${THEME.dim}Provider:${ANSI.reset}     ${session.provider.name}\n`);
  screen.write(`  ${THEME.dim}Model:${ANSI.reset}       ${session.provider.model}\n`);
  screen.write(`  ${THEME.dim}API URL:${ANSI.reset}     ${session.provider.apiUrl || 'default'}\n`);
  screen.write(`  ${THEME.dim}API Key:${ANSI.reset}     ${session.provider.apiKey ? '●●●●●●●●' : 'not set'}\n`);
  screen.write(`  ${THEME.dim}Max Turns:${ANSI.reset}    ${settings.agent?.maxTurns || 20}\n`);
  screen.write(`  ${THEME.dim}Temperature:${ANSI.reset}  ${settings.agent?.temperature || 0.2}\n`);
  screen.write(`  ${THEME.dim}Project Root:${ANSI.reset} ${settings.projectRoot || process.cwd()}\n`);
  screen.write(`  ${THEME.dim}Shell:${ANSI.reset}        ${settings.tools?.shell?.enabled ? 'enabled' : 'disabled'}\n`);
  screen.write('\n');
}

function runDoctor({ screen, session }) {
  screen.write(`\n${THEME.heading}Diagnostics${ANSI.reset}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);

  const checks = [
    { name: 'Node.js', check: () => process.version },
    { name: 'Provider', check: () => session.provider.name },
    { name: 'Model', check: () => session.provider.model },
    { name: 'API Key', check: () => session.provider.apiKey ? `${THEME.success}✓ set${ANSI.reset}` : `${THEME.error}✗ not set${ANSI.reset}` },
    { name: 'API URL', check: () => session.provider.apiUrl || 'default' },
    { name: 'Shell Tool', check: () => session.settings.tools?.shell?.enabled ? `${THEME.success}✓ enabled${ANSI.reset}` : `${THEME.warning}✗ disabled${ANSI.reset}` },
    { name: 'TTY', check: () => screen.isTTY() ? `${THEME.success}✓ yes${ANSI.reset}` : `${THEME.warning}✗ no${ANSI.reset}` },
    { name: 'Terminal', check: () => `${process.stdout.columns}x${process.stdout.rows}` },
    { name: 'Session ID', check: () => session.id.slice(0, 20) },
  ];

  for (const { name, check } of checks) {
    const result = check();
    screen.write(`  ${THEME.dim}${name.padEnd(14)}${ANSI.reset} ${result}\n`);
  }
  screen.write('\n');
}

let themeEnabled = true;
function toggleTheme({ screen }) {
  themeEnabled = !themeEnabled;
  screen.write(`${THEME.success}Theme ${themeEnabled ? 'enabled' : 'disabled'}.${ANSI.reset}\n`);
}

let vimMode = false;
function toggleVim({ screen }) {
  vimMode = !vimMode;
  screen.write(`${THEME.success}Vim mode ${vimMode ? 'enabled' : 'disabled'}.${ANSI.reset}\n`);
}

function handleMemoryCommand(args, { screen, session }) {
  const { listMemories, readMemory, writeMemory, deleteMemory } = require('./memory');
  const [subCommand, ...subArgs] = args;

  switch (subCommand) {
    case 'list':
    case undefined: {
      const memories = listMemories(session.settings);
      if (memories.length === 0) {
        screen.write(`${THEME.dim}No memories stored.${ANSI.reset}\n`);
        return;
      }
      screen.write(`\n${THEME.heading}Memories${ANSI.reset}\n`);
      for (const mem of memories) {
        screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset} ${THEME.dim}${mem.updatedAt ? new Date(mem.updatedAt).toLocaleDateString() : ''}${ANSI.reset}\n`);
      }
      screen.write('\n');
      break;
    }
    case 'read': {
      const [name] = subArgs;
      if (!name) {
        screen.write(`${THEME.dim}Usage: /memory read <name>${ANSI.reset}\n`);
        return;
      }
      const mem = readMemory(name, session.settings);
      if (!mem) {
        screen.write(`${THEME.warning}Memory not found: ${name}${ANSI.reset}\n`);
        return;
      }
      screen.write(`${THEME.heading}${mem.name}${ANSI.reset}\n${mem.content}\n\n`);
      break;
    }
    case 'write': {
      const [name, ...contentParts] = subArgs;
      if (!name || contentParts.length === 0) {
        screen.write(`${THEME.dim}Usage: /memory write <name> <content>${ANSI.reset}\n`);
        return;
      }
      writeMemory(name, contentParts.join(' '), session.settings);
      screen.write(`${THEME.success}Memory saved: ${name}${ANSI.reset}\n`);
      break;
    }
    case 'delete': {
      const [name] = subArgs;
      if (!name) {
        screen.write(`${THEME.dim}Usage: /memory delete <name>${ANSI.reset}\n`);
        return;
      }
      const deleted = deleteMemory(name, session.settings);
      screen.write(deleted ? `${THEME.success}Memory deleted: ${name}${ANSI.reset}\n` : `${THEME.warning}Memory not found: ${name}${ANSI.reset}\n`);
      break;
    }
    default:
      screen.write(`${THEME.error}Unknown memory command: ${subCommand}${ANSI.reset}\n`);
      screen.write(`${THEME.dim}Usage: /memory [list|read|write|delete]${ANSI.reset}\n`);
  }
}

async function runModelsCommand() {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  await printModels(provider, { write: (t) => process.stdout.write(t), isInteractive: () => true });
}

function runTeamCommand(args) {
  const [teamName] = args;
  if (teamName !== 'auth-refactor') {
    console.error('Usage: hax-agent team auth-refactor');
    process.exitCode = 1;
    return;
  }
  const team = createAuthRefactorTeam();
  console.log(formatTeamPlan(team));
}

async function runResumeCommand(args) {
  const settings = loadSettings();
  const sessions = listSessions(settings);
  const [sessionId] = args;

  if (sessions.length === 0) {
    console.error('No previous sessions found.');
    process.exitCode = 1;
    return;
  }

  const target = sessionId
    ? sessions.find(s => s.id.startsWith(sessionId))
    : sessions[0];

  if (!target) {
    console.error(`Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Resuming session: ${target.id}`);
  await runShell([]);
}

async function runSessionsCommand() {
  const settings = loadSettings();
  const sessions = listSessions(settings);

  if (sessions.length === 0) {
    console.log('No previous sessions found.');
    return;
  }

  console.log('Previous sessions:');
  for (const s of sessions.slice(0, 20)) {
    const entries = s.entries();
    const userMessages = entries.filter(e => e.role === 'user');
    const firstMsg = userMessages[0]?.content || '(empty)';
    const preview = firstMsg.length > 60 ? firstMsg.slice(0, 57) + '...' : firstMsg;
    console.log(`  ${s.id.slice(0, 20)}  ${new Date(s.updatedAt).toLocaleString()}  ${preview}`);
  }
}

async function printModels(provider, output) {
  const models = await provider.listModels();

  output.write(`\n${THEME.heading}Available Models for ${provider.name}${ANSI.reset}\n`);
  output.write(`${THEME.border}──────────────────────────────────${ANSI.reset}\n`);

  models.forEach((model, index) => {
    const marker = model.id === provider.model ? `${THEME.success}*${ANSI.reset}` : ' ';
    const label = model.name && model.name !== model.id ? ` ${THEME.dim}(${model.name})${ANSI.reset}` : '';
    const numStr = String(index + 1).padStart(2);
    output.write(` ${marker} ${THEME.dim}${numStr}.${ANSI.reset} ${model.id}${label}\n`);
  });

  output.write('\n');
  return models;
}

function formatToolStart(chunk) {
  const displayInput = chunk.displayInput || summarizeToolInput(chunk.name, chunk.input);
  const label = toToolLabel(chunk.name);
  const attemptLabel = chunk.attempt && chunk.attempt > 1 ? ` ${THEME.warning}(attempt ${chunk.attempt})${ANSI.reset}` : '';
  if (!displayInput) return `${THEME.toolIndicator}${label}${ANSI.reset}${attemptLabel}`;
  return `${THEME.toolIndicator}${label}${ANSI.reset}${attemptLabel} ${THEME.dim}(${displayInput})${ANSI.reset}`;
}

function formatToolResult(chunk) {
  const duration = formatDuration(chunk.durationMs);
  const lines = [];
  const name = chunk.name;
  const input = chunk.input || {};

  if (chunk.isError) {
    const code = chunk.errorCode && chunk.errorCode !== 'TOOL_ERROR' ? `${chunk.errorCode}: ` : '';
    const message = chunk.error ? `${code}${chunk.error}` : `${code}tool failed`;
    const errorDetail = formatToolErrorDetail(name, input, message);
    lines.push(`  ${THEME.toolError}✗ Failed${ANSI.reset}${THEME.dim}${duration}${ANSI.reset}`);
    lines.push(...errorDetail.split('\n').map(line => `    ${THEME.dim}${line}${ANSI.reset}`));
    return lines.join('\n');
  }

  const detail = formatToolSuccessDetail(chunk);
  lines.push(`  ${THEME.toolSuccess}✓ Done${ANSI.reset}${THEME.dim}${duration}${ANSI.reset}`);
  if (detail) {
    lines.push(...detail.split('\n').map(line => `    ${THEME.dim}${line}${ANSI.reset}`));
  }

  return lines.join('\n');
}

function formatToolSuccessDetail(chunk) {
  const data = chunk.data || {};
  const name = chunk.name;

  if (name === 'file.read') {
    const lineCount = (data.content || '').split('\n').length;
    return `${toDisplayPath(data.path)} · ${formatBytes(data.bytes)} · ${lineCount} ${pluralize('line', lineCount)}`;
  }

  if (name === 'file.write') {
    const action = data.overwritten ? 'Updated' : 'Created';
    const change = data.change;
    if (change && change.operation === 'update') {
      const parts = [];
      if (change.added > 0) parts.push(`${THEME.diffAdd}+${change.added}${ANSI.reset}`);
      if (change.removed > 0) parts.push(`${THEME.diffRemove}-${change.removed}${ANSI.reset}`);
      return `${action} ${toDisplayPath(data.path)} · ${formatBytes(data.bytes)} (${parts.join(', ')})`;
    }
    return `${action} ${toDisplayPath(data.path)} · ${formatBytes(data.bytes)}`;
  }

  if (name === 'file.glob') {
    const matchCount = Array.isArray(data.matches) ? data.matches.length : 0;
    const truncated = data.truncated ? ' (truncated)' : '';
    return `${matchCount} ${pluralize('file', matchCount)} matched${truncated}`;
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
        const preview = output.length > 200 ? `${output.slice(0, 197)}...` : output;
        return `exit ${data.exitCode || 0}${status}\n    └─ stdout: ${preview}`;
      }
    }
    if (data.stderr) {
      const errOut = data.stderr.trim();
      if (errOut.length > 0) {
        const preview = errOut.length > 200 ? `${errOut.slice(0, 197)}...` : errOut;
        return `exit ${data.exitCode || 0}${status}\n    └─ stderr: ${preview}`;
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
  const lines = [
    `${THEME.toolIndicator}${action}${ANSI.reset}(${THEME.accent}${formatDisplayPath(chunk.data.path)}${ANSI.reset})`,
    `  ${THEME.border}⎿${ANSI.reset}  ${formatChangeSummary(change)}`,
  ];

  for (const item of Array.isArray(change.preview) ? change.preview : []) {
    const lineNum = String(item.line).padStart(4);
    const marker = item.marker === '+' ? THEME.diffAdd : item.marker === '-' ? THEME.diffRemove : THEME.diffContext;
    lines.push(`      ${THEME.dim}${lineNum}${ANSI.reset} ${marker}${item.marker}${item.text || ''}${ANSI.reset}`);
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

function formatToolErrorDetail(name, input, message) {
  if (name === 'file.read') {
    const displayPath = input.path ? toDisplayPath(input.path) : '(no path provided)';
    return `└─ FileRead(${displayPath}) → ${message}`;
  }
  if (name === 'file.write') {
    const displayPath = input.path ? toDisplayPath(input.path) : '(no path provided)';
    return `└─ FileWrite(${displayPath}) → ${message}`;
  }
  if (name === 'shell.run') {
    const cmd = input.command || '(no command)';
    return `└─ ShellRun(${cmd}) → ${message}`;
  }
  return `└─ ${message}`;
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

function formatNumber(n) {
  return n.toLocaleString();
}

function toDisplayPath(filePath) {
  return String(filePath || '').replace(/\//g, '\\');
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

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const value = input;

  if (name === 'file.read') return joinInputParts([formatInputPart('file', value.path), formatInputPart('maxBytes', value.maxBytes)]);
  if (name === 'file.write') return joinInputParts([formatInputPart('file', value.path), formatInputPart('chars', typeof value.content === 'string' ? value.content.length : undefined), formatInputPart('maxBytes', value.maxBytes)]);
  if (name === 'file.glob') return joinInputParts([formatInputPart('pattern', value.pattern), formatInputPart('cwd', value.cwd), formatInputPart('maxResults', value.maxResults)]);
  if (name === 'file.search') return joinInputParts([formatInputPart('query', value.query), formatInputPart('path', value.path), formatInputPart('glob', value.glob), formatInputPart('regex', value.regex)]);
  if (name === 'shell.run') {
    const command = [value.command, ...(Array.isArray(value.args) ? value.args : [])].filter(Boolean).join(' ');
    return joinInputParts([formatInputPart('command', command), formatInputPart('cwd', value.cwd), formatInputPart('timeoutMs', value.timeoutMs)]);
  }

  return joinInputParts(Object.entries(value)
    .filter(([key, item]) => isDisplayableInput(key, item))
    .slice(0, 3)
    .map(([key, item]) => formatInputPart(key, item)));
}

function isDisplayableInput(key, value) {
  return !/key|token|secret|password|content|env/i.test(key) &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}

function formatInputPart(key, value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).replace(/\s+/g, ' ');
  const truncated = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return `${key}: ${truncated}`;
}

function joinInputParts(parts) {
  return parts.filter(Boolean).join(', ');
}

function formatProviderError(error, provider) {
  const message = error?.message || String(error);
  if (provider.name === 'anthropic' && /\b(401|403|forbidden|unauthorized)\b/i.test(message)) {
    return `${message}\n${THEME.dim}Check /api-key and /api-url, then try again.${ANSI.reset}`;
  }
  return message;
}

function resolveModelSelection(selection, models) {
  const modelNumber = Number(selection);
  if (Number.isInteger(modelNumber) && modelNumber > 0 && modelNumber <= models.length) {
    return models[modelNumber - 1].id;
  }
  return selection;
}

function persistAgentSettings(agentSettings) {
  updateUserSettings({ agent: agentSettings });
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function showHelp() {
  console.log(`
${THEME.accent}ʜᴀx ᴀɢᴇɴᴛ${ANSI.reset} ${THEME.dim}v${VERSION}${ANSI.reset}
${THEME.dim}AI-powered coding assistant${ANSI.reset}

${THEME.heading}Usage:${ANSI.reset}
  hax-agent              Start interactive chat (default)
  hax-agent chat         Start interactive chat
  hax-agent resume       Resume most recent session
  hax-agent models       List available models
  hax-agent sessions     List previous sessions
  hax-agent team auth-refactor  Create agent team plan
  hax-agent version      Show version
  hax-agent help         Show this help

${THEME.heading}Interactive Commands:${ANSI.reset}
  /help /exit /clear /compact /tools /agents /models /model <id>
  /api-url <url> /api-key <key> /cost /sessions /resume /config
  /doctor /theme /vim /memory

${THEME.heading}Keyboard Shortcuts:${ANSI.reset}
  Ctrl+C   Interrupt or exit
  Ctrl+L   Clear screen
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`${THEME.error}Error: ${error.message}${ANSI.reset}`);
  process.exitCode = 1;
});
