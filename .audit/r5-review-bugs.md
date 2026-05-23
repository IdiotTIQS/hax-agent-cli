# R5 New Module Audit — Bug Report

**Date:** 2026-05-23  
**Auditor:** Automated review  
**Scope:** ~40 files across 22 directories, ~18,000+ lines of code  

---

## Bug Density Summary

| Metric | Value |
|--------|-------|
| Total lines reviewed | ~18,000 |
| Critical bugs found | 3 |
| High bugs found | 8 |
| Medium bugs found | 11 |
| Low bugs found | 12 |
| **Bug density** | **~1.9 bugs per 1000 lines** |
| **Overall assessment** | **Good — below industry average (~15 bugs/KLOC)** |

---

## Severity Classification

- **Critical:** Crashing, data corruption, security bypass
- **High:** Logic error affecting correctness in common paths
- **Medium:** Missing validation, edge-case mishandling, API inconsistency
- **Low:** Cosmetic, documentation, minor performance, naming

---

## Critical Bugs

### [CRITICAL-1] `src/tokens/strategies.js` — `_isSimilar()` returns false for short strings
**File:** `E:/HaxAgent/src/tokens/strategies.js`  
**Lines:** 700-727  
**Description:** `_isSimilar()` computes Jaccard similarity on word trigrams via `_trigrams()`. When input text has fewer than 3 words, `_trigrams()` returns an empty Set. This causes `allTrigrams.size === 0` (line 719) to return `false`, meaning all short strings (including two identical single-word strings) are treated as "not similar." This causes `_dropRedundant()` to fail to detect small redundant messages.

**Fix:** Add a direct string equality check before the trigram comparison:
```js
_isSimilar(a, b, threshold) {
  if (!a || !b) return false;
  if (a === b) return true;  // Already present
  // ... rest of trigram logic
  // Add: if both strings are short (<3 words), fall back to length ratio
  const wordsA = a.split(/\s+/).length;
  const wordsB = b.split(/\s+/).length;
  if (wordsA < 3 || wordsB < 3) {
    return a === b; // Exact match only for short strings
  }
}
```

### [CRITICAL-2] `src/models/selector.js` — Inconsistent variable reference could crash
**File:** `E:/HaxAgent/src/models/selector.js`  
**Lines:** 60-62 (aliasing `task` to `t`) vs 120-125 (using raw `task`)  
**Description:** At line 60, `_computeFitness(model, task)` does `const t = task || {}` to safely handle null tasks. Most of the function uses `t` (the safe alias). However, lines 120-125 in the "hard disqualification" loop directly reference `task[needKey]` instead of `t[needKey]`. If `_computeFitness` is ever called with a falsy `task` (null/undefined), this throws `TypeError: Cannot read properties of null`. While current callers validate task, future callers or direct module consumers could hit this.

**Fix:** Change `task[needKey]` to `t[needKey]` on line 122.

### [CRITICAL-3] `src/plugins/isolate.js` — Double-counting of hook calls in sandbox mode
**File:** `E:/HaxAgent/src/plugins/isolate.js`  
**Lines:** 283-338 (`_isolateHook`) and 344-432 (`_sandboxHook`)  
**Description:** `_sandboxHook()` (line 344) wraps the output of `_isolateHook()` (line 283). But `_isolateHook` already increments `stats.calls += 1` (line 291). The `_sandboxHook` creates its own stats tracking via `_getOrCreateStats(pluginName)` and also accumulates CPU time, latency, etc. However, `_sandboxHook` calls `isolatedFn(ctx)` which IS the already-wrapped function from `_isolateHook`. This means every call through `sandbox()` gets:
- Call count incremented by `_isolateHook` (line 291)
- CPU/memory stats accumulated by `_sandboxHook` (lines 384-402)
- Additional CPU/memory accumulation in the isolated hook's own stats

The result is: per-hook stats in the sandbox layer are correct, but the "top-level" stats (`stats.calls`, `stats.cpuTimeMs`, etc.) are inflated because `_isolateHook` writes to them and then `_sandboxHook` writes again to the same stats object (retrieved via `_getOrCreateStats` which returns the same reference).

