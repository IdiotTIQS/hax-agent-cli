import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicProvider } from "../src/api/provider.js";

// Regression: Anthropic tool names must match ^[a-zA-Z0-9_-]{1,64}$ — dotted
// names like "file.write" / "shell.run" must be sanitized to "file_write" /
// "shell_run" before being sent, or the model never sees the real tools and
// invents names like "bash" or omits required params.

test("Anthropic _buildRequestBody sanitizes dotted tool names", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-x" });
  const body = p._buildRequestBody({
    model: "claude-x",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { name: "file.write", description: "write", input_schema: { type: "object", required: ["path", "content"], properties: {} } },
      { name: "shell.run", description: "run", input_schema: { type: "object", properties: {} } },
      { name: "web.search", description: "search", input_schema: { type: "object", properties: {} } },
    ],
  });
  const tools = body["tools"] as Array<{ name: string; input_schema: unknown }>;
  assert.equal(tools.length, 3);
  assert.equal(tools[0].name, "file_write");
  assert.equal(tools[1].name, "shell_run");
  assert.equal(tools[2].name, "web_search");
  // input_schema preserved (with required fields, so the model sends path/content)
  assert.deepEqual((tools[0].input_schema as { required: string[] }).required, ["path", "content"]);
  // valid Anthropic tool-name pattern (no dots)
  for (const t of tools) assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
});

test("Anthropic builds a reverse name map for tool_use round-trip", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  p._buildRequestBody({
    messages: [],
    tools: [{ name: "file.write", description: "", input_schema: {} }],
  });
  assert.equal(p._toolNameMap?.["file_write"], "file.write");
});

test("Anthropic _toMessages sanitizes recorded tool_use names", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const msgs = p._toMessages([
    { role: "assistant", content: "", tool_uses: [{ id: "t1", name: "file.write", input: { path: "a.ts" } }] },
  ]);
  const blocks = (msgs[0].content as Array<{ type: string; name?: string }>);
  const toolUse = blocks.find((b) => b.type === "tool_use");
  assert.equal(toolUse?.name, "file_write");
});
