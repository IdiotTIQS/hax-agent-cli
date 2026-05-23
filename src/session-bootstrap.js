'use strict';

/**
 * session-bootstrap.js — Unified session initialization
 *
 * Extracted from cli.js to eliminate duplication between runResumeCommand
 * (lines 328–395) and runShell (lines 495–668).  Both paths need the same
 * core wiring — provider, screen, plugins, tools, safety pipeline, event bus,
 * analytics, background tasks, knowledge management, and graceful shutdown
 * hooks.
 *
 * All optional infrastructure modules are accepted as parameters so the
 * caller (cli.js) retains control over try/catch loading and error handling.
 */

const path = require('path');
const os = require('node:os');
const { EventBus } = require('./events/bus');
const { createProvider } = require('./providers');
const { TerminalScreen, MarkdownRenderer } = require('./renderer');
const { createLocalToolRegistry } = require('./tools');
const { PluginRegistry } = require('./plugins');
const { PermissionManager } = require('./permissions');
const { Session, InputHistory } = require('./session');
const { registerAgentTeamTools } = require('./teams/tools');
const { DynamicCommandRegistry } = require('./infrastructure/command-registry');
const { UndoStack } = require('./undo-stack');
const { debug } = require('./debug');

/**
 * Bootstrap a HaxAgent session with all wiring and lifecycle hooks.
 *
 * @param {Object} opts
 * @param {string[]}  [opts.args=[]]               CLI arguments (e.g. ['--yolo'])
 * @param {Object}    [opts.settings]               Merged settings object
 * @param {Function}  [opts.createTranslator]       Translator factory: (locale) => t(key, values)
 * @param {Object}    [opts.explicitSession=null]   Reuse an existing session (e.g. from resume)
 * @param {string}    [opts.root=process.cwd()]     Project root directory
 * @param {Function|null} [opts.createInputPipeline=null]       Input safety pipeline factory
 * @param {Function|null} [opts.createPluginManager=null]       Enhanced plugin manager factory
 * @param {Function|null} [opts._setupBackgroundTasks=null]     Background task initializer
 * @param {Function|null} [opts._teardownBackgroundTasks=null]  Background task teardown
 * @param {Function|null} [opts._shutdownManager=null]          Shutdown manager factory
 * @param {Object|null}   [opts._SHUTDOWN_PRIORITY=null]        Shutdown priority constants
 * @param {Function|null} [opts.setupKnowledgeManagement=null]  Knowledge management initializer
 * @returns {Promise<{
 *   settings: Object,
 *   provider: Object,
 *   screen: TerminalScreen,
 *   markdown: MarkdownRenderer,
 *   permissionManager: PermissionManager,
 *   toolRegistry: Object,
 *   session: Session,
 *   history: InputHistory,
 *   t: Function,
 *   pluginRegistry: PluginRegistry,
 *   pluginManager: Object|null,
 * }>}
 */
