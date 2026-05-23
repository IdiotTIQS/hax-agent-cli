# Documentation & Developer Experience (DX) Review

**Date:** 2026-05-23  
**Project:** HaxAgent CLI v1.4.1 (E:/HaxAgent)  
**Scope:** README, JSDoc, error messages, i18n, CLI help, examples, public API, onboarding  
**Prior audit context:** A docs-report was written on 2026-05-22 covering some CLI help, error message, and i18n fixes. This review builds on that and evaluates the _current_ state.

---

## Overall DX Score: **65 / 100**

| Category | Score | Weight |
|----------|-------|--------|
| README Accuracy & Completeness | 80 | 15% |
| Inline Documentation / JSDoc | 72 | 15% |
| Error Messages | 68 | 15% |
| i18n Coverage | 55 | 15% |
| CLI Help Text | 60 | 10% |
| Examples | 85 | 10% |
| Public API Reference | 55 | 10% |
| Onboarding | 50 | 10% |

---

## 1. README.md -- Accuracy, Completeness, Getting Started

**Score: 80/100**

### Strengths
- Two fully-translated versions (zh-CN primary, en), both content-complete.
- Clean table of contents, badges, feature list, usage examples, architecture tree, and env-var reference table.
- Configuration section covers all 5 priority levels with a working JSON example.
- Skills system section is thorough with SKILL.md format specification.
- Architecture overview maps source files to their responsibilities in a table.

### Issues Found

**A) Factual inaccuracies**
- README documents `hax-agent doctor --json` as producing machine-readable output, but `runDoctorCommand()` in `src/cli.js` ignores the `--json` flag entirely. The flag is a no-op.
- Architecture tree in README lists `src/runtime/utils.js` which does not exist. The actual file at `src/runtime/utils.js` is a recently added module that doesn't appear in the tree at all.

**B) Missing interactive commands in the README table**
- `/undo` and `/redo` have i18n keys (`cmd.undo`, `cmd.redo`) and are implemented in the shell, but are NOT listed in the README's interactive commands table.
- `/export` (for session export to md/json/text) exists in i18n but is also missing from the README table.
- `/cache` alias for `/context` is not mentioned.

**C) Missing sections**
- No **Troubleshooting** section. Common failure modes (API key not set, model not found, Node.js version issues, path escaping errors) are not documented.
- No **FAQ**. Questions like "How do I use a custom OpenAI-compatible endpoint?", "How do I increase the context window?", "How do I recover a lost session?" are not addressed.
- No **Limitations** section. Max file size, max transcript length, supported Node.js versions, concurrency limits.
- No **Security considerations** section explaining the sandbox model, what the permissions system does vs does not protect against.

**D) Getting started gaps**
- Only shows `npm install -g`; no `npx` alternative for one-shot usage.
- Does not explain that the first launch auto-triggers the init wizard. Users may be confused if they set env vars first.
- No screenshot or asciicast of what the shell looks like after startup.

---

## 2. Inline Documentation -- JSDoc Quality, WHY vs WHAT

**Score: 72/100**

### Strengths
- High JSDoc presence: **4,933 occurrences across 232 files** -- every major module has at least some documentation.
- `src/tools/error-codes.js` is exemplary: 35 error codes organized by category with clear inline descriptions of when each fires.
- `src/batch.js` has excellent JSDoc with `@param`, `@returns`, and a file-level docblock explaining batch mode usage and behavior.
- Newer sub-modules under `src/` (e.g., `examples/hub-usage.js`, `examples/workflows/README.md`) are very well-documented with step-by-step walkthroughs.

### Issues Found

**A) JSDoc describes WHAT, not WHY**
- Many JSDoc comments repeat the function name: `/** Create a session */ function createSession(...)` -- these add no value beyond the signature.
- Few modules explain _design rationale_: why is `orchestration.js` structured as a set of factory functions rather than classes? Why does `agent-engine.js` use an event-stream pattern?
- `src/config.js` has only 4 JSDoc tags total across 350+ lines. Key functions like `resolveSettings()`, `mergeConfigs()`, and `applyEnvOverrides()` are undocumented.

