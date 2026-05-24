"use strict";

const path = require('node:path');
const { debug } = require('./debug');

// ─── optional / soft dependencies (lazy-loaded) ──────────────────────
// These are loaded via try/catch so the hub works even when individual
// modules are not installed or have failing transitive imports.

let _cache = {};

function _requireSafe(id) {
  if (_cache[id] !== undefined) return _cache[id];
  try {
    _cache[id] = require(id);
  } catch (_) {
    _cache[id] = null;
  }
  return _cache[id];
}

function _mod(name) { return _requireSafe(`./${name}`); }

function _has(mod)  { return mod !== null; }

// ─── helpers ─────────────────────────────────────────────────────────

function _toBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  return fallback;
}

function _resolveRoot(root) {
  return path.resolve(root || process.cwd());
}

// ─── default discovery directories for plugins ──────────────────────

function _pluginDiscoveryDirs(root) {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return [
    path.join(home, '.haxagent', 'plugins'),
    path.join(root, '.hax-agent', 'plugins'),
  ];
}

// ─── createAgent ─────────────────────────────────────────────────────

/**
 * Create a fully configured agent with optional subsystems wired in.
 *
 * @param {object} [options]
 * @param {string} [options.root]             - Project root directory
 * @param {object} [options.settings]         - Merged Hax Agent settings
 * @param {object} [options.provider]         - LLM provider instance
 * @param {boolean} [options.enablePlugins=true]
 * @param {boolean} [options.enableUndo=true]
 * @param {boolean} [options.enableRateLimit=true]
 * @param {boolean} [options.enableRetry=true]
 * @param {boolean} [options.enableShutdown=true]
 * @param {boolean} [options.enableMemoryEviction=true]
 * @param {boolean} [options.enableGoalPersistence=true]
 * @param {boolean} [options.enableAutoCompact=true]
 * @param {object} [options.pluginDiscoveryDirs] - Override discovery dirs
 * @param {object} [options.shutdownOptions]     - Options for ShutdownManager
 * @param {object} [options.rateLimitOptions]    - Options for RateLimiter
 * @param {object} [options.retryOptions]        - Default options for makeToolRetryable
 * @param {object} [options.evictionOptions]     - Options for evictMemories
 * @param {object} [options.compactionOptions]   - Options for compactMessages
 * @returns {object} { agent, toolRegistry, session, undoStack, pluginRegistry, rateLimiter, shutdown, cleanup }
 */
