"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HealthChecker,
  createFallbackChain,
  withFallback,
  selectHealthiestProvider,
} = require("../../src/providers/fallback");

function createMockProvider(name, handler) {
  return {
    name,
    async chat(request) {
      return handler(request);
    },
    stream(request) {
      return (async function* () {
        yield { type: "text", delta: "mock stream" };
      })();
    },
    setModel() {},
    setApiUrl() {},
    setApiKey() {},
    async listModels() {
      return [{ id: "mock", name }];
    },
  };
}

test("createFallbackChain tries primary provider first", async () => {
  const primary = createMockProvider("primary", (req) => ({
    content: `primary: ${req.prompt}`,
  }));
  const fallback = createMockProvider("fallback", () => ({
    content: "should not be called",
  }));

  const chain = createFallbackChain([primary, fallback]);
  const result = await chain({ prompt: "hello" });

  assert.equal(result.content, "primary: hello");
});

test("createFallbackChain falls back on primary error", async () => {
  const primary = createMockProvider("primary", () => {
    throw new Error("Primary down");
  });
  const fallback = createMockProvider("fallback", () => ({
    content: "fallback response",
  }));

  const chain = createFallbackChain([primary, fallback]);
  const result = await chain({ prompt: "hello" });

  assert.equal(result.content, "fallback response");
});

test("createFallbackChain fails when all providers fail", async () => {
  const primary = createMockProvider("primary", () => {
    throw new Error("Primary error");
  });
  const fallback = createMockProvider("fallback", () => {
    throw new Error("Fallback error");
  });

  const chain = createFallbackChain([primary, fallback]);

  await assert.rejects(
    () => chain({ prompt: "test" }),
    /All providers in fallback chain failed/,
  );
});

test("createFallbackChain throws with empty providers array", () => {
  assert.throws(
    () => createFallbackChain([]),
    /At least one provider is required/,
  );
});

test("createFallbackChain works with single provider", async () => {
  const provider = createMockProvider("solo", () => ({
    content: "solo response",
  }));

  const chain = createFallbackChain([provider]);
  const result = await chain({ prompt: "hello" });

  assert.equal(result.content, "solo response");
});

test("HealthChecker records success and calculates success rate", () => {
  const checker = new HealthChecker({ providerName: "test-provider" });

  checker.recordSuccess(100);
  checker.recordSuccess(200);
  checker.recordSuccess(150);

  assert.equal(checker.totalRequests, 3);
  assert.equal(checker.successRate, 1);
  assert.equal(checker.errorRate, 0);
  assert.equal(checker.averageLatencyMs, 150);
});

test("HealthChecker records failure and calculates error rate", () => {
  const checker = new HealthChecker({ providerName: "test-provider" });

  checker.recordSuccess(100);
  checker.recordSuccess(200);
  checker.recordFailure(new Error("timeout"));
  checker.recordSuccess(150);

  assert.equal(checker.totalRequests, 4);
  assert.equal(checker.successRate, 0.75);
  assert.equal(checker.errorRate, 0.25);
});

test("HealthChecker health score improves with success", () => {
  const checker = new HealthChecker({ providerName: "test-provider", minSamplesForHealth: 1 });

  checker.recordSuccess(50);
  assert.equal(checker.totalRequests, 1);
  assert.ok(checker.healthScore >= 0.7);
  assert.equal(checker.isHealthy(), true);
});

test("HealthChecker health score degrades with failures", () => {
  const checker = new HealthChecker({ providerName: "test-provider", minSamplesForHealth: 1 });

  checker.recordFailure(new Error("timeout"));
  assert.equal(checker.totalRequests, 1);
  assert.ok(checker.healthScore < 0.5);
  assert.equal(checker.isHealthy(), false);
});

test("HealthChecker low sample count returns neutral score", () => {
  const checker = new HealthChecker({ providerName: "test-provider", minSamplesForHealth: 10 });

  checker.recordSuccess(100);
  checker.recordSuccess(200);

  assert.equal(checker.healthScore, 0.5);
});

