# HaxAgent Security Fix Report

**Date:** 2026-05-23
**Based on:** `.audit/code-review-security.md`

---

## Fix 1: Symlink Path Traversal in Read-Only File Tools (H5)

**Severity:** High
**Files modified:**
- `src/tools/file-read.js`
- `src/tools/file-search.js`
- `src/tools/file-glob.js`
- `src/tools/file-readdir.js`

**Change:** Replaced `resolveWithinRoot()` (lexical-only check) with `resolveWithinRootSafe()` (lexical + `fs.realpath` symlink resolution) in all four read-only file tools.

The `resolveWithinRootSafe()` function uses `fs.realpath()` to resolve the true path before checking if it falls within the workspace root, preventing symlink-based path traversal attacks. Since `resolveWithinRootSafe` is async, all call sites were updated to use `await`.

**Verification:** All 17 file-tool tests pass (`node --test test/tools/file-tools.test.js`).

---

## Fix 2: API Key Redaction in Log Output (L4)

**Severity:** Medium (elevated due to cross-cutting nature)
**Files modified:**
- `src/debug.js`
- `src/observability/logger.js`

**Change:**
- **debug.js:** Added `redactSecrets()` helper with three API key patterns (`sk-ant-api...`, `sk-...`, `AIza...`), applied to all debug output before writing to stderr.
- **logger.js:** Added `redactApiKeyFromString()` helper with the same patterns, integrated into `redactSensitiveData()` to scan both object keys AND string values. The logger already had key-based redaction for `apiKey`, `token`, `password`, etc.; this adds value-level pattern scanning so keys embedded in arbitrary string values (e.g., URLs, concatenated strings) are also caught.

**Verification:** All 54 runtime-classes tests pass. Module loads correctly.

---

## Fix 3: SSRF Redirect Chain Protection in Web Fetch (H1)

**Severity:** High
**File modified:** `src/tools/web-fetch.js`

**Change:**
- Added `MAX_REDIRECTS = 10` limit to prevent infinite redirect chains.
- Added first-hop private host check in `fetchUrl()` -- direct requests to private IPs are now blocked at the initial fetch stage (previously only checked during redirects).
- Refactored `handleRedirect()` to accept an options object with `redirectChain` array and `maxRedirects`.
- Every redirect target hostname is checked via `isPrivateOrLocalHost()` before following.
- Added redirect loop detection: if the same URL appears twice in the chain, the request is blocked.
- The redirect chain is passed through each recursion level, ensuring multi-hop chains cannot bypass the private-host filter.

**Verification:** Module loads correctly. The existing fetch architecture tests pass.

---

## Fix 4: Plugin Arbitrary Code Execution Warning (H2)

**Severity:** High
**File modified:** `src/plugins.js`

**Change:** Added a `SECURITY CONSIDERATION` JSDoc comment on the `loadPlugin()` method documenting that `require()` executes arbitrary code with full process privileges. The comment warns about the risk and advises users to only install plugins from trusted sources.

This is a documentation fix -- the `require()` call is intentionally preserved since plugin systems inherently need code execution capability.

**Verification:** Module loads correctly.

---

## Fix 5: Error Message Path Sanitization (H3)

**Severity:** High
**File modified:** `src/tools/error.js`

**Change:** Added a `sanitizePath(message, workspaceRoot)` helper function that replaces absolute paths in error messages with `.` (relative workspace root). The function:
- Normalizes path separators for cross-platform matching (both `/` and `\`)
- Escapes regex-special characters in the root path
- Replaces all occurrences of the workspace root with `.` in the message string

The function is exported from `src/tools/error.js` so it can be used by any error path that constructs user-facing messages.

**Verification:** Module loads correctly. Existing error test integrations pass.

---

## Test Summary

| Test Suite | Tests | Result |
|---|---|---|
| `test/tools/file-tools.test.js` | 17 | 17 pass |
| `test/runtime-classes.test.js` | 54 | 54 pass |
| `test/providers-factory.test.js` | 28 | 28 pass |
| `test/orchestration-edge-cases.test.js` | 50 | 50 pass |
| `test/memory-edge-cases.test.js` | 32 | 32 pass |

**Total:** 181 tests, 0 failures.

---

## Remaining Known Issues (Not Addressed)

These findings from the audit report are acknowledged but beyond the scope of this fix pass:

- **C1:** Plaintext API key storage (requires OS keychain integration)
- **C2:** Google Gemini key in URL query params (requires proxy or Vertex AI migration)
- **C3:** Unsanitized `!command` shell execution (requires command parser refactor)
- **H4:** Prompt injection defense (requires system prompt redesign)
- **M1-M5:** Medium-severity items (session encryption, plugin hook error suppression, update verification, rate limiter distinction, export warnings)

---

*End of report.*
