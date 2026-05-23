# Agent Workflows

HaxAgent supports composing multiple specialized agents into **teams** that
collaborate on complex coding tasks.  Each agent has a distinct role, a
scoped set of tools, and a natural-language prompt that guides its behavior.

This document describes six workflow patterns, when to use each, and how to
express them with the TeamRuntime API.

---

## Architecture Quick Reference

```
  TeamRuntime
    ├── createTeam({ name, mission, members })
    ├── addMember({ agentType, name, model, tools })
    ├── addTask({ title, owner, prompt, dependsOn, deliverable })
    ├── run({ concurrency })
    ├── getProgress()
    └── snapshot()

  Built-in agent types:
    general-purpose   explore     planner      implementer
    reviewer          test-runner security-reviewer  docs-writer
```

Tasks declare **dependencies** (`dependsOn`), which the runtime uses to build
a DAG.  Tasks with no incomplete dependencies are **ready** and get executed
in parallel (up to `concurrency`).

---

## Pattern 1: Single Agent

**When to use:** Simple Q&A, code generation, file operations, or any task
that a single specialist can handle end-to-end without handoffs.

**Description:** One agent works alone on one or more independent tasks.
The team has a single member and runs sequentially (concurrency defaults to 1).

**Example team config:**

```
name: "quick-fix"
mission: "Fix one focused bug."
members:
  - agentType: implementer
    name: fixer
    role: "Quick bug fixer"
tasks:
  - id: T1
    title: "Fix null-pointer in user controller"
    owner: fixer
    prompt: "..."
    dependsOn: []
    deliverable: "A single file changed with the null guard."
```

**Expected output:** One agent produces one result.  Simple, fast, no
coordination overhead.

**Runtime snippet:**

```js
const { createTeamRuntime } = require('../../src/teams/runtime');
const runtime = createTeamRuntime({ projectRoot: __dirname });
runtime.createTeam({
  name: 'quick-fix',
  mission: 'Fix one focused bug.',
  members: [{ agentType: 'implementer', name: 'fixer' }],
});
runtime.addTask({ title: 'Fix null-pointer', owner: 'fixer', prompt: '...' });
const result = await runtime.run({ concurrency: 1 });
```

---

## Pattern 2: Sequential Pipeline

**When to use:** Multi-phase workflows where each stage depends on the output
of the previous one.  Classic example: explore -> plan -> implement -> review.

**Description:** Agents hand work downstream through a dependency chain.
Each task declares `dependsOn` pointing to the previous task, forming a
strict linear sequence.  The runtime respects these edges and never starts a
task before its dependencies complete.

**Example team config:**

```
name: "feature-pipeline"
mission: "Add a search endpoint to the REST API."
members:
  - agentType: explore
    name: code-explorer
  - agentType: planner
    name: task-planner
  - agentType: implementer
    name: code-implementer
  - agentType: reviewer
    name: code-reviewer
tasks:
  - id: T1  title: "Explore existing routes and controllers"  owner: code-explorer    dependsOn: []
  - id: T2  title: "Produce implementation plan"              owner: task-planner     dependsOn: [T1]
  - id: T3  title: "Implement search endpoint"                owner: code-implementer dependsOn: [T2]
  - id: T4  title: "Review implementation"                    owner: code-reviewer    dependsOn: [T3]
```

**Expected output:** Phase-by-phase deliverables, each informed by the
previous agent's findings.  The review step catches issues before the user
sees the code.

**Full example:** `pipeline-example.js` in this directory.

---

## Pattern 3: Parallel Specialists

**When to use:** Tasks that do not depend on each other and can be executed
concurrently.  Great for linting + testing + typechecking, or for
simultaneous file operations on unrelated modules.

**Description:** Multiple agents are assigned independent tasks (empty
`dependsOn` arrays).  The runtime runs them concurrently up to the
configured `concurrency` limit.

**Example team config:**

