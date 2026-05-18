"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const electron = require("electron");

const { AgentEngine } = require("../../src/agent-engine");
const {
  loadSettings,
  resolveSettings,
  updateUserSettings,
} = require("../../src/config");
const { PermissionManager } = require("../../src/permissions");
const { createProvider } = require("../../src/providers");
const { Session } = require("../../src/session");
const { registerAgentTeamTools } = require("../../src/teams/tools");
const { serializeProvider, serializeError } = require("../../src/utils/serialization");
const { createLocalToolRegistry } = require("../../src/tools");
const {
  findTranscriptSession,
  readSessionList,
  readGitDiff,
  readWorkspaceFile,
  readSkillsSnapshot,
  readToolSnapshot,
  readPermissionSnapshot,
  readTeamSnapshot,
  readGitStatus,
  pathsEqual,
  sanitizeSettings,
  searchWorkspaceContent,
  readWorkspaceTree,
  summarizeTranscriptEntries,
} = require("../../src/desktop-services");

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const shell = electron.shell;

let mainWindow = null;
const sessions = new Map();
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
    mode: normalizePermissionMode(options.permissionMode, settings.permissions?.mode || "normal"),
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

function normalizePermissionMode(mode, fallback = "normal") {
  if (mode === "full" || mode === "yolo") return "yolo";
  if (mode === "normal" || mode === "ask" || mode === "auto") return mode;
  return fallback;
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

    if (payload.permissionMode !== undefined) {
      record.session.permissionManager.mode = normalizePermissionMode(
        payload.permissionMode,
        record.session.permissionManager.mode,
      );
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
