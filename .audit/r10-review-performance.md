# R10 Performance Audit: HaxAgent

**Date**: 2026-05-22
**Scope**: Entire `E:/HaxAgent` project (896 source files; `src/`, `desktop/`, `examples/`, `scripts/`)
**Method**: Automated pattern scanning + manual hotspot review
**Overall Performance Score**: **52 / 100**

---

## Executive Summary

The HaxAgent codebase shows a "development velocity over runtime efficiency" posture. A deep-clone utility was written (`src/shared/deep-clone.js`) but nearly every caller still uses `JSON.parse(JSON.stringify(...))`. Sync I/O is pervasive in data-persistence layers, including inside constructor hot-paths. Four separate topological-sort implementations independently commit the `queue.sort()` + `queue.shift()` quadratic anti-pattern. Regex patterns are recompiled inside loops in HTML post-processing, codegen, and AST search, creating measurable GC pressure.

The fixes are uniformly low-risk and high-reward -- mostly swapping one call for another or pre-compiling patterns.

---

## 1. Sync I/O in Async Paths

**Severity**: HIGH | **Occurrences**: 475 across 61 files | **Estimated cycles saved with fix**: 50-200ms per I/O-heavy call path

### Category: Sync I/O inside synchronous code paths (acceptable)

These are module-level or constructor uses that do not block the event loop (by definition, sync code runs before the loop starts):

| File | Lines | Calls | Notes |
|------|-------|-------|-------|
| `src/data/backup.js` | 27,35,47-48,65-66 | 37 | All in sync `createBackup()` -- acceptable |
| `src/data/migration.js` | throughout | 22 | Constructor + migration steps -- acceptable |
| `src/workspace/session-context.js` | 205,207,216,219 | 4 | Sync in sync helper -- acceptable |
| `src/config.js` | throughout | 3 | Module-level init -- acceptable |
| `src/memory.js` | throughout | 22 | Session write functions -- acceptable if called rarely |

### Category: Sync I/O inside async functions (BLOCKING)

These block the Node.js event loop for the entire duration of each sync call. On a spinning disk or network mount, a single `readFileSync` can stall the process for 5-50ms.

| File | Line(s) | Issue | Impact |
|------|---------|-------|--------|
| `src/artifact/manager.js` | 70,79,84,95-97,105-110 | `mkdirSync`, `writeFileSync`, `copyFileSync`, `existsSync`, `readFileSync`, `readdirSync` in `DirectoryBackend` methods (constructor, save, get, list) | 22 calls. These methods are called from async orchestration paths. Each `save()` call does 2+ sync file ops. |
| `src/batch.js` | 45,95-96 | `readFileSync` on potentially large input, `mkdirSync` + `writeFileSync` for output | Blocks at batch startup and completion |
| `src/catalog/scanner.js` | 201,228 | `readdirSync`, `readFileSync` in recursive `_walk()` and `_processFile()` | Called during catalog building; scans entire project tree synchronously |
| `src/desktop-services.js` | throughout | 11 `fs.*Sync` calls for Git operations and config I/O | Desktop renderer thread can freeze |
| `src/workspace/monorepo.js` | throughout | 19 sync calls in dependency graph resolution | For large monorepos this can block significantly |
| `src/improvement/learning-engine.js` | throughout | 7 sync calls for model persistence | Called in background, but still blocks |

### Category: Sync I/O in hot paths (constructor / repeated)

| File | Line | Call | Context |
|------|------|------|---------|
| `src/artifact/manager.js` | 70 | `fs.mkdirSync(this.basePath, { recursive: true })` | **Constructor** -- blocks class instantiation |
| `src/cache/manager.js` | multiple | 11 sync calls | Cache directory init, read, write |
| `src/skills/package-skills.js` | multiple | 35 sync calls | Skill packaging pipeline |
| `src/skills/registry.js` | multiple | 25 sync calls | Skill discovery scans disk |

**Fix**: Replace `fs.*Sync` with `fs/promises` variants in any function that is called from async contexts. For constructors, accept a pre-created directory path or use lazy initialization. For `catalog/scanner.js`, convert `_walk` to an async generator.

