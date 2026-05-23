"use strict";

/**
 * Pre-built command providers for the HaxAgent command palette.
 *
 * Each provider implements the { name, getItems(context) } interface.
 * getItems() returns an array of palette items:
 *   { id, name, category, description, shortcut, keywords, action }
 *
 * The action is either a function to execute when selected, or a string
 * that the palette engine dispatches as a command.
 */

const { SLASH_COMMANDS } = require("../commands/definitions");

/**
 * Provider that exposes all slash commands as palette items.
 *
 * Each slash command becomes a palette item with its name as the action
 * string (the palette engine prepends "/" when executing).
 */
class SlashCommandsProvider {
  constructor() {
    this.name = "Slash Commands";
  }

  /**
   * @param {object} [context] - Optional context for session-aware commands
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    return SLASH_COMMANDS.map((cmd) => ({
      id: `cmd-${cmd.name}`,
      name: `/${cmd.name}`,
      category: "Commands",
      description: cmd.description || "",
      shortcut: cmd.aliases && cmd.aliases.length > 0 ? `/${cmd.aliases[0]}` : null,
      keywords: [
        cmd.name,
        ...(cmd.aliases || []),
        cmd.descriptionKey || "",
      ],
      action: () => {
        if (context && typeof context.executeCommand === "function") {
          return context.executeCommand(cmd.name);
        }
        return `/${cmd.name}`;
      },
    }));
  }
}

/**
 * Provider that exposes registered tools as palette items.
 */
class ToolCommandsProvider {
  /**
   * @param {object} [options]
   * @param {Function} [options.getTools] - Function that returns an array of tool definitions
   */
  constructor(options = {}) {
    this.name = "Tool Commands";
    this._getTools = options.getTools || (() => []);
  }

  /**
   * @param {object} [context]
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    const tools = typeof this._getTools === "function" ? this._getTools(context) : [];

    return tools.map((tool) => ({
      id: `tool-${tool.name}`,
      name: tool.name,
      category: "Tools",
      description: tool.description || "",
      shortcut: null,
      keywords: [tool.name, ...(tool.keywords || [])],
      action: () => {
        if (context && typeof context.invokeTool === "function") {
          return context.invokeTool(tool.name);
        }
        return tool.name;
      },
    }));
  }
}

/**
 * Provider that exposes recently modified files as palette items.
 */
class RecentFilesProvider {
  /**
   * @param {object} [options]
   * @param {number} [options.maxFiles=20] - Maximum number of files to show
   * @param {string} [options.projectRoot] - Project root to make paths relative
   */
  constructor(options = {}) {
    this.name = "Recent Files";
    this._maxFiles = options.maxFiles || 20;
    this._projectRoot = options.projectRoot || process.cwd();
    this._filesCache = [];
  }

  /**
   * Refresh the file list. Call this before getItems to update.
   *
   * @param {string[]} files - Array of file paths
   */
  refresh(files) {
    if (Array.isArray(files)) {
      this._filesCache = files.slice(0, this._maxFiles);
    }
  }

  /**
   * @param {object} [context]
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    const files = this._filesCache;

    return files.map((filePath, index) => {
      const relative = this._makeRelative(filePath);
      const parts = relative.split(/[/\\]/);
      const fileName = parts[parts.length - 1] || relative;

      return {
        id: `file-${index}`,
        name: fileName,
        category: "Recent Files",
        description: relative,
        shortcut: null,
        keywords: [fileName, relative, ...parts],
        action: () => {
          if (context && typeof context.openFile === "function") {
            return context.openFile(filePath);
          }
          return filePath;
        },
      };
    });
  }

  _makeRelative(filePath) {
    try {
      const path = require("node:path");
      const relative = path.relative(this._projectRoot, filePath);
      if (relative && !relative.startsWith("..")) {
        return relative;
      }
    } catch (_) {
      // Fall through to return original
    }
    return filePath;
  }
}

/**
 * Provider that exposes recent session history as palette items.
 */
class SessionHistoryProvider {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSessions=15] - Maximum number of sessions to show
   * @param {Function} [options.listSessions] - Function that returns session objects
   */
  constructor(options = {}) {
    this.name = "Session History";
    this._maxSessions = options.maxSessions || 15;
    this._listSessions = options.listSessions || (() => []);
  }

  /**
   * @param {object} [context]
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    let sessions = [];
    try {
      sessions = this._listSessions(context);
    } catch (_) {
      sessions = [];
    }

    return sessions.slice(0, this._maxSessions).map((s) => {
      const sessionId = s.id || s;
      const shortId = String(sessionId).slice(0, 12);
      const label = s.customName || s.label || shortId;

      let preview = "";
      if (s.entries && typeof s.entries === "function") {
        const entries = s.entries();
        const firstUser = entries.find((e) => e.role === "user");
        if (firstUser) {
          const content = String(firstUser.content || "");
          preview = content.length > 60 ? content.slice(0, 57) + "..." : content;
        }
      } else if (s.preview) {
        preview = s.preview;
      }

      const date = s.updatedAt || s.date || "";
      const dateStr = date ? new Date(date).toLocaleDateString() : "";

      return {
        id: `session-${sessionId}`,
        name: label,
        category: "Sessions",
        description: preview || dateStr || String(sessionId),
        shortcut: null,
        keywords: [String(sessionId), String(label), preview, dateStr].filter(Boolean),
        action: () => {
          if (context && typeof context.resumeSession === "function") {
            return context.resumeSession(String(sessionId));
          }
          return String(sessionId);
        },
      };
    });
  }
}

/**
 * Provider that exposes plugin-provided commands as palette items.
 */
class PluginCommandsProvider {
  /**
   * @param {object} [options]
   * @param {Function} [options.getPlugins] - Function returning plugin definitions
   */
  constructor(options = {}) {
    this.name = "Plugin Commands";
    this._getPlugins = options.getPlugins || (() => []);
  }

