# HaxAgent CLI — Developer Guide

## Project Overview

HaxAgent is a professional AI coding assistant with a Claude-like CLI experience. It supports 12+ LLM providers (Anthropic, OpenAI, DeepSeek, Groq, Mistral, Google, Moonshot, Zhipu, DashScope, Ollama, vLLM, OpenRouter), agent teams, plugins, skills, session memory, and a desktop UI. **Architecture: Fully refactored following the OpenHarness reference architecture and industry-grade standards.** Rebuilt from flat directory (~560 files) into layered modular design: `core/` (typed protocols) → `engine/` (agent runtime) → `api/`/`tools/`/`services/` (implementations). 229 OpenHarness Python modules ported to 144 consolidated JS modules with full feature parity.

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

# Lint
npm run lint

# Desktop development
npm run desktop:dev      # Start dev server
npm run desktop:build    # Build for production
```

## Architecture & Data Flow

```
User input (stdin)
  -> cli.js                                  -- parse commands, manage readline
    -> commands/registry.js                  -- route slash commands and chat messages
      -> engine/agent.js (AgentEngine)       -- core agent loop: prompt, tool use, streaming
        -> api/provider.js                   -- LLM API calls (12+ providers)
        -> engine/query.js (QueryContext)    -- state tracking, compaction, offloading
        -> core/permissions/checker.js       -- tool permission evaluation
      -> tui/index.js (TUI)                  -- terminal rendering
    -> stdout (rendered output)
```

**Key data flow for a user message:**
1. `cli.js` readline captures input -> slash command or chat message
2. `commands/registry.js` routes to handler -> `engine.sendMessage()`
3. `engine/agent.js` builds system prompt (skills + context + history) and runs tool loop
4. `api/provider.js` sends prompt to LLM -> streams response tokens
5. Agent engine parses tool calls from response -> executes via `tools/registry.js`
6. Tool results fed back to provider -> loop until no more tool calls
7. `tui/index.js` renders events to terminal

## Directory Structure

```
src/
├── index.js                    # Library entry — exports engine, tools, api, config, skills, memory, tui, commands
├── cli.js                      # CLI entry: argument parsing, readline loop, session wiring
├── api/
│   ├── provider.js             # 12+ provider clients (Anthropic, OpenAI, DeepSeek, Groq, Mistral, Google, Moonshot, Zhipu, DashScope, Ollama, vLLM, OpenRouter)
│   └── retry.js                # Retry logic with exponential backoff
├── commands/
│   ├── registry.js             # Slash command registry (~30 commands)
│   └── extended-commands.js    # Extended command set
├── config/
│   ├── settings.js             # Settings management (~/.haxagent/settings.json)
│   └── profiles.js             # Provider profiles (claude, gpt, sonnet, haiku, local, etc.)
├── core/                       # Foundation layer — typed, protocol-driven
│   ├── index.js                # Core module exports
│   ├── api/
│   │   ├── errors.js           # API error classification (CONTEXT_TOO_LONG, RATE_LIMITED, etc.)
│   │   └── provider-adapter.js # Provider adapter protocol (ApiStreamEvent types, ProviderAdapter base class)
│   ├── memory/
│   │   └── compaction.js       # Token estimation and compaction utilities
│   ├── messages/
│   │   └── types.js            # StandardMessage, ContentBlock types, stream events, token estimation
│   └── permissions/
│       └── checker.js          # PermissionChecker, PermissionMode, sensitive path patterns
├── engine/                     # Agent runtime
│   ├── agent.js                # AgentEngine, Session, HookExecutor, PermissionChecker, HookEvent
│   └── query.js                # QueryContext: task focus, file tracking, skill tracking, output offloading, tool context
├── hooks/
│   └── registry.js             # Hook registry for lifecycle events
├── memory/
│   ├── compact.js              # Message micro-compaction and token estimation
│   └── store.js                # Persistent memory store (CRUD, search)
├── plugins/
│   ├── installer.js            # Plugin installer
│   ├── registry.js             # Plugin auto-discovery and lifecycle hooks
│   └── schema.js               # Plugin manifest schema validation
├── prompts/
│   └── manager.js              # System prompt assembly and management
├── services/                   # Auxiliary services
│   ├── autodream.js            # AutoDream — automated goal continuation
│   ├── lsp.js                  # LSP-like code navigation (go-to-def, workspace search)
│   ├── mcp.js                  # MCP (Model Context Protocol) server integration
│   ├── memory-extract.js       # Memory extraction from conversation
│   ├── personalization.js      # Environment fact extraction and rules.md generation
│   └── session-memory.js       # Session memory persistence
├── shared/
│   ├── themes.js               # Terminal color themes
│   └── utils.js                # ANSI escape codes, styled() output helper, THEME constants
├── skills/
│   └── registry.js             # Skill auto-discovery, loading, and system prompt generation
├── tools/
│   ├── registry.js             # Tool registry: 10 built-in tools (file.*, shell.run, web.*)
│   ├── agent-tool.js           # Agent subprocess tool
│   ├── extended.js             # Extended tool set
│   ├── image-tools.js          # Image processing tools
│   ├── mcp-tools.js            # MCP tool integration
│   ├── plan-mode-tool.js       # Plan mode tool (EnterPlanMode/ExitPlanMode)
│   ├── send-message-tool.js    # Inter-agent message tool
│   └── worktree-tool.js        # Git worktree management tool
└── tui/
    └── index.js                # Terminal UI: alt-screen, event rendering, status bar, approval prompts

