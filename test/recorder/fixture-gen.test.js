"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  FixtureGenerator,
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_VALUE_PATTERNS,
} = require("../../src/recorder/fixture-gen");

function makeRecording(events) {
  return {
    version: 1,
    metadata: {
      id: "test-fixture-rec",
      sessionId: "test-fixture-session",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    events,
    startTime: events[0]?.timestamp || new Date().toISOString(),
    endTime: events[events.length - 1]?.timestamp || new Date().toISOString(),
  };
}

function evt(type, data, offsetMs = 0) {
  return {
    type,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
    data,
    context: {},
  };
}

test("FixtureGenerator: generateFromRecording() produces fixture with scenarios", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Write a function to sort an array" }),
    evt("assistant_response", { content: "Here is a sort function:", usage: { input_tokens: 100, output_tokens: 50 } }),
    evt("user_message", { content: "Add unit tests for it" }),
    evt("assistant_response", { content: "Here are the tests:" }),
  ]);

  const result = gen.generateFromRecording(recording);

  assert.ok(result.fixtureName);
  assert.ok(Array.isArray(result.scenarios));
  assert.ok(result.scenarios.length >= 2, `Expected >= 2 scenarios, got ${result.scenarios.length}`);
  assert.ok(result.testCode.includes('test("'));
  assert.ok(result.testCode.includes("assert.ok"));
  assert.ok(result.mockResponses);
});

test("FixtureGenerator: generateFromRecording() with anonymize=false preserves data", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Hello", apiKey: "sk-secret123" }),
  ]);

  const result = gen.generateFromRecording(recording, { anonymize: false });

  // The original recording in the result should still have the apiKey
  const rawContent = JSON.stringify(result);
  assert.ok(rawContent.includes("sk-secret123"));
});

test("FixtureGenerator: generateFromRecording() with minimize=true reduces events", () => {
  const gen = new FixtureGenerator();

  // Create a recording with many redundant events
  const events = [];
  for (let i = 0; i < 10; i++) {
    events.push(evt("user_message", { content: `Message ${i}` }));
    events.push(evt("assistant_response", { content: `Response ${i}` }));
  }
  const recording = makeRecording(events);

  const result = gen.generateFromRecording(recording, { minimize: true });

  assert.ok(result.recording.events.length < 20);
});

test("FixtureGenerator: anonymize() redacts API keys in data", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "My key is sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu" }),
    evt("assistant_response", {
      content: "OK",
      apiKey: "sk-super-secret-long-key-12345",
      authToken: "Bearer xyz-token-value",
    }),
  ]);

  const anonymized = gen.anonymize(recording);

  // Check that metadata apiKey is redacted
  const json = JSON.stringify(anonymized);
  assert.ok(!json.includes("sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu"));
  assert.ok(!json.includes("sk-super-secret-long-key-12345"));
  assert.ok(!json.includes("Bearer xyz-token-value"));
  assert.ok(json.includes("[REDACTED]"));
});

test("FixtureGenerator: anonymize() redacts JWT tokens", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", {
      content: "Auth header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9Pl0FfD0vE0rA",
    }),
  ]);

  const anonymized = gen.anonymize(recording);
  const json = JSON.stringify(anonymized);

  assert.ok(!json.includes("eyJhbGci"));
});

test("FixtureGenerator: anonymize() redacts email addresses", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Contact admin@company.com or john.doe@example.org" }),
  ]);

  const anonymized = gen.anonymize(recording);
  const json = JSON.stringify(anonymized);

  assert.ok(!json.includes("admin@company.com"));
  assert.ok(!json.includes("john.doe@example.org"));
  assert.ok(json.includes("user@example.com"));
});

test("FixtureGenerator: minimize() keeps first user message and errors", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("state_change", { state: "loading" }),
    evt("user_message", { content: "First message" }),
    evt("assistant_response", { content: "Processing..." }),
    evt("user_message", { content: "Second message" }),
    evt("assistant_response", { content: "More processing..." }),
    evt("error", { message: "Something failed" }),
    evt("user_message", { content: "Third message" }),
  ]);

  const minimized = gen.minimize(recording);

  // Should keep: first user msg, first assistant, error
  const types = minimized.events.map((e) => e.type);
  assert.ok(types.includes("user_message"));
  assert.ok(types.includes("error"));
});

test("FixtureGenerator: extractScenarios() groups by user messages", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Task 1" }),
    evt("assistant_response", { content: "Result 1" }),
    evt("tool_call", { name: "run", arguments: { cmd: "ls" } }),
    evt("tool_result", { output: "file listing" }),
    evt("user_message", { content: "Task 2" }),
    evt("assistant_response", { content: "Result 2" }),
    evt("error", { message: "Issue in task 2" }),
  ]);

  const scenarios = gen.extractScenarios(recording);

  assert.ok(scenarios.length >= 2);

  // First scenario should include user_message, assistant_response, tool_call, tool_result
  const scenario1 = scenarios[0];
  assert.equal(scenario1.events[0].type, "user_message");
  assert.equal(scenario1.events[0].data.content, "Task 1");
  assert.equal(scenario1.events.length, 4);

  // Second scenario should include user_message, assistant_response, error
  const scenario2 = scenarios[1];
  assert.equal(scenario2.events[0].type, "user_message");
  assert.equal(scenario2.events[0].data.content, "Task 2");
});

