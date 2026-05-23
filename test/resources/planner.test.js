/**
 * Tests for ResourcePlanner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ResourcePlanner,
  STRATEGY,
  RESOURCE_TYPES,
  TASK_COMPLEXITY,
} = require("../../src/resources/planner");

// ---- constructor & constants ----

test("ResourcePlanner: initializes with default strategy BALANCED and name", () => {
  const planner = new ResourcePlanner();
  assert.equal(planner.strategy, STRATEGY.BALANCED);
});

test("ResourcePlanner: accepts custom strategy at construction", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.GREEDY, name: "test-planner" });
  assert.equal(planner.strategy, STRATEGY.GREEDY);
});

test("ResourcePlanner: setStrategy validates and changes strategy", () => {
  const planner = new ResourcePlanner();
  planner.setStrategy(STRATEGY.EFFICIENCY);
  assert.equal(planner.strategy, STRATEGY.EFFICIENCY);

  assert.throws(() => {
    planner.setStrategy("INVALID");
  }, /Invalid strategy/);
});

test("ResourcePlanner: RESOURCE_TYPES includes all six dimensions", () => {
  assert.ok(RESOURCE_TYPES.includes("tokens"));
  assert.ok(RESOURCE_TYPES.includes("apiCalls"));
  assert.ok(RESOURCE_TYPES.includes("toolExecutions"));
  assert.ok(RESOURCE_TYPES.includes("time"));
  assert.ok(RESOURCE_TYPES.includes("memory"));
  assert.ok(RESOURCE_TYPES.includes("disk"));
  assert.equal(RESOURCE_TYPES.length, 6);
});

test("ResourcePlanner: TASK_COMPLEXITY includes expected levels", () => {
  assert.ok(Object.values(TASK_COMPLEXITY).includes("LOW"));
  assert.ok(Object.values(TASK_COMPLEXITY).includes("MEDIUM"));
  assert.ok(Object.values(TASK_COMPLEXITY).includes("HIGH"));
  assert.ok(Object.values(TASK_COMPLEXITY).includes("CRITICAL"));
});

// ---- plan() ----

test("ResourcePlanner: plan creates an allocation plan with expected structure", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.BALANCED });
  const tasks = [
    { id: "task-1", type: "analyze", priority: 1, complexity: "MEDIUM" },
    { id: "task-2", type: "generate", priority: 2, complexity: "HIGH" },
  ];
  const resources = {
    tokens: 100000,
    apiCalls: 100,
    toolExecutions: 50,
    time: 300000,
    memory: 2048,
    disk: 1024,
  };

  const plan = planner.plan(tasks, resources);

  assert.ok(plan.planId.startsWith("plan-"));
  assert.equal(plan.tasks, 2);
  assert.equal(plan.strategy, STRATEGY.BALANCED);
  assert.ok(typeof plan.timestamp === "number");
  assert.ok(Array.isArray(plan.allocations));
  assert.ok(Array.isArray(plan.bottlenecks));
  assert.ok(typeof plan.utilization === "object");
  assert.ok(typeof plan.totalAllocated === "object");
});

test("ResourcePlanner: plan allocates all tasks when resources are abundant", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.GREEDY });
  const tasks = [
    { id: "t1", type: "test", priority: 1, complexity: "LOW" },
    { id: "t2", type: "test", priority: 1, complexity: "LOW" },
  ];
  const resources = {
    tokens: 1000000,
    apiCalls: 1000,
    toolExecutions: 1000,
    time: 600000,
    memory: 4096,
    disk: 4096,
  };

  const plan = planner.plan(tasks, resources);
  assert.equal(plan.unallocated, 0);
  assert.equal(plan.allocations.length, 2);
  for (const a of plan.allocations) {
    assert.equal(a.granted, true);
  }
});

test("ResourcePlanner: plan leaves tasks unallocated when resources are scarce", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.GREEDY });
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    type: "heavy",
    priority: 0,
    complexity: "HIGH",
  }));
  const resources = {
    tokens: 5000,
    apiCalls: 1,
    toolExecutions: 1,
    time: 10000,
    memory: 64,
    disk: 16,
  };

  const plan = planner.plan(tasks, resources);
  assert.ok(plan.unallocated > 0, `Expected some unallocated tasks, got ${plan.unallocated}`);
});

test("ResourcePlanner: plan validates inputs", () => {
  const planner = new ResourcePlanner();
  assert.throws(() => planner.plan(null, {}), /tasks must be an array/);
  assert.throws(() => planner.plan([], null), /resources must be an object/);
  assert.throws(() => planner.plan([null], {}), /each task must be an object/);
});

// ---- estimateNeeds() ----

test("ResourcePlanner: estimateNeeds returns estimates with all resource dimensions", () => {
  const planner = new ResourcePlanner();
  const task = { id: "t1", type: "code-review", complexity: "MEDIUM" };
  const needs = planner.estimateNeeds(task);

  assert.ok(needs.tokens > 0);
  assert.ok(needs.apiCalls > 0);
  assert.ok(needs.toolExecutions > 0);
  assert.ok(needs.time > 0);
  assert.ok(needs.memory > 0);
  assert.ok(needs.disk > 0);
  assert.ok(typeof needs.totalCost === "number");
  assert.ok(needs.totalCost > 0);
  assert.ok(typeof needs.confidence === "number");
});

test("ResourcePlanner: estimateNeeds scales with complexity", () => {
  const planner = new ResourcePlanner();
  const low = planner.estimateNeeds({ id: "low", complexity: "LOW" });
  const high = planner.estimateNeeds({ id: "high", complexity: "HIGH" });
  const critical = planner.estimateNeeds({ id: "crit", complexity: "CRITICAL" });

  // Higher complexity should require more resources
  assert.ok(low.totalCost < high.totalCost, "LOW should cost less than HIGH");
  assert.ok(high.totalCost < critical.totalCost, "HIGH should cost less than CRITICAL");
});

// ---- learn() ----

test("ResourcePlanner: learn updates estimates for a task type", () => {
  const planner = new ResourcePlanner();
  const before = planner.estimateNeeds({ id: "t", type: "custom" });
  assert.equal(before.confidence, 0.3);

  planner.learn("custom", { tokens: 2000, apiCalls: 2, toolExecutions: 1, time: 10000, memory: 32, disk: 8 });

  const after = planner.estimateNeeds({ id: "t", type: "custom" });
  assert.ok(after.confidence > 0.3, "Confidence should improve after learning");
});

test("ResourcePlanner: learn validates taskType argument", () => {
  const planner = new ResourcePlanner();
  assert.throws(() => planner.learn("", {}), /taskType must be a non-empty string/);
  assert.throws(() => planner.learn(null, {}), /taskType must be a non-empty string/);
});

// ---- optimizeAllocation() ----

test("ResourcePlanner: optimizeAllocation reduces waste in an allocation plan", () => {
  const planner = new ResourcePlanner();
  const tasks = [
    { id: "t1", complexity: "LOW" },
    { id: "t2", complexity: "LOW" },
  ];
  const resources = tokensFactory(20000);

  const plan = planner.plan(tasks, resources);
  const before = plan.totalAllocated.tokens;

  // Artificially inflate an allocation then optimize
  plan.allocations[0].allocated.tokens = 20000;
  plan.totalAllocated.tokens = plan.allocations.reduce((s, a) => s + (a.granted ? a.allocated.tokens : 0), 0);

  const optimized = planner.optimizeAllocation(plan);
  assert.ok(optimized.totalAllocated.tokens < plan.totalAllocated.tokens || optimized.totalAllocated.tokens === plan.totalAllocated.tokens);
  assert.equal(optimized.optimized, true);
});

test("ResourcePlanner: optimizeAllocation validates input", () => {
  const planner = new ResourcePlanner();
  assert.throws(() => planner.optimizeAllocation(null), /invalid plan/);
  assert.throws(() => planner.optimizeAllocation({}), /invalid plan/);
});

// ---- detectBottlenecks() ----

test("ResourcePlanner: detectBottlenecks finds resource bottlenecks", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.BALANCED });
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`,
    complexity: "HIGH",
    priority: 1,
  }));
  const resources = tokensFactory(50000, 10, 5);

  const plan = planner.plan(tasks, resources);
  const bottlenecks = planner.detectBottlenecks(plan);

  // With 20 HIGH tasks and limited resources, there should be bottlenecks
  assert.ok(bottlenecks.length > 0, `Expected bottlenecks, got ${bottlenecks.length}`);
  assert.ok(bottlenecks.some((b) => b.severity === "CRITICAL" || b.severity === "HIGH"),
    `Expected at least one CRITICAL/HIGH bottleneck, got: ${bottlenecks.map((b) => b.resource + ":" + b.severity).join(", ")}`);
});

test("ResourcePlanner: detectBottlenecks returns empty for abundant resources", () => {
  const planner = new ResourcePlanner();
  const tasks = [{ id: "t1", complexity: "LOW" }];
  const resources = tokensFactory(1000000, 100000, 100000);

  const plan = planner.plan(tasks, resources);
  const bottlenecks = planner.detectBottlenecks(plan);
  assert.equal(bottlenecks.length, 0, `Expected no bottlenecks, got ${bottlenecks.length}`);
});

// ---- plan retrieval & management ----

test("ResourcePlanner: getPlan retrieves a previously created plan", () => {
  const planner = new ResourcePlanner();
  const plan = planner.plan([{ id: "t1" }], tokensFactory(100000));
  const retrieved = planner.getPlan(plan.planId);

  assert.ok(retrieved);
  assert.equal(retrieved.planId, plan.planId);
  assert.equal(retrieved.tasks, 1);
});

test("ResourcePlanner: listPlans and removePlan manage plan storage", () => {
  const planner = new ResourcePlanner();
  const p1 = planner.plan([{ id: "a" }], tokensFactory(50000));
  const p2 = planner.plan([{ id: "b" }], tokensFactory(50000));

  const plans = planner.listPlans();
  assert.ok(plans.length >= 2);

  const removed = planner.removePlan(p1.planId);
  assert.equal(removed, true);
  assert.equal(planner.getPlan(p1.planId), null);
  assert.ok(planner.getPlan(p2.planId));
});

test("ResourcePlanner: reset clears all plans and learned estimates", () => {
  const planner = new ResourcePlanner();
  planner.plan([{ id: "t1" }], tokensFactory(100000));
  planner.learn("test-type", { tokens: 1000, apiCalls: 1, toolExecutions: 1, time: 5000, memory: 32, disk: 8 });

  planner.reset();

  assert.equal(planner.listPlans().length, 0);
  const learned = planner.getLearnedEstimates();
  assert.equal(Object.keys(learned.estimates).length, 0);
  assert.equal(Object.keys(learned.accuracy).length, 0);
});

// ---- strategy-dependent behavior ----

test("ResourcePlanner: GREEDY strategy prioritizes higher-priority tasks", () => {
  const planner = new ResourcePlanner({ strategy: STRATEGY.GREEDY });
  const tasks = [
    { id: "low-prio", priority: 0, complexity: "HIGH" },
    { id: "high-prio", priority: 10, complexity: "HIGH" },
    { id: "medium-prio", priority: 5, complexity: "HIGH" },
  ];
  const resources = tokensFactory(50000);

  const plan = planner.plan(tasks, resources);

  // GREEDY allocates highest priority first, so high-prio should be allocated
  const allocMap = {};
  for (const a of plan.allocations) {
    allocMap[a.taskId] = a.granted;
  }

  // The high-priority task should be among the first allocated
  assert.equal(allocMap["high-prio"], true, "High priority task should be allocated");
});

// ---- helper ----

function tokensFactory(tokens = 100000, apiCalls = 100, toolExecutions = 50) {
  return {
    tokens,
    apiCalls,
    toolExecutions,
    time: 300000,
    memory: 2048,
    disk: 1024,
  };
}
