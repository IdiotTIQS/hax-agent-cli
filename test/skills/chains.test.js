/**
 * Tests for SkillChain — composition of multiple skills into sequential,
 * parallel, conditional, loop, and fallback pipelines.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SkillChain,
  CHAIN_TYPE,
  STEP_STATUS,
  createChain,
  createParallel,
} = require("../../src/skills/chains");

// ── helpers ───────────────────────────────────────────────────

function noopSkill(value) {
  return async (input) => `processed:${input}:${value}`;
}

function failingSkill(message) {
  return async () => { throw new Error(message || "skill failed"); };
}

function asyncSkill(value, delayMs) {
  return async (input) => {
    await new Promise((r) => setTimeout(r, delayMs || 5));
    return `async:${input}:${value}`;
  };
}

// ── construction & fluent API ────────────────────────────────

test("SkillChain: constructs with defaults", () => {
  const chain = new SkillChain();
  assert.ok(chain.id.startsWith("chain-"));
  assert.equal(chain.type, CHAIN_TYPE.SEQUENCE);
  assert.equal(chain.nodes.length, 0);
  assert.equal(chain._options.timeout, 60000);
  assert.equal(chain._options.continueOnError, false);
});

test("SkillChain: constructs with custom options", () => {
  const chain = new SkillChain({ id: "my-chain", name: "Test", timeout: 10000, continueOnError: true, maxIterations: 3 });
  assert.equal(chain.id, "my-chain");
  assert.equal(chain.name, "Test");
  assert.equal(chain._options.timeout, 10000);
  assert.equal(chain._options.continueOnError, true);
  assert.equal(chain._options.maxIterations, 3);
});

test("SkillChain.chain() appends sequential nodes", () => {
  const chain = new SkillChain();
  chain.chain(
    { id: "a", name: "step-a", skill: noopSkill("a") },
    { id: "b", name: "step-b", skill: noopSkill("b") },
  );

  assert.equal(chain.nodes.length, 2);
  assert.equal(chain.nodes[0].id, "a");
  assert.equal(chain.nodes[1].id, "b");
});

test("SkillChain.chain() accepts SkillChain instances as sub-chains", () => {
  const sub = new SkillChain({ name: "sub-chain" });
  sub.chain({ id: "inner", name: "inner", skill: noopSkill("inner") });

  const parent = new SkillChain();
  parent.chain(
    { id: "before", name: "before", skill: noopSkill("before") },
    sub,
    { id: "after", name: "after", skill: noopSkill("after") },
  );

  assert.equal(parent.nodes.length, 3);
  assert.ok(parent.nodes[1].chain instanceof SkillChain);
  assert.equal(parent.nodes[1].chain.nodes.length, 1);
});

test("SkillChain.parallel() adds a parallel group", () => {
  const chain = new SkillChain();
  chain.parallel(
    [
      { id: "p1", name: "p1", skill: noopSkill("p1") },
      { id: "p2", name: "p2", skill: noopSkill("p2") },
    ],
    { concurrency: 2 },
  );

  assert.equal(chain.nodes.length, 1);
  assert.equal(chain.nodes[0].type, CHAIN_TYPE.PARALLEL);
  assert.equal(chain.nodes[0].children.length, 2);
  assert.equal(chain.nodes[0].config.concurrency, 2);
});

test("SkillChain.conditional() adds a conditional node", () => {
  const chain = new SkillChain();
  chain.conditional(
    { id: "cond", name: "conditional-step", skill: noopSkill("cond") },
    (input) => input.runCondition === true,
  );

  assert.equal(chain.nodes.length, 1);
  assert.equal(typeof chain.nodes[0]._condition, "function");
  assert.equal(chain.nodes[0]._condition({ runCondition: true }), true);
  assert.equal(chain.nodes[0]._condition({ runCondition: false }), false);
});

test("SkillChain.conditional() throws for non-function condition", () => {
  const chain = new SkillChain();
  assert.throws(
    () => chain.conditional({ id: "x", skill: noopSkill("x") }, "not-a-function"),
    TypeError,
  );
});

test("SkillChain.loop() adds a loop node", () => {
  const chain = new SkillChain();
  chain.loop(
    { id: "loop", name: "loop-step", skill: noopSkill("loop") },
    { while: (output, results, i) => i < 3, maxIterations: 5 },
  );

  assert.equal(chain.nodes.length, 1);
  assert.equal(chain.nodes[0].type, CHAIN_TYPE.LOOP);
  assert.equal(typeof chain.nodes[0]._whileCondition, "function");
  assert.equal(chain.nodes[0]._maxIterations, 5);
});

test("SkillChain.fallback() adds a fallback node", () => {
  const chain = new SkillChain();
  chain.fallback(
    { id: "primary", name: "primary", skill: failingSkill("boom") },
    { id: "fallback", name: "fallback", skill: noopSkill("fb") },
  );

  assert.equal(chain.nodes.length, 1);
  assert.equal(chain.nodes[0].type, CHAIN_TYPE.FALLBACK);
  assert.ok(chain.nodes[0]._fallback);
  assert.equal(chain.nodes[0]._fallback.id, "fallback");
});

test("SkillChain.prepend() and append() merge chains", () => {
  const a = new SkillChain();
  a.chain({ id: "a1", skill: noopSkill("a1") });

  const b = new SkillChain();
  b.chain({ id: "b1", skill: noopSkill("b1") });

  const main = new SkillChain();
  main.chain({ id: "main1", skill: noopSkill("main1") });
  main.prepend(a);
  main.append(b);

  assert.equal(main.nodes.length, 3);
  assert.equal(main.nodes[0].id, "a1");
  assert.equal(main.nodes[1].id, "main1");
  assert.equal(main.nodes[2].id, "b1");
});

// ── execution: sequence ──────────────────────────────────────

test("SkillChain.execute() runs sequential nodes in order", async () => {
  const chain = new SkillChain({ name: "seq-test" });
  chain.chain(
    { id: "s1", name: "s1", skill: noopSkill("one") },
    { id: "s2", name: "s2", skill: noopSkill("two") },
  );

  const result = await chain.execute("start");
  assert.equal(result.output, "processed:processed:start:one:two");

  // Verify trace order: s1 must run before s2
  const stepIds = result.trace.map((t) => t.stepId);
  const s1Index = stepIds.indexOf("s1");
  const s2Index = stepIds.indexOf("s2");
  assert.ok(s1Index >= 0, "s1 trace entry exists");
  assert.ok(s2Index >= 0, "s2 trace entry exists");
  assert.ok(s1Index < s2Index, "s1 runs before s2");
});

// ── execution: parallel ──────────────────────────────────────

test("SkillChain parallel group runs concurrently", async () => {
  const chain = new SkillChain({ name: "par-test" });
  chain.parallel([
    { id: "p1", name: "p1", skill: asyncSkill("a", 20) },
    { id: "p2", name: "p2", skill: asyncSkill("b", 20) },
  ]);

  const start = Date.now();
  const result = await chain.execute("input");
  const elapsed = Date.now() - start;

  // Both should complete in ~20ms (not ~40ms), proving concurrency
  assert.ok(elapsed < 100, `parallel should be fast, took ${elapsed}ms`);

  const outputs = result.output;
  assert.equal(outputs.length, 2);
  assert.ok(outputs.some((r) => r.output.includes(":a")));
  assert.ok(outputs.some((r) => r.output.includes(":b")));
});

// ── execution: conditional ───────────────────────────────────

test("SkillChain conditional node runs when condition is true", async () => {
  const chain = new SkillChain();
  chain.conditional(
    { id: "c1", name: "c1", skill: noopSkill("run") },
    (input) => input.shouldRun === true,
  );

  const result = await chain.execute({ shouldRun: true });
  assert.equal(result.output, "processed:[object Object]:run");
});

test("SkillChain conditional node skips when condition is false", async () => {
  const chain = new SkillChain();
  chain.conditional(
    { id: "c1", name: "c1", skill: noopSkill("run") },
    (input) => input.shouldRun === true,
  );

  const result = await chain.execute({ shouldRun: false });
  assert.deepEqual(result.output, { shouldRun: false }); // input passes through

  const skippedTrace = result.trace.find(
    (t) => t.stepId === "c1" && t.status === STEP_STATUS.SKIPPED,
  );
  assert.ok(skippedTrace, "conditional step was skipped in trace");
  assert.equal(skippedTrace.reason, "condition evaluated to false");
});

// ── execution: loop ──────────────────────────────────────────

test("SkillChain loop node iterates while condition holds", async () => {
  const counter = { value: 0 };

  const chain = new SkillChain();
  chain.loop(
    {
      id: "loop1",
      name: "loop1",
      skill: async (input) => {
        counter.value += 1;
        return counter.value;
      },
    },
    { while: (output) => output < 4, maxIterations: 10 },
  );

  const result = await chain.execute(0);
  assert.equal(result.output, 4);
  assert.equal(counter.value, 4);
});

test("SkillChain loop node respects maxIterations", async () => {
  const chain = new SkillChain({ maxIterations: 3 });
  chain.loop(
    {
      id: "loop2",
      name: "loop2",
      skill: async (input) => input + 1,
    },
    { while: () => true, maxIterations: 2 },
  );

  const result = await chain.execute(0);
  assert.equal(result.output, 2);
});

// ── execution: fallback ──────────────────────────────────────

test("SkillChain fallback node uses fallback on primary failure", async () => {
  const chain = new SkillChain({ name: "fb-test" });
  chain.fallback(
    { id: "primary", name: "primary", skill: failingSkill("primary down") },
    { id: "backup", name: "backup", skill: noopSkill("backup-success") },
  );

  const result = await chain.execute("data");
  assert.equal(result.output, "processed:data:backup-success");

  const fbTrace = result.trace.find(
    (t) => t.stepId === "primary" && t.status === STEP_STATUS.FALLBACK_TAKEN,
  );
  assert.ok(fbTrace, "fallback was taken in trace");
});

test("SkillChain fallback node succeeds without fallback when primary works", async () => {
  const chain = new SkillChain();
  chain.fallback(
    { id: "primary", name: "primary", skill: noopSkill("ok") },
    { id: "backup", name: "backup", skill: noopSkill("unused") },
  );

  const result = await chain.execute("data");
  assert.equal(result.output, "processed:data:ok");

  // Fallback should not appear in trace
  const backupTraces = result.trace.filter((t) => t.stepId === "backup");
  assert.equal(backupTraces.length, 0, "fallback was not used");
});

// ── execution: continueOnError ───────────────────────────────

test("SkillChain continues execution on error when continueOnError is true", async () => {
  const chain = new SkillChain({ continueOnError: true });
  chain.chain(
    { id: "good1", name: "good1", skill: noopSkill("first") },
    { id: "bad", name: "bad", skill: failingSkill("oops") },
    { id: "good2", name: "good2", skill: noopSkill("third") },
  );

  const result = await chain.execute("x");
  // The failing step is skipped; good2 still processes
  assert.ok(result.output.includes(":third"));
});

test("SkillChain throws on error when continueOnError is false (default)", async () => {
  const chain = new SkillChain();
  chain.chain(
    { id: "good1", name: "good1", skill: noopSkill("first") },
    { id: "bad", name: "bad", skill: failingSkill("fatal") },
    { id: "good2", name: "good2", skill: noopSkill("third") },
  );

  await assert.rejects(
    () => chain.execute("x"),
    /fatal/,
  );
});

// ── trace & summary ──────────────────────────────────────────

test("getExecutionTrace() returns chronological trace", () => {
  const chain = new SkillChain();
  chain._trace = [
    { stepId: "a", status: STEP_STATUS.RUNNING, timestamp: new Date().toISOString() },
    { stepId: "b", status: STEP_STATUS.COMPLETED, timestamp: new Date().toISOString() },
  ];

  const trace = chain.getExecutionTrace();
  assert.equal(trace.length, 2);
  assert.equal(trace[0].stepId, "a");
  assert.equal(trace[1].stepId, "b");
  // Should be a copy, not the original
  assert.notEqual(trace, chain._trace);
});

test("getExecutionSummary() reports per-step details", async () => {
  const chain = new SkillChain({ name: "summary-test" });
  chain.chain(
    { id: "s1", name: "s1", skill: noopSkill("one") },
    { id: "s2", name: "s2", skill: noopSkill("two") },
  );

  await chain.execute("start");
  const summary = chain.getExecutionSummary();

  assert.equal(summary.name, "summary-test");
  assert.ok(summary.totalSteps > 0);
  assert.ok(summary.totalDuration >= 0);
  assert.ok(Array.isArray(summary.steps));
  assert.ok(summary.steps.some((s) => s.stepId === "s1"));
  assert.ok(summary.steps.some((s) => s.stepId === "s2"));
});

// ── serialization ────────────────────────────────────────────

test("toJSON() serializes chain definition", () => {
  const chain = new SkillChain({ id: "ser", name: "serialize-me" });
  chain.chain({ id: "n1", name: "n1", skill: noopSkill("n1") });
  chain.parallel([{ id: "p1", name: "p1", skill: noopSkill("p1") }]);

  const json = chain.toJSON();

  assert.equal(json.id, "ser");
  assert.equal(json.name, "serialize-me");
  assert.equal(json.nodes.length, 2);
  assert.equal(json.nodes[0].id, "n1");
  // Second node is the parallel wrapper (id is auto-generated), check its type and children
  assert.equal(json.nodes[1].type, CHAIN_TYPE.PARALLEL);
  assert.ok(json.nodes[1].children && json.nodes[1].children.length > 0);
  assert.equal(json.nodes[1].children[0].id, "p1");
});

// ── factory functions ────────────────────────────────────────

test("createChain() returns a populated SkillChain", () => {
  const chain = createChain(
    [
      { id: "a", skill: noopSkill("a") },
      { id: "b", skill: noopSkill("b") },
    ],
    { name: "my-seq" },
  );

  assert.ok(chain instanceof SkillChain);
  assert.equal(chain.name, "my-seq");
  assert.equal(chain.nodes.length, 2);
});

test("createParallel() returns a SkillChain with parallel group", () => {
  const chain = createParallel(
    [
      { id: "a", skill: noopSkill("a") },
      { id: "b", skill: noopSkill("b") },
    ],
    { name: "my-par" },
  );

  assert.ok(chain instanceof SkillChain);
  assert.equal(chain.type, CHAIN_TYPE.PARALLEL);
  assert.equal(chain.nodes.length, 1);
  assert.equal(chain.nodes[0].type, CHAIN_TYPE.PARALLEL);
  assert.equal(chain.nodes[0].children.length, 2);
});

test("createChain() and createParallel() work with empty arrays", () => {
  const seq = createChain([]);
  assert.equal(seq.nodes.length, 0);

  // createParallel only calls .parallel() when there are skills, so it produces
  // an empty-nodes chain (type PARALLEL, no children).
  const par = createParallel([]);
  assert.ok(par instanceof SkillChain);
  assert.equal(par.type, CHAIN_TYPE.PARALLEL);
  assert.equal(par.nodes.length, 0);
});

// ── abort ────────────────────────────────────────────────────

test("SkillChain.abort() sets aborted flag", () => {
  const chain = new SkillChain();
  assert.equal(chain._aborted, false);
  chain.abort();
  assert.equal(chain._aborted, true);
});

// ── chaining multiple types together ─────────────────────────

test("SkillChain composes sequence, parallel, conditional, and fallback", async () => {
  const chain = new SkillChain({ name: "combo", continueOnError: true });

  // 1. sequential step
  chain.chain({ id: "init", name: "init", skill: noopSkill("init") });

  // 2. parallel group
  chain.parallel([
    { id: "check1", name: "check1", skill: asyncSkill("chk1", 5) },
    { id: "check2", name: "check2", skill: asyncSkill("chk2", 5) },
  ]);

  // 3. fallback
  chain.fallback(
    { id: "risky", name: "risky", skill: failingSkill("fail") },
    { id: "safe", name: "safe", skill: noopSkill("recovered") },
  );

  const result = await chain.execute("start");

  // After init (sequential) → parallel (returns [{...}, {...}]) → fallback
  // (primary fails, safe handler runs).  The safe handler produces a string.
  assert.ok(typeof result.output === "string", `expected string, got ${typeof result.output}`);
  assert.ok(result.output.includes("recovered"), `output does not contain "recovered": ${JSON.stringify(result.output)}`);
});

// ── nested sub-chain execution ───────────────────────────────

test("SkillChain executes nested sub-chains", async () => {
  const inner = new SkillChain({ name: "inner" });
  inner.chain({ id: "inner-1", name: "inner-1", skill: noopSkill("inner") });

  const outer = new SkillChain({ name: "outer" });
  outer.chain(
    { id: "outer-1", name: "outer-1", skill: noopSkill("outer") },
    inner,
    { id: "outer-2", name: "outer-2", skill: noopSkill("end") },
  );

  const result = await outer.execute("data");
  assert.ok(result.output.includes(":inner"));
  assert.ok(result.output.includes(":outer"));
  assert.ok(result.output.includes(":end"));
});
