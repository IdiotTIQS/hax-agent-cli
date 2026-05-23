"use strict";

// ---------------------------------------------------------------------------
// pipeline-example.js — Sequential 4-Agent Pipeline
//
// Demonstrates the **Sequential Pipeline** workflow pattern where four
// specialized agents each own one phase of the work, and each phase's
// output feeds into the next via `dependsOn` edges.
//
//   Phase 1 (explore)  →  Phase 2 (plan)  →  Phase 3 (implement)  →  Phase 4 (review)
//
// The TeamRuntime respects task dependencies, so Phase 2 only starts
// after Phase 1 completes, and so on.
//
//   node examples/workflows/pipeline-example.js
//
// Requires a provider (ANTHROPIC_API_KEY or compatible env).  Pass
// --mock to use a mock provider instead of a real LLM.
// ---------------------------------------------------------------------------

const path = require("node:path");

// --- imports from the project source tree --------------------------------
const { createTeamRuntime } = require("../../src/teams/runtime");
const { createProvider } = require("../../src/providers/factory");
// The ToolRegistry is what gives agents access to tools at runtime.
const { ToolRegistry } = require("../../src/tool-registry");

// ---------------------------------------------------------------------------
// Determine whether the user wants real-LLM or mock mode.
// ---------------------------------------------------------------------------

const USE_MOCK = process.argv.includes("--mock");

