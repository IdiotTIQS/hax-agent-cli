# Changelog

All notable changes to Hax Agent CLI will be documented in this file.

## [1.3.13] - 2026-05-14

### Added
- `stock.quote` tool for real-time stock/index quotes (A-shares, HK stocks, US stocks)
- `file.read` auto-truncation + `offset`/`limit` line pagination for large files
- Inline diff view for `file.edit` tool
- Context window usage meter in status line
- Multi-line input support (`\` line continuation)
- Ctrl+←/→ word jump navigation, status bar cwd, `/help` shortcut cheatsheet
- Ctrl+R reverse history search
- Command syntax highlighting and improved error messages
- Session file change summary on `/exit`
- `/copy` command to copy last AI response to clipboard
- `/rename` command to name the current session
- Tool execution timing displayed in file modification notices
- `-v` shorthand for `--version` flag

### Changed
- Local tools modularized into separate files (`file-edit`, `file-readdir`, `file-delete`, `web-fetch`, `web-search`, `stock-quote`)
- Enhanced tab autocomplete with first-run onboarding
- Enhanced `/clear` with cleared message count and user guidance
- `file.read`/`file.search`/`file.write` tool descriptions discourage AI from passing tiny `maxBytes`
- Increased empty tool preamble retry tolerance (1→3) with stronger continuation prompts

### Fixed
- Google provider dependency: `require("@google/genai")` → `@google/generative-ai`
- Stream `finalMessage()` returning `null` on non-Anthropic endpoints
- Chinese text falsely detected as tool preamble in `forceTextResponse` mode
- Tab autocomplete not working due to readline inserting `\t` before keypress event

## [1.3.12] - 2026-05-14

### Added
- Quick setup mode in init wizard: skip optional questions with recommended defaults
- `hax-agent config` command to view current configuration
- `hax-agent config edit` to open config file in default editor
- Smart API key detection during init (auto-detects env vars to skip input)
- `hax-agent --version` / `-V` flag to print version number
- `hax-agent doctor` command for one-line diagnostics
- `--no-color` flag to disable ANSI terminal output

### Changed
- Init wizard flow: quick mode asks only Provider + Key, full mode keeps all 9 questions
- CLI better supports piping and non-TTY environments for config viewing
- Improved i18n for Chinese (zh-CN) translations

## [1.3.11] - 2026-05-07

### Added
- Desktop approval dialog for tool permissions
- Workspace search in desktop app
- Git diff/review tools in desktop app

### Changed
- Refactored shared serialization utilities to `src/utils/serialization.js`
- Improved web-search with Bing RSS fallback when DuckDuckGo fails
- Updated User-Agent version string

## [1.3.10] - 2026-05-05

### Changed
- Improved context handling and tool-call recovery
- Better error messages for empty tool preamble detection

## [1.3.9] - 2026-04-28

### Changed
- Modularized tools into separate files
- Unified DSML tool call parsing across providers

## [1.3.8] - 2026-04-20

### Added
- Desktop app renderer with Vue.js components
- File tree, chat area, sidebar, and settings UI

## [1.3.7] - 2026-04-15

### Added
- Command suggestions for slash and CLI commands
- Typo-tolerant command matching

## [1.3.6] - 2026-04-10

### Added
- Interactive initialization wizard (`hax-agent init`)
- Enhanced permission management system

## [1.3.5] - 2026-04-05

### Added
- CI/CD workflow for automated testing and npm publishing
- Manual release trigger via `workflow_dispatch`

## [1.3.4] - 2026-03-30

### Added
- Self-update check and installation (`/update` command)

### Changed
- Refactored provider code for better maintainability
- Raised tool execution limits

## [1.3.3] - 2026-03-25

### Added
- Shell command execution with allowlist control
- Improved terminal UI rendering

## [1.3.2] - 2026-03-20

### Fixed
- CLI test suite failures
- Various bug fixes and refactoring

## [1.3.1] - 2026-03-15

### Added
- Permission management system
- DeepSeek DSML format support
- `reasoning_content` handling for extended thinking models

### Fixed
- Single-call tool deduplication
- Recursive web.fetch loop prevention
- Windows shell spawn issues
