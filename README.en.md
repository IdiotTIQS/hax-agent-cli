# Hax Agent

> Lightweight, Claude-like local agent tooling with CLI as the primary entry point and an Electron + Vue desktop app · Developed by [IdiotTIQS](https://github.com/IdiotTIQS)

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)](#development--contributing)
[![npm](https://img.shields.io/npm/v/hax-agent-cli)](https://www.npmjs.com/package/hax-agent-cli)

Hax Agent is an AI coding assistant for developers, with CLI as the primary entry point and an Electron + Vue desktop app alongside it. It supports 12+ AI providers (Anthropic, OpenAI, DeepSeek, Groq, Mistral, Google, Moonshot, Zhipu, DashScope, Ollama, vLLM, OpenRouter), interactive chat, provider profile switching, local file tools, session memory management, LSP code navigation, terminal themes, and hook lifecycle extension.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Desktop App](#desktop-app)
- [Usage](#usage)
- [Interactive Commands](#interactive-commands)
- [Skills System](#skills-system)
- [Configuration](#configuration)
- [Local Tools](#local-tools)
- [Architecture Overview](#architecture-overview)
- [Sessions & Memory](#sessions--memory)
- [Provider Profiles](#provider-profiles)
- [Development & Testing](#development--testing)
- [License](#license)

---

## Features

- **Interactive Agent Shell** — Enters chat mode by default, supporting continuous contextual conversations, slash commands, and streaming output.
- **Desktop GUI** — Electron + Vue interface that keeps the CLI workflow intact while adding session lists, file tree browsing, a right-side status panel, and session recovery.
- **Multi-Provider Support** — Built-in 12+ providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, Groq, Mistral, Moonshot, Zhipu, DashScope, Ollama, vLLM, OpenRouter.
- **Provider Profiles** — Pre-configured profiles (claude, gpt, sonnet, haiku, gpt-mini, local) with custom profile support and one-command switching.
- **Model Management** — View available models and switch models at runtime.
- **Local Toolset** — File read/write, search, glob matching, and permission-gated shell command execution.
- **Skills System** — Create, manage, and invoke reusable skills by packaging repetitive workflows into SKILL.md files.
- **Hook Lifecycle** — 10 lifecycle hooks (session.start/end, pre/post.compact, pre/post.tool_use, etc.) for plugins and script extension.
- **LSP Code Navigation** — Built-in `/lsp` command for go-to-definition and workspace symbol search.
- **Terminal Themes** — Multiple color themes switchable via `/theme` command.
- **Session Memory** — Automatically saves conversation transcripts; new sessions automatically load recent context.
- **Layered Configuration** — Multi-level config merging with independent provider profile management.
- **Cost Tracking** — Token usage and cost estimation statistics.
- **Permission Management** — Four modes: normal (ask), yolo (auto-approve all), plan (block writes), fullauto (silent auto-approve).

---

## Prerequisites

- **Node.js** >= 18
- **npm** (or pnpm / yarn)
- **API Key** (at least one provider)

---

## Quick Start

### 1. Installation

```bash
# Install from npm
npm install -g hax-agent-cli

# Or install from source
git clone https://github.com/IdiotTIQS/hax-agent-cli.git
cd hax-agent-cli
npm install
```

### 2. Start the Interactive Shell

```bash
hax-agent
# or
npm start
```

On first launch, configure your API keys:

```text
/api-key anthropic sk-ant-xxxxxxxxxxxx
/api-key openai sk-xxxxxxxxxxxx
```

Or use pre-configured provider profiles:

```text
/provider claude        # Switch to Anthropic Claude
/provider gpt           # Switch to OpenAI GPT
/provider local         # Switch to local Ollama
/provider list          # List all available profiles
```

### 3. Configure Provider

Set up within the Shell at runtime:

```text
/provider anthropic     # Switch to Anthropic
/provider openai        # Switch to OpenAI
/provider deepseek      # Switch to DeepSeek
/model claude-sonnet-4-20250514
/api-url https://api.anthropic.com
/api-key anthropic sk-ant-xxxxxxxxxxxx
```

Or pre-configure via environment variables (see [Configuration](#configuration)).

## Desktop App

The desktop app shares the same configuration, session storage, and tool layer as the CLI.

### Start the dev build

```bash
npm run desktop:dev
```

### Build the desktop app

```bash
npm run desktop:build
```

---

## Usage

```bash
# Start interactive chat (default)
hax-agent
hax-agent chat

# View help and version
hax-agent help
hax-agent -v

# List available models for the current provider
hax-agent models

# Run diagnostics (script-friendly)
hax-agent doctor --json

# List and resume sessions
hax-agent sessions
hax-agent resume <session-id>

# View or edit configuration
hax-agent config
hax-agent config edit

# Other options
hax-agent --no-color    # Disable ANSI color output
hax-agent --debug       # Enable verbose debug logging

# Use globally after linking
npm link
hax-agent               # Available from any directory
```

### Built-in npm Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the CLI (`node src/cli.js`) |
| `npm run desktop:dev` | Start the Electron + Vue desktop app in development mode |
| `npm run desktop:build` | Build the desktop frontend assets |
| `npm run desktop:start` | Start the Electron desktop app directly |
| `npm run lint` | Run syntax checks for JS files |
| `npm test` | Run the test suite |
| `npm run test:desktop` | Build desktop and run desktop tests |

---

## Interactive Commands

Type the following slash commands in the Shell:

| Command | Description |
|---------|-------------|
| `/help` | View all available commands |
| `/exit` or `/quit` | Exit the Shell |
| `/clear` | Clear the current context and start a new session |
| `/compact` | Compact the current conversation to reduce context usage |
| `/tools` | List available local tools |
| `/skills` | List available skills |
| `/goal [--max n] <goal>` | Set a persistent goal until complete, blocked, or `/goal clear` |
| `/models` | List available models for the current provider |
| `/model <id>` | Switch models |
| `/provider <name>` | Switch provider profile (`list` to see all) |
| `/providers` | List all available AI providers |
| `/api-url <base-url>` | Set or view the API Base URL |
| `/api-key <provider> <key>` | Set API Key for a provider |
| `/cost` | View token usage and cost for this session |
| `/status` | Show session summary (model, cost, tokens) |
| `/context` | View context window usage |
| `/config` | Show current configuration |
| `/copy` | Copy last AI response to clipboard |
| `/export` | Export session to JSON file |
| `/doctor` | Run diagnostics |
| `/theme <name>` | Switch terminal color theme (`list` to see all) |
| `/yolo` | Toggle YOLO mode (auto-approve all tools) |
| `/plan` | Toggle Plan mode (block all mutating tools) |
| `/fullauto` | Toggle Full Auto mode (silent auto-approve) |
| `/perms` | Show permission status |
| `/permissions [allow\|deny\|reset\|yolo\|normal] [tool]` | Manage tool permissions |
| `/allow <tool>` | Always allow a tool |
| `/deny <tool>` | Always deny a tool |
| `/memory [search\|list]` | Manage persistent memories |
| `/lsp def <symbol>` | Go to symbol definition |
| `/lsp search <query>` | Search workspace symbols |
| `/personalize` | Extract environment rules from conversation to rules.md |
| `/init` | Initialize .hax-agent project directory |
| `/version` | Show version info |

---

## Skills System

Skills are reusable workflow packages that allow you to save repetitive task processes as SKILL.md files and quickly invoke them in later sessions via slash commands.

### Skills Directory Structure

Skills are stored in the following locations:

```text
~/.hax-agent/skills/          # User-level skills (available across projects)
├── code-review/
│   └── SKILL.md
└── deploy-workflow/
    └── SKILL.md

.hax-agent/skills/            # Project-level skills (available only in the current project)
├── run-tests/
│   └── SKILL.md
└── ...
```

Each skill is a directory containing a `SKILL.md` file.

### SKILL.md Format

```markdown
---
name: my-skill
description: One-line description of what this skill does
allowed-tools:
  - file.read
  - file.write
  - shell.run
when_to_use: Describes when to automatically invoke this skill. Start with "Use when...".
argument-hint: "[arg1] [arg2]"
arguments:
  - arg1
  - arg2
---

# Skill Title

Detailed description of this skill's workflow.

## Inputs
- `$arg1`: Description of this input

## Goal
Clearly state the goal of this workflow.

## Steps

### 1. Step Name
What to do in this step. Be specific and actionable.

**Success criteria**: Always include! This indicates the step is complete and you can move on.
```

### Invoking Skills

In the Shell, simply type the skill name as a slash command:

```text
/code-review                    # Invoke the code review skill
/code-review src/index.js       # Invoke with arguments
/skills                         # List all available skills
```

---

## Configuration

### Configuration Priority

1. **Default Configuration** — Built into `src/config/settings.js`
2. **User Configuration** — `~/.hax-agent/settings.json`
3. **Environment Variables** — All `HAX_AGENT_*` prefixed variables

> It is recommended not to commit configuration containing API keys to version control. Use environment variables or user configuration instead.

### Supported Providers

| Provider | Aliases | Default Model | Environment Variables |
|----------|---------|---------------|----------------------|
| **Anthropic** | `anthropic`, `claude` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `openai`, `gpt` | `gpt-4o` | `OPENAI_API_KEY` |
| **DeepSeek** | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| **Groq** | `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| **Mistral** | `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` |
| **Google** | `google`, `gemini` | `gemini-2.5-pro` | `GOOGLE_API_KEY` |
| **Moonshot** | `moonshot` | `moonshot-v1-8k` | `MOONSHOT_API_KEY` |
| **Zhipu** | `zhipu` | `glm-4-plus` | `ZHIPUAI_API_KEY` |
| **DashScope** | `dashscope` | `qwen-max` | `DASHSCOPE_API_KEY` |
| **OpenRouter** | `openrouter` | `anthropic/claude-sonnet-4` | `OPENROUTER_API_KEY` |
| **Ollama** | `ollama` | `llama3.2` | — (local) |
| **vLLM** | `vllm` | — | — (local) |

### Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HAX_AGENT_PROVIDER` | Provider name | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | — |
| `GROQ_API_KEY` | Groq API Key | — |
| `MISTRAL_API_KEY` | Mistral API Key | — |
| `GOOGLE_API_KEY` | Google API Key | — |
| `HAX_AGENT_MODEL` | Model ID | — |
| `HAX_AGENT_MAX_TURNS` | Maximum conversation turns | `25` |
| `HAX_AGENT_API_URL` | API Base URL | — |
| `HAX_AGENT_PERMISSIONS_MODE` | Default permission mode | `normal` |
| `HAX_AGENT_SHELL_ENABLED` | Enable shell tool | `true` |

### Configuration File Example

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTurns": 25
  },
  "permissions": {
    "mode": "normal"
  },
  "tools": {
    "shell": {
      "enabled": true
    }
  },
  "ui": {
    "locale": "en",
    "autoClearScreen": true
  },
  "context": {
    "compactionEnabled": false,
    "compactionThreshold": 0.85
  }
}
```

---

## Local Tools

The Agent Shell includes a restricted tool registry, with all file operations confined to the workspace root to prevent path traversal attacks.

| Tool | Description | Security Restriction |
|------|-------------|---------------------|
| `file.read` | Read text files within the workspace | Path restricted to workspace root |
| `file.write` | Write text files within the workspace | Path restricted to workspace root |
| `file.edit` | Precisely replace text in files | Path restricted to workspace root |
| `file.delete` | Delete files (moves to trash by default) | Path restricted to workspace root |
| `file.glob` | List files matching a glob pattern | Path restricted to workspace root |
| `file.search` | Search for content in text files | Supports regex / case sensitivity config |
| `file.readDirectory` | List directory contents | Path restricted to workspace root |
| `shell.run` | Execute local commands | Permission prompt decides in non-yolo mode |
| `web.fetch` | Fetch web pages and convert to plain text | URL fetching |
| `web.search` | Search the web for information | Requires search API config |

---

## Architecture Overview

```
src/
├── index.js                      # Module export entry
├── cli.js                        # CLI entry + interactive Shell
├── api/
│   ├── provider.js               # 12+ provider clients & registry
│   └── retry.js                  # Retry logic with backoff
├── commands/
│   ├── registry.js               # ~30 slash commands
│   └── extended-commands.js      # Extended command set
├── config/
│   ├── settings.js               # Settings load/save
│   └── profiles.js               # Provider profile management
├── core/                         # Foundation layer — typed protocols
│   ├── api/
│   │   ├── errors.js             # API error classification
│   │   └── provider-adapter.js   # Provider adapter protocol & stream events
│   ├── messages/
│   │   └── types.js              # StandardMessage, ContentBlock types, stream events
│   ├── memory/
│   │   └── compaction.js         # Token estimation & compaction
│   └── permissions/
│       └── checker.js            # Permission checker
├── engine/                       # Agent runtime
│   ├── agent.js                  # AgentEngine, Session, HookExecutor
│   └── query.js                  # QueryContext state tracking
├── hooks/
│   └── registry.js               # Hook registry
├── memory/
│   ├── compact.js                # Message micro-compaction
│   └── store.js                  # Persistent memory store
├── plugins/
│   ├── installer.js              # Plugin installer
│   ├── registry.js               # Plugin auto-discovery
│   └── schema.js                 # Plugin manifest validation
├── prompts/
│   └── manager.js                # System prompt assembly
├── services/                     # Auxiliary services
│   ├── autodream.js              # Auto goal continuation
│   ├── lsp.js                    # LSP code navigation
│   ├── mcp.js                    # MCP server integration
│   ├── memory-extract.js         # Memory extraction
│   ├── personalization.js        # Rule extraction & rules.md
│   └── session-memory.js         # Session memory
├── shared/
│   ├── themes.js                 # Terminal themes
│   └── utils.js                  # ANSI codes & style utilities
├── skills/
│   └── registry.js               # Skill auto-discovery & loading
├── tools/
│   ├── registry.js               # 10 built-in tools
│   ├── agent-tool.js             # Agent subprocess tool
│   ├── extended.js               # Extended tool set
│   ├── image-tools.js            # Image processing
│   ├── mcp-tools.js              # MCP tool integration
│   ├── plan-mode-tool.js         # Plan mode tool
│   ├── send-message-tool.js      # Inter-agent messaging
│   └── worktree-tool.js          # Git worktree management
└── tui/
    └── index.js                  # Terminal UI (alt-screen, event rendering, status bar)

desktop/
├── main/                         # Electron main process
├── preload/                      # Preload scripts
└── renderer/                     # Vue desktop frontend
```

### Core Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `api/provider.js` | Unified streaming provider clients, 12+ provider registry |
| `core/api/provider-adapter.js` | Typed provider adapter protocol, stream event types, Anthropic/OpenAI adapters |
| `core/messages/types.js` | StandardMessage class, ContentBlock discriminated union, token estimation, format conversion |
| `core/permissions/checker.js` | Permission checker, four modes, sensitive path detection |
| `engine/agent.js` | AgentEngine main loop, Session management, HookExecutor lifecycle dispatch |
| `engine/query.js` | QueryContext: task focus, file tracking, skill tracking, work log |
| `config/settings.js` | Config load/save from `~/.haxagent/settings.json` |
| `config/profiles.js` | ProfileManager: built-in + custom provider profiles, runtime switching |
| `commands/registry.js` | ~30 slash command registration and dispatch |
| `tools/registry.js` | ToolRegistry: 10 built-in tools, isReadOnly classification, path sandboxing |
| `tui/index.js` | Terminal UI: alt-screen buffer, event-driven rendering, approval prompts |
| `skills/registry.js` | Skill discovery, loading, and system prompt generation |
| `services/lsp.js` | Code navigation: go-to-definition, workspace symbol search |
| `services/personalization.js` | Environment rule extraction and rules.md generation |
| `memory/store.js` | Persistent memory CRUD with search |
| `memory/compact.js` | Token-aware message compaction |

---

## Sessions & Memory

### Session Storage

All session transcripts are saved as JSONL files in the configuration directory:

```text
.hax-agent/sessions/
├── 2025-01-15T10-30-00-000Z-a1b2c3d4.jsonl
└── ...
```

- Each record is a single line of JSON, containing `timestamp`, `role`, `content`, and other fields.
- The desktop app's "Recent Sessions" list reads from the same transcript files and can resume historical conversations.

### Memory Storage

Persistent memories are saved as JSON files in:

```text
.hax-agent/memory/
├── user-preferences-5f8a2b1c.json
└── ...
```

- Manage memories via `/memory search <query>` or `/memory list`.
- `/personalize` extracts environment rules from conversations into `.hax-agent/rules.md`.

---

## Provider Profiles

Pre-configured profiles for quick provider switching via `/provider`:

| Profile | Provider | Model |
|---------|----------|-------|
| `claude` | Anthropic | claude-sonnet-4-20250514 |
| `sonnet` | Anthropic | claude-sonnet-4-20250514 |
| `haiku` | Anthropic | claude-haiku-3-5-20241022 |
| `gpt` | OpenAI | gpt-4o |
| `gpt-mini` | OpenAI | gpt-4o-mini |
| `local` | Ollama | (local config) |

Custom profiles are managed via `~/.haxagent/profiles.json`, switchable with `/provider <name>`.

---

## Development & Testing

### Running Tests

```bash
npm test
```

The project uses the Node.js built-in test runner (`node --test`). Test files are in the `test/` directory.

### Directory Conventions

- `src/` — Source code, following CommonJS module conventions, layered architecture (core -> engine -> api/tools/services)
- `desktop/` — Desktop app source, sharing the same core layer as the CLI
- `test/` — Test files
- `.hax-agent/` — Runtime data (sessions, memories, settings), already in `.gitignore`

### Development & Contributing

1. Fork this repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

Issues and PRs are welcome! Please ensure:
- New features include corresponding test cases
- Code style is consistent (follow existing conventions)
- Related documentation is updated

---

## License

MIT (c) [IdiotTIQS](https://github.com/IdiotTIQS)

---

*Hax Agent CLI -- Let your AI coding assistant serve you in your terminal.*
