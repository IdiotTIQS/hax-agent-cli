/**
 * Tests for safety RedactionEngine.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RedactionEngine,
  REDACTION_TYPES,
  DEFAULT_PLACEHOLDER_TEMPLATE,
  buildPlaceholder,
  luhnCheck,
  escapeRegExp,
} = require("../../src/safety/redaction");

// ---------------------------------------------------------------------------
// buildPlaceholder
// ---------------------------------------------------------------------------

test("buildPlaceholder: creates placeholder with type", () => {
  assert.equal(buildPlaceholder("API_KEYS"), "[REDACTED:API_KEYS]");
  assert.equal(buildPlaceholder("EMAILS"), "[REDACTED:EMAILS]");
});

test("buildPlaceholder: respects custom template", () => {
  const custom = "<<REDACTED_{type}>>";
  assert.equal(buildPlaceholder("SSN", custom), "<<REDACTED_SSN>>");
  assert.equal(buildPlaceholder("PHONES", custom), "<<REDACTED_PHONES>>");
});

// ---------------------------------------------------------------------------
// luhnCheck
// ---------------------------------------------------------------------------

test("luhnCheck: validates valid card numbers", () => {
  // Test Visa
  assert.equal(luhnCheck("4111111111111111"), true);
  // Test MasterCard
  assert.equal(luhnCheck("5555555555554444"), true);
  // Test Amex
  assert.equal(luhnCheck("378282246310005"), true);
});

test("luhnCheck: rejects invalid numbers", () => {
  assert.equal(luhnCheck("4111111111111112"), false);
  assert.equal(luhnCheck("1234567890123456"), false);
  // 16 zeros passes Luhn mathematically, so test a truly invalid sequence
  assert.equal(luhnCheck("1111111111111111"), false);
});

test("luhnCheck: rejects too-short or too-long strings", () => {
  assert.equal(luhnCheck("123"), false);
  assert.equal(luhnCheck("12345678901234567890"), false);
});

// ---------------------------------------------------------------------------
// escapeRegExp
// ---------------------------------------------------------------------------

test("escapeRegExp: escapes special regex characters", () => {
  assert.equal(escapeRegExp("a.b"), "a\\.b");
  assert.equal(escapeRegExp("a*b"), "a\\*b");
  assert.equal(escapeRegExp("a+b"), "a\\+b");
  assert.equal(escapeRegExp("a|b"), "a\\|b");
  assert.equal(escapeRegExp("a(b"), "a\\(b");
});

// ---------------------------------------------------------------------------
// RedactionEngine constructor
// ---------------------------------------------------------------------------

test("RedactionEngine: constructor with defaults", () => {
  const engine = new RedactionEngine();
  assert.equal(engine.getPlaceholder(), DEFAULT_PLACEHOLDER_TEMPLATE);
});

test("RedactionEngine: constructor with custom placeholder", () => {
  const engine = new RedactionEngine({ placeholder: "***{type}***" });
  assert.equal(engine.getPlaceholder(), "***{type}***");
});

// ---------------------------------------------------------------------------
// redact
// ---------------------------------------------------------------------------

test("redact: redacts email addresses", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Contact me at user@example.com for details.");
  assert.ok(!result.includes("user@example.com"), "Should redact email");
  assert.ok(result.includes("[REDACTED:EMAILS]"), "Should contain redaction placeholder");
});

test("redact: redacts API keys", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("My OpenAI key is sk-abcdefghijklmnopqrstuvwxyz123456");
  assert.ok(!result.includes("sk-abcdefghijklmnopqrstuvwxyz123456"), "Should redact API key");
  assert.ok(result.includes("[REDACTED:API_KEYS]"), "Should contain API_KEYS placeholder");
});

test("redact: redacts phone numbers", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Call me at 555-123-4567 or (800) 555-9999.");
  assert.ok(!result.includes("555-123-4567"), "Should redact phone");
  assert.ok(!result.includes("(800) 555-9999"), "Should redact phone with parens");
  assert.ok(result.includes("[REDACTED:PHONES]"), "Should contain PHONES placeholder");
});

test("redact: redacts credit card numbers (with Luhn)", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Card: 4111-1111-1111-1111 (valid Visa test number)");
  assert.ok(!result.includes("4111-1111-1111-1111"), "Should redact credit card");
  assert.ok(result.includes("[REDACTED:CREDIT_CARDS]"), "Should contain CREDIT_CARDS placeholder");
});

test("redact: redacts IP addresses", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Server at 192.168.1.1 responded with error.");
  assert.ok(!result.includes("192.168.1.1"), "Should redact IP");
  assert.ok(result.includes("[REDACTED:IP_ADDRESSES]"), "Should contain IP_ADDRESSES placeholder");
});

test("redact: redacts SSN", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("SSN: 123-45-6789 on file.");
  assert.ok(!result.includes("123-45-6789"), "Should redact SSN");
  assert.ok(result.includes("[REDACTED:SSN]"), "Should contain SSN placeholder");
});

test("redact: redacts passwords in key=value form", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("password=supersecret123 and secret=myhiddenvalue");
  assert.ok(!result.includes("supersecret123"), "Should redact password value");
  assert.ok(!result.includes("myhiddenvalue"), "Should redact secret value");
  assert.ok(result.includes("[REDACTED:PASSWORDS]"), "Should contain PASSWORDS placeholder");
});

test("redact: redacts JWT tokens", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
  assert.ok(!result.includes("eyJhbGci"), "Should redact JWT");
  assert.ok(result.includes("[REDACTED:TOKENS]"), "Should contain TOKENS placeholder");
});

test("redact: respects types filter option", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("Email me at user@example.com, SSN is 123-45-6789.", {
    types: ["EMAILS"],
  });
  assert.ok(!result.includes("user@example.com"), "Should redact email when EMAILS type is specified");
  assert.ok(result.includes("123-45-6789"), "Should NOT redact SSN when only EMAILS type is specified");
});

test("redact: uses custom placeholder template from constructor", () => {
  const engine = new RedactionEngine({ placeholder: "***HIDDEN_{type}***" });
  const result = engine.redact("user@example.com");
  assert.ok(result.includes("***HIDDEN_EMAILS***"), "Should use custom placeholder");
  assert.ok(!result.includes("user@example.com"));
});

test("redact: handles extra patterns", () => {
  const engine = new RedactionEngine();
  const result = engine.redact("My custom ID is ABC-XYZ-12345.", {
    extraPatterns: [
      { type: "CUSTOM_ID", pattern: /ABC-XYZ-\d{5}/g },
    ],
  });
  assert.ok(!result.includes("ABC-XYZ-12345"), "Should redact custom pattern");
  assert.ok(result.includes("[REDACTED:CUSTOM_ID]"), "Should contain custom placeholder");
});

test("redact: throws on non-string input", () => {
  const engine = new RedactionEngine();
  assert.throws(() => engine.redact(null), /text must be a string/);
  assert.throws(() => engine.redact(undefined), /text must be a string/);
});

test("redact: returns unchanged text when nothing matches", () => {
  const engine = new RedactionEngine();
  const input = "This is perfectly normal text with nothing sensitive.";
  const result = engine.redact(input);
  assert.equal(result, input);
});

// ---------------------------------------------------------------------------
// detectAndRedact
// ---------------------------------------------------------------------------

test("detectAndRedact: is equivalent to redact() with no options", () => {
  const engine1 = new RedactionEngine();
  const engine2 = new RedactionEngine();
  const input = "Email: user@example.com, Phone: 555-123-4567";
  const result1 = engine1.redact(input);
  const result2 = engine2.detectAndRedact(input);
  assert.equal(result1, result2);
});

// ---------------------------------------------------------------------------
// getRedactionMap / getRedactionSummary
// ---------------------------------------------------------------------------

test("getRedactionMap: returns what was redacted and where", () => {
  const engine = new RedactionEngine({ keepMap: true });
  engine.redact("Email: user@example.com, API: sk-abc123def456ghi789jkl012mno345pqr678stu");
  const map = engine.getRedactionMap();
  assert.ok(map.length >= 1, "Should have at least one entry");
  assert.equal(typeof map[0].key, "string");
  assert.equal(typeof map[0].type, "string");
  assert.equal(typeof map[0].original, "string");
  assert.equal(typeof map[0].placeholder, "string");
  assert.equal(typeof map[0].position, "number");
  assert.equal(typeof map[0].length, "number");
});

test("getRedactionMap: returns empty array when keepMap is false", () => {
  const engine = new RedactionEngine({ keepMap: false });
  engine.redact("Email: user@example.com");
  const map = engine.getRedactionMap();
  assert.equal(map.length, 0);
});

test("getRedactionSummary: returns counts by type", () => {
  const engine = new RedactionEngine();
  engine.redact("Email: user@example.com, Phone: 555-123-4567, Other email: admin@test.org");
  const summary = engine.getRedactionSummary();
  assert.equal(summary.total, 3, "Should have 3 total redactions");
  assert.equal(summary.byType.EMAILS, 2, "Should have 2 email redactions");
  assert.equal(summary.byType.PHONES, 1, "Should have 1 phone redaction");
});

// ---------------------------------------------------------------------------
// undoRedaction
// ---------------------------------------------------------------------------

test("undoRedaction: restores original text", () => {
  const engine = new RedactionEngine({ keepMap: true });
  const original = "Email user@example.com and call 555-123-4567.";
  const redacted = engine.redact(original);
  assert.notEqual(redacted, original);

  const restored = engine.undoRedaction(redacted);
  assert.equal(restored, original);
});

test("undoRedaction: returns unchanged when keepMap is false", () => {
  const engine = new RedactionEngine({ keepMap: false });
  const original = "Email user@example.com for help.";
  const redacted = engine.redact(original);
  const restored = engine.undoRedaction(redacted);
  assert.equal(restored, redacted);
});

test("undoRedaction: throws on non-string input", () => {
  const engine = new RedactionEngine();
  assert.throws(() => engine.undoRedaction(null), /must be a string/);
});

// ---------------------------------------------------------------------------
// clearRedactionMap
// ---------------------------------------------------------------------------

test("clearRedactionMap: clears map and counters", () => {
  const engine = new RedactionEngine();
  engine.redact("Email user@example.com");
  assert.ok(engine.getRedactionMap().length > 0);

  engine.clearRedactionMap();
  assert.equal(engine.getRedactionMap().length, 0);
  assert.equal(engine.getRedactionSummary().total, 0);
});

// ---------------------------------------------------------------------------
// REDACTION_TYPES constant
// ---------------------------------------------------------------------------

test("REDACTION_TYPES: contains expected types", () => {
  assert.ok(Array.isArray(REDACTION_TYPES));
  assert.ok(REDACTION_TYPES.includes("API_KEYS"));
  assert.ok(REDACTION_TYPES.includes("PASSWORDS"));
  assert.ok(REDACTION_TYPES.includes("EMAILS"));
  assert.ok(REDACTION_TYPES.includes("PHONES"));
  assert.ok(REDACTION_TYPES.includes("CREDIT_CARDS"));
  assert.ok(REDACTION_TYPES.includes("IP_ADDRESSES"));
  assert.ok(REDACTION_TYPES.includes("TOKENS"));
  assert.ok(REDACTION_TYPES.includes("SSN"));
});
