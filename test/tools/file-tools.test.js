"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");

const { createReadFileTool } = require("../../src/tools/file-read");
const { createGlobTool } = require("../../src/tools/file-glob");
const { createSearchTool } = require("../../src/tools/file-search");
const { createReadDirectoryTool } = require("../../src/tools/file-readdir");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-test-"));
}

function cleanTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function context(root) {
  return { root };
}

// ---------------------------------------------------------------------------
// file.read
// ---------------------------------------------------------------------------

test("file.read: reads file content from workspace root", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    const filePath = path.join(dir, "test.txt");
    fs.writeFileSync(filePath, "line one\nline two\nline three", "utf8");

    const result = await tool.execute({ path: "test.txt" }, context(dir));

    assert.equal(result.path, "test.txt");
    assert.equal(result.encoding, "utf8");
    assert.ok(result.content.includes("line one"));
    assert.ok(result.content.includes("line two"));
    assert.ok(result.content.includes("line three"));
    assert.equal(result.totalLines, 3);
    assert.equal(result.offset, 1);
    assert.equal(result.limit, 3);
  } finally {
    cleanTemp(dir);
  }
});

test("file.read: throws for missing file", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    await assert.rejects(
      () => tool.execute({ path: "does-not-exist.txt" }, context(dir)),
      { message: /Path does not exist/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

test("file.read: throws for path outside root", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    await assert.rejects(
      () => tool.execute({ path: "../outside.txt" }, context(dir)),
      { message: /escapes workspace root/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

test("file.read: throws for empty path", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    await assert.rejects(
      () => tool.execute({ path: "" }, context(dir)),
      { message: /must be a non-empty string/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

test("file.read: applies offset and limit correctly", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(dir, "lines.txt"), lines.join("\n"), "utf8");

    const result = await tool.execute({ path: "lines.txt", offset: 5, limit: 3 }, context(dir));

    assert.equal(result.offset, 5);
    assert.equal(result.limit, 3);
    assert.ok(result.content.includes("line 5"));
    assert.ok(result.content.includes("line 6"));
    assert.ok(result.content.includes("line 7"));
    assert.ok(!result.content.includes("line 4"));
    assert.ok(!result.content.includes("line 8"));
  } finally {
    cleanTemp(dir);
  }
});

test("file.read: returns workspace-relative path in result", async () => {
  const tool = createReadFileTool();
  const dir = tempDir();
  try {
    // Create a file in a subdirectory
    const subDir = path.join(dir, "sub", "nested");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "data.txt"), "hello world", "utf8");

    const result = await tool.execute({ path: "sub/nested/data.txt" }, context(dir));

    assert.equal(result.path, "sub/nested/data.txt");
    assert.equal(result.bytes, 11);
  } finally {
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// file.glob
// ---------------------------------------------------------------------------

test("file.glob: matches files by pattern in workspace", async () => {
  const tool = createGlobTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "index.js"), "// main", "utf8");
    fs.writeFileSync(path.join(dir, "utils.js"), "// utils", "utf8");
    fs.writeFileSync(path.join(dir, "README.md"), "# readme", "utf8");

    const result = await tool.execute({ pattern: "*.js" }, context(dir));

    assert.equal(result.pattern, "*.js");
    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.some((m) => m.path === "index.js"));
    assert.ok(result.matches.some((m) => m.path === "utils.js"));
    assert.ok(!result.matches.some((m) => m.path === "README.md"));
  } finally {
    cleanTemp(dir);
  }
});

test("file.glob: handles empty results", async () => {
  const tool = createGlobTool();
  const dir = tempDir();
  try {
    const result = await tool.execute({ pattern: "*.ts" }, context(dir));

    assert.equal(result.matches.length, 0);
    assert.equal(result.truncated, false);
  } finally {
    cleanTemp(dir);
  }
});

test("file.glob: throws for non-directory cwd", async () => {
  const tool = createGlobTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "file.txt"), "data", "utf8");

    await assert.rejects(
      () => tool.execute({ cwd: "file.txt", pattern: "*" }, context(dir)),
      { message: /not a directory/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

test("file.glob: uses **/* as default pattern", async () => {
  const tool = createGlobTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "a", "utf8");
    fs.writeFileSync(path.join(dir, "b.txt"), "b", "utf8");

    const result = await tool.execute({}, context(dir));

    assert.equal(result.pattern, "**/*");
    assert.equal(result.matches.length, 2);
  } finally {
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// file.search
// ---------------------------------------------------------------------------

test("file.search: finds matching lines in files", async () => {
  const tool = createSearchTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "app.js"), "const x = 1;\nfunction foo() {\n  return x;\n}\n", "utf8");

    const result = await tool.execute({ query: "foo" }, context(dir));

    assert.equal(result.query, "foo");
    assert.ok(result.matches.length >= 1);
    assert.ok(result.matches.some((m) => m.text.includes("foo")));
  } finally {
    cleanTemp(dir);
  }
});

test("file.search: handles no matches gracefully", async () => {
  const tool = createSearchTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "app.js"), "const x = 1;\n", "utf8");

    const result = await tool.execute({ query: "nonexistent" }, context(dir));

    assert.equal(result.matches.length, 0);
  } finally {
    cleanTemp(dir);
  }
});