---

## 2. JSON.parse(JSON.stringify()) Deep Clone Usage

**Severity**: MEDIUM-HIGH | **Occurrences**: 42 across 37 files | **Estimated memory reduction with fix**: ~2x for large objects (avoids stringify intermediate)

A proper `deepClone()` utility exists at `src/shared/deep-clone.js` (supports circular refs, Date, Map, Set, RegExp, depth limiting), but **only 3 call sites** use `structuredClone` and **zero call sites import `deepClone`**:

```
structuredClone usage: src/memory/vector-store.js (lines 51, 182), src/shared/deep-clone.js (line 37)
```

Every other caller uses the lossy+slow `JSON.parse(JSON.stringify(...))` pattern:

| File | Line(s) | Occurrences | Notes |
|------|---------|-------------|-------|
| `src/config/migration.js` | 219, 223 | 2 | Double clone of config object per migration step |
| `src/regression/detector.js` | 163, 180 | 2 | Baseline snapshot + retrieval |
| `src/handoff/escalation.js` | 533, 538 | 2 | Agent handoff data |
| `src/resources/planner.js` | 334, 526 | 2 | Resource plan optimization |
| `src/workflow/library.js` | 627, 631 | 2 | Workflow snapshotting |
| `src/recorder/fixture-gen.js` | 82 | 1 | Anonymized recording copy |
| `src/cli.js` | 282 | 1 | Settings clone |
| `src/desktop-services.js` | 691 | 1 | Settings clone |
| `src/cache/manager.js` | 53 | 1 | Cache value clone (has try/catch, falls through on error) |
| `src/ci/pipeline.js` | 646 | 1 | Pipeline context clone |
| `src/ci/cache.js` | 402 | 1 | CI cache snapshot |
| 26 more files | various | 26 | Various snapshot/clone operations |

**What `JSON.parse(JSON.stringify(x))` loses**:
- `Date` objects become strings
- `Map`, `Set`, `RegExp` become empty objects
- `undefined` values and functions are silently dropped
- Circular references throw `TypeError`

**Fix**: Add `const { deepClone } = require('../shared/deep-clone');` imports and replace `JSON.parse(JSON.stringify(value))` with `deepClone(value)`. The utility already handles the `structuredClone` fast path for Node >= 17. Estimated per-call savings: 0.1-2ms (plus correctness).

---

## 3. Array.shift() / unshift() Anti-Patterns

**Severity**: MEDIUM | **Occurrences**: 75 across 54 files | **Estimated cycles saved with fix**: 100-500ms on large dependency graphs

### Category A: `.sort()` + `.shift()` -- THE CRITICAL QUADRATIC PATTERN

This is the most impactful anti-pattern found. Re-sorting an array every iteration of a while-loop, then shifting from the front, creates **O(n^2 log n)** behavior:

**`src/tasks/resolver.js`** -- THREE occurrences in topological sort routines:

| Lines | Context | Complexity |
|-------|---------|------------|
| 127-142 | `getExecutionOrder()`: `queue.sort()` on line 127, `queue.shift()` on line 132, then `queue.sort()` again on line 141 inside the while loop | O(n^2 log n) |
| 264-276 | `getCriticalPath()`: `queue.sort()` on line 264, `queue.shift()` on line 268, `queue.sort()` on line 275 | O(n^2 log n) |
| 438 | Priority queue variant also uses `shift()` | Additional instance |

**`src/workspace/monorepo.js`** -- TWO occurrences:

| Lines | Context | Complexity |
|-------|---------|------------|
| 328, 392-393 | `getAffectedPackages()`: `queue.shift()` in BFS (line 328) + `getBuildOrder()`: `queue.sort()` then `queue.shift()` (lines 392-393) | O(n) + O(n^2 log n) |

### Category B: Ring-buffer semantics with shift() -- acceptable but could use index pointer

Many files use `shift()` to maintain fixed-size rolling windows. This is O(n) per shift but the arrays are small (usually <= 100 entries):

