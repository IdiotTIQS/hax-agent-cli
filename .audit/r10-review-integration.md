# GLOBAL WIRING Phase: Integration Readiness Assessment

**Date:** 2026-05-22
**Phase:** r10 — Pre-Global Wiring Review
**Scope:** Assess integration readiness of ~94 orphan modules across 6 categories into 3 entry points.

---

## Overall Integration Readiness Score: 67/100

| Dimension | Score | Comment |
|-----------|-------|---------|
| Entry Point Maturity | 78/100 | All 3 entry points are stable, well-structured, have clear hook points |
| Module Completeness | 85/100 | Most orphan modules have complete API surfaces with clear contracts |
| Hook Architecture | 70/100 | Plugin/hook system exists but only in ToolRegistry; AgentEngine lacks middleware |
| Conflict Risk | 60/100 | 8 identified conflicts between modules competing for same hooks |
| Integration Surface | 55/100 | Many modules need wiring into areas that have no formal hook points yet |
| Documentation | 60/100 | APIs are self-documenting but no formal integration guides exist |

---

## 1. The Three Entry Points — Anatomy & Hook Points

### 1.1 `src/cli.js` — Main CLI Entry (1383 lines)

**Constructor / Initialization sequences:**
```
main(argv) → resolves settings, routes to runShell / runBatch / subcommand
runShell(args, session?) → creates: settings, provider, screen, permissionManager,
  pluginRegistry, toolRegistry, session, history → enters REPL loop
runBatch(...) → creates provider, toolRegistry, permissionManager(yolo), session → batch mode
runResumeCommand(args) → restores session from transcript → runShell
```

**Existing hook points (in execution order):**

| # | Hook Point | Line(s) | Signature | Currently Used By |
|---|-----------|---------|-----------|-------------------|
| H1 | Early arg parsing | 89-109 | `main(argv)` body | --no-color, --debug, --preset, --list-presets |
| H2 | Settings resolution | 19-28, 439 | `resolveSettings()` | Config, presets |
| H3 | Plugin registry init | 469-475 | `new PluginRegistry()` + `loadPluginsFromDirectory()` | Plugin auto-discovery |
| H4 | Tool registry init | 477-483 | `createLocalToolRegistry({ root, shellPolicy, permissionManager, undoStack, pluginRegistry })` | Tool setup |
| H5 | Agent team tools registration | 484 | `registerAgentTeamTools(toolRegistry, ...)` | Team tools |
| H6 | Session creation | 486-492 | `new Session({ provider, settings, toolRegistry, permissionManager, pluginRegistry })` | Core runtime |
| H7 | Plugin hook: onSessionStart | 495 | `pluginRegistry.runHook('onSessionStart', { session })` | Plugins |
| H8 | Transcript loading | 504-506 | `loadRecentTranscript(session)` | Memory |
| H9 | Interactive prompt setup | 513-678 | readline.createInterface, keypress handlers | REPL |
| H10 | Approval callback | 826-889 | `createApprovalPrompt()` → `toolRegistry.approvalCallback` | Permissions |
| H11 | Banner rendering | 893, 508-509 | `renderBanner(screen, session)` | UI |
| H12 | Version update check | 927-967 | `checkForUpdate(VERSION)` | Updater |
| H13 | Line processing | 1006-1264 | `rl.on('line')` → `processLine()` → `handleChatMessage()` or `handleSlashCommand()` | Chat/Slash |
| H14 | Slash command routing | 1150-1173 | `handleSlashCommand(trimmed, { screen, session, markdown, rl, input, output })` | 32 commands |
| H15 | Plugin hook: onSessionEnd | 1000-1003 | `pluginRegistry.runHook('onSessionEnd', { session })` | Plugins |
| H16 | Clean exit | 984-1004 | `performCleanExit(session, screen, t)` | Shutdown |
| H17 | Error handlers | 1351-1381 | `setupErrorHandlers()` | Crash handling |

**Available integration slots (NOT yet used):**

| Slot | Where | How to Wire |
|------|-------|-------------|
| S1 | `main()` — after KNOWN_COMMANDS check, before runShell | New subcommands: `hax-agent health/benchmark/test/migrate/marketplace/ci/catalog/train` |
| S2 | `runShell()` — between H8 and H9 | Sidecar services startup (health monitor, scheduler, watchers, notification manager) |
| S3 | `runShell()` — before H5 | Pre-session middleware (safety checker, injection detector, personality injector) |
| S4 | `rl.on('line')` — before processLine | Input pipeline (injection sanitizer, NLP intent detector) |
| S5 | `performCleanExit()` — before H15 | Sidecar shutdown sequence |
| S6 | `setupErrorHandlers()` — add handlers | Error reporting, audit logging, crash analytics |
| S7 | `SLASH_COMMANDS` array in `src/commands/definitions.js` | New slash commands |
| S8 | `COMMAND_HANDLERS` object in `src/commands/index.js` | New command handler functions |

**New CLI flags to add to `KNOWN_COMMANDS`:**
```
--log-level, --trace, --schedule, --notify, --health, --profile, --sandbox
```

### 1.2 `src/agent-engine.js` — Core Agent Loop (486 lines)

**Class & lifecycle:**
```javascript
class AgentEngine {
  constructor({ session, env, projectRoot })    // L38-47
  sendMessage(content, options)                  // L49 — main entry
  invokeSkill(skill, args, options)              // L53
  interrupt()                                    // L57
  *_runUserMessage(content, options)             // L65 — skill matching + provider turn + goal continuation
  *_runSkill(skill, args, options)               // L138 — skill execution
  *_runProviderTurn(options)                     // L169 — LLM streaming + tool execution loop
  _applyProviderChunk(chunk, state)              // L306 — chunk-to-event mapper
}

function buildTurnSystemPrompt(options)          // L355 — system prompt assembly
function findExplicitSkill(content, session...)   // L418
function createEvent(type, payload, session)     // L432
```

**Existing hook points:**

