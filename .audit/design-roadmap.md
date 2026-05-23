# HaxAgent Architecture Roadmap

> Prepared 2026-05-22 after a full-source audit of `E:/HaxAgent/src/`.
> Each feature is concrete, references actual file paths and function names, and includes an actionable implementation approach.

---

## Architecture Summary (for context)

The codebase (~15 KLoC JavaScript) has two coexisting runtime models:

| Layer | Production path | Newer abstraction |
|---|---|---|
| Session | `src/session.js` (Session + CostTracker) | `src/runtime/sessions.js` (Session class) |
| Agents | None (ad-hoc) | `src/runtime/agents.js` (AgentDefinition) |
| Tasks | `src/runtime/tasks.js` (TaskList) | shared between both |
| Composition | None | `src/runtime/composition.js` (RuntimeComposition) |
| Commands | `src/commands/index.js` (COMMAND_HANDLERS) | `src/runtime/command-registry.js` (CommandRegistry) |

Key gaps identified:
- `src/plugins.js` -- fully designed plugin registry with 7 hooks; **never instantiated or wired**
- `src/batch.js` -- batch mode engine; **no `--batch` CLI flag**
- `src/export.js` -- transcript export (MD/JSON/text); **no slash command to invoke**
- `src/undo-stack.js` -- complete undo/redo system; **never wired into tool execution**
- Teams layer has full parallel orchestration but no integration with the plugin hooks or undo stack
- No automatic context summarization beyond `/compact` (keeps last 6 messages hard-coded)
- Memory is flat (no namespaces, tags)
- Goal persistence is lost on process exit

---

## Feature 1: Wire the Plugin System into the Runtime

**One-line summary:** Activate the existing `PluginRegistry` by firing its 7 lifecycle hooks from `AgentEngine`, `ToolRegistry`, and `Session`.

**Problem it solves:**
`src/plugins.js` has a fully-implemented `PluginRegistry` class with `beforeToolCall`, `afterToolCall`, `onError`, `beforeChat`, `afterChat`, `onSessionStart`, and `onSessionEnd` hooks. The class has `loadPluginsFromDirectory()`, `register()`, `runHook()`, and `unregister()` -- but it is never imported by `src/cli.js`, `src/agent-engine.js`, or `src/session.js`. Users cannot actually use plugins despite the infrastructure being complete.

**Files that would change:**
- `src/cli.js` -- instantiate the registry, load plugins from `~/.hax-agent/plugins/` and `./.hax-agent/plugins/`, pass it into Session
- `src/session.js` -- add `pluginRegistry` field to the `Session` class
- `src/agent-engine.js` -- call `pluginRegistry.runHook('beforeChat', ctx)` at the top of `_runProviderTurn()`, call `afterChat` after completion; pass pluginRegistry through to tools via context
- `src/tools/registry.js` -- accept `pluginRegistry` in `execute()`, call `beforeToolCall` / `afterToolCall` around each tool invocation
- `src/memory.js` -- support a plugin storage directory (`~/.hax-agent/plugins/`)

**Implementation approach:**
1. In `src/session.js`, add `this.pluginRegistry = options.pluginRegistry || new PluginRegistry();`
2. In `src/cli.js` main loop, after creating the Session, call: `session.pluginRegistry.loadPluginsFromDirectory(pluginUserDir)` and `loadPluginsFromDirectory(pluginProjectDir)`.
3. In `src/agent-engine.js`, at the top of `_runProviderTurn()`, wrap the body with:
   ```
   const beforeCtx = await session.pluginRegistry.runHook('beforeChat', { message: userMessage, session });
   if (beforeCtx.blocked) { yield createEvent('turn.blocked', ...); return; }
   // ... existing logic ...
   await session.pluginRegistry.runHook('afterChat', { message: userMessage, response: assistantMessage, session });
   ```
4. In `src/tools/registry.js` `execute()`, between permission check and `tool.execute()`, insert:
   ```
   await this.pluginRegistry?.runHook('beforeToolCall', { toolName: name, args, session: context.session });
   const data = await tool.execute(args, context);
   await this.pluginRegistry?.runHook('afterToolCall', { toolName: name, args, result: data, session: context.session });
   ```
5. Fire `onSessionStart` in CLI init, `onSessionEnd` in exit handler.
6. Add a `/plugins` slash command to list/disable/enable plugins.
7. Add `--plugin <path>` CLI flag for one-off plugin loading.
8. Add tests in a new `test/plugins.test.js`.

