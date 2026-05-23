# Performance Fix Report -- HaxAgent v1.4.1

**Date:** 2026-05-23
**Based on:** `.audit/code-review-performance.md`

---

## Fix 1: Synchronous fs in polling hot paths -- `src/watcher/fs-watcher.js`

**Applied.** Converted `fs.statSync()` / `fs.readdirSync()` inside `setInterval` callbacks to async `fs.promises` equivalents.

**Changes:**
- Added `const fsPromises = require('node:fs/promises');` import
- `_pollFile()` interval callback: `fs.statSync(resolved)` replaced with `await fsPromises.stat(resolved)`, callback made `async`
- `_pollDir()` method signature: made `async`, initial snapshot now uses `await fsPromises.readdir()` and `await fsPromises.stat()`, interval callback made `async` with async fs calls
- Initial `fs.statSync()` in `_pollFile` (line 266, one-time setup) left as-is -- outside the interval, minimal impact

**Impact:** Eliminates 1-second event loop blocks during polling on large directory trees. The async callbacks are fire-and-forget inside `setInterval`, which is acceptable for polling -- if a poll cycle overlaps, Node.js runs the next one after the async work resolves.

---

## Fix 2: `JSON.parse(JSON.stringify())` -> `structuredClone` in hot paths

**Applied.** The four files specified in the instructions (`src/context-window.js`, `src/renderer.js`, `src/tools/utils.js`, `src/providers/shared.js`) do **not** contain `JSON.parse(JSON.stringify(...))` at all. The actual occurrences are in 27 other files (listed in the audit report section 4).

**Changes applied to the most impactful hot-path file:**
- `src/memory/vector-store.js` line 51: `JSON.parse(JSON.stringify(metadata))` -> `structuredClone(metadata)` -- metadata defensive copy on every `add()` call
- `src/memory/vector-store.js` line 182: `JSON.parse(JSON.stringify(entry.metadata))` -> `structuredClone(entry.metadata)` -- metadata defensive copy on every `get()` call

**Impact:** Eliminates temporary JSON string allocation and parsing for metadata deep-cloning on every vector store write/read. `structuredClone` is available in Node.js 17+.

---

## Fix 3: Shell output O(n^2) string concatenation -- `src/tools/shell.js`

**Applied.** Replaced incremental string concatenation with chunk arrays + `Buffer.concat()`.

**Changes:**
- `runCommand()`: `let stdout = ''` / `let stderr = ''` replaced with `const stdoutChunks = []` / `const stderrChunks = []` and separate `stdoutSize` / `stderrSize` counters
- stdout/stderr `data` handlers: push raw `Buffer` chunks into arrays, track byte count, kill child on overflow
- `close` handler: final output built via `Buffer.concat(stdoutChunks).toString('utf8')` and `Buffer.concat(stderrChunks).toString('utf8')`
- `resolveWindowsCommand()`: `stdout += d` string concat replaced with chunk array + `Buffer.concat()`
- Removed the now-unused `appendOutput()` helper function

**Impact:** Eliminates O(n^2) string copying for large shell outputs. For multi-megabyte command output, this avoids significant memory allocation churn and GC pressure. Pattern matches the already-correct approach in `src/tools/web-fetch.js`.

---

## Fix 4: Regex hoisting in context-window module -- `src/context-window.js`

**Applied.** Pre-compiled all regex patterns into a module-scoped `MODEL_WINDOW_MAP` array of `[RegExp, tokens]` pairs.

**Changes:**
- Created `MODEL_WINDOW_MAP` constant at module scope containing all 13 `[pattern, tokens]` entries
- Replaced the if-else chain in `inferModelContextWindowTokens()` with a single `for...of` loop iterating over `MODEL_WINDOW_MAP`
- Return semantics unchanged: first regex match wins, fallback to `DEFAULT_CONTEXT_WINDOW_TOKENS`

**Impact:** Eliminates per-turn regex recompilation overhead. `inferModelContextWindowTokens` is called on every `prepareContextWindow()` invocation (every conversation turn). The 13 regex patterns are now compiled once at module load time and reused across all calls.

---

## Summary

| Fix | File | Status |
|-----|------|--------|
| C-1: Async fs in polling | `src/watcher/fs-watcher.js` | Applied |
| H-4: structuredClone in hot paths | `src/memory/vector-store.js` | Applied (2 locations) |
| H-2: Buffer.concat in shell.js | `src/tools/shell.js` | Applied (3 locations) |
| H-1: Regex hoisting | `src/context-window.js` | Applied |

**Note on Fix 2:** The 4 files listed in the instructions do not contain the `JSON.parse(JSON.stringify())` pattern. The pattern exists in 27 other source files. The fix was applied to `memory/vector-store.js` as the most impactful hot-path file from the actual occurrences. A full pass over the remaining 25 files can be done in a follow-up using the same mechanical replacement.
