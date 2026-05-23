# HaxAgent Architecture Review (R10)

**Date:** 2026-05-22  
**Scope:** All 454 source files under `E:/HaxAgent/src/`  
**Entry points traced:** `cli.js`, `index.js`, `agent-engine.js`, `desktop/main/index.js`, dynamic imports via `hub.js`  
**Methodology:** BFS dependency graph from all production entry points, capturing static `require()` and dynamic `_mod()` calls.

---

## 1. Module Inventory

### Summary

| Metric | Count |
|--------|-------|
| Total JS files in src/ | 454 |
| Production-reachable (CLI + desktop + hub dynamic) | 96 |
| Orphan files (never imported by any production path) | 358 |
| Directories under src/ | 96 |
| Directories fully orphaned (zero files reachable) | 88 |

### Complete Directory-by-Directory Census

#### FULLY REACHABLE DIRECTORIES (8)

| Directory | Files | Reachable | % Wired |
|-----------|-------|-----------|---------|
| commands/ | 5 | 5 | 100% |
| formatters/ | 2 | 2 | 100% |
| runtime/ | 8 | 8 | 100% |
| teams/ | 5 | 5 | 100% |
| tools/ | 16 | 16 | 100% |
| utils/ | 1 | 1 | 100% |

#### PARTIALLY REACHABLE DIRECTORIES (3)

| Directory | Files | Reachable | % Wired | Orphan Details |
|-----------|-------|-----------|---------|----------------|
| providers/ | 21 | 10 | 48% | aggregator, benchmark, comparator, cost-optimizer, diversity, fallback, load-balancer, router, streaming, synthesizer, token-counter |
| skills/ | 13 | 6 | 46% | chains, composer, metrics, package-skills, recommender, registry, templates |
| i18n/ | 8 | 5 | 63% | glossary, translator, zh-additions |

#### ROOT-LEVEL (src/) -- 38 files, 27 reachable, 11 orphan

| Status | Files |
|--------|-------|
| REACHABLE | agent-engine, batch, cli, command-suggestions, config, config-presets, context, context-compaction, context-window, config-validator (via hub), debug, export, file-context, goal-persistence, hub, index, init-wizard, memory, memory-eviction (via hub), orchestration, paste-utils, permissions, plugins, rate-limiter (via hub), renderer, session, session-summary, shutdown (via hub), tool-retry, undo-stack, updater |
| ORPHAN | desktop-services, plugin-validator, schema-validator, session-import, session-utils, tool-decorators, tool-result-formatter |

#### FULLY ORPHAN DIRECTORIES (88 directories, zero production-reachable files)

| Directory | Files | Category |
|-----------|-------|----------|
| analytics/ | 5 | Analytics / observability |
| artifact/ | 3 | Artifact distribution |
| benchmark/ | 3 | Benchmarking |
| branches/ | 3 | Branch management |
| bridge/ | 2 | Context bridging |
| cache/ | 2 | Caching |
| capability/ | 3 | Capability discovery |
| catalog/ | 2 | Code cataloging |
| ci/ | 3 | CI/CD |
| cli-utils/ | 3 | CLI utilities (progress, table, prompt) |
| codegen/ | 3 | Code generation |
| collab/ | 3 | Collaboration |
| compat/ | 3 | Compatibility layer |
| compliance/ | 3 | Compliance |
| config/ | 5 | Config subsystem (schema, interactive, migration, profiler, environment) |
| consolidation/ | 3 | Module consolidation |
| context/ | 3 | Context subsystem (injector, selector, templates) |
| contracts/ | 3 | Design-by-contract |
| conversation/ | 3 | Conversation utilities |
| coordination/ | 3 | Agent coordination |
| dashboard/ | 3 | Dashboard |
| data/ | 3 | Data management (backup, migration, serializer) |
| debate/ | 3 | Agent debate |
| deps/ | 2 | Dependency analysis |
| dev-tooling/ | 3 | Development tooling |
| diagram/ | 3 | Diagram generation |
| diff/ | 3 | Diff/merge |
| docs/ | 3 | Documentation browser |
| errors/ | 2 | Error enhancement/recovery |
| events/ | 3 | Event system |
| explain/ | 3 | Explainability |
| export/ (subdirs) | 5 | Export formats & pipeline |
| extraction/ | 2 | Code/knowledge extraction |
| files/ | 2 | File impact/prediction |
| format/ | 3 | Format/pretty/syntax |
| gateway/ | 3 | API gateway |
| generator/ | 5 | Code generation |
| goals/ | 3 | Goals subsystem |
| governance/ | 2 | Governance |
| graph/ | 3 | Graph engine |
| handoff/ | 3 | Agent handoff |
| health/ | 5 | Health monitoring |
| hotreload/ | 3 | Hot reload |
| hub/ (subdirs) | 3 | Hub catalog/discovery/rating |
| improvement/ | 3 | Self-improvement |
| injection/ | 3 | Injection detection |
| integrations/ | 3 | Cross-module integrations |
| intel/ | 3 | Codebase intelligence |
| isolate/ | 3 | Isolated execution |
| knowledge/ | 2 | Knowledge management |
| logs/ | 3 | Logging |
| marketplace/ | 2 | Plugin marketplace |
| memory/ (subdirs) | 6 | Memory subsystem (compressor, embedder, semantic-search, vector-store, optimizer, archiver) |
| migration/ | 3 | Migration engine |
| models/ | 2 | Model selection |
| multimodal/ | 3 | Multimodal rendering |
| nlp/ | 3 | NLP |
| notify/ | 5 | Notifications |
| observability/ | 3 | Observability |
| optimizer/ | 3 | Context/token optimization |
| ownership/ | 3 | Code ownership |
| palette/ | 3 | Color palette |
| patches/ | 4 | Runtime patches |
| patterns/ | 2 | Pattern matching |
| personality/ | 3 | Agent personality |
| planner/ | 3 | Planning |
| platform/ | 3 | Platform detection |
| plugins/ (subdirs) | 5 | Plugin subsystem (dependency, hotswap, indexer, isolate, repository) |
| prediction/ | 2 | Prediction |
| preserve/ | 3 | Context preservation |
| prompts/ | 7 | Prompt engineering |
| protocol/ | 2 | Protocol |
| pruning/ | 2 | Context pruning |
| quality/ | 3 | Code quality |
| quota/ | 3 | Quota management |
| rbac/ | 3 | Role-based access |
| recorder/ | 3 | Session recorder |
| regression/ | 3 | Regression testing |
| reinforcement/ | 3 | Reinforcement learning |
| replay/ | 2 | Session replay |
| resilience/ | 3 | Resilience patterns (circuit-breaker, bulkhead, retry) |
| resources/ | 2 | Resource management |
| review/ | 2 | Code review |
| safety/ | 5 | Safety/security |
| sandbox/ | 3 | Code sandboxing |
| scheduler/ | 3 | Job scheduling |
| search/ | 5 | Code search |
| security/ | 3 | Security (input sanitizer, audit log, content policy) |
| semver/ | 3 | Semver |
| shared/ | 4 | Shared utilities |
| sim/ | 3 | Simulation |
| similarity/ | 2 | Similarity detection |
| state/ | 5 | Agent state machines |
| strategy/ | 3 | Strategy library |
| streaming/ | 2 | Streaming adapter |
| synthesis/ | 2 | Synthesis |
| tasks/ | 2 | Task management |
| testing/ | 2 | Self-testing |
| time/ | 3 | Time/tracking |
| tokens/ | 7 | Token management |
| training/ | 3 | Training data |
| trust/ | 3 | Trust/reputation |
| tutorial/ | 3 | Tutorial engine |
| versioning/ | 3 | Versioning |
| visualize/ | 2 | Visualization |
| watcher/ | 3 | File watcher |
| workflow/ | 7 | Workflow DSL |
| workspace/ | 3 | Workspace management |

