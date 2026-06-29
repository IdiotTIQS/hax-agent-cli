import crypto from 'crypto';
import { getPricing, getCost as calcCost } from './pricing.js';

/**
 * Generate a unique, file-safe session id (timestamp + random suffix).
 * Inlined from the former src/memory.js (removed during the architecture
 * migration); the new src/memory/ modules don't provide an equivalent.
 * @param {Date} [date]
 * @returns {string}
 */
function createSessionId(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${suffix}`;
}

class InputHistory {
  entries: string[];
  maxSize: number;
  index: number;
  partial: string;

  constructor(maxSize = 1000) {
    this.entries = [];
    this.maxSize = maxSize;
    this.index = -1;
    this.partial = '';
  }

  add(entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (this.entries.length > 0 && this.entries[0] === trimmed) return;
    this.entries.unshift(trimmed);
    if (this.entries.length > this.maxSize) this.entries.pop();
    this.index = -1;
    this.partial = '';
  }

  up(current: string): string {
    if (this.entries.length === 0) return current;
    if (this.index === -1) {
      this.partial = current;
      this.index = 0;
    } else if (this.index < this.entries.length - 1) {
      this.index += 1;
    }
    return this.entries[this.index];
  }

  down(current: string): string {
    if (this.index === -1) return current;
    if (this.index === 0) {
      this.index = -1;
      return this.partial;
    }
    this.index -= 1;
    return this.entries[this.index];
  }

  reset(): void {
    this.index = -1;
    this.partial = '';
  }

  search(query: string): string[] {
    if (!query) return [];
    const lower = query.toLowerCase();
    return this.entries.filter(e => e.toLowerCase().includes(lower)).slice(0, 10);
  }

  /**
   * Interactive reverse-i-search. Returns { match, query } or null.
   * Call repeatedly as user types; caller handles the display.
   */
  rsearch(query: string): { match: string; query: string } | null {
    if (!query) return null;
    const lower = query.toLowerCase();
    for (const e of this.entries) {
      if (e.toLowerCase().includes(lower)) return { match: e, query };
    }
    return null;
  }
}

class CostTracker {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  toolCallCount: number;
  startTime: number;

  constructor() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheCreationTokens = 0;
    this.cacheReadTokens = 0;
    this.turnCount = 0;
    this.toolCallCount = 0;
    this.startTime = Date.now();
  }

  addUsage(usage: Record<string, unknown>, model: string): void {
    if (!usage) return;
    this.inputTokens += readUsageNumber(usage, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens') || 0;
    this.outputTokens += readUsageNumber(usage, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens') || 0;
    this.cacheCreationTokens += readUsageNumber(usage, 'cache_creation_input_tokens', 'cacheCreationInputTokens') || 0;
    this.cacheReadTokens += readUsageNumber(usage, 'cache_read_input_tokens', 'cacheReadInputTokens') || 0;
    this.turnCount += 1;
  }

  addToolCall(): void {
    this.toolCallCount += 1;
  }

  getCost(model: string): number {
    return calcCost(model, this.inputTokens, this.outputTokens, this.cacheCreationTokens, this.cacheReadTokens);
  }

  getPricing(model: string): unknown {
    return getPricing(model);
  }

  formatSummary(model: string): string {
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

function readUsageNumber(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (Number.isFinite(usage[key])) {
      return usage[key] as number;
    }
  }

  return 0;
}

interface SessionProvider {
  name?: string;
  model?: string;
  apiKey?: string;
  apiUrl?: string;
  [key: string]: unknown;
}

interface SessionPermissionManager {
  mode: string;
  _alwaysAllow?: Set<string>;
  _alwaysDeny?: Set<string>;
}

interface SessionGoal {
  enabled?: boolean;
  text?: string;
  maxContinuations?: number;
}

interface SessionContextStats {
  inputTokens: number;
  budgetTokens: number;
}

interface SessionOptions {
  provider?: SessionProvider | null;
  settings?: Record<string, unknown> | null;
  toolRegistry?: unknown | null;
  permissionManager?: SessionPermissionManager | null;
  pluginRegistry?: unknown | null;
}

class Session {
  id: string;
  messages: unknown[];
  provider: SessionProvider | null;
  settings: Record<string, unknown> | null;
  toolRegistry: unknown | null;
  permissionManager: SessionPermissionManager | null;
  costTracker: CostTracker;
  shouldExit: boolean;
  isStreaming: boolean;
  pendingExit: boolean;
  responseAbortController: AbortController | null;
  responseRenderer: unknown | null;
  responseInterrupted: boolean;
  availableModels: unknown;
  startTime: number;
  modifiedFiles: Set<string>;
  goal: SessionGoal | null;
  pluginRegistry: unknown | null;
  contextStats: SessionContextStats | null;

  constructor(options: SessionOptions = {}) {
    this.id = createSessionId();
    this.messages = [];
    this.provider = options.provider ?? null;
    this.settings = options.settings ?? null;
    this.toolRegistry = options.toolRegistry ?? null;
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
    /** @type {{ inputTokens: number, budgetTokens: number } | null} */
    this.contextStats = null;
  }

  getElapsedTime(): string {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  }

  getStatusLine(): string {
    const provider = this.provider?.name || 'provider';
    const model = this.provider?.model || 'model';
    const cost = this.costTracker.getCost(model as string);
    const turns = this.costTracker.turnCount;
    const elapsed = this.getElapsedTime();

    let permMode = '';
    if (this.permissionManager) {
      const mode = this.permissionManager.mode;
      const modeLabel = mode === 'yolo' ? 'YOLO' : 'Standard';
      const modeColor = mode === 'yolo' ? '\x1B[93m' : '\x1B[92m';
      permMode = ` · ${modeColor}${modeLabel}\x1B[0m`;
    }

    const dim = '\x1B[2m';
    const reset = '\x1B[0m';
    const costColor = '\x1B[93m';
    const cwd = (this.settings?.projectRoot as string | undefined) || process.cwd();
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

function formatTokenCount(value: unknown): string {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(tokens)));
}

export {
  InputHistory,
  CostTracker,
  Session,
};