**Effort estimate:** M (4-6 dev-hours). The code already exists; work is integration plumbing + tests + CLI surface.

---

## Feature 2: Context Compression / Automatic Summarization

**One-line summary:** Replace the hard-coded `/compact` (keeps last 6 messages) with a token-aware smart compaction that asks the LLM to summarize earlier conversation turns.

**Problem it solves:**
`src/commands/index.js` `compactShell()` at line 328 is extremely crude: it keeps only the last 6 messages and drops everything else, losing all context. Long sessions hit token limits fast. There is no automatic truncation with summarization. Users lose important context.

**Files that would change:**
- `src/commands/index.js` -- rewrite `compactShell()` and `handleChatMessage()` to support smart compaction
- `src/context-window.js` -- add `compactContext()` function that produces a summary of dropped messages
- `src/agent-engine.js` -- add an auto-compaction threshold option
- `src/config.js` -- add `context.autoCompactThreshold` setting
- `src/session.js` -- add session-level compaction state tracking

**Implementation approach:**
1. Add settings `context.autoCompact: false` and `context.autoCompactThresholdTokens: 0.85` to `DEFAULT_SETTINGS`.
2. In `src/context-window.js`, add `compactContext(messages, budget, provider)`:
   - Split messages into "summary zone" (old) and "preserve zone" (recent up to 20 messages).
   - Call the provider with a summarization prompt to compress the summary zone into a single `<conversation-summary>` system message.
   - Return `{ compactedMessages, summaryText }`.
3. In `src/agent-engine.js` `_runProviderTurn()`, after `prepareContextWindow()`:
   - If `droppedMessages > 0` or `inputTokens / budgetTokens > threshold`, trigger `compactContext()`.
   - Inject the summary as a synthetic system message at the top of the message list.
4. In `src/commands/index.js` `compactShell()`, replace the hard-coded keep-6 logic with a call to `compactContext()` that produces human-readable output about what was summarized.
5. The compaction is done by sending a lightweight API call to the same model -- this ensures a free-form quality summary without needing a separate model.
6. Add tests in `test/context-window.test.js`.

**Effort estimate:** M (5-7 dev-hours). The context-window module already has all the token estimation infrastructure; the main work is the summarization prompt design, the compaction flow, and edge case handling.

---

## Feature 3: Agent Team Plan Generation from Natural Language

**One-line summary:** Let the user describe a multi-step task in natural language, and have the AI automatically generate a `TeamRuntime` plan (members, tasks, dependencies) ready to execute.

**Problem it solves:**
Currently, agent teams require pre-authored plans (like `src/teams/auth-refactor.js`). The only dynamic path is through the `/team` slash command, which requires manual `spawn`, `task`, `run` steps. There is no "take my goal and build the team plan for me" capability. This limits the team feature to pre-scripted use cases.

**Files that would change:**
- `src/teams/planner.js` -- new file: LLM-driven plan generation
- `src/commands/team.js` -- add `plan` subcommand
- `src/commands/index.js` -- add `plan` to TEAM_SUBCOMMANDS
- `src/teams/runtime.js` -- add `loadFromPlan(plan)` method
- `src/agent-engine.js` -- (minimal) expose the planning capability

**Implementation approach:**
1. Create `src/teams/planner.js` with a `generateTeamPlan(session, goal, options)` function:
   - Sends a structured prompt to the LLM asking it to output a JSON plan with `{ name, mission, members: [...], tasks: [...] }`.
   - Members reference existing agent types (from `loadAgentDefinitions()`).
   - Tasks include titles, dependencies, suggested owner agent types, and deliverables.
   - Parse the LLM JSON response, validate against the `TaskBoard`/`AgentRegistry` schemas.
   - Return a `plan` object that maps to `TeamRuntime.createTeam()` input.
2. Add a `generateTeamFromGoal(goalText)` exported function that:
   - Calls `generateTeamPlan()` synchronously (blocks until LLM responds).
   - Feeds the result to `TeamRuntime.createTeam()`.
   - Returns the created team snapshot.
3. In `src/commands/team.js`, add a `plan` subcommand handler:
   ```
   /team plan "refactor the authentication module to support OAuth2"
   ```
   This calls `generateTeamPlan()`, displays the generated plan, asks for confirmation, then creates the team.