---

## 2. Orphan Classification

### Category: TOOL (protocol-adjacent, enhances core tool execution)

| Module | File | What it does | Suggested Integration |
|--------|------|-------------|----------------------|
| tool-decorators | `src/tool-decorators.js` | withTimeout, withValidation, withRateLimit, withCache, withMetrics decorators | Wire into `tools/registry.js` wrapTool() or createLocalToolRegistry(); composes with `tool-retry.js` |
| tool-result-formatter | `src/tool-result-formatter.js` | Human-friendly formatting of tool outputs, truncation, duration display | Wire into CLI rendering pipeline in `cli.js` or `renderer.js` for tool result display |
| tools/error-codes (used) | Already reachable via errors/ | Provides TOOL_TIMEOUT etc. used by tool-decorators | Already wired; tool-decorators already imports this |
| plugin-validator | `src/plugin-validator.js` | Validates plugin module shape, schema, hooks | Already imported by plugins/indexer, plugins/hotswap, marketplace/curation; only orphan because its importers are orphaned. Wire marketplace/ or plugins/ into init sequence. |
| schema-validator | `src/schema-validator.js` | JSON Schema validation for tool input | Wire into `tools/registry.js` as optional validation layer before tool dispatch |
| rate-limiter (wired via hub) | `src/rate-limiter.js` | Rate limits on API-billed operations | Already reachable via hub.js dynamic import; used at agent creation time |

### Category: UTILITY (general-purpose helpers, no side effects)

