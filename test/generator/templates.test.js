/**
 * Tests for generator/templates — TemplateRegistry.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { TemplateRegistry } = require("../../src/generator/templates");

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRegistry() {
  return new TemplateRegistry();
}

// ── register ─────────────────────────────────────────────────────────────────

test("TemplateRegistry: register adds a template and listTemplates returns it", () => {
  const r = createRegistry();
  r.register("hello", {
    template: "Hello, {{name}}!",
    category: "greetings",
    description: "A greeting template",
    required: ["name"],
  });

  const list = r.listTemplates();
  const hello = list.find((t) => t.name === "hello");

  assert.ok(hello);
  assert.equal(hello.category, "greetings");
  assert.equal(hello.description, "A greeting template");
  assert.deepEqual(hello.required, ["name"]);
});

test("TemplateRegistry: register throws on missing name", () => {
  const r = createRegistry();
  assert.throws(() => r.register("", { template: "x" }), /name must be a non-empty string/);
  assert.throws(() => r.register(null, { template: "x" }), /name must be a non-empty string/);
});

test("TemplateRegistry: register throws on missing template string", () => {
  const r = createRegistry();
  assert.throws(() => r.register("x", {}), /template must be a string/);
  assert.throws(() => r.register("x", { template: 123 }), /template must be a string/);
});

// ── generate ─────────────────────────────────────────────────────────────────

test("TemplateRegistry: generate renders a simple template", () => {
  const r = createRegistry();
  r.register("hello", { template: "Hello, {{name}}!" });
  assert.equal(r.generate("hello", { name: "World" }), "Hello, World!");
});

test("TemplateRegistry: generate supports conditional blocks", () => {
  const r = createRegistry();
  r.register("cond", { template: "{{#if show}}visible{{/if}}" });
  assert.equal(r.generate("cond", { show: true }), "visible");
  assert.equal(r.generate("cond", { show: false }), "");
});

test("TemplateRegistry: generate supports iteration blocks", () => {
  const r = createRegistry();
  r.register("items", { template: "{{#each items}}{{name}},{{/each}}" });
  assert.equal(
    r.generate("items", { items: [{ name: "a" }, { name: "b" }] }),
    "a,b,"
  );
});

test("TemplateRegistry: generate throws on unknown template", () => {
  const r = createRegistry();
  assert.throws(
    () => r.generate("no-such-template", {}),
    /unknown template/
  );
});

// ── listTemplates ────────────────────────────────────────────────────────────

test("TemplateRegistry: listTemplates returns all templates when no category given", () => {
  const r = createRegistry();
  r.register("a", { template: "A", category: "cat1" });
  r.register("b", { template: "B", category: "cat2" });

  const list = r.listTemplates();
  assert.ok(list.length >= 2);
});

test("TemplateRegistry: listTemplates filters by category", () => {
  const r = createRegistry();
  r.register("a", { template: "A", category: "cat1" });
  r.register("b", { template: "B", category: "cat2" });

  const filtered = r.listTemplates("cat1");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "a");
});

test("TemplateRegistry: listTemplates returns empty array for unknown category", () => {
  const r = createRegistry();
  assert.deepEqual(r.listTemplates("no-such-cat"), []);
});

// ── validate ─────────────────────────────────────────────────────────────────

test("TemplateRegistry: validate returns valid=true and empty errors for satisfying variables", () => {
  const r = createRegistry();
  r.register("greet", {
    template: "Hello, {{name}}!",
    required: ["name"],
  });

  const result = r.validate("greet", { name: "World" });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("TemplateRegistry: validate detects missing required variables", () => {
  const r = createRegistry();
  r.register("greet", {
    template: "Hello, {{name}}!",
    required: ["name"],
  });

  const result = r.validate("greet", {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
});

test("TemplateRegistry: validate returns error for unknown template", () => {
  const r = createRegistry();
  const result = r.validate("ghost", {});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Unknown template")));
});

test("TemplateRegistry: validate warns about unreferenced variables", () => {
  const r = createRegistry();
  r.register("info", {
    template: "{{user}} is {{age}} years old",
    required: [],
  });

  const result = r.validate("info", { user: "Alice" });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("age")));
});

// ── Built-in templates ──────────────────────────────────────────────────────

test("TemplateRegistry: all 7 built-in templates are registered", () => {
  const r = createRegistry();
  const builtins = r.listTemplates("builtin");
  assert.equal(builtins.length, 7);

  const names = builtins.map((t) => t.name).sort();
  assert.deepEqual(names, [
    ".env",
    "Makefile",
    "docker-compose",
    "github-actions",
    "gitlab-ci",
    "package.json",
    "tsconfig.json",
  ]);
});

test("TemplateRegistry: built-in package.json generates valid JSON", () => {
  const r = createRegistry();
  const output = r.generate("package.json", {
    name: "my-lib",
    version: "2.0.0",
    description: "A test library",
    main: "index.js",
    startScript: "node index.js",
    testScript: "jest",
    buildScript: "tsc",
    lintScript: "eslint .",
    keywordsBlock: '"keywords": ["hax-agent", "node"],',
    author: "Tester",
    license: "MIT",
    dependenciesBlock: '',
    devDependenciesBlock: '',
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.name, "my-lib");
  assert.equal(parsed.version, "2.0.0");
});

test("TemplateRegistry: built-in tsconfig.json generates valid JSON", () => {
  const r = createRegistry();
  const output = r.generate("tsconfig.json", {
    target: "ES2022",
    module: "commonjs",
    moduleResolution: "node",
    strict: "true",
    esModuleInterop: "true",
    skipLibCheck: "true",
    outDir: "dist",
    rootDir: "src",
    declaration: "true",
    sourceMap: "true",
    jsxBlock: "",
    pathsBlock: '"@/*": ["src/*"]',
    include: `"src/**/*"`,
    exclude: `"node_modules", "dist"`,
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.compilerOptions.target, "ES2022");
  assert.equal(parsed.compilerOptions.outDir, "dist");
});

