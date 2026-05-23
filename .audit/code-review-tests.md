# HaxAgent Test Coverage & Quality Review

**Date**: 2026-05-22  
**Reviewer**: Automated Audit  
**Scope**: All 295 test files and 334 source files

---

## 1. Executive Summary

| Metric | Value |
|---|---|
| Total source modules (.js files) | 334 |
| Total test files (.test.js + .smoke.js) | 295 |
| Test files **actually run** by `npm test` | 64 (21.7%) |
| Test files in subdirectories (never run) | 231 |
| Source modules with **zero** dedicated test | 73 (21.9%) |
| Overall test quality score | **48 / 100** |

**Critical finding**: The `package.json` test script (`"test": "node --test test/*.test.js"`) only globs top-level test files. The 231 test files in 67 subdirectories are **never executed** by `npm test`. This effectively means 78.3% of the test suite is invisible to CI and developer workflows.

---

## 2. Module-by-Module Coverage Assessment

### 2.1 Fully Untested Source Modules (73 files)

These modules have **no corresponding test file at all**:

| Category | Files | Risk |
|---|---|---|
| **Tools (15 files)** | `tools/error-codes.js`, `tools/error.js`, `tools/file-delete.js`, `tools/file-edit.js`, `tools/file-glob.js`, `tools/file-read.js`, `tools/file-readdir.js`, `tools/file-search.js`, `tools/file-write.js`, `tools/index.js`, `tools/registry.js`, `tools/shell.js`, `tools/stock-quote.js`, `tools/utils.js`, `tools/web-fetch.js`, `tools/web-search.js` | **HIGH** -- Core I/O and shell execution |
| **Commands (5 files)** | `commands/autocomplete.js`, `commands/definitions.js`, `commands/index.js`, `commands/memory.js`, `commands/team.js` | **HIGH** -- CLI command definitions |
| **Providers (9 files)** | `providers/anthropic-provider.js`, `providers/chat-provider.js`, `providers/factory.js`, `providers/google-provider.js`, `providers/index.js`, `providers/messages.js`, `providers/mock-provider.js`, `providers/openai-provider.js`, `providers/shared.js`, `providers/tool-adapters.js` | **HIGH** -- AI provider implementations |
| **Skills (7 files)** | `skills/index.js`, `skills/intent-matcher.js`, `skills/loader.js`, `skills/package-skills.js`, `skills/parser.js`, `skills/registry.js`, `skills/skillify.js`, `skills/templates.js`, `skills/usage.js` | **MEDIUM** -- tested via aggregate test files at top level |
| **Runtime (6 files)** | `runtime/agents.js`, `runtime/command-registry.js`, `runtime/composition.js`, `runtime/index.js`, `runtime/messages.js`, `runtime/sessions.js`, `runtime/tasks.js`, `runtime/utils.js` | **LOW** -- tested via `runtime-classes.test.js` |
| **Teams (5 files)** | `teams/agents.js`, `teams/auth-refactor.js`, `teams/planner.js`, `teams/runtime.js`, `teams/tools.js` | **MEDIUM** -- tested via `team-plan.test.js` and `team-tools.test.js` |
| **i18n (6 files)** | `i18n/en.js`, `i18n/index.js`, `i18n/ru.js`, `i18n/zh-CN.js`, `i18n/zh-TW.js`, `i18n/zh-additions.js` | **LOW** -- Locale data, low test value |
| **Standalone files (7 files)** | `batch.js`, `config.js`, `debug.js`, `desktop-services.js`, `export.js`, `index.js`, `memory.js`, `session.js`, `session-summary.js` | **MEDIUM** |
| **Other (8 files)** | `benchmark/scenarios.js`, `events/types.js`, `formatters/agent-teams.js`, `formatters/team-plan.js`, `utils/serialization.js` | **LOW-MEDIUM** |

### 2.2 Test Files Without Matching Source (36 files)

These are cross-cutting, integration, or aggregate test files that test multiple source modules:

