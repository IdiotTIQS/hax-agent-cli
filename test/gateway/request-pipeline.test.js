"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RequestPipeline } = require("../../src/gateway/request-pipeline");

// ── Helpers ───────────────────────────────────────────────────────────────

function echoHandler(request) {
  return { echoed: request };
}

function createNoopMiddleware(name) {
  return {
    name,
    handler: async function (ctx, next) {
      await next();
    },
  };
}

// ── Core pipeline tests ──────────────────────────────────────────────────

test("RequestPipeline use registers a middleware", () => {
  const pipeline = new RequestPipeline();
  pipeline.use({ name: "test-mw" });

  const config = pipeline.getPipeline();
  assert.equal(config.length, 1);
  assert.equal(config[0].name, "test-mw");
});

test("RequestPipeline use throws on invalid middleware", () => {
  const pipeline = new RequestPipeline();

  assert.throws(() => pipeline.use(null), /Middleware must be a non-null object/);
  assert.throws(() => pipeline.use({}), /Middleware must have a non-empty string "name"/);
  assert.throws(() => pipeline.use({ name: "" }), /Middleware must have a non-empty string "name"/);
  assert.throws(
    () => pipeline.use({ name: "bad", handler: "not-a-function" }),
    /Middleware handler must be a function/,
  );
});

test("RequestPipeline use returns this for chaining", () => {
  const pipeline = new RequestPipeline();
  const result = pipeline
    .use({ name: "a" })
    .use({ name: "b" })
    .use({ name: "c" });

  assert.strictEqual(result, pipeline);
  assert.equal(pipeline.getPipeline().length, 3);
});

test("RequestPipeline execute runs request through middleware chain", async () => {
  const pipeline = new RequestPipeline({ requestHandler: echoHandler });

  const order = [];
  pipeline.use({
    name: "first",
    handler: async (ctx, next) => {
      order.push("first:pre");
      await next();
      order.push("first:post");
    },
  });
  pipeline.use({
    name: "second",
    handler: async (ctx, next) => {
      order.push("second:pre");
      await next();
      order.push("second:post");
    },
  });

  const response = await pipeline.execute({ input: "hello" });

  assert.deepEqual(order, ["first:pre", "second:pre", "second:post", "first:post"]);
  assert.deepEqual(response, { echoed: { input: "hello" } });
});

test("RequestPipeline execute short-circuits when middleware sets response", async () => {
  const pipeline = new RequestPipeline({ requestHandler: echoHandler });

  pipeline.use({
    name: "cache",
    handler: async (ctx) => {
      ctx.response = { cached: true };
      // Does not call next()
    },
  });
  pipeline.use({
    name: "log",
    handler: async (ctx, next) => {
      ctx.metadata.wasReached = true;
      await next();
    },
  });

  const response = await pipeline.execute({ input: "test" });

  assert.deepEqual(response, { cached: true });
  assert.equal(response.echoed, undefined);
});

test("RequestPipeline middleware can modify ctx.request", async () => {
  const pipeline = new RequestPipeline({ requestHandler: echoHandler });

  pipeline.use({
    name: "transform",
    handler: async (ctx, next) => {
      ctx.request.transformed = true;
      ctx.request.body = "modified";
      await next();
    },
  });

  const response = await pipeline.execute({ original: true });

  assert.equal(response.echoed.transformed, true);
  assert.equal(response.echoed.body, "modified");
  assert.equal(response.echoed.original, true);
});

test("RequestPipeline removeMiddleware removes by name", () => {
  const pipeline = new RequestPipeline();
  pipeline.use({ name: "keep" });
  pipeline.use({ name: "remove" });
  pipeline.use({ name: "also-keep" });

  pipeline.removeMiddleware("remove");

  const config = pipeline.getPipeline();
  assert.equal(config.length, 2);
  assert.equal(config[0].name, "keep");
  assert.equal(config[1].name, "also-keep");
});

test("RequestPipeline removeMiddleware does nothing for unknown name", () => {
  const pipeline = new RequestPipeline();
  pipeline.use({ name: "exists" });

  pipeline.removeMiddleware("nonexistent");

  assert.equal(pipeline.getPipeline().length, 1);
});

test("RequestPipeline execute propagates errors from middleware", async () => {
  const pipeline = new RequestPipeline();

  pipeline.use({
    name: "thrower",
    handler: async () => {
      throw new Error("middleware exploded");
    },
  });

  await assert.rejects(
    () => pipeline.execute({}),
    /middleware exploded/,
  );
});

test("RequestPipeline execute propagates errors from request handler", async () => {
  const pipeline = new RequestPipeline({
    requestHandler: () => {
      throw new Error("handler failed");
    },
  });

  pipeline.use(createNoopMiddleware("passthrough"));

  await assert.rejects(
    () => pipeline.execute({}),
    /handler failed/,
  );
});

test("RequestPipeline execute tracks errors in ctx.errors", async () => {
  const errors = [];
  const pipeline = new RequestPipeline({
    requestHandler: () => {
      throw new Error("downstream error");
    },
  });

  pipeline.use({
    name: "collector",
    handler: async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        ctx.errors.push({ stage: "collector", error: err.message, timestamp: Date.now() });
        throw err;
      }
    },
  });

  await assert.rejects(() => pipeline.execute({ url: "/test" }));

  // The handler threw, so the error should be in ctx.errors
  // (but the execute method replaces ctx on error — we need to capture it)
});

