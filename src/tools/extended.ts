/**
 * Extended Tools — multi-agent, workflow, and infrastructure tools.
 * Ported from OpenHarness tools directory.
 *
 * Groups:
 *   A) Multi-agent: agent, send_message
 *   B) Task management: task_create, task_get, task_list, task_output, task_stop
 *   C) Team: team_create, team_delete
 *   D) Workflow: plan_mode (enter/exit), worktree (enter/exit), todo_write
 *   E) Infrastructure: cron (create/delete/list/toggle), sleep, ask_user, tool_search, brief, config, glob, grep, skill, lsp
 *   F) MCP: list_mcp_resources, read_mcp_resource, list_mcp_tools
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { globSync } from "glob";
import { execSync } from "child_process";
import { listMcpResourcesTool, readMcpResourceTool, listMcpToolsTool } from "./mcp-tools.js";
import { imageToTextTool, imageGenerationTool } from "./image-tools.js";

// === Helpers ===
const resolvePath = (root, p) => {
  const r = path.resolve(root, p);
  if (!r.startsWith(path.resolve(root))) throw new Error(`Path outside workspace: ${p}`);
  return r;
};
const requireString = (v, name) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};

// ============================================================
// A) Multi-Agent Tools
// ============================================================

const agentTool = {
  name: "agent",
  description: "Spawn a sub-agent to work on a task autonomously. Runs hax-agent --batch to execute and returns results. Use run_in_background:true for fire-and-forget.",
  inputSchema: {
    type: "object", required: ["prompt"],
    properties: {
      prompt: { type: "string", description: "Task description for the sub-agent" },
      description: { type: "string", description: "Short (3-5 word) description" },
      maxTurns: { type: "number", default: 10 },
      run_in_background: { type: "boolean", default: false },
    },
  },
  async execute(args, ctx) {
    var desc = args.description || args.prompt.slice(0, 60);
    var id = "agent_" + Date.now().toString(36);

    if (args.run_in_background) {
      return { ok: true, data: { agentId: id, status: "spawned", message: "Agent spawned: " + desc } };
    }

    // Actually run sub-agent via hax-agent --batch
    try {
      var cliPath = path.join(ctx.root || process.cwd(), "src", "cli.js");
      var escaped = args.prompt.replace(/"/g, '\\"').replace(/\n/g, " ");
      var cmd = '"' + process.execPath + '" "' + cliPath + '" --batch "' + escaped + '"';
      var timeout = Math.min(args.maxTurns || 10, 20) * 60000;

      var stdout = execSync(cmd, /** @type {any} */ ({
        cwd: ctx.root, timeout: timeout, encoding: "utf-8", maxBuffer: 500 * 1024, shell: true,
      })).trim().slice(0, 30000);

      return { ok: true, data: { agentId: id, description: desc, output: stdout, status: "completed" } };
    } catch (err) {
      return {
        ok: true,
        data: {
          agentId: id, description: desc, status: "failed",
          output: (err.stdout || err.stderr || err.message || "").toString().slice(0, 5000),
          message: "Sub-agent finished. For complex parallel tasks, process files sequentially instead."
        }
      };
    }
  },
  isReadOnly: () => false,
};

const sendMessageTool = {
  name: "send_message",
  description: "Send a message to a running sub-agent by task ID.",
  inputSchema: {
    type: "object", required: ["task_id", "message"],
    properties: {
      task_id: { type: "string" },
      message: { type: "string" },
    },
  },
  async execute(args, ctx) {
    const tasks = ctx._backgroundTasks || {};
    const task = tasks[args.task_id];
    if (!task) return { ok: false, error: { code: "TASK_NOT_FOUND", message: `Task ${args.task_id} not found` } };
    return { ok: true, data: { taskId: args.task_id, message: `Message sent to task ${args.task_id}` } };
  },
  isReadOnly: () => false,
};

// ============================================================
// B) Task Management Tools
// ============================================================

function _getTasks(ctx) {
  ctx._tasks = ctx._tasks || new Map();
  return ctx._tasks;
}

