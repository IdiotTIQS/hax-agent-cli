/**
 * Tests for DecisionTreeRenderer: tree, timeline, graph, and stats visualization.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DecisionTreeRenderer } = require("../../src/visualize/decision-tree");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a realistic set of decision objects matching the DecisionTracer shape.
 */
function makeDecisions() {
  return [
    {
      id: "dec_001",
      timestamp: "2025-01-15T10:00:00.000Z",
      type: "tool_selection",
      agentId: "agent-1",
      context: { task: "fix auth bug", availableToolCount: 4 },
      alternatives: [
        { index: 0, id: "read", description: "Read file", score: 0.8, pros: ["Safe"], cons: ["Slow"] },
        { index: 1, id: "edit", description: "Edit file", score: 0.9, pros: ["Direct"], cons: ["Risky"] },
        { index: 2, id: "grep", description: "Search code", score: 0.7, pros: ["Fast"], cons: ["Limited"] },
        { index: 3, id: "bash", description: "Run command", score: 0.5, pros: ["Flexible"], cons: ["Dangerous"] },
      ],
      rationale: 'Selected "edit" as the best tool for fixing the auth bug directly.',
      confidence: 0.85,
      confidenceLabel: "very_high",
      outcome: { chosen: "edit", success: true, result: "Bug fixed", followUpActions: [], notes: null },
      metadata: {},
    },
    {
      id: "dec_002",
      timestamp: "2025-01-15T10:01:00.000Z",
      type: "response_path",
      agentId: "agent-1",
      context: { prompt: "How should I fix this?", pathCount: 3 },
      alternatives: [
        { index: 0, id: "refactor", description: "Refactor module", score: 0.7, pros: ["Clean"], cons: ["Time-consuming"] },
        { index: 1, id: "patch", description: "Apply patch", score: 0.9, pros: ["Fast", "Safe"], cons: ["Temporary"] },
        { index: 2, id: "rewrite", description: "Rewrite from scratch", score: 0.4, pros: ["Fresh start"], cons: ["Very risky"] },
      ],
      rationale: 'Chose "patch" approach as it is fast, safe, and sufficient for the current issue.',
      confidence: 0.72,
      confidenceLabel: "high",
      outcome: { chosen: "patch", success: true, result: "Patch applied", followUpActions: ["test"], notes: null },
      metadata: {},
    },
    {
      id: "dec_003",
      timestamp: "2025-01-15T10:02:00.000Z",
      type: "error_recovery",
      agentId: "agent-2",
      context: { error: "ENOENT: no such file", strategyCount: 3 },
      alternatives: [
        { index: 0, id: "retry", description: "Retry operation", score: 0.5, pros: ["Simple"], cons: ["May fail again"] },
        { index: 1, id: "skip", description: "Skip and continue", score: 0.3, pros: ["Fast"], cons: ["Incomplete"] },
        { index: 2, id: "ask", description: "Ask user for help", score: 0.6, pros: ["User-aware"], cons: ["Blocking"] },
      ],
      rationale: 'Attempting retry first before escalating to user.',
      confidence: 0.35,
      confidenceLabel: "low",
      outcome: { chosen: "retry", success: false, result: "Still failed", followUpActions: ["ask"], notes: "Escalating" },
      metadata: {},
    },
    {
      id: "dec_004",
      timestamp: "2025-01-15T10:03:00.000Z",
      type: "strategy",
      agentId: "agent-1",
      context: { task: "Plan deployment", strategyCount: 2 },
      alternatives: [
        { index: 0, id: "blue_green", description: "Blue-green deployment", score: 0.85, pros: ["Zero downtime"], cons: ["Double resources"] },
        { index: 1, id: "rolling", description: "Rolling update", score: 0.65, pros: ["Simple"], cons: ["Brief downtime"] },
      ],
      rationale: 'Blue-green deployment chosen for zero-downtime requirement.',
      confidence: 0.91,
      confidenceLabel: "very_high",
      outcome: { chosen: "blue_green", success: true, result: "Deployed", followUpActions: [], notes: null },
      metadata: {},
    },
    {
      id: "dec_005",
      timestamp: "2025-01-15T10:04:00.000Z",
      type: "general",
      agentId: "agent-2",
      context: { task: "Summarize findings" },
      alternatives: [],
      rationale: 'No alternatives needed for summary generation.',
      confidence: 0.95,
      confidenceLabel: "very_high",
      outcome: { chosen: "summary_report", success: true, result: "Report generated", followUpActions: [], notes: null },
      metadata: {},
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("DecisionTreeRenderer: constructor defaults", () => {
  const renderer = new DecisionTreeRenderer();
  assert.equal(renderer._useAnsi, true);
  assert.equal(renderer._maxWidth, 100);
  assert.equal(renderer._maxDepth, 10);
  assert.equal(renderer._collapseByDefault, false);
  assert.equal(renderer._collapseAfter, 8);
});

test("DecisionTreeRenderer: constructor with options", () => {
  const renderer = new DecisionTreeRenderer({
    useAnsi: false,
    maxWidth: 60,
    collapseByDefault: true,
    collapseAfter: 4,
  });
  assert.equal(renderer._useAnsi, false);
  assert.equal(renderer._maxWidth, 60);
  assert.equal(renderer._collapseByDefault, true);
  assert.equal(renderer._collapseAfter, 4);
});

test("renderTree: returns tree text for a list of decisions", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderTree(decisions);

  assert.ok(typeof output === "string");
  assert.ok(output.length > 0);

  // Should contain type names
  assert.ok(output.includes("Tool Selection"), "should mention Tool Selection");
  assert.ok(output.includes("Response Path"), "should mention Response Path");
  assert.ok(output.includes("Error Recovery"), "should mention Error Recovery");

  // Should contain chosen alternatives
  assert.ok(output.includes("edit"), "should include chosen tool 'edit'");
  assert.ok(output.includes("patch"), "should include chosen path 'patch'");

  // Should have tree-drawing characters
  assert.ok(output.includes("─") || output.includes("├") || output.includes("└"), "should use box-drawing chars");
});

test("renderTree: handles empty decisions", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const output = renderer.renderTree([], { title: "Empty Tree" });
  assert.ok(output.includes("Empty Tree"));
  assert.ok(output.includes("no decisions"));
});

test("renderTree: collapsed mode hides extra nodes", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false, collapseAfter: 2 });
  // Create many decisions of the same type
  const manyDecisions = Array.from({ length: 10 }, (_, i) => ({
    id: `dec_${i}`,
    timestamp: new Date(2025, 0, 15, 10, i).toISOString(),
    type: "tool_selection",
    agentId: "agent-1",
    context: {},
    alternatives: [],
    rationale: `Decision ${i}`,
    confidence: 0.5,
    confidenceLabel: "moderate",
    outcome: { chosen: `tool_${i}`, success: null, result: null, followUpActions: [], notes: null },
    metadata: {},
  }));

  const output = renderer.renderTree(manyDecisions, { collapsed: true });
  assert.ok(output.includes("more decisions collapsed"), "should indicate collapsed nodes");
});

