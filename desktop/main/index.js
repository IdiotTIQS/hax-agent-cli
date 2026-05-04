"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");

const { AgentEngine } = require("../../src/agent-engine");
const {
  loadSettings,
  resolveSettings,
  updateUserSettings,
} = require("../../src/config");
const { listSessions } = require("../../src/memory");
const { PermissionManager } = require("../../src/permissions");
const { createProvider } = require("../../src/providers");
const { Session } = require("../../src/session");
const { registerAgentTeamTools } = require("../../src/teams/tools");
const { createLocalToolRegistry } = require("../../src/tools");

let mainWindow = null;
const sessions = new Map();
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".hax-agent"]);
const MAX_TREE_DEPTH = 4;
const MAX_TREE_ENTRIES = 500;
const MAX_RECENT_SESSIONS = 30;
const MOCK_ASSISTANT_PREFIX = "I’m in local mock mode right now";

function isDevMode() {
  return Boolean(process.env.HAX_AGENT_DESKTOP_URL) || !app.isPackaged;
}

function getDevUrl() {
  return process.env.HAX_AGENT_DESKTOP_URL || "http://127.0.0.1:5173";
}

function getRendererDistIndex() {
  return path.join(__dirname, "..", "renderer", "dist", "index.html");
}

function createMainWindow() {
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

  if (isDevMode()) {
    mainWindow.loadURL(getDevUrl());
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(getRendererDistIndex());
  }

  return mainWindow;
}

function createDesktopSession(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const settings = loadSettings({
    projectRoot,
    overrides: options.settings || {},
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

function getSessionRecord(sessionId) {
  const record = sessions.get(sessionId);

  if (!record) {
    throw new Error(`Unknown agent session: ${sessionId}`);
  }

  return record;
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

function registerIpcHandlers() {
  ipcMain.handle("agent:createSession", async (_event, options = {}) => {
    const { session } = createDesktopSession(options);
    return serializeSession(session);
  });

  ipcMain.handle("agent:resumeSession", async (_event, payload = {}) => {
    const projectRoot = path.resolve(payload.projectRoot || process.cwd());
    const settings = loadSettings({ projectRoot });
    const transcriptSession = findTranscriptSession(settings, payload.sessionId);

    if (!transcriptSession) {
      throw new Error(`Session not found: ${payload.sessionId}`);
    }

    const messages = transcriptSession.entries()
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({ role: entry.role, content: entry.content || "" }));
    const { session } = createDesktopSession({
      projectRoot,
      sessionId: transcriptSession.id,
      messages,
    });

    return serializeSession(session);
  });

  ipcMain.handle("agent:sendMessage", async (event, payload = {}) => {
    const { sessionId, options } = payload;
    const content = payload.content ?? payload.message;
    const record = getSessionRecord(sessionId);

    if (record.session.isStreaming) {
      throw new Error("Session is already streaming a response.");
    }

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

  ipcMain.handle("agent:interrupt", async (_event, payload = {}) => {
    const record = getSessionRecord(payload.sessionId);
    record.engine.interrupt();
    return serializeSession(record.session);
  });

  ipcMain.handle("settings:get", async (_event, options = {}) => {
    const resolved = resolveSettings({
      projectRoot: options.projectRoot || process.cwd(),
    });

    return {
      settings: sanitizeSettings(resolved.settings),
      sources: resolved.sources,
    };
  });

  ipcMain.handle("settings:update", async (_event, updates = {}) => {
    const saved = updateUserSettings(normalizeSettingsUpdates(updates));
    const resolved = resolveSettings();

    return {
      path: saved.path,
      settings: sanitizeSettings(resolved.settings),
      sources: resolved.sources,
    };
  });

  ipcMain.handle("workspace:getSnapshot", async (_event, options = {}) => {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const settings = loadSettings({ projectRoot });

    return {
      projectRoot,
      fileTree: readWorkspaceTree(projectRoot),
      git: await readGitStatus(projectRoot),
      sessions: readSessionList(settings),
    };
  });
}

function findTranscriptSession(settings, sessionId) {
  if (!sessionId) return null;
  const transcriptSessions = listSessions(settings);
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

function readSessionList(settings) {
  return listSessions(settings).map((session) => {
    const entries = session.entries();
    const summary = summarizeTranscriptEntries(entries);

    if (!summary) return null;

    return {
      id: session.id,
      updatedAt: session.updatedAt,
      preview: summary.preview,
      title: summary.title,
      messageCount: entries.length,
    };
  }).filter(Boolean).slice(0, MAX_RECENT_SESSIONS);
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

      resolve({
        available: true,
        branch: branch.name,
        ahead: branch.ahead,
        behind: branch.behind,
        changed: lines.filter((line) => !line.startsWith("## ")).length,
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
  delete next.workspace;

  return next;
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