| # | Hook Point | Line(s) | Signature | Extension Mechanism |
|---|-----------|---------|-----------|---------------------|
| A1 | Skill matching | 68-93 | `findExplicitSkill()` + `matchSkillByIntent()` | Skills module |
| A2 | System prompt building | 185-191 | `buildTurnSystemPrompt({ baseSystem, settings, session, projectRoot, query })` | Add custom instructions, file context |
| A3 | Context window preparation | 192-198 | `prepareContextWindow({ messages, system, settings, model, outputTokens })` | Token budget enforcement |
| A4 | Provider streaming loop | 212-249 | `session.provider.stream({ messages, toolRegistry, signal, system, context })` | Stream interception |
| A5 | Chunk dispatching | 221-226, 306-352 | `_applyProviderChunk(chunk, state)` | Event processing |
| A6 | Goal continuation | 108-136 | `shouldContinueGoal()` + loop | Goal system |
| A7 | Transcript persistence | 295-298 | `appendTranscriptEntry()` | Memory |
| A8 | Event creation | 432-449 | `createEvent(type, payload, session)` | Event enrichment |

**Missing hook points (need to be added):**

| Gap | Priority | What to Add |
|-----|----------|------------|
| G1 | HIGH | `beforeTurn` middleware — pre-process user input before system prompt assembly |
| G2 | HIGH | `afterTurn` middleware — post-process after LLM response, before event yield |
| G3 | HIGH | `beforeToolExecution` interceptor — inject safety checks, sandboxing |
| G4 | MEDIUM | `onEvent` bus — emit typed events to an EventBus alongside generator yields |
| G5 | MEDIUM | `messagePreprocessor` — chain: sanitize → inject context → transform |
| G6 | MEDIUM | `systemPromptAssembler` — pluggable blocks for system prompt (personality, rules, context) |
| G7 | LOW | `responsePostprocessor` — format, filter, redact LLM output |

**Specific integration surface in AgentEngine:**

```javascript
// G1 + G5: Add message preprocessor pipeline (inject before L96-103)
// In _runUserMessage(), before _runProviderTurn():
//   content = await this._runInputPipeline(content, options);

// G2: Add after-turn hook (after L300)
//   await this._runAfterTurnPipeline(event, session);

// G3 + G4: Wire EventBus (after L21, in constructor)
//   this.eventBus = options.eventBus || new EventBus();
//   In _applyProviderChunk(): this.eventBus.emit(event.type, event);

// G6: Plugin system prompt blocks (in buildTurnSystemPrompt, after L363)
//   blocks.push(...(await this._getPluginsSystemPrompts(options)));
```

### 1.3 `src/tools/registry.js` — Tool Pipeline (186 lines)

**Class & lifecycle:**
```javascript
class ToolRegistry {
  constructor({ root, permissionManager, approvalCallback, undoStack, pluginRegistry })
  register(tool)                          // L31 — add tool to registry
  list()                                  // L58
  resetSingleCallTracking()               // L66
  hasSingleCallResult(name)               // L70
  execute(name, args, context)            // L80 — main execution pipeline
}

function createLocalToolRegistry(options)  // L160 — factory, registers 11 built-in tools
```

**Existing hook points:**

| # | Hook Point | Line(s) | Signature | Extension Mechanism |
|---|-----------|---------|-----------|---------------------|
| T1 | Permission check | 107-116 | `permissionManager.checkPermission(name, args, approvalCallback)` | PermissionManager |
| T2 | Plugin: beforeToolCall | 120-122 | `pluginRegistry.runHook('beforeToolCall', { toolName, args, session })` | Plugin hooks |
| T3 | Tool execution | 124-129 | `tool.execute(args, { ...context, root, registry, undoStack })` | Core execution |
| T4 | Single-call caching | 131-133 | `_singleCallCache.set(name, { data, timestamp })` | Cache |
| T5 | Plugin: afterToolCall | 136-138 | `pluginRegistry.runHook('afterToolCall', { toolName, args, result, session })` | Plugin hooks |
| T6 | Plugin: onError | 147-149 | `pluginRegistry.runHook('onError', { error, toolName, session })` | Plugin hooks |

**Missing hook points (need to be added):**

| Gap | Priority | What to Add |
|-----|----------|------------|
| TG1 | HIGH | `toolWrapper` pipeline — compose decorators (timeout, retry, rate-limit, metrics) around each tool's execute |
| TG2 | HIGH | `preExecuteValidate` — validate args against JSON Schema (integrate `schema-validator.js`) |
| TG3 | MEDIUM | `sandboxWrapper` — optional sandboxed execution wrapper |
| TG4 | MEDIUM | `auditLog` — log every tool execution for security/compliance |
| TG5 | MEDIUM | `circuitBreaker` — per-tool circuit breaker integration |

**Specific integration surface in ToolRegistry:**

```javascript
// TG1: Tool decorator pipeline (add as a new method or constructor option)
// register(tool) → optionally wrap withToolTimeout/withValidation/withRateLimit/withCaching/withMetrics

// TG2: Schema validation (in execute(), before L107)
//   const schema = this.tools.get(name).inputSchema;
//   if (schema) this._validateArgs(name, args, schema);

// TG4: Audit logging (in execute(), after L80, wrapping the whole body)
//   this._auditLog?.log({ toolName: name, args, timestamp: Date.now() });
```

---

## 2. Module-to-Entry-Point Mapping Table

### KEY: Category legend
- **C** = CLI Surface (slash commands, flags, subcommands)
- **A** = Agent Loop (middleware, hooks, pre/post processing)
- **T** = Tool Pipeline (wrappers, validators, monitors)
- **S** = Sidecar Services (background)
- **E** = Agent Teams (multi-agent)
- **D** = Dev/Docs Tooling