| Module | File | What it does | Suggested Integration |
|--------|------|-------------|----------------------|
| session-import | `src/session-import.js` | Import sessions from external formats | Wire into `commands/index.js` as /session import subcommand |
| session-utils | `src/session-utils.js` | Session diff, search, stats utilities | Wire into `session-summary.js` or `commands/index.js` for enhanced /sessions output |
| cli-utils/progress | `src/cli-utils/progress.js` | CLI progress bars | Wire into `cli.js` for long-running operations (init, batch, update) |
| cli-utils/prompt | `src/cli-utils/prompt.js` | Structured CLI prompts (confirm, select, input) | Wire into `init-wizard.js` or `cli.js` interactive flows |
| cli-utils/table | `src/cli-utils/table.js` | ASCII table rendering | Wire into `commands/index.js` for listing commands (models, sessions, agents) |
| format/pretty | `src/format/pretty.js` | Pretty-print JSON/objects | Wire into `renderer.js` for structured output display |
| format/syntax | `src/format/syntax.js` | Syntax highlighting | Already used by multimodal/renderer; accessible if renderer is wired into CLI |
| shared/ (all 4 files) | `src/shared/` | deepClone, hash (sha256, md5), validation, index | Import from `runtime/utils.js` or core utilities; they provide reusable primitives |
| platform/ (all 3 files) | `src/platform/` | OS detection, env, paths | Wire into `config.js` for platform-aware defaults |
| compat/ (all 3 files) | `src/compat/` | Adapter pattern, deprecation warnings, polyfills | Use in `providers/factory.js` to wrap legacy providers |
| errors/enhancer | `src/errors/enhancer.js` | Enhances errors with context, suggestions | Wire into agent-engine error handling or tools/error.js |
| errors/recovery | `src/errors/recovery.js` | Automatic error recovery strategies | Wire into agent-engine.js provider turn loop |
| security/ (all 3 files) | `src/security/` | Input sanitizer, audit log, content policy | Wire into tools/shell.js, tools/file-*.js for input validation; audit-log for CLI |
| inject/ (all 3 files) | `src/injection/` | Prompt injection detector, monitor, sanitizer | Wire into session.js or agent-engine.js before sending messages to provider |
| events/ (all 3 files) | `src/events/` | EventBus, middleware, event types | Wire into agent-engine.js as alternative to generator-based events; or into plugin system |
| data/ (all 3 files) | `src/data/` | Serializer, backup, migration | Wire into memory.js for data persistence; backup/migration into session management |
| resilience/ (all 3 files) | `src/resilience/` | Circuit breaker, bulkhead, retry | Wire into providers/ for API call resilience; overlaps with tool-retry.js for retry logic |
| config/schema | `src/config/schema.js` | Config schema definition and validation | Wire into config.js as the canonical schema source |
| config/interactive | `src/config/interactive.js` | Interactive config editing | Wire into cli.js `runConfigCommand()` |
| config/migration | `src/config/migration.js` | Config version migration | Wire into config.js `loadSettings()` |
| config/profiler | `src/config/profiler.js` | Settings profiling | Wire into hub.js or debug.js for diagnostics |
| config/environment | `src/config/environment.js` | Env-var to config mapping | Wire into config.js `loadSettings()` |
| memory/archiver | `src/memory/archiver.js` | Compress old sessions | Wire into memory-eviction.js or memory.js |
| memory/compressor | `src/memory/compressor.js` | Memory compression | Wire into memory-eviction.js |
| memory/embedder | `src/memory/embedder.js` | Text embedding | Wire into memory/semantic-search.js |
| memory/semantic-search | `src/memory/semantic-search.js` | Semantic memory search | Wire into memory.js as enhanced search over basic listMemories |
| memory/vector-store | `src/memory/vector-store.js` | Vector storage | Already imported by semantic-search |
| memory/optimizer | `src/memory/optimizer.js` | Memory optimization | Wire into memory-eviction.js |

### Category: FEATURE (complete subsystem, ready to wire)

