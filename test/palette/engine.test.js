"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Writable } = require("node:stream");

const { CommandPalette, ANSI, THEME } = require("../../src/palette/engine");

// Helper: create a capture stream for output
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
  // Provide columns/rows/isTTY for rendering
  stream.columns = 80;
  stream.rows = 24;
  stream.isTTY = true;
  return stream;
}

// Helper: create a minimal readable stream for input (not a real TTY)
function createInput() {
  const { Readable } = require("node:stream");
  const input = new Readable({ read() {} });
  input.isTTY = false; // Ensure programmatic control
  return input;
}

// Sample items for testing
function createSampleItems() {
  return [
    { id: "cmd-help", name: "/help", category: "Commands", description: "Show available commands", shortcut: null, keywords: ["help"], action: () => "executed:help" },
    { id: "cmd-exit", name: "/exit", category: "Commands", description: "Exit the session", shortcut: null, keywords: ["quit"], action: () => "executed:exit" },
    { id: "cmd-clear", name: "/clear", category: "Commands", description: "Clear conversation", shortcut: null, keywords: ["c"], action: () => "executed:clear" },
    { id: "tool-read", name: "file.read", category: "Tools", description: "Read files", shortcut: "Ctrl+R", keywords: ["read"], action: () => "executed:file.read" },
    { id: "qa-new", name: "New Session", category: "Quick Actions", description: "Start new session", shortcut: "Ctrl+N", keywords: ["new"], action: () => "executed:new" },
  ];
}

// ── CommandPalette constructor ─────────────────────────────────────

test("CommandPalette: constructor with default options", () => {
  const palette = new CommandPalette();
  assert.ok(palette instanceof CommandPalette);
  assert.equal(palette.isOpen(), false);
  assert.equal(palette.getItems().length, 0);
});

test("CommandPalette: constructor with custom options", () => {
  const palette = new CommandPalette({
    placeholder: "Search...",
    title: "My Palette",
    maxVisible: 5,
  });
  assert.ok(palette instanceof CommandPalette);
});

test("CommandPalette: registerProvider adds provider", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });
  // getItems() calls _refreshItems which collects from all providers
  palette._refreshItems();
  assert.equal(palette.getItems().length, 5);
});

test("CommandPalette: registerProvider throws for invalid provider", () => {
  const palette = new CommandPalette();
  assert.throws(() => palette.registerProvider(null), /Provider must implement/);
  assert.throws(() => palette.registerProvider({ name: "no-getItems" }), /Provider must implement/);
  assert.throws(() => palette.registerProvider({ getItems: () => [] }), /Provider must have a name/);
});

test("CommandPalette: registerProvider returns this for chaining", () => {
  const palette = new CommandPalette();
  const result = palette.registerProvider({
    name: "A",
    getItems: () => [],
  });
  assert.strictEqual(result, palette);
});

// ── CommandPalette.search ─────────────────────────────────────────

test("search: returns ranked results for a query", () => {
  const stream = captureStream();
  const palette = new CommandPalette({ output: stream });
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });

  const results = palette.search("help");
  assert.ok(results.length >= 1, "should find help command");
  const topItem = results[0].item;
  assert.equal(topItem.id, "cmd-help");
});

test("search: returns all items for empty query", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });

  const results = palette.search("");
  assert.equal(results.length, 5);
});

test("search: returns empty for non-matching query", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });

  const results = palette.search("zzzxyz123");
  assert.equal(results.length, 0);
});

// ── CommandPalette.select ─────────────────────────────────────────

test("select: executes command action", () => {
  const palette = new CommandPalette();
  const result = palette.select({
    id: "test",
    name: "Test",
    action: () => "hello",
  });
  assert.equal(result, "hello");
});

test("select: returns null for invalid command", () => {
  const palette = new CommandPalette();
  assert.equal(palette.select(null), null);
  assert.equal(palette.select({}), null);
  assert.equal(palette.select({ id: "x", action: "not-a-function" }), null);
});

test("select: returns null when action throws", () => {
  const palette = new CommandPalette();
  const result = palette.select({
    id: "err",
    name: "Error Command",
    action: () => { throw new Error("fail"); },
  });
  assert.equal(result, null);
});

// ── CommandPalette.getItems / getResults ──────────────────────────

test("getItems: returns copy of items array", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });

  const items = palette.getItems();
  assert.equal(items.length, 5);
});

test("getResults: returns empty before search", () => {
  const palette = new CommandPalette();
  assert.deepEqual(palette.getResults(), []);
});

test("getResults: returns search results after search", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Test",
    getItems: () => createSampleItems(),
  });
  palette.search("file");
  const results = palette.getResults();
  assert.ok(results.length >= 1);
});

// ── CommandPalette.isOpen ─────────────────────────────────────────

test("isOpen: returns false by default", () => {
  const palette = new CommandPalette();
  assert.equal(palette.isOpen(), false);
});

// ── Deduplication ─────────────────────────────────────────────────

test("deduplicates items by id across providers", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Provider A",
    getItems: () => [
      { id: "dup", name: "Duplicate", category: "A", description: "", shortcut: null, keywords: [], action: () => {} },
    ],
  });
  palette.registerProvider({
    name: "Provider B",
    getItems: () => [
      { id: "dup", name: "Duplicate", category: "B", description: "", shortcut: null, keywords: [], action: () => {} },
    ],
  });

  palette._refreshItems();
  assert.equal(palette.getItems().length, 1, "duplicate IDs should be removed");
});

// ── Provider error handling ───────────────────────────────────────

test("provider throwing error does not crash refresh", () => {
  const palette = new CommandPalette();
  palette.registerProvider({
    name: "Bad Provider",
    getItems: () => { throw new Error("provider error"); },
  });
  palette.registerProvider({
    name: "Good Provider",
    getItems: () => createSampleItems(),
  });

  // Should not throw
  palette._refreshItems();
  assert.equal(palette.getItems().length, 5, "should have items from the good provider");
});