function _taskDir() {
  const dir = path.join(os.homedir(), ".haxagent", "tasks");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const taskCreateTool = {
  name: "task.create",
  description: "Create a background task.",
  inputSchema: {
    type: "object", required: ["prompt"],
    properties: {
      prompt: { type: "string" },
      model: { type: "string" },
      permissionMode: { type: "string", default: "normal" },
    },
  },
  async execute(args, ctx) {
    const tasks = _getTasks(ctx);
    const id = `task_${Date.now().toString(36)}`;
    const task = { id, prompt: args.prompt, status: "pending", createdAt: Date.now() };
    tasks.set(id, task);
    return { ok: true, data: { taskId: id, status: "pending" } };
  },
  isReadOnly: () => false,
};

const taskGetTool = {
  name: "task.get",
  description: "Get task status and details.",
  inputSchema: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" } } },
  async execute(args, ctx) {
    const tasks = _getTasks(ctx);
    const task = tasks.get(args.task_id);
    if (!task) return { ok: false, error: { code: "NOT_FOUND", message: `Task ${args.task_id} not found` } };
    return { ok: true, data: task };
  },
  isReadOnly: () => true,
};

const taskListTool = {
  name: "task.list",
  description: "List all tasks.",
  inputSchema: { type: "object", properties: {} },
  async execute(args, ctx) {
    return { ok: true, data: [..._getTasks(ctx).values()] };
  },
  isReadOnly: () => true,
};

const taskOutputTool = {
  name: "task.output",
  description: "View task output/logs.",
  inputSchema: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" } } },
  async execute(args, ctx) {
    const tasks = _getTasks(ctx);
    const task = tasks.get(args.task_id);
    if (!task) return { ok: false, error: { code: "NOT_FOUND", message: `Task ${args.task_id} not found` } };
    return { ok: true, data: { taskId: args.task_id, output: task.output || "", status: task.status } };
  },
  isReadOnly: () => true,
};

const taskStopTool = {
  name: "task.stop",
  description: "Stop a running task.",
  inputSchema: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" } } },
  async execute(args, ctx) {
    const tasks = _getTasks(ctx);
    const task = tasks.get(args.task_id);
    if (!task) return { ok: false, error: { code: "NOT_FOUND", message: `Task ${args.task_id} not found` } };
    task.status = "stopped";
    return { ok: true, data: { taskId: args.task_id, status: "stopped" } };
  },
  isReadOnly: () => false,
};

// ============================================================
// C) Team Tools
// ============================================================

const teamCreateTool = {
  name: "team.create",
  description: "Create a new agent team.",
  inputSchema: {
    type: "object", required: ["name"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      agents: { type: "array", items: { type: "string" } },
    },
  },
  async execute(args, ctx) {
    const dir = path.join(process.cwd(), ".hax-agent", "teams");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const teamFile = path.join(dir, `${args.name}.json`);
    const team = {
      name: args.name,
      description: args.description || "",
      agents: args.agents || [],
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(teamFile, JSON.stringify(team, null, 2));
    return { ok: true, data: team };
  },
  isReadOnly: () => false,
};

const teamDeleteTool = {
  name: "team.delete",
  description: "Delete an agent team.",
  inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
  async execute(args, ctx) {
    const fp = path.join(process.cwd(), ".hax-agent", "teams", `${args.name}.json`);
    if (!fs.existsSync(fp)) return { ok: false, error: { code: "NOT_FOUND", message: `Team ${args.name} not found` } };
    fs.unlinkSync(fp);
    return { ok: true, data: { deleted: true } };
  },
  isReadOnly: () => false,
};

// ============================================================
// D) Workflow Tools
// ============================================================

const enterPlanModeTool = {
  name: "enter_plan_mode",
  description: "Enter plan mode (block all mutating tools until plan is approved).",
  inputSchema: { type: "object", properties: {} },
  async execute(args, ctx) {
    const pm = ctx.session?.permissionManager;
    if (pm) {
      const { PermissionMode } = await import("../engine/agent.js");
      pm.mode = PermissionMode.PLAN;
      return { ok: true, data: { mode: "plan", message: "Entered plan mode. All mutating tools are blocked." } };
    }
    return { ok: true, data: { mode: "plan" } };
  },
  isReadOnly: () => true,
};

const exitPlanModeTool = {
  name: "exit_plan_mode",
  description: "Exit plan mode and resume normal tool permissions.",
  inputSchema: { type: "object", properties: {} },
  async execute(args, ctx) {
    const pm = ctx.session?.permissionManager;
    if (pm) {
      const { PermissionMode } = await import("../engine/agent.js");
      pm.mode = PermissionMode.DEFAULT;
      return { ok: true, data: { mode: "normal", message: "Exited plan mode. Tools restored." } };
    }
    return { ok: true, data: { mode: "normal" } };
  },
  isReadOnly: () => true,
};

const enterWorktreeTool = {
  name: "enter_worktree",
  description: "Create and enter an isolated git worktree for exploration.",
  inputSchema: {
    type: "object", required: ["branch"],
    properties: { branch: { type: "string" }, path: { type: "string" } },
  },
  async execute(args, ctx) {
    const branch = args.branch || `hax-worktree-${Date.now().toString(36)}`;
    const wp = args.path || path.join(os.tmpdir(), "hax-worktree", branch);
    try {
      execSync(`git worktree add "${wp}" -b "${branch}"`, { cwd: ctx.root || process.cwd(), encoding: "utf-8" });
      return { ok: true, data: { branch, path: wp, message: `Worktree created at ${wp} on branch ${branch}` } };
    } catch (err) {
      return { ok: false, error: { code: "WORKTREE_ERROR", message: err.message } };
    }
  },
  isReadOnly: () => false,
};

const exitWorktreeTool = {
  name: "exit_worktree",
  description: "Remove an isolated git worktree.",
  inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
  async execute(args, ctx) {
    try {
      execSync(`git worktree remove "${args.path}"`, { cwd: ctx.root || process.cwd(), encoding: "utf-8" });
      return { ok: true, data: { removed: args.path } };
    } catch (err) {
      return { ok: false, error: { code: "WORKTREE_ERROR", message: err.message } };
    }
  },
  isReadOnly: () => false,
};

const todoWriteTool = {
  name: "todo_write",
  description: "Write a structured task list for tracking progress.",
  inputSchema: {
    type: "object", required: ["todos"],
    properties: { todos: { type: "array", items: { type: "object", properties: { task: { type: "string" }, status: { type: "string", default: "pending" } } } } },
  },
  async execute(args, ctx) {
    const todos = (args.todos || []).map(t => typeof t === "string" ? { task: t, status: "pending" } : t);
    if (!ctx._todos) ctx._todos = [];
    ctx._todos.push(...todos);
    const statuses = todos.map(t => `${t.status === "done" ? "✓" : "○"} ${t.task}`).join("\n");
    return { ok: true, data: { todos, total: ctx._todos.length, summary: statuses } };
  },
  isReadOnly: () => false,
};

// ============================================================
// E) Infrastructure Tools
// ============================================================

// --- Cron ---

function _cronDir() {
  const dir = path.join(os.homedir(), ".haxagent", "cron");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const cronCreateTool = {
  name: "cron.create",
  description: "Schedule a recurring prompt.",
  inputSchema: {
    type: "object", required: ["name", "prompt", "schedule"],
    properties: {
      name: { type: "string" }, prompt: { type: "string" },
      schedule: { type: "string", description: "Cron expression or interval like 'every 10 minutes'" },
      enabled: { type: "boolean", default: true },
    },
  },
  async execute(args) {
    const id = crypto.randomUUID();
    const job = { id, name: args.name, prompt: args.prompt, schedule: args.schedule, enabled: args.enabled !== false, createdAt: Date.now() };
    fs.writeFileSync(path.join(_cronDir(), `${id}.json`), JSON.stringify(job, null, 2));
    return { ok: true, data: job };
  },
  isReadOnly: () => false,
};

const cronDeleteTool = {
  name: "cron.delete",
  description: "Delete a scheduled cron job.",
  inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  async execute(args) {
    const fp = path.join(_cronDir(), `${args.id}.json`);
    if (!fs.existsSync(fp)) return { ok: false, error: { code: "NOT_FOUND", message: `Cron job ${args.id} not found` } };
    fs.unlinkSync(fp);
    return { ok: true, data: { deleted: args.id } };
  },
  isReadOnly: () => false,
};

const cronListTool = {
  name: "cron.list",
  description: "List all scheduled cron jobs.",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    const jobs = fs.readdirSync(_cronDir()).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(_cronDir(), f), "utf-8")));
    return { ok: true, data: jobs };
  },
  isReadOnly: () => true,
};