| Module | File | What it does | Suggested Integration |
|--------|------|-------------|----------------------|
| marketplace/ | `src/marketplace/index.js` | Plugin marketplace (install, publish, search) | Wire as CLI command /marketplace in cli.js |
| desktop-services | `src/desktop-services.js` | Desktop-specific IPC services | Already reachable from desktop/main/index.js; OK as-is |
| docs/ | `src/docs/` | In-app documentation browser | Wire as CLI command /docs or --help enhanced |
| export/ (subdir) | `src/export/` | Multi-format export (blog, html, notebook, pipeline, postprocess) | Wire into export.js; currently export.js only does markdown/json/text |
| dashboard/ | `src/dashboard/` | Runtime dashboard (collector, renderer, reports) | Wire as /dashboard slash command |
| observability/ | `src/observability/` | Metrics, tracer, logger | Wire into agent-engine.js lifecycle events |
| health/ | `src/health/` | Health monitoring, debt tracker, scorer, recommendations | Wire into hub.js agent lifecycle or /doctor command |
| sandbox/ | `src/sandbox/` | Code sandboxing (vm-sandbox, executor, policy) | Wire into tools/shell.js for safe shell execution |
| scheduler/ | `src/scheduler/` | Cron, queue, worker | Wire as background service in hub.js for scheduled tasks |
| search/ | `src/search/` | Code search (ast-grep, index-builder, query-parser, ranking, results-formatter) | Wire as tool or /search command |
| workflow/ | `src/workflow/` | Workflow DSL, engine, library, templates, validator, linter, scheduler | Wire as /workflow command or agent orchestration backend |
| graph/ | `src/graph/` | Graph query engine | Wire into planning/orchestration decisions |
| recorder/ | `src/recorder/` | Session recording (capture, playback, fixture-gen) | Wire into session.js as debug/playback mode |
| replay/ | `src/replay/` | Session replay with diff analysis | Wire as /replay command |
| notify/ | `src/notify/` | Notification system (channels, rules, triggers, aggregator, manager) | Wire into hub.js or cli.js for async notifications |
| tokens/ | `src/tokens/` | Token budgeting, cost tracking, monitoring, reporting, strategies, visualization | Wire into session.js CostTracker or as /tokens command |
| collaboration/ | `src/collab/` | Consensus, knowledge-base, messaging | Wire into teams/ for multi-agent coordination |
| coordination/ | `src/coordination/` | Dispatcher, heartbeat, leader election | Wire into teams/runtime.js for agent team coordination |
| handoff/ | `src/handoff/` | Agent handoff protocol, briefing, escalation | Wire into teams/runtime.js agent lifecycle |
| debate/ | `src/debate/` | Agent debate engine with scoring | Wire into teams/planner.js for multi-agent deliberation |
| personality/ | `src/personality/` | Behavior modifiers, profiles, response styles | Wire into agent-engine.js buildTurnSystemPrompt |
| prompts/ (subdir) | `src/prompts/` | A/B testing, builder, evolution, optimizer, roles, templates, versioning | Wire into context.js or agent-engine.js buildTurnSystemPrompt |
| state/ | `src/state/` | FSM, agent lifecycle, rehydration, snapshot, team coordinator | Wire into teams/runtime.js for team state management |
| planning/ | `src/planner/` | Task decomposer, estimator, progress tracker | Wire into teams/planner.js |
| goals/ | `src/goals/` | History, templates, tracker | Wire into goal-persistence.js |
| tasks/ | `src/tasks/` | Task resolver, tracker | Wire into teams/runtime.js |
| strategy/ | `src/strategy/` | Strategy engine, library, registry | Wire into teams/planner.js for strategy selection |
| integration/ | `src/integrations/` | Bridge modules connecting health/task/model subsystems | Wire into hub.js createAgent() as optional modules |
| similarity/ | `src/similarity/` | Code similarity detector, fingerprint | Wire as /similarity command or for reuse-check in tools |
| diag/ | `src/diagram/` | ASCII charts, Mermaid, SVG generation | Wire into renderer.js for visual output |
| intel/ | `src/intel/` | Codebase analyzer, context builder, dependency analyzer | Wire into file-context.js for enhanced context |
| quality/ | `src/quality/` | Auto-fix, quality gates, reporter | Wire into tool execution pipeline as post-execution quality check |
| review/ | `src/review/` | Code review engine, formatter | Wire as /review command or into agent response pipeline |
| extraction/ | `src/extraction/` | Code extractor, knowledge extractor | Wire into context.js for knowledge extraction from conversations |
| generator/ | `src/generator/` | Project skeleton generation, file templates | Wire as /generate or `hax-agent init` enhancement |
| codegen/ | `src/codegen/` | Function extraction, import manager, refactoring | Wire into tools/file-edit.js |
| nlp/ | `src/nlp/` | Command builder, entity extractor, intent detector | Wire into command-suggestions.js or skills/intent-matcher.js |
| prediction/ | `src/prediction/` | Early warning, error predictor | Wire into agent-engine.js for proactive error prevention |
| regression/ | `src/regression/` | Regression detection, alerting, root cause analysis | Wire into testing/ as self-test framework |
| reinforce/ | `src/reinforcement/` | Explorer, policy, rewards | Experimental ML feature; keep orphan or wire as opt-in plugin |
| training/ | `src/training/` | Training data augmenter, extractor, formatter | Keep orphan; data pipeline, separate entry point |
| sim/ | `src/sim/` | Simulation engine, metrics, scenarios | Keep orphan; development/testing tool |
| tutorial/ | `src/tutorial/` | Interactive tutorials | Wire as /tutorial command |
| trust/ | `src/trust/` | Delegation, reliability, reputation scoring | Wire into teams/runtime.js for agent trust scoring |
| ownership/ | `src/ownership/` | Code blame, insights, tracker | Wire as /blame command |
| workspace/ | `src/workspace/` | Workspace management, monorepo support | Wire into config.js for multi-root workspaces |
| time/ | `src/time/` | Time analytics, estimator, scheduler | Wire into scheduler/cron.js or as standalone |

### Category: INFRASTRUCTURE (build, development, testing, migration)

| Module | File | What it does | Suggested Integration |
|--------|------|-------------|----------------------|
| benchmark/ | `src/benchmark/` | Benchmark runner, scenarios, reporter | Keep orphan; dev tooling, invoked standalone |
| dev-tooling/ | `src/dev-tooling/` | Project init, scaffold, validator | Keep as devtools; used during development |
| testing/ | `src/testing/` | Self-test, smoke test | Wire into CI or keep standalone |
| migration/ | `src/migration/` | Project migration engine, transforms, validator | Wire as /migrate command |
| consolidation/ | `src/consolidation/` | Module analyzer, migration guide, report | Use during refactoring; keep as dev tooling |
| catalog/ | `src/catalog/` | Codebase scanner, reporter | Wire into docs/search.js or dev-tooling |
| deps/ | `src/deps/` | Dependency analyzer, visualizer | Keep as dev tooling |
| patches/ | `src/patches/` | Runtime monkey patches | Wire into startup in hub.js or cli.js |
| ci/ | `src/ci/` | CI cache, pipeline, triggers | Keep as CI tooling |
| compliance/ | `src/compliance/` | Policy drift detector, reports | Wire for enterprise use cases |
| governance/ | `src/governance/` | Policy engine, auditor | Wire for enterprise use cases |
| explain/ | `src/explain/` | Counterfactual, tracer, report | Wire into agent response for explainability |
| artifact/ | `src/artifact/` | Build artifacts (distribution, manager, release) | Keep as CI/build tooling |
| branches/ | `src/branches/` | Branch comparison, manager, merge | Keep as git tooling |
| protocol/ | `src/protocol/` | Protocol compressor, router | Wire into providers/streaming.js or providers/router.js |
| hotreload/ | `src/hotreload/` | Hot reload watcher, applier, notifier | Wire into hub.js for plugin hot reload |
| versioning/ | `src/versioning/` | Semver, lockfile, upgrade | Wire into updater.js |
| watcher/ | `src/watcher/` | File system watcher, change log | Wire into file-context.js for live file monitoring |
| cache/ | `src/cache/` | Cache manager, preloader | Wire into providers/ for response caching |
| gateway/ | `src/gateway/` | API gateway (cache, rate-limiter, request-pipeline) | Wire into providers/router.js for API routing |
| optimizer/ | `src/optimizer/` | Context scheduler, template engine, token optimizer | Wire into context-window.js for advanced optimization |
| preserve/ | `src/preserve/` | Context importance scorer, restorer, summarizer | Wire into context-compaction.js |
| pruning/ | `src/pruning/` | Context pruning evaluator, strategies | Wire into context-compaction.js |

