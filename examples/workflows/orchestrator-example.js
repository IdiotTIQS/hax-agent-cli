"use strict";

// ---------------------------------------------------------------------------
// orchestrator-example.js — Orchestrator + Workers Pattern
//
// Demonstrates the **Orchestrator + Workers** workflow pattern: a single
// lead agent (the orchestrator) decomposes a large, complex goal into
// discrete tasks, spawns specialist worker agents, assigns tasks to the
// right worker, and aggregates the results.
//
// This is the most powerful pattern for large, heterogeneous tasks:
//   - Refactoring a monolith across many modules.
//   - Multi-file feature development (frontend + backend + tests + docs).
//   - Pull request review across many files with different specialists.
//
//   node examples/workflows/orchestrator-example.js
//
// Pass --mock to use a canned provider instead of a real LLM.
// ---------------------------------------------------------------------------

const path = require("node:path");

// --- project imports ------------------------------------------------------
const { createTeamRuntime } = require("../../src/teams/runtime");
const { createProvider } = require("../../src/providers/factory");
const { ToolRegistry } = require("../../src/tool-registry");

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const USE_MOCK = process.argv.includes("--mock");

// ---------------------------------------------------------------------------
// Helper: short summary for display
// ---------------------------------------------------------------------------

function shortSummary(text, limit) {
  limit = limit || 200;
  if (!text) return "(empty)";
  if (typeof text !== "string") text = JSON.stringify(text);
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

function summarizeOutput(task) {
  if (!task || !task.result) return "(no output)";
  if (typeof task.result.content === "string") return task.result.content;
  return JSON.stringify(task.result, null, 2);
}

// ---------------------------------------------------------------------------
// Provider setup
// ---------------------------------------------------------------------------

function resolveProvider() {
  if (USE_MOCK) return createMockProvider();

  const provider = createProvider(
    {
      apiKey: process.env.HAX_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY,
      model: process.env.HAX_AGENT_MODEL || "claude-sonnet-4-20250514",
    },
    process.env,
  );

  if (!provider.apiKey) {
    console.error(
      "[orchestrator-example] No API key found.\n" +
      "  Set ANTHROPIC_API_KEY or run with --mock.\n",
    );
    process.exit(1);
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Mock provider — returns pre-scripted responses for each worker type
// and a simulated orchestrator decomposition.
// ---------------------------------------------------------------------------

function createMockProvider() {
  const callIndex = { explorer: 0, implementer: 0, reviewer: 0, tester: 0, orchestrator: 0 };

  return {
    name: "mock",
    model: "mock-model",
    apiKey: "mock-key",

    async *stream({ messages, system }) {
      const identity = system || "";

      let agentType = "unknown";
      if (identity.includes("code-explorer"))     agentType = "explorer";
      else if (identity.includes("code-implementer")) agentType = "implementer";
      else if (identity.includes("code-reviewer"))    agentType = "reviewer";
      else if (identity.includes("test-validator"))   agentType = "tester";
      else if (identity.includes("orchestrator"))     agentType = "orchestrator";

      if (callIndex[agentType] !== undefined) {
        callIndex[agentType] += 1;
      }

      const userContent = messages.length > 0
        ? String(messages[messages.length - 1].content || "")
        : "";

      const response = mockAgentResponse(agentType, userContent, callIndex[agentType]);

      yield { type: "text", delta: response };
      yield { type: "usage", inputTokens: 15, outputTokens: response.length };
    },
  };
}

function mockAgentResponse(agentType, _prompt, callNum) {
  switch (agentType) {
    // --- ORCHESTRATOR: decomposes the goal into worker tasks ---
    case "orchestrator":
      return [
        "TASK DECOMPOSITION",
        "",
        "I have analyzed the refactoring goal and broken it into five tasks.",
        "The dependency graph is:",
        "  T1 (explore) → T2 (implement auth) + T3 (implement middleware)",
        "  T2 + T3 → T4 (review)",
        "  T2 + T3 → T5 (test)",
        "",
        "Worker assignments:",
        "  T1: code-explorer    — map the existing auth module",
        "  T2: auth-refactorer  — refactor auth service",
        "  T3: middleware-refactorer — refactor auth middleware",
        "  T4: code-reviewer    — review all changes for correctness",
        "  T5: test-validator   — run the full test suite and report",
        "",
        "Strategy notes:",
        "- T2 and T3 are independent (different files) so they run in parallel.",
        "- T4 depends on both T2 and T3 (needs all changes to review).",
        "- T5 also depends on both T2 and T3.",
        "- T4 and T5 are independent of each other and can run in parallel too.",
        "",
        "Proceed with T1 first so the workers have exploration context.",
      ].join("\n");

    // --- EXPLORER: maps the codebase ---
    case "explorer":
      return [
        `AUTH MODULE SURVEY (call #${callNum})`,
        "",
        "Files mapped:",
        "  src/auth/service.ts           — AuthService class with login, logout, refresh",
        "  src/auth/middleware.ts        — authenticate, authorize middlewares",
        "  src/auth/types.ts             — AuthToken, UserSession, Credentials",
        "  src/auth/__tests__/           — 15 test files, some outdated",
        "  src/middleware/rate-limit.ts  — uses auth context for per-user limits",
        "  src/routes/auth.ts            — /login, /logout, /refresh endpoints",
        "",
        "Constraints found:",
        "- AuthService is tightly coupled to the User model (circular dep risk).",
        "- Middleware functions are 200+ lines each — need extraction.",
        "- Tests reference hard-coded JWT secrets (uses test env var).",
        "- Existing refactoring pattern elsewhere in the codebase: extract",
        "  interfaces first, then split services, then update consumers.",
        "",
        "Recommended implementation order:",
        "1. Extract auth interfaces to src/auth/interfaces.ts.",
        "2. Split AuthService into AuthService + TokenService.",
        "3. Split middleware into smaller composable functions.",
        "4. Update all consumers to use the new structure.",
      ].join("\n");

    // --- IMPLEMENTER: does the actual code changes ---
    case "implementer":
      return [
        `REFACTORING COMPLETE (call #${callNum})`,
        "",
        "Files changed:",
        "  src/auth/interfaces.ts        — NEW: IAuthService, ITokenService, IAuthMiddleware",
        "  src/auth/service.ts           — MODIFIED: split into AuthService + TokenService",
        "  src/auth/middleware.ts        — MODIFIED: split into authenticate, authorize, requireRole, optionalAuth",
        "  src/auth/token-service.ts     — NEW: TokenService class extracted from AuthService",
        "  src/auth/index.ts             — MODIFIED: updated barrel exports",
        "  src/routes/auth.ts            — MODIFIED: updated imports",
        "  src/middleware/rate-limit.ts  — MODIFIED: updated auth middleware import",
        "",
        "Conventions followed:",
        "- Used existing DI pattern (constructor injection for TokenService).",
        "- Interfaces follow the project's I-prefix convention.",
        "- Barrel exports updated to keep existing import paths working.",
        "- All existing type imports remain compatible.",
        "",
        "Validation:",
        "- npx tsc --noEmit → 0 errors",
        "- Baseline tests still pass (did not run the full suite — that's T5's job).",
        "",
        "Known trade-offs: backward-compatible shims kept for 2 deprecated",
        "import paths (will be removed in the next major version).",
      ].join("\n");

    // --- REVIEWER: inspects the implementation ---
    case "reviewer":
      return [
        `CODE REVIEW REPORT (call #${callNum})`,
        "",
        "Scope reviewed: all changes from T2 (auth-refactorer) and T3 (middleware-refactorer).",
        "",
        "VERDICT: APPROVED with minor notes.",
        "",
        "What went well:",
        "- Interface extraction is clean — IAuthService and ITokenService are well-defined.",
        "- Middleware split into composable functions is a big readability win.",
        "- Backward-compatible shims for deprecated paths — good migration UX.",
        "",
        "Blockers: None.",
        "",
        "Suggestions:",
        "1. src/auth/token-service.ts — consider making the JWT secret injection",
        "   explicit (constructor param) rather than reading from process.env directly.",
        "2. src/auth/middleware.ts — the `optionalAuth` function docstring is missing",
        "   @returns annotation.",
        "3. Deprecated shim comments should include a removal date or version tag",
        "   (e.g., @deprecated since v3.2, remove in v4.0).",
        "",
        "No regressions detected from the files I inspected.",
      ].join("\n");

    // --- TESTER: runs validation ---
    case "tester":
      return [
        `TEST RESULTS (call #${callNum})`,
        "",
        "Commands executed:",
        "  npm t -- --testPathPattern=auth        →  42/42 passing",
        "  npm t -- --testPathPattern=middleware   →  28/28 passing",
        "  npx tsc --noEmit                       →  0 errors",
        "  npm run lint -- src/auth/              →  0 warnings, 0 errors",
        "",
        "All tests pass.  No regressions detected.",
        "",
        "Note: The deprecated import path shims have their own deprecation",
        "tests that correctly log warnings.  These tests pass and the warnings",
        "are expected.",
        "",
        "Coverage report (auth module):",
        "  Statements: 94.2%  Branches: 88.7%  Functions: 96.1%  Lines: 93.8%",
        "",
        "Coverage is slightly higher than before the refactor (+1.2%),",
        "likely because the extracted TokenService is easier to test in isolation.",
      ].join("\n");

    default:
      return "Task completed successfully.";
  }
}

// ---------------------------------------------------------------------------
// Core: orchestrator decomposition step
// ---------------------------------------------------------------------------

/**
 * The orchestrator analyzes the goal and produces a task decomposition.
 * This decomposition step is itself a team task — the orchestrator agent
 * looks at the goal and decides:
 *   1. Which specialist workers are needed.
 *   2. What tasks each worker should do.
 *   3. The dependency order (what must complete before what else).
 *
 * In a real scenario, the orchestrator would spawn new workers dynamically.
 * Here we pre-define the roster and let the orchestrator assign work to them.
 */
async function orchestrate(runtime, goal) {
  console.log("[orchestrate] Decomposing goal...");

  const decomposeTask = runtime.addTask({
    id: "T0",
    title: "Orchestrator: decompose goal into worker tasks",
    owner: "orchestrator",
    agentType: "planner",
    prompt: [
      `You are the orchestrator (planner agent).`,
      `Your job: break this large goal into specific, well-scoped tasks`,
      `and assign each to the right specialist worker.`,
      "",
      `Goal: ${goal}`,
      "",
      `Available workers:`,
      `  code-explorer       (explore)    — maps code paths and architecture`,
      `  auth-refactorer     (implementer)— refactors the auth service`,
      `  middleware-refactorer(implementer)— refactors auth middleware`,
      `  code-reviewer       (reviewer)   — reviews changes for correctness`,
      `  test-validator      (test-runner)— runs tests and reports failures`,
      "",
      `Produce a task decomposition with:`,
      `- Concrete task descriptions for each worker.`,
      `- Dependency edges (which tasks must finish before others can start).`,
      `- Which tasks can run in parallel.`,
      `- A suggested execution order.`,
      "",
      `Output your decomposition as structured text.`,
    ].join("\n"),
    dependsOn: [],
    deliverable: "Task decomposition with assignments, dependencies, and execution order.",
  });

  await runtime.run({ concurrency: 1 });

  const result = runtime.snapshot().tasks.find((t) => t.id === decomposeTask.id);

  console.log(`  Orchestrator output: ${shortSummary(summarizeOutput(result), 300)}`);
  console.log("");

  if (result.status === "failed") {
    throw new Error(`Orchestrator decomposition failed: ${String(result.error?.message || result.error)}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log(" Orchestrator + Workers: decomposing and delegating");
  console.log(` Mode: ${USE_MOCK ? "MOCK (offline)" : "LIVE (LLM)"}`);
  console.log("=".repeat(60));
  console.log("");

  // --- 1. Setup ---

  const projectRoot = path.resolve(__dirname, "..", "..");
  const provider = resolveProvider();

  const toolRegistryFactory = (_member) => new ToolRegistry({ root: projectRoot });

  const runtime = createTeamRuntime({
    projectRoot,
    provider,
    toolRegistryFactory,
  });

  const goal =
    "Refactor the auth module: extract interfaces from the AuthService," +
    " split the monolithic service into AuthService + TokenService," +
    " split the auth middleware into smaller composable functions," +
    " and update all consumers.  Ensure backward compatibility," +
    " run the full test suite, and get a code review.";

  // --- 2. Create team with orchestrator + specialist workers ---

  console.log("[1/4] Creating team...");

  runtime.createTeam({
    name: "orchestrator-team",
    mission: `Orchestrate the following goal: ${goal}`,

    members: [
      // --- The orchestrator (lead) ---
      {
        agentType: "planner",
        name: "orchestrator",
        role: "Decomposes large goals into discrete tasks and assigns them to specialist workers.",
        model: provider.model,
      },

      // --- Specialist workers ---
      {
        agentType: "explore",
        name: "code-explorer",
        role: "Maps the existing auth module: files, dependencies, patterns, and constraints.",
        model: provider.model,
      },
      {
        agentType: "implementer",
        name: "auth-refactorer",
        role: "Refactors AuthService: extracts interfaces, splits into AuthService + TokenService.",
        model: provider.model,
      },
      {
        agentType: "implementer",
        name: "middleware-refactorer",
        role: "Refactors auth middleware: splits monoliths into composable functions.",
        model: provider.model,
      },
      {
        agentType: "reviewer",
        name: "code-reviewer",
        role: "Reviews all refactored code for correctness, style, and regression risk.",
        model: provider.model,
      },
      {
        agentType: "test-runner",
        name: "test-validator",
        role: "Runs the full test suite against the refactored code and reports failures.",
        model: provider.model,
      },
    ],
  });

  const roster = runtime.snapshot().members.map((m) => `${m.name} (${m.agentType})`);
  console.log(`   Team: orchestrator-team`);
  console.log(`   Roster: ${roster.join(", ")}`);
  console.log("");

  // --- 3. Orchestrator: decompose the goal ---

  console.log("[2/4] Orchestrator decomposition...");
  console.log("");

  await orchestrate(runtime, goal);

  // --- 4. Add worker tasks with dependency edges ---
  //
  // The orchestrator determined that:
  //   T1 (explore) runs first.
  //   T2 (auth refactor) and T3 (middleware refactor) run in parallel after T1.
  //   T4 (review) and T5 (test) run after T2+T3, also in parallel.
  //
  // Dependency graph:
  //
  //   T1 (explore)
  //    ├── T2 (auth refactor) ──┐
  //    └── T3 (midl refactor) ─┤
  //                             ├── T4 (review)
  //                             └── T5 (test)

  console.log("[3/4] Adding worker tasks with dependency DAG...");
  console.log("");

  // Phase 1: Exploration (no dependencies)
  runtime.addTask({
    id: "T1",
    title: "Explore the auth module structure",
    owner: "code-explorer",
    agentType: "explore",
    prompt: [
      `Goal: ${goal}`,
      "",
      "Survey the auth module in detail:",
      "- List every file under src/auth/ and describe its role.",
      "- Identify tight couplings, circular dependencies, or risky patterns.",
      "- Find all consumers of the auth module (import statements across the project).",
      "- Note existing test structure and coverage gaps.",
      "- Document project conventions that must be preserved (naming, DI patterns, etc.).",
      "",
      "Produce a structured report the implementers can use to plan their changes.",
    ].join("\n"),
    dependsOn: [],
    deliverable: "Auth module survey with file map, dependency graph, and consumer list.",
  });

  // Phase 2a: Auth service refactoring (depends on T1)
  runtime.addTask({
    id: "T2",
    title: "Refactor AuthService: extract interfaces, split into AuthService + TokenService",
    owner: "auth-refactorer",
    agentType: "implementer",
    prompt: [
      `Goal: ${goal}`,
      "",
      "Using the exploration findings from T1:",
      "1. Create src/auth/interfaces.ts with IAuthService, ITokenService, etc.",
      "2. Split AuthService into:",
      "   - AuthService: login, logout, refresh orchestration",
      "   - TokenService: JWT creation, verification, refresh logic",
      "3. Update src/auth/index.ts barrel exports.",
      "4. Add backward-compatible re-exports for any deprecated paths.",
      "",
      "Follow existing project conventions (constructor DI, typed interfaces, error handling style).",
      "Validate with: npx tsc --noEmit",
    ].join("\n"),
    dependsOn: ["T1"],
    deliverable: "Refactored AuthService + TokenService with updated exports.",
  });

  // Phase 2b: Middleware refactoring (depends on T1, runs in parallel with T2)
  runtime.addTask({
    id: "T3",
    title: "Refactor auth middleware: split into composable functions",
    owner: "middleware-refactorer",
    agentType: "implementer",
    prompt: [
      `Goal: ${goal}`,
      "",
      "Using the exploration findings from T1:",
      "1. Split the monolithic middleware.ts into composable, single-responsibility functions:",
      "   - authenticate(req, res, next) — validates the JWT and attaches user to request.",
      "   - authorize(roles) — checks that the authenticated user has one of the required roles.",
      "   - requireRole(role) — convenience wrapper for single-role authorization.",
      "   - optionalAuth(req, res, next) — authenticates if a token is present, skips otherwise.",
      "2. Update all consumers that import from src/auth/middleware.ts.",
      "3. Keep backward-compatible wrappers for the existing function signatures.",
      "",
      "Follow existing project conventions.",
      "Validate with: npx tsc --noEmit",
    ].join("\n"),
    dependsOn: ["T1"],
    deliverable: "Refactored middleware with composable, single-responsibility functions.",
  });

  // Phase 3a: Code review (depends on T2 and T3)
  runtime.addTask({
    id: "T4",
    title: "Review all refactored code",
    owner: "code-reviewer",
    agentType: "reviewer",
    prompt: [
      `Goal: ${goal}`,
      "",
      "Review the combined changes from:",
      "  T2: Refactored AuthService + TokenService",
      "  T3: Refactored auth middleware",
      "",
      "Evaluate:",
      "- Correctness: does the refactored code behave identically to the original?",
      "- Style: consistent with project conventions?",
      "- Backward compatibility: do existing consumers still work?",
      "- Maintainability: is the new structure clearer?",
      "- Risk: could any behavior change cause a regression?",
      "",
      "Classify findings as BLOCKER or SUGGESTION.",
      "End with VERDICT: APPROVED or NEEDS_CHANGES.",
    ].join("\n"),
    dependsOn: ["T2", "T3"],
    deliverable: "Review report with findings classified by severity and a verdict.",
  });

  // Phase 3b: Test suite (depends on T2 and T3, runs in parallel with T4)
  runtime.addTask({
    id: "T5",
    title: "Run full test suite against refactored code",
    owner: "test-validator",
    agentType: "test-runner",
    prompt: [
      `Goal: ${goal}`,
      "",
      "Run the full test suite against the refactored code from T2 and T3.",
      "Execute these commands in order:",
      "  1. npx tsc --noEmit          — typecheck the entire project",
      "  2. npm t -- --testPathPattern=auth       — auth-specific tests",
      "  3. npm t -- --testPathPattern=middleware  — middleware tests",
      "  4. npm run lint -- src/auth/  — lint the auth module",
      "",
      "Report: exact commands executed, test pass/fail counts,",
      "lint warnings, and any failures with their error messages.",
      "If anything fails, provide enough detail for the implementers to fix it.",
    ].join("\n"),
    dependsOn: ["T2", "T3"],
    deliverable: "Test results with command output, pass/fail counts, and failure analysis.",
  });

  console.log("   Dependency graph:");
  console.log("     T1 (explore)");
  console.log("      ├── T2 (auth refactor) ──┐");
  console.log("      └── T3 (midl refactor) ─┤");
  console.log("                               ├── T4 (review)");
  console.log("                               └── T5 (test)");
  console.log("");

  // --- 5. Run the team ---
  //
  // concurrency = 2 allows T2+T3 and later T4+T5 to run in parallel,
  // while still respecting the dependency DAG.

  console.log("[4/4] Running team (concurrency = 2)...");
  console.log("");

  const result = await runtime.run({ concurrency: 2 });

  console.log("");
  console.log("-".repeat(60));
  console.log(" RESULTS");
  console.log("-".repeat(60));
  console.log("");

  const snapshot = runtime.snapshot();

  console.log(`Team:    ${snapshot.teamName}`);
  console.log(`Mission: ${snapshot.mission}`);
  console.log(`Status:  ${result.run.status}`);
  console.log("");

  const progress = snapshot.progress;
  console.log("Progress:");
  console.log(`  Total: ${progress.total}  Completed: ${progress.completed}  Failed: ${progress.failed}`);
  console.log(`  ${progress.percentComplete}% complete`);
  console.log("");

  // Print each task's outcome in the dependency order for clarity
  const taskOrder = ["T0", "T1", "T2", "T3", "T4", "T5"];

  console.log("Task outcomes:");
  for (const id of taskOrder) {
    const task = snapshot.tasks.find((t) => t.id === id);
    if (!task) continue;

    const statusIcon = task.status === "completed" ? "=" : task.status === "failed" ? "x" : "~";
    const owner = task.owner;
    const deps = task.dependsOn.length > 0 ? ` (after ${task.dependsOn.join(", ")})` : "";

    console.log(`  [${statusIcon}] ${task.id}: ${task.title}`);
    console.log(`       owner: ${owner}${deps}`);
    console.log(`       status: ${task.status}`);

    if (task.result) {
      const preview = summarizeOutput(task).split("\n").slice(0, 2).join("\n");
      console.log(`       result: ${shortSummary(preview, 150)}`);
    }

    if (task.error) {
      console.log(`       error: ${task.error.message || String(task.error)}`);
    }
  }

  console.log("");

  // Show blocked tasks (should be none if everything worked)
  if (result.blocked && result.blocked.length > 0) {
    console.log("Blocked tasks (incomplete dependencies):");
    for (const t of result.blocked) {
      console.log(`  - ${t.id}: ${t.title} (waiting on: ${t.dependsOn.join(", ")})`);
    }
    console.log("");
  }

  console.log("Done. The orchestrator pattern decomposes work and delegates to specialists.");
  console.log("");

  process.exit(result.run.status === "completed" ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("[orchestrator-example] Unhandled error:", err);
  process.exit(1);
});
