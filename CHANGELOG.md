     1|# Changelog
     2|
     3|All notable changes to Hax Agent CLI will be documented in this file.
     4|
     5|## [1.5.4] - 2026-05-30

### Changed
- **Architecture Rewrite (Complete):** Fully rebuilt following OpenHarness reference architecture and industry-grade standards. Flat src (~560 files) → layered modular (144 consolidated JS files). All 30+ OpenHarness subsystems covered with full feature parity.

## [1.5.3] - 2026-05-15

### Changed
- **Architecture Rewrite:** Migrated from flat `src/` structure to layered modular architecture inspired by OpenHarness.
  - New `core/` layer: typed messages (`StandardMessage`, `ContentBlock`), provider adapter protocol (`ApiStreamEvent` types), permission checker.
  - New `engine/` layer: `AgentEngine` with async generator tool loop, `QueryContext` for state tracking, `Session`, `HookExecutor`.
  - Consolidated provider layer: 12+ providers in `api/provider.js` (Anthropic, OpenAI, DeepSeek, Groq, Mistral, Google, Moonshot, Zhipu, DashScope, Ollama, vLLM, OpenRouter).
  - Consolidated tool registry: all 10 built-in tools in `tools/registry.js` with `isReadOnly` classification.
  - New `services/`: LSP code navigation, MCP integration, personalization, AutoDream goal continuation.
  - New `config/profiles.js`: Provider profile management with pre-configured profiles and runtime switching.
  - New `tui/`: Terminal UI with alt-screen buffer and event-driven rendering.
- Updated all documentation (CLAUDE.md, README.md, README.en.md) to reflect new architecture.

### Added
- `/lsp` command: go-to-definition and workspace symbol search.
- `/theme` command: switch terminal color themes at runtime.
- `/providers` command: list all 12+ available AI providers.
- `/personalize` command: extract environment rules from conversations.
- `/plan` command: toggle Plan mode (block all mutating tools).
- `/fullauto` command: toggle Full Auto mode (silent auto-approve).
- `/perms` command: show detailed permission status.
- `/export` command: export session to JSON file.
- `/api-key <provider> <key>` command: set per-provider API keys.
- Provider profiles: pre-configured claude, gpt, sonnet, haiku, gpt-mini, local profiles.

### Removed
- Legacy flat modules superseded by layered architecture (agent-engine, session, renderer, hub, batch, config, permissions, undo-stack, context-compaction, context-window, config-presets, init-wizard, updater, debug, i18n, and ~70 legacy subsystem directories).

## [1.4.0] - 2026-05-15
     6|
     7|### Added
     8|- `/context` command and `/cache` alias to view and tune context cache budgets.
     9|- Tab completion for context cache subcommands (`status`, `window`, `reserve`, `chars-per-token`, `auto`, `on`, `off`).
    10|- Broader model context-window inference for GPT-5, Claude 4.x, Gemini, DeepSeek, Qwen, Kimi, GLM, Doubao, Hunyuan, MiniMax, Yi, and Baichuan model IDs.
    11|- Token-count context meter now shows sub-percent usage and input-budget counts.
    12|
    13|### Changed
    14|- YOLO/full permission mode now maps consistently across CLI and desktop flows.
    15|- Shell execution no longer uses a hard allowlist gate; normal mode asks for permission and YOLO mode auto-approves.
    16|- CLI status line is rendered outside chat history so workspace/model/context metadata stays visible without becoming user input.
    17|- Windows shell command resolution now prefers executable shims and wraps `.cmd`/`.bat` launchers correctly.
    18|
    19|### Fixed
    20|- Repeated empty tool preamble loops from OpenAI-compatible providers.
    21|- `shell.run` spinner flooding the terminal while commands are running.
    22|- Windows `npm` execution failures caused by spawning extensionless npm shims.
    23|- Desktop permission mode and approval flow edge cases.
    24|
    25|## [1.3.14] - 2026-05-14

### Fixed
- Desktop i18n path corrections and component updates
- CLI paste detection multi-line splitting
- Desktop test i18n injection missing
- 7 HIGH severity security issues (path traversal hardening, env var sanitization)
- ReDoS protection added to regex patterns in file.search
- LICENSE file and .gitignore hardening