---

## 3. Overlap Report: Competing Implementations

### HIGH-PRIORITY OVERLAPS (same concern, multiple implementations, one wired, one or more unwired)

| Concern | Wired Implementation | Orphan Implementation(s) | Recommendation |
|---------|---------------------|--------------------------|----------------|
| **Rate Limiting** | `src/rate-limiter.js` (via hub) | `src/gateway/rate-limiter.js` | Merge into single rate-limiter module; gateway version adds HTTP-level limiting. Keep one. |
| **Retry Logic** | `src/tool-retry.js` (createRetryableTool) | `src/resilience/retry.js` | Consolidate: tool-retry.js handles tool-level retry; resilience/retry.js is more general. Wire resilience/retry as base, tool-retry as tool-specific wrapper. |
| **Tool Decoration** | `src/tool-retry.js` (retry only) | `src/tool-decorators.js` (timeout, validation, rate-limit, cache, metrics) | tool-decorators is a superset. Wire tool-decorators into tool registry, have tool-retry compose with it. |
| **Config Validation** | `src/config-validator.js` (via hub) | `src/config/schema.js` + `src/config/profiler.js` | config/schema is more detailed. Have config-validator delegate to config/schema for detailed validation. |
| **Schema Validation** | `src/tools/error.js` (basic) | `src/schema-validator.js` (JSON Schema) | Wire schema-validator into tools/registry for input validation before dispatch. |
| **Memory Management** | `src/memory.js` (basic storage) | `src/memory/` (6 files: archiver, compressor, embedder, semantic-search, vector-store, optimizer) | memory.js is the basic layer. Wire memory/ modules as advanced features behind config flags. |
| **Context Compaction** | `src/context-compaction.js` | `src/preserve/` (3 files), `src/pruning/` (2 files) | preserve/ provides scoring logic that compaction.js needs. pruning/ provides strategies. Wire them together. |
| **Context Building** | `src/context.js` + `src/file-context.js` | `src/context/` (3 files: injector, selector, templates) | context/ subdir provides reusable components. Wire into context.js. |
| **Conversation Summarization** | `src/session-summary.js` | `src/conversation/` (3 files: chunker, diff, summarizer) | conversation/summarizer provides lower-level operations. Wire into session-summary.js. |
| **Plugin System** | `src/plugins.js` (core) | `src/plugins/` (5 files: dependency, hotswap, indexer, isolate, repository) | plugins/ extends the core. Wire indexer and repository into plugin discovery; hotswap for dev mode. |
| **Permissions/RBAC** | `src/permissions.js` | `src/rbac/` (3 files: permissions, policy, roles) | rbac/ provides a richer role model. Wire rbac into permissions.js as advanced mode. |
| **Safety/Security** | Basic tool validation | `src/safety/` (5 files), `src/security/` (3 files), `src/injection/` (3 files) | Three competing safety layers. Consolidate: security/ for input validation, safety/ for output scanning, injection/ for prompt-level security. Wire ALL into the request pipeline. |
| **File Watching** | None wired | `src/watcher/` (3 files), `src/hotreload/` (3 files) | watcher/ monitors filesystem; hotreload/ applies changes. Wire watcher into file-context.js refresh; hotreload for plugin dev. |
| **Agent State** | Basic session/memory | `src/state/` (5 files: FSM, lifecycle, rehydration, snapshot, team-coordinator) | Wire state/ into teams/runtime.js for proper agent lifecycle management. |
| **Prompt Management** | Hardcoded in agent-engine | `src/prompts/` (7 files: ab-test, builder, evolution, optimizer, roles, templates, versioning) | Wire prompts/builder and prompts/templates into agent-engine.js buildTurnSystemPrompt. A/B testing and evolution as dev tools. |
| **Token Tracking** | `src/session.js` CostTracker (basic) | `src/tokens/` (7 files: budget, cost-tracker, monitor, planner, report, strategies, visualizer) | tokens/ is a richer implementation. Wire cost-tracker and budget into session.js; monitor/report/visualizer as CLI display options. |
| **Export** | `src/export.js` (md, json, text) | `src/export/` (5 files: pipeline, postprocess, formats/blog, formats/html, formats/notebook) | Wire export/ pipeline into export.js for multi-format support. |
| **Logging** | `src/debug.js` (basic) | `src/logs/` (3 files), `src/observability/` (3 files) | Wire logs/ for file-based logging; observability/ for structured metrics/tracing. |
| **Code Generation** | None wired | `src/generator/` (5 files), `src/codegen/` (3 files) | generator/ is project-level; codegen/ is function-level. Wire both as skills or tools. |
| **Model Selection** | Hardcoded in providers | `src/models/` (2 files: matrix, selector) | Wire model/selector into providers/router.js for intelligent model routing. |
| **Resource Management** | None wired | `src/resources/` (2 files: planner, pool), `src/quota/` (3 files) | Wire into hub.js for multi-tenant/team resource allocation. |
| **Diff/Patch** | Basic in tools | `src/diff/` (3 files: merge-engine, patch, semantic-diff), `src/similarity/` (2 files) | Wire diff/semantic-diff into file-edit tool for smarter merges. |
| **Sandbox** | None (shell tools run natively) | `src/sandbox/` (3 files), `src/isolate/` (3 files) | Wire sandbox/executor into tools/shell.js for safe execution mode. |
| **Streaming** | `src/providers/streaming.js` (orphan) | Per-provider stream() methods | Wire providers/streaming.js as shared streaming adapter for all providers. |
| **Provider Fallback/Load-Balance** | None wired | `src/providers/fallback.js`, `src/providers/load-balancer.js`, `src/providers/router.js`, `src/providers/aggregator.js` | Wire providers/router.js and fallback.js into providers/factory.js for multi-provider resilience. |
| **Cost Optimization** | None wired | `src/providers/cost-optimizer.js`, `src/providers/comparator.js`, `src/providers/benchmark.js`, `src/providers/diversity.js` | Wire cost-optimizer into model selection for cost-aware routing. |
| **Skills Enhancement** | `src/skills/` (6/13 wired) | chains, composer, metrics, recommender, registry, templates, package-skills | Wire skills/registry as centralized skill registry; composer for chained skills; recommender for command suggestions. |