async function bootstrapSession({
  // ---- required ----
  args = [],
  settings,
  createTranslator,
  // ---- optional ----
  explicitSession = null,
  root = process.cwd(),
  // ---- infrastructure (passed by caller) ----
  createInputPipeline = null,
  createPluginManager = null,
  _setupBackgroundTasks = null,
  _teardownBackgroundTasks = null,
  _shutdownManager = null,
  _SHUTDOWN_PRIORITY = null,
  setupKnowledgeManagement = null,
}) {
  // ====================================================================
  // Block 1: Core setup — provider, screen, plugins, tools, session
  // ====================================================================

  const provider = explicitSession
    ? explicitSession.provider
    : createProvider(settings.agent, process.env);

  const screen = new TerminalScreen();
  const markdown = new MarkdownRenderer(screen.columns);

  const permissionManager = explicitSession
    ? explicitSession.permissionManager
    : new PermissionManager({
        mode: args.includes('--yolo')
          ? 'yolo'
          : (settings.permissions?.mode || 'normal'),
        locale: settings.ui?.locale,
        persistPath: path.join(root, '.hax-agent', 'permissions.json'),
      });

  // Create plugin registry (raw or enhanced via plugin-manager)
  let pluginRegistry;
  let pluginManager = null;
  if (createPluginManager) {
    pluginManager = createPluginManager({
      pluginsDir: path.join(os.homedir(), '.haxagent', 'plugins'),
      installDir: path.join(root, '.hax-agent', 'plugins'),
      autoValidate: true,
    });
    // Also scan project-level plugins
    pluginManager.scanDirectory(path.join(root, '.hax-agent', 'plugins'));
    pluginRegistry = pluginManager.registry;
  } else {
    pluginRegistry = new PluginRegistry();
    pluginRegistry.loadPluginsFromDirectory(
      path.join(os.homedir(), '.haxagent', 'plugins'),
    );
    pluginRegistry.loadPluginsFromDirectory(
      path.join(root, '.hax-agent', 'plugins'),
    );
  }

  const toolRegistry = createLocalToolRegistry({
    root,
    shellPolicy: settings.tools?.shell,
    permissionManager,
    undoStack: new UndoStack(),
    pluginRegistry,
  });
  registerAgentTeamTools(toolRegistry, { settings, projectRoot: root });

  const session = explicitSession || new Session({
    provider,
    settings,
    toolRegistry,
    permissionManager,
    pluginRegistry,
  });

  // ====================================================================
  // Block 2: Session wiring — commands, safety, plugins, events
  // ====================================================================

  // Initialize dynamic command registry and attach to session
  if (!session.commandRegistry) {
    session.commandRegistry = new DynamicCommandRegistry();
  }

  // Wire plugin manager into the session for /plugin commands
  if (pluginManager) {
    session.pluginManager = pluginManager;
  }

  // Wire safety pipeline into the session
  if (createInputPipeline) {
    try {
      session.inputPipeline = createInputPipeline({
        blockOnSeverity: settings.safety?.blockOnSeverity || 'CRITICAL',
        warnOnSeverity: settings.safety?.warnOnSeverity || 'HIGH',
        enableSafetyScan: settings.safety?.enableScanner !== false,
        maxInputLength: settings.safety?.maxInputLength || null,
      });
    } catch (_) {
      /* safety pipeline optional */
    }
  }

  // Fire onSessionStart plugin hooks
  pluginRegistry.runHook('onSessionStart', { session }).catch(() => {});
  permissionManager.locale = settings.ui?.locale;
  if (session.permissionManager) {
    session.permissionManager.locale = settings.ui?.locale;
  }

  // Wire EventBus into session — foundation for all event-driven modules
  if (!session.eventBus) {
    session.eventBus = new EventBus();
  }
  session.eventBus.emit('session:start', {
    sessionId: session.id,
    timestamp: new Date().toISOString(),
  });

  // ---- analytics: stats, anomaly detection, predictions ----
  try {
    const { setupAnalytics } = require('./infrastructure/analytics-setup');
    setupAnalytics(session, {
      anomalyAlerts: settings.analytics?.anomalyAlerts !== false,
      generateReportOnEnd: settings.analytics?.generateReportOnEnd === true,
    });
  } catch (_) {
    /* analytics optional */
  }

  // ---- background task scheduler ----
  if (_setupBackgroundTasks) {
    try {
      const tasks = _setupBackgroundTasks(session);
      session._bgTasks = tasks;
    } catch (_) {
      /* optional */
    }
  }

  // ---- knowledge accumulation & advanced memory ----
  if (setupKnowledgeManagement) {
    try {
      setupKnowledgeManagement(session);
    } catch (_) {
      /* optional */
    }
  }

  // ====================================================================
  // Block 3: Graceful shutdown hooks
  // ====================================================================

  if (_shutdownManager && _SHUTDOWN_PRIORITY) {
    try {
      const sm = _shutdownManager({ timeoutMs: 5_000 });

      // Hook: tear down background workers (lowest = runs first)
      sm.register(
        'bg-teardown',
        _SHUTDOWN_PRIORITY.SAVE_STATE,
        async ({ reason }) => {
          debug('shutdown', `bg-teardown reason=${reason}`);
          if (session._bgTasks && _teardownBackgroundTasks) {
            await _teardownBackgroundTasks(session);
            session._bgTasks = null;
          }
        },
      );

      // Hook: flush logs, save state
      sm.register('flush-logs', _SHUTDOWN_PRIORITY.CLOSE_STREAMS, () => {
        debug('shutdown', 'flush-logs');
        // Placeholder — real log flusher would go here
      });

      // Hook: release locks / close connections
      sm.register('release-locks', _SHUTDOWN_PRIORITY.RELEASE_LOCKS, () => {
        debug('shutdown', 'release-locks');
        // Placeholder — file lock / DB connection teardown
      });

      // Hook: fire session:end on EventBus
      sm.register('session-end', _SHUTDOWN_PRIORITY.NOTIFY, () => {
        if (session.eventBus) {
          try {
            session.eventBus.emit('session:end', {
              sessionId: session.id,
              timestamp: new Date().toISOString(),
            });
          } catch (_) {
            /* best-effort */
          }
        }
        if (session.pluginRegistry) {
          session.pluginRegistry
            .runHook('onSessionEnd', { session })
            .catch(() => {});
        }
      });

      // Hook: final debug ping
      sm.register('shutdown-log', _SHUTDOWN_PRIORITY.LOG, () => {
        debug('shutdown', 'graceful shutdown complete');
      });
    } catch (_) {
      /* optional */
    }
  }

  // ====================================================================
  // Block 4: Post-bootstrap — history, translator, transcript, TTY
  // ====================================================================

  const history = new InputHistory();
  const t = createTranslator
    ? (key, values) => createTranslator(session.settings?.ui?.locale)(key, values)
    : (key, values) => key;

  // New sessions start fresh. Use /resume to restore previous context.
  if (!screen.isTTY()) {
    session.permissionManager.mode = 'yolo';
  }

  return {
    settings,
    provider,
    screen,
    markdown,
    permissionManager,
    toolRegistry,
    session,
    history,
    t,
    pluginRegistry,
    pluginManager,
  };
}

module.exports = { bootstrapSession };