## [1.3.13] - 2026-05-14
    26|
    27|### Added
    28|- `stock.quote` tool for real-time stock/index quotes (A-shares, HK stocks, US stocks)
    29|- `file.read` auto-truncation + `offset`/`limit` line pagination for large files
    30|- Inline diff view for `file.edit` tool
    31|- Context window usage meter in status line
    32|- Multi-line input support (`\` line continuation)
    33|- Ctrl+←/→ word jump navigation, status bar cwd, `/help` shortcut cheatsheet
    34|- Ctrl+R reverse history search
    35|- Command syntax highlighting and improved error messages
    36|- Session file change summary on `/exit`
    37|- `/copy` command to copy last AI response to clipboard
    38|- `/rename` command to name the current session
    39|- Tool execution timing displayed in file modification notices
    40|- `-v` shorthand for `--version` flag
    41|
    42|### Changed
    43|- Local tools modularized into separate files (`file-edit`, `file-readdir`, `file-delete`, `web-fetch`, `web-search`, `stock-quote`)
    44|- Enhanced tab autocomplete with first-run onboarding
    45|- Enhanced `/clear` with cleared message count and user guidance
    46|- `file.read`/`file.search`/`file.write` tool descriptions discourage AI from passing tiny `maxBytes`
    47|- Increased empty tool preamble retry tolerance (1→3) with stronger continuation prompts
    48|
    49|### Fixed
    50|- Google provider dependency: `require("@google/genai")` → `@google/generative-ai`
    51|- Stream `finalMessage()` returning `null` on non-Anthropic endpoints
    52|- Chinese text falsely detected as tool preamble in `forceTextResponse` mode
    53|- Tab autocomplete not working due to readline inserting `\t` before keypress event
    54|
    55|## [1.3.12] - 2026-05-14
    56|
    57|### Added
    58|- Quick setup mode in init wizard: skip optional questions with recommended defaults
    59|- `hax-agent config` command to view current configuration
    60|- `hax-agent config edit` to open config file in default editor
    61|- Smart API key detection during init (auto-detects env vars to skip input)
    62|- `hax-agent --version` / `-V` flag to print version number
    63|- `hax-agent doctor` command for one-line diagnostics
    64|- `--no-color` flag to disable ANSI terminal output
    65|
    66|### Changed
    67|- Init wizard flow: quick mode asks only Provider + Key, full mode keeps all 9 questions
    68|- CLI better supports piping and non-TTY environments for config viewing
    69|- Improved i18n for Chinese (zh-CN) translations
    70|
    71|## [1.3.11] - 2026-05-07
    72|
    73|### Added
    74|- Desktop approval dialog for tool permissions
    75|- Workspace search in desktop app
    76|- Git diff/review tools in desktop app
    77|
    78|### Changed
    79|- Refactored shared serialization utilities to `src/utils/serialization.js`
    80|- Improved web-search with Bing RSS fallback when DuckDuckGo fails
    81|- Updated User-Agent version string
    82|
    83|## [1.3.10] - 2026-05-05
    84|
    85|### Changed
    86|- Improved context handling and tool-call recovery
    87|- Better error messages for empty tool preamble detection
    88|
    89|## [1.3.9] - 2026-04-28
    90|
    91|### Changed
    92|- Modularized tools into separate files
    93|- Unified DSML tool call parsing across providers
    94|
    95|## [1.3.8] - 2026-04-20
    96|
    97|### Added
    98|- Desktop app renderer with Vue.js components
    99|- File tree, chat area, sidebar, and settings UI
   100|
   101|## [1.3.7] - 2026-04-15
   102|
   103|### Added
   104|- Command suggestions for slash and CLI commands
   105|- Typo-tolerant command matching
   106|
   107|## [1.3.6] - 2026-04-10
   108|
   109|### Added
   110|- Interactive initialization wizard (`hax-agent init`)
   111|- Enhanced permission management system
   112|
   113|## [1.3.5] - 2026-04-05
   114|
   115|### Added
   116|- CI/CD workflow for automated testing and npm publishing
   117|- Manual release trigger via `workflow_dispatch`
   118|
   119|## [1.3.4] - 2026-03-30
   120|
   121|### Added
   122|- Self-update check and installation (`/update` command)
   123|
   124|### Changed
   125|- Refactored provider code for better maintainability
   126|- Raised tool execution limits
   127|
   128|## [1.3.3] - 2026-03-25
   129|
   130|### Added
   131|- Shell command execution with allowlist control
   132|- Improved terminal UI rendering
   133|
   134|## [1.3.2] - 2026-03-20
   135|
   136|### Fixed
   137|- CLI test suite failures
   138|- Various bug fixes and refactoring
   139|
   140|## [1.3.1] - 2026-03-15
   141|
   142|### Added
   143|- Permission management system
   144|- DeepSeek DSML format support
   145|- `reasoning_content` handling for extended thinking models
   146|
   147|### Fixed
   148|- Single-call tool deduplication
   149|- Recursive web.fetch loop prevention
   150|- Windows shell spawn issues
   151|