4. Add `--auto-run` flag: `/team plan "..." --run` to generate and execute immediately.
5. Add a `/plan` top-level slash command alias for ergonomics.
6. Add tests in `test/team-plan.test.js`.

**Effort estimate:** M (6-8 dev-hours). The TeamRuntime is already fully wired; the main work is the LLM prompt engineering, JSON schema validation, and CLI integration.

---

## Feature 4: Wire UndoStack into Tool Execution

**One-line summary:** Activate the existing `UndoStack` by recording all file.mutating tool operations and exposing `/undo` and `/redo` slash commands.

**Problem it solves:**
`src/undo-stack.js` has a complete `UndoStack` class with `push()`, `undo()`, `redo()`, `list()`, `canUndo()`, `canRedo()`. It tracks original file content and can restore it. But it is never instantiated or called anywhere. The framework cannot undo file changes made by the AI.

**Files that would change:**
- `src/session.js` -- add `undoStack` field to Session
- `src/tools/registry.js` -- for `file.write` and `file.edit`, capture original content and push to undoStack
- `src/tools/file-write.js` -- expose pre-write read (to capture original content)
- `src/tools/file-edit.js` -- already reads before editing; capture original content
- `src/commands/index.js` -- add `/undo` and `/redo` command handlers
- `src/commands/definitions.js` -- add undo/redo to SLASH_COMMANDS