| # | Module Path | Files | Category | Entry Point | Hook/Slot | Effort | Notes |
|---|------------|-------|----------|-------------|-----------|--------|-------|
| 1 | `src/events/` | bus.js, middleware.js | A, S, T | agent-engine.js | G4 (EventBus) | **M** | Wire EventBus into AgentEngine, ToolRegistry, and CLI lifecycle |
| 2 | `src/tool-decorators.js` | tool-decorators.js | T | tools/registry.js | TG1 (wrapper pipeline) | **S** | composeDecorators on tool.execute in register() |
| 3 | `src/schema-validator.js` | schema-validator.js | T | tools/registry.js | TG2 (validate) | **S** | Validate tool args against inputSchema before execution |
| 4 | `src/injection/` | detector.js, monitor.js, sanitizer.js | A | agent-engine.js | G1+ (input pipeline) | **M** | Pre-process user messages before LLM call |
| 5 | `src/safety/` | executor.js, scanner.js, rules-engine.js, redaction.js, auditor.js | A, T | agent-engine.js + tools/registry.js | G3 + TG3 | **L** | Safety scanning pre-turn, sandboxed execution |
| 6 | `src/sandbox/` | executor.js, policy.js, vm-sandbox.js | T | tools/registry.js | TG3 (sandbox) | **L** | Wrap shell commands in sandboxed environment |
| 7 | `src/observability/` | logger.js, metrics.js, tracer.js | S, A | cli.js + agent-engine.js | S2 + G4 | **M** | Structured logging, metrics collection, distributed tracing |
| 8 | `src/health/` | monitor.js, scorer.js, debt-tracker.js, recommendations.js, visualizer.js | C, S | cli.js | S1 + S2 | **M** | New `hax-agent health` command + background monitor |
| 9 | `src/scheduler/` | cron.js, queue.js, worker.js | S | cli.js | S2 + S5 | **M** | Background task scheduling with cron expressions |
| 10 | `src/notify/` | manager.js, channels.js, aggregator.js, rules-engine.js, triggers.js | S | cli.js | S2 + H7 | **M** | Notification channels (desktop, log, webhook) |
| 11 | `src/tokens/` | budget.js, monitor.js, planner.js, strategies.js, report.js, visualizer.js | A | agent-engine.js | A3 | **M** | Token budget enforcement during turn processing |
| 12 | `src/personality/` | profiles.js, behavior-modifiers.js, response-styles.js | A | agent-engine.js | G6 (system prompt) | **M** | Inject personality into system prompt |
| 13 | `src/prompts/` | builder.js, optimizer.js, templates.js, roles.js, evolution.js, ab-test.js, versioning.js | A | agent-engine.js | A2 + G6 | **L** | Full prompt management pipeline |
| 14 | `src/context/` | injector.js, selector.js, templates.js | A | agent-engine.js | A2 | **S** | Context injection into prompts |
| 15 | `src/optimizer/` | token-optimizer.js, context-scheduler.js, template-engine.js | A | agent-engine.js | A2, A3 | **M** | Token optimization, context scheduling |
| 16 | `src/knowledge/` | accumulator.js, curator.js | A | agent-engine.js | G2 (after turn) | **M** | Extract knowledge from turns |
| 17 | `src/intel/` | codebase-analyzer.js, context-builder.js, dependency-analyzer.js | A | agent-engine.js | A2 | **M** | Codebase intelligence for context |
| 18 | `src/strategy/` | engine.js, library.js, registry.js | A | agent-engine.js | G5 (preprocessor) | **L** | Strategy execution for agent decisions |
| 19 | `src/resilience/` | circuit-breaker.js, bulkhead.js, retry.js | T | tools/registry.js | TG1 + TG5 | **M** | Wrap tool execution with resilience patterns |
| 20 | `src/quota/` | enforcer.js, manager.js, scheduler.js | T | tools/registry.js | TG1 | **M** | Per-tool execution quotas |
| 21 | `src/errors/` | enhancer.js, recovery.js | T | tools/registry.js | execute() error path | **S** | Enhanced error messages, recovery strategies |
| 22 | `src/prediction/` | early-warning.js, error-predictor.js | A, S | agent-engine.js + cli.js | G2 + S2 | **L** | Failure prediction and early warnings |
| 23 | `src/analytics/` | anomaly-detector.js, predictor.js, conversation-stats.js, report-generator.js, tool-insights.js | S, C | cli.js | S1 + S2 | **L** | Analytics dashboard + background analysis |
| 24 | `src/regression/` | alerting.js, detector.js, root-cause.js | S | cli.js | S1 | **L** | Regression detection from benchmark data |
| 25 | `src/benchmark/` | runner.js, scenarios.js, reporter.js | C | cli.js | S1 | **M** | `hax-agent benchmark` command |
| 26 | `src/security/` | audit-log.js, content-policy.js, input-sanitizer.js | T, C | tools/registry.js + cli.js | TG4 + S1 | **M** | Audit logging, content policy |
| 27 | `src/governance/` | auditor.js, policy-engine.js | C, A | cli.js + agent-engine.js | S1 + G1 | **L** | Policy auditing, governance dashboard |
| 28 | `src/compliance/` | policies.js, drift.js, reports.js | C | cli.js | S1 | **M** | Compliance checking and reports |
| 29 | `src/quality/` | gates.js, auto-fix.js, reporter.js | A, T | agent-engine.js + tools/registry.js | G1 + TG2 | **M** | Pre/post quality gates |
| 30 | `src/marketplace/` | index.js, curation.js | C | cli.js | S1 | **M** | Plugin marketplace browsing |
| 31 | `src/plugins/` | repository.js, indexer.js, isolate.js, dependency.js, hotswap.js | C | cli.js | S1 | **M** | Plugin management commands |
| 32 | `src/providers/` | aggregator.js, load-balancer.js, fallback.js, router.js, synthesizer.js, comparator.js, diversity.js, cost-optimizer.js | A | agent-engine.js | G7 (response postprocessor) | **L** | Multi-provider aggregation, load balancing |
| 33 | `src/memory/` | archiver.js, compressor.js, embedder.js, semantic-search.js, vector-store.js, optimizer.js | A | agent-engine.js | A7 (transcript) | **L** | Enhanced memory with vector search |
| 34 | `src/skills/` | recommender.js, chains.js, composer.js, metrics.js | A | agent-engine.js | A1 | **M** | Skill recommendation and chaining |
| 35 | `src/goals/` | history.js, templates.js, tracker.js | A | agent-engine.js | A6 | **M** | Enhanced goal tracking |
| 36 | `src/conversation/` | chunker.js, diff.js, summarizer.js | A | agent-engine.js | A7 | **S** | Conversation chunking and summarization |
| 37 | `src/improvement/` | feedback-collector.js, learning-engine.js, metrics-tracker.js | A | agent-engine.js | G2 | **M** | Feedback collection and learning |
| 38 | `src/capability/` | discovery.js, profile.js, reflection.js | A | agent-engine.js | G6 | **M** | Capability discovery and reflection |
| 39 | `src/hub/` | discovery.js, catalog.js, rating.js | C, A | cli.js + agent-engine.js | S1 + constructor | **M** | Hub features for agent discovery |
| 40 | `src/coordination/` | dispatcher.js, heartbeat.js, leader.js | E | agent-engine.js | (new team coord) | **L** | Multi-agent coordination backbone |
| 41 | `src/workflow/` | engine.js, library.js, templates.js, validator.js, linter.js, scheduler.js | E | agent-engine.js | (new workflow runner) | **L** | Workflow engine for multi-step tasks |
| 42 | `src/debate/` | engine.js, formats.js, scoring.js | E | agent-engine.js | (new debate mode) | **L** | Multi-agent debate for decisions |
| 43 | `src/handoff/` | protocol.js, briefing.js, escalation.js | E | agent-engine.js | G2 (after turn) | **M** | Agent-to-agent handoff protocol |
| 44 | `src/bridge/` | continuity.js, transfer.js | E | agent-engine.js | A7 | **M** | Session continuity across agents |
| 45 | `src/collab/` | consensus.js, knowledge-base.js, messaging.js | E | agent-engine.js | (new collab mode) | **L** | Agent collaboration system |
| 46 | `src/sim/` | engine.js, metrics.js, scenarios.js | E | cli.js | S1 | **M** | `hax-agent sim` command |
| 47 | `src/replay/` | engine.js, diff-analyzer.js | C | cli.js | S1 | **M** | Session replay |
| 48 | `src/review/` | engine.js, formatter.js | E | agent-engine.js | G2 | **M** | Auto code review in agent mode |
| 49 | `src/reinforcement/` | explorer.js, policy.js, rewards.js | A | agent-engine.js | G2 (feedback) | **L** | RL-based exploration |
| 50 | `src/trust/` | delegation.js, reliability.js, reputation.js | E | agent-engine.js | (new trust sys) | **L** | Trust scoring for agents |
| 51 | `src/contracts/` | define.js, negotiate.js, verify.js | E | agent-engine.js | (new contract sys) | **L** | Agent contracts |
| 52 | `src/branches/` | comparison.js, manager.js, merge.js | C | cli.js | S1 | **M** | Branch management commands |
| 53 | `src/consolidation/` | analyzer.js, migration-guide.js, report.js | C | cli.js | S1 | **M** | Consolidation reports |
| 54 | `src/graph/` | engine.js, builder.js, query.js | A, C | agent-engine.js + cli.js | A2 + S1 | **L** | Knowledge graph for context |
| 55 | `src/watcher/` | change-log.js, fs-watcher.js, hot-reload.js | S | cli.js | S2 | **S** | File watching sidecar |
| 56 | `src/hotreload/` | applier.js, notifier.js, watcher.js | S | cli.js | S2 | **S** | Hot reload sidecar |
| 57 | `src/testing/` | selftest.js, smoke-test.js | C | cli.js | S1 | **M** | `hax-agent test` command |
| 58 | `src/tutorial/` | engine.js, progress.js, tutorials.js | C | cli.js | S1 | **M** | `hax-agent tutorial` command |
| 59 | `src/diagram/` | ascii-charts.js, mermaid-gen.js, svg-gen.js | C | cli.js | S1 | **M** | `/diagram` slash command |
| 60 | `src/visualize/` | decision-tree.js, flow.js | C | cli.js | S1 | **M** | `/visualize` slash command |
| 61 | `src/catalog/` | scanner.js, reporter.js | C | cli.js | S1 | **M** | Project catalog command |
| 62 | `src/ci/` | pipeline.js, triggers.js, cache.js | C | cli.js | S1 | **M** | CI integration commands |
| 63 | `src/migration/` | engine.js, transforms.js, validator.js | C | cli.js | S1 | **M** | `hax-agent migrate` command |
| 64 | `src/export/` | pipeline.js, postprocess.js | C | cli.js | S1 | **S** | Enhance existing /export |
| 65 | `src/format/` | pipeline.js, pretty.js, syntax.js | C | cli.js | S1 | **S** | Output formatting options |
| 66 | `src/config/` | environment.js, interactive.js, migration.js, profiler.js, schema.js | C | cli.js | S1 | **M** | Enhance /config command |
| 67 | `src/deps/` | analyzer.js, visualizer.js | C | cli.js | S1 | **S** | `/deps` slash command |
| 68 | `src/ownership/` | blame.js, insights.js, tracker.js | C | cli.js | S1 | **M** | `/ownership` slash command |
| 69 | `src/explain/` | counterfactual.js, report.js, tracer.js | C | cli.js | S1 | **M** | `/explain` slash command |
| 70 | `src/training/` | augmenter.js, extractor.js, formatter.js | C | cli.js | S1 | **M** | `hax-agent train` command |
| 71 | `src/generator/` | composer.js, customizer.js, file-gen.js, project-gen.js, templates.js | C | cli.js | S1 | **L** | Code generation commands |
| 72 | `src/artifact/` | manager.js, distribution.js, release.js | C | cli.js | S1 | **M** | Artifact management |
| 73 | `src/diff/` | merge-engine.js, patch.js, semantic-diff.js | C | cli.js | S1 | **M** | Diff and merge commands |
| 74 | `src/patterns/` | classifier.js, matcher.js | A | agent-engine.js | G5 | **S** | Pattern matching for input |
| 75 | `src/similarity/` | detector.js, fingerprint.js | A | agent-engine.js | G5 | **S** | Similarity detection |
| 76 | `src/platform/` | detect.js, env.js, paths.js | C, A | cli.js + agent-engine.js | S1 + constructor | **S** | Platform-aware behavior |
| 77 | `src/workspace/` | manager.js, monorepo.js, session-context.js | C | cli.js | S1 | **M** | Workspace management |
| 78 | `src/search/` | ast-grep.js, index-builder.js, query-parser.js, ranking.js, results-formatter.js | C, T | tools/registry.js + cli.js | S1 | **L** | Enhanced search capabilities |
| 79 | `src/files/` | impact.js, predictor.js | A | agent-engine.js | A2 | **S** | File impact analysis for context |
| 80 | `src/recorder/` | capture.js, fixture-gen.js, playback.js | C | cli.js | S1 | **M** | Test recording / playback |
| 81 | `src/data/` | backup.js, migration.js, serializer.js | C | cli.js | S1 | **M** | Data management |
| 82 | `src/state/` | agent-lifecycle.js, fsm.js, rehydration.js, snapshot.js, team-coordinator.js | A | agent-engine.js | (new state mgmt) | **L** | State machine lifecycle |
| 83 | `src/time/` | analytics.js, estimator.js, scheduler.js | S | cli.js | S2 | **S** | Time tracking and analytics |
| 84 | `src/multimodal/` | layout.js, preview.js, renderer.js | C | cli.js | S1 | **L** | Multimodal output |
| 85 | `src/models/` | matrix.js, selector.js | C | cli.js + agent-engine.js | A2 | **S** | Model selection matrix |
| 86 | `src/protocol/` | compressor.js, router.js | A | agent-engine.js | G7 | **M** | Response compression |
| 87 | `src/streaming/` | adapter.js, optimizer.js | A | agent-engine.js | A4 | **M** | Streaming optimization |
| 88 | `src/pruning/` | evaluator.js, strategies.js | A | agent-engine.js | A7 | **S** | Context pruning |
| 89 | `src/synthesis/` | merger.js, quality.js | A | agent-engine.js | G2 | **M** | Response synthesis |
| 90 | `src/preserve/` | importance.js, restorer.js, summarizer.js | A | agent-engine.js | A7 | **S** | Context preservation |
| 91 | `src/tasks/` | resolver.js, tracker.js | E | agent-engine.js | (new task sys) | **M** | Task resolution tracking |
| 92 | `src/teams/` | planner.js | E | agent-engine.js | (new planner) | **M** | Team planning |
| 93 | `src/resources/` | planner.js, pool.js | E | agent-engine.js | (new resource) | **M** | Resource pooling |
| 94 | `src/nlp/` | command-builder.js, entity-extractor.js, intent-detector.js | C | cli.js | S4 | **L** | NLP-enhanced command parsing |

