const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_SETTINGS = Object.freeze({
  agent: {
    name: 'hax-agent',
    model: 'claude-sonnet-4-20250514',
    apiKey: undefined,
    apiUrl: undefined,
    maxTurns: 20,
    temperature: 0.2,
  },
  memory: {
    enabled: true,
    directory: undefined,
    maxItems: 20,
  },
  sessions: {
    directory: undefined,
    transcriptLimit: 100,
  },
  prompts: {
    includeSettings: true,
    includeMemory: true,
    includeTranscript: true,
    maxTranscriptMessages: undefined,
  },
  context: {
    enabled: true,
    windowTokens: undefined,
    reserveOutputTokens: 8192,
    charsPerToken: 4,
  },
  instructions: {
    custom: undefined,
  },
  fileContext: {
    enabled: true,
    maxFiles: 8,
    maxIndexFiles: 2000,
    maxFileSize: 512_000,
    maxBytesPerFile: 32_000,
    maxTotalBytes: 120_000,
  },
  permissions: {
    mode: 'normal',
  },
  updates: {
    autoInstall: false,
  },
  desktop: {
    workspace: undefined,
  },
  ui: {
    locale: 'en',
  },
  tools: {
    shell: {
      enabled: true,
      timeoutMs: 10_000,
      maxBuffer: 200_000,
    },
  },
});

/**
 * Resolve final settings by merging defaults, user config, project config,
 * explicit config, and environment variables in that priority order.
 * @param {{ projectRoot?: string, userSettingsPath?: string, projectSettingsPath?: string, env?: Record<string,string> }} [options]
 * @returns {object} merged settings object
 */
function resolveSettings(options = {}) {
  const env = options.env || process.env;
  const projectRoot = path.resolve(options.projectRoot || env.HAX_AGENT_PROJECT_ROOT || process.cwd());
  const userSettingsPath = options.userSettingsPath || env.HAX_AGENT_USER_SETTINGS || defaultUserSettingsPath();
  const projectSettingsPath = options.projectSettingsPath || env.HAX_AGENT_PROJECT_SETTINGS || defaultProjectSettingsPath(projectRoot);
  const explicitSettingsPath = options.settingsPath || env.HAX_AGENT_SETTINGS;
  const sources = [];
  const jsonSettings = [];

  for (const source of [
    { type: 'user', filePath: userSettingsPath },
    { type: 'project', filePath: projectSettingsPath },
    { type: 'explicit', filePath: explicitSettingsPath },
  ]) {
    if (!source.filePath) {
      continue;
    }

    const loaded = loadJsonFile(source.filePath, { optional: true });
    sources.push({ type: source.type, path: loaded.path, loaded: loaded.loaded });

    if (loaded.loaded) {
      jsonSettings.push(loaded.data);
    }
  }

  const settings = normalizeSettings(
    mergeSettings(DEFAULT_SETTINGS, ...jsonSettings, readEnvOverrides(env), options.overrides || {}),
    projectRoot,
  );

  return { settings, sources };
}

/**
 * Load settings from default paths. Shortcut for resolveSettings().
 * @param {{ projectRoot?: string }} [options]
 * @returns {object} loaded settings
 */
function loadSettings(options = {}) {
  return resolveSettings(options).settings;
}

