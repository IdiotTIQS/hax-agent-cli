import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/api/provider.js";

test("无 thinking 时请求体不含 thinking/output_config", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(body.thinking, undefined);
  assert.equal(body.output_config, undefined);
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.stream, true);
});

test("thinking=true 时设置 adaptive thinking + default high effort", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-opus-4-7" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "solve" }],
    thinking: true,
  });
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "high" });
});

test("thinkIntensity 'low' 映射到 effort=low", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "low",
  });
  assert.equal(body.output_config.effort, "low");
});

test("thinkIntensity 'x-high' 映射到 effort=xhigh(Opus 4.7 专属)", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "x-high",
  });
  assert.equal(body.output_config.effort, "xhigh");
});

test("thinkIntensity 'max' 映射到 effort=max", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "max",
  });
  assert.equal(body.output_config.effort, "max");
});

test("请求体绝不包含 budget_tokens、temperature、top_p、top_k", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "max",
  });
  assert.equal(body.budget_tokens, undefined, "Opus 4.7 移除了 budget_tokens");
  assert.equal(body.temperature, undefined, "Opus 4.7 移除了采样参数");
  assert.equal(body.top_p, undefined);
  assert.equal(body.top_k, undefined);
});

// -- added by fix
test("thinkIntensity 'medium' 映射到 effort=medium", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "medium",
  });
  assert.equal(body.output_config.effort, "medium");
});

test("thinkIntensity 'high' 显式映射到 effort=high", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "high",
  });
  assert.equal(body.output_config.effort, "high");
});

test("thinkIntensity 'xhigh'(无连字符) 映射到 effort=xhigh", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "x" }],
    thinking: true,
    thinkIntensity: "xhigh",
  });
  assert.equal(body.output_config.effort, "xhigh");
});

// -- added for Task 3: Prompt Caching --

test("enableCache=true 时 system 被转为带 cache_control 的内容块", () => {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-6" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
    enableCache: true,
  });
  assert.ok(Array.isArray(body.system), "system 应为内容块数组");
  assert.equal(body.system.length, 1);
  assert.equal(body.system[0].type, "text");
  assert.equal(body.system[0].text, "You are helpful.");
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
});

test("enableCache=false 时 system 保持字符串", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
    enableCache: false,
  });
  assert.equal(typeof body.system, "string");
  assert.equal(body.system, "You are helpful.");
});

test("enableCache 缺省时 system 保持字符串(向后兼容)", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const body = p._buildRequestBody({
    messages: [{ role: "user", content: "hi" }],
    system: "You are helpful.",
  });
  assert.equal(typeof body.system, "string");
});

// -- added for Task 4: Native Tool Use --

test("_toMessages 将 tool_result 转换为 Anthropic 块格式", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const result = p._toMessages([
    { role: "user", content: "list files" },
    { role: "assistant", content: "ok", tool_uses: [{ id: "tu_1", name: "file.glob", input: { pattern: "*.js" } }] },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }
    ]},
  ]);

  assert.equal(result.length, 3);
  // assistant 应转换为 [text, tool_use]
  assert.ok(Array.isArray(result[1].content));
  assert.equal(result[1].content[0].type, "text");
  assert.equal(result[1].content[1].type, "tool_use");
  assert.equal(result[1].content[1].id, "tu_1");
  // user tool_result 应保留 tool_use_id
  assert.equal(result[2].content[0].tool_use_id, "tu_1");
});

test("_parseDsml 为每个 invoke 生成唯一 id", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const FW = "｜";
  const text = `${FW}${FW}DSML${FW}${FW}invoke name="x">${FW}${FW}DSML${FW}${FW}parameter name="a">1</${FW}${FW}DSML${FW}${FW}parameter></${FW}${FW}DSML${FW}${FW}invoke>` +
               `${FW}${FW}DSML${FW}${FW}invoke name="y">${FW}${FW}DSML${FW}${FW}parameter name="b">2</${FW}${FW}DSML${FW}${FW}parameter></${FW}${FW}DSML${FW}${FW}invoke>`;
  const uses = p._parseDsml(text);
  assert.equal(uses.length, 2);
  assert.ok(uses[0].id.startsWith("dsml_"));
  assert.ok(uses[1].id.startsWith("dsml_"));
  assert.notEqual(uses[0].id, uses[1].id, "两次 invoke 应有不同 id");
});

test("_toMessages 处理无 tool_uses 的 assistant 消息(向后兼容)", () => {
  const p = new AnthropicProvider({ apiKey: "test" });
  const result = p._toMessages([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  assert.equal(result[1].content, "hello", "无 tool_uses 时保持原始字符串内容");
});