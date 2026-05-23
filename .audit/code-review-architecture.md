# HaxAgent Architecture Review

**Date:** 2026-05-22
**Version Reviewed:** 1.4.1
**Scope:** Full project (src/, desktop/, examples/, test/, test-helpers/)
**Total Source Files:** ~250 JS files across 75+ modules

---

## 1. Module Dependency Map

```
                          ┌──────────────┐
                          │    cli.js    │  (1370 lines — entry point / "god object")
                          └──────┬───────┘
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
   ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
   │   hub.js     │     │  commands/   │      │   config.js  │
   │ (composition │     │  index.js    │      │              │
   │    root)     │     │ definitions  │      │              │
   └──────┬───────┘     │ memory.js    │      └──────┬───────┘
          │             │ team.js      │             │
          │             │ autocomplete │             ▼
          │             └──────────────┘    ┌──────────────┐
          │                                 │   config/    │
          │                                 │ schema.js    │
          │                                 │ migration.js │
          │                                 │ interactive  │
          │                                 └──────────────┘
          │
    ┌─────┴──────────────────────────────────────────────┐
    │                                                     │
    ▼                     ▼                      ▼        ▼
┌─────────┐    ┌──────────────────┐    ┌──────────────────────┐
│providers│    │   tools/         │    │   session.js          │
│factory  │    │   registry.js    │    │   memory.js           │
│anthropic│    │   file-read.js   │    │   permissions.js      │
│openai   │    │   file-write.js  │    │   renderer.js         │
│google   │    │   shell.js       │    └──────────────────────┘
│mock     │    │   web-fetch.js   │
│chat     │    │   (11 tools)     │
└─────────┘    │   error-codes.js │
               │   error.js       │
               └──────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │              New / Enhanced Subsystems                   │
    ├──────────────┬──────────────┬───────────────────────────┤
    │  safety/     │  security/   │  resilience/              │
    │  scanner     │  audit-log   │  circuit-breaker          │
    │  rules-engine│  content-policy│ retry                   │
    │  redaction   │  input-sanit │  bulkhead                 │
    ├──────────────┼──────────────┼───────────────────────────┤
    │observability │  injection/  │  plugins/ + plugins.js    │
    │ metrics      │  detector    │  dependency, indexer,     │
    │ tracer       │  monitor     │  repository, validator    │
    │ logger       │  sanitizer   │                           │
    ├──────────────┼──────────────┼───────────────────────────┤
    │  analytics/  │  compat/     │  runtime/ + runtime/utils │
    │  benchmark/  │  compliance/ │  agents, sessions, tasks, │
    │  dashboard/  │  sandbox/    │  messages, command-reg.   │
    └──────────────┴──────────────┴───────────────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │              Feature Modules (75+ total)                 │
    ├──────┬──────┬──────┬──────┬──────┬──────┬───────────────┤
    │teams │skills│debate│collab│graph │ i18n │goals/memory   │
    │agents│loader│engine│consen│engine│zh/en │history/tracker│
    │tools │regist│format│knowle│query │/ru   │...            │
    │auth-r│ skill│scorin│messag│build │/tw   │               │
    │...   │ ...  │...   │...   │...   │addit │               │
    └──────┴──────┴──────┴──────┴──────┴──────┴───────────────┘
```

### Dependency Flow Summary

| Layer | Modules | Dependencies |
|-------|---------|-------------|
| Entry | `cli.js` | config, providers, tools, commands, plugins, teams, session, permissions, skills, renderer, i18n, debug, updater, memory, batch, desktop-services |
| Composition | `hub.js`, `index.js` | Wiring layer — composes subsystems |
| Domain | `providers/`, `tools/`, `session.js`, `memory.js` | Core business logic |
| Cross-cutting | `safety/`, `security/`, `observability/`, `resilience/`, `plugins/` | Independent of domain; consumed by composition layer |
| Feature | `teams/`, `skills/`, `debate/`, `collab/`, `graph/`, `goals/`, etc. | Each mostly self-contained with some cross-references |

---

## 2. Design Issues by Severity

### CRITICAL

**C-1: Massive Code Duplication of Utility Functions**

The following functions are duplicated identically (or near-identically) across many files:

