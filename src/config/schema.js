"use strict";

/**
 * Configuration schema for HaxAgent.
 * Defines every recognized setting with its type, default, description,
 * environment variable mapping, and validation rules.
 *
 * Organized into top-level sections matching the DEFAULT_SETTINGS shape.
 */

// ---------------------------------------------------------------------------
// Helper: createSchemaEntry (reduces boilerplate)
// ---------------------------------------------------------------------------

/**
 * @param {string} key
 * @param {string} type - 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'path'
 * @param {*} defaultValue
 * @param {string} description
 * @param {object} [opts]
 * @param {string} [opts.envVar]
 * @param {function} [opts.validate]
 * @param {Array} [opts.choices]
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @returns {object} schema entry
 */
function entry(key, type, defaultValue, description, opts = {}) {
  return {
    key,
    type,
    default: defaultValue,
    description,
    envVar: opts.envVar || null,
    validate: opts.validate || null,
    choices: opts.choices || null,
    min: opts.min !== undefined ? opts.min : null,
    max: opts.max !== undefined ? opts.max : null,
  };
}

// ---------------------------------------------------------------------------
// AGENT_SCHEMA
// ---------------------------------------------------------------------------

const AGENT_SCHEMA = Object.freeze([
  entry('provider', 'string', 'anthropic',
    'AI provider backend (anthropic, openai, google, vertex, openrouter)',
    { envVar: 'HAX_AGENT_PROVIDER', choices: ['anthropic', 'openai', 'google', 'vertex', 'openrouter', 'deepseek', 'groq', 'ollama', 'custom'] }),

  entry('model', 'string', 'claude-sonnet-4-20250514',
    'Model identifier for the chosen provider',
    { envVar: 'HAX_AGENT_MODEL' }),

  entry('name', 'string', 'hax-agent',
    'Display name for this agent instance',
    { envVar: 'HAX_AGENT_NAME' }),

  entry('apiKey', 'string', undefined,
    'API key for the provider (prefer env var over config file)',
    { envVar: 'ANTHROPIC_API_KEY' }),

  entry('apiUrl', 'string', undefined,
    'Custom API base URL for self-hosted or proxied endpoints',
    { envVar: 'HAX_AGENT_API_URL' }),

  entry('maxToolTurns', 'integer', 20,
    'Maximum number of tool-calling rounds per agent turn',
    { envVar: 'HAX_AGENT_MAX_TURNS', min: 1, max: 200 }),

  entry('maxTokens', 'integer', 8192,
    'Maximum output tokens per response',
    { min: 1, max: 128000 }),

  entry('temperature', 'number', 0.2,
    'Sampling temperature (0 = deterministic, 1 = creative)',
    { min: 0, max: 2 }),

  entry('systemPrompt', 'string', undefined,
    'Custom system prompt override (appended to built-in prompt)'),
]);

// ---------------------------------------------------------------------------
// TOOLS_SCHEMA
// ---------------------------------------------------------------------------