function updateUserSettings(updates, options = {}) {
  const env = options.env || process.env;
  const userSettingsPath = options.userSettingsPath || env.HAX_AGENT_USER_SETTINGS || defaultUserSettingsPath();
  const loaded = loadJsonFile(userSettingsPath, { optional: true });
  const nextSettings = mergeSettings(loaded.data, updates);

  fs.mkdirSync(path.dirname(userSettingsPath), { recursive: true });
  fs.writeFileSync(userSettingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');

  return { path: path.resolve(userSettingsPath), settings: nextSettings };
}

function loadJsonFile(filePath, options = {}) {
  const optional = options.optional !== false;
  const resolvedPath = path.resolve(filePath);

  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const data = JSON.parse(content);

    if (!isPlainObject(data)) {
      throw new Error(`Settings file must contain a JSON object: ${resolvedPath}`);
    }

    return { path: resolvedPath, loaded: true, data };
  } catch (error) {
    if (error.code === 'ENOENT' && optional) {
      return { path: resolvedPath, loaded: false, data: {} };
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in settings file ${resolvedPath}: ${error.message}`);
    }

    throw error;
  }
}

function defaultUserSettingsPath(homeDirectory = os.homedir()) {
  return path.join(defaultAppDataDirectory(homeDirectory), 'settings.json');
}

function defaultProjectSettingsPath(projectRoot = process.cwd()) {
  return path.join(path.resolve(projectRoot), '.hax-agent', 'settings.json');
}

function defaultAppDataDirectory(homeDirectory = os.homedir(), env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(homeDirectory, 'AppData', 'Roaming'), 'HaxAgent');
  }

  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'HaxAgent');
  }

  return path.join(env.XDG_DATA_HOME || path.join(homeDirectory, '.local', 'share'), 'hax-agent');
}

function readEnvOverrides(env = process.env) {
  const overrides = {};

  setIfDefined(overrides, ['agent', 'name'], env.HAX_AGENT_NAME);
  setIfDefined(overrides, ['agent', 'model'], env.HAX_AGENT_MODEL);
  setIfDefined(overrides, ['agent', 'provider'], env.HAX_AGENT_PROVIDER || env.AI_PROVIDER);
  setIfDefined(overrides, ['agent', 'apiKey'], env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.GOOGLE_API_KEY);
  setIfDefined(overrides, ['agent', 'apiUrl'], env.HAX_AGENT_API_URL || env.ANTHROPIC_BASE_URL || env.OPENAI_BASE_URL || env.GOOGLE_BASE_URL);
  setIfDefined(overrides, ['agent', 'maxTurns'], parseNumberEnv(env, 'HAX_AGENT_MAX_TURNS'));
  setIfDefined(overrides, ['agent', 'temperature'], parseNumberEnv(env, 'HAX_AGENT_TEMPERATURE'));
  setIfDefined(overrides, ['memory', 'enabled'], parseBooleanEnv(env, 'HAX_AGENT_MEMORY_ENABLED'));
  setIfDefined(overrides, ['memory', 'directory'], env.HAX_AGENT_MEMORY_DIR);
  setIfDefined(overrides, ['memory', 'maxItems'], parseNumberEnv(env, 'HAX_AGENT_MEMORY_MAX_ITEMS'));
  setIfDefined(overrides, ['sessions', 'directory'], env.HAX_AGENT_SESSION_DIR);
  setIfDefined(overrides, ['sessions', 'transcriptLimit'], parseNumberEnv(env, 'HAX_AGENT_TRANSCRIPT_LIMIT'));
  setIfDefined(overrides, ['prompts', 'includeSettings'], parseBooleanEnv(env, 'HAX_AGENT_INCLUDE_SETTINGS'));
  setIfDefined(overrides, ['prompts', 'includeMemory'], parseBooleanEnv(env, 'HAX_AGENT_INCLUDE_MEMORY'));
  setIfDefined(overrides, ['prompts', 'includeTranscript'], parseBooleanEnv(env, 'HAX_AGENT_INCLUDE_TRANSCRIPT'));
  setIfDefined(overrides, ['prompts', 'maxTranscriptMessages'], parseNumberEnv(env, 'HAX_AGENT_MAX_TRANSCRIPT_MESSAGES'));
  setIfDefined(overrides, ['context', 'enabled'], parseBooleanEnv(env, 'HAX_AGENT_CONTEXT_ENABLED'));
  setIfDefined(overrides, ['context', 'windowTokens'], parseNumberEnv(env, 'HAX_AGENT_CONTEXT_WINDOW_TOKENS'));
  setIfDefined(overrides, ['context', 'reserveOutputTokens'], parseNumberEnv(env, 'HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS'));
  setIfDefined(overrides, ['context', 'charsPerToken'], parseNumberEnv(env, 'HAX_AGENT_CONTEXT_CHARS_PER_TOKEN'));
  setIfDefined(overrides, ['instructions', 'custom'], env.HAX_AGENT_INSTRUCTIONS);
  setIfDefined(overrides, ['fileContext', 'enabled'], parseBooleanEnv(env, 'HAX_AGENT_FILE_CONTEXT_ENABLED'));
  setIfDefined(overrides, ['fileContext', 'maxFiles'], parseNumberEnv(env, 'HAX_AGENT_FILE_CONTEXT_MAX_FILES'));
  setIfDefined(overrides, ['fileContext', 'maxIndexFiles'], parseNumberEnv(env, 'HAX_AGENT_FILE_CONTEXT_MAX_INDEX_FILES'));
  setIfDefined(overrides, ['fileContext', 'maxFileSize'], parseNumberEnv(env, 'HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE'));
  setIfDefined(overrides, ['fileContext', 'maxBytesPerFile'], parseNumberEnv(env, 'HAX_AGENT_FILE_CONTEXT_MAX_BYTES_PER_FILE'));
  setIfDefined(overrides, ['fileContext', 'maxTotalBytes'], parseNumberEnv(env, 'HAX_AGENT_FILE_CONTEXT_MAX_TOTAL_BYTES'));
  setIfDefined(overrides, ['permissions', 'mode'], env.HAX_AGENT_PERMISSIONS_MODE);
  setIfDefined(overrides, ['updates', 'autoInstall'], parseBooleanEnv(env, 'HAX_AGENT_UPDATES_AUTO_INSTALL'));
  setIfDefined(overrides, ['desktop', 'workspace'], env.HAX_AGENT_DESKTOP_WORKSPACE);
  setIfDefined(overrides, ['ui', 'locale'], env.HAX_AGENT_LOCALE || env.HAX_AGENT_LANGUAGE);
  setIfDefined(overrides, ['tools', 'shell', 'enabled'], parseBooleanEnv(env, 'HAX_AGENT_SHELL_ENABLED'));
  setIfDefined(overrides, ['tools', 'shell', 'timeoutMs'], parseNumberEnv(env, 'HAX_AGENT_SHELL_TIMEOUT_MS'));
  setIfDefined(overrides, ['tools', 'shell', 'maxBuffer'], parseNumberEnv(env, 'HAX_AGENT_SHELL_MAX_BUFFER'));

  return overrides;
}

function normalizeSettings(settings, projectRoot) {
  const normalized = mergeSettings(settings);

  normalized.projectRoot = projectRoot;
  normalized.desktop.workspace = normalized.desktop.workspace
    ? path.resolve(normalized.desktop.workspace)
    : undefined;
  normalized.memory.directory = resolveConfigPath(projectRoot, normalized.memory.directory, defaultMemoryDirectory());
  normalized.sessions.directory = resolveConfigPath(projectRoot, normalized.sessions.directory, defaultSessionDirectory());

  return normalized;
}

function defaultMemoryDirectory() {
  return path.join(defaultAppDataDirectory(), 'memory');
}

function defaultSessionDirectory() {
  return path.join(defaultAppDataDirectory(), 'sessions');
}

function resolveConfigPath(projectRoot, configuredPath, fallbackPath = projectRoot) {
  if (!configuredPath) {
    return path.normalize(fallbackPath);
  }

  if (path.isAbsolute(configuredPath)) {
    return path.normalize(configuredPath);
  }

  return path.resolve(projectRoot, configuredPath);
}

function mergeSettings(...settingsList) {
  const target = {};

  for (const settings of settingsList) {
    mergeInto(target, settings || {});
  }

  return target;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = cloneValue(value);
    }
  }

  return target;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    return mergeSettings(value);
  }

  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setIfDefined(target, pathSegments, value) {
  if (value === undefined || value === '') {
    return;
  }

  let cursor = target;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }

    cursor = cursor[segment];
  }

  cursor[pathSegments[pathSegments.length - 1]] = value;
}

function parseNumberEnv(env, name) {
  const value = env[name];

  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }

  return parsed;
}

function parseBooleanEnv(env, name) {
  const value = env[name];

  if (value === undefined || value === '') {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value`);
}

function parseListEnv(env, name) {
  const value = env[name];

  if (value === undefined || value === '') {
    return undefined;
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  DEFAULT_SETTINGS,
  defaultAppDataDirectory,
  defaultMemoryDirectory,
  defaultProjectSettingsPath,
  defaultSessionDirectory,
  defaultUserSettingsPath,
  loadJsonFile,
  loadSettings,
  mergeSettings,
  updateUserSettings,
  readEnvOverrides,
  resolveConfigPath,
  resolveSettings,
};