| File | Line(s) | Occurrences | Window Size |
|------|---------|-------------|-------------|
| `src/prediction/early-warning.js` | 465, 518, 576, 639, 676, 867 | 6 | Small trend buffers (~50-200) |
| `src/skills/metrics.js` | 85, 93, 100 | 3 | Small history buffers |
| `src/health/monitor.js` | 279, 538 | 2 | Alert/history buffers |
| `src/providers/router.js` | 147, 168 | 2 | Latency window |
| `src/providers/streaming.js` | 83, 115 | 2 | Stream resolver queue |

### Category C: BFS/DFS using shift() -- acceptable for typical project sizes

| File | Line | Description |
|------|------|-------------|
| `src/bridge/continuity.js` | 154, 462 | LRU eviction queues (< 1000 entries) |
| `src/graph/engine.js` | 223 | Graph traversal depth queue |
| `src/tools/file-readdir.js` | 103 | Directory BFS walker |
| `src/versioning/upgrade.js` | 115 | Version migration queue |

**Fix for Category A**: Replace `queue.sort()` + `queue.shift()` with a proper binary heap (e.g., `MinPriorityQueue` wrapper around a sorted insert, or use `Array.prototype.pop()` with reverse-sorted data). For topological sort specifically, use Kahn's algorithm with a simple binary heap: insert into heap O(log n), extract O(log n) = total O(n log n).

---

## 4. Regex Recompilation in Loops

**Severity**: MEDIUM | **Occurrences**: 65 `new RegExp()` calls across 36 files | **Estimated cycles saved**: 5-50ms per call path

### Critical: Regex compiled inside for-loops

**`src/export/postprocess.js`** lines 550-553:
```js
const blockTags = ["div", "section", "article", ...]; // 24 tags
for (const tag of blockTags) {
    result = result.replace(new RegExp("<" + tag + "([\\s>])", "gi"), "\n<$1$1");
    result = result.replace(new RegExp("</" + tag + ">", "gi"), "</$1>\n");
}
```
**48 regex compilations per call** (24 tags x 2 patterns). These patterns are identical for every call. The array and regexes should be pre-computed at module level or in a single pattern: `/<(div|section|article|...)…/gi`.

**`src/codegen/refactoring.js`** lines 109-259:
- `renameSymbol()`: 2 regexes created per call (lines 110, 125)
- `convertToArrow()`: 1 regex (line 142)
- `addErrorHandling()`: 3 regexes in `fnPatterns` array (lines 186, 192, 197) -- created every call even though only functionName changes
- `addLogging()`: 3 regexes (lines 245, 249, 253) -- same pattern

Each refactoring method creates 1-3 regexes with a dynamically interpolated `functionName`. These could be cached by functionName with a simple `Map<string, RegExp>` or using a template-literal cache.

**`src/search/ast-grep.js`** lines 138-305:
- `searchFunctionDefinitions()`: 5 regexes created per call (lines 168-190)
- `searchImports()`: 3 regexes (lines 238-249)
- `searchPatterns()`: 1+ regexes per pattern input (line 297-299)
- `searchFunctionCalls()`: 1 regex (line 143)
- `searchVariableReferences()`: 1 regex (line 219)
- `searchClassDefinitions()`: 1 regex (line 276)

Each of these functions is a search utility called repeatedly. The patterns for a given functionName/moduleName are deterministic. Cache with a WeakMap or simple Map by (name + flags) key.

**`src/safety/redaction.js`** lines 180, 185, 227, 258:
- Constructor: patterns compiled from input (lines 180, 185) -- OK, one-time
- `redact()`: lines 227, 258 -- **regex recreated per redact() call** for each pattern entry AND each extra pattern. Inside `redact()`, the regex is matched with `.exec()` in a while loop (line 229), so the regex state is consumed. While you can't reuse the regex object across calls without resetting `lastIndex`, you can create it once per call rather than recreating it.

**`src/export/postprocess.js`** lines 552-553 also has a subtle bug: `"$1" + "$1"` produces the literal string `"$1$1"`, which in a regex replace would reference capture group 1 twice. However, looking more carefully, `\n<$1$1` is the replacement which would expand to `\n<capture1capture1`. This is likely unintended.

