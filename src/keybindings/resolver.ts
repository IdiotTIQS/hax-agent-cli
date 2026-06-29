/**
 * Keybinding resolver — resolves keypresses to actions.
 * Ported from OpenHarness keybindings/resolver.py
 */

import { loadKeybindings } from "./loader.js";
import { matchesBinding } from "./parser.js";

interface KeybindingResolverOptions {
  bindings?: Record<string, string>;
  configDir?: string;
}

class KeybindingResolver {
  _bindings: Record<string, string>;
  _actionHandlers: Record<string, (event: unknown) => void>;

  constructor(opts: KeybindingResolverOptions = {}) {
    this._bindings = opts.bindings || loadKeybindings(opts.configDir);
    this._actionHandlers = {};
  }

  /** Register an action handler. */
  on(action: string, handler: (event: unknown) => void): this { this._actionHandlers[action] = handler; return this; }

  /** Resolve a keypress event to an action. Returns null if no match. */
  resolve(event: unknown): string | null {
    for (const [keyExpr, action] of Object.entries(this._bindings)) {
      if (matchesBinding(event, keyExpr)) return action;
    }
    return null;
  }

  /** Handle a keypress event: resolve and execute handler. Returns true if handled. */
  handle(event: unknown): boolean {
    const action = this.resolve(event);
    if (!action) return false;
    const handler = this._actionHandlers[action];
    if (handler) { handler(event); return true; }
    return false;
  }

  /** Reload bindings from disk. */
  reload(configDir?: string): void { this._bindings = loadKeybindings(configDir); }

  /** Get all registered actions. */
  getActions(): string[] { return [...new Set(Object.values(this._bindings))]; }

  /** Update a single binding at runtime. */
  setBinding(keyExpr: string, action: string): void { this._bindings[keyExpr] = action; }
  removeBinding(keyExpr: string): void { delete this._bindings[keyExpr]; }
}

export { KeybindingResolver };