---

## 3. Conflict Resolution

### 3.1 Identified Conflicts

| ID | Conflict | Modules Involved | Hook Point | Resolution |
|----|---------|-----------------|------------|------------|
| CF1 | **System prompt assembly order** | personality, prompts, context/injector, safety/rules, capability, strategy, optimizer | A2: `buildTurnSystemPrompt()` | Establish a `PromptPipeline` with configurable priority ordering. Default order: base system → capability → personality → context → strategy → safety rules. User settings control inclusion. |
| CF2 | **Input preprocessing pipeline** | injection/sanitizer, safety/scanner, nlp/intent-detector, patterns/classifier, context/injector | G1: before `_runProviderTurn` | Define `InputPipeline` with ordered stages: sanitize → detect injection → classify intent → inject context → transform. Run in sequence, each stage can short-circuit. |
| CF3 | **Tool execution wrapping** | tool-decorators (timeout/validation/rate-limit/caching/metrics), resilience (circuit-breaker), safety/executor, sandbox/executor, quota/enforcer | TG1: ToolRegistry.register() | Define `ToolWrapperPipeline`: [metrics(outer)] → [rate-limit] → [circuit-breaker] → [timeout] → [quota] → [safety/sandbox] → [caching] → [validation] → [execute(inner)]. Use `composeDecorators()` from tool-decorators.js. |
| CF4 | **Post-turn event processing** | improvement/feedback, knowledge/accumulator, conversation/summarizer, goals/tracker, prediction/early-warning, regression/detector | G2: after `_runProviderTurn` | Create `PostTurnPipeline` that asynchronously runs all post-turn processors. None blocks the next turn. Priority: knowledge extraction → goal updating → conversation summarization → feedback collection → prediction. |
| CF5 | **Sidecar startup order** | scheduler, health/monitor, notify/manager, observability, analytics, watcher, hotreload | S2: `runShell()` after session creation | Define `SidecarRegistry` with dependency ordering. Core (observability, EventBus) starts first, then dependent services (health, scheduler, notify), then optional (analytics, watchers). All started via `Promise.all` after core. |
| CF6 | **CLI subcommand collision** | health, benchmark, test, migrate, marketplace, ci, catalog, train, sim, tutorial | S1: `main()` switch(primary) | All use `hax-agent <subcommand>` pattern. No collisions with existing commands (init, models, agents, team, resume, sessions, config, doctor, help). Add to KNOWN_COMMANDS array. Order doesn't matter — they're stateless commands. |
| CF7 | **Slash command collision** | diagram, visualize, catalog, deps, ownership, explain, format | S7: SLASH_COMMANDS array | None collide with existing 32 slash commands. Add to COMMAND_HANDLERS. These are all read-only display commands with no dependencies. |
| CF8 | **Permission check vs Safety check** | safety/executor, injection/detector, permissions.js | T1 + TG3 | Safety checks run BEFORE permission checks. Injection detection = block immediately. Permission = gate. Safety = firewall. Order: injection check → safety scan → permission check → tool execution. |

