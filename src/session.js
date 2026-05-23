const { createSessionId } = require('./memory');
const { createTranslator } = require('./i18n');

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

  /**
   * Interactive reverse-i-search. Returns { match, query } or null.
   * Call repeatedly as user types; caller handles the display.
   */
  rsearch(query) {
    if (!query) return null;
    const lower = query.toLowerCase();
    for (const e of this.entries) {
      if (e.toLowerCase().includes(lower)) return { match: e, query };
    }
    return null;
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
      'claude-opus-4-20250514': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
      'claude-opus-4-7': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
      'claude-haiku-3-5-20241022': { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
      'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
      'claude-3-opus-20240229': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
      'claude-sonnet-4-7-20250501': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4.1': { input: 2.0, output: 8.0 },
      'gpt-4.1-mini': { input: 0.4, output: 1.6 },
      'o3-mini': { input: 1.1, output: 4.4 },
      'gemini-2.5-pro-exp-03-25': { input: 1.25, output: 10.0 },
      'gemini-2.5-pro-preview-06-05': { input: 1.25, output: 10.0 },
      'gemini-2.5-flash-preview-04-17': { input: 0.15, output: 0.6 },
      'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.6 },
      'gemini-2.0-flash': { input: 0.1, output: 0.4 },
      'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
    };
  }

  addUsage(usage, model) {
    if (!usage) return;
    this.inputTokens += readUsageNumber(usage, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens') || 0;
    this.outputTokens += readUsageNumber(usage, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens') || 0;
    this.cacheCreationTokens += readUsageNumber(usage, 'cache_creation_input_tokens', 'cacheCreationInputTokens') || 0;
    this.cacheReadTokens += readUsageNumber(usage, 'cache_read_input_tokens', 'cacheReadInputTokens') || 0;
    this.turnCount += 1;
  }

  addToolCall() {
    this.toolCallCount += 1;
  }

  getCost(model) {
    const p = this.getPricing(model);
    if (!p) return 0;
    const inputCost = (this.inputTokens / 1_000_000) * p.input;
    const outputCost = (this.outputTokens / 1_000_000) * p.output;
    const cacheWriteCost = p.cacheWrite ? (this.cacheCreationTokens / 1_000_000) * p.cacheWrite : 0;
    const cacheReadCost = p.cacheRead ? (this.cacheReadTokens / 1_000_000) * p.cacheRead : 0;
    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  getPricing(model) {
    const key = String(model || '').toLowerCase();
    if (this.pricing[key]) return this.pricing[key];

    // Priority-ordered fallback patterns
    const FALLBACKS = [
      [/claude.*opus/,        'claude-opus-4-7'],
      [/claude.*haiku/,       'claude-haiku-3-5-20241022'],
      [/claude.*sonnet/,      'claude-sonnet-4-20250514'],
      [/gpt-4\.1.*mini/,      'gpt-4.1-mini'],
      [/gpt-4\.1/,            'gpt-4.1'],
      [/gpt-4o.*mini/,        'gpt-4o-mini'],
      [/gpt-4o/,              'gpt-4o'],
      [/o3.*mini/,            'o3-mini'],
      [/gemini-2\.5.*pro/,    'gemini-2.5-pro-preview-06-05'],
      [/gemini-2\.5.*flash/,  'gemini-2.5-flash-preview-05-20'],
      [/gemini-2\.0.*flash.*lite/, 'gemini-2.0-flash-lite'],
      [/gemini-2\.0.*flash/,  'gemini-2.0-flash'],
    ];

    for (const [pattern, pricingKey] of FALLBACKS) {
      if (pattern.test(key)) return this.pricing[pricingKey];
    }
    return null;
  }

  formatSummary(model) {
    const cost = this.getCost(model);
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    return [
      `Session Statistics`,
      `──────────────────────────────────`,
      `  Duration:       ${timeStr}`,
      `  Turns:         ${this.turnCount}`,
      `  Tool calls:    ${this.toolCallCount}`,
      `  Input tokens:   ${this.inputTokens.toLocaleString()}`,
      `  Output tokens:  ${this.outputTokens.toLocaleString()}`,
      this.cacheCreationTokens > 0 ? `  Cache write:   ${this.cacheCreationTokens.toLocaleString()}` : null,
      this.cacheReadTokens > 0 ? `  Cache read:    ${this.cacheReadTokens.toLocaleString()}` : null,
      `  Estimated cost: $${cost.toFixed(4)}`,
    ].filter(Boolean).join('\n');
  }
}

function readUsageNumber(usage, ...keys) {
  for (const key of keys) {
    if (Number.isFinite(usage[key])) {
      return usage[key];
    }
  }

  return 0;
}

class Session {
  constructor(options = {}) {
    this.id = createSessionId();
    this.messages = [];
    this.provider = options.provider;
    this.settings = options.settings;
    this.toolRegistry = options.toolRegistry;
    this.permissionManager = options.permissionManager || null;
    this.costTracker = new CostTracker();
    this.shouldExit = false;
    this.isStreaming = false;
    this.pendingExit = false;
    this.responseAbortController = null;
    this.responseRenderer = null;
    this.responseInterrupted = false;
    this.availableModels = undefined;
    this.startTime = Date.now();
    this.modifiedFiles = new Set();
    this.goal = null;
    this.pluginRegistry = options.pluginRegistry || null;
  }

  getElapsedTime() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  }

  getStatusLine() {
    const t = createTranslator(this.settings?.ui?.locale);
    const provider = this.provider?.name || 'provider';
    const model = this.provider?.model || 'model';
    const cost = this.costTracker.getCost(model);
    const turns = this.costTracker.turnCount;
    const elapsed = this.getElapsedTime();

    let permMode = '';
    if (this.permissionManager) {
      const mode = this.permissionManager.mode;
      const modeLabel = mode === 'yolo' ? 'YOLO' : t('common.mode.standard');
      const modeColor = mode === 'yolo' ? '\x1B[93m' : '\x1B[92m';
      permMode = ` · ${modeColor}${modeLabel}\x1B[0m`;
    }

    const dim = '\x1B[2m';
    const reset = '\x1B[0m';
    const costColor = '\x1B[93m';
    const cwd = this.settings?.projectRoot || process.cwd();
    const cwdShort = cwd.length > 30 ? '...' + cwd.slice(-27) : cwd;

    // Context window usage meter
    let ctxMeter = '';
    const stats = this.contextStats;
    if (stats && stats.budgetTokens > 0) {
      const ratio = Math.min(1, stats.inputTokens / stats.budgetTokens);
      const totalSegs = 8;
      const filled = Math.round(ratio * totalSegs);
      const empty = totalSegs - filled;
      const pct = Math.round(ratio * 100);
      const pctLabel = ratio > 0 && pct === 0 ? '<1%' : `${pct}%`;
      const barColor = ratio >= 0.9 ? '\x1B[91m' : ratio >= 0.7 ? '\x1B[93m' : dim;
      ctxMeter = `[${barColor}${'█'.repeat(filled)}${dim}${'░'.repeat(empty)}${reset}] ${pctLabel} ${formatTokenCount(stats.inputTokens)}/${formatTokenCount(stats.budgetTokens)} · `;
    }

    const goalIndicator = this.goal?.enabled && this.goal.text ? ` · \x1B[95mgoal\x1B[0m` : '';

    return `${ctxMeter}${dim}${cwdShort}${reset} · ${dim}${provider}${reset} · ${dim}${model}${reset} · ${costColor}$${cost.toFixed(4)}${reset} · ${dim}${turns} turns${reset} · ${dim}${elapsed}${reset}${permMode}${goalIndicator}`;
  }
}

function formatTokenCount(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(tokens)));
}

module.exports = {
  InputHistory,
  CostTracker,
  Session,
};
