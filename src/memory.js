'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

function normalizeTags(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.filter(t => typeof t === 'string').map(t => t.toLowerCase().trim()).filter(t => t.length > 0))];
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
  }
  return [];
}

function writeMemory(name, content, options = {}) {
  const namespace = typeof options.namespace === 'string' ? options.namespace.trim() : 'default';
  const tags = normalizeTags(options.tags);
  const existing = readMemory(name, options);
  // When updating without explicit namespace, carry forward the existing namespace
  // so the file path matches the original location
  const effectiveNamespace = existing && typeof options.namespace !== 'string'
    ? existing.namespace || 'default'
    : namespace;
  const effectiveTags = existing && options.tags == null
    ? existing.tags || []
    : tags;
  const filePath = getMemoryPath(name, { ...options, namespace: effectiveNamespace });
  const now = new Date().toISOString();
  const record = {
    name,
    namespace: existing?.namespace || namespace,
    tags: effectiveTags,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    content,
  };

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return record;
}

function readMemory(name, options = {}) {
  const safeName = toFileSafeName(name, 'memory name');
  const fileName = `${safeName}.json`;

  // If namespace explicitly specified, only look there
  if (typeof options.namespace === 'string') {
    const filePath = getMemoryPath(name, options);
    if (fs.existsSync(filePath)) {
      return readJsonFile(filePath);
    }
    return null;
  }

  // First try root directory (no namespace / default namespace)
  const rootPath = path.join(createStorage(options).memoryDirectory, fileName);
  if (fs.existsSync(rootPath)) {
    return readJsonFile(rootPath);
  }

  // Then search namespace subdirectories
  const storage = createStorage(options);
  if (fs.existsSync(storage.memoryDirectory)) {
    const entries = fs.readdirSync(storage.memoryDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nsFilePath = path.join(storage.memoryDirectory, entry.name, fileName);
        if (fs.existsSync(nsFilePath)) {
          return readJsonFile(nsFilePath);
        }
      }
    }
  }

  return null;
}

function listMemories(options = {}) {
  const storage = createStorage(options);
  const filterNamespace = typeof options.namespace === 'string' ? options.namespace.trim() : null;
  const filterTag = typeof options.tag === 'string' ? options.tag.trim().toLowerCase() : null;

  if (!fs.existsSync(storage.memoryDirectory)) {
    return [];
  }

  const results = [];

  function collectFromDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !filterNamespace) {
        collectFromDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          results.push(readJsonFile(fullPath));
        } catch (_) {
          // Skip corrupt or unreadable memory files silently
        }
      }
    }
  }

  if (filterNamespace && filterNamespace !== 'default') {
    const nsDir = path.join(storage.memoryDirectory, toFileSafeName(filterNamespace, 'namespace'));
    collectFromDir(nsDir);
  } else {
    collectFromDir(storage.memoryDirectory);
  }

  let filtered = results;
  if (filterNamespace) {
    filtered = filtered.filter((mem) => (mem.namespace || 'default') === filterNamespace);
  }
  if (filterTag) {
    filtered = filtered.filter((mem) => (mem.tags || []).some((t) => t.toLowerCase() === filterTag));
  }

  return filtered.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

function deleteMemory(name, options = {}) {
  const filePath = getMemoryPath(name, options);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function searchMemories(query, options = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const filterNamespace = typeof options.namespace === 'string' ? options.namespace.trim() : null;
  const filterTag = typeof options.tag === 'string' ? options.tag.trim().toLowerCase() : null;
  let all = listMemories(options);

  if (filterNamespace) {
    all = all.filter((mem) => (mem.namespace || 'default') === filterNamespace);
  }
  if (filterTag) {
    all = all.filter((mem) => (mem.tags || []).some((t) => t.toLowerCase() === filterTag));
  }

  const wordBoundary = new RegExp(`\\b${escapeRegex(q)}\\b`, 'i');
  const scored = all.map((mem) => {
    let score = 0;
    if (mem.name && mem.name.toLowerCase().includes(q)) {
      score += 30;
      if (wordBoundary.test(mem.name)) score += 20;
    }
    if ((mem.tags || []).some((t) => t.toLowerCase().includes(q))) {
      score += 25;
    }
    if ((mem.namespace || 'default').toLowerCase().includes(q)) {
      score += 20;
    }
    if (mem.content && mem.content.toLowerCase().includes(q)) {
      score += 10;
      if (wordBoundary.test(mem.content)) score += 10;
    }
    return { ...mem, score };
  });

  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

function escapeRegex(str) {
  return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
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
  const namespace = typeof options.namespace === 'string' && options.namespace !== 'default'
    ? options.namespace.trim()
    : null;
  const baseDir = namespace
    ? path.join(storage.memoryDirectory, toFileSafeName(namespace, 'namespace'))
    : storage.memoryDirectory;

  return path.join(baseDir, `${toFileSafeName(name, 'memory name')}.json`);
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
  normalizeTags,
  readMemory,
  readTranscript,
  readTranscriptMetadata,
  resolveStoragePath,
  searchMemories,
  toFileSafeName,
  writeMemory,
  writeTranscript,
};
