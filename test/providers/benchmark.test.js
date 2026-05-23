"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderBenchmark, TestCase } = require("../../src/providers/benchmark");

function createMockProvider(name, handler, options = {}) {
  return {
    name,
    model: options.model || `${name}-model`,
    async chat(request) {
      if (options.failuresBefore) {
        options._failCount = (options._failCount || 0) + 1;
        if (options._failCount <= options.failuresBefore) {
          throw new Error(`Simulated failure #${options._failCount} for ${name}`);
        }
      }
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      const result = await handler(request);
      return result;
    },
  };
}

function mockHandler(content) {
  return async () => ({
    id: `mock-${Date.now()}`,
    content: typeof content === "function" ? content() : (content || "Mock response"),
    model: "mock-model",
    role: "assistant",
    usage: { inputTokens: 100, outputTokens: 50 },
  });
}

// TestCase tests
test("TestCase constructs with valid specification", () => {
  const tc = new TestCase({
    prompt: "What is the best caching strategy?",
    expectedConcepts: ["caching", "performance", "redis"],
    expectedTools: ["web.search"],
    minQuality: 0.5,
    maxTokens: 8192,
    category: "architecture",
    weight: 2,
  });

  assert.equal(tc.prompt, "What is the best caching strategy?");
  assert.deepEqual(tc.expectedConcepts, ["caching", "performance", "redis"]);
  assert.deepEqual(tc.expectedTools, ["web.search"]);
  assert.equal(tc.minQuality, 0.5);
  assert.equal(tc.maxTokens, 8192);
  assert.equal(tc.category, "architecture");
  assert.equal(tc.weight, 2);
  assert.ok(typeof tc.id === "string");
  assert.ok(tc.id.length > 0);
});

test("TestCase throws with empty prompt", () => {
  assert.throws(
    () => new TestCase({ prompt: "" }),
    /non-empty prompt/,
  );

  assert.throws(
    () => new TestCase({ prompt: "   " }),
    /non-empty prompt/,
  );
});

test("TestCase throws with missing specification", () => {
  assert.throws(
    () => new TestCase(),
    /valid specification/,
  );

  assert.throws(
    () => new TestCase(null),
    /valid specification/,
  );
});

test("TestCase uses defaults for optional fields", () => {
  const tc = new TestCase({ prompt: "Hello world" });

  assert.deepEqual(tc.expectedTools, []);
  assert.deepEqual(tc.expectedConcepts, []);
  assert.equal(tc.minQuality, 0);
  assert.equal(tc.maxTokens, 4096);
  assert.equal(tc.category, "general");
  assert.equal(tc.weight, 1);
});

// ProviderBenchmark tests
test("ProviderBenchmark measureLatency computes latency statistics", async () => {
  const benchmark = new ProviderBenchmark();
  const fastProvider = createMockProvider("fast", mockHandler("Quick response"), { delayMs: 10 });
  const slowProvider = createMockProvider("slow", mockHandler("Slow response"), { delayMs: 50 });

  const results = await benchmark.measureLatency(
    [fastProvider, slowProvider],
    ["test prompt 1", "test prompt 2", "test prompt 3"],
  );

  assert.ok(results.fast, "Should have results for fast provider");
  assert.ok(results.slow, "Should have results for slow provider");
  assert.ok(results.fast.averageMs > 0);
  assert.ok(results.slow.averageMs > 0);
  assert.ok(results.slow.averageMs > results.fast.averageMs, "Slow provider should have higher average latency");
  assert.ok(results.fast.p50Ms > 0);
  assert.ok(results.fast.p95Ms > 0);
  assert.equal(results.fast.samples, 3);
});

test("ProviderBenchmark measureLatency throws with empty providers", async () => {
  const benchmark = new ProviderBenchmark();

  await assert.rejects(
    () => benchmark.measureLatency([], ["test"]),
    /At least one provider is required/,
  );
});

test("ProviderBenchmark measureQuality evaluates response quality against test cases", async () => {
  const benchmark = new ProviderBenchmark();

  const goodProvider = createMockProvider("good", mockHandler(
    "We recommend using Redis for caching because it provides excellent performance. The caching strategy should implement TTL-based expiration and include performance monitoring.",
  ));
  const poorProvider = createMockProvider("poor", mockHandler("OK."));

  const testCases = [
    new TestCase({
      prompt: "What caching strategy should we use?",
      expectedConcepts: ["redis", "caching", "performance", "ttl"],
      expectedTools: [],
    }),
  ];

  const results = await benchmark.measureQuality([goodProvider, poorProvider], testCases);

  assert.ok(results.good, "Should have results for good provider");
  assert.ok(results.poor, "Should have results for poor provider");
  assert.ok(results.good.averageScore > results.poor.averageScore, "Good provider should score higher");
  assert.ok(results.good.conceptRecall > results.poor.conceptRecall, "Good provider should have better concept recall");
});

