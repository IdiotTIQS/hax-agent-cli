/**
 * Tests for generator/project-gen — ProjectGenerator.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ProjectGenerator } = require("../../src/generator/project-gen");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-project-gen-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tempDir(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── generateNodeProject ──────────────────────────────────────────────────────

test("ProjectGenerator: generateNodeProject creates expected files", () => {
  const dir = tempDir("node-basic");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateNodeProject({ name: "my-node-lib" });

  assert.ok(result.projectDir.endsWith("my-node-lib"));
  assert.ok(result.files.length >= 8);

  const expectedFiles = [
    "package.json", "tsconfig.json", "jest.config.js",
    ".eslintrc.json", ".env", ".gitignore",
    "src/index.ts", "test/index.test.ts",
  ];
  for (const f of expectedFiles) {
    assert.ok(fs.existsSync(path.join(result.projectDir, f)), `Missing: ${f}`);
  }
});

test("ProjectGenerator: generateNodeProject package.json has correct fields", () => {
  const dir = tempDir("node-pkg");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateNodeProject({
    name: "my-node-lib",
    description: "A great library",
    author: "Dev",
    license: "Apache-2.0",
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.equal(pkg.name, "my-node-lib");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.description, "A great library");
  assert.equal(pkg.license, "Apache-2.0");
  assert.ok("jest" in pkg.devDependencies);
  assert.ok("typescript" in pkg.devDependencies);
  assert.ok("eslint" in pkg.devDependencies);
});

test("ProjectGenerator: generateNodeProject tsconfig.json is valid JSON with expected options", () => {
  const dir = tempDir("node-tsconfig");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateNodeProject({ name: "my-node-lib" });

  const tsconfig = JSON.parse(fs.readFileSync(path.join(result.projectDir, "tsconfig.json"), "utf-8"));
  assert.equal(tsconfig.compilerOptions.target, "ES2022");
  assert.equal(tsconfig.compilerOptions.module, "commonjs");
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.outDir, "dist");
  assert.ok(tsconfig.include.includes("src/**/*"));
});

test("ProjectGenerator: generateNodeProject source and test files are valid", () => {
  const dir = tempDir("node-sources");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateNodeProject({ name: "my-node-lib" });

  const indexContent = fs.readFileSync(path.join(result.projectDir, "src", "index.ts"), "utf-8");
  assert.ok(indexContent.includes("export function main"));
  assert.ok(indexContent.includes("require.main === module"));

  const testContent = fs.readFileSync(path.join(result.projectDir, "test", "index.test.ts"), "utf-8");
  assert.ok(testContent.includes("describe"));
  assert.ok(testContent.includes("../src/index"));
});

// ── generatePythonProject ────────────────────────────────────────────────────

test("ProjectGenerator: generatePythonProject creates expected files", () => {
  const dir = tempDir("py-basic");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePythonProject({ name: "my-python-lib" });

  assert.ok(result.projectDir.endsWith("my-python-lib"));
  const expected = [
    "setup.py", "pyproject.toml", "requirements.txt",
    "requirements-dev.txt", ".gitignore",
  ];
  for (const f of expected) {
    assert.ok(fs.existsSync(path.join(result.projectDir, f)), `Missing: ${f}`);
  }
  // Module name replaces hyphens with underscores
  const moduleName = "my_python_lib";
  assert.ok(fs.existsSync(path.join(result.projectDir, "src", moduleName, "__init__.py")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "src", moduleName, "cli.py")));
});

test("ProjectGenerator: generatePythonProject setup.py contains expected metadata", () => {
  const dir = tempDir("py-setup");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePythonProject({
    name: "my-python-lib",
    description: "Python utility library",
    version: "0.2.0",
    author: "Python Dev",
  });

  const setupPy = fs.readFileSync(path.join(result.projectDir, "setup.py"), "utf-8");
  assert.ok(setupPy.includes('name="my-python-lib"'));
  assert.ok(setupPy.includes('description="Python utility library"'));
  assert.ok(setupPy.includes('version="0.2.0"'));
  assert.ok(setupPy.includes('packages=find_packages'));
  assert.ok(setupPy.includes('pytest'));
});

test("ProjectGenerator: generatePythonProject test file is valid Python", () => {
  const dir = tempDir("py-test");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePythonProject({ name: "my-python-lib" });

  const testFile = path.join(result.projectDir, "test", "test_cli.py");
  const content = fs.readFileSync(testFile, "utf-8");
  assert.ok(content.includes("def test_greet"));
  assert.ok(content.includes("CliRunner"));
  assert.ok(content.includes("Hello, Hax!"));
});

// ── generateWebApp ───────────────────────────────────────────────────────────

test("ProjectGenerator: generateWebApp (React) creates expected files", () => {
  const dir = tempDir("web-react");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateWebApp({ name: "my-react-app", framework: "react" });

  assert.ok(result.projectDir.endsWith("my-react-app"));
  assert.ok(fs.existsSync(path.join(result.projectDir, "package.json")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "vite.config.js")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "index.html")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "src", "main.jsx")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "src", "App.jsx")));
});

test("ProjectGenerator: generateWebApp (Vue) creates App.vue", () => {
  const dir = tempDir("web-vue");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateWebApp({ name: "my-vue-app", framework: "vue" });

  assert.ok(fs.existsSync(path.join(result.projectDir, "src", "App.vue")));
  const appVue = fs.readFileSync(path.join(result.projectDir, "src", "App.vue"), "utf-8");
  assert.ok(appVue.includes("<script setup>"));
  assert.ok(appVue.includes("<template>"));
});