---

## 4. Integration Points: Wiring Plan

### Phase 1: CRITICAL (affects stability/security/performance of production paths)

| Priority | Module | Wire To | Rationale |
|----------|--------|---------|-----------|
| P0 | `src/security/input-sanitizer.js` | `tools/shell.js`, `tools/file-edit.js`, `tools/file-write.js` | All shell and file tools must sanitize inputs to prevent injection |
| P0 | `src/injection/` (detector, monitor, sanitizer) | `agent-engine.js` before provider stream | Block prompt injection before messages reach the LLM |
| P0 | `src/schema-validator.js` | `tools/registry.js` dispatch | Validate tool inputs against their declared schema before execution |
| P0 | `src/tool-decorators.js` | `tools/registry.js` createLocalToolRegistry | Compose timeout + validation decorators around all tool execution |
| P1 | `src/errors/recovery.js` | `agent-engine.js` _runProviderTurn | Auto-recover from common provider errors (rate limits, timeouts) |
| P1 | `src/providers/fallback.js` + `router.js` | `providers/factory.js` createProvider | Multi-provider fallback chain for resilience |
| P1 | `src/sandbox/executor.js` | `tools/shell.js` executeShell | Configurable sandboxed execution for shell commands |

### Phase 2: FEATURE (completes existing features)

| Priority | Module | Wire To | Rationale |
|----------|--------|---------|-----------|
| P2 | `src/export/` (pipeline + formats) | `src/export.js` | Full multi-format export support |
| P2 | `src/cli-utils/` (progress, prompt, table) | `src/cli.js` | Better CLI UX during long operations |
| P2 | `src/memory/` (archiver, semantic-search) | `src/memory.js` + `src/memory-eviction.js` | Advanced memory management |
| P2 | `src/prompts/` (builder, templates, roles) | `agent-engine.js` buildTurnSystemPrompt | Dynamic, configurable prompt construction |
| P2 | `src/tokens/` (budget, cost-tracker) | `session.js` CostTracker | Accurate token budgeting and cost prediction |
| P2 | `src/plugins/` (indexer, repository, hotswap) | `plugins.js` + `hub.js` | Plugin discovery, marketplace support, dev hot reload |
| P2 | `src/observability/` (metrics, tracer, logger) | `agent-engine.js` | Structured observability for debugging |
| P3 | `src/workflow/` (engine, DSL) | CLI as /workflow command | Workflow orchestration |
| P3 | `src/state/` (FSM, lifecycle) | `teams/runtime.js` | Proper team agent lifecycle management |
| P3 | `src/notify/` (channels, rules) | `hub.js` or `cli.js` | Async notification system |
| P3 | `src/search/` (ast-grep, ranking) | CLI as /search command | In-app code search |
| P3 | `src/marketplace/index.js` | CLI as /marketplace command | Plugin marketplace |

### Phase 3: INFRASTRUCTURE (development, diagnostics, enterprise)

| Priority | Module | Wire To | Rationale |
|----------|--------|---------|-----------|
| P4 | `src/health/` (monitor, scorer) | `hub.js` or /health command | System health diagnostics |
| P4 | `src/scheduler/` (cron, queue) | `hub.js` background service | Scheduled task execution |
| P4 | `src/benchmark/`, `src/testing/` | Standalone scripts | Keep as dev tooling |
| P4 | `src/docs/` (browser, search) | CLI /docs command | In-app documentation |
| P4 | `src/generator/`, `src/codegen/` | /generate command or tools | Code generation features |
| P5 | `src/dashboard/`, `src/visualize/` | Optional UI | TUI dashboard for monitoring |
| P5 | `src/tutorial/` | /tutorial command | Interactive tutorials |
| P5 | `src/compliance/`, `src/governance/` | Enterprise config flag | Enterprise governance features |