function createAgent(options = {}) {
  const root = _resolveRoot(options.root);
  const settings = options.settings || {};
  const provider = options.provider || null;

  const enablePlugins = _toBool(options.enablePlugins, true);
  const enableUndo = _toBool(options.enableUndo, true);
  const enableRateLimit = _toBool(options.enableRateLimit, true);
  const enableRetry = _toBool(options.enableRetry, true);
  const enableShutdown = _toBool(options.enableShutdown, true);
  const enableMemoryEviction = _toBool(options.enableMemoryEviction, true);
  const enableGoalPersistence = _toBool(options.enableGoalPersistence, true);
  const enableAutoCompact = _toBool(options.enableAutoCompact, true);

  // ── 1. Validate configuration ──────────────────────────────────
  const configValidator = _mod('config-validator');
  if (_has(configValidator)) {
    try {
      configValidator.assertValidSettings(settings, { strict: false });
    } catch (err) {
      debug('hub', `Config validation: ${err.message}`);
      // Don't crash on config issues — caller should handle warnings.
    }
  }

  // ── 2. Plugin registry ─────────────────────────────────────────
  let pluginRegistry = null;
  if (enablePlugins) {
    const pluginsMod = _mod('plugins');
    if (_has(pluginsMod)) {
      pluginRegistry = new pluginsMod.PluginRegistry();
      const dirs = options.pluginDiscoveryDirs || _pluginDiscoveryDirs(root);
      for (const dir of dirs) {
        try {
          const count = pluginRegistry.loadPluginsFromDirectory(dir);
          if (count > 0) {
            debug('hub', `Loaded ${count} plugin(s) from ${dir}`);
          }
        } catch (err) {
          debug('hub', `Skipping plugin dir ${dir}: ${err.message}`);
        }
      }
    }
  }

  // ── 3. Undo stack ──────────────────────────────────────────────
  let undoStack = null;
  if (enableUndo) {
    const undoMod = _mod('undo-stack');
    if (_has(undoMod)) {
      undoStack = new undoMod.UndoStack(50);
    }
  }

  // ── 4. Rate limiter ────────────────────────────────────────────
  let rateLimiter = null;
  if (enableRateLimit) {
    const rlMod = _mod('rate-limiter');
    if (_has(rlMod)) {
      rateLimiter = new rlMod.CompositeRateLimiter(options.rateLimitOptions || {});
    }
  }

  // ── 5. Tool registry (wired with plugin hooks & undo stack) ────
  const toolsMod = _requireSafe('./tools/registry');
  const ToolRegistry = toolsMod ? toolsMod.ToolRegistry : null;
  let toolRegistry = null;

  if (ToolRegistry) {
    toolRegistry = new ToolRegistry({
      root,
      pluginRegistry,
      undoStack,
    });

    // Register built-in tools
    const builtinTools = _buildBuiltinTools(root, settings);
    for (const tool of builtinTools) {
      let wrapped = tool;

      // Apply retry wrapping
      if (enableRetry) {
        const retryMod = _mod('tool-retry');
        if (_has(retryMod)) {
          wrapped = retryMod.makeToolRetryable(wrapped, {
            maxRetries: 3,
            baseDelayMs: 500,
            ...(options.retryOptions || {}),
          });
        }
      }

      // Apply rate-limit wrapping
      if (enableRateLimit && rateLimiter) {
        wrapped = _wrapRateLimited(wrapped, rateLimiter);
      }

      toolRegistry.register(wrapped);
    }
  }

  // ── 6. Session ─────────────────────────────────────────────────
  const sessionMod = _requireSafe('./session');
  const Session = sessionMod ? sessionMod.Session : null;
  let session = null;

  if (Session) {
    session = new Session({
      provider,
      settings,
      toolRegistry,
      pluginRegistry,
    });
  }

  // ── 7. Agent engine ────────────────────────────────────────────
  const engineMod = _requireSafe('./agent-engine');
  const AgentEngine = engineMod ? engineMod.AgentEngine : null;
  let agent = null;

  if (AgentEngine && session) {
    agent = new AgentEngine({
      session,
      projectRoot: root,
    });
  }

  // ── 8. Memoty eviction check ───────────────────────────────────
  if (enableMemoryEviction) {
    const evictMod = _mod('memory-eviction');
    if (_has(evictMod)) {
      const status = evictMod.checkEvictionNeeded({ settings, maxItems: options.evictionOptions?.maxItems });
      if (status.needsEviction) {
        debug('hub', `Memory eviction needed: ${status.currentCount}/${status.maxItems}`);
        evictMod.evictMemories({ settings, maxItems: status.maxItems, strategy: options.evictionOptions?.strategy });
      }
    }
  }

  // ── 9. Goal persistence ────────────────────────────────────────
  if (enableGoalPersistence && session && session.id) {
    const goalMod = _mod('goal-persistence');
    if (_has(goalMod)) {
      try {
        const restored = goalMod.restoreGoal(session.id, { settings });
        if (restored) {
          session.goal = restored;
          debug('hub', `Restored goal for session ${session.id}: ${restored.text}`);
        }
      } catch (err) {
        debug('hub', `Goal restore failed: ${err.message}`);
      }
    }
  }

  // ── 10. Graceful shutdown ──────────────────────────────────────
  let shutdown = null;

  if (enableShutdown) {
    const sdMod = _mod('shutdown');
    if (_has(sdMod)) {
      shutdown = sdMod.getShutdownManager(options.shutdownOptions || {});

      // Register cleanup hooks in priority order
      // 0 = SAVE_STATE: persist the current goal before exit
      if (enableGoalPersistence && session && session.id) {
        const goalMod = _mod('goal-persistence');
        if (_has(goalMod)) {
          shutdown.register('hub:save-goal', sdMod.PRIORITY.SAVE_STATE, () => {
            if (session.goal) {
              goalMod.persistGoal(session.id, session.goal, { settings });
            }
          });
        }
      }

      // 10 = CLOSE_STREAMS: reset rate limiter, drain queues
      if (rateLimiter) {
        shutdown.register('hub:rate-limiter', sdMod.PRIORITY.CLOSE_STREAMS, () => {
          rateLimiter.drain();
          rateLimiter.reset();
        });
      }

      // 20 = RELEASE_LOCKS: detach shutdown manager itself
      shutdown.register('hub:detach', sdMod.PRIORITY.RELEASE_LOCKS, () => {
        shutdown.detach();
      });

      // Also persist goal on session end plugin hook
      if (pluginRegistry) {
        pluginRegistry.register({
          name: 'hub-goal-persistence',
          hooks: {
            onSessionEnd: async (ctx) => {
              if (enableGoalPersistence) {
                const goalMod = _mod('goal-persistence');
                if (_has(goalMod)) {
                  try {
                    goalMod.persistGoal(ctx.session?.id || session.id, session.goal, { settings });
                  } catch (err) {
                    debug('hub', `Goal persist on session end failed: ${err.message}`);
                  }
                }
              }
            },
          },
        });
      }
    }
  }

  // ── 11. Auto-compaction ────────────────────────────────────────
  let compactionApi = null;
  if (enableAutoCompact) {
    const compMod = _mod('context-compaction');
    if (_has(compMod)) {
      compactionApi = {
        compactMessages: compMod.compactMessages,
        buildCompactionPrompt: compMod.buildCompactionPrompt,
        buildCompactMessages: compMod.buildCompactMessages,
      };
    }
  }

  // ── return value ───────────────────────────────────────────────
  return {
    agent,
    toolRegistry,
    session,
    undoStack,
    pluginRegistry,
    rateLimiter,
    shutdown,
    compactionApi,
    cleanup: () => _cleanup({ shutdown, rateLimiter, pluginRegistry, undoStack, toolRegistry, session, enableGoalPersistence, enableShutdown, settings }),
  };
}

