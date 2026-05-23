# HaxAgent Code Style and Consistency Review

**Date**: 2026-05-23
**Scope**: All source files in `src/**/*.js` (~337 files)
**Review type**: Read-only analysis -- no files modified

---

## Overall Style Score: **62 / 100**

---

## 1. "use strict" Coverage (HIGH severity)

### Findings

- **284 of ~337 source files** (84%) have `"use strict"` at the top
- **~53 files** (~16%) are missing it entirely
- All files that include it use double-quoted form `"use strict"` (consistent)

### Files missing "use strict" include several core modules:

| File | Category |
|------|----------|
| `src/index.js` | Public API entry point |
| `src/config.js` | Central config module |
| `src/memory.js` | Core memory module |
| `src/context.js` | Context module |
| `src/i18n/index.js` | Internationalization |
| `src/i18n/en.js` | Translation dictionary |
| `src/i18n/zh-CN.js` | Translation dictionary |
| `src/i18n/zh-TW.js` | Translation dictionary |
| `src/i18n/ru.js` | Translation dictionary |
| `src/permissions.js` | Permission system |
| `src/orchestration.js` | Team orchestration |
| `src/commands/index.js` | Command handler |
| `src/commands/team.js` | Team subcommand |
| `src/commands/memory.js` | Memory subcommand |
| `src/renderer.js` | Terminal rendering |
| `src/session.js` | Session management |
| `src/tools/index.js` | Tool barrel export |
| `src/tools/error.js` | Error class |
| `src/tools/error-codes.js` | Error codes |
| `src/tools/utils.js` | Tool utilities |
| `src/runtime/*.js` (all 6 files) | Runtime subsystems |
| `src/init-wizard.js` | First-run wizard |
| `src/command-suggestions.js` | Command autocomplete |

### Impact
Without strict mode, silent errors (like assigning to undefined variables) go undetected. This is a notable risk given that these are core modules used throughout the codebase.

### Recommended fix
Add `"use strict";` to every .js file as the project's `.editorconfig` is already configured for strict Node.js. Consider adding an ESLint rule: `"strict": ["error", "global"]`.

---

## 2. Quoting Inconsistency (MEDIUM-HIGH severity)

### Node prefix `require()` calls

The project is split nearly 50/50 between single and double quotes for built-in `require()` calls:

| Pattern | Count | Files |
|---------|-------|-------|
| `require('node:path')` | 34 files, 96 usages | `src/batch.js`, `src/cli.js`, `src/export.js`, `src/hub.js`, `src/plugins.js`, `src/undo-stack.js`, etc. |
| `require("node:path")` | 31 files, 106 usages | `src/desktop-services.js`, `src/file-context.js`, `src/updater.js`, etc. |

### Bare `require()` calls

| Pattern | Count | Files |
|---------|-------|-------|
| `require('fs')` (no node: prefix) | 6 files | `src/config.js`, `src/memory.js`, `src/skills/loader.js`, `src/skills/parser.js`, `src/skills/skillify.js`, `src/skills/usage.js` |
| `require('path')` (no node: prefix) | Same 6 files | Same locations |

The 6 files using bare `require('fs')` / `require('path')` are inconsistent with the rest of the codebase which consistently uses the `node:` prefix.

### Mixed quoting within a single file

Several files use both single and double quotes:

- `src/agent-engine.js`: Uses `require("./memory")` (double) for the same module that others require as `require('./memory')` (single)
- `src/cli.js`: Mixes `require('./providers')` with template literals using backticks

### Impact
Makes the codebase feel fragmented. Automated tools (Prettier) would normalize this, but the codebase currently has no enforced formatter.

---

## 3. DRY Violations -- Copy-Pasted Utility Functions (HIGH severity)

The same helper functions are defined locally in multiple files instead of imported from a shared utility module.

### `requireString(value, name)` -- 17 files

