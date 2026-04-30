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
    directory: '.hax-agent/memory',
    maxItems: 20,
  },
  sessions: {
    directory: '.hax-agent/sessions',
    transcriptLimit: 100,
  },
  prompts: {
    includeSettings: true,
    includeMemory: true,
    includeTranscript: true,
    maxTranscriptMessages: 20,
  },
  tools: {
    shell: {
      enabled: true,
      allowedCommands: [
        'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun',
        'git', 'gh',
        'ls', 'dir', 'cat', 'type', 'echo', 'head', 'tail', 'wc', 'pwd', 'whoami', 'hostname',
        'mkdir', 'rm', 'cp', 'mv', 'touch', 'rmdir',
        'find', 'grep', 'rg', 'ag',
        'curl', 'wget',
        'python', 'python3', 'pip', 'pip3',
        'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
        'docker', 'docker-compose',
        'code', 'open', 'start',
      ],
      timeoutMs: 10_000,
      maxBuffer: 200_000,
    },
  },
});

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
  return path.join(homeDirectory, '.hax-agent', 'settings.json');
}

function defaultProjectSettingsPath(projectRoot = process.cwd()) {
  return path.join(path.resolve(projectRoot), '.hax-agent', 'settings.json');
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
  setIfDefined(overrides, ['tools', 'shell', 'enabled'], parseBooleanEnv(env, 'HAX_AGENT_SHELL_ENABLED'));
  setIfDefined(overrides, ['tools', 'shell', 'allowedCommands'], parseListEnv(env, 'HAX_AGENT_SHELL_COMMANDS'));
  setIfDefined(overrides, ['tools', 'shell', 'timeoutMs'], parseNumberEnv(env, 'HAX_AGENT_SHELL_TIMEOUT_MS'));
  setIfDefined(overrides, ['tools', 'shell', 'maxBuffer'], parseNumberEnv(env, 'HAX_AGENT_SHELL_MAX_BUFFER'));

  return overrides;
}

function normalizeSettings(settings, projectRoot) {
  const normalized = mergeSettings(settings);

  normalized.projectRoot = projectRoot;
  normalized.memory.directory = resolveConfigPath(projectRoot, normalized.memory.directory);
  normalized.sessions.directory = resolveConfigPath(projectRoot, normalized.sessions.directory);

  return normalized;
}

function resolveConfigPath(projectRoot, configuredPath) {
  if (!configuredPath) {
    return projectRoot;
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
  defaultProjectSettingsPath,
  defaultUserSettingsPath,
  loadJsonFile,
  loadSettings,
  mergeSettings,
  updateUserSettings,
  readEnvOverrides,
  resolveConfigPath,
  resolveSettings,
};