| Function | Duplicated In | Count |
|----------|--------------|-------|
| `requireString()` | collab/consensus.js, collab/messaging.js, collab/knowledge-base.js, coordination/dispatcher.js, coordination/heartbeat.js, coordination/leader.js, contracts/negotiate.js, debate/engine.js, graph/engine.js, orchestration.js, runtime/agents.js, runtime/command-registry.js, runtime/composition.js, runtime/messages.js, runtime/tasks.js, tools/utils.js | **16 files** |
| `positiveInteger()` | file-context.js, memory-eviction.js, notify/triggers.js, notify/manager.js, notify/channels.js, rate-limiter.js, resilience/retry.js, resilience/bulkhead.js, resilience/circuit-breaker.js, shutdown.js, tool-decorators.js, tool-retry.js | **12 files** |
| `normalizeError()` | orchestration.js, agent-engine.js, session-utils.js | **3 files** |
| `escapeRegExp()` | tools/utils.js, safety/redaction.js, security/input-sanitizer.js | **3 files** |

A `runtime/utils.js` was created to consolidate `requireString`/`requireEnum`/`createId`/`toIsoString`, but **none of the 16 files that duplicate these functions actually import from it**. The utility file exists but is entirely unused by its peers.

**C-2: `cli.js` is a God Object (1370 lines)**

`src/cli.js` contains tightly interleaved concerns:
- Command-line argument parsing
- Shell/readline UI management (prompts, keybindings, raw mode)
- Vim mode implementation (normal/insert state, commands)
- Reverse-i-search (Ctrl+R) with inline display
- Bracketed paste handling
- Permission mode switching UI
- Update checking and auto-install
- Session lifecycle (create, resume, exit)
- Batch mode dispatch
- First-run initialization logic
- File change summarization on exit
- Error handler setup (uncaughtException, unhandledRejection)
- All subcommand handlers (init, models, agents, team, config, resume, sessions, doctor)

The `runShell()` function alone is ~900 lines and handles UI, input processing, streaming, paste detection, command dispatch, and exit logic. This makes testing, reasoning about, and modifying any single concern extremely difficult.

**C-3: Inconsistent Error Handling Across Module Boundaries**

- `tools/` layer uses `ToolExecutionError` with standardized error codes from `tools/error-codes.js` (excellent pattern)
- `runtime/` layer throws generic `new Error(...)` or `new TypeError(...)` — no error codes
- `safety/` and `security/` modules return result objects `{ passed, violations }` — no exceptions thrown
- `providers/` layer uses both patterns inconsistently
- `orchestration.js` and `agent-engine.js` each define their own `normalizeError()` function

Callers cannot reliably catch or classify errors across module boundaries.

### HIGH

**H-1: `session.js` Mixes Unrelated Concerns**

The Session module (`src/session.js`) bundles:
- `InputHistory` class (CLI input history with search)
- `CostTracker` class (token counting and cost calculation with hardcoded pricing)
- `Session` class (message management, tool execution orchestration, streaming)

These three classes serve entirely different purposes and should live in separate modules: an input-history module, a cost-tracker module, and the session module proper.

**H-2: Export Functions Have 90% Code Duplication**

`src/export.js` defines three export functions (`exportSessionToMarkdown`, `exportSessionToJson`, `exportSessionToText`) that share identical structure:
1. Lookup session by ID (same 6 lines)
2. Read metadata and entries (same 4 lines)
3. Build output (different formatting)
4. Write to file (same 4 lines)

The common logic should be extracted into a shared helper.

**H-3: Plugin/Module Loading Uses Different Patterns**

Two different lazy-loading patterns coexist:
- `hub.js`: Uses `_requireSafe()` with try/catch fallback to `null`
- `plugin-validator.js`: Uses direct `require()` with try/catch
- `plugins/indexer.js`: Uses dynamic `require()` wrapped in try/catch (but caches results differently)
- `skills/loader.js`: Has its own loading logic

No shared "dynamic module loader" abstraction exists, despite several modules implementing near-identical logic.

**H-4: Hardcoded Provider Pricing in Session Module**

`CostTracker` in `session.js` contains a hardcoded pricing table (`this.pricing`) for 13+ models. This data should live in a configuration file or be fetched from a provider metadata endpoint. Every model addition/removal requires source code changes.