Defined identically in:
- `src/runtime/utils.js` (canonical)
- `src/runtime/agents.js`
- `src/runtime/command-registry.js`
- `src/runtime/composition.js`
- `src/runtime/messages.js`
- `src/runtime/tasks.js`
- `src/tools/utils.js`
- `src/orchestration.js`
- `src/graph/engine.js`
- `src/coordination/dispatcher.js`
- `src/coordination/heartbeat.js`
- `src/coordination/leader.js`
- `src/contracts/negotiate.js`
- `src/debate/engine.js`
- `src/collab/messaging.js`
- `src/collab/knowledge-base.js`
- `src/collab/consensus.js`

```js
// Identical body in all 17 files:
function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
```

### `positiveInteger(value, fallback)` -- 12 files

Defined identically in:
- `src/tool-retry.js`
- `src/tool-decorators.js`
- `src/rate-limiter.js`
- `src/shutdown.js`
- `src/memory-eviction.js`
- `src/file-context.js`
- `src/resilience/retry.js`
- `src/resilience/bulkhead.js`
- `src/resilience/circuit-breaker.js`
- `src/notify/triggers.js`
- `src/notify/manager.js`
- `src/notify/channels.js`

```js
// Identical body in all 12 files:
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
```

### `requireEnum(value, options, name)` -- 4 files

Defined in `src/runtime/utils.js` and duplicated in:
- `src/runtime/agents.js`
- `src/runtime/messages.js`
- `src/runtime/tasks.js`

### `sleep(ms)` -- 5 files

Defined in `src/tool-retry.js` and duplicated in:
- `src/resilience/retry.js`
- `src/tools/web-search.js`
- `src/workflow/engine.js`
- `src/ci/pipeline.js`

### `toIsoString(value, name)` -- 3 files

Defined in `src/runtime/utils.js` and duplicated in:
- `src/runtime/sessions.js`
- `src/runtime/messages.js`

### `normalizeCommand(command)` -- 2 files

Defined in `src/tools/utils.js` and duplicated in `src/permissions.js` (with slight differences -- not identical clones, but nearly so).

### `createId(prefix)` -- duplicated

Defined in both `src/runtime/utils.js` and `src/runtime/sessions.js`.

### Impact
- Code changes must be applied in many places
- Risk of divergence (the `normalizeCommand` copies already differ slightly)
- Increases maintenance burden
- Inflates source line count with redundant code

---

## 4. Missing "use strict" in i18n dictionary files (MEDIUM severity)

All four translation files are missing `"use strict"`:
- `src/i18n/en.js`
- `src/i18n/zh-CN.js`
- `src/i18n/zh-TW.js`
- `src/i18n/ru.js`

While these are pure data files, they are still `module.exports` assignments and should be consistent.

---

## 5. Dead Code (MEDIUM severity)

### `parseListEnv()` in `src/config.js` (lines 339-350)

Defined but never exported in `module.exports` and never called anywhere in the codebase. This is 12 lines of unreachable code.

```js
function parseListEnv(env, name) {
  const value = env[name];
  if (value === undefined || value === '') return undefined;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
```

### ANSI definitions duplicated across files

The `ANSI` escape sequence object is defined in both:
- `src/renderer.js` (59 occurrences of `\x1B`)
- `src/init-wizard.js` (7 occurrences of `\x1b` -- lowercase B)

Additionally `src/cli.js`, `src/dashboard/renderer.js`, `src/session.js`, and others define their own ANSI constants. There is no single source of truth for terminal formatting.

---

## 6. ANSI Escape Code Case Inconsistency (LOW severity)

| Escape style | Files | Occurrences |
|-------------|-------|-------------|
| `\x1B` (uppercase B) | 10 files | 124 |
| `\x1b` (lowercase b) | 3 files | 16 |

`\x1B` is used in `renderer.js` while `\x1b` appears in `init-wizard.js`. Both are valid but inconsistent.

---

## 7. Catch Variable Naming Inconsistency (LOW-MEDIUM severity)

Three different conventions for catch clause variables:

| Pattern | Occurrences | Files | Convention |
|---------|------------|-------|------------|
| `catch (error)` | 50 | 32 | Explicit error handling |
| `catch (err)` | 100 | 51 | Short form, common in async/util code |
| `catch (_)` | 93 | 44 | Explicitly ignored errors |