  /**
   * @param {object} [context]
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    let plugins = [];
    try {
      plugins = this._getPlugins(context);
    } catch (_) {
      plugins = [];
    }

    return plugins.map((plugin) => ({
      id: `plugin-${plugin.name}`,
      name: plugin.name,
      category: "Plugins",
      description: plugin.description || plugin.version || "Plugin command",
      shortcut: null,
      keywords: [plugin.name, plugin.description || "", plugin.version || ""],
      action: () => {
        if (context && typeof context.invokePlugin === "function") {
          return context.invokePlugin(plugin.name);
        }
        return plugin.name;
      },
    }));
  }
}

/**
 * Provider that exposes common quick actions as palette items.
 */
class QuickActionsProvider {
  constructor() {
    this.name = "Quick Actions";
  }

  /**
   * @param {object} [context]
   * @returns {Array<{id: string, name: string, category: string, description: string, shortcut: string|null, keywords: string[], action: Function}>}
   */
  getItems(context) {
    const actions = [
      {
        id: "qa-new-session",
        name: "New Session",
        category: "Quick Actions",
        description: "Start a new conversation session",
        shortcut: "Ctrl+N",
        keywords: ["new", "session", "start", "fresh"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("clear");
          }
          return "/clear";
        },
      },
      {
        id: "qa-clear-conversation",
        name: "Clear Conversation",
        category: "Quick Actions",
        description: "Clear the current conversation",
        shortcut: "Ctrl+L",
        keywords: ["clear", "reset", "wipe"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("clear");
          }
          return "/clear";
        },
      },
      {
        id: "qa-compact",
        name: "Compact Context",
        category: "Quick Actions",
        description: "Compact conversation to reduce token usage",
        shortcut: null,
        keywords: ["compact", "compress", "reduce", "context"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("compact");
          }
          return "/compact";
        },
      },
      {
        id: "qa-show-help",
        name: "Show Help",
        category: "Quick Actions",
        description: "Display available commands and shortcuts",
        shortcut: "Ctrl+H",
        keywords: ["help", "?", "commands", "shortcuts"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("help");
          }
          return "/help";
        },
      },
      {
        id: "qa-show-config",
        name: "Show Configuration",
        category: "Quick Actions",
        description: "View current configuration settings",
        shortcut: null,
        keywords: ["config", "settings", "options"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("config");
          }
          return "/config";
        },
      },
      {
        id: "qa-show-status",
        name: "Show Session Status",
        category: "Quick Actions",
        description: "Display session summary (model, cost, tokens)",
        shortcut: null,
        keywords: ["status", "summary", "info"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("status");
          }
          return "/status";
        },
      },
      {
        id: "qa-toggle-theme",
        name: "Toggle Theme",
        category: "Quick Actions",
        description: "Switch between light and dark color themes",
        shortcut: null,
        keywords: ["theme", "dark", "light", "color"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("theme");
          }
          return "/theme";
        },
      },
      {
        id: "qa-run-doctor",
        name: "Run Diagnostics",
        category: "Quick Actions",
        description: "Check system setup and configuration",
        shortcut: null,
        keywords: ["doctor", "diagnostics", "check", "health"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("doctor");
          }
          return "/doctor";
        },
      },
      {
        id: "qa-exit",
        name: "Exit Session",
        category: "Quick Actions",
        description: "Exit the current session",
        shortcut: "Ctrl+C",
        keywords: ["exit", "quit", "q", "close"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("exit");
          }
          return "/exit";
        },
      },
      {
        id: "qa-list-skills",
        name: "List Skills",
        category: "Quick Actions",
        description: "Show all available skills",
        shortcut: null,
        keywords: ["skills", "list", "abilities"],
        action: () => {
          if (context && typeof context.executeCommand === "function") {
            return context.executeCommand("skills");
          }
          return "/skills";
        },
      },
    ];

    return actions;
  }
}

/**
 * Create a default set of command providers.
 *
 * @param {object} [options]
 * @param {Function} [options.getTools] - Function returning tool definitions
 * @param {Function} [options.getPlugins] - Function returning plugin definitions
 * @param {Function} [options.listSessions] - Function returning session objects
 * @param {string[]} [options.recentFiles] - Array of recent file paths
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {{ slashCommands: SlashCommandsProvider, tools: ToolCommandsProvider, recentFiles: RecentFilesProvider, sessions: SessionHistoryProvider, plugins: PluginCommandsProvider, quickActions: QuickActionsProvider }}
 */
function createDefaultProviders(options = {}) {
  const providers = {
    slashCommands: new SlashCommandsProvider(),
    quickActions: new QuickActionsProvider(),
  };

  if (options.getTools) {
    providers.tools = new ToolCommandsProvider({ getTools: options.getTools });
  }

  const recentFilesProvider = new RecentFilesProvider({
    maxFiles: options.maxFiles || 20,
    projectRoot: options.projectRoot,
  });
  if (Array.isArray(options.recentFiles)) {
    recentFilesProvider.refresh(options.recentFiles);
  }
  providers.recentFiles = recentFilesProvider;

  if (options.listSessions) {
    providers.sessions = new SessionHistoryProvider({
      maxSessions: options.maxSessions || 15,
      listSessions: options.listSessions,
    });
  }

  if (options.getPlugins) {
    providers.plugins = new PluginCommandsProvider({
      getPlugins: options.getPlugins,
    });
  }

  return providers;
}

module.exports = {
  SlashCommandsProvider,
  ToolCommandsProvider,
  RecentFilesProvider,
  SessionHistoryProvider,
  PluginCommandsProvider,
  QuickActionsProvider,
  createDefaultProviders,
};
