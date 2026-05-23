# HaxAgent CLI — Developer Guide

## Project Overview

HaxAgent is a professional AI coding assistant with a Claude-like CLI experience. It supports multiple LLM providers (Anthropic, OpenAI, Google), agent teams, plugins, skills, session memory, and a desktop UI. The project is dual-purpose: an interactive terminal shell (`hax-agent`) and a programmatic library (`hax-agent-cli`).

- **Language:** Node.js (>= 18), JavaScript (CommonJS)
- **Entry point (CLI):** `src/cli.js` (bin: `hax-agent`)
- **Entry point (library):** `src/index.js` (main: `hax-agent-cli`)
- **Desktop UI:** Vue 3 + Electron under `desktop/`
- **Tests:** Node.js built-in test runner (`node --test`)
- **Dependencies:** `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `markdown-it`, `dompurify`

## Quick Start

```bash
# Install
npm install

# Run the CLI (interactive shell)
npm start

# Run all tests
npm test

# Run specific tests
node --test test/cli.test.js
node --test "test/**/config*.test.js"

# Lint
npm run lint

# Desktop development
npm run desktop:dev      # Start dev server
npm run desktop:build    # Build for production
```

## Architecture & Data Flow

```
User input (stdin)
  -> cli.js (main / runShell)           -- parse commands, manage readline
    -> commands/index.js                 -- route slash commands and chat messages
      -> agent-engine.js                 -- core agent loop: prompt construction, tool use, response streaming
        -> providers/                    -- LLM API calls (Anthropic, OpenAI, Google)
        -> tools/                        -- file I/O, shell, web fetch/search, stock quotes
        -> session.js                    -- conversation state, cost tracking, input history
    -> renderer.js                       -- terminal output: ANSI, Markdown, styled text, screen management
  -> stdout (rendered output)