const TOOLS_SCHEMA = Object.freeze([
  // --- shell ---
  entry('shell.enabled', 'boolean', true,
    'Whether the shell tool is available',
    { envVar: 'HAX_AGENT_SHELL_ENABLED' }),

  entry('shell.timeoutMs', 'integer', 10_000,
    'Maximum runtime for a shell command (ms)',
    { envVar: 'HAX_AGENT_SHELL_TIMEOUT_MS', min: 1000, max: 300_000 }),

  entry('shell.maxBuffer', 'integer', 52_428_800,
    'Maximum output buffer size for a shell command (bytes)',
    { envVar: 'HAX_AGENT_SHELL_MAX_BUFFER', min: 1024, max: 268_435_456 }),

  entry('shell.allowedCommands', 'array', ['*'],
    'Whitelist of allowed shell commands; ["*"] means all allowed'),

  // --- file ---
  entry('file.maxBytes', 'integer', 512_000,
    'Maximum file size for read operations (bytes)',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE', min: 1024 }),

  entry('file.allowedPaths', 'array', ['*'],
    'Whitelist of allowed file-system paths; ["*"] means all allowed'),
]);

// ---------------------------------------------------------------------------
// UI_SCHEMA
// ---------------------------------------------------------------------------

const UI_SCHEMA = Object.freeze([
  entry('theme', 'string', 'dark',
    'UI color theme',
    { envVar: 'HAX_AGENT_THEME', choices: ['dark', 'light', 'system'] }),

  entry('locale', 'string', 'en',
    'Interface language (IETF BCP 47 tag)',
    { envVar: 'HAX_AGENT_LOCALE' }),

  entry('color', 'string', undefined,
    'Accent color in hex format (e.g. "#ff6600")',
    { envVar: 'HAX_AGENT_COLOR', validate: (v) => v === undefined || /^#[0-9a-fA-F]{6}$/.test(v) }),

  entry('vim', 'boolean', false,
    'Enable vim keybindings in the editor',
    { envVar: 'HAX_AGENT_VIM' }),
]);

// ---------------------------------------------------------------------------
// MEMORY_SCHEMA
// ---------------------------------------------------------------------------

const MEMORY_SCHEMA = Object.freeze([
  entry('enabled', 'boolean', true,
    'Whether persistent memory is enabled',
    { envVar: 'HAX_AGENT_MEMORY_ENABLED' }),

  entry('directory', 'path', undefined,
    'Custom directory for memory storage',
    { envVar: 'HAX_AGENT_MEMORY_DIR' }),

  entry('maxEntries', 'integer', 20,
    'Maximum number of memory entries before eviction',
    { envVar: 'HAX_AGENT_MEMORY_MAX_ITEMS', min: 1, max: 1000 }),

  entry('evictionPolicy', 'string', 'lru',
    'Eviction strategy when memory is full',
    { choices: ['lru', 'fifo', 'temporal', 'score'] }),
]);

// ---------------------------------------------------------------------------
// CONTEXT_SCHEMA
// ---------------------------------------------------------------------------

const CONTEXT_SCHEMA = Object.freeze([
  entry('enabled', 'boolean', true,
    'Whether context-window management is active',
    { envVar: 'HAX_AGENT_CONTEXT_ENABLED' }),

  entry('windowTokens', 'integer', undefined,
    'Max context window size in tokens (auto-detected if unset)',
    { envVar: 'HAX_AGENT_CONTEXT_WINDOW_TOKENS', min: 4096 }),

  entry('reserveOutputTokens', 'integer', 8192,
    'Tokens reserved exclusively for model output',
    { envVar: 'HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS', min: 256 }),

  entry('autoCompact', 'boolean', true,
    'Auto-compact conversation when near token limit'),

  entry('threshold', 'number', 0.8,
    'Fraction of windowTokens at which auto-compaction triggers',
    { min: 0.1, max: 0.95 }),

  entry('charsPerToken', 'integer', 4,
    'Estimated characters per token for rough counting',
    { envVar: 'HAX_AGENT_CONTEXT_CHARS_PER_TOKEN', min: 1, max: 10 }),
]);

// ---------------------------------------------------------------------------
// PERMISSIONS_SCHEMA
// ---------------------------------------------------------------------------

const PERMISSIONS_SCHEMA = Object.freeze([
  entry('mode', 'string', 'normal',
    'Permission mode: normal (prompt), ask (always confirm), auto (auto-approve safe), yolo (auto-approve all)',
    { envVar: 'HAX_AGENT_PERMISSIONS_MODE', choices: ['normal', 'ask', 'auto', 'yolo'] }),

  entry('persistPath', 'string', undefined,
    'File path for persisting permission decisions'),
]);

// ---------------------------------------------------------------------------
// SESSIONS_SCHEMA
// ---------------------------------------------------------------------------

const SESSIONS_SCHEMA = Object.freeze([
  entry('directory', 'path', undefined,
    'Directory for session transcript storage',
    { envVar: 'HAX_AGENT_SESSION_DIR' }),

  entry('transcriptLimit', 'integer', 100,
    'Maximum number of transcript messages to keep',
    { envVar: 'HAX_AGENT_TRANSCRIPT_LIMIT', min: 1 }),
]);

// ---------------------------------------------------------------------------
// FILE_CONTEXT_SCHEMA
// ---------------------------------------------------------------------------

const FILE_CONTEXT_SCHEMA = Object.freeze([
  entry('enabled', 'boolean', true,
    'Whether automatic file-context injection is active',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_ENABLED' }),

  entry('maxFiles', 'integer', 8,
    'Maximum number of files to include in context',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_FILES', min: 1, max: 100 }),

  entry('maxIndexFiles', 'integer', 2000,
    'Maximum files to index in a directory scan',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_INDEX_FILES', min: 1 }),

  entry('maxFileSize', 'integer', 512_000,
    'Maximum per-file size before it is skipped (bytes)',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE', min: 1 }),

  entry('maxBytesPerFile', 'integer', 32_000,
    'Maximum bytes read from a single file',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_BYTES_PER_FILE', min: 1 }),

  entry('maxTotalBytes', 'integer', 120_000,
    'Maximum total bytes across all context files',
    { envVar: 'HAX_AGENT_FILE_CONTEXT_MAX_TOTAL_BYTES', min: 1 }),
]);

// ---------------------------------------------------------------------------
// PROMPTS_SCHEMA
// ---------------------------------------------------------------------------

const PROMPTS_SCHEMA = Object.freeze([
  entry('includeSettings', 'boolean', true,
    'Include current settings in the system prompt',
    { envVar: 'HAX_AGENT_INCLUDE_SETTINGS' }),

  entry('includeMemory', 'boolean', true,
    'Include memory entries in the system prompt',
    { envVar: 'HAX_AGENT_INCLUDE_MEMORY' }),

  entry('includeTranscript', 'boolean', true,
    'Include recent transcript in the system prompt',
    { envVar: 'HAX_AGENT_INCLUDE_TRANSCRIPT' }),

  entry('maxTranscriptMessages', 'integer', undefined,
    'Max transcript messages injected (undefined = unlimited)',
    { envVar: 'HAX_AGENT_MAX_TRANSCRIPT_MESSAGES', min: 1 }),
]);

// ---------------------------------------------------------------------------
// UPDATES_SCHEMA
// ---------------------------------------------------------------------------

const UPDATES_SCHEMA = Object.freeze([
  entry('autoInstall', 'boolean', false,
    'Whether to auto-install HaxAgent updates',
    { envVar: 'HAX_AGENT_UPDATES_AUTO_INSTALL' }),
]);

// ---------------------------------------------------------------------------
// DESKTOP_SCHEMA
// ---------------------------------------------------------------------------

const DESKTOP_SCHEMA = Object.freeze([
  entry('workspace', 'path', undefined,
    'Default workspace directory for the desktop app',
    { envVar: 'HAX_AGENT_DESKTOP_WORKSPACE' }),
]);

// ---------------------------------------------------------------------------
// All sections map & flat schema
// ---------------------------------------------------------------------------

const ALL_SECTIONS = Object.freeze({
  agent: AGENT_SCHEMA,
  tools: TOOLS_SCHEMA,
  ui: UI_SCHEMA,
  memory: MEMORY_SCHEMA,
  context: CONTEXT_SCHEMA,
  permissions: PERMISSIONS_SCHEMA,
  sessions: SESSIONS_SCHEMA,
  fileContext: FILE_CONTEXT_SCHEMA,
  prompts: PROMPTS_SCHEMA,
  updates: UPDATES_SCHEMA,
  desktop: DESKTOP_SCHEMA,
});

/**
 * Look up a schema entry by its dotted path (e.g. "agent.model").
 * @param {string} dottedPath
 * @returns {object|null}
 */
function lookupEntry(dottedPath) {
  const parts = dottedPath.split('.');
  const sectionName = parts[0];
  const fieldKey = parts.slice(1).join('.');

  const section = ALL_SECTIONS[sectionName];
  if (!section) return null;

  return section.find((e) => e.key === fieldKey) || null;
}

/**
 * Return every schema entry flattened into a single list.
 * Each entry gets an extra `path` property like "agent.model".
 * @returns {Array<object>}
 */
function flattenSchema() {
  const flat = [];
  for (const [sectionName, entries] of Object.entries(ALL_SECTIONS)) {
    for (const e of entries) {
      flat.push({ ...e, path: `${sectionName}.${e.key}` });
    }
  }
  return flat;
}

/**
 * Return the default config object constructed from the schema.
 * @returns {object}
 */
function schemaDefaults() {
  return {
    agent: sectionDefaults('agent'),
    tools: {
      shell: pickDefaults('shell'),
      file: pickDefaults('file'),
    },
    ui: sectionDefaults('ui'),
    memory: sectionDefaults('memory'),
    context: sectionDefaults('context'),
    permissions: sectionDefaults('permissions'),
    sessions: sectionDefaults('sessions'),
    fileContext: sectionDefaults('fileContext'),
    prompts: sectionDefaults('prompts'),
    updates: sectionDefaults('updates'),
    desktop: sectionDefaults('desktop'),
  };
}

function sectionDefaults(sectionName) {
  const entries = ALL_SECTIONS[sectionName];
  const obj = {};
  for (const e of entries) {
    obj[e.key] = e.default;
  }
  return obj;
}

function pickDefaults(prefix) {
  const sections = ALL_SECTIONS[prefix] || ALL_SECTIONS.tools;
  const obj = {};
  for (const e of sections) {
    if (e.key.startsWith(`${prefix}.`)) {
      obj[e.key.replace(`${prefix}.`, '')] = e.default;
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single value against its schema entry.
 * @param {object} entry - schema entry
 * @param {*} value
 * @returns {string|null} error message, or null if valid
 */
function validateEntry(entry, value) {
  if (value === undefined) return null; // absent fields are fine

  const { type, choices, min, max, validate: customValidate } = entry;

  if (type === 'boolean') {
    if (typeof value !== 'boolean') return `expected boolean, got ${typeof value}`;
  } else if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `expected integer, got ${typeof value}`;
    }
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `expected finite number, got ${value}`;
    }
  } else if (type === 'string' || type === 'path') {
    if (typeof value !== 'string') return `expected string, got ${typeof value}`;
  } else if (type === 'array') {
    if (!Array.isArray(value)) return `expected array, got ${typeof value}`;
  }

  if (choices && !choices.includes(value)) {
    return `must be one of [${choices.join(', ')}], got "${value}"`;
  }

  if (min !== null && typeof min === 'number' && value < min) {
    return `must be >= ${min}, got ${value}`;
  }

  if (max !== null && typeof max === 'number' && value > max) {
    return `must be <= ${max}, got ${value}`;
  }

  if (typeof customValidate === 'function') {
    if (!customValidate(value)) {
      return `failed custom validation`;
    }
  }

  return null;
}

module.exports = {
  AGENT_SCHEMA,
  TOOLS_SCHEMA,
  UI_SCHEMA,
  MEMORY_SCHEMA,
  CONTEXT_SCHEMA,
  PERMISSIONS_SCHEMA,
  SESSIONS_SCHEMA,
  FILE_CONTEXT_SCHEMA,
  PROMPTS_SCHEMA,
  UPDATES_SCHEMA,
  DESKTOP_SCHEMA,
  ALL_SECTIONS,
  lookupEntry,
  flattenSchema,
  schemaDefaults,
  validateEntry,
};