test("ProviderBenchmark measureQuality handles expected tools accuracy", async () => {
  const benchmark = new ProviderBenchmark();

  const provider = createMockProvider("tool-user", async () => ({
    id: "resp-1",
    content: "I will search and read files.",
    toolCalls: [
      { name: "web.search" },
      { name: "file.read" },
    ],
  }));

  const testCases = [
    new TestCase({
      prompt: "Research the topic",
      expectedTools: ["web.search", "file.read"],
    }),
  ];

  const results = await benchmark.measureQuality([provider], testCases);

  assert.ok(results["tool-user"]);
  assert.equal(results["tool-user"].toolAccuracy, 1, "Should have perfect tool accuracy when all expected tools match");
});

test("ProviderBenchmark measureReliability evaluates provider consistency", async () => {
  const benchmark = new ProviderBenchmark();

  const reliableProvider = createMockProvider("reliable", mockHandler("Always works"));
  const flakyProvider = createMockProvider("flaky", mockHandler("Works sometimes"), { failuresBefore: 3 });

  const reliableResult = await benchmark.measureReliability(reliableProvider, 5);
  const flakyResult = await benchmark.measureReliability(flakyProvider, 5);

  assert.equal(reliableResult.attempts, 5);
  assert.equal(reliableResult.successes, 5);
  assert.equal(reliableResult.successRate, 1);
  assert.equal(reliableResult.failures, 0);

  assert.equal(flakyResult.attempts, 5);
  assert.equal(flakyResult.successes, 2);
  assert.equal(flakyResult.failures, 3);
  assert.ok(flakyResult.successRate < 1);
  assert.ok(flakyResult.consecutiveFailures >= 3);
});

test("ProviderBenchmark measureReliability throws with invalid provider", async () => {
  const benchmark = new ProviderBenchmark();

  await assert.rejects(
    () => benchmark.measureReliability({ name: "bad" }, 3),
    /A valid provider with a chat/,
  );
});

test("ProviderBenchmark runBenchmark runs the full benchmark suite", async () => {
  const benchmark = new ProviderBenchmark();

  const primaryProvider = createMockProvider("primary", mockHandler(
    "A detailed response covering caching strategies with Redis. For performance optimization, implement TTL-based expiration and consider using a CDN for static assets. Monitor cache hit rates regularly.",
  ), { delayMs: 5 });
  const secondaryProvider = createMockProvider("secondary", mockHandler(
    "Some caching approach.",
  ), { delayMs: 20 });

  const testCases = [
    { prompt: "Best caching strategy?", expectedConcepts: ["redis", "caching", "performance"], expectedTools: [] },
    { prompt: "Optimize database queries?", expectedConcepts: ["index", "query", "optimization"], expectedTools: [] },
  ];

  const result = await benchmark.runBenchmark([primaryProvider, secondaryProvider], testCases);

  assert.ok(result.providers, "Should include provider summaries");
  assert.ok(result.providers.primary, "Should include primary provider");
  assert.ok(result.providers.secondary, "Should include secondary provider");
  assert.equal(result.testCaseCount, 2);
  assert.ok(result.report, "Should include comparison report");
  assert.ok(result.report.summary.length > 0);
  assert.ok(result.report.ranking.length > 0);
  assert.ok(Array.isArray(result.report.recommendations));
  assert.ok(result.timestamp > 0);
});

test("ProviderBenchmark runBenchmark throws with no providers", async () => {
  const benchmark = new ProviderBenchmark();

  await assert.rejects(
    () => benchmark.runBenchmark([], [{ prompt: "test" }]),
    /At least one provider/,
  );
});

test("ProviderBenchmark runBenchmark throws with no test cases", async () => {
  const benchmark = new ProviderBenchmark();
  const provider = createMockProvider("test", mockHandler("ok"));

  await assert.rejects(
    () => benchmark.runBenchmark([provider], []),
    /At least one test case/,
  );
});

