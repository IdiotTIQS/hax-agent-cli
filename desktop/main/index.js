"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const electron = require("electron");

const { AgentEngine } = require("../../src/agent-engine");
const {
  loadSettings,
  resolveSettings,
  updateUserSettings,
} = require("../../src/config");
const { listSessions } = require("../../src/memory");
const {
  PermissionManager,
  TOOL_PERMISSIONS,
  SAFE_SHELL_COMMANDS,
  DANGEROUS_SHELL_COMMANDS,
} = require("../../src/permissions");
const {
  loadAllSkills,
  createSkillifySkill,
  getSkillUsageStats,
} = require("../../src/skills");
const { createProvider } = require("../../src/providers");
const { Session } = require("../../src/session");
const { createTeamRuntime } = require("../../src/teams/runtime");
const { registerAgentTeamTools } = require("../../src/teams/tools");
const { createLocalToolRegistry } = require("../../src/tools");

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const shell = electron.shell;

let mainWindow = null;
const sessions = new Map();
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".hax-agent"]);
const MAX_TREE_DEPTH = 4;
const MAX_TREE_ENTRIES = 500;
const MAX_RECENT_SESSIONS = 30;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DIFF_BYTES = 200 * 1024;
const MOCK_ASSISTANT_PREFIX = "I’m in local mock mode right now";
const pendingApprovals = new Map();

function isDevMode() {
  if (process.env.HAX_AGENT_DESKTOP_MODE === "production") return false;
  return Boolean(process.env.HAX_AGENT_DESKTOP_URL) || !app.isPackaged;
}

function getDevUrl() {
  return process.env.HAX_AGENT_DESKTOP_URL || "http://127.0.0.1:5173";
}

function shouldOpenDevTools() {
  return process.env.HAX_AGENT_DESKTOP_DEVTOOLS === "1";
}

function getRendererDistIndex() {
  return path.join(__dirname, "..", "renderer", "dist", "index.html");
}

function createMainWindow() {
  if (!BrowserWindow) {
    throw new Error("createMainWindow requires the Electron runtime.");
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(() => {});
    return { action: "deny" };
  });

  if (isDevMode()) {
    mainWindow.loadURL(getDevUrl());
    if (shouldOpenDevTools()) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(getRendererDistIndex());
  }

  return mainWindow;
}

function createDesktopSession(options = {}) {
  const hasWorkspace = Boolean(String(options.projectRoot || "").trim());
  const projectRoot = path.resolve(hasWorkspace ? options.projectRoot : process.cwd());
  const settings = loadSettings({
    projectRoot,
    overrides: mergePlainObjects(
      { transcriptProjectRoot: hasWorkspace ? projectRoot : "" },
      options.settings || {},
    ),
  });
  const provider = createProvider(settings.agent, process.env);
  const permissionManager = new PermissionManager({
    mode: options.permissionMode || settings.permissions?.mode || "normal",
    locale: settings.ui?.locale,
    persistPath: path.join(projectRoot, ".hax-agent", "permissions.json"),
  });
  const toolRegistry = createLocalToolRegistry({
    root: projectRoot,
    shellPolicy: settings.tools?.shell,
    permissionManager,
  });
  registerAgentTeamTools(toolRegistry, { settings, projectRoot });
  const session = new Session({
    provider,
    settings,
    toolRegistry,
    permissionManager,
  });
  if (Array.isArray(options.messages)) {
    session.messages = options.messages;
  }
  if (options.sessionId) {
    session.id = options.sessionId;
  }
  const engine = new AgentEngine({
    session,
    projectRoot,
    env: process.env,
  });
  const record = { engine, projectRoot, session };

  sessions.set(session.id, record);

  return record;
}

function createDesktopApprovalPrompt(sender, session) {
  return ({ toolName, toolArgs, level, description, toolKey }) => new Promise((resolve) => {
    if (!sender || typeof sender.send !== "function") {
      resolve("deny");
      return;
    }

    const id = crypto.randomUUID();
    pendingApprovals.set(id, { resolve, sessionId: session?.id || "" });
    sender.send("approval:request", {
      id,
      sessionId: session?.id || "",
      toolName,
      toolArgs: sanitizeApprovalArgs(toolArgs),
      toolKey,
      level,
      description,
      requestedAt: new Date().toISOString(),
    });
  });
}

