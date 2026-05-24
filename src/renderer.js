'use strict';

const { ANSI, THEME, stripAnsi } = require('./renderer-ansi');
const { TerminalScreen } = require('./renderer-terminal');
const { MarkdownRenderer, styled } = require('./renderer-markdown');

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

const SPINNER_VERBS = [
  'Thinking', 'Analyzing', 'Processing', 'Reasoning', 'Computing',
  'Evaluating', 'Generating', 'Considering', 'Examining', 'Planning',
];

const VERSION = require('../package.json').version;

const CLAUDE_BANNER = [
  '',
  `${THEME.accent}   ╭${'─'.repeat(40)}╮${ANSI.reset}`,
  `${THEME.accent}   │${ANSI.reset}    ${THEME.bold}Hax Agent v${VERSION}${ANSI.reset}                    ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}   │${ANSI.reset}  ${THEME.dim}AI-powered coding assistant${ANSI.reset}           ${THEME.accent}│${ANSI.reset}`,
  `${THEME.accent}   ╰${'─'.repeat(40)}╯${ANSI.reset}`,
  '',
];

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

  _flushLineBuffer() {
    if (this.lineBuffer.length > 0) {
      const rendered = this.markdown._renderInline(this.lineBuffer);
      this.screen.write(`${rendered}\n`);
      this.lineBuffer = '';
    }
    this.lineOpen = false;
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
    this._flushLineBuffer();
    if (chunk.name === 'shell.run') {
      this.spinner.stop();
      this.screen.write(`  ${THEME.spinner}Running${ANSI.reset} ${toolLine}\n`);
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

    this._flushLineBuffer();

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
    this._flushLineBuffer();
    this.screen.write(`${THEME.info}  ${message}${ANSI.reset}\n`);
  }

  complete(usage) {
    this.spinner.stop();

    this._flushLineBuffer();

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
  // file.write path (existing)
  if (chunk.name === 'file.write' && !chunk.isError && chunk.data?.path && chunk.data?.change) {
    return formatWriteModificationNotice(chunk);
  }

  // file.edit path (new — render diff inline)
  if (chunk.name === 'file.edit' && !chunk.isError && chunk.data?.path && chunk.data?.changed) {
    return formatEditModificationNotice(chunk);
  }

  return null;
}

function formatWriteModificationNotice(chunk) {
  const change = chunk.data.change;
  const action = change.operation === 'create' ? 'Create' : 'Update';
  const duration = formatDuration(chunk.durationMs);
  const pathDisplay = `${THEME.toolIndicator}${action}${ANSI.reset}(${THEME.accent}${formatDisplayPath(chunk.data.path)}${ANSI.reset})${THEME.dim}${duration}${ANSI.reset}`;
  const lines = [
    pathDisplay,
    `  ${THEME.border}└─${ANSI.reset}  ${formatChangeSummary(change)}`,
  ];

  if (change.preview && Array.isArray(change.preview) && change.preview.length > 0) {
    renderPreviewLines(lines, change.preview);
  }

  return lines;
}

function formatEditModificationNotice(chunk) {
  const data = chunk.data;
  const applied = data.applied !== false;
  const action = applied ? 'Edit' : 'Preview';
  const duration = formatDuration(chunk.durationMs);
  const pathDisplay = `${THEME.toolIndicator}${action}${ANSI.reset}(${THEME.accent}${formatDisplayPath(data.path)}${ANSI.reset})${THEME.dim}${duration}${ANSI.reset}`;
  const summary = data.summary || `Modified ${data.oldLines || 1} → ${data.newLines || 1} lines`;
  const lines = [
    pathDisplay,
    `  ${THEME.border}└─${ANSI.reset}  ${summary}`,
  ];

  // Parse the raw diff string into preview items
  if (data.diff && typeof data.diff === 'string') {
    const rawDiffLines = data.diff.split('\n');
    const preview = [];
    for (const dLine of rawDiffLines) {
      if (dLine.startsWith('- ')) {
        preview.push({ line: preview.length + 1, marker: '-', text: dLine.slice(2) });
      } else if (dLine.startsWith('+ ')) {
        preview.push({ line: preview.length + 1, marker: '+', text: dLine.slice(2) });
      }
      // Skip context lines (no prefix) to keep the display compact
    }

    if (preview.length > 0) {
      renderPreviewLines(lines, preview);
    }
  }

  return lines;
}

function renderPreviewLines(lines, preview) {
  const maxPreview = 6;
  const shown = preview.slice(0, maxPreview);
  for (const item of shown) {
    const lineNum = String(item.line).padStart(4);
    const marker = item.marker === '+' ? THEME.diffAdd : item.marker === '-' ? THEME.diffRemove : THEME.diffContext;
    const textColor = item.marker === '+' ? THEME.diffAdd : item.marker === '-' ? THEME.diffRemove : THEME.diffContext;
    lines.push(`    ${THEME.dim}${lineNum} ${ANSI.reset}${marker}${item.marker}${ANSI.reset} ${textColor}${item.text || ''}${ANSI.reset}`);
  }
  if (preview.length > maxPreview) {
    lines.push(`    ${THEME.dim}… +${preview.length - maxPreview} more ${pluralize('line', preview.length - maxPreview)}${ANSI.reset}`);
  }
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

// Field names that are likely to contain sensitive values
const SENSITIVE_KEY_PATTERNS = [
  /key/i, /token/i, /secret/i, /password/i, /passwd/i,
  /credential/i, /auth/i, /env/i, /api[_-]?key/i, /access[_-]?key/i,
  /private[_-]?key/i, /certificate/i, /authorization/i,
];

// Patterns that indicate a value is a secret even if the key isn't flagged
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[A-Za-z0-9_-]{20,}$/,
  /^AIza[A-Za-z0-9_-]{30,}$/,
  /^gh[pousr]_[A-Za-z0-9_-]{20,}$/,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
  /^[0-9a-fA-F]{40,}$/,
];

function isDisplayableInput(key, value) {
  const isKeySensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
  if (isKeySensitive) return false;

  if (typeof value === 'string' && value.length > 20) {
    const isValueSensitive = SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
    if (isValueSensitive) return false;
  }

  return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}

function formatProviderError(error, provider) {
  const message = error?.message || String(error);
  const msg = message.toLowerCase();

  if (error?.code === 'EMPTY_TOOL_PREAMBLE') {
    return `${message}\nThe selected model/provider endpoint produced planning text instead of a tool call. Try again, or switch to a model endpoint with reliable tool calling.`;
  }

  // Authentication errors
  if (/\b(401|403|forbidden|unauthorized|invalid.*key|incorrect.*key|auth.*fail)\b/i.test(msg)) {
    return `${message}\n→ API key may be invalid or expired. Run /api-key to update it, or hax-agent config edit.`;
  }

  // Rate limiting
  if (/\b(429|rate.?limit|too many requests|quota)\b/i.test(msg)) {
    return `${message}\n→ Rate limited. Wait a moment and try again, or switch provider with /provider.`;
  }

  // Billing / quota
  if (/\b(billing|quota.*exceeded|insufficient.*(funds|quota|balance)|payment)\b/i.test(msg)) {
    return `${message}\n→ Check your billing/ quota on the provider dashboard, or switch to another provider with /provider.`;
  }

  // Network / timeout
  if (/\b(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network|timeout|fetch failed)\b/i.test(msg)) {
    return `${message}\n→ Network error. Check your connection, API URL (/api-url), or proxy settings.`;
  }

  // Anthropic-specific
  if (provider?.name === 'anthropic' && /\b(401|403)\b/i.test(msg)) {
    return `${message}\n→ Check /api-key and /api-url, then try again.`;
  }

  return message;
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
  styled,
};
