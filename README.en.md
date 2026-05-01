# Hax Agent CLI

> — Lightweight, Claude-like Local Agent CLI · Developed by [IdiotTIQS](https://github.com/IdiotTIQS)

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](#license)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)](#development--contributing)
[![npm](https://img.shields.io/npm/v/hax-agent-cli)](https://www.npmjs.com/package/hax-agent-cli)

Hax Agent CLI is an AI coding assistant for developers, offering a Claude-like terminal experience. It supports three major AI providers — Anthropic, OpenAI, and Google — and features interactive chat, multi-provider switching, local file tools, session memory management, and multi-agent team collaboration plan generation.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Interactive Commands](#interactive-commands)
- [Skills System](#skills-system)
- [Configuration](#configuration)
- [Local Tools](#local-tools)
- [Architecture Overview](#architecture-overview)
- [Sessions & Memory](#sessions--memory)
- [Multi-Agent Team](#multi-agent-team)
- [Development & Testing](#development--testing)
- [License](#license)

---

## Features

- **Interactive Agent Shell** — Enters chat mode by default, supporting continuous contextual conversations, slash commands, and streaming output.
- **Multi-Provider Support** — Built-in Anthropic (Claude), OpenAI (GPT), and Google (Gemini) providers with runtime switching.
- **Model Management** — View available models and switch models at runtime.
- **Local Toolset** — File read/write, search, glob matching, and allowlist-restricted shell command execution.
- **Skills System** — Create, manage, and invoke reusable skills by packaging repetitive workflows into SKILL.md files.
- **Session Memory** — Automatically saves conversation transcripts; new sessions automatically load recent context.
- **Layered Configuration** — Supports 5-level priority configuration merging (default → user → project → explicit → environment variables).
- **Multi-Agent Team** — Built-in `auth-refactor` authentication refactoring team plan, supporting structured collaborative output.
- **Cost Tracking** — Token usage and cost estimation statistics.

---

## Prerequisites

- **Node.js** >= 18
- **npm** (or pnpm / yarn)
- **API Key** (Anthropic / OpenAI / Google, at least one)

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

### 3. Configure Provider

Set up within the Shell at runtime:

```text
/provider anthropic     # Switch to Anthropic
/provider openai        # Switch to OpenAI
/provider google        # Switch to Google
/api-url https://api.anthropic.com
/api-key sk-ant-xxxxxxxxxxxx
/model claude-sonnet-4-20250514
```

Or pre-configure via environment variables (see [Configuration](#configuration)).

---

## Usage

```bash
# Start interactive chat (default)
hax-agent
hax-agent chat

# View help
hax-agent help

# List available models for the current provider
hax-agent models

# Output the auth-refactor team plan
hax-agent team auth-refactor

# Use globally after linking
npm link
hax-agent            # Available from any directory
```

### Built-in npm Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the CLI (`node src/cli.js`) |
| `npm run auth:team` | Output the auth-refactor team plan |
| `npm test` | Run the test suite |

---

## Interactive Commands

Type the following slash commands in the Shell:

| Command | Description |
|---------|-------------|
| `/help` | View all available commands |
| `/exit` or `/quit` | Exit the Shell |
| `/clear` or `/new` | Clear the current context and start a new session |
| `/tools` | List available local tools |
| `/agents` | View built-in agent roles |
| `/models` | List available models for the current provider |
| `/model <id-or-number>` | Switch models |
| `/provider <name>` | Switch AI provider (`anthropic`, `openai`, `google`) |
| `/api-url <base-url>` | Set the API Base URL |
| `/api-key <key>` | Set the API Key |

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
when_to_use: Describes when to automatically invoke this skill. Start with "Use when...", include trigger phrases and example messages.
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

### 2. Another Step
...

**Human checkpoint**: When to pause and ask the user (especially for irreversible operations).
```

### Invoking Skills

In the Shell, simply type the skill name as a slash command:

```text
/code-review                    # Invoke the code review skill
/code-review src/index.js       # Invoke with arguments
/skillify                       # Capture the current session as a skill
/skills                         # List all available skills
/skills usage                   # View skill usage statistics
```

### Capturing a Session as a Skill

Use the `/skillify` command to save a repetitive workflow from the current session as a reusable skill:

```text
/skillify                       # Create a skill interactively
/skillify deploy workflow       # Describe the workflow to capture
```

The AI will analyze the session content, identify reusable steps, and guide you through creating the SKILL.md file.

### Skill Usage Tracking

The system automatically tracks each skill's usage frequency and last-used time, supporting intelligent sorting based on usage frequency and recency.

---

## Configuration

### Configuration Priority (Low to High)

1. **Default Configuration** — Built into `DEFAULT_SETTINGS` in `src/config.js`
2. **User Configuration** — `~/.hax-agent/settings.json`
3. **Project Configuration** — `./.hax-agent/settings.json`
4. **Explicit Configuration** — JSON file path specified by the `HAX_AGENT_SETTINGS` environment variable
5. **Environment Variable Overrides** — All environment variables listed below

> ⚠️ It is recommended not to commit project configuration containing API keys to version control. Use environment variables or user configuration instead.

### Supported Providers

| Provider | Aliases | Default Model | Environment Variables |
|----------|---------|---------------|----------------------|
| **Anthropic** | `anthropic`, `claude` | `claude-opus-4-7` | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` |
| **OpenAI** | `openai`, `gpt` | `gpt-4o` | `OPENAI_API_KEY`, `OPENAI_BASE_URL` |
| **Google** | `google`, `gemini` | `gemini-2.5-pro` | `GOOGLE_API_KEY`, `GOOGLE_BASE_URL` |

### Complete Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HAX_AGENT_PROVIDER` / `AI_PROVIDER` | Provider name (`mock`, `local`, `anthropic`, `claude`, `openai`, `gpt`, `google`, `gemini`) | `mock` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `GOOGLE_API_KEY` | Google API Key | — |
| `HAX_AGENT_API_URL` / `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `GOOGLE_BASE_URL` | API Base URL | — |
| `HAX_AGENT_MODEL` / `AI_MODEL` | Model ID | `claude-sonnet-4-20250514` |
| `HAX_AGENT_MAX_TURNS` | Maximum conversation turns | `20` |
| `HAX_AGENT_TEMPERATURE` | Sampling temperature | `0.2` |
| `HAX_AGENT_MAX_TOKENS` | Maximum generation tokens | — |
| `HAX_AGENT_MOCK_RESPONSE` | Response text in mock mode | — |
| `HAX_AGENT_MOCK_DELAY_MS` | Delay in milliseconds for mock mode | `0` |
| `HAX_AGENT_MOCK_TOOL_TRACE` | Mock tool call trace (`1` to enable) | — |
| `HAX_AGENT_MEMORY_ENABLED` | Enable memory | `true` |
| `HAX_AGENT_MEMORY_DIR` | Memory directory | `.hax-agent/memory` |
| `HAX_AGENT_MEMORY_MAX_ITEMS` | Maximum memory items | `20` |
| `HAX_AGENT_SESSION_DIR` | Session directory | `.hax-agent/sessions` |
| `HAX_AGENT_TRANSCRIPT_LIMIT` | Transcript save/read limit | `100` |
| `HAX_AGENT_INCLUDE_SETTINGS` | Include settings in prompt | `true` |
| `HAX_AGENT_INCLUDE_MEMORY` | Include memory in prompt | `true` |
| `HAX_AGENT_INCLUDE_TRANSCRIPT` | Include recent conversation in prompt | `true` |
| `HAX_AGENT_MAX_TRANSCRIPT_MESSAGES` | Maximum conversation messages in prompt | `20` |
| `HAX_AGENT_SHELL_ENABLED` | Enable shell tool | `true` |
| `HAX_AGENT_SHELL_COMMANDS` | Allowed commands (comma-separated) | `node,npm,git` |
| `HAX_AGENT_SHELL_TIMEOUT_MS` | Shell command timeout in milliseconds | `10000` |
| `HAX_AGENT_SHELL_MAX_BUFFER` | Shell command max output bytes | `200000` |
| `HAX_AGENT_PROJECT_ROOT` | Project root directory (overrides `process.cwd()`) | — |
| `HAX_AGENT_USER_SETTINGS` | User configuration path | `~/.hax-agent/settings.json` |
| `HAX_AGENT_PROJECT_SETTINGS` | Project configuration path | `./.hax-agent/settings.json` |
| `HAX_AGENT_SETTINGS` | Explicit configuration file path | — |

### Configuration File Example

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-xxxxxxxxxxxx",
    "apiUrl": "https://api.anthropic.com",
    "temperature": 0.2,
    "maxTurns": 20
  },
  "memory": {
    "enabled": true,
    "directory": ".hax-agent/memory",
    "maxItems": 20
  },
  "sessions": {
    "directory": ".hax-agent/sessions",
    "transcriptLimit": 100
  },
  "prompts": {
    "includeSettings": true,
    "includeMemory": true,
    "includeTranscript": true,
    "maxTranscriptMessages": 20
  },
  "tools": {
    "shell": {
      "enabled": true,
      "allowedCommands": ["node", "npm", "git"],
      "timeoutMs": 10000,
      "maxBuffer": 200000
    }
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
| `file.glob` | List files matching a glob pattern | Path restricted to workspace root |
| `file.search` | Search for content in text files | Supports regex / case sensitivity config |
| `shell.run` | Execute local commands | Only allowlisted commands (default `node`, `npm`, `git`) |

---

## Architecture Overview

```
src/
├── index.js                      # Module export entry
├── cli.js                        # CLI entry + interactive Shell
├── config.js                     # Layered configuration loading & environment variable overrides
├── context.js                    # Prompt context assembly
├── memory.js                     # Session memory & persistent storage
├── orchestration.js              # Agent orchestration logic
│
├── providers/                    # AI Provider abstraction layer
│   ├── index.js                  #   Module exports
│   ├── factory.js                #   Provider factory + registration mechanism
│   ├── chat-provider.js          #   Base Provider abstract class
│   ├── anthropic-provider.js     #   Anthropic (Claude) implementation
│   ├── openai-provider.js        #   OpenAI (GPT) implementation
│   ├── google-provider.js        #   Google (Gemini) implementation
│   ├── mock-provider.js          #   Local mock implementation
│   └── messages.js               #   Message format normalization
│
├── runtime/                      # Agent runtime
│   ├── index.js                  #   Module exports
│   ├── agents.js                 #   Agent role definitions
│   ├── commands.js               #   Slash command handling
│   ├── composition.js            #   Agent composition logic
│   ├── messages.js               #   Runtime message handling
│   ├── sessions.js               #   Session lifecycle
│   └── tasks.js                  #   Task definition & execution
│
├── teams/                        # Multi-agent team definitions
│   └── auth-refactor.js          #   Auth refactoring team
│
├── tools/                        # Local tool registry
│   └── index.js                  #   Tool definitions & validation
│
└── formatters/                   # Output formatting
    └── team-plan.js              #   Team plan formatting
```

### Core Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `config.js` | Multi-source configuration merging, environment variable parsing, configuration persistence |
| `context.js` | Assembles settings, memory, and conversation history into system prompts |
| `memory.js` | JSON/JSONL file storage, session transcript read/write, memory CRUD |
| `providers/` | Provider abstraction with factory pattern, supports dynamic registration of new providers |
| `runtime/` | Session management, agent role orchestration, task scheduling, command parsing |
| `teams/auth-refactor.js` | Multi-agent collaboration plan definition (architect, developer, reviewer, etc.) |
| `tools/index.js` | Tool registry, path security validation, execution sandbox |

---

## Sessions & Memory

### Session Storage

All session transcripts are saved as JSONL files in the configuration directory:

```text
.hax-agent/sessions/
├── 2025-01-15T10-30-00-000Z-a1b2c3d4.jsonl
├── 2025-01-15T11-00-00-000Z-e5f6g7h8.jsonl
└── ...
```

- Each record is a single line of JSON, containing `timestamp`, `role`, `content`, and other fields.
- New sessions automatically generate filenames based on timestamp + random suffix.
- On startup, the most recent transcript is automatically loaded as context.

### Memory Storage

Persistent memories are saved as JSON files in:

```text
.hax-agent/memory/
├── user-preferences-5f8a2b1c.json
├── project-rules-9e3d7f6a.json
└── ...
```

- Each memory is a separate file containing `name`, `content`, `createdAt`, and `updatedAt`.
- Supports clearing context via `/clear` or managing memories via `writeMemory` / `deleteMemory`.

---

## Multi-Agent Team

The built-in `auth-refactor` team plan, designed for authentication module refactoring, includes the following roles:

| Role | Responsibility |
|------|---------------|
| 🏗️ **Architect** | Design the overall refactoring plan and module breakdown |
| 🔐 **Token Expert** | Token generation, validation, and refresh strategy |
| 💾 **Session Expert** | Session storage and state management |
| 👤 **Identity Expert** | User identity and permission model |
| 🛡️ **Security Reviewer** | Security audit and vulnerability detection |
| 🧪 **Test Engineer** | Test coverage and integration testing plan |

Run the team plan:

```bash
npm run auth:team
# or
hax-agent team auth-refactor
```

---

## Development & Testing

### Running Tests

```bash
npm test
```

The project uses Node.js built-in test runner (`node --test`). Test files are located in the `test/` directory:

```text
test/
├── auth-refactor.test.js
├── cli.test.js
├── config-memory.test.js
├── orchestration.test.js
├── providers.test.js
└── team-plan.test.js
```

### Directory Conventions

- `src/` — Source code, following CommonJS module conventions
- `test/` — Test files, one-to-one mapping with tested modules
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

MIT © [IdiotTIQS](https://github.com/IdiotTIQS)

---

*Hax Agent CLI — Let your AI coding assistant serve you in your terminal.*
