"use strict";

// ---------------------------------------------------------------------------
// review-loop-example.js — Iterative Implementer + Reviewer Loop
//
// Demonstrates the **Review Loop** workflow pattern: an implementer makes
// changes, a reviewer inspects the result, and the cycle repeats until the
// reviewer approves (or a maximum number of iterations is reached).
//
// This is useful when:
//   - Code quality must meet a defined bar before merging.
//   - The implementer needs concrete feedback to improve.
//   - Review is mandatory (e.g., security-sensitive or API changes).
//
//   node examples/workflows/review-loop-example.js
//
// Pass --mock to use a canned provider instead of a real LLM.
// Pass --max-rounds=N to limit the loop (default: 3).
// ---------------------------------------------------------------------------

const path = require("node:path");

// --- project imports ------------------------------------------------------
const { createTeamRuntime } = require("../../src/teams/runtime");
const { createProvider } = require("../../src/providers/factory");
const { ToolRegistry } = require("../../src/tool-registry");

// ---------------------------------------------------------------------------
// Command-line flags
// ---------------------------------------------------------------------------

const USE_MOCK = process.argv.includes("--mock");

const MAX_ROUNDS = (() => {
  const flag = process.argv.find((a) => a.startsWith("--max-rounds="));
  if (flag) {
    const n = Number(flag.split("=")[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : 3;
  }
  return 3;
})();

// ---------------------------------------------------------------------------
// Helper: summarise task output for display / next-round prompts
// ---------------------------------------------------------------------------

function summarizeOutput(task) {
  if (!task || !task.result) return "(no output)";
  if (typeof task.result.content === "string") return task.result.content;
  return JSON.stringify(task.result, null, 2);
}

function shortSummary(text, limit) {
  limit = limit || 200;
  if (!text) return "(empty)";
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

// ---------------------------------------------------------------------------
// Provider: resolve real LLM or mock
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
      "[review-loop-example] No API key found.\n" +
      "  Set ANTHROPIC_API_KEY or run with --mock.\n",
    );
    process.exit(1);
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Mock provider — simulates an implementer who improves each round based
// on reviewer feedback, and a reviewer who gets stricter over time.
// ---------------------------------------------------------------------------

function createMockProvider() {
  // Round-tracking state (module-scoped so it persists across calls).
  let round = 0;

  return {
    name: "mock",
    model: "mock-model",
    apiKey: "mock-key",

    async *stream({ messages, system }) {
      const identity = system || "";
      let agentType = "unknown";

      if (identity.includes("implementation specialist") || identity.includes("code-implementer")) {
        agentType = "implementer";
      } else if (identity.includes("code review specialist") || identity.includes("code-reviewer")) {
        agentType = "reviewer";
      }

      // Extract the task prompt (the last user message)
      const userContent = messages.length > 0
        ? String(messages[messages.length - 1].content || "")
        : "";

      const response = mockRoundResponse(agentType, userContent, round);
      yield { type: "text", delta: response };
      yield { type: "usage", inputTokens: 20, outputTokens: response.length };
    },
  };

  function mockRoundResponse(agentType, prompt, _round) {
    // Increment round on each implementer call (a new round starts
    // when the implementer runs again after reviewer feedback).
    if (agentType === "implementer") {
      round += 1;
    }

    const roundLabel = `Round ${round}`;

    if (agentType === "implementer") {
      // --- IMPLEMENTER RESPONSES ---
      if (round === 1) {
        return [
          `IMPLEMENTATION — ${roundLabel}`,
          "",
          "Files changed:",
          "  src/services/user-service.ts   — Added rate-limit decorator",
          "  src/middleware/rate-limit.ts    — Created token-bucket rate limiter",
          "  test/rate-limit.test.ts         — 3 basic test cases",
          "",
          "Approach: Simple in-memory token bucket with configurable",
          "window size and request limit.",
        ].join("\n");
      }

      if (round === 2) {
        return [
          `IMPLEMENTATION — ${roundLabel} (addressing review feedback)`,
          "",
          "Changes made based on reviewer feedback:",
          "  src/middleware/rate-limit.ts    — Added Redis backend option",
          "                                  — Added user-tier support (free/premium)",
          "                                  — Added configurable burst allowance",
          "  test/rate-limit.test.ts         — Added 5 more test cases covering:",
          "                                    distributed consistency, user tiers,",
          "                                    burst behavior, config reload, cleanup",
          "  src/services/user-service.ts   — Wired user-tier into rate-limiter init",
          "",
          "Validation: npm t -- test/rate-limit.test.ts → 8/8 passing",
        ].join("\n");
      }

      // Round 3+
      return [
        `IMPLEMENTATION — ${roundLabel} (final refinements)`,
        "",
        "Final changes:",
        "  src/middleware/rate-limit.ts    — Added metrics export for monitoring",
        "                                  — Added graceful degradation (fallback to",
        "                                    allow-all if Redis is unreachable)",
        "  test/rate-limit.test.ts         — Now 12 tests covering all edge cases",
        "  src/config/rate-limit.ts        — Centralized config with schema validation",
        "",
        "Validation: npm t -- test/rate-limit.test.ts → 12/12 passing",
        "           npx tsc --noEmit → 0 errors",
      ].join("\n");
    }

    // --- REVIEWER RESPONSES ---
    if (round === 1) {
      return [
        `REVIEW — ${roundLabel}`,
        "",
        "VERDICT: NEEDS_CHANGES",
        "",
        "Blockers:",
        "1. In-memory only.  Won't work with multiple server instances.",
        "   Must support a Redis backend or at minimum document the limitation.",
        "2. No user-tier differentiation.  Free-tier and premium users",
        "   should have different rate limits.",
        "",
        "Suggestions:",
        "- Add a burst allowance (e.g., 20% over the steady limit for spikes).",
        "- More test coverage: distributed consistency, tier boundaries.",
        "- Config should be reloadable without restart.",
        "",
        "NEXT: Please address the two blockers for round 2.",
      ].join("\n");
    }

    if (round === 2) {
      return [
        `REVIEW — ${roundLabel}`,
        "",
        "VERDICT: NEEDS_CHANGES (minor remaining issues)",
        "",
        "Blockers: None resolved.",
        "",
        "Suggestions (from round 1, partially addressed):",
        "1. Redis backend added — good.  But what happens when Redis",
        "   is unreachable?  Should fail open or closed?  Add explicit",
        "   configuration for failure mode.",
        "2. User tiers added — good.  But test coverage for tier",
        "   boundary edge cases is still light.",
        "3. (New) Consider adding a metrics export so monitoring tools",
        "   can observe rate-limit behavior in production.",
        "",
        "NEXT: One more round to polish these items.",
      ].join("\n");
    }

    // Round 3 — approval
    return [
      `REVIEW — ${roundLabel}`,
      "",
      "VERDICT: APPROVED",
      "",
      "All previous issues addressed:",
      "- Redis backend with configurable fail-open / fail-closed mode.",
      "- User tiers with proper test coverage (12 tests).",
      "- Metrics export for monitoring.",
      "- Centralized config with schema validation.",
      "- Graceful degradation when Redis is unreachable.",
      "",
      "No blockers.  Code is clean, follows project conventions, and",
      "has comprehensive test coverage.",
      "",
      "SHIP IT.",
    ].join("\n");
  }
}

// ---------------------------------------------------------------------------
// Core: run a single review round
// ---------------------------------------------------------------------------

/**
 * Run one review round: implementer creates/fixes code, reviewer evaluates.
 *
 * @param {TeamRuntime} runtime
 * @param {object} goal — { description, expectedOutput }
 * @param {Array}  previousFeedback — reviewer feedback from prior rounds
 * @param {number} roundNumber
 * @returns {Promise<{ implementResult, reviewResult, approved }>}
 */
async function runReviewRound(runtime, goal, previousFeedback, roundNumber) {
  const label = `R${roundNumber}`;

  // --- Build the implementer prompt ---
  //
  // Round 1: fresh implementation from scratch.
  // Round 2+: include all previous reviewer feedback so the implementer
  //           knows exactly what to fix.
  let implementPrompt;
  if (previousFeedback.length === 0) {
    implementPrompt = [
      `You are the implementer.`,
      `Goal: ${goal.description}`,
      `Expected output: ${goal.expectedOutput}`,
      "",
      "Implement the solution. Follow the project's existing conventions.",
      "After implementing, validate your work (run tests, typecheck, lint).",
      "Return a summary of files changed, validation results, and any",
      "trade-offs you made.",
    ].join("\n");
  } else {
    const feedbackText = previousFeedback
      .map((fb, i) => `[Round ${i + 1} feedback]:\n${fb}`)
      .join("\n\n");
    implementPrompt = [
      `You are the implementer.`,
      `Goal: ${goal.description}`,
      "",
      `This is round ${roundNumber}.  You received the following feedback`,
      `on your previous attempt.  Address all blocker-level issues before`,
      `working on suggestions.`,
      "",
      feedbackText,
      "",
      "Implement the fixes and improvements requested above.",
      "Validate your work and return a summary of what changed.",
    ].join("\n");
  }

  // --- Submit the implementer task and run it ---
  const implTask = runtime.addTask({
    id: `I${label}`,
    title: `Implement (round ${roundNumber})`,
    owner: "code-implementer",
    agentType: "implementer",
    prompt: implementPrompt,
    dependsOn: [],
    deliverable: `Implementation output for round ${roundNumber}`,
  });

  await runtime.run({ concurrency: 1 });

  const implResult = runtime.snapshot().tasks.find((t) => t.id === implTask.id);

  console.log(`  Implementer output (${roundLabel}):`);
  console.log(`    Status: ${implResult.status}`);
  console.log(`    ${shortSummary(summarizeOutput(implResult), 250)}`);
  console.log("");

  if (implResult.status === "failed") {
    throw new Error(`Implementation failed in round ${roundNumber}: ${String(implResult.error?.message || implResult.error)}`);
  }

  // --- Build the reviewer prompt ---
  //
  // The reviewer sees the full implementation output and evaluates it
  // against the goal and any standards we want enforced.

  const reviewPrompt = [
    `You are the code reviewer.`,
    `Original goal: ${goal.description}`,
    `Expected output: ${goal.expectedOutput}`,
    "",
    "Below is the implementer's output from this round.  Review it.",
    "",
    "Evaluate:",
    "- Correctness: does it meet the goal?",
    "- Style: consistent with project conventions?",
    "- Completeness: are there gaps or missing edge cases?",
    "- Risk: could this break existing functionality?",
    "",
    "Classify each finding as:",
    "  BLOCKER — must fix before approval",
    "  SUGGESTION — nice to have, not blocking",
    "",
    "End with VERDICT: APPROVED or NEEDS_CHANGES.",
    "",
    "Implementation output:",
    summarizeOutput(implResult),
  ].join("\n");

  // --- Submit the reviewer task and run it ---
  const reviewTask = runtime.addTask({
    id: `R${label}`,
    title: `Review (round ${roundNumber})`,
    owner: "code-reviewer",
    agentType: "reviewer",
    prompt: reviewPrompt,
    dependsOn: [implTask.id],
    deliverable: `Review verdict for round ${roundNumber}`,
  });

  await runtime.run({ concurrency: 1 });

  const reviewResult = runtime.snapshot().tasks.find((t) => t.id === reviewTask.id);

  console.log(`  Reviewer output (${roundLabel}):`);
  console.log(`    Status: ${reviewResult.status}`);

  const reviewText = summarizeOutput(reviewResult);
  console.log(`    ${shortSummary(reviewText, 300)}`);
  console.log("");

  // --- Interpret the reviewer's verdict ---
  //
  // We look for "APPROVED" in the output.  The reviewer must include
  // VERDICT: APPROVED exactly for us to stop the loop.
  const approved = /VERDICT:\s*APPROVED/i.test(reviewText);

  return { implementResult: implResult, reviewResult, approved, reviewText };
}

// ---------------------------------------------------------------------------
// Main — create team, run review loop, print final summary
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log(" Review Loop: implementer ↔ reviewer cycle");
  console.log(` Mode: ${USE_MOCK ? "MOCK (offline)" : "LIVE (LLM)"}`);
  console.log(` Max rounds: ${MAX_ROUNDS}`);
  console.log("=".repeat(60));
  console.log("");

  // --- 1. Create runtime and team ---

  const projectRoot = path.resolve(__dirname, "..", "..");
  const provider = resolveProvider();

  const toolRegistryFactory = (_member) => new ToolRegistry({ root: projectRoot });

  const runtime = createTeamRuntime({
    projectRoot,
    provider,
    toolRegistryFactory,
  });

  const goal = {
    description:
      "Add a configurable rate-limiter middleware that enforces per-user " +
      "request limits with a token-bucket algorithm.  Must handle distributed " +
      "deployments (multiple server instances) and support different tiers " +
      "(free vs premium users).",
    expectedOutput:
      "A rate-limit middleware in src/middleware/rate-limit.ts, tests in " +
      "test/rate-limit.test.ts, and any necessary config updates.",
  };

  console.log("[1/3] Creating team...");
  runtime.createTeam({
    name: "review-loop-team",
    mission: `Implement rate-limit middleware with iterative review.  Goal: ${goal.description}`,
    members: [
      {
        agentType: "implementer",
        name: "code-implementer",
        role: "Writes the rate-limit middleware following project conventions.",
        model: provider.model,
      },
      {
        agentType: "reviewer",
        name: "code-reviewer",
        role: "Reviews each implementation attempt and provides concrete, actionable feedback.",
        model: provider.model,
      },
    ],
  });

  console.log(`   Team: review-loop-team`);
  console.log(`   Members: code-implementer, code-reviewer`);
  console.log("");

  // --- 2. Review loop ---

  console.log("[2/3] Running review loop...");
  console.log("");

  const history = [];
  const feedbackLog = [];
  let finalVerdict = false;
  let lastRound = 0;

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    console.log(`--- Round ${round} / ${MAX_ROUNDS} ---`);
    console.log("");

    const { implementResult, reviewResult, approved, reviewText } =
      await runReviewRound(runtime, goal, feedbackLog, round);

    history.push({ round, implementResult, reviewResult });

    // Store the reviewer's full feedback for the next round
    if (!approved) {
      // Extract the substantive part of the review for the implementer
      const clean = reviewText
        .replace(/NEXT:.*$/im, "")       // Strip the "NEXT:" instruction
        .replace(/REVIEW — Round \d+/i, "")
        .trim();
      feedbackLog.push(clean || reviewResult.result?.content || "");
    }

    lastRound = round;

    if (approved) {
      finalVerdict = true;
      console.log("  >>> REVIEWER APPROVED — loop complete.");
      console.log("");
      break;
    }

    console.log(`  >>> Reviewer requested changes.  Continuing to round ${round + 1}...`);
    console.log("");
  }

  // --- 3. Print final summary ---

  console.log("[3/3] Summary");
  console.log("");
  console.log("-".repeat(60));

  if (finalVerdict) {
    console.log(" RESULT: APPROVED after " + lastRound + " round(s)");
  } else {
    console.log(" RESULT: MAX ROUNDS REACHED (" + MAX_ROUNDS + ") without approval");
  }

  console.log("-".repeat(60));
  console.log("");

  // Show round-by-round timeline
  for (const entry of history) {
    const r = entry.round;
    const impl = entry.implementResult;
    const rev = entry.reviewResult;
    const approveIcon = /APPROVED/i.test(summarizeOutput(rev)) ? "ok" : "fix";

    console.log(`Round ${r} | impl: ${impl.status} | review: ${rev.status} (${approveIcon})`);
  }

  console.log("");

  const progress = runtime.getProgress();
  console.log(`Total tasks: ${progress.total}  Completed: ${progress.completed}  Failed: ${progress.failed}`);
  console.log("");

  console.log("Done. The review loop pattern ensures quality through iterative feedback.");
  console.log("");

  process.exit(finalVerdict ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("[review-loop-example] Unhandled error:", err);
  process.exit(1);
});
