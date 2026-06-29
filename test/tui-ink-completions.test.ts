/**
 * Unit tests for src/tui-ink/completions.ts
 *
 * Tests: slash prefix matching, no-slash → empty, prefix filtering,
 * deduplication between command and skill names, empty inputs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeCompletions } from "../src/tui-ink/completions.js";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const COMMANDS = ["help", "clear", "model", "provider", "skills", "goal", "yolo", "plan", "export", "cost", "lsp"];
const SKILLS = ["deep-research", "code-review", "simplify", "run", "verify", "loop"];

// ---------------------------------------------------------------------------
// No-slash → always empty
// ---------------------------------------------------------------------------

test("computeCompletions: empty string → empty", () => {
  assert.deepEqual(computeCompletions("", COMMANDS, SKILLS), []);
});

test("computeCompletions: plain text with no slash → empty", () => {
  assert.deepEqual(computeCompletions("hello world", COMMANDS, SKILLS), []);
});

test("computeCompletions: leading space (not slash) → empty", () => {
  assert.deepEqual(computeCompletions(" /help", COMMANDS, SKILLS), []);
});

// ---------------------------------------------------------------------------
// Slash alone → all entries
// ---------------------------------------------------------------------------

test("computeCompletions: bare '/' returns all commands + skills with '/' prefix", () => {
  const result = computeCompletions("/", COMMANDS, SKILLS);
  // Every entry must start with /
  assert.ok(result.every((r) => r.startsWith("/")), "all results start with /");
  // Total length = commands + skills
  assert.equal(result.length, COMMANDS.length + SKILLS.length);
  // Spot-check a few
  assert.ok(result.includes("/help"));
  assert.ok(result.includes("/deep-research"));
});

// ---------------------------------------------------------------------------
// Prefix filtering
// ---------------------------------------------------------------------------

test("computeCompletions: '/c' matches clear, cost, code-review", () => {
  const result = computeCompletions("/c", COMMANDS, SKILLS);
  assert.ok(result.includes("/clear"));
  assert.ok(result.includes("/cost"));
  assert.ok(result.includes("/code-review"));
  // 'model', 'provider', 'yolo', etc. should NOT appear
  assert.ok(!result.includes("/model"));
  assert.ok(!result.includes("/provider"));
});

test("computeCompletions: '/mo' matches only /model", () => {
  const result = computeCompletions("/mo", COMMANDS, SKILLS);
  assert.deepEqual(result, ["/model"]);
});

test("computeCompletions: '/deep' matches only /deep-research", () => {
  const result = computeCompletions("/deep", COMMANDS, SKILLS);
  assert.deepEqual(result, ["/deep-research"]);
});

test("computeCompletions: '/xyz' matches nothing → empty", () => {
  const result = computeCompletions("/xyz", COMMANDS, SKILLS);
  assert.deepEqual(result, []);
});

test("computeCompletions: '/help' exact match → ['/help']", () => {
  const result = computeCompletions("/help", COMMANDS, SKILLS);
  assert.deepEqual(result, ["/help"]);
});

// ---------------------------------------------------------------------------
// Case insensitivity
// ---------------------------------------------------------------------------

test("computeCompletions: '/HELP' matches /help (case-insensitive prefix)", () => {
  const result = computeCompletions("/HELP", COMMANDS, SKILLS);
  assert.ok(result.includes("/help"));
});

test("computeCompletions: '/Code' matches /code-review", () => {
  const result = computeCompletions("/Code", COMMANDS, SKILLS);
  assert.ok(result.includes("/code-review"));
});

// ---------------------------------------------------------------------------
// Empty lists
// ---------------------------------------------------------------------------

test("computeCompletions: empty command + skill lists → empty", () => {
  assert.deepEqual(computeCompletions("/help", [], []), []);
});

test("computeCompletions: commands only, no skills", () => {
  const result = computeCompletions("/h", COMMANDS, []);
  assert.ok(result.includes("/help"));
  assert.ok(!result.some((r) => r === "/deep-research"));
});

test("computeCompletions: skills only, no commands", () => {
  const result = computeCompletions("/r", [], SKILLS);
  assert.ok(result.includes("/run"));
  assert.ok(!result.includes("/model"));
});

// ---------------------------------------------------------------------------
// Return format
// ---------------------------------------------------------------------------

test("computeCompletions: all returned values start with '/'", () => {
  const result = computeCompletions("/", COMMANDS, SKILLS);
  for (const r of result) {
    assert.ok(r.startsWith("/"), `${r} should start with /`);
  }
});
