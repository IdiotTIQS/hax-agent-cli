# Performance Audit: R1-R4 New Modules

**Audit date:** 2026-05-23
**Scope:** 104 files across 23 directories
**Reviewer:** Automated (Claude)
**Overall Performance Score: 72/100 — MODERATE CONCERN**

---

## Executive Summary

The new modules across rounds R1-R4 are generally well-structured with configurable limits and proper resource cleanup. However, several systematic performance issues exist: pervasive use of synchronous filesystem operations in async-capable contexts, O(n^2) pairwise comparison algorithms in the similarity and dependency modules, repeated JSON.parse/JSON.stringify deep-clone operations on large objects, and unbounded trend collections in several monitoring modules. These are unlikely to cause immediate failures but will degrade performance under scale — large codebases for the similarity detector, many sessions for the analytics pipeline, and many plugins for the marketplace.

---

## 1. Synchronous Blocking Patterns

### 1.1 Sync FS throughout plugin/marketplace infrastructure (HIGH impact)

**Files affected:**
- `src/plugins/indexer.js` — `fs.existsSync`, `fs.statSync`, `fs.readdirSync`, sync `require()`
- `src/plugins/repository.js` — `fs.existsSync`, `fs.readdirSync`, `fs.copyFileSync`, sync `require()`
- `src/marketplace/index.js` — `fs.existsSync`, `fs.readdirSync`, `fs.mkdirSync`, `fs.writeFileSync`, `fs.copyFileSync`, sync `require()` + `delete require.cache`

**Impact:** Every plugin scan, install, update, or uninstall operation blocks the event loop for the duration of filesystem I/O. In the marketplace `init()`, `_findInstalledFiles()` iterates all .js files, `require()`s each one, then `delete`s the cache — this is ~O(files) sync I/O + module evaluation.

**Recommendation:** Use `fs.promises` API for all marketplace/plugin operations. Avoid in-line `require()` for file scanning — use static analysis or a metadata file instead.

### 1.2 Sync FS in health scoring (MEDIUM impact)

**Files affected:**
- `src/health/scorer.js` — `fs.readFileSync` per file, `fs.readdirSync` in `walkDir`
- `src/similarity/fingerprint.js` — `fs.readFileSync`, `fs.statSync`, `fs.existsSync`
- `src/similarity/detector.js` — synchronous crypto hashing per block

**Impact:** Directory-level health scoring and fingerprinting read every file synchronously. For a project with 1000+ files, this causes a noticeable event-loop pause. The `CloneDetector.findExactClones()` hashes every code block synchronously.

**Recommendation:** Batch file reads with `Promise.all` and `fs.promises.readFile`. Use worker threads for CPU-intensive hashing in the similarity detector.

### 1.3 Sync exec in environment detection (LOW impact, startup only)

**Files affected:**
- `src/config/environment.js` — `execSync` for disk space detection, `fs.readFileSync` for container detection

**Impact:** These only run at startup, so impact is limited. However, `execSync` for disk space can block for seconds on some filesystems.

**Recommendation:** Use async alternatives or defer disk-space detection until first use.

---

## 2. Memory Patterns and Allocation

### 2.1 Repeated JSON deep-cloning of large objects (HIGH impact)

**Files affected:**
- `src/bridge/continuity.js` — `deepClone()` via `JSON.parse(JSON.stringify())` on every `checkpoint()`, `resume()`, `listCheckpoints()`, `compare()`, `getCheckpoint()`
- `src/bridge/transfer.js` — same pattern in `capture()`, `transfer()`, `merge()`
- `src/workflow/engine.js` — `clone()` at `getDefinition()`
- `src/workflow/library.js` — `cloneSteps()`, `deepClone()` at `instantiate()`, every template access
- `src/workflow/scheduler.js` — `cloneWorkflow()` at `schedule()`

**Impact:** These modules call JSON.parse/JSON.stringify on objects that include full message arrays, checkpoint contexts, and workflow definitions. Each clone allocates a complete copy. For sessions with 100+ messages, this is substantial GC pressure.