function resolvePendingApproval(id, decision) {
  const pending = pendingApprovals.get(id);
  if (!pending) {
    return { resolved: false };
  }

  pendingApprovals.delete(id);
  pending.resolve(normalizeApprovalDecision(decision));
  return { resolved: true };
}

function resolvePendingApprovalsForSession(sessionId, decision = "deny") {
  let count = 0;
  for (const [id, pending] of pendingApprovals.entries()) {
    if (pending.sessionId !== sessionId) continue;
    pendingApprovals.delete(id);
    pending.resolve(normalizeApprovalDecision(decision));
    count += 1;
  }
  return count;
}

function normalizeApprovalDecision(decision) {
  return ["approve", "deny", "always_allow", "always_deny"].includes(decision)
    ? decision
    : "deny";
}

function sanitizeApprovalArgs(value) {
  if (value == null) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const maxLength = 6000;
  if (text.length <= maxLength) return value;
  return {
    truncated: true,
    preview: `${text.slice(0, maxLength)}\n...`,
  };
}

function mergePlainObjects(...objects) {
  return Object.assign({}, ...objects.filter((item) => item && typeof item === "object"));
}

function getSessionRecord(sessionId) {
  const record = sessions.get(sessionId);

  if (!record) {
    throw new Error(`Unknown agent session: ${sessionId}`);
  }

  return record;
}

function retargetSessionRecord(record, projectRoot) {
  const nextProjectRoot = path.resolve(projectRoot || process.cwd());

  if (pathsEqual(record.projectRoot, nextProjectRoot)) {
    return record;
  }

  return createDesktopSession({
    projectRoot: nextProjectRoot,
    sessionId: record.session.id,
    messages: record.session.messages,
    permissionMode: record.session.permissionManager?.mode,
  });
}

function serializeSession(session) {
  return {
    id: session.id,
    messages: session.messages,
    provider: serializeProvider(session.provider),
    permission: session.permissionManager?.getSummary?.() || null,
    settings: sanitizeSettings(session.settings),
    status: {
      isStreaming: session.isStreaming,
      turns: session.costTracker.turnCount,
      toolCalls: session.costTracker.toolCallCount,
      inputTokens: session.costTracker.inputTokens,
      outputTokens: session.costTracker.outputTokens,
      tokens: session.costTracker.inputTokens + session.costTracker.outputTokens,
      cost: session.costTracker.getCost(session.provider?.model),
      elapsed: session.getElapsedTime(),
    },
  };
}

function serializeProvider(provider) {
  if (!provider) return null;

  return {
    name: provider.name,
    model: provider.model,
    apiUrl: provider.apiUrl,
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: error?.message || String(error || "Unknown error"),
    stack: error?.stack || null,
  };
}

