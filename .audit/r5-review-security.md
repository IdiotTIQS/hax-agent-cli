# Security Review — Rounds R1-R4 New Modules

**Project:** HaxAgent  
**Review date:** 2026-05-22  
**Scope:** 50 files across 25 new module directories created in R1-R4  
**Reviewer:** Automated security audit

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH     | 4 |
| MEDIUM   | 5 |
| LOW      | 7 |

Overall, the codebase shows strong security hygiene — extensive input validation via `requireString`, `TypeError` guards, and bounded collections (maps with max-size capping, history ring buffers). No `eval()` or `new Function()` usage was found in the new modules. The main concerns cluster around two themes: **dynamic `require()` on filesystem paths** and **ReDoS potential in regex-heavy text processing**.

---

## CRITICAL Findings

### C1: Dynamic `require()` on untrusted paths — Code execution risk

**File:** `E:/HaxAgent/src/marketplace/index.js`  
**Lines:** 319, 383, 874

**Description:**  
`PluginMarketplace.install()`, `update()`, and `_findInstalledFiles()` all use `require(destPath)` / `require(fullPath)` to load installed plugins dynamically. If an attacker can write a `.js` file into the plugin directory (via a malicious plugin submission, a dependency-chain attack, or file-system misconfiguration), `require()` will execute that code in the Node.js process context with full privileges.

**Code references:**

```javascript
// Line 319 — install()
delete require.cache[require.resolve(destPath)];
const installed = require(destPath);

// Line 383 — update()
delete require.cache[require.resolve(installedPath)];
const mod = require(installedPath);

// Line 874 — _findInstalledFiles()
delete require.cache[require.resolve(fullPath)];
const mod = require(fullPath);
```

**Risk:** Remote code execution if an attacker controls a plugin file.  
**Recommendation:**  
1. Use `vm.Script` with a sandboxed context (or `node:vm` module) to load plugin code in an isolated compartment with restricted globals (`require`, `process`, `fs`, etc. denied or narrowly gated).  
2. Alternatively, statically validate plugin source against an allowlist before `require()` (e.g., verify the file was previously reviewed/accepted by the `MarketplaceCurator`).  
3. Ensure the install directory is writable only by the plugin management process, not by external actors.

---

### C2: `require()` in plugin loading bypasses security checks

**File:** `E:/HaxAgent/src/marketplace/index.js`  
**Lines:** 303-308

**Description:**  
When `install()` copies a file from a local source, it immediately `require()`s the file at the destination. There is no integrity check between the copy and the `require()`. A TOCTOU (time-of-check/time-of-use) race condition exists: a file could be swapped between `fs.copyFileSync` and `require()` in a concurrent-access scenario.

**Code reference:**
```javascript
// Line 301-319
destPath = path.join(resolvedTarget, fileName);
fs.copyFileSync(srcPath, destPath);
// ... immediately followed by ...
const installed = require(destPath);
```

**Recommendation:** Add a SHA-256 hash check between copy and load. Verify the file at `destPath` has the expected content before `require()`-ing it.

---

## HIGH Findings

### H1: Shell command execution via `execSync` for disk detection

**File:** `E:/HaxAgent/src/config/environment.js`  
**Lines:** 413-427

**Description:**  
`getResourceLimits()` uses `execSync` to run `wmic` (Windows) or `df` (Unix) commands to detect free disk space. While the commands are hardcoded, the `cwd[0]` character (first character of current working directory) is interpolated into the command string. An attacker who can control the working directory (e.g., to a path starting with a special character) could theoretically alter the command semantics on Windows. Additionally, `execSync` with `timeout: 3000` catches errors via try/catch but still spawns a child process that could hang briefly under extreme conditions.

**Code reference:**
```javascript
const stdout = execSync(
  `wmic logicaldisk where "DeviceID='${cwd[0]}:'" get FreeSpace`,
  { encoding: "utf8", timeout: 3000 }
);
```

**Risk:** Medium — constrained but unnecessary shell execution.  
**Recommendation:**  
1. Use `require('child_process').execFileSync` instead of `execSync` to avoid shell interpretation.  
2. On Windows, use `fs.statvfs`-equivalent APIs or the built-in `os` module extensions rather than shelling out.  
3. Validate `cwd[0]` is a letter `[A-Za-z]` before interpolation.

---

### H2: Unbounded regex processing on potentially adversarial input

**File:** `E:/HaxAgent/src/providers/synthesizer.js`  
**Line:** 303

**Description:**  
`_extractSentences()` calls `content.split(/[.!?]+/)` on raw response text from potentially untrusted providers. If a provider returns a string consisting of millions of alternating `"a.b"` patterns, this split can consume unbounded CPU (no length limit before splitting). The same issue exists in `_extractKeyPhrases()` (line 309) and `rankQuality()` (line 215-216).

**Code reference:**
```javascript
_extractSentences(content) {
  const text = String(content || "");
  return text.split(/[.!?]+/).map(...).filter(...);
}
```