**Recommendation:** Use structural sharing via `structuredClone()` (available in Node 17+), or implement a shallow-copy-with-immutable-update pattern. For the bridge, consider storing checkpoints as references and cloning only on export.

### 2.2 2D grid allocation in HealthVisualizer.renderRadar (MEDIUM impact)

**File:** `src/health/visualizer.js` line ~400

Every `renderRadar()` call creates a `height × width` 2D grid of objects `{ char, color }`, then fills rings by iterating 360 degrees at 2-degree resolution per ring. For a standard 36×8 grid this is ~288 cells, but the ring-drawing loop produces `maxRadius * 180 * axes` iterations.

**Recommendation:** Pre-allocate the grid once and reuse it via a pool, or render lazily via string concatenation instead of a cell array.

### 2.3 Configurable but potentially large caches (LOW impact)

The following have sensible configurable limits, which is good practice:

| Module | Cache | Default Limit |
|--------|-------|--------------|
| `CostTracker._records` | token usage records | 10,000 |
| `HealthMonitor._history` | health snapshots | 1,000 |
| `TokenMonitor._events` | token events | 10,000 |
| `TokenMonitor._trendBuckets` | trend data | 100 buckets |
| `TokenMonitor._alertHistory` | alerts | 500 |
| `PolicyAuditor._auditTrail` | audit entries | 1,000 |
| `KnowledgeAccumulator._items` | knowledge items | 10,000 |

**No unbounded growth detected.** All tracked data structures have pruning logic.

---

## 3. Algorithmic Efficiency

### 3.1 O(n^2) pairwise comparisons in similarity detection (HIGH impact)

**File:** `src/similarity/detector.js`

`findNearClones()` (lines 689-803) and `findStructuralClones()` (lines 813-928) both use nested loops over ALL extracted blocks:

```javascript
for (let i = 0; i < allBlocks.length; i++) {
  for (let j = i + 1; j < allBlocks.length; j++) {
    // Jaccard similarity computation + group merging
  }
}
```

For a codebase producing 500 blocks, this is ~125,000 pairwise comparisons, each computing Jaccard similarity on n-gram sets. If each block has 100 n-grams, total operations are in the millions. The structural variant additionally calls `extractNGrams()` at comparison time rather than pre-computing.

**Recommendation:** Use locality-sensitive hashing (LSH) or MinHash for near-duplicate detection. For exact clones, the hash-based approach is already correct. For structural clones, pre-compute n-gram sets during extraction rather than reconstructing them.

### 3.2 Redundant work in ProtocolCompressor.estimateSavings (MEDIUM impact)

**File:** `src/protocol/compressor.js` line 221

`estimateSavings()` calls `this.compress(message)` for every message, each of which computes full token estimates. Then it also calls `estimateTokens()` separately. The compress call internally computes the compressed form; this work could be shared.

**Recommendation:** Refactor `compress()` to return both the compressed form and the token count in one pass.

### 3.3 Linear scan in _deduplicateBody character-by-character (MEDIUM impact)

**File:** `src/protocol/compressor.js` line 299

`_deduplicateBody()` loops over recent bodies and does a character-by-character scan to find the longest common prefix. For long message bodies and a window size of 5+, this is O(bodies * body_length).

**Recommendation:** Use a radix tree or prefix trie for common-prefix detection, or simply skip this optimization when bodies are short.

### 3.4 CostTracker._resolvePricing fuzzy match loop (LOW-MEDIUM impact)

**File:** `src/providers/cost-tracker.js` line 578

When a model name doesn't directly match `MODEL_PRICING`, the fallback iterates over ALL entries doing substring matching:

```javascript
for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
  if (normalized.includes(key) || key.includes(normalized)) return pricing;
}
```

This is called on every `track()` call. For 56 model entries, this adds a few microseconds per call — negligible individually but accumulates under high-frequency token tracking.

**Recommendation:** Pre-build a normalized-to-canonical map at construction time. Only do fuzzy matching for truly unknown models.