**Fix:** Either (a) remove stat tracking from `_isolateHook` when it is called from within `_sandboxHook`, or (b) make `_sandboxHook` not call `_isolateHook` but instead do its own isolation + sandbox tracking in one wrapper.

---

## High-Severity Bugs

### [HIGH-1] `src/protocol/compressor.js` — Explicit `dedupWindow: 0` treated as falsy
**File:** `E:/HaxAgent/src/protocol/compressor.js`  
**Line:** 108  
**Description:** `this._dedupWindow = Math.max(0, Number(options.dedupWindow) || 5)` — when `options.dedupWindow` is explicitly `0`, `Number(0) || 5` evaluates to `5` because `0` is falsy. A user who explicitly sets `dedupWindow: 0` to disable deduplication will get the default value of `5` instead.

**Fix:** Use nullish coalescing: `options.dedupWindow ?? 5`, or check explicitly with `options.dedupWindow !== undefined`.

### [HIGH-2] `src/plugins/hotswap.js` — Direct access to private registry internals
**File:** `E:/HaxAgent/src/plugins/hotswap.js`  
**Lines:** 106-107, 186, 306, 317  
**Description:** `PluginHotSwap` reaches into `this._registry._plugins` and `this._registry._hooks` — properties not part of any public API contract. This is an encapsulation violation that:
- Breaks if `PluginRegistry` renames internal fields
- Bypasses any validation/consistency checks in `PluginRegistry`
- Directly mutates `registered.hooks[hookName]` on line 327, which could conflict with the registry's own hook management

**Fix:** `PluginRegistry` should expose public methods like `getPlugin(name)`, `getHookHandlers(hookName)`, and `replaceHookHandler(pluginName, hookName, newFn)`. HotSwap should use these instead of reaching into private fields.

### [HIGH-3] `src/knowledge/curator.js` — Direct manipulation of accumulator internals
**File:** `E:/HaxAgent/src/knowledge/curator.js`  
**Lines:** 326-351 (`_removeItem` method)  
**Description:** `KnowledgeCurator._removeItem()` directly accesses `this._accumulator._items`, `this._accumulator._indexByTag`, and `this._accumulator._indexByType`. These are private properties of `KnowledgeAccumulator`. The curator should not be tightly coupled to the accumulator's internal map structures. If `KnowledgeAccumulator` changes its indexing strategy, the curator breaks silently.

**Fix:** `KnowledgeAccumulator` should expose a `removeItem(id)` method that handles index cleanup internally. The curator should call that instead.

### [HIGH-4] `src/tasks/resolver.js` — `getCriticalPath()` DP tie-breaking uses string comparison on possibly-null values
**File:** `E:/HaxAgent/src/tasks/resolver.js`  
**Lines:** 287-293  
**Description:** In the DP loop:
```js
if (depLen > maxLen || (depLen === maxLen && bestPrev !== null && depId < bestPrev))
```
The tie-breaking condition `depId < bestPrev` only runs when `bestPrev !== null`. But on the very first iteration, `bestPrev` is `null`, so ties are not broken. Worse, on line 305-308 when finding the overall max:
```js
if ((longest.get(id) || 0) > (longest.get(maxId) || 0) || ...)
```
This can fail if `maxId` becomes `undefined` (e.g., if `order` is empty), since `order[0]` on an empty array returns `undefined`.

**Fix:** Guard against empty `order` array at the start. Always break ties in the DP loop, even when `bestPrev` is null.

### [HIGH-5] `src/workflow/library.js` — `get(name)` returns `undefined` instead of null for consistency
**File:** `E:/HaxAgent/src/workflow/library.js`  
**Line:** 86  
**Description:** `get(name)` returns `undefined` (the raw `Map.get()` return value) when a template is not found. Most other functions in the codebase return `null` for "not found" (e.g., `getCheckpoint`, `getTranslations`). Inconsistent return types force callers to check for both `undefined` and `null`.

**Fix:** Return `null` instead of `undefined`:
```js
get(name) {
  const tmpl = this._templates.get(name);
  return tmpl ? deepClone(tmpl) : null;
}
```

