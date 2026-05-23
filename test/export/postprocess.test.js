"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PostProcessor, PII_PATTERNS } = require("../../src/export/postprocess");

// ── helpers ────────────────────────────────────────────────────────────────

function createProcessor(options = {}) {
  return new PostProcessor(options);
}

// ═══════════════════════════════════════════════════════════════════════════
// anonymize
// ═══════════════════════════════════════════════════════════════════════════

test("anonymize: replaces email addresses with [EMAIL]", () => {
  const pp = createProcessor();
  const input = "Contact us at support@example.com or admin@test.org.";
  const result = pp.anonymize(input);
  assert.ok(!result.includes("support@example.com"));
  assert.ok(!result.includes("admin@test.org"));
  assert.ok(result.includes("[EMAIL]"));
});

test("anonymize: replaces phone numbers with [PHONE]", () => {
  const pp = createProcessor();
  const input = "Call 555-123-4567 or (800) 555-1234 for support.";
  const result = pp.anonymize(input);
  assert.ok(!result.includes("555-123-4567"));
  assert.ok(!result.includes("(800) 555-1234"));
  assert.ok(result.includes("[PHONE]"));
});

test("anonymize: replaces SSN patterns with [SSN]", () => {
  const pp = createProcessor();
  const input = "SSN: 123-45-6789 and 987-65-4321.";
  const result = pp.anonymize(input);
  assert.ok(!/123-45-6789/.test(result));
  assert.ok(!/987-65-4321/.test(result));
  assert.ok(result.includes("[SSN]"));
});

test("anonymize: replaces API keys (sk-, AIza, gh*) with [API_KEY]", () => {
  const pp = createProcessor();
  const input =
    "Key1: sk-abcdefghijklmnopqrstuvwxyz123456 " +
    "Key2: AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 " +
    "Key3: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  const result = pp.anonymize(input);
  assert.ok(!result.includes("sk-abcdefghijklmnopqrstuvwxyz123456"));
  assert.ok(!result.includes("AIza"));
  assert.ok(!result.includes("ghp_"));
  assert.ok(result.includes("[API_KEY]"));
});

test("anonymize: replaces IP addresses with [IP]", () => {
  const pp = createProcessor();
  const input = "Server at 192.168.1.100 and 10.0.0.1 are active.";
  const result = pp.anonymize(input);
  assert.ok(!result.includes("192.168.1.100"));
  assert.ok(!result.includes("10.0.0.1"));
  assert.ok(result.includes("[IP]"));
});

test("anonymize: replaces credit card numbers with [CREDIT_CARD]", () => {
  const pp = createProcessor();
  const input = "Card: 4111111111111111 and 5500000000000004.";
  const result = pp.anonymize(input);
  assert.ok(!result.includes("4111111111111111"));
  assert.ok(!result.includes("5500000000000004"));
  assert.ok(result.includes("[CREDIT_CARD]"));
});

test("anonymize: replaces JWT tokens with [JWT]", () => {
  const pp = createProcessor();
  const input =
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const result = pp.anonymize(input);
  assert.ok(result.includes("[JWT]"));
  assert.ok(!result.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
});

test("anonymize: replaces connection strings with [CONNECTION_STRING]", () => {
  const pp = createProcessor();
  const input = "mongodb://user:pass@db.example.com:27017/mydb";
  const result = pp.anonymize(input);
  assert.ok(result.includes("[CONNECTION_STRING]"));
  assert.ok(!result.includes("mongodb://"));
});

test("anonymize: returns empty string for non-string input", () => {
  const pp = createProcessor();
  assert.equal(pp.anonymize(null), "");
  assert.equal(pp.anonymize(undefined), "");
  assert.equal(pp.anonymize(12345), "");
});

test("anonymize: preserveLength replaces with asterisks instead of labels", () => {
  const pp = createProcessor();
  const input = "Email: user@example.com";
  const result = pp.anonymize(input, { preserveLength: true });
  // "user@example.com" is 16 chars → should become "****************"
  assert.ok(result.includes("****************"));
  assert.ok(!result.includes("[EMAIL]"));
  assert.equal(result.length, "Email: ".length + 16);
});

test("anonymize: custom patterns override defaults", () => {
  const pp = createProcessor();
  const input = "secret: abc123";
  const customPatterns = [{ pattern: /abc\d+/g, replacement: "[CUSTOM]" }];
  const result = pp.anonymize(input, { patterns: customPatterns });
  assert.equal(result, "secret: [CUSTOM]");
});

test("anonymize: content without PII is returned unchanged", () => {
  const pp = createProcessor();
  const input = "This content has no personal information.";
  const result = pp.anonymize(input);
  assert.equal(result, input);
});

// ═══════════════════════════════════════════════════════════════════════════
// beautify
// ═══════════════════════════════════════════════════════════════════════════

test("beautify: formats JSON with indentation", () => {
  const pp = createProcessor();
  const input = '{"a":1,"b":[2,3],"c":{"d":"hello"}}';
  const result = pp.beautify(input, "json");
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed, { a: 1, b: [2, 3], c: { d: "hello" } });
  assert.ok(result.includes("\n"));
  assert.ok(result.includes('  "a": 1'));
});

