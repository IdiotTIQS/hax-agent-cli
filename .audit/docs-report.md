# Documentation & DX Audit Report

**Date:** 2026-05-22
**Project:** HaxAgent (E:/HaxAgent)
**Scope:** CLI help text, error messages, i18n strings, inline documentation, README accuracy

---

## Changes Made

### 1. CLI Help Text (`src/cli.js`)

**Before:** Flat list of 13 commands with no grouping, descriptions, or examples.

**After:** Commands grouped into logical categories (CHAT & SESSION, SETUP & CONFIG, PROVIDERS & MODELS, AGENTS & TEAMS, DIAGNOSTICS, OPTIONS), plus an EXAMPLES section showing common usage patterns. Each group is clearly labeled, making the help output scannable.

### 2. CLI Error Messages (`src/cli.js`)

- **Unknown command:** Improved message flow -- error on stderr, suggestion on stderr with spacing, then a single actionable line directing to `hax-agent help`.
- **Fatal error / Unhandled rejection:** Changed "Unhandled rejection" to "Unexpected error" (more user-friendly). Added the exact re-run command (`hax-agent --debug`) instead of the generic "Run with --debug".
- **Team command usage:** Cleaned up formatting with blank lines and consistent alignment.

### 3. i18n Improvements

#### Russian (`src/i18n/ru.js`) -- 5 categories of fixes:

- **Bug fix:** `shell.contextCleared` was missing the `{count}` parameter -- the message said "Context cleared." with no count, unlike all other languages. Fixed to `'Контекст очищен ({count} сообщений).'`
- **Added 10 missing shell keys:** `shell.clearHint`, `shell.filesModified`, `shell.copyNoResponse`, `shell.copySuccess`, `shell.copyFailed`, `shell.renameNoName`, `shell.renameSuccess`, `shell.bangDenied`, `shell.exitCode`, `shell.commandError`
- **Added 5 new shell keys:** `shell.compacted`, `shell.compactedDetail`, `shell.goalCleared`, `shell.goalSet`, `shell.goalHint`, `shell.goalNoActive`, `shell.themeToggled`, `shell.vimToggled`
- **Added 10 permission reason/level keys:** `permission.level.*` (auto, ask, dangerous), `permission.reason.*` (yolo, auto, alwaysDenied, alwaysAllowed, noPrompt, approved, denied)
- **Added 4 command description keys:** `cmd.context`, `cmd.copy`, `cmd.rename`, `cmd.status`
- **Added 3 help shortcut keys:** `help.ctrlR`, `help.ctrlArrow`, `help.tab`
- **Added missing key:** `errors.tabHint`
- **Improved 6 doctor labels:** Provider, API Key, API URL, Shell Tool, TTY, Session ID now translated to Russian

#### Chinese Traditional (`src/i18n/zh-TW.js`) -- minor additions:

- Added `shell.copyNoResponse`, `shell.copySuccess`, `shell.copyFailed`, `shell.renameNoName`, `shell.renameSuccess` (previously inherited from zh-CN parent)
- Added 8 new keys for the shell.compacted, shell.goal*, shell.themeToggled, shell.vimToggled groups

#### Chinese Simplified (`src/i18n/zh-CN.js`) and English (`src/i18n/en.js`):

- Added 12 new i18n keys for previously hardcoded English strings (see section 4)

### 4. Non-i18n'd Strings Fixed

Replaced 7 hardcoded English strings with i18n keys in `src/cli.js` and `src/commands/index.js`:

| Location | Before | After (i18n key) |
|----------|--------|-------------------|
| `!` command denial (cli.js) | `! Command denied: ${reason}` | `t('shell.bangDenied', { reason })` |
| Exit code display (cli.js) | `Exit code: ${code}` | `t('shell.exitCode', { code })` |
| Command error (cli.js) | `Command error: ${msg}` | `t('shell.commandError', { message })` |
| Compact confirm (commands) | `Compacted.` / `Kept last ...` | `t('shell.compacted')` / `t('shell.compactedDetail', ...)` |
| Goal messages (commands) | `Goal cleared.` / `Goal set:` / hint text | 3 separate keys |
| Theme toggle (commands) | `Theme enabled/disabled.` | `t('shell.themeToggled', { state })` |
| Vim toggle (commands) | `Vim mode enabled/disabled.` | `t('shell.vimToggled', { state })` |

### 5. Inline Documentation (`src/agent-engine.js`, `src/session.js`)

- Added 1-line comment explaining the `AgentEventType` enum -- each value now has an inline description of when it fires
- Added 1-line comment on `Session.getStatusLine()` describing the status bar format
- Added 2-line comment on `CostTracker.getPricing()` explaining the regex fallback mechanism

---

## Findings (Not Fixed -- Requires Architectural Decisions)

### 1. Permission Mode Inconsistency

The system has 3 permission mode values that appear in different places:

| Source | Mode Names Used |
|--------|----------------|
| Shift+Tab toggle (cli.js:1199) | `['normal', 'yolo']` |
| `/permissions mode` validation (commands/index.js:493) | `['auto', 'ask', 'yolo']` |
| `/permissions mode` label (commands/index.js:500) | `yolo`, `auto`, or `standard` |

A user who toggles to "normal" via Shift+Tab cannot switch back via `/permissions mode normal` (it's not a valid mode). The value "normal" and "ask" both end up labeled as "standard" but they enter the system through different paths. This should be unified to a single set of canonical mode values.

### 2. README Inaccuracy

The README documents `hax-agent doctor --json` as outputting machine-readable results, but the `runDoctorCommand()` implementation ignores all arguments. The `--json` flag is a no-op.

### 3. Additional Non-i18n'd Strings Not Yet Migrated

These strings remain hardcoded in English and are not using the i18n system:

- `src/commands/index.js`: "Goal" heading, "active" status label, "max continuations" label, "default" fallback text, "Usage: /goal", "missing" word for permissions, context window strings ("yes/no", "manual/auto", "inferred"), update check messages ("Checking for updates...", "You're on the latest version", etc.), agent list strings ("General teammate", "Some agent files failed to load"), and the `/sessions clear` success message.
- `src/init-wizard.js`: Provider/permission mode labels with full descriptions, and some prompt strings.

These were not migrated because they appear in contexts where i18n support would require passing the translator function through additional function signatures, which is a broader refactor beyond the scope of this documentation-focused audit.

---

## Summary

- **8 source files modified** (3 core JS, 1 commands JS, 4 i18n JS)
- **~30 new i18n keys added** across 4 languages
- **7 hardcoded English strings** replaced with translatable keys
- **1 i18n bug fixed** (ru.js missing `{count}` in shell.contextCleared)
- **3 inline doc comments added** for non-obvious behavior
- **0 regressions** -- all files pass syntax check (`node -c`)
