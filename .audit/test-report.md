# HaxAgent Test Audit Report

**Date:** 2026-05-22  
**Branch:** master  
**Framework:** Node.js native test runner (`node:test` + `node:assert/strict`)

## Summary

Added 9 new test files with 271 tests targeting previously uncovered modules: undo-stack, plugins, serialization, session classes, skills parser, context builder, command suggestions, paste utilities, and renderer utilities.

**Result:** 271/271 tests pass (0 failures)

## New Test Files

### 1. `test/undo-stack.test.js` -- 22 tests
Tests for the `UndoStack` class covering:
- Constructor defaults and custom `maxEntries`
- `push()` edge cases: null/undefined, missing `filePath`, defaults for missing fields, redo-stack clearance on new action, stack trimming at capacity
- `canUndo()` / `canRedo()` boolean guards
- `undo()` / `redo()` with empty stacks
- Actual file I/O: restore original content, handle externally modified files, reapply changes
- Error recovery: re-push on write failure (both undo and redo)
- `removeByPath()` across both undo and redo stacks
- `list()` ordering and structure
- `clear()` resets both stacks
- Full undo-redo lifecycle cycle (v1 -> v2 -> v3 -> v2 -> v1 -> v2 -> v3)

### 2. `test/plugins.test.js` -- 26 tests
Tests for the `PluginRegistry` class covering:
- `PLUGIN_HOOK_NAMES` constants (all 7 hooks confirmed)
- Constructor initializes empty hooks map for all hook names
- `register()` validation: rejects non-object, empty name, whitespace name, duplicates
- Default version (`"0.0.0"`)
- Ignores non-function hooks and unknown hook names
- `runHook()`: returns context unchanged when no handlers, shallow-clones context when handlers present, passes through null/undefined return values
- Sequential handler execution order
- Error handling: swallows handler errors, fires `onError` hook, avoids recursive `onError` loops
- `unregister()`: removes plugin and all its hooks, returns false for unknown
- `list()` and `getHookCount()` reporting
- `loadPlugin()`: rejects missing files, loads from disk
- `loadPluginsFromDirectory()`: loads all `.js` files, skips non-js files, silently skips failing plugins, returns 0 for non-existent dirs
- Async handler support
- Empty context defaults to empty object

### 3. `test/serialization.test.js` -- 22 tests
Tests for `src/utils/serialization.js` covering:
- `serializeProvider()`: null/undefined, minimal provider, extra fields are stripped (apiKey, client, internalState not leaked)
- `serializeError()`: null/undefined, standard Error, Error with code, custom-named errors, error-like objects, non-error primitives (string, number, boolean)
- `serializeSkill()`: null/undefined, minimal skill, displayName fallback, description, source field
- `serializeProviderIssue()`: empty_tool_preamble reason, unknown reasons, missing reason, null/undefined
- `isTerminalToolLimitReason()`: true/false for all known reason values

### 4. `test/session-classes.test.js` -- 50 tests
Tests for `InputHistory`, `CostTracker`, and `Session`:

**InputHistory (20 tests):**
- Constructor defaults and custom `maxSize`, initial state verification
- `add()`: ignores empty/whitespace, deduplicates consecutive same entries, FILO ordering, resets navigation state, trims to `maxSize`
- `up()`: returns current when empty, cycles through history, stays at last entry
- `down()`: returns current when not navigating, returns partial at boundary, cycles back
- `reset()` clears navigation state
- `search()`: empty/null/undefined queries return empty, case-insensitive matching, limits to 10
- `rsearch()`: empty/null returns null, finds first match, returns null for no match

**CostTracker (16 tests):**
- Constructor initializes all fields to 0 and `startTime`
- `addUsage()`: reads `input_tokens`/`output_tokens`, alternative keys (`prompt_tokens`/`completion_tokens`), `cache_creation_input_tokens`/`cache_read_input_tokens`, handles null/undefined, ignores NaN/Infinity
- `addToolCall()` increments counter
- `getCost()`: returns 0 for unknown/null model, calculates correctly for known models
- `getPricing()`: direct match, pattern fallback (claude-opus, gpt-4o), returns null for unknown
- Cache cost calculation
- `formatSummary()`: includes all non-zero fields, hides zero cache lines

**Session (14 tests):**
- Constructor: unique id, empty messages, CostTracker instance, initial state fields
- Stores provider, settings, toolRegistry, permissionManager
- `getElapsedTime()` returns formatted string
- `modifiedFiles` is a Set instance
- Unique session IDs
- `getStatusLine()`: includes provider/model, yolo mode indicator, handles null permissionManager, context meter when stats available, long cwd truncation, goal indicator (enabled/disabled)

### 5. `test/skills-parser.test.js` -- 30 tests
Tests for `src/skills/parser.js`:

**parseFrontmatter (11 tests):**
- Content without markers returns empty frontmatter
- Empty content
- Simple key-value pairs
- Quote stripping (double and single)
- Inline arrays (`[...]`), empty inline arrays
- Multi-line YAML-style arrays
- Key-value after multi-line array
- Empty lines within arrays
- Hyphenated key names
- Multiple hyphenated keys

**extractDescriptionFromMarkdown (5 tests):**
- H1 extraction
- Fallback to default name when no heading
- Custom fallback
- Blank leading lines skipped
- Empty content