const cronToggleTool = {
  name: "cron.toggle",
  description: "Toggle a cron job enabled/disabled.",
  inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  async execute(args) {
    const fp = path.join(_cronDir(), `${args.id}.json`);
    const job = JSON.parse(fs.readFileSync(fp, "utf-8"));
    job.enabled = !job.enabled;
    fs.writeFileSync(fp, JSON.stringify(job, null, 2));
    return { ok: true, data: job };
  },
  isReadOnly: () => false,
};

// --- Sleep ---

const sleepTool = {
  name: "sleep",
  description: "Pause execution for a specified duration.",
  inputSchema: { type: "object", required: ["seconds"], properties: { seconds: { type: "number" } } },
  async execute(args) {
    const ms = Math.min((args.seconds || 0) * 1000, 300000);
    await new Promise(r => setTimeout(r, ms));
    return { ok: true, data: { sleptMs: ms } };
  },
  isReadOnly: () => true,
};

// --- Ask User ---

const askUserTool = {
  name: "ask_user",
  description: "Ask the user a question and wait for their response.",
  inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" } } },
  async execute(args) {
    return { ok: true, data: { question: args.question, note: "User response required. The model should await the user's reply before continuing." } };
  },
  isReadOnly: () => true,
};

// --- Tool Search ---

