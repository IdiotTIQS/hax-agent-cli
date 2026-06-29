import test from "node:test";
import assert from "node:assert/strict";
import { getPricing, getCost } from "../src/pricing.js";

// === FREE_PATTERNS: local/free models resolve to zero cost ===

test("ollama models are free", () => {
  assert.deepEqual(getPricing("ollama/llama3"), { input: 0, output: 0 });
});

test("vllm models are free", () => {
  assert.deepEqual(getPricing("vllm-server-model"), { input: 0, output: 0 });
});

test("local models are free", () => {
  assert.deepEqual(getPricing("my-local-model"), { input: 0, output: 0 });
});

// === FALLBACKS: regex tuple matching (the [RegExp, string] path) ===

test("'claude haiku' fuzzy name resolves to Haiku pricing", () => {
  const p = getPricing("claude-3-haiku-foo");
  assert.equal(p.input, 1.0);
  assert.equal(p.output, 5.0);
});

test("'claude sonnet' fuzzy name resolves to Sonnet pricing", () => {
  const p = getPricing("anthropic/claude-sonnet-latest");
  assert.equal(p.input, 3.0);
  assert.equal(p.output, 15.0);
});

test("gpt-4o fuzzy name resolves via fallback", () => {
  const p = getPricing("openai/gpt-4o-2024-08-06");
  assert.ok(p, "gpt-4o variant should match a fallback");
  assert.ok(typeof p.input === "number");
});

// === No match → null ===

test("completely unknown model returns null", () => {
  assert.equal(getPricing("nonexistent-vendor-model-9000"), null);
});

// === getCost integrates pricing lookup ===

test("getCost returns 0 for free model regardless of tokens", () => {
  assert.equal(getCost("ollama/llama3", 5_000_000, 5_000_000), 0);
});

test("getCost returns 0 for unmatched model", () => {
  assert.equal(getCost("nonexistent-vendor-model-9000", 1_000_000, 1_000_000), 0);
});

test("getCost includes cache pricing when provided", () => {
  // Opus 4.7: in $5, out $25, cacheWrite $6.25, cacheRead $0.5 per 1M
  const cost = getCost("claude-opus-4-7", 0, 0, 1_000_000, 1_000_000);
  assert.equal(cost, 6.25 + 0.5);
});