test("beautify: returns original for invalid JSON", () => {
  const pp = createProcessor();
  const input = "not valid json {";
  const result = pp.beautify(input, "json");
  assert.equal(result, input);
});

test("beautify: normalizes line endings and trims trailing whitespace for text", () => {
  const pp = createProcessor();
  const input = "line1   \r\nline2   \r\n";
  const result = pp.beautify(input, "text");
  assert.equal(result, "line1\nline2");
});

test("beautify: ensures blank lines before headings in markdown", () => {
  const pp = createProcessor();
  const input = "text\n# Heading\nmore text";
  const result = pp.beautify(input, "markdown");
  // Blank line inserted before the heading
  assert.ok(result.includes("text\n\n# Heading"));
});

test("beautify: formats iPynb notebooks via JSON re-parse", () => {
  const pp = createProcessor();
  const input = '{"nbformat":4,"cells":[]}';
  const result = pp.beautify(input, "ipynb");
  assert.ok(result.includes("\n"));
  assert.ok(result.includes('"nbformat": 4'));
});

test("beautify: handles empty string gracefully", () => {
  const pp = createProcessor();
  assert.equal(pp.beautify("", "json"), "");
  assert.equal(pp.beautify("", "html"), "");
  assert.equal(pp.beautify("", "text"), "");
});

// ═══════════════════════════════════════════════════════════════════════════
// validate
// ═══════════════════════════════════════════════════════════════════════════

test("validate: returns valid:true for well-formed JSON", () => {
  const pp = createProcessor();
  const result = pp.validate('{"key":"value"}', "json");
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validate: returns valid:false with errors for malformed JSON", () => {
  const pp = createProcessor();
  const result = pp.validate("{key: value}", "json");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validate: returns valid:false for empty string", () => {
  const pp = createProcessor();
  const result = pp.validate("", "json");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("empty")));
});

test("validate: warns on unbalanced fenced code blocks in markdown", () => {
  const pp = createProcessor();
  const result = pp.validate("```js\ncode\nnot closed", "markdown");
  // Not necessarily invalid, but should warn
  assert.ok(result.warnings.some((w) => w.includes("Unbalanced") || w.includes("odd")));
});

test("validate: warns on missing nbformat in ipynb", () => {
  const pp = createProcessor();
  const result = pp.validate('{"cells":[]}', "ipynb");
  assert.ok(result.warnings.some((w) => w.includes("nbformat")));
});

test("validate: detects null bytes as corruption for text", () => {
  const pp = createProcessor();
  const result = pp.validate("hello\0world", "text");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.toLowerCase().includes("null")));
});

test("validate: warns on potential truncation (trailing ellipsis)", () => {
  const pp = createProcessor();
  const result = pp.validate("Some content...", "text");
  assert.ok(result.warnings.some((w) => w.includes("truncated")));
});

test("validate: warns on large JSON content", () => {
  const pp = createProcessor();
  // Build content > 50MB warning threshold (just check size-based warning)
  const big = JSON.stringify({ data: "x".repeat(60 * 1024 * 1024) });
  const result = pp.validate(big, "json");
  assert.ok(result.warnings.some((w) => w.includes("large")));
});

