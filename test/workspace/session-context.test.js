"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SessionContext } = require("../../src/workspace/session-context");

// ── Helpers ────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-sc-"));
}

function cleanup(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

// ── Constructor ────────────────────────────────────────────

test("constructor: initialProject sets initial context", () => {
  const ctx = new SessionContext({ initialProject: "/test/project" });
  const current = ctx.getCurrent();

  assert.ok(current);
  assert.equal(current.projectRoot, path.resolve("/test/project"));
  assert.equal(typeof current.lastAccessed, "string");
  assert.ok(current.memoryDir.includes(".hax-agent"));
  assert.ok(current.sessionDir.includes(".hax-agent"));
});

test("constructor: no initialProject has null current", () => {
  const ctx = new SessionContext();
  assert.equal(ctx.getCurrent(), null);
});

// ── save / restore ─────────────────────────────────────────

test("save: persists context and returns frozen snapshot", () => {
  const tmp = tempDir();
  try {
    const ctx = new SessionContext({ storageDir: tmp });

    const snapshot = ctx.save({
      projectRoot: "/test/proj-a",
      settings: { theme: "dark" },
    });

    assert.equal(snapshot.projectRoot, path.resolve("/test/proj-a"));
    assert.equal(snapshot.settings.theme, "dark");
    assert.throws(() => (snapshot.projectRoot = "changed"));

    // Verify it was persisted to disk
    const diskPath = path.join(tmp, "session-context.json");
    assert.ok(fs.existsSync(diskPath));
  } finally {
    cleanup(tmp);
  }
});

test("save: throws when session has no projectRoot", () => {
  const ctx = new SessionContext();
  assert.throws(
    () => ctx.save({}),
    { message: /must have a projectRoot/ },
  );
});

test("restore: returns saved context from memory", () => {
  const ctx = new SessionContext();

  ctx.save({ projectRoot: "/test/proj-b", settings: { key: "val" } });
  const restored = ctx.restore();

  assert.equal(restored.projectRoot, path.resolve("/test/proj-b"));
  assert.equal(restored.settings.key, "val");
});

test("restore: returns initial project when no context saved", () => {
  const ctx = new SessionContext({ initialProject: "/test/default" });
  const restored = ctx.restore();

  assert.ok(restored);
  assert.equal(restored.projectRoot, path.resolve("/test/default"));
});

test("restore: restores from disk when memory is null", () => {
  const tmp = tempDir();
  try {
    // Create a context via one instance
    const ctx1 = new SessionContext({ storageDir: tmp });
    ctx1.save({ projectRoot: "/test/disk-proj" });

    // New instance with no initial project — should load from disk
    const ctx2 = new SessionContext({ storageDir: tmp });
    const restored = ctx2.restore();

    assert.ok(restored);
    assert.equal(restored.projectRoot, path.resolve("/test/disk-proj"));
  } finally {
    cleanup(tmp);
  }
});

test("restore: returns null when nothing available", () => {
  const tmp = tempDir();
  try {
    const ctx = new SessionContext({ storageDir: tmp });
    const restored = ctx.restore();
    assert.equal(restored, null);
  } finally {
    cleanup(tmp);
  }
});

// ── pushContext / popContext ───────────────────────────────

test("pushContext: saves current and switches to new project", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });

  const snapshot = ctx.pushContext("/test/b", { theme: "light" });

  assert.equal(snapshot.projectRoot, path.resolve("/test/b"));
  assert.equal(snapshot.settings.theme, "light");
});

test("pushContext: stack grows with each push", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });

  ctx.pushContext("/test/b");
  ctx.pushContext("/test/c");

  const stack = ctx.getContextStack();
  assert.equal(stack.length, 2);
  assert.equal(stack[0].projectRoot, path.resolve("/test/a"));
  assert.equal(stack[1].projectRoot, path.resolve("/test/b"));

  const current = ctx.getCurrent();
  assert.equal(current.projectRoot, path.resolve("/test/c"));
});

