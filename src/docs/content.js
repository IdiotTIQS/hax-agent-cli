"use strict";

/**
 * Documentation content for the HaxAgent documentation browser.
 * Organized by section: Commands, Tools, Plugins, Configuration, API Reference, Examples.
 *
 * Each entry: { id, title, description, usage, examples, seeAlso }
 */

const COMMANDS_DOCS = [
  {
    id: "cmd-help",
    title: "/help",
    description: "Show available commands and keyboard shortcuts. Displays a categorized list of all slash commands with their descriptions.",
    usage: "/help\n/h\n/?",
    examples: [
      "/help          — show all commands",
      "/h             — shorthand alias",
      "/?             — alternative shorthand",
    ],
    seeAlso: ["cmd-config", "cmd-doctor"],
  },
  {
    id: "cmd-exit",
    title: "/exit",
    description: "Exit the current session. Saves transcript and session state before quitting.",
    usage: "/exit\n/q\n/quit",
    examples: [
      "/exit          — exit the session",
      "/q             — quick exit alias",
    ],
    seeAlso: ["cmd-sessions", "cmd-resume"],
  },
  {
    id: "cmd-clear",
    title: "/clear",
    description: "Clear the conversation and start fresh. Resets the message transcript while preserving memory and settings.",
    usage: "/clear\n/c",
    examples: [
      "/clear         — wipe conversation history",
      "/c             — shorthand",
    ],
    seeAlso: ["cmd-compact", "cmd-context"],
  },
  {
    id: "cmd-compact",
    title: "/compact",
    description: "Compact the conversation to reduce context length. Summarizes earlier messages while preserving recent context, helping stay within token limits.",
    usage: "/compact",
    examples: [
      "/compact       — summarize conversation to free context",
    ],
    seeAlso: ["cmd-clear", "cmd-context"],
  },
  {
    id: "cmd-tools",
    title: "/tools",
    description: "List all available tools. Shows tool names, descriptions, and permission levels.",
    usage: "/tools\n/t",
    examples: [
      "/tools         — list all tools",
      "/t             — shorthand",
    ],
    seeAlso: ["cmd-permissions"],
  },
  {
    id: "cmd-skills",
    title: "/skills",
    description: "List or manage skills. Shows loaded skills and their usage statistics.",
    usage: "/skills [list|usage]",
    examples: [
      "/skills             — list all loaded skills",
      "/skills list        — list skills explicitly",
      "/skills usage       — show skill usage statistics",
    ],
    seeAlso: ["cmd-skillify"],
  },
  {
    id: "cmd-skillify",
    title: "/skillify",
    description: "Capture the current session as a reusable skill. Packages the conversation pattern into a skill that can be reused in future sessions.",
    usage: "/skillify [description]",
    examples: [
      "/skillify                    — capture session as skill",
      "/skillify Database migration — with description",
    ],
    seeAlso: ["cmd-skills"],
  },
  {
    id: "cmd-goal",
    title: "/goal",
    description: "Set a persistent goal the assistant should keep pursuing across turns. Goals persist across the session.",
    usage: "/goal [status|clear|<goal>]",
    examples: [
      "/goal              — show current goal",
      "/goal status       — show goal status",
      "/goal refactor auth — set a persistence goal",
      "/goal clear        — clear the goal",
    ],
    seeAlso: ["cmd-memory"],
  },
  {
    id: "cmd-agents",
    title: "/agents",
    description: "List available agents. Shows agent names, roles, and status from the agent registry.",
    usage: "/agents\n/a",
    examples: [
      "/agents         — list all agents",
      "/a              — shorthand",
    ],
    seeAlso: ["cmd-team"],
  },
  {
    id: "cmd-team",
    title: "/team",
    description: "Manage agent teams and teammates. Create teams, spawn agents, assign tasks, and monitor team status.",
    usage: "/team [new|spawn|task|run|status|send|inbox|agents]",
    examples: [
      "/team new       — create a new team",
      "/team agents    — list team agents",
      "/team spawn     — spawn a new teammate",
      "/team task      — assign a task to a team member",
      "/team run       — run pending team tasks",
      "/team status    — check team status",
      "/team send      — send a message to a teammate",
      "/team inbox     — view agent inbox",
    ],
    seeAlso: ["cmd-agents"],
  },
  {
    id: "cmd-models",
    title: "/models",
    description: "List available AI models with their capabilities and token limits. Shows provider and model identifiers.",
    usage: "/models\n/m",
    examples: [
      "/models         — list available models",
      "/m              — shorthand",
    ],
    seeAlso: ["cmd-model", "cmd-provider"],
  },
  {
    id: "cmd-model",
    title: "/model",
    description: "Switch the active model. Accepts a model ID or numeric index from /models list.",
    usage: "/model <model-id-or-number>",
    examples: [
      "/model claude-sonnet-4-20250514 — switch by ID",
      "/model 2                        — switch by index",
    ],
    seeAlso: ["cmd-models", "cmd-provider"],
  },
  {
    id: "cmd-provider",
    title: "/provider",
    description: "Show or switch the AI provider. Supports Anthropic, OpenAI, and Google providers.",
    usage: "/provider [anthropic|openai|google]",
    examples: [
      "/provider               — show current provider",
      "/provider anthropic     — switch to Anthropic (Claude)",
      "/provider openai        — switch to OpenAI (GPT)",
      "/provider google        — switch to Google (Gemini)",
    ],
    seeAlso: ["cmd-model", "cmd-api-key", "cmd-api-url"],
  },
  {
    id: "cmd-api-url",
    title: "/api-url",
    description: "Show or set the API base URL. Useful for proxies, custom endpoints, or enterprise deployments.",
    usage: "/api-url <base-url>",
    examples: [
      "/api-url                              — show current API URL",
      "/api-url https://api.example.com/v1   — set custom endpoint",
    ],
    seeAlso: ["cmd-api-key", "cmd-provider"],
  },
  {
    id: "cmd-api-key",
    title: "/api-key",
    description: "Show or set the API key for the current provider. Keys are stored in the local settings file.",
    usage: "/api-key <key>",
    examples: [
      "/api-key                  — show current key (masked)",
      "/api-key sk-ant-...       — set Anthropic API key",
    ],
    seeAlso: ["cmd-api-url", "cmd-provider"],
  },
  {
    id: "cmd-language",
    title: "/language",
    description: "Show or switch the CLI language. Supports English and Chinese (Simplified and Traditional).",
    usage: "/language [en|zh-CN|zh-TW|ru]",
    examples: [
      "/language            — show current language",
      "/language en         — switch to English",
      "/language zh-CN      — switch to Simplified Chinese",
      "/language zh-TW      — switch to Traditional Chinese",
    ],
    seeAlso: ["cmd-config"],
  },
  {
    id: "cmd-cost",
    title: "/cost",
    description: "Show token usage and cost for the current session. Displays input/output tokens and estimated cost.",
    usage: "/cost",
    examples: [
      "/cost           — show session cost breakdown",
    ],
    seeAlso: ["cmd-status", "cmd-config"],
  },
  {
    id: "cmd-context",
    title: "/context",
    description: "View or set context window and cache budget settings. Control how much context the model can see.",
    usage: "/context [status|window|reserve|chars-per-token|auto|on|off] [value]",
    examples: [
      "/context                    — show context settings",
      "/context status             — detailed context status",
      "/context window 100000      — set context window to 100k tokens",
      "/context reserve 8192       — set output reserve",
      "/context auto               — enable automatic management",
      "/context on                 — enable context management",
      "/context off                — disable context management",
    ],
    seeAlso: ["cmd-compact"],
  },
  {
    id: "cmd-sessions",
    title: "/sessions",
    description: "List previous sessions with timestamps, durations, and summary info.",
    usage: "/sessions\n/s",
    examples: [
      "/sessions        — list all sessions",
      "/s               — shorthand",
    ],
    seeAlso: ["cmd-resume", "cmd-status"],
  },
  {
    id: "cmd-resume",
    title: "/resume",
    description: "Resume a previous session by its ID. Restores transcript and state.",
    usage: "/resume <session-id>",
    examples: [
      "/resume 2025-05-22T10-30-00-0000-abcd1234",
    ],
    seeAlso: ["cmd-sessions"],
  },
  {
    id: "cmd-config",
    title: "/config",
    description: "Show current configuration with all merged settings. Displays defaults, user overrides, and project overrides.",
    usage: "/config",
    examples: [
      "/config          — show full configuration",
    ],
    seeAlso: ["cmd-doctor", "cmd-status"],
  },
  {
    id: "cmd-doctor",
    title: "/doctor",
    description: "Run diagnostics and check setup. Validates configuration, checks connectivity, and reports issues.",
    usage: "/doctor",
    examples: [
      "/doctor          — run full diagnostics",
    ],
    seeAlso: ["cmd-config"],
  },
  {
    id: "cmd-theme",
    title: "/theme",
    description: "Toggle between color and no-color mode. Disables ANSI styling when toggled off.",
    usage: "/theme",
    examples: [
      "/theme           — toggle color theme on/off",
    ],
    seeAlso: ["cmd-config"],
  },
  {
    id: "cmd-vim",
    title: "/vim",
    description: "Toggle vim-style keybindings mode. Enables hjkl navigation and vim command-line behaviors.",
    usage: "/vim",
    examples: [
      "/vim             — toggle vim mode on/off",
    ],
    seeAlso: ["cmd-config"],
  },
  {
    id: "cmd-memory",
    title: "/memory",
    description: "Manage agent persistent memory. Store, retrieve, and delete key-value memories that persist across sessions.",
    usage: "/memory [list|read|write|delete|search] [name]",
    examples: [
      "/memory                    — show memory status",
      "/memory list               — list all stored memories",
      "/memory read user-prefs    — read a specific memory",
      "/memory write user-prefs   — write/update a memory",
      "/memory delete old-key     — delete a memory entry",
      "/memory search project     — search memory by query",
    ],
    seeAlso: ["cmd-goal"],
  },
  {
    id: "cmd-permissions",
    title: "/permissions",
    description: "View or manage tool permission levels. Controls which tools auto-run, ask for confirmation, or are blocked.",
    usage: "/permissions [status|mode <auto|ask|yolo>|reset]",
    examples: [
      "/permissions              — show permission status",
      "/permissions status       — detailed permission levels",
      "/permissions mode auto    — auto-approve safe tools",
      "/permissions mode ask     — ask before each tool",
      "/permissions mode yolo    — auto-approve all tools",
      "/permissions reset        — reset to defaults",
    ],
    seeAlso: ["cmd-tools"],
  },
  {
    id: "cmd-update",
    title: "/update",
    description: "Check for CLI updates. Optionally install the latest version.",
    usage: "/update [install]",
    examples: [
      "/update              — check for updates",
      "/update install      — install available update",
    ],
    seeAlso: ["cmd-doctor"],
  },
  {
    id: "cmd-copy",
    title: "/copy",
    description: "Copy the last AI response to the system clipboard.",
    usage: "/copy",
    examples: [
      "/copy            — copy last response",
    ],
    seeAlso: ["cmd-export"],
  },
  {
    id: "cmd-rename",
    title: "/rename",
    description: "Name the current session. Useful for identifying sessions in the list.",
    usage: "/rename <name>",
    examples: [
      "/rename Auth refactor session — set a friendly name",
    ],
    seeAlso: ["cmd-sessions"],
  },
  {
    id: "cmd-status",
    title: "/status",
    description: "Show a session summary including model, cost, tokens used, and git status.",
    usage: "/status",
    examples: [
      "/status          — show session summary",
    ],
    seeAlso: ["cmd-config", "cmd-cost"],
  },
  {
    id: "cmd-undo",
    title: "/undo",
    description: "Undo the last file operation. Supports file write, edit, and delete operations via the undo stack.",
    usage: "/undo\n/u",
    examples: [
      "/undo            — undo last file change",
      "/u               — shorthand",
    ],
    seeAlso: ["cmd-redo"],
  },
  {
    id: "cmd-redo",
    title: "/redo",
    description: "Redo the last undone file operation. Re-applies a previously undone file change.",
    usage: "/redo",
    examples: [
      "/redo            — redo last undone change",
    ],
    seeAlso: ["cmd-undo"],
  },
  {
    id: "cmd-export",
    title: "/export",
    description: "Export the session transcript to a file. Supports Markdown, JSON, and plain text formats.",
    usage: "/export [md|json|text]",
    examples: [
      "/export               — export to default format (md)",
      "/export md            — export as Markdown",
      "/export json          — export as JSON",
      "/export text          — export as plain text",
    ],
    seeAlso: ["cmd-copy", "cmd-sessions"],
  },
];