**H-5: `config.js` resolveSettings Depends on Side Effects**

The config resolution process reads from multiple filesystem sources (user config, project config, explicit path, env vars) and mutates internal state during resolution (`sources.push(...)`). While the final result is deterministic, the resolution logic is tightly coupled to filesystem I/O, making it hard to test without mocking the filesystem.

### MEDIUM

**M-1: Inconsistent `'use strict'` Directives**

Some files use `"use strict"`, some use `'use strict'`, and many omit it entirely. The project should standardize on one form (or rely on ES module strict mode if migrating to ESM).

**M-2: Inconsistent `node:` Prefix on Core Modules**

Some files use `require('node:fs')` while others use `require('fs')`. About 30% use the `node:` prefix; 70% do not. This should be standardized.

**M-3: Test Directory Mirrors src/ Nearly 1:1**

The `test/` directory has an almost identical directory tree to `src/` (50+ test subdirectories). While this makes test location predictable, it also means that adding a new module requires creating boilerplate in two directory trees. A flatter test structure or colocated `*.test.js` files would reduce overhead.

**M-4: Many Thin Modules Exist**

Several modules contain only 2-3 small files with minimal logic:
- `ci/` (not read but likely thin)
- `compat/` (adapter, deprecation, polyfill - thin)
- `palette/` (engine, providers, search - thin)
- `handoff/`, `ownership/`, `trust/`, `regression/`, `reinforcement/`, `training/`

Some of these could be consolidated into broader feature modules to reduce cognitive overhead of 75+ directories.

**M-5: `index.js` Public API Has Name Collision Risk**

`src/index.js` uses spread to flatten multiple submodules:
```js
module.exports = {
  config, context, fileContext, memory,
  ...orchestration,  // spreads AgentRegistry, AgentStatus, MessageRouter, TaskBoard, ...
  ...basicRuntime,   // spreads AgentDefinition, CommandRegistry, ...
  ...agentTeams,     // spreads potentially overlapping names
  ...teamAgents,     // spreads potentially overlapping names
  ...teamTools,      // spreads potentially overlapping names
  ...agentTeamFormatters,
  // ...
};
```

Multiple spread operators mean any property name collision between modules silently overwrites the previous value. Without a test guaranteeing no collisions exist, this is fragile.

### LOW

**L-1: Console.log Usage in Production Code**

85 `console.log`/`console.error`/`console.warn` calls exist across 13 source files (excluding cli.js, which legitimately uses console for its CLI interface). The `observability/logger.js` module provides a structured logger, but it is not used consistently for debug/info/warn/error output in non-CLI modules.

**L-2: TODO/FIXME Comments in Production Code**

The `dev-tooling/scaffold.js` file contains 12+ placeholder TODO comments used as template content. These are harmless as they appear in generated code, but the health/debt-tracker is designed to flag them — creating a self-referential warning.

**L-3: Missing ESM Migration Path**

The entire codebase uses CommonJS (`require`/`module.exports`). With Node.js 18+ being the minimum engine, ESM support is available. No migration path or dual-mode (CJS+ESM) strategy is documented.

---

## 3. Refactoring Recommendations

### R-1: Extract `cli.js` Concerns (CRITICAL)

Split `cli.js` into at minimum these files:
- `src/cli/parser.js` — argument parsing (`main()` function, `KNOWN_COMMANDS`)
- `src/cli/shell-ui.js` — readline management, prompts, keybindings, paste, vim mode
- `src/cli/subcommands.js` — init, models, agents, team, config, resume, sessions, doctor
- `src/cli/batch-entry.js` — batch mode dispatch
- `src/cli/error-handlers.js` — `setupErrorHandlers()`

Keep `cli.js` as a thin entry point that wires these together (~50 lines).

### R-2: Create `src/shared/utils.js` for Duplicated Utilities (CRITICAL)

Consolidate into a single `src/shared/utils.js` (or expand `runtime/utils.js`):
```js
requireString, requireEnum, assertPlainObject, isNonEmptyString,
positiveInteger, normalizeError, escapeRegExp, createId, toIsoString, toStringSafe
```

Then update all 16+ files that duplicate these to import from the shared location. This eliminates ~300 lines of duplicate code.

