/**
 * Tests for generator/customizer — ProjectCustomizer.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  ProjectCustomizer,
  deepMerge,
} = require("../../src/generator/customizer");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-customizer-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeProject(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Construction and queuing ─────────────────────────────────────────────────

test("ProjectCustomizer: constructs with defaults", () => {
  const cz = new ProjectCustomizer();
  assert.equal(cz.pendingDeps, 0);
  assert.equal(cz.pendingDevDeps, 0);
  assert.equal(cz.pendingScripts, 0);
  assert.equal(cz.pendingTools, 0);
  assert.equal(cz.pendingEnvVars, 0);
});

test("ProjectCustomizer: addDependency queues a dependency", () => {
  const cz = new ProjectCustomizer();
  cz.addDependency("express", "^4.19.0");
  assert.equal(cz.pendingDeps, 1);
});

test("ProjectCustomizer: addDependency rejects invalid inputs", () => {
  const cz = new ProjectCustomizer();
  assert.throws(() => cz.addDependency("", "^1.0.0"), TypeError);
  assert.throws(() => cz.addDependency("lodash", ""), TypeError);
  assert.throws(() => cz.addDependency(null, "^1.0.0"), TypeError);
});

test("ProjectCustomizer: addDevDependency queues a dev dependency", () => {
  const cz = new ProjectCustomizer();
  cz.addDevDependency("eslint", "^8.57.0");
  assert.equal(cz.pendingDevDeps, 1);
});

test("ProjectCustomizer: addScript queues a script", () => {
  const cz = new ProjectCustomizer();
  cz.addScript("deploy", "node scripts/deploy.js");
  assert.equal(cz.pendingScripts, 1);
});

test("ProjectCustomizer: configureTool queues a tool config", () => {
  const cz = new ProjectCustomizer();
  cz.configureTool("eslint", { rules: { "no-console": "off" } });
  assert.equal(cz.pendingTools, 1);
});

// ── customize ────────────────────────────────────────────────────────────────

test("ProjectCustomizer: customize applies dependencies and scripts to package.json", () => {
  const projectDir = makeProject("customize-pkg");
  const pkgPath = path.join(projectDir, "package.json");

  // Create a minimal package.json first
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "test-app",
    version: "1.0.0",
    scripts: { test: "jest" },
  }, null, 2) + "\n", "utf-8");

  const cz = new ProjectCustomizer();
  cz.addDependency("express", "^4.19.0");
  cz.addDependency("lodash", "^4.17.21");
  cz.addDevDependency("prettier", "^3.2.0");
  cz.addScript("deploy", "node deploy.js");
  cz.addScript("lint", "eslint src/");

  const result = cz.customize(projectDir);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  assert.equal(pkg.dependencies.express, "^4.19.0");
  assert.equal(pkg.dependencies.lodash, "^4.17.21");
  assert.equal(pkg.devDependencies.prettier, "^3.2.0");
  assert.equal(pkg.scripts.deploy, "node deploy.js");
  assert.equal(pkg.scripts.lint, "eslint src/");
  assert.equal(pkg.scripts.test, "jest"); // original preserved

  assert.ok(result.modified.includes("package.json"));
  assert.equal(result.depsAdded.length, 2);
  assert.equal(result.devDepsAdded.length, 1);
  assert.equal(result.scriptsAdded.length, 2);
});

test("ProjectCustomizer: customize applies tool configuration to .eslintrc.json", () => {
  const projectDir = makeProject("customize-eslint");
  const eslintPath = path.join(projectDir, ".eslintrc.json");

  // Create initial eslint config
  fs.writeFileSync(eslintPath, JSON.stringify({
    parser: "@typescript-eslint/parser",
    rules: { "no-console": "warn" },
  }, null, 2) + "\n", "utf-8");

  const cz = new ProjectCustomizer();
  cz.configureTool("eslint", { rules: { "no-console": "off", "no-debugger": "error" } });

  const result = cz.customize(projectDir);
  assert.ok(result.modified.includes(".eslintrc.json"));

  const eslintConfig = JSON.parse(fs.readFileSync(eslintPath, "utf-8"));
  assert.equal(eslintConfig.rules["no-console"], "off");
  assert.equal(eslintConfig.rules["no-debugger"], "error");
  assert.equal(eslintConfig.parser, "@typescript-eslint/parser");
});

test("ProjectCustomizer: customize sets env vars in .env", () => {
  const projectDir = makeProject("customize-env");
  const envPath = path.join(projectDir, ".env");

  // Create an initial .env
  fs.writeFileSync(envPath, [
    "NODE_ENV=development",
    "PORT=3000",
    "",
  ].join("\n"), "utf-8");

  const cz = new ProjectCustomizer();
  cz.setEnvVar("API_KEY", "abc123");
  cz.setEnvVar("PORT", "8080");
  cz.setEnvVar("DB_HOST", "pg.example.com");

  const result = cz.customize(projectDir);
  assert.ok(result.modified.includes(".env"));

  const envContent = fs.readFileSync(envPath, "utf-8");
  assert.ok(envContent.includes("API_KEY=abc123"));
  assert.ok(envContent.includes("PORT=8080"));
  assert.ok(envContent.includes("DB_HOST=pg.example.com"));
});

test("ProjectCustomizer: customize with files option writes extra files", () => {
  const projectDir = makeProject("customize-files");

  const cz = new ProjectCustomizer();
  const result = cz.customize(projectDir, {
    files: {
      "CHANGELOG.md": "# Changelog\n\n## 1.0.0\n- Initial release\n",
      "config/app.json": JSON.stringify({ name: "test-app", debug: true }),
    },
  });

  assert.ok(result.modified.includes("CHANGELOG.md"));
  assert.ok(result.modified.includes("config/app.json"));
  assert.ok(fs.existsSync(path.join(projectDir, "CHANGELOG.md")));
  assert.ok(fs.existsSync(path.join(projectDir, "config", "app.json")));

  const appJson = JSON.parse(fs.readFileSync(path.join(projectDir, "config", "app.json"), "utf-8"));
  assert.equal(appJson.name, "test-app");
  assert.equal(appJson.debug, true);
});

test("ProjectCustomizer: customize rejects non-existent project directory", () => {
  const cz = new ProjectCustomizer();
  assert.throws(
    () => cz.customize("/nonexistent/path/12345"),
    Error,
  );
});

// ── mergeConfig ──────────────────────────────────────────────────────────────

test("ProjectCustomizer: mergeConfig deep-merges two objects", () => {
  const cz = new ProjectCustomizer();

  const base = { a: 1, b: { x: 10, y: 20 }, c: [1, 2] };
  const override = { b: { y: 99, z: 30 }, c: [3, 4], d: "new" };

  const result = cz.mergeConfig(base, override);

  assert.equal(result.a, 1);
  assert.equal(result.b.x, 10);
  assert.equal(result.b.y, 99);
  assert.equal(result.b.z, 30);
  assert.deepStrictEqual(result.c, [1, 2, 3, 4]);
  assert.equal(result.d, "new");
});

test("ProjectCustomizer: mergeConfig handles null/empty gracefully", () => {
  const cz = new ProjectCustomizer();

  assert.deepStrictEqual(cz.mergeConfig({}, {}), {});
  assert.deepStrictEqual(cz.mergeConfig({ a: 1 }, null), { a: 1 });
  assert.deepStrictEqual(cz.mergeConfig({ a: 1 }, {}), { a: 1 });
});

// ── reset ────────────────────────────────────────────────────────────────────

test("ProjectCustomizer: reset clears all queued operations", () => {
  const cz = new ProjectCustomizer();
  cz.addDependency("lodash", "^4.0.0");
  cz.addDevDependency("jest", "^29.0.0");
  cz.addScript("start", "node index.js");
  cz.configureTool("eslint", { rules: {} });
  cz.setEnvVar("FOO", "bar");

  assert.equal(cz.pendingDeps, 1);
  assert.equal(cz.pendingDevDeps, 1);
  assert.equal(cz.pendingScripts, 1);
  assert.equal(cz.pendingTools, 1);
  assert.equal(cz.pendingEnvVars, 1);

  cz.reset();

  assert.equal(cz.pendingDeps, 0);
  assert.equal(cz.pendingDevDeps, 0);
  assert.equal(cz.pendingScripts, 0);
  assert.equal(cz.pendingTools, 0);
  assert.equal(cz.pendingEnvVars, 0);
});

// ── Chaining ─────────────────────────────────────────────────────────────────

test("ProjectCustomizer: supports method chaining", () => {
  const cz = new ProjectCustomizer();
  const returned = cz
    .addDependency("express", "^4.19.0")
    .addDevDependency("eslint", "^8.57.0")
    .addScript("build", "tsc")
    .configureTool("prettier", { semi: false })
    .setEnvVar("NODE_ENV", "production");

  assert.strictEqual(returned, cz);
  assert.equal(cz.pendingDeps, 1);
  assert.equal(cz.pendingDevDeps, 1);
  assert.equal(cz.pendingScripts, 1);
  assert.equal(cz.pendingTools, 1);
  assert.equal(cz.pendingEnvVars, 1);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("ProjectCustomizer: customize with no queued operations returns empty result", () => {
  const projectDir = makeProject("customize-empty");
  fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "empty" }), "utf-8");

  const cz = new ProjectCustomizer();
  const result = cz.customize(projectDir);

  assert.deepStrictEqual(result.modified, []);
  assert.deepStrictEqual(result.scriptsAdded, []);
  assert.deepStrictEqual(result.depsAdded, []);
  assert.deepStrictEqual(result.devDepsAdded, []);
});

test("ProjectCustomizer: customize works when package.json does not exist yet", () => {
  const projectDir = makeProject("customize-no-pkg");

  const cz = new ProjectCustomizer();
  cz.addDependency("lodash", "^4.0.0");
  cz.addScript("start", "node index.js");

  const result = cz.customize(projectDir);

  assert.ok(result.modified.includes("package.json"));

  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
  assert.equal(pkg.dependencies.lodash, "^4.0.0");
  assert.equal(pkg.scripts.start, "node index.js");
});

test("ProjectCustomizer: customize creates .env when it does not exist", () => {
  const projectDir = makeProject("customize-no-env");

  const cz = new ProjectCustomizer();
  cz.setEnvVar("API_KEY", "secret123");

  const result = cz.customize(projectDir);

  assert.ok(result.modified.includes(".env"));
  const envContent = fs.readFileSync(path.join(projectDir, ".env"), "utf-8");
  assert.ok(envContent.includes("API_KEY=secret123"));
});

// ── deepMerge standalone ─────────────────────────────────────────────────────

test("ProjectCustomizer: deepMerge handles nested objects", () => {
  const base = {
    compilerOptions: { target: "ES2020", strict: false },
    include: ["src"],
  };
  const override = {
    compilerOptions: { strict: true, outDir: "build" },
  };
  const result = deepMerge(base, override);

  assert.equal(result.compilerOptions.target, "ES2020");
  assert.equal(result.compilerOptions.strict, true);
  assert.equal(result.compilerOptions.outDir, "build");
  assert.deepStrictEqual(result.include, ["src"]);
});

test("ProjectCustomizer: deepMerge deduplicates arrays by object name", () => {
  const base = { plugins: [{ name: "a" }, { name: "b" }] };
  const override = { plugins: [{ name: "b", extra: true }, { name: "c" }] };

  const result = deepMerge(base, override);

  assert.equal(result.plugins.length, 3);
  // Base items come first; override items replace duplicates and append new ones
  assert.deepStrictEqual(result.plugins[0], { name: "a" });
  assert.deepStrictEqual(result.plugins[1], { name: "b", extra: true });
  assert.deepStrictEqual(result.plugins[2], { name: "c" });
});
