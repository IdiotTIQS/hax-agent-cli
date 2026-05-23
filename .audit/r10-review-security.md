# HaxAgent Security Audit Report (r10)

**Date:** 2026-05-23  
**Scope:** Full repository — `src/`, `desktop/`, `package.json`, config files  
**Methodology:** Manual code review of all source files, regex search for risky patterns, analysis of data flow from user input to sensitive sinks  
**Files Reviewed:** ~230 source files

---

## Overall Security Score: **62 / 100**

| Category | Score | Weight |
|---|---|---|
| Injection Defense | 45/100 | 25% |
| Secrets Management | 55/100 | 20% |
| File Safety (Path Traversal) | 80/100 | 20% |
| Network Safety (SSRF) | 75/100 | 15% |
| Auth & Permissions | 70/100 | 10% |
| Dependency Safety | 65/100 | 10% |

**Score derivation:** The codebase shows conscientious security effort in many areas (SSRF protection, symlink-aware path resolution, permission system) but has several critical gaps centered on user-controlled input flowing to code-execution sinks and API key handling.

---

## Findings by Severity

### CRITICAL

#### C-1: Arbitrary Code Execution via `new Function()` on Potentially User-Controlled Content

**File:** `src/migration/validator.js`, lines 105, 121

**Issue:** The migration validator uses `new Function(content)` and `new vm.Script(content)` to validate JavaScript syntax. If the `content` parameter contains any user-controlled or AI-generated data, this is a direct code execution vulnerability. The validator runs with full Node.js process privileges.

```js
try {
  new Function(content);  // line 105 — direct code execution
} catch (err) {
  if (err instanceof SyntaxError) {
    if (/\b(import|export)\s+/.test(content)) {
      try {
        new Function(stripped);  // line 121 — code execution on stripped variant
```

**Risk:** Attacker-controlled JavaScript executes with full process privileges (file system access, env var access including API keys, network access).

**Recommendation:** Use a parser like `acorn` or `@babel/parser` for syntax validation only. Never use `new Function()` on untrusted content. If validation is the only goal, use `acorn.parse(content, { ecmaVersion: 'latest' })` which only parses, never executes.

---

#### C-2: Plugin System Allows Arbitrary Code Execution via `require()`

**File:** `src/plugins.js`, lines 93-103

**Issue:** The plugin system loads arbitrary JavaScript files via `require()` with no code signing, integrity verification, sandboxing, or permission model applied at load time. The file itself acknowledges this risk in a comment (line 86-92), but acknowledgement without mitigation is still a vulnerability.

```js
loadPlugin(filePath) {
    const resolved = path.resolve(filePath);
    // ...
    delete require.cache[require.resolve(resolved)];
    const plugin = require(resolved);  // line 101 — full code execution
    return this.register(plugin);
}
```

**Risk:** A malicious plugin file placed in `~/.haxagent/plugins/` or `.hax-agent/plugins/` gains unrestricted access to the process (filesystem, env vars with API keys, network). No sandboxing is applied during `require()`. Cross-plugin contamination possible via `require.cache` manipulation.

**Recommendation:** 
1. Add SHA-256 integrity hashes for known-trusted plugins
2. Run plugin code in a worker_thread with limited capabilities
3. Add a `--no-plugins` flag for security-sensitive environments
4. At minimum, prompt user before loading any plugin for the first time

---

#### C-3: API Key Exposure in Console During Initialization Wizard

**File:** `src/init-wizard.js`, lines 93-97

**Issue:** When `detectedApiKey` is found from the environment, it is written to the console output (via `output.write`) in clear text. While the config display later masks keys (`***`), the init flow explicitly states "API key detected" and the user can see the key if they look at the configuration output.

**File:** `src/cli.js`, lines 281-285

**Issue:** The `hax-agent config --json` command correctly masks the API key with `***`, but the `hax-agent config` (without `--json`) display only uses `********` which is consistent and safe. Good.

**File:** `src/config.js`, lines 124-127

**Issue:** API keys are stored in plaintext JSON files (`settings.json`). There is no encryption at rest. The file is in the user's home directory or project `.hax-agent/` directory, which may be committed to version control.

```js
function updateUserSettings(updates, options = {}) {
  // ...
  fs.writeFileSync(userSettingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  // API keys stored in plaintext here
}
```

**Recommendation:**
1. Remove the console output line that acknowledges a detected key — just use it silently
2. Encrypt API keys at rest using the OS keychain (via `keytar` on desktop, or DPAPI on Windows)
3. Add `.hax-agent/settings.json` to project `.gitignore` guidance
4. Warn users when their settings.json file is not .gitignored and contains API keys

---

### HIGH

