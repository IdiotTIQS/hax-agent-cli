# TUI Rewrite Plan

## Diagnosis

The current TUI (`src/tui/index.js`, 293 lines) is fundamentally broken. Root causes:

| # | Bug | Root Cause |
|---|-----|-----------|
| B1 | Alt-screen broken | Uses `ANSI.clearScreen` instead of proper `\x1b[?1049h`/`\x1b[?1049l` |
| B2 | Scroll regions conflict with readline | readline writes directly to stdout, ignoring scroll margins |
| B3 | Spinner doesn't render | `_spinnerStart` only increments a counter, never writes output |
| B4 | Status bar positioning broken | Absolute `cursorTo` conflicts with readline's prompt management |
| B5 | Approval flow deadlocks | `requestApproval` Promise never resolves because async generator blocks the `line` event |
| B6 | Output/readline interleaving | `_writeOutput` writes to stdout while readline also writes prompt |
| B7 | Non-TTY fallback missing | When `_altScreen` is false, `start()` returns immediately but `renderEvent` still tries full TUI path |

## Approach

Instead of fighting readline, work WITH it. Use two tiers:

- **Tier 1 (TTY):** Write events to readline's `output` stream, let readline manage the prompt
- **Tier 2 (non-TTY):** Plain text output, no cursor management, respect `--no-color`

## Tasks

### Task 1: Rewrite TUI core
File: `src/tui/index.js`
- Replace 293 lines with readline-integrated rendering
- `renderEvent(event)` → clean text output via `output.write`
- `createApprovalCallback()` → uses `rl.question()` (non-blocking)
- Remove: alt-screen, scroll regions, cursor positioning, broken spinner

### Task 2: Fix CLI integration
File: `src/cli.js`
- Pass `rl` to TUI: `new TUI({ rl, isTTY })`
- Remove manual `screen.write` and `ANSI.clearScreen`
- Wire TUI approval callback into engine

### Task 3: Status-aware prompt
- TUI provides `getPrompt()` returning prompt string with session info
- CLI calls `rl.setPrompt(tui.getPrompt())` after events

### Task 4: Verify
- `echo "/help\n/version\n/exit" | node src/cli.js` — clean output
- `npm test` — no regressions