### Non-loop regex compilations (acceptable)

| File | Lines | Count | Context |
|------|-------|-------|---------|
| `src/safety/redaction.js` | 62 | 1 | Module-level ZERO_WIDTH_CHARS constant -- GOOD |
| `src/injection/sanitizer.js` | 62 | 1 | Module-level constant -- GOOD |
| `src/graph/builder.js` | 114 | 1 | Per-call only -- acceptable |
| `src/optimizer/token-optimizer.js` | 523 | 1 | Per-call, dynamically built -- acceptable |

**Fix**: Pre-compile regex at module level where patterns are static. For dynamic patterns with function names, use a `Map<string, RegExp>` cache. For loops, construct a single alternation pattern `/(tag1|tag2|...)/` rather than looping through individual regexes.

---

## 5. Missing Resource Cleanup

**Severity**: LOW-MEDIUM | **Estimated memory leak reduction**: 10-100KB per leaked timer/listener per hour

### setInterval cleanup audit

All `setInterval()` calls in `src/` have corresponding `clearInterval()` paths. Verified:

| File | Line (set) | Cleanup lines | Status |
|------|-----------|---------------|--------|
| `src/coordination/heartbeat.js` | 52 | 66 | **CLEAN** |
| `src/watcher/fs-watcher.js` | 270, 311 | 372 | **CLEAN** |
| `src/health/monitor.js` | 165 | 188 | **CLEAN** |
| `src/cli-utils/progress.js` | 27 | 35 | **CLEAN** |
| `src/gateway/cache.js` | 214 | 191 + `.unref()` at 218 | **CLEAN** |
| `src/plugins/isolate.js` | 190 | 528 | **CLEAN** |
| `src/security/audit-log.js` | 154 | 168 + `.unref()` at 157 | **CLEAN** |
| `src/renderer.js` | 264 | 272 | **CLEAN** |
| `src/cache/preloader.js` | 329 | 343, 355 | **CLEAN** |
| `src/cache/manager.js` | 811 | 803 + `.unref()` at 815 | **CLEAN** |
| `src/integrations/health-integration.js` | 84 | 99 + `.unref()` at 88 | **CLEAN** |
| `src/integrations/task-integration.js` | 178 | 188 + `.unref()` at 180 | **CLEAN** |
| `src/memory/optimizer.js` | - | 494 (clearInterval) | **CLEAN** |

### setTimeout without clearTimeout

Most `setTimeout` calls in the codebase are either:
- Promise wrappers (`await new Promise(r => setTimeout(r, ms))`) -- no cleanup needed
- Debounce timers with proper cleanup (`src/watcher/fs-watcher.js`, `src/watcher/hot-reload.js`)
- Timeout guards with cleanup in `finally` blocks (`src/tools/web-fetch.js`)

### Event listener cleanup

| File | Pattern | Risk |
|------|---------|------|
| `src/cli.js` line 607 | `process.stdin.on('keypress', ...)` -- listener set but **not** in a paired setup that also guarantees removal on all exit paths | LOW: Only one stdin listener at a time, but in exceptional exit paths (SIGKILL), this could theoretically accumulate if the process doesn't die |
| `src/cli.js` lines 1354, 1368 | `process.on('uncaughtException')`, `process.on('unhandledRejection')` -- these are set once and persist for process lifetime | LOW: Correct semantics for process-level handlers |
| `src/renderer.js` line 160 | `this.stream.on('resize', ...)` -- cleaned up on line 166 with `this.stream.off(...)` | **CLEAN** |
| `src/init-wizard.js` line 393 | `input.on('keypress', ...)` -- removed on line 353 | **CLEAN** |
| `src/docs/browser.js` line 817 | `this._input.on('keypress', ...)` -- removed on line 833 | **CLEAN** |
| `src/palette/engine.js` line 621 | `this._input.on('keypress', handler)` -- removed on line 189 | **CLEAN** |

