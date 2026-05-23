# Architecture Fix Report — Consolidate `requireString` Duplication

**Date:** 2026-05-22
**Fix:** Consolidate duplicated utility functions (`requireString`, `requireEnum`, `createId`, `toIsoString`) across 7 files to import from `src/runtime/utils.js`

---

## Summary

Replaced local function definitions of `requireString`, `requireEnum`, `createId`, and `toIsoString` in 7 files with imports from the shared `src/runtime/utils.js` module. This eliminates ~45 lines of duplicate code.

## Files Modified

| File | Functions Replaced | Import Path | Notes |
|------|--------------------|-------------|-------|
| `src/runtime/agents.js` | `requireString`, `requireEnum` | `./utils` | 6 lines removed |
| `src/runtime/command-registry.js` | `requireString` | `./utils` | 4 lines removed |
| `src/runtime/composition.js` | `requireString` | `./utils` | 4 lines removed |
| `src/runtime/messages.js` | `createId`, `toIsoString`, `requireString`, `requireEnum` | `./utils` | 24 lines removed |
| `src/runtime/sessions.js` | `createId`, `toIsoString` | `./utils` | 12 lines removed |
| `src/runtime/tasks.js` | `requireString`, `requireEnum` | `./utils` | 7 lines removed |
| `src/orchestration.js` | `requireString` | `./runtime/utils` | 4 lines removed |

## Files Intentionally Not Modified

- `src/tools/utils.js` — has its own `requireString` that throws `ToolExecutionError` (intentional layer separation, different error type)
- `src/tool-retry.js` — only has `positiveInteger`, not `requireString` or the other runtime utils
- `src/teams/runtime.js` — no local duplicates of these functions found
- `src/teams/agents.js` — no local duplicates of these functions found
- `src/collab/*.js`, `src/coordination/*.js`, `src/contracts/*.js`, `src/debate/*.js`, `src/graph/*.js`, `src/handoff/*.js` — these also have local `requireString` duplicates per the audit but were out of scope for this fix (different module trees)

## Behavioral Change

`src/orchestration.js` previously threw `new Error(...)` from its local `requireString`. After importing from `runtime/utils`, it now throws `new TypeError(...)` — consistent with the other runtime modules. This is the correct behavior since the function validates argument types.

## Verification

- `node -e "require('./src/runtime/utils.js')"` — shared module loads successfully
- All 7 edited files load without errors via `require()`
- Functional tests confirm `requireString`, `requireEnum`, `createId`, and `toIsoString` work correctly from all modules:
  - `requireString` rejects empty strings with `TypeError`
  - `requireEnum` rejects invalid enum values with `TypeError`
  - `createId` generates prefixed IDs with timestamp+random suffix
  - `toIsoString` converts Date values to ISO strings, rejects invalid dates
  - `AgentDefinition`, `CommandRegistry`, `RuntimeComposition`, `createMessage`, `Session`, `TaskList` all construct and function correctly

## Remaining Work (out of scope for this fix)

Per the architecture audit (C-1), `requireString` is also duplicated in these files (not addressed here):

- `src/collab/consensus.js`
- `src/collab/knowledge-base.js`
- `src/collab/messaging.js`
- `src/contracts/negotiate.js`
- `src/debate/engine.js`
- `src/coordination/leader.js`
- `src/coordination/heartbeat.js`
- `src/coordination/dispatcher.js`
- `src/handoff/protocol.js`
- `src/handoff/escalation.js`
- `src/graph/engine.js`

These would need `require('../runtime/utils')` imports added as a follow-up task.
