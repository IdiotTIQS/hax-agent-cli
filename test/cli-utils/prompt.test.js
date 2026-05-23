/**
 * Tests for cli-utils/prompt: confirm, select, input, multiSelect.
 * Tests prompt formatting (the visual output), not user interaction.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  confirm,
  select,
  input,
  multiSelect,
} = require("../../src/cli-utils/prompt");

// ── confirm ───────────────────────────────────────────────

test("confirm: renders yes/no options with default YES", () => {
  const result = confirm("Proceed?");
  assert.ok(result.includes("Proceed?"));
  // Default true => Y/n
  assert.ok(result.includes("Y"));
  assert.ok(result.includes("n"));
  assert.ok(result.includes("\x1B")); // ANSI codes present
});

test("confirm: renders with uppercase N when default is NO", () => {
  const result = confirm("Continue?", false);
  assert.ok(result.includes("Continue?"));
  // Default false => y/N
  assert.ok(result.includes("y"));
  assert.ok(result.includes("N"));
});

// ── select ────────────────────────────────────────────────

test("select: renders numbered list with label", () => {
  const options = ["Option A", "Option B", "Option C"];
  const result = select("Choose one:", options);

  assert.ok(result.includes("Choose one:"));
  assert.ok(result.includes("1"));
  assert.ok(result.includes("Option A"));
  assert.ok(result.includes("2"));
  assert.ok(result.includes("Option B"));
  assert.ok(result.includes("3"));
  assert.ok(result.includes("Option C"));
  assert.ok(result.includes("1-3"));
  assert.ok(result.includes("\x1B"));
});

test("select: renders object options with value/label", () => {
  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ];
  const result = select("Pick:", options);
  assert.ok(result.includes("Option A"));
  assert.ok(result.includes("Option B"));
});

test("select: empty options returns empty string", () => {
  assert.equal(select("Label", []), "");
});

// ── input ─────────────────────────────────────────────────

test("input: renders prompt with default shown", () => {
  const result = input("Enter name:", { default: "Alice" });
  assert.ok(result.includes("Enter name:"));
  assert.ok(result.includes("Alice"));
  assert.ok(result.includes("\x1B"));
});

test("input: renders prompt without default when not provided", () => {
  const result = input("Enter name:");
  assert.ok(result.includes("Enter name:"));
  assert.ok(!result.includes("("));
});

test("input: hides empty default", () => {
  const result = input("Name:", { default: "" });
  assert.ok(result.includes("Name:"));
  assert.ok(!result.includes("("));
});

// ── multiSelect ───────────────────────────────────────────

test("multiSelect: renders with checkbox indicators", () => {
  const options = ["Feature 1", "Feature 2", "Feature 3"];
  const result = multiSelect("Features:", options);

  assert.ok(result.includes("Features:"));
  // Unchecked circles
  assert.ok(result.includes("○"));
  assert.ok(!result.includes("◉"));
  assert.ok(result.includes("Feature 1"));
  assert.ok(result.includes("Feature 2"));
  assert.ok(result.includes("Feature 3"));
  assert.ok(result.includes("space to toggle"));
  assert.ok(result.includes("enter to confirm"));
  assert.ok(result.includes("\x1B"));
});

test("multiSelect: shows checked items", () => {
  const options = ["Alpha", "Beta", "Gamma"];
  const result = multiSelect("Select:", options, { checked: ["Alpha", "Gamma"] });

  // Should have two filled circles
  const filledCount = (result.match(/◉/g) || []).length;
  assert.equal(filledCount, 2);
  // Should have one empty circle
  const emptyCount = (result.match(/○/g) || []).length;
  assert.equal(emptyCount, 1);
});

test("multiSelect: respects checked property on object options", () => {
  const options = [
    { value: "a", label: "A", checked: true },
    { value: "b", label: "B" },
    { value: "c", label: "C", checked: true },
  ];
  const result = multiSelect("Pick:", options);
  const filledCount = (result.match(/◉/g) || []).length;
  assert.equal(filledCount, 2);
});

test("multiSelect: empty options returns empty string", () => {
  assert.equal(multiSelect("Label", []), "");
});