function registerIpcHandlers(ipc = ipcMain) {
  if (!ipc || typeof ipc.handle !== "function") {
    throw new TypeError("registerIpcHandlers requires an Electron ipcMain-like object.");
  }

  ipc.handle("agent:createSession", async (_event, options = {}) => {
    const { session } = createDesktopSession(options);
    return serializeSession(session);
  });

  ipc.handle("agent:resumeSession", async (_event, payload = {}) => {
    const hasWorkspace = Boolean(String(payload.projectRoot || "").trim());
    const projectRoot = path.resolve(hasWorkspace ? payload.projectRoot : process.cwd());
    const settings = loadSettings({ projectRoot });
    const transcriptSession = findTranscriptSession(settings, payload.sessionId);

    if (!transcriptSession) {
      throw new Error(`Session not found: ${payload.sessionId}`);
    }

    const messages = transcriptSession.entries()
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({ role: entry.role, content: entry.content || "" }));
    const { session } = createDesktopSession({
      projectRoot: hasWorkspace ? projectRoot : "",
      sessionId: transcriptSession.id,
      messages,
    });

    return serializeSession(session);
  });

  ipc.handle("agent:sendMessage", async (event, payload = {}) => {
    const { sessionId, options } = payload;
    const content = payload.content ?? payload.message;
    let record = getSessionRecord(sessionId);
    const requestedProjectRoot = payload.projectRoot || options?.projectRoot;

    if (record.session.isStreaming) {
      throw new Error("Session is already streaming a response.");
    }

    if (String(requestedProjectRoot || "").trim()) {
      record = retargetSessionRecord(record, requestedProjectRoot);
    }

    record.session.toolRegistry.approvalCallback = createDesktopApprovalPrompt(event.sender, record.session);

    try {
      for await (const agentEvent of record.engine.sendMessage(content, options || {})) {
        event.sender.send("agent:event", agentEvent);
      }

      return serializeSession(record.session);
    } catch (error) {
      const failedEvent = {
        type: "turn.failed",
        sessionId: record.session.id,
        timestamp: new Date().toISOString(),
        error: serializeError(error),
      };

      event.sender.send("agent:event", failedEvent);
      throw error;
    }
  });

  ipc.handle("agent:interrupt", async (_event, payload = {}) => {
    const record = getSessionRecord(payload.sessionId);
    resolvePendingApprovalsForSession(record.session.id, "deny");
    record.engine.interrupt();
    return serializeSession(record.session);
  });

  ipc.handle("approval:respond", async (_event, payload = {}) => (
    resolvePendingApproval(payload.id, payload.decision)
  ));

  ipc.handle("settings:get", async (_event, options = {}) => {
    const bootstrap = resolveSettings({ projectRoot: options.projectRoot || process.cwd() });
    const resolved = resolveSettings({
      projectRoot: options.projectRoot || bootstrap.settings.desktop?.workspace || process.cwd(),
    });

    return {
      settings: sanitizeSettings(resolved.settings),
      sources: resolved.sources,
    };
  });

  ipc.handle("settings:update", async (_event, updates = {}) => {
    const saved = updateUserSettings(normalizeSettingsUpdates(updates));
    const bootstrap = resolveSettings();
    const resolved = resolveSettings({
      projectRoot: bootstrap.settings.desktop?.workspace || process.cwd(),
    });

    return {
      path: saved.path,
      settings: sanitizeSettings(resolved.settings),
      sources: resolved.sources,
    };
  });

  ipc.handle("workspace:getSnapshot", async (_event, options = {}) => {
    const hasWorkspace = Boolean(String(options.projectRoot || "").trim());
    const projectRoot = path.resolve(hasWorkspace ? options.projectRoot : process.cwd());
    const settings = loadSettings({ projectRoot });

    return {
      projectRoot: hasWorkspace ? projectRoot : "",
      fileTree: hasWorkspace ? readWorkspaceTree(projectRoot) : [],
      git: await readGitStatus(projectRoot),
      sessions: readSessionList(settings, { currentProjectRoot: hasWorkspace ? projectRoot : "" }),
    };
  });

  ipc.handle("workspace:search", async (_event, options = {}) => {
    const hasWorkspace = Boolean(String(options.projectRoot || "").trim());
    const projectRoot = path.resolve(hasWorkspace ? options.projectRoot : process.cwd());
    return searchWorkspaceContent(projectRoot, options);
  });

  ipc.handle("workspace:readFile", async (_event, options = {}) => {
    const hasWorkspace = Boolean(String(options.projectRoot || "").trim());
    const projectRoot = path.resolve(hasWorkspace ? options.projectRoot : process.cwd());
    return readWorkspaceFile(projectRoot, options);
  });

  ipc.handle("git:getDiff", async (_event, options = {}) => {
    const hasWorkspace = Boolean(String(options.projectRoot || "").trim());
    const projectRoot = path.resolve(hasWorkspace ? options.projectRoot : process.cwd());
    return readGitDiff(projectRoot, options);
  });

  ipc.handle("workspace:chooseDirectory", async (_event, options = {}) => {
    if (!dialog || typeof dialog.showOpenDialog !== "function") {
      throw new Error("Choosing a workspace directory requires the Electron runtime.");
    }

    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "选择项目目录",
      defaultPath: options.defaultPath || process.cwd(),
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true, path: "" };
    }

    return { canceled: false, path: path.resolve(result.filePaths[0]) };
  });

  ipc.handle("skills:getSnapshot", async (_event, options = {}) => {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    return readSkillsSnapshot(projectRoot);
  });

  ipc.handle("tools:getSnapshot", async (_event, options = {}) => {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const settings = loadSettings({ projectRoot });
    return readToolSnapshot(projectRoot, settings);
  });

  ipc.handle("permissions:getSnapshot", async (_event, options = {}) => {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const settings = loadSettings({ projectRoot });
    return readPermissionSnapshot(projectRoot, settings);
  });

  ipc.handle("team:getSnapshot", async (_event, options = {}) => {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const settings = loadSettings({ projectRoot });
    return readTeamSnapshot(projectRoot, settings);
  });

  ipc.handle("shell:openExternal", async (_event, url) => openExternalUrl(url));
}