desktop/                         # Electron + Vue 3 desktop application
├── main/                       # Electron main process
├── preload/                    # Preload scripts
└── renderer/                   # Vue 3 frontend (Vite)
test/                           # Test suite
scripts/                        # Build, lint, and test scripts
docs/plans/                     # Architecture and design plans
```

## Core Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `api/provider.js` | Provider clients with unified streaming interface, provider registry (12+ providers) |
| `core/api/provider-adapter.js` | Typed provider adapter protocol: ApiStreamEvent types, AnthropicAdapter, OpenAIAdapter, factory |
| `core/messages/types.js` | StandardMessage class, ContentBlock discriminated union, token estimation, format conversion |
| `core/permissions/checker.js` | PermissionChecker with mode (normal/yolo/plan/fullauto), always-allow/deny sets, sensitive path detection |
| `engine/agent.js` | AgentEngine with async generator tool loop, Session, HookExecutor, HookEvent lifecycle |
| `engine/query.js` | QueryContext for state tracking: task focus, read files, skills, work log, verified work |
| `config/settings.js` | Settings load/save from `~/.haxagent/settings.json` with defaults merging |
| `config/profiles.js` | ProfileManager: built-in + custom provider profiles with switching |
| `commands/registry.js` | ~30 slash commands: help, model, provider, skills, goal, yolo, plan, perms, lsp, cost, export, etc. |
| `tools/registry.js` | ToolRegistry with 10 built-in tools, isReadOnly classification, path sandboxing |
| `tui/index.js` | Terminal UI with alt-screen buffer, event-driven rendering, approval prompts, status bar |
| `skills/registry.js` | Skill discovery from `.hax-agent/skills/`, system prompt generation |
| `services/lsp.js` | Code navigation: go-to-definition, workspace symbol search |
| `services/personalization.js` | Environment fact extraction, rules.md generation |
| `memory/store.js` | Persistent memory CRUD with search |
| `memory/compact.js` | Message compaction with token-aware truncation |

## Module Organization Principles

1. **Layered architecture.** `core/` (protocols, types) → `engine/` (runtime) → `api/`/`tools/`/`services/` (implementations). Dependencies flow downward.
2. **Provider-agnostic engine.** The AgentEngine works with any provider via the common streaming interface in `core/api/provider-adapter.js`.
3. **Tools are self-describing.** Each tool registers `{ name, description, inputSchema, execute, isReadOnly }`. The schema is sent to the LLM for function calling.
4. **Event-driven streaming.** The agent loop uses async generators yielding typed events (`message.delta`, `tool.start`, `tool.result`, `turn.completed`). The TUI consumes these events.
5. **Hooks for lifecycle extension.** HookExecutor supports: `session.start`, `session.end`, `pre.compact`, `post.compact`, `pre.tool_use`, `post.tool_use`, `user.prompt_submit`, `notification`, `stop`, `subagent.stop`.
6. **Permission modes.** Four modes: `normal` (ask), `yolo` (auto-approve all), `plan` (block mutating tools), `fullauto` (silent auto-approve). Plus per-tool always-allow/always-deny sets.

## How to Add a New Feature

### Add a Slash Command

1. In `src/commands/registry.js`, call `register("commandname", handler, "Description")`.
2. The handler receives `(args, ctx)` where `ctx` has `{ screen, session, rl, settings }`.
3. Use `ctx.screen.write()` for output and `ctx.rl.prompt()` to re-display the prompt.

### Add a Tool

1. Add the tool definition to the `tools` object in `src/tools/registry.js`:
   ```js
   "tool.name": {
     name: "tool.name", description: "...",
     inputSchema: { type: "object", required: [...], properties: {...} },
     async execute(args, ctx) { ... return { ok: true, data: {...} }; },
     isReadOnly: (args) => true/false,
   }
   ```
2. It will be auto-registered by `createDefaultRegistry()`.

### Add a Provider

1. Add an entry to the `REGISTRY` object in `src/api/provider.js`:
   ```js
   providername: { cls: BaseOpenAICompatible, envKey: "PROVIDER_API_KEY", url: "https://...", model: "...", name: "providername" }
   ```
2. For non-OpenAI-compatible APIs, create a new class implementing the `stream()` async generator method.

### Add a Plugin

1. Create a plugin directory with a manifest in `~/.haxagent/plugins/` or `<project>/.hax-agent/plugins/`.
2. Plugins register hooks on lifecycle events. See `HookEvent` in `engine/agent.js` for available events.

### Add a Skill

1. Create a `SKILL.md` file with YAML frontmatter (`name`, `description`, `triggers`) and markdown body.
2. Place it in `~/.haxagent/skills/<name>/` or `<project>/.hax-agent/skills/<name>/`.
3. Skills are auto-discovered by `loadSkillRegistry()`.

## Coding Conventions

- **Language:** JavaScript (CommonJS `require`/`module.exports`), strict mode.
- **Formatting:** 2-space indentation, semicolons.
- **Naming:** camelCase for functions/variables, PascalCase for classes/constructors, UPPER_SNAKE for constants.
- **Error handling:** Use try/catch for async operations. Tool errors return `{ ok: false, error: { code, message } }`.
- **JSDoc:** Document public APIs with `@param`, `@returns`, `@throws`. Explain WHY, not WHAT.
- **Imports:** Group in order: Node built-ins, npm packages, local modules. Use destructuring for named imports.

## Testing Conventions

- **Framework:** Node.js built-in test runner (`node --test`).
- **File naming:** `test/<module>.test.js` mirrors `src/<module>.js`.
- **Run all tests:** `npm test`
- **Run specific tests:** `node --test test/cli.test.js` or `node --test "test/**/config*.test.js"`

## Key Design Patterns

1. **Layered Architecture:** `core/` (types, protocols) → `engine/` (runtime) → `api/`/`tools/`/`services/` (implementations). Each layer only depends on the layer below.
2. **Async Generator Streaming:** AgentEngine uses `async *sendMessage()` yielding typed events consumed by the TUI for incremental rendering.
3. **Hook System (Observer Pattern):** HookExecutor dispatches lifecycle events to registered handlers with fnmatch-style tool name matching.
4. **Strategy Pattern:** Provider adapters implement a common streaming interface so the engine is provider-agnostic.
5. **Factory Functions:** `createProvider()`, `createDefaultRegistry()`, `loadSkillRegistry()` — dependency injection without DI frameworks.
6. **Composite Config:** Settings merge defaults → user config file → environment variables → runtime overrides.
7. **QueryContext (State Tracking):** A single context object tracks task focus, read files, invoked skills, work log, and verified work across a query.
8. **Tool Output Offloading:** Large tool outputs (>8000 chars) are written to disk files with inline previews to avoid context bloat.

## Common Development Tasks

```bash
# After editing the agent engine:
node --test test/agent-engine.test.js

# After editing a tool in tools/registry.js:
node --test test/tools/

# After editing CLI commands:
node --test test/cli.test.js test/cli-commands.test.js

# After editing the provider layer:
node --test test/providers/

# Full test suite before pushing:
npm test
```
