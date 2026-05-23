# Error Handling Audit Report

**Date:** 2026-05-22
**Scope:** All source files under `src/`
**Focus:** Tool and provider modules

## Infrastructure Reviewed

### Error system
- `src/tools/error.js` -- `ToolExecutionError` class: `(code, message, details)`
- `src/tools/error-codes.js` -- `ErrorCodes` enum with modules: Validation, File-System, File-Edit, Shell, Web, Stock, Registry, Fallback
- `src/tools/utils.js` -- `serializeError()` falls back to `TOOL_ERROR` for plain Error objects
- `src/config-validator.js` -- returns issues array; uses plain `Error` for assertion (adequate, non-tool layer)
- `src/plugin-validator.js` -- returns validation results; uses plain `Error` for assertion (adequate, non-tool layer)

### Dual validation pattern (intentional)
The codebase has two `requireString`/`requireEnum` implementations:
- `src/tools/utils.js` throws `ToolExecutionError` (tool execution layer)
- `src/runtime/utils.js` throws `TypeError` (runtime/CLI layer)

This is intentional and correct. Tool-layer validation needs structured error codes for AI model consumption. Runtime validation uses standard JavaScript error types.

## Findings by Severity

### P1 -- Fixed: Provider SDK import errors lose original cause

**Files:** `anthropic-provider.js`, `google-provider.js`, `openai-provider.js`
**Issue:** When SDK packages are not installed, the `MODULE_NOT_FOUND` error from `require()` was caught and a new `Error` was thrown without preserving the original error as `cause`.
**Fix:** Added `err.cause = error` to preserve the original error chain for debugging.

### P1 -- Fixed: Tool retry module uses bare Error

**File:** `src/tool-retry.js:34`
**Issue:** `createRetryableTool()` threw `new Error('execute must be a function')` when validating the tool executor. This is a tool-layer validation that should use `ToolExecutionError` with the `INVALID_TOOL_EXECUTOR` code, consistent with `ToolRegistry.register()` in `registry.js:41`.
**Fix:** Imported `ToolExecutionError` and converted the throw to `new ToolExecutionError('INVALID_TOOL_EXECUTOR', ...)`.

### P2 -- Fixed: Silent catch blocks in provider listModels

**Files:** `anthropic-provider.js`, `google-provider.js`, `openai-provider.js`
**Issue:** Each provider's `listModels()` method has a try/catch that silently swallows API errors when falling back to a predefined model list. While the fallback behavior is correct, the completely silent catch made troubleshooting impossible.
**Fix:** Added `debug('providers:<name>', ...)` logging in each catch block (only visible when `HAX_AGENT_DEBUG=1`).

### P2 -- Fixed: Silent catch in plugin loader

**File:** `src/plugins.js:110-112`
**Issue:** `loadPluginsFromDirectory()` silently skipped plugin files that failed to load with `catch (_err) { /* Silently skip */ }`.
**Fix:** Added `debug('plugins', ...)` logging with the error message.

### P2 -- Fixed: Stream creation error silently swallowed in anthropic provider

**File:** `src/providers/anthropic-provider.js:115-117`
**Issue:** When `client.messages.stream()` fails, the error was caught and only a user-facing text chunk was yielded. The original error details were lost.
**Fix:** Added `debug('providers:anthropic', ...)` before the text chunk yield.

### Verified adequate (no changes needed)

| File | Pattern | Reason |
|------|---------|--------|
| `src/tools/*.js` (all tool files) | `ToolExecutionError` with codes | Already correct |
| `src/tools/registry.js` | `ToolExecutionError` with codes | Already correct |
| `src/config-validator.js` | `throw new Error(...)` | Non-tool config layer, adequate |
| `src/plugin-validator.js` | `throw new Error(...)` | Non-tool config layer, adequate |
| `src/config.js` | `throw new Error(...)` | Config loading, adequate |
| `src/memory.js` | `throw new Error(...)` | I/O/JSON errors, adequate |
| `src/orchestration.js` | `throw new Error(...)` | Domain logic, plain Error OK |
| `src/runtime/tasks.js` | `throw new Error(...)` | Runtime layer, plain Error OK |
| `src/runtime/command-registry.js` | `try { } throw new Error(...)` | Runtime layer, plain Error OK |
| `src/runtime/utils.js` | `throw new TypeError(...)` | Standard JS type validation |
| `src/teams/*.js` | `throw new Error(...)` | Domain logic, adequate |
| `src/desktop-services.js` | `throw new Error(...)` | API layer, adequate |
| `src/export.js` | `throw new Error(...)` | Export layer, adequate |
| `src/providers/chat-provider.js` | `throw new Error(...)` | Abstract base class, adequate |
| `src/providers/factory.js` | `throw new Error(...)` | Factory/config errors, adequate |
| `src/rate-limiter.js` | `throw new Error(...)` | Infrastructure, serializeError falls back to TOOL_ERROR |
| `src/cli.js` | `console.error(...)` | CLI output layer, adequate |
| `src/providers/anthropic-provider.js:178` | `catch (_) { return block }` | JSON parse fallback for partial stream data |
| `src/providers/messages.js:130` | `catch (_error) { return args }` | JSON parse fallback |
| `src/providers/shared.js:156` | `catch (_error) { return null }` | JSON parse fallback |
| `src/providers/tool-adapters.js:108` | `catch (_error) { return {} }` | JSON parse fallback |
| `src/tools/file-delete.js:42` | `catch (_) { /* skip undo */ }` | Intentional non-critical operation |
| `src/file-context.js` | `catch (_error)` patterns | File I/O fallbacks, adequate |
| `src/desktop-services.js:609` | `catch { /* No persisted overrides */ }` | Intentional first-run state |

## Files Modified

| File | Change |
|------|--------|
| `src/tool-retry.js` | Imported `ToolExecutionError`; converted plain Error to `ToolExecutionError('INVALID_TOOL_EXECUTOR', ...)` |
| `src/plugins.js` | Imported `debug`; added debug logging for plugin load failures |
| `src/providers/anthropic-provider.js` | Imported `debug`; added `cause` to SDK import error; added debug logging to listModels and stream error handlers |
| `src/providers/google-provider.js` | Imported `debug`; added `cause` to SDK import error; added debug logging to listModels |
| `src/providers/openai-provider.js` | Imported `debug`; added `cause` to SDK import error; added debug logging to listModels |

## Summary

- **6 files modified** across tool and provider layers
- **1 bare Error** converted to `ToolExecutionError` in the tool layer
- **3 SDK import errors** now preserve their original cause
- **5 silent catch blocks** now emit debug logs (visible with `HAX_AGENT_DEBUG=1`)
- **0 new error codes** needed (existing codes were reused)
- **0 public API changes** to error classes
- **0 bare `throw 'string'` patterns** found in the codebase
- **0 promise chains missing `.catch()`** found in tool/provider modules