**B) Missing docs on public APIs**
- `src/index.js` (the module entry point) has zero JSDoc. It exports ~35 symbols through a mix of named exports and spread operators from sub-modules. A developer reading this file cannot determine what each export does without tracing into 10+ sub-modules.
- The `hub.js` integration API (`createAgent()`) is well-documented internally but not referenced from `index.js` or README.

**C) Key undocumented modules**
- `src/agent-engine.js`: The `AgentEngine` class constructor and `sendMessage()` (the primary public method) have no JSDoc. Only the `AgentEventType` enum has basic comments.
- `src/session.js`: `Session` constructor, `startTurn()`, `endTurn()` are undocumented.
- `src/renderer.js` (31KB): Rich terminal rendering library with no file-level description, no JSDoc on public functions.
- `src/permissions.js`: No JSDoc on the permission check pipeline.

**D) No CLAUDE.md or developer guide**
- The project has no `CLAUDE.md`, `ARCHITECTURE.md`, or `INTERNALS.md` to help a new developer understand the codebase structure, data flow, or design decisions.
- With 100+ subdirectories under `src/`, a developer has no guidance on where to start reading or how the modules connect.

### Top files needing documentation (in priority order):
1. `src/cli.js` -- 48KB entry point, minimal JSDoc
2. `src/config.js` -- key config resolver, 4 JSDoc tags
3. `src/agent-engine.js` -- core agent loop, sparse comments
4. `src/index.js` -- public API surface, zero docs
5. `src/renderer.js` -- 31KB rendering engine, no file-level docs

---

## 3. Error Messages -- Clarity, Actionability, Consistency

**Score: 68/100**

### Strengths
- **Tools layer (excellent):** All tool errors use a single `ToolExecutionError(code, message, details)` class with **35 standardized error codes** in `src/tools/error-codes.js`. Each code is documented with when it fires. This gives the AI model predictable error shapes to reason about.
- Error codes are organized into categories: Validation, File-System, File-Edit, Shell, Web, Stock, Registry, Fallback.
- Tool error messages are consistently actionable: `"Path does not exist: ${filePath}"`, `"Content exceeds maxBytes (${maxBytes})"`, `"Parent path is not a directory: ${dirname}"`.
- The i18n system provides translated versions of all user-facing error strings for the interactive shell.

### Issues Found

**A) CLI-layer errors are inconsistent**
- `console.error('Session not found.')` in `runResumeCommand()` does not tell the user which session ID was not found, where sessions are stored, or what to do next (try `hax-agent sessions` to list).
- `console.error('Failed to list models: ${err.message}')` exposes raw error messages that may be API-provider-specific and not user-friendly.
- `console.error('Failed to initialize: ${err.message}')` -- no guidance on whether the config file was corrupted, what file to check, or how to re-run `hax-agent init`.

**B) Hardcoded English errors outside i18n**
- Batch mode (`src/batch.js`): All 6 error messages are hardcoded English (`'Error reading input file'`, `'Error writing output file'`, etc.). Batch mode has no i18n support at all.
- CLI top-level commands (`runConfigCommand()`, `runResumeCommand()`, `runSessionsCommand()`): Output like `'Current configuration:'`, `'Session not found.'`, `'No previous sessions found.'` are hardcoded English, not routed through the i18n system.
- Fatal error handler in `cli.js:1347-1365`: Uses hardcoded English with embedded ANSI codes (`'\n\x1B[91mFatal error:\x1B[0m'`).

**C) Error messages describe the problem but not the solution**
- `'Unknown command: ${primary}'` tells the user they typed something wrong. It also suggests a correction. But it does not tell them how to see all valid commands (`hax-agent help` or `/help`).
- `'Failed to initialize: ${err.message}'` -- good error context but no path forward.
- `'Could not verify connection. You can still save and test later with hax-agent doctor.'` -- this is actually a good example of an actionable message that the init wizard uses.

