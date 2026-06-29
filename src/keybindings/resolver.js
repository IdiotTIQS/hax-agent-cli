/**
 * Keybinding resolver — resolves keypresses to actions.
 * Ported from OpenHarness keybindings/resolver.py
 */

import { loadKeybindings } from "./loader.js";
import { matchesBinding } from "./parser.js";

class KeybindingResolver {
  constructor(opts = {}) {
    this._bindings = opts.bindings || loadKeybindings(opts.configDir);
    this._actionHandlers = {};
  }

  /** Register an action handler. */
  on(action, handler) { this._actionHandlers[action] = handler; return this; }

  /** Resolve a keypress event to an action. Returns null if no match. */
  resolve(event) {
    for (const [keyExpr, action] of Object.entries(this._bindings)) {
      if (matchesBinding(event, keyExpr)) return action;
    }
    return null;
  }

  /** Handle a keypress event: resolve and execute handler. Returns true if handled. */
  handle(event) {
    const action = this.resolve(event);
    if (!action) return false;
    const handler = this._actionHandlers[action];
    if (handler) { handler(event); return true; }
    return false;
  }

  /** Reload bindings from disk. */
  reload(configDir) { this._bindings = loadKeybindings(configDir); }

  /** Get all registered actions. */
  getActions() { return [...new Set(Object.values(this._bindings))]; }

  /** Update a single binding at runtime. */
  setBinding(keyExpr, action) { this._bindings[keyExpr] = action; }
  removeBinding(keyExpr) { delete this._bindings[keyExpr]; }
}

export { KeybindingResolver };