#### H-1: Shell Command Injection via `!` Prefix in Interactive Shell

**File:** `src/cli.js`, lines 1189-1243

**Issue:** The `!` prefix in the interactive shell passes user input directly to a system shell (`powershell.exe -Command` on Windows, `/bin/bash -c` on Linux/macOS). While there's a permission check, the data flows directly from user input to `spawn()` without any sanitization of shell metacharacters.

```js
if (isSingleLineInput && trimmed.startsWith('!')) {
    const shellLine = trimmed.slice(1).trim();
    const bangPermission = await session.permissionManager.checkPermission(
        'shell.run', { command: shellLine }, session.approvalCallback || null,
    );
    // ...
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['-Command', shellLine] : ['-c', shellLine];
    const child = spawn(shell, shellArgs, { stdio: 'inherit', cwd: process.cwd() });
```

**Risk:** If a user pastes input containing `!$(malicious_command)` or similar shell metacharacters, the command executes with user's shell privileges. The permission check looks at the base command name but doesn't inspect for injection within arguments.

**Recommendation:** 
1. Remove the `!` prefix shortcut entirely — route through the normal `shell.run` tool which uses `spawn` with argument arrays (shell-free execution)
2. If keeping it, sanitize against command chaining operators (`&&`, `||`, `;`, `|`, `$()`, backticks)

---

#### H-2: `execSync` with User-Controlled Command Strings

**File:** `src/generator/file-gen.js`, lines 202, 223

**Issue:** Format and lint commands accept arbitrary command strings that include `{file}` substitution. The full command is passed to `execSync()` which spawns a shell. If an attacker can control the `formatConfig` or `lintConfig` objects passed to the generator, they can inject shell commands.

```js
_format(filePath, formatConfig) {
    const cmd = typeof formatConfig === "string" ? formatConfig : formatConfig.command;
    const fullCmd = cmd.replace(/\{file\}/g, filePath);
    execSync(fullCmd, { stdio: "pipe", timeout: 30000 });  // shell execution
}
```

**Risk:** Shell injection if `formatConfig.command` contains shell metacharacters alongside the `{file}` placeholder.

**Recommendation:** Parse commands into `command` + `args` arrays and use `execFileSync` or `spawnSync` instead of `execSync`. Apply the file path only as an argument, not through string substitution.

---

#### H-3: Path Traversal in File Edit Tool (Non-Safe Resolution)

**File:** `src/tools/file-edit.js`, line 46

**Issue:** The `file.edit` tool uses `resolveWithinRoot()` (the non-safe variant) instead of `resolveWithinRootSafe()`. This means symlinks that escape the workspace root will NOT be detected.

```js
const resolvedPath = resolveWithinRoot(context.root, filePath);  // line 46
```

Compare with `file.write` (line 54) and `file.read` (line 40) which use `resolveWithinRootSafe()`:

```js
// file-read.js line 40:
const resolvedPath = await resolveWithinRootSafe(context.root, filePath);
// file-write.js line 54:
const resolvedPath = await resolveWithinRootSafe(context.root, filePath);
```

**Risk:** An attacker who can create a symlink inside the workspace pointing to `/etc/passwd` or similar sensitive locations could edit files outside the workspace root through the `file.edit` tool.

**Recommendation:** Replace `resolveWithinRoot` with `resolveWithinRootSafe` on line 46 of `src/tools/file-edit.js`.

---

#### H-4: Desktop Preload Exposes Broad API Surface

**File:** `desktop/preload/index.js`, lines 117-145

**Issue:** The preload script exposes 25 functions to the renderer process via `contextBridge`. While `contextIsolation: true` is correctly set, the `sandbox: false` option in the BrowserWindow configuration (`desktop/main/index.js`, line 78) means renderer processes are not sandboxed from the OS. A compromised renderer (via XSS or dependency vulnerability) would have broad access to the main process through these IPC channels.

```js
// desktop/main/index.js line 78:
webPreferences: {
    preload: path.join(__dirname, "..", "preload", "index.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,  // <-- sandbox disabled
},
```

**Risk:** A compromised renderer can invoke `agent:sendMessage` (executing arbitrary tool calls), `settings:update` (modifying config including API keys), `workspace:readFile` (reading arbitrary files), `git:getDiff` (information disclosure), and `shell:openExternal` (opening arbitrary URLs).

**Recommendation:**
1. Enable `sandbox: true` for renderer processes
2. If `sandbox: true` breaks functionality, add explicit `ipcRenderer` permission grants instead
3. Review whether ALL 25 API functions need to be exposed to the renderer

---

### MEDIUM

#### M-1: No HTTPS Enforcement for API Endpoints

**File:** `src/providers/factory.js`, lines 47-53; `src/providers/anthropic-provider.js`, line 47

