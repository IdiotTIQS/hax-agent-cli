# Team Plan Generation from Natural Language -- Implementation Report

**Date:** 2026-05-22
**Feature:** Feature 3 from the HaxAgent Design Roadmap

## Summary

Implemented the `/team plan "<goal>"` command that lets users describe a multi-step task in natural language and have the system auto-generate a team of specialized agents with roles, responsibilities, and handoff rules. The implementation uses the existing TeamRuntime infrastructure and works with or without an LLM provider.

## Files Changed

| File | Change |
|---|---|
| `src/teams/planner.js` | **NEW** -- Core planning module (475 lines) |
| `src/commands/team.js` | Added `plan` subcommand handler, `formatTeamConfirmCommand` helper |
| `src/commands/definitions.js` | Added `plan` to `TEAM_SUBCOMMANDS` array |
| `src/formatters/team-plan.js` | Updated `formatTeamPlan` to handle both orchestration teams and planner-generated plan objects |
| `src/teams/agents.js` | Added `normalizeName` to module exports (was defined but not exported) |
| `test/team-plan.test.js` | **REWRITTEN** -- 28 tests across 8 suites |
| `.audit/team-plan-report.md` | This report |

## Architecture

### LLM-Driven Planning (primary path)

When a real provider (Anthropic, OpenAI, Google) with an API key is available:

1. `generateTeamPlan()` sends a structured prompt to the LLM listing all available agent types and their descriptions
2. The LLM responds with a JSON team plan containing `name`, `mission`, `members[]`, and `tasks[]`
3. The response is parsed robustly (handles markdown fences, trailing commas, extra text)
4. The plan is validated against `loadAgentDefinitions()` -- unknown agent types are mapped to closest known, orphan task owners are reassigned
5. The validated plan is returned with `source: 'llm'` and formatted for display

### Pattern-Based Decomposition (fallback)

When no LLM is available (mock provider, missing API key):

1. `decomposeGoalFallback()` scans the goal text for keywords
2. Recognized patterns:
   - `explore|find|search|inspect|map` -> add `explore` agent
   - `plan|design|architecture|structure` -> add `planner` agent
   - `implement|build|create|write|refactor|code` -> add `implementer` agent
   - `security|auth|token|permission|vulnerability` -> add `security-reviewer` agent
   - `test|verify|validate|coverage|lint` -> add `test-runner` agent
   - `review|audit|check` -> add `reviewer` agent
   - `doc|readme|document|explain|usage` -> add `docs-writer` agent
3. Tasks are created in logical dependency order (explore -> plan -> implement -> review/security/test -> docs)
4. Parallel tasks have empty `dependsOn[]`; sequential tasks chain to predecessors

### LLM Availability Detection

`isLLMAvailable(provider)` checks:
- Provider is not null/undefined
- Provider name is not `mock` or `local`
- Provider has a non-null `apiKey`

## CLI Usage

```
/team plan "build a web scraper that monitors prices"
```

The command:
1. Generates a plan (LLM if available, pattern-based if not)
2. Displays the plan preview with agents, tasks, and dependencies
3. Shows a confirmation command to create the team: `/team create <name> --mission "..." --member ...`

## Tests

28 tests across 8 suites, all passing:

| Suite | Tests | Focus |
|---|---|---|
| `isLLMAvailable` | 4 | Provider detection logic |
| `generateTeamPlan` | 4 | End-to-end plan generation (LLM + pattern + fallback) |
| `decomposeGoalFallback` | 8 | Keyword-based decomposition for all agent types |
| `validatePlan` | 4 | Plan validation and error correction |
| `parseLLMResponse` | 4 | JSON parsing robustness (fences, kebab-case, trailing commas) |
| `formatGeneratedPlan` | 1 | Human-readable plan formatting |
| `formatTeamPlan (updated)` | 1 | Backward-compatible formatter update |
| `TeamRuntime integration` | 2 | End-to-end: plan -> TeamRuntime.createTeam() -> save state file |

## Edge Cases Handled

- **Empty goal**: Rejects with clear error message
- **No LLM available**: Falls back to pattern-based decomposition
- **LLM returns malformed JSON**: Strips markdown fences, extracts JSON object, handles trailing commas
- **LLM uses unknown agent types**: Maps to closest known type via keyword matching
- **LLM assigns task to non-existent owner**: Reassigns to first team member
- **LLM inventing invalid task agent types**: Fixes from the owner's agent type
- **LLM connection failure**: Falls back to pattern-based decomposition
- **Goal with no recognizable keywords**: Creates a minimal general-purpose team with one task

## Design Decisions

1. **Dual-path approach**: The LLM path is preferred when available because it can decompose goals intelligently with nuanced agent roles. The pattern path ensures the feature works offline and in CI environments.

2. **Plan display, not auto-create**: The command shows the plan for review and provides a confirmation command. The user must explicitly run the suggested command to create the team. This prevents accidental expensive LLM agent runs.

3. **Reuse of existing infrastructure**: The planner produces plan objects compatible with `TeamRuntime.createTeam()`. No new state management or team format was created.

4. **`formatTeamPlan` backward compatibility**: The formatter now handles both orchestration team objects (with `.agents`, `.board`) and planner output (with `.members`).
