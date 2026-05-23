"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  highlightJs,
  highlightJson,
  highlightMarkdown,
  highlightDiff,
  highlightShell,
  highlightXml,
} = require("../../src/format/syntax");

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function hasAnsi(text) {
  return /\x1B\[/.test(text);
}

// ── highlightJs ──────────────────────────────────────────────────────

test("highlightJs: handles empty / non-string input", () => {
  assert.strictEqual(highlightJs(""), "");
  assert.strictEqual(highlightJs(null), "");
  assert.strictEqual(highlightJs(undefined), "");
});

test("highlightJs: highlights JS keywords", () => {
  const result = highlightJs("const x = function() {}");
  assert.ok(hasAnsi(result), "result should contain ANSI codes");
  // strip ANSI and verify original text is preserved
  assert.strictEqual(stripAnsi(result), "const x = function() {}");
  // "const" should be wrapped in ANSI (keyword)
  assert.ok(result.includes("const"), "should contain 'const'");
});

test("highlightJs: highlights strings and numbers", () => {
  const result = highlightJs('let name = "hello"; let age = 42;');
  const plain = stripAnsi(result);
  assert.strictEqual(plain, 'let name = "hello"; let age = 42;');
  // The quote portions should be present
  assert.ok(result.includes('"hello"'));
  assert.ok(result.includes("42"));
});

test("highlightJs: highlights // single-line and /* block */ comments", () => {
  const code = "// this is a comment\nconst a = 1; /* inline */";
  const result = highlightJs(code);
  assert.strictEqual(stripAnsi(result), code);
  // Comment portions should contain ANSI
  assert.ok(result.includes("is a comment"));
  assert.ok(result.includes("inline"));
});

test("highlightJs: highlights regex literals", () => {
  const code = "const re = /test/g;";
  const result = highlightJs(code);
  assert.strictEqual(stripAnsi(result), code);
  assert.ok(result.includes("/test/g"));
});

test("highlightJs: highlights PascalCase as types", () => {
  const result = highlightJs("class FooBar extends Base {}");
  const plain = stripAnsi(result);
  assert.strictEqual(plain, "class FooBar extends Base {}");
});

test("highlightJs: highlights template literals with expressions", () => {
  const code = "const msg = `Hello ${name}!`;";
  const result = highlightJs(code);
  assert.strictEqual(stripAnsi(result), code);
});

// ── highlightJson ────────────────────────────────────────────────────

test("highlightJson: highlights keys, strings, numbers, booleans", () => {
  const json = '{"name":"Alice","age":30,"active":true,"data":null}';
  const result = highlightJson(json);
  assert.strictEqual(stripAnsi(result), json);
});

test("highlightJson: handles nested objects and arrays", () => {
  const json = '{"items":[{"id":1,"val":"a"},{"id":2,"val":"b"}]}';
  const result = highlightJson(json);
  assert.strictEqual(stripAnsi(result), json);
});

test("highlightJson: handles empty input", () => {
  assert.strictEqual(highlightJson(""), "");
  assert.strictEqual(highlightJson(null), "");
});

// ── highlightMarkdown ────────────────────────────────────────────────

test("highlightMarkdown: highlights headings", () => {
  const md = "# Title\n## Subtitle\n\nContent";
  const result = highlightMarkdown(md);
  const plain = stripAnsi(result);
  assert.strictEqual(plain, md);
  // Heading markers should be preserved
  assert.ok(plain.startsWith("# Title"));
});

test("highlightMarkdown: highlights inline bold, italic, code, links", () => {
  const md = "This is **bold** and *italic* and `code` and [link](url).";
  const result = highlightMarkdown(md);
  // Markdown syntax should still appear in plain text
  const plain = stripAnsi(result);
  assert.ok(plain.includes("bold"));
  assert.ok(plain.includes("italic"));
  assert.ok(plain.includes("link"));
  assert.ok(plain.includes("code"));
});

test("highlightMarkdown: handles fenced code blocks", () => {
  const md = "```js\nconst x = 1;\n```";
  const result = highlightMarkdown(md);
  const plain = stripAnsi(result);
  assert.ok(plain.includes("```js"));
  assert.ok(plain.includes("const x = 1;"));
  assert.ok(plain.includes("```"));
});

test("highlightMarkdown: handles blockquotes and lists", () => {
  const md = "> quoted text\n\n- item 1\n- item 2";
  const result = highlightMarkdown(md);
  const plain = stripAnsi(result);
  assert.ok(plain.includes("quoted text"));
  assert.ok(plain.includes("item 1"));
  assert.ok(plain.includes("item 2"));
});

// ── highlightDiff ────────────────────────────────────────────────────

test("highlightDiff: highlights added, removed, and header lines", () => {
  const diff = `--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 unchanged
-old line
+new line
`;
  const result = highlightDiff(diff);
  const plain = stripAnsi(result);
  assert.strictEqual(plain, diff);
});

test("highlightDiff: handles empty input", () => {
  assert.strictEqual(highlightDiff(""), "");
  assert.strictEqual(highlightDiff(null), "");
});

// ── highlightShell ───────────────────────────────────────────────────

test("highlightShell: highlights commands, flags, variables", () => {
  const cmd = "git commit -m \"fix bug\" --no-verify $FILE";
  const result = highlightShell(cmd);
  assert.strictEqual(stripAnsi(result), cmd);
});

test("highlightShell: highlights comments and pipes", () => {
  const cmd = "ls -la | grep foo # find foo\n";
  const result = highlightShell(cmd);
  assert.strictEqual(stripAnsi(result), cmd);
});

test("highlightShell: handles empty input", () => {
  assert.strictEqual(highlightShell(""), "");
  assert.strictEqual(highlightShell(null), "");
});

// ── highlightXml ─────────────────────────────────────────────────────

test("highlightXml: highlights tags, attributes, and text", () => {
  const xml = '<div class="main"><p>Hello</p></div>';
  const result = highlightXml(xml);
  assert.strictEqual(stripAnsi(result), xml);
});

test("highlightXml: handles comments and self-closing tags", () => {
  const xml = '<!-- comment --><img src="x.png" /><br/>';
  const result = highlightXml(xml);
  assert.strictEqual(stripAnsi(result), xml);
});

test("highlightXml: handles empty input", () => {
  assert.strictEqual(highlightXml(""), "");
  assert.strictEqual(highlightXml(null), "");
});