```
name: "quality-gates"
mission: "Run all code quality checks in parallel."
members:
  - agentType: test-runner
    name: unit-tester
  - agentType: test-runner
    name: lint-checker
  - agentType: security-reviewer
    name: sec-auditor
tasks:
  - id: T1  title: "Run unit tests"    owner: unit-tester  dependsOn: []
  - id: T2  title: "Run linter"        owner: lint-checker dependsOn: []
  - id: T3  title: "Security audit"     owner: sec-auditor  dependsOn: []
```

**Expected output:** Three result sets produced simultaneously.  Total
wall-clock time is roughly max(slowest task), not sum(all tasks).

**Runtime snippet:**

```js
runtime.createTeam({
  name: 'quality-gates',
  mission: 'Run all code quality checks in parallel.',
  members: [
    { agentType: 'test-runner', name: 'unit-tester' },
    { agentType: 'test-runner', name: 'lint-checker' },
    { agentType: 'security-reviewer', name: 'sec-auditor' },
  ],
});
runtime.addTask({ title: 'Run unit tests', owner: 'unit-tester', prompt: '...' });
runtime.addTask({ title: 'Run linter',     owner: 'lint-checker', prompt: '...' });
runtime.addTask({ title: 'Security audit',  owner: 'sec-auditor',  prompt: '...' });
await runtime.run({ concurrency: 3 });
```

---

## Pattern 4: Review Loop

**When to use:** Changes that must meet a quality bar before they are
accepted.  The implementer writes code, the reviewer checks it, and the cycle
repeats until the reviewer approves.

**Description:** Two agents (implementer + reviewer) run in a feedback loop.
After each implementation attempt, the reviewer inspects the result and
either approves or requests changes.  The loop continues until approval or a
max-iteration guard fires.

**Example team config:**

```
name: "review-loop"
mission: "Implement a feature with iterative code review."
members:
  - agentType: implementer
    name: code-implementer
  - agentType: reviewer
    name: code-reviewer
tasks (multiple rounds, programmatically managed):
  round 1: T1: implement -> T2: review
  round 2: T3: re-implement -> T4: review
  ...
```

**Expected output:** Code that has passed review, with concrete feedback at
each round.  The reviewer's output drives the next implementation attempt.

**Full example:** `review-loop-example.js` in this directory.

---

## Pattern 5: Orchestrator + Workers

**When to use:** Large, heterogeneous goals where one agent is best suited to
break the work into smaller pieces and delegate to specialists.  Examples:
refactoring a monolith, building a multi-module feature, PR review across
many files.

**Description:** A lead (orchestrator) agent inspects the problem, decomposes
it into discrete tasks, spawns specialist workers, assigns tasks to them, and
aggregates the results.  The orchestrator may also handle the final
integration step.

**Example team config:**

```
name: "orchestrator-team"
mission: "Refactor the auth module."
members:
  - agentType: planner
    name: orchestrator
  - agentType: explore
    name: code-explorer
  - agentType: implementer
    name: code-implementer
  - agentType: security-reviewer
    name: sec-auditor
  - agentType: test-runner
    name: test-validator
tasks (delegated by orchestrator):
  T1: Explore auth module                 -> code-explorer
  T2: Plan refactoring steps              -> orchestrator (after T1)
  T3: Implement refactoring               -> code-implementer (after T2)
  T4: Security review of auth changes     -> sec-auditor (after T3)
  T5: Run auth tests                      -> test-validator (after T3) [parallel with T4]
```

**Expected output:** A structured decomposition with specialized agents
handling their portions.  The orchestrator ensures coverage and consistency.

**Full example:** `orchestrator-example.js` in this directory.

---

## Pattern 6: Debate & Decide

**When to use:** High-stakes architectural decisions where multiple
approaches should be evaluated before committing.  Useful for: database
schema design, API versioning strategy, auth framework selection, build
tool chain decisions.

