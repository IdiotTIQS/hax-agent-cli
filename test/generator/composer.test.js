/**
 * Tests for generator/composer — ProjectComposer.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ProjectComposer, buildDefaultParts } = require("../../src/generator/composer");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-composer-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tempDir(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Construction and basic API ───────────────────────────────────────────────

test("ProjectComposer: constructs with defaults", () => {
  const c = new ProjectComposer();
  assert.equal(c.partCount, 0);
  assert.deepStrictEqual(c.getParts(), []);
});

test("ProjectComposer: constructs with framework option", () => {
  const c = new ProjectComposer({ framework: "python" });
  assert.equal(c.partCount, 0);
});

// ── addPart ──────────────────────────────────────────────────────────────────

test("ProjectComposer: addPart registers a valid part", () => {
  const c = new ProjectComposer();
  c.addPart({
    name: "testing",
    files: [
      { path: "test/foo.test.ts", content: 'describe("x", () => {});\n' },
    ],
    dependencies: [{ name: "jest", version: "^29.7.0" }],
    devDependencies: [{ name: "ts-jest", version: "^29.1.0" }],
    scripts: { test: "jest" },
  });

  assert.equal(c.partCount, 1);
  const parts = c.getParts();
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, "testing");
  assert.equal(parts[0].fileCount, 1);
  assert.equal(parts[0].depCount, 1);
  assert.equal(parts[0].devDepCount, 1);
  assert.deepStrictEqual(parts[0].scriptNames, ["test"]);
});

test("ProjectComposer: addPart rejects invalid inputs", () => {
  const c = new ProjectComposer();

  assert.throws(() => c.addPart(null), TypeError);
  assert.throws(() => c.addPart({}), TypeError);
  assert.throws(() => c.addPart({ name: "", files: [] }), TypeError);
  assert.throws(() => c.addPart({ name: "x", files: [{ path: "", content: "a" }] }), TypeError);
  assert.throws(() => c.addPart({ name: "x", files: [{ path: "f.txt" }] }), TypeError);
});

test("ProjectComposer: addPart overwrites existing part with same name", () => {
  const c = new ProjectComposer();
  c.addPart({ name: "ci", files: [{ path: ".github/workflows/ci.yml", content: "v1\n" }] });
  c.addPart({ name: "ci", files: [{ path: ".github/workflows/ci.yml", content: "v2\n" }] });

  assert.equal(c.partCount, 1);
  const parts = c.getParts();
  assert.equal(parts.length, 1);
  assert.equal(parts[0].fileCount, 1);
});

// ── addBuiltinParts ──────────────────────────────────────────────────────────

test("ProjectComposer: addBuiltinParts registers built-in parts", () => {
  const c = new ProjectComposer();
  c.addBuiltinParts(["framework", "testing", "linting", "gitignore", "env"]);

  assert.equal(c.partCount, 5);
  const names = c.getParts().map((p) => p.name);
  assert.deepStrictEqual(names, ["env", "framework", "gitignore", "linting", "testing"]);
});

test("ProjectComposer: addBuiltinParts accepts single string", () => {
  const c = new ProjectComposer();
  c.addBuiltinParts("gitignore");
  assert.equal(c.partCount, 1);
  assert.equal(c.getParts()[0].name, "gitignore");
});

test("ProjectComposer: addBuiltinParts throws for unknown part", () => {
  const c = new ProjectComposer();
  assert.throws(() => c.addBuiltinParts("nonexistent"), Error);
});

// ── compose ──────────────────────────────────────────────────────────────────

test("ProjectComposer: compose generates project files on disk", () => {
  const dir = tempDir("compose-basic");
  const c = new ProjectComposer({ outputDir: dir });

  c.addBuiltinParts(["framework", "testing", "gitignore"], { name: "my-composed-app" });
  const result = c.compose({ name: "my-composed-app" });

  assert.ok(result.projectDir.endsWith("my-composed-app"));
  assert.ok(result.files.length >= 4, `expected >= 4 files, got ${result.files.length}`);

  // Core files should exist
  const expected = ["package.json", "tsconfig.json", "jest.config.js", ".gitignore"];
  for (const f of expected) {
    assert.ok(fs.existsSync(path.join(result.projectDir, f)), `Missing: ${f}`);
  }

  // package.json should have merged scripts
  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.equal(pkg.name, "my-composed-app");
  assert.ok(pkg.scripts.test, "should have test script from testing part");
  assert.ok(pkg.scripts.build, "should have build script from framework part");
  assert.ok(pkg.devDependencies.jest, "should have jest devDependency");
  assert.ok(pkg.devDependencies.typescript, "should have typescript devDependency");
});

test("ProjectComposer: compose merges all parts correctly", () => {
  const dir = tempDir("compose-merge");
  const c = new ProjectComposer({ outputDir: dir });

  // Add custom part that also touches package.json
  c.addBuiltinParts(["framework"], { name: "merge-test" });
  c.addPart({
    name: "custom-tool",
    files: [
      { path: "tools/deploy.sh", content: "#!/bin/bash\necho deploy\n" },
    ],
    dependencies: [{ name: "express", version: "^4.19.0" }],
    devDependencies: [{ name: "nodemon", version: "^3.1.0" }],
    scripts: { deploy: "bash tools/deploy.sh" },
  });

  const result = c.compose({ name: "merge-test" });

  // Check custom file exists
  assert.ok(fs.existsSync(path.join(result.projectDir, "tools/deploy.sh")));

  // Check package.json has merged everything
  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.ok(pkg.dependencies.express, "should have express dependency");
  assert.ok(pkg.devDependencies.nodemon, "should have nodemon devDependency");
  assert.ok(pkg.scripts.deploy, "should have deploy script");
});

// ── preview ──────────────────────────────────────────────────────────────────

test("ProjectComposer: preview returns dry-run info without writing files", () => {
  const dir = tempDir("preview-test");
  const c = new ProjectComposer({ outputDir: dir });

  c.addBuiltinParts(["framework"], { name: "preview-app" });

  const plan = c.preview({ name: "preview-app" });

  assert.ok(plan.projectDir.endsWith("preview-app"));
  assert.ok(plan.totalFiles >= 2);
  assert.ok(plan.totalSize > 0);
  assert.ok(Array.isArray(plan.files));
  assert.equal(typeof plan.files[0].path, "string");
  assert.equal(typeof plan.files[0].size, "number");
  assert.ok(plan.scripts && typeof plan.scripts === "object");

  // Verify no files were written
  assert.ok(!fs.existsSync(plan.projectDir), "preview should not create project directory");
});

test("ProjectComposer: preview includes all dependencies in output", () => {
  const dir = tempDir("preview-deps");
  const c = new ProjectComposer({ outputDir: dir });

  c.addBuiltinParts(["framework", "testing", "linting"], { name: "preview-deps-app" });

  const plan = c.preview({ name: "preview-deps-app" });

  assert.ok(plan.dependencies.length >= 1, "should have at least 1 dependency");
  assert.ok(plan.devDependencies.length >= 5, "should have several devDependencies");

  const depNames = plan.devDependencies.map((d) => d.name);
  assert.ok(depNames.includes("jest"));
  assert.ok(depNames.includes("typescript"));
  assert.ok(depNames.includes("eslint"));
});

// ── removePart ───────────────────────────────────────────────────────────────

test("ProjectComposer: removePart removes a registered part", () => {
  const c = new ProjectComposer();
  c.addBuiltinParts(["framework", "testing"]);

  assert.equal(c.partCount, 2);
  assert.equal(c.removePart("testing"), true);
  assert.equal(c.partCount, 1);
  assert.equal(c.removePart("testing"), false);
  assert.equal(c.partCount, 1);
});

// ── buildDefaultParts ────────────────────────────────────────────────────────

test("ProjectComposer: buildDefaultParts returns all 8 part types", () => {
  const parts = buildDefaultParts({ name: "my-app" });
  const names = Object.keys(parts).sort();

  assert.deepStrictEqual(names, ["ci", "docker", "docs", "env", "framework", "gitignore", "linting", "testing"]);
  assert.equal(parts.framework.name, "framework");
  assert.ok(parts.framework.files.length >= 2);
  assert.equal(parts.docker.files.length, 3, "docker part should have Dockerfile, .dockerignore, docker-compose.yml");
});

test("ProjectComposer: buildDefaultParts framework=python produces python files", () => {
  const parts = buildDefaultParts({ name: "py-app", framework: "python" });
  const paths = parts.framework.files.map((f) => f.path);

  assert.ok(paths.includes("pyproject.toml"));
  assert.ok(paths.some((p) => p.endsWith("__init__.py")));
  assert.ok(paths.some((p) => p.endsWith("cli.py")));
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("ProjectComposer: compose with no parts returns minimal result", () => {
  const dir = tempDir("compose-empty");
  const c = new ProjectComposer({ outputDir: dir });

  const result = c.compose({ name: "empty-project" });

  assert.ok(result.projectDir.endsWith("empty-project"));
  assert.deepStrictEqual(result.files, []);
  assert.deepStrictEqual(result.scripts, {});
  assert.deepStrictEqual(result.dependencies, []);
});

test("ProjectComposer: preview with no parts returns empty plan", () => {
  const c = new ProjectComposer();
  const plan = c.preview({ name: "noparts" });

  assert.equal(plan.totalFiles, 0);
  assert.equal(plan.totalSize, 0);
  assert.deepStrictEqual(plan.files, []);
});
