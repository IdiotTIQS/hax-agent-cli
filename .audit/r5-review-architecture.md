# R5 Architecture Coherence Review

**Date:** 2026-05-23
**Scope:** Full cross-module architecture audit of src/ (all ~350 files across ~67 subdirectories)
**Method:** Static import-graph analysis via `require()` tracing, manual interface comparison

---

## 1. Module Dependency Map

### Core Integration Spine (the only living cross-module dependency chain)

```
cli.js
  -> commands/index.js      -> teams/agents, teams/runtime, teams/planner, skills, memory, goal-persistence
  -> renderer.js
  -> session.js             -> memory, i18n
  -> config.js, agent-engine.js

agent-engine.js             (core loop — see hub.js for full wiring)
  -> providers/             (Anthropic, OpenAI, Google adapters)
  -> tools/                 (file I/O, shell, web, stock)
  -> session.js

hub.js                      (soft-dependency orchestration; lazy-loads via try/catch)
  -> config-validator
  -> plugins, undo-stack, rate-limiter
  -> tools/registry, session, agent-engine
  -> memory-eviction, goal-persistence, shutdown, context-compaction

teams/runtime.js            -> orchestration.js, providers/, tools/, teams/agents
orchestration.js            -> runtime/utils.js (new R1-R4 utility)
index.js                    (public API barrel) -> hub, context, memory, orchestration, runtime,
  teams/runtime, teams/agents, teams/tools, formatters/team-plan,
  formatters/agent-teams, undo-stack, plugins, batch, export, tool-retry,
  goal-persistence, context-compaction, config-presets, session-summary
```

### Teams / Orchestration / Runtime Circular-Aware Chain

```
teams/runtime.js
  -> orchestration.js       (imports createAgentTeam)
  -> providers/             (imports createProvider)
  -> tools/                 (imports ToolRegistry)
  -> teams/agents           (imports loadAgentDefinitions)

orchestration.js
  -> runtime/utils.js       (imports requireString)

teams/planner.js
  -> teams/agents           (imports loadAgentDefinitions, normalizeName)

teams/auth-refactor.js
  -> orchestration.js       (imports createAgentTeam)

NO CIRCULAR DEPENDENCIES FOUND in these chains.
```

---

## 2. The Orphan Architecture Crisis (67 of 73 directories have ZERO integration)