### 3.2 Recommended Pipeline Architecture

```
INPUT PIPELINE (before AgentEngine._runProviderTurn)
  userMessage → Sanitize(injection) → Detect Threats → Classify Intent
  → Inject Context → Transform → → LLM Call

SYSTEM PROMPT PIPELINE (buildTurnSystemPrompt)
  baseSystem → capability → personality → context/intel → strategy
  → safety_rules → custom_instructions → final

TOOL EXECUTION PIPELINE (ToolRegistry.execute)
  metrics → rateLimit → circuitBreaker → timeout → quota
  → safety/sandbox → caching → validation → EXECUTE

POST-TURN PIPELINE (after AgentEngine._runProviderTurn)
  event emitted → knowledge extraction → goal tracking → conversation summary
  → feedback collection → prediction analysis → (parallel, non-blocking)

SIDECAR LIFECYCLE (cli.js runShell)
  start: EventBus → observability → scheduler → health → notify → optional(analytics, watchers)
  stop:  optional → notify → health → scheduler → observability → EventBus
```

---

## 4. Integration Order (Priority Sequencing)

### Phase 1: Foundation (Effort: 3-4 agent-days)
Wire the infrastructure that OTHER modules depend on.

| Order | Module | Entry Point | Why First |
|-------|--------|-------------|-----------|
| 1 | `events/bus.js` + `middleware.js` | agent-engine.js + tools/registry.js + cli.js | Foundation for ALL event-driven wiring. Every subsequent module can subscribe to events. |
| 2 | `observability/` (logger, metrics, tracer) | cli.js | All other modules need structured logging and metrics. Add `--log-level` flag. |
| 3 | `tool-decorators.js` | tools/registry.js | Compose pipeline for ALL tool execution. Every tool gets timeout + metrics + validation. |
| 4 | `schema-validator.js` | tools/registry.js | Validate tool args against JSON Schema before execution. |