---

## 5. Module Cohesion: Which Modules Belong Together

### Cohesion Clusters (tightly coupled modules that should stay together)

| Cluster Name | Modules | Rationale |
|-------------|---------|-----------|
| **Safety Pipeline** | `security/`, `injection/`, `safety/` | Input sanitization + prompt injection detection + output content policy form a complete safety pipeline |
| **Provider Resilience** | `providers/fallback`, `providers/router`, `providers/load-balancer`, `resilience/`, `gateway/` | Provider resilience layer: routing, fallback, circuit breaking, gateway |
| **Memory Stack** | `memory.js`, `memory-eviction.js`, `memory/archiver`, `memory/compressor`, `memory/embedder`, `memory/semantic-search`, `memory/vector-store`, `memory/optimizer` | Complete memory subsystem: basic storage -> eviction -> compression -> semantic search |
| **Context Pipeline** | `context.js`, `context-window.js`, `context-compaction.js`, `context/injector`, `context/selector`, `context/templates`, `preserve/`, `pruning/` | Context construction, selection, injection, compaction, preservation, pruning |
| **Tool Execution Stack** | `tools/registry.js`, `tool-retry.js`, `tool-decorators.js`, `tool-result-formatter.js`, `schema-validator.js`, `tools/error.js`, `tools/error-codes.js`, `errors/` | Complete tool lifecycle: registry -> validation -> decoration -> execution -> retry -> error -> formatting |
| **Agent Runtime** | `runtime/`, `teams/`, `state/`, `coordination/`, `handoff/`, `planner/`, `tasks/` | Multi-agent orchestration: runtime -> teams -> state -> coordination -> planning -> tasks |
| **Plugin Ecosystem** | `plugins.js`, `plugins/`, `plugin-validator.js`, `marketplace/` | Plugin management: core -> indexing -> validation -> isolation -> hotswap -> marketplace |
| **Prompt Engineering** | `prompts/`, `personality/` | Prompt construction, A/B testing, versioning, roles, behavior |
| **Observability Stack** | `observability/`, `logs/`, `analytics/`, `dashboard/`, `health/` | Metrics, tracing, logging, analytics, health monitoring |
| **Export Pipeline** | `export.js`, `export/pipeline`, `export/postprocess`, `export/formats/` | Session export: core -> pipeline -> post-processing -> format-specific rendering |
| **Optimizer Stack** | `optimizer/`, `tokens/`, `quota/`, `rate-limiter.js` | Resource optimization: token optimization + budgeting + quota + rate limiting |
| **Platform Layer** | `platform/`, `config/`, `compat/`, `versioning/` | Cross-platform abstractions: detection + config + compatibility + versioning |

---

## 6. Architecture Score: 31/100

### Scoring Breakdown

| Dimension | Score | Max | Notes |
|-----------|-------|-----|-------|
| **Wiring Completeness** | 8 | 25 | Only 96/454 files (21%) connected to production paths. 79% of codebase is dead code from the production perspective. |
| **Module Cohesion** | 6 | 20 | Related modules are spread across directories (e.g., safety has 3 competing implementations in security/, safety/, injection/). Good module grouping exists but no wiring. |
| **Dependency Hygiene** | 4 | 15 | hub.js uses dynamic require() for lazy loading, which is good, but most modules have no integration plan. `desktop-services.js` is imported only by desktop/main -- correct. |
| **Overlap Management** | 3 | 15 | 28+ overlapping concerns identified. Multiple rate limiters, retry implementations, validation layers, memory subsystems all competing. |
| **Entry Point Clarity** | 9 | 15 | Clear entry points: cli.js (CLI), index.js (library), desktop/main/index.js (Electron). hub.js acts as dependency injection container. Good layering. |
| **Test Coverage Alignment** | 1 | 10 | Test files exist for both wired and orphan modules, but orphan modules' tests test code that never runs in production. Wasted CI time. |
| **TOTAL** | **31** | **100** | Critical structural debt. Massive dead-code volume (79%) needs wiring or deletion. |

---

## 7. Top 5 Architecture Fixes

### Fix #1: Wire Safety Pipeline Into Production (P0, Security)
**Problem:** Zero of 11 safety/security/injection modules are connected to the production request pipeline. Shell commands, file operations, and LLM prompts execute without input sanitization, injection detection, or output content scanning.
**Action:**
- Wire `security/input-sanitizer.js` into `tools/shell.js`, `tools/file-edit.js`, `tools/file-write.js` as pre-execution guard
- Wire `injection/detector.js` and `injection/monitor.js` into `agent-engine.js` _runProviderTurn() before sending messages to provider
- Wire `safety/scanner.js` and `safety/rules-engine.js` into agent-engine.js for output content policy enforcement
**Impact:** Eliminates critical security gap in every production request.