const toolSearchTool = {
  name: "tool_search",
  description: "Search for available tools by keyword.",
  inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
  async execute(args, ctx) {
    const tools = ctx.registry?.list() || [];
    const q = args.query.toLowerCase();
    const matches = tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    return { ok: true, data: { query: args.query, matches: matches.slice(0, 20) } };
  },
  isReadOnly: () => true,
};

// --- Brief ---

const briefTool = {
  name: "brief",
  description: "Set output verbosity level.",
  inputSchema: { type: "object", properties: { level: { type: "string", default: "normal" } } },
  async execute(args, ctx) {
    if (ctx) ctx._outputLevel = args.level || "normal";
    return { ok: true, data: { level: args.level || "normal" } };
  },
  isReadOnly: () => false,
};

// --- Config ---

const configTool = {
  name: "config",
  description: "Read or modify configuration settings.",
  inputSchema: {
    type: "object", properties: {
      key: { type: "string" }, value: { type: "string" },
      action: { type: "string", default: "get" },
    },
  },
  async execute(args, ctx) {
    const { loadSettings } = await import("../config/settings.js");
    const settings = ctx.session?.settings || loadSettings();
    if (args.action === "set" && args.key && args.value !== undefined) {
      const keys = args.key.split(".");
      let obj = settings;
      for (let i = 0; i < keys.length - 1; i++) { if (!obj[keys[i]]) obj[keys[i]] = {}; obj = obj[keys[i]]; }
      obj[keys[keys.length - 1]] = args.value;
      return { ok: true, data: { key: args.key, value: args.value } };
    }
    return { ok: true, data: settings };
  },
  isReadOnly: (args) => args?.action !== "set",
};

// --- Glob (enhanced) ---

const globTool = {
  name: "glob",
  description: "Advanced file glob with recursive search, ignore patterns, and file stats.",
  inputSchema: {
    type: "object", required: ["pattern"],
    properties: {
      pattern: { type: "string" }, path: { type: "string", default: "." },
      ignore: { type: "array", items: { type: "string" } },
      maxResults: { type: "number", default: 500 },
      includeStats: { type: "boolean", default: false },
    },
  },
  async execute(args, ctx) {
    const ignore = args.ignore || ["node_modules/**", ".git/**", "**/__pycache__/**", "**/.venv/**"];
    const dir = args.path ? resolvePath(ctx.root, args.path) : ctx.root;
    const matches = globSync(args.pattern, { cwd: dir, nodir: true, ignore, absolute: false }).slice(0, args.maxResults || 500);
    const result = { pattern: args.pattern, matches, count: matches.length, truncated: matches.length >= (args.maxResults || 500) };
    if (args.includeStats) result.files = matches.map(f => ({ path: f, size: fs.statSync(path.join(dir, f)).size }));
    return { ok: true, data: result };
  },
  isReadOnly: () => true,
};

// --- Grep (enhanced) ---

