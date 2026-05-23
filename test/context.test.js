/**
 * Tests for context module: loadPromptContext, buildPromptContext,
 * assembleSystemPrompt, buildMessages, formatSettings, formatMemories,
 * formatTranscript, limitItems, limitLast, truncate.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assembleSystemPrompt,
  buildMessages,
  buildPromptContext,
  formatMemories,
  formatSettings,
  formatTranscript,
  loadPromptContext,
} = require("../src/context");

// ── buildPromptContext ───────────────────────────────────

test("buildPromptContext: returns minimal structure with empty options", () => {
  const result = buildPromptContext();
  assert.ok(result.systemPrompt);
  assert.ok(result.systemPrompt.includes("Hax Agent CLI"));
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.memories, []);
  assert.deepEqual(result.transcript, []);
});

test("buildPromptContext: includes instructions in system prompt", () => {
  const result = buildPromptContext({ instructions: "Be concise." });
  assert.ok(result.systemPrompt.includes("Be concise"));
});

test("buildPromptContext: includes userPrompt as final message", () => {
  const result = buildPromptContext({ userPrompt: "Hello world" });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content, "Hello world");
});

test("buildPromptContext: limits memories by maxItems", () => {
  const memories = Array.from({ length: 50 }, (_, i) => ({
    name: `mem-${i}`,
    content: `content-${i}`,
  }));
  const result = buildPromptContext({
    memories,
    settings: { memory: { maxItems: 5 } },
  });
  assert.equal(result.memories.length, 5);
});

test("buildPromptContext: respects prompts.includeSettings false", () => {
  const result = buildPromptContext({
    settings: { prompts: { includeSettings: false } },
  });
  assert.ok(!result.systemPrompt.includes("## Settings"));
});

test("buildPromptContext: respects prompts.includeMemory false", () => {
  const result = buildPromptContext({
    settings: { prompts: { includeMemory: false } },
  });
  assert.ok(!result.systemPrompt.includes("## Memory"));
});

test("buildPromptContext: respects prompts.includeTranscript false", () => {
  const result = buildPromptContext({
    settings: { prompts: { includeTranscript: false } },
  });
  assert.ok(!result.systemPrompt.includes("## Recent transcript"));
});

// ── assembleSystemPrompt ─────────────────────────────────

test("assembleSystemPrompt: includes Identity section always", () => {
  const prompt = assembleSystemPrompt();
  assert.ok(prompt.includes("## Identity"));
  assert.ok(prompt.includes("Hax Agent CLI"));
  assert.ok(prompt.includes("AI coding assistant"));
});

test("assembleSystemPrompt: includes runtime section when provided", () => {
  const prompt = assembleSystemPrompt({
    runtime: { skills: ["test-skill"], env: { NODE_ENV: "test" } },
  });
  assert.ok(prompt.includes("## Runtime"));
  assert.ok(prompt.includes("test-skill"));
});

test("assembleSystemPrompt: skips runtime section when empty object", () => {
  const prompt = assembleSystemPrompt({ runtime: {} });
  assert.ok(!prompt.includes("## Runtime"));
});

// ── buildMessages ────────────────────────────────────────

test("buildMessages: returns only user prompt when no transcript", () => {
  const messages = buildMessages([], "hello");
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { role: "user", content: "hello" });
});

test("buildMessages: returns empty when no transcript and no prompt", () => {
  const messages = buildMessages([], null);
  assert.deepEqual(messages, []);
});

test("buildMessages: filters non-user/assistant roles", () => {
  const transcript = [
    { role: "user", content: "hello" },
    { role: "tool", content: "result" },
    { role: "assistant", content: "hi" },
    { role: "system", content: "prompt" },
  ];
  const messages = buildMessages(transcript, null);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
});

test("buildMessages: filters entries with no content", () => {
  const transcript = [
    { role: "user", content: "" },
    { role: "user", content: null },
    { role: "assistant", content: "has content" },
  ];
  const messages = buildMessages(transcript, null);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
});

test("buildMessages: filters null/undefined entries in transcript", () => {
  const transcript = [
    null,
    { role: "user", content: "hello" },
    undefined,
  ];
  const messages = buildMessages(transcript, null);
  assert.equal(messages.length, 1);
});

// ── formatMemories ───────────────────────────────────────

test("formatMemories: returns 'No stored memories' when empty", () => {
  assert.equal(formatMemories([]), "No stored memories.");
});

test("formatMemories: formats memory list", () => {
  const memories = [
    { name: "style", content: "Use tabs" },
    { name: "prefs", content: "ESM modules" },
  ];
  const result = formatMemories(memories);
  assert.ok(result.includes("- style: Use tabs"));
  assert.ok(result.includes("- prefs: ESM modules"));
});

test("formatMemories: truncates long content", () => {
  const memories = [{ name: "test", content: "a".repeat(1000) }];
  const result = formatMemories(memories);
  assert.ok(result.length < 850); // name + truncation overhead
});

// ── formatTranscript ─────────────────────────────────────

test("formatTranscript: returns 'No recent transcript' when empty", () => {
  assert.equal(formatTranscript([]), "No recent transcript.");
});

test("formatTranscript: formats transcript entries", () => {
  const transcript = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "world" },
  ];
  const result = formatTranscript(transcript);
  assert.ok(result.includes("- user: hello"));
  assert.ok(result.includes("- assistant: world"));
});

test("formatTranscript: uses type field when role missing", () => {
  const transcript = [{ type: "event", content: "something happened" }];
  const result = formatTranscript(transcript);
  assert.ok(result.includes("- event: something happened"));
});

test("formatTranscript: falls back to 'event' when no role or type", () => {
  const transcript = [{ content: "plain" }];
  const result = formatTranscript(transcript);
  assert.ok(result.includes("- event: plain"));
});

test("formatTranscript: truncates long content", () => {
  const transcript = [{ role: "user", content: "a".repeat(1200) }];
  const result = formatTranscript(transcript);
  assert.ok(result.length < 850);
});

// ── formatSettings ───────────────────────────────────────

test("formatSettings: formats agent settings", () => {
  const settings = {
    agent: { name: "test-agent", model: "claude-sonnet-4", maxTurns: 50, temperature: 0.7 },
    projectRoot: "/test/project",
    memory: { directory: "/test/mem" },
    sessions: { directory: "/test/sess" },
  };
  const result = formatSettings(settings);
  assert.ok(result.includes("- agent: test-agent"));
  assert.ok(result.includes("- model: claude-sonnet-4"));
  assert.ok(result.includes("- maxTurns: 50"));
  assert.ok(result.includes("- temperature: 0.7"));
  assert.ok(result.includes("- projectRoot: /test/project"));
});

test("formatSettings: filters undefined/empty values", () => {
  const settings = {
    agent: { name: "agent", model: undefined, maxTurns: "", temperature: 0 },
    projectRoot: undefined,
  };
  const result = formatSettings(settings);
  // Should only have name and temperature (0 is a valid value) lines
  assert.ok(result.includes("- agent: agent"));
  assert.ok(!result.includes("model"));
  assert.ok(!result.includes("maxTurns"));
  assert.ok(result.includes("0")); // 0 passes the filter
  assert.ok(!result.includes("projectRoot"));
});

// ── loadPromptContext ────────────────────────────────────

test("loadPromptContext: skips memories when disabled", () => {
  const result = loadPromptContext({
    settings: { memory: { enabled: false } },
  });
  assert.deepEqual(result.memories, []);
});

test("loadPromptContext: uses provided memories over listing", () => {
  const providedMemories = [{ name: "test", content: "custom" }];
  const result = loadPromptContext({
    settings: {},
    memories: providedMemories,
  });
  assert.deepEqual(result.memories, [providedMemories[0]]);
});

test("loadPromptContext: uses provided transcript over session read", () => {
  const transcript = [
    { role: "user", content: "hello" },
  ];
  const result = loadPromptContext({
    settings: {},
    transcript,
  });
  assert.equal(result.transcript.length, 1);
  assert.deepEqual(result.messages[0], { role: "user", content: "hello" });
});

test("loadPromptContext: handles empty options", () => {
  const result = loadPromptContext();
  assert.ok(result.systemPrompt);
  assert.ok(result.systemPrompt.includes("Hax Agent CLI"));
  assert.deepEqual(result.messages, []);
});