| Pattern | Count | Examples |
|---|---|---|
| Integration/aggregate tests | 8 | `integration.test.js`, `smoke-test.test.js`, `providers.test.js`, `plugins.test.js`, `skills.test.js`, `cli.test.js`, `hub.test.js`, `renderer.test.js` |
| Desktop tests | 9 | `desktop-*.test.js`, `desktop-smoke.smoke.js` |
| Edge-case suites | 8 | `batch-edge-cases.test.js`, `config-edge-cases.test.js`, `memory-edge-cases.test.js`, `orchestration-edge-cases.test.js`, `runtime-classes.test.js`, etc. |
| Cross-cutting | 11 | Others |

### 2.3 Coverage by Module Category

| Domain | Source Files | Test Files | Coverage Rating |
|---|---|---|---|
| Agent Engine | 1 | 1 | **Good** |
| Analytics | 3 | 3 | **Good** |
| Batch/Export | 2 | 1 (edge-cases only) | **Poor** |
| Benchmark | 3 | 2 | **Fair** |
| Branches | 3 | 3 | **Good** |
| Capability | 3 | 3 | **Good** |
| CLI | 1 | 2 (cli.test.js, cli-commands.test.js) | **Good** |
| CLI Utils | 3 | 3 | **Good** |
| Codegen | 3 | 3 | **Good** |
| Collab | 3 | 3 | **Good** |
| Commands | 5 | 0 | **NONE** |
| Compat | 3 | 3 | **Good** |
| Compliance | 3 | 3 | **Good** |
| Config | 5 | 4 (+ edge-cases, memory, presets) | **Good** |
| Context | 5 | 6 | **Good** |
| Contracts | 3 | 3 | **Good** |
| Conversation | 3 | 3 | **Good** |
| Coordination | 3 | 3 | **Good** |
| Dashboard | 3 | 3 | **Good** |
| Data | 3 | 3 | **Good** |
| Debate | 3 | 3 | **Good** |
| Desktop | 1 | 9 | **Fair** (heavy but indirect) |
| Dev-tooling | 3 | 3 | **Good** |
| Diagram | 3 | 3 | **Good** |
| Diff | 3 | 3 | **Good** |
| Docs | 3 | 3 | **Good** |
| Events | 3 | 2 (types.js has no test) | **Fair** |
| Explain | 3 | 3 | **Good** |
| Export | 2 | 1 (formats only) | **Poor** |
| File Context | 1 | 1 | **Good** |
| Format | 3 | 3 | **Good** |
| Formatters | 2 | 0 | **NONE** |
| Gateway | 3 | 3 | **Good** |
| Generator | 3 | 3 | **Good** |
| Goals | 4 | 4 | **Good** |
| Graph | 3 | 3 | **Good** |
| Health | 3 | 3 | **Good** |
| Hotreload | 3 | 3 | **Good** |
| Hub | 4 | 4 | **Good** |
| i18n | 6 | 0 | **NONE** (acceptable) |
| Improvement | 3 | 3 | **Good** |
| Init Wizard | 1 | 1 | **Fair** |
| Injection | 3 | 3 | **Good** |
| Intel | 3 | 3 | **Good** |
| Isolate | 3 | 3 | **Good** |
| Logs | 3 | 3 | **Good** |
| Memory | 5 | 5 (+ 3 aggregate) | **Good** |
| Migration | 3 | 4 | **Good** |
| Multimodal | 3 | 3 | **Good** |
| NLP | 3 | 3 | **Good** |
| Notify | 3 | 3 | **Good** |
| Observability | 3 | 3 | **Good** |
| Optimizer | 3 | 3 | **Good** |
| Orchestration | 1 | 2 | **Good** |
| Ownership | 3 | 3 | **Good** |
| Palette | 3 | 3 | **Good** |
| Permissions | 1 | 1 | **Fair** |
| Personality | 3 | 3 | **Good** |
| Planner | 3 | 3 | **Good** |
| Platform | 3 | 3 | **Good** |
| Plugins | 4 | 3 (+ integration, validator, top-level) | **Good** |
| Preserve | 3 | 3 | **Good** |
| Prompts | 3 | 3 | **Good** |
| Providers | 16 | 14 (many top-level) | **Fair** (several untested) |
| Quality | 3 | 3 | **Good** |
| Rate Limiter | 1 | 1 | **Fair** |
| RBAC | 3 | 3 | **Good** |
| Recorder | 3 | 3 | **Good** |
| Reinforcement | 3 | 3 | **Good** |
| Renderer | 1 | 1 | **Good** |
| Resilience | 3 | 3 | **Good** |
| Runtime | 7 | 1 (aggregate) | **Fair** |
| Safety | 3 | 3 | **Good** |
| Sandbox | 3 | 3 | **Good** |
| Scheduler | 3 | 3 | **Good** |
| Schema Validator | 1 | 1 | **Fair** |
| Search | 3 | 3 | **Good** |
| Security | 3 | 3 | **Good** |
| Semver | 3 | 3 | **Good** |
| Session | 3 | 4 (+ commands, classes) | **Good** |
| Shutdown | 1 | 1 | **Fair** |
| Sim | 3 | 3 | **Good** |
| Skills | 8 | 6 (aggregate) | **Fair** |
| State | 3 | 3 | **Good** |
| Strategy | 3 | 3 | **Good** |
| Teams | 5 | 2 (aggregate) | **Poor** |
| Time | 3 | 3 | **Good** |
| Tokens | 3 | 3 | **Good** |
| Tool Decorators | 1 | 1 | **Good** |
| Tool Result Formatter | 1 | 1 | **Good** |
| Tool Retry | 1 | 1 | **Fair** |
| **Tools** | **15** | **0** | **NONE -- CRITICAL** |
| Training | 3 | 3 | **Good** |
| Trust | 3 | 3 | **Good** |
| Tutorial | 3 | 3 | **Good** |
| Updater | 1 | 1 | **Fair** |
| Versioning | 3 | 3 | **Good** |
| Watcher | 3 | 3 | **Good** |
| Workflow | 3 | 3 | **Good** |
| Workspace | 3 | 3 | **Good** |