const TOOLS_DOCS = [
  {
    id: "tool-file-read",
    title: "file.read",
    description: "Read a file from the local filesystem. Returns file contents with line numbers, byte size, and encoding information. Can read text files and images (PNG, JPG). Supports PDF files with page ranges.",
    usage: "file.read(path, [offset], [limit])",
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the file to read" },
      { name: "offset", type: "number", required: false, description: "Line number to start reading from" },
      { name: "limit", type: "number", required: false, description: "Maximum number of lines to read" },
    ],
    examples: [
      "file.read(\"/home/project/src/app.js\")",
      "file.read(\"/home/project/src/app.js\", 10, 50)",
    ],
    seeAlso: ["tool-file-write", "tool-file-edit"],
  },
  {
    id: "tool-file-write",
    title: "file.write",
    description: "Write content to a file. Creates new files or overwrites existing ones. Reports bytes written with diff stats for modifications.",
    usage: "file.write(path, content)",
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the file to write" },
      { name: "content", type: "string", required: true, description: "Content to write to the file" },
    ],
    examples: [
      "file.write(\"/home/project/src/new.js\", \"use strict;\\n...\")",
    ],
    seeAlso: ["tool-file-edit", "tool-file-read"],
  },
  {
    id: "tool-file-edit",
    title: "file.edit",
    description: "Edit a file using exact string replacement. Performs find-and-replace within a file. Reports diff preview with added/removed lines.",
    usage: "file.edit(path, old_string, new_string, [replace_all])",
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the file to edit" },
      { name: "old_string", type: "string", required: true, description: "Exact text to find and replace" },
      { name: "new_string", type: "string", required: true, description: "Replacement text" },
      { name: "replace_all", type: "boolean", required: false, description: "Replace all occurrences (default: false)" },
    ],
    examples: [
      "file.edit(\"/src/config.js\", \"port: 3000\", \"port: 8080\")",
      "file.edit(\"/src/utils.js\", \"var \", \"const \", true)",
    ],
    seeAlso: ["tool-file-write", "tool-file-read"],
  },
  {
    id: "tool-file-delete",
    title: "file.delete",
    description: "Delete a file from the filesystem. Reports the file path and bytes freed.",
    usage: "file.delete(path)",
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the file to delete" },
    ],
    examples: [
      "file.delete(\"/tmp/generated-output.txt\")",
    ],
    seeAlso: ["tool-file-write"],
  },
  {
    id: "tool-file-glob",
    title: "file.glob",
    description: "Find files matching a glob pattern. Returns sorted list of matching file paths. Supports recursive patterns with **.",
    usage: "file.glob(pattern, [path])",
    args: [
      { name: "pattern", type: "string", required: true, description: "Glob pattern (e.g., \"src/**/*.js\")" },
      { name: "path", type: "string", required: false, description: "Directory to search (default: cwd)" },
    ],
    examples: [
      "file.glob(\"src/**/*.js\")",
      "file.glob(\"test/**/*.test.js\", \"/home/project\")",
    ],
    seeAlso: ["tool-file-search", "tool-file-readdir"],
  },
  {
    id: "tool-file-search",
    title: "file.search",
    description: "Search file contents using ripgrep. Supports full regex, file type filtering, and context lines. Extremely fast for large codebases.",
    usage: "file.search(pattern, [path], [glob], [output_mode])",
    args: [
      { name: "pattern", type: "string", required: true, description: "Regex pattern to search for" },
      { name: "path", type: "string", required: false, description: "Directory to search (default: cwd)" },
      { name: "glob", type: "string", required: false, description: "File filter (e.g., \"*.js\")" },
      { name: "output_mode", type: "string", required: false, description: "Output mode: content, files_with_matches, count" },
    ],
    examples: [
      "file.search(\"function\\s+\\w+\", \"/src\", \"*.js\")",
      "file.search(\"TODO|FIXME\", \"/src\", null, \"content\")",
    ],
    seeAlso: ["tool-file-glob", "tool-file-read"],
  },
  {
    id: "tool-file-readdir",
    title: "file.readDirectory",
    description: "Read the contents of a directory. Lists files and subdirectories.",
    usage: "file.readDirectory(path)",
    args: [
      { name: "path", type: "string", required: true, description: "Absolute path to the directory" },
    ],
    examples: [
      "file.readDirectory(\"/home/project/src\")",
    ],
    seeAlso: ["tool-file-glob"],
  },
  {
    id: "tool-shell",
    title: "shell.run",
    description: "Execute a shell command. Supports timeouts, working directories, and background execution. Safe commands auto-approve; dangerous commands require confirmation.",
    usage: "shell.run(command, [args], [options])",
    args: [
      { name: "command", type: "string", required: true, description: "Shell command to execute" },
      { name: "args", type: "string[]", required: false, description: "Command arguments array" },
      { name: "options", type: "object", required: false, description: "{ cwd, timeout, env, background }" },
    ],
    examples: [
      "shell.run(\"npm\", [\"test\"])",
      "shell.run(\"git\", [\"diff\", \"--stat\"])",
      "shell.run(\"node\", [\"scripts/build.js\"], { cwd: \"/project\" })",
    ],
    seeAlso: ["tool-web-fetch"],
  },
  {
    id: "tool-web-fetch",
    title: "web.fetch",
    description: "Fetch content from a URL. Returns the response body, headers, and status code.",
    usage: "web.fetch(url, [options])",
    args: [
      { name: "url", type: "string", required: true, description: "URL to fetch (http/https)" },
      { name: "options", type: "object", required: false, description: "{ method, headers, body, timeout }" },
    ],
    examples: [
      "web.fetch(\"https://api.example.com/data\")",
      "web.fetch(\"https://example.com\", { method: \"POST\", headers: { ... } })",
    ],
    seeAlso: ["tool-web-search"],
  },
  {
    id: "tool-web-search",
    title: "web.search",
    description: "Search the web for information. Returns relevant results with titles, URLs, and snippets.",
    usage: "web.search(query)",
    args: [
      { name: "query", type: "string", required: true, description: "Search query string" },
    ],
    examples: [
      "web.search(\"Node.js best practices 2025\")",
    ],
    seeAlso: ["tool-web-fetch"],
  },
  {
    id: "tool-stock-quote",
    title: "stock.quote",
    description: "Fetch real-time or delayed stock quotes. Returns price, change, volume, and other market data.",
    usage: "stock.quote(symbol)",
    args: [
      { name: "symbol", type: "string", required: true, description: "Stock ticker symbol (e.g., AAPL, GOOGL)" },
    ],
    examples: [
      "stock.quote(\"AAPL\")",
      "stock.quote(\"GOOGL\")",
    ],
    seeAlso: ["tool-web-fetch"],
  },
];

