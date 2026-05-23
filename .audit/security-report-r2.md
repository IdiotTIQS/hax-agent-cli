# HaxAgent Security Audit Report -- Round 2

**Date**: 2026-05-22  
**Auditor**: Automated security review (second pass)  
**Scope**: New modules created in Round 1 + providers + desktop-services + skills + untracked modules  
**Methodology**: Deep review of ~25 source files targeting prototype pollution, ReDoS, insecure randomness, missing input validation, and information disclosure.

---

## Issues Fixed (Round 2)

### 1. [LOW] Unescaped Regex Input in `substituteArguments`

**File**: `src/skills/parser.js`  
**Line**: 93 (original)  
**Severity**: Low  

**What was wrong**: The `substituteArguments` function constructs a `RegExp` by directly interpolating `argName` into the pattern string:

```js
result = result.replace(new RegExp(`\\$${argName}`, 'g'), argValue);
```

If `argName` contains regex metacharacters (`.`, `+`, `*`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `|`, `\`), they would be interpreted as regex operators rather than literal characters. For example, an argument named `model.name` would produce the regex `/$model.name/g`, where `.` matches any character instead of a literal dot.

Attack surface: The `argName` values originate from the `arguments` field in a skill's SKILL.md frontmatter. An attacker would need filesystem write access to `.hax-agent/skills/` to craft a malicious skill, which already implies local compromise. The practical risk is low but the code was technically incorrect.

**What was changed**:
- Added `escapeRegex()` helper that escapes all regex metacharacters using `String.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
- `substituteArguments` now passes `argName` through `escapeRegex()` before interpolating into the pattern

---

### 2. [LOW] Missing `"use strict"` Directive

**File**: `src/skills/parser.js`  
**Line**: 1 (original)  
**Severity**: Low  

**What was wrong**: `parser.js` was the only logic-containing file in `src/skills/` that did not declare `"use strict"`. While all other `src/` modules use strict mode, the skills parser ran in sloppy mode.

In sloppy mode, assignment to `parsed['__proto__']` (where `parsed = {}`) would attempt to set the object's internal `[[Prototype]]` via the `__proto__` accessor. If the value happened to be an object (e.g., from the frontmatter inline-array syntax), the prototype would be silently replaced. In strict mode, assigning a non-object value to `__proto__` throws a `TypeError`, making the failure explicit and preventing silent state corruption.

Attack surface: The `parsed` object receives keys from YAML-like frontmatter in SKILL.md files, where key names are user-controlled (the skill author). A key named `__proto__` with an array value would change `parsed`'s prototype to `Array.prototype`. In the current code this does not create a global pollution chain because `parsed` is used only for property reads (known keys like `description`, `arguments`, etc.) and is never used to construct other objects. However, the missing strict mode is a defense-in-depth gap.

**What was changed**:
- Added `"use strict";` as the first line of `parser.js`

---

## Files Reviewed (No Issues Found)

### New modules from Round 1
| Module | Analysis |
|--------|----------|
| `config-validator.js` | Safe `getNestedValue` property access via `cursor[segment]`. URL validation via `new URL()`. |
| `rate-limiter.js` | Clean token-bucket implementation. No regex, no prototype mutations. |
| `shutdown.js` | Standard process signal handling. Clean teardown sequence. |
| `tool-retry.js` | `Math.random()` used for jitter (non-security). Clean retry logic. |
| `memory-eviction.js` | Clean eviction logic. No external input to file paths. |
| `plugin-validator.js` | Validation-only. Name regex `[._-]` has `-` at end of class (literal, not range). `Object.entries` used safely. |

### Providers
| Module | Analysis |
|--------|----------|
| `anthropic-provider.js` | API key passed via `apiKey` config property -- SDK uses Authorization header, not URL. No key in logs. DSML regex patterns safe (no catastrophic backtracking). |
| `google-provider.js` | API key in query param previously documented in Round 1. No new issues. |
| `openai-provider.js` | API key via `apiKey` -- SDK uses Authorization header. Falls back to mock client when key is absent. |
| `mock-provider.js` | Harmless mock responses. No external effect. |
| `chat-provider.js` | Clean base class. `normalizeOptionalString` uses `String()` safely. |
| `factory.js` | Clean provider resolution from config/env. No injection. |
| `messages.js` | `normalizeToolArguments` try-catches `JSON.parse`. `normalizeMetadata` safe spread. |
| `shared.js` | All 4 DSML regexes analyzed for ReDoS: `[\s\S]*?` is lazy, anchored by specific tags at both ends. No catastrophic backtracking. `stripToolCallMarkup` secondary regex `/ <([A-Za-z]...)[^>]*>[\s\S]*?<\/\1>/g` uses backreference to force matching closing tag, limits backtracking. `Math.random()` in `withRetry` for jitter only. |
| `tool-adapters.js` | `normalizeSchemaForGemini` uses `Object.entries` (own properties only) -- safe from prototype pollution. `JSON.parse` in `parseToolInput` is try-caught. |

### Other modules
| Module | Analysis |
|--------|----------|
| `desktop-services.js` | `runGit` uses `spawn("git", args)` with args array -- no shell injection. `sanitizeSettings` masks API keys with `"***"`. File reads validated via `resolveWorkspacePath`. |
| `batch.js` | CLI batch mode. `inputFile`/`outputFile` are explicit CLI arguments -- by design. |
| `export.js` | Export to user-specified path. `path.resolve` is correct for CLI tool accepting a path argument. |
| `plugins.js` | Plugin loading via `require()`. `require.cache` clearing for hot-reload. |
| `runtime/utils.js` | `createId` uses `Math.random()` for session IDs (non-cryptographic). |
| `undo-stack.js` | File paths come from validated tool operations. Clean undo/redo. |

### Skills
| Module | Analysis |
|--------|----------|
| `loader.js` | Loads skills from known directories (`~/.hax-agent/skills/`, `.hax-agent/skills/`). No path traversal. |
| `intent-matcher.js` | Clean matching logic. `matchSkillByIntent` uses `.includes()` on lowercased strings -- safe. |
| `skillify.js` | Template-based prompt generation. User messages are template-substituted, not evaluated. |
| `usage.js` | File read/write to known location. Clean JSON handling. |

---

## Verification of Round 1 Fixes

All four Round 1 fixes were verified intact:

1. **Path traversal in `file.edit`** -- `resolveWithinRoot` still in place on all three path resolutions.
2. **Command injection via EDITOR/VISUAL** -- `shell: false` still set, editor string still split on whitespace.
3. **Symlink escape in `file.write`** -- `resolveWithinRootSafe` still imported and used.
4. **Symlink escape in `file.delete`** -- `resolveWithinRootSafe` still imported and used.

No regressions introduced by the new Round 1 modules.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0     | --     |
| High     | 0     | --     |
| Medium   | 0     | --     |
| Low      | 2     | Fixed  |

The six new defensive modules created in Round 1 (`config-validator`, `rate-limiter`, `shutdown`, `tool-retry`, `memory-eviction`, `plugin-validator`) are well-written with no security issues. The provider layer properly handles API keys (via SDK-native mechanisms, not URL embedding) with the known exception of the Google provider (documented in Round 1). The skills subsystem had two minor issues (`parser.js` lacking strict mode and unescaped regex input) which have been fixed. The desktop services, batch, export, and undo-stack modules are clean.

The overall security posture is strong. The codebase demonstrates consistent use of safe patterns: `spawn` with argument arrays (no `shell: true` for untrusted input), `Object.entries` for safe iteration, try-catch around `JSON.parse`, and path validation before all filesystem operations.