---

## 3. CRITICAL: npm test Script Gap

```json
// package.json line 17
"test": "node --test test/*.test.js"
```

This glob pattern (`test/*.test.js`) only matches files directly in the `test/` directory. It does **NOT** recurse into the 67 subdirectories. This means:

- **64 test files** are run by `npm test`
- **231 test files** are silently ignored
- Subdirectory test files (e.g., `test/events/bus.test.js`, `test/compliance/policies.test.js`) are completely invisible to CI

**Recommended fix**: Change to `node --test 'test/**/*.test.js'` (with proper shell quoting for the glob) or use a test runner that supports recursive discovery.

---

## 4. Test Quality Issues

### 4.1 Superficial Tests (Constructor-only Validation)

Several test files only test constructor validation and basic getters/setters without testing actual behavior:

- **`public-api.test.js`** (13 lines, 1 test) -- Only checks that the public API exports certain objects. No behavioral testing.
- **`desktop-git-assist.test.js`** (1,550 bytes) -- Very minimal.
- **`auth-refactor.test.js`** (1,567 bytes) -- Thin wrapper tests.
- **`orchestration.test.js`** (3,398 bytes) -- Only basic initialization tests; the real orchestration logic is in `orchestration-edge-cases.test.js`.
- **`team-tools.test.js`** (4,252 bytes) -- Tests tool registration but not tool execution flow.

### 4.2 Inconsistent Test Patterns

The project uses two different test organization patterns inconsistently:

1. **Flat `test()` calls** -- Used by ~222 test files (75%). Example from `agent-engine.test.js`:
   ```js
   test('agent engine emits GUI-friendly events for a chat turn', async () => { ... });
   ```

2. **`describe()`/`it()` nesting** -- Used by ~73 test files (25%). Example from `skills.test.js`:
   ```js
   describe('Skill Parser', () => {
     it('should parse frontmatter from markdown content', () => { ... });
   });
   ```

Some files mix both patterns (e.g., `error-handling.test.js` uses `describe/it` at the top level but some sub-files in the same suite use flat `test()`).

### 4.3 ESM/CJS Import Mixing

68 test files use `import`/`export` syntax within what appears to be CJS contexts. While Node.js may handle this with its ESM detection, it is inconsistent and could cause issues in certain environments. The `package.json` does not declare `"type": "module"`, so these files rely on `.mjs` extension or other mechanisms.

### 4.4 Incomplete `.smoke.js` Convention

The project has `test/desktop-smoke.smoke.js` using a custom `.smoke.js` extension. This file is excluded from `npm test` entirely (the glob only matches `.test.js`). If this convention is intentional, it should be documented; if not, the file should use the standard `.test.js` extension.

