/**
 * Tests for CommandBuilder: intent-to-action conversion.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CommandBuilder,
  buildCommand,
  INTENT_COMMAND_MAP,
  INTENT_AGENT_MAP,
  INTENT_TOOL_MAP,
  EXPLANATIONS,
} = require("../../src/nlp/command-builder");

// ── build: full action plan ────────────────────────────────────────

test("build: returns complete action plan for CODE_REVIEW", () => {
  const builder = new CommandBuilder();

  const detection = {
    intent: "CODE_REVIEW",
    confidence: 0.85,
    entities: { files: ["auth.js"], technologies: ["node"] },
    subIntent: "security",
  };
  const extracted = {
    filePaths: ["src/auth.js"],
    functionNames: ["loginUser"],
    lineNumbers: [10, 42],
    technologies: ["node", "express"],
  };

  const plan = builder.build(detection, extracted);

  assert.equal(plan.intent, "CODE_REVIEW");
  assert.equal(plan.confidence, 0.85);
  assert.ok(typeof plan.command === "string", "Should have a command string");
  assert.ok(typeof plan.toolCall === "object", "Should have a toolCall");
  assert.ok(typeof plan.toolCall.tool === "string", "toolCall should have tool");
  assert.ok(typeof plan.agentTask === "object", "Should have an agentTask");
  assert.ok(typeof plan.agentTask.agentType === "string", "agentTask should have agentType");
  assert.ok(typeof plan.agentTask.task === "string", "agentTask should have task");
  assert.ok(typeof plan.explanation === "string", "Should have an explanation");
  assert.ok(Array.isArray(plan.suggestedCommands), "Should have suggestedCommands");
});

test("build: command includes file if present in entities", () => {
  const builder = new CommandBuilder();

  const detection = {
    intent: "DEBUG",
    confidence: 0.9,
    entities: { files: ["auth.js"] },
    subIntent: null,
  };

  const plan = builder.build(detection, {});

  assert.ok(plan.command.includes("auth.js"), "Command should reference the file");
  assert.ok(plan.command.startsWith("/debug"), "Command should start with slash command");
});

test("build: handles intent with no matching command map", () => {
  const builder = new CommandBuilder();

  // Unknown intent falls back gracefully
  const detection = {
    intent: "UNKNOWN_INTENT",
    confidence: 0.1,
    entities: {},
    subIntent: null,
  };

  const plan = builder.build(detection, {});
  assert.ok(typeof plan === "object", "Should return an object");
  assert.ok(typeof plan.command === "string", "Should have a command");
});

// ── suggestCommands ────────────────────────────────────────────────

test("suggestCommands: returns primary and aliases for known intents", () => {
  const builder = new CommandBuilder();

  const commands = builder.suggestCommands("CODE_REVIEW", {});

  assert.ok(commands.length >= 2, "Should have at least primary + aliases");
  assert.ok(commands.includes("/review"), "Should include /review");
  assert.ok(commands.some((c) => c.startsWith("/")), "Commands should start with /");
});

test("suggestCommands: appends file paths when present", () => {
  const builder = new CommandBuilder();

  const commands = builder.suggestCommands("EXPLAIN_CODE", {
    files: ["src/utils.ts"],
    lineNumbers: [42],
  });

  assert.ok(commands.some((c) => c.includes("src/utils.ts")),
    "Should include file path in at least one suggestion");
});

test("suggestCommands: returns empty for unknown intent", () => {
  const builder = new CommandBuilder();

  const commands = builder.suggestCommands("NONEXISTENT", {});
  assert.deepEqual(commands, []);
});

// ── buildToolCall ──────────────────────────────────────────────────

test("buildToolCall: uses file.read for CODE_REVIEW with file path", () => {
  const builder = new CommandBuilder();

  const tc = builder.buildToolCall("CODE_REVIEW", {
    filePaths: ["src/auth.js"],
    lineNumbers: [10, 45],
  });

  assert.equal(tc.tool, "file.read");
  assert.equal(tc.args.file_path, "src/auth.js");
  assert.equal(tc.args.offset, 9); // line 10 → offset 9
  assert.equal(tc.args.limit, 36); // lines 10-45 = 36 lines
});

test("buildToolCall: uses grep for SEARCH_CODEBASE with pattern", () => {
  const builder = new CommandBuilder();

  const tc = builder.buildToolCall("SEARCH_CODEBASE", {
    functionNames: ["handleLogin"],
    filePaths: ["src/"],
  });

  assert.equal(tc.tool, "grep");
  assert.equal(tc.args.pattern, "handleLogin");
  assert.equal(tc.args.path, "src/");
});

test("buildToolCall: uses bash for DEPLOY", () => {
  const builder = new CommandBuilder();

  const tc = builder.buildToolCall("DEPLOY", {});
  assert.equal(tc.tool, "bash");
  assert.ok(typeof tc.args.command === "string", "Should have a bash command");
});

test("buildToolCall: returns file.read as default tool for unknown intent", () => {
  const builder = new CommandBuilder();

  const tc = builder.buildToolCall("UNKNOWN", {});
  assert.equal(tc.tool, "file.read");
});

// ── buildAgentTask ─────────────────────────────────────────────────

test("buildAgentTask: uses appropriate agent type per intent", () => {
  const builder = new CommandBuilder();

  const reviewTask = builder.buildAgentTask("CODE_REVIEW", {});
  assert.equal(reviewTask.agentType, "security-reviewer");

  const testTask = builder.buildAgentTask("WRITE_TESTS", {});
  assert.equal(testTask.agentType, "test-runner");

  const searchTask = builder.buildAgentTask("SEARCH_CODEBASE", {});
  assert.equal(searchTask.agentType, "explore");

  const docTask = builder.buildAgentTask("DOCUMENT", {});
  assert.equal(docTask.agentType, "docs-writer");
});

test("buildAgentTask: includes file and tech context in task description", () => {
  const builder = new CommandBuilder();

  const task = builder.buildAgentTask("CODE_REVIEW", {
    filePaths: ["src/auth.js", "src/middleware.ts"],
    technologies: ["express", "jwt"],
  });

  assert.ok(task.task.includes("src/auth.js"), "Task should mention file path");
  assert.ok(task.task.includes("express"), "Task should mention technology");
  assert.ok(task.task.length > 50, "Task description should be substantial");
});

// ── explain ────────────────────────────────────────────────────────

test("explain: returns human-readable explanation with entity details", () => {
  const builder = new CommandBuilder();

  const explanation = builder.explain("CODE_REVIEW", {
    filePaths: ["src/auth.js"],
    technologies: ["node", "express"],
  });

  assert.ok(typeof explanation === "string", "Explanation should be a string");
  assert.ok(explanation.length > 20, "Explanation should be substantive");
  assert.ok(explanation.includes("src/auth.js"), "Should mention file");
  assert.ok(explanation.includes("node"), "Should mention tech");
});

test("explain: handles empty entities gracefully", () => {
  const builder = new CommandBuilder();

  const explanation = builder.explain("EXPLAIN_CODE", {});
  assert.ok(typeof explanation === "string", "Should return a string");
  assert.ok(explanation.length > 10, "Should have some content");
});

test("explain: includes commit hash info when present", () => {
  const builder = new CommandBuilder();

  const explanation = builder.explain("CODE_REVIEW", {
    commitHashes: ["abc1234f", "def5678a"],
  });

  assert.ok(explanation.includes("abc1234f"), "Should mention commit hash");
});

// ── Custom mappings ────────────────────────────────────────────────

test("constructor: supports custom command mappings", () => {
  const builder = new CommandBuilder({
    customMappings: {
      CODE_REVIEW: { primary: "/audit", aliases: ["/scan"] },
    },
  });

  const commands = builder.suggestCommands("CODE_REVIEW", {});
  assert.ok(commands.includes("/audit"), "Should use custom primary");
  assert.ok(commands.includes("/scan"), "Should use custom alias");
});

// ── Convenience export ─────────────────────────────────────────────

test("buildCommand: convenience function works", () => {
  const result = buildCommand(
    { intent: "REFACTOR", confidence: 0.8, entities: { files: ["utils.js"] }, subIntent: null },
    { filePaths: ["src/utils.js"] }
  );

  assert.equal(result.intent, "REFACTOR");
  assert.ok(typeof result.command === "string");
  assert.ok(typeof result.toolCall === "object");
  assert.ok(typeof result.agentTask === "object");
  assert.ok(typeof result.explanation === "string");
  assert.ok(Array.isArray(result.suggestedCommands));
});

// ── Constants are exported ─────────────────────────────────────────

test("INTENT_COMMAND_MAP: covers all 10 intents", () => {
  const intents = [
    "CODE_REVIEW", "EXPLAIN_CODE", "WRITE_TESTS", "REFACTOR",
    "DEBUG", "OPTIMIZE", "DOCUMENT", "DEPLOY", "ANALYZE", "SEARCH_CODEBASE",
  ];
  for (const intent of intents) {
    assert.ok(INTENT_COMMAND_MAP[intent], `${intent} should be in COMMAND_MAP`);
  }
});

test("INTENT_AGENT_MAP: covers all 10 intents", () => {
  const intents = [
    "CODE_REVIEW", "EXPLAIN_CODE", "WRITE_TESTS", "REFACTOR",
    "DEBUG", "OPTIMIZE", "DOCUMENT", "DEPLOY", "ANALYZE", "SEARCH_CODEBASE",
  ];
  for (const intent of intents) {
    assert.ok(INTENT_AGENT_MAP[intent], `${intent} should be in AGENT_MAP`);
  }
});

test("EXPLANATIONS: covers all 10 intents", () => {
  const intents = [
    "CODE_REVIEW", "EXPLAIN_CODE", "WRITE_TESTS", "REFACTOR",
    "DEBUG", "OPTIMIZE", "DOCUMENT", "DEPLOY", "ANALYZE", "SEARCH_CODEBASE",
  ];
  for (const intent of intents) {
    assert.ok(EXPLANATIONS[intent], `${intent} should be in EXPLANATIONS`);
  }
});