This is actually a reasonable pattern where the choice maps to intent:
- `catch (error)` -- the error is inspected/used
- `catch (err)` -- the error is briefly referenced (e.g., `err.code`)
- `catch (_)` -- the error is intentionally discarded

However, within the same file, some mix `catch (error)` and `catch (_)` which reduces readability.

---

## 8. Console Usage in Library Code (LOW severity)

13 source files use `console.*` directly:

| Files | Notes |
|-------|-------|
| `src/cli.js` | Acceptable (CLI entry point) |
| `src/migration/validator.js` | Library code -- should use debug() |
| `src/generator/project-gen.js` | Library code |
| `src/hotreload/watcher.js` | Library code |
| `src/compat/deprecation.js` | Acceptable (deprecation warnings) |
| `src/codegen/refactoring.js` | Library code |
| `src/tutorial/progress.js`, `src/tutorial/engine.js` | Library code |
| `src/sandbox/executor.js` | Library code |
| `src/plugins/dependency.js`, `src/plugins/indexer.js` | Library code |
| `src/docs/content.js` | Library code |
| `src/events/bus.js` | Library code |

Most library files should use the `debug()` utility from `src/debug.js` instead of `console.log`.

---

## 9. Module `require()` Path Patterns (LOW severity)

### Bare `fs`/`path` (no node: prefix)

6 files use the older `require('fs')` / `require('path')` pattern instead of `require('node:fs')` / `require('node:path')`:
- `src/config.js`
- `src/memory.js`
- `src/skills/loader.js`
- `src/skills/parser.js`
- `src/skills/skillify.js`
- `src/skills/usage.js`

The rest of the codebase uses the `node:` prefix. The Node.js documentation recommends the `node:` prefix since Node.js 14.18+.

---

## 10. File Sizes (MEDIUM severity)

The largest source files:

| File | Lines | Concern |
|------|-------|---------|
| `src/cli.js` | 1,370 | Excessive -- combines CLI parsing, session setup, tools, batch mode, and interactive REPL |
| `src/renderer.js` | 1,024 | Large but focused on rendering |
| `src/desktop-services.js` | 716 | Combined desktop services |
| `src/session-utils.js` | 504 | Session utilities |
| `src/agent-engine.js` | 486 | Agent engine |
| `src/orchestration.js` | 454 | Team orchestration |
| `src/hub.js` | 418 | Agent hub/factory |
| `src/file-context.js` | 411 | File context indexing |

`src/cli.js` is the biggest concern. It handles CLI argument parsing, batch mode, interactive REPL loop, command dispatch, prompt rendering, input history, and more -- at 1,370 lines, it should be split into smaller modules.

---

## 11. Code Style Positives (What's Good)

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Semicolon usage** | Excellent | Consistent semicolons at end of statements throughout. No reliance on ASI. |
| **Indentation** | Excellent | Consistent 2-space indentation matching `.editorconfig`. |
| **File naming** | Excellent | Consistent kebab-case (`agent-engine.js`, `file-context.js`). No camelCase or snake_case files. |
| **CommonJS pattern** | Excellent | Consistent `module.exports = { ... }` pattern. No ESM mix. Only 5 files use `exports.xxx =` shorthand. |
| **Module organization** | Good | Clean directory structure mirroring feature domains. Test directory mirrors source. |
| **Error handling** | Good | Well-defined `ToolExecutionError` with error codes in `tools/error-codes.js`. Codebase offers structured error propagation. |
| **Object.freeze usage** | Good | Enums and constants frozen with `Object.freeze()` in 68 files (151 occurrences). Consistent pattern. |
| **JSDoc comments** | Good | Core modules (`config.js`, `agent-engine.js`, `batch.js`, `plugins.js`, etc.) have high-quality JSDoc. |
| **Numeric literals** | Good | Uses underscore separators (`52_428_800`, `512_000`) for readability. |
| **Template literals** | Good | Consistent use of backtick template strings for dynamic strings. |

---

## 12. Naming Convention Summary

