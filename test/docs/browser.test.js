/**
 * Tests for DocBrowser, wordWrap, and clipText utilities.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Writable } = require("node:stream");

const { DocBrowser, SECTION, wordWrap, clipText } = require("../../src/docs/browser");

// Helper: create a writable stream that captures output
function captureStream() {
  let buffer = "";
  const stream = new Writable({
    write(chunk, encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });
  stream.buffer = () => buffer;
  stream.reset = () => { buffer = ""; };
  return stream;
}

test("SECTION has all six expected keys", () => {
  assert.ok(SECTION.COMMANDS, "should have COMMANDS section");
  assert.ok(SECTION.TOOLS, "should have TOOLS section");
  assert.ok(SECTION.PLUGINS, "should have PLUGINS section");
  assert.ok(SECTION.CONFIG, "should have CONFIG section");
  assert.ok(SECTION.API, "should have API section");
  assert.ok(SECTION.EXAMPLES, "should have EXAMPLES section");

  assert.equal(Object.keys(SECTION).length, 6);
});

test("SECTION entries have id, title, icon, docs", () => {
  for (const [, section] of Object.entries(SECTION)) {
    assert.equal(typeof section.id, "string", `${section.title}: missing id`);
    assert.equal(typeof section.title, "string", `${section.title}: missing title`);
    assert.equal(typeof section.icon, "string", `${section.title}: missing icon`);
    assert.ok(Array.isArray(section.docs), `${section.title}: docs is not an array`);
    assert.ok(section.docs.length > 0, `${section.title}: docs is empty`);
    // Validate each doc entry
    for (const doc of section.docs) {
      assert.equal(typeof doc.id, "string", `${section.title} doc: missing id string`);
      assert.equal(typeof doc.title, "string", `${section.title} doc: missing title string`);
    }
  }
});

test("DocBrowser: constructor accepts optional streams", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);
  assert.ok(browser instanceof DocBrowser);
});

test("DocBrowser: showTopic finds topic by id", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.showTopic("cmd-help");
  const output = stream.buffer();
  assert.ok(output.includes("help"), "output should contain 'help'");
  assert.ok(output.length > 0);
});

test("DocBrowser: showTopic for known tools", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.showTopic("tool-file-read");
  const output = stream.buffer();
  assert.ok(output.includes("file.read") || output.includes("File Read"), "should show tool info");
});

test("DocBrowser: showTopic for unknown id shows error", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.showTopic("nonexistent-topic-xyz");
  const output = stream.buffer();
  assert.ok(output.includes("Error") || output.includes("not found"), "should show error for unknown topic");
});

test("DocBrowser: searchTopics returns results", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.searchTopics("file");
  const output = stream.buffer();
  // Should contain search results with "file" mentions
  assert.ok(output.length > 0, "search output should not be empty");
});

test("DocBrowser: searchTopics with empty query does nothing", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.searchTopics("");
  const output = stream.buffer();
  assert.equal(output.length, 0, "empty query should produce no output");
});

test("DocBrowser: renderSection renders valid section", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.renderSection("commands");
  const output = stream.buffer();
  assert.ok(output.includes("Commands"), "should render Commands section");
  assert.ok(output.length > 0);
});

test("DocBrowser: renderSection for unknown key shows error", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.renderSection("nonexistent");
  const output = stream.buffer();
  assert.ok(output.includes("Error") || output.includes("Unknown"), "should show error for unknown section");
});

test("DocBrowser: showTopic shows examples when present", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  browser.showTopic("cmd-config");
  const output = stream.buffer();
  assert.ok(output.includes("/config") || output.includes("configuration"), "output should mention the command");
});

test("wordWrap: wraps text at max width", () => {
  const result = wordWrap("hello world this is a test", 10);
  assert.ok(Array.isArray(result), "should return array");
  // Each line should be <= maxWidth (accounting for ANSI stripped)
  for (const line of result) {
    // Strip ANSI for measurement
    const stripped = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    assert.ok(stripped.length <= 10, `line "${stripped}" exceeds width 10`);
  }
});

test("wordWrap: handles empty input", () => {
  const result = wordWrap("", 80);
  assert.deepEqual(result, [""]);
});

test("wordWrap: handles null/undefined", () => {
  const result = wordWrap(null, 80);
  assert.deepEqual(result, [""]);
});

test("wordWrap: preserves long words that exceed maxWidth", () => {
  const result = wordWrap("supercalifragilisticexpialidocious", 10);
  assert.ok(result.length > 0);
  // A single word that exceeds width gets its own line
  assert.equal(result[0], "supercalifragilisticexpialidocious");
});

test("clipText: clips text that exceeds maxWidth", () => {
  const result = clipText("this is a very long text that should be clipped", 15);
  assert.ok(result.endsWith("..."), "clipped text should end with '...'");
  // Visible characters (minus ANSI) should be around maxWidth
  const stripped = result.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  assert.ok(stripped.length <= 18, "visible length should be near maxWidth");
});

test("clipText: handles empty/null text", () => {
  assert.equal(clipText("", 10), "");
  assert.equal(clipText(null, 10), "");
});

test("clipText: returns short text unchanged", () => {
  const result = clipText("short", 20);
  assert.equal(result, "short");
  assert.ok(!result.includes("..."));
});

test("DocBrowser: _findDocById finds doc across all sections", () => {
  const stream = captureStream();
  const browser = new DocBrowser(stream);

  // Find in commands
  const cmdDoc = browser._findDocById("cmd-model");
  assert.ok(cmdDoc, "should find cmd-model");
  assert.equal(cmdDoc.title, "/model");

  // Find in tools
  const toolDoc = browser._findDocById("tool-shell");
  assert.ok(toolDoc, "should find tool-shell");
  assert.equal(toolDoc.title, "shell.run");

  // Find in plugins
  const pluginDoc = browser._findDocById("plugins-overview");
  assert.ok(pluginDoc, "should find plugins-overview");

  // Find in config
  const configDoc = browser._findDocById("config-agent");
  assert.ok(configDoc, "should find config-agent");

  // Find in examples
  const exampleDoc = browser._findDocById("example-quickstart");
  assert.ok(exampleDoc, "should find example-quickstart");

  // Non-existent
  const missingDoc = browser._findDocById("non-existent-id-xyz");
  assert.equal(missingDoc, null, "non-existent doc should return null");
});