test("FixtureGenerator: toTestCode() generates valid Node.js test syntax", () => {
  const gen = new FixtureGenerator();
  const fixture = {
    name: "my test_scenario with spaces",
    userMessage: "User said hello",
    events: [
      evt("user_message", { content: "Hello, write a test" }),
      evt("assistant_response", { content: "Here is the code: `const x = 1;`" }),
      evt("tool_call", { name: "file_write", arguments: { path: "test.js", content: "code" } }),
      evt("error", { message: "Unexpected token" }),
    ],
  };

  const code = gen.toTestCode(fixture);

  assert.ok(code.includes('test("my_test_scenario_with_spaces"'));
  assert.ok(code.includes('assert.ok') || code.includes('assert('));
  assert.ok(code.includes("const userMsg1 ="));
  assert.ok(code.includes("Hello, write a test"));
  assert.ok(code.includes("Here is the code"));
  assert.ok(code.includes('t.mock.method(tools, "file_write"'));
  assert.ok(code.includes("Unexpected token"));
});

test("FixtureGenerator: toTestCode() handles empty fixture gracefully", () => {
  const gen = new FixtureGenerator();
  const fixture = { name: "empty_test", userMessage: "", events: [] };

  const code = gen.toTestCode(fixture);

  assert.ok(code.includes('test("empty_test"'));
  assert.ok(code.includes("assert.ok"));
});

test("FixtureGenerator: generateMockResponses() extracts assistant responses", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Hi" }),
    evt("assistant_response", {
      content: "Hello!",
      usage: { input_tokens: 50, output_tokens: 10 },
    }),
    evt("user_message", { content: "Do something" }),
    evt("assistant_response", {
      content: "Sure!",
      tool_use: [{ name: "read", input: { path: "file.txt" } }],
      stop_reason: "tool_use",
    }),
    evt("tool_result", { output: "file contents" }),
  ]);

  const mocks = gen.generateMockResponses(recording);

  assert.equal(mocks.length, 2);

  assert.equal(mocks[0].type, "assistant_response");
  assert.equal(mocks[0].content, "Hello!");
  assert.equal(mocks[0].usage.input_tokens, 50);

  assert.equal(mocks[1].content, "Sure!");
  assert.equal(mocks[1].stopReason, "tool_use");
  assert.ok(Array.isArray(mocks[1].toolCalls));
  assert.equal(mocks[1].toolCalls.length, 1);
});

test("FixtureGenerator: saveFixture() writes JSON and test files", () => {
  const gen = new FixtureGenerator();
  const recording = makeRecording([
    evt("user_message", { content: "Test message" }),
    evt("assistant_response", { content: "Test response" }),
  ]);

  const result = gen.generateFromRecording(recording, { scenarioName: "saved_fixture" });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-fixture-test-"));
  try {
    const paths = gen.saveFixture(result, tmpDir);

    assert.ok(fs.existsSync(paths.jsonPath));
    assert.ok(paths.jsonPath.endsWith("saved_fixture.json"));
    assert.ok(fs.existsSync(paths.testPath));
    assert.ok(paths.testPath.endsWith("saved_fixture.generated.test.js"));

    const jsonContent = JSON.parse(fs.readFileSync(paths.jsonPath, "utf8"));
    assert.equal(jsonContent.fixtureName, "saved_fixture");

    const testContent = fs.readFileSync(paths.testPath, "utf8");
    assert.ok(testContent.includes("Generated fixture test"));
    assert.ok(testContent.includes('test('));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("FixtureGenerator: SENSITIVE_KEY_PATTERNS covers common keys", () => {
  const keys = ["apiKey", "API_KEY", "token", "secret", "password", "auth", "credential", "private"];
  for (const key of keys) {
    const matched = SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
    assert.ok(matched, `Pattern should match key: ${key}`);
  }
});

test("FixtureGenerator: SENSITIVE_VALUE_PATTERNS covers common formats", () => {
  // API key format
  assert.ok(SENSITIVE_VALUE_PATTERNS[0].test("sk-abcdefghijklmnopqrstuvwxyz123456"));

  // JWT format
  assert.ok(SENSITIVE_VALUE_PATTERNS[5].test(
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummySig"
  ));

  // Long numeric ID
  assert.ok(SENSITIVE_VALUE_PATTERNS[6].test("1234567890123456"));
});