**parseArgumentNames (7 tests):**
- null/undefined returns empty
- Comma-separated string
- Whitespace handling
- Already-array format
- Non-string values filtered from arrays
- Single argument (no commas)
- Empty/whitespace-only strings

**substituteArguments (7 tests):**
- No args or no arg names returns content unchanged
- Empty args array behavior
- Variable substitution with values
- Missing args default to empty string
- Global replacement (`$name` appears multiple times)
- Empty arg values

### 6. `test/context.test.js` -- 29 tests
Tests for `src/context.js`:

**buildPromptContext (7 tests):**
- Minimal structure with empty options
- Instructions inclusion
- User prompt as final message
- Memory limiting by `maxItems`
- `includeSettings: false`, `includeMemory: false`, `includeTranscript: false`

**assembleSystemPrompt (3 tests):**
- Identity section always present
- Runtime section when provided
- Empty runtime object skipped

**buildMessages (5 tests):**
- User prompt only when no transcript
- Empty when nothing provided
- Non-user/assistant role filtering
- Empty content filtering
- Null/undefined entries in transcript

**formatMemories/formatTranscript/formatSettings (10 tests):**
- Empty state messages
- Content formatting with truncation
- Role/type fallback in transcript
- Setting field filtering for undefined/empty values

**loadPromptContext (4 tests):**
- Disabled memory skip
- Provided memories override
- Provided transcript override
- Empty options

### 7. `test/command-suggestions.test.js` -- 21 tests
Tests for `src/command-suggestions.js`:

**editDistance (9 tests):**
- Identical strings (distance 0)
- Empty source/target (distance = length of other)
- Both empty
- null/undefined handling
- Case insensitivity
- Standard test cases (kitten/sitting, abc/xyz, file/files)
- Transposition detection
- Completely different strings

**suggestCommand (12 tests):**
- Empty/whitespace-only input
- Leading slash stripping
- Exact match
- Typo correction
- Custom object format (`{name, description}`)
- Hybrid format (`{match, suggest}`)
- Tie-breaking (prefers shorter suggestions)
- Empty/null candidates
- Distance threshold exceeded
- Regex special characters in input
- Null/undefined fields in candidates
- Threshold scaling with input length

### 8. `test/paste-utils.test.js` -- 17 tests
Tests for `src/paste-utils.js`:

- `shouldRunPasteAsCommandBatch()`: empty/null/undefined input, single line, non-command lines, all `/` lines, all `!` lines, mixed prefixes, detection of non-command in multi-line input, blank line filtering, Windows line endings, whitespace-only lines
- `formatPastedInputSummary()`: empty, null/undefined, single line, multiple lines, formatted numbers
- `formatPastedInputBadge()`: ANSI codes present, empty input handling

### 9. `test/renderer.test.js` -- 54 tests
Tests for pure utility functions in `src/renderer.js`:

- `formatBytes()`: zero, null/undefined/NaN, bytes, KB, MB, GB
- `formatDuration()`: null/undefined/NaN/strings, valid durations
- `formatDisplayPath()`: slash-to-backslash conversion, no slashes, null/undefined
- `pluralize()`: singular (1), plural (0, 2, 100)
- `toToolLabel()`: dotted-to-title-case, single word, null/undefined, empty segments
- `isDisplayableInput()`: sensitive key filtering (case-insensitive), non-sensitive keys, numbers/booleans, objects/arrays
- `stripAnsi()`: ANSI removal, no-ANSI text, empty string
- `styled()`: color wrapping, empty text
- `formatChangeSummary()`: added+removed, only added, fallback to "Modified N lines", default to 1 changed
- `formatProviderError()`: empty_tool_preamble, 401/403 auth guidance, 429 rate limit, billing/quota, network errors, non-auth anthropic errors, unrecognized errors, null/undefined, string errors
- `formatToolInputSummary()`: null/undefined, non-object, file.read path, shell.run command+args, file.glob pattern+cwd, file.search query+path, unknown tool generic display, long value truncation, sensitive key filtering
- `formatToolStart()`: basic tool with name, attempt label for retries, no label for first attempt, no label when unset

## Pre-existing Failures

Two pre-existing test failures were identified (not caused by new tests):
1. `orchestration-edge-cases.test.js`: "MessageRouter: history filters by agent (from or to)" -- incorrect assertion in existing test
2. `providers-factory.test.js`: One test in the factory test file fails

## Test Coverage Gaps

Areas that could still benefit from additional tests:
- `src/agent-engine.js` (complex, requires mocking)
- `src/cli.js` (interactive, hard to test)
- `src/commands/autocomplete.js` (requires readline mocking)
- `src/skills/loader.js` (requires filesystem fixtures)
- `src/skills/intent-matcher.js` (formatSkillsList, buildSkillSystemPrompt, matchSkillByIntent)
- `src/desktop-services.js` (Electron-dependent)
- `src/file-context.js` (file system dependent)
- `src/providers/shared.js` (already partially covered by providers.test.js)

## Test Statistics

| File | Tests | Status |
|------|-------|--------|
| undo-stack.test.js | 22 | All pass |
| plugins.test.js | 26 | All pass |
| serialization.test.js | 22 | All pass |
| session-classes.test.js | 50 | All pass |
| skills-parser.test.js | 30 | All pass |
| context.test.js | 29 | All pass |
| command-suggestions.test.js | 21 | All pass |
| paste-utils.test.js | 17 | All pass |
| renderer.test.js | 54 | All pass |
| **Total New** | **271** | **0 failures** |
