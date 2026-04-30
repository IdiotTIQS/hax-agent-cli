const { listMemories, readTranscript } = require('./memory');

function loadPromptContext(options = {}) {
  const settings = options.settings || {};
  const memories = options.memories || (settings.memory?.enabled === false ? [] : listMemories(settings));
  const transcript = options.transcript || (options.sessionId ? readTranscript(options.sessionId, settings) : []);

  return buildPromptContext({
    ...options,
    memories,
    transcript,
  });
}

function buildPromptContext(options = {}) {
  const settings = options.settings || {};
  const memories = limitItems(options.memories || [], settings.memory?.maxItems || 20);
  const transcript = limitLast(options.transcript || [], settings.prompts?.maxTranscriptMessages || 20);
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

function assembleSystemPrompt(options = {}) {
  const settings = options.settings || {};
  const prompts = settings.prompts || {};
  const sections = [];

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

function buildMessages(transcript = [], userPrompt) {
  const messages = transcript
    .map(toMessage)
    .filter(Boolean);

  if (userPrompt) {
    messages.push({ role: 'user', content: String(userPrompt) });
  }

  return messages;
}

function formatSection(title, body) {
  const content = String(body || '').trim();

  if (!content) {
    return '';
  }

  return `## ${title}\n${content}`;
}

function formatSettings(settings) {
  const agent = settings.agent || {};
  const memory = settings.memory || {};
  const sessions = settings.sessions || {};
  const rows = [
    ['agent', agent.name],
    ['model', agent.model],
    ['maxTurns', agent.maxTurns],
    ['temperature', agent.temperature],
    ['projectRoot', settings.projectRoot],
    ['memoryDirectory', memory.directory],
    ['sessionDirectory', sessions.directory],
  ];

  return rows
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
}

function formatMemories(memories) {
  if (memories.length === 0) {
    return 'No stored memories.';
  }

  return memories
    .map((memory) => `- ${memory.name}: ${truncate(stringifyContent(memory.content), 800)}`)
    .join('\n');
}

function formatTranscript(transcript) {
  if (transcript.length === 0) {
    return 'No recent transcript.';
  }

  return transcript
    .map((entry) => `- ${entry.role || entry.type || 'event'}: ${truncate(extractEntryContent(entry), 800)}`)
    .join('\n');
}

function toMessage(entry) {
  if (!entry || !['user', 'assistant'].includes(entry.role)) {
    return null;
  }

  const content = extractEntryContent(entry);

  if (!content) {
    return null;
  }

  return {
    role: entry.role,
    content,
  };
}

function extractEntryContent(entry) {
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

function stringifyContent(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function limitItems(items, limit) {
  if (!Number.isFinite(limit) || limit < 1) {
    return items;
  }

  return items.slice(0, limit);
}

function limitLast(items, limit) {
  if (!Number.isFinite(limit) || limit < 1) {
    return items;
  }

  return items.slice(Math.max(0, items.length - limit));
}

function truncate(value, maxLength) {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

module.exports = {
  assembleSystemPrompt,
  buildMessages,
  buildPromptContext,
  formatMemories,
  formatSettings,
  formatTranscript,
  loadPromptContext,
};
