const { createSessionId } = require('./memory');

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
      'claude-sonnet-4-7-20250501': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4.1': { input: 2.0, output: 8.0 },
      'gemini-2.5-pro-exp-03-25': { input: 1.25, output: 10.0 },
      'gemini-2.5-flash-preview-04-17': { input: 0.15, output: 0.6 },
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
    const p = this.pricing[model];
    if (!p) return 0;
    const inputCost = (this.inputTokens / 1_000_000) * p.input;
    const outputCost = (this.outputTokens / 1_000_000) * p.output;
    const cacheWriteCost = p.cacheWrite ? (this.cacheCreationTokens / 1_000_000) * p.cacheWrite : 0;
    const cacheReadCost = p.cacheRead ? (this.cacheReadTokens / 1_000_000) * p.cacheRead : 0;
    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
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

    let permMode = '';
    if (this.permissionManager) {
      const mode = this.permissionManager.mode;
      const modeLabel = mode === 'yolo' ? 'YOLO' : '标准';
      const modeColor = mode === 'yolo' ? '\x1B[93m' : '\x1B[92m';
      permMode = ` · ${modeColor}${modeLabel}\x1B[0m`;
    }

    const dim = '\x1B[2m';
    const reset = '\x1B[0m';
    const costColor = '\x1B[93m';
    return `${dim}${provider}${reset} · ${dim}${model}${reset} · ${costColor}$${cost.toFixed(4)}${reset} · ${dim}${turns} turns${reset} · ${dim}${elapsed}${reset}${permMode}`;
  }
}

module.exports = {
  InputHistory,
  CostTracker,
  Session,
};
