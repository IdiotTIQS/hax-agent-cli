import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderMarkdownLine } from "../src/tui-ink/markdown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip all ANSI escape sequences from a string. */
function strip(s: string): string {
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

/** Return true if s contains at least one ANSI escape sequence. */
function hasAnsi(s: string): boolean {
  return /\x1B\[/.test(s);
}

// ---------------------------------------------------------------------------
// renderMarkdown — inline formatting
// ---------------------------------------------------------------------------

test("renderMarkdown: bold text is wrapped in ANSI and literal markers are removed", () => {
  const out = renderMarkdown("**bold**");
  assert.ok(!out.includes("**"), "should not contain raw ** markers");
  assert.ok(strip(out).includes("bold"), "plain text should survive");
  assert.ok(hasAnsi(out), "should contain ANSI codes");
});

test("renderMarkdown: italic text is wrapped in ANSI and literal markers are removed", () => {
  const out = renderMarkdown("*italic*");
  assert.ok(!out.includes("*italic*"), "raw italic markers should be removed");
  assert.ok(strip(out).includes("italic"), "plain text should survive");
  assert.ok(hasAnsi(out), "should contain ANSI codes");
});

test("renderMarkdown: inline code is wrapped in ANSI and backticks are removed", () => {
  const out = renderMarkdown("`myFunc()`");
  assert.ok(!out.includes("`"), "backticks should be removed");
  assert.ok(strip(out).includes("myFunc()"), "code content should survive");
  assert.ok(hasAnsi(out), "should contain ANSI codes");
});

// ---------------------------------------------------------------------------
// renderMarkdown — block-level elements
// ---------------------------------------------------------------------------

test("renderMarkdown: heading produces ANSI output without # prefix", () => {
  const out = renderMarkdown("# Hello World");
  assert.ok(!out.startsWith("#"), "should not start with raw # character");
  assert.ok(strip(out).includes("Hello World"), "heading text should survive");
  assert.ok(hasAnsi(out), "should contain ANSI codes");
});

test("renderMarkdown: list item strips marker and applies ANSI", () => {
  const out = renderMarkdown("- item one");
  assert.ok(strip(out).includes("item one"), "list text should survive");
  assert.ok(hasAnsi(out), "should contain ANSI codes");
});

test("renderMarkdown: fenced code block renders bordered box", () => {
  const md = "```js\nconsole.log('hi');\n```";
  const out = renderMarkdown(md);
  // The renderer emits box-drawing characters for the code block.
  assert.ok(out.includes("╭") || out.includes("┌"), "should contain top border");
  assert.ok(out.includes("╰") || out.includes("└"), "should contain bottom border");
  assert.ok(strip(out).includes("console.log"), "code content should survive");
});

test("renderMarkdown: mixed inline on a single line", () => {
  const out = renderMarkdown("**bold** and `code`");
  assert.ok(!out.includes("**"), "** markers should be consumed");
  assert.ok(!out.includes("`"), "backticks should be consumed");
  assert.ok(strip(out).includes("bold"), "bold text should survive");
  assert.ok(strip(out).includes("code"), "code text should survive");
});

// ---------------------------------------------------------------------------
// renderMarkdown — edge cases
// ---------------------------------------------------------------------------

test("renderMarkdown: empty string returns empty string", () => {
  assert.equal(renderMarkdown(""), "");
});

test("renderMarkdown: plain text with no markdown is returned unchanged", () => {
  const plain = "just plain text";
  assert.equal(strip(renderMarkdown(plain)), plain);
});

test("renderMarkdown: columns parameter is accepted without error", () => {
  const out = renderMarkdown("hello", 120);
  assert.ok(typeof out === "string");
});

// ---------------------------------------------------------------------------
// renderMarkdownLine — single non-fence lines
// ---------------------------------------------------------------------------

test("renderMarkdownLine: plain line is returned as plain text", () => {
  const line = "This is a plain line.";
  assert.equal(strip(renderMarkdownLine(line)), line);
});

test("renderMarkdownLine: inline styled line strips markers and adds ANSI", () => {
  const out = renderMarkdownLine("Use **bold** for emphasis and `code` for values.");
  assert.ok(!out.includes("**"), "** markers should be removed");
  assert.ok(!out.includes("`"), "backticks should be removed");
  assert.ok(strip(out).includes("bold"), "bold word should survive");
  assert.ok(strip(out).includes("code"), "code word should survive");
});

test("renderMarkdownLine: heading line is rendered without # prefix", () => {
  const out = renderMarkdownLine("## Section Title");
  assert.ok(!out.trimStart().startsWith("#"), "# should not appear in output");
  assert.ok(strip(out).includes("Section Title"), "heading text should survive");
});

test("renderMarkdownLine: list item line renders correctly", () => {
  const out = renderMarkdownLine("- list entry");
  assert.ok(strip(out).includes("list entry"), "list text should survive");
});

test("renderMarkdownLine: empty string returns empty string", () => {
  assert.equal(renderMarkdownLine(""), "");
});

test("renderMarkdownLine: columns parameter is accepted without error", () => {
  const out = renderMarkdownLine("hello", 100);
  assert.ok(typeof out === "string");
});