**Risk:** Potential DoS via crafted provider responses.  
**Recommendation:** Add a `content.slice(0, 50000)` length guard (or configurable limit) before splitting. Apply the same limit to all regex-based content extraction methods in this class.

---

### H3: ReDoS via repeated regex scanning in review engine

**File:** `E:/HaxAgent/src/review/engine.js`  
**Lines:** 155-318 (security review), 345-475 (performance review)

**Description:**  
The `reviewSecurity()` function applies ~15 regex patterns sequentially over the full file content, with many being run per-line via `findMatches()` which re-compiles patterns for each line. For a 10,000-line file, this means roughly 150,000 regex evaluations. Each regex is a static pattern (no catastrophic backtracking in the patterns themselves), but the volume is high.

**Risk:** Medium DoS risk for large code reviews.  
**Recommendation:**  
1. Add a file size cap (e.g., skip or sample files > 500KB).  
2. Pre-compile all regex patterns once in the module scope rather than inside the review functions.  
3. Use a single-pass scanner that applies all patterns per line rather than scanning the entire content multiple times per pattern.

---

### H4: `hookFn.toString()` on untrusted plugin code

**File:** `E:/HaxAgent/src/marketplace/curation.js`  
**Lines:** 483-492, 526-546

**Description:**  
`_checkSecurity()` and `_checkPerformance()` call `hookFn.toString()` on every hook function in the plugin. While `Function.prototype.toString()` is generally safe, a maliciously crafted plugin could have an extremely large function body (megabytes), causing unbounded memory allocation. There is no length guard.

**Code reference:**
```javascript
const fnStr = hookFn.toString();
for (const rule of SECURITY_PATTERNS) {
  if (rule.pattern.test(fnStr)) { ... }
}
```

**Recommendation:** Add a guard: `const fnStr = hookFn.toString().slice(0, 50000);` before regex matching.

---

## MEDIUM Findings

### M1: `new RegExp()` from dictionary keys in translator

**File:** `E:/HaxAgent/src/i18n/translator.js`  
**Lines:** 1254-1258

**Description:**  
`_translateTokens()` constructs `new RegExp(escaped, "gi")` for each dictionary phrase. The escaping at line 1255 properly handles regex-special characters. However, with 500+ dictionary entries, and the regex being re-created per invocation of `_translateTokens()` (called recursively in `_translateEnTo()`), this has a performance cost. No security exploit identified — the escaping is correct.

**Code reference:**
```javascript
const regex = new RegExp(
  phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  "gi"
);
```

**Risk:** Performance, not security. Validated — escaping is safe.

---

### M2: Unbounded collections in health monitoring

**File:** `E:/HaxAgent/src/health/monitor.js`  
**Lines:** 277-280 (history), 536-539 (alerts)

**Description:**  
Both `_history` and `_alerts` arrays grow unboundedly during monitoring. The ring-buffer trim (`_history.shift()`) only fires when exceeding `_maxHistory` (default 1000), and the alert cap is similarly bounded. These defaults are sane and configurable. No active DoS risk, but operators should be aware that high-frequency checking with large defaults can consume memory.

**Status:** Acceptable — already bounded with configurable caps.

---

### M3: `console.log` on sensitive configuration in profiler

**File:** `E:/HaxAgent/src/config/profiler.js`  
**Lines:** 372-381

**Description:**  
When `agent.apiKey` is found in the configuration, `profile()` correctly redacts the value (`currentValue: "[REDACTED]"`). However, `getReportText()` at line 692 will `JSON.stringify()` current config values, potentially exposing them in text output. The `apiKey` case is handled, but other sensitive keys (custom secret keys, tokens in nested objects) are not.

**Code reference:**
```javascript
lines.push(
  `  ${sug.path}: ${JSON.stringify(sug.currentValue)} -> ${JSON.stringify(sug.recommendedValue)}`
);
```

**Recommendation:** Add a general `REDACTED_KEYS` list (e.g., any path containing "key", "secret", "token", "password") that is always replaced with `[REDACTED]` in `getReportText()` output.

---

### M4: Path traversal in `_findInstalledFiles()` directory traversal

**File:** `E:/HaxAgent/src/marketplace/index.js`  
**Lines:** 863-888

**Description:**  
`_findInstalledFiles()` reads all `.js` files in a directory and `require()`s each one to check if it exports a matching plugin name. If an attacker places a malicious `.js` file in the install directory, `require()` will execute it. This is related to C1 but distinct: even the *scanning* step is dangerous.

**Code reference:**
```javascript
const entries = fs.readdirSync(dir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isFile() && entry.name.endsWith(".js")) {
    const fullPath = path.join(dir, entry.name);
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);  // <-- executes all .js in dir
```

**Recommendation:** Do not `require()` files during scanning. Instead, use a static parser or a safer inspection method (e.g., `vm.Script` or regex-based name extraction).

---

### M5: `JSON.stringify()` deep clone on untrusted structures

**File:** Multiple files (`src/bridge/continuity.js:28`, `src/bridge/transfer.js:26`, etc.)

