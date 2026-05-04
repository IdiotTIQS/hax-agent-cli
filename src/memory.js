const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createStorage(options = {}) {
  const settings = options.settings || options;
  const projectRoot = path.resolve(settings.projectRoot || process.cwd());

  return {
    projectRoot,
    memoryDirectory: resolveStoragePath(projectRoot, settings.memoryDirectory || settings.memory?.directory || '.hax-agent/memory'),
    sessionDirectory: resolveStoragePath(projectRoot, settings.sessionDirectory || settings.sessions?.directory || '.hax-agent/sessions'),
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
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

  return record;
}

function writeTranscript(sessionId, entries, options = {}) {
  const filePath = getSessionTranscriptPath(sessionId, options);
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, lines ? `${lines}\n` : '', 'utf8');

  return filePath;
}

function readTranscript(sessionId, options = {}) {
  return readTranscriptFile(getSessionTranscriptPath(sessionId, options));
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
        entries: () => readTranscriptFile(filePath),
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
  resolveStoragePath,
  toFileSafeName,
  writeMemory,
  writeTranscript,
};