**Fix**: The codebase already handles cleanup well for timers. For long-running sessions, consider adding a periodic `process.getActiveResourcesInfo()` trace (debug mode only) to catch any regressions.

---

## 6. Large Synchronous Requires at Module Level

**Severity**: LOW | **Current startup cost**: ~50-150ms for all sync requires (cold start)

### Direct package.json requires

| File | Line | Call |
|------|------|------|
| `src/cli.js` | 39 | `const VERSION = require('../package.json').version;` |
| `src/renderer.js` | 111 | `const VERSION = require('../package.json').version;` |

These force the entire `package.json` into the module cache. At ~2-5KB this is negligible.

### Heavy built-in require inventory

The following modules are required at module scope across the project (each has a non-trivial C++ binding initialization cost):

| Module | Files using it | Approx init cost |
|--------|---------------|-----------------|
| `crypto` | ~30 files | 2-5ms first require |
| `fs` | ~80 files | 1-3ms first require |
| `path` | ~70 files | <1ms |
| `os` | ~15 files | <1ms |
| `readline` | ~8 files | 1-2ms |
| `child_process` | ~10 files | 2-5ms first require |
| `zlib` | 1 file | 2-3ms |
| `vm` | 2 files | 1-2ms |
| `http`/`https` | ~5 files | 2-3ms each |

None of these are in hot startup paths that can't tolerate them. The `crypto.randomBytes(4)` call in `src/memory.js` line 23 (`createSessionId` helper, not module-level) is the only crypto call that runs at require time.

**Fix**: `require('../package.json')` should use `require('../package.json').version` directly to minimize what's loaded. Even better, use `fs.readFileSync` with a JSON.parse targeting only the `version` field, or extract it to a standalone `.version` file at build time.

---

## 7. Additional Issues Found

### 7.1 Multiple topological sort implementations

Three different files implement topological sort independently, all with the same `sort()+shift()` anti-pattern:
- `src/tasks/resolver.js` (lines 127-142, 264-276)
- `src/workspace/monorepo.js` (lines 390-399)
- `src/planner/decomposer.js` (line 374 -- uses shift() in BFS queue, not sort+shift, but still quadratic for large DAGs if elements are added unsorted)

**Fix**: Create a single `src/shared/toposort.js` with a proper O(n log n) implementation using a binary heap or sorted insert.

### 7.2 String concatenation in hot loops

**`src/export/postprocess.js`** `_beautifyHtml()` function:
```js
let result = content;
for (const tag of blockTags) {
    result = result.replace(...);  // Creates new string each iteration, 24 times
    result = result.replace(...);
}
```
24 iterations of string replace on potentially large HTML content. Each `.replace()` allocates a new string. Use a single pattern or process in one pass.