test("file.search: supports regex patterns", async () => {
  const tool = createSearchTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "code.js"), "var a = 10;\nvar b = 20;\nlet c = 30;\n", "utf8");

    const result = await tool.execute({ query: "var\\s+\\w+", regex: true }, context(dir));

    assert.ok(result.matches.length >= 2);
    assert.equal(result.regex, true);
  } finally {
    cleanTemp(dir);
  }
});

test("file.search: handles empty query", async () => {
  const tool = createSearchTool();
  const dir = tempDir();
  try {
    await assert.rejects(
      () => tool.execute({ query: "" }, context(dir)),
      { message: /must be a non-empty string/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// file.readDirectory
// ---------------------------------------------------------------------------

test("file.readDirectory: lists directory entries", async () => {
  const tool = createReadDirectoryTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "file1.txt"), "content", "utf8");
    fs.writeFileSync(path.join(dir, "file2.txt"), "content", "utf8");
    fs.mkdirSync(path.join(dir, "subdir"));

    const result = await tool.execute({ path: "." }, context(dir));

    assert.equal(result.path, ".");
    assert.ok(result.entryCount >= 3);
    assert.ok(result.entries.some((e) => e.name === "file1.txt" && e.type === "file"));
    assert.ok(result.entries.some((e) => e.name === "file2.txt" && e.type === "file"));
    assert.ok(result.entries.some((e) => e.name === "subdir" && e.type === "directory"));
  } finally {
    cleanTemp(dir);
  }
});

test("file.readDirectory: throws for non-directory path", async () => {
  const tool = createReadDirectoryTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "file.txt"), "data", "utf8");

    await assert.rejects(
      () => tool.execute({ path: "file.txt" }, context(dir)),
      { message: /not a directory/ }
    );
  } finally {
    cleanTemp(dir);
  }
});

test("file.readDirectory: sorts entries (directories first, then by name)", async () => {
  const tool = createReadDirectoryTool();
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "zebra.txt"), "z", "utf8");
    fs.writeFileSync(path.join(dir, "alpha.txt"), "a", "utf8");
    fs.mkdirSync(path.join(dir, "docs"));

    const result = await tool.execute({ path: "." }, context(dir));

    const fileEntries = result.entries.filter((e) => e.type === "file");
    const dirEntries = result.entries.filter((e) => e.type === "directory");
    // Directories should come before files
    const firstFileIdx = result.entries.findIndex((e) => e.type === "file");
    const lastDirIdx = result.entries.map((e, i) => e.type === "directory" ? i : -1).filter((i) => i !== -1).pop();
    if (dirEntries.length > 0 && fileEntries.length > 0) {
      assert.ok(lastDirIdx < firstFileIdx);
    }
  } finally {
    cleanTemp(dir);
  }
});
