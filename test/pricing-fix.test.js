import test from "node:test";
import assert from "node:assert/strict";
import { PRICING, getPricing } from "../src/pricing.js";

test("Opus 4.7 pricing matches official $5/$25 per 1M tokens", () => {
  const p = getPricing("claude-opus-4-7");
  assert.equal(p.input, 5.0, "Opus 4.7 input price should be $5/1M");
  assert.equal(p.output, 25.0, "Opus 4.7 output price should be $25/1M");
  assert.equal(p.cacheWrite, 6.25, "Cache write = 1.25x input");
  assert.equal(p.cacheRead, 0.5, "Cache read = 0.1x input");
});

test("phantom model claude-opus-4-8 is not in pricing table", () => {
  assert.equal(PRICING["claude-opus-4-8"], undefined, "claude-opus-4-8 is not a real model");
});

test("phantom model claude-sonnet-4-7-20250501 is not in pricing table", () => {
  assert.equal(PRICING["claude-sonnet-4-7-20250501"], undefined, "alias with date suffix is invalid");
});

test("Sonnet 4.6 pricing intact at $3/$15", () => {
  const p = getPricing("claude-sonnet-4-6");
  assert.equal(p.input, 3.0);
  assert.equal(p.output, 15.0);
});

test("Haiku 4.5 pricing matches $1/$5", () => {
  const p = getPricing("claude-haiku-4-5-20251001");
  assert.equal(p.input, 1.0, "Haiku 4.5 input should be $1/1M (was $0.8)");
  assert.equal(p.output, 5.0, "Haiku 4.5 output should be $5/1M (was $4)");
});

test("regex fallback for 'claude opus' resolves to claude-opus-4-7", () => {
  const p = getPricing("claude-opus-foo");
  assert.equal(p.input, 5.0);
  assert.equal(p.output, 25.0);
});
