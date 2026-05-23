"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { CIPipeline, PipelineError } = require("../../src/ci/pipeline");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeStep(name, run) {
  return { name, run };
}

function pipelineWithStages(...stages) {
  const p = new CIPipeline();
  p.define("test-pipeline", stages);
  return p;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("CIPipeline", () => {
  // 1. define and list pipelines
  it("should define a pipeline and list it", () => {
    const ci = new CIPipeline();
    ci.define("my-pipeline", [
      { name: "checkout", steps: [] },
      { name: "test", steps: [] },
    ]);

    assert.ok(ci.list().includes("my-pipeline"));
    assert.strictEqual(ci.list().length, 1);
  });

  // 2. define with invalid args
  it("should throw on invalid pipeline name", () => {
    const ci = new CIPipeline();
    assert.throws(() => ci.define(""), { code: "INVALID_NAME" });
  });

  it("should throw on empty stages array", () => {
    const ci = new CIPipeline();
    assert.throws(() => ci.define("p", []), { code: "INVALID_STAGES" });
  });

  // 3. run a simple pipeline with success
  it("should run a simple pipeline successfully", async () => {
    const ci = new CIPipeline();
    const steps = [];
    const captured = [];

    ci.define("build", [
      {
        name: "checkout",
        steps: [makeStep("clone", async (ctx) => {
          captured.push("clone");
          return { repo: "cloned" };
        })],
      },
      {
        name: "install",
        steps: [makeStep("deps", async (ctx) => {
          captured.push("install");
          return { deps: "installed" };
        })],
      },
    ]);

    const result = await ci.run("build");

    assert.strictEqual(result.status, "completed");
    assert.strictEqual(result.totalStages, 2);
    assert.strictEqual(result.completedStages, 2);
    assert.strictEqual(result.failedStages, 0);
    assert.deepStrictEqual(captured, ["clone", "install"]);
  });

  // 4. run with string options
  it("should accept pipeline name as string option", async () => {
    const ci = new CIPipeline();
    ci.define("lint", [
      { name: "lint", steps: [makeStep("check", async () => ({ ok: true }))] },
    ]);

    const result = await ci.run("lint");
    assert.strictEqual(result.status, "completed");
  });

  // 5. run with context
  it("should pass context through to steps", async () => {
    const ci = new CIPipeline();
    let received = null;

    ci.define("ctx-test", [
      {
        name: "build",
        steps: [makeStep("compile", async (ctx) => {
          received = ctx;
          return ctx.mode;
        })],
      },
    ]);

    const result = await ci.run({ name: "ctx-test", context: { mode: "production" } });
    assert.deepStrictEqual(received, { mode: "production" });
    assert.strictEqual(result.status, "completed");
  });

  // 6. fail stage without continueOnError
  it("should fail pipeline when a stage errors and continueOnError is false", async () => {
    const ci = new CIPipeline();
    ci.define("fail-test", [
      {
        name: "checkout",
        steps: [makeStep("clone", async () => ({ ok: true }))],
      },
      {
        name: "build",
        steps: [makeStep("compile", async () => {
          throw new Error("build failed");
        })],
      },
      {
        name: "deploy",
        steps: [makeStep("ship", async () => ({ deployed: true }))],
      },
    ]);

    const result = await ci.run("fail-test");
    assert.strictEqual(result.status, "failed");
    assert.ok(result.error);
    assert.ok(result.error.message.includes("build failed"));
  });

  // 7. continueOnError on a stage
  it("should continue pipeline when a stage has continueOnError", async () => {
    const ci = new CIPipeline();
    const captured = [];

    ci.define("continue-test", [
      {
        name: "install",
        steps: [makeStep("deps", async () => captured.push("install"))],
      },
      {
        name: "lint",
        steps: [makeStep("check", async () => {
          captured.push("lint");
          throw new Error("lint failed");
        })],
        continueOnError: true,
      },
      {
        name: "build",
        steps: [makeStep("compile", async () => captured.push("build"))],
      },
    ]);

    const result = await ci.run("continue-test");
    assert.strictEqual(result.status, "completed");
    assert.deepStrictEqual(captured, ["install", "lint", "build"]);

    // Check the lint stage was recorded as failed_but_continued
    const lintStage = result.stages.find((s) => s.name === "lint");
    assert.strictEqual(lintStage.status, "failed_but_continued");
  });

  // 8. getDefinition
  it("should return a pipeline definition", () => {
    const ci = new CIPipeline();
    const stages = [
      { name: "checkout", steps: [makeStep("clone", async () => {})] },
      { name: "test", steps: [] },
    ];
    ci.define("my-ci", stages);

    const def = ci.getDefinition("my-ci");
    assert.strictEqual(def.name, "my-ci");
    assert.strictEqual(def.stages.length, 2);
  });

  it("should throw if pipeline not found in getDefinition", () => {
    const ci = new CIPipeline();
    assert.throws(() => ci.getDefinition("nope"), { code: "NOT_FOUND" });
  });

  // 9. status check
  it("should return current status via status()", async () => {
    const ci = new CIPipeline();
    ci.define("status-test", [
      { name: "build", steps: [makeStep("s", async () => ({ ok: true }))] },
    ]);

    const result = await ci.run("status-test");

    // After completion, status() can be queried via history
    const statusObj = ci.status(result.runId);
    assert.strictEqual(statusObj.runId, result.runId);
    assert.strictEqual(statusObj.status, "completed");
  });

  // 10. cancel
  it("should cancel a running pipeline", async () => {
    const ci = new CIPipeline();

    ci.define("cancel-test", [
      {
        name: "slow-stage",
        steps: [makeStep("wait", async () => {
          await sleep(500);
          return {};
        })],
      },
      {
        name: "post-stage",
        steps: [makeStep("post", async () => ({ ok: true }))],
      },
    ]);

    // Register listener BEFORE starting the run
    let capturedRunId = null;
    ci.on("pipeline.start", (evt) => {
      capturedRunId = evt.runId;
    });

    // Start run
    const runPromise = ci.run("cancel-test");

    // Give it a moment to enter the slow step
    await sleep(30);

    if (capturedRunId) {
      const cancelled = ci.cancel(capturedRunId);
      assert.ok(cancelled);
    }

    const result = await runPromise;
    assert.strictEqual(result.status, "cancelled");
  });

  // 11. getHistory
  it("should return run history", async () => {
    const ci = new CIPipeline();
    ci.define("hist-test", [
      { name: "checkout", steps: [makeStep("c", async () => ({}))] },
    ]);

    await ci.run("hist-test");
    await ci.run("hist-test");

    const history = ci.getHistory();
    assert.ok(history.length >= 2);
  });

  // 12. getHistory with filters
  it("should filter history by pipeline name", async () => {
    const ci = new CIPipeline();
    ci.define("pipe-a", [
      { name: "checkout", steps: [makeStep("c", async () => ({}))] },
    ]);
    ci.define("pipe-b", [
      { name: "checkout", steps: [makeStep("c", async () => ({}))] },
    ]);

    await ci.run("pipe-a");
    await ci.run("pipe-b");

    const filtered = ci.getHistory({ pipelineName: "pipe-a" });
    assert.ok(filtered.every((r) => r.pipelineName === "pipe-a"));
  });

  // 13. remove pipeline
  it("should remove a pipeline definition", () => {
    const ci = new CIPipeline();
    ci.define("tmp", [
      { name: "checkout", steps: [] },
    ]);

    assert.ok(ci.list().includes("tmp"));
    ci.remove("tmp");
    assert.ok(!ci.list().includes("tmp"));
  });

  // 14. events
  it("should emit expected lifecycle events", async () => {
    const ci = new CIPipeline();
    const events = [];

    ci.on("pipeline.start", () => events.push("start"));
    ci.on("stage.start", () => events.push("stage.start"));
    ci.on("stage.complete", () => events.push("stage.complete"));
    ci.on("pipeline.complete", () => events.push("complete"));

    ci.define("event-test", [
      { name: "build", steps: [makeStep("s", async () => ({}))] },
    ]);

    await ci.run("event-test");

    assert.ok(events.includes("start"));
    assert.ok(events.includes("stage.start"));
    assert.ok(events.includes("stage.complete"));
    assert.ok(events.includes("complete"));
  });

  // 15. step error event
  it("should emit step.error on step failure", async () => {
    const ci = new CIPipeline();
    const stepErrors = [];

    ci.on("step.error", (evt) => stepErrors.push(evt));

    ci.define("step-fail-test", [
      {
        name: "build",
        steps: [makeStep("bad-step", async () => {
          throw new Error("step went wrong");
        })],
      },
    ]);

    await ci.run("step-fail-test");
    assert.strictEqual(stepErrors.length, 1);
    assert.strictEqual(stepErrors[0].stepName, "bad-step");
    assert.strictEqual(stepErrors[0].error.message, "step went wrong");
  });
});