**D) Provider error surface is inconsistent**
- `src/providers/anthropic-provider.js`, `openai-provider.js`, `google-provider.js` each throw errors in different shapes. Some wrap in custom errors, some let SDK errors propagate raw. This means the error UX differs by provider.
- There is no centralized error serialization for provider errors (unlike the excellent tool error serialization).

---

## 4. i18n Coverage -- Hardcoded Strings, Missing Translations

**Score: 55/100**

### Current State

| Language | Keys Translated | Coverage (of en keys) |
|----------|----------------|----------------------|
| `en` | 419 | 100% (reference) |
| `zh-CN` | 419 | 100% |
| `zh-TW` | ~95 (+ zh-CN fallback) | ~23% own keys |
| `ru` | ~120 (+ en fallback) | ~29% own keys |

### Strengths
- Clean architecture: `src/i18n/index.js` provides `createTranslator()`, `normalizeLocale()`, `listLocales()`.
- `zh-TW` inherits from `zh-CN` via spread operator, so it only overrides Simplified Chinese terms that differ in Traditional Chinese. Unlisted keys fall through to zh-CN, not English.
- `ru` inherits from `en` similarly.
- The interactive shell (`runShell()` in cli.js) uses `t()` for ~20 user-facing messages (permission prompts, shell status, clipboard, etc.).
- Desktop UI strings are fully covered across all 4 languages -- the i18n key list includes ~200+ desktop-specific keys.

### Issues Found

**A) CLI top-level commands are entirely non-i18n'd**
Every command handler in `src/cli.js` outside `runShell()` outputs hardcoded English:
- `runConfigCommand()`: `'Current configuration:'`, `'not set'`, `'********'`, `'default'`, config labels
- `runResumeCommand()`: `'Session not found.'`
- `runSessionsCommand()`: `'No previous sessions found.'`, `'Run "hax-agent sessions clear" to delete all sessions.'`
- `runModelsCommand()`: error messages
- `runHelpCommand()`: all 20+ lines of help text
- Error handler at line 166-173: `'Unknown command:'`, `'Did you mean:'`, `'Usage:'`

These are the first things a non-English user sees when running `hax-agent help`, `hax-agent config`, etc.

**B) Incomplete translations in zh-TW and ru**
- Russian (`ru.js`, 120 keys): Missing approximately 299 keys compared to `en.js`. Key gaps include:
  - Shell: `shell.filesModified`, `shell.copyNoResponse`, `shell.copySuccess`, `shell.copyFailed`, `shell.renameNoName`, `shell.renameSuccess`
  - Skills: all `skills.*` keys
  - Commands: `cmd.skillify`, `cmd.goal`, `cmd.context`, `cmd.copy`, `cmd.rename`, `cmd.status`, `cmd.undo`, `cmd.redo`, `cmd.export`
  - Help shortcuts: `help.ctrlR`, `help.ctrlArrow`, `help.tab`, `help.shiftTab`, `help.bang`
  - Desktop UI: vast majority of `desktop.*` keys simply fall through to English
  - Tool descriptions: `permission.desc.*` unlocalized
- Traditional Chinese (`zh-TW.js`, 95 keys): Similar gaps, though slightly less severe since it falls through to zh-CN (not English). Still, approximately 75% of strings display in Simplified Chinese for traditional users.

**C) init-wizard.js strings are hardcoded**
- The initialization wizard (`src/init-wizard.js`, 16KB) contains dozens of user-facing strings. Some appear to use the i18n system but many do not. The `init.*` keys exist in en/zh-CN but coverage is inconsistent.
- `init.quickMode`, `init.quickModeActive`, `init.testingConnection`, `init.connectionOk`, `init.connectionFailed` exist only in `en.js` but not all i18n files.

**D) No i18n audit tooling**
- There is no script to check which keys are used in source code vs defined in translation files, or to detect missing translations.
- Adding a new user-facing string requires manually adding it to up to 4 files with no automated verification.