### R-3: Standardize Error Handling (HIGH)

- Define a `HaxAgentError` base class with `code` property, used across all modules
- Convert generic `throw new Error(...)` in `runtime/` to use structured errors
- Document the error contract (which codes, thrown vs. returned) at module boundaries
- Use the existing `tools/error-codes.js` pattern as the canonical reference

### R-4: Extract CostTracker and InputHistory from session.js (HIGH)

Move `CostTracker` to `src/cost-tracker.js` and `InputHistory` to `src/input-history.js`. Keep `Session` as a pure session manager.

### R-5: Deduplicate Export Functions (MEDIUM)

Extract shared helper from `src/export.js`:
```js
function _resolveSession(sessionId, options) {
  const sessions = listSessions(options);
  const target = sessions.find(s => s.id.startsWith(sessionId));
  if (!target) throw new Error(`Session not found: ${sessionId}`);
  return { target, entries: target.entries(), metadata: target.metadata() };
}
```

### R-6: Externalize Provider Pricing (MEDIUM)

Move the hardcoded pricing table from `CostTracker.pricing` into `src/providers/pricing.js` as a data module, making it independently updateable.

### R-7: Unify Module Loading Pattern (LOW)

Create `src/shared/module-loader.js` that provides a single lazy-loading abstraction, replacing the 4+ different implementations in hub.js, plugin-validator.js, plugins/indexer.js, and skills/loader.js.

### R-8: Standardize on `node:` Prefix and `'use strict'` (LOW)

Lint-enforce that all `require()` calls use the `node:` prefix for built-in modules, and that all files begin with `'use strict';`.

---

## 4. Overall Architecture Score

| Dimension | Score (0-100) | Assessment |
|-----------|:------------:|------------|
| Module Organization | **78** | Clear boundaries, well-named directories. Penalized by god object (cli.js) and 75+ directories creating cognitive overhead. |
| Dependency Management | **82** | Generally acyclic, hub.js provides good composition. Penalized by upward references (tools → permissions, plugins/indexer → plugins). |
| Interface Consistency | **70** | Good use of factory functions + classes. Penalized by inconsistent error handling patterns and return value conventions. |
| Code Duplication | **45** | Severe — `requireString` in 16 files, `positiveInteger` in 12. Shared utilities exist but go unused. This is the weakest dimension. |
| Error Handling | **65** | `tools/` layer is excellent (error codes, ToolExecutionError). Other layers use generic Errors. No unified error taxonomy. |
| Module Cohesion | **75** | Most modules are single-purpose. Penalized by session.js mixing three concerns and cli.js being a monolith. |
| Naming & Conventions | **80** | Consistent `createXxx` factories, JSDoc throughout, Object.freeze for constants. Inconsistent strict mode and `node:` prefix. |
| Testability | **72** | Good test mirror structure but cli.js and config resolution are hard to test in isolation. |
| **OVERALL** | **71** | Solid foundation undermined by code duplication, a monolithic entry point, and inconsistent error handling. |

---

## 5. Top 5 Architectural Improvements

1. **Eliminate Code Duplication (Priority: URGENT)**
   Consolidate `requireString`, `positiveInteger`, `normalizeError`, `escapeRegExp`, and related utilities into a single shared module. Eliminates 300+ lines of identical code across 16+ files and prevents future drift. The existing `runtime/utils.js` is already positioned for this — make it the canonical source and import it everywhere.

2. **Decompose `cli.js` (Priority: HIGH)**
   Split the 1370-line entry point into focused modules: argument parser, shell UI, subcommand handlers, batch mode, error handlers. This is the single file most in need of refactoring — it violates the Single Responsibility Principle severely and makes the entire CLI untestable in isolation.

3. **Unify Error Handling (Priority: HIGH)**
   Extend the `ToolExecutionError` pattern (with `ErrorCodes`) to all non-tool modules. Define a `HaxAgentError` base and ensure every thrown error carries a machine-readable `code`. This enables callers to reliably handle errors across module boundaries and enables automated error categorization.

4. **Decouple Session.js Concerns (Priority: MEDIUM)**
   Extract `InputHistory` and `CostTracker` into their own modules. Move hardcoded model pricing to a data module (`src/providers/pricing.js`). This keeps Session focused on message/transcript management.

