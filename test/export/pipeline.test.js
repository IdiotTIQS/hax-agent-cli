"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ExportPipeline,
  BUILTIN_STAGES,
  BUILTIN_STAGE_NAMES,
  PHASE_ORDER,
} = require("../../src/export/pipeline");

// ── helpers ────────────────────────────────────────────────────────────────

function createSession(entries = []) {
  return {
    id: "session-001",
    updatedAt: "2025-06-15T10:30:00Z",
    entries: () => entries,
    metadata: () => ({ projectName: "test-project", projectRoot: "/tmp/test" }),
  };
}

// ── ExportPipeline class ────────────────────────────────────────────────────

test("ExportPipeline: constructor creates an empty pipeline", () => {
  const pipeline = new ExportPipeline();
  assert.deepEqual(pipeline.getStages(), []);
});

test("ExportPipeline: constructor with autoAddBuiltins adds all built-in stages", () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true });
  const stages = pipeline.getStages();
  assert.equal(stages.length, BUILTIN_STAGE_NAMES.length);
  for (const s of stages) {
    assert.ok(BUILTIN_STAGE_NAMES.includes(s.name), `Unknown stage: ${s.name}`);
  }
});

test("ExportPipeline: constructor with builtinStages subset adds only specified stages", () => {
  const subset = ["extract", "anonymize"];
  const pipeline = new ExportPipeline({ autoAddBuiltins: true, builtinStages: subset });
  const stages = pipeline.getStages();
  assert.equal(stages.length, 2);
  assert.deepEqual(stages.map((s) => s.name).sort(), subset.slice().sort());
});

test("ExportPipeline: addStage appends a stage with name and phase", () => {
  const pipeline = new ExportPipeline();
  pipeline.addStage({
    name: "myStage",
    phase: "transform",
    handler: () => {},
  });

  const stages = pipeline.getStages();
  assert.equal(stages.length, 1);
  assert.equal(stages[0].name, "myStage");
  assert.equal(stages[0].phase, "transform");
});

test("ExportPipeline: addStage accepts a plain function as anonymous stage", () => {
  const pipeline = new ExportPipeline();
  pipeline.addStage(() => {});

  const stages = pipeline.getStages();
  assert.equal(stages.length, 1);
  assert.equal(stages[0].name, "anonymous");
  assert.equal(stages[0].phase, null);
});

test("ExportPipeline: addStage throws TypeError when handler is missing", () => {
  const pipeline = new ExportPipeline();
  assert.throws(() => pipeline.addStage({ name: "bad" }), {
    name: "TypeError",
    message: "Stage must have a handler function",
  });
  assert.throws(() => pipeline.addStage(null), { name: "TypeError" });
  assert.throws(() => pipeline.addStage({ name: "bad", handler: null }), {
    name: "TypeError",
  });
});

test("ExportPipeline: addStage is fluent (returns this)", () => {
  const pipeline = new ExportPipeline();
  const result = pipeline.addStage({ name: "a", handler: () => {} });
  assert.strictEqual(result, pipeline);
});

// ── process ────────────────────────────────────────────────────────────────

test("ExportPipeline: process runs stages in phase order", async () => {
  const pipeline = new ExportPipeline();
  const order = [];

  pipeline.addStage({ name: "deliver-stage", phase: "deliver", handler: () => { order.push("deliver"); } });
  pipeline.addStage({ name: "extract-stage", phase: "extract", handler: () => { order.push("extract"); } });
  pipeline.addStage({ name: "format-stage", phase: "format", handler: () => { order.push("format"); } });

  await pipeline.process(createSession());

  assert.deepEqual(order, ["extract", "format", "deliver"]);
});

test("ExportPipeline: process sets context.data after builtin extract stage", async () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true, builtinStages: ["extract"] });
  const session = createSession([
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ]);

  const result = await pipeline.process(session);

  assert.ok(result.context.data);
  assert.equal(result.context.data.id, "session-001");
  assert.equal(result.context.data.entries.length, 2);
  assert.equal(result.context.metadata.entryCount, 2);
});

test("ExportPipeline: process invokes custom stages with the context", async () => {
  const pipeline = new ExportPipeline();
  let capturedContext = null;

  pipeline.addStage({
    name: "custom",
    handler: (_session, context) => {
      capturedContext = context;
      context.output = "custom-result";
    },
  });

  const session = createSession();
  const result = await pipeline.process(session);

  assert.ok(capturedContext);
  assert.equal(result.output, "custom-result");
  assert.deepEqual(result.context.stagesRun, ["custom"]);
});

test("ExportPipeline: builtin anonymize replaces email and phone patterns in content", async () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true, builtinStages: ["extract", "anonymize"] });
  const session = createSession([
    { role: "user", content: "Contact: user@example.com or 555-123-4567" },
    { role: "assistant", content: "Got it." },
    { role: "tool", name: "lookup", content: "API key: sk-abcdefghijklmnopqrstuvwxyz123456" },
  ]);

  const result = await pipeline.process(session);

  assert.equal(result.context.data.entries[0].content, "Contact: [EMAIL] or [PHONE]");
  assert.equal(result.context.data.entries[1].content, "Got it.");
  assert.ok(result.context.data.entries[2].content.includes("[API_KEY]"));
});