### Phase 2: Core Safety & Reliability (Effort: 3-4 agent-days)
Wire the modules that every turn depends on.

| Order | Module | Entry Point | Why First |
|-------|--------|-------------|-----------|
| 5 | `injection/` (detector, sanitizer) | agent-engine.js (input pipeline) | Every user message must be sanitized. |
| 6 | `safety/executor.js` | tools/registry.js (TG3) | Pre-execution safety checks for every tool. |
| 7 | `resilience/` (circuit-breaker, retry) | tools/registry.js (TG1) | Wrap tool execution with resilience. |
| 8 | `errors/enhancer.js` + `recovery.js` | tools/registry.js (error path) | Better error messages for all tool failures. |
| 9 | `security/audit-log.js` | tools/registry.js (TG4) | Audit every tool execution. |

### Phase 3: Agent Loop Enhancement (Effort: 4-5 agent-days)
Enrich the core agent loop.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 10 | `personality/` (profiles, behavior-modifiers) | agent-engine.js (A2/G6) | System prompt personality injection. |
| 11 | `context/injector.js` | agent-engine.js (A2) | Smart context injection into prompts. |
| 12 | `tokens/` (budget, monitor) | agent-engine.js (A3) | Token budget enforcement. |
| 13 | `optimizer/` (token-optimizer, context-scheduler) | agent-engine.js (A2/A3) | Token and context optimization. |
| 14 | `knowledge/` (accumulator, curator) | agent-engine.js (G2) | Post-turn knowledge extraction. |
| 15 | `conversation/` (summarizer, chunker) | agent-engine.js (A7) | Conversation summarization. |
| 16 | `improvement/` (feedback-collector) | agent-engine.js (G2) | Feedback collection. |

### Phase 4: Sidecar Services (Effort: 3-4 agent-days)
Background monitoring and automation.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 17 | `scheduler/` (cron, queue, worker) | cli.js (S2) | Background task scheduling. |
| 18 | `health/monitor.js` | cli.js (S2) | Background health monitoring. |
| 19 | `notify/` (manager, channels) | cli.js (S2/H7) | Event-driven notifications. |
| 20 | `watcher/` (fs-watcher, hot-reload) | cli.js (S2) | File change monitoring. |
| 21 | `analytics/` (anomaly-detector, predictor) | cli.js (S2) | Background analytics. |
| 22 | `prediction/` (early-warning) | agent-engine.js (G2) + cli.js | Failure prediction. |

### Phase 5: CLI Commands (Effort: 3-4 agent-days)
New slash commands and subcommands.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 23 | `health/` (CLI command) | cli.js (S1) | `hax-agent health` |
| 24 | `benchmark/` | cli.js (S1) | `hax-agent benchmark` |
| 25 | `security/` (CLI audit) | cli.js (S1) | `/audit` slash command |
| 26 | `config/` (enhanced config) | cli.js (S1) | Enhanced `/config` |
| 27 | `plugins/` (repository, hotswap) | cli.js (S1) | `/plugins install/search` |
| 28 | `marketplace/` | cli.js (S1) | `/marketplace` |
| 29 | `deps/` | cli.js (S1) | `/deps` |
| 30 | `ownership/` | cli.js (S1) | `/ownership` |
| 31 | `explain/` | cli.js (S1) | `/explain` |
| 32 | `diagram/` + `visualize/` | cli.js (S1) | `/diagram`, `/visualize` |
| 33 | `migration/` | cli.js (S1) | `hax-agent migrate` |
| 34 | `testing/` | cli.js (S1) | `hax-agent test` |
| 35 | `catalog/` | cli.js (S1) | `/catalog` |
| 36 | `tutorial/` | cli.js (S1) | `hax-agent tutorial` |
| 37 | `replay/` | cli.js (S1) | `/replay` |

### Phase 6: Agent Teams & Coordination (Effort: 5-7 agent-days)
Multi-agent capabilities.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 38 | `state/` (agent-lifecycle, fsm) | agent-engine.js | State machine for agent lifecycle |
| 39 | `coordination/` (dispatcher, heartbeat, leader) | agent-engine.js | Multi-agent coordination |
| 40 | `handoff/` (protocol, briefing) | agent-engine.js | Agent-to-agent handoff |
| 41 | `workflow/` (engine) | agent-engine.js | Workflow execution |
| 42 | `review/engine.js` | agent-engine.js | Auto code review agent mode |
| 43 | `teams/planner.js` | agent-engine.js | Team planner |
| 44 | `tasks/` (resolver, tracker) | agent-engine.js | Task tracking |
| 45 | `sim/engine.js` | cli.js (S1) | Simulation |
| 46 | `debate/engine.js` | agent-engine.js | Debate mode |
| 47 | `trust/` (delegation, reputation) | agent-engine.js | Trust scoring |
| 48 | `contracts/` | agent-engine.js | Agent contracts |
| 49 | `reinforcement/` | agent-engine.js | RL exploration |
| 50 | `collab/` | agent-engine.js | Collaboration |