test("popContext: returns to previous project", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });

  ctx.pushContext("/test/b");
  ctx.pushContext("/test/c");

  const restored = ctx.popContext();
  assert.equal(restored.projectRoot, path.resolve("/test/b"));

  const current = ctx.getCurrent();
  assert.equal(current.projectRoot, path.resolve("/test/b"));
});

test("popContext: returns null when stack is empty", () => {
  const ctx = new SessionContext();

  const result = ctx.popContext();
  assert.equal(result, null);
});

test("popContext: after one push, pop goes back to initial", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });

  ctx.pushContext("/test/b");
  ctx.popContext();

  const current = ctx.getCurrent();
  // After push(b): stack=[a], current=b
  // After pop(): current=a (restored from stack)
  assert.equal(current.projectRoot, path.resolve("/test/a"));
});

test("popContext: stack shrinks after pop", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });

  ctx.pushContext("/test/b");
  ctx.pushContext("/test/c");

  assert.equal(ctx.getContextStack().length, 2);

  ctx.popContext();
  assert.equal(ctx.getContextStack().length, 1);

  ctx.popContext();
  assert.equal(ctx.getContextStack().length, 0);
});

// ── withContext ────────────────────────────────────────────

test("withContext: executes fn in new context and restores previous", async () => {
  const ctx = new SessionContext({ initialProject: "/test/original" });

  const original = ctx.getCurrent().projectRoot;

  const result = await ctx.withContext("/test/temp", async (tempContext) => {
    // Inside the fn, current should be the temp context
    assert.equal(tempContext.projectRoot, path.resolve("/test/temp"));
    const inner = ctx.getCurrent();
    assert.equal(inner.projectRoot, path.resolve("/test/temp"));
    return "done";
  });

  assert.equal(result, "done");

  // After withContext, should be back to original
  const current = ctx.getCurrent();
  assert.equal(current.projectRoot, original);
});

test("withContext: restores context even when fn throws", async () => {
  const ctx = new SessionContext({ initialProject: "/test/original" });

  const original = ctx.getCurrent().projectRoot;

  try {
    await ctx.withContext("/test/temp", async () => {
      throw new Error("test failure");
    });
    assert.fail("Expected error was not thrown");
  } catch (err) {
    assert.equal(err.message, "test failure");
  }

  // Context should be restored despite the error
  const current = ctx.getCurrent();
  assert.equal(current.projectRoot, original);
});

test("withContext: works with null initial context", async () => {
  const ctx = new SessionContext();

  const result = await ctx.withContext("/test/temp", async (tempContext) => {
    assert.ok(tempContext);
    assert.equal(tempContext.projectRoot, path.resolve("/test/temp"));
    return "ok";
  });

  assert.equal(result, "ok");
});

// ── getContextStack ────────────────────────────────────────

test("getContextStack: returns a copy, not the original array", () => {
  const ctx = new SessionContext({ initialProject: "/test/a" });
  ctx.pushContext("/test/b");

  const stack = ctx.getContextStack();
  stack.push({ projectRoot: "hacked" });

  // Original stack should be unchanged
  assert.equal(ctx.getContextStack().length, 1);
});

// ── Snapshot immutability ──────────────────────────────────

test("snapshot: is frozen and cannot be mutated", () => {
  const ctx = new SessionContext();
  const snapshot = ctx.save({
    projectRoot: "/test/proj",
    settings: { key: "value" },
  });

  assert.throws(() => (snapshot.settings = {}));
  assert.throws(() => (snapshot.memoryDir = "/hacked"));
});

test("snapshot: has correct default paths", () => {
  const ctx = new SessionContext();
  const snapshot = ctx.save({ projectRoot: "/test/proj" });

  assert.ok(snapshot.memoryDir.includes(".hax-agent"));
  assert.ok(snapshot.memoryDir.includes("memory"));
  assert.ok(snapshot.sessionDir.includes(".hax-agent"));
  assert.ok(snapshot.sessionDir.includes("sessions"));
  assert.ok(snapshot.lastAccessed.match(/^\d{4}-\d{2}-\d{2}T/));
});
