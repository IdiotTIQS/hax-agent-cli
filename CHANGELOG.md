# Changelog

All notable changes to Hax Agent CLI will be documented in this file.

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