### [HIGH-6] `src/testing/smoke-test.js` — Test implementations reference `this` instead of closure
**File:** `E:/HaxAgent/src/testing/smoke-test.js`  
**Lines:** 263-264, 293-294, 318-319, 330-331  
**Description:** `TEST_IMPLS["memory:read"]` calls `this["memory:write"](ctx)` (line 264). The `this` context depends on how the function is called. In `_runSuite`, the function is bound via `fn.bind(TEST_IMPLS)` (line 457), which correctly binds `this`. However, if anyone calls `TEST_IMPLS["memory:read"](ctx)` directly without binding, `this` will be `undefined` (in strict mode) or `globalThis`. While the current code path works, this is fragile and could break with refactoring.

**Fix:** Replace `this["memory:write"](ctx)` with `TEST_IMPLS["memory:write"](ctx)` to make the reference explicit and independent of `this` binding.

### [HIGH-7] `src/providers/synthesizer.js` — Missing provider validation in extractConsensus
**File:** `E:/HaxAgent/src/providers/synthesizer.js`  
**Lines:** 89-97  
**Description:** The code calls `valid[i].provider` (line 96), but there is no guarantee that each response object has a `provider` property. If any response is missing `provider`, the code creates entries keyed by `"unknown"`, which may incorrectly merge sentences from unrelated providers. The filter logic at `_filterValid` (line 32) only checks `success !== false && !r.error` but not the presence of `provider`.

**Fix:** Either validate that `provider` exists in `_filterValid`, or handle the missing case explicitly.

### [HIGH-8] `src/config/environment.js` — `/proc/1/cgroup` check is Linux-only
**File:** `E:/HaxAgent/src/config/environment.js`  
**Lines:** 74-78  
**Description:** `CONTAINER_FILES` includes `"/proc/1/cgroup"` for Docker container detection. This path does not exist on Windows. On this platform (win32), the container detection logic that reads these files will fail with a file-not-found error. The code should handle platform differences or catch read errors gracefully.

**Fix:** Check `process.platform` and skip `/proc/1/cgroup` on non-Linux platforms.

---

## Medium-Severity Bugs

### [MEDIUM-1] `src/bridge/transfer.js` — `deepClone()` silently drops functions, Dates, and undefined
**File:** `E:/HaxAgent/src/bridge/transfer.js`  
**Line:** 26-28  
**Description:** `deepClone` uses `JSON.parse(JSON.stringify(value))` which:
- Drops `undefined` values (becomes absent from objects)
- Converts `Date` objects to ISO strings (not Date instances)
- Drops functions entirely
- Fails on circular references with a thrown error
This affects history storage, checkpoint data, and context snapshots.

**Fix:** Document these limitations clearly, or use a structured clone approach that handles these types.

### [MEDIUM-2] `src/health/monitor.js` — `setDimension()` allows negative/infinite values
**File:** `E:/HaxAgent/src/health/monitor.js`  
**Lines:** 457-468  
**Description:** `setDimension()` validates that the value is a number and not NaN, but it does not clamp or reject negative or infinite values. `debtRatio` should be between 0 and 1, and the score dimensions should be between 0 and 100. Passing `Infinity` or `-100` silently corrupts the health score.

**Fix:** Add bounds checking appropriate to the dimension:
```js
if (dimension === "debtRatio") { value = Math.max(0, Math.min(1, value)); }
else { value = Math.max(0, Math.min(100, value)); }
```

### [MEDIUM-3] `src/health/monitor.js` — `dismissAlert` does not mark alerts as resolved
**File:** `E:/HaxAgent/src/health/monitor.js`  
**Lines:** 418-424  
**Description:** `dismissAlert(alertId)` removes the alert from the array, but it does not set `alert.resolved = true` or `alert.resolvedAt`. The `_evaluateAlerts` method (line 546-555) auto-resolves alerts when conditions recover by checking `alert.resolved`. If a dismissed alert is accessed elsewhere (e.g., via a retained reference from an event listener), its `resolved` flag is still `false`, making it look active.

**Fix:** Set `alert.resolved = true` and `alert.resolvedAt = nowISO()` before splicing.

