"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  APIAdapter,
  ChainAdapter,
  AutoAdapter,
} = require("../../src/compat/adapter");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeAdapter(version, renameMap) {
  return {
    version,
    map(method, args) {
      // Apply renames
      if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        const mapped = {};
        for (const [k, v] of Object.entries(args)) {
          mapped[renameMap[k] || k] = v;
        }
        return [method, mapped];
      }
      return [method, args];
    },
  };
}

// -----------------------------------------------------------------------
// APIAdapter — registerAdapter + resolve (single hop)
// -----------------------------------------------------------------------

test("registerAdapter and single-hop resolve", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) {
      if (method === "search") {
        return ["find", { q: args.query }];
      }
      return [method, args];
    },
  });

  const result = a.resolve(
    { method: "search", args: { query: "hello" }, version: "1.0.0" },
    "2.0.0",
  );
  assert.equal(result.method, "find");
  assert.deepEqual(result.args, { q: "hello" });
  assert.equal(result.hops, 1);
  assert.deepEqual(result.path, ["1.0.0", "2.0.0"]);
});

test("resolve returns identity when source equals target with no hop", () => {
  const a = new APIAdapter();
  // When source and target are identical BFS returns immediately — no adapter needed
  const result = a.resolve(
    { method: "nop", args: [1, 2], version: "1.0.0" },
    "1.0.0",
  );
  assert.equal(result.method, "nop");
  assert.deepEqual(result.args, [1, 2]);
  assert.equal(result.hops, 0);
  assert.deepEqual(result.path, ["1.0.0"]);
});

// -----------------------------------------------------------------------
// APIAdapter — multi-hop resolve (BFS)
// -----------------------------------------------------------------------

test("multi-hop resolve chains adapters via BFS", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "1.1.0", {
    version: "1.1.0",
    map(method, args) {
      return [method + "_v11", args];
    },
  });
  a.registerAdapter("1.1.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) {
      return [method.replace("_v11", "_v2"), { ...args, extra: true }];
    },
  });

  const result = a.resolve(
    { method: "run", args: { a: 1 }, version: "1.0.0" },
    "2.0.0",
  );
  assert.equal(result.method, "run_v2");
  assert.deepEqual(result.args, { a: 1, extra: true });
  assert.equal(result.hops, 2);
  assert.deepEqual(result.path, ["1.0.0", "1.1.0", "2.0.0"]);
});

test("resolve throws when no path exists", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "1.1.0", {
    version: "1.1.0",
    map(method, args) { return [method, args]; },
  });

  assert.throws(
    () => a.resolve({ method: "x", args: {}, version: "1.0.0" }, "3.0.0"),
    /No adapter path found/,
  );
});

test("resolve throws when request.version is missing", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) { return [method, args]; },
  });

  assert.throws(
    () => a.resolve({ method: "x", args: {} }, "2.0.0"),
    /request\.version/,
  );
});

// -----------------------------------------------------------------------
// APIAdapter — adapt convenience method
// -----------------------------------------------------------------------

test("adapt convenience method registers and resolves", () => {
  const a = new APIAdapter();
  a.adapt("1.0.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) {
      return ["_migrated", args];
    },
  });

  const result = a.resolve(
    { method: "any", args: { x: 1 }, version: "1.0.0" },
    "2.0.0",
  );
  assert.equal(result.method, "_migrated");
  assert.deepEqual(result.args, { x: 1 });
});

// -----------------------------------------------------------------------
// ChainAdapter
// -----------------------------------------------------------------------

test("ChainAdapter chains multiple adapters", () => {
  const chain = new ChainAdapter();
  chain
    .add("1.0.0", "1.5.0", {
      version: "1.5.0",
      map(method, args) {
        return [method.toUpperCase(), { ...args, step1: true }];
      },
    })
    .add("1.5.0", "2.0.0", {
      version: "2.0.0",
      map(method, args) {
        return ["step2_" + method, { ...args, step2: true }];
      },
    });

  const result = chain.resolve(
    { method: "call", args: { x: 10 }, version: "1.0.0" },
    "2.0.0",
  );
  assert.equal(result.method, "step2_CALL");
  assert.deepEqual(result.args, { x: 10, step1: true, step2: true });
  assert.equal(result.hops, 2);
});

