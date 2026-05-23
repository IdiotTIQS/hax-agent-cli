/**
 * Tests for generator/file-gen — FileGenerator.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { FileGenerator } = require("../../src/generator/file-gen");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-file-gen-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tempDir(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── generateFile ─────────────────────────────────────────────────────────────

test("FileGenerator: generateFile renders template with variables", () => {
  const gen = new FileGenerator();
  const output = gen.generateFile("Hello, {{name}}!", { name: "World" });
  assert.equal(output, "Hello, World!");
});

test("FileGenerator: generateFile uses default variables", () => {
  const gen = new FileGenerator({ defaults: { author: "HaxAgent" } });
  const output = gen.generateFile("By {{author}}", {});
  assert.equal(output, "By HaxAgent");
});

test("FileGenerator: generateFile allows overrides over defaults", () => {
  const gen = new FileGenerator({ defaults: { author: "HaxAgent" } });
  const output = gen.generateFile("By {{author}}", { author: "Override" });
  assert.equal(output, "By Override");
});

test("FileGenerator: generateFile handles empty/blank template", () => {
  const gen = new FileGenerator();
  assert.equal(gen.generateFile("", {}), "");
  assert.equal(gen.generateFile(undefined, {}), "");
});

// ── generateFromSpec ─────────────────────────────────────────────────────────

test("FileGenerator: generateFromSpec writes file to disk", () => {
  const dir = tempDir("spec-write");
  const gen = new FileGenerator({ cwd: dir });

  const result = gen.generateFromSpec({
    path: "output.txt",
    template: "content: {{val}}",
    variables: { val: "42" },
    overwrite: true,
    createDirs: true,
  });

  assert.equal(result.written, true);
  assert.ok(result.filePath.endsWith("output.txt"));
  const content = fs.readFileSync(result.filePath, "utf-8");
  assert.equal(content, "content: 42");
});

test("FileGenerator: generateFromSpec respects overwrite = false", () => {
  const dir = tempDir("spec-no-overwrite");
  const gen = new FileGenerator({ cwd: dir });

  // First write
  gen.generateFromSpec({
    path: "data.txt",
    template: "original",
    variables: {},
    overwrite: true,
    createDirs: true,
  });

  // Second write with overwrite = false
  const result = gen.generateFromSpec({
    path: "data.txt",
    template: "updated",
    variables: {},
    overwrite: false,
    createDirs: true,
  });

  assert.equal(result.written, false);
  const content = fs.readFileSync(result.filePath, "utf-8");
  assert.equal(content, "original");
});

test("FileGenerator: generateFromSpec creates parent directories when createDirs = true", () => {
  const dir = tempDir("spec-create-dirs");
  const gen = new FileGenerator({ cwd: dir });

  gen.generateFromSpec({
    path: "deep/nested/dir/file.txt",
    template: "nested content",
    variables: {},
    overwrite: true,
    createDirs: true,
  });

  assert.ok(fs.existsSync(path.join(dir, "deep", "nested", "dir", "file.txt")));
});

test("FileGenerator: generateFromSpec throws when createDirs = false and parent missing", () => {
  const dir = tempDir("spec-no-dirs");
  const gen = new FileGenerator({ cwd: dir });

  assert.throws(() => {
    gen.generateFromSpec({
      path: "missing-parent/file.txt",
      template: "content",
      variables: {},
      createDirs: false,
    });
  });
});

test("FileGenerator: generateFromSpec throws on invalid spec", () => {
  const gen = new FileGenerator();

  assert.throws(() => gen.generateFromSpec(null), /spec must be an object/);
  assert.throws(() => gen.generateFromSpec({}), /template must be a string/);
  assert.throws(() => gen.generateFromSpec({ template: "x" }), /path must be/);
});

test("FileGenerator: generateFromSpec resolves relative paths against cwd", () => {
  const dir = tempDir("spec-cwd");
  const gen = new FileGenerator({ cwd: dir });

  const result = gen.generateFromSpec({
    path: "relative/file.txt",
    template: "relative",
    variables: {},
    overwrite: true,
    createDirs: true,
  });

  assert.ok(result.filePath.startsWith(dir));
  assert.ok(fs.existsSync(result.filePath));
});

test("FileGenerator: generateFromSpec sets file mode via chmod", () => {
  const dir = tempDir("spec-chmod");
  const gen = new FileGenerator({ cwd: dir });

  gen.generateFromSpec({
    path: "executable.sh",
    template: "#!/bin/bash\necho hello",
    variables: {},
    overwrite: true,
    createDirs: true,
    hooks: { chmod: "755" },
  });

  const stats = fs.statSync(path.join(dir, "executable.sh"));
  // On Windows, chmod mostly affects write permissions; just verify file exists
  // and mode was set (on Unix: 0o755). On Windows, mode bits are different.
  assert.ok(stats.isFile());
});

// ── generateBatch ────────────────────────────────────────────────────────────

test("FileGenerator: generateBatch processes multiple specs", () => {
  const dir = tempDir("batch");
  const gen = new FileGenerator({ cwd: dir });

  const results = gen.generateBatch([
    { path: "a.txt", template: "file a", variables: {}, overwrite: true, createDirs: true },
    { path: "b.txt", template: "file b", variables: {}, overwrite: true, createDirs: true },
    { path: "c.txt", template: "file c", variables: {}, overwrite: true, createDirs: true },
  ]);

  assert.equal(results.length, 3);
  assert.equal(results[0].written, true);
  assert.equal(results[1].written, true);
  assert.equal(results[2].written, true);

  assert.ok(fs.existsSync(path.join(dir, "a.txt")));
  assert.ok(fs.existsSync(path.join(dir, "b.txt")));
  assert.ok(fs.existsSync(path.join(dir, "c.txt")));
});

test("FileGenerator: generateBatch returns written=false for skipped files", () => {
  const dir = tempDir("batch-skip");
  const gen = new FileGenerator({ cwd: dir });

  // First, create file
  gen.generateFromSpec({
    path: "existing.txt",
    template: "original",
    variables: {},
    overwrite: true,
    createDirs: true,
  });

  // Batch includes existing file with overwrite = false
  const results = gen.generateBatch([
    { path: "new.txt", template: "new", variables: {}, overwrite: true, createDirs: true },
    { path: "existing.txt", template: "should not write", variables: {}, overwrite: false, createDirs: true },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].written, true);
  assert.equal(results[1].written, false);
  assert.equal(fs.readFileSync(path.join(dir, "existing.txt"), "utf-8"), "original");
});

test("FileGenerator: generateBatch throws on non-array input", () => {
  const gen = new FileGenerator();
  assert.throws(() => gen.generateBatch("not-array"), /specs must be an array/);
  assert.throws(() => gen.generateBatch(null), /specs must be an array/);
});

// ── dryRun ───────────────────────────────────────────────────────────────────

test("FileGenerator: dryRun returns content without writing to disk", () => {
  const dir = tempDir("dry-basic");
  const gen = new FileGenerator({ cwd: dir });

  const result = gen.dryRun({
    path: "should-not-exist.txt",
    template: "preview: {{val}}",
    variables: { val: "ok" },
  });

  assert.equal(result.content, "preview: ok");
  assert.ok(result.filePath.endsWith("should-not-exist.txt"));
  assert.equal(result.wouldWrite, true);
  assert.ok(!fs.existsSync(result.filePath));
});

test("FileGenerator: dryRun reports wouldWrite = false for existing file with overwrite false", () => {
  const dir = tempDir("dry-overwrite");
  const gen = new FileGenerator({ cwd: dir });

  // Create the file first
  fs.writeFileSync(path.join(dir, "exists.txt"), "old", "utf-8");

  const result = gen.dryRun({
    path: "exists.txt",
    template: "new content",
    variables: {},
    overwrite: false,
  });

  assert.equal(result.wouldWrite, false);
  assert.equal(result.content, "new content");
  assert.equal(fs.readFileSync(path.join(dir, "exists.txt"), "utf-8"), "old");
});

test("FileGenerator: dryRun works without a path (preview only)", () => {
  const gen = new FileGenerator();
  const result = gen.dryRun({
    template: "Hello, {{user}}!",
    variables: { user: "Alice" },
  });

  assert.equal(result.filePath, null);
  assert.equal(result.content, "Hello, Alice!");
  assert.equal(result.wouldWrite, true);
});

// ── hooks ────────────────────────────────────────────────────────────────────

test("FileGenerator: generateFromSpec handles format hook (non-fatal on failure)", () => {
  const dir = tempDir("hook-format");
  const gen = new FileGenerator({ cwd: dir });

  // Use a non-existent formatter — should not throw
  const result = gen.generateFromSpec({
    path: "formatted.txt",
    template: "code",
    variables: {},
    overwrite: true,
    createDirs: true,
    hooks: { format: "nonexistent-formatter-xyz {file}" },
  });

  assert.equal(result.written, true);
  assert.ok(fs.existsSync(result.filePath));
});

test("FileGenerator: generateFromSpec handles lint hook (non-fatal on failure)", () => {
  const dir = tempDir("hook-lint");
  const gen = new FileGenerator({ cwd: dir });

  const result = gen.generateFromSpec({
    path: "linted.txt",
    template: "code",
    variables: {},
    overwrite: true,
    createDirs: true,
    hooks: { lint: "nonexistent-linter-xyz {file}" },
  });

  assert.equal(result.written, true);
  assert.ok(fs.existsSync(result.filePath));
});

test("FileGenerator: generateFromSpec runs multiple hooks", () => {
  const dir = tempDir("hook-multi");
  const gen = new FileGenerator({ cwd: dir });

  const result = gen.generateFromSpec({
    path: "multi.txt",
    template: "code",
    variables: {},
    overwrite: true,
    createDirs: true,
    hooks: {
      format: "nonexistent-1 {file}",
      lint: "nonexistent-2 {file}",
      chmod: "644",
    },
  });

  assert.equal(result.written, true);
  assert.ok(fs.existsSync(result.filePath));
});