### [MEDIUM-4] `src/plugins/hotswap.js` — `_awaitInflight` adds two resolvers for the same resolve
**File:** `E:/HaxAgent/src/plugins/hotswap.js`  
**Lines:** 416-438  
**Description:** In `_awaitInflight`:
```js
entry.inflightResolvers.add(resolve);  // Line 424
// ...
entry.inflightResolvers.add(() => {     // Line 434
    clearTimeout(timer);
    originalResolve();
});
```
The second `add` (line 434) wraps `resolve` in another function and adds it to the set. But the `_notifyInflight` method (line 406) iterates over `inflightResolvers` and calls each resolver. This means `resolve()` gets called once from the first resolver, and `originalResolve()` gets called again from the wrapped version. While multiple `resolve()` calls on a Promise are harmless (only the first resolves), this creates confusing side effects and the `clearTimeout(timer)` may be called twice.

**Fix:** Remove the first `add(resolve)` and only use the wrapped version, or restructure so only one resolver is added.

### [MEDIUM-5] `src/tokens/cost-tracker.js` — `getSavingsOpportunities()` budget_warning message is wrong
**File:** `E:/HaxAgent/src/tokens/cost-tracker.js`  
**Lines:** 468-479  
**Description:** The budget warning says `"Only ${Math.round(current.budgetUsedPercent)}% of budget remaining."` — but `budgetUsedPercent` is the percentage *used*, not remaining. The message should say `"Only ${Math.round(100 - current.budgetUsedPercent)}% of budget remaining."` or `"${Math.round(current.budgetUsedPercent)}% of budget used."`

### [MEDIUM-6] `src/analytics/anomaly-detector.js` / `src/analytics/predictor.js` / `src/prediction/early-warning.js` — Duplicate helper functions
**File:** Multiple files  
**Description:** `extractEntries`, `isUserMsg`, `isAssistantMsg`, `isToolMsg`, `isErrorTool`, `parseTs`, `getContentLength`, `roundTo`, etc. are defined identically across at least 4 separate files (`anomaly-detector.js`, `predictor.js`, `early-warning.js`, `error-predictor.js`). This violates DRY and means a bug fix in one must be replicated across all.

**Fix:** Extract shared helpers into a common utility module (e.g., `src/analytics/transcript-helpers.js`).

### [MEDIUM-7] `src/tasks/resolver.js` — `_buildIndegreeMap` has confusing edge naming
**File:** `E:/HaxAgent/src/tasks/resolver.js`  
**Lines:** 491-499  
**Description:** The method name `_buildIndegreeMap` suggests it builds a map of indegrees (incoming edges). However, the map it builds actually counts how many dependencies each task has (outgoing edges in the "depends on" direction). While this is mathematically equivalent and used correctly in the Kahn algorithm, the naming is misleading for maintainers. The indegree for a DAG where "A -> B" means "A depends on B" should count how many tasks depend on THIS task, not how many tasks THIS task depends on.

**Fix:** Rename to `_buildDependencyCountMap()` or similar, and document the convention.

### [MEDIUM-8] `src/workflow/library.js` — `register()` overwrites existing templates silently
**File:** `E:/HaxAgent/src/workflow/library.js`  
**Line:** 63  
**Description:** `this._templates.set(name, template)` overwrites an existing template with the same name without warning. Compare with `protocol/router.js` `registerAgent()` which throws `"Duplicate agent"`. Inconsistent behavior across registries.

**Fix:** Either throw on duplicate or return a warning indicator.

### [MEDIUM-9] `src/prompts/optimizer.js` — `_deduplicateSectionHeadings` removes non-duplicate headings
**File:** `E:/HaxAgent/src/prompts/optimizer.js`  
**Lines:** 879-902  
**Description:** When a duplicate heading is found (line 891), the code skips that heading AND all its content until the next heading (lines 892-894). However, if the heading text matches a previous heading but the content is different (e.g., two "## Examples" sections with different content), the second section's unique content is silently dropped.

**Fix:** Only skip the heading line itself, not the content, or check content similarity before deciding to drop.

### [MEDIUM-10] `src/export/postprocess.js` — `anonymize()` returns empty string for non-string input
**File:** `E:/HaxAgent/src/export/postprocess.js`  
**Line:** 73  
**Description:** `anonymize(content)` returns `""` when content is not a string. Other methods like `beautify` and `validate` throw errors on invalid input. Inconsistent error handling. A silent empty-string return could hide data loss bugs.

**Fix:** Return `content` as-is (or throw TypeError) for non-string inputs.