function findTranscriptSession(settings, sessionId) {
  if (!sessionId) return null;
  const transcriptSessions = getSessionRecords(settings);
  const exactMatch = transcriptSessions.find((session) => session.id === sessionId);

  if (exactMatch) return exactMatch;

  const prefixMatches = transcriptSessions.filter((session) => session.id.startsWith(sessionId));
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

function readWorkspaceTree(projectRoot) {
  let entryCount = 0;

  function walk(directory, depth) {
    if (depth > MAX_TREE_DEPTH || entryCount >= MAX_TREE_ENTRIES) return [];

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => !shouldIgnoreEntry(entry))
      .sort(sortDirectoryEntries)
      .slice(0, Math.max(0, MAX_TREE_ENTRIES - entryCount))
      .map((entry) => {
        entryCount += 1;
        const fullPath = path.join(directory, entry.name);
        const relativePath = normalizeSlashes(path.relative(projectRoot, fullPath));
        const node = {
          name: entry.name,
          path: relativePath || ".",
          type: entry.isDirectory() ? "directory" : "file",
        };

        if (entry.isDirectory()) {
          node.children = walk(fullPath, depth + 1);
        }

        return node;
      });
  }

  return walk(projectRoot, 0);
}

function searchWorkspaceContent(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const query = String(options.query || "").trim();
  const caseSensitive = options.caseSensitive === true;
  const maxResults = clampPositiveInteger(options.maxResults, MAX_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  const maxFiles = clampPositiveInteger(options.maxFiles, MAX_SEARCH_FILES, 1, MAX_SEARCH_FILES);
  const matches = [];
  let scannedFiles = 0;
  let truncated = false;

  if (!query) {
    return { projectRoot: root, query, matches, scannedFiles, truncated: false };
  }

  const needle = caseSensitive ? query : query.toLocaleLowerCase();

  function walk(directory) {
    if (matches.length >= maxResults || scannedFiles >= maxFiles) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort(sortDirectoryEntries);

    for (const entry of entries) {
      if (matches.length >= maxResults || scannedFiles >= maxFiles) {
        truncated = true;
        return;
      }

      if (shouldIgnoreEntry(entry)) continue;

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const stat = safeStat(fullPath);
      if (!stat || stat.size > MAX_SEARCH_FILE_BYTES) continue;

      scannedFiles += 1;
      let content;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      if (content.includes("\0")) continue;

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const haystack = caseSensitive ? line : line.toLocaleLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) continue;

        matches.push({
          path: normalizeSlashes(path.relative(root, fullPath)),
          line: index + 1,
          column: column + 1,
          text: line.length > 240 ? `${line.slice(0, 237)}...` : line,
        });

        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    }
  }

  walk(root);

  return { projectRoot: root, query, matches, scannedFiles, truncated };
}

function readWorkspaceFile(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const requestedPath = String(options.path || "");
  const resolvedPath = resolveWorkspacePath(root, requestedPath);
  const stat = safeStat(resolvedPath);

  if (!stat || !stat.isFile()) {
    throw new Error(`Path is not a file: ${requestedPath}`);
  }

  if (stat.size > MAX_PREVIEW_BYTES) {
    return {
      projectRoot: root,
      path: normalizeSlashes(path.relative(root, resolvedPath)),
      bytes: stat.size,
      truncated: true,
      content: "",
      lines: [],
    };
  }

  const content = fs.readFileSync(resolvedPath, "utf8");
  if (content.includes("\0")) {
    throw new Error(`Cannot preview binary file: ${requestedPath}`);
  }

  return {
    projectRoot: root,
    path: normalizeSlashes(path.relative(root, resolvedPath)),
    bytes: stat.size,
    truncated: false,
    content,
    lines: content.split(/\r?\n/).map((text, index) => ({ number: index + 1, text })),
  };
}