const PLUGINS_DOCS = [
  {
    id: "plugins-overview",
    title: "Plugin System Overview",
    description: "HaxAgent has a simple, powerful plugin/hook system. Plugins are JavaScript modules that export an object with a name and hooks. They can intercept and modify behavior at key points in the agent lifecycle.",
    usage: `// plugins are loaded from:
//   1. ~/.haxagent/plugins/*.js    (user-level)
//   2. .hax-agent/plugins/*.js     (project-level)
//   3. registry.register(plugin)   (programmatic)`,
    examples: [],
    seeAlso: ["plugins-hooks", "plugins-examples"],
  },
  {
    id: "plugins-hooks",
    title: "Available Hooks",
    description: "Seven lifecycle hooks allow plugins to intercept agent behavior at specific points. Hooks are called sequentially in registration order. Hook errors are caught and reported via the onError hook.",
    usage: `const plugin = {
  name: "my-plugin",
  hooks: {
    beforeToolCall(ctx) { ... },
    afterToolCall(ctx)  { ... },
    onError(ctx)        { ... },
    beforeChat(ctx)     { ... },
    afterChat(ctx)      { ... },
    onSessionStart(ctx) { ... },
    onSessionEnd(ctx)   { ... },
  }
};`,
    examples: [],
    seeAlso: ["plugins-overview", "plugins-examples"],
  },
  {
    id: "plugins-before-tool-call",
    title: "beforeToolCall",
    description: "Called before a tool executes. Can modify arguments, skip execution, or add logging.",
    usage: "beforeToolCall(ctx: { toolName, args, session }): ctx",
    examples: [
      `// Log every tool call
beforeToolCall(ctx) {
  console.log("Calling", ctx.toolName, ctx.args);
  return ctx;
}`,
      `// Prevent shell.run from running docker
beforeToolCall(ctx) {
  if (ctx.toolName === "shell.run" && ctx.args.command === "docker") {
    throw new Error("Docker commands blocked by policy");
  }
  return ctx;
}`,
    ],
    seeAlso: ["plugins-after-tool-call", "plugins-on-error"],
  },
  {
    id: "plugins-after-tool-call",
    title: "afterToolCall",
    description: "Called after a tool completes. Can inspect results, add custom formatting, or trigger follow-up actions.",
    usage: "afterToolCall(ctx: { toolName, args, result, session }): ctx",
    examples: [
      `// Track file modifications
afterToolCall(ctx) {
  if (ctx.toolName === "file.write") {
    auditLog.record("file_modified", { path: ctx.args.path });
  }
  return ctx;
}`,
    ],
    seeAlso: ["plugins-before-tool-call", "plugins-on-error"],
  },
  {
    id: "plugins-on-error",
    title: "onError",
    description: "Called when an error occurs. Can log errors, send alerts, or implement custom recovery logic.",
    usage: "onError(ctx: { error, toolName, session }): ctx",
    examples: [
      `// Send error to monitoring
onError(ctx) {
  logger.error(ctx.toolName + " failed:", ctx.error.message);
  return ctx;
}`,
    ],
    seeAlso: ["plugins-before-tool-call", "plugins-after-tool-call"],
  },
  {
    id: "plugins-before-chat",
    title: "beforeChat",
    description: "Called before sending a chat message to the model. Can modify the message, inject context, or intercept.",
    usage: "beforeChat(ctx: { message, session }): ctx",
    examples: [
      `// Inject project context
beforeChat(ctx) {
  ctx.message = "[Context: Jest v29] " + ctx.message;
  return ctx;
}`,
    ],
    seeAlso: ["plugins-after-chat"],
  },
  {
    id: "plugins-after-chat",
    title: "afterChat",
    description: "Called after receiving a response from the model. Can modify the response or trigger post-processing.",
    usage: "afterChat(ctx: { message, response, session }): ctx",
    examples: [
      `// Log response length
afterChat(ctx) {
  stats.record("response_chars", ctx.response.length);
  return ctx;
}`,
    ],
    seeAlso: ["plugins-before-chat"],
  },
  {
    id: "plugins-session-start",
    title: "onSessionStart",
    description: "Called when a session starts. Use for initialization, loading project context, or setting up resources.",
    usage: "onSessionStart(ctx: { session }): ctx",
    examples: [
      `// Load project-specific config
onSessionStart(ctx) {
  ctx.session.metadata = loadProjectConfig();
  return ctx;
}`,
    ],
    seeAlso: ["plugins-session-end"],
  },
  {
    id: "plugins-session-end",
    title: "onSessionEnd",
    description: "Called when a session ends. Use for cleanup, saving state, or generating session reports.",
    usage: "onSessionEnd(ctx: { session }): ctx",
    examples: [
      `// Generate session report
onSessionEnd(ctx) {
  generateSessionReport(ctx.session);
  return ctx;
}`,
    ],
    seeAlso: ["plugins-session-start"],
  },
  {
    id: "plugins-examples",
    title: "Plugin Examples",
    description: "Complete plugin examples demonstrating common patterns.",
    usage: "",
    examples: [
      `// A simple audit logging plugin
module.exports = {
  name: "audit-logger",
  version: "1.0.0",
  hooks: {
    beforeToolCall(ctx) {
      fs.appendFileSync("audit.log", auditEntry(ctx));
      return ctx;
    },
    onSessionEnd(ctx) {
      fs.appendFileSync("audit.log", sessionSummary(ctx));
      return ctx;
    },
  },
};`,
      `// A tool-disable-list plugin
module.exports = {
  name: "tool-policy",
  version: "1.0.0",
  hooks: {
    beforeToolCall(ctx) {
      const blocked = ["file.delete", "shell.run"];
      if (blocked.includes(ctx.toolName)) {
        throw new Error(ctx.toolName + " disabled by policy");
      }
      return ctx;
    },
  },
};`,
    ],
    seeAlso: ["plugins-overview", "plugins-hooks"],
  },
];