test("renderTimeline: renders chronological timeline", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderTimeline(decisions, { title: "Decision Timeline" });

  assert.ok(typeof output === "string");
  assert.ok(output.length > 0);
  assert.ok(output.includes("Decision Timeline"), "should include title");
  assert.ok(output.includes("edit"), "should include first decision");
  assert.ok(output.includes("patch"), "should include second decision");
  assert.ok(output.includes("5 decisions"), "should show count");
});

test("renderTimeline: compact mode renders single-line entries", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderTimeline(decisions, { compact: true });

  assert.ok(typeof output === "string");
  // Should use tree connectors
  assert.ok(output.includes("├") || output.includes("└"), "should use tree connectors");
  // Each decision should have confidence indicator
  assert.ok(output.includes("tool_selection"), "should reference type");
});

test("renderTimeline: handles empty input", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const output = renderer.renderTimeline([], { title: "No Data" });
  assert.ok(output.includes("No Data"));
  assert.ok(output.includes("no decisions"));
});

test("renderGraph: renders type-grouped graph", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderGraph(decisions, { title: "Decision Graph", groupBy: "type" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("Decision Graph"), "should include title");
  assert.ok(output.includes("tool_selection"), "should group by type");
  assert.ok(output.includes("response_path"), "should include response_path group");
});

test("renderGraph: groupBy agent renders agent clusters", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderGraph(decisions, { groupBy: "agent" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("agent-1"), "should include agent-1 group");
  assert.ok(output.includes("agent-2"), "should include agent-2 group");
});

test("renderGraph: handles empty decisions", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const output = renderer.renderGraph([], { title: "Graph" });
  assert.ok(output.includes("Graph"));
  assert.ok(output.includes("no decisions"));
});

test("renderStats: renders comprehensive statistics", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderStats(decisions, { title: "Decision Stats" });

  assert.ok(typeof output === "string");
  assert.ok(output.length > 0);
  assert.ok(output.includes("Decision Stats"), "should include title");

  // Overview
  assert.ok(output.includes("Total decisions"), "should show total");
  assert.ok(output.includes("5"), "should show count of 5 decisions");
  assert.ok(output.includes("Unique agents"), "should show agent count");
  assert.ok(output.includes("Time span"), "should show time span");

  // Type distribution
  assert.ok(output.includes("Decision Type Distribution"), "should have type distribution section");
  assert.ok(output.includes("Tool Selection"), "should mention Tool Selection");

  // Confidence distribution
  assert.ok(output.includes("Confidence Distribution"), "should have confidence section");

  // Agent activity
  assert.ok(output.includes("Agent Activity"), "should have agent section");
  assert.ok(output.includes("agent-1"), "should list agent-1");
});

test("renderStats: showDetails includes per-decision rows", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderStats(decisions, { showDetails: true });

  assert.ok(output.includes("Per-Decision Detail"), "should have detail section");
  assert.ok(output.includes("edit"), "should list edit decision");
});

test("renderStats: handles empty input", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const output = renderer.renderStats([], { title: "Stats" });
  assert.ok(output.includes("Stats"));
  assert.ok(output.includes("no decisions"));
});

test("DecisionTreeRenderer: ANSI mode includes escape sequences", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: true });
  const decisions = makeDecisions();
  const output = renderer.renderTree(decisions);

  assert.ok(output.includes("\x1b["), "should contain ANSI escape sequences");
});

test("DecisionTreeRenderer: no-ANSI mode has no escape sequences", () => {
  const renderer = new DecisionTreeRenderer({ useAnsi: false });
  const decisions = makeDecisions();
  const output = renderer.renderTree(decisions);

  assert.ok(!output.includes("\x1b["), "should NOT contain ANSI escape sequences");
});