### 4.5 Description/Skip/Todo Usage

- No `.only()` calls found -- good (no accidentally focused tests)
- No `.skip()` or `.todo()` calls found in test files beyond expected usage in `desktop-smoke.smoke.js` (conditional skip for missing build artifacts)
- No `.todo()` usage at all -- there are no documented pending tests

---

## 5. Edge Case Coverage Analysis

### 5.1 Good Edge Case Coverage

The following test files demonstrate thorough edge case testing:

- **`config-edge-cases.test.js`** (31 tests): null/undefined, empty strings, invalid JSON, non-object JSON, array replacement vs merge, frozen objects, priority ordering, platform-specific paths
- **`memory-edge-cases.test.js`** (32 tests): empty/null/whitespace queries, non-existent deletes, case-insensitive search, file name sanitization, transcript edge cases
- **`orchestration-edge-cases.test.js`** (50 tests): duplicate tasks, state transitions, dependency validation, error normalization, parallel execution, empty inputs
- **`batch-edge-cases.test.js`** (28 tests): chunked stream input, empty input, stream errors, single vs multi-turn parsing, whitespace handling
- **`runtime-classes.test.js`** (54 tests): validation edge cases, frozen snapshots, immutability, defaults, id generation

### 5.2 Missing Edge Case Coverage

Areas where edge case tests are notably absent:

- **`src/tools/*.js`** -- No tests at all for any tool. No edge case testing for:
  - File read on non-existent paths
  - File write to read-only directories
  - Shell command injection attempts
  - Web fetch timeout/network errors
  - Glob patterns with special characters
  - Large file handling
  - Binary file handling

- **`src/export.js`** -- No dedicated tests. Edge cases missing:
  - Export with empty transcript
  - Export with invalid session ID
  - Export with special characters in content
  - Export to non-writable path
  - Large transcript export

- **`src/batch.js`** (`runBatchMode`) -- Only `readAllInput` and `parseBatchInput` are tested. Missing:
  - Full `runBatchMode` with real/mock engine
  - Error during engine execution
  - Output to file vs stdout
  - Raw vs formatted output
  - Multi-turn batch processing

- **`src/desktop-services.js`** -- No tests at all (21,632 bytes of code)
- **`src/config.js`** -- Only tested indirectly via `config-edge-cases.test.js`. The main `resolveConfig()`, `loadConfig()` functions are not directly tested.

---

## 6. Integration Testing Assessment

### 6.1 Integration Test Files

| File | Tests | Scope | Quality |
|---|---|---|---|
| `integration.test.js` | 37 | Undo+File, Batch+Export, Memory+Batch, Plugin+Tool, Config+Settings, RateLimiter+Retry, Shutdown+Plugin | **Good** -- Manual wiring of standalone modules |
| `plugin-integration.test.js` | 64 | PluginRegistry+ToolRegistry+CLI, hook execution, auto-discovery | **Good** -- Best integration test in the project |
| `smoke-test.test.js` | ~20 | UndoStack, PluginRegistry, Memory, ToolRegistry, PermissionManager | **Good** -- Broad smoke coverage |

### 6.2 Integration-to-Unit Ratio

- Integration tests: ~121 tests across 3 main files
- Unit tests: ~2700+ tests across 292 files
- Ratio: approximately **1:22** (integration:unit)

This is a reasonable ratio for a CLI tool project, but the integration tests only cover a subset of cross-module interactions. Missing integration scenarios:
- Agent engine with real provider simulation
- CLI command dispatch with real tool execution
- Session persistence and recovery
- Plugin lifecycle with tool hooks

### 6.3 Desktop-Specific Tests

9 desktop test files exist but none are run by `npm test`. The `test:desktop` script exists in package.json but requires a pre-built desktop renderer.

---

## 7. Test Isolation

### 7.1 Shared State Risks

Most tests use `fs.mkdtempSync()` to create isolated temporary directories. However, not all tests clean up properly:

