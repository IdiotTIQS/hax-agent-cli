"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  prettifyJson,
  prettifyXml,
  formatCodeBlock,
  formatTable,
  formatList,
  formatKeyValue,
  truncate,
} = require("../../src/format/pretty");

function hasAnsi(text) {
  return /\x1B\[/.test(text);
}

// ── prettifyJson ─────────────────────────────────────────────────────

test("prettifyJson: pretty-prints valid JSON string", () => {
  const input = '{"name":"Alice","age":30}';
  const result = prettifyJson(input);
  assert.ok(result.includes("name"), "should contain key name");
  assert.ok(result.includes("Alice"), "should contain value Alice");
  assert.ok(result.includes("\n"), "should contain newlines (indentation)");
  assert.ok(result.includes('"name"'), "should contain quoted key");
  const reparsed = JSON.parse(result);
  assert.deepStrictEqual(reparsed, { name: "Alice", age: 30 });
});

test("prettifyJson: handles already-parsed objects", () => {
  const obj = { x: 1, y: [2, 3] };
  const result = prettifyJson(obj);
  const reparsed = JSON.parse(result);
  assert.deepStrictEqual(reparsed, obj);
});

test("prettifyJson: returns original string on parse failure", () => {
  const bad = "not valid json at all";
  assert.strictEqual(prettifyJson(bad), bad);
});

test("prettifyJson: handles null/undefined/empty", () => {
  assert.strictEqual(prettifyJson(null), "");
  assert.strictEqual(prettifyJson(undefined), "");
  assert.strictEqual(prettifyJson(42), "42");
});

// ── prettifyXml ──────────────────────────────────────────────────────

test("prettifyXml: pretty-prints nested XML", () => {
  const input = "<root><child>text</child><child>more</child></root>";
  const result = prettifyXml(input);
  // Should contain newlines for indentation
  assert.ok(result.includes("\n"), "should be multiline");
  assert.ok(result.includes("root"), "should contain root element");
  assert.ok(result.includes("child"), "should contain child elements");
  assert.ok(result.includes("text"), "should contain text content");
});

test("prettifyXml: handles self-closing tags", () => {
  const input = "<html><br/><img src='x.png'/></html>";
  const result = prettifyXml(input);
  assert.ok(result.includes("<br/>"));
});

test("prettifyXml: handles empty input", () => {
  assert.strictEqual(prettifyXml(""), "");
  assert.strictEqual(prettifyXml("   "), "");
});

// ── formatCodeBlock ──────────────────────────────────────────────────

test("formatCodeBlock: produces bordered code block with optional language", () => {
  const code = "const x = 1;\nconst y = 2;";
  const result = formatCodeBlock(code, "javascript");
  // Should contain border characters
  assert.ok(result.includes("╭"), "should have top border");
  assert.ok(result.includes("╰"), "should have bottom border");
  assert.ok(result.includes("javascript"), "should contain language label");
  assert.ok(result.includes("const x = 1;"), "should contain code content");
});

test("formatCodeBlock: handles empty / non-string code", () => {
  const result = formatCodeBlock("");
  assert.strictEqual(result, "");
  assert.strictEqual(formatCodeBlock(null), "");
});

// ── formatTable ──────────────────────────────────────────────────────

test("formatTable: formats aligned table with header", () => {
  const data = [
    ["Name", "Age"],
    ["Alice", "30"],
    ["Bob", "25"],
  ];
  const result = formatTable(data);
  assert.ok(result.includes("Name"), "should contain header Name");
  assert.ok(result.includes("Alice"), "should contain row Alice");
  assert.ok(result.includes("Bob"), "should contain row Bob");
  // Separator line after header
  assert.ok(result.includes("─"), "should contain separator");
});

test("formatTable: handles empty data", () => {
  assert.strictEqual(formatTable([]), "");
  assert.strictEqual(formatTable(null), "");
});

test("formatTable: ANSI color enabled", () => {
  const data = [["Key", "Value"]];
  const result = formatTable(data, { ansi: true });
  assert.ok(hasAnsi(result), "should contain ANSI codes");
});

// ── formatList ───────────────────────────────────────────────────────

test("formatList: formats bullet list by default", () => {
  const items = ["first", "second", "third"];
  const result = formatList(items);
  assert.ok(result.includes("• first"));
  assert.ok(result.includes("• second"));
  assert.ok(result.includes("• third"));
});

test("formatList: formats numbered list", () => {
  const items = ["alpha", "beta"];
  const result = formatList(items, "number");
  assert.ok(result.includes("1. alpha"));
  assert.ok(result.includes("2. beta"));
});

test("formatList: formats dash list", () => {
  const items = ["one"];
  const result = formatList(items, "dash");
  assert.ok(result.includes("─ one"));
});

test("formatList: handles empty items array", () => {
  assert.strictEqual(formatList([]), "");
  assert.strictEqual(formatList(null), "");
});

// ── formatKeyValue ───────────────────────────────────────────────────

test("formatKeyValue: aligns key-value pairs", () => {
  const data = { name: "Alice", version: "2.0.1" };
  const result = formatKeyValue(data);
  assert.ok(result.includes("name"), "should contain key name");
  assert.ok(result.includes("Alice"), "should contain value Alice");
  assert.ok(result.includes("version"), "should contain key version");
  assert.ok(result.includes("2.0.1"), "should contain value 2.0.1");
});

test("formatKeyValue: handles null/empty object", () => {
  assert.strictEqual(formatKeyValue(null), "");
  assert.strictEqual(formatKeyValue({}), "");
});

// ── truncate ─────────────────────────────────────────────────────────

test("truncate: returns text unchanged when under maxLength", () => {
  const text = "short text";
  assert.strictEqual(truncate(text, 20), text);
});

test("truncate: truncates at word boundary by default", () => {
  const text = "hello world this is a test";
  const result = truncate(text, 14);
  // Should cut at a space boundary, not mid-word
  assert.ok(result.length <= 15, `result too long: "${result}" (${result.length})`);
  assert.ok(result.startsWith("hello world"), `unexpected start: "${result}"`);
  assert.ok(result.endsWith("…"), "should end with ellipsis");
});

test("truncate: sentence mode cuts at sentence punctuation", () => {
  const text = "First sentence. Second sentence. Third one here.";
  const result = truncate(text, 30, { mode: "sentence" });
  assert.ok(result.startsWith("First sentence."), `unexpected: "${result}"`);
  assert.ok(result.includes("…"), "should include ellipsis");
});

test("truncate: line mode preserves whole lines", () => {
  const text = "line one\nline two\nline three";
  const result = truncate(text, 14, { mode: "line" });
  // "line one" (8 chars) + "\n" + "line two" (8 chars) = 16, should cut after "line one"
  assert.ok(result.includes("line one"), `unexpected: "${result}"`);
  assert.ok(!result.includes("line two"), `should not include line two: "${result}"`);
});

test("truncate: char mode cuts at exact character position", () => {
  const text = "abcdefghijklmnop";
  const result = truncate(text, 8, { mode: "char" });
  assert.strictEqual(result.length, 8);
  assert.ok(result.endsWith("…"));
});

test("truncate: handles empty/null input", () => {
  assert.strictEqual(truncate("", 10), "");
  assert.strictEqual(truncate(null, 10), "");
});

test("truncate: custom ellipsis", () => {
  const text = "hello world this is a long text";
  const result = truncate(text, 15, { ellipsis: "..." });
  assert.ok(result.endsWith("..."));
  assert.ok(!result.endsWith("…"));
});