test("ProjectGenerator: generateWebApp (Svelte) creates App.svelte", () => {
  const dir = tempDir("web-svelte");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateWebApp({ name: "my-svelte-app", framework: "svelte" });

  assert.ok(fs.existsSync(path.join(result.projectDir, "src", "App.svelte")));
  const appSvelte = fs.readFileSync(path.join(result.projectDir, "src", "App.svelte"), "utf-8");
  assert.ok(appSvelte.includes("<script>"));
  assert.ok(appSvelte.includes("{name}"));
});

test("ProjectGenerator: generateWebApp package.json includes framework dependency", () => {
  const dir = tempDir("web-dep");
  const gen = new ProjectGenerator({ outputDir: dir });

  const reactResult = gen.generateWebApp({ name: "r", framework: "react", outputDir: path.join(dir, "ra") });
  const reactPkg = JSON.parse(fs.readFileSync(path.join(reactResult.projectDir, "package.json"), "utf-8"));
  assert.ok("react" in reactPkg.dependencies);

  const vueResult = gen.generateWebApp({ name: "v", framework: "vue", outputDir: path.join(dir, "va") });
  const vuePkg = JSON.parse(fs.readFileSync(path.join(vueResult.projectDir, "package.json"), "utf-8"));
  assert.ok("vue" in vuePkg.dependencies);

  const svelteResult = gen.generateWebApp({ name: "s", framework: "svelte", outputDir: path.join(dir, "sa") });
  const sveltePkg = JSON.parse(fs.readFileSync(path.join(svelteResult.projectDir, "package.json"), "utf-8"));
  assert.ok("svelte" in sveltePkg.dependencies);
});

// ── generateCLI ──────────────────────────────────────────────────────────────

test("ProjectGenerator: generateCLI creates expected files", () => {
  const dir = tempDir("cli-basic");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateCLI({ name: "my-cli" });

  assert.ok(result.projectDir.endsWith("my-cli"));
  assert.ok(fs.existsSync(path.join(result.projectDir, "package.json")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "tsconfig.json")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "src", "cli.ts")));
});

test("ProjectGenerator: generateCLI package.json includes bin entry", () => {
  const dir = tempDir("cli-bin");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateCLI({ name: "my-cli" });

  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.ok(pkg.bin);
  assert.ok("my-cli" in pkg.bin);
  assert.equal(pkg.bin["my-cli"], "dist/cli.js");
});

test("ProjectGenerator: generateCLI respects custom description", () => {
  const dir = tempDir("cli-desc");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateCLI({ name: "my-cli", description: "A custom CLI" });

  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.equal(pkg.description, "A custom CLI");
});

// ── generatePlugin ───────────────────────────────────────────────────────────

test("ProjectGenerator: generatePlugin creates expected files", () => {
  const dir = tempDir("plugin-basic");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePlugin({ name: "my-plugin" });

  assert.ok(result.projectDir.endsWith("my-plugin"));
  assert.ok(fs.existsSync(path.join(result.projectDir, "package.json")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "index.js")));
  assert.ok(fs.existsSync(path.join(result.projectDir, "test", "basic.test.js")));
});

test("ProjectGenerator: generatePlugin index.js exports a valid plugin shape", () => {
  const dir = tempDir("plugin-module");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePlugin({ name: "my-plugin" });

  const plugin = require(path.join(result.projectDir, "index.js"));
  assert.equal(typeof plugin, "object");
  assert.equal(plugin.name, "my-plugin");
  assert.equal(plugin.version, "1.0.0");
  assert.equal(typeof plugin.hooks, "object");
  assert.equal(typeof plugin.hooks.beforeChat, "function");
});

test("ProjectGenerator: generatePlugin hooks are pass-through", () => {
  const dir = tempDir("plugin-ctx");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generatePlugin({ name: "my-plugin" });

  const plugin = require(path.join(result.projectDir, "index.js"));
  const ctx = { session: { id: "x" }, message: "hi" };
  assert.strictEqual(plugin.hooks.beforeChat(ctx), ctx);
  assert.strictEqual(plugin.hooks.afterToolCall(ctx), ctx);
});

// ── generate (dispatcher) ────────────────────────────────────────────────────

test("ProjectGenerator: generate dispatcher routes to correct method", () => {
  const dir = tempDir("dispatch");
  const gen = new ProjectGenerator({ outputDir: dir });

  const node = gen.generate({ type: "node", name: "n", outputDir: path.join(dir, "nd") });
  assert.ok(fs.existsSync(path.join(node.projectDir, "tsconfig.json")));

  const cli = gen.generate({ type: "cli", name: "c", outputDir: path.join(dir, "cd") });
  assert.ok(fs.existsSync(path.join(cli.projectDir, "src", "cli.ts")));
});

test("ProjectGenerator: generate throws on unknown type", () => {
  const gen = new ProjectGenerator();
  assert.throws(
    () => gen.generate({ type: "unknown", name: "x" }),
    /unknown project type/
  );
});

test("ProjectGenerator: generateNodeProject handles missing optional fields gracefully", () => {
  const dir = tempDir("node-minimal");
  const gen = new ProjectGenerator({ outputDir: dir });
  const result = gen.generateNodeProject({ name: "minimal" });

  const pkg = JSON.parse(fs.readFileSync(path.join(result.projectDir, "package.json"), "utf-8"));
  assert.equal(pkg.name, "minimal");
  assert.equal(pkg.version, "1.0.0");
});