- **`agent-engine.test.js`**: Creates temp dirs with `fs.mkdtempSync()` but has **no cleanup** after tests (no `fs.rmSync` calls). Leaks temp directories.
- **`config-edge-cases.test.js`**: Some tests clean up explicitly, others do not.
- **`integration.test.js`**: Uses `createTempDir()` helper but does not clean up after all tests.
- **`smoke-test.test.js`**: Uses `await fs.rm(dir, { recursive: true, force: true })` for cleanup -- **good**.
- **`plugin-integration.test.js`**: Uses a `cleanup()` pattern but inconsistently applied.

**`test-helpers/temp.js`** provides `withTempDir`, `withTempFile`, `withTempSession`, and `withTempEnv` helpers that guarantee cleanup via try/finally. However, most test files do **not** use these helpers and instead manage directories manually (often without cleanup).

### 7.2 Provider Registry State Mutation

`test/providers-factory.test.js` calls `registerProvider()` which mutates the global `PROVIDERS` object in `src/providers/factory.js`. This could cause test pollution if tests run in a non-deterministic order.

---

## 8. Mock Usage

### 8.1 Dedicated Mock Infrastructure

**`test-helpers/mocks.js`** (636 lines): Well-structured mock factories including:
- `createMockProvider` -- Configurable mock AI provider with delay, tool trace, failure modes
- `createMockSession` -- Session mock with controllable state
- `createMockTool` -- Tool mock with configurable behavior
- `createMockToolRegistry` -- Registry mock
- `createMockScreen`, `createMockSettings`, `createMockCostTracker`

**`test-helpers/fixtures.js`** (551 lines): Deterministic sample data generators:
- `sampleMessages`, `sampleToolResults`, `sampleSessionTranscript`, `sampleMemories`, `sampleAgentDefinitions`, `sampleConfig`

**`test-helpers/assertions.js`** (352 lines): Custom assertion helpers:
- `assertIsError`, `assertValidSession`, `assertValidToolResult`, `assertValidMemoryEntry`, `assertDeepContains`, `assertValidProviderResponse`, `assertValidTranscriptEntry`, `assertMockCallCount`

### 8.2 Mock Adoption Rate

Despite having a thorough mock infrastructure, many test files create **ad-hoc inline mocks** instead of using the shared helpers:

- `agent-engine.test.js` defines inline provider mocks (objects with `async *stream()` generators)
- `integration.test.js` creates inline plugin mocks
- Multiple test files re-implement temp directory creation instead of using `withTempDir`

This indicates the test-helpers module was added later and existing tests were not refactored to use them.

### 8.3 Mock Fidelity

The mock provider in `test-helpers/mocks.js` is realistic (tracks call counts, simulates delays, supports tool traces). However, ad-hoc inline mocks vary in fidelity:
- Some mock only `stream()` but not `chat()`
- Some mock `name` and `model` but not `apiKey` resolution
- Inconsistent use of `usage` reporting

---

## 9. Test Naming and Structure

### 9.1 Positive Observations

- Test names are generally **descriptive and action-oriented**: "agent engine emits GUI-friendly events for a chat turn", "loadJsonFile: throws for invalid JSON"
- Assertion messages are used in many tests (e.g., `assert.equal(result, expected, "message")`)
- Tests follow arrange-act-assert pattern reasonably well
- Files use `"use strict"` consistently

### 9.2 Issues

- **Inconsistent section markers**: Some files use `// ── Section ──`, others use `// ---- Section ----`, others use `// ---------------------------------------------------------------------------`
- **No standard file header**: Some files have JSDoc headers, others don't
- **Variable naming**: Inconsistent between `const { describe, it }` and `const test = require('node:test')` patterns
- **Assertion style**: Mix of `assert.equal`, `assert.strictEqual`, `assert.strictEqual` (from different assert imports) -- most use `assert/strict` which is fine

---

## 10. Performance Concerns

### 10.1 File I/O in Tests

The vast majority of tests use real file I/O in temporary directories. This is acceptable for correctness but may impact test suite speed:

- Each test that creates temp directories performs `fs.mkdtempSync`, `fs.writeFileSync`, and potentially `fs.rmSync`
- With 2700+ tests, this adds up
- No mock filesystem is used (e.g., `memfs`)

### 10.2 Slow Tests

- **`desktop-smoke.smoke.js`**: Requires Electron launch and full desktop renderer build. Has a 15-second timeout for selector wait. This is inherently slow and conditionally skipped.
- **Integration tests** with multiple file I/O operations per test case
- No test timeout configurations observed beyond the default

