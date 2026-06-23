"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AnthropicProvider } = require("../src/api/provider");

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