test("ExportPipeline: builtin compressImages replaces data URIs", async () => {
  const pipeline = new ExportPipeline({
    autoAddBuiltins: true,
    builtinStages: ["extract", "compressImages"],
  });
  const longBase64 = "a".repeat(200);
  const session = createSession([
    { role: "tool", name: "screenshot", content: `data:image/png;base64,${longBase64}==` },
  ]);

  const result = await pipeline.process(session);

  assert.equal(result.context.data.entries[0].content, "[COMPRESSED_IMAGE]");
  assert.equal(result.context.metadata.imagesCompressed, true);
});

test("ExportPipeline: builtin highlightCode wraps code fences in pre/code tags", async () => {
  const pipeline = new ExportPipeline({
    autoAddBuiltins: true,
    builtinStages: ["extract", "highlightCode"],
  });
  const session = createSession([
    { role: "assistant", content: "Here is code:\n```js\nconst x = 1;\n```" },
  ]);

  const result = await pipeline.process(session);

  const content = result.context.data.entries[0].content;
  assert.ok(content.includes('<pre class="language-js"><code>'));
  assert.ok(content.includes("</code></pre>"));
  assert.equal(result.context.metadata.codeHighlighted, true);
});

test("ExportPipeline: builtin addMetadata prepends metadata comment block", async () => {
  const pipeline = new ExportPipeline();
  // setOutput must run before addMetadata (optimize), so give it format phase
  pipeline.addStage({
    name: "setOutput",
    phase: "format",
    handler: (_s, ctx) => {
      ctx.data = { id: "test-1", entries: [], exportedAt: "2025-01-01T00:00:00Z" };
      ctx.output = "<!DOCTYPE html>\n<html></html>";
    },
  });
  pipeline.addStage(BUILTIN_STAGES.addMetadata);
  const result = await pipeline.process(createSession());

  assert.ok(result.output.includes("<!-- HaxAgent Export Metadata -->"));
  assert.ok(result.output.includes("id: test-1"));
  assert.equal(result.context.metadata.metadataAdded, true);
});

test("ExportPipeline: builtin minifyOutput collapses blank lines in standard mode", async () => {
  const pipeline = new ExportPipeline();
  pipeline.addStage({
    name: "setOutput",
    phase: "format",
    handler: (_s, ctx) => {
      ctx.output = "line1\n\n\n\nline2\n\n\n\nline3";
    },
  });
  pipeline.addStage(BUILTIN_STAGES.minifyOutput);

  const result = await pipeline.process(createSession());

  assert.equal(result.output, "line1\n\nline2\n\nline3");
  assert.equal(result.context.metadata.minified, true);
});

test("ExportPipeline: builtin minifyOutput in aggressive mode collapses all whitespace", async () => {
  const pipeline = new ExportPipeline();
  pipeline.addStage({
    name: "setOutput",
    phase: "format",
    handler: (_s, ctx) => {
      ctx.output = "  line1   \t  \n  line2  \n  line3  ";
    },
  });
  pipeline.addStage(BUILTIN_STAGES.minifyOutput);

  const result = await pipeline.process(createSession(), { minifyAggressive: true });
  assert.equal(result.output, "line1 line2 line3");
  assert.equal(result.context.metadata.minified, true);
});

// ── clear ──────────────────────────────────────────────────────────────────

test("ExportPipeline: clear removes all stages", () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true });
  assert.ok(pipeline.getStages().length > 0);

  pipeline.clear();
  assert.deepEqual(pipeline.getStages(), []);
});

test("ExportPipeline: clear leaves pipeline usable for new stages", () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true });
  pipeline.clear();
  pipeline.addStage({ name: "new-stage", handler: () => {} });
  assert.equal(pipeline.getStages().length, 1);
  assert.equal(pipeline.getStages()[0].name, "new-stage");
});

// ── edge cases ─────────────────────────────────────────────────────────────

test("ExportPipeline: process on session with no entries does not crash", async () => {
  const pipeline = new ExportPipeline({ autoAddBuiltins: true, builtinStages: ["extract"] });
  const session = {
    id: "empty",
    entries: () => [],
    metadata: () => ({}),
  };

  const result = await pipeline.process(session);

  assert.ok(result.context.data);
  assert.deepEqual(result.context.data.entries, []);
  assert.equal(result.context.metadata.entryCount, 0);
});

test("ExportPipeline: process with an empty pipeline returns empty context", async () => {
  const pipeline = new ExportPipeline();
  const result = await pipeline.process(createSession());
  assert.equal(result.output, null);
  assert.deepEqual(result.context.stagesRun, []);
});

test("ExportPipeline: non-string data fields pass through anonymize unchanged", async () => {
  const pipeline = new ExportPipeline({
    autoAddBuiltins: true,
    builtinStages: ["extract", "anonymize"],
  });
  const session = createSession([
    { role: "tool", name: "fetch", data: { result: "user@example.com" }, content: "" },
  ]);

  const result = await pipeline.process(session);

  // data is an object, not a string — should remain unchanged
  assert.deepEqual(result.context.data.entries[0].data, { result: "user@example.com" });
});