// ─── internal helpers ────────────────────────────────────────────────

/**
 * Build the default set of built-in tool definitions.
 */
function _buildBuiltinTools(root, settings) {
  const tools = [];
  const toolDefs = [
    { fn: './tools/file-read',    create: 'createReadFileTool' },
    { fn: './tools/file-write',   create: 'createWriteFileTool' },
    { fn: './tools/file-glob',    create: 'createGlobTool' },
    { fn: './tools/file-search',  create: 'createSearchTool' },
    { fn: './tools/shell',        create: 'createShellTool' },
    { fn: './tools/web-fetch',    create: 'createWebFetchTool' },
    { fn: './tools/web-search',   create: 'createWebSearchTool' },
    { fn: './tools/file-edit',    create: 'createFileEditTool' },
    { fn: './tools/file-readdir', create: 'createReadDirectoryTool' },
    { fn: './tools/file-delete',  create: 'createDeleteFileTool' },
    { fn: './tools/stock-quote',  create: 'createStockQuoteTool' },
    { fn: './tools/skill',        create: 'createSkillTool' },
    { fn: './tools/cli-test',     create: 'createCliTestTool' },
  ];

  for (const { fn, create } of toolDefs) {
    try {
      const mod = require(fn);
      if (typeof mod[create] === 'function') {
        const tool = mod[create]({ root, settings });
        if (tool && tool.name && typeof tool.execute === 'function') {
          tools.push(tool);
        }
      }
    } catch (_) {
      // Some tools may not be available (missing native deps, etc.)
    }
  }

  return tools;
}

/**
 * Wrap a tool's execute function with rate-limiting.
 */
function _wrapRateLimited(tool, rateLimiter) {
  const original = tool.execute;
  return {
    ...tool,
    execute: rateLimiter.wrap(original, { cost: 1 }),
  };
}

/**
 * Run full cleanup: drain, persist, detach.
 */
function _cleanup({ shutdown, rateLimiter, pluginRegistry, undoStack, toolRegistry, session, enableGoalPersistence, enableShutdown, settings }) {
  const errors = [];

  try {
    // Fire session end hooks
    if (pluginRegistry) {
      pluginRegistry.runHook('onSessionEnd', { session }).catch(() => {});
    }
  } catch (e) {
    errors.push(`session-hooks: ${e.message}`);
  }

  // Persist goal one last time
  try {
    if (enableGoalPersistence && session && session.id && session.goal) {
      const goalMod = _mod('goal-persistence');
      if (_has(goalMod)) {
        goalMod.persistGoal(session.id, session.goal, { settings });
      }
    }
  } catch (e) {
    errors.push(`goal-persist: ${e.message}`);
  }

  // Drain rate limiter
  try {
    if (rateLimiter) {
      rateLimiter.drain();
      rateLimiter.reset();
    }
  } catch (e) {
    errors.push(`rate-limiter: ${e.message}`);
  }

  // Clear undo stack
  try {
    if (undoStack) {
      undoStack.clear();
    }
  } catch (e) {
    errors.push(`undo-stack: ${e.message}`);
  }

  // Shutdown manager
  try {
    if (enableShutdown && shutdown) {
      shutdown.detach();
    }
  } catch (e) {
    errors.push(`shutdown: ${e.message}`);
  }

  return errors;
}

module.exports = { createAgent };