const CONFIG_DOCS = [
  {
    id: "config-agent",
    title: "Agent Settings",
    description: "Core agent configuration controlling identity, model selection, API connectivity, and generation parameters.",
    settings: [
      { path: "agent.name", type: "string", default: "hax-agent", env: "HAX_AGENT_NAME", description: "Agent display name used in system prompts and logs" },
      { path: "agent.model", type: "string", default: "claude-sonnet-4-20250514", env: "HAX_AGENT_MODEL", description: "AI model identifier" },
      { path: "agent.apiKey", type: "string", default: "undefined", env: "ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY", description: "Provider API key (auto-detected by provider)" },
      { path: "agent.apiUrl", type: "string", default: "undefined", env: "HAX_AGENT_API_URL", description: "Custom API base URL for proxies/enterprise" },
      { path: "agent.maxTurns", type: "number", default: "20", env: "HAX_AGENT_MAX_TURNS", description: "Maximum conversation turns per interaction" },
      { path: "agent.temperature", type: "number", default: "0.2", env: "HAX_AGENT_TEMPERATURE", description: "Model temperature (0-2), lower = more deterministic" },
    ],
  },
  {
    id: "config-memory",
    title: "Memory Settings",
    description: "Persistent memory configuration. Memories are key-value pairs that persist across sessions.",
    settings: [
      { path: "memory.enabled", type: "boolean", default: "true", env: "HAX_AGENT_MEMORY_ENABLED", description: "Enable persistent memory system" },
      { path: "memory.directory", type: "string", default: "<appdata>/memory", env: "HAX_AGENT_MEMORY_DIR", description: "Directory to store memory files" },
      { path: "memory.maxItems", type: "number", default: "20", env: "HAX_AGENT_MEMORY_MAX_ITEMS", description: "Maximum number of memory items to retain (1-10000)" },
    ],
  },
  {
    id: "config-sessions",
    title: "Session Settings",
    description: "Session storage and transcript management.",
    settings: [
      { path: "sessions.directory", type: "string", default: "<appdata>/sessions", env: "HAX_AGENT_SESSION_DIR", description: "Directory to store session transcripts" },
      { path: "sessions.transcriptLimit", type: "number", default: "100", env: "HAX_AGENT_TRANSCRIPT_LIMIT", description: "Maximum transcript entries per session" },
    ],
  },
  {
    id: "config-prompts",
    title: "Prompt Settings",
    description: "Control what information is included in the system prompt sent to the model.",
    settings: [
      { path: "prompts.includeSettings", type: "boolean", default: "true", env: "HAX_AGENT_INCLUDE_SETTINGS", description: "Include settings in system prompt" },
      { path: "prompts.includeMemory", type: "boolean", default: "true", env: "HAX_AGENT_INCLUDE_MEMORY", description: "Include memory items in system prompt" },
      { path: "prompts.includeTranscript", type: "boolean", default: "true", env: "HAX_AGENT_INCLUDE_TRANSCRIPT", description: "Include recent transcript in context" },
      { path: "prompts.maxTranscriptMessages", type: "number", default: "undefined", env: "HAX_AGENT_MAX_TRANSCRIPT_MESSAGES", description: "Limit transcript messages sent" },
    ],
  },
  {
    id: "config-context",
    title: "Context Window Settings",
    description: "Control the context window and token management.",
    settings: [
      { path: "context.enabled", type: "boolean", default: "true", env: "HAX_AGENT_CONTEXT_ENABLED", description: "Enable context window management" },
      { path: "context.windowTokens", type: "number", default: "undefined", env: "HAX_AGENT_CONTEXT_WINDOW_TOKENS", description: "Maximum context window in tokens" },
      { path: "context.reserveOutputTokens", type: "number", default: "8192", env: "HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS", description: "Tokens reserved for model output" },
      { path: "context.charsPerToken", type: "number", default: "4", env: "HAX_AGENT_CONTEXT_CHARS_PER_TOKEN", description: "Estimated characters per token for counting" },
    ],
  },
  {
    id: "config-file-context",
    title: "File Context Settings",
    description: "Control automatic file context detection and inclusion.",
    settings: [
      { path: "fileContext.enabled", type: "boolean", default: "true", env: "HAX_AGENT_FILE_CONTEXT_ENABLED", description: "Enable automatic file context" },
      { path: "fileContext.maxFiles", type: "number", default: "8", env: "HAX_AGENT_FILE_CONTEXT_MAX_FILES", description: "Max files to include in context" },
      { path: "fileContext.maxIndexFiles", type: "number", default: "2000", env: "HAX_AGENT_FILE_CONTEXT_MAX_INDEX_FILES", description: "Max files to index" },
      { path: "fileContext.maxFileSize", type: "number", default: "512000", env: "HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE", description: "Max file size in bytes (500 KB)" },
      { path: "fileContext.maxBytesPerFile", type: "number", default: "32000", env: "HAX_AGENT_FILE_CONTEXT_MAX_BYTES_PER_FILE", description: "Max bytes to read per file" },
      { path: "fileContext.maxTotalBytes", type: "number", default: "120000", env: "HAX_AGENT_FILE_CONTEXT_MAX_TOTAL_BYTES", description: "Max total bytes across all files" },
    ],
  },
  {
    id: "config-permissions",
    title: "Permissions Settings",
    description: "Control tool execution permission levels.",
    settings: [
      { path: "permissions.mode", type: "string", default: "normal", env: "HAX_AGENT_PERMISSIONS_MODE", description: "Permission mode: normal, auto, ask, yolo" },
    ],
  },
  {
    id: "config-updates",
    title: "Update Settings",
    description: "Control update checking behavior.",
    settings: [
      { path: "updates.autoInstall", type: "boolean", default: "false", env: "HAX_AGENT_UPDATES_AUTO_INSTALL", description: "Auto-install updates when available" },
    ],
  },
  {
    id: "config-ui",
    title: "UI Settings",
    description: "User interface customization.",
    settings: [
      { path: "ui.locale", type: "string", default: "en", env: "HAX_AGENT_LOCALE / HAX_AGENT_LANGUAGE", description: "Interface language: en, zh-CN, zh-TW, ru" },
    ],
  },
  {
    id: "config-tools",
    title: "Tool Settings",
    description: "Per-tool configuration options.",
    settings: [
      { path: "tools.shell.enabled", type: "boolean", default: "true", env: "HAX_AGENT_SHELL_ENABLED", description: "Enable shell command execution" },
      { path: "tools.shell.timeoutMs", type: "number", default: "10000", env: "HAX_AGENT_SHELL_TIMEOUT_MS", description: "Shell command timeout in milliseconds" },
      { path: "tools.shell.maxBuffer", type: "number", default: "52428800", env: "HAX_AGENT_SHELL_MAX_BUFFER", description: "Max output buffer (50 MB)" },
    ],
  },
  {
    id: "config-files",
    title: "Configuration Files",
    description: "Configuration is loaded from multiple sources in priority order (highest wins):\n\n1. Environment variables (HAX_AGENT_*)\n2. Explicit settings (--settings flag)\n3. Project settings (.hax-agent/settings.json)\n4. User settings (~/.haxagent/settings.json)\n5. Built-in defaults\n\nSettings are deep-merged, so you only need to specify what you want to override.",
    settings: [],
  },
];

