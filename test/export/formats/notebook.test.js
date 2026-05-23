/**
 * Tests for notebook export formats (Jupyter, Observable, Markdown cells).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  exportAsJupyterNotebook,
  exportAsObservableNotebook,
  exportAsMarkdownCells,
  buildJupyterCell,
  buildObservableCell,
  detectLanguage,
} = require("../../../src/export/formats/notebook");

// ── helpers ──────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  const entries = overrides.entries || [];
  const metadata = overrides.metadata || {};
  return {
    id: overrides.id || "nb-session-1",
    updatedAt: overrides.updatedAt || "2025-06-01T12:00:00.000Z",
    entries: () => entries,
    metadata: () => metadata,
  };
}

// ── buildJupyterCell ─────────────────────────────────────────────────────

test("buildJupyterCell: creates a markdown cell with correct structure", () => {
  const cell = buildJupyterCell("markdown", "# Hello\n", null, "cell-1");

  assert.equal(cell.cell_type, "markdown");
  assert.equal(cell.id, "cell-1");
  assert.deepEqual(cell.source, ["# Hello\n"]);
  assert.deepEqual(cell.metadata, {});
  assert.equal(cell.outputs, undefined, "markdown cells should not have outputs");
});

test("buildJupyterCell: creates a code cell with outputs", () => {
  const outputs = [
    {
      output_type: "execute_result",
      data: { "text/plain": ["hello world\n"] },
      metadata: {},
      execution_count: 1,
    },
  ];

  const cell = buildJupyterCell("code", 'print("hello world")\n', outputs, "cell-2");

  assert.equal(cell.cell_type, "code");
  assert.equal(cell.id, "cell-2");
  assert.equal(cell.outputs, outputs);
  assert.equal(cell.execution_count, null);
  assert.deepEqual(cell.source, ['print("hello world")\n']);
});

// ── exportAsJupyterNotebook ──────────────────────────────────────────────

test("exportAsJupyterNotebook: produces valid ipynb structure", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Write a hello world script", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsJupyterNotebook(session, { title: "Test Notebook" });

  assert.equal(nb.nbformat, 4);
  assert.equal(nb.nbformat_minor, 5);
  assert.ok(Array.isArray(nb.cells));
  assert.ok(nb.cells.length > 0);
  assert.ok(nb.metadata.kernelspec, "should have kernelspec");
  assert.ok(nb.metadata.language_info, "should have language_info");
  assert.ok(nb.metadata.haxagent, "should have haxagent metadata");
});

test("exportAsJupyterNotebook: first cell is a title markdown cell", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "hello", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsJupyterNotebook(session, { title: "My Session" });

  const firstCell = nb.cells[0];
  assert.equal(firstCell.cell_type, "markdown");
  assert.ok(firstCell.source[0].includes("My Session"), "first cell should be the title");
});

test("exportAsJupyterNotebook: user messages become markdown cells", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "How do I do X?", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsJupyterNotebook(session);

  // Find the user content cell (second cell, after title)
  const userCell = nb.cells.find(
    (c) => c.cell_type === "markdown" && c.source.some((s) => s.includes("How do I do X?"))
  );
  assert.ok(userCell, "should have a markdown cell with user content");
});

test("exportAsJupyterNotebook: assistant messages become markdown cells", () => {
  const session = makeSession({
    entries: [
      { role: "assistant", content: "Here is the answer.", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsJupyterNotebook(session);

  const assistantCell = nb.cells.find(
    (c) => c.cell_type === "markdown" && c.source.some((s) => s.includes("Here is the answer."))
  );
  assert.ok(assistantCell, "should have a markdown cell with assistant content");
});

test("exportAsJupyterNotebook: tool entries become code cells with outputs", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "execute_command",
        data: "hello world",
        timestamp: "2025-06-01T12:00:00Z",
      },
    ],
  });

  const nb = exportAsJupyterNotebook(session);

  const toolCell = nb.cells.find((c) => c.cell_type === "code");
  assert.ok(toolCell, "should have a code cell for tool entry");
  assert.ok(toolCell.outputs.length > 0, "should have outputs");
  assert.ok(
    toolCell.outputs[0].data["text/plain"].some((s) => s.includes("hello world")),
    "output text should contain tool data"
  );
});

test("exportAsJupyterNotebook: error tool entries have error output type", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "failing_tool",
        data: "something went wrong",
        isError: true,
        timestamp: "2025-06-01T12:00:00Z",
      },
    ],
  });

  const nb = exportAsJupyterNotebook(session);

  const toolCell = nb.cells.find((c) => c.cell_type === "code");
  assert.ok(toolCell, "should have a code cell");
  assert.equal(toolCell.outputs[0].output_type, "error", "should be error output type");
});

test("exportAsJupyterNotebook: includes session metadata in haxagent field", () => {
  const session = makeSession({
    id: "session-abc",
    entries: [{ role: "user", content: "x", timestamp: "2025-06-01T12:00:00Z" }],
    metadata: { projectName: "TestProject" },
  });

  const nb = exportAsJupyterNotebook(session);

  assert.equal(nb.metadata.haxagent.session_id, "session-abc");
  assert.equal(nb.metadata.haxagent.message_count, 1);
  assert.ok(nb.metadata.haxagent.exported_at, "should have exported_at timestamp");
});

test("exportAsJupyterNotebook: handles empty sessions gracefully", () => {
  const session = makeSession({ entries: [] });
  const nb = exportAsJupyterNotebook(session);

  assert.ok(Array.isArray(nb.cells));
  assert.equal(nb.cells.length, 1, "should only have the title cell");
});

// ── exportAsObservableNotebook ───────────────────────────────────────────

test("exportAsObservableNotebook: produces valid Observable structure", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Hello Observable", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsObservableNotebook(session, { title: "Obs Test" });

  assert.equal(nb.version, 1);
  assert.equal(nb.title, "Obs Test");
  assert.ok(Array.isArray(nb.nodes));
  assert.ok(nb.nodes.length > 0);
  // Should have imports cell
  const importsCell = nb.nodes.find((n) => n.type === "js" && n.name === "imports");
  assert.ok(importsCell, "should have imports cell");
});

test("exportAsObservableNotebook: renders user message as markdown cell", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Question?", timestamp: "2025-06-01T12:00:00Z" },
    ],
  });

  const nb = exportAsObservableNotebook(session);

  const userCell = nb.nodes.find(
    (n) => n.type === "md" && n.value.includes("Question?")
  );
  assert.ok(userCell, "should have a markdown node with question");
});

test("exportAsObservableNotebook: renders tool entries as JS cells", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "read_file",
        data: '{"content": "hello"}',
        timestamp: "2025-06-01T12:00:00Z",
      },
    ],
  });

  const nb = exportAsObservableNotebook(session);

  const toolCell = nb.nodes.find(
    (n) => n.type === "js" && n.value && n.value.includes("read_file")
  );
  assert.ok(toolCell, "should have a JS cell for tool entry");
});

// ── exportAsMarkdownCells ────────────────────────────────────────────────

test("exportAsMarkdownCells: produces valid markdown with headings", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "First question", timestamp: "2025-06-01T12:00:00Z" },
      { role: "assistant", content: "First answer", timestamp: "2025-06-01T12:01:00Z" },
    ],
  });

  const md = exportAsMarkdownCells(session, { title: "MD Test" });

  assert.ok(md.startsWith("# MD Test"), "should start with title heading");
  assert.ok(md.includes("## You"), "should have user heading");
  assert.ok(md.includes("First question"), "should include user content");
  assert.ok(md.includes("## Assistant"), "should have assistant heading");
  assert.ok(md.includes("First answer"), "should include assistant content");
});

test("exportAsMarkdownCells: includes metadata table when enabled", () => {
  const session = makeSession({
    id: "md-session-1",
    entries: [{ role: "user", content: "Hello", timestamp: "2025-06-01T12:00:00Z" }],
    metadata: { projectName: "MyProject" },
  });

  const md = exportAsMarkdownCells(session, { includeMetadata: true });

  assert.ok(md.includes("| Session ID |"), "should include session ID row");
  assert.ok(md.includes("md-session-1"), "should include session ID value");
  assert.ok(md.includes("MyProject"), "should include project name");
});

test("exportAsMarkdownCells: omits metadata table when disabled", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Hello", timestamp: "2025-06-01T12:00:00Z" }],
  });

  const md = exportAsMarkdownCells(session, { includeMetadata: false });

  assert.ok(!md.includes("| Session ID |"), "should not include metadata table");
});

test("exportAsMarkdownCells: formats tool entries with code blocks", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "grep",
        data: "result line 1\nresult line 2",
        timestamp: "2025-06-01T12:00:00Z",
      },
    ],
  });

  const md = exportAsMarkdownCells(session);

  assert.ok(md.includes("## Tool:"), "should have tool heading");
  assert.ok(md.includes("grep"), "should include tool name");
  assert.ok(md.includes("**Result:**"), "should have result heading");
  assert.ok(md.includes("result line 1"), "should include tool output");
});

test("exportAsMarkdownCells: marks error entries", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "bad_command",
        data: "error message",
        isError: true,
        timestamp: "2025-06-01T12:00:00Z",
      },
    ],
  });

  const md = exportAsMarkdownCells(session);

  assert.ok(md.includes("**Error**"), "should indicate error");
});

// ── detectLanguage ───────────────────────────────────────────────────────

test("detectLanguage: detects JSON", () => {
  assert.equal(detectLanguage('{"key": "value"}'), "json");
  assert.equal(detectLanguage('[1, 2, 3]'), "json");
});

test("detectLanguage: detects JavaScript", () => {
  assert.equal(detectLanguage("const x = 1;"), "javascript");
  assert.equal(detectLanguage("import fs from 'fs'"), "javascript");
  assert.equal(detectLanguage("function test() {}"), "javascript");
});

test("detectLanguage: detects Python", () => {
  assert.equal(detectLanguage("def hello():"), "python");
  assert.equal(detectLanguage("import os"), "python");
});

test("detectLanguage: detects shell", () => {
  assert.equal(detectLanguage("echo hello"), "shell");
  assert.equal(detectLanguage("git status"), "shell");
  assert.equal(detectLanguage("npm install"), "shell");
});

test("detectLanguage: detects SQL", () => {
  assert.equal(detectLanguage("SELECT * FROM users"), "sql");
});

test("detectLanguage: defaults to plaintext", () => {
  assert.equal(detectLanguage("hello world"), "plaintext");
  assert.equal(detectLanguage(""), "plaintext");
});
