"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateFlowDiagram,
  generateArchitectureDiagram,
  generateHeatMap,
} = require("../../src/diagram/svg-gen");

// ── Helpers ─────────────────────────────────────────────────

function svgContains(svg, needle) {
  assert.ok(svg.includes(needle), `SVG should contain "${needle}"`);
}

function svgIsValid(svg, width, height) {
  svgContains(svg, '<?xml version="1.0" encoding="UTF-8"?>');
  svgContains(svg, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (width) svgContains(svg, `width="${width}"`);
  if (height) svgContains(svg, `height="${height}"`);
  assert.ok(svg.endsWith("</svg>"));
}

// ── generateBarChart ────────────────────────────────────────

test("generateBarChart: renders vertical bars by default", () => {
  const svg = generateBarChart([
    { label: "A", value: 10 },
    { label: "B", value: 20 },
  ], { width: 400, height: 300 });
  svgIsValid(svg, 400, 300);
  svgContains(svg, '<rect');
  svgContains(svg, "A");
  svgContains(svg, "B");
});

test("generateBarChart: supports horizontal orientation", () => {
  const svg = generateBarChart(
    [{ label: "Item 1", value: 50 }],
    { orientation: "horizontal", width: 500, height: 200 }
  );
  svgIsValid(svg, 500, 200);
  svgContains(svg, '<rect');
  svgContains(svg, "Item 1");
});

test("generateBarChart: includes title when provided", () => {
  const svg = generateBarChart(
    [{ label: "X", value: 5 }],
    { title: "Quarterly Sales", width: 400, height: 300 }
  );
  svgContains(svg, "Quarterly Sales");
  svgContains(svg, "font-weight=\"bold\"");
});

test("generateBarChart: handles empty data gracefully", () => {
  const svg = generateBarChart([], { width: 300, height: 200 });
  svgIsValid(svg, 300, 200);
  // Should still produce valid SVG — just no rect elements
});

// ── generateLineChart ───────────────────────────────────────

test("generateLineChart: renders line path with points", () => {
  const svg = generateLineChart([1, 5, 3, 8], { width: 500, height: 300 });
  svgIsValid(svg, 500, 300);
  svgContains(svg, '<path');
  svgContains(svg, 'stroke="#3B82F6"');
});

test("generateLineChart: shows data points when enabled", () => {
  const svg = generateLineChart([10, 20], { showPoints: true, width: 400, height: 250 });
  svgContains(svg, '<circle');
});

test("generateLineChart: hides data points when disabled", () => {
  const svg = generateLineChart([10, 20], { showPoints: false, width: 400, height: 250 });
  // No circle elements should be present
  assert.ok(!svg.includes('<circle'));
});

test("generateLineChart: shows area fill when enabled", () => {
  const svg = generateLineChart([3, 7, 5], { showArea: true, width: 400, height: 250 });
  svgContains(svg, 'fill-opacity="0.1"');
});

test("generateLineChart: includes title and labels", () => {
  const svg = generateLineChart(
    [5, 10, 15],
    { title: "Growth", labels: ["Jan", "Feb", "Mar"], width: 450, height: 300 }
  );
  svgContains(svg, "Growth");
  svgContains(svg, "Jan");
  svgContains(svg, "Mar");
});

test("generateLineChart: handles single data point", () => {
  const svg = generateLineChart([42], { width: 300, height: 200 });
  svgIsValid(svg, 300, 200);
  svgContains(svg, "42");
});

// ── generatePieChart ────────────────────────────────────────

test("generatePieChart: renders slices as arc paths", () => {
  const svg = generatePieChart([
    { label: "A", value: 60 },
    { label: "B", value: 40 },
  ], { width: 400, height: 400 });
  svgIsValid(svg, 400, 400);
  svgContains(svg, '<path');
  svgContains(svg, 'A '); // arc commands
  svgContains(svg, "60.0%");
  svgContains(svg, "40.0%");
});

test("generatePieChart: renders donut chart when enabled", () => {
  const svg = generatePieChart(
    [{ label: "X", value: 100 }],
    { donut: true, width: 400, height: 400 }
  );
  svgIsValid(svg, 400, 400);
  // Donut has two arc segments per slice (outer and inner)
  svgContains(svg, '<path');
});

test("generatePieChart: handles empty data", () => {
  const svg = generatePieChart([], { width: 300, height: 200 });
  svgIsValid(svg, 300, 200);
  svgContains(svg, "No data");
});

// ── generateFlowDiagram ─────────────────────────────────────

test("generateFlowDiagram: renders nodes and edges", () => {
  const nodes = [
    { id: "start", label: "Start", shape: "ellipse" },
    { id: "process", label: "Process", shape: "box" },
    { id: "end", label: "End", shape: "ellipse" },
  ];
  const edges = [
    { from: "start", to: "process" },
    { from: "process", to: "end" },
  ];
  const svg = generateFlowDiagram(nodes, edges, { width: 600, height: 400 });
  svgIsValid(svg, 600, 400);
  svgContains(svg, "Start");
  svgContains(svg, "Process");
  svgContains(svg, "End");
  svgContains(svg, '<line');
  svgContains(svg, 'marker-end');
});

test("generateFlowDiagram: handles node shapes", () => {
  const svg = generateFlowDiagram(
    [{ id: "d", label: "Decision?", shape: "diamond" }],
    [],
    { width: 400, height: 200 }
  );
  svgContains(svg, '<polygon'); // diamond is a polygon
});

test("generateFlowDiagram: handles empty nodes", () => {
  const svg = generateFlowDiagram([], [], { width: 300, height: 200 });
  svgContains(svg, "No nodes");
});

// ── generateArchitectureDiagram ─────────────────────────────

test("generateArchitectureDiagram: renders layered components", () => {
  const components = [
    { name: "Web App", type: "frontend", dependsOn: ["API"] },
    { name: "API", type: "service", dependsOn: ["DB"] },
    { name: "DB", type: "database" },
  ];
  const svg = generateArchitectureDiagram(components, { width: 700, height: 500, title: "System" });
  svgIsValid(svg, 700, 500);
  svgContains(svg, "System");
  svgContains(svg, "Web App");
  svgContains(svg, "API");
  svgContains(svg, "DB");
  svgContains(svg, '<line'); // dependency arrows
});

test("generateArchitectureDiagram: handles empty components", () => {
  const svg = generateArchitectureDiagram([], { width: 300, height: 200 });
  svgContains(svg, "No components");
});

// ── generateHeatMap ─────────────────────────────────────────

test("generateHeatMap: renders colored cell grid", () => {
  const matrix = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  const svg = generateHeatMap(matrix, { width: 500, height: 400, title: "Activity" });
  svgIsValid(svg, 500, 400);
  svgContains(svg, "Activity");
  svgContains(svg, '<rect');
  // Should have 9 rect cells
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.ok(rectCount >= 9, `Expected at least 9 rect elements, got ${rectCount}`);
});

test("generateHeatMap: renders row and column labels", () => {
  const matrix = [[1, 2], [3, 4]];
  const svg = generateHeatMap(matrix, {
    width: 400, height: 300,
    rowLabels: ["CPU", "Memory"],
    colLabels: ["Min", "Max"],
  });
  svgContains(svg, "CPU");
  svgContains(svg, "Memory");
  svgContains(svg, "Min");
  svgContains(svg, "Max");
});

test("generateHeatMap: respects custom color scale", () => {
  const matrix = [[0, 50, 100]];
  const svg = generateHeatMap(matrix, {
    width: 400, height: 200,
    colorScale: ["#00FF00", "#FFFF00", "#FF0000"],
  });
  // Should contain our custom colors
  svgContains(svg, "#00FF00");
  svgContains(svg, "#FF0000");
});

test("generateHeatMap: handles empty data", () => {
  const svg = generateHeatMap([], { width: 300, height: 200 });
  svgContains(svg, "No data");
});
