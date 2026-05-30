"use strict";

const fs = require("fs");
const path = require("path");
const { extendedTools } = require("./extended");

class ToolRegistry {
  constructor(o = {}) { this.root = path.resolve(o.root || process.cwd()); this._tools = new Map(); }
  register(t) { if (!t?.name) throw new Error("Tool needs name"); this._tools.set(t.name.toLowerCase(), t); return this; }
  execute(name, args = {}, ctx = {}) { const t = this._tools.get(String(name).toLowerCase()); if (!t) throw new Error(`Tool "${name}" not found`); return t.execute(args, { ...ctx, root: this.root, registry: this }); }
  list() { return [...this._tools.values()].map(t => ({ name: t.name, description: t.description })); }
  toApiSchema() { return [...this._tools.values()].map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })); }
  get(n) { return this._tools.get(String(n).toLowerCase()) || null; }
  names() { return [...this._tools.keys()]; }
}

// === Helpers ===
function resolvePath(root, p) {
  var r = path.resolve(root, p);
  var home = path.join((process.env.HOME || process.env.USERPROFILE || ""), ".haxagent");
  // Allow project root, home .haxagent (tool_artifacts, memory, etc.), and temp dirs
  if (r.startsWith(path.resolve(root)) || (home && r.startsWith(home)) || r.startsWith(require("os").tmpdir())) return r;
  throw new Error("Path outside workspace: " + p);
}
function requireString(v, name) { if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`); return v.trim(); }

// === All Tools ===
const tools = {
  "file.read": {
    name: "file.read", description: "Read a file from the workspace.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, maxBytes: { type: "number", default: 50000 } } },
    async execute(args, ctx) {
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
      const stat = fs.statSync(fp);
      if (!stat.isFile()) throw new Error("Not a file");
      const content = fs.readFileSync(fp, "utf-8").slice(0, args.maxBytes || 50000);
      return { ok: true, data: { path: args.path, content, bytes: Buffer.byteLength(content), lines: content.split("\n").length } };
    },
    isReadOnly: () => true,
  },

  "file.glob": {
    name: "file.glob", description: "Find files matching a glob pattern.",
    inputSchema: { type: "object", required: ["pattern"], properties: { pattern: { type: "string" }, maxResults: { type: "number", default: 100 } } },
    async execute(args, ctx) {
      const { globSync } = require("glob");
      const matches = globSync(args.pattern, { cwd: ctx.root, nodir: true, ignore: ["node_modules/**", ".git/**"], absolute: false }).slice(0, args.maxResults || 100);
      return { ok: true, data: { pattern: args.pattern, matches, truncated: matches.length >= (args.maxResults || 100) } };
    },
    isReadOnly: () => true,
  },

  "file.search": {
    name: "file.search", description: "Search file contents with regex.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, path: { type: "string", default: "." }, glob: { type: "string" }, maxResults: { type: "number", default: 50 } } },
    async execute(args, ctx) {
      const dir = args.path ? resolvePath(ctx.root, args.path) : ctx.root;
      const pattern = new RegExp(args.query, "gi");
      const matches = []; const max = args.maxResults || 50;
      const { globSync } = require("glob");
      const files = globSync(args.glob || "**/*.{js,ts,py,md,txt,json,yaml,yml,css,html}", { cwd: dir, nodir: true, ignore: ["node_modules/**", ".git/**"] });
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
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const existed = fs.existsSync(fp);
      if (existed && args.overwrite === false) throw new Error("File exists and overwrite is false");
      fs.writeFileSync(fp, args.content, "utf-8");
      return { ok: true, data: { path: args.path, bytes: Buffer.byteLength(args.content), overwritten: existed } };
    },
    isReadOnly: () => false,
  },

  "file.edit": {
    name: "file.edit", description: "Edit a file by finding and replacing text.",
    inputSchema: { type: "object", required: ["path", "old_string", "new_string"], properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean", default: false } } },
    async execute(args, ctx) {
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
      if (!fs.existsSync(fp)) throw new Error("File not found: " + args.path);
      let content = fs.readFileSync(fp, "utf-8");
      const old = args.old_string, nw = args.new_string;
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
      const fp = resolvePath(ctx.root, requireString(args.path, "path"));
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
      const { execSync } = require("child_process");
      var cmd = [args.command, ...(args.args || [])].filter(Boolean).join(" ");
      // Windows: convert common Unix commands
      if (process.platform === "win32") {
        if (/^(tail|head|grep|awk|sed)\s/.test(cmd)) {
          cmd = "powershell -NoProfile -Command \"" + cmd.replace(/"/g, '\\"') + "\"";
        }
      }
      try {
        const stdout = execSync(cmd, { cwd: args.cwd || ctx.root, timeout: args.timeoutMs || 30000, maxBuffer: 1024 * 1024, encoding: "utf-8", shell: true });
        return { ok: true, data: { command: cmd, stdout, stderr: "", exitCode: 0 } };
      } catch (err) {
        return { ok: false, error: { code: "SHELL_ERROR", message: err.message, stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.status || 1 } };
      }
    },
    isReadOnly: (args) => {
      // Read-only shell commands: echo, ls, cat, pwd, etc.
      const cmd = (args.command || "").toLowerCase();
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
        const text = (await r.text()).slice(0, args.maxBytes || 50000);
        return { ok: true, data: { url: args.url, status: r.status, contentType: r.headers.get("content-type") || "", content: text } };
      } catch (err) { return { ok: false, error: { code: "FETCH_ERROR", message: err.message } }; }
    },
    isReadOnly: () => true,
  },

  "web.search": {
    name: "web.search", description: "Search the web (requires search API key).",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
    async execute(args) {
      return { ok: true, data: { query: args.query, results: [{ title: "Web search requires API key", url: "", snippet: "Configure search API in settings." }], note: "Search API not configured. Set web.search.apiKey in settings." } };
    },
    isReadOnly: () => true,
  },
};

function createDefaultRegistry(root) {
  const r = new ToolRegistry({ root });
  for (const t of Object.values(tools)) r.register(t);
  for (const t of extendedTools) r.register(t);
  return r;
}
module.exports = { ToolRegistry, createDefaultRegistry, tools };
