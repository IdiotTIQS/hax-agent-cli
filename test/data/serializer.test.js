/**
 * Tests for data/serializer: serializeSession, deserializeSession,
 * serializeSettings, serializeMessages, toNdjson, fromNdjson, toCsv, fromCsv.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  serializeSession,
  deserializeSession,
  serializeSettings,
  serializeMessages,
  toNdjson,
  fromNdjson,
  toCsv,
  fromCsv,
  SENSITIVE_KEYS,
} = require("../../src/data/serializer");

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

function makeMockSession(overrides = {}) {
  return {
    id: "2025-06-15T10-30-00-000Z-abc12345",
    startTime: Date.now() - 3600000,
    provider: {
      name: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-secret-key-12345",
      client: {},
    },
    settings: {
      agent: {
        name: "hax-agent",
        model: "claude-sonnet-4-20250514",
        apiKey: "sk-ant-project-key-67890",
      },
      memory: { enabled: true, maxItems: 20 },
    },
    messages: [
      { role: "user", content: "Hello", timestamp: "2025-06-15T10:30:05.000Z" },
      { role: "assistant", content: "Hi there!", timestamp: "2025-06-15T10:30:10.000Z" },
      { role: "tool", name: "Read", data: "file content", timestamp: "2025-06-15T10:30:12.000Z", isError: false },
    ],
    costTracker: {
      inputTokens: 150,
      outputTokens: 80,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      turnCount: 2,
      toolCallCount: 1,
    },
    goal: { enabled: true, text: "Refactor the module" },
    modifiedFiles: new Set(["/project/src/index.js", "/project/src/utils.js"]),
    shouldExit: false,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// serializeSession
// ───────────────────────────────────────────────────────────────────────────

test("serializeSession: returns null for null/undefined", () => {
  assert.equal(serializeSession(null), null);
  assert.equal(serializeSession(undefined), null);
});

test("serializeSession: serializes basic session fields", () => {
  const session = makeMockSession();
  const result = serializeSession(session);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.id, session.id);
  assert.equal(result.shouldExit, false);
  assert.ok(typeof result.serializedAt === "string");
  assert.ok(typeof result.elapsedMs === "number");
  assert.ok(result.elapsedMs >= 0);
});

test("serializeSession: includes provider info but not secrets", () => {
  const session = makeMockSession();
  const result = serializeSession(session);

  assert.equal(result.provider.name, "anthropic");
  assert.equal(result.provider.model, "claude-sonnet-4-20250514");
  assert.equal(result.provider.apiUrl, "https://api.anthropic.com");
  // apiKey should NOT be exposed on the provider
  assert.equal(result.provider.apiKey, undefined);
});

test("serializeSession: redacts secrets in settings", () => {
  const session = makeMockSession();
  const result = serializeSession(session);

  // The apiKey in settings.agent should be redacted
  assert.ok(result.settings.agent.apiKey.includes("***"));
  assert.notEqual(result.settings.agent.apiKey, "sk-ant-project-key-67890");
});

test("serializeSession: serializes messages via serializeMessages", () => {
  const session = makeMockSession();
  const result = serializeSession(session);

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content, "Hello");
  assert.equal(result.messages[2].toolName, "Read");
});

test("serializeSession: serializes cost tracker", () => {
  const session = makeMockSession();
  const result = serializeSession(session);

  assert.equal(result.cost.inputTokens, 150);
  assert.equal(result.cost.outputTokens, 80);
  assert.equal(result.cost.turnCount, 2);
  assert.equal(result.cost.toolCallCount, 1);
});

test("serializeSession: handles session without optional fields", () => {
  const minimal = {
    id: "minimal-session",
    messages: [],
  };
  const result = serializeSession(minimal);

  assert.equal(result.id, "minimal-session");
  assert.equal(result.messages.length, 0);
  assert.equal(result.provider, null);
  assert.equal(result.settings, null);
  assert.equal(result.cost, null);
});

// ───────────────────────────────────────────────────────────────────────────
// deserializeSession
// ───────────────────────────────────────────────────────────────────────────

test("deserializeSession: returns null for null/undefined/non-object", () => {
  assert.equal(deserializeSession(null), null);
  assert.equal(deserializeSession(undefined), null);
  assert.equal(deserializeSession("string"), null);
});

test("deserializeSession: reconstructs session from serialized data", () => {
  const session = makeMockSession();
  const serialized = serializeSession(session);
  const reconstructed = deserializeSession(serialized);

  assert.equal(reconstructed.id, session.id);
  assert.equal(reconstructed.messages.length, 3);
  assert.equal(reconstructed.getUserMessages().length, 1);
  assert.equal(reconstructed.getAssistantMessages().length, 1);
  assert.equal(reconstructed.getToolMessages().length, 1);
  assert.equal(reconstructed.cost.inputTokens, 150);
  assert.ok(Array.isArray(reconstructed.modifiedFiles));
  assert.equal(reconstructed.modifiedFiles.length, 2);
});

test("deserializeSession: getter methods work", () => {
  const reconstructed = deserializeSession({
    id: "test",
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "tool", name: "x", data: "y" },
      { role: "assistant", content: "d" },
    ],
    elapsedMs: 125000,
  });

  assert.equal(reconstructed.getMessageCount(), 5);
  assert.equal(reconstructed.getUserMessages().length, 2);
  assert.equal(reconstructed.getAssistantMessages().length, 2);
  assert.equal(reconstructed.getToolMessages().length, 1);
  assert.equal(reconstructed.getElapsedFormatted(), "2m 5s");
});

// ───────────────────────────────────────────────────────────────────────────
// serializeSettings
// ───────────────────────────────────────────────────────────────────────────

test("serializeSettings: returns null for null/undefined", () => {
  assert.equal(serializeSettings(null), null);
  assert.equal(serializeSettings(undefined), null);
});

test("serializeSettings: redacts apiKey by default", () => {
  const settings = { agent: { apiKey: "sk-secret-12345", name: "test" } };
  const result = serializeSettings(settings);

  assert.ok(result.agent.apiKey.includes("***"));
  assert.notEqual(result.agent.apiKey, "sk-secret-12345");
  assert.equal(result.agent.name, "test");
});

test("serializeSettings: does not redact when redactSecrets is false", () => {
  const settings = { agent: { apiKey: "sk-secret-12345", name: "test" } };
  const result = serializeSettings(settings, { redactSecrets: false });

  assert.equal(result.agent.apiKey, "sk-secret-12345");
});

test("serializeSettings: redacts multiple sensitive fields", () => {
  const settings = {
    auth: { apiKey: "key1", secret: "sec1", token: "tok1", password: "pw1" },
  };
  const result = serializeSettings(settings);

  for (const key of ["apiKey", "secret", "token", "password"]) {
    assert.ok(result.auth[key].includes("***"), `Field ${key} should be redacted`);
  }
});

test("serializeSettings: redacts nested objects", () => {
  const settings = {
    providers: {
      anthropic: { apiKey: "sk-ant-123" },
      openai: { apiKey: "sk-openai-456" },
    },
  };
  const result = serializeSettings(settings);

  assert.ok(result.providers.anthropic.apiKey.includes("***"));
  assert.ok(result.providers.openai.apiKey.includes("***"));
});

test("serializeSettings: handles arrays", () => {
  const settings = {
    endpoints: [
      { url: "https://a.com", apiKey: "key-a" },
      { url: "https://b.com", apiKey: "key-b" },
    ],
  };
  const result = serializeSettings(settings);

  assert.equal(result.endpoints[0].url, "https://a.com");
  assert.ok(result.endpoints[0].apiKey.includes("***"));
  assert.ok(result.endpoints[1].apiKey.includes("***"));
});

// ───────────────────────────────────────────────────────────────────────────
// serializeMessages
// ───────────────────────────────────────────────────────────────────────────

test("serializeMessages: returns empty array for non-array", () => {
  assert.deepEqual(serializeMessages(null), []);
  assert.deepEqual(serializeMessages(undefined), []);
  assert.deepEqual(serializeMessages("not-array"), []);
});

test("serializeMessages: normalizes messages", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "tool", name: "Read", data: { key: "val" }, isError: true },
  ];
  const result = serializeMessages(messages);

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "user");
  assert.equal(result[0].content, "hello");
  assert.equal(result[0].index, 0);
  assert.equal(result[1].toolName, "Read");
  assert.equal(result[1].data.key, "val");
  assert.equal(result[1].isError, true);
});

test("serializeMessages: handles null entries in array", () => {
  const messages = [{ role: "user", content: "a" }, null, { role: "assistant", content: "b" }];
  const result = serializeMessages(messages);

  assert.equal(result.length, 3);
  assert.equal(result[1].role, "unknown");
  assert.equal(result[1].index, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// toNdjson / fromNdjson
// ───────────────────────────────────────────────────────────────────────────

test("toNdjson: converts array to NDJSON string", () => {
  const records = [
    { a: 1, b: "x" },
    { a: 2, b: "y" },
  ];
  const result = toNdjson(records);

  const lines = result.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { a: 1, b: "x" });
  assert.deepEqual(JSON.parse(lines[1]), { a: 2, b: "y" });
});

test("toNdjson: returns empty string for non-array", () => {
  assert.equal(toNdjson(null), "");
  assert.equal(toNdjson("not-array"), "");
});

test("fromNdjson: parses NDJSON string", () => {
  const text = '{"a":1}\n{"b":2}\n{"c":3}\n';
  const { records, errors } = fromNdjson(text);

  assert.equal(records.length, 3);
  assert.equal(errors.length, 0);
  assert.deepEqual(records[0], { a: 1 });
  assert.deepEqual(records[1], { b: 2 });
  assert.deepEqual(records[2], { c: 3 });
});

test("fromNdjson: skips invalid lines with error reporting", () => {
  const text = '{"a":1}\nnot-json\n{"b":2}\n';
  const { records, errors } = fromNdjson(text);

  assert.equal(records.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
  assert.ok(errors[0].error.length > 0);
});

test("fromNdjson: handles empty input", () => {
  assert.deepEqual(fromNdjson(""), { records: [], errors: [] });
  assert.deepEqual(fromNdjson("  \n  \n"), { records: [], errors: [] });
});

// ───────────────────────────────────────────────────────────────────────────
// toCsv / fromCsv
// ───────────────────────────────────────────────────────────────────────────

test("toCsv: converts array to CSV with header", () => {
  const records = [
    { name: "Alice", age: 30, city: "NYC" },
    { name: "Bob", age: 25, city: "LA" },
  ];
  const csv = toCsv(records);

  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "name,age,city");
  assert.ok(lines[1].includes("Alice"));
  assert.ok(lines[2].includes("Bob"));
});

test("toCsv: accepts explicit columns", () => {
  const records = [
    { name: "Alice", age: 30, city: "NYC" },
  ];
  const csv = toCsv(records, ["name", "city"]);

  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "name,city");
  assert.ok(!lines[0].includes("age"));
});

test("toCsv: handles values with commas and quotes", () => {
  const records = [{ text: 'hello, "world"' }];
  const csv = toCsv(records);

  const lines = csv.trim().split("\n");
  assert.ok(lines[1].includes('"hello, ""world"""'));
});

test("toCsv: returns empty string for empty array", () => {
  assert.equal(toCsv([]), "");
});

test("fromCsv: parses CSV with header auto-detection", () => {
  const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA\n";
  const records = fromCsv(csv);

  assert.equal(records.length, 2);
  assert.equal(records[0].name, "Alice");
  assert.equal(records[0].age, "30");
  assert.equal(records[0].city, "NYC");
});

test("fromCsv: handles quoted fields", () => {
  const csv = 'name,note\nAlice,"hello, world"\nBob,"said ""hi"""\n';
  const records = fromCsv(csv);

  assert.equal(records.length, 2);
  assert.equal(records[0].note, "hello, world");
  assert.equal(records[1].note, 'said "hi"');
});

test("fromCsv: returns empty array for empty input", () => {
  assert.deepEqual(fromCsv(""), []);
  assert.deepEqual(fromCsv("  \n  "), []);
});

// ───────────────────────────────────────────────────────────────────────────
// SENSITIVE_KEYS and pattern validation
// ───────────────────────────────────────────────────────────────────────────

test("SENSITIVE_KEYS: contains expected keys", () => {
  assert.ok(SENSITIVE_KEYS.has("apiKey"));
  assert.ok(SENSITIVE_KEYS.has("api_key"));
  assert.ok(SENSITIVE_KEYS.has("secret"));
  assert.ok(SENSITIVE_KEYS.has("token"));
  assert.ok(SENSITIVE_KEYS.has("password"));
  assert.ok(SENSITIVE_KEYS.has("privateKey"));
});