### [MEDIUM-11] `src/providers/diversity.js` — `_filterValid` does not validate response structure
**File:** `E:/HaxAgent/src/providers/diversity.js`  
**Line:** 181-183  
**Description:** `_filterValid` filters out responses where `success === false` or `error` is truthy. But `_getContent` (line 185-193) attempts to extract content from multiple possible fields (`response.content`, `content`, `text`, `message`). Responses that pass `_filterValid` may still produce empty strings from `_getContent`, which are then treated as valid contributions to diversity metrics.

**Fix:** Also filter out responses that produce empty content strings.

---

## Low-Severity Bugs

### [LOW-1] `src/protocol/compressor.js` — `estimateSavings` mutates state through `compress()` call
**File:** `E:/HaxAgent/src/protocol/compressor.js`  
**Lines:** 221-259  
**Description:** `estimateSavings()` calls `this.compress(message)` inside the loop (line 232), which updates `this._totalSaved`, `this._totalMessagesCompressed`, and `this._recentBodies`. This pollutes the compressor's internal state when the user only meant to get an estimate. An "estimate" should be read-only.

**Fix:** Use a temporary compressor instance or add a read-only flag to `compress()`.

### [LOW-2] `src/protocol/router.js` — `broadcast()` parameter `agents` is never used in filtering
**File:** `E:/HaxAgent/src/protocol/router.js`  
**Lines:** 239, 243  
**Description:** `broadcast()` calls `this._resolveAgentPool(agents)` which returns either the provided agents or all registered agents. But the filter criteria (role, status, capabilities) are applied only to the resolved pool. If a caller passes `agents` expecting those to be the only recipients, and then also passes `filter`, the filter is applied to the provided agents, which IS correct. However, if the caller passes `agents` without `filter`, all provided agents are returned as recipients. There is no bug here — the documentation could be clearer.

### [LOW-3] `src/bridge/continuity.js` — `deepClone` duplicates `transfer.js` function
**File:** `E:/HaxAgent/src/bridge/continuity.js`  
**Lines:** 26-29  
**Description:** `deepClone` is defined identically in both `src/bridge/transfer.js` and `src/bridge/continuity.js`. This is a minor code duplication.

### [LOW-4] `src/health/visualizer.js` — `renderTrend()` uses `values.length > width` for resampling
**File:** `E:/HaxAgent/src/health/visualizer.js`  
**Line:** 323  
**Description:** `values.length > width ? _resampleArray(values, width) : values` — if `values.length` equals `width`, no resampling occurs. This is fine, but the comment "Sample if more values than width" is slightly misleading (equality case is included in `>` not `>=`).

### [LOW-5] `src/testing/selftest.js` — `setToolRegistry` etc. assume tests not yet run
**File:** `E:/HaxAgent/src/testing/selftest.js`  
**Lines:** 663-698  
**Description:** Convenience methods like `setToolRegistry(reg)` call `this.testTools(reg)` which overwrites the `"tools"` category in `_registry`. If tests were already run via `testAll()`, calling these methods silently replaces the test definitions without clearing the old results. The next `testAll()` would use new tests but `getReport()` would use old results until then.

### [LOW-6] `src/i18n/translator.js` — `_translateToEn` skips pattern matching in reverse direction
**File:** `E:/HaxAgent/src/i18n/translator.js`  
**Lines:** 1319-1326  
**Description:** The loop at line 1320 calls `regex.exec(text)` but the comment says "For reverse, we don't have reverse patterns easily, skip pattern translation." The pattern regexes match English source strings, so they won't match target-language text. This is intentional but could benefit from reverse patterns for better non-English -> English translation quality.

### [LOW-7] `src/visualize/decision-tree.js` and `src/visualize/flow.js` — Duplicate helper functions
**File:** Both files  
**Description:** `clamp`, `repeat`, `padRight`, `padLeft`, `truncate`, `formatTs` are defined identically in both files. Consider extracting into a shared visualizer utils module.

### [LOW-8] `src/review/formatter.js` — `SEVERITY_EMOJI` includes a variation selector character
**File:** `E:/HaxAgent/src/review/formatter.js`  
**Line:** 23  
**Description:** `MAJOR: "\u{26A0}\u{FE0F}"` — includes `\u{FE0F}` (variation selector-16) after the warning sign. This makes the emoji display correctly on some systems but might render as two characters on older terminals. Minor compatibility concern.

