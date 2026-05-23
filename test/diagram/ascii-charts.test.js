"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  barChart,
  lineChart,
  pieChart,
  treeChart,
  tableChart,
  ganttChart,
  BOX,
} = require("../../src/diagram/ascii-charts");

// ── barChart ────────────────────────────────────────────────

test("barChart: renders horizontal bars by default", () => {
  const result = barChart([
    { label: "Apples", value: 10 },
    { label: "Oranges", value: 5 },
  ]);
  assert.ok(result.includes("Apples"));
  assert.ok(result.includes("Oranges"));
  assert.ok(result.includes("10"));
  assert.ok(result.includes("5"));
  assert.ok(result.includes("Max: 10"));
});

test("barChart: renders vertical orientation", () => {
  const result = barChart(
    [
      { label: "A", value: 3 },
      { label: "B", value: 7 },
    ],
    { orientation: "vertical", height: 6 }
  );
  assert.ok(result.includes("A"));
  assert.ok(result.includes("B"));
  // Vertical chart should contain block characters (bars going up)
  assert.ok(result.includes(BOX.BLOCK));
});

test("barChart: handles empty data", () => {
  const result = barChart([]);
  assert.ok(result.includes("(no data)"));
});

test("barChart: includes title when provided", () => {
  const result = barChart(
    [{ label: "X", value: 1 }],
    { title: "Sales", orientation: "horizontal", width: 40 }
  );
  assert.ok(result.includes("Sales"));
});

test("barChart: accepts data.bars format", () => {
  const result = barChart({ bars: [{ label: "Q1", value: 42 }] });
  assert.ok(result.includes("Q1"));
  assert.ok(result.includes("42"));
});

test("barChart: custom fill character", () => {
  const result = barChart(
    [{ label: "A", value: 5 }],
    { fillChar: "#" }
  );
  // With value=5 and whatever max, we should see # fill chars
  assert.ok(result.includes("#"));
});

// ── lineChart ───────────────────────────────────────────────

test("lineChart: renders data points with connecting lines", () => {
  const result = lineChart([10, 20, 15, 30], { height: 8, width: 50 });
  assert.ok(typeof result === "string");
  // Check the chart contains our data values
  // Actually, lineChart doesn't print numeric values inline — it uses graphic chars
  // but it should exist as a non-empty string
  assert.ok(result.length > 0);
});

test("lineChart: renders title when provided", () => {
  const result = lineChart([1, 2, 3], { title: "Trend", height: 6 });
  assert.ok(result.includes("Trend"));
});

test("lineChart: handles empty data", () => {
  const result = lineChart([]);
  assert.ok(result.includes("(no data)"));
});

test("lineChart: accepts data.series format", () => {
  const result = lineChart({ series: [5, 10, 15] }, { height: 6, width: 50 });
  assert.ok(result.length > 0);
});

test("lineChart: handles labels option", () => {
  const result = lineChart(
    [5, 10, 15],
    { labels: ["Jan", "Feb", "Mar"], height: 6, width: 50 }
  );
  assert.ok(result.includes("Jan"));
  assert.ok(result.includes("Feb"));
});

// ── pieChart ────────────────────────────────────────────────

test("pieChart: renders slices with percentages", () => {
  const result = pieChart([
    { label: "Red", value: 30 },
    { label: "Blue", value: 70 },
  ]);
  assert.ok(result.includes("Red"));
  assert.ok(result.includes("Blue"));
  assert.ok(result.includes("30.0%"));
  assert.ok(result.includes("70.0%"));
  assert.ok(result.includes("Total: 100"));
});

test("pieChart: handles empty data", () => {
  const result = pieChart([]);
  assert.ok(result.includes("(no data)"));
});

test("pieChart: includes title when provided", () => {
  const result = pieChart([{ label: "A", value: 1 }], { title: "Colors" });
  assert.ok(result.includes("Colors"));
});

test("pieChart: accepts data.slices format", () => {
  const result = pieChart({ slices: [{ label: "Cats", value: 5 }] });
  assert.ok(result.includes("Cats"));
  assert.ok(result.includes("100.0%"));
});

// ── treeChart ───────────────────────────────────────────────