| Convention | Consistency | Notes |
|------------|------------|-------|
| File names | Consistent | kebab-case throughout |
| Class names | Consistent | PascalCase (`AgentEngine`, `PluginRegistry`, `ShutdownManager`) |
| Function names | Consistent | camelCase (`resolveSettings`, `createProvider`) |
| Constants | Consistent | SCREAMING_SNAKE_CASE (`DEFAULT_SETTINGS`, `MAX_TREE_DEPTH`) |
| Event types | Consistent | dot-separated (`turn.started`, `tool.start`) |
| Error codes | Consistent | SCREAMING_SNAKE_CASE (`INVALID_ARGUMENT`, `PATH_NOT_FOUND`) |
| Module filenames vs directory names | Minor gap | Some modules have both a file and directory of the same name (`src/plugins.js` + `src/plugins/`, `src/memory.js` + `src/memory/`) |

---

## Top 5 Style Improvements (Priority Order)

### 1. Add `"use strict"` to all ~53 files missing it
Add `"use strict";` as the first line of every `.js` file. Configure ESLint to enforce this: add `"strict": ["error", "global"]` to `.eslintrc.json`.

### 2. Consolidate duplicated utility functions into a shared module
Move `requireString`, `positiveInteger`, `requireEnum`, `sleep`, `toIsoString`, `createId`, and `normalizeCommand` into a single shared utility module (e.g., `src/utils/helpers.js`) and import them instead of copy-pasting. This would eliminate approximately 17+12+4+5+3+3+2 = 46+ duplicate function definitions.

### 3. Adopt a consistent quoting style with an auto-formatter
Choose single quotes for all `require()` calls and normal strings, reserving double quotes only for strings containing single quotes. After adopting a consistent style, enforce with Prettier or ESLint's `--fix`. This would resolve the ~96 vs ~106 split in `node:` prefix quoting.

### 4. Remove dead code (`parseListEnv`) and abandon inline console.log in library files
Delete `parseListEnv()` from `src/config.js` (not exported, never called). Replace `console.log` in library files with the `debug()` utility from `src/debug.js`.

### 5. Break `src/cli.js` into smaller modules
Split the 1,370-line CLI monolith into:
- `src/cli/args.js` -- argument parsing
- `src/cli/repl.js` -- REPL loop
- `src/cli/commands.js` -- command dispatch (replacing `src/commands/index.js`)
This would improve readability and testability.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total source files | ~337 |
| Files with `"use strict"` | 284 (84%) |
| Files missing `"use strict"` | ~53 (16%) |
| Files using single-quote `node:` require | 45 |
| Files using double-quote `node:` require | 45 |
| Files with bare `require('fs')` | 6 |
| Duplicated `requireString` definitions | 17 |
| Duplicated `positiveInteger` definitions | 12 |
| Duplicated `requireEnum` definitions | 4 |
| Duplicated `sleep` definitions | 5 |
| Dead code instances found | 1 confirmed (`parseListEnv`) |
| Console.log in library code | ~12 files |
| Largest source file | `src/cli.js` (1,370 lines) |

---

## Style Score Breakdown

| Category | Weight | Score | Notes |
|----------|--------|-------|-------|
| "use strict" consistency | 15% | 8/15 | 84% coverage; core modules missing it |
| Quoting consistency | 15% | 7/15 | Near 50/50 split; mixed in same files |
| DRY / code reuse | 15% | 5/15 | Heavy copy-pasting of utility functions |
| Naming conventions | 10% | 10/10 | Consistent and clear |
| Error handling patterns | 10% | 8/10 | Good structure; catch var naming is varied |
| Module/export patterns | 10% | 9/10 | Consistent CommonJS; minor `exports.xxx` outliers |
| Comment quality | 10% | 7/10 | Core docs are good; some modules sparse |
| Formatting (semicolons, indent) | 10% | 10/10 | Excellent consistency |
| File size / complexity | 5% | 3/5 | `cli.js` is a monolith; `renderer.js` large |
| **Total** | **100%** | **62/100** | -- |
