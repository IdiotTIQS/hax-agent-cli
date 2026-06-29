import fs from "fs";
import path from "path";
import os from "os";
import { globSync } from "glob";
import { execSync } from "child_process";
import { extendedTools } from "./extended.js";
import { validateWorkspacePath, isSensitivePath } from "../sandbox/path-validator.js";

interface ToolContext {
  root: string;
  registry?: ToolRegistry;
  session?: Record<string, unknown>;
  [key: string]: unknown;
}
interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; [key: string]: unknown };
  durationMs?: number;
}
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  isReadOnly(args?: Record<string, unknown>): boolean;
}
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  status?: number;
}

class ToolRegistry {
  root: string;
  _tools: Map<string, ToolDefinition>;

  constructor(o: { root?: string } = {}) { this.root = path.resolve(o.root || process.cwd()); this._tools = new Map(); }
  register(t: ToolDefinition) { if (!t?.name) throw new Error("Tool needs name"); this._tools.set(t.name.toLowerCase(), t); return this; }
  execute(name: string, args: Record<string, unknown> = {}, ctx: Partial<ToolContext> = {}) { const t = this._tools.get(String(name).toLowerCase()); if (!t) throw new Error(`Tool "${name}" not found`); return t.execute(args, { ...ctx, root: this.root, registry: this } as ToolContext); }
  list() { return [...this._tools.values()].map(t => ({ name: t.name, description: t.description })); }
  toApiSchema() { return [...this._tools.values()].map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })); }
  get(n: string) { return this._tools.get(String(n).toLowerCase()) || null; }
  names() { return [...this._tools.keys()]; }
}