5. **Standardize Module Loading (Priority: MEDIUM)**
   Create a shared lazy-loading abstraction for the 4+ modules that independently implement try/catch-require patterns. Reduces fragility and ensures consistent fallback behavior when optional dependencies are unavailable.

---

## 6. What Is Working Well

- **Plugin Architecture**: The `PluginRegistry` with hook lifecycle (`beforeToolCall`, `afterToolCall`, `onSessionStart`, `onSessionEnd`, `onError`) is clean and extensible. The new `plugins/dependency.js` and `plugins/indexer.js` add valuable capabilities without complicating the core registry.

- **Tool System**: The `ToolRegistry` - `ToolExecutionError` - `ErrorCodes` triad is the best-designed subsystem. Strong validation, permission checks, plugin hooks, and serialized results. The 11 built-in tools follow a consistent `createXxxTool` factory pattern.

- **Safety & Security Modules**: `safety/scanner.js`, `safety/rules-engine.js`, `security/content-policy.js`, `security/input-sanitizer.js`, and `security/audit-log.js` are well-designed with clear separation of concerns, comprehensive input validation, and good use of Object.freeze for immutability.

- **Resilience Patterns**: `circuit-breaker.js`, `retry.js`, and `bulkhead.js` are clean implementations of standard resilience patterns with proper configuration, events, and state management.

- **Observability**: `logger.js`, `metrics.js` (Counter/Histogram), and `tracer.js` (Span with tracing) provide a solid foundation for monitoring, though they are not yet consistently adopted across the codebase.

- **Hub Composition Root**: `hub.js` provides an excellent "single entry point" for wiring together all subsystems with proper cleanup, lazy loading, and configurable toggles. This is a strong architectural pattern that should be used as the preferred way to instantiate the system programmatically.

- **Documentation**: JSDoc comments are thorough and consistent across the codebase, particularly in the security, safety, and resilience modules.

- **Immutable Constants**: Consistent use of `Object.freeze()` for enums, error codes, and configuration defaults across all modules. This prevents accidental mutation and communicates intent clearly.

---

## 7. Module Quality Heatmap

| Module | Lines | Quality | Notes |
|--------|-------|---------|-------|
| `tools/` | ~800 | 90 | Best-in-class: consistent patterns, error codes, clear contracts |
| `safety/` | ~1200 | 88 | Well-structured, good separation of scanner/rules/redaction |
| `security/` | ~1400 | 87 | Clean policy engine, comprehensive audit logging, thorough sanitization |
| `resilience/` | ~800 | 85 | Standard patterns, clean implementation, good events |
| `observability/` | ~400 | 82 | Clean metrics/tracer/logger but not yet adopted consistently |
| `plugins/` (new) | ~600 | 85 | Well-designed registry, dependency graph, indexer |
| `providers/` | ~2000 | 78 | Clear factory pattern, but Anthropic provider is large (579 lines) |
| `hub.js` | 418 | 85 | Excellent composition root |
| `orchestration.js` | 454 | 80 | Clean task/agent/message abstractions |
| `session.js` | 262 | 65 | Mixed concerns (session + history + cost tracking) |
| `config.js` | 366 | 72 | Good resolution hierarchy, but filesystem-coupled |
| `cli.js` | 1370 | 45 | God object — urgent refactoring needed |
| `runtime/` | ~400 | 65 | Duplicated utilities, generic error handling |
| `export.js` | 158 | 60 | 90% code duplication across three export functions |
| `batch.js` | 163 | 82 | Clean API, good separation |
| `undo-stack.js` | 149 | 80 | Solid implementation |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Utility divergence from code duplication | HIGH | MEDIUM | R-2: Consolidate shared utilities immediately |
| Untestable CLI from monolithic design | MEDIUM | HIGH | R-1: Decompose cli.js |
| Error misclassification from inconsistent patterns | MEDIUM | MEDIUM | R-3: Unify error handling |
| Silent API breakage from spread collision in index.js | LOW | HIGH | Add collision detection test; migrate to explicit exports |
| Stale pricing data in hardcoded table | MEDIUM | LOW | R-6: Externalize pricing |

---

*Review conducted by automated architecture analysis. No files were modified.*