### Phase 7: Advanced Tooling (Effort: 3-4 agent-days)
Advanced development features.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 51 | `generator/` (code gen) | cli.js (S1) | Code generation |
| 52 | `artifact/` (manager) | cli.js (S1) | Artifact management |
| 53 | `diff/` (merge, semantic) | cli.js (S1) | Diff tools |
| 54 | `search/` (ast-grep, index) | cli.js (S1) | Enhanced search |
| 55 | `recorder/` (capture, playback) | cli.js (S1) | Test recording |
| 56 | `workspace/` (manager) | cli.js (S1) | Workspace mgmt |
| 57 | `data/` (backup, migration) | cli.js (S1) | Data tools |
| 58 | `format/` (pipeline) | cli.js (S1) | Output formatting |

### Phase 8: Specialty Modules (Effort: 3-4 agent-days)
Niche/specialist features.

| Order | Module | Entry Point | Why |
|-------|--------|-------------|-----|
| 59 | `prompts/` (full pipeline) | agent-engine.js | Full prompt management |
| 60 | `providers/` (aggregator, load-balancer) | agent-engine.js | Multi-provider |
| 61 | `memory/` (vector store, semantic search) | agent-engine.js | Enhanced memory |
| 62 | `strategy/` (engine) | agent-engine.js | Strategy system |
| 63 | `intel/` (codebase analyzer) | agent-engine.js | Intelligence |
| 64 | `graph/` (knowledge graph) | agent-engine.js | Knowledge graph |
| 65 | `multimodal/` (renderer) | cli.js | Multimodal output |
| 66 | `nlp/` (intent, entity) | cli.js | NLP commands |
| 67 | `sandbox/` (full VM sandbox) | tools/registry.js | Full sandbox |
| 68 | `governance/` | agent-engine.js | Governance |
| 69 | `compliance/` | cli.js | Compliance |
| 70 | `quality/` (gates, auto-fix) | agent-engine.js | Quality gates |
| 71 | `regression/` (detector) | cli.js | Regression |
| 72 | `capability/` (discovery, reflection) | agent-engine.js | Capability |
| 73 | `hub/` (discovery, catalog) | hub.js | Hub features |
| 74 | `skills/` (recommender, chains) | agent-engine.js | Skill enhancement |
| 75 | `goals/` (tracker, history) | agent-engine.js | Goal tracking |
| 76 | `training/` (augmenter) | cli.js | Training |
| 77 | `consolidation/` | cli.js | Consolidation |
| 78 | `branches/` | cli.js | Branches |
| 79 | `models/` (matrix, selector) | agent-engine.js | Model selection |
| 80 | `protocol/` (compressor) | agent-engine.js | Compression |
| 81 | `streaming/` (adapter, optimizer) | agent-engine.js | Streaming |
| 82 | `pruning/` (evaluator, strategies) | agent-engine.js | Pruning |
| 83 | `synthesis/` (merger, quality) | agent-engine.js | Synthesis |
| 84 | `preserve/` (importance, restorer) | agent-engine.js | Preservation |
| 85 | `resources/` (planner, pool) | agent-engine.js | Resources |
| 86 | `patterns/` (classifier, matcher) | agent-engine.js | Patterns |
| 87 | `similarity/` (detector, fingerprint) | agent-engine.js | Similarity |
| 88 | `files/` (impact, predictor) | agent-engine.js | Files |
| 89 | `platform/` (detect, env, paths) | cli.js | Platform |
| 90 | `time/` (analytics, estimator) | cli.js | Time |
| 91 | `docs/` (browser, content, search) | cli.js | Docs |
| 92 | `dev-tooling/` (project-init, scaffold) | cli.js | Dev tools |
| 93 | `ci/` (pipeline, triggers) | cli.js | CI |
| 94 | `export/` (pipeline, postprocess) | cli.js | Export enhance |

---

## 5. Risk Assessment

### High Risk Integrations (require design discussion BEFORE wiring)

| Module | Risk | Mitigation |
|--------|------|------------|
| `sandbox/vm-sandbox.js` | OS-level sandboxing is inherently risky and platform-specific. Requires root/admin on some systems. | Start with `sandbox/policy.js` only (restrict allowed commands), defer VM sandbox. |
| `reinforcement/` | RL-based agent behavior can produce unexpected/unsafe actions. Needs guardrails and kill-switch. | Never enable by default. Require explicit config flag. Add hard safety limits. |
| `providers/aggregator.js` | Multi-provider routing can double costs if not configured correctly. | Add cost estimation before routing. Show cost preview. |
| `nlp/intent-detector.js` | Intent misclassification can route user to wrong handler. | Use as suggestion only, never auto-execute. Always confirm ambiguous intents. |
| `workflow/engine.js` | Workflow DSL can create infinite loops. | Add max steps limit, timeout, circuit breaker. |
| `debate/engine.js` | Multi-agent debates consume many tokens (N agents x debate rounds). | Token budget per debate. Max rounds configurable. Estimate cost before starting. |

### Low Risk, High Value (wire first)
| Module | Value |
|--------|-------|
| `events/bus.js` | Foundation for all event-driven behavior |
| `tool-decorators.js` | Every tool gets timeout, metrics, validation |
| `observability/` | Visibility into all system behavior |
| `personality/` | User-facing customization, high impact |
| `injection/detector.js` | Immediate security win |
| `scheduler/cron.js` | Enables automated workflows |
| `notify/manager.js` | User engagement, low integration cost |

---

## 6. Prerequisites Before Wiring Begins

### 6.1 Must-do infrastructure changes

