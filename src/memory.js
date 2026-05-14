const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { defaultMemoryDirectory, defaultSessionDirectory } = require('./config');

const SESSION_META_TYPE = 'session.meta';

function createStorage(options = {}) {
  const settings = options.settings || options;
  const projectRoot = path.resolve(settings.projectRoot || process.cwd());

  return {
    projectRoot,
    memoryDirectory: resolveStoragePath(projectRoot, settings.memoryDirectory || settings.memory?.directory || defaultMemoryDirectory()),
    sessionDirectory: resolveStoragePath(projectRoot, settings.sessionDirectory || settings.sessions?.directory || defaultSessionDirectory()),
  };
}

function createSessionId(date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(4).toString('hex');

  return `${timestamp}-${suffix}`;
}

function appendTranscriptEntry(sessionId, entry, options = {}) {
  const filePath = getSessionTranscriptPath(sessionId, options);
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  ensureDirectory(path.dirname(filePath));
  ensureTranscriptMetadata(filePath, options);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

  return record;
}

function writeTranscript(sessionId, entries, options = {}) {
  const filePath = getSessionTranscriptPath(sessionId, options);
  const metadata = createTranscriptMetadata(options);
  const hasMetadata = entries.some((entry) => entry?.type === SESSION_META_TYPE);
  const records = hasMetadata ? entries : [metadata, ...entries];
  const lines = records.map((entry) => JSON.stringify(entry)).join('\n');

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, lines ? `${lines}\n` : '', 'utf8');

  return filePath;
}

function readTranscript(sessionId, options = {}) {
  return readChatTranscriptFile(getSessionTranscriptPath(sessionId, options));
}

function readTranscriptFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();

  if (!content) {
    return [];
  }

  return content.split(/\r?\n/).map((line, index) => parseJsonLine(line, filePath, index + 1));
}

function listSessions(options = {}) {
  const storage = createStorage(options);

  if (!fs.existsSync(storage.sessionDirectory)) {
    return [];
  }

  return fs.readdirSync(storage.sessionDirectory)
    .filter((fileName) => fileName.endsWith('.jsonl'))
    .map((fileName) => {
      const filePath = path.join(storage.sessionDirectory, fileName);
      const stats = fs.statSync(filePath);

      return {
        id: path.basename(fileName, '.jsonl'),
        path: filePath,
        entries: () => readChatTranscriptFile(filePath),
        metadata: () => readTranscriptMetadata(filePath),
        updatedAt: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function writeMemory(name, content, options = {}) {
  const filePath = getMemoryPath(name, options);
  const existing = readMemory(name, options);
  const now = new Date().toISOString();
  const record = {
    name,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    content,
  };

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return record;
}

function readMemory(name, options = {}) {
  const filePath = getMemoryPath(name, options);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return readJsonFile(filePath);
}

function listMemories(options = {}) {
  const storage = createStorage(options);

  if (!fs.existsSync(storage.memoryDirectory)) {
    return [];
  }

  return fs.readdirSync(storage.memoryDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => readJsonFile(path.join(storage.memoryDirectory, fileName)))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

function deleteMemory(name, options = {}) {
  const filePath = getMemoryPath(name, options);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function clearSessions(options = {}) {
  const storage = createStorage(options);

  if (!fs.existsSync(storage.sessionDirectory)) {
    return 0;
  }

  const files = fs.readdirSync(storage.sessionDirectory)
    .filter((fileName) => fileName.endsWith('.jsonl'));

  for (const fileName of files) {
    fs.unlinkSync(path.join(storage.sessionDirectory, fileName));
  }

  return files.length;
}

function getSessionTranscriptPath(sessionId, options = {}) {
  const storage = createStorage(options);
  const transcriptId = String(sessionId || '').trim();

  if (isFileSafeName(transcriptId)) {
    const directPath = path.join(storage.sessionDirectory, `${transcriptId}.jsonl`);

    if (fs.existsSync(directPath) || isGeneratedTranscriptId(transcriptId)) {
      return directPath;
    }
  }

  return path.join(storage.sessionDirectory, `${toFileSafeName(sessionId, 'session id')}.jsonl`);
}

function getMemoryPath(name, options = {}) {
  const storage = createStorage(options);

  return path.join(storage.memoryDirectory, `${toFileSafeName(name, 'memory name')}.json`);
}

function resolveStoragePath(projectRoot, configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return path.normalize(configuredPath);
  }

  return path.resolve(projectRoot, configuredPath);
}

function ensureTranscriptMetadata(filePath, options = {}) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return;
  }

  const metadata = createTranscriptMetadata(options);
  if (metadata) {
    fs.appendFileSync(filePath, `${JSON.stringify(metadata)}\n`, 'utf8');
  }
}

function createTranscriptMetadata(options = {}) {
  const storage = createStorage(options);
  const projectRoot = Object.prototype.hasOwnProperty.call(options, 'transcriptProjectRoot')
    ? normalizeOptionalPath(options.transcriptProjectRoot)
    : normalizeOptionalPath(options.projectRoot || storage.projectRoot);
  const projectName = projectRoot ? path.basename(projectRoot) : '';

  return {
    type: SESSION_META_TYPE,
    timestamp: new Date().toISOString(),
    projectRoot,
    projectName,
  };
}

function readTranscriptMetadata(filePath) {
  const entries = readTranscriptFile(filePath);
  return entries.find((entry) => entry?.type === SESSION_META_TYPE) || null;
}

function readChatTranscriptFile(filePath) {
  return readTranscriptFile(filePath).filter((entry) => entry?.type !== SESSION_META_TYPE);
}

function normalizeOptionalPath(value) {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }

    throw error;
  }
}

function parseJsonLine(line, filePath, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid transcript JSON in ${filePath}:${lineNumber}: ${error.message}`);
  }
}

function toFileSafeName(value, label) {
  const text = String(value || '').trim();

  if (!text) {
    throw new Error(`${label} is required`);
  }

  const slug = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);

  return `${slug || 'item'}-${hash}`;
}

function isFileSafeName(value) {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value === path.basename(value);
}

function isGeneratedTranscriptId(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-[a-f0-9]{8}$/i.test(value);
}

module.exports = {
  appendTranscriptEntry,
  clearSessions,
  createTranscriptMetadata,
  createSessionId,
  createStorage,
  deleteMemory,
  ensureDirectory,
  getMemoryPath,
  getSessionTranscriptPath,
  listMemories,
  listSessions,
  readMemory,
  readTranscript,
  readTranscriptMetadata,
  resolveStoragePath,
  toFileSafeName,
  writeMemory,
  writeTranscript,
};
