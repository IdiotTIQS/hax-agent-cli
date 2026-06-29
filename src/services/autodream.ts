/**
 * Autodream - automated memory consolidation and cleanup.
 * Ported from OpenHarness services/autodream/
 *
 * Periodically analyzes accumulated memories for:
 * - Duplicate detection and merging
 * - Stale/outdated memory cleanup
 * - Confidence-based memory promotion/demotion
 * - Backup creation before mutations
 *
 * Runs as a background process, triggered by:
 * - Turn count threshold (every N turns)
 * - Time threshold (every M minutes)
 * - Manual trigger (/dream command)
 *
 * Critical invariants:
 * - Always backs up before modifying
 * - Never deletes without archiving
 * - Runs non-blocking (spawned in background)
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// === Autodream Config ===

const DEFAULT_CONFIG = {
  turnInterval: 15,        // Consolidate every N turns
  timeIntervalMs: 10 * 60 * 1000, // or every 10 minutes
  maxMemoriesBeforeCompact: 50,   // Trigger when memory count exceeds this
  backupRetention: 5,      // Keep last N backups
  staleThresholdDays: 30,  // Memories older than this without reinforcement are stale
  minConfidence: 2,        // Minimum confidence to keep (1-2 get archived)
};

// === Interfaces ===

interface AutodreamConfig {
  turnInterval: number;
  timeIntervalMs: number;
  maxMemoriesBeforeCompact: number;
  backupRetention: number;
  staleThresholdDays: number;
  minConfidence: number;
}

interface AutodreamManagerOptions {
  memoryDir?: string;
  config?: Partial<AutodreamConfig>;
}

interface RunOptions {
  memories?: MemoryItem[];
  onProgress?: (msg: string) => void;
}

interface AutodreamSchedulerOptions {
  intervalMs?: number;
}

interface MemoryItem {
  content?: string;
  confidence?: number;
  occurrenceCount?: number;
  timestamp?: number;
  category?: string;
  [key: string]: unknown;
}

interface DuplicateGroup {
  original: MemoryItem;
  copies: MemoryItem[];
  signature: string;
}

// === Autodream Manager ===

class AutodreamManager {
  _memoryDir: string;
  _config: AutodreamConfig;
  _lastRun: number | null;
  _runCount: number;
  _isRunning: boolean;

  /**
   * @param options
   * @param options.memoryDir - memory storage directory
   * @param options.config - autodream config overrides
   */
  constructor(options: AutodreamManagerOptions = {}) {
    this._memoryDir = options.memoryDir || path.join(os.homedir(), ".haxagent", "memory");
    this._config = { ...DEFAULT_CONFIG, ...options.config };
    this._lastRun = null;
    this._runCount = 0;
    this._isRunning = false;
  }

  /**
   * Check if consolidation should run based on turn count and time.
   * @param turnCount
   * @param memoryCount
   */
  shouldRun(turnCount: number, memoryCount: number): boolean {
    // Time-based
    if (this._lastRun) {
      const elapsed = Date.now() - this._lastRun;
      if (elapsed < this._config.timeIntervalMs) {
        // Check turn count and memory count
        if (turnCount % this._config.turnInterval !== 0) return false;
        if (memoryCount < this._config.maxMemoriesBeforeCompact) return false;
      }
    }
    return true;
  }

  /**
   * Run the consolidation process.
   * @param options
   * @param options.memories - current memory entries
   * @param options.onProgress - progress callback
   */
  async run(options: RunOptions = {}): Promise<Record<string, unknown>> {
    if (this._isRunning) return { skipped: true, reason: "Already running" };

    this._isRunning = true;
    this._lastRun = Date.now();
    this._runCount++;

    const memories = options.memories || this._loadMemories();
    const onProgress = options.onProgress || (() => {});

    try {
      // 1. Create backup
      onProgress("Creating backup...");
      const backupPath = this._createBackup(memories);

      // 2. Detect duplicates
      onProgress("Detecting duplicates...");
      const { unique, duplicates } = this._deduplicate(memories);

      // 3. Identify stale memories
      onProgress("Checking staleness...");
      const { active, stale } = this._separateStale(unique);

      // 4. Merge with reinforcement
      onProgress("Merging...");
      const merged = this._mergeDuplicates(duplicates);

      // 5. Archive stale
      onProgress("Archiving stale...");
      this._archiveStale(stale);

      // 6. Boost confidence from merged entries
      const boosted = this._boostConfidence([...active, ...merged]);

      // 7. Save consolidated
      onProgress("Saving...");
      this._saveMemories(boosted);

      // 8. Prune old backups
      this._pruneBackups();

      this._isRunning = false;

      return {
        consolidated: boosted.length,
        removed: memories.length - boosted.length,
        merged: duplicates.length,
        archived: stale.length,
        backupPath,
      };
    } catch (err) {
      this._isRunning = false;
      throw err;
    }
  }

  /**
   * Create a backup of current memories.
   * @returns backup file path
   */
  _createBackup(memories: MemoryItem[]): string {
    const backupDir = path.join(this._memoryDir, "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const filename = `memory_backup_${Date.now()}.json`;
    const filePath = path.join(backupDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(memories, null, 2));
    return filePath;
  }

  /**
   * Prune old backups beyond retention limit.
   */
  _pruneBackups(): void {
    const backupDir = path.join(this._memoryDir, "backups");
    if (!fs.existsSync(backupDir)) return;

    try {
      const files = fs.readdirSync(backupDir)
        .filter((f) => f.startsWith("memory_backup_") && f.endsWith(".json"))
        .sort()
        .reverse();

      const toDelete = files.slice(this._config.backupRetention);
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {}
      }
    } catch (_) {}
  }

  /**
   * Find and separate duplicate memories.
   */
  _deduplicate(memories: MemoryItem[]): { unique: MemoryItem[]; duplicates: DuplicateGroup[] } {
    const seen = new Map<string, { original: MemoryItem; copies: MemoryItem[] }>();
    const unique: MemoryItem[] = [];
    const duplicates: DuplicateGroup[] = [];

    for (const m of memories) {
      const sig = this._normalizeContent(m.content);
      if (seen.has(sig)) {
        seen.get(sig)!.copies.push(m);
      } else {
        seen.set(sig, { original: m, copies: [] });
        unique.push(m);
      }
    }

    // Collect groups with duplicates
    for (const [sig, group] of seen) {
      if (group.copies.length > 0) {
        duplicates.push({
          original: group.original,
          copies: group.copies,
          signature: sig,
        });
      }
    }

    return { unique, duplicates };
  }

  /**
   * Merge duplicate groups, keeping the highest-confidence version
   * and aggregating occurrence counts.
   */
  _mergeDuplicates(duplicateGroups: DuplicateGroup[]): MemoryItem[] {
    const merged: MemoryItem[] = [];

    for (const group of duplicateGroups) {
      const allEntries = [group.original, ...group.copies];
      // Use highest confidence
      const best = allEntries.reduce((a, b) =>
        (a.confidence || 3) >= (b.confidence || 3) ? a : b
      );
      // Sum occurrence counts
      best.occurrenceCount = allEntries.reduce((sum, e) =>
        sum + (e.occurrenceCount || 1), 0
      );
      // Boost confidence slightly for repeated confirmation
      if (best.occurrenceCount >= 3 && (best.confidence || 3) < 5) {
        best.confidence = Math.min(5, (best.confidence || 3) + 1);
      }
      merged.push(best);
    }

    return merged;
  }

  /**
   * Separate stale memories (old, low confidence, unreinforced).
   */
  _separateStale(memories: MemoryItem[]): { active: MemoryItem[]; stale: MemoryItem[] } {
    const now = Date.now();
    const staleThresholdMs = this._config.staleThresholdDays * 24 * 60 * 60 * 1000;
    const minConfidence = this._config.minConfidence;

    const active: MemoryItem[] = [];
    const stale: MemoryItem[] = [];

    for (const m of memories) {
      const age = now - (m.timestamp || 0);
      const confidence = m.confidence || 3;
      const occurrenceCount = m.occurrenceCount || 1;

      // Stale if: old, low confidence, and only seen once
      if (age > staleThresholdMs && confidence < minConfidence && occurrenceCount <= 1) {
        stale.push(m);
      } else {
        active.push(m);
      }
    }

    return { active, stale };
  }

  /**
   * Archive stale memories to a separate file.
   */
  _archiveStale(stale: MemoryItem[]): void {
    if (stale.length === 0) return;
    const archivePath = path.join(this._memoryDir, "archive.json");
    let archive: unknown[] = [];
    if (fs.existsSync(archivePath)) {
      try { archive = JSON.parse(fs.readFileSync(archivePath, "utf-8")); } catch (_) {}
    }
    for (const m of stale) {
      archive.push({ ...m, archivedAt: Date.now() });
    }
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  }

  /**
   * Boost confidence for memories that are actively being reinforced.
   */
  _boostConfidence(memories: MemoryItem[]): MemoryItem[] {
    for (const m of memories) {
      const count = m.occurrenceCount || 1;
      // Gradually boost confidence with repeated reinforcement
      if (count >= 5 && (m.confidence || 3) < 5) m.confidence = 5;
      else if (count >= 3 && (m.confidence || 3) < 4) m.confidence = 4;
      else if (count >= 2 && (m.confidence || 3) < 3) m.confidence = 3;
    }
    return memories;
  }

  /**
   * Load current memories from disk.
   */
  _loadMemories(): MemoryItem[] {
    const memPath = path.join(this._memoryDir, "memories.json");
    if (!fs.existsSync(memPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(memPath, "utf-8")) as MemoryItem[];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save memories to disk.
   */
  _saveMemories(memories: MemoryItem[]): void {
    const memPath = path.join(this._memoryDir, "memories.json");
    const dir = path.dirname(memPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(memPath, JSON.stringify(memories, null, 2));
  }

  /**
   * Normalize content for signature comparison.
   */
  _normalizeContent(content?: string): string {
    return (content || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "")
      .trim()
      .slice(0, 200);
  }

  /**
   * Get consolidation statistics.
   */
  getStats(): Record<string, unknown> {
    const memories = this._loadMemories();
    const archivePath = path.join(this._memoryDir, "archive.json");
    let archivedCount = 0;
    if (fs.existsSync(archivePath)) {
      try { archivedCount = (JSON.parse(fs.readFileSync(archivePath, "utf-8")) as unknown[]).length; } catch (_) {}
    }

    const byCategory: Record<string, number> = {};
    for (const m of memories) {
      const cat = (m.category as string) || "unknown";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    return {
      total: memories.length,
      archived: archivedCount,
      byCategory,
      lastRun: this._lastRun,
      runCount: this._runCount,
    };
  }
}

// === Scheduler ===

/**
 * Simple scheduler that triggers autodream periodically.
 * Can be started/stopped and configured with intervals.
 */
class AutodreamScheduler {
  _manager: AutodreamManager;
  _interval: number;
  _timer: NodeJS.Timeout | null;
  _session: { turnCount?: number } | null;
  _callbacks: Array<(result: unknown) => void>;

  constructor(manager: AutodreamManager, options: AutodreamSchedulerOptions = {}) {
    this._manager = manager;
    this._interval = options.intervalMs || 5 * 60 * 1000; // 5 minutes
    this._timer = null;
    this._session = null;
    this._callbacks = [];
  }

  /**
   * Start the scheduler for a session.
   */
  start(session: { turnCount?: number }): void {
    if (this._timer) return;
    this._session = session;
    this._timer = setInterval(() => {
      this._tick();
    }, this._interval);
    this._timer.unref(); // Don't keep process alive
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Register a callback for consolidation results.
   */
  onConsolidate(callback: (result: unknown) => void): void {
    this._callbacks.push(callback);
  }

  async _tick(): Promise<void> {
    if (!this._manager.shouldRun(
      this._session?.turnCount || 0,
      this._manager._loadMemories().length
    )) {
      return;
    }

    try {
      const result = await this._manager.run({
        onProgress: (msg) => {
          for (const cb of this._callbacks) cb({ type: "progress", message: msg });
        },
      });

      for (const cb of this._callbacks) {
        cb({ type: "complete", result });
      }
    } catch (err) {
      for (const cb of this._callbacks) {
        cb({ type: "error", error: (err as Error).message });
      }
    }
  }
}

export { AutodreamManager, AutodreamScheduler, DEFAULT_CONFIG };