function resolveWorkspacePath(root, requestedPath) {
  const resolved = path.resolve(root, requestedPath || ".");
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new Error(`Path escapes workspace root: ${requestedPath}`);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function clampPositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function shouldIgnoreEntry(entry) {
  if (entry.name.startsWith(".") && entry.name !== ".github") return true;
  return entry.isDirectory() && IGNORED_DIRS.has(entry.name);
}

function sortDirectoryEntries(left, right) {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function readSessionList(settings, options = {}) {
  const sessionRecords = getSessionRecords(settings);
  const currentProjectRoot = options.currentProjectRoot === undefined ? settings.projectRoot : options.currentProjectRoot;

  return sessionRecords.map((session) => {
    const entries = session.entries();
    const summary = summarizeTranscriptEntries(entries);
    const metadata = typeof session.metadata === "function" ? session.metadata() : null;
    const projectRoot = metadata?.projectRoot || "";

    if (!summary) return null;

    return {
      id: session.id,
      updatedAt: session.updatedAt,
      preview: summary.preview,
      title: summary.title,
      messageCount: entries.length,
      projectRoot,
      projectName: metadata?.projectName || (projectRoot ? path.basename(projectRoot) : "未归属"),
      projectScope: getSessionProjectScope(projectRoot, currentProjectRoot),
    };
  }).filter(Boolean).slice(0, MAX_RECENT_SESSIONS);
}

function getSessionRecords(settings) {
  const legacySessionDirectory = path.join(settings.projectRoot || process.cwd(), ".hax-agent", "sessions");
  const sessionRecords = [
    ...listSessions(settings),
    ...(pathsEqual(settings.sessions?.directory, legacySessionDirectory)
      ? []
      : listSessions({ ...settings, sessions: { ...(settings.sessions || {}), directory: legacySessionDirectory } })),
  ];
  const seen = new Set();

  return sessionRecords.map((session) => {
    if (seen.has(session.path)) return null;
    seen.add(session.path);
    return session;
  }).filter(Boolean);
}

function getSessionProjectScope(sessionProjectRoot, currentProjectRoot) {
  if (!sessionProjectRoot) return "unassigned";
  if (pathsEqual(sessionProjectRoot, currentProjectRoot)) return "current";
  return "other";
}

function pathsEqual(left, right) {
  const normalize = (value) => path.resolve(String(value || "")).toLowerCase();
  return Boolean(left && right) && normalize(left) === normalize(right);
}

function summarizeTranscriptEntries(entries) {
  const chatEntries = entries.filter((entry) => entry.role === "user" || entry.role === "assistant");
  if (chatEntries.length === 0 || isMockTranscript(chatEntries)) return null;

  const userMessages = chatEntries
    .filter((entry) => entry.role === "user")
    .map((entry) => normalizePreviewText(entry.content))
    .filter(Boolean);
  const latestUserMessage = userMessages.at(-1);
  const firstUserMessage = userMessages[0];
  const preview = latestUserMessage || normalizePreviewText(chatEntries.at(-1)?.content) || "(empty session)";

  return {
    title: truncateText(firstUserMessage || preview, 48),
    preview: truncateText(preview, 90),
  };
}

function isMockTranscript(entries) {
  const hasOnlyMockAssistantReplies = entries
    .filter((entry) => entry.role === "assistant")
    .every((entry) => String(entry.content || "").startsWith(MOCK_ASSISTANT_PREFIX));
  const hasAssistantReply = entries.some((entry) => entry.role === "assistant");

  return hasAssistantReply && hasOnlyMockAssistantReplies;
}

function normalizePreviewText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function readGitStatus(projectRoot) {
  return new Promise((resolve) => {
    runGit(projectRoot, ["status", "--porcelain=v1", "--branch"]).then((result) => {
      if (result.exitCode !== 0) {
        resolve({
          available: false,
          branch: "none",
          ahead: 0,
          behind: 0,
          changed: 0,
          raw: result.stderr || result.stdout,
        });
        return;
      }

      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("## ")) || "";
      const branch = parseGitBranch(branchLine);
      const files = parseGitStatusFiles(lines.filter((line) => !line.startsWith("## ")));

      resolve({
        available: true,
        branch: branch.name,
        ahead: branch.ahead,
        behind: branch.behind,
        changed: files.length,
        files,
        raw: result.stdout,
      });
    }).catch((error) => {
      resolve({
        available: false,
        branch: "none",
        ahead: 0,
        behind: 0,
        changed: 0,
        raw: error.message,
      });
    });
  });
}

async function readGitDiff(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const filePath = String(options.path || "");
  const resolvedPath = resolveWorkspacePath(root, filePath);
  const relativePath = normalizeSlashes(path.relative(root, resolvedPath));
  const diffParts = [];

  const staged = await runGit(root, ["diff", "--cached", "--", relativePath]);
  const unstaged = await runGit(root, ["diff", "--", relativePath]);

  if (staged.exitCode === 0 && staged.stdout.trim()) {
    diffParts.push(`# staged\n${staged.stdout}`);
  }
  if (unstaged.exitCode === 0 && unstaged.stdout.trim()) {
    diffParts.push(`# unstaged\n${unstaged.stdout}`);
  }

  let diff = diffParts.join("\n");

  if (!diff.trim() && safeStat(resolvedPath)?.isFile()) {
    const content = fs.readFileSync(resolvedPath, "utf8");
    if (!content.includes("\0")) {
      diff = synthesizeUntrackedDiff(relativePath, content);
    }
  }

  const truncated = Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_BYTES) + "\n...diff truncated...\n";
  }

  return {
    projectRoot: root,
    path: relativePath,
    diff,
    truncated,
  };
}