The most serious finding: **~60 of ~73 src/** subdirectories contain modules that are never `require()`d by any other module outside their own directory.** They exist only as dead code referenced exclusively by test files.

| Status | Count | Directories |
|--------|-------|-------------|
| **Imported by other modules** | ~14 | commands, formatters, hub, i18n, providers, runtime, skills, teams, tools, config(flat), memory, session, orchestration, index |
| **Zero cross-module imports** | ~53 | analytics, artifact, benchmark, branches, bridge, capability, ci, cli-utils, codegen, collab, compat, compliance, config/subdir, context/subdir, contracts, conversation, coordination, dashboard, data, debate, dev-tooling, diagram, diff, docs, events, explain, export, format, gateway, generator, goals, governance, graph, handoff, health, hotreload, improvement, injection, intel, isolate, knowledge, logs, marketplace, memory/subdir, migration, models, multimodal, nlp, notify, observability, optimizer, ownership, palette, patterns, personality, planner, platform, plugins/subdir, prediction, preserve, prompts, protocol(flat), quality, quota, rbac, recorder, regression, reinforcement, resilience, review, safety, sandbox, **scheduler**, search, security, semver, sim, similarity, state, strategy, tasks, testing, time, **tokens**, training, trust, tutorial, utils, versioning, visualize, watcher, **workflow**, workspace |

This means **the vast majority of the codebase is dead code** — fully written modules that no production code path ever reaches. These modules were created speculatively (likely by AI generation) without any integration plan.

---

## 3. Overlapping / Competing Abstractions

### 3a. Four competing Schedulers (all orphans, all unused)

| Scheduler | File | Lines | Purpose | Imported By |
|-----------|------|-------|---------|-------------|
| CronScheduler | `scheduler/cron.js` | 457 | Cron-based recurring job scheduler | Nothing |
| TaskQueue + TaskWorker | `scheduler/queue.js` + `scheduler/worker.js` | 449 + 325 | Priority queue with worker pool | Nothing |
| WorkflowScheduler | `workflow/scheduler.js` | 584 | Cron-triggered workflow scheduling with retries | Nothing |
| FairScheduler | `quota/scheduler.js` | 634 | Multi-agent weighted fair queuing / max-min / priority | Nothing |
| WorkScheduler | `time/scheduler.js` | 601 | Working-hours-aware task scheduling with deadline detection | Nothing |

**Total: 3,050 lines of scheduler code, all dead.** Five different scheduling paradigms with overlapping concepts (priority, cron, retry, deadline, concurrency) and zero coordination between them. Each reinvents its own cron parser independently.

### 3b. Seven token counting / budgeting systems

| System | File | Concern | Used By |
|--------|------|---------|---------|
| `context-window.js` | 218 lines | Per-message token estimation, context window enforcement | `agent-engine.js`, `hub.js` (indirect) |
| `providers/token-counter.js` | 148 lines | Provider-agnostic token estimation, tiktoken integration | `session.js` |
| `tokens/budget.js` (TokenBudget) | 238 lines | Category-based token budget with allocation/reservation/consumption | Nothing |
| `tokens/monitor.js` (TokenMonitor) | 450 lines | Token usage tracking, trend analysis, exhaustion prediction | Nothing |
| `tokens/planner.js` (TokenPlanner) | 479 lines | Task-based token budget planning, complexity assessment | Nothing |
| `tokens/strategies.js` (TokenStrategy) | 781 lines | 5 strategy token optimization: truncate, summarize, compress, drop, merge | Nothing |
| `tokens/cost-tracker.js` | separate | Cost tracking (model pricing) | `session.js` (inline CostTracker class) |

**Total: ~2,314 lines of token management code, ~1,948 lines of which are dead.**

Both `context-window.js` and `providers/token-counter.js` independently implement `estimateTokens()` with the same `Math.ceil(content.length / 4)` formula. `tokens/strategies.js` also has its own `_estimateTotalTokens()` doing the same thing. Three copies of the same estimation logic at varying MESSAGE_OVERHEAD_TOKENS constants (4, 6, 8).

### 3c. Three session classes with overlapping concerns

| Session | File | Lines | Key Features | Relationship |
|---------|------|-------|--------------|--------------|
| `Session` (main) | `session.js` | ~600 | Conversation state, cost tracking, input history, provider management | Core - used by cli.js, agent-engine |
| `Session` (runtime) | `runtime/sessions.js` | 54 | Minimal session with id, messages, transcript, snapshot | New R1-R4 module - used by runtime/composition.js |
| `Session` (workspace) | `workspace/session-context.js` | separate | Workspace-aware session | Nothing imports it |

These three Session classes are **completely independent** — they do not share an interface, do not extend each other, and have different property sets.

### 3d. Four task models

| Task Model | File | Fields | Used By |
|------------|------|--------|---------|
| `createTask()` | `orchestration.js` | id, title, owner, parallel, dependsOn, deliverable, status, result, error, startedAt, completedAt, metadata | `teams/runtime.js` via createAgentTeam |
| `TaskList / createTask()` | `runtime/tasks.js` | id, title, owner, status, parallel, dependsOn, deliverable, metadata | `runtime/composition.js` |
| Internal task | `teams/runtime.js` | Expanded set (prompt, agentType, nextTaskNumber, etc.) | `teams/runtime.js` own state |
| Task tracker | `tasks/tracker.js` | Unknown — orphan module | Nothing |

The task models share similar fields (id, title, owner, status, dependsOn, deliverable) but have **incompatible status enums**:
- `orchestration.js`: `pending | in_progress | completed | failed`
- `runtime/tasks.js`: `pending | in_progress | blocked | completed | failed`
- `teams/runtime.js`: `pending | in_progress | completed | failed`

`runtime/tasks.js` has a `blocked` status that `orchestration.js` and `teams/runtime.js` do not support — silently incompatible.

### 3e. Four agent definition systems

| Agent System | File | Key Class/Function | Used By |
|--------------|------|--------------------|---------|
| AgentDefinition | `runtime/agents.js` | `AgentDefinition` class (name, role, goal, tools, status) | `runtime/composition.js` |
| Subagent creation | `orchestration.js` | `createSubagent()` (name, role, capabilities, status, currentTaskId) | `teams/runtime.js` via createAgentTeam |
| Agent definitions | `teams/agents.js` | Built-in agents with tool lists, prompts, discovery from filesystem | `teams/runtime.js`, `cli.js` |
| Team members | `teams/runtime.js` | Internal member objects (id, agentType, prompt, model, tools, color) | `teams/runtime.js` own state |

Agent status enums are also incompatible:
- `runtime/agents.js`: `idle | running | blocked | done`
- `orchestration.js`: `idle | busy | offline`
- `teams/runtime.js`: `idle | busy`

### 3f. Three export / output systems

| System | File | Function |
|--------|------|----------|
| `export.js` | flat file | `exportSessionToMarkdown`, `exportSessionToJson`, `exportSessionToText` |
| `export/` | directory with pipeline, postprocess, formats/(blog,html,notebook) | Full export pipeline |
| `session-summary.js` | flat file | `summarizeSession`, `listSummaries`, `getSessionTimeline` |

`export.js` exports individually while `export/` has a pipeline architecture. `session-summary.js` overlaps with the export concept (summarizing for output). All three are independent.

### 3g. Two config systems

| System | File | Approach |
|--------|------|----------|
| `config.js` | flat file | Settings resolution (5 priority levels), defaults, env, CLI flags |
| `config/` | directory with environment, interactive, migration, profiler, schema | Modular config subsystems |

`config.js` resolves settings; the `config/` subdirectory adds environment, migration, profiling, and schema validation. `config-presets.js` and `config-validator.js` are separate flat files alongside. There is no clear integration boundary — some `config/` files may be orphans.

---

## 4. Integration Issues

### Issue 1: hub.js is the only integrator — and it uses soft (try/catch) requires

`hub.js` uses `_mod('name')` with try/catch wrapping for every subsystem. This means:
- Integration failures are silently swallowed
- No compile-time visibility into what subsystems are available
- Impossible to statically analyze the dependency graph

### Issue 2: The new R1-R4 runtime/ modules integrate in a separate silo

The new `runtime/` modules (agents, command-registry, composition, messages, sessions, tasks, utils) form a clean internal graph:
```
runtime/index.js -> agents, command-registry, composition, messages, sessions, tasks
runtime/composition.js -> command-registry, sessions, tasks, utils
```

But they are only used by:
- `orchestration.js` (imports `runtime/utils.js` for `requireString`)
- `index.js` (barrel-reexports `runtime`)
- `protocol/compressor.js` and `protocol/router.js` (import `runtime/utils.js` for `requireString`)

The runtime Session, TaskList, and AgentDefinition classes are **never wired into the main code path** (cli.js, agent-engine.js, tools/). They exist in a parallel universe.

### Issue 3: teams/ is the only truly integrated subsystem

`teams/runtime.js` -> `orchestration.js` -> `runtime/utils.js` is the only clean dependency chain that actually reaches runtime code. It is used from:
- `cli.js` (via `registerAgentTeamTools`, `loadAgentDefinitions`)
- `commands/index.js` and `commands/team.js` (via `loadAgentDefinitions`, `createTeamRuntime`, `generateTeamPlan`)
- `index.js` (via barrel export)
- `desktop-services.js`

### Issue 4: 53 dead directories represent a massive spec-build problem

These directories all follow a consistent 3-file pattern (e.g., `foo/a.js`, `foo/b.js`, `foo/c.js`), suggesting batch generation without an architecture plan. They have tests but no production consumers.

---

## 5. API Consistency Across Modules

**Rating: Very Poor**

| Pattern | Consistency Finding |
|---------|---------------------|
| Status enums | Inconsistent across all 4 agent systems and 3 task systems |
| Factory functions | Inconsistent: some use `createX()`, some use `new X()`, some mix both |
| Error handling | `runtime/` uses `TypeError` throws; `orchestration.js` uses `requireString`; `scheduler/worker.js` has its own `TaskWorkerError`; `tools/` has `ToolExecutionError` |
| Immutability | `runtime/` uses `Object.freeze()` on snapshots; `teams/runtime.js` uses `JSON.parse(JSON.stringify())` for cloning; `orchestration.js` mixes mutable objects |
| Module export style | Some export classes + factory functions; some export plain objects; some export via `module.exports = { ...require('./x') }` |
| Naming | `token-counter.js` vs `cost-tracker.js` vs `budget.js` — no consistent naming scheme even within the tokens/ domain |

---

## 6. Orphan Module Inventory (53 directories with zero integration)

These directories contain between 2 and 11 files each and are **only referenced by test files, never by production code**:

`analytics/`, `artifact/`, `benchmark/`, `branches/`, `bridge/`, `capability/`, `ci/`, `cli-utils/`, `codegen/`, `collab/`, `compat/`, `compliance/`, `config/`(subdir), `context/`(subdir), `contracts/`, `conversation/`, `coordination/`, `dashboard/`, `data/`, `debate/`, `dev-tooling/`, `diagram/`, `diff/`, `docs/`, `events/`, `explain/`, `export/`, `gateway/`, `generator/`, `goals/`, `governance/`, `graph/`, `handoff/`, `health/`, `hotreload/`, `improvement/`, `injection/`, `intel/`, `isolate/`, `knowledge/`, `logs/`, `marketplace/`, `memory/`(subdir), `migration/`, `models/`, `multimodal/`, `nlp/`, `notify/`, `observability/`, `optimizer/`, `ownership/`, `palette/`, `patterns/`, `personality/`, `planner/`, `platform/`, `plugins/`(subdir), `prediction/`, `preserve/`, `prompts/`, `quality/`, `quota/`, `rbac/`, `recorder/`, `regression/`, `reinforcement/`, `resilience/`, `review/`, `safety/`, `sandbox/`, `scheduler/`, `search/`, `security/`, `semver/`, `sim/`, `similarity/`, `state/`, `strategy/`, `tasks/`, `testing/`, `time/`, `tokens/`, `training/`, `trust/`, `tutorial/`, `versioning/`, `visualize/`, `watcher/`, `workflow/`, `workspace/`

**Estimated dead code: ~200 files, ~50,000+ lines**

---

## 7. Suggested Module Consolidation & Removal

### Immediate removal candidates (no integration path exists)

1. **All 4 competing scheduler systems** — `scheduler/`, `workflow/scheduler.js`, `quota/scheduler.js`, `time/scheduler.js` — Replace with ONE scheduler if needed
2. **All unused token systems** — `tokens/budget.js`, `tokens/monitor.js`, `tokens/planner.js`, `tokens/strategies.js`, `tokens/cost-tracker.js` — Keep only `context-window.js` + `providers/token-counter.js`
3. **Remove duplicate session classes** — Keep `session.js`, delete `runtime/sessions.js` and `workspace/session-context.js`
4. **Remove duplicate task models** — Keep `orchestration.js` task model, delete `runtime/tasks.js` and `tasks/`
5. **Remove duplicate agent definitions** — Keep `teams/agents.js`, delete `runtime/agents.js`
6. **Remove all 53 orphan directories** (listed above)

### Consolidation candidates

| Consolidation | What to keep | What to merge/remove |
|---------------|--------------|----------------------|
| Token counting | `context-window.js` (window enforcement) + `providers/token-counter.js` (provider estimation) | Merge duplicate `estimateTokens()` implementations |
| Export | `export.js` (flat functions, exported in public API) | Merge `export/` pipeline, remove `session-summary.js` |
| Config | `config.js` (flat resolution) | Merge `config/` into it; `config-presets.js` and `config-validator.js` are fine as-is |
| Runtime classes | Keep the `runtime/utils.js` helpers (used by orchestration, protocol) | Remove `runtime/agents.js`, `runtime/tasks.js`, `runtime/sessions.js` — duplicates of existing systems |
| Task system | Consolidate `orchestration.js` TaskBoard + teams task model | Remove `runtime/tasks.js TaskList` — incompatible status enum |

---

## 8. Overall Architecture Coherence Score: **18 / 100**

**Breakdown:**

| Dimension | Score | Reason |
|-----------|-------|--------|
| Dependency clarity | 10/20 | hub.js uses soft requires obscuring the graph; most modules are orphans |
| Module boundary hygiene | 5/20 | 53/67 directories are dead code; real code is a small handful of files |
| Avoiding duplication | 5/20 | 4 schedulers, 7 token systems, 3 sessions, 4 tasks, 4 agents — rampant duplication |
| Integration quality | 8/20 | Only teams/ is properly integrated; runtime/ is partially integrated via utils only |
| API consistency | 0/20 | No shared base classes, inconsistent enums, mixed patterns, three different error types |

**Final: 18/100 — Architecture coherence is critically broken.**

---

## 9. Top 5 Architecture Improvements

### 1. Purge 53 orphan directories (~200 files, ~50K lines of dead code)
These directories have zero production consumers. They inflate the codebase 10x, create false confidence in test coverage, and make it impossible to reason about the real architecture. Remove them in one sweep.

### 2. Consolidate to ONE token economy
Replace the 7 competing token systems (`context-window.js`, `providers/token-counter.js`, `tokens/strategies.js`, `tokens/budget.js`, `tokens/monitor.js`, `tokens/planner.js`, `tokens/cost-tracker.js`) with a single `TokenManager` that handles estimation, budgeting, monitoring, and optimization through one consistent API. Standardize MESSAGE_OVERHEAD_TOKENS to a single constant.

### 3. Pick ONE task model with a shared base
`orchestration.js`, `runtime/tasks.js`, and `teams/runtime.js` all define task structures with nearly identical fields but incompatible status enums. Pick one (orchestration.js is already integrated), add the `blocked` status from runtime/tasks.js, and delete the other two. Ensure all task consumers (`TaskBoard`, `TaskList`, team state) use the same shape.

### 4. Consolidate to ONE agent definition system
`runtime/agents.js` and `orchestration.js` both define agents with different status enums. `teams/agents.js` is the only one with real content (built-in definitions, filesystem discovery). Merge the runtime AgentDefinition into teams/agents.js with a shared `AgentStatus` enum.

### 5. Make the dependency graph explicit in hub.js (remove soft requires)
Replace `_mod()` / `_requireSafe()` try/catch wrappers with explicit `require()` calls. If a subsystem is truly optional, document it and make it an explicit config flag, not a silent null. This makes the dependency graph statically analyzable and catches integration errors at startup rather than silently producing null pointers.

---

## Appendix: Dependency Graph (simplified)

```
                    ┌──────────────────────────────────┐
                    │            cli.js                │
                    │  (bin entry point, readline loop) │
                    └───┬──────────┬──────────┬────────┘
                        │          │          │
              ┌─────────▼──┐ ┌─────▼─────┐ ┌─▼──────────────┐
              │ commands/   │ │ session.js │ │ teams/(agents, │
              │ index.js    │ │ (state)    │ │  runtime,tools)│
              └──────┬──────┘ └─────┬──────┘ └────┬───────────┘
                     │              │              │
         ┌───────────┼──────────────┼──────────────┼───────────┐
         │           │              │              │           │
    ┌────▼────┐ ┌────▼────┐  ┌──────▼──────┐ ┌────▼────┐ ┌───▼────┐
    │agent-   │ │renderer │  │ providers/  │ │orchest- │ │hub.js  │
    │engine   │ │.js      │  │ (api adapt) │ │ration.js│ │(lazy   │
    │(core)   │ │         │  │             │ │         │ │wiring) │
    └────┬────┘ └─────────┘  └──────┬──────┘ └────┬────┘ └───┬────┘
         │                          │              │          │
    ┌────▼────┐                ┌────▼────┐    ┌────▼────┐     │
    │ tools/  │                │token-   │    │runtime/  │     │
    │(15+    │                │counter  │    │utils.js  │     │
    │ tools)  │                │.js      │    │(helpers) │     │
    └─────────┘                └─────────┘    └──────────┘     │
                                                               │
    ╔═══════════════════════════════════════════════════════════╧══╗
    ║                      DEAD CODE GRAVEYARD                     ║
    ║  53 directories, ~200 files, ~50K+ lines, zero integration   ║
    ║  scheduler/, workflow/, quota/, time/, tokens/, analytics/,  ║
    ║  artifact/, benchmark/, branches/, bridge/, ... (see list)   ║
    ╚══════════════════════════════════════════════════════════════╝
```