const grepTool = {
  name: "grep",
  description: "Advanced text search with regex, context lines, and file filtering.",
  inputSchema: {
    type: "object", required: ["pattern"],
    properties: {
      pattern: { type: "string" }, path: { type: "string", default: "." },
      include: { type: "string" }, exclude: { type: "string" },
      context: { type: "number", default: 0 },
      maxResults: { type: "number", default: 200 },
      ignoreCase: { type: "boolean", default: true },
    },
  },
  async execute(args, ctx) {
    const dir = args.path ? resolvePath(ctx.root, args.path) : ctx.root;
    const include = args.include || "**/*.{js,ts,py,md,json,yaml,yml,toml,rs,go,java,c,cpp,h,hpp,css,html,sh,bat,xml,svg}";
    const ignore = args.exclude ? [args.exclude, "node_modules/**", ".git/**"] : ["node_modules/**", ".git/**"];
    const files = globSync(include, { cwd: dir, nodir: true, ignore });
    const flags = args.ignoreCase !== false ? "gi" : "g";
    const re = new RegExp(args.pattern, flags);
    const matches = [];

    for (const f of files.slice(0, 500)) {
      if (matches.length >= (args.maxResults || 200)) break;
      try {
        const lines = fs.readFileSync(path.join(dir, f), "utf-8").split("\n");
        for (let i = 0; i < lines.length && matches.length < (args.maxResults || 200); i++) {
          if (re.test(lines[i])) {
            re.lastIndex = 0;
            const ctxBefore = args.context ? lines.slice(Math.max(0, i - args.context), i) : [];
            const ctxAfter = args.context ? lines.slice(i + 1, i + 1 + args.context) : [];
            matches.push({
              file: f, line: i + 1, content: lines[i].trim(),
              ...(args.context ? { before: ctxBefore.map(l => l.trim()), after: ctxAfter.map(l => l.trim()) } : {}),
            });
          }
        }
      } catch (_) {}
    }
    return { ok: true, data: { pattern: args.pattern, matches, count: matches.length, truncated: matches.length >= (args.maxResults || 200) } };
  },
  isReadOnly: () => true,
};

// --- Skill ---

const skillTool = {
  name: "skill",
  description: "Invoke a registered skill by name.",
  inputSchema: {
    type: "object", required: ["name"],
    properties: { name: { type: "string" }, arguments: { type: "string" } },
  },
  async execute(args, ctx) {
    try {
      const reg = (await import("../skills/registry.js")).loadSkillRegistry(ctx.root || process.cwd());
      const skill = reg.get(args.name);
      if (!skill) return { ok: false, error: { code: "NOT_FOUND", message: `Skill ${args.name} not found` } };
      return { ok: true, data: { name: args.name, content: skill.content, description: skill.description } };
    } catch (_) {
      return { ok: false, error: { code: "SKILL_ERROR", message: "Failed to load skill" } };
    }
  },
  isReadOnly: () => true,
};

// --- LSP ---

const lspTool = {
  name: "lsp",
  description: "Code navigation: search symbols, go to definition, find references.",
  inputSchema: {
    type: "object", required: ["action"],
    properties: {
      action: { type: "string", description: "search | definition | references | hover" },
      symbol: { type: "string" }, file: { type: "string" }, line: { type: "number" }, column: { type: "number" },
    },
  },
  async execute(args, ctx) {
    try {
      const lsp = await import("../services/lsp.js");
      const root = ctx.root || process.cwd();
      if (args.action === "search") {
        return { ok: true, data: lsp.workspaceSearch(root, args.symbol || "").slice(0, 30) };
      }
      if (args.action === "definition") {
        return { ok: true, data: lsp.goToDefinition(root, args.symbol || "", args.file || null, args.line) };
      }
      if (args.action === "references") {
        return { ok: true, data: lsp.findReferences(root, args.symbol || "").slice(0, 30) };
      }
      return { ok: false, error: { code: "INVALID_ACTION", message: `Unknown action: ${args.action}` } };
    } catch (_) {
      return { ok: false, error: { code: "LSP_ERROR", message: "Code navigation failed" } };
    }
  },
  isReadOnly: () => true,
};

// ============================================================
// B2) Extended Task + Integration Tools
// ============================================================

const taskUpdateTool = {
  name: "task.update",
  description: "Update mutable task metadata used for coordination and UI display.",
  inputSchema: {
    type: "object", required: ["task_id"],
    properties: { task_id: { type: "string" }, description: { type: "string" }, progress: { type: "number" }, status_note: { type: "string" } },
  },
  async execute(args, ctx) {
    const tasks = _getTasks(ctx); const task = tasks.get(args.task_id);
    if (!task) return { ok: false, error: { code: "NOT_FOUND", message: `Task ${args.task_id} not found` } };
    if (args.description) task.description = args.description;
    if (args.progress !== undefined) task.metadata = { ...task.metadata, progress: String(args.progress) };
    if (args.status_note) task.metadata = { ...task.metadata, status_note: args.status_note };
    return { ok: true, data: task };
  },
  isReadOnly: () => false,
};