### Fix #2: Complete Tool Execution Stack (P0, Reliability)
**Problem:** `tool-decorators.js` (timeout, validation, rate-limit, cache, metrics) and `schema-validator.js` (JSON Schema input validation) are orphaned. Tools execute without timeout guards, input validation, or caching. `tool-retry.js` is wired but only provides retry -- decorators compose with it.
**Action:**
- Import `tool-decorators.js` into `tools/registry.js` `createLocalToolRegistry()`
- Compose decorators: `withTimeout(30000, withValidation(schema, withRateLimit(rl, withCache(cache, fn))))` around each tool's execute function
- Import `schema-validator.js` into `tools/registry.js` to validate tool args against declared schemas before dispatch
**Impact:** All tool execution gets timeout protection, input validation, and structured error handling.

### Fix #3: Wire Provider Resilience Layer (P1, Reliability)
**Problem:** `providers/router.js`, `providers/fallback.js`, and `providers/load-balancer.js` are orphaned. When a provider fails (rate limit, network error), the session dies. No multi-provider fallback exists despite having Anthropic, OpenAI, and Google providers.
**Action:**
- Wire `providers/fallback.js` into `providers/factory.js` `createProvider()` to create a chained provider with fallback order
- Wire `resilience/circuit-breaker.js` into the provider stream pipeline in `agent-engine.js`
- Wire `providers/streaming.js` as shared streaming adapter used by all providers instead of per-provider stream() methods
**Impact:** Automatic provider failover. Session survives individual provider outages.

### Fix #4: Consolidate Competing Implementations & Wire Memory Stack (P1, Waste)
**Problem:** 28+ overlapping concerns with competing implementations. Top offender: two rate limiters (`rate-limiter.js` wired via hub, `gateway/rate-limiter.js` orphan), three safety layers, two retry implementations, two schema validators. Memory subsystem has 6 orphan files that 3x what `memory.js` provides.
**Action:**
- Merge `gateway/rate-limiter.js` into `rate-limiter.js` (one canonical rate limiter)
- Merge `resilience/retry.js` into `tool-retry.js` (one retry implementation, with resilience retry as base class)
- Wire `memory/archiver.js`, `memory/compressor.js`, and `memory/semantic-search.js` into `memory.js` behind config flags
- Wire `preserve/importance.js` and `pruning/strategies.js` into `context-compaction.js`
**Impact:** Removes code duplication, reduces maintenance burden, completes feature-implementations.

### Fix #5: Wire Plugin Ecosystem (P2, Feature Completeness)
**Problem:** `plugins/indexer.js` (scans and indexes plugins), `plugins/repository.js` (plugin registry store), `plugins/hotswap.js` (live reload), `plugin-validator.js` (schema validation), and `marketplace/index.js` (install/publish/search) are all orphaned. The plugin system has a sophisticated ecosystem ready but disconnected.
**Action:**
- Wire `plugins/indexer.js` into `plugins.js` PluginRegistry.loadPluginsFromDirectory()
- Wire `plugin-validator.js` into `plugins.js` registration path (validate before register)
- Wire `plugins/hotswap.js` into `hub.js` for dev mode hot reload
- Wire `marketplace/index.js` as /marketplace CLI command
- Wire `plugins/isolate.js` for plugin sandboxing in production
**Impact:** Full plugin ecosystem: discovery, validation, installation, hot reload, marketplace.

---

## Appendix A: Dynamic Import Paths (hub.js)

The `hub.js` module uses a lazy-loading pattern via `_mod()` to avoid loading 454 modules at import time. These are the modules it dynamically imports:

```
_requireSafe('./config-validator')   -- config-validator.js (root)
_requireSafe('./plugins')             -- plugins.js (root)
_requireSafe('./undo-stack')          -- undo-stack.js (root)
_requireSafe('./rate-limiter')        -- rate-limiter.js (root)
_requireSafe('./tools/registry')      -- tools/registry.js
_requireSafe('./tool-retry')          -- tool-retry.js (root)
_requireSafe('./session')             -- session.js (root)
_requireSafe('./agent-engine')        -- agent-engine.js (root)
_requireSafe('./memory-eviction')    -- memory-eviction.js (root)
_requireSafe('./goal-persistence')    -- goal-persistence.js (root)
_requireSafe('./shutdown')            -- shutdown.js (root)
_requireSafe('./context-compaction')  -- context-compaction.js (root)
```

This is a good pattern. Extend it to also lazy-load: `schema-validator`, `tool-decorators`, `injection/detector`, `security/input-sanitizer`, `errors/recovery`, `providers/fallback`.

---

## Appendix B: Entry Point Dependency Quick Reference

### cli.js imports from:
providers, config, commands, commands/autocomplete, command-suggestions, tools, undo-stack, plugins, batch, teams/tools, config-presets, skills, permissions, session, renderer, updater, init-wizard, debug, i18n, paste-utils, memory, teams/agents, formatters/agent-teams, teams/auth-refactor, formatters/team-plan

### index.js imports from:
config, context, file-context, memory, orchestration, runtime, teams/*, formatters/*, undo-stack, plugins, batch, export, tool-retry, goal-persistence, context-compaction, config-presets, session-summary, hub

### agent-engine.js imports from:
memory, context-window, file-context, debug, skills/intent-matcher, skills, utils/serialization

### desktop/main/index.js imports from:
agent-engine, config, permissions, providers, session, teams/tools, utils/serialization, tools, desktop-services

---

*Review completed. Architecture score: 31/100. 358 orphan modules (79% dead code). 28+ overlapping concerns. Five critical wiring paths identified.*