// ═══════════════════════════════════════════════════════════════════════════
// compress
// ═══════════════════════════════════════════════════════════════════════════

test("compress: safe mode trims trailing whitespace and collapses blank lines", () => {
  const pp = createProcessor();
  const input = "line1   \n\n\n\nline2   \n\n\n\nline3";
  const result = pp.compress(input, { mode: "safe" });
  assert.equal(result, "line1\n\nline2\n\nline3");
});

test("compress: aggressive mode collapses all whitespace", () => {
  const pp = createProcessor();
  const input = "  hello   world  \n  foo   bar  ";
  const result = pp.compress(input, { mode: "aggressive" });
  assert.equal(result, "hello world foo bar");
});

test("compress: aggressive mode removes HTML comments", () => {
  const pp = createProcessor();
  const input = "<!-- comment --><div>hello</div><!-- another -->";
  const result = pp.compress(input, { mode: "aggressive" });
  assert.ok(!result.includes("comment"));
  assert.ok(result.includes("hello"));
});

test("compress: returns empty string for non-string input", () => {
  const pp = createProcessor();
  assert.equal(pp.compress(null), "");
  assert.equal(pp.compress(undefined), "");
});

// ═══════════════════════════════════════════════════════════════════════════
// split
// ═══════════════════════════════════════════════════════════════════════════

test("split: returns single chunk when content fits in maxSize", () => {
  const pp = createProcessor();
  const input = "short content";
  const result = pp.split(input, 100000);
  assert.deepEqual(result, [input]);
  assert.equal(result.length, 1);
});

test("split: splits text content by paragraph boundaries", () => {
  const pp = createProcessor({ maxSplitSize: 50 });
  // Each paragraph ~20 chars, max 50 → should split into 2
  const paras = Array.from({ length: 10 }, (_, i) => "Paragraph " + i + " with some text.");
  const input = paras.join("\n\n");
  const result = pp.split(input);
  assert.ok(result.length > 1, "Expected multiple chunks, got " + result.length);
  for (const chunk of result) {
    assert.ok(Buffer.byteLength(chunk, "utf8") <= 60, "Chunk too large: " + Buffer.byteLength(chunk, "utf8"));
  }
  // All content should be present across chunks
  const joined = result.join("\n\n");
  assert.ok(joined.includes("Paragraph 0"));
  assert.ok(joined.includes("Paragraph 9"));
});

test("split: splits JSON by message entries", () => {
  const pp = createProcessor({ maxSplitSize: 200 });
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "message number " + i + " with enough text to take some space",
  }));
  const input = JSON.stringify({
    sessionId: "test",
    exportedAt: new Date().toISOString(),
    messages,
  });

  const result = pp.split(input, 500, { format: "json" });
  assert.ok(result.length > 1, "Expected multiple chunks for JSON split");
  // Each chunk should be parseable JSON
  for (const chunk of result) {
    const parsed = JSON.parse(chunk);
    assert.ok(Array.isArray(parsed.messages));
    assert.ok(parsed._chunked);
  }
});

test("split: single JSON message still returns at least one chunk", () => {
  const pp = createProcessor();
  const input = JSON.stringify({
    sessionId: "test",
    messages: [{ role: "user", content: "hello" }],
  });
  const result = pp.split(input, 10, { format: "json" });
  assert.ok(result.length >= 1);
  // total content fits so it returns 1 chunk despite small maxSize
});

test("split: returns empty array for non-string input", () => {
  const pp = createProcessor();
  assert.deepEqual(pp.split(null), []);
  assert.deepEqual(pp.split(undefined), []);
});

