/**
 * Tests for cli-utils/table: formatTable, formatKeyValue, formatTree.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatTable,
  formatKeyValue,
  formatTree,
} = require("../../src/cli-utils/table");

// ── formatTable ───────────────────────────────────────────

test("formatTable: simple 2-column table with header", () => {
  const rows = [
    ["Name", "Value"],
    ["foo", "1"],
    ["bar", "2"],
  ];
  const result = formatTable(rows);
  const lines = result.split("\n");
  assert.equal(lines.length, 4); // header + separator + 2 data rows

  // Header
  assert.ok(lines[0].includes("Name"));
  assert.ok(lines[0].includes("Value"));

  // Separator line
  assert.ok(lines[1].includes("─"));

  // Data rows
  assert.ok(lines[2].includes("foo"));
  assert.ok(lines[3].includes("bar"));
});

test("formatTable: multiple columns", () => {
  const rows = [
    ["ID", "Product", "Price"],
    ["1", "Widget", "$9.99"],
    ["2", "Gadget", "$14.50"],
  ];
  const result = formatTable(rows);
  const lines = result.split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[2].includes("Widget"));
  assert.ok(lines[3].includes("Gadget"));
});

test("formatTable: custom column widths", () => {
  const rows = [
    ["A", "B"],
    ["short", "ok"],
  ];
  const result = formatTable(rows, { widths: [20, 10] });
  const lines = result.split("\n");
  // "A" padded to 20 + padding + "B" padded to 10
  assert.equal(lines[0].length, 20 + 1 + 10);
  // check alignment — "short" padded to 20 columns
  assert.equal(lines[2].indexOf("ok"), 21);
});

test("formatTable: no header option", () => {
  const rows = [
    ["foo", "1"],
    ["bar", "2"],
  ];
  const result = formatTable(rows, { header: false });
  const lines = result.split("\n");
  assert.equal(lines.length, 2);
  // No separator line
  assert.ok(!lines[1].includes("─"));
});

test("formatTable: ansi mode dims separator", () => {
  const rows = [
    ["Name", "Value"],
    ["x", "1"],
  ];
  const result = formatTable(rows, { ansi: true });
  // When no color option is passed, only the separator gets dim ANSI codes
  assert.ok(result.includes("\x1B"));
  const lines = result.split("\n");
  // Separator line (index 1) should have ANSI dim
  assert.ok(lines[1].includes("\x1B"));
});

test("formatTable: empty rows returns empty string", () => {
  assert.equal(formatTable([]), "");
});

// ── formatKeyValue ────────────────────────────────────────

test("formatKeyValue: simple object", () => {
  const data = { name: "HaxAgent", version: "1.0.0" };
  const result = formatKeyValue(data);
  const lines = result.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("name"));
  assert.ok(lines[0].includes("HaxAgent"));
  assert.ok(lines[1].includes("version"));
  assert.ok(lines[1].includes("1.0.0"));
});

test("formatKeyValue: nested object values are JSON-stringified", () => {
  const data = { config: { debug: true } };
  const result = formatKeyValue(data);
  assert.ok(result.includes('{"debug":true}'));
});

test('formatKeyValue: null/undefined values display "null"', () => {
  const data = { a: null, b: undefined };
  const result = formatKeyValue(data);
  assert.ok(result.includes("null"));
});

test("formatKeyValue: respects minKeyWidth", () => {
  const data = { a: 1 };
  const result = formatKeyValue(data, { minKeyWidth: 20 });
  const line = result.split("\n")[0];
  // "a" should be padded to 20 chars
  const keyPart = line.substring(0, 22); // key + 2 spaces
  assert.equal(keyPart.trim(), "a");
});

test("formatKeyValue: empty object returns empty string", () => {
  assert.equal(formatKeyValue({}), "");
});

test("formatKeyValue: null input returns empty string", () => {
  assert.equal(formatKeyValue(null), "");
  assert.equal(formatKeyValue(undefined), "");
});

// ── formatTree ────────────────────────────────────────────

test("formatTree: single root node", () => {
  const tree = { label: "root" };
  const result = formatTree(tree);
  assert.ok(result.includes("root"));
  assert.ok(!result.includes("├─ "));
});

test("formatTree: single root with children", () => {
  const tree = {
    label: "root",
    children: [
      { label: "child1" },
      { label: "child2" },
    ],
  };
  const result = formatTree(tree);
  const lines = result.split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("└─ root"));
  assert.ok(lines[1].includes("child1"));
  assert.ok(lines[2].includes("child2"));
});

test("formatTree: multiple levels of nesting", () => {
  const tree = {
    label: "root",
    children: [
      {
        label: "a",
        children: [
          { label: "a1" },
          { label: "a2" },
        ],
      },
      { label: "b" },
    ],
  };
  const result = formatTree(tree);
  const lines = result.split("\n");

  // root
  assert.ok(lines[0].startsWith("└─ root"));
  // a (not last child) — two-space indent then branch
  assert.ok(lines[1].includes("├─ a"));
  // a1 (child of a, a1 is not last) — indent + pipe + branch
  assert.ok(lines[2].includes("├─ a1"));
  // a2 (last child of a)
  assert.ok(lines[3].includes("└─ a2"));
  // b (last child of root)
  assert.ok(lines[4].includes("└─ b"));
});

test("formatTree: leaf nodes with no children", () => {
  const tree = { label: "leaf" };
  const result = formatTree(tree);
  assert.equal(result, "└─ leaf");
});

test("formatTree: array input (multiple roots)", () => {
  const tree = [
    { label: "root1" },
    { label: "root2" },
  ];
  const result = formatTree(tree);
  const lines = result.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("├─ root1"));
  assert.ok(lines[1].startsWith("└─ root2"));
});

test("formatTree: custom branch characters", () => {
  const tree = {
    label: "r",
    children: [{ label: "c" }],
  };
  const result = formatTree(tree, {
    branch: "--> ",
    lastBranch: "--> ",
    indent: "    ",
    pipe: "|   ",
  });
  const lines = result.split("\n");
  assert.ok(lines[1].startsWith("    --> c"));
});