function synthesizeUntrackedDiff(filePath, content) {
  const lines = content.split(/\r?\n/).slice(0, 400);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function parseGitStatusFiles(lines) {
  return lines.map((line) => {
    const rawStatus = line.slice(0, 2);
    const rawPath = line.slice(3);
    const renameParts = rawPath.split(" -> ");
    const filePath = renameParts.at(-1) || rawPath;
    return {
      path: normalizeSlashes(filePath),
      previousPath: renameParts.length > 1 ? normalizeSlashes(renameParts[0]) : "",
      index: rawStatus[0],
      worktree: rawStatus[1],
      status: summarizeGitFileStatus(rawStatus),
    };
  }).filter((item) => item.path);
}

function summarizeGitFileStatus(rawStatus) {
  if (rawStatus === "??") return "untracked";
  if (rawStatus.includes("D")) return "deleted";
  if (rawStatus.includes("R")) return "renamed";
  if (rawStatus.includes("A")) return "added";
  if (rawStatus.includes("M")) return "modified";
  return "changed";
}

function readSkillsSnapshot(projectRoot) {
  const skillify = createSkillifySkill([]);
  const usageStats = getSkillUsageStats();
  const skills = [skillify, ...loadAllSkills(projectRoot)].map((skill) => {
    const usage = usageStats[skill.name] || {};
    return {
      name: skill.name,
      displayName: skill.displayName || skill.name,
      description: skill.description || '',
      whenToUse: skill.whenToUse || '',
      allowedTools: Array.isArray(skill.allowedTools) ? skill.allowedTools : [],
      source: skill.source || 'custom',
      baseDir: skill.baseDir || '',
      isHidden: Boolean(skill.isHidden),
      userInvocable: skill.userInvocable !== false,
      usageCount: Number(usage.usageCount || 0),
      lastUsedAt: usage.lastUsedAt || null,
      usageScore: Number((usage.usageCount || 0)),
    };
  });

  skills.sort((left, right) => {
    if (right.usageScore !== left.usageScore) return right.usageScore - left.usageScore;
    return left.displayName.localeCompare(right.displayName);
  });

  return {
    projectRoot,
    total: skills.length,
    visible: skills.filter((skill) => !skill.isHidden).length,
    skills,
  };
}

function readToolSnapshot(projectRoot, settings) {
  const registry = createLocalToolRegistry({
    root: projectRoot,
    shellPolicy: settings.tools?.shell,
  });

  const tools = registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || null,
  }));

  return {
    projectRoot,
    total: tools.length,
    tools,
  };
}