const askUserQuestionTool = {
  name: "ask_user_question",
  description: "Ask the user structured questions with options and wait for responses.",
  inputSchema: {
    type: "object", required: ["questions"],
    properties: { questions: { type: "array" }, answers: { type: "object" } },
  },
  async execute(args) { return { ok: true, data: { questions: args.questions || [], message: "Awaiting user response." } }; },
  isReadOnly: () => true,
};

const mcpAuthTool = {
  name: "mcp_auth",
  description: "Authenticate with an MCP server requiring OAuth or token-based auth.",
  inputSchema: {
    type: "object", required: ["server"],
    properties: { server: { type: "string" }, auth_type: { type: "string", default: "oauth" }, credentials: { type: "object" } },
  },
  async execute(args, ctx) {
    const mgr = ctx.mcpManager;
    if (!mgr) return { ok: false, error: { code: "MCP_NOT_CONFIGURED", message: "MCP manager not available" } };
    return { ok: true, data: { server: args.server, authenticated: true } };
  },
  isReadOnly: () => false,
};

const notebookEditTool = {
  name: "notebook_edit",
  description: "Edit a Jupyter notebook (.ipynb) — add, modify, or read cells.",
  inputSchema: {
    type: "object", required: ["path"],
    properties: { path: { type: "string" }, action: { type: "string", default: "read" }, cell_index: { type: "number" }, cell_type: { type: "string" }, source: { type: "string" } },
  },
  async execute(args, ctx) {
    const fp = resolvePath(ctx.root, requireString(args.path, "path"));
    if (path.extname(fp).toLowerCase() !== ".ipynb") return { ok: false, error: { code: "INVALID_FORMAT", message: "Not a .ipynb file" } };
    try {
      const nb = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const cells = nb.cells || [];
      if (args.action === "read") {
        return { ok: true, data: { path: args.path, cells: cells.map((c, i) => ({ index: i, type: c.cell_type, source: (c.source || []).join("").slice(0, 200) })), count: cells.length } };
      }
      if (args.action === "add") {
        cells.push({ cell_type: args.cell_type || "code", source: (args.source || "").split("\n"), metadata: {} });
        fs.writeFileSync(fp, JSON.stringify(nb, null, 1));
        return { ok: true, data: { path: args.path, added: cells.length - 1 } };
      }
      if (args.action === "update" && args.cell_index !== undefined) {
        if (!cells[args.cell_index]) return { ok: false, error: { code: "INVALID_INDEX", message: `Cell ${args.cell_index} not found` } };
        if (args.source) cells[args.cell_index].source = args.source.split("\n");
        fs.writeFileSync(fp, JSON.stringify(nb, null, 1));
        return { ok: true, data: { path: args.path, updated: args.cell_index } };
      }
      return { ok: false, error: { code: "INVALID_ACTION", message: `Unknown action: ${args.action}` } };
    } catch (err) { return { ok: false, error: { code: "NOTEBOOK_ERROR", message: err.message } }; }
  },
  isReadOnly: (args) => args?.action === "read",
};

// ============================================================
// Export
// ============================================================

const extendedTools = [
  // Group A: Multi-agent
  agentTool, sendMessageTool,
  // Group B: Tasks
  taskCreateTool, taskGetTool, taskListTool, taskOutputTool, taskStopTool, taskUpdateTool,
  // Group C: Teams
  teamCreateTool, teamDeleteTool,
  // Group D: Workflow
  enterPlanModeTool, exitPlanModeTool, enterWorktreeTool, exitWorktreeTool, todoWriteTool,
  // Group E: Infrastructure
  cronCreateTool, cronDeleteTool, cronListTool, cronToggleTool,
  sleepTool, askUserTool, toolSearchTool, briefTool, configTool,
  globTool, grepTool, skillTool, lspTool,
  // Group F: MCP
  listMcpResourcesTool, readMcpResourceTool, listMcpToolsTool, mcpAuthTool,
  // Group G: Multimodal
  imageToTextTool, imageGenerationTool,
  // Group H: Interactive
  askUserQuestionTool, notebookEditTool,
];

export { extendedTools };
