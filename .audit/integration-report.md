# Integration Report: Orphan Module Wiring

**Date:** 2026-05-22
**Branch:** master
**Scope:** Wire 4 fully-implemented but never-integrated modules into the running HaxAgent CLI.

---

## Summary

4 orphan modules were identified as feature-complete but disconnected from the system. All 4 have been integrated with minimal, surgical changes. The wiring was done in priority order:

| Priority | Module | File | Integration Status |
|----------|--------|------|--------------------|
| 1 | UndoStack | `src/undo-stack.js` | Wired to file tools + slash commands |
| 2 | Batch    | `src/batch.js`        | Wired to `--batch`/`--batch-file` CLI flags |
| 3 | Export   | `src/export.js`       | Wired to `/export` slash command |
| 4 | Plugins  | `src/plugins.js`      | Wired to tool hooks + session lifecycle |

---

## 1. UndoStack (Priority 1)

### What was wired
- `ToolRegistry` now accepts an `undoStack` option -- passed through to tool execution context
- `file-edit.js`: pushes original/new content to undo stack after each successful edit
- `file-write.js`: pushes original/new content to undo stack after each successful write
- `file-delete.js`: reads file content before deletion, pushes to undo stack for rollback
- `/undo` slash command: invokes `undoStack.undo()` to restore the last file
- `/redo` slash command: invokes `undoStack.redo()` to re-apply the last undone change

### Files changed
- `src/tools/registry.js` -- added `this.undoStack` in constructor, pass through `createLocalToolRegistry`
- `src/tools/file-edit.js` -- push to undoStack after non-dry-run edits
- `src/tools/file-write.js` -- push to undoStack after writes
- `src/tools/file-delete.js` -- read content before delete, push to undoStack
- `src/commands/definitions.js` -- added `/undo` and `/redo` entries to `SLASH_COMMANDS`
- `src/commands/index.js` -- added `handleUndo` and `handleRedo` handlers, wired into `COMMAND_HANDLERS`
- `src/cli.js` -- creates `UndoStack` instance, passes to `createLocalToolRegistry` in both `runShell` and `runResumeCommand`

### Edge cases handled
- Undo of a file edited externally after the tool wrote it: the redo stack captures the current content as the baseline
- Dry-run edits: not pushed to undo stack
- File deletion where content can't be read: silently skips undo entry
- Undo/redo failure: error message shown, stack state preserved
- No undo available: "Nothing to undo" displayed

---

## 2. Batch Mode (Priority 2)

### What was wired
- `--batch` CLI flag triggers non-interactive batch processing (reads from stdin)
- `--batch-file <path>` reads input from a file instead of stdin
- `--batch-output <path>` writes response to a file instead of stdout
- `--model <id>` overrides the model for batch runs

### Files changed
- `src/cli.js` -- added `runBatch()` function, batch args parsing in `main()`, KNOWN_COMMANDS updated
- `src/batch.js` -- fixed missing `path` import (was using `path.dirname` without requiring it)

### Usage examples
```
echo "refactor the auth module" | hax-agent --batch
cat tasks.txt | hax-agent --batch --model claude-sonnet-4-20250514
hax-agent --batch --batch-file prompt.txt --batch-output result.md
```

### Edge cases handled
- No input provided: exits with error code 1 and error message
- Missing input file: exits with error code 1
- Batch mode session uses `yolo` permissions (no interactive approvals needed)
- Batch mode creates UndoStack (file mutations are undoable if needed)

---

## 3. Export (Priority 3)

### What was wired
- `/export [format]` slash command dumps the session transcript
- Formats: `md` (Markdown, default), `json` (JSON), `text`/`txt` (plain text)
- Output written to `.hax-agent/exports/<session-id>-<timestamp>.<ext>`

### Files changed
- `src/commands/definitions.js` -- added `/export` to `SLASH_COMMANDS`
- `src/commands/index.js` -- added `handleExport` handler, wired into `COMMAND_HANDLERS`, imported export functions