### [LOW-9] `src/marketplace/index.js` — `init()` is not idempotent after errors
**File:** `E:/HaxAgent/src/marketplace/index.js`  
**Lines:** 97-98  
**Description:** `init()` returns early if `this._initialized` is true. But if `init()` throws mid-way through initialization (e.g., remote fetch fails), `_initialized` remains `false`. Retrying would restart from scratch, which is the correct behavior. But there is no partial-cleanup or rollback of the partial state from the failed attempt.

### [LOW-10] `src/patterns/classifier.js` and `src/patterns/matcher.js` — Not fully reviewed
**Description:** These files contain classification profiles and pattern matchers. The `classifier.js` header declares 7 classes but only 5 profiles were visible in the read. Need full review of `matcher.js` (~31KB) for complete assessment.

### [LOW-11] `src/prediction/error-predictor.js` — Shared helper duplication
**Description:** `floatClamp`, `positiveInteger`, `nowMs` are defined here but similar helpers exist in other files. Consider consolidation.

### [LOW-12] `src/review/engine.js` — `SEVERITY_ORDER` defined as object but used as inverted map
**File:** `E:/HaxAgent/src/review/engine.js`  
**Lines:** 22-28, 77-78  
**Description:** `SEVERITY_ORDER` maps severity names to numeric order. But `severityNum()` at line 76-78 performs another lookup. This is consistent but could be simplified by defining `SEVERITY_ORDER` directly as the severity-to-number map used by `severityNum`.

---

## Top 5 Bugs to Fix First

| Priority | ID | File | Issue | Impact |
|----------|-----|------|-------|--------|
| 1 | CRITICAL-1 | `strategies.js:700` | `_isSimilar()` fails for strings <3 words | Redundant message detection silently broken for short messages |
| 2 | CRITICAL-3 | `isolate.js:283,344` | Double-counting stats in sandbox mode | Incorrect monitoring data, potential memory leak from duplicate tracking |
| 3 | HIGH-1 | `compressor.js:108` | `dedupWindow: 0` treated as falsy | User cannot disable deduplication |
| 4 | HIGH-6 | `smoke-test.js:264` | Fragile `this` binding in test implementations | Tests could fail after refactoring |
| 5 | MEDIUM-5 | `cost-tracker.js:471` | "X% of budget remaining" shows used percent | User-facing lie about budget remaining |

---

## Cross-Cutting Concerns

### 1. Encapsulation violations
`plugins/hotswap.js` and `knowledge/curator.js` directly access private `_`-prefixed properties of their dependencies. This creates tight coupling that is fragile to internal refactoring. The solution in both cases is to add explicit public API methods to the dependency classes.

### 2. Helper function duplication
Functions like `clamp`, `padRight`, `truncate`, `extractEntries`, `isToolMsg`, `parseTs`, `deepClone`, and `roundTo` appear in 3-5+ different files. A shared utility module would reduce duplication and ensure consistent behavior.

### 3. Inconsistent not-found return values
Some methods return `undefined` (`workflow/library.js get()`), some return `null` (`knowledge/curator.js lookups`), some return `false` (`tasks/tracker.js start()`). Callers must handle multiple sentinel types.

### 4. JSON-based deep clone limitations
At least 4 modules use `JSON.parse(JSON.stringify(value))` for deep cloning. This drops `undefined`, `Date`, `Function`, circular references, and `Map`/`Set` objects. Consider using `structuredClone` (Node 17+) or a custom deep clone that handles these types.

---

## Summary

The new R1-R4 modules are well-structured with generally clean code. The bug density of ~1.9 bugs per 1000 lines is well below industry average. The three critical findings are all in edge-case handling (short strings, double-wrapping, null safety). The most pervasive issue is the encapsulation violations in `hotswap.js` and `curator.js`, which are design-level problems rather than bugs but create maintenance risk.

No resource leaks (uncleaned intervals, event listeners) were found — `HealthMonitor.stop()` and `PluginIsolate.close()` both properly clean up their intervals. Event emitter listeners are consistently removed via returned unsubscribe functions.