### 3.5 DependencyGraph.checkConflicts nested loops (LOW impact)

**File:** `src/plugins/dependency.js` line 348

`checkConflicts()` has a triple-nested structure: for each dependency → pairwise range comparison → semver parsing. For typical plugin graphs (<100 nodes), this is fine. Only becomes problematic with very large dependency trees.

---

## 4. Module Loading

### 4.1 Dynamic require() with cache clearing (MEDIUM impact)

**Files affected:**
- `src/plugins/indexer.js` — `delete require.cache[require.resolve()]` + `require()` per file
- `src/plugins/repository.js` — same pattern
- `src/marketplace/index.js` — same pattern in `install()`, `update()`, `_findInstalledFiles()`

**Impact:** `require.cache` manipulation forces Node.js to re-parse and re-evaluate the module, which is expensive. The `_findInstalledFiles()` method in marketplace (line 863-888) does this for EVERY .js file in the install directory to match plugin names — this is O(files) * module evaluation cost.

**Recommendation:** Use a lightweight metadata file (e.g., `plugin.json`) that carries `name` and `version` without requiring full module evaluation. Parse exports with static analysis or store a sidecar manifest.

### 4.2 Large prompt templates loaded eagerly (LOW impact)

**File:** `src/prompts/templates.js` — 741 lines, 10 large template functions
**File:** `src/prompts/roles.js` — 471 lines, 10 large role definitions

These are string-heavy modules with multi-kilobyte template strings. While they are import-time costs (not hot-path), they contribute to startup latency.

**Recommendation:** Consider lazy-loading templates only when first requested.

---

## 5. Hot Path Analysis

### 5.1 TokenMonitor.trackUsage() — called on every token event (HIGH frequency)

**File:** `src/tokens/monitor.js`

This is the highest-frequency function in the tokens module. On every call it:
1. Creates a record object
2. Pushes to events array
3. Runs `shift()` pruning (O(n) array shift)
4. Updates category usage map
5. Updates trend bucket (with potential sort + prune)
6. Runs `_generateAlerts()` which calls `getBudget()` and scans recent events

The `shift()`-based pruning on `_events` is particularly expensive — each shift moves every remaining element.

**Recommendation:** Use a ring buffer for `_events` instead of array with `shift()`. Defer alert generation to a periodic check rather than every event.

### 5.2 EarlyWarningSystem.monitor() — 5 detectors per cycle (MEDIUM frequency)

**File:** `src/prediction/early-warning.js`

Each `monitor()` call runs all 5 detectors (`_detectTokenAcceleration`, `_detectErrorRateIncrease`, etc.), each of which iterates through entries, computes means, compares against baselines, and potentially pushes warnings.

**Recommendation:** Sample entries rather than processing every single one. Run detectors at different intervals based on urgency (e.g., loop detection every 5 cycles, token acceleration every cycle).

### 5.3 ConfigProfiler.profile() — full schema traversal (LOW frequency)

**File:** `src/config/profiler.js`

`profile()` flattens the entire config object (recursive walk), then iterates the full flattened schema, all SUBOPTIMAL_PATTERNS, and checks for unrecognized keys. This is called once on startup, so impact is minimal.

**Recommendation:** No changes needed — acceptable for startup-only use.

### 5.4 MessageRouter.route() — multiple array filters (HIGH frequency, MEDIUM concern)

**File:** `src/protocol/router.js`

`route()` calls `_resolveAgentPool()` which does `Array.from()` + `normalizeAgent()` on every agent. It then does sequential filter passes for each strategy. The agent pool is typically small (<50 agents), so this is fast, but there is unnecessary array copying.

**Recommendation:** Cache the resolved agent list and invalidate on register/unregister. Avoid `Array.from` when the pool is already an array.

---

## 6. Resource Cleanup

### 6.1 Proper cleanup: PASS

The following lifecycle patterns are correctly implemented:

| Module | Resource | Cleanup |
|--------|----------|---------|
| `HealthMonitor` | `setInterval` | `stop()` / `reset()` calls `clearInterval` |
| `WorkflowScheduler` | `setTimeout` | `cancel()` / `remove()` / `clear()` clean up timers |
| `PluginIsolate` | `setInterval` | `_stopMonitor()` via `close()` |
| `HealthVisualizer` | No persistent state | N/A — stateless rendering |

### 6.2 Potential concern: WorkflowEngine runParallel setTimeout handles (LOW)

**File:** `src/workflow/engine.js`

`withTimeout()` creates a `setTimeout` per step but does not clear it if the step completes successfully. The `Promise.race` resolves but the timeout timer continues to run until it fires. For workflows with many steps, this accumulates idle timers.

**Recommendation:** Store timeout handles and clear them in the `.then()` block of `Promise.race`.

---

## 7. Memory Leak Risks

### 7.1 No verified leaks — LOW risk overall

After systematic review of all 104 files:

- **EventEmitter listeners:** No pattern of `on()` without corresponding `off()`. The `HealthMonitor`, `WorkflowEngine`, `TaskTracker`, and `ErrorPredictor` all extend EventEmitter but listeners are managed externally.
- **Closure captures:** No large-context closures that could retain session data indefinitely.
- **Global state:** No module-level mutable state that grows without bound. All caches have size limits with pruning.
- **Timer leaks:** `PluginIsolate.monitor()` and `HealthMonitor.start()` provide explicit stop mechanisms. `WorkflowEngine.withTimeout()` has a minor issue noted above.

### 7.2 Watch: _swapHistory in PluginHotSwap

**File:** `src/plugins/hotswap.js`

`_swapHistory` is capped at `_maxHistory` (default 100) and trimmed via `_trimHistory()`. Each entry stores `previousPlugin` which contains function references to hook handlers. While capped, this prevents hook functions from being garbage collected.

**Impact:** Minor — capped at 100 entries. Only relevant in extreme plugin-churn scenarios.

---

## 8. Top 5 Performance Fixes

### Fix 1: Replace O(n^2) clone detection with LSH / MinHash
**Priority: HIGH | Effort: Large | Impact: 10-100x speedup for large codebases**

`src/similarity/detector.js` — the `findNearClones()` and `findStructuralClones()` methods are the most algorithmically expensive code in the new modules. Use MinHash + LSH to reduce pairwise comparisons from O(n^2) to O(n).

### Fix 2: Replace array.shift() with ring buffer in TokenMonitor
**Priority: HIGH | Effort: Small | Impact: Eliminates O(n) per-event cost**

`src/tokens/monitor.js` — `_events`, `_trendBuckets`, and `_alertHistory` all use array `.shift()` for pruning. Replace with a ring-buffer or a `head`/`tail` index that wraps.

### Fix 3: Remove sync filesystem operations from plugin/marketplace hot paths
**Priority: HIGH | Effort: Medium | Impact: Prevents event-loop blockage**

`src/plugins/indexer.js`, `src/plugins/repository.js`, `src/marketplace/index.js` — all plugin I/O should use `fs.promises`. Replace `require()`-based plugin file scanning with manifest-based discovery.

### Fix 4: Reduce JSON.parse/JSON.stringify deep-clone overhead in bridge
**Priority: MEDIUM | Effort: Medium | Impact: Reduce GC pressure on context capture**

`src/bridge/continuity.js` and `src/bridge/transfer.js` — use `structuredClone()` or implement copy-on-write for checkpoint objects. The `capture()` method clones the entire context object including message digests; consider returning immutable frozen objects.

### Fix 5: Clear timeout handles in WorkflowEngine.withTimeout
**Priority: MEDIUM | Effort: Small | Impact: Prevent timer accumulation**

`src/workflow/engine.js` — the `withTimeout()` helper creates a `setTimeout` that is never cleared if the promise resolves first. For workflows with 50+ steps, this leaves 50 idle timers. Store and clear in the `.then()` handler.

---

## 9. Optimization Recommendations

### Algorithmic