**`src/cli.js` line 745**:
```js
highlight = match.replace(new RegExp(escaped, 'gi'), m => `\x1b[1m\x1b[33m${m}\x1b[0m`);
```
This creates a new regex per match in a potentially large output. Pre-compile with the ANSI-escaped pattern.

### 7.3 Missing `stream.destroy()` in request error paths

Multiple HTTP request handlers call `req.on('error', reject)` or `req.on('timeout', ...)` but don't always destroy the request socket:

| File | Lines | Status |
|------|-------|--------|
| `src/tools/stock-quote.js` | 109, 156 | Calls `req.destroy()` on timeout -- **OK** |
| `src/notify/channels.js` | 298-299 | Calls `req.destroy()` on timeout -- **OK** |
| `src/updater.js` | 47-49 | Calls `request.destroy()` on both error and timeout -- **OK** |
| `src/init-wizard.js` | 493 | Calls `req.destroy()` on timeout -- **OK** |

This is actually handled well across the codebase.

---

## Issue Inventory Summary

| Category | Occurrences | Files | Severity | Fix Difficulty |
|----------|-------------|-------|----------|----------------|
| 1. Sync I/O (all) | 475 | 61 | HIGH | MEDIUM |
| 1a. Sync I/O in async/hot paths | ~60 | 10 | HIGH | MEDIUM |
| 2. JSON.parse(JSON.stringify()) | 42 | 37 | MEDIUM-HIGH | LOW |
| 3. shift()/unshift() | 75 | 54 | MEDIUM | LOW-MEDIUM |
| 3a. sort()+shift() quadratic | 5 instances | 2 | HIGH | LOW |
| 4. Regex in loops | ~20 | 8 | MEDIUM | LOW |
| 5. Missing cleanup | 0 critical | 0 | LOW | N/A |
| 6. Large sync requires | 2 (pkg.json) | 2 | LOW | LOW |
| 7. Duplicate toposort impls | 3 | 3 | LOW | MEDIUM |

---

## Top 5 Performance Fixes (Ranked by Impact)

### Fix 1: Replace `sort()+shift()` with binary heap in topological sort
- **Files**: `src/tasks/resolver.js`, `src/workspace/monorepo.js`
- **Current cost**: O(n^2 log n) per sort call
- **Fix cost**: O(n log n) with binary heap
- **Effort**: ~30 lines changed
- **Saving**: Up to 500ms on large dependency graphs (>1000 nodes)
- **Risk**: None -- topological order remains identical

### Fix 2: Pre-compile regex patterns in `src/export/postprocess.js`
- **File**: `src/export/postprocess.js` lines 541-556
- **Current cost**: 48 regex compilations + 24 string allocations per HTML beautify call
- **Fix**: Single module-level alternation pattern + single-pass replace
- **Effort**: ~10 lines changed
- **Saving**: 10-50ms per large HTML export
- **Risk**: None -- regex semantics identical

### Fix 3: Replace `JSON.parse(JSON.stringify(...))` with `deepClone()` utility
- **Files**: 37 files (42 call sites)
- **Current cost**: Serialize to string + parse back (lossy for Date/Map/Set/RegExp)
- **Fix**: `const { deepClone } = require('../shared/deep-clone');` then `deepClone(value)`
- **Effort**: ~80 lines changed (2 lines per file)
- **Saving**: ~1ms per large-object clone + correctness for typed objects
- **Risk**: Very low -- `deepClone` already handles edge cases

### Fix 4: Pre-compile regex patterns in search and codegen modules
- **Files**: `src/search/ast-grep.js` (13 patterns), `src/codegen/refactoring.js` (9 patterns), `src/safety/redaction.js` (4 patterns)
- **Current cost**: 1-13 regex compilations per search call
- **Fix**: Cache compiled patterns by key in a `Map<string, RegExp>`
- **Effort**: ~50 lines changed
- **Saving**: 1-5ms per search call (adds up for repeated searches in text editors)
- **Risk**: Low -- ensure `lastIndex` is reset for global regexes

### Fix 5: Create shared topological sort utility
- **Files**: New `src/shared/toposort.js` replacing 3+ implementations
- **Current cost**: 3 separate implementations, 2 with quadratic behavior
- **Fix**: Single O(n log n) implementation with proper min-heap
- **Effort**: ~60 lines new, ~90 lines deleted
- **Saving**: Deduplication + algorithmic improvement across all callers
- **Risk**: Low -- well-understood algorithm

---

## Scoring Breakdown

| Dimension | Score (0-100) | Weight | Weighted |
|-----------|---------------|--------|----------|
| I/O efficiency | 35 | x0.30 | 10.5 |
| Memory management | 55 | x0.25 | 13.8 |
| Algorithmic efficiency | 50 | x0.25 | 12.5 |
| Resource lifecycle | 80 | x0.10 | 8.0 |
| Startup time | 70 | x0.10 | 7.0 |
| **TOTAL** | | | **51.8 -> 52** |

**Score interpretation**:
- 0-30: Critical performance issues in production paths
- 31-55: Significant room for improvement with low-risk fixes
- 56-75: Generally sound with some hotspots
- 76-90: Well-optimized
- 91-100: Exemplary

At **52**, the codebase is functional but leaves substantial performance on the table through systemic patterns (sync I/O everywhere, regex rec-compilation, quad-sort loops). The fixes are uniformly mechanical and low-risk -- the primary barrier is developer awareness and tooling (linter rules would prevent regression).