test("HealthChecker reset clears all state", () => {
  const checker = new HealthChecker({ providerName: "test-provider" });

  checker.recordSuccess(100);
  checker.recordFailure(new Error("fail"));
  checker.reset();

  assert.equal(checker.totalRequests, 0);
  assert.equal(checker.successRate, 1);
  assert.equal(checker.errorRate, 0);
  assert.equal(checker.lastCheckTime, null);
  assert.equal(checker.lastError, null);
});

test("HealthChecker toJSON returns a snapshot", () => {
  const checker = new HealthChecker({ providerName: "test-provider" });

  checker.recordSuccess(100);
  const json = checker.toJSON();

  assert.equal(json.providerName, "test-provider");
  assert.equal(json.totalRequests, 1);
  assert.equal(json.successRate, 1);
  assert.ok(typeof json.healthScore === "number");
  assert.equal(json.healthy, true);
});

test("selectHealthiestProvider picks provider with best health score", () => {
  const providerA = { name: "a", _healthChecker: new HealthChecker({ providerName: "a", minSamplesForHealth: 3 }) };
  const providerB = { name: "b", _healthChecker: new HealthChecker({ providerName: "b", minSamplesForHealth: 3 }) };
  const providerC = { name: "c", _healthChecker: new HealthChecker({ providerName: "c", minSamplesForHealth: 3 }) };

  // Provider A: 3 successes, 1 failure => some degradation
  providerA._healthChecker.recordSuccess(50);
  providerA._healthChecker.recordSuccess(50);
  providerA._healthChecker.recordSuccess(50);
  providerA._healthChecker.recordFailure(new Error("fail"));

  // Provider B: 4 successes, no failures => highest score
  providerB._healthChecker.recordSuccess(50);
  providerB._healthChecker.recordSuccess(50);
  providerB._healthChecker.recordSuccess(50);
  providerB._healthChecker.recordSuccess(50);

  // Provider C: mostly failures => low health score
  providerC._healthChecker.recordFailure(new Error("fail"));
  providerC._healthChecker.recordFailure(new Error("fail"));
  providerC._healthChecker.recordSuccess(50);

  const selected = selectHealthiestProvider([providerA, providerB, providerC]);

  assert.equal(selected.name, "b");
});

test("selectHealthiestProvider returns sole provider when only one", () => {
  const provider = { name: "only", _healthChecker: new HealthChecker({ providerName: "only" }) };
  const selected = selectHealthiestProvider([provider]);

  assert.equal(selected.name, "only");
});

test("selectHealthiestProvider throws for empty array", () => {
  assert.throws(
    () => selectHealthiestProvider([]),
    /At least one provider is required/,
  );
});

test("withFallback transparent passthrough when primary works", async () => {
  const primary = createMockProvider("primary", (req) => ({
    content: `primary: ${req.prompt}`,
  }));
  const fallback = createMockProvider("fallback", () => ({
    content: "should not be called",
  }));

  const wrapped = withFallback(primary, fallback);
  const response = await wrapped.chat({ prompt: "hello" });

  assert.equal(response.content, "primary: hello");
  assert.equal(wrapped.health.totalRequests, 1);
  assert.equal(wrapped.health.successRate, 1);
});

test("withFallback uses fallback when primary fails", async () => {
  const primary = createMockProvider("primary", () => {
    throw new Error("Primary error");
  });
  const fallback = createMockProvider("fallback", () => ({
    content: "fallback used",
  }));

  const wrapped = withFallback(primary, fallback);
  const response = await wrapped.chat({ prompt: "hello" });

  assert.equal(response.content, "fallback used");
});

test("withFallback listModels falls back when primary listModels fails", async () => {
  const primary = {
    name: "primary",
    async chat() { return { content: "" }; },
    async listModels() { throw new Error("list failed"); },
    setModel() {},
    setApiUrl() {},
    setApiKey() {},
    stream() {},
  };
  const fallback = {
    name: "fallback",
    async chat() { return { content: "" }; },
    async listModels() { return [{ id: "fb", name: "Fallback Model" }]; },
    setModel() {},
    setApiUrl() {},
    setApiKey() {},
    stream() {},
  };

  const wrapped = withFallback(primary, fallback);
  const models = await wrapped.listModels();

  assert.deepEqual(models, [{ id: "fb", name: "Fallback Model" }]);
});