test("ProviderBenchmark generateComparisonReport produces structured report", () => {
  const benchmark = new ProviderBenchmark();

  const results = {
    providerA: {
      provider: "providerA",
      model: "model-a",
      latency: { averageMs: 200, minMs: 100, maxMs: 500, p50Ms: 180, p95Ms: 450, p99Ms: 490 },
      quality: { averageScore: 0.85, minScore: 0.7, maxScore: 0.95, conceptRecall: 0.9, toolAccuracy: 0.8 },
      reliability: { successRate: 0.98, errors: [], consecutiveFailures: 0 },
      overallScore: 0.85,
    },
    providerB: {
      provider: "providerB",
      model: "model-b",
      latency: { averageMs: 8000, minMs: 5000, maxMs: 12000, p50Ms: 7500, p95Ms: 11000, p99Ms: 11800 },
      quality: { averageScore: 0.3, minScore: 0.1, maxScore: 0.5, conceptRecall: 0.2, toolAccuracy: 0.1 },
      reliability: { successRate: 0.65, errors: [{ attempt: 3, error: "timeout" }], consecutiveFailures: 3 },
      overallScore: 0.2,
    },
  };

  const report = benchmark.generateComparisonReport({ providers: results });

  assert.ok(report.summary.includes("Best overall"));
  assert.ok(report.summary.includes("providerA"));
  assert.equal(report.ranking[0].name, "providerA");
  assert.equal(report.ranking[1].name, "providerB");
  assert.ok(report.strengths.providerA.length > 0);
  assert.ok(report.weaknesses.providerB.length > 0);
  assert.ok(report.recommendations.length > 0);
});

test("ProviderBenchmark generateComparisonReport handles empty results", () => {
  const benchmark = new ProviderBenchmark();

  const report = benchmark.generateComparisonReport({});

  assert.equal(report.summary, "No provider results to compare.");
  assert.equal(report.providers.length, 0);
  assert.equal(report.ranking.length, 0);
});

test("ProviderBenchmark generateComparisonReport throws with no argument", () => {
  const benchmark = new ProviderBenchmark();

  assert.throws(
    () => benchmark.generateComparisonReport(),
    /Results object is required/,
  );
});

test("ProviderBenchmark trackOverTime records metric snapshots", () => {
  const benchmark = new ProviderBenchmark();

  const provider = {
    name: "tracked-provider",
    _lastLatency: 250,
    _lastQuality: 0.75,
    _lastSuccessRate: 0.9,
  };

  const result1 = benchmark.trackOverTime(provider, "latency");
  assert.equal(result1.provider, "tracked-provider");
  assert.equal(result1.metric, "latency");
  assert.equal(result1.current, 250);
  assert.equal(result1.sampleCount, 1);
  assert.equal(result1.trend, "insufficient-data");

  provider._lastLatency = 200;
  const result2 = benchmark.trackOverTime(provider, "latency");

  assert.equal(result2.current, 200);
  assert.equal(result2.sampleCount, 2);
});

test("ProviderBenchmark trackOverTime detects trends over multiple samples", () => {
  const benchmark = new ProviderBenchmark();

  const provider = { name: "trending", _lastQuality: 0.5 };
  benchmark.trackOverTime(provider, "quality");

  provider._lastQuality = 0.6;
  benchmark.trackOverTime(provider, "quality");

  provider._lastQuality = 0.75;
  benchmark.trackOverTime(provider, "quality");

  provider._lastQuality = 0.9;
  const result = benchmark.trackOverTime(provider, "quality");

  assert.equal(result.trend, "improving");
  assert.equal(result.sampleCount, 4);
});

test("ProviderBenchmark trackOverTime throws on invalid provider", () => {
  const benchmark = new ProviderBenchmark();

  assert.throws(
    () => benchmark.trackOverTime(null, "latency"),
    /valid provider/,
  );
});

test("ProviderBenchmark trackOverTime throws on missing metric", () => {
  const benchmark = new ProviderBenchmark();
  const provider = { name: "test" };

  assert.throws(
    () => benchmark.trackOverTime(provider, ""),
    /metric name is required/,
  );
});

test("ProviderBenchmark clearTracking removes tracking data", () => {
  const benchmark = new ProviderBenchmark();
  const provider = { name: "clear-test", _lastLatency: 100 };

  benchmark.trackOverTime(provider, "latency");
  assert.equal(benchmark.getTrackingHistory("clear-test").length, 1);

  benchmark.clearTracking("clear-test");
  assert.equal(benchmark.getTrackingHistory("clear-test").length, 0);
});

test("ProviderBenchmark getResults returns benchmark history", async () => {
  const benchmark = new ProviderBenchmark();

  const provider = createMockProvider("results-test", mockHandler("ok"));
  await benchmark.runBenchmark([provider], [{ prompt: "Test" }]);

  const results = benchmark.getResults();
  assert.equal(results.length, 1);
  assert.ok(results[0].providers);
  assert.ok(results[0].report);
});
