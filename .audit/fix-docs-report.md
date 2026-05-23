# Docs/DX Fix Report

**Date:** 2026-05-23
**Scope:** CLAUDE.md creation, CLI help i18n, createAgent export
**Based on:** .audit/code-review-docs.md

---

## Fix 1: CLAUDE.md Developer Guide (NEW FILE)

**File:** `E:/HaxAgent/CLAUDE.md`

Created a comprehensive developer guide covering:
- Project overview (purpose, tech stack, dual CLI/library nature)
- Quick start (install, run, test, lint, desktop dev)
- Architecture diagram and data flow (user input -> CLI -> agent engine -> provider -> renderer)
- Directory structure map with descriptions of all key directories
- Module organization principles (6 rules)
- How-to guides: add a slash command, tool, plugin, skill, or provider
- Coding conventions (naming, i18n, JSDoc, imports, error handling)
- Testing conventions (framework, file naming, run commands)
- Key design patterns (Factory, Observer/Plugin Hooks, Strategy, Command/Undo, Composite Config, Soft Dependency Loading, Translator I18n)
- Common development tasks (which tests to run after which changes)

---

## Fix 2: CLI Help i18n

### Files modified:
- `E:/HaxAgent/src/i18n/en.js` — Added 24 new keys under `cli.help.*` and `cli.errors.*`
- `E:/HaxAgent/src/i18n/zh-CN.js` — Added 24 corresponding Chinese translations
- `E:/HaxAgent/src/cli.js` — Updated help command and error handler to use i18n

### Keys added to en.js and zh-CN.js:

| Key | English | Chinese |
|-----|---------|---------|
| `cli.help.title` | Hax Agent CLI v{version} | Hax Agent CLI v{version} |
| `cli.help.chat` | Start interactive shell (default) | 启动交互式 Shell（默认） |
| `cli.help.init` | Run first-time setup wizard | 运行首次安装向导 |
| `cli.help.models` | List available models | 列出可用模型 |
| `cli.help.agents` | List agent definitions | 列出 Agent 定义 |
| `cli.help.team` | Print an auth-refactor team plan | 输出 auth-refactor 团队计划 |
| `cli.help.doctor` | Run diagnostics | 运行诊断检查 |
| `cli.help.help` | Show this help | 显示本帮助 |
| `cli.help.sessions` | List previous sessions | 列出历史会话 |
| `cli.help.resume` | Resume a previous session | 恢复历史会话 |
| `cli.help.config` | Show or edit configuration | 显示或编辑配置 |
| `cli.help.configJson` | Output configuration as JSON | 以 JSON 格式输出配置 |
| `cli.help.batch` | Run in non-interactive batch mode | 以非交互批量模式运行 |
| `cli.help.batchFile` | Process prompts from file | 从文件读取提示词 |
| `cli.help.batchOutput` | Write response to file | 将响应写入文件 |
| `cli.help.batchModel` | Override model for batch runs | 为批量运行覆盖模型 |
| `cli.help.preset` | Apply config preset ({presets}) | 应用配置预设 ({presets}) |
| `cli.help.version` | Print version number | 打印版本号 |
| `cli.help.noColor` | Disable ANSI color output | 禁用 ANSI 彩色输出 |
| `cli.help.debug` | Enable verbose debug logging | 启用详细调试日志 |
| `cli.errors.unknownCommand` | Unknown command: {command} | 未知命令: {command} |
| `cli.errors.didYouMean` | Did you mean: hax-agent {command}? | 你是不是想用: hax-agent {command}? |
| `cli.errors.usage` | Usage: hax-agent <command> | 用法: hax-agent <command> |
| `cli.errors.showHelp` | hax-agent help Show available commands | hax-agent help 显示可用命令 |

### Code changes in cli.js:

1. **Added `createCliTranslator()` helper** (lines 46-54): Loads settings, creates a translator from the user's locale, falls back to English on error. Used by both the help command and the error handler in `main()`.

2. **Help command** (lines 143-168): Now wraps in a block scope, creates `t = createCliTranslator()`, and uses `t('cli.help.*')` for all 20 help lines.

3. **Default/error case** (lines 177-185): Uses `t('cli.errors.*')` for unknown command, suggestion, usage, and help hint messages.

---

## Fix 3: Export createAgent from index.js

**File:** `E:/HaxAgent/src/index.js`

- Added `const { createAgent } = require('./hub');` (line 24)
- Added `createAgent` to the module.exports object (line 59)

This makes the high-level `createAgent()` API available to consumers via `require('hax-agent-cli').createAgent`, without needing a deep import (`require('hax-agent-cli/src/hub')`).

---

## Verification

All changes are backward-compatible:
- I18n keys follow existing naming conventions (`cli.help.*`, `cli.errors.*`)
- `createCliTranslator()` wraps config loading in try/catch with English fallback
- `createAgent` is a named export added alongside existing pattern in index.js
- CLAUDE.md is a new file, no existing files were removed or renamed
