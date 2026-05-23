"use strict";

/**
 * Memory archiver.
 *
 * Archives old or low-priority memories to compressed JSON files on disk
 * so they can be restored later. Archives are gzip-compressed JSON with
 * metadata for listing, searching, and lifecycle management.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const os = require("node:os");

const DEFAULT_ARCHIVE_DIR = path.join(
  os.tmpdir(),
  "hax-memory-archives"
);
const ARCHIVE_EXTENSION = ".json.gz";
const DEFAULT_MAX_ARCHIVE_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const DEFAULT_MAX_ARCHIVE_COUNT = 50;
const DEFAULT_NAME_PREFIX = "hax-memory-archive";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique archive file name with timestamp.
 * @param {string} [prefix]
 * @returns {string}
 */
function generateArchiveName(prefix = DEFAULT_NAME_PREFIX) {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${suffix}${ARCHIVE_EXTENSION}`;
}

/**
 * Safely create a directory tree or return false.
 * @param {string} dir
 * @returns {boolean}
 */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * List archive files in a directory with their metadata.
 * @param {string} archiveDir
 * @returns {object[]}
 */
function listArchiveFiles(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(ARCHIVE_EXTENSION)) {
      const filePath = path.join(archiveDir, entry.name);
      try {
        const stats = fs.statSync(filePath);
        const metadata = readArchiveMetadata(filePath);
        results.push({
          name: entry.name,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          memoryCount: metadata ? metadata.memoryCount : null,
          namespaces: metadata ? metadata.namespaces : [],
          totalOriginalChars: metadata ? metadata.totalOriginalChars : null,
          totalCompressedChars: metadata ? metadata.totalCompressedChars : null,
        });
      } catch (_) {
        // Skip files we can't read.
      }
    }
  }
  return results.sort(
    (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

/**
 * Read metadata from a compressed archive without decompressing all memories.
 * @param {string} archivePath
 * @returns {object|null}
 */
function readArchiveMetadata(archivePath) {
  try {
    const compressed = fs.readFileSync(archivePath);
    const json = zlib.gunzipSync(compressed).toString("utf8");
    const archive = JSON.parse(json);
    return archive.metadata || null;
  } catch (_) {
    return null;
  }
}

/**
 * Read the full contents of an archive.
 * @param {string} archivePath
 * @returns {{ metadata: object, memories: object[] }|null}
 */
function readArchive(archivePath) {
  try {
    const compressed = fs.readFileSync(archivePath);
    const json = zlib.gunzipSync(compressed).toString("utf8");
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MemoryArchiver
// ---------------------------------------------------------------------------

class MemoryArchiver {
  /**
   * @param {object} [options]
   * @param {string} [options.archiveDir] - Directory where archive files are
   *   stored. Defaults to a temp directory location.
   * @param {number} [options.maxArchiveAgeMs=7776000000] - Maximum age of
   *   an archive before it is eligible for pruning (90 days).
   * @param {number} [options.maxArchiveCount=50] - Maximum number of archive
   *   files to keep.
   */
  constructor(options = {}) {
    this.archiveDir =
      typeof options.archiveDir === "string" && options.archiveDir.trim()
        ? path.resolve(options.archiveDir.trim())
        : DEFAULT_ARCHIVE_DIR;

    this.maxArchiveAgeMs =
      Number.isFinite(options.maxArchiveAgeMs) && options.maxArchiveAgeMs > 0
        ? options.maxArchiveAgeMs
        : DEFAULT_MAX_ARCHIVE_AGE_MS;

    this.maxArchiveCount =
      Number.isSafeInteger(options.maxArchiveCount) && options.maxArchiveCount > 0
        ? options.maxArchiveCount
        : DEFAULT_MAX_ARCHIVE_COUNT;
  }

  // -----------------------------------------------------------------------
  // archive(memories, archivePath)
  // -----------------------------------------------------------------------

  /**
   * Archive a set of memories to a compressed JSON file.
   *
   * @param {object[]} memories - Array of memory records to archive.
   * @param {string} [archivePath] - Optional custom path for the archive.
   *   If omitted, a timestamped name is generated.
   * @returns {{ path: string, metadata: object }|null}
   *   Returns null if there is nothing to archive.
   */
  archive(memories, archivePath) {
    const entries = Array.isArray(memories) ? memories : [];
    if (entries.length === 0) return null;

    ensureDir(this.archiveDir);

    const filePath = archivePath
      ? path.resolve(archivePath)
      : path.join(this.archiveDir, generateArchiveName());

    const now = new Date().toISOString();

    // Compute namespace summary.
    const nsSet = new Set();
    let totalOriginalChars = 0;
    for (const mem of entries) {
      if (mem.namespace) nsSet.add(mem.namespace);
      totalOriginalChars += String(mem.content || "").length;
    }

    const metadata = {
      version: 1,
      createdAt: now,
      memoryCount: entries.length,
      namespaces: [...nsSet].sort(),
      totalOriginalChars,
      totalCompressedChars: 0, // filled after compression
    };

    const archive = {
      metadata,
      memories: entries,
    };

    const json = JSON.stringify(archive, null, 2);
    metadata.totalCompressedChars = json.length;

    const compressed = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 6 });
    fs.writeFileSync(filePath, compressed);

    return {
      path: filePath,
      metadata: {
        name: path.basename(filePath),
        ...metadata,
        fileSize: compressed.length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // restore(archivePath, filter)
  // -----------------------------------------------------------------------

  /**
   * Restore memories from an archive file.
   *
   * @param {string} archivePath - Path to the archive file.
   * @param {object} [filter]
   * @param {string} [filter.namespace] - Only restore memories from this
   *   namespace.
   * @param {string} [filter.tag] - Only restore memories with this tag.
   * @param {string} [filter.name] - Only restore memories whose name
   *   contains this substring (case-insensitive).
   * @returns {object[]} Restored memory records, or empty array if archive
   *   not found or empty.
   */
  restore(archivePath, filter = {}) {
    const data = readArchive(archivePath);
    if (!data || !Array.isArray(data.memories)) return [];

    let memories = data.memories.map((m) => ({
      ...m,
      restoredFromArchive: path.basename(archivePath),
      restoredAt: new Date().toISOString(),
    }));

    if (filter.namespace) {
      const ns = String(filter.namespace).trim();
      memories = memories.filter((m) => (m.namespace || "default") === ns);
    }

    if (filter.tag) {
      const tag = String(filter.tag).trim().toLowerCase();
      memories = memories.filter((m) =>
        (m.tags || []).some((t) => String(t).toLowerCase() === tag)
      );
    }

    if (filter.name) {
      const q = String(filter.name).trim().toLowerCase();
      memories = memories.filter((m) =>
        String(m.name || "").toLowerCase().includes(q)
      );
    }

    return memories;
  }

  // -----------------------------------------------------------------------
  // listArchives()
  // -----------------------------------------------------------------------

  /**
   * List all available archives with metadata.
   *
   * @returns {object[]} Array of archive descriptors, each with name, path,
   *   size, creation date, memory count, and namespaces.
   */
  listArchives() {
    return listArchiveFiles(this.archiveDir);
  }

  // -----------------------------------------------------------------------
  // pruneArchives(maxAge, maxCount)
  // -----------------------------------------------------------------------

  /**
   * Clean up old archives. Both age and count constraints are applied.
   *
   * @param {number} [maxAge] - Maximum age in milliseconds. Archives older
   *   than this are removed. Uses constructor default if omitted.
   * @param {number} [maxCount] - Maximum number of archives to keep. Oldest
   *   (by creation date) are removed first. Uses constructor default if
   *   omitted.
   * @returns {{ removed: number, kept: number, removedPaths: string[] }}
   */
  pruneArchives(maxAge, maxCount) {
    const ageThreshold =
      Number.isFinite(maxAge) && maxAge > 0 ? maxAge : this.maxArchiveAgeMs;

    const countLimit =
      Number.isSafeInteger(maxCount) && maxCount > 0
        ? maxCount
        : this.maxArchiveCount;

    const all = listArchiveFiles(this.archiveDir);
    if (all.length === 0) return { removed: 0, kept: 0, removedPaths: [] };

    const now = Date.now();
    const toRemove = new Set();

    // Age-based pruning.
    for (const archive of all) {
      const created = new Date(archive.createdAt).getTime();
      if (now - created > ageThreshold) {
        toRemove.add(archive);
      }
    }

    // Count-based pruning: keep only the newest `countLimit` archives.
    const sortedByAge = [...all]
      .filter((a) => !toRemove.has(a))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    for (let i = countLimit; i < sortedByAge.length; i++) {
      toRemove.add(sortedByAge[i]);
    }

    const removedPaths = [];
    for (const archive of toRemove) {
      try {
        fs.unlinkSync(archive.path);
        removedPaths.push(archive.path);
      } catch (_) {
        // Skip files we can't delete.
      }
    }

    return {
      removed: removedPaths.length,
      kept: all.length - removedPaths.length,
      removedPaths,
    };
  }

  // -----------------------------------------------------------------------
  // searchArchives(query)
  // -----------------------------------------------------------------------

  /**
   * Search across all archived memories for a given query string.
   *
   * Match scoring prioritizes name matches, then tag matches, then content
   * matches. Results are sorted by score descending.
   *
   * @param {string} query - Search query.
   * @param {object} [options]
   * @param {number} [options.limit=50] - Maximum number of results.
   * @param {string} [options.namespace] - Only search within this namespace.
   * @returns {{ archive: string, memory: object, score: number }[]}
   */
  searchArchives(query, options = {}) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];

    const limit =
      Number.isSafeInteger(options.limit) && options.limit > 0
        ? options.limit
        : 50;

    const filterNs =
      typeof options.namespace === "string"
        ? options.namespace.trim()
        : null;

    const archives = this.listArchives();
    const results = [];

    for (const archive of archives) {
      const data = readArchive(archive.path);
      if (!data || !Array.isArray(data.memories)) continue;

      for (const mem of data.memories) {
        if (filterNs && (mem.namespace || "default") !== filterNs) continue;

        let score = 0;
        const name = String(mem.name || "").toLowerCase();
        const content = String(mem.content || "").toLowerCase();
        const tags = (mem.tags || []).map((t) => String(t).toLowerCase());

        if (name.includes(q)) score += 30;
        if (tags.some((t) => t.includes(q))) score += 25;
        if (content.includes(q)) score += 10;

        if (score > 0) {
          results.push({
            archive: archive.name,
            memory: mem,
            score,
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MemoryArchiver,
  generateArchiveName,
  readArchiveMetadata,
  readArchive,
  listArchiveFiles,
};