**E) Desktop UI i18n gap**
- The desktop app has its own translation layer for Vue components. It's unclear whether the Vue i18n system uses the same key namespace or a separate one -- this creates risk of drift between CLI and desktop translations.

---

## 5. CLI Help Text -- Accuracy, Discoverability, Formatting

**Score: 60/100**

### Strengths
- `hax-agent help` groups commands into logical sections (though without visible headers).
- Covers all top-level commands and options (--batch, --model, --no-color, --debug).
- Includes presets listing via `--preset`.
- Error messages suggest corrections via `command-suggestions.js` (Levenshtein distance).

### Issues Found

**A) Help is not i18n'd**
All 20+ lines of `hax-agent help` output are hardcoded English with no `t()` calls.

**B) Missing commands from help**
- `hax-agent undo` and `hax-agent redo` are NOT shown in the top-level help, though the interactive shell supports `/undo` and `/redo`.
- `hax-agent export` is not shown.
- `hax-agent --raw` and `hax-agent --no-raw` (batch flags documented in examples/batch/README.md) are not shown in CLI help.
- `hax-agent --preset` is shown but the list of preset names is only shown if the user explicitly runs with a bad preset name.

**C) Help text format lacks hierarchy**
The current help is a flat list:
```
hax-agent [chat]               Start interactive shell (default)
hax-agent init                 Run first-time setup wizard
...
```
No section headers like "CHAT & SESSION" or "SETUP & CONFIG" are displayed, even though the code groups them logically. Without section headers, a flat list of 17 entries is harder to scan.

**D) Interactive `/help` command**
- The interactive shell's `/help` command shows the commands table and keyboard shortcuts. This IS using i18n (checked: `help.commands`, `help.shortcuts`, `help.ctrlC`, etc.).
- However, it does not show argument syntax (e.g., `/resume <session-id>`, `/permissions mode <auto|ask|yolo>`), only one-line descriptions.
- The `/help` output would benefit from showing the same grouping as `hax-agent help`.

**E) No `hax-agent --help` for subcommands**
- `hax-agent team --help` does not exist; `hax-agent team` with no args shows usage, but `hax-agent team abc --help` gives "Unknown command: abc".
- Similarly, `hax-agent sessions --help`, `hax-agent config --help` are not supported.

---

## 6. Examples -- Quality and Completeness

**Score: 85/100**

### Strengths
- **4 well-organized example directories:** `batch/`, `memory/`, `plugins/`, `workflows/`
- **Each has a comprehensive README.md:** The batch README explains single-turn vs multi-turn input, CLI flags, exit codes. The plugins README explains plugin shape, lifecycle hooks, and includes a hook reference table. The workflows README documents 6 team patterns with when-to-use guidance.
- **Working, well-commented code:**
  - `hub-usage.js` -- step-by-step walkthrough with inline comments explaining each stage
  - `plugins/file-backup-plugin.js`, `logger-plugin.js`, `rate-limit-plugin.js` -- 3 real, runnable plugin examples
  - `workflows/pipeline-example.js`, `review-loop-example.js`, `orchestrator-example.js` -- implement concrete patterns
- **`examples/memory/sample-workflow.sh`** -- bash script demonstrating memory CRUD operations
- All examples use `"use strict"` and follow consistent code style.

### Issues Found

**A) Missing example types**
- No **"hello world"** minimal example (simplest possible agent invocation).
- No **CI/CD integration** example (GitHub Actions workflow using batch mode).
- No **custom tool** example (how to add a tool to the registry programmatically).
- No **custom provider** example (how to register a new LLM provider).
- No **programmatic API** example using `require('hax-agent-cli')` from another Node.js project.

**B) Example README prose mixed English/Chinese**
- `examples/workflows/README.md` and `examples/batch/README.md` are in English. Some other examples may benefit from zh-CN versions.

**C) Examples not referenced from main README**
- The main README does not point to the `examples/` directory. A user discovering the project through the README would not know these examples exist.

**D) No test-like verification of examples**
- There is no CI step that runs `node examples/hub-usage.js` (or similar) to verify examples stay working across changes.