test("split: respects custom maxSize argument over constructor default", () => {
  const pp = createProcessor({ maxSplitSize: 100000 });
  // Build content with many paragraphs (~30 bytes each) separated by double
  // newlines so the paragraph-based splitter can find boundaries
  const paras = Array.from({ length: 30 }, (_, i) => "para-" + String(i).padStart(3, "0") + " padding text here");
  const input = paras.join("\n\n");
  const result = pp.split(input, 60);
  assert.ok(result.length >= 3, "Expected at least 3 chunks, got " + result.length);
  for (const chunk of result) {
    assert.ok(Buffer.byteLength(chunk, "utf8") <= 120);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// merge
// ═══════════════════════════════════════════════════════════════════════════

test("merge: returns first string for single-element array", () => {
  const pp = createProcessor();
  const result = pp.merge(["single export"]);
  assert.equal(result, "single export");
});

test("merge: returns empty string for empty array", () => {
  const pp = createProcessor();
  assert.equal(pp.merge([]), "");
});

test("merge: combines text exports with separator", () => {
  const pp = createProcessor();
  const result = pp.merge(["export one", "export two"], { format: "text", separator: "\n===\n" });
  assert.ok(result.includes("export one"));
  assert.ok(result.includes("export two"));
  assert.ok(result.includes("==="));
});

test("merge: combines JSON exports into one merged messages array", () => {
  const pp = createProcessor();
  const exp1 = JSON.stringify({
    sessionId: "a",
    messages: [{ role: "user", content: "hello" }],
  });
  const exp2 = JSON.stringify({
    sessionId: "b",
    messages: [{ role: "assistant", content: "hi" }],
  });
  const result = pp.merge([exp1, exp2], { format: "json" });
  const parsed = JSON.parse(result);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].content, "hello");
  assert.equal(parsed.messages[1].content, "hi");
  assert.equal(parsed.sourceCount, 2);
});

test("merge: combines HTML exports by extracting body content", () => {
  const pp = createProcessor();
  const exp1 = "<!DOCTYPE html><html><body><p>one</p></body></html>";
  const exp2 = "<!DOCTYPE html><html><body><p>two</p></body></html>";
  const result = pp.merge([exp1, exp2], { format: "html" });
  assert.ok(result.includes("one"));
  assert.ok(result.includes("two"));
  assert.ok(result.includes("<html"));
  assert.ok(result.includes("</html>"));
});

test("merge: combines markdown exports with headers", () => {
  const pp = createProcessor();
  const result = pp.merge(["# Doc A\ncontent a", "# Doc B\ncontent b"], { format: "markdown" });
  assert.ok(result.includes("Merged"));
  assert.ok(result.includes("# Doc A"));
  assert.ok(result.includes("# Doc B"));
  assert.ok(result.includes("Export 1"));
  assert.ok(result.includes("Export 2"));
});

test("merge: skips unparseable JSON entries gracefully", () => {
  const pp = createProcessor();
  const exp1 = JSON.stringify({ messages: [{ role: "user", content: "ok" }] });
  const exp2 = "not valid json";
  const result = pp.merge([exp1, exp2], { format: "json" });
  const parsed = JSON.parse(result);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.sourceCount, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// PII_PATTERNS export
// ═══════════════════════════════════════════════════════════════════════════

test("PII_PATTERNS: is frozen and contains all required pattern types", () => {
  assert.ok(Object.isFrozen(PII_PATTERNS));
  const patternNames = PII_PATTERNS.map((p) => p.replacement);
  assert.ok(patternNames.includes("[EMAIL]"));
  assert.ok(patternNames.includes("[PHONE]"));
  assert.ok(patternNames.includes("[SSN]"));
  assert.ok(patternNames.includes("[API_KEY]"));
  assert.ok(patternNames.includes("[IP]"));
  assert.ok(patternNames.includes("[CREDIT_CARD]"));
  assert.ok(patternNames.includes("[JWT]"));
  assert.ok(patternNames.includes("[AWS_KEY]"));
  assert.ok(patternNames.includes("[HEX_SECRET]"));
  assert.ok(patternNames.includes("[CONNECTION_STRING]"));
});

// ═══════════════════════════════════════════════════════════════════════════
// constructor options
// ═══════════════════════════════════════════════════════════════════════════

test("PostProcessor: constructor accepts maxSplitSize option", () => {
  const pp = new PostProcessor({ maxSplitSize: 5000 });
  assert.equal(pp._options.maxSplitSize, 5000);
});

test("PostProcessor: constructor uses default maxSplitSize of 100000", () => {
  const pp = new PostProcessor();
  assert.equal(pp._options.maxSplitSize, 100000);
});
