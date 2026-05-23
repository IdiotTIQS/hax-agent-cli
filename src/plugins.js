"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { debug } = require('./debug');

const PLUGIN_HOOK_NAMES = [
  'beforeToolCall',
  'afterToolCall',
  'onError',
  'beforeChat',
  'afterChat',
  'onSessionStart',
  'onSessionEnd',
];

/**
 * Simple plugin/hook system for Hax Agent.
 *
 * Plugins are JS modules that export an object with:
 *   - name: string (required)
 *   - version: string (optional)
 *   - hooks: { [hookName]: (context) => context | Promise<context> }
 *
 * Plugins are loaded from:
 *   1. ~/.haxagent/plugins/*.js (user-level)
 *   2. .hax-agent/plugins/*.js (project-level)
 *   3. Programmatic registration via PluginRegistry.register()
 *
 * Hooks:
 *   beforeToolCall(ctx)  — called before a tool executes; ctx = { toolName, args, session }
 *   afterToolCall(ctx)   — called after a tool completes; ctx = { toolName, args, result, session }
 *   onError(ctx)         — called on errors; ctx = { error, toolName, session }
 *   beforeChat(ctx)      — called before sending a chat message; ctx = { message, session }
 *   afterChat(ctx)       — called after receiving a response; ctx = { message, response, session }
 *   onSessionStart(ctx)  — called when session starts; ctx = { session }
 *   onSessionEnd(ctx)    — called when session ends; ctx = { session }
 */
class PluginRegistry {
  constructor() {
    this._plugins = [];
    this._hooks = new Map();
    for (const name of PLUGIN_HOOK_NAMES) {
      this._hooks.set(name, []);
    }
  }

  /**
   * Register a plugin object directly.
   */
  register(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Plugin must be an object');
    }
    if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
      throw new Error('Plugin must have a non-empty name');
    }

    // Prevent duplicates by name
    if (this._plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    const entry = {
      name: plugin.name,
      version: plugin.version || '0.0.0',
      hooks: {},
    };

    if (plugin.hooks && typeof plugin.hooks === 'object') {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        if (PLUGIN_HOOK_NAMES.includes(hookName) && typeof hookFn === 'function') {
          entry.hooks[hookName] = hookFn;
          this._hooks.get(hookName).push({ plugin: entry.name, fn: hookFn });
        }
      }
    }

    this._plugins.push(entry);
    return entry;
  }

  /**
   * Load a plugin from a file path.
   *
   * SECURITY CONSIDERATION: This method uses `require()` to load the plugin
   * module, which executes arbitrary code with the full privileges of the
   * HaxAgent process. Plugins are loaded from `~/.haxagent/plugins/` and
   * `.hax-agent/plugins/` directories. Only install plugins from trusted
   * sources. A malicious plugin file can access environment variables
   * (including API keys), the file system, and the network.
   */
  loadPlugin(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Plugin file not found: ${resolved}`);
    }

    // Clear require cache for hot-reloadability
    delete require.cache[require.resolve(resolved)];
    const plugin = require(resolved);
    return this.register(plugin);
  }

  /**
   * Auto-discover plugins from a directory.
   */
  loadPluginsFromDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) return 0;
    const entries = fs.readdirSync(directoryPath);
    let count = 0;

    for (const entry of entries) {
      if (entry.endsWith('.js')) {
        try {
          this.loadPlugin(path.join(directoryPath, entry));
          count += 1;
        } catch (err) {
          debug('plugins', `Failed to load plugin ${entry}: ${err.message}`);
        }
      }
    }

    return count;
  }

  /**
   * Run all registered handlers for a hook. Returns the (possibly modified) context.
   * Handlers are called sequentially in registration order.
   * If a handler returns undefined/null, the context is passed through unchanged.
   */
  async runHook(hookName, context = {}) {
    const handlers = this._hooks.get(hookName);
    if (!handlers || handlers.length === 0) return context;

    let ctx = { ...context };

    for (const { plugin, fn } of handlers) {
      try {
        const result = await fn(ctx);
        if (result !== undefined && result !== null) {
          ctx = result;
        }
      } catch (error) {
        // Hook errors shouldn't crash the application
        // Fire onError hook if it's not already the error hook
        if (hookName !== 'onError') {
          await this.runHook('onError', {
            error,
            pluginName: plugin,
            hookName,
            session: context.session,
          });
        }
      }
    }

    return ctx;
  }

  /**
   * Remove a plugin by name.
   */
  unregister(pluginName) {
    const index = this._plugins.findIndex((p) => p.name === pluginName);
    if (index === -1) return false;

    this._plugins.splice(index, 1);

    for (const [hookName, handlers] of this._hooks) {
      this._hooks.set(
        hookName,
        handlers.filter((h) => h.plugin !== pluginName),
      );
    }

    return true;
  }

  list() {
    return this._plugins.map((p) => ({
      name: p.name,
      version: p.version,
      hooks: Object.keys(p.hooks),
    }));
  }

  getHookCount() {
    let count = 0;
    for (const handlers of this._hooks.values()) {
      count += handlers.length;
    }
    return count;
  }
}

module.exports = { PluginRegistry, PLUGIN_HOOK_NAMES };
