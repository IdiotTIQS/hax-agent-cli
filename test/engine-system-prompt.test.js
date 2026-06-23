"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentEngine, Session } = require("../src/engine/agent");
const { createMockProvider, createMockToolRegistry } = require("../test-helpers/mocks");

function makeEngine() {
  const session = new Session({
    provider: createMockProvider(),
    toolRegistry: createMockToolRegistry(),
  });
  return new AgentEngine({ session });
}

test("_buildStableSystemPrompt 不包含 Current Context 段", () => {
  const e = makeEngine();
  const stable = e._buildStableSystemPrompt();
  assert.ok(!stable.includes("Current Context:"),
    "稳定前缀不应包含每轮变化的上下文摘要");
});

test("_buildStableSystemPrompt 包含角色与工具说明", () => {
  const e = makeEngine();
  const stable = e._buildStableSystemPrompt();
  assert.ok(stable.includes("Hax Agent"));
  assert.ok(stable.includes("file.read"));
  assert.ok(stable.includes("shell.run"));
});

test("_buildDynamicContextReminder 在无上下文时返回 null", () => {
  const e = makeEngine();
  const reminder = e._buildDynamicContextReminder();
  assert.equal(reminder, null);
});

test("_buildSystemPrompt 在无上下文时等于稳定前缀", () => {
  const e = makeEngine();
  assert.equal(e._buildSystemPrompt(), e._buildStableSystemPrompt());
});