---

## 7. Public API Reference -- Exports Clarity, Documentation

**Score: 55/100**

### Current State
`src/index.js` exports ~35 symbols via a flat object:

```js
module.exports = {
  config, context, fileContext, memory, basicRuntime,
  ...orchestration, ...basicRuntime,         // potential collisions
  ...agentTeams, ...teamAgents, ...teamTools,
  ...agentTeamFormatters,
  createAuthRefactorTeam, formatTeamPlan,
  UndoStack, PluginRegistry, PLUGIN_HOOK_NAMES,
  runBatchMode, exportSessionToMarkdown, ...,
  createRetryableTool, persistGoal, restoreGoal,
  compactMessages, ..., getPreset, listPresets, ...,
  summarizeSession, listSummaries, getSessionTimeline,
};
```

### Issues Found

**A) Spread operators hide the actual API surface**
- `...orchestration` and `...basicRuntime` both use spread -- if they export identically-named keys, one silently overwrites the other.
- A consumer cannot determine what `require('hax-agent-cli')` provides without reading 6+ sub-module entry points.

**B) No JSDoc on the module**
- The entry point has zero JSDoc. There is no `@module` declaration, no listing of exports with descriptions.
- Key functions like `createSession()`, `createAgent()` (from hub), `compactMessages()` are not described.

**C) public-api.test.js is minimal**
- Tests only 5 assertions: that `basicRuntime` is an object and that `Session`, `createSession`, `TaskList`, `CommandRegistry` are exposed under it.
- Does not test any other exported function or class.

**D) Hub API not exported from index.js**
- `src/hub.js` provides `createAgent()` (the highest-level integration API) but it is NOT exported from `src/index.js`. Users must `require('hax-agent-cli/src/hub')` with a deep import.

**E) No TypeScript type definitions**
- No `.d.ts` files or JSDoc-based type generation. IDE autocomplete for consumers is non-existent.

**F) No versioned API stability policy**
- There is no documentation of which exports are stable/public vs internal/private. A consumer has no way to know if `compactMessages` will change signature in a minor version.

---

## 8. Onboarding -- New Developer Experience

**Score: 50/100**

### Can a new developer understand the project in 30 minutes?

**Probably not.** Here is what a new developer encounters:

1. **No CLAUDE.md, CONTRIBUTING.md, or CODE_OF_CONDUCT.md.** The README has a short "Development & Contributing" section but it only covers fork/commit/PR mechanics.
2. **The project has 100+ subdirectories under `src/`.** Without an architecture guide, a developer must brute-force explore to understand the module relationships.
3. **The README architecture tree is helpful** but shows only ~60 of the 100+ directories. Newer modules (`capability/`, `compliance/`, `debate/`, `explain/`, etc.) are absent from the tree entirely.
4. **No development environment setup guide.** What Node.js version is tested against? What editor config is used? How to run specific test files?
5. **Test suite is large** (70+ test files) but no guidance on which tests to run after which changes.
6. **No data flow diagram.** How does a user message flow from `cli.js` through `agent-engine.js` to `providers/` and back through `renderer.js`? A sequence diagram would help enormously.
7. **The `.editorconfig` and `.eslintrc.json` exist but are minimal.** No Prettier config, no lint-staged, no commitlint.

### What would help:
- A `CLAUDE.md` with: project purpose, directory map, key files to read first, how to run and test, architecture decision records.
- A data flow diagram or sequence diagram.
- A "contributing your first feature" walkthrough.
- Module-level READMEs in the most complex subdirectories (e.g., `src/teams/`, `src/providers/`).

---

## Top 5 DX Improvements

### 1. Write a CLAUDE.md / Developer Guide (Priority: Critical)
Create a `CLAUDE.md` at the project root covering:
- Project purpose and architecture overview
- Directory map with descriptions of every top-level `src/` subdirectory
- Key files to read first (config.js -> cli.js -> agent-engine.js -> session.js)
- How to run, test, lint, and debug
- Data flow: user input -> CLI parser -> session -> agent engine -> provider -> renderer
- Common development tasks (adding a new slash command, adding a new tool, etc.)
- **Estimated effort:** 2-3 hours. **Impact:** High -- cuts onboarding from hours to 30 minutes.