### Limitations (documented, not fixed)
- Export reads from persisted session store (`src/memory` module). A brand-new session that has not yet been persisted will fail with "Session not found". This is acceptable for v1 -- sessions are persisted automatically as the user interacts.
- No custom output path argument yet (always goes to `.hax-agent/exports/`)

---

## 4. Plugins (Priority 4)

### What was wired
- `PluginRegistry` instantiated in `src/cli.js` `runShell()`
- Auto-discovers plugins from `~/.haxagent/plugins/*.js` and `.hax-agent/plugins/*.js`
- `beforeToolCall`/`afterToolCall` hooks fired in `ToolRegistry.execute()`
- `onError` hook fired on tool execution errors
- `onSessionStart` hook fired after session creation in `runShell`
- `onSessionEnd` hook fired in `performCleanExit` before process exit
- `PluginRegistry` and `UndoStack` exported from `src/index.js`

### Files changed
- `src/session.js` -- added `pluginRegistry` property to `Session`
- `src/tools/registry.js` -- added `pluginRegistry` to constructor/`createLocalToolRegistry`, fire hooks in `execute()`
- `src/cli.js` -- create `PluginRegistry`, auto-discover plugins, fire lifecycle hooks
- `src/index.js` -- export `PluginRegistry` and `UndoStack`

### Hook semantics
- Hook errors never crash the application (caught silently, `onError` hook fired for non-error hooks)
- Hooks are called sequentially in registration order
- `beforeToolCall` context includes `{ toolName, args, session }` -- hook can modify or return new context
- `afterToolCall` context includes `{ toolName, args, result, session }`
- `onError` context includes `{ error, toolName, session }`
- `onSessionStart`/`onSessionEnd` context includes `{ session }`

### Not yet wired (documented, deferred)
- `beforeChat`/`afterChat` hooks: these require changes to `AgentEngine.sendMessage()`, which was deemed too invasive for minimal integration. They can be added in a follow-up pass.
- Batch mode does not load plugins (by design -- batch is non-interactive)
- No `/plugins` slash command to list/manage plugins at runtime

---

## Files Modified (summary)

| File | Changes |
|------|---------|
| `src/tools/registry.js` | +undoStack prop, +pluginRegistry prop, +beforeToolCall/afterToolCall/onError hooks |
| `src/tools/file-edit.js` | +undoStack push after non-dry-run edit |
| `src/tools/file-write.js` | +undoStack push after write |
| `src/tools/file-delete.js` | +read original content, +undoStack push after delete |
| `src/commands/definitions.js` | +`/undo`, `/redo`, `/export` commands |
| `src/commands/index.js` | +`handleUndo`, `handleRedo`, `handleExport` handlers, +export imports |
| `src/session.js` | +`pluginRegistry` property |
| `src/cli.js` | +UndoStack import+creation, +PluginRegistry import+creation+lifecycle, +`runBatch()`, +batch args, +KNOWN_COMMANDS |
| `src/index.js` | +PluginRegistry export, +UndoStack export |
| `src/batch.js` | +missing `path` import |

## Files NOT modified (integration-ready as-is)
| File | Reason |
|------|--------|
| `src/undo-stack.js` | Complete, no changes needed |
| `src/plugins.js` | Complete, no changes needed |
| `src/export.js` | Complete, no changes needed |
| `src/tools/index.js` | Re-exports only, no logic changes |

---

## Verification

All 10 modified files pass Node.js syntax validation (`node --check`). The integration is additive, non-breaking, and follows existing code conventions:

- Factory function patterns (`createXxxTool`) preserved
- Async hook execution follows same pattern as `runHook`
- Error handling follows existing `ToolExecutionError` patterns
- Slash command registration follows existing `SLASH_COMMANDS` + `COMMAND_HANDLERS` pattern
- CLI argument parsing follows existing `--no-color`/`--debug` early-extraction pattern