function resolveProvider() {
  if (USE_MOCK) {
    // Mock provider returns canned responses — useful for offline testing
    // and verifying the pipeline structure without spending API credits.
    return createMockProvider();
  }

  // Real provider: reads apiKey + model from HAX_AGENT_ env vars or
  // falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY etc.
  const provider = createProvider(
    {
      apiKey: process.env.HAX_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY,
      model: process.env.HAX_AGENT_MODEL || "claude-sonnet-4-20250514",
    },
    process.env,
  );

  if (!provider.apiKey) {
    console.error(
      "[pipeline-example] No API key found.\n" +
      "  Set ANTHROPIC_API_KEY in your environment, or run with --mock.\n",
    );
    process.exit(1);
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Mock provider — returns pre-scripted responses for each agent so the
// pipeline can be exercised without a real LLM.
// ---------------------------------------------------------------------------

function createMockProvider() {
  return {
    name: "mock",
    model: "mock-model",
    apiKey: "mock-key",

    async *stream({ messages, system }) {
      // Extract the agent identity from the system prompt so the mock
      // can return a role-appropriate response.
      const identity = system || "";
      let agentType = "unknown";

      if (identity.includes("exploration specialist") || identity.includes("code-explorer")) {
        agentType = "explore";
      } else if (identity.includes("planning specialist") || identity.includes("task-planner")) {
        agentType = "planner";
      } else if (identity.includes("implementation specialist") || identity.includes("code-implementer")) {
        agentType = "implementer";
      } else if (identity.includes("code review specialist") || identity.includes("code-reviewer")) {
        agentType = "reviewer";
      }

      const response = mockResponse(agentType, messages);
      yield { type: "text", delta: response };
      yield { type: "usage", inputTokens: 12, outputTokens: response.length };
    },
  };
}

function mockResponse(agentType, _messages) {
  switch (agentType) {
    case "explore":
      return [
        "CODEBASE SURVEY RESULTS",
        "",
        "Files relevant to the search-endpoint task:",
        "  src/routes/search.ts         — existing search route stub (GET /search)",
        "  src/controllers/search.ts    — thin controller, delegates to service layer",
        "  src/services/search.ts       — main search logic; currently empty",
        "  src/middleware/validate.ts   — request validation middleware (reusable)",
        "  test/search.test.ts          — existing test file with placeholder tests",
        "  src/types/search.ts          — SearchQuery and SearchResult interfaces",
        "",
        "Key constraints:",
        "- Project uses TypeScript strict mode.",
        "- REST endpoints follow Express-style (req, res, next).",
        "- Existing pattern: controller -> service -> repository.",
        "- Tests use Jest with supertest for HTTP integration tests.",
        "",
        "Implementation guidance:",
        "- Fill in src/services/search.ts with the query logic.",
        "- Wire the service into the controller at src/controllers/search.ts.",
        "- Add request validation via the existing validate middleware.",
        "- Extend test/search.test.ts with real integration test cases.",
        "",
        "NEXT: Hand off to the planner for a sequenced implementation plan.",
      ].join("\n");

    case "planner":
      return [
        "IMPLEMENTATION PLAN: Add Search Endpoint",
        "",
        "Dependencies: None beyond what already exists in the codebase.",
        "Risk level: Low.  We are filling in a pre-existing scaffolding.",
        "",
        "Step-by-step:",
        "1. [src/services/search.ts] Implement searchService.query(text)",
        "   - Accept SearchQuery, return SearchResult[].",
        "   - Use existing repository layer to query the DB.",
        "   - Handle empty query (return all), pagination (limit/offset).",
        "   - Add try/catch with typed ErrorResult for downstream handling.",
        "",
        "2. [src/controllers/search.ts] Wire service into controller.",
        "   - Parse query params from req.query.",
        "   - Call searchService.query(...).",
        "   - Return 200 with results, 400 for invalid input, 500 for DB errors.",
        "   - Use existing res.json() pattern from other controllers.",
        "",
        "3. [src/routes/search.ts] Add validation middleware.",
        "   - Apply validate.searchQuery middleware to GET /search.",
        "   - Ensure all existing route tests still pass after the change.",
        "",
        "4. [test/search.test.ts] Add integration tests.",
        "   - Test: empty query returns all results.",
        "   - Test: specific query returns matching results.",
        "   - Test: invalid query (e.g. malformed) returns 400.",
        "   - Test: DB down returns 500.",
        "",
        "Validation strategy:",
        "- Run `npm t -- test/search.test.ts` after each step.",
        "- Run `npx tsc --noEmit` to catch type errors.",
        "",
        "NEXT: Hand off to the implementer for code changes.",
      ].join("\n");

    case "implementer":
      return [
        "IMPLEMENTATION COMPLETE",
        "",
        "Files changed:",
        "  src/services/search.ts        — Added searchService.query(text) with pagination",
        "  src/controllers/search.ts     — Wired service, added error handling",
        "  src/routes/search.ts          — Applied validate.searchQuery middleware",
        "  test/search.test.ts           — Added 4 integration test cases",
        "",
        "Conventions followed:",
        "- Used existing project patterns (controller -> service -> repository).",
        "- Added typed interfaces for all inputs/outputs.",
        "- Followed existing error-handling style (ErrorResult type).",
        "- Tests use the same describe/it/supertest pattern as other test files.",
        "",
        "Validation performed:",
        "- npm t -- test/search.test.ts  →  4/4 passing",
        "- npx tsc --noEmit             →  0 errors",
        "",
        "NEXT: Hand off to the reviewer for a quality check.",
      ].join("\n");

    case "reviewer":
      return [
        "CODE REVIEW REPORT",
        "",
        "Overall: APPROVED with minor suggestions.",
        "",
        "Blockers (must fix): None.",
        "",
        "Suggestions (nice-to-have):",
        "1. [src/services/search.ts:42] The pagination default is 20.",
        "   Consider making it configurable via an env var (SEARCH_PAGE_SIZE).",
        "   This is fine for now but may need tuning in production.",
        "",
        "2. [src/controllers/search.ts:18] The error message for 500 is",
        "   'Internal server error'.  Consider logging the actual error to a",
        "   logger before returning the generic message, to aid debugging.",
        "",
        "3. [test/search.test.ts] Tests are good but could add a performance",
        "   test for large result sets (e.g., 10k+ rows).",
        "",
        "Style compliance: consistent with project conventions.",
        "Regression risk: low.  Only the search route is affected.",
        "Security: no obvious issues.  Query params are validated.",
        "",
        "VERDICT: Ship it.",
      ].join("\n");

    default:
      return "Task completed successfully.";
  }
}

// ---------------------------------------------------------------------------
// Main — build and run the pipeline
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log(" Sequential Pipeline: explore → plan → implement → review");
  console.log(` Mode: ${USE_MOCK ? "MOCK (offline)" : "LIVE (LLM)"}`);
  console.log("=".repeat(60));
  console.log("");

  // --- 1. Create the runtime ---
  //
  // The runtime manages team state, task scheduling, and agent invocation.
  // It persists team state to .hax-agent/teams/<name>.json.
  //
  // We need a toolRegistryFactory so agents can actually use tools at
  // runtime.  Here we expose the full tool set; in production you might
  // scope per-agent (the runtime's createScopedToolRegistry does this
  // automatically based on each member's `tools` array).

  const projectRoot = path.resolve(__dirname, "..", "..");

  const toolRegistryFactory = (_member) => {
    const registry = new ToolRegistry({ root: projectRoot });
    // In a real setup, you'd register file/system tools here.
    // The runtime's createScopedToolRegistry will automatically filter
    // to only the tools each agent is allowed to use.
    return registry;
  };

  const provider = resolveProvider();

  const runtime = createTeamRuntime({
    projectRoot,
    provider,                // pre-resolved provider (real or mock)
    toolRegistryFactory,     // supplies tools to agents at runtime
  });

  console.log("[1/4] Creating team...");

  // --- 2. Create the team ---
  //
  // `createTeam` initializes the state file, registers the lead agent,
  // and spawns all listed members.

  const goal = "Add a search endpoint to the REST API that accepts query parameters and returns paginated results.";

  const { team, members } = runtime.createTeam({
    name: "search-endpoint-pipeline",
    mission: `Complete the following goal: ${goal}`,

    members: [
      {
        agentType: "explore",
        name: "code-explorer",
        role: "Maps existing routes, controllers, and service patterns relevant to the search feature.",
        model: provider.model,
      },
      {
        agentType: "planner",
        name: "task-planner",
        role: "Produces a sequenced, verifiable implementation plan from the exploration findings.",
        model: provider.model,
      },
      {
        agentType: "implementer",
        name: "code-implementer",
        role: "Makes focused code changes following the plan and project conventions.",
        model: provider.model,
      },
      {
        agentType: "reviewer",
        name: "code-reviewer",
        role: "Reviews the implementation for correctness, style, and regression risk.",
        model: provider.model,
      },
    ],
  });

  console.log(`   Team: ${team.teamName}`);
  console.log(`   Members: ${team.members.map((m) => m.name).join(", ")}`);
  console.log("");

  // --- 3. Add tasks with dependency edges ---
  //
  // Task IDs form a DAG.  The runtime will only start a task when all
  // of its `dependsOn` tasks have status "completed".

  console.log("[2/4] Creating task DAG...");

  const tasks = [
    runtime.addTask({
      id: "T1",
      title: "Explore codebase for search-related files and patterns",
      owner: "code-explorer",
      agentType: "explore",
      prompt: [
        `Goal: ${goal}`,
        "",
        "Survey the codebase. Find existing routes, controllers, services, and tests",
        "that relate to search or API endpoints.  Map the architecture, identify",
        "conventions (TypeScript usage, error handling patterns, test framework),",
        "and note any constraints or risks.",
        "",
        "Deliver a structured report covering:",
        "- File paths and their roles",
        "- Architectural patterns in use",
        "- Existing scaffolding that can be filled in",
        "- Implementation risks or hidden constraints",
      ].join("\n"),
      dependsOn: [],               // Phase 1 — no dependencies
      deliverable: "Codebase survey with file mapping and implementation guidance.",
    }),

    runtime.addTask({
      id: "T2",
      title: "Produce sequenced implementation plan",
      owner: "task-planner",
      agentType: "planner",
      prompt: [
        `Goal: ${goal}`,
        "",
        "Read the exploration output from T1.  Produce a concrete, step-by-step",
        "implementation plan.  For each step include:",
        "- Exact file to modify and what to do",
        "- Dependencies between steps",
        "- Risk assessment (low/medium/high)",
        "- Validation strategy (what test or build command to run)",
        "",
        "The plan must be specific enough that an implementer can execute it",
        "without further exploration.",
      ].join("\n"),
      dependsOn: ["T1"],           // Phase 2 — needs exploration results
      deliverable: "Step-by-step plan with file targets, risk notes, and validation commands.",
    }),

    runtime.addTask({
      id: "T3",
      title: "Implement the search endpoint",
      owner: "code-implementer",
      agentType: "implementer",
      prompt: [
        `Goal: ${goal}`,
        "",
        "Read the plan from T2 and the exploration findings from T1.",
        "Implement the changes file by file.  Follow the plan exactly.",
        "After each file edit, verify with the prescribed validation command.",
        "",
        "Return: a summary of every file changed, the conventions you followed,",
        "and a list of validation commands you ran with their results.",
      ].join("\n"),
      dependsOn: ["T2"],           // Phase 3 — needs the plan
      deliverable: "Working code changes with files touched and validation results.",
    }),

    runtime.addTask({
      id: "T4",
      title: "Review the implementation for correctness and quality",
      owner: "code-reviewer",
      agentType: "reviewer",
      prompt: [
        `Goal: ${goal}`,
        "",
        "Read the implementation output from T3.  Review every changed file.",
        "Evaluate:",
        "- Correctness: does it do what the plan and goal describe?",
        "- Style: does it follow project conventions?",
        "- Regression risk: could these changes break anything else?",
        "- Maintainability: is the code clear and well-structured?",
        "",
        "Classify each finding as BLOCKER (must fix) or SUGGESTION (nice-to-have).",
        "End with a VERDICT: APPROVED or NEEDS_CHANGES.",
      ].join("\n"),
      dependsOn: ["T3"],           // Phase 4 — needs the implementation
      deliverable: "Review report with findings classified by severity and a final verdict.",
    }),
  ];

  console.log("   Tasks created:");
  for (const task of tasks) {
    const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(", ")})` : " (no dependencies)";
    console.log(`     ${task.id}: ${task.title} → ${task.owner}${deps}`);
  }
  console.log("");

  // --- 4. Run the pipeline ---
  //
  // `runtime.run()` executes all ready tasks in dependency order.
  // Concurrency = 1 ensures strict sequential execution (each agent
  // reads the previous agent's output as dependency context).

  console.log("[3/4] Running pipeline (concurrency = 1)...");
  console.log("");

  const result = await runtime.run({ concurrency: 1 });

  console.log("[4/4] Pipeline complete.");
  console.log("");

  // --- 5. Display results ---

  const finalSnapshot = runtime.snapshot();

  console.log("-".repeat(60));
  console.log(" RESULTS");
  console.log("-".repeat(60));
  console.log("");

  console.log(`Team:    ${finalSnapshot.teamName}`);
  console.log(`Mission: ${finalSnapshot.mission}`);
  console.log(`Status:  ${result.run.status}`);
  console.log(`Time:    ${result.run.startedAt} → ${result.run.completedAt}`);
  console.log("");

  const progress = finalSnapshot.progress;
  console.log("Progress:");
  console.log(`  Total: ${progress.total}  Completed: ${progress.completed}  Failed: ${progress.failed}`);
  console.log(`  ${progress.percentComplete}% complete`);
  console.log("");

  // Print each task's outcome
  console.log("Task outcomes:");
  for (const task of finalSnapshot.tasks) {
    const owner = finalSnapshot.members.find((m) => m.name === task.owner);
    const agentType = owner ? `(${owner.agentType})` : "";
    const statusIcon = task.status === "completed" ? "OK" : task.status === "failed" ? "FAIL" : task.status.toUpperCase();
    console.log(`  [${statusIcon}] ${task.id}: ${task.title} → ${task.owner} ${agentType}`);

    if (task.result) {
      const preview = typeof task.result.content === "string"
        ? task.result.content.split("\n").slice(0, 3).join("\n")
        : JSON.stringify(task.result).slice(0, 120);
      console.log(`        Result preview: ${preview}...`);
    }

    if (task.error) {
      console.log(`        Error: ${task.error.message || String(task.error)}`);
    }
  }
  console.log("");

  // Print message log summary
  const msgs = finalSnapshot.messages;
  console.log(`Messages exchanged: ${msgs.length}`);
  for (const msg of msgs) {
    const preview = String(msg.body || "").slice(0, 80);
    console.log(`  ${msg.from} → ${msg.to}  [${msg.type}]  ${preview}...`);
  }

  console.log("");
  console.log("Done. Pipeline executed phases 1 → 2 → 3 → 4 in strict order.");
  console.log("");

  // Clean exit
  process.exit(result.run.status === "completed" ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("[pipeline-example] Unhandled error:", err);
  process.exit(1);
});