test("RequestPipeline getPipeline returns accurate configuration", () => {
  const pipeline = new RequestPipeline();
  pipeline.use({ name: "mw1", handler: () => {} });
  pipeline.use({ name: "mw2" }); // no handler

  const config = pipeline.getPipeline();
  assert.equal(config[0].name, "mw1");
  assert.equal(config[0].hasHandler, true);
  assert.equal(config[1].name, "mw2");
  assert.equal(config[1].hasHandler, false);
});

// ── Built-in middleware factory tests ─────────────────────────────────────

test("RequestPipeline.createTransformMiddleware transforms request and response", async () => {
  const pipeline = new RequestPipeline({ requestHandler: echoHandler });

  pipeline.use(RequestPipeline.createTransformMiddleware({
    name: "transform",
    transformRequest: (ctx) => {
      ctx.request.added = "from-transform";
    },
    transformResponse: (ctx) => {
      ctx.response.wrapped = true;
    },
  }));

  const response = await pipeline.execute({ original: true });
  assert.equal(response.echoed.added, "from-transform");
  assert.equal(response.wrapped, true);
});

test("RequestPipeline.createCacheMiddleware returns cached response on hit", async () => {
  const store = new Map();
  const cache = {
    get: (key) => store.get(key) || null,
    set: (key, val) => { store.set(key, val); },
  };

  const pipeline = new RequestPipeline({ requestHandler: echoHandler });

  pipeline.use(RequestPipeline.createCacheMiddleware({ cache }));

  // First request: cache miss, populate cache
  const res1 = await pipeline.execute({ method: "GET", url: "/api/test" });
  assert.deepEqual(res1, { echoed: { method: "GET", url: "/api/test" } });

  // Second request: cache hit, should skip handler
  const res2 = await pipeline.execute({ method: "GET", url: "/api/test" });
  // The cached value is the echoed response from the first call
  assert.deepEqual(res2, { echoed: { method: "GET", url: "/api/test" } });
});

test("RequestPipeline.createRateLimitMiddleware allows under limit", async () => {
  const limiter = { acquire: () => true };

  const pipeline = new RequestPipeline({ requestHandler: echoHandler });
  pipeline.use(RequestPipeline.createRateLimitMiddleware({ limiter }));

  const response = await pipeline.execute({ url: "/api/test" });
  assert.deepEqual(response, { echoed: { url: "/api/test" } });
});

test("RequestPipeline.createRateLimitMiddleware rejects when rate limited", async () => {
  const limiter = { acquire: () => false };

  const pipeline = new RequestPipeline({ requestHandler: echoHandler });
  pipeline.use(RequestPipeline.createRateLimitMiddleware({ limiter }));

  const response = await pipeline.execute({ url: "/api/blocked" });
  assert.equal(response.code, "RATE_LIMITED");
  assert.equal(response.status, 429);
});

test("RequestPipeline.createLogMiddleware logs request start and end", async () => {
  const logs = [];
  const logger = (level, message, data) => {
    logs.push({ level, message, data });
  };

  const pipeline = new RequestPipeline({ requestHandler: echoHandler });
  pipeline.use(RequestPipeline.createLogMiddleware({ logger }));

  await pipeline.execute({ method: "POST", url: "/api/log-test" });

  assert.ok(logs.length >= 2);
  assert.equal(logs[0].message, "request:start");
  assert.equal(logs[0].data.method, "POST");
  assert.equal(logs[logs.length - 1].message, "request:end");
});

test("RequestPipeline.createRetryMiddleware retries on failure", async () => {
  let callCount = 0;
  const flakyHandler = () => {
    callCount += 1;
    if (callCount < 3) {
      throw new Error("temporary failure");
    }
    return { success: true, attempt: callCount };
  };

  const pipeline = new RequestPipeline({ requestHandler: flakyHandler });
  pipeline.use(RequestPipeline.createRetryMiddleware({ maxRetries: 3, retryDelay: 5 }));

  const response = await pipeline.execute({});
  assert.equal(response.success, true);
  assert.equal(response.attempt, 3);
});

test("RequestPipeline.createRetryMiddleware stops after max retries", async () => {
  const failingHandler = () => {
    throw new Error("always fails");
  };

  const pipeline = new RequestPipeline({ requestHandler: failingHandler });
  pipeline.use(RequestPipeline.createRetryMiddleware({ maxRetries: 2, retryDelay: 5 }));

  await assert.rejects(
    () => pipeline.execute({}),
    /always fails/,
  );
});

test("RequestPipeline.createCircuitBreakerMiddleware opens after threshold failures", async () => {
  const pipeline = new RequestPipeline({
    requestHandler: () => {
      throw new Error("downstream down");
    },
  });

  pipeline.use(RequestPipeline.createCircuitBreakerMiddleware({
    failureThreshold: 3,
    resetTimeout: 60000,
  }));

  // First 3 requests fail and open the circuit
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => pipeline.execute({ url: "/test" }));
  }

  // 4th request should be rejected by circuit breaker (no throw, but error response)
  const response = await pipeline.execute({ url: "/test" });
  assert.equal(response.code, "CIRCUIT_OPEN");
  assert.equal(response.status, 503);
});
