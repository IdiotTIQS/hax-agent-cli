/**
 * Tests for UndoStack: push, undo, redo, canUndo/canRedo, list, clear, removeByPath.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { UndoStack } = require("../src/undo-stack");

test("UndoStack: constructor defaults maxEntries to 50", () => {
  const stack = new UndoStack();
  assert.equal(stack._maxEntries, 50);
  assert.deepEqual(stack._stack, []);
  assert.deepEqual(stack._redoStack, []);
});

test("UndoStack: constructor accepts custom maxEntries", () => {
  const stack = new UndoStack(10);
  assert.equal(stack._maxEntries, 10);
});

test("UndoStack: push ignores null/undefined action", () => {
  const stack = new UndoStack();
  stack.push(null);
  stack.push(undefined);
  assert.equal(stack._stack.length, 0);
});

test("UndoStack: push ignores action without filePath", () => {
  const stack = new UndoStack();
  stack.push({});
  stack.push({ toolName: "file.write" });
  assert.equal(stack._stack.length, 0);
});

test("UndoStack: push stores action with resolved filePath", () => {
  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath: "test.txt",
    originalContent: "old",
    newContent: "new",
    description: "update test",
  });
  assert.equal(stack._stack.length, 1);
  assert.equal(stack._stack[0].toolName, "file.write");
  assert.equal(stack._stack[0].filePath, path.resolve("test.txt"));
  assert.equal(stack._stack[0].originalContent, "old");
  assert.equal(stack._stack[0].newContent, "new");
  assert.ok(stack._stack[0].timestamp);
});

test("UndoStack: push defaults missing fields", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "/test.txt" });
  assert.equal(stack._stack[0].toolName, "unknown");
  assert.equal(stack._stack[0].originalContent, "");
  assert.equal(stack._stack[0].newContent, "");
  assert.equal(stack._stack[0].description, "");
});

test("UndoStack: push clears redo stack", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "a.txt", originalContent: "old", newContent: "new" });

  // Simulate redo entries
  stack._redoStack.push({ filePath: "a.txt", originalContent: "old", newContent: "new" });

  stack.push({ filePath: "b.txt" });
  assert.equal(stack._redoStack.length, 0);
});

test("UndoStack: push trims stack when exceeding maxEntries", () => {
  const stack = new UndoStack(3);
  for (let i = 0; i < 5; i++) {
    stack.push({ filePath: `file${i}.txt` });
  }
  assert.equal(stack._stack.length, 3);
  assert.equal(stack._stack[0].filePath, path.resolve("file2.txt"));
  assert.equal(stack._stack[2].filePath, path.resolve("file4.txt"));
});

test("UndoStack: canUndo returns false when empty", () => {
  const stack = new UndoStack();
  assert.equal(stack.canUndo(), false);
});

test("UndoStack: canUndo returns true when has entries", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "test.txt" });
  assert.equal(stack.canUndo(), true);
});

test("UndoStack: canRedo returns false when empty", () => {
  const stack = new UndoStack();
  assert.equal(stack.canRedo(), false);
});

test("UndoStack: undo returns null-like when empty", async () => {
  const stack = new UndoStack();
  const result = await stack.undo();
  assert.equal(result.undone, false);
  assert.equal(result.description, "Nothing to undo");
  assert.equal(result.filePath, "");
});

test("UndoStack: redo returns null-like when empty", async () => {
  const stack = new UndoStack();
  const result = await stack.redo();
  assert.equal(result.redone, false);
  assert.equal(result.description, "Nothing to redo");
  assert.equal(result.filePath, "");
});

test("UndoStack: undo restores original content", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-undo-"));
  const filePath = path.join(tmpDir, "test.txt");
  fs.writeFileSync(filePath, "initial content", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "initial content",
    newContent: "modified content",
  });

  // Write the "new" content that the tool supposedly wrote
  fs.writeFileSync(filePath, "modified content", "utf8");

  const result = await stack.undo();
  assert.equal(result.undone, true);
  assert.ok(result.description.includes("Undo"));

  const restored = fs.readFileSync(filePath, "utf8");
  assert.equal(restored, "initial content");
  assert.equal(stack.canRedo(), true);
  assert.equal(stack.canUndo(), false);
});

test("UndoStack: undo handles file with external modifications", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-undo-"));
  const filePath = path.join(tmpDir, "test.txt");
  fs.writeFileSync(filePath, "initial content", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "initial content",
    newContent: "modified content",
  });

  // File was modified externally (different from our recorded newContent)
  fs.writeFileSync(filePath, "externally modified", "utf8");

  await stack.undo();
  const restored = fs.readFileSync(filePath, "utf8");
  assert.equal(restored, "initial content");

  // Redo stack should have the external content as originalContent
  assert.equal(stack._redoStack[0].originalContent, "externally modified");
  assert.equal(stack._redoStack[0].newContent, "modified content");
});

test("UndoStack: undo re-pushes action on write failure", async () => {
  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath: "/nonexistent-directory/test.txt",
    originalContent: "old",
    newContent: "new",
  });

  const result = await stack.undo();
  assert.equal(result.undone, false);
  assert.ok(result.description.includes("Undo failed"));
  // Action should be back on stack
  assert.equal(stack._stack.length, 1);
});

test("UndoStack: redo reapplies new content", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-undo-"));
  const filePath = path.join(tmpDir, "test.txt");
  fs.writeFileSync(filePath, "initial content", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "initial content",
    newContent: "modified content",
  });
  fs.writeFileSync(filePath, "modified content", "utf8");

  await stack.undo();
  const afterUndo = fs.readFileSync(filePath, "utf8");
  assert.equal(afterUndo, "initial content");

  const result = await stack.redo();
  assert.equal(result.redone, true);

  const afterRedo = fs.readFileSync(filePath, "utf8");
  assert.equal(afterRedo, "modified content");
  assert.equal(stack.canRedo(), false);
  assert.equal(stack.canUndo(), true);
});

test("UndoStack: redo re-pushes action on write failure", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-undo-"));
  const filePath = path.join(tmpDir, "test.txt");
  fs.writeFileSync(filePath, "initial", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "initial",
    newContent: "modified",
  });
  fs.writeFileSync(filePath, "modified", "utf8");
  await stack.undo();

  // Make the path unreadable to cause redo to fail (fs.writeFile would succeed
  // on a deleted file since the directory exists, so we delete the directory)
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const result = await stack.redo();
  assert.equal(result.redone, false);
  assert.ok(result.description.includes("Redo failed"));
  // Action should be back on redo stack
  assert.equal(stack._redoStack.length, 1);
});

test("UndoStack: removeByPath removes from both stacks", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "a.txt" });
  stack.push({ filePath: "b.txt" });
  stack.push({ filePath: "a.txt" });
  // Simulate redo entry (must be resolved path to match removeByPath comparison)
  stack._redoStack.push({ filePath: path.resolve("a.txt") });

  stack.removeByPath("a.txt");
  assert.equal(stack._stack.length, 1);
  assert.equal(stack._stack[0].filePath, path.resolve("b.txt"));
  assert.equal(stack._redoStack.length, 0);
});

test("UndoStack: list returns entries in reverse order", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "first.txt", toolName: "file.write" });
  stack.push({ filePath: "second.txt", toolName: "file.edit" });
  stack.push({ filePath: "third.txt", toolName: "file.write" });

  const list = stack.list();
  assert.equal(list.length, 3);
  assert.equal(list[0].index, 3);
  assert.equal(list[0].file, "third.txt");
  assert.equal(list[1].index, 2);
  assert.equal(list[1].file, "second.txt");
  assert.equal(list[2].index, 1);
  assert.equal(list[2].file, "first.txt");

  // Check list entry structure
  assert.equal(list[0].toolName, "file.write");
  assert.ok(list[0].filePath);
  assert.ok(list[0].timestamp);
});

test("UndoStack: clear empties both stacks", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "a.txt" });
  stack.push({ filePath: "b.txt" });
  stack._redoStack.push({ filePath: "c.txt" });

  stack.clear();
  assert.equal(stack._stack.length, 0);
  assert.equal(stack._redoStack.length, 0);
  assert.equal(stack.canUndo(), false);
  assert.equal(stack.canRedo(), false);
});

test("UndoStack: full undo-redo cycle", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-undo-"));
  const filePath = path.join(tmpDir, "cycle.txt");
  fs.writeFileSync(filePath, "v1", "utf8");

  const stack = new UndoStack();

  // Edit 1: v1 -> v2
  stack.push({ filePath, originalContent: "v1", newContent: "v2", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v2", "utf8");

  // Edit 2: v2 -> v3
  stack.push({ filePath, originalContent: "v2", newContent: "v3", toolName: "file.edit" });
  fs.writeFileSync(filePath, "v3", "utf8");

  assert.equal(stack._stack.length, 2);

  // Undo edit 2: should go back to v2
  const undo1 = await stack.undo();
  assert.equal(undo1.undone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");

  // Undo edit 1: should go back to v1
  const undo2 = await stack.undo();
  assert.equal(undo2.undone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v1");

  // Can't undo more
  assert.equal(stack.canUndo(), false);

  // Redo edit 1: v1 -> v2
  const redo1 = await stack.redo();
  assert.equal(redo1.redone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v2");

  // Redo edit 2: v2 -> v3
  const redo2 = await stack.redo();
  assert.equal(redo2.redone, true);
  assert.equal(fs.readFileSync(filePath, "utf8"), "v3");

  // Can't redo more
  assert.equal(stack.canRedo(), false);
});