function readPermissionSnapshot(projectRoot, settings) {
  const persistPath = path.join(projectRoot, ".hax-agent", "permissions.json");
  const manager = new PermissionManager({
    mode: settings.permissions?.mode || "normal",
    locale: settings.ui?.locale,
    persistPath,
  });

  try {
    const raw = fs.readFileSync(persistPath, "utf8");
    const persisted = JSON.parse(raw);
    if (persisted && typeof persisted === "object") {
      if (persisted.mode) manager.mode = persisted.mode;
      if (Array.isArray(persisted.alwaysAllow)) {
        manager._alwaysAllow = new Set(persisted.alwaysAllow);
      }
      if (Array.isArray(persisted.alwaysDeny)) {
        manager._alwaysDeny = new Set(persisted.alwaysDeny);
      }
    }
  } catch {
    // No persisted overrides yet.
  }

  const summary = manager.getSummary();

  return {
    projectRoot,
    ...summary,
    counts: {
      auto: summary.toolPermissions.filter((item) => item.level === "auto").length,
      dynamic: summary.toolPermissions.filter((item) => item.level === "dynamic").length,
      ask: summary.toolPermissions.filter((item) => item.level === "ask").length,
      dangerous: summary.toolPermissions.filter((item) => item.level === "dangerous").length,
    },
    shellCommands: {
      safe: Array.from(SAFE_SHELL_COMMANDS).sort(),
      dangerous: Array.from(DANGEROUS_SHELL_COMMANDS).sort(),
    },
    toolPermissions: summary.toolPermissions.map((item) => ({
      tool: item.tool,
      level: item.level,
    })),
  };
}

function readTeamSnapshot(projectRoot, settings) {
  const runtime = createTeamRuntime({ projectRoot, settings });
  const teams = runtime.listTeams();
  let activeTeam = null;

  if (teams.length > 0) {
    try {
      activeTeam = runtime.loadTeam(teams[0].name);
    } catch {
      activeTeam = null;
    }
  }

  return {
    projectRoot,
    teams,
    activeTeam,
  };
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function parseGitBranch(line) {
  const clean = line.replace(/^##\s+/, "");
  const [namePart, metaPart = ""] = clean.split("...");
  const meta = metaPart || namePart;
  const aheadMatch = meta.match(/ahead\s+(\d+)/);
  const behindMatch = meta.match(/behind\s+(\d+)/);

  return {
    name: namePart.replace(/\s+\[.*\]$/, "") || "unknown",
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function sanitizeSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const clone = JSON.parse(JSON.stringify(settings));

  if (clone.agent?.apiKey) {
    clone.agent.apiKey = "***";
  }

  return clone;
}

function normalizeSettingsUpdates(updates = {}) {
  const next = { ...updates };

  if ("provider" in next || "model" in next || "temperature" in next) {
    next.agent = {
      ...(next.agent || {}),
      ...(next.provider && next.provider !== "auto" ? { provider: next.provider } : {}),
      ...(next.model ? { model: next.model } : {}),
      ...(Number.isFinite(next.temperature) ? { temperature: next.temperature } : {}),
    };
  }

  delete next.provider;
  delete next.model;
  delete next.temperature;
  if (next.workspace !== undefined) {
    const workspace = String(next.workspace || "").trim();
    next.desktop = {
      ...(next.desktop || {}),
      ...(workspace ? { workspace: path.resolve(workspace) } : { workspace: undefined }),
    };
  }
  delete next.workspace;

  return next;
}

async function openExternalUrl(rawUrl, opener = shell) {
  const url = new URL(String(rawUrl || ""));

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported external URL protocol: ${url.protocol || "unknown"}`);
  }

  if (!opener || typeof opener.openExternal !== "function") {
    throw new Error("Opening external URLs requires the Electron runtime.");
  }

  await opener.openExternal(url.href);
  return { opened: true, url: url.href };
}

function startElectronApp() {
  if (!app || typeof app.whenReady !== "function") {
    throw new Error("startElectronApp requires the Electron runtime.");
  }

  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

if (app && typeof app.whenReady === "function" && (require.main === module || process.versions?.electron)) {
  startElectronApp();
}

module.exports = {
  createDesktopSession,
  createDesktopApprovalPrompt,
  createMainWindow,
  findTranscriptSession,
  getDevUrl,
  getRendererDistIndex,
  isDevMode,
  normalizeSettingsUpdates,
  openExternalUrl,
  readSessionList,
  readGitDiff,
  readWorkspaceFile,
  readSkillsSnapshot,
  readToolSnapshot,
  readPermissionSnapshot,
  readTeamSnapshot,
  readGitStatus,
  searchWorkspaceContent,
  readWorkspaceTree,
  registerIpcHandlers,
  resolvePendingApproval,
  resolvePendingApprovalsForSession,
  serializeSession,
  shouldOpenDevTools,
  startElectronApp,
  summarizeTranscriptEntries,
};