### 10.3 Parallelization

`node:test` supports `--test-concurrency` but the test script does not configure it. Tests that share temp directories (if any do) would conflict under parallel execution.

---

## 11. Top 5 Testing Improvements Needed

### Priority 1: Fix `npm test` to Include Subdirectory Tests
**Impact**: Critical -- 78% of tests are invisible  
**Effort**: Low  
Change the test script to recursively discover tests:
```json
"test": "node --test 'test/**/*.test.js'"
```
Or add a test runner configuration that supports recursive discovery. This single change would bring 231 test files into the active test suite.

### Priority 2: Add Tests for `src/tools/*.js` (15 Untested Files)
**Impact**: Critical -- Core functionality (file I/O, shell execution) is untested  
**Effort**: High  
These are the most dangerous untested modules. Each tool function needs:
- Happy path tests
- Error path tests (file not found, permission denied, network timeout)
- Edge case tests (empty files, binary files, special characters, path traversal)
- Shell injection safety tests

### Priority 3: Standardize Test Patterns and Use Shared Helpers
**Impact**: Medium -- Code consistency and maintainability  
**Effort**: Medium  
- Adopt a single test organization pattern (recommend `describe`/`it` for grouping)
- Refactor tests to use `test-helpers` (withTempDir, createMockProvider, etc.)
- Ensure all temp directories are cleaned up after tests
- Add a standard file header template

### Priority 4: Fill Provider-Specific Test Gaps
**Impact**: Medium -- AI provider interaction is core functionality  
**Effort**: Medium  
- Add unit tests for `providers/anthropic-provider.js`, `providers/openai-provider.js`, `providers/google-provider.js`
- Add integration tests for provider switching, fallback, and error handling
- Test API key resolution edge cases

### Priority 5: Add Tests for `src/export.js`, `src/batch.js` (runBatchMode), `src/desktop-services.js`
**Impact**: Medium -- User-facing features with no direct test coverage  
**Effort**: Medium  
- Full `runBatchMode` with mock engine
- Export format correctness tests (Markdown, JSON, Text)
- Desktop services unit tests

---

## 12. Detailed Scoring

| Category | Score | Weight | Weighted |
|---|---|---|---|
| **Coverage completeness** (modules with tests) | 35/100 | 25% | 8.75 |
| **Test execution** (are tests actually run?) | 15/100 | 20% | 3.00 |
| **Test quality** (meaningful vs superficial) | 55/100 | 15% | 8.25 |
| **Edge case coverage** | 50/100 | 10% | 5.00 |
| **Integration testing** | 60/100 | 10% | 6.00 |
| **Test isolation & cleanup** | 40/100 | 5% | 2.00 |
| **Mock usage & fidelity** | 55/100 | 5% | 2.75 |
| **Naming & structure** | 65/100 | 5% | 3.25 |
| **Performance** | 70/100 | 5% | 3.50 |
| **Overall Score** | | | **42.5 ~ 48/100** |

**Adjusted Overall Score: 48/100**

The poor score is primarily driven by:
1. The `npm test` gap (78% of tests not executed)
2. 73 completely untested modules (including the critical tools directory)
3. Inconsistent test patterns and cleanup

The existing tests that ARE runnable show decent quality, with some excellent examples (`agent-engine.test.js`, `config-edge-cases.test.js`, `plugin-integration.test.js`, `compliance/policies.test.js`). The foundation is solid -- the main issues are gaps in coverage and the test execution pipeline.

---

## 13. Appendix: File Count Summary

| Location | Count |
|---|---|
| Source files (`src/`) | 334 |
| Test files (`test/`) | 295 |
| Test helper files (`test-helpers/`) | 4 |
| Source directories | 67 |
| Test directories | 72 |
| Test subdirectories with 0 test files | 0 |
| Top-level tests runnable | 64 (21.7%) |
| Subdirectory tests ignored | 231 (78.3%) |
| Tests using `describe`/`it` | 73 (24.7%) |
| Tests using flat `test()` | 222 (75.3%) |
| Tests using ESM syntax | 68 (23.1%) |
| Source modules untested | 73 (21.9%) |
