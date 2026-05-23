/**
 * Temporary filesystem helpers for HaxAgent tests.
 *
 * Each `with*` function creates a temporary resource, calls a user-provided
 * async function, and guarantees cleanup afterward — even if the function
 * throws. Use these instead of manual fs.mkdtempSync / fs.unlinkSync to
 * avoid leaking test artifacts.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// withTempDir
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory, call fn(dirPath), and remove it afterward.
 *
 * @param {Function} fn - async function receiving (dirPath: string)
 * @param {object} [options]
 * @param {string} [options.prefix="hax-test-"] - prefix for temp dir name
 * @param {string} [options.parentDir] - parent directory (defaults to os.tmpdir())
 * @returns {Promise<any>} the return value of fn
 *
 * @example
 *   const result = await withTempDir(async (dir) => {
 *     fs.writeFileSync(path.join(dir, "test.txt"), "hello");
 *     return fs.readFileSync(path.join(dir, "test.txt"), "utf8");
 *   });
 *   // dir is guaranteed to be deleted
 */
async function withTempDir(fn, options = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("withTempDir: fn must be a function");
  }

  const prefix = options.prefix || "hax-test-";
  const parentDir = options.parentDir || os.tmpdir();
  const dirPath = fs.mkdtempSync(path.join(parentDir, prefix));

  try {
    return await fn(dirPath);
  } finally {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_cleanupErr) {
      // Best-effort cleanup; don't mask the original error
    }
  }
}

// ---------------------------------------------------------------------------
// withTempFile
// ---------------------------------------------------------------------------

/**
 * Create a temporary file with the given content, call fn(filePath), and
 * remove it afterward.
 *
 * @param {string} content - file content (string or Buffer)
 * @param {Function} fn - async function receiving (filePath: string)
 * @param {object} [options]
 * @param {string} [options.prefix="hax-test-"] - prefix for temp file name
 * @param {string} [options.suffix=".tmp"] - suffix for temp file name
 * @param {string} [options.encoding="utf8"] - encoding to write (ignored for Buffer)
 * @param {string} [options.parentDir] - parent directory (defaults to os.tmpdir())
 * @returns {Promise<any>} the return value of fn
 *
 * @example
 *   const stats = await withTempFile("hello world", async (filePath) => {
 *     return fs.statSync(filePath);
 *   });
 */
async function withTempFile(content, fn, options = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("withTempFile: fn must be a function");
  }

  const prefix = options.prefix || "hax-test-";
  const suffix = options.suffix || ".tmp";
  const encoding = options.encoding || "utf8";
  const parentDir = options.parentDir || os.tmpdir();
  // Use writeStream-friendly path pattern
  const filePath = path.join(parentDir, `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${suffix}`);

  // Write content
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, String(content), encoding);
  }

  try {
    return await fn(filePath);
  } finally {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_cleanupErr) {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// withTempSession
// ---------------------------------------------------------------------------

/**
 * Create a temporary session directory structure, call fn(sessionDir, options),
 * and remove the entire directory afterward.
 *
 * The session directory is populated with a minimal structure:
 *   - session.jsonl  (the transcript, if `transcript` option provided)
 *   - meta.json       (session metadata)
 *   - memory/         (memory directory, created but empty)
 *
 * @param {Function} fn - async function receiving (sessionDir: string, info: object)
 * @param {object} [options]
 * @param {string} [options.sessionId] - session id (auto-generated if omitted)
 * @param {Array<object>} [options.transcript] - transcript entries to write
 * @param {object} [options.meta] - metadata to write to meta.json
 * @param {object} [options.memories] - map of name -> content to write into memory/
 * @param {string} [options.prefix="hax-session-"] - prefix for temp dir name
 * @param {string} [options.parentDir] - parent directory (defaults to os.tmpdir())
 * @returns {Promise<any>} the return value of fn
 *
 * @example
 *   const sessionId = await withTempSession(async (dir, info) => {
 *     // read transcript, manipulate files, etc.
 *     return info.sessionId;
 *   }, { transcript: sampleSessionTranscript() });
 */
async function withTempSession(fn, options = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("withTempSession: fn must be a function");
  }

  const prefix = options.prefix || "hax-session-";
  const parentDir = options.parentDir || os.tmpdir();
  const dirPath = fs.mkdtempSync(path.join(parentDir, prefix));
  const sessionId = options.sessionId || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Create session directory
    const sessionDir = path.join(dirPath, "sessions", sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Write transcript
    if (options.transcript && Array.isArray(options.transcript)) {
      const transcriptPath = path.join(sessionDir, "session.jsonl");
      const lines = options.transcript.map((entry) => JSON.stringify(entry)).join("\n");
      fs.writeFileSync(transcriptPath, lines ? `${lines}\n` : "", "utf8");
    }

    // Write metadata
    const meta = options.meta || {
      sessionId,
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(sessionDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

    // Write memories
    const memoryDir = path.join(dirPath, "memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    if (options.memories && typeof options.memories === "object") {
      for (const [name, content] of Object.entries(options.memories)) {
        const safeName = name.replace(/[<>:"/\\|?*]/g, "_");
        const memoryFile = path.join(memoryDir, `${safeName}.json`);
        const record = {
          name,
          namespace: "default",
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content,
        };
        fs.writeFileSync(memoryFile, JSON.stringify(record, null, 2), "utf8");
      }
    }

    const info = {
      sessionId,
      rootDir: dirPath,
      sessionDir,
      memoryDir,
      get transcriptPath() { return path.join(sessionDir, "session.jsonl"); },
      get metaPath() { return path.join(sessionDir, "meta.json"); },
    };

    return await fn(dirPath, info);
  } finally {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_cleanupErr) {
      // Best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// withTempEnv (bonus utility)
// ---------------------------------------------------------------------------

/**
 * Temporarily mutate process.env variables, call fn(), and restore them.
 *
 * This is NOT concurrency-safe (it mutates shared state). For truly
 * isolated tests, prefer passing an explicit `env` object to the code
 * under test. Use this helper for integration or smoke tests where the
 * code reads process.env directly.
 *
 * @param {object} envVars - key/value pairs to set on process.env
 * @param {Function} fn - async function to call with mutated env
 * @returns {Promise<any>} the return value of fn
 *
 * @example
 *   const result = await withTempEnv({ HAX_AGENT_MODEL: "gpt-4o" }, async () => {
 *     return resolveSettings();
 *   });
 *   // process.env.HAX_AGENT_MODEL is restored
 */
async function withTempEnv(envVars, fn) {
  if (typeof fn !== "function") {
    throw new TypeError("withTempEnv: fn must be a function");
  }

  const previous = {};
  const keys = Object.keys(envVars);

  for (const key of keys) {
    previous[key] = process.env[key];
    if (envVars[key] === undefined || envVars[key] === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(envVars[key]);
    }
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  withTempDir,
  withTempFile,
  withTempSession,
  withTempEnv,
};