| Area | Current | Recommended |
|------|---------|------------|
| Clone detection | O(n^2) pairwise Jaccard | MinHash + LSH buckets |
| Body dedup | Character-by-character scan | Prefix trie or Bloom pre-filter |
| CostTracker pricing | Linear O(models) lookup per track() | Pre-built map with normalized keys |
| TokenMonitor pruning | Array.shift() | Ring buffer with head/tail |
| Similarity fingerprinting | Sequential sync file reads | Promise.all with concurrency limit |

### Memory

| Area | Current | Recommended |
|------|---------|------------|
| Bridge checkpoints | Full JSON deep-clone per op | structuredClone() or immutable snapshots |
| Workflow library | JSON deep-clone at instantiate() | Share immutable template objects |
| HealthVisualizer radar | New 2D grid each render() | Object pool or lazy string build |
| MessageRouter pool | Array.from() every route() | Cache until mutation |

### Module Loading

| Area | Current | Recommended |
|------|---------|------------|
| Plugin scanning | require() per file + cache delete | Manifest file (plugin.json) |
| Marketplace findInstalled | require() all .js files | Manifest-based lookup |
| Prompt templates | All 10 loaded at import | Lazy load on first use |
| Config environment | execSync at startup | Defer to first access or use async |

---

## 10. Module-by-Module Scores

| Directory | Score | Key Issues |
|-----------|-------|------------|
| `protocol/` | 82 | Token estimator called twice; body dedup O(n*m) |
| `bridge/` | 72 | JSON deep-clone everywhere; repeated on every op |
| `similarity/` | 55 | O(n^2) clone detection; sync crypto + fs in hot path |
| `tokens/` | 68 | Array.shift() pruning; alerts generated every track() |
| `health/` | 75 | Sync FS for directory scoring; radar grid allocation |
| `i18n/` | 90 | Largely static data; no runtime concerns |
| `testing/` | 95 | Small files; no performance issues |
| `plugins/` | 65 | Sync require() + cache manipulation; sync FS everywhere |
| `visualize/` | 78 | Grid allocation per render; otherwise stateless |
| `knowledge/` | 82 | Configurable limits; reasonable patterns |
| `governance/` | 85 | Clean policy evaluation; capped audit trail |
| `prompts/` | 80 | Eager load of large strings; AB-test engine is heavy |
| `workflow/` | 72 | JSON clone patterns; uncleared timeout handles |
| `tasks/` | 92 | Clean Map-based; no algorithmic concerns |
| `models/` | 88 | Static lookup tables; reasonable query patterns |
| `prediction/` | 75 | 6 predictors run every call; shift() pruning |
| `marketplace/` | 62 | Sync FS + require() everywhere; O(files) install scan |
| `export/` | 78 | PII regex applied to full content; TextEncoder per split |
| `config/` | 80 | execSync at startup; flatten() recursion |
| `analytics/` | 82 | Reasonable streaming analysis; no major issues |
| `providers/` | 78 | Linear pricing lookup; large files but no algorithmic issues |
| `review/` | 85 | Lightweight; scoring is simple arithmetic |
| `skills/` | 88 | Registry-based; no performance concerns |

---

## 11. Final Assessment

**Overall Performance Score: 72/100 (MODERATE)**

The new modules demonstrate good engineering practices with configurable limits, proper resource cleanup, and attention to bounded data structures. The primary performance risks are:

1. **Algorithmic complexity in similarity detection** — the O(n^2) pairwise comparison will be the first bottleneck to appear under real load
2. **Synchronous I/O in plugin/marketplace** — blocks the event loop and prevents concurrent operations
3. **Repeated deep-cloning** — generates significant GC pressure, especially in the context bridge
4. **Array.shift() pruning in monitoring** — an easily-fixed anti-pattern that compounds under high-frequency event tracking

These issues are unlikely to cause failures under light use but will manifest as degraded throughput and increased latency under moderate-to-heavy workloads (large codebases for similarity, many concurrent sessions for monitoring). The top 5 fixes listed above address the highest-impact items and are recommended for the next development round.
