/**
 * Tests for WorkflowEngine: define, run, runParallel, status, cancel,
 * retry, timeout, continueOnError, conditions, event emission.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkflowEngine } = require("../../src/workflow/engine");

// Helper: create a simple tool handler that succeeds
function succeedHandler(result) {
  return function (context, config) {
    return Promise.resolve(result !== undefined ? result : { ok: true, config });
  };
}

// Helper: create a handler that fails
function failHandler(message) {
  return function () {
    return Promise.reject(new Error(message || "step failed"));
  };
}

// Helper: create a handler that resolves after a delay
function delayHandler(ms, result) {
  return function () {
    return new Promise((resolve) => setTimeout(() => resolve(result || { ok: true }), ms));
  };
}

// ---- define ----

test("define: registers a workflow with valid steps", () => {
  const engine = new WorkflowEngine();
  engine.define("my-workflow", [
    { id: "s1", name: "Step 1", type: "tool", config: { handler: succeedHandler() } },
  ]);

  const def = engine.getDefinition("my-workflow");
  assert.equal(def.name, "my-workflow");
  assert.equal(def.steps.length, 1);
  assert.equal(def.steps[0].id, "s1");
});

test("define: throws for empty name", () => {
  const engine = new WorkflowEngine();
  assert.throws(() => engine.define("", []), { message: /non-empty string/ });
  assert.throws(() => engine.define("   ", []), { message: /non-empty string/ });
});

test("define: throws for non-array steps", () => {
  const engine = new WorkflowEngine();
  assert.throws(() => engine.define("w", null), { message: /must be an array/ });
  assert.throws(() => engine.define("w", "not-array"), { message: /must be an array/ });
});

test("define: throws for invalid step type", () => {
  const engine = new WorkflowEngine();
  assert.throws(
    () => engine.define("w", [{ id: "s1", type: "invalid_type" }]),
    { message: /invalid type/ },
  );
});

test("define: throws for duplicate step ids", () => {
  const engine = new WorkflowEngine();
  assert.throws(
    () =>
      engine.define("w", [
        { id: "dup", type: "tool", config: { handler: succeedHandler() } },
        { id: "dup", type: "tool", config: { handler: succeedHandler() } },
      ]),
    { message: /Duplicate step/ },
  );
});

test("define: throws for circular dependencies", () => {
  const engine = new WorkflowEngine();
  assert.throws(
    () =>
      engine.define("w", [
        { id: "a", type: "tool", dependsOn: ["b"], config: { handler: succeedHandler() } },
        { id: "b", type: "tool", dependsOn: ["a"], config: { handler: succeedHandler() } },
      ]),
    { message: /Circular dependency/ },
  );
});

test("define: throws for unknown dependsOn reference", () => {
  const engine = new WorkflowEngine();
  assert.throws(
    () =>
      engine.define("w", [
        { id: "a", type: "tool", dependsOn: ["nonexistent"], config: { handler: succeedHandler() } },
      ]),
    { message: /unknown step/ },
  );
});

// ---- run (sequential) ----

test("run: executes all steps in order and returns status", async () => {
  const engine = new WorkflowEngine();
  const executionOrder = [];

  engine.define("seq", [
    { id: "s1", type: "tool", config: { handler: succeedHandler() } },
    { id: "s2", type: "tool", dependsOn: ["s1"], config: { handler: succeedHandler() } },
    { id: "s3", type: "tool", dependsOn: ["s2"], config: { handler: succeedHandler() } },
  ]);

  const events = [];
  engine.on("step.complete", (data) => events.push(data.stepId));

  const result = await engine.run("seq", { key: "val" });

  assert.equal(result.status, "completed");
  assert.equal(result.workflowName, "seq");
  assert.equal(events.length, 3);
  assert.deepEqual(events, ["s1", "s2", "s3"]);
  assert.equal(result.context.key, "val");
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].status, "completed");

  // Verify steps ran sequentially by checking timestamps
  const startTimes = result.steps.map((s) => new Date(s.startedAt).getTime());
  assert.ok(startTimes[0] <= startTimes[1]);
  assert.ok(startTimes[1] <= startTimes[2]);
});

test("run: emits workflow.complete event on success", async () => {
  const engine = new WorkflowEngine();
  engine.define("emit-test", [
    { id: "s1", type: "tool", config: { handler: succeedHandler() } },
  ]);

  const events = [];
  engine.on("step.start", (data) => events.push({ event: "step.start", stepId: data.stepId }));
  engine.on("step.complete", (data) => events.push({ event: "step.complete", stepId: data.stepId }));
  engine.on("workflow.complete", (data) => events.push({ event: "workflow.complete", status: data.status }));

  await engine.run("emit-test");

  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { event: "step.start", stepId: "s1" });
  assert.deepEqual(events[1], { event: "step.complete", stepId: "s1" });
  assert.deepEqual(events[2], { event: "workflow.complete", status: "completed" });
});

test("run: fails when a step throws and returns error", async () => {
  const engine = new WorkflowEngine();
  engine.define("fail", [
    { id: "s1", type: "tool", config: { handler: succeedHandler() } },
    { id: "s2", type: "tool", config: { handler: failHandler("boom") }, dependsOn: ["s1"] },
    { id: "s3", type: "tool", config: { handler: succeedHandler() }, dependsOn: ["s2"] },
  ]);

  const stepEvents = [];
  engine.on("step.error", (data) => stepEvents.push({ stepId: data.stepId, message: data.error.message }));
  engine.on("workflow.complete", (data) => {
    stepEvents.push({ event: "workflow.complete", status: data.status, errorMessage: data.error?.message });
  });

  const result = await engine.run("fail");

  assert.equal(result.status, "failed");
  assert.ok(result.error.message.includes("boom"));
  assert.equal(result.steps[0].status, "completed");
  assert.equal(result.steps.length, 3);
});

// ---- retry on failure ----

test("retry: retries a failing step and succeeds on second attempt", async () => {
  const engine = new WorkflowEngine();
  let attempts = 0;

  engine.define("retry-test", [
    {
      id: "flaky",
      type: "tool",
      config: {
        handler: () => {
          attempts += 1;
          if (attempts < 2) {
            return Promise.reject(new Error("transient failure"));
          }
          return Promise.resolve({ ok: true });
        },
      },
      retryCount: 3,
      retryDelay: 10,
    },
  ]);

  const errorEvents = [];
  engine.on("step.error", (data) => errorEvents.push(data));

  const result = await engine.run("retry-test");
  assert.equal(result.status, "completed");
  assert.equal(attempts, 2);
  assert.equal(errorEvents.length, 1); // one error before retry succeeds
});

test("retry: exhausts retries and fails the workflow", async () => {
  const engine = new WorkflowEngine();

  engine.define("exhaust", [
    {
      id: "fail",
      type: "tool",
      config: { handler: failHandler("permanent failure") },
      retryCount: 2,
      retryDelay: 10,
    },
  ]);

  const errorEvents = [];
  engine.on("step.error", (data) => errorEvents.push(data));

  const result = await engine.run("exhaust");
  assert.equal(result.status, "failed");
  assert.equal(errorEvents.length, 3); // initial + 2 retries
});

// ---- continueOnError ----

test("continueOnError: skips failed step and continues workflow", async () => {
  const engine = new WorkflowEngine();
  const executed = [];

  engine.define("continue-test", [
    {
      id: "s1",
      type: "tool",
      config: {
        handler: () => {
          executed.push("s1");
          return Promise.reject(new Error("non-critical failure"));
        },
      },
      continueOnError: true,
    },
    {
      id: "s2",
      type: "tool",
      config: {
        handler: () => {
          executed.push("s2");
          return Promise.resolve({ ok: true });
        },
      },
      dependsOn: ["s1"],
    },
  ]);

  const result = await engine.run("continue-test");

  assert.equal(result.status, "completed");
  assert.deepEqual(executed, ["s1", "s2"]);
  assert.equal(result.steps[0].status, "failed_but_continued");
  assert.equal(result.steps[1].status, "completed");
});

// ---- timeout ----

test("timeout: fails a step that exceeds its timeout", async () => {
  const engine = new WorkflowEngine();

  engine.define("timeout-test", [
    {
      id: "slow",
      type: "tool",
      config: { handler: delayHandler(500, { slow: true }) },
      timeout: 50,
    },
  ]);

  const result = await engine.run("timeout-test");
  assert.equal(result.status, "failed");
  assert.ok(result.error.message.includes("timed out"));
});

test("timeout: completes a step within its timeout window", async () => {
  const engine = new WorkflowEngine();

  engine.define("not-timeout", [
    {
      id: "fast",
      type: "tool",
      config: { handler: delayHandler(10, { fast: true }) },
      timeout: 5000,
    },
  ]);

  const result = await engine.run("not-timeout");
  assert.equal(result.status, "completed");
  assert.equal(result.steps[0].status, "completed");
});

// ---- condition step ----

test("condition: skips step when condition evaluates to false", async () => {
  const engine = new WorkflowEngine();

  engine.define("cond-false", [
    {
      id: "s1",
      type: "tool",
      config: { handler: () => Promise.resolve({ ran: true }) },
      condition: () => false,
    },
  ]);

  const events = [];
  engine.on("step.skip", (data) => events.push(data));

  const result = await engine.run("cond-false");
  assert.equal(result.status, "completed");
  assert.equal(events.length, 1);
  assert.equal(events[0].stepId, "s1");
  assert.equal(events[0].reason, "condition evaluated to false");
});

test("condition: runs step when condition evaluates to true", async () => {
  const engine = new WorkflowEngine();

  engine.define("cond-true", [
    {
      id: "s1",
      type: "tool",
      config: { handler: () => Promise.resolve({ ran: true }) },
      condition: () => true,
    },
  ]);

  const result = await engine.run("cond-true");
  assert.equal(result.status, "completed");
  assert.equal(result.steps[0].status, "completed");
});

// ---- wait step ----

test("wait: waits for configured duration", async () => {
  const engine = new WorkflowEngine();

  engine.define("wait-test", [
    { id: "w", type: "wait", config: { duration: 50 } },
  ]);

  const start = Date.now();
  const result = await engine.run("wait-test");
  const elapsed = Date.now() - start;

  assert.equal(result.status, "completed");
  assert.ok(elapsed >= 45, `Expected >= 45ms, got ${elapsed}ms`);
});

// ---- cancel ----

test("cancel: cancels a running workflow", async () => {
  const engine = new WorkflowEngine();

  let stepEntered = false;
  let barrierResolve;

  engine.define("cancel-test", [
    {
      id: "block",
      type: "tool",
      config: {
        handler: () =>
          new Promise((resolve) => {
            stepEntered = true;
            // Resolve only when the test signals
            barrierResolve = () => resolve({ ok: true });
          }),
      },
    },
  ]);

  let capturedRunId = null;
  engine.on("step.start", (data) => {
    capturedRunId = data.runId;
  });

  const cancelEvents = [];
  engine.on("workflow.cancel", (data) => cancelEvents.push(data));

  const runPromise = engine.run("cancel-test");

  // Wait for the step to start
  while (!stepEntered) {
    await sleep(5);
  }

  // Cancelling a non-existent run returns false
  assert.equal(engine.cancel("nonexistent"), false);

  // Now cancel the actual run
  const wasCancelled = engine.cancel(capturedRunId);
  assert.equal(wasCancelled, true);

  // Release the barrier so the run can finish
  if (barrierResolve) barrierResolve();

  const result = await runPromise;
  assert.equal(result.status, "cancelled");
  assert.equal(cancelEvents.length, 1);
  assert.equal(cancelEvents[0].runId, capturedRunId);
});

// ---- runParallel ----

test("runParallel: executes independent steps concurrently", async () => {
  const engine = new WorkflowEngine();
  let s1Done = false;
  let s2Done = false;

  engine.define("parallel-test", [
    {
      id: "a",
      type: "tool",
      config: {
        handler: () =>
          new Promise((resolve) =>
            setTimeout(() => {
              s1Done = true;
              resolve({ step: "a" });
            }, 50),
          ),
      },
    },
    {
      id: "b",
      type: "tool",
      config: {
        handler: () =>
          new Promise((resolve) =>
            setTimeout(() => {
              s2Done = true;
              resolve({ step: "b" });
            }, 50),
          ),
      },
    },
  ]);

  const result = await engine.runParallel("parallel-test");

  assert.equal(result.status, "completed");
  assert.ok(s1Done);
  assert.ok(s2Done);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps.every((s) => s.status === "completed"), true);
});

test("runParallel: fails if any step fails without continueOnError", async () => {
  const engine = new WorkflowEngine();

  engine.define("parallel-fail", [
    { id: "a", type: "tool", config: { handler: succeedHandler() } },
    { id: "b", type: "tool", config: { handler: failHandler("parallel boom") } },
  ]);

  const result = await engine.runParallel("parallel-fail");

  assert.equal(result.status, "failed");
  assert.ok(result.error.message.includes("parallel boom"));
});

// ---- status ----

test("status: throws for unknown runId", () => {
  const engine = new WorkflowEngine();
  assert.throws(() => engine.status("nonexistent"), { message: /Run not found/ });
});

// ---- list / remove / getDefinition ----

test("list: returns names of all defined workflows", () => {
  const engine = new WorkflowEngine();
  engine.define("a", [{ id: "s1", type: "tool", config: { handler: succeedHandler() } }]);
  engine.define("b", [{ id: "s2", type: "tool", config: { handler: succeedHandler() } }]);

  const names = engine.list();
  assert.deepEqual(names, ["a", "b"]);
});

test("remove: removes a workflow", () => {
  const engine = new WorkflowEngine();
  engine.define("temp", [{ id: "s1", type: "tool", config: { handler: succeedHandler() } }]);

  assert.equal(engine.remove("temp"), true);
  assert.equal(engine.remove("temp"), false);
  assert.throws(() => engine.getDefinition("temp"), { message: /not found/ });
});

test("getDefinition: throws for unknown workflow", () => {
  const engine = new WorkflowEngine();
  assert.throws(() => engine.getDefinition("nope"), { message: /not found/ });
});

// ---- parallel step type (nested parallel) ----

test("parallel step type: runs sub-steps concurrently", async () => {
  const engine = new WorkflowEngine();

  engine.define("nested-parallel", [
    {
      id: "group",
      type: "parallel",
      config: {
        steps: [
          { id: "sub-a", type: "tool", config: { handler: delayHandler(20, "a") } },
          { id: "sub-b", type: "tool", config: { handler: delayHandler(20, "b") } },
        ],
      },
    },
  ]);

  const result = await engine.run("nested-parallel");
  assert.equal(result.status, "completed");
  assert.equal(result.steps[0].status, "completed");
  assert.ok(result.steps[0].result.parallel);
  assert.equal(result.steps[0].result.parallel.length, 2);
});

// ---- condition step type ----

test("condition step type: evaluates and returns condition result", async () => {
  const engine = new WorkflowEngine();

  engine.define("cond-eval", [
    { id: "check", type: "condition", config: { evaluate: () => true } },
  ]);

  const result = await engine.run("cond-eval");
  assert.equal(result.status, "completed");
  assert.equal(result.steps[0].status, "completed");
  assert.deepEqual(result.steps[0].result, { condition: true });
});

// ---- helper ----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