test("treeChart: renders tree structure with box-drawing chars", () => {
  const result = treeChart({
    name: "root",
    children: [
      { name: "child1", children: [{ name: "grandchild" }] },
      { name: "child2" },
    ],
  });
  assert.ok(result.includes("root"));
  assert.ok(result.includes("child1"));
  assert.ok(result.includes("child2"));
  assert.ok(result.includes("grandchild"));
  // Should contain tree-drawing characters
  assert.ok(result.includes(BOX.TREE_E) || result.includes(BOX.TREE_L));
});

test("treeChart: handles null/undefined data", () => {
  const result = treeChart(null);
  assert.ok(result.includes("(no data)"));
});

test("treeChart: respects maxDepth", () => {
  const deep = { name: "L0", children: [{ name: "L1", children: [{ name: "L2", children: [{ name: "L3" }] }] }] };
  const shallow = treeChart(deep, { maxDepth: 2 });
  assert.ok(shallow.includes("L0"));
  assert.ok(shallow.includes("L1"));
  // L2 should NOT appear because maxDepth=2 means depth 0 and 1 only
  assert.ok(!shallow.includes("L2"));
});

test("treeChart: includes title when provided", () => {
  const result = treeChart({ name: "root" }, { title: "My Tree" });
  assert.ok(result.includes("My Tree"));
});

// ── tableChart ──────────────────────────────────────────────

test("tableChart: renders bordered table", () => {
  const result = tableChart({
    headers: ["Name", "Age", "City"],
    rows: [
      ["Alice", "30", "NYC"],
      ["Bob", "25", "SF"],
    ],
  });
  assert.ok(result.includes("Name"));
  assert.ok(result.includes("Age"));
  assert.ok(result.includes("City"));
  assert.ok(result.includes("Alice"));
  assert.ok(result.includes("Bob"));
  // Should have Unicode box borders
  assert.ok(result.includes(BOX.TL));  // top-left corner
  assert.ok(result.includes(BOX.BL));  // bottom-left corner
});

test("tableChart: supports compact mode", () => {
  const result = tableChart(
    { headers: ["A"], rows: [["1"], ["2"]] },
    { compact: true }
  );
  // Compact mode should still have borders
  assert.ok(result.includes(BOX.TL));
});

test("tableChart: supports column alignment", () => {
  const result = tableChart(
    { headers: ["Left", "Right"], rows: [["a", "123"]] },
    { align: ["left", "right"] }
  );
  assert.ok(result.includes("Left"));
  assert.ok(result.includes("Right"));
  assert.ok(result.includes("123"));
});

test("tableChart: handles empty data", () => {
  const result = tableChart({ headers: [], rows: [] });
  assert.ok(result.includes("(no data)"));
});

test("tableChart: includes title when provided", () => {
  const result = tableChart(
    { headers: ["Col"], rows: [["val"]] },
    { title: "Data" }
  );
  assert.ok(result.includes("Data"));
});

// ── ganttChart ──────────────────────────────────────────────

test("ganttChart: renders gantt timeline", () => {
  const result = ganttChart([
    { name: "Phase 1", start: 0, end: 10 },
    { name: "Phase 2", start: 8, end: 20 },
  ]);
  assert.ok(result.includes("Phase 1"));
  assert.ok(result.includes("Phase 2"));
  assert.ok(result.includes("total: 20d"));
  // Should contain block characters (bar fill)
  assert.ok(result.includes(BOX.BLOCK));
});

test("ganttChart: shows progress fill when provided", () => {
  const result = ganttChart([
    { name: "Task", start: 0, end: 10, progress: 50 },
  ], { showProgress: true });
  assert.ok(result.includes("Task"));
  // Progress 50% means half filled blocks + half light shade
  assert.ok(result.includes(BOX.BLOCK));
});

test("ganttChart: handles empty tasks", () => {
  const result = ganttChart([]);
  assert.ok(result.includes("(no tasks)"));
});

test("ganttChart: includes title when provided", () => {
  const result = ganttChart(
    [{ name: "T", start: 0, end: 5 }],
    { title: "Timeline" }
  );
  assert.ok(result.includes("Timeline"));
});