test("TemplateRegistry: built-in .env generates expected content", () => {
  const r = createRegistry();
  const output = r.generate(".env", {
    name: "myapp",
    nodeEnv: "production",
    port: "8080",
    host: "127.0.0.1",
    apiKeys: [{ key: "SERVICE_KEY", value: "sk-test" }],
    logLevel: "debug",
    logFormat: "text",
    featureFlags: [{ name: "BETA", enabled: "true" }],
  });

  assert.ok(output.includes('NODE_ENV=production'));
  assert.ok(output.includes('PORT=8080'));
  assert.ok(output.includes('SERVICE_KEY=sk-test'));
  assert.ok(output.includes('BETA=true'));
});

test("TemplateRegistry: built-in docker-compose generates valid YAML", () => {
  const r = createRegistry();
  const output = r.generate("docker-compose", {
    composeVersion: "3.8",
    name: "web",
    buildContext: ".",
    dockerfile: "Dockerfile",
    containerName: "web-container",
    hostPort: "3000",
    containerPort: "3000",
    restartPolicy: "unless-stopped",
    envVars: [{ key: "NODE_ENV", value: "production" }],
    volumes: [{ source: "./data", target: "/app/data" }],
  });

  assert.ok(output.includes('version: "3.8"'));
  assert.ok(output.includes('container_name: web-container'));
  assert.ok(output.includes('NODE_ENV=production'));
});

test("TemplateRegistry: built-in Makefile generates expected content", () => {
  const r = createRegistry();
  const output = r.generate("Makefile", {
    name: "myproject",
    srcDir: "src",
    testDir: "test",
    installCmd: "npm install",
    buildCmd: "npm run build",
    devCmd: "npm run dev",
    startCmd: "npm start",
    testCmd: "npm test",
    testWatchCmd: "npm run test:watch",
    coverageCmd: "npm run coverage",
    lintCmd: "npm run lint",
    formatCmd: "npm run format",
    typecheckCmd: "npm run typecheck",
    cleanCmd: "rm -rf dist node_modules",
    dockerImage: "myproject:latest",
    hostPort: "3000",
    containerPort: "3000",
  });

  assert.ok(output.includes('.DEFAULT_GOAL := help'));
  assert.ok(output.includes('npm install'));
  assert.ok(output.includes('npm run build'));
  assert.ok(output.includes('docker build'));
});

test("TemplateRegistry: built-in GitHub Actions generates valid YAML", () => {
  const r = createRegistry();
  const output = r.generate("github-actions", {
    workflowName: "CI",
    pushBranches: `"main"`,
    prBranches: `"main"`,
    jobName: "test",
    runsOn: "ubuntu-latest",
    setupNode: true,
    nodeVersion: "20",
    nodePackageManager: "npm",
    steps: [
      { name: "Install", run: "npm ci" },
      { name: "Test", run: "npm test" },
    ],
  });

  assert.ok(output.includes('name: CI'));
  assert.ok(output.includes('branches: ["main"]'));
  assert.ok(output.includes('actions/setup-node@v4'));
  assert.ok(output.includes('node-version: 20'));
  assert.ok(output.includes('npm ci'));
  assert.ok(output.includes('npm test'));
});

test("TemplateRegistry: built-in GitLab CI generates valid content", () => {
  const r = createRegistry();
  const output = r.generate("gitlab-ci", {
    name: "myapp",
    stages: [{ name: "test" }, { name: "deploy" }],
    variables: [{ key: "NODE_VERSION", value: "20" }],
    jobs: [{
      name: "unit-tests",
      stage: "test",
      image: "node:20",
      script: [
        { line: "npm ci" },
        { line: "npm test" },
      ],
      artifacts: [{ path: "coverage/" }],
      only: [{ ref: "main" }],
    }],
  });

  assert.ok(output.includes('stages:'));
  assert.ok(output.includes('- test'));
  assert.ok(output.includes('NODE_VERSION: "20"'));
  assert.ok(output.includes('npm ci'));
});

// ── unregister ───────────────────────────────────────────────────────────────

test("TemplateRegistry: unregister removes a template", () => {
  const r = createRegistry();
  r.register("tmp", { template: "x" });
  assert.equal(r.size >= 1, true);

  const removed = r.unregister("tmp");
  assert.equal(removed, true);
  assert.throws(() => r.generate("tmp", {}), /unknown template/);
});

test("TemplateRegistry: unregister returns false for unknown template", () => {
  const r = createRegistry();
  assert.equal(r.unregister("nope"), false);
});

// ── getCategories ────────────────────────────────────────────────────────────

test("TemplateRegistry: getCategories returns unique sorted categories", () => {
  const r = createRegistry();
  r.register("a", { template: "A", category: "zzz" });
  r.register("b", { template: "B", category: "aaa" });

  const cats = r.getCategories();
  assert.ok(cats.includes("builtin"));
  assert.ok(cats.includes("aaa"));
  assert.ok(cats.includes("zzz"));
  assert.equal(cats[0], "aaa"); // sorted
});