// === Helpers ===
function resolvePath(root: string, p: string): string {
  var r = path.resolve(root, p);
  var home = path.join((process.env.HOME || process.env.USERPROFILE || ""), ".haxagent");
  // Allow project root, home .haxagent (tool_artifacts, memory, etc.), and temp dirs
  if (r.startsWith(path.resolve(root)) || (home && r.startsWith(home)) || r.startsWith(os.tmpdir())) return r;
  throw new Error("Path outside workspace: " + p);
}
function requireString(v: unknown, name: string): string { if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`); return v.trim(); }
function _stripHtml(s: unknown) { return String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").trim(); }
function _cleanDdgUrl(u: string) {
  // DuckDuckGo wraps URLs in a redirect; extract the actual URL
  const m = /[?&]uddg=([^&]+)/.exec(u);
  if (m) return decodeURIComponent(m[1]);
  return u;
}

// === All Tools ===
const tools: Record<string, ToolDefinition> = {
  "file.read": {
    name: "file.read", description: "Read a file from the workspace.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, maxBytes: { type: "number", default: 50000 } } },
    async execute(args, ctx) {
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
      const stat = fs.statSync(fp);
      if (!stat.isFile()) throw new Error("Not a file");
      const content = fs.readFileSync(fp, "utf-8").slice(0, (args.maxBytes as number) || 50000);
      return { ok: true, data: { path: args.path, content, bytes: Buffer.byteLength(content), lines: content.split("\n").length } };
    },
    isReadOnly: () => true,
  },

  "file.glob": {
    name: "file.glob", description: "Find files matching a glob pattern.",
    inputSchema: { type: "object", required: ["pattern"], properties: { pattern: { type: "string" }, maxResults: { type: "number", default: 100 } } },
    async execute(args, ctx) {
      const matches = globSync(args.pattern as string, { cwd: ctx.root, nodir: true, ignore: ["node_modules/**", ".git/**"], absolute: false }).slice(0, (args.maxResults as number) || 100);
      return { ok: true, data: { pattern: args.pattern, matches, truncated: matches.length >= ((args.maxResults as number) || 100) } };
    },
    isReadOnly: () => true,
  },

  "file.search": {
    name: "file.search", description: "Search file contents with regex.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, path: { type: "string", default: "." }, glob: { type: "string" }, maxResults: { type: "number", default: 50 } } },
    async execute(args, ctx) {
      const dir = args.path ? resolvePath(ctx.root, args.path as string) : ctx.root;
      const pattern = new RegExp(args.query as string, "gi");
      const matches: Array<{ path: string; line: number; content: string }> = [];
      const max = (args.maxResults as number) || 50;
      const files = globSync((args.glob as string) || "**/*.{js,ts,py,md,txt,json,yaml,yml,css,html}", { cwd: dir, nodir: true, ignore: ["node_modules/**", ".git/**"] });
      for (const f of files.slice(0, 200)) {
        if (matches.length >= max) break;
        try {
          const lines = fs.readFileSync(path.join(dir, f), "utf-8").split("\n");
          for (let i = 0; i < lines.length && matches.length < max; i++) {
            if (pattern.test(lines[i])) { pattern.lastIndex = 0; matches.push({ path: f, line: i + 1, content: lines[i].trim() }); }
          }
        } catch (_) {}
      }
      return { ok: true, data: { query: args.query, matches, truncated: matches.length >= max } };
    },
    isReadOnly: () => true,
  },

  "file.write": {
    name: "file.write", description: "Write content to a file. Overwrites by default.",
    inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" }, overwrite: { type: "boolean", default: true } } },
    async execute(args, ctx) {
      const targetPath = requireString(args.path, "path");
      if (isSensitivePath(targetPath)) throw new Error("Access denied: sensitive path");
      const fp = resolvePath(ctx.root, targetPath);
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const existed = fs.existsSync(fp);
      if (existed && args.overwrite === false) throw new Error("File exists and overwrite is false");
      fs.writeFileSync(fp, args.content as string, "utf-8");
      return { ok: true, data: { path: args.path, bytes: Buffer.byteLength(args.content as string), overwritten: existed } };
    },
    isReadOnly: () => false,
  },

  "file.edit": {
    name: "file.edit", description: "Edit a file by finding and replacing text.",
    inputSchema: { type: "object", required: ["path", "old_string", "new_string"], properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean", default: false } } },
    async execute(args, ctx) {
      const targetPath = requireString(args.path, "path");
      if (isSensitivePath(targetPath)) throw new Error("Access denied: sensitive path");
      const fp = resolvePath(ctx.root, targetPath);
      if (!fs.existsSync(fp)) throw new Error("File not found: " + args.path);
      let content = fs.readFileSync(fp, "utf-8");
      const old = args.old_string as string, nw = args.new_string as string;
      if (!content.includes(old)) throw new Error("old_string not found in file");
      const count = (content.match(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      if (count > 1 && !args.replace_all) throw new Error(`old_string appears ${count} times. Use replace_all:true or be more specific.`);
      content = args.replace_all ? content.split(old).join(nw) : content.replace(old, nw);
      fs.writeFileSync(fp, content, "utf-8");
      return { ok: true, data: { path: args.path, changed: true, occurrences: args.replace_all ? count : 1 } };
    },
    isReadOnly: () => false,
  },

  "file.delete": {
    name: "file.delete", description: "Delete a file (moves to .hax-agent/trash by default).",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, permanent: { type: "boolean", default: false } } },
    async execute(args, ctx) {
      const targetPath = requireString(args.path, "path");
      if (isSensitivePath(targetPath)) throw new Error("Access denied: sensitive path");
      const fp = resolvePath(ctx.root, targetPath);
      if (!fs.existsSync(fp)) throw new Error("File not found");
      const stat = fs.statSync(fp);
      if (args.permanent) { fs.unlinkSync(fp); }
      else {
        const trash = path.join(ctx.root, ".hax-agent", "trash");
        fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(fp, path.join(trash, `${Date.now()}-${path.basename(fp)}`));
      }
      return { ok: true, data: { path: args.path, deleted: true, permanent: !!args.permanent, bytes: stat.size } };
    },
    isReadOnly: () => false,
  },

  "file.readdir": {
    name: "file.readDirectory", description: "List files and directories in a path.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
    async execute(args, ctx) {
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
      const entries = fs.readdirSync(fp, { withFileTypes: true });
      return { ok: true, data: { path: args.path, entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })) } };
    },
    isReadOnly: () => true,
  },

  "shell.run": {
    name: "shell.run", description: "Run a shell command with optional arguments.",
    inputSchema: { type: "object", required: ["command"], properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: { type: "string" }, timeoutMs: { type: "number", default: 30000 } } },
    async execute(args, ctx) {
      var cmd = [args.command, ...((args.args as string[]) || [])].filter(Boolean).join(" ");
      var sandbox = (ctx.session as Record<string, unknown>)?.sandbox as { isRunning?: boolean; execAsync?: (cmd: string, opts: unknown) => Promise<{ exitCode: number; stdout: string; stderr: string }> } | undefined;

      // Use sandbox if available and running
      if (sandbox && sandbox.isRunning) {
        try {
          var result = await sandbox.execAsync!(cmd, { timeoutMs: (args.timeoutMs as number) || 30000 });
          if (result.exitCode === 0) return { ok: true, data: { command: cmd, stdout: result.stdout, stderr: result.stderr, exitCode: 0 } };
          else return { ok: false, error: { code: "SHELL_ERROR", message: `Exit code ${result.exitCode}`, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } };
        } catch (err) {
          return { ok: false, error: { code: "SANDBOX_ERROR", message: (err as Error).message } };
        }
      }

      // Fallback: direct execution
      // Windows: convert common Unix commands
      if (process.platform === "win32") {
        if (/^(tail|head|grep|awk|sed)\s/.test(cmd)) {
          cmd = "powershell -NoProfile -Command \"" + cmd.replace(/"/g, '\\"') + "\"";
        }
      }
      try {
        const stdout = execSync(cmd, { cwd: (args.cwd as string) || ctx.root, timeout: (args.timeoutMs as number) || 30000, maxBuffer: 1024 * 1024, encoding: "utf-8", shell: true } as unknown as Parameters<typeof execSync>[1]);
        return { ok: true, data: { command: cmd, stdout, stderr: "", exitCode: 0 } };
      } catch (err) {
        const e = err as ExecError;
        return { ok: false, error: { code: "SHELL_ERROR", message: e.message, stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.status || 1 } };
      }
    },
    isReadOnly: (args) => {
      // Read-only shell commands: echo, ls, cat, pwd, etc.
      const cmd = ((args?.command as string) || "").toLowerCase();
      const safe = ["echo", "ls", "dir", "pwd", "whoami", "date", "uname", "cat", "head", "tail", "wc", "which", "where", "env", "printenv", "type"];
      return safe.some(s => cmd === s || cmd.startsWith(s + " "));
    },
  },

  "web.fetch": {
    name: "web.fetch", description: "Fetch content from a URL.",
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, maxBytes: { type: "number", default: 50000 } } },
    async execute(args) {
      try {
        const r = await fetch(requireString(args.url, "url"));
        const text = (await r.text()).slice(0, (args.maxBytes as number) || 50000);
        return { ok: true, data: { url: args.url, status: r.status, contentType: r.headers.get("content-type") || "", content: text } };
      } catch (err) { return { ok: false, error: { code: "FETCH_ERROR", message: (err as Error).message } }; }
    },
    isReadOnly: () => true,
  },

  "web.search": {
    name: "web.search", description: "Search the web using DuckDuckGo (no API key needed).",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, maxResults: { type: "number", default: 8 } } },
    async execute(args) {
      const query = requireString(args.query, "query");
      const maxResults = (args.maxResults as number) || 8;

      try {
        // Use DuckDuckGo HTML endpoint (no API key required)
        const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html",
          },
        });
        const html = await resp.text();

        // Parse search results from DuckDuckGo HTML
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        // Match result blocks: <a class="result__a" href="...">title</a> + <a class="result__snippet">snippet</a>
        const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        const links: Array<{ url: string; title: string }> = [];
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          links.push({
            url: _cleanDdgUrl(match[1]),
            title: _stripHtml(match[2]),
          });
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
          snippets.push(_stripHtml(match[1]));
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
          results.push({
            title: links[i].title,
            url: links[i].url,
            snippet: snippets[i] || "",
          });
        }

        if (results.length === 0) {
          // Fallback: try parsing from result__body blocks
          const bodyRegex = /<div[^>]+class="result__body"[^>]*>([\s\S]*?)<\/div>/gi;
          while ((match = bodyRegex.exec(html)) !== null && results.length < maxResults) {
            const block = match[1];
            const aMatch = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
            const sMatch = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
            if (aMatch) {
              results.push({
                title: _stripHtml(aMatch[2]),
                url: _cleanDdgUrl(aMatch[1]),
                snippet: sMatch ? _stripHtml(sMatch[1]) : "",
              });
            }
          }
        }

        return { ok: true, data: { query, results, count: results.length } };
      } catch (err) {
        return { ok: false, error: { code: "SEARCH_ERROR", message: (err as Error).message } };
      }
    },
    isReadOnly: () => true,
  },
};

function createDefaultRegistry(root: string) {
  const r = new ToolRegistry({ root });
  for (const t of Object.values(tools)) r.register(t);
  for (const t of extendedTools) r.register(t as ToolDefinition);
  return r;
}
export { ToolRegistry, createDefaultRegistry, tools };