const API_DOCS = [
  {
    id: "api-config",
    title: "config",
    description: "Configuration loading and management. Loads settings from files and environment, merges with defaults, and provides utilities for updating settings.",
    exports: "loadSettings, resolveSettings, updateUserSettings, mergeSettings, readEnvOverrides, DEFAULT_SETTINGS, defaultUserSettingsPath, defaultProjectSettingsPath, defaultAppDataDirectory, defaultMemoryDirectory, defaultSessionDirectory",
    usage: `const { loadSettings, resolveSettings, DEFAULT_SETTINGS } = require("./src/config");
const settings = loadSettings({ projectRoot: "." });`,
    seeAlso: ["api-context", "api-memory"],
  },
  {
    id: "api-context",
    title: "context",
    description: "Prompt context builder. Assembles system prompts from settings, memories, transcript, and instructions.",
    exports: "loadPromptContext, buildPromptContext, assembleSystemPrompt",
    usage: `const { loadPromptContext } = require("./src/context");
const { systemPrompt, messages } = loadPromptContext({ settings, sessionId });`,
    seeAlso: ["api-config", "api-memory"],
  },
  {
    id: "api-memory",
    title: "memory",
    description: "Persistent memory system. Stores key-value pairs that persist across sessions, with transcript management and session tracking.",
    exports: "createStorage, createSessionId, appendTranscriptEntry, writeTranscript, readTranscript, listMemories, setMemory, getMemory, deleteMemory, findMemories",
    usage: `const { listMemories, setMemory, getMemory } = require("./src/memory");
setMemory("user-prefs", "typescript", settings);
const prefs = getMemory("user-prefs", settings);`,
    seeAlso: ["api-context", "api-config"],
  },
  {
    id: "api-providers",
    title: "providers",
    description: "AI provider abstraction layer. Supports Anthropic (Claude), OpenAI (GPT), Google (Gemini), and Mock providers. Creates providers from configuration with auto-detect.",
    exports: "createProvider, registerProvider, normalizeMessages, AnthropicProvider, ChatProvider, MockProvider",
    usage: `const { createProvider } = require("./src/providers");
const provider = createProvider({
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: process.env.ANTHROPIC_API_KEY,
});`,
    seeAlso: ["api-tools", "api-orchestration"],
  },
  {
    id: "api-tools",
    title: "tools",
    description: "Tool system with registry, execution error handling, and result serialization. Includes 11 built-in tools: file operations, shell execution, web capabilities, and stock quotes.",
    exports: "ToolRegistry, createLocalToolRegistry, ToolExecutionError, ErrorCodes, serializeToolResult, stringifyToolResult, createReadFileTool, createWriteFileTool, createGlobTool, createSearchTool, createShellTool, createWebFetchTool, createWebSearchTool, createFileEditTool, createReadDirectoryTool, createDeleteFileTool, createStockQuoteTool",
    usage: `const { createLocalToolRegistry } = require("./src/tools");
const registry = createLocalToolRegistry();`,
    seeAlso: ["api-providers", "api-permissions"],
  },
  {
    id: "api-orchestration",
    title: "orchestration",
    description: "Team orchestration system for coordinating multiple agents. Manages task boards, agent registries, message routing, and team planning.",
    exports: "createAgentTeam, createSubagent, createTask, TaskStatus, AgentStatus, TaskBoard, AgentRegistry, MessageRouter, executeTeamPlan, runTeamTasks",
    usage: `const { createAgentTeam, createTask } = require("./src/orchestration");
const team = createAgentTeam({
  name: "refactor-team",
  agents: [{ name: "code-analyzer", role: "analysis" }],
  tasks: [{ id: "task-1", title: "Audit auth module" }],
});`,
    seeAlso: ["api-providers", "api-tools"],
  },
  {
    id: "api-plugins",
    title: "plugins",
    description: "Plugin registry with a hooks system. Plugins are JavaScript modules that intercept agent lifecycle events. Seven hooks cover tool calls, chat flow, and session lifecycle.",
    exports: "PluginRegistry, PLUGIN_HOOK_NAMES",
    usage: `const { PluginRegistry } = require("./src/plugins");
const registry = new PluginRegistry();
registry.register({
  name: "my-plugin",
  hooks: {
    beforeToolCall(ctx) { return ctx; },
  },
});`,
    seeAlso: ["api-tools", "api-orchestration"],
  },
  {
    id: "api-permissions",
    title: "permissions",
    description: "Tool permission management. Controls which tools auto-execute, require confirmation, or are blocked. Classifies shell commands as safe, dangerous, or explicit.",
    exports: "PermissionManager, PermissionLevel, PERMISSION_LABELS, TOOL_PERMISSIONS, SAFE_SHELL_COMMANDS, DANGEROUS_SHELL_COMMANDS",
    usage: `const { PermissionManager, PermissionLevel } = require("./src/permissions");
const pm = new PermissionManager({ mode: "normal" });
const canAuto = pm.canAutoApprove("file.read");`,
    seeAlso: ["api-tools"],
  },
  {
    id: "api-agent-engine",
    title: "AgentEngine",
    description: "Core agent execution loop. Manages the send/receive cycle, handles tool calls, skill matching, and goal persistence. Emits events for UI rendering.",
    exports: "AgentEngine, AgentEventType",
    usage: `const { AgentEngine } = require("./src/agent-engine");
const engine = new AgentEngine({ session });
engine.sendMessage("Hello");`,
    seeAlso: ["api-providers", "api-tools"],
  },
  {
    id: "api-renderer",
    title: "renderer",
    description: "Terminal rendering system with ANSI codes, theme constants, Markdown formatting, spinner animation, and response streaming display.",
    exports: "ANSI, THEME, TerminalScreen, Spinner, MarkdownRenderer, ResponseRenderer, NullWritable, styled, stripAnsi, formatBytes, formatDuration, pluralize, toToolLabel",
    usage: `const { THEME, ANSI, MarkdownRenderer } = require("./src/renderer");
const md = new MarkdownRenderer(80);
console.log(md.render("**bold** and *italic*"));`,
    seeAlso: ["api-config"],
  },
  {
    id: "api-runtime",
    title: "runtime",
    description: "Core runtime modules providing agents, command registry, session management, task execution, and message handling.",
    exports: "from agents.js, command-registry.js, composition.js, messages.js, sessions.js, tasks.js",
    usage: `const runtime = require("./src/runtime");
const { CommandRegistry } = runtime;`,
    seeAlso: ["api-agent-engine", "api-memory"],
  },
  {
    id: "api-other",
    title: "Other Modules",
    description: "Additional utility and feature modules available in the public API.",
    exports: {
      "file-context": "Automatic file context detection (maxFiles, maxFileSize configurable)",
      "context-window": "Context window calculation and token budget management",
      "context-compaction": "Message compaction for long conversations (compactMessages, buildCompactionPrompt)",
      "undo-stack": "Undo/redo for file operations (UndoStack class)",
      "batch": "Batch mode execution from input files (runBatchMode)",
      "export": "Session export to Markdown, JSON, or text (exportSessionToMarkdown, exportSessionToJson, exportSessionToText)",
      "goal-persistence": "Persistent goal tracking across sessions (persistGoal, restoreGoal)",
      "config-presets": "Preset configuration profiles (getPreset, listPresets, applyPreset)",
      "session-summary": "Session analytics and timelines (summarizeSession, listSummaries, getSessionTimeline)",
      "tool-retry": "Retry wrapper for flaky tool calls (createRetryableTool)",
      "skills": "Skill loading, parsing, usage tracking (loadAllSkills, createSkillifySkill)",
      "i18n": "Internationalization with en, zh-CN, zh-TW, ru support",
      "updater": "Version checking and update installation (checkForUpdate, performUpdate)",
      "debug": "Structured debug logging (debug, isDebugEnabled)",
      "init-wizard": "First-run setup wizard (runInitWizard, shouldRunFirstRunInit)",
      "paste-utils": "Clipboard paste handling and batch processing",
      "shutdown": "Graceful shutdown and cleanup",
      "rate-limiter": "Rate limiting for tool execution",
      "memory-eviction": "LRU-based memory eviction strategy",
      "plugin-validator": "Plugin schema validation",
      "config-validator": "Configuration validation against rules",
      "command-suggestions": "Typo-tolerant command suggestions",
    },
  },
];