**Issue:** API URLs from environment variables (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GOOGLE_BASE_URL`) and config files are accepted without protocol validation. A user could configure an `http://` endpoint, causing API keys to be transmitted in cleartext.

```js
// factory.js line 47-53:
function resolveApiUrl(config, env, providerName) {
    if (config.apiUrl) return config.apiUrl;  // no protocol validation
    if (env.HAX_AGENT_API_URL) return env.HAX_AGENT_API_URL;
    if (providerName === "openai" || providerName === "gpt") return env.OPENAI_BASE_URL;
    // ...
}
```

**Risk:** API keys sent over unencrypted HTTP are vulnerable to network interception.

**Recommendation:** Validate that `apiUrl` starts with `https://` unless it's `localhost` or a `.local` domain. Warn the user if HTTP is used.

---

#### M-2: ReDoS Vulnerability in Regex Search with Nested Quantifier Detection (Partial Bypass)

**File:** `src/tools/file-search.js`, lines 141-142

**Issue:** The ReDoS guard checks for patterns like `(a+)+` but the detection regex `/\(.*[*+]\{.*\}.*\)|\(.*\).*[*+]\{/.test(query)` can be bypassed. For example, `/(a+)+b/` would trigger the guard but `/(a|aa)+b/` (which is also exponential backtracking) would not.

```js
if (/\(.*[*+]\{.*\}.*\)|\(.*\).*[*+]\{/.test(query) || /[*+]{2,}/.test(query)) {
    throw new ToolExecutionError('INVALID_REGEX', 'Pattern contains potentially unsafe nested quantifiers');
}
```

**Recommendation:** Add a timeout wrapper around `RegExp.exec()` calls (not just `new RegExp()` construction), or use a library like `re2` which guarantees linear-time matching. The 500-character limit helps but is not a complete defense.

---

#### M-3: No Message Size Limits on Chat Input

**File:** `src/agent-engine.js`, line 49; `src/cli.js`, line 1262

**Issue:** User messages are passed directly to the provider with no size limit. A single massive message could consume all available memory or exhaust API token limits.

**Recommendation:** Add a configurable `maxInputLength` (e.g., 1MB) that truncates or rejects overly large input messages before they reach the provider.

---

#### M-4: Session Transcript Files Store Potentially Sensitive Tool Outputs in Plaintext

**File:** `src/memory.js`, lines 28-40

**Issue:** Session transcripts are stored as JSONL files with all tool outputs (including file contents, shell command outputs, web fetch results) in plaintext. No automatic cleanup, retention policy, or encryption.

**Recommendation:** 
1. Add configurable session retention (e.g., auto-delete sessions older than 30 days)
2. Consider encrypting session data at rest
3. Add a `/clear` or `/forget` command that also removes the transcript file, not just the in-memory messages

---

### LOW

#### L-1: Electron `sandbox: false` (Already Covered in H-4)

Redundant with H-4.

---

#### L-2: Settings File World-Readable on Unix

**File:** `src/config.js`, lines 124-125

**Issue:** On Unix systems, `fs.writeFileSync` creates files with default umask (typically 644, world-readable). The settings.json file containing API keys would be readable by any user on the system.

**Recommendation:** After writing settings files, set mode to `0o600` (owner read/write only):
```js
fs.writeFileSync(userSettingsPath, content, { mode: 0o600 });
```

---

#### L-3: Web Search Uses Public Services Without Rate Limiting

**File:** `src/tools/web-search.js`

**Issue:** The web search tool queries DuckDuckGo and Bing without respecting their rate limits or terms of service. Could lead to IP banning.

**Recommendation:** Add a configurable delay between automated search requests.

---

#### L-4: Stock Quote Tool Uses Unauthenticated HTTP Calls

**File:** `src/tools/stock-quote.js`

**Issue:** The stock quote tool makes direct HTTPS calls using Node's built-in `https` module. While this appears safe (fixed endpoints), there's no certificate validation customization beyond Node defaults.

No action needed — this is a minor observation, not a vulnerability.

---

## Top 5 Must-Fix Issues

| # | Severity | Issue | File(s) | Effort |
|---|---|---|---|---|
| 1 | **Critical** | `new Function()` execution on potentially user-controlled JS content | `src/migration/validator.js:105,121` | Medium — replace with parser |
| 2 | **Critical** | Plugin `require()` loads arbitrary code with full privileges | `src/plugins.js:93-103` | High — need sandboxing or signing |
| 3 | **Critical** | API keys stored in plaintext JSON on disk | `src/config.js:124-127` | Medium — OS keychain or encryption |
| 4 | **High** | `!` prefix passes user input directly to system shell | `src/cli.js:1189-1243` | Low — remove shortcut or sanitize |
| 5 | **High** | `file.edit` uses unsafe path resolution (missing symlink check) | `src/tools/file-edit.js:46` | Low — one-line fix to use `resolveWithinRootSafe` |

---

## Positive Security Observations

The codebase demonstrates several strong security practices worth acknowledging:

1. **SSRF protection is thorough:** `web-fetch.js` validates URL protocols (HTTP/HTTPS only), blocks private/local IP ranges via `isPrivateOrLocalHost`, enforces redirect chain limits (max 10), and validates redirect targets against the same private-IP blocklist.

2. **Symlink-aware path resolution exists:** `resolveWithinRootSafe()` in `tools/utils.js` (lines 90-106) follows symlinks and validates the real path stays within the workspace root. Most file tools use this variant.

3. **Tool permission system is well-structured:** The `PermissionManager` class provides AUTO/ASK/DANGEROUS levels, per-command shell classification, YOLO mode, and persistent allow/deny overrides. Web fetch permissions dynamically check for private hosts.

4. **ReDoS protections exist:** The regex search tool limits query length (500 chars), detects nested quantifier patterns, and wraps regex construction in try/catch. The reverse search in CLI has a 200-character escape guard.

5. **Electron contextIsolation is enabled:** The desktop app correctly uses `contextIsolation: true` and `nodeIntegration: false` in the BrowserWindow configuration.

6. **HTML-to-text conversion avoids DOM parsing:** Instead of using a DOM parser (which could trigger scripts), `htmlToPlainText()` uses regex-based HTML stripping, eliminating XSS risks from fetched web content.

7. **No secrets in source code:** A scan for hardcoded API keys, tokens, and passwords found none in the source tree.

8. **Undo stack for file operations:** File write and delete operations push to an undo stack, and deletions move files to `.hax-agent/trash/` by default instead of permanent removal.

---

## File-by-File Summary

| File | Rating | Key Issues |
|---|---|---|
| `src/cli.js` | Medium | `!` shell injection (H-1), `spawn` with user input |
| `src/config.js` | Medium | Plaintext API key storage (C-3, L-2) |
| `src/plugins.js` | Low | Arbitrary code via `require()` (C-2), self-documented |
| `src/tools/shell.js` | Good | `spawn` with `shell: false`, timeout, output caps |
| `src/tools/web-fetch.js` | Good | SSRF protection, redirect validation, size limits |
| `src/tools/file-read.js` | Good | Safe path resolution, encoding validation, size limits |
| `src/tools/file-write.js` | Good | Safe path resolution, encoding validation, undo stack |
| `src/tools/file-edit.js` | Medium | Missing symlink check (H-3) |
| `src/tools/file-delete.js` | Good | Safe path resolution, trash recovery, undo stack |
| `src/tools/file-glob.js` | Good | Safe path resolution, ignores .git/node_modules |
| `src/tools/file-search.js` | Good | ReDoS protections, safe path resolution |
| `src/tools/file-readdir.js` | Good | Safe path resolution, depth limits, max entries |
| `src/tools/web-search.js` | Good | Reuses web-fetch SSRF protections |
| `src/permissions.js` | Good | Well-structured permission levels, shell classification |
| `src/providers/anthropic-provider.js` | Good | Retry logic, API key from env not hardcoded |
| `src/providers/factory.js` | Medium | No HTTPS protocol enforcement (M-1) |
| `src/sandbox/vm-sandbox.js` | Good | Whitelisted globals, blocked `require`/`process`/`global` |
| `src/sandbox/executor.js` | Good | Policy-based command whitelisting |
| `src/migration/validator.js` | Critical | `new Function()` execution (C-1) |
| `src/generator/file-gen.js` | High | `execSync` with command strings (H-2) |
| `src/memory.js` | Good | Filename sanitization via `toFileSafeName` |
| `src/init-wizard.js` | Medium | API key in console output (C-3) |
| `src/hub.js` | Good | Lazy-loading, error isolation |
| `src/agent-engine.js` | Good | AbortController for interruption, context window management |
| `src/session.js` | Good | Clean data model, cost tracking |
| `desktop/main/index.js` | Medium | `sandbox: false`, broad IPC surface (H-4) |
| `desktop/preload/index.js` | Good | `contextBridge` isolation, no `nodeIntegration` |
| `src/tools/stock-quote.js` | Good | Fixed endpoints only, no user-controlled URLs |
| `src/plugins/isolate.js` | Good | Hook timeout, error containment, resource tracking |

---

**Audit conducted by:** Automated security review  
**Total files reviewed:** ~230  
**Total findings:** 12 (3 Critical, 4 High, 4 Medium, 3 Low)