```

**Key data flow for a user message:**
1. `cli.js` readline captures input -> slash command or chat message
2. `commands/index.js` routes to handler -> `handleChatMessage()`
3. `agent-engine.js` builds prompt (system + context + history + user message)
4. Provider sends prompt to LLM -> streams response tokens
5. Agent engine parses tool calls from response -> executes via `tools/`
6. Tool results fed back to provider -> loop until no more tool calls
7. `renderer.js` formats final output to terminal

## Directory Structure

| Directory | Purpose |
|-----------|---------|
| `src/` | All source code (CLI + library) |
| `src/cli.js` | CLI entry point: argument parsing, readline loop, top-level commands |
| `src/agent-engine.js` | Core agent loop: prompt assembly, tool-call dispatch, response streaming |
| `src/session.js` | Session state, message history, cost tracking, input history |
| `src/config.js` | Settings resolution (5 priority levels: defaults < user config < env < CLI flags < runtime) |
| `src/renderer.js` | Terminal rendering: ANSI codes, Markdown->terminal, screen buffer, themes |
| `src/commands/` | Slash command handlers (`/help`, `/model`, `/provider`, `/clear`, etc.) and autocomplete |
| `src/tools/` | Built-in tool implementations (file read/write/edit/delete/glob/search, shell, web, stock) |
| `src/providers/` | LLM provider adapters (Anthropic, OpenAI, Google, mock, fallback, streaming, token counting) |
| `src/i18n/` | Internationalization: translator factory, 4 language files (en, zh-CN, zh-TW, ru) |
| `src/skills/` | Skill system: loader, parser, intent matcher, usage stats, `/skillify` |
| `src/plugins/` | Plugin system: registry, hook names, validator |
| `src/teams/` | Agent team orchestration: agents, tools, planner, runtime, auth-refactor team |
| `src/memory/` | Session persistence: list, clear, CRUD |
| `src/permissions.js` | Tool permission modes: normal, yolo; approval callbacks |
| `src/hub.js` | High-level integration API (`createAgent()`) — wires all subsystems together |
| `src/batch.js` | Non-interactive batch mode (file input/output) |
| `src/undo-stack.js` | Undo/redo for file operations |
| `src/context-compaction.js` | Context window management and message compaction |
| `src/context-window.js` | Token counting and context window enforcement |
| `src/config-presets.js` | Named config presets (coding, autonomous, review, chat, ci, learn) |
| `src/init-wizard.js` | First-run setup wizard |
| `src/updater.js` | Version check and auto-update |
| `src/debug.js` | Debug logging utility |
| `src/observability/` | Logging, metrics, tracing |
| `src/security/` | Input sanitizer, audit log |
| `src/benchmark/` | Performance benchmarks |
| `src/cli-utils/` | CLI helpers: progress bars, tables, prompts |
| `src/formatters/` | Output formatters for agent teams and team plans |
| `desktop/` | Electron + Vue 3 desktop application |
| `test/` | Test suite (mirrors `src/` structure) |
| `scripts/` | Build and utility scripts |
| `examples/` | Example usage: batch, memory, plugins, workflows, hub API |

## Module Organization Principles

1. **Single responsibility per file.** Each module does one thing well — `agent-engine.js` runs the agent loop, `renderer.js` handles output, `session.js` manages state.
2. **Provider-agnostic core.** The agent engine and tools work with any provider. Provider-specific logic is isolated in `src/providers/`.
3. **Tools are self-describing.** Each tool exports a `create*Tool()` factory returning `{ name, description, parameters, execute }`. This schema is sent to the LLM for function calling.
4. **I18n is first-class.** All user-facing strings in the interactive shell use `t('key')` via `createTranslator()`. Translation files are in `src/i18n/`.
5. **Plugins hook into lifecycle events.** Plugins register hooks (`onSessionStart`, `onSessionEnd`, `onToolCall`, `onResponse`) without modifying core code.
6. **Error codes are standardized.** Tool errors use `ToolExecutionError` with 35 categorized error codes from `src/tools/error-codes.js`.

## How to Add a New Feature

### Add a Slash Command

1. Add an i18n key (e.g., `'cmd.mycommand'`) to `src/i18n/en.js` and `src/i18n/zh-CN.js`.
2. Add a handler name to `src/commands/definitions.js` (or anywhere `handleSlashCommand` dispatches).
3. Implement the handler in `src/commands/index.js` (or a new file in `src/commands/`).
4. The handler receives `{ screen, session, markdown, args }` — use `screen.write()` for output.

### Add a Tool

1. Create `src/tools/my-tool.js` with a `createMyTool({ root, settings })` factory.
2. The factory returns `{ name, description, parameters: { type: 'object', properties: {...}, required: [...] }, execute: async (args, context) => {...} }`.
3. Register the tool:
   - For the CLI shell: add to `_buildBuiltinTools()` in `src/hub.js` or `createLocalToolRegistry()` in `src/tools/index.js`.
   - For the library: the hub API auto-discovers built-in tools.
4. Add tests in `test/tools/my-tool.test.js`.

### Add a Plugin

1. Create a plugin object with `{ name, version, hooks: { onSessionStart, onToolCall, ... } }`.
2. Place it in `~/.haxagent/plugins/` or `<project>/.hax-agent/plugins/`.
3. Plugins are auto-discovered by `PluginRegistry` on startup.
4. Available hooks: see `PLUGIN_HOOK_NAMES` in `src/plugins.js`.

### Add a Skill

1. Create a `SKILL.md` file with YAML frontmatter (`name`, `description`, `triggers`) and markdown body.
2. Place it in `~/.haxagent/skills/` or `<project>/.hax-agent/skills/`.
3. Skills are auto-loaded. Use `/skillify` to capture a session as a skill.

### Add a Provider

1. Create `src/providers/my-provider.js` implementing the provider interface.
2. Register it in `src/providers/factory.js` under `createProvider()`.
3. Add config keys if needed.

## Coding Conventions

- **Language:** JavaScript (CommonJS `require`/`module.exports`), strict mode.
- **Formatting:** 2-space indentation, semicolons.
- **Naming:** camelCase for functions/variables, PascalCase for classes/constructors, UPPER_SNAKE for constants.
- **Error handling:** Use try/catch for async operations. Tool errors use `ToolExecutionError(code, message, details)`. Provider errors should be normalized.
- **I18n:** All user-facing strings in CLI output use `t('namespace.key', { vars })`. Keys are lowercase dot-separated (e.g., `'shell.contextCleared'`).
- **JSDoc:** Document public APIs with `@param`, `@returns`, `@throws`. Explain WHY, not WHAT.
- **Imports:** Group in order: Node built-ins, npm packages, local modules. Use destructuring for named imports.

## Testing Conventions

- **Framework:** Node.js built-in test runner (`node --test`).
- **File naming:** `test/<module>.test.js` mirrors `src/<module>.js`. Subdirectories match `src/` structure.
- **Test structure:** Use `describe`/`it` blocks. Keep tests focused on one behavior.
- **Run all tests:** `npm test`
- **Run specific tests:** `node --test test/cli.test.js` or `node --test "test/**/config*.test.js"`
- **Test the public API:** `public-api.test.js` validates the library exports from `src/index.js`.
- **Edge case tests:** Files like `config-edge-cases.test.js` cover boundary conditions.

## Key Design Patterns

1. **Factory Functions:** Tools, providers, and sessions are created via factory functions (not direct `new` calls), enabling dependency injection and testability.
2. **Event/Stream Pattern:** The agent engine uses async generators and event emitters for streaming LLM responses, allowing incremental rendering.
3. **Plugin Hooks (Observer Pattern):** Plugins register callbacks on lifecycle hooks (`onSessionStart`, `onToolCall`, `onResponse`, `onSessionEnd`). The core calls `pluginRegistry.runHook()` at each lifecycle point.
4. **Strategy Pattern:** Provider adapters implement a common interface so the agent engine is provider-agnostic.
5. **Undo Stack (Command Pattern):** File operations push undo entries onto an `UndoStack`, enabling `/undo` and `/redo` in the interactive shell.
6. **Composite Config Resolution:** Settings merge from 5 priority levels (defaults -> user config file -> environment variables -> CLI flags -> runtime overrides), with each level overriding the previous.
7. **Soft Dependency Loading:** `src/hub.js` uses `try/catch` require wrappers so subsystems can fail independently without crashing the entire agent.
8. **Translator (I18n):** A single `createTranslator(locale)` factory returns a `t(key, vars)` function. `zh-TW` inherits from `zh-CN` via spread, `ru` from `en`, minimizing duplication.

## Common Development Tasks

```bash
# After editing config.js, run:
node --test test/config/test/config*.test.js test/config-edge-cases.test.js

# After editing a tool, run:
node --test test/tools/<tool-name>.test.js

# After editing CLI commands, run:
node --test test/cli-commands.test.js test/cli.test.js

# After editing the agent engine, run:
node --test test/agent-engine.test.js

# Full test suite before pushing:
npm test
```