// -----------------------------------------------------------------------
// AutoAdapter
// -----------------------------------------------------------------------

test("AutoAdapter maps parameter names", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", {
    query: "q",
    limit: "maxResults",
    sortBy: "orderBy",
  });

  const result = auto.resolve(
    {
      method: "search",
      args: { query: "hello", limit: 10, sortBy: "name" },
      version: "1.0.0",
    },
    "2.0.0",
  );
  assert.equal(result.method, "search");
  assert.deepEqual(result.args, { q: "hello", maxResults: 10, orderBy: "name" });
  assert.equal(result.hops, 1);
});

test("AutoAdapter passes through non-mapped parameters", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", { oldName: "newName" });

  const result = auto.resolve(
    {
      method: "run",
      args: { oldName: 1, keepMe: "preserved" },
      version: "1.0.0",
    },
    "2.0.0",
  );
  assert.deepEqual(result.args, { newName: 1, keepMe: "preserved" });
});

test("AutoAdapter.adapt shortcut method", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", { foo: "bar" });

  const result = auto.adapt({
    method: "test",
    args: { foo: "val" },
    version: "1.0.0",
  });
  assert.equal(result.method, "test");
  assert.deepEqual(result.args, { bar: "val" });
  assert.equal(result.version, "2.0.0");
});

test("AutoAdapter.adapt throws on version mismatch", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", {});
  assert.throws(
    () => auto.adapt({ method: "x", args: {}, version: "3.0.0" }),
    /Version mismatch/,
  );
});

test("AutoAdapter handles null/undefined args gracefully", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", { x: "y" });

  const r1 = auto.adapt({ method: "m", args: null, version: "1.0.0" });
  assert.equal(r1.args, null);

  const r2 = auto.adapt({ method: "m", args: undefined, version: "1.0.0" });
  assert.equal(r2.args, undefined);
});

test("AutoAdapter handles array args (pass through)", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", { old: "new" });

  const result = auto.adapt({ method: "m", args: [1, 2, 3], version: "1.0.0" });
  assert.deepEqual(result.args, [1, 2, 3]);
});

test("AutoAdapter.mapParam adds/updates a mapping", () => {
  const auto = new AutoAdapter("1.0.0", "2.0.0", { a: "b" });
  auto.mapParam("c", "d");
  auto.mapParam("a", "b2"); // overwrite

  const result = auto.adapt({ method: "m", args: { a: 1, c: 2 }, version: "1.0.0" });
  assert.deepEqual(result.args, { b2: 1, d: 2 });
});

// -----------------------------------------------------------------------
// APIAdapter — introspection
// -----------------------------------------------------------------------

test("hasAdapter returns true for registered pair", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) { return [method, args]; },
  });
  assert.equal(a.hasAdapter("1.0.0", "2.0.0"), true);
  assert.equal(a.hasAdapter("2.0.0", "1.0.0"), false);
});

test("listAdapters returns registered pairs", () => {
  const a = new APIAdapter();
  a.adapt("1.0.0", "2.0.0", {
    version: "2.0.0",
    map(method, args) { return [method, args]; },
  });
  const list = a.listAdapters();
  assert.equal(list.length, 1);
  assert.equal(list[0].fromVersion, "1.0.0");
  assert.equal(list[0].toVersion, "2.0.0");
});

// -----------------------------------------------------------------------
// Error propagation
// -----------------------------------------------------------------------

test("resolve propagates adapter errors with context", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "2.0.0", {
    version: "2.0.0",
    map() { throw new Error("boom"); },
  });

  assert.throws(
    () => a.resolve({ method: "x", args: {}, version: "1.0.0" }, "2.0.0"),
    /Adapter.*failed.*"x".*boom/,
  );
});

test("adapter must return array [method, args]", () => {
  const a = new APIAdapter();
  a.registerAdapter("1.0.0", "2.0.0", {
    version: "2.0.0",
    map() { return "not-an-array"; },
  });

  assert.throws(
    () => a.resolve({ method: "x", args: {}, version: "1.0.0" }, "2.0.0"),
    /must return \[method, args\]/,
  );
});
