import test from "node:test";
import assert from "node:assert/strict";
import { Session, AgentEngine } from "../src/engine/agent.js";

// 内联 mock provider: 发出一次 tool_use 后结束
function makeStubProvider() {
  return {
    name: "anthropic",
    model: "claude-sonnet-4-6",
    async *stream(req) {
      yield { type: "tool_uses", toolUses: [{ id: "tu_abc", name: "file.read", input: { path: "/a" } }], text: "", usage: null };
    },
  };
}

function makeStubRegistry() {
  return {
    toApiSchema: () => [{ name: "file.read", description: "", input_schema: { type: "object" } }],
    get: () => ({ isReadOnly: () => true }),
    execute: async () => ({ ok: true, data: { content: "file content" } }),
  };
}

test("tool_result 携带 tool_use_id 来自 provider 的 tool_uses.id", async () => {
  const session = new Session({
    provider: makeStubProvider(),
    toolRegistry: makeStubRegistry(),
  });
  const engine = new AgentEngine({ session, maxToolTurns: 1 });

  for await (const _ of engine.sendMessage("read /a")) { /* drain */ }

  const last = session.messages.find(m =>
    m.role === "user" && Array.isArray(m.content) &&
    m.content.some(c => c.type === "tool_result")
  );
  assert.ok(last, "应存在 tool_result 消息");
  const tr = last.content.find(c => c.type === "tool_result");
  assert.equal(tr.tool_use_id, "tu_abc", "tool_use_id 应等于 provider 返回的 id");
});