const EXAMPLES = [
  {
    id: "example-quickstart",
    title: "Quick Start",
    description: "A typical first session with HaxAgent.",
    code: `# Start HaxAgent
$ hax-agent

# List available slash commands
> /help

# Check your configuration
> /config

# Explore the project structure
> Ask the agent: "What files are in the src directory?"

# Make a code change
> Ask: "Add error handling to the login function in auth.js"

# See usage stats
> /status`,
  },
  {
    id: "example-plugin",
    title: "Creating a Custom Plugin",
    description: "How to create and register a HaxAgent plugin.",
    code: `// ~/.haxagent/plugins/lint-on-save.js
"use strict";

module.exports = {
  name: "lint-on-save",
  version: "1.0.0",
  hooks: {
    async afterToolCall(ctx) {
      if (ctx.toolName === "file.write" && ctx.args.path.endsWith(".js")) {
        const { execSync } = require("child_process");
        try {
          execSync("npx eslint " + ctx.args.path + " --fix", {
            cwd: ctx.session.settings.projectRoot,
          });
        } catch (e) {
          // eslint errors are non-fatal for the plugin
        }
      }
      return ctx;
    },
  },
};`,
  },
  {
    id: "example-batch",
    title: "Batch Mode",
    description: "Run HaxAgent in batch mode with predefined prompts.",
    code: `# Create a batch input file
$ cat > prompts.txt << 'EOF'
Read the file src/config.js and list all exported functions.
Search for TODO comments in the src/ directory.
What npm dependencies does this project use?
EOF

# Run batch mode
$ hax-agent --batch prompts.txt --batch-output results.json

# Or use a single prompt with --batch-file
$ hax-agent --batch-file prompts.json`,
  },
  {
    id: "example-team",
    title: "Agent Teams",
    description: "Creating and managing agent teams for complex tasks.",
    code: `# Create a refactoring team
> /team new
Describe the team: Refactoring team for the auth module

# Add agents to the team
> /team spawn
Role: Code analyzer

> /team spawn
Role: Test writer

# Assign tasks
> /team task
Agent: Code analyzer
Task: Audit auth.js for security issues

> /team task
Agent: Test writer
Task: Write unit tests for fixed auth functions`,
  },
  {
    id: "example-config",
    title: "Configuration Example",
    description: "A sample configuration file with common overrides.",
    code: `// ~/.haxagent/settings.json
{
  "agent": {
    "model": "claude-sonnet-4-20250514",
    "maxTurns": 30,
    "temperature": 0.3
  },
  "memory": {
    "enabled": true,
    "maxItems": 50
  },
  "context": {
    "windowTokens": 100000,
    "reserveOutputTokens": 8192
  },
  "permissions": {
    "mode": "normal"
  },
  "tools": {
    "shell": {
      "timeoutMs": 30000
    }
  }
}`,
  },
];

module.exports = {
  COMMANDS_DOCS,
  TOOLS_DOCS,
  PLUGINS_DOCS,
  CONFIG_DOCS,
  API_DOCS,
  EXAMPLES,
};
