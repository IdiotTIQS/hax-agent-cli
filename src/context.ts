/**
 * Memory/transcript loading. The legacy synchronous `listMemories` /
 * `readTranscript` from the former src/memory.js were removed in the
 * architecture migration; the new src/memory/ store is async with a different
 * data model and is not a drop-in replacement here. Until context loading is
 * ported to the new store, these degrade gracefully to empty results — callers
 * may still pass `memories` / `transcript` in explicitly to supply data.
 */

interface ContextSettings {
  memory?: { enabled?: boolean; maxItems?: number; directory?: string };
  sessions?: { directory?: string };
  agent?: { name?: string; model?: string; maxTurns?: number; temperature?: number };
  prompts?: { includeSettings?: boolean; includeMemory?: boolean; includeTranscript?: boolean; maxTranscriptMessages?: number };
  projectRoot?: string;
}

interface ContextMemory {
  name?: string;
  content?: unknown;
}

interface ContextEntry {
  role?: string;
  type?: string;
  content?: unknown;
  text?: unknown;
  message?: unknown;
}

interface ContextMessage {
  role: string;
  content: string;
}

interface PromptContextResult {
  systemPrompt: string;
  messages: ContextMessage[];
  memories: ContextMemory[];
  transcript: ContextEntry[];
}

interface LoadPromptContextOptions {
  settings?: ContextSettings;
  memories?: ContextMemory[];
  transcript?: ContextEntry[];
  sessionId?: string;
  userPrompt?: string;
  instructions?: string;
  runtime?: Record<string, unknown>;
}

interface SystemPromptOptions {
  settings?: ContextSettings;
  memories?: ContextMemory[];
  transcript?: ContextEntry[];
  instructions?: string;
  runtime?: Record<string, unknown>;
}

function listMemories(_settings: ContextSettings): ContextMemory[] {
  return [];
}

function readTranscript(_sessionId: string, _settings: ContextSettings): ContextEntry[] {
  return [];
}

/**
 * Load prompt context from memories and transcript, building the system prompt
 * and message list for the provider.
 * @param {LoadPromptContextOptions} [options]
 * @returns {PromptContextResult}
 */
function loadPromptContext(options: LoadPromptContextOptions = {}): PromptContextResult {
  const settings = options.settings || {};
  const memories = options.memories || (settings.memory?.enabled === false ? [] : listMemories(settings));
  const transcript = options.transcript || (options.sessionId ? readTranscript(options.sessionId, settings) : []);

  return buildPromptContext({
    ...options,
    memories,
    transcript,
  });
}

function buildPromptContext(options: LoadPromptContextOptions = {}): PromptContextResult {
  const settings = options.settings || {};
  const memories = limitItems(options.memories || [], settings.memory?.maxItems || 20);
  const transcript = limitLast(options.transcript || [], settings.prompts?.maxTranscriptMessages);
  const systemPrompt = assembleSystemPrompt({
    instructions: options.instructions,
    memories,
    runtime: options.runtime,
    settings,
    transcript,
  });

  return {
    systemPrompt,
    messages: buildMessages(transcript, options.userPrompt),
    memories,
    transcript,
  };
}

function assembleSystemPrompt(options: SystemPromptOptions = {}): string {
  const settings = options.settings || {};
  const prompts = settings.prompts || {};
  const sections: string[] = [];

  sections.push(formatSection('Identity', 'You are Hax Agent CLI, a lightweight AI coding assistant running in the terminal. You help developers with coding, file operations, shell commands, and project management. Always identify yourself as Hax Agent when asked.'));

  if (options.instructions) {
    sections.push(formatSection('Instructions', options.instructions));
  }

  if (prompts.includeSettings !== false) {
    sections.push(formatSection('Settings', formatSettings(settings)));
  }

  if (prompts.includeMemory !== false) {
    sections.push(formatSection('Memory', formatMemories(options.memories || [])));
  }

  if (prompts.includeTranscript !== false) {
    sections.push(formatSection('Recent transcript', formatTranscript(options.transcript || [])));
  }

  if (options.runtime && Object.keys(options.runtime).length > 0) {
    sections.push(formatSection('Runtime', stringifyContent(options.runtime)));
  }

  return sections.filter(Boolean).join('\n\n');
}

function buildMessages(transcript: ContextEntry[] = [], userPrompt?: string): ContextMessage[] {
  const messages = transcript
    .map(toMessage)
    .filter((m): m is ContextMessage => m !== null);

  if (userPrompt) {
    messages.push({ role: 'user', content: String(userPrompt) });
  }

  return messages;
}

function formatSection(title: string, body: string): string {
  const content = String(body || '').trim();

  if (!content) {
    return '';
  }

  return `## ${title}\n${content}`;
}

function formatSettings(settings: ContextSettings): string {
  const agent = settings.agent || {};
  const memory = settings.memory || {};
  const sessions = settings.sessions || {};
  const rows: [string, unknown][] = [
    ['agent', agent.name],
    ['model', agent.model],
    ['maxTurns', agent.maxTurns],
    ['temperature', agent.temperature],
    ['projectRoot', settings.projectRoot],
    ['memoryDirectory', (memory as any).directory],
    ['sessionDirectory', sessions.directory],
  ];

  return rows
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
}

function formatMemories(memories: ContextMemory[]): string {
  if (memories.length === 0) {
    return 'No stored memories.';
  }

  return memories
    .map((memory) => `- ${memory.name}: ${truncate(stringifyContent(memory.content), 800)}`)
    .join('\n');
}

function formatTranscript(transcript: ContextEntry[]): string {
  if (transcript.length === 0) {
    return 'No recent transcript.';
  }

  return transcript
    .map((entry) => `- ${entry.role || entry.type || 'event'}: ${truncate(extractEntryContent(entry), 800)}`)
    .join('\n');
}

function toMessage(entry: ContextEntry): ContextMessage | null {
  if (!entry || !['user', 'assistant'].includes(entry.role || '')) {
    return null;
  }

  const content = extractEntryContent(entry);

  if (!content) {
    return null;
  }

  return {
    role: entry.role as string,
    content,
  };
}

function extractEntryContent(entry: ContextEntry): string {
  if (entry.content !== undefined) {
    return stringifyContent(entry.content);
  }

  if (entry.text !== undefined) {
    return stringifyContent(entry.text);
  }

  if (entry.message !== undefined) {
    return stringifyContent(entry.message);
  }

  return stringifyContent(entry);
}

function stringifyContent(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function limitItems<T>(items: T[], limit: number | undefined): T[] {
  if (!Number.isFinite(limit) || (limit as number) < 1) {
    return items;
  }

  return items.slice(0, limit as number);
}

function limitLast<T>(items: T[], limit: number | undefined): T[] {
  if (!Number.isFinite(limit) || (limit as number) < 1) {
    return items;
  }

  return items.slice(Math.max(0, items.length - (limit as number)));
}

function truncate(value: unknown, maxLength: number): string {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

export {
  assembleSystemPrompt,
  buildMessages,
  buildPromptContext,
  formatMemories,
  formatSettings,
  formatTranscript,
  loadPromptContext,
};
