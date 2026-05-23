"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FormatPipeline } = require("../../src/format/pipeline");

// ── Helpers ──────────────────────────────────────────────────────────

function makeFormatter(name, prefix) {
  return {
    name,
    format(text) {
      return prefix + text + prefix;
    },
  };
}

// ── Basic registration ───────────────────────────────────────────────

test("use: registers a formatter and returns the pipeline", () => {
  const p = new FormatPipeline();
  const result = p.use(makeFormatter("bold", "*"));
  assert.strictEqual(result, p);
  assert.deepStrictEqual(p.names, ["bold"]);
});

test("use: replaces a formatter with the same name", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("bold", "*"));
  p.use(makeFormatter("bold", "**"));
  assert.strictEqual(p.names.length, 1);
  assert.strictEqual(p.names[0], "bold");
});

test("use: throws if formatter is missing name or format", () => {
  const p = new FormatPipeline();
  assert.throws(() => p.use({}), /TypeError/);
  assert.throws(() => p.use({ name: "x" }), /TypeError/);
  assert.throws(() => p.use({ format: () => {} }), /TypeError/);
});

// ── format() ─────────────────────────────────────────────────────────

test("format: runs text through all enabled formatters in order", () => {
  const p = new FormatPipeline();
  p.use({ name: "a", format: (t) => `[${t}]` });
  p.use({ name: "b", format: (t) => `(${t})` });
  assert.strictEqual(p.format("hello"), "([hello])");
});

test("format: passes options to each formatter", () => {
  const p = new FormatPipeline();
  const received = [];
  p.use({
    name: "opt",
    format(text, options) {
      received.push(options);
      return text;
    },
  });
  p.format("hi", { lang: "js" });
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].lang, "js");
});

// ── enable / disable ─────────────────────────────────────────────────

test("enable/disable: skips disabled formatters", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("a", "<"));
  p.use(makeFormatter("b", ">"));
  p.disable("a");
  assert.strictEqual(p.format("x"), ">x>");
});

test("enable/disable: returns false for unknown formatter name", () => {
  const p = new FormatPipeline();
  assert.strictEqual(p.enable("nope"), false);
  assert.strictEqual(p.disable("nope"), false);
});

// ── removeFormatter ──────────────────────────────────────────────────

test("removeFormatter: removes by name and also drops it from disabled set", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("a", "*"));
  p.use(makeFormatter("b", "-"));
  p.disable("a");

  assert.strictEqual(p.removeFormatter("a"), true);
  assert.deepStrictEqual(p.names, ["b"]);
  // name "a" should not exist in disabled any more
  assert.strictEqual(p.disabled.has("a"), false);
});

test("removeFormatter: returns false for unknown name", () => {
  const p = new FormatPipeline();
  assert.strictEqual(p.removeFormatter("missing"), false);
});

// ── isEnabled / names ────────────────────────────────────────────────

test("isEnabled: reflects disabled state", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("x", ">"));
  assert.strictEqual(p.isEnabled("x"), true);
  p.disable("x");
  assert.strictEqual(p.isEnabled("x"), false);
  p.enable("x");
  assert.strictEqual(p.isEnabled("x"), true);
});

test("names: returns ordered list of registered formatter names", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("first", "1"));
  p.use(makeFormatter("second", "2"));
  assert.deepStrictEqual(p.names, ["first", "second"]);
});

// ── clear ────────────────────────────────────────────────────────────

test("clear: removes all formatters and disabled state", () => {
  const p = new FormatPipeline();
  p.use(makeFormatter("a", "x"));
  p.use(makeFormatter("b", "y"));
  p.disable("a");
  p.clear();
  assert.strictEqual(p.names.length, 0);
  assert.strictEqual(p.disabled.size, 0);
});

// ── formatStream ─────────────────────────────────────────────────────

test("formatStream: creates a Transform that applies streamable formatters", (t, done) => {
  const p = new FormatPipeline();
  p.use({
    name: "upper",
    format: (text) => text.toUpperCase(),
    isStreamable: true,
  });
  p.use({
    name: "slow",
    format: (text) => `[${text}]`,
    isStreamable: false,
  });

  const { Readable } = require("stream");

  const input = new Readable({ read() {} });
  const transform = p.formatStream(input);

  const chunks = [];
  transform.on("data", (chunk) => chunks.push(chunk.toString()));
  transform.on("end", () => {
    const result = chunks.join("");
    // Only the streamable "upper" should have been applied
    assert.strictEqual(result, "HELLO");
    done();
  });

  input.push("hello");
  input.push(null);
});