**Implementation approach:**
1. In `src/session.js` Session constructor, add `this.undoStack = new UndoStack(options.maxUndoEntries || 50);`.
2. In `src/tools/registry.js` `execute()`:
   - After a successful `file.write` or `file.edit`, check if `context.session?.undoStack` exists.
   - If so, call `undoStack.push({ toolName, filePath, originalContent, newContent, description })`.
   - The `originalContent` comes from reading the file before the write/edit (or an empty string if the file didn't exist).
3. Modify `src/tools/file-write.js` to return the pre-existing content (if any) as part of its result or a separate metadata field so the registry can capture it.
4. In `src/tools/file-edit.js`, the tool already reads the file; surface the original full content in the tool context so the registry can capture it.
5. In `src/commands/index.js`, add:
   - `/undo` -- calls `session.undoStack.undo()`, displays result (file name, what was restored).
   - `/redo` -- calls `session.undoStack.redo()`, displays result.
   - `/undo list` -- shows the undo stack.
6. Integrate with the exit handler: on `/exit`, if there are undoable changes, offer to show them.
7. Add tests in `test/undo-stack.test.js`.

**Effort estimate:** S (2-4 dev-hours). The UndoStack is complete; this is pure wiring + 2 new slash commands.

---

## Feature 5: Structured Memory with Namespaces and Tags

**One-line summary:** Upgrade the flat memory system to support namespaces, tags, and semantic search, making `/memory` more useful for large projects.

**Problem it solves:**
`src/memory.js` stores memories as flat JSON files with `name` and `content`. There is no way to scope memories to a project, tag them for categorization, or search by semantic meaning. `searchMemories()` only does substring matching. As users accumulate dozens of memories, the flat model becomes unusable.

**Files that would change:**
- `src/memory.js` -- add namespace, tags, and semantic search
- `src/commands/memory.js` -- add `--namespace`, `--tag` flags
- `src/commands/index.js` -- update memory command handler
- `src/config.js` -- add `memory.defaultNamespace` setting

**Implementation approach:**
1. Extend the memory file schema (`writeMemory()`) to include:
   ```
   { name, namespace: string, tags: string[], content, createdAt, updatedAt }
   ```
2. Add `writeMemory(name, content, { namespace = 'default', tags = [] })` with backwards-compatible defaults.
3. Add `listMemories({ namespace, tag })` with optional filtering.
4. Add `searchMemories(query, { namespace, tag })` with combined text + metadata search.
5. Add `import/export` memory functions for portability.
6. Storage: maintain backward compatibility by using a `.meta.json` index file alongside individual memory files if needed, or keep the per-file approach but add a `memories.json` index for fast lookup.
7. CLI: update `/memory write` to support `--namespace <ns> --tag <tag>`.
8. CLI: add `/memory search <query>` with namespace/tag filter display.
9. Optional: add a TF-IDF or simple embedding-based relevance rank for search results (can be a lightweight `natural` npm module or a custom implementation using term frequency).
10. Add tests in `test/memory-edge-cases.test.js`.

**Effort estimate:** M (5-7 dev-hours). Schema extension with backward compatibility, file I/O changes, CLI surface expansion.

---

## Feature 6: Batch Mode CLI Integration

**One-line summary:** Wire the existing `src/batch.js` `runBatchMode()` into the CLI entry point with a `--batch` flag and `--input`/`--output` file options.

**Problem it solves:**
`src/batch.js` has a complete `runBatchMode()` function supporting stdin input, file input, multi-turn processing, and raw/formatted output. But `src/cli.js` has no `--batch` flag. Users cannot run Hax Agent in scripted/CI pipelines despite the engine being fully ready for it.

**Files that would change:**
- `src/cli.js` -- parse `--batch`, `--input <file>`, `--output <file>`, `--raw` flags; call `runBatchMode()`
- `src/batch.js` -- fix the missing `path` import in `formatBatchOutput` (line 94 references `path.dirname` but `path` is not imported at the top)

**Implementation approach:**
1. Fix the `path` import bug in `src/batch.js` (line 94 uses `path.dirname` but `const path = require('node:path')` is missing).
2. In `src/cli.js`, parse `--batch` from process.argv (likely using the existing argument parser in the CLI entry).
3. When `--batch` is set:
   - Skip the interactive REPL.
   - Load settings (same as normal startup, including provider, API keys).
   - Initialize Session with the resolved settings.
   - Call `runBatchMode({ session, settings, inputFile, outputFile, raw })`.
   - Exit with the returned code.
4. Handle `--input <file>` to read from file instead of stdin.
5. Handle `--output <file>` to write response to file.
6. Handle `--raw` to skip the footer statistics.
7. Handle `--model` and `--provider` overrides for one-off batch runs.
8. Ensure error messages go to stderr (already done in batch.js).
9. Add smoke test in a new test file or in `test/cli.test.js`.

**Effort estimate:** S (2-3 dev-hours). The engine is complete; this is CLI arg parsing + the `path` bug fix.

---

## Feature 7: Session Transcript Export Command

**One-line summary:** Expose the existing `src/export.js` export functions via a `/export` slash command for Markdown, JSON, and text formats.

**Problem it solves:**
`src/export.js` has `exportSessionToMarkdown()`, `exportSessionToJson()`, and `exportSessionToText()` -- fully implemented. But there is no slash command to invoke them. Users must write code to export transcripts.

**Files that would change:**
- `src/commands/index.js` -- add `/export` command handler
- `src/commands/definitions.js` -- add `export` to SLASH_COMMANDS

**Implementation approach:**
1. In `src/commands/definitions.js`, add:
   ```js
   { name: 'export', descriptionKey: 'cmd.export', description: 'Export this session transcript', aliases: [], argHint: '[md|json|text] [output-path]' }
   ```
2. In `src/commands/index.js`, add `export` handler to COMMAND_HANDLERS:
   - `export` without args: prompt for format (md/json/text) via interactive menu.
   - `/export md ./session-log.md` -- exports to Markdown.
   - `/export json ./session-log.json` -- exports to JSON.
   - `/export text ./session-log.txt` -- exports to plain text.
   - Default output path: `./hax-agent-session-<date>.<ext>` in cwd.
   - Display success with file size and path.
3. Import `exportSessionToMarkdown`, `exportSessionToJson`, `exportSessionToText` from `src/export.js`.
4. Add to i18n files the necessary translation keys.
5. Add to `/export sessions <id>` to export a specific session by ID.

**Effort estimate:** S (1-2 dev-hours). Pure wiring; export functions are complete.

---

## Feature 8: Goal Persistence Across Sessions

**One-line summary:** Save active goals to disk so that if the agent process crashes or the user exits, the goal state can be resumed in the next session.

**Problem it solves:**
The goal system (`/goal <text>`) in `src/agent-engine.js` runs entirely in-memory via `session.goal`. If the process exits unexpectedly, the goal and all continuation progress are lost. For long-running multi-turn goals (e.g., "refactor all test files"), this is a critical reliability gap.

**Files that would change:**
- `src/session.js` -- add goal serialization to transcript
- `src/agent-engine.js` -- persist goal changes
- `src/commands/index.js` -- `loadRecentTranscript()` should also restore goal state
- `src/memory.js` -- add goal persistence helpers

**Implementation approach:**
1. In `src/session.js`, add `persistGoal()` that writes goal state as a special metadata entry in the session transcript:
   ```json
   { "type": "goal.meta", "goal": { "text": "...", "enabled": true, "maxContinuations": 5, "createdAt": "..." } }
   ```
2. In `src/agent-engine.js`:
   - When a goal is set (`/goal` handler), call `session.persistGoal()`.
   - When a goal continuation runs, update a `lastContinuationAt` timestamp and persist.
   - When a goal completes or is blocked, write a goal-status entry.
3. In `src/commands/index.js` `loadRecentTranscript()`:
   - After restoring messages, scan transcript entries for `goal.meta` records.
   - Reconstruct `session.goal` from the most recent `goal.meta` entry.
   - Show a notice: "Resumed active goal: <text>".
4. Add a `goal.meta` entry filter to `readTranscript()` similar to how `SESSION_META_TYPE` is already filtered.
5. Add `/goal resume` to explicitly reload a goal from disk.
6. Add tests in `test/agent-engine.test.js`.

**Effort estimate:** S (2-3 dev-hours). The transcript system already supports typed metadata entries (`SESSION_META_TYPE`); this extends the pattern.

---

## Prioritization by Impact/Effort Ratio

| Rank | Feature | Impact | Effort | Rationale |
|------|---------|--------|--------|-----------|
| 1 | **Feature 1: Wire Plugin System** | Very High | M | Activates an entire extensibility layer; unlocks community plugins; the code is already written |
| 2 | **Feature 4: Wire UndoStack** | High | S | Tiny effort for a dramatic UX improvement; users frequently need to undo AI changes |
| 3 | **Feature 6: Batch Mode CLI** | High | S | Enables CI/CD integration; code is complete except for CLI flag + one `path` bug |
| 4 | **Feature 7: Export Command** | Medium | S | Completes the session management workflow; near-zero effort |
| 5 | **Feature 8: Goal Persistence** | Medium | S | Protects against data loss during long-running tasks |
| 6 | **Feature 2: Smart Context Compression** | High | M | Massively improves long-session UX; reduces token costs |
| 7 | **Feature 3: Team Plan Generation** | High | M | Makes the teams feature accessible to non-power-users |
| 8 | **Feature 5: Structured Memory** | Medium | M | Nice-to-have for power users; incremental improvement |

---

## Quick Wins (do these first, 1-3 hours each)

These three features have fully-implemented engines with zero integration effort -- they just need CLI surface:

1. **Batch mode** (`src/batch.js`) -- add `--batch` flag to `src/cli.js`, fix missing `path` import
2. **Session export** (`src/export.js`) -- add `/export` slash command
3. **Undo/redo** (`src/undo-stack.js`) -- wire into `src/tools/registry.js` + `/undo` `/redo` commands

---

## Medium-term Goals (do these next, 4-8 hours each)

These have higher impact but require more integration work:

4. **Plugin system activation** (`src/plugins.js`) -- wire hooks into `AgentEngine`, `ToolRegistry`, `Session`, `CLI`
5. **Smart context compression** -- new summarization flow in `context-window.js` + rewrite `compactShell()`
6. **Team plan generation from NL** -- new `teams/planner.js` + LLM prompt engineering

---

## Additional Observations (not full features, but worth noting)

- **Runtime model consolidation**: `src/runtime/sessions.js` and `src/session.js` both define a `Session` class with overlapping but non-identical fields. A future refactoring could merge them or make the old one delegate to the new one. This would reduce confusion and simplify dependency graphs.
- **Tool schema validation**: Tools declare `inputSchema` (JSON Schema) but there is no validation at the registry level. Adding an `ajv` or `@cfworker/json-schema` validation before tool execution would catch bad AI tool calls early and provide better error messages.
- **Provider message format normalization**: `src/providers/messages.js` normalizes messages for each provider, but the normalization happens inside each provider's `stream()` method. Centralizing the normalization in the factory or `agent-engine.js` would reduce duplication and make it easier to add new providers.
- **Desktop services modularization**: `src/desktop-services.js` is 22 KB and contains workspace tree, search, git, session, snapshot, and config logic. It could be split into 3-4 focused modules.
- **i18n coverage**: The i18n system (`src/i18n/`) is well-structured but only covers CLI strings. Tool error messages, system prompts, and the `DEFAULT_SYSTEM_PROMPT` in `src/providers/shared.js` are hard-coded in English.