**Description:**  
The pattern `JSON.parse(JSON.stringify(value))` is used extensively for deep cloning. This pattern throws on circular references (which is acceptable behavior) and silently drops functions, `undefined`, `Symbol`, and `BigInt` values. If untrusted data contains large payloads, `JSON.stringify` will allocate proportional memory without a length guard. This is a general concern but mitigated by the fact that these modules process session/checkpoint/context data, which comes from the trusted application, not direct user input.

**Status:** Acceptable for in-process data — not exposed to external input. The pattern is consistent across the codebase.

---

## LOW Findings

### L1: Token estimator regex may fail on very long strings

**File:** `E:/HaxAgent/src/protocol/compressor.js`  
**Lines:** 57, 69

`text.match(TOKEN_PATTERN)` on `JSON.stringify(value)` for large objects could return an array with millions of entries, consuming significant memory. Add a result cap or use a streaming count.

### L2: Histogram regex compilation in fingerprint

**File:** `E:/HaxAgent/src/similarity/fingerprint.js`  
**Line:** 186

`new RegExp("\\b" + kw + "\\b", "g")` is compiled per keyword invocation. The keyword list is static, so this could be pre-compiled. Low severity — only called once per fingerprint.

### L3: `TextEncoder` instantiation per split call

**File:** `E:/HaxAgent/src/export/postprocess.js`  
**Line:** 266

`new TextEncoder()` is created inside `split()`. For large split operations, this creates unnecessary GC pressure. Could be hoisted to module scope or a cached instance.

### L4: `new Set()` per search in knowledge accumulator

**File:** `E:/HaxAgent/src/knowledge/accumulator.js`  
**Lines:** 284-285

`_computeSetOverlap` creates potentially large `Set` objects from knowledge item tokens without a size guard. In edge cases with very large items, this could cause memory pressure.

### L5: `process.hrtime.bigint()` used for timing without overflow check

**File:** Multiple testing/selftest files

Timing uses `process.hrtime.bigint()` converted to milliseconds via division. No overflow concern for this use case (durations are sub-minute). Acceptable.

### L6: `debug()` dependency in prediction modules

**File:** `E:/HaxAgent/src/prediction/early-warning.js:436`, `E:/HaxAgent/src/prediction/error-predictor.js:343`

Calls `debug("early-warning", ...)` which likely writes to stdout/stderr. If the debug module writes verbose data including session content, it could leak potentially sensitive information. Verify that the `debug` function does not log full message content.

### L7: No input sanitization before `simpleHash` in conversation loop detection

**File:** `E:/HaxAgent/src/prediction/early-warning.js`  
**Line:** 664-668

The `_simpleHash()` function operates on `e.content` directly. If content is extremely large (tens of megabytes), the hash loop will consume proportional CPU. Add a `content.slice(0, 5000)` guard before hashing.

---

## Positive Findings

The following security-positive practices are consistently applied across all reviewed modules:

1. **Input validation is systematic** — nearly every public method validates parameter types via `requireString()`, `TypeError` guards, `Array.isArray()` checks, and `typeof` assertions.

2. **No dynamic code execution** — No `eval()`, `new Function()`, or `vm.runInNewContext()` was found in any new module (the `require()` in the marketplace module is the only dynamic code loading, and it is a feature, not a bypass).

3. **Collection bounds are enforced** — Maps, arrays, and ring buffers have configurable or hard-coded maximum sizes with automatic eviction (e.g., `_maxHistory`, `_maxItems`, `_maxAlerts`).

4. **PII/anonymization is built in** — `src/export/pipeline.js` and `src/export/postprocess.js` contain comprehensive PII detection patterns (email, phone, SSN, API keys, credit cards, IP addresses) for export safety.

5. **Error isolation in plugins** — `src/plugins/isolate.js` wraps all plugin hooks with try/catch and timeout guards to prevent a single plugin crash from bringing down the system.

6. **ReDoS awareness** — `src/review/engine.js` includes a dedicated ReDoS detection pattern (`nested quantifiers`, `polynomial backtracking`) in its security reviewer.

7. **Secret detection in curator** — `src/marketplace/curation.js` has a `SECURITY_PATTERNS` array that scans plugin code for `eval()`, `child_process`, `process.env`, and `__proto__` usage before allowing marketplace publication.

8. **Safe-by-default governance** — `src/governance/policy-engine.js` defaults to deny (safe-by-default) for agent actions, with explicit ALLOW rules required.

---

## Recommendations by Priority

1. **Immediate:** Replace `require()`-based plugin loading in `marketplace/index.js` with `vm.Script` sandboxing.
2. **High:** Add content-length guards before regex operations in `providers/synthesizer.js`, `review/engine.js`, and `knowledge/curator.js`.
3. **High:** Replace `execSync` shell commands in `config/environment.js` with native Node.js APIs.
4. **Medium:** Add `toString().slice(0, 50000)` guard in `marketplace/curation.js` before scanning plugin hook bodies.
5. **Medium:** Broaden the REDACTED_KEYS list in `config/profiler.js` to cover token, secret, and password-containing paths.
6. **Low:** Add content-length guards before hashing in `prediction/early-warning.js`.