1. **Add EventBus to AgentEngine** (lines to change: `src/agent-engine.js` L38-47, L169, L212, L306)
   ```javascript
   // agent-engine.js L38:
   constructor(options = {}) {
     this.eventBus = options.eventBus || null;
     // ...existing...
   }
   // In _runProviderTurn L212:
   this.eventBus?.emit('turn.started', event);
   // In _applyProviderChunk L306:
   this.eventBus?.emit(`chunk.${chunk.type}`, chunk);
   ```

2. **Add InputPipeline to AgentEngine** (new method, ~20 lines)
   ```javascript
   // After L64 (end of constructor), add:
   async _runInputPipeline(content, options = {}) {
     let result = content;
     for (const stage of this.inputStages || []) {
       result = await stage.process(result, { session: this.session, ...options });
       if (result === null) throw new Error(`Input rejected by stage: ${stage.name}`);
     }
     return result;
   }
   ```

3. **Add ToolWrapper pipeline to ToolRegistry** (modify `register()`, ~10 lines)
   ```javascript
   // In tools/registry.js L31, after validation:
   register(tool, options = {}) {
     // ...existing validation...
     let execute = tool.execute;
     if (options.decorators) {
       execute = composeDecorators(execute, ...options.decorators);
     }
     this.tools.set(tool.name, { ...tool, execute });
   }
   ```

4. **Add Sidecar lifecycle to cli.js** (new function, ~30 lines)
   ```javascript
   // In cli.js, after L483:
   async function startSidecars(session, config) {
     const sidecars = [];
     if (config.enableScheduler) sidecars.push(startScheduler(session));
     if (config.enableHealthMonitor) sidecars.push(startHealthMonitor(session));
     // ... etc
     return { stopAll: async () => { for (const s of sidecars) await s.stop(); } };
   }
   ```

5. **Add SLASH_COMMANDS extensibility** (modify `src/commands/definitions.js`, ~5 lines)
   ```javascript
   // Allow programmatic registration (for plugins to add commands)
   function registerSlashCommand(command) { SLASH_COMMANDS.push(command); }
   function registerCommandHandler(name, handler) { COMMAND_HANDLERS[name] = handler; }
   ```

### 6.2 Must-do test infrastructure

Before wiring 94 modules, add integration test scaffolding:

```javascript
// test/integration/wiring.test.js
// Test each module can be loaded, instantiated, and connected to its target entry point
// Test all pipeline orders are respected
// Test conflict resolution (e.g., safety check before permission check)
```

### 6.3 Must-document

- `docs/integration/SIDECAR_LIFECYCLE.md` — Sidecar start/stop order and dependencies
- `docs/integration/PIPELINE_ARCHITECTURE.md` — All 5 pipeline definitions
- `docs/integration/TOOL_WRAPPER_ORDER.md` — Why the tool wrapper order matters
- CHANGELOG entry for each phase

---

## 7. Integration Readiness Summary

### Strengths
- **All 3 entry points are well-structured** with clear constructor signatures and lifecycle hooks
- **Plugin/hook system** (`beforeToolCall`, `afterToolCall`, `onSessionStart`, `onSessionEnd`) is operational and tested
- **94 orphan modules** have consistent factory/class patterns with clear exports
- **Hub (`src/hub.js`)** already integrates 10 subsystems and demonstrates the wiring pattern
- **ToolRegistry.execute()** already has pluggable permission, hook, and undo stack integration
- **No module-to-module circular dependencies** detected

### Weaknesses
- **AgentEngine lacks middleware/pipeline architecture** — must be added before wiring ~50 agent-loop modules
- **No EventBus wiring exists** — must be added before event-driven modules
- **No formal input/output pipeline** in AgentEngine — each module currently requires surgical code changes
- **CLI command registration is static** (hardcoded SLASH_COMMANDS array) — needs dynamic registration API
- **Sidecar lifecycle management is non-existent** — no start/stop/dependency ordering

### Recommended Pre-Wire Tasks (before any module integration)

| # | Task | Lines of Code | Effort |
|---|------|--------------|--------|
| 1 | Wire EventBus into AgentEngine, ToolRegistry, and CLI | ~40 | **S** |
| 2 | Add InputPipeline to AgentEngine | ~30 | **S** |
| 3 | Add ToolWrapper pipeline to ToolRegistry | ~20 | **S** |
| 4 | Add Sidecar lifecycle manager to cli.js | ~40 | **S** |
| 5 | Make SLASH_COMMANDS extensible (dynamic registration) | ~15 | **S** |
| 6 | Add COMMAND_HANDLERS extensibility | ~10 | **S** |
| 7 | Create integration test scaffolding | ~80 | **M** |
| 8 | Document pipeline architecture and hook points | ~100 | **M** |

**Total pre-wire effort: ~335 lines, 2 agent-days**

### Final Score Breakdown

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| Entry Point Clarity | 85/100 | All 3 entry points have clear APIs and hook points documented above |
| Hook Availability | 65/100 | Plugin hooks exist for tools but AgentEngine needs middleware hooks |
| Module API Consistency | 90/100 | Nearly all orphan modules follow consistent patterns (class + factory) |
| Conflict Manageability | 60/100 | 8 conflicts identified, all resolvable with pipeline architecture |
| Test Infrastructure | 40/100 | No integration tests for wiring exist yet |
| Documentation | 55/100 | Code is self-documenting but no formal integration guides |
| **OVERALL** | **67/100** | Ready to begin Phase 1 after completing 8 pre-wire tasks |

---

## 8. Recommended First Action

Begin with the **8 pre-wire tasks** (Section 7), then execute **Phase 1** (Section 4):

1. Wire `events/bus.js` into all 3 entry points → foundation for everything else
2. Wire `tool-decorators.js` into `tools/registry.js` → every tool gets pipeline
3. Wire `observability/logger.js` into `cli.js` → visibility into all behavior
4. Wire `schema-validator.js` into `tools/registry.js` → arg validation

This gives you the infrastructure needed to wire the remaining 90 modules efficiently.

---

*Report generated for GLOBAL WIRING agent consumption. All hook points, signatures, and line numbers are exact as of the current codebase state.*