**Description:** Multiple specialist agents each produce a recommendation for
the same problem from their perspective.  An orchestrator reviews all
proposals, weighs trade-offs, and produces a final decision document with
rationale.

**N.B.** This pattern relies on an LLM-capable provider.  Each agent needs
to reason about the problem and produce a coherent proposal.

**Example team config:**

```
name: "debate-team"
mission: "Choose a state-management strategy for the frontend."
members:
  - agentType: planner
    name: decision-lead
    role: "Orchestrator who weighs proposals and decides"
  - agentType: general-purpose
    name: redux-advocate
    role: "Argues for Redux Toolkit"
  - agentType: general-purpose
    name: zustand-advocate
    role: "Argues for Zustand"
  - agentType: general-purpose
    name: context-advocate
    role: "Argues for React Context + useReducer"
tasks:
  T1: redux-advocate   produces Redux proposal    dependsOn: []
  T2: zustand-advocate produces Zustand proposal   dependsOn: []
  T3: context-advocate produces Context proposal   dependsOn: []
  T4: decision-lead    weighs options, decides     dependsOn: [T1, T2, T3]
```

**Expected output:** A decision document with pros/cons for each approach
and a justified final recommendation.

**Runtime snippet:**

```js
runtime.createTeam({
  name: 'debate-team',
  mission: 'Choose a state-management strategy.',
  members: [
    { agentType: 'planner', name: 'decision-lead', role: 'Orchestrator' },
    { agentType: 'general-purpose', name: 'redux-advocate' },
    { agentType: 'general-purpose', name: 'zustand-advocate' },
    { agentType: 'general-purpose', name: 'context-advocate' },
  ],
});

const problem = 'We need state management for a dashboard with real-time updates.';

// All advocates work in parallel
runtime.addTask({ id: 'T1', title: 'Redux proposal',  owner: 'redux-advocate',   prompt: problem, dependsOn: [] });
runtime.addTask({ id: 'T2', title: 'Zustand proposal', owner: 'zustand-advocate',  prompt: problem, dependsOn: [] });
runtime.addTask({ id: 'T3', title: 'Context proposal', owner: 'context-advocate',  prompt: problem, dependsOn: [] });

// Decision lead runs after all proposals are ready
runtime.addTask({ id: 'T4', title: 'Weigh and decide', owner: 'decision-lead',
  prompt: 'Review the three proposals.  Weigh trade-offs.  Pick one with rationale.',
  dependsOn: ['T1', 'T2', 'T3'],
  deliverable: 'Final decision document with pros/cons matrix.',
});

await runtime.run({ concurrency: 3 });
```

---

## Choosing the Right Pattern

| Your Goal | Recommended Pattern |
|---|---|
| Quick one-off code change | Single Agent |
| Multi-step transform with clear phases | Sequential Pipeline |
| Independent checks (lint, test, typecheck) | Parallel Specialists |
| High-quality bar, multiple revision rounds | Review Loop |
| Large, heterogeneous task (many files/modules) | Orchestrator + Workers |
| Architectural decision with multiple options | Debate & Decide |

Most real-world workflows combine patterns.  For example, an Orchestrator
team might contain a review-loop step for its most critical sub-task.

---

## Running the Examples

All example files in this directory are runnable with Node.js:

```
node examples/workflows/pipeline-example.js
node examples/workflows/review-loop-example.js
node examples/workflows/orchestrator-example.js
```

**Provider requirement:** These examples invoke LLM agents.  Set
`ANTHROPIC_API_KEY` (or a compatible provider) in your environment, or
pass a mock provider to the runtime constructor.

```js
// With a real provider (auto-detected from env):
const runtime = createTeamRuntime({ projectRoot: __dirname });

// With an explicit mock / testing provider:
const runtime = createTeamRuntime({
  projectRoot: __dirname,
  provider: myMockProvider,
});
```