### 2. i18n-ify CLI Top-Level Commands (Priority: High)
All command handlers in `src/cli.js` outside `runShell()` output hardcoded English. These should use the existing i18n system by passing a translator to command handlers.
- Add i18n keys for: config display labels, session listing, model listing, help text, error messages.
- Create a shared `createCliTranslator()` that reads locale from settings/env without needing a session.
- **Estimated effort:** 3-4 hours. **Impact:** High -- 4 languages become first-class for all CLI commands.

### 3. Document the Public API (Priority: High)
- Add JSDoc with `@module`, `@typedef`, and descriptions to `src/index.js`.
- Export hub's `createAgent()` from `src/index.js` so consumers can use the high-level API.
- Mark exports as `@public` or `@private` / `@internal` to establish API stability expectations.
- Expand `public-api.test.js` to test all 35+ exports.
- **Estimated effort:** 2-3 hours. **Impact:** High -- enables programmatic usage with confidence.

### 4. Standardize Provider Error Handling (Priority: Medium)
- Create a `ProviderError` class (parallel to `ToolExecutionError`) with standardized codes like `AUTH_FAILED`, `RATE_LIMITED`, `MODEL_NOT_FOUND`.
- Have each provider implementation (`anthropic-provider.js`, `openai-provider.js`, `google-provider.js`) catch SDK errors and wrap them in `ProviderError`.
- This gives the agent engine consistent error shapes to present to users regardless of provider.
- **Estimated effort:** 2-3 hours. **Impact:** Medium-High -- eliminates inconsistent provider error UX.

### 5. Complete zh-TW and ru i18n Coverage (Priority: Medium)
- The Russian translation file covers only ~120 of 419 keys. Fill in the remaining ~299 keys (many of which are desktop UI strings that currently display in English).
- The Traditional Chinese file covers only ~95 of 419 keys (falling back to Simplified via zh-CN inheritance). While less urgent than Russian, add Traditional Chinese for the most visible strings (commands, help, shell).
- Add a script (`scripts/check-i18n.js`) to detect missing translation keys by comparing `en.js` against all other language files.
- **Estimated effort:** 4-5 hours for ru (full), 2-3 hours for zh-TW (essential keys only), 1 hour for audit script. **Impact:** Medium -- makes the CLI fully usable for Russian and Traditional Chinese speakers.

---

## Summary of Findings

| Finding | Severity | Count |
|---------|----------|-------|
| README inaccuracies (doctor --json, missing commands) | Medium | 3 |
| README missing sections (Troubleshooting, FAQ, Security) | Medium | 3 |
| JSDoc describes WHAT not WHY | Low-Medium | Widespread |
| Key public APIs undocumented (index.js, agent-engine.js, config.js) | High | 5 files |
| CLI errors hardcoded English (not i18n) | High | ~15 strings |
| zh-TW translations incomplete (~23% own keys) | Medium | ~324 keys |
| ru translations incomplete (~29% own keys) | High | ~299 keys |
| CLI help not i18n'd | Medium | All help text |
| CLI help missing subcommand --help | Low | 3 subcommands |
| Examples not referenced from main README | Low | 4 directories |
| Spread operators in index.js mask exports | Medium | 1 critical file |
| No CLAUDE.md or developer onboarding guide | High | Missing |
| No API stability policy or type definitions | Medium | Missing |

**Overall assessment:** The project has strong bones -- well-organized code, consistent tool error handling, good test coverage, and excellent examples. The primary DX weaknesses are in the public-facing layers: the main entry point is undocumented, i18n is incomplete for 2 of 4 languages, CLI commands outside the interactive shell are hardcoded in English, and there is no developer onboarding documentation. Addressing the top 5 recommendations would raise the DX score from **65 to approximately 82**.
