/**
 * Durable Memory — file-based persistent memory with signature dedup,
 * TTL expiry, MEMORY.md index, and auto-extraction from conversation.
 * Ported from OpenHarness memory/schema.py + memory/manager.py.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const MEMORY_DIR = path.join(os.homedir(), ".haxagent", "memories");
const INDEX_FILE = "MEMORY.md";
const EXT = ".md";

// === Interfaces ===

interface MemoryEntryOptions {
  id?: string;
  title?: string;
  content?: string;
  category?: string;
  scope?: string;
  importance?: number;
  tags?: string[];
  signature?: string;
  ttlDays?: number;
  disabled?: boolean;
  supersedes?: string | null;
  createdAt?: number;
  updatedAt?: number;
  source?: string | null;
}

interface SaveOptions {
  title?: string;
  category?: string;
  scope?: string;
  importance?: number;
  tags?: string[];
  ttlDays?: number;
  source?: string;
}

interface ListOptions {
  category?: string;
  scope?: string;
}

interface MergeOptions {
  title?: string;
  importance?: number;
}

interface MemoryStoreOptions {
  dir?: string;
}

interface SessionMemoryStoreOptions {
  dir?: string;
}

interface SessionData {
  id: string;
  messages: Array<{ role: string; content: string | unknown }>;
  toolCallCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface FrontmatterMap {
  [key: string]: string;
}

// === Memory Entry ===

class MemoryEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  scope: string;
  importance: number;
  tags: string[];
  signature: string;
  ttlDays: number;
  disabled: boolean;
  supersedes: string | null;
  createdAt: number;
  updatedAt: number;
  source: string | null;

  constructor(opts: MemoryEntryOptions = {}) {
    this.id = opts.id || crypto.randomUUID();
    this.title = opts.title || "";
    this.content = opts.content || "";
    this.category = opts.category || "user_preference";
    this.scope = opts.scope || "project";  // private | project | team
    this.importance = opts.importance || 3; // 1-5
    this.tags = opts.tags || [];
    this.signature = opts.signature || this._computeSignature(opts.title, opts.content);
    this.ttlDays = opts.ttlDays || 0;  // 0 = never expire
    this.disabled = !!opts.disabled;
    this.supersedes = opts.supersedes || null;
    this.createdAt = opts.createdAt || Date.now();
    this.updatedAt = opts.updatedAt || Date.now();
    this.source = opts.source || null;  // "user" | "auto_extract" | "llm_extract"
  }

  get isExpired(): boolean {
    if (!this.ttlDays) return false;
    const age = (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24);
    return age > this.ttlDays;
  }

  _computeSignature(title?: string, content?: string): string {
    return crypto.createHash("sha256")
      .update((title || "") + "::" + (content || "").slice(0, 500))
      .digest("hex").slice(0, 16);
  }
}

// === Memory Store ===

class MemoryStore {
  private _dir: string;
  private _entries: Map<string, MemoryEntry>;
  private _signatures: Map<string, string>;
  private _loaded: boolean;

  constructor(opts: MemoryStoreOptions = {}) {
    this._dir = opts.dir || MEMORY_DIR;
    this._entries = new Map();      // id -> MemoryEntry
    this._signatures = new Map();   // signature -> id (dedup)
    this._loaded = false;
  }

  async init(): Promise<void> {
    if (this._loaded) return;
    if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });

    for (const f of fs.readdirSync(this._dir).filter(f => f.endsWith(EXT) && f !== INDEX_FILE)) {
      try {
        const raw = fs.readFileSync(path.join(this._dir, f), "utf-8");
        const e = this._parse(raw);
        if (e && !e.isExpired && !e.disabled) {
          // Signature dedup: if same signature exists, keep newer one
          const existing = this._signatures.get(e.signature);
          if (existing) {
            const old = this._entries.get(existing);
            if (old && e.updatedAt > old.updatedAt) {
              this._entries.delete(existing);
              this._entries.set(e.id, e);
              this._signatures.set(e.signature, e.id);
            }
          } else {
            this._entries.set(e.id, e);
            this._signatures.set(e.signature, e.id);
          }
        }
      } catch (_) {}
    }

    // Clean expired
    for (const [id, e] of this._entries) {
      if (e.isExpired) { this._entries.delete(id); this._signatures.delete(e.signature); }
    }

    this._loaded = true;
    await this._writeIndex();
  }

  async save(title: string, content: string, opts: SaveOptions = {}): Promise<MemoryEntry> {
    await this.init();
    const sig = crypto.createHash("sha256")
      .update((title || "") + "::" + (content || "").slice(0, 500))
      .digest("hex").slice(0, 16);

    // Dedup by signature
    const existingId = this._signatures.get(sig);
    let entry: MemoryEntry | undefined;
    if (existingId) {
      entry = this._entries.get(existingId);
      if (entry) {
        entry.content = content.slice(0, 2000);
        entry.updatedAt = Date.now();
        if (opts.title) entry.title = opts.title;
        if (opts.category) entry.category = opts.category;
        if (opts.importance) entry.importance = opts.importance;
        if (opts.tags) entry.tags = opts.tags;
        this._write(entry);
        await this._writeIndex();
        return entry;
      }
    }

    entry = new MemoryEntry({
      title, content: content.slice(0, 2000),
      category: opts.category || "user_preference",
      scope: opts.scope || "project",
      importance: opts.importance || 3,
      tags: opts.tags || [],
      ttlDays: opts.ttlDays || 0,
      signature: sig,
      source: opts.source || "user",
    });
    this._entries.set(entry.id, entry);
    this._signatures.set(sig, entry.id);
    this._write(entry);
    await this._writeIndex();
    return entry;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    await this.init();
    const q = String(query).toLowerCase();
    const results: Array<{ entry: MemoryEntry; score: number }> = [];
    for (const e of this._entries.values()) {
      if (e.isExpired || e.disabled) continue;
      const c = (e.title + " " + e.content).toLowerCase();
      let score = 0;
      for (const kw of q.split(/\s+/)) {
        if (c.includes(kw)) score++;
        if (e.tags.some(t => t.toLowerCase() === kw)) score += 2;
      }
      // Boost by importance
      score += (e.importance || 3) * 0.1;
      if (score > 0) results.push({ entry: e, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit).map(r => r.entry);
  }

  async list(opts: ListOptions = {}): Promise<MemoryEntry[]> {
    await this.init();
    let entries = [...this._entries.values()].filter(e => !e.isExpired && !e.disabled);
    if (opts.category) entries = entries.filter(e => e.category === opts.category);
    if (opts.scope) entries = entries.filter(e => e.scope === opts.scope);
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return entries;
  }

  async delete(id: string): Promise<void> {
    await this.init();
    const e = this._entries.get(id);
    if (e) {
      this._entries.delete(id);
      this._signatures.delete(e.signature);
      try { fs.unlinkSync(this._path(e)); } catch (_) {}
      await this._writeIndex();
    }
  }

  async merge(id: string, newContent: string, opts: MergeOptions = {}): Promise<MemoryEntry | null> {
    await this.init();
    const e = this._entries.get(id);
    if (!e) return null;
    e.content = e.content + "\n" + (newContent || "").slice(0, 1000);
    e.updatedAt = Date.now();
    if (opts.title) e.title = opts.title;
    if (opts.importance) e.importance = opts.importance;
    this._write(e);
    await this._writeIndex();
    return e;
  }

  get count(): number { return this._entries.size; }

  // === Auto-extract from conversation ===

  static extractFromText(text: string): MemoryEntryOptions[] {
    const candidates: MemoryEntryOptions[] = [];
    const ct = String(text || "");

    // "remember that X" / "记住 X"
    const rem = ct.match(/(?:remember|记住)(?:\s+that|\s+这个)?\s+(.{5,300}?)[.;!。；！\n]/is);
    if (rem) candidates.push({ title: "Remembered", content: rem[1].trim(), category: "user_preference", importance: 4 });

    // "I prefer/use/always X" / "我习惯/常用/总是"
    const pref = ct.match(/(?:i|we|我|我们)\s+(?:prefer|like|use|always|never|习惯|常用|喜欢|总是|从不)\s+(.{5,300}?)[.;!。；！\n]/is);
    if (pref) candidates.push({ title: "User preference", content: pref[0].trim(), category: "user_preference", importance: 3 });

    // Convention statements
    const conv = ct.match(/(?:use|using|follow|使用|采用|遵循)\s+(?:strict\s+)?(.{5,300}?)\s+(?:for|in|when|as|在|当)\s+\w/is);
    if (conv) candidates.push({ title: "Convention", content: conv[0].trim(), category: "convention", importance: 4 });

    // Error/fix patterns
    const fix = ct.match(/(?:fix|solved|fixed|修复|解决|debug)\s*(?:by|using|通过|使用)?\s*(.{10,300}?)[.;!。；！\n]/is);
    if (fix) candidates.push({ title: "Error solution", content: fix[0].trim(), category: "error_solution", importance: 4 });

    // Project facts: file paths, versions, configs
    const ver = ct.match(/(?:version|版本)[:\s]+(\S+)/i);
    if (ver) candidates.push({ title: "Version", content: `Version: ${ver[1]}`, category: "project_fact", importance: 2 });

    return candidates;
  }

  /** LLM-driven memory extraction prompt */
  static buildExtractionPrompt(recentMessages: Array<{ role: string; content: unknown }>, existingTitles: string[] = []): string {
    const titles = existingTitles.slice(0, 10).join(", ");
    return [
      "Extract durable memories from the conversation below. Return a JSON array of memory objects.",
      "Each memory should have: title (string), content (string), category (one of: user_preference, project_fact, technique, convention, error_solution), importance (1-5), tags (string array).",
      `Existing memories (avoid duplicates): ${titles || "none"}`, "",
      "Conversation:",
      ...recentMessages.map(m => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500)}`),
      "", "Return ONLY the JSON array, no other text. Limit to 3 most important memories.",
    ].join("\n");
  }

  // --- Private ---

  private _path(entry: MemoryEntry): string { return path.join(this._dir, `${entry.id}${EXT}`); }
  private _indexPath(): string { return path.join(this._dir, INDEX_FILE); }

  private _write(entry: MemoryEntry): void {
    const lines = [
      "---",
      `title: ${entry.title}`,
      `category: ${entry.category}`,
      `scope: ${entry.scope}`,
      `importance: ${entry.importance}`,
      `signature: ${entry.signature}`,
      `created: ${new Date(entry.createdAt).toISOString()}`,
      `updated: ${new Date(entry.updatedAt).toISOString()}`,
      entry.ttlDays ? `ttl_days: ${entry.ttlDays}` : "",
      entry.disabled ? "disabled: true" : "",
      entry.supersedes ? `supersedes: ${entry.supersedes}` : "",
      entry.tags.length ? `tags: [${entry.tags.join(", ")}]` : "",
      entry.source ? `source: ${entry.source}` : "",
      "---", "", entry.content,
    ];
    fs.writeFileSync(this._path(entry), lines.filter(Boolean).join("\n"), "utf-8");
  }

  private _parse(raw: string): MemoryEntry | null {
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) return null;
    const fm: FrontmatterMap = {};
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return new MemoryEntry({
      id: fm["id"] || crypto.randomUUID(),
      title: fm["title"] || "",
      content: m[2].trim(),
      category: fm["category"] || "user_preference",
      scope: fm["scope"] || "project",
      importance: parseInt(fm["importance"] ?? "3") || 3,
      tags: fm["tags"] ? fm["tags"].replace(/[[\]"]/g, "").split(",").map(t => t.trim()) : [],
      signature: fm["signature"] || "",
      ttlDays: parseInt(fm["ttl_days"] ?? "0") || 0,
      disabled: fm["disabled"] === "true",
      supersedes: fm["supersedes"] || null,
      source: fm["source"] || null,
      createdAt: fm["created"] ? new Date(fm["created"]).getTime() : Date.now(),
      updatedAt: fm["updated"] ? new Date(fm["updated"]).getTime() : Date.now(),
    });
  }

  private async _writeIndex(): Promise<void> {
    const entries = [...this._entries.values()]
      .filter(e => !e.isExpired && !e.disabled)
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt);

    const lines = [
      "# Memory Index",
      `Last updated: ${new Date().toISOString()}`,
      `Total entries: ${entries.length}`,
      "",
    ];
    for (const e of entries.slice(0, 50)) {
      const stars = "★".repeat(Math.min(e.importance, 5));
      lines.push(`- ${stars} [${e.category}] **${e.title}**: ${e.content.slice(0, 100).replace(/\n/g, " ")}`);
    }
    fs.writeFileSync(this._indexPath(), lines.join("\n"), "utf-8");
  }
}

// === Session Memory (file-backed session snapshots) ===

class SessionMemoryStore {
  private _dir: string;

  constructor(opts: SessionMemoryStoreOptions = {}) {
    this._dir = opts.dir || path.join(os.homedir(), ".haxagent", "sessions");
  }

  async save(session: SessionData): Promise<string> {
    if (!fs.existsSync(this._dir)) fs.mkdirSync(this._dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fp = path.join(this._dir, `${session.id}_${ts}.json`);
    const data = {
      sessionId: session.id,
      messages: session.messages.map(m => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 2000) : "[complex]",
      })),
      toolCallCount: session.toolCallCount,
      turnCount: session.turnCount,
      tokens: { input: session.inputTokens, output: session.outputTokens },
      timestamp: Date.now(),
    };
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    return fp;
  }

  async load(filePath: string): Promise<unknown> {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  }

  async list(sessionId?: string): Promise<Array<{ path: string; name: string }>> {
    if (!fs.existsSync(this._dir)) return [];
    return fs.readdirSync(this._dir)
      .filter(f => f.startsWith(sessionId || "") && f.endsWith(".json"))
      .map(f => ({ path: path.join(this._dir, f), name: f }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  async prune(maxSnapshots = 10): Promise<void> {
    if (!fs.existsSync(this._dir)) return;
    const files = fs.readdirSync(this._dir)
      .filter(f => f.endsWith(".json"))
      .sort().reverse();
    for (const f of files.slice(maxSnapshots)) {
      try { fs.unlinkSync(path.join(this._dir, f)); } catch (_) {}
    }
  }
}

export { MemoryEntry, MemoryStore, SessionMemoryStore };
