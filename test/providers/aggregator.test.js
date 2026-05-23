"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderAggregator } = require("../../src/providers/aggregator");

function createMockProvider(name, handler, options = {}) {
  return {
    name,
    async chat(request) {
      if (options.failOnCall !== undefined) {
        options.callCount = (options.callCount || 0) + 1;
        if (options.callCount === options.failOnCall) {
          throw new Error(`Simulated failure for ${name}`);
        }
      }
      return handler(request);
    },
    stream() {
      return (async function* () {
        yield { type: "text", delta: `mock stream from ${name}` };
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

function mockHandler(content) {
  return async () => ({
    id: `mock-${Date.now()}`,
    provider: "mock",
    model: "mock-model",
    role: "assistant",
    content,
    usage: { inputTokens: 10, outputTokens: 20 },
  });
}

test("ProviderAggregator addProvider registers a provider", () => {
  const aggregator = new ProviderAggregator();
  const provider = createMockProvider("anthropic", mockHandler("hello"));

  aggregator.addProvider("anthropic", provider);

  assert.equal(aggregator.providerCount, 1);
  assert.deepEqual(aggregator.providerNames, ["anthropic"]);
});

test("ProviderAggregator addProvider throws on invalid name", () => {
  const aggregator = new ProviderAggregator();
  const provider = createMockProvider("test", mockHandler("ok"));

  assert.throws(
    () => aggregator.addProvider("", provider),
    /Provider name is required/,
  );
});

test("ProviderAggregator addProvider throws on invalid provider", () => {
  const aggregator = new ProviderAggregator();

  assert.throws(
    () => aggregator.addProvider("bad", {}),
    /Provider must implement a chat/,
  );
});

test("ProviderAggregator sendAll sends to all providers in parallel", async () => {
  const aggregator = new ProviderAggregator();
  const a = createMockProvider("anthropic", mockHandler("Hello from Anthropic!"));
  const b = createMockProvider("openai", mockHandler("Hello from OpenAI!"));
  const c = createMockProvider("google", mockHandler("Hello from Google!"));

  aggregator.addProvider("anthropic", a);
  aggregator.addProvider("openai", b);
  aggregator.addProvider("google", c);

  const results = await aggregator.sendAll("Say hello");

  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.success));
  assert.ok(results.some((r) => r.response.content.includes("Anthropic")));
  assert.ok(results.some((r) => r.response.content.includes("OpenAI")));
  assert.ok(results.some((r) => r.response.content.includes("Google")));
});

test("ProviderAggregator sendAll handles partial failures", async () => {
  const aggregator = new ProviderAggregator();
  const a = createMockProvider("anthropic", mockHandler("OK from Anthropic"));
  const b = createMockProvider("openai", () => {
    throw new Error("OpenAI is down");
  });
  const c = createMockProvider("google", mockHandler("OK from Google"));

  aggregator.addProvider("anthropic", a);
  aggregator.addProvider("openai", b);
  aggregator.addProvider("google", c);

  const results = await aggregator.sendAll("Test prompt");

  assert.equal(results.length, 3);
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  assert.equal(successes.length, 2);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].error.includes("OpenAI"));
});

test("ProviderAggregator sendAll throws with no providers", async () => {
  const aggregator = new ProviderAggregator();

  await assert.rejects(
    () => aggregator.sendAll("test"),
    /No providers registered/,
  );
});

test("ProviderAggregator sendBest routes to the highest-ranked provider", async () => {
  const aggregator = new ProviderAggregator();
  let callLog = [];

  const a = createMockProvider("anthropic", async (req) => {
    callLog.push("anthropic");
    return { content: `anthropic: ${req.prompt}` };
  });
  const b = createMockProvider("openai", async (req) => {
    callLog.push("openai");
    return { content: `openai: ${req.prompt}` };
  });

  aggregator.addProvider("anthropic", a);
  aggregator.addProvider("openai", b);

  // Boost anthropic via success records
  aggregator.recordSuccess("anthropic", 100);
  aggregator.recordSuccess("anthropic", 100);
  aggregator.recordSuccess("anthropic", 100);
  aggregator.recordFailure("openai", new Error("fail"));
  aggregator.recordFailure("openai", new Error("fail"));

  const result = await aggregator.sendBest("Hello");

  assert.equal(result.success, true);
  assert.equal(result.selected, true);
  assert.ok(callLog.length >= 1);
});

test("ProviderAggregator sendSequential tries providers in order", async () => {
  const aggregator = new ProviderAggregator();
  let callOrder = [];

  const a = createMockProvider("anthropic", async () => {
    callOrder.push("anthropic");
    throw new Error("Anthropic failed");
  });
  const b = createMockProvider("openai", async () => {
    callOrder.push("openai");
    return { content: "OpenAI responded" };
  });
  const c = createMockProvider("google", async () => {
    callOrder.push("google");
    return { content: "Google responded" };
  });

  aggregator.addProvider("anthropic", a);
  aggregator.addProvider("openai", b);
  aggregator.addProvider("google", c);

  const result = await aggregator.sendSequential("Test");

  assert.equal(result.success, true);
  assert.equal(result.response.content, "OpenAI responded");
  assert.deepEqual(callOrder, ["anthropic", "openai"]);
  assert.equal(callOrder.length, 2, "Should only call first two providers");
});

test("ProviderAggregator sendSequential throws when all providers fail", async () => {
  const aggregator = new ProviderAggregator();
  const a = createMockProvider("primary", () => {
    throw new Error("Primary down");
  });
  const b = createMockProvider("fallback", () => {
    throw new Error("Fallback down");
  });

  aggregator.addProvider("primary", a);
  aggregator.addProvider("fallback", b);

  await assert.rejects(
    () => aggregator.sendSequential("test"),
    /All providers in sequential chain failed/,
  );
});

test("ProviderAggregator compareResponses produces side-by-side comparison", () => {
  const aggregator = new ProviderAggregator();

  const responses = [
    {
      provider: "anthropic",
      response: { content: "Detailed and thorough response with many words and explanations." },
      success: true,
      latencyMs: 500,
    },
    {
      provider: "openai",
      response: { content: "Short answer." },
      success: true,
      latencyMs: 200,
    },
    {
      provider: "google",
      error: "timeout",
      success: false,
      latencyMs: 10000,
    },
  ];

  const comparison = aggregator.compareResponses(responses);

  assert.equal(comparison.totalResponses, 3);
  assert.equal(comparison.successfulCount, 2);
  assert.equal(comparison.failedCount, 1);
  assert.ok(comparison.averageContentLength > 0);
  assert.equal(comparison.responses.length, 3);
  assert.ok(comparison.summary.includes("Fastest"));
  assert.ok(comparison.summary.includes("Most detailed"));
});

test("ProviderAggregator compareResponses throws with empty array", () => {
  const aggregator = new ProviderAggregator();

  assert.throws(
    () => aggregator.compareResponses([]),
    /At least one response is required/,
  );
});

test("ProviderAggregator voteResponses finds majority consensus", () => {
  const aggregator = new ProviderAggregator();

  const responses = [
    {
      provider: "anthropic",
      response: {
        content: "The system should use caching for performance optimization and implement retry logic for resilience.",
      },
      success: true,
    },
    {
      provider: "openai",
      response: {
        content: "I recommend caching for performance and implementing retry logic for handling failures.",
      },
      success: true,
    },
    {
      provider: "google",
      response: {
        content: "Use caching for performance. Also add retry logic for robustness.",
      },
      success: true,
    },
  ];

  const result = aggregator.voteResponses(responses);

  assert.equal(result.totalVotes, 3);
  assert.ok(result.agreement > 0, "Should have some agreement");
  assert.ok(result.keyPoints.length > 0, "Should extract key points");
  assert.ok(result.perProviderVotes.anthropic, "Should have per-provider votes");
});

test("ProviderAggregator voteResponses with no successful responses", () => {
  const aggregator = new ProviderAggregator();

  const responses = [
    { provider: "a", error: "fail", success: false },
    { provider: "b", error: "fail", success: false },
  ];

  const result = aggregator.voteResponses(responses);

  assert.equal(result.consensus, null);
  assert.equal(result.totalVotes, 0);
  assert.equal(result.agreement, 0);
  assert.equal(result.message, "No successful responses to vote on");
});

test("ProviderAggregator rankings reflect success and failure patterns", () => {
  const aggregator = new ProviderAggregator();
  const a = createMockProvider("fast", mockHandler("ok"));
  const b = createMockProvider("slow", mockHandler("ok"));

  aggregator.addProvider("fast", a);
  aggregator.addProvider("slow", b);

  // Fast provider succeeds with low latency
  aggregator.recordSuccess("fast", 50);
  aggregator.recordSuccess("fast", 60);
  aggregator.recordSuccess("fast", 55);

  // Slow provider has high latency and failures
  aggregator.recordSuccess("slow", 8000);
  aggregator.recordFailure("slow", new Error("timeout"));

  const rankings = aggregator.getRankings();

  assert.ok(rankings.fast.score > rankings.slow.score, "Fast provider should rank higher than slow provider");
});

test("ProviderAggregator reset clears all rankings", () => {
  const aggregator = new ProviderAggregator();
  const provider = createMockProvider("test", mockHandler("ok"));

  aggregator.addProvider("test", provider);
  aggregator.recordSuccess("test", 100);
  aggregator.recordSuccess("test", 100);

  const before = aggregator.getRankings();
  assert.ok(before.test.requests > 0);

  aggregator.reset();

  const after = aggregator.getRankings();
  assert.equal(after.test.requests, 0);
  assert.equal(after.test.score, 0.5);
});

test("ProviderAggregator addProvider is chainable", () => {
  const aggregator = new ProviderAggregator();
  const a = createMockProvider("a", mockHandler("ok"));
  const b = createMockProvider("b", mockHandler("ok"));

  const result = aggregator.addProvider("a", a).addProvider("b", b);

  assert.equal(result, aggregator);
  assert.equal(aggregator.providerCount, 2);
});
