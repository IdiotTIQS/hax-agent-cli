# HaxAgent Plugins

Plugins let you extend HaxAgent's behavior by hooking into its lifecycle.
Each plugin is a **CommonJS module** that exports an object describing which
events it cares about and what to do when those events fire.

## Quick start

1. Write your plugin as a `.js` file (see examples below).
2. Copy the file into `.hax-agent/plugins/` at the root of your project.
3. Restart the agent — plugins are auto-discovered on startup.

You can also register plugins programmatically:

```js
const { PluginRegistry } = require('./src/plugins');
const registry = new PluginRegistry();

// Option A — direct object
registry.register(require('./my-plugin'));

// Option B — using the convenience `register()` helper some plugins export
require('./my-plugin').register(registry);

// Option C — load from a directory
registry.loadPluginsFromDirectory('./my-plugins/');
```

## Plugin shape

A plugin is a plain object:

```js
module.exports = {
  name: "my-plugin",          // required, non-empty string, unique
  version: "1.0.0",           // optional, semver-ish string

  hooks: {
    beforeToolCall(ctx) { /* … */ },
    afterToolCall(ctx)  { /* … */ },
    onError(ctx)        { /* … */ },
    beforeChat(ctx)     { /* … */ },
    afterChat(ctx)      { /* … */ },
    onSessionStart(ctx) { /* … */ },
    onSessionEnd(ctx)   { /* … */ },
  },
};
```

- `name` — Must be unique across all registered plugins. Duplicate names
  cause `PluginRegistry.register()` to throw.
- `version` — Informational; not enforced.
- `hooks` — An object whose keys are hook names and values are functions.
  Unknown keys are silently ignored.

## Lifecycle hooks

All hooks receive a **context object** (`ctx`). Handlers may mutate the
context and return the modified version. If a handler returns `undefined`
or `null`, the previous context is passed through unchanged.

Hooks run **sequentially** in plugin-registration order. If a hook throws,
the error is caught by the registry and — unless the hook was `onError`
itself — routed to the `onError` hook so it can be logged without crashing
the agent.

### `onSessionStart(ctx)`

Fires when a new agent session begins.

| Field     | Type | Description |
|-----------|------|-------------|
| `session` | object | Session metadata (may include `id`, `cwd`) |

### `onSessionEnd(ctx)`

Fires when the session ends (cleanup, shutdown).

| Field     | Type | Description |
|-----------|------|-------------|
| `session` | object | Session metadata |

### `beforeChat(ctx)`

Fires before a chat message is sent to the LLM.

| Field     | Type   | Description |
|-----------|--------|-------------|
| `message` | any    | The outbound message |
| `session` | object | Session metadata |

### `afterChat(ctx)`

Fires after a response is received from the LLM.

| Field      | Type   | Description |
|------------|--------|-------------|
| `message`  | any    | The original outbound message |
| `response` | any    | The LLM response |
| `session`  | object | Session metadata |

### `beforeToolCall(ctx)`

Fires **before** a tool executes. Throw inside this hook to block the call.

| Field      | Type   | Description |
|------------|--------|-------------|
| `toolName` | string | e.g. `"file.write"`, `"shell.run"` |
| `args`     | object | Arguments passed to the tool |
| `session`  | object | Session metadata |

### `afterToolCall(ctx)`

Fires **after** a tool has finished (success or failure).

| Field      | Type   | Description |
|------------|--------|-------------|
| `toolName` | string | Tool name |
| `args`     | object | Original arguments |
| `result`   | object | Serialized result `{ ok, data, error, durationMs }` |
| `session`  | object | Session metadata |

### `onError(ctx)`

Fires when an error occurs — either a thrown hook error or a tool failure.

| Field        | Type   | Description |
|--------------|--------|-------------|
| `error`      | Error  | The error that was thrown |
| `toolName`   | string | Tool name (if applicable) |
| `pluginName` | string | Plugin that threw (if it was a hook error) |
| `hookName`   | string | Hook that threw (if it was a hook error) |
| `session`    | object | Session metadata |

## Built-in tool names

| Tool name            | Description |
|----------------------|-------------|
| `file.read`          | Read a file |
| `file.write`         | Write / overwrite a file |
| `file.edit`          | Search-and-replace within a file |
| `file.delete`        | Delete or trash a file |
| `file.readDirectory` | List directory contents |
| `file.glob`          | Find files by glob pattern |
| `file.search`        | Search file contents (ripgrep) |
| `shell.run`          | Execute a shell command |
| `web.fetch`          | Fetch a URL |
| `web.search`         | Web search |
| `stock.quote`        | Stock quote lookup |

All file-operation tools accept a `path` argument (string, relative to the
project root or absolute).

## Example plugins in this directory

| File | Description |
|------|-------------|
| `logger-plugin.js` | Logs every lifecycle event to `.hax-agent/logs/plugin.log` |
| `rate-limit-plugin.js` | Token-bucket rate limiter — caps tool calls per minute |
| `file-backup-plugin.js` | Backs up files before write/edit/delete to `.hax-agent/backups/` |

## Writing your own plugin

1. Create a `.js` file with `"use strict"` at the top.
2. Export an object with `name`, optional `version`, and a `hooks` map.
3. For each hook you care about, write an async-compatible function that
   receives `ctx`, optionally mutates it, and returns it.
4. If you need state, use module-level closures — the module is loaded once
   and cached.
5. Never let your hook crash: the registry catches errors, but unhandled
   rejections or synchronous throws outside the hook chain will bubble up.

### Tips

- Use `beforeToolCall` to **validate, modify, or block** tool calls.
- Use `afterToolCall` to **audit or post-process** results.
- Use `onError` for **alerting, logging, or metrics**.
- Store the plugin file in `.hax-agent/plugins/` for auto-discovery.
- Add `module.exports.register = function(registry) { … }` for a
  programmatic convenience API — not required, but nice for